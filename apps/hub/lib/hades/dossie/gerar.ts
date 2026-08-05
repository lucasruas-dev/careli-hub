import {
  listApoloDocuments,
  uploadApoloDocument,
} from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";

import { montarDadosDoDossie, type DossieDados } from "./dados";
import { gerarDossiePdf } from "./pdf";
import { carregarTratativas } from "./tratativas";

// GERA O DOSSIÊ E ANEXA NOS DOCUMENTOS DO CLIENTE.
//
// Pedido do Lucas (03/08): "dentro do cliente, na parte de negociação ter um botão para gerar esse
// documento e anexar aos demais documentos dele".
//
// Ordem de propósito: gera o PDF PRIMEIRO e só depois tenta anexar. Se a entidade do Apolo não for
// encontrada, o operador ainda recebe o documento para levar ao jurídico — o dossiê é o
// entregável, o anexo é a conveniência. Um retorno com `anexado: false` diz exatamente isso.

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export const DOSSIE_DOC_TYPE = "dossie-juridico";

export type DossieResultado = {
  anexado: boolean;
  bytes: Uint8Array;
  dados: DossieDados;
  documentId?: string;
  erroAnexo?: string;
  nomeArquivo: string;
};

// O nome do arquivo é o que o jurídico vê na pasta: tipo, cliente, contrato e data.
function nomeDoArquivo(d: DossieDados): string {
  const cliente = d.cliente
    .trim()
    .toLocaleLowerCase("pt-BR")
    .replace(/\s+/g, " ")
    .replace(/(^|\s)\p{L}/gu, (c) => c.toUpperCase())
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .trim();
  const hoje = new Date().toISOString().slice(0, 10).split("-").reverse().join("-");

  return `Dossiê Jurídico - ${cliente} - ${d.codigoVenda} - ${hoje}.pdf`;
}

// A entidade do Apolo vem do vínculo com o C2X. `apolo_entities.document_hash` é NULO nas
// entidades que nasceram do C2X, então buscar por documento perde justamente esses clientes —
// o caminho certo é apolo_source_links (source_table "users").
async function entidadeDoCliente(
  client: AdminClient,
  clienteC2xId: number | null,
): Promise<null | string> {
  if (!clienteC2xId) return null;

  const { data } = await client
    .from("apolo_source_links")
    .select("entity_id")
    .eq("source_system", "c2x")
    .eq("source_table", "users")
    .eq("source_id", String(clienteC2xId))
    .limit(1)
    .returns<Array<{ entity_id: string }>>();

  return data?.[0]?.entity_id ?? null;
}

export async function gerarDossieJuridico(input: {
  acquisitionRequestId: number;
  client: AdminClient;
  correcaoPercent?: null | number;
  correcaoReferencia?: null | string;
  motivoEncaminhamento: string;
  processo?: null | string;
  recomendacao: string;
  responsavel: string;
}): Promise<{ error: string; ok: false } | { ok: true; resultado: DossieResultado }> {
  const dados = await montarDadosDoDossie({
    acquisitionRequestId: input.acquisitionRequestId,
    correcaoPercent: input.correcaoPercent,
  });
  if (!dados) return { error: "Negociação não encontrada no C2X.", ok: false };

  const entityId = await entidadeDoCliente(input.client, dados.clienteC2xId);

  // As tratativas são do CLIENTE (o motor não guarda o vínculo por negociação). Falha aqui não
  // derruba o dossiê: o documento sai com a seção 6 vazia, que é honesto.
  let tratativas: Awaited<ReturnType<typeof carregarTratativas>> = [];
  if (dados.clienteC2xId) {
    try {
      tratativas = await carregarTratativas({
        client: input.client,
        clienteC2xId: dados.clienteC2xId,
      });
    } catch {
      tratativas = [];
    }
  }

  // A seção 7 lista o que ESTÁ mesmo anexado na ficha do cliente — não uma promessa.
  let documentosAnexos: string[] = [];
  if (entityId) {
    try {
      const docs = await listApoloDocuments(input.client, "entidade", entityId);
      documentosAnexos = docs.map((d) => d.label || d.documentType || "").filter(Boolean);
    } catch {
      documentosAnexos = [];
    }
  }

  const bytes = await gerarDossiePdf(dados, {
    correcaoPercent: input.correcaoPercent ?? null,
    correcaoReferencia: input.correcaoReferencia ?? null,
    documentosAnexos,
    motivoEncaminhamento: input.motivoEncaminhamento,
    processo: input.processo?.trim() || `HAD-${dados.codigoVenda}`,
    recomendacao: input.recomendacao,
    responsavel: input.responsavel,
    tratativas,
  });

  const nomeArquivo = nomeDoArquivo(dados);
  const resultado: DossieResultado = { anexado: false, bytes, dados, nomeArquivo };

  if (!entityId) {
    resultado.erroAnexo = "Cliente sem ficha no Apolo: o dossiê foi gerado mas não ficou anexado.";
    return { ok: true, resultado };
  }

  // Cada dossiê é uma peça datada — NÃO substitui o anterior. O jurídico precisa da série
  // histórica (o de março mostra o que se sabia em março).
  const salvo = await uploadApoloDocument({
    adminClient: input.client,
    documentType: DOSSIE_DOC_TYPE,
    fileBase64: Buffer.from(bytes).toString("base64"),
    fileName: nomeArquivo,
    label: `Dossiê Jurídico - ${dados.codigoVenda}`,
    metadataExtra: {
      acquisitionRequestId: input.acquisitionRequestId,
      codigoVenda: dados.codigoVenda,
      correcaoPercent: input.correcaoPercent ?? null,
      geradoEm: dados.geradoEm,
      origem: "hades-dossie",
      valorAtualizado: dados.valorInadimplenciaAtualizado,
    },
    mimeType: "application/pdf",
    ownerId: entityId,
    scope: "entidade",
    uploadedByName: input.responsavel,
  });

  if (!salvo.ok || !salvo.id) {
    resultado.erroAnexo = salvo.error ?? "Falha ao anexar o dossiê na ficha do cliente.";
    return { ok: true, resultado };
  }

  resultado.anexado = true;
  resultado.documentId = salvo.id;
  return { ok: true, resultado };
}
