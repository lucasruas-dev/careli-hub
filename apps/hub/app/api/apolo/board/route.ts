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

// Estado do item na esteira do Board. Mora em tabela própria justamente para sobreviver ao
// sync do C2X, que substitui o metadata da entidade a cada rodada.
type EsteiraRow = {
  analista_id: string | null;
  chegou_em: string | null;
  corretor: string | null;
  empreendimento: string | null;
  entity_id: string;
  etapa: string | null;
  imobiliaria: string | null;
};

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
    // Onde o item está na esteira. Fica no metadata (jsonb livre) em vez de coluna própria.
    esteira?: {
      analistaId?: string | null;
      atualizadoEm?: string;
      chegouEm?: string | null;
      corretor?: string | null;
      empreendimento?: string | null;
      etapa?: string;
      imobiliaria?: string | null;
      origem?: string;
    };
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

  const CAMPOS =
    "id, display_name, legal_name, document_masked, entity_kind, metadata, created_at, primary_city, primary_state";

  // A fila tem DUAS origens e elas não se sobrepõem:
  //
  // (a) o que nasceu pelos canais externos (wizard/portal) e aguarda validação. O filtro por
  //     source='apolo' existe porque sem ele entravam ~512 entidades do sync do C2X, que estão
  //     em 'review' por outro motivo e não são trabalho do operador.
  // (b) o que já foi COLOCADO na esteira — hoje, as CADs importadas do Asana. Essas são
  //     cadastros antigos: status 'active' e sem source, então o filtro (a) as excluiria e a
  //     coluna Credenciado ficaria vazia mesmo com a importação tendo funcionado.
  // A esteira vive em `apolo_esteira` (tabela própria). Ela NÃO pode morar no metadata da
  // entidade: o sync do C2X faz upsert substituindo o metadata inteiro, e em 20/jul isso
  // apagou etapa e analista de 122 CADs importadas.
  const { data: esteiraRows } = await adminClient
    .from("apolo_esteira")
    .select(
      "entity_id, etapa, analista_id, chegou_em, corretor, empreendimento, imobiliaria",
    )
    .limit(2000);

  const esteiraPorEntidade = new Map(
    ((esteiraRows ?? []) as EsteiraRow[]).map((row) => [row.entity_id, row]),
  );
  const idsNaEsteira = [...esteiraPorEntidade.keys()];

  const [daFila, naEsteira] = await Promise.all([
    adminClient
      .from("apolo_entities")
      .select(CAMPOS)
      .eq("status", "review")
      .eq("metadata->>source", "apolo")
      .order("created_at", { ascending: true })
      .limit(200),
    idsNaEsteira.length > 0
      ? adminClient
          .from("apolo_entities")
          .select(CAMPOS)
          .in("id", idsNaEsteira.slice(0, 1000))
          .order("created_at", { ascending: true })
          .limit(1000)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (daFila.error && naEsteira.error) {
    return NextResponse.json({ error: "Nao foi possivel carregar a fila." }, { status: 500 });
  }

  // Uma entidade pode cair nas duas consultas: dedup por id, preservando a ordem de chegada.
  const porId = new Map<string, EntityRow>();
  for (const row of [...(daFila.data ?? []), ...(naEsteira.data ?? [])] as EntityRow[]) {
    if (!porId.has(row.id)) porId.set(row.id, row);
  }
  const data = [...porId.values()].sort((a, b) =>
    a.created_at.localeCompare(b.created_at),
  );

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

  const itens = data.map((row) => {
    const cadastro = row.metadata?.cadastro;
    const esteira = esteiraPorEntidade.get(row.id);

    // O empreendimento vem do cadastro (quem nasceu no wizard) OU da esteira (quem foi
    // importado do Asana, que é cadastro antigo e não tem metadata.cadastro).
    const doCadastro = nomesEmpreendimentos(cadastro?.empreendimentos);
    const empreendimentos =
      doCadastro.length > 0
        ? doCadastro
        : esteira?.empreendimento
          ? [esteira.empreendimento]
          : [];

    return {
      // Responsável salvo. Sem isto o Board volta a mostrar "Sem analista" a cada carga.
      analistaId: esteira?.analista_id ?? null,
      corretor: esteira?.corretor ?? null,
      corretores: conta(cadastro?.corretores),
      // Quando a CAD chegou. Para o que veio do Asana é a data da própria CAD; o created_at
      // da entidade seria a data do SYNC do C2X (100 das 122 no mesmo segundo), que não diz
      // nada sobre a chegada e ainda ordenaria a fila errado.
      criadoEm: esteira?.chegou_em ?? row.created_at,
      documento: row.document_masked ?? "",
      empreendimentos,
      imobiliaria: esteira?.imobiliaria ?? null,
      // A etapa salva no banco. A tela usa isto como ponto de partida do item; sem ele, tudo
      // voltava para "Validação" a cada carregamento porque a etapa só existia em memória.
      etapa: row.metadata?.esteira?.etapa ?? null,
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
