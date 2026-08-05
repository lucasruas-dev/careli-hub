import { NextResponse } from "next/server";

import { authorizeApoloRead } from "@/lib/apolo/auth";
import { maisRecentePorEntidade } from "@/lib/apolo/esteira-cad";
import { imobiliariaEntityIdEmLote } from "@/lib/apolo/imobiliaria-do-cliente";
import { normalizarNome } from "@/lib/apolo/imobiliaria-match";
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
  atualizado_em: string | null;
  chegou_em: string | null;
  corretor: string | null;
  created_at: string | null;
  empreendimento: string | null;
  enterprise_id: string | null;
  entity_id: string;
  etapa: string | null;
  imobiliaria: string | null;
  // PIX da pré-venda confirmado (carimbo nosso, com hora). Null = ainda não pagou.
  pago_em: string | null;
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
  //
  // ⚠️ DESDE A 0080 CADA LINHA É UMA **CAD**, NÃO UMA PESSOA: a chave é
  // `(entity_id, enterprise_id)`, então a mesma pessoa aparece uma vez por empreendimento. O
  // `limit(2000)` passou a contar CADs.
  //
  // O CARD DO BOARD, POR ENQUANTO, CONTINUA SENDO POR PESSOA (o `id` do card é o entityId e a
  // tela inteira depende disso: seleção, painel de validação, rotas `/board/[id]/*`). Transformar
  // o card em CAD é uma decisão de produto à parte, e grande. O que MUDOU aqui é que o colapso
  // deixou de ser "a última linha que o banco devolveu" e passou a ser a CAD MAIS RECENTE, com
  // ordem explícita — e o card agora carrega o `enterpriseId` dela, para as ações saberem em qual
  // CAD estão mexendo.
  const { data: esteiraRows } = await adminClient
    .from("apolo_esteira")
    .select(
      "entity_id, enterprise_id, etapa, analista_id, chegou_em, corretor, empreendimento, imobiliaria, pago_em, atualizado_em, created_at",
    )
    .order("atualizado_em", { ascending: false })
    .order("created_at", { ascending: false })
    .order("enterprise_id", { ascending: false })
    .limit(2000);

  const esteiraPorEntidade = maisRecentePorEntidade((esteiraRows ?? []) as EsteiraRow[]);
  const idsNaEsteira = [...esteiraPorEntidade.keys()];

  const [daFila, naEsteira] = await Promise.all([
    adminClient
      .from("apolo_entities")
      .select(CAMPOS)
      .eq("status", "review")
      .eq("metadata->>source", "apolo")
      .order("created_at", { ascending: true })
      // Teto alto (era 200): com ordem da mais ANTIGA pra mais nova, um teto baixo cortava as CADs
      // RECENTES da fila de validação — a partir da 201ª a CAD sumia do Board (incidente 22/jul:
      // "Poliana", a 272ª, não aparecia). 2000 = mesmo teto da esteira.
      .limit(2000),
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

  // FALHA DE ENVIO da pré-venda. O card só marca quem deu erro — quem está bem não mostra nada,
  // senão a fila vira um mar de ícones e o problema deixa de saltar aos olhos.
  const { data: falhas } = await adminClient
    .from("apolo_disparos")
    .select("entity_id")
    .in("tipo", ["prevenda_cobranca", "prevenda_recibo"])
    .eq("status", "falhou")
    .limit(2000);
  const comErroEnvio = new Set(
    ((falhas ?? []) as Array<{ entity_id: string | null }>)
      .map((f) => f.entity_id)
      .filter((id): id is string => Boolean(id)),
  );

  // NÃO SUBIU PARA O C2X. Alerta que o Lucas pediu (05/08): a CAD que falhou ao ser criada no
  // legado precisa gritar no Board. Só DOIS status valem alerta, e eles são coisas diferentes:
  //   'erro'            -> a API recusou de verdade; o motivo está na coluna `erro`
  //                        (ex.: "Escolaridade não pode ficar em branco").
  //   'sem_confirmacao' -> a API respondeu sucesso MAS o cadastro não apareceu no banco do C2X.
  //                        É o mais perigoso, porque PARECE sucesso: foi o incidente de 28/jul e
  //                        01/08, com a env de escrita apontando para o ambiente de teste.
  // Quem está resolvido/enviado/duplicado está no C2X e NÃO ganha ícone. Quem está 'pendente' ou
  // sequer tem linha na tabela ainda não foi tentado: marcar como falha seria mentira.
  //
  // ⚠️ Lido por STATUS, não por `.in()` com os ids do board: a fila tem centenas de ids e o `.in()`
  // com essa quantidade estoura o tamanho da URL do PostgREST (400 — foi o que derrubou a Iris).
  // Aqui voltam só as linhas com falha (dezenas), e o índice apolo_c2x_sync_status_idx cobre
  // exatamente esta consulta. Mesmo padrão do bloco de falha de envio acima.
  const { data: falhasC2x } = await adminClient
    .from("apolo_c2x_sync")
    .select("entity_id, status, erro")
    .in("status", ["erro", "sem_confirmacao"])
    .limit(2000);
  const c2xFalhaPorEntidade = new Map<string, { erro: string | null; status: string }>();
  for (const linha of (falhasC2x ?? []) as Array<{
    entity_id: string | null;
    erro: string | null;
    status: string;
  }>) {
    if (linha.entity_id) {
      c2xFalhaPorEntidade.set(linha.entity_id, { erro: linha.erro, status: linha.status });
    }
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

  // PADRONIZAÇÃO do nome da imobiliária (Lucas, 29/07: "temos que padronizar esses nomes"). A
  // imobiliária vive como TEXTO livre na esteira, e a MESMA imobiliária aparece com grafias
  // diferentes ("RR Soluções" x "RR Soluções Imobiliárias LTDA", "Mais Lotes" x "Mais Lotes
  // Negócios Imobiliários LTDA"). Aqui agrupamos as CADs pela ENTIDADE da imobiliária (vínculo em
  // apolo_relationships, com fallback no de-para apolo_imobiliaria_match por texto normalizado) e
  // exibimos, para todas as CADs de uma imobiliária, a MESMA grafia: a MAIS USADA entre elas
  // (empate -> a mais curta). Preserva a grafia original (acentos e siglas como "J&F"), sem forçar
  // caixa. O "apelido curador" curto fica para um passo seguinte (decisão do Lucas: unificar já).
  // Sem entidade resolvida, cai no texto normalizado (junta ao menos as grafias idênticas).
  const grafiaCanonicaPorCliente = new Map<string, string>();
  {
    const linhas = [...esteiraPorEntidade.values()].filter((r) => (r.imobiliaria ?? "").trim());
    const imobPorVinculo = await imobiliariaEntityIdEmLote(
      adminClient,
      linhas.map((r) => r.entity_id),
    );
    const { data: matches } = await adminClient
      .from("apolo_imobiliaria_match")
      .select("nome_normalizado, entity_id")
      .not("entity_id", "is", null);
    const entidadePorTexto = new Map<string, string>();
    for (const m of (matches ?? []) as Array<{ entity_id: string; nome_normalizado: string }>) {
      entidadePorTexto.set(m.nome_normalizado, m.entity_id);
    }

    // Chave do grupo: a entidade da imobiliária, ou (na falta) o texto normalizado.
    const chaveDe = (r: EsteiraRow): string => {
      const texto = (r.imobiliaria ?? "").trim();
      const ent = imobPorVinculo.get(r.entity_id) ?? entidadePorTexto.get(normalizarNome(texto));
      return ent ? `ent:${ent}` : `txt:${normalizarNome(texto)}`;
    };

    // Conta a frequência de cada grafia dentro do grupo.
    const contagem = new Map<string, Map<string, number>>();
    for (const r of linhas) {
      const texto = (r.imobiliaria ?? "").trim();
      const porGrafia = contagem.get(chaveDe(r)) ?? new Map<string, number>();
      porGrafia.set(texto, (porGrafia.get(texto) ?? 0) + 1);
      contagem.set(chaveDe(r), porGrafia);
    }

    // Grafia canônica do grupo: mais frequente; empate -> mais curta -> alfabética.
    const canonicaPorChave = new Map<string, string>();
    for (const [chave, porGrafia] of contagem) {
      let melhor = "";
      let melhorN = -1;
      for (const [grafia, n] of porGrafia) {
        const vence =
          n > melhorN ||
          (n === melhorN &&
            (grafia.length < melhor.length ||
              (grafia.length === melhor.length && grafia.localeCompare(melhor) < 0)));
        if (vence) {
          melhor = grafia;
          melhorN = n;
        }
      }
      canonicaPorChave.set(chave, melhor);
    }

    for (const r of linhas) {
      const canonica = canonicaPorChave.get(chaveDe(r));
      if (canonica) grafiaCanonicaPorCliente.set(r.entity_id, canonica);
    }
  }

  const itens = data.map((row) => {
    const cadastro = row.metadata?.cadastro;
    const esteira = esteiraPorEntidade.get(row.id);

    // O empreendimento vem do cadastro (quem nasceu no wizard) OU da esteira (quem foi
    // importado do Asana, que é cadastro antigo e não tem metadata.cadastro).
    const falhaC2x = c2xFalhaPorEntidade.get(row.id) ?? null;

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
      // Motivo da recusa do C2X, para o tooltip do ícone. Null quando não falhou.
      c2xErro: falhaC2x?.erro ?? null,
      // 'erro' | 'sem_confirmacao' quando a CAD não conseguiu subir; null = está no C2X ou ainda
      // não foi tentada (nos dois casos o card não mostra alerta).
      c2xFalha: falhaC2x?.status ?? null,
      corretor: esteira?.corretor ?? null,
      corretores: conta(cadastro?.corretores),
      // Quando a CAD chegou. Para o que veio do Asana é a data da própria CAD; o created_at
      // da entidade seria a data do SYNC do C2X (100 das 122 no mesmo segundo), que não diz
      // nada sobre a chegada e ainda ordenaria a fila errado.
      criadoEm: esteira?.chegou_em ?? row.created_at,
      documento: row.document_masked ?? "",
      empreendimentos,
      // De QUAL CAD é este card (metade da chave da esteira). A tela devolve isto nas ações, para
      // a etapa não ser gravada na CAD que a pessoa tem em outro loteamento.
      enterpriseId: esteira?.enterprise_id ?? null,
      imobiliaria: grafiaCanonicaPorCliente.get(row.id) ?? esteira?.imobiliaria ?? null,
      // A etapa salva no banco. A tela usa isto como ponto de partida do item; sem ele, tudo
      // voltava para "Validação" a cada carregamento porque a etapa só existia em memória.
      // Da TABELA, não do metadata: para as CADs vindas do C2X o metadata é apagado pelo
      // sync, e era exatamente por ler daqui que a coluna "Análise de crédito" aparecia
      // zerada mesmo com 122 registros corretos no banco.
      etapa: esteira?.etapa ?? null,
      // Só é true quando algum envio da pré-venda falhou — o card marca em vermelho.
      erroEnvio: comErroEnvio.has(row.id),
      id: row.id,
      nome: row.legal_name || row.display_name,
      // PIX da pré-venda: alimenta o selo "PAGO" no card e o filtro de pagos.
      pagoEm: esteira?.pago_em ?? null,
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
