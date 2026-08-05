import { createClient } from "@supabase/supabase-js";

import { getServerSupabaseConfig } from "@/lib/supabase/server-config";

import { HUB_IT_TICKET_ATTACHMENT_BUCKET } from "./server";

// Faxina dos anexos legados: o arquivo estava em base64 numa coluna text do
// Postgres (88 anexos = 53MB). Roda DENTRO do app de proposito: a chave de
// servico ja existe no ambiente de producao e nenhuma credencial precisa sair
// do lugar.
//
// Tres modos, nessa ordem:
//   dry-run  conta o que falta, nao escreve nada
//   apply    sobe o arquivo e SO ENTAO grava storage_path (mantem o base64)
//   purge    zera content_data_url das linhas ja migradas, liberando o espaco
//
// Idempotente: `apply` so enxerga linhas com storage_path nulo, entao rodar de
// novo nunca duplica. E o base64 so morre no `purge`, depois de conferido.

export type HubItTicketAttachmentBackfillMode = "apply" | "dry-run" | "purge";

export type HubItTicketAttachmentBackfillResult = {
  failures: string[];
  migrated: number;
  mode: HubItTicketAttachmentBackfillMode;
  pending: number;
  purgeable: number;
  purged: number;
};

type LegacyAttachmentRow = {
  content_data_url: string;
  file_name: string;
  id: string;
  mime_type: string;
  ticket_id: string;
};

// O BUCKET TEM LISTA BRANCA DE TIPOS e compara o texto INTEIRO. Duas coisas quebravam:
//   • a gravação de tela produz `video/webm;codecs=vp8` — é webm, mas o sufixo faz a
//     comparação falhar (17 dos 47 anexos parados);
//   • planilha e CSV simplesmente não estão liberados no bucket (5 anexos).
// Aqui o tipo é limpo do sufixo e, se ainda assim não for aceito, vai como binário genérico —
// que está liberado. Melhor guardar o arquivo com tipo genérico do que não guardar.
const TIPOS_ACEITOS_NO_BUCKET = new Set([
  "application/octet-stream",
  "application/pdf",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
  "text/plain",
  "video/mp4",
  "video/webm",
]);

export function tipoAceitoPeloBucket(mimeType: string | null | undefined): string {
  // `video/webm;codecs=vp8` -> `video/webm`. O parâmetro depois do `;` descreve o codec e não
  // faz parte do tipo para efeito da lista do bucket.
  const limpo = String(mimeType ?? "")
    .split(";")[0]
    ?.trim()
    .toLowerCase();

  if (limpo && TIPOS_ACEITOS_NO_BUCKET.has(limpo)) {
    return limpo;
  }

  return "application/octet-stream";
}

const DEFAULT_BATCH_SIZE = 15;
const MAX_BATCH_SIZE = 40;

export async function backfillHubItTicketAttachments({
  batchSize = DEFAULT_BATCH_SIZE,
  mode,
}: {
  batchSize?: number;
  mode: HubItTicketAttachmentBackfillMode;
}): Promise<HubItTicketAttachmentBackfillResult> {
  const { serviceRoleKey, url } = getServerSupabaseConfig();

  if (!serviceRoleKey || !url) {
    throw new Error("Configure a chave server-side para migrar os anexos.");
  }

  const client = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const failures: string[] = [];
  let migrated = 0;
  let purged = 0;

  if (mode === "purge") {
    const { count, error } = await client
      .from("hub_it_ticket_attachments")
      .update({ content_data_url: null }, { count: "exact" })
      .not("storage_path", "is", null)
      .not("content_data_url", "is", null)
      .select("id");

    if (error) {
      throw new Error(error.message);
    }

    purged = count ?? 0;
  }

  if (mode === "apply") {
    const { data, error } = await client
      .from("hub_it_ticket_attachments")
      .select("id,ticket_id,file_name,mime_type,content_data_url")
      .is("storage_path", null)
      .not("content_data_url", "is", null)
      .order("created_at", { ascending: true })
      .limit(Math.min(Math.max(1, batchSize), MAX_BATCH_SIZE));

    if (error) {
      throw new Error(error.message);
    }

    for (const row of (data ?? []) as LegacyAttachmentRow[]) {
      const decoded = decodeDataUrl(row.content_data_url);

      if (!decoded) {
        failures.push(`${row.file_name}: data-URL invalido`);
        continue;
      }

      const storagePath = `legacy/${row.ticket_id}/${row.id}${resolveExtension(
        row.mime_type,
        row.file_name,
      )}`;
      const upload = await client.storage
        .from(HUB_IT_TICKET_ATTACHMENT_BUCKET)
        .upload(storagePath, decoded.bytes, {
          contentType: tipoAceitoPeloBucket(row.mime_type || decoded.mimeType),
          upsert: true,
        });

      if (upload.error) {
        // O MOTIVO, não só "falhou". A mensagem genérica custou uma investigação inteira:
        // pela tela era impossível saber que o bucket estava recusando o tipo do arquivo.
        failures.push(`${row.file_name}: ${upload.error.message}`);
        continue;
      }

      // So depois do arquivo estar no bucket a linha passa a apontar pra ele.
      const updateResult = await client
        .from("hub_it_ticket_attachments")
        .update({ storage_path: storagePath })
        .eq("id", row.id);

      if (updateResult.error) {
        failures.push(`${row.file_name}: nao consegui gravar o caminho`);
        continue;
      }

      migrated += 1;
    }
  }

  // Quanto ainda falta migrar, e quanto ja pode ter o base64 apagado.
  const [pendingResult, purgeableResult] = await Promise.all([
    client
      .from("hub_it_ticket_attachments")
      .select("id", { count: "exact", head: true })
      .is("storage_path", null)
      .not("content_data_url", "is", null),
    client
      .from("hub_it_ticket_attachments")
      .select("id", { count: "exact", head: true })
      .not("storage_path", "is", null)
      .not("content_data_url", "is", null),
  ]);

  if (pendingResult.error || purgeableResult.error) {
    throw new Error(
      pendingResult.error?.message ??
        purgeableResult.error?.message ??
        "Nao foi possivel contar os anexos.",
    );
  }

  return {
    failures,
    migrated,
    mode,
    pending: pendingResult.count ?? 0,
    purgeable: purgeableResult.count ?? 0,
    purged,
  };
}

// O MESMO `;codecs=` de novo, agora aqui. O regex antigo era `^data:([^;,]+);base64,` — o
// `[^;,]+` para no primeiro `;`, então uma gravação de tela, que chega como
// `data:video/webm;codecs=vp8;base64,...`, NUNCA casava e era reportada como "data-URL
// invalido". O tipo estava certo e o arquivo inteiro estava lá: quem não sabia ler era a gente.
// Agora o tipo é tudo o que vem antes do `;base64,`, com os parâmetros que houver.
export function decodeDataUrl(dataUrl: string) {
  const match = /^data:(.*?);base64,(.+)$/s.exec(dataUrl.trim());

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return { bytes: Buffer.from(match[2], "base64"), mimeType: match[1] };
}

function resolveExtension(mimeType: string, fileName: string) {
  const fromName = /\.([a-z0-9]{1,8})$/i.exec(fileName)?.[1];

  if (fromName) {
    return `.${fromName.toLowerCase()}`;
  }

  const byMimeType: Record<string, string> = {
    "audio/webm": ".webm",
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "video/mp4": ".mp4",
    "video/webm": ".webm",
  };

  return byMimeType[mimeType] ?? "";
}
