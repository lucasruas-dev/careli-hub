// Comprovante da consulta de crédito: orquestra a GERAÇÃO (dados da consulta -> PDF com QR ->
// salvo na pasta do cliente) e a VERIFICAÇÃO pública (token do QR -> autenticidade; detalhes só
// com a senha do empreendimento).
//
// Fonte dos valores: a linha em serasa_consultas (imutável). O comprovante NUNCA inventa nada — a
// verificação pública lê SEMPRE do banco, nunca do que veio no PDF.

import { createHash } from "node:crypto";

import { lerCadDaEsteira } from "@/lib/apolo/esteira-cad";
import { resolverLimiteCredito } from "@/lib/apolo/limite-credito";
import { uploadApoloDocument } from "@/lib/apolo/documentos";
import type { createApoloAdminClient } from "@/lib/apolo/server";
import { avaliarCredito, totalRestricoes } from "@/lib/serasa/avaliacao";
import {
  emitirTokenComprovante,
  verificarTokenComprovante,
} from "@/lib/serasa/comprovante-token";
import { montarComprovantePdf, type ComprovanteRestricao } from "@/lib/serasa/comprovante-pdf";
import { resumirRelatorio } from "@/lib/serasa/resumo";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// Domínio público FIXO do QR de verificação. Não usa NEXT_PUBLIC_APP_URL de propósito: essa env
// vem errada em alguns ambientes (no .env.local aponta pra URL do Supabase), e um QR gerado com o
// domínio errado não abre. O domínio de produção é estável; se mudar, é uma linha.
const BASE_URL = "https://c2x.app.br";
export const COMPROVANTE_DOC_TYPE = "comprovante-credito";

// Blocos de negativeData -> rótulo humano. Blocos desconhecidos caem no próprio nome.
const RESTRICAO_ROTULOS: Record<string, string> = {
  check: "Cheques sem fundo (CCF)",
  collectionRecords: "Registros de cobrança",
  notary: "Protestos",
  pefin: "Pendências financeiras (Pefin)",
  refin: "Restrições financeiras (Refin)",
};

type ConsultaRow = {
  ambiente: string | null;
  created_at: string;
  documento: string | null;
  entity_id: string | null;
  finalidade: string | null;
  id: string;
  report_name: string | null;
  resposta: unknown;
  solicitado_por: string | null;
  status: string | null;
  tipo_pessoa: string | null;
};

function comoRegistro(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

// Detalhamento das restrições (dívidas vencidas) por bloco, só os que têm ocorrência ou valor.
function detalharRestricoes(cru: unknown): ComprovanteRestricao[] {
  const relatorio = comoRegistro((comoRegistro(cru)?.reports as unknown[] | undefined)?.[0]);
  const negativeData = comoRegistro(relatorio?.negativeData);
  if (!negativeData) return [];

  const out: ComprovanteRestricao[] = [];
  for (const [bloco, conteudo] of Object.entries(negativeData)) {
    const summary = comoRegistro(comoRegistro(conteudo)?.summary);
    const quantidade = Number(summary?.count) || 0;
    const valor = Number(summary?.balance) || 0;
    if (quantidade <= 0 && valor <= 0) continue;
    out.push({ quantidade, rotulo: RESTRICAO_ROTULOS[bloco] ?? bloco, valor });
  }
  return out;
}

// Fingerprint dos valores IMUTÁVEIS da consulta (congelados em serasa_consultas.resposta):
// assinado no token; recomputado do banco na verificação — se divergir, o comprovante não
// corresponde ao registro. NÃO inclui o veredito (aprovado): ele é recomputado do limite do
// empreendimento, que é MUTÁVEL (editável) e depende do C2X — incluí-lo faria um comprovante
// GENUÍNO falhar a verificação só porque o limite mudou ou o C2X caiu. A página pública nem mostra
// o veredito, então ele não pertence à assinatura. Ordem/formato fixos.
function fingerprint(input: {
  documento: string;
  id: string;
  score: number | null;
  total: number;
}): string {
  const canonico = [input.id, input.documento, input.score ?? "", input.total.toFixed(2)].join("|");
  return createHash("sha256").update(canonico).digest("hex");
}

function formatarDocumento(doc: string, mascarar = false): string {
  const d = (doc ?? "").replace(/\D/g, "");
  if (d.length === 11) {
    return mascarar
      ? `${d.slice(0, 3)}.***.***-${d.slice(9)}`
      : `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }
  if (d.length === 14) {
    return mascarar
      ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-${d.slice(12)}`
      : `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }
  return doc ?? "";
}

function protocoloDe(id: string): string {
  return `SR-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function dataBR(iso: string): string {
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";
  // Sempre no horário de Brasília: o servidor (Vercel) roda em UTC, e sem timeZone a hora sairia
  // 3h adiantada no comprovante e na verificação.
  return dt.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  });
}

// Núcleo compartilhado: lê a consulta e computa tudo que o comprovante e a verificação usam.
async function montarNucleo(client: AdminClient, consulta: ConsultaRow) {
  const cru = consulta.resposta;
  const documentoDigitos = (consulta.documento ?? "").replace(/\D/g, "");
  const resumo = resumirRelatorio(cru);
  const entityId = consulta.entity_id ?? "";

  const limite = entityId ? await resolverLimiteCredito(client, entityId) : null;
  const veredito = avaliarCredito(cru, limite ?? 1000);
  const total = totalRestricoes(cru);
  const score = typeof resumo.score === "number" ? resumo.score : null;

  let cliente = resumo.nome ?? "";
  if (entityId) {
    const { data: ent } = await client
      .from("apolo_entities")
      .select("display_name, legal_name")
      .eq("id", entityId)
      .maybeSingle<{ display_name: string; legal_name: string | null }>();
    cliente = (ent?.legal_name || ent?.display_name || cliente || "").trim();
  }

  let empreendimento = "";
  if (entityId) {
    // O comprovante é da CONSULTA, que não carrega empreendimento. Sem escopo, a CAD MAIS
    // RECENTE — é o rótulo mais provável e o campo é informativo (não decide nada).
    const est = await lerCadDaEsteira<{ empreendimento: string | null }>(
      client,
      entityId,
      "empreendimento",
    );
    empreendimento = (est?.empreendimento ?? "").trim();
  }

  const h = fingerprint({ documento: documentoDigitos, id: consulta.id, score, total });

  return {
    ambiente: consulta.ambiente ?? "producao",
    cliente: cliente || "Cliente",
    documentoDigitos,
    emitidoEm: dataBR(consulta.created_at),
    empreendimento,
    entityId,
    faixa: resumo.faixa,
    h,
    protocolo: protocoloDe(consulta.id),
    restricoes: detalharRestricoes(cru),
    score,
    veredito,
  };
}

async function buscarConsulta(client: AdminClient, consultaId: string): Promise<ConsultaRow | null> {
  const { data } = await client
    .from("serasa_consultas")
    .select(
      "id, entity_id, documento, resposta, ambiente, created_at, status, report_name, solicitado_por, finalidade, tipo_pessoa",
    )
    .eq("id", consultaId)
    .maybeSingle<ConsultaRow>();
  return data ?? null;
}

// GERA o comprovante PDF (com QR) e SALVA na pasta do cliente (apolo_documents). Best-effort:
// devolve {ok:false} sem lançar. Idempotente por consulta: remove um comprovante anterior da
// MESMA consulta antes de gravar o novo (não acumula ao regerar).
export async function gerarESalvarComprovante(
  client: AdminClient,
  consultaId: string,
  opts: { uploadedByName?: string | null } = {},
): Promise<{ documentId?: string; error?: string; ok: boolean }> {
  try {
    const consulta = await buscarConsulta(client, consultaId);
    if (!consulta) return { error: "Consulta nao encontrada.", ok: false };
    if (consulta.status && consulta.status !== "sucesso") {
      return { error: "Consulta sem resultado.", ok: false };
    }
    if (!consulta.entity_id) return { error: "Consulta sem ficha.", ok: false };

    const n = await montarNucleo(client, consulta);

    // Token do QR (id + fingerprint). Sem segredo, segue sem QR (o comprovante ainda vale como
    // documento, só não fica verificável online).
    const emitido = emitirTokenComprovante({ h: n.h, id: consulta.id });
    const qrUrl = emitido.ok
      ? `${BASE_URL}/publico/verificar?c=${encodeURIComponent(emitido.token)}`
      : "";

    const pdf = await montarComprovantePdf({
      ambiente: n.ambiente,
      autenticacao: n.protocolo,
      cliente: n.cliente,
      data: n.emitidoEm,
      documento: formatarDocumento(n.documentoDigitos),
      empreendimento: n.empreendimento || undefined,
      faixa: n.faixa,
      protocolo: n.protocolo,
      qrUrl,
      restricoes: n.restricoes,
      score: n.score,
      scoreModelo: n.faixa,
      veredito: n.veredito,
    });

    // Idempotência: apaga comprovante anterior desta MESMA consulta.
    const { data: antigos } = await client
      .from("apolo_documents")
      .select("id, storage_bucket, storage_path")
      .eq("entity_id", consulta.entity_id)
      .eq("document_type", COMPROVANTE_DOC_TYPE)
      .contains("metadata", { consultaId: consulta.id });
    for (const a of (antigos ?? []) as { id: string; storage_bucket: string | null; storage_path: string | null }[]) {
      if (a.storage_path) {
        await client.storage.from(a.storage_bucket ?? "apolo-documents").remove([a.storage_path]);
      }
      await client.from("apolo_documents").delete().eq("id", a.id);
    }

    const salvo = await uploadApoloDocument({
      adminClient: client,
      documentType: COMPROVANTE_DOC_TYPE,
      fileBase64: Buffer.from(pdf).toString("base64"),
      fileName: `Comprovante ${n.protocolo}.pdf`,
      label: `Comprovante de credito ${n.protocolo}`,
      metadataExtra: { consultaId: consulta.id, protocolo: n.protocolo },
      mimeType: "application/pdf",
      ownerId: consulta.entity_id,
      scope: "entidade",
      uploadedByName: opts.uploadedByName ?? null,
    });

    if (!salvo.ok) return { error: salvo.error, ok: false };
    return { documentId: salvo.id, ok: true };
  } catch (e) {
    return { error: (e as Error).message, ok: false };
  }
}

// ---- Verificação pública ---------------------------------------------------------------------

export type VerificacaoComprovante = {
  ambiente?: string; // "producao" | "homologacao"
  autentico: boolean;
  documento?: string; // mascarado
  emitidoEm?: string;
  empreendimento?: string;
  error?: string;
  finalidade?: string;
  operador?: string;
  protocolo?: string;
  relatorio?: string; // report_name do Serasa
  tipoPessoa?: string; // "PF" | "PJ"
};

// Confere o token do QR + a integridade do registro e devolve os DADOS TÉCNICOS da consulta
// (autorização/requisição feita ao Serasa): quando, por quem, qual relatório, ambiente. NÃO
// revela dado de crédito (score/dívidas) — esses vivem no PDF. Sem senha, por decisão do Lucas.
export async function verificarComprovante(
  client: AdminClient,
  token: string | null | undefined,
): Promise<VerificacaoComprovante> {
  const tk = verificarTokenComprovante(token);
  if (!tk.ok) return { autentico: false, error: tk.error };

  const consulta = await buscarConsulta(client, tk.payload.id);
  if (!consulta || consulta.status === "erro") {
    return { autentico: false, error: "Comprovante nao localizado." };
  }

  const n = await montarNucleo(client, consulta);
  // Integridade: o fingerprint assinado tem que bater com o recomputado do banco.
  if (n.h !== tk.payload.h) {
    return { autentico: false, error: "Comprovante inconsistente com o registro." };
  }

  // Operador que solicitou a consulta (nome no hub_users; e-mail como reserva).
  let operador = "";
  if (consulta.solicitado_por && /^[0-9a-f-]{36}$/i.test(consulta.solicitado_por)) {
    const { data } = await client
      .from("hub_users")
      .select("display_name, email")
      .eq("id", consulta.solicitado_por)
      .maybeSingle<{ display_name: string | null; email: string | null }>();
    operador = (data?.display_name || data?.email || "").trim();
  }

  return {
    ambiente: consulta.ambiente ?? "producao",
    autentico: true,
    documento: formatarDocumento(n.documentoDigitos, true),
    emitidoEm: n.emitidoEm,
    empreendimento: n.empreendimento || undefined,
    finalidade: consulta.finalidade ?? undefined,
    operador: operador || undefined,
    protocolo: n.protocolo,
    relatorio: consulta.report_name ?? undefined,
    tipoPessoa: consulta.tipo_pessoa ? consulta.tipo_pessoa.toUpperCase() : undefined,
  };
}
