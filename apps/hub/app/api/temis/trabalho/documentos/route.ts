import { NextResponse } from "next/server";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarLeituraDeContrato } from "@/lib/temis/autorizacao";

// OS DOCUMENTOS DA VENDA, VISTOS PELA TÊMIS — a segunda aba da coluna fixa.
//
// Lucas (09/09/2026): *"chat - documentos - (trazer os documentos dos propronentes) historico"*.
//
// ⚠️ DUAS FONTES, E ELE PEDIU AS DUAS. `hercules_documentos` guarda o que foi trocado NA VENDA
// (contrato gerado, comprovante, anexo do corretor) e tem `proposta_id`; `apolo_documents` guarda
// os documentos DA PESSOA (RG, CPF, comprovante de renda), colhidos na CAD, e é chaveado por
// `entity_id`. "Trazer os documentos dos proponentes" é a segunda — e ela não aparece na tela do
// Hércules, que só mostra a primeira.
//
// ⚠️ O ARQUIVO NÃO VIAJA AQUI. Esta rota lista; abrir é `?abrir=<id>`, que devolve URL assinada de
// 10 minutos. O bucket é privado, e mandar bytes numa listagem carregaria o dobro do que a tela
// mostra.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const WORKSPACE = "careli";
const BUCKET = "apolo-documents";
/** Dez minutos: tempo de abrir e ler, não de guardar o link. */
const VALIDADE_SEGUNDOS = 600;

type DocumentoNaTela = {
  criadoEm: string;
  /** `venda` ou `proponente` — a tela separa em dois blocos. */
  fonte: "proponente" | "venda";
  id: string;
  nome: string;
  quem: null | string;
  tipo: null | string;
};

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const propostaId = (url.searchParams.get("proposta") ?? "").trim();
  const abrir = (url.searchParams.get("abrir") ?? "").trim();
  const fonte = (url.searchParams.get("fonte") ?? "venda").trim();

  if (!propostaId) {
    return NextResponse.json({ error: "Proposta não informada." }, { status: 400 });
  }

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  // ── ABRIR UM DOCUMENTO ────────────────────────────────────────────────────
  if (abrir) {
    const tabela = fonte === "proponente" ? "apolo_documents" : "hercules_documentos";
    const colunaDoCaminho = fonte === "proponente" ? "storage_path" : "caminho";

    const { data: doc } = await admin
      .from(tabela)
      .select(colunaDoCaminho)
      .eq("id", abrir)
      .maybeSingle<Record<string, null | string>>();

    const caminho = doc?.[colunaDoCaminho];
    if (!caminho) {
      return NextResponse.json({ error: "Documento não encontrado." }, { status: 404 });
    }

    const { data: assinada, error } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(caminho, VALIDADE_SEGUNDOS);

    if (error || !assinada?.signedUrl) {
      console.error("[temis][documentos] falha ao assinar", error);
      return NextResponse.json({ error: "Não foi possível abrir." }, { status: 503 });
    }

    return NextResponse.json(
      { data: { url: assinada.signedUrl } },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  // ── LISTAR ────────────────────────────────────────────────────────────────
  try {
    const daVenda = await admin
      .from("hercules_documentos")
      .select("id, tipo, nome, enviado_por_nome, criado_em")
      .eq("workspace_id", WORKSPACE)
      .eq("proposta_id", propostaId)
      // ⚠️ REMOVIDO CONTINUA NA TABELA. Sem este filtro a lista mostra o que alguém apagou de
      // propósito — inclusive versão de contrato substituída.
      .is("removido_em", null)
      .order("criado_em", { ascending: false });

    if (daVenda.error) throw new Error(daVenda.error.message);

    // Os documentos DA PESSOA: chegam pelo cliente da proposta, não pela proposta.
    const { data: proposta } = await admin
      .from("hercules_propostas")
      .select("cliente_entity_id")
      .eq("id", propostaId)
      .maybeSingle<{ cliente_entity_id: null | string }>();

    const doProponente = proposta?.cliente_entity_id
      ? await admin
          .from("apolo_documents")
          .select("id, document_type, label, created_at")
          .eq("entity_id", proposta.cliente_entity_id)
          .order("created_at", { ascending: false })
      : { data: [], error: null };

    if (doProponente.error) throw new Error(doProponente.error.message);

    const documentos: DocumentoNaTela[] = [
      ...((daVenda.data ?? []) as Array<Record<string, null | string>>).map((d) => ({
        criadoEm: String(d.criado_em),
        fonte: "venda" as const,
        id: String(d.id),
        nome: String(d.nome ?? "Documento"),
        quem: d.enviado_por_nome ?? null,
        tipo: d.tipo ?? null,
      })),
      ...((doProponente.data ?? []) as Array<Record<string, null | string>>).map((d) => ({
        criadoEm: String(d.created_at),
        fonte: "proponente" as const,
        id: String(d.id),
        nome: String(d.label ?? d.document_type ?? "Documento"),
        quem: null,
        tipo: d.document_type ?? null,
      })),
    ];

    return NextResponse.json(
      { data: { documentos } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    console.error("[temis][documentos] falha ao listar", erro);
    return NextResponse.json(
      { error: "Não foi possível carregar os documentos." },
      { status: 503 },
    );
  }
}
