import { randomUUID } from "node:crypto";

import { createPrometeuClient } from "@/lib/prometeu/data";

// A PA — a folha A4 com a proposta preenchida no salão de vendas.
//
// POR QUE ELA EXISTE AQUI: parte do atendimento acontece REMOTO, com gente que não está no
// evento. Quem atende de fora não tem o papel na mão, então a única forma de lançar a proposta
// é ver a foto. Registrar a PA no bip da secretaria é o que torna o atendimento remoto possível.
//
// REGRA DO LUCAS (27/07): o bip PASSA sem PA — não trava a fila, porque no dia a internet cai,
// a foto sai tremida e o celular enche. Mas quem está sem PA **não pode ser encaminhado para
// atendimento REMOTO**; presencial pode, que ali o atendente tem o papel na mesa.
//
// ONDE FICA: o caminho do arquivo vai em `prometeu_credenciados.metadata.pa` (jsonb que já
// existe — sem migration). ⚠️ O campo do caminho é EXATAMENTE o que se perdeu no Zeus e deixou
// anexos invisíveis por 13 dias: aqui a gravação recusa PA sem caminho, e a leitura tem teste.

export const PROMETEU_PA_BUCKET = "prometeu-pa";

export type PaDoCredenciado = {
  // Caminho no Storage. É o dado que não pode se perder.
  path: string;
  registradaEm: string;
  // Quem fotografou: operador do evento (freela) ou usuário do hub.
  registradaPor: string | null;
};

// Lê a PA de dentro do metadata, tolerando qualquer lixo que esteja lá. Um metadata sem PA, com
// PA malformada ou com `path` vazio devolve `null` — que a tela mostra como "PA pendente".
export function lerPa(metadata: unknown): PaDoCredenciado | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }

  const bruta = (metadata as Record<string, unknown>).pa;

  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) {
    return null;
  }

  const registro = bruta as Record<string, unknown>;
  const path = typeof registro.path === "string" ? registro.path.trim() : "";

  // Sem caminho não há arquivo: melhor dizer "pendente" do que exibir um link quebrado no dia
  // do atendimento.
  if (!path) return null;

  return {
    path,
    registradaEm:
      typeof registro.registradaEm === "string" ? registro.registradaEm : "",
    registradaPor:
      typeof registro.registradaPor === "string" ? registro.registradaPor : null,
  };
}

// Pode ir para a fila REMOTA? Só com a PA registrada.
export function podeAtenderRemoto(metadata: unknown): boolean {
  return lerPa(metadata) !== null;
}

// Prepara o envio: devolve uma URL assinada e o cliente manda os bytes DIRETO para o Storage.
// A foto de um A4 passa fácil dos 4,5 MB que a function da Vercel aceita no corpo.
export async function criarUrlDeUploadDaPa(input: {
  credenciadoId: string;
  eventoId: string;
}) {
  const client = createPrometeuClient();

  if (!client) {
    throw new Error("Supabase indisponivel para registrar a PA.");
  }

  // Caminho por EVENTO e por CREDENCIADO: facilita achar tudo de um lançamento e apagar um
  // evento inteiro depois, sem varrer o bucket.
  const path = `${input.eventoId}/${input.credenciadoId}/${randomUUID()}.jpg`;
  const assinada = await client.storage
    .from(PROMETEU_PA_BUCKET)
    .createSignedUploadUrl(path);

  if (assinada.error || !assinada.data) {
    throw new Error(
      assinada.error?.message ?? "Nao foi possivel preparar o envio da PA.",
    );
  }

  return {
    bucket: PROMETEU_PA_BUCKET,
    path: assinada.data.path,
    token: assinada.data.token,
  };
}

// Carimba a PA no credenciado. MERGE no metadata: escrever o objeto inteiro apagaria em
// silêncio o que a esteira gravou ali (mesma armadilha do Apolo e da fila do Direct).
export async function registrarPa(input: {
  credenciadoId: string;
  path: string;
  registradaPor?: string | null;
}): Promise<{ error?: string; ok: boolean }> {
  const caminho = input.path.trim();

  // Recusa PA sem caminho ANTES de gravar. Foi assim que o Zeus ficou com 20 anexos órfãos:
  // a linha existia, o arquivo estava no bucket, e ninguém sabia onde.
  if (!caminho) {
    return { error: "PA sem arquivo: nada foi registrado.", ok: false };
  }

  const client = createPrometeuClient();

  if (!client) {
    return { error: "Supabase indisponivel.", ok: false };
  }

  const { data: atual } = await client
    .from("prometeu_credenciados")
    .select("metadata")
    .eq("id", input.credenciadoId)
    .maybeSingle<{ metadata: unknown }>();

  const metadataAtual =
    atual?.metadata && typeof atual.metadata === "object" && !Array.isArray(atual.metadata)
      ? (atual.metadata as Record<string, unknown>)
      : {};

  const pa: PaDoCredenciado = {
    path: caminho,
    registradaEm: new Date().toISOString(),
    registradaPor: input.registradaPor ?? null,
  };

  const { error } = await client
    .from("prometeu_credenciados")
    .update({ metadata: { ...metadataAtual, pa }, updated_at: new Date().toISOString() })
    .eq("id", input.credenciadoId);

  if (error) return { error: error.message, ok: false };

  // A PA TAMBÉM VIRA DOCUMENTO DO CADASTRO (Lucas, 03/08). Best-effort de propósito: o bip da
  // secretaria não pode falhar porque o Apolo demorou — a foto já está salva e o backfill
  // (scripts/prometeu/backfill-pa-apolo.mjs) recupera qualquer uma que escapar aqui.
  try {
    const { data: cred } = await client
      .from("prometeu_credenciados")
      .select("entity_id, nome")
      .eq("id", input.credenciadoId)
      .maybeSingle<{ entity_id: string | null; nome: string }>();
    if (cred) {
      const { registrarPaNoApolo } = await import("@/lib/prometeu/pa-para-apolo");
      await registrarPaNoApolo({
        entityId: cred.entity_id,
        metadata: { pa },
        nomeCliente: cred.nome,
      });
    }
  } catch {
    // silencioso: o backfill cobre.
  }

  return { ok: true };
}

// URL temporária para ABRIR a PA (o atendente remoto lançando a proposta). O bucket é privado:
// a foto tem dado de cliente e não pode ficar em link público.
export async function urlParaVerPa(
  path: string,
  segundos = 3600,
): Promise<string | null> {
  const client = createPrometeuClient();

  if (!client || !path) return null;

  const { data } = await client.storage
    .from(PROMETEU_PA_BUCKET)
    .createSignedUrl(path, segundos);

  return data?.signedUrl ?? null;
}
