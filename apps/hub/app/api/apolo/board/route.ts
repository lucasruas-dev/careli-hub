import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// Fila da ESTEIRA de credenciamento: tudo que nasceu pelos canais externos e aguarda o time.
// A entidade já nasce com status 'review' (createApoloEntity), então a fila sai daí — sem tabela
// nova. As ETAPAS da esteira (validado / crédito / pago) ainda não persistem: esta primeira
// versão é o esqueleto navegável pro Lucas validar o layout.
// Ver [[project_esteira_credenciamento_venda]].
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type HubUserRow = { display_name: string | null; email: string | null; id: string };

type EntityRow = {
  created_at: string;
  display_name: string;
  document_masked: string | null;
  entity_kind: string;
  id: string;
  legal_name: string | null;
  metadata: {
    bornRole?: string;
    cadastro?: { corretores?: unknown[]; empreendimentos?: unknown[]; socios?: unknown[] };
  } | null;
  primary_city: string | null;
  primary_state: string | null;
};

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  const adminClient = createApoloAdminClient();
  if (!adminClient) {
    return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });
  }

  const { data, error } = await adminClient
    .from("apolo_entities")
    .select(
      "id, display_name, legal_name, document_masked, entity_kind, metadata, created_at, primary_city, primary_state",
    )
    .eq("status", "review")
    // SÓ o que nasceu pelos canais externos (cadastro/portal). Sem isto a fila trazia ~512
    // entidades vindas do sync do C2X, que estão em 'review' por outro motivo e não são
    // trabalho do operador — a Torre nasceria inútil.
    .eq("metadata->>source", "apolo")
    // Mais antigo primeiro: a fila de trabalho respeita a ordem de chegada.
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: "Nao foi possivel carregar a fila." }, { status: 500 });
  }

  const conta = (valor: unknown): number => (Array.isArray(valor) ? valor.length : 0);

  // Nomes dos empreendimentos: o Lucas precisa ver a QUE empreendimento cada item se refere,
  // tanto nas CADs quanto nas imobiliárias (é o eixo de filtro e ordenação da Torre).
  const nomesEmpreendimentos = (valor: unknown): string[] =>
    Array.isArray(valor)
      ? valor
          .map((item) => {
            const registro = item as { label?: unknown; nome?: unknown };
            const label = registro?.label ?? registro?.nome;
            return typeof label === "string" ? label.trim() : "";
          })
          .filter(Boolean)
      : [];

  const itens = ((data ?? []) as EntityRow[]).map((row) => {
    const cadastro = row.metadata?.cadastro;
    return {
      corretores: conta(cadastro?.corretores),
      criadoEm: row.created_at,
      documento: row.document_masked ?? "",
      empreendimentos: nomesEmpreendimentos(cadastro?.empreendimentos),
      id: row.id,
      nome: row.legal_name || row.display_name,
      papel: row.metadata?.bornRole ?? (row.entity_kind === "pj" ? "imobiliaria" : "prospect"),
      socios: conta(cadastro?.socios),
    };
  });

  // Analistas = usuários internos do hub, pra atribuir quem está cuidando de cada item.
  const { data: usuarios } = await adminClient
    .from("hub_users")
    .select("id, display_name, email")
    .order("display_name", { ascending: true })
    .limit(200);

  const analistas = ((usuarios ?? []) as HubUserRow[])
    .map((row) => ({ id: row.id, nome: row.display_name || row.email || "" }))
    .filter((row) => row.nome);

  // Quem abre o processo assume a análise (regra do Lucas): a tela precisa saber quem está logado.
  const usuarioAtual =
    analistas.find((pessoa) => pessoa.id === auth.userId) ?? null;

  return NextResponse.json(
    { data: { analistas, itens, usuarioAtual } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
