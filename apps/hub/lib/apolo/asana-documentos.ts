// Traz os ANEXOS das CADs do Asana para o Storage do Apolo.
//
// Isto NÃO é iOCR e NÃO custa nada na MOST: só baixa o arquivo do Asana e guarda no bucket
// `apolo-documents`, ligado à entidade. É o que faz a validação lado a lado do Board ter o
// documento de verdade para o analista conferir contra a ficha.
//
// A leitura por iOCR (que é cobrada, R$ 0,506 por imagem) fica para depois e é decisão à
// parte — ver [[project_esteira_credenciamento_venda]].
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

const ASANA_API = "https://app.asana.com/api/1.0";

// O Asana devolve um link assinado e temporário em download_url; o permanent_url é a PÁGINA
// do anexo (precisa de sessão) e não serve para baixar byte.
type AnexoAsana = {
  download_url?: string | null;
  gid: string;
  name?: string | null;
  resource_subtype?: string | null;
  size?: number | null;
};

// Teto de segurança por arquivo. A rota de cadastro usa 28MB de base64 (~20MB de binário);
// aqui somos mais conservadores porque são muitos arquivos numa tacada.
const TAMANHO_MAXIMO_BYTES = 15 * 1024 * 1024;

// Baixar dezenas de anexos em paralelo derruba o rate limit do Asana. Mesmo número já usado
// no relatório de performance do repo.
const CONCORRENCIA = 4;

function token(): string {
  return process.env.ASANA_ACCESS_TOKEN?.trim() ?? "";
}

export type ResultadoDocumentos = {
  baixados: number;
  erros: { motivo: string; tarefa: string }[];
  ignorados: number;
  semAnexo: number;
};

async function listarAnexos(taskGid: string): Promise<AnexoAsana[]> {
  const url = new URL(`${ASANA_API}/tasks/${taskGid}/attachments`);
  url.searchParams.set("opt_fields", "name,download_url,size,resource_subtype");

  const resposta = await fetch(url, {
    cache: "no-store",
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!resposta.ok) {
    throw new Error(`Asana respondeu HTTP ${resposta.status} ao listar anexos.`);
  }
  const json = (await resposta.json()) as { data: AnexoAsana[] };
  return json.data ?? [];
}

// Quais anexos desta entidade já vieram do Asana. Evita subir o mesmo arquivo duas vezes
// quando a importação roda de novo.
async function anexosJaImportados(
  client: AdminClient,
  entityId: string,
): Promise<Set<string>> {
  const { data } = await client
    .from("apolo_documents")
    .select("metadata")
    .eq("entity_id", entityId)
    .limit(200);

  const gids = new Set<string>();
  for (const linha of ((data ?? []) as { metadata: { asanaAnexoGid?: string } | null }[])) {
    const gid = linha.metadata?.asanaAnexoGid;
    if (gid) gids.add(gid);
  }
  return gids;
}

// Um documento por vez: baixa do Asana e sobe pro Storage do Apolo.
async function trazerAnexo(input: {
  anexo: AnexoAsana;
  client: AdminClient;
  entityId: string;
  taskGid: string;
}): Promise<{ erro?: string; ok: boolean }> {
  const { anexo } = input;

  if (!anexo.download_url) {
    return { erro: "anexo sem link de download", ok: false };
  }
  if (anexo.size && anexo.size > TAMANHO_MAXIMO_BYTES) {
    return { erro: `arquivo grande demais (${Math.round(anexo.size / 1024 / 1024)}MB)`, ok: false };
  }

  // O download_url já vem assinado: não mandar o token do Asana para um host de terceiro.
  const resposta = await fetch(anexo.download_url, { cache: "no-store" });
  if (!resposta.ok) {
    return { erro: `download falhou (HTTP ${resposta.status})`, ok: false };
  }

  const buffer = Buffer.from(await resposta.arrayBuffer());
  if (buffer.byteLength > TAMANHO_MAXIMO_BYTES) {
    return { erro: "arquivo grande demais", ok: false };
  }

  const nomeArquivo = anexo.name ?? `anexo-${anexo.gid}`;

  const resultado = await uploadApoloDocument({
    adminClient: input.client,
    // "outro": o tipo real do documento só se sabe lendo, e ler é a etapa paga. O analista
    // classifica na validação.
    documentType: "outro",
    fileBase64: buffer.toString("base64"),
    fileName: nomeArquivo,
    label: nomeArquivo,
    // Guarda a origem: é a chave de dedup e o rastro de onde o arquivo veio.
    metadataExtra: {
      asanaAnexoGid: anexo.gid,
      asanaTaskGid: input.taskGid,
      origem: "asana",
    },
    ownerId: input.entityId,
    scope: "entidade",
    uploadedByName: "Importação do Asana",
  });

  if (resultado.error) return { erro: resultado.error, ok: false };
  return { ok: true };
}

// Processa UM LOTE de CADs. A rota chama isto repetidamente porque baixar centenas de
// arquivos não cabe no tempo de uma requisição só.
export async function trazerDocumentosDoLote(input: {
  client: AdminClient;
  itens: { entityId: string; nome: string; taskGid: string }[];
}): Promise<ResultadoDocumentos> {
  const resultado: ResultadoDocumentos = {
    baixados: 0,
    erros: [],
    ignorados: 0,
    semAnexo: 0,
  };

  for (let i = 0; i < input.itens.length; i += CONCORRENCIA) {
    const bloco = input.itens.slice(i, i + CONCORRENCIA);

    await Promise.all(
      bloco.map(async (item) => {
        try {
          const [anexos, jaImportados] = await Promise.all([
            listarAnexos(item.taskGid),
            anexosJaImportados(input.client, item.entityId),
          ]);

          if (anexos.length === 0) {
            resultado.semAnexo += 1;
            return;
          }

          for (const anexo of anexos) {
            if (jaImportados.has(anexo.gid)) {
              resultado.ignorados += 1;
              continue;
            }

            const { erro, ok } = await trazerAnexo({
              anexo,
              client: input.client,
              entityId: item.entityId,
              taskGid: item.taskGid,
            });

            if (ok) resultado.baixados += 1;
            else resultado.erros.push({ motivo: erro ?? "falha", tarefa: item.nome });
          }
        } catch (erro) {
          resultado.erros.push({
            motivo: (erro as Error).message,
            tarefa: item.nome,
          });
        }
      }),
    );
  }

  return resultado;
}
