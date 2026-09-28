import type { SupabaseClient } from "@supabase/supabase-js";

import {
  type ContratoDoPanteon,
  type LinhaDaViewDeContratos,
  type LinhaDaViewDeEnvelopes,
  montarContratosDoPanteon,
  type PropostaForaDaLeitura,
  type UnidadeDaLeitura,
} from "./contratos-do-panteon-montagem";

// A LEITURA ÚNICA DO CONTRATO — o que as telas de assinatura leem, e SÓ do Panteon (F4 da fonte
// única, docs/assinatura/fonte-unica-do-contrato.md).
//
// Lucas, 28/09/2026: *"a tela é do hercules"* e *"pode seguir, faz tudo morar no Panteon"*. Sai o
// C2X (nem a exceção por lista: resposta 1 do Lucas, "aparecem pelo envelope, sem ler o C2X"), sai a
// D4Sign ao vivo e sai o aquecimento em segundo plano. Quem mantém a D4Sign em dia é o espelho (F3),
// e a campainha dele (`ultima_rodada_ok_em`) vai junto para a tela dizer quando pode estar atrasada.
//
// ⚠️ SÓ AS DUAS VIEWS DA 0195 E TABELAS ESTREITAS. `temis_contratos_do_panteon` já tira a proposta da
// carga pendurada na sombra do pai (a regra da régua) e não traz CPF nem contato;
// `temis_envelopes_de_contrato` só traz `finalidade = 'contrato'`. O jsonb dos envelopes (que tem
// e-mail) só é lido para os envelopes que viram linha, e o e-mail morre na montagem.
//
// ⚠️ FALHA DE LEITURA É `ok: false` (a rota responde 503), NUNCA LISTA VAZIA: lista vazia diria "nenhum
// contrato" para quem tem contratos. As leituras acessórias (quando o contrato foi gerado, a campainha
// do espelho, o código do empreendimento da linha sem venda) degradam: a linha perde o detalhe, não
// some.
//
// ⚠️ TODA LISTA PAGINA COM ORDEM, E `.in()` VAI EM LOTES DE 100 (o PostgREST corta em 1.000 linhas sem
// erro, e sem ORDER a paginação perde linha com o total batendo; a URL do `.in()` estoura com 700 ids).

/** O recorte. Esta função NÃO autoriza nada: quem chama já passou pelo escopo da sessão. */
export type EscopoDosContratos =
  | { enterpriseIds: readonly string[] }
  | { propostaIds: readonly string[] }
  | { unidadeIds: readonly string[] };

export type LeituraDosContratos =
  | { contratos: ContratoDoPanteon[]; lidoEm: string; ok: true; ultimaRodadaOkEm: null | string }
  | { erro: string; ok: false };

const LOTE = 100;
const PAGINA = 1000;

const COLUNAS_DOS_CONTRATOS =
  "proposta_id,origem,ar_c2x_id,etapa,etapa_desde,criado_em,cliente_nome,imobiliaria_nome,valor,preco_tabela,data_assinatura,data_ato,data_faturamento,cancelamento_pedido_em,unidade_id,espelho_de,unidade_codigo,quadra,lote,enterprise_id,unidade_c2x_id,unidade_preco_tabela,empreendimento_codigo,gerado_em";

const COLUNAS_DOS_ENVELOPES =
  "id,provedor,origem,envelope_id,provedor_documento_id,c2x_contract_signature_id,proposta_id,unidade_id,estado,estado_cru,falha,signatarios,ordenada,enviado_em,fechado_em,conferido_em,criado_em";

const COLUNAS_DA_UNIDADE = "id,codigo,quadra,lote,enterprise_id,espelho_de,origem_c2x_id,preco_tabela";

type ErroDoBanco = { code?: string; message?: string } | null;
type Pagina = PromiseLike<{ data: unknown; error: ErroDoBanco }>;

/** O erro do Supabase, só com código e mensagem (o objeto inteiro pode trazer a linha: "Failing row contains"). */
class FalhaDeLeitura extends Error {
  constructor(rotulo: string, erro: ErroDoBanco) {
    super(`${rotulo}: ${erro?.code ?? "sem código"} ${erro?.message ?? ""}`.trim());
  }
}

async function paginado<L>(rotulo: string, pagina: (de: number) => Pagina): Promise<L[]> {
  const linhas: L[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await pagina(de);
    if (error) throw new FalhaDeLeitura(rotulo, error);
    const lote = (Array.isArray(data) ? data : []) as L[];
    linhas.push(...lote);
    if (lote.length < PAGINA) break;
  }
  return linhas;
}

async function emLotes<L>(
  rotulo: string,
  valores: readonly string[],
  pagina: (lote: string[], de: number) => Pagina,
): Promise<L[]> {
  const unicos = [...new Set(valores.map((v) => String(v).trim()).filter(Boolean))];
  const linhas: L[] = [];
  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE);
    linhas.push(...(await paginado<L>(rotulo, (de) => pagina(lote, de))));
  }
  return linhas;
}

function faixa(de: number): [number, number] {
  return [de, de + PAGINA - 1];
}

/**
 * Lê os contratos do recorte, os envelopes deles e os envelopes que só a unidade sustenta, e monta.
 *
 * @param entrada.agora Para o teste; a campainha do espelho compara com ele.
 */
export async function lerContratosDoPanteon(entrada: {
  admin: SupabaseClient;
  agora?: Date;
  escopo: EscopoDosContratos;
  workspaceId?: string;
}): Promise<LeituraDosContratos> {
  const { admin, escopo } = entrada;
  const workspace = entrada.workspaceId ?? "careli";
  const agora = entrada.agora ?? new Date();

  const [colunaDoEscopo, valoresDoEscopo] =
    "enterpriseIds" in escopo
      ? (["enterprise_id", escopo.enterpriseIds] as const)
      : "propostaIds" in escopo
        ? (["proposta_id", escopo.propostaIds] as const)
        : (["unidade_id", escopo.unidadeIds] as const);

  // ⚠️ RECORTE VAZIO RESPONDE NA HORA, SEM LER NADA (revisão da F4). Com todos os códigos sem id (o
  // cadastro no ar, mas nenhum código traduzido), a leitura do passo 3 percorria o acervo inteiro de
  // envelopes para devolver uma lista vazia.
  if (valoresDoEscopo.map((v) => String(v).trim()).filter(Boolean).length === 0) {
    return { contratos: [], lidoEm: agora.toISOString(), ok: true, ultimaRodadaOkEm: null };
  }

  try {
    // 1. AS VENDAS VIVAS COM CONTRATO, pela view.
    const contratos = await emLotes<LinhaDaViewDeContratos>("temis_contratos_do_panteon", valoresDoEscopo, (lote, de) =>
      admin
        .from("temis_contratos_do_panteon")
        .select(COLUNAS_DOS_CONTRATOS)
        .eq("workspace_id", workspace)
        .in(colunaDoEscopo, lote)
        .order("proposta_id", { ascending: true })
        .range(...faixa(de)),
    );
    const idsDasVendas = new Set(contratos.map((c) => c.proposta_id));

    // 2. OS ENVELOPES DE CONTRATO DAS VENDAS.
    const envelopes = await emLotes<LinhaDaViewDeEnvelopes>("temis_envelopes_de_contrato:das_vendas", [...idsDasVendas], (lote, de) =>
      admin
        .from("temis_envelopes_de_contrato")
        .select(COLUNAS_DOS_ENVELOPES)
        .eq("workspace_id", workspace)
        .in("proposta_id", lote)
        .order("id", { ascending: true })
        .range(...faixa(de)),
    );

    // 3. OS ENVELOPES QUE NÃO CAEM NUMA VENDA VIVA DO RECORTE: sem proposta (resposta 1), de venda
    //    desfeita (resposta 2) ou de proposta viva que a view não traz. Primeiro ESTREITO (sem o jsonb),
    //    depois a unidade decide se é do recorte, e só então o envelope inteiro.
    //
    // ⚠️ O RECORTE ANTES DO LEQUE (revisão da F4). No recorte por empreendimento a lista estreita vem do
    // acervo inteiro (a view não tem o empreendimento); se as propostas, as unidades e a família fossem
    // lidas para TODOS os soltos, cada abertura da aba pagaria o acervo de todos os empreendimentos
    // (~3,8 mil envelopes de fora num recorte do VOC depois da carga da F3: ~120 idas sequenciais ao
    // PostgREST numa rota de 30 s). Então os ids das unidades do recorte vêm primeiro (só a coluna
    // `id`), e o solto com unidade FORA dele sai em memória. Fica só o solto do recorte e o que não
    // tem unidade (o envelope da Têmis, que é da proposta).
    const todosOsSoltos = await lerEnvelopesSoltos(admin, workspace, escopo, idsDasVendas);
    const unidadesDoRecorte =
      "enterpriseIds" in escopo && todosOsSoltos.some((s) => String(s.unidade_id ?? "").trim())
        ? await lerIdsDasUnidades(admin, workspace, escopo.enterpriseIds)
        : null;
    const soltos = unidadesDoRecorte
      ? todosOsSoltos.filter((s) => {
          const unidade = String(s.unidade_id ?? "").trim();
          return !unidade || unidadesDoRecorte.has(unidade);
        })
      : todosOsSoltos;
    const propostasFora = await emLotes<PropostaForaDaLeitura>(
      "hercules_propostas:fora_da_leitura",
      soltos.map((s) => String(s.proposta_id ?? "")).filter(Boolean),
      (lote, de) =>
        admin
          .from("hercules_propostas")
          .select("id,etapa,cancelada_em,aberta,origem,unidade_id")
          .eq("workspace_id", workspace)
          .in("id", lote)
          .order("id", { ascending: true })
          .range(...faixa(de)),
    );
    const foraPorId = new Map(propostasFora.map((p) => [p.id, p]));
    const unidadeDoSolto = (s: EnvelopeEstreito) =>
      String(s.unidade_id ?? "").trim() || String(foraPorId.get(String(s.proposta_id ?? ""))?.unidade_id ?? "").trim();

    // A unidade do envelope e a da proposta (é ela que diz se a proposta da carga está na sombra do pai).
    const unidadesDosSoltos = await emLotes<UnidadeDaLeitura>(
      "hercules_unidades:dos_envelopes",
      [...soltos.map(unidadeDoSolto), ...propostasFora.map((p) => String(p.unidade_id ?? ""))].filter(Boolean),
      (lote, de) =>
        admin
          .from("hercules_unidades")
          .select(COLUNAS_DA_UNIDADE)
          .eq("workspace_id", workspace)
          .in("id", lote)
          .order("id", { ascending: true })
          .range(...faixa(de)),
    );
    const unidadePorId = new Map(unidadesDosSoltos.map((u) => [u.id, u]));
    const doRecorte = (unidade: UnidadeDaLeitura | undefined): boolean => {
      if (!unidade) return false;
      if ("enterpriseIds" in escopo) return escopo.enterpriseIds.map(String).includes(String(unidade.enterprise_id ?? "").trim());
      if ("unidadeIds" in escopo) return escopo.unidadeIds.includes(unidade.id);
      return true; // propostaIds: `lerEnvelopesSoltos` já trouxe só os das propostas pedidas
    };
    const idsSoltosDoRecorte = soltos.filter((s) => doRecorte(unidadePorId.get(unidadeDoSolto(s)))).map((s) => s.id);
    const envelopesSoltos = await emLotes<LinhaDaViewDeEnvelopes>("temis_envelopes_de_contrato:soltos", idsSoltosDoRecorte, (lote, de) =>
      admin
        .from("temis_envelopes_de_contrato")
        .select(COLUNAS_DOS_ENVELOPES)
        .eq("workspace_id", workspace)
        .in("id", lote)
        .order("id", { ascending: true })
        .range(...faixa(de)),
    );

    // 4. A FAMÍLIA DAS UNIDADES DOS SOLTOS, para o terreno (pai que aponta para elas, e o alvo delas).
    //    Só as unidades dos soltos QUE VIRAM LINHA e as das propostas deles: a família de uma unidade
    //    fora do recorte não muda linha nenhuma deste recorte.
    const unidadesUsadas = [
      ...new Set(
        envelopesSoltos
          .flatMap((e) => [unidadeDoSolto(e), String(foraPorId.get(String(e.proposta_id ?? ""))?.unidade_id ?? "").trim()])
          .filter(Boolean),
      ),
    ]
      .map((id) => unidadePorId.get(id))
      .filter((u): u is UnidadeDaLeitura => Boolean(u));
    const familia = await lerFamilia(admin, workspace, unidadesUsadas);

    // 5. AS LEITURAS QUE DEGRADAM.
    const [empreendimentoPorEnterprise, contratoGeradoEm, ultimaRodadaOkEm] = await Promise.all([
      lerEmpreendimentos(admin, workspace),
      lerContratosGerados(
        admin,
        contratos.filter((c) => String(c.origem ?? "") === "panteon").map((c) => c.proposta_id),
      ),
      lerCampainha(admin),
    ]);

    return {
      contratos: montarContratosDoPanteon(
        {
          contratoGeradoEm,
          contratos,
          empreendimentoPorEnterprise,
          envelopes: [...envelopes, ...envelopesSoltos],
          propostasForaDaLeitura: propostasFora,
          ultimaRodadaOkEm,
          unidades: [...unidadesUsadas, ...familia],
        },
        agora,
      ),
      lidoEm: agora.toISOString(),
      ok: true,
      ultimaRodadaOkEm,
    };
  } catch (erro) {
    // Só a mensagem (código e texto do banco); nunca o objeto inteiro.
    console.error("[assinatura][leitura-unica] falha ao ler os contratos do Panteon", erro instanceof Error ? erro.message : "erro");
    return { erro: "Não foi possível ler as assinaturas agora.", ok: false };
  }
}

type EnvelopeEstreito = { id: string; proposta_id: null | string; unidade_id: null | string };

/**
 * Os envelopes de contrato do recorte que NÃO são de uma venda viva lida, estreitos (sem o jsonb).
 *
 * ⚠️ NO RECORTE POR EMPREENDIMENTO A VIEW NÃO TEM O EMPREENDIMENTO (e o `enterprise_id` do envelope da
 * Têmis ainda guarda a sigla, PAN-124): lê-se a coluna estreita de todos e a UNIDADE decide. São
 * poucas páginas (o acervo inteiro de contrato cabe em ~4 mil linhas de três uuids), e é o preço de
 * não perder o envelope sem venda do Garden (resposta 1). Quem chama corta pelas unidades do recorte
 * (`lerIdsDasUnidades`) ANTES de ler qualquer outra coisa desses envelopes.
 */
async function lerEnvelopesSoltos(
  admin: SupabaseClient,
  workspace: string,
  escopo: EscopoDosContratos,
  idsDasVendas: ReadonlySet<string>,
): Promise<EnvelopeEstreito[]> {
  const base = () =>
    admin.from("temis_envelopes_de_contrato").select("id,proposta_id,unidade_id").eq("workspace_id", workspace);
  let linhas: EnvelopeEstreito[];
  if ("propostaIds" in escopo) {
    linhas = await emLotes<EnvelopeEstreito>("temis_envelopes_de_contrato:estreito", escopo.propostaIds, (lote, de) =>
      base().in("proposta_id", lote).order("id", { ascending: true }).range(...faixa(de)),
    );
  } else if ("unidadeIds" in escopo) {
    linhas = await emLotes<EnvelopeEstreito>("temis_envelopes_de_contrato:estreito", escopo.unidadeIds, (lote, de) =>
      base().in("unidade_id", lote).order("id", { ascending: true }).range(...faixa(de)),
    );
  } else {
    linhas = await paginado<EnvelopeEstreito>("temis_envelopes_de_contrato:estreito", (de) =>
      base().order("id", { ascending: true }).range(...faixa(de)),
    );
  }
  return linhas.filter((l) => !l.proposta_id || !idsDasVendas.has(l.proposta_id));
}

/**
 * Os ids das unidades do recorte por empreendimento, SÓ a coluna `id` (paginado com ordem, `.in()` em
 * lotes). É o filtro em memória dos envelopes soltos: sem ele, o leque de leituras seguia o acervo
 * inteiro. Falha aqui é falha da leitura (sem o recorte não se sabe o que é deste empreendimento).
 */
async function lerIdsDasUnidades(
  admin: SupabaseClient,
  workspace: string,
  enterpriseIds: readonly string[],
): Promise<Set<string>> {
  const linhas = await emLotes<{ id: string }>("hercules_unidades:do_recorte", enterpriseIds.map(String), (lote, de) =>
    admin
      .from("hercules_unidades")
      .select("id")
      .eq("workspace_id", workspace)
      .in("enterprise_id", lote)
      .order("id", { ascending: true })
      .range(...faixa(de)),
  );
  return new Set(linhas.map((l) => String(l.id)));
}

/**
 * A família de cada unidade solta, para a união do terreno: as linhas do pai que apontam para ela
 * (`espelho_de`) e a linha para onde ela aponta. As glebas irmãs que a leitura já tem (as unidades das
 * vendas vivas vêm inteiras da view) entram pela mesma união.
 *
 * ⚠️ DEGRADA: sem a família, o terreno fica sendo a própria unidade (a linha sem venda aparece; só não
 * tira do portal a venda "aguardando emissão" do mesmo terreno).
 */
async function lerFamilia(
  admin: SupabaseClient,
  workspace: string,
  unidades: readonly UnidadeDaLeitura[],
): Promise<UnidadeDaLeitura[]> {
  if (unidades.length === 0) return [];
  try {
    const ids = unidades.map((u) => u.id);
    const alvos = unidades.map((u) => String(u.espelho_de ?? "")).filter(Boolean);
    const [apontam, apontadas] = await Promise.all([
      emLotes<UnidadeDaLeitura>("hercules_unidades:do_pai", ids, (lote, de) =>
        admin
          .from("hercules_unidades")
          .select(COLUNAS_DA_UNIDADE)
          .eq("workspace_id", workspace)
          .in("espelho_de", lote)
          .order("id", { ascending: true })
          .range(...faixa(de)),
      ),
      emLotes<UnidadeDaLeitura>("hercules_unidades:alvo", alvos, (lote, de) =>
        admin
          .from("hercules_unidades")
          .select(COLUNAS_DA_UNIDADE)
          .eq("workspace_id", workspace)
          .in("id", lote)
          .order("id", { ascending: true })
          .range(...faixa(de)),
      ),
    ]);
    return [...apontam, ...apontadas];
  } catch (erro) {
    console.error("[assinatura][leitura-unica] família das unidades indisponível", erro instanceof Error ? erro.message : "erro");
    return [];
  }
}

/** `hercules_unidades.enterprise_id` → código do cadastro. Falha = linha sem venda sem código. */
async function lerEmpreendimentos(admin: SupabaseClient, workspace: string): Promise<Map<string, string>> {
  const mapa = new Map<string, string>();
  try {
    const linhas = await paginado<{ c2x_enterprise_id: null | string; codigo: null | string }>(
      "hercules_empreendimentos",
      (de) =>
        admin
          .from("hercules_empreendimentos")
          .select("codigo,c2x_enterprise_id")
          .eq("workspace_id", workspace)
          .order("codigo", { ascending: true })
          .range(...faixa(de)),
    );
    for (const l of linhas) {
      const id = String(l.c2x_enterprise_id ?? "").trim();
      const codigo = String(l.codigo ?? "").trim();
      // A mesma escolha da view (`order by e.codigo limit 1`): o primeiro código em ordem vence.
      if (id && codigo && !mapa.has(id)) mapa.set(id, codigo);
    }
  } catch (erro) {
    console.error("[assinatura][leitura-unica] cadastro de empreendimentos indisponível", erro instanceof Error ? erro.message : "erro");
  }
  return mapa;
}

/**
 * Proposta NATIVA → o contrato mais recente gerado (`hercules_documentos` tipo contrato, não removido).
 * ⚠️ FALHA DEVOLVE `null`, NÃO MAPA VAZIO: mapa vazio diria "nenhum contrato gerado" (e a volta para
 * correção pareceria definitiva); `null` cai na primeira passagem para `contrato`, da view.
 */
async function lerContratosGerados(admin: SupabaseClient, ids: readonly string[]): Promise<Map<string, string> | null> {
  if (ids.length === 0) return new Map();
  try {
    const linhas = await emLotes<{ criado_em: null | string; proposta_id: null | string }>(
      "hercules_documentos",
      ids,
      (lote, de) =>
        admin
          .from("hercules_documentos")
          .select("id,proposta_id,criado_em")
          .eq("tipo", "contrato")
          .is("removido_em", null)
          .in("proposta_id", lote)
          .order("id", { ascending: true })
          .range(...faixa(de)),
    );
    const mapa = new Map<string, string>();
    for (const l of linhas) {
      const proposta = String(l.proposta_id ?? "").trim();
      const quando = String(l.criado_em ?? "").trim();
      if (!proposta || !quando) continue;
      const atual = mapa.get(proposta);
      if (!atual || Date.parse(quando) > Date.parse(atual)) mapa.set(proposta, quando);
    }
    return mapa;
  } catch (erro) {
    console.error("[assinatura][leitura-unica] contratos gerados indisponíveis", erro instanceof Error ? erro.message : "erro");
    return null;
  }
}

/**
 * A campainha do espelho (`temis_espelho_d4sign.ultima_rodada_ok_em`). Falha = nulo, e a tela avisa
 * que pode estar atrasada quando o recorte tem D4Sign: é o lado seguro.
 */
async function lerCampainha(admin: SupabaseClient): Promise<null | string> {
  try {
    const { data, error } = await admin
      .from("temis_espelho_d4sign")
      .select("ultima_rodada_ok_em")
      .eq("id", 1)
      .maybeSingle();
    if (error) throw new FalhaDeLeitura("temis_espelho_d4sign", error);
    const valor = (data as null | { ultima_rodada_ok_em: null | string })?.ultima_rodada_ok_em;
    return valor ? String(valor) : null;
  } catch (erro) {
    console.error("[assinatura][leitura-unica] campainha do espelho indisponível", erro instanceof Error ? erro.message : "erro");
    return null;
  }
}
