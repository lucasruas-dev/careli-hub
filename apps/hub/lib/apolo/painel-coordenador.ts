// PAINEL DO COORDENADOR — a jornada da venda num lugar só: CAD, imobiliárias, assinatura e sinal.
//
// Fonte de CAD = APOLO, e só o Apolo. O Asana saiu de vez (Lucas, 14/08): ele deixou de ser a
// entrada de CAD quando o portal público entrou no ar, e continuar lendo de lá só produzia dois
// números para a mesma pergunta. Quem quiser o histórico do Asana tem as 575 linhas que já foram
// importadas para `apolo_esteira` — elas contam aqui como qualquer outra.
//
// ⚠️ EMPREENDIMENTO É `enterprise_id`, NUNCA O TEXTO. O mesmo loteamento aparece escrito de
// jeitos diferentes ("VALE DO OURO" e "Vale do Ouro" convivem hoje em `apolo_relationships`), e
// agrupar por texto parte o painel em dois empreendimentos com números pela metade. O nome de
// tela vem do C2X, a chave é sempre o id.
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";

import { imobiliariaEntityIdEmLote } from "./imobiliaria-do-cliente";
import { grafiaCanonicaPorCliente } from "./imobiliaria-grafia";
import { createApoloAdminClient } from "./server";

/**
 * Loteamentos que o C2X guarda partido e o comércio enxerga inteiro.
 *
 * O Vale do Ouro é três `enterprises` com o MESMO nome: VLO (35) é o masterplan histórico, VOL
 * (36) e VOC (37) são as carteiras financeiras que nasceram da divisão. A CAD é registrada no 35;
 * o contrato e o boleto vivem no 36/37. Sem esta ponte, a aba CAD mostra 659 e as abas de
 * assinatura e sinal mostram zero — cada uma certa no seu canto e o painel inteiro mentindo.
 *
 * Chave = id que aparece no Apolo; valor = todos os ids do grupo. Ver [[project_vale_do_ouro_divisao]].
 */
const GRUPOS_C2X: Record<number, number[]> = {
  35: [35, 36, 37],
  36: [35, 36, 37],
  37: [35, 36, 37],
};

const TTL_MS = 5 * 60 * 1000;

export type EmpreendimentoDoPainel = {
  /** Ids do C2X que compõem o empreendimento (mais de um quando a carteira é partida). */
  ids: number[];
  /** Quantas CADs o Apolo tem para ele. Zero é possível: pode ter só imobiliária credenciada. */
  cads: number;
  imobiliarias: number;
  nome: string;
  slug: string;
};

export type CadDoPainel = {
  cliente: string;
  criadoEm: null | string;
  etapa: null | string;
  imobiliaria: null | string;
  /**
   * Entidade da imobiliária desta CAD. É por ela que a aba Imobiliárias conta produção: cruzar
   * pelo NOME erra feio, porque a esteira guarda o que o corretor digitou ("J&F") e a ficha
   * credenciada tem a razão social ("J&F NEGOCIOS IMOBILIARIOS LTDA").
   */
  imobiliariaEntityId: null | string;
  pagoEm: null | string;
  /** Quanto entrou de PIX da pré-venda desta CAD (0 quando não pagou ou não temos o evento). */
  valorPago: number;
};

export type ImobiliariaDoPainel = {
  cadastradaEm: null | string;
  /** Quantas CADs desta imobiliária no empreendimento — é o que separa quem trabalha de quem só credenciou. */
  cads: number;
  corretores: number;
  documento: null | string;
  nome: string;
  socios: number;
  /** 'ativa' | 'validacao' — `review` no banco é a fila do operador. */
  status: string;
};

type Cache<T> = Map<string, { dados: T; em: number }>;

function doCache<T>(cache: Cache<T>, chave: string): null | T {
  const guardado = cache.get(chave);
  if (guardado && Date.now() - guardado.em < TTL_MS) return guardado.dados;
  return null;
}

export function slugDoNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Todos os ids do grupo do empreendimento (ele mesmo, quando não faz parte de nenhum). */
export function idsDoGrupo(id: number): number[] {
  return GRUPOS_C2X[id] ?? [id];
}

const limpo = (v: unknown) => String(v ?? "").trim();

// --- nomes dos empreendimentos (C2X, read-only) ------------------------------------------------

type NomeRow = RowDataPacket & { code: null | string; id: number; name: null | string };

const cacheNomes: Cache<Map<number, { code: string; name: string }>> = new Map();

/**
 * id -> nome/código do C2X. Consulta enxuta de propósito: `loadApoloEnterprises` faz o cenário
 * comercial inteiro (conta e soma todas as unidades) e aqui só queremos o rótulo.
 */
export async function carregarNomes(): Promise<Map<number, { code: string; name: string }>> {
  const guardado = doCache(cacheNomes, "todos");
  if (guardado) return guardado;

  const pool = getHadesDbPool();
  if (!pool.ok) return new Map();

  try {
    const [rows] = await pool.pool.query<NomeRow[]>(
      "select id, code, name from enterprises order by id",
    );
    const mapa = new Map<number, { code: string; name: string }>();
    for (const row of rows) {
      mapa.set(Number(row.id), {
        code: limpo(row.code),
        name: limpo(row.name) || limpo(row.code) || `Empreendimento ${row.id}`,
      });
    }
    cacheNomes.set("todos", { dados: mapa, em: Date.now() });
    return mapa;
  } catch (error) {
    console.error("[painel-coordenador] falha ao ler nomes no C2X", error);
    return new Map();
  }
}

// --- quem é imobiliária -------------------------------------------------------------------------

const cacheImobIds: Cache<Set<string>> = new Map();

/**
 * Entidades que TÊM o papel de imobiliária.
 *
 * Existe porque o vínculo com o empreendimento (`apolo_relationships` tipo `empreendimento`) é
 * usado por três papéis diferentes — imobiliária credenciada, corretor e prospect da CAD — e só
 * o primeiro é imobiliária. O papel mora em `apolo_entity_profiles`, que é a fonte de verdade
 * sobre O QUE cada entidade é. Ver [[project_apolo_crm_grafo]] (entidade única + papéis).
 */
async function carregarIdsDeImobiliarias(): Promise<Set<string>> {
  const guardado = doCache(cacheImobIds, "todas");
  if (guardado) return guardado;

  const client = createApoloAdminClient();
  if (!client) return new Set();

  const { data } = await client
    .from("apolo_entity_profiles")
    .select("entity_id")
    .eq("profile", "imobiliaria");

  const ids = new Set(
    ((data ?? []) as Array<{ entity_id: string }>).map((linha) => linha.entity_id),
  );
  cacheImobIds.set("todas", { dados: ids, em: Date.now() });
  return ids;
}

// --- a lista de empreendimentos do painel -------------------------------------------------------

const cacheLista: Cache<EmpreendimentoDoPainel[]> = new Map();

/**
 * Os empreendimentos que aparecem no seletor: **tem CAD no Apolo OU tem imobiliária credenciada**.
 *
 * A regra do Lucas é "onde está acontecendo venda". Credenciamento entra junto porque ele vem
 * ANTES da primeira CAD: um loteamento que acabou de abrir já tem imobiliária se preparando e
 * ainda não tem cadastro nenhum — e é justamente aí que o coordenador quer olhar.
 */
export async function listarEmpreendimentos(): Promise<EmpreendimentoDoPainel[]> {
  const guardado = doCache(cacheLista, "todos");
  if (guardado) return guardado;

  const client = createApoloAdminClient();
  if (!client) return [];

  const [{ data: esteira }, { data: vinculos }, ehImobiliaria, nomes] = await Promise.all([
    client.from("apolo_esteira").select("enterprise_id, empreendimento"),
    client
      .from("apolo_relationships")
      .select("entity_id, label, metadata")
      .eq("relationship_type", "empreendimento"),
    carregarIdsDeImobiliarias(),
    carregarNomes(),
  ]);

  // Contagem por id do C2X; o agrupamento (Vale do Ouro = 35+36+37) vem depois, para o mesmo
  // loteamento não aparecer três vezes no seletor.
  const cadsPorId = new Map<number, number>();
  const rotuloPorId = new Map<number, string>();

  for (const linha of (esteira ?? []) as Array<{
    empreendimento: null | string;
    enterprise_id: null | string;
  }>) {
    const id = Number(linha.enterprise_id);
    if (!Number.isFinite(id) || id <= 0) continue;
    cadsPorId.set(id, (cadsPorId.get(id) ?? 0) + 1);
    if (!rotuloPorId.has(id) && limpo(linha.empreendimento)) {
      rotuloPorId.set(id, limpo(linha.empreendimento));
    }
  }

  // Imobiliárias: a mesma pode estar credenciada em vários empreendimentos, então contamos
  // entidades DISTINTAS por id — somar linhas contaria a mesma imobiliária duas vezes no grupo.
  //
  // ⚠️ O vínculo `empreendimento` NÃO É SÓ DE IMOBILIÁRIA. A ficha do prospect e a do corretor
  // recebem o mesmo tipo de relação (é assim que a CAD do portal guarda em qual loteamento a
  // pessoa entrou). Sem o filtro por PAPEL, o painel dizia "76 imobiliárias credenciadas" no Vale
  // do Ouro e listava gente física com CPF na tabela; as imobiliárias de verdade são 30.
  const imobsPorId = new Map<number, Set<string>>();
  for (const vinculo of (vinculos ?? []) as Array<{
    entity_id: string;
    label: null | string;
    metadata: null | { enterpriseId?: number | string };
  }>) {
    const id = Number(vinculo.metadata?.enterpriseId);
    if (!Number.isFinite(id) || id <= 0) continue;
    if (!ehImobiliaria.has(vinculo.entity_id)) {
      // Ainda serve para descobrir o empreendimento (o rótulo abaixo), mas não conta como
      // imobiliária: um loteamento que só tem CAD precisa aparecer no seletor do mesmo jeito.
      if (!rotuloPorId.has(id) && limpo(vinculo.label)) {
        rotuloPorId.set(id, limpo(vinculo.label));
      }
      continue;
    }
    const jaTem = imobsPorId.get(id) ?? new Set<string>();
    jaTem.add(vinculo.entity_id);
    imobsPorId.set(id, jaTem);
    if (!rotuloPorId.has(id) && limpo(vinculo.label)) {
      rotuloPorId.set(id, limpo(vinculo.label));
    }
  }

  // Agrupa: cada id cai no seu grupo, e o grupo é identificado pelo MENOR id (estável).
  const porGrupo = new Map<number, EmpreendimentoDoPainel>();
  const todosOsIds = new Set([...cadsPorId.keys(), ...imobsPorId.keys()]);

  for (const id of todosOsIds) {
    const grupo = idsDoGrupo(id);
    const chave = Math.min(...grupo);
    // Nome do C2X; o texto gravado no Apolo é só o plano B (empreendimento novo que ainda não
    // existe no legado, como Jardim das Gerais até ganhar unidades).
    const nome =
      nomes.get(chave)?.name ?? rotuloPorId.get(id) ?? `Empreendimento ${chave}`;

    const atual = porGrupo.get(chave) ?? {
      cads: 0,
      ids: grupo,
      imobiliarias: 0,
      nome,
      slug: slugDoNome(nome),
    };
    porGrupo.set(chave, atual);
  }

  // Segunda passada para somar: um grupo recebe as CADs e as imobiliárias de TODOS os seus ids.
  for (const empreendimento of porGrupo.values()) {
    const imobs = new Set<string>();
    for (const id of empreendimento.ids) {
      empreendimento.cads += cadsPorId.get(id) ?? 0;
      for (const entityId of imobsPorId.get(id) ?? []) imobs.add(entityId);
    }
    empreendimento.imobiliarias = imobs.size;
  }

  const lista = [...porGrupo.values()].sort(
    (a, b) => b.cads - a.cads || b.imobiliarias - a.imobiliarias || a.nome.localeCompare(b.nome),
  );

  cacheLista.set("todos", { dados: lista, em: Date.now() });
  return lista;
}

export async function acharEmpreendimento(
  slug: string,
): Promise<EmpreendimentoDoPainel | null> {
  const lista = await listarEmpreendimentos();
  const alvo = slugDoNome(slug);
  return lista.find((item) => item.slug === alvo) ?? lista[0] ?? null;
}

// --- aba CAD -----------------------------------------------------------------------------------

const cacheCads: Cache<CadDoPainel[]> = new Map();

/**
 * As CADs do empreendimento, direto da esteira do Apolo — TODAS, qualquer que seja a origem
 * (portal público, cadastro manual ou o lote importado do Asana). Decisão do Lucas 14/08: o que
 * está no Apolo conta, ponto; separar por origem só esconderia metade do funil.
 */
export async function carregarCads(ids: number[]): Promise<CadDoPainel[]> {
  const chave = ids.join(",");
  const guardado = doCache(cacheCads, chave);
  if (guardado) return guardado;

  const client = createApoloAdminClient();
  if (!client) return [];

  const { data, error } = await client
    .from("apolo_esteira")
    .select("entity_id, etapa, imobiliaria, chegou_em, pago_em, pagamento_ref")
    .in("enterprise_id", ids.map(String));

  if (error || !data) {
    if (error) console.error("[painel-coordenador] esteira", error.message);
    return [];
  }

  const linhas = data as Array<{
    chegou_em: null | string;
    entity_id: string;
    etapa: null | string;
    imobiliaria: null | string;
    pagamento_ref: null | string;
    pago_em: null | string;
  }>;

  // Nome do cliente: a esteira guarda só o entity_id. Em lotes de 300 — `.in()` com a lista
  // inteira estoura o tamanho da URL do PostgREST. Ver [[reference_postgrest_in_url_limite]].
  const entityIds = [...new Set(linhas.map((l) => l.entity_id))];
  const nomePorId = new Map<string, string>();
  for (let i = 0; i < entityIds.length; i += 300) {
    const { data: entidades } = await client
      .from("apolo_entities")
      .select("id, display_name, legal_name")
      .in("id", entityIds.slice(i, i + 300));
    for (const entidade of (entidades ?? []) as Array<{
      display_name: null | string;
      id: string;
      legal_name: null | string;
    }>) {
      nomePorId.set(
        entidade.id,
        limpo(entidade.legal_name) || limpo(entidade.display_name) || "Sem nome",
      );
    }
  }

  // Valor do PIX da pré-venda: vem do evento do Asaas que confirmou a cobrança (a esteira guarda
  // só a referência). Um pagamento gera CONFIRMED e RECEIVED: só o primeiro por cobrança soma.
  const refs = linhas.map((l) => l.pagamento_ref).filter((r): r is string => Boolean(r));
  const valorPorRef = new Map<string, number>();
  for (let i = 0; i < refs.length; i += 300) {
    const { data: eventos } = await client
      .from("apolo_asaas_eventos")
      .select("asaas_payment_id, value, evento")
      .in("asaas_payment_id", refs.slice(i, i + 300))
      .in("evento", ["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED"]);
    for (const evento of (eventos ?? []) as Array<{
      asaas_payment_id: null | string;
      value: null | number | string;
    }>) {
      const id = evento.asaas_payment_id ?? "";
      if (!id || valorPorRef.has(id)) continue;
      const valor = Number(evento.value ?? 0);
      if (Number.isFinite(valor)) valorPorRef.set(id, valor);
    }
  }

  // Uma imobiliária, um nome. Sem isto o filtro lista "J&F" e "J&F NEGOCIOS IMOBILIARIOS LTDA"
  // como se fossem duas, e o ranking divide em duas barras médias quem na verdade é a primeira
  // colocada. Mesma regra do Board (lib/apolo/imobiliaria-grafia.ts).
  const [grafia, imobPorCliente] = await Promise.all([
    grafiaCanonicaPorCliente(client, linhas),
    imobiliariaEntityIdEmLote(client, entityIds),
  ]);

  const cads: CadDoPainel[] = linhas.map((linha) => ({
    cliente: nomePorId.get(linha.entity_id) ?? "Sem nome",
    criadoEm: linha.chegou_em,
    etapa: linha.etapa,
    imobiliaria: grafia.get(linha.entity_id) ?? (limpo(linha.imobiliaria) || null),
    imobiliariaEntityId: imobPorCliente.get(linha.entity_id) ?? null,
    pagoEm: linha.pago_em,
    valorPago: linha.pagamento_ref ? (valorPorRef.get(linha.pagamento_ref) ?? 0) : 0,
  }));

  cads.sort((a, b) => (b.criadoEm ?? "").localeCompare(a.criadoEm ?? ""));
  cacheCads.set(chave, { dados: cads, em: Date.now() });
  return cads;
}

// --- aba IMOBILIÁRIAS ---------------------------------------------------------------------------

const cacheImobs: Cache<ImobiliariaDoPainel[]> = new Map();

/**
 * Quem está trabalhando o empreendimento. O vínculo é o do CREDENCIAMENTO (relationship
 * `empreendimento`, gravado no Apolo), não vendas do C2X: o legado nunca teve essa ligação — lá
 * ela só existe DERIVADA das vendas, o que deixa de fora justamente a imobiliária que acabou de
 * ser credenciada e ainda não vendeu. Ver [[project_apolo_cadastro_imobiliaria]].
 */
export async function carregarImobiliarias(
  ids: number[],
): Promise<ImobiliariaDoPainel[]> {
  const chave = ids.join(",");
  const guardado = doCache(cacheImobs, chave);
  if (guardado) return guardado;

  const client = createApoloAdminClient();
  if (!client) return [];

  const [{ data: vinculos }, ehImobiliaria] = await Promise.all([
    client
      .from("apolo_relationships")
      .select("entity_id, metadata")
      .eq("relationship_type", "empreendimento"),
    carregarIdsDeImobiliarias(),
  ]);

  // Só quem tem o PAPEL de imobiliária. O mesmo tipo de vínculo é usado pela ficha do prospect e
  // pela do corretor — sem este filtro, a aba lista pessoa física com CPF como "credenciada".
  const doGrupo = new Set(ids.map(String));
  const entityIds = [
    ...new Set(
      ((vinculos ?? []) as Array<{
        entity_id: string;
        metadata: null | { enterpriseId?: number | string };
      }>)
        .filter(
          (v) =>
            doGrupo.has(String(v.metadata?.enterpriseId ?? "")) && ehImobiliaria.has(v.entity_id),
        )
        .map((v) => v.entity_id),
    ),
  ];

  if (entityIds.length === 0) {
    cacheImobs.set(chave, { dados: [], em: Date.now() });
    return [];
  }

  const entidades = new Map<
    string,
    { criadoEm: null | string; documento: null | string; nome: string }
  >();
  const statusPorId = new Map<string, string>();
  const corretoresPorId = new Map<string, number>();
  const sociosPorId = new Map<string, number>();

  for (let i = 0; i < entityIds.length; i += 300) {
    const fatia = entityIds.slice(i, i + 300);

    const [{ data: linhas }, { data: perfis }, { data: relacoes }] = await Promise.all([
      client
        .from("apolo_entities")
        .select("id, display_name, legal_name, document_masked, created_at")
        .in("id", fatia),
      client
        .from("apolo_entity_profiles")
        .select("entity_id, status")
        .eq("profile", "imobiliaria")
        .in("entity_id", fatia),
      client
        .from("apolo_relationships")
        .select("entity_id, relationship_type")
        .in("relationship_type", ["corretor", "socio"])
        .in("entity_id", fatia),
    ]);

    for (const linha of (linhas ?? []) as Array<{
      created_at: null | string;
      display_name: null | string;
      document_masked: null | string;
      id: string;
      legal_name: null | string;
    }>) {
      entidades.set(linha.id, {
        criadoEm: linha.created_at,
        documento: limpo(linha.document_masked) || null,
        nome: limpo(linha.legal_name) || limpo(linha.display_name) || "Sem nome",
      });
    }
    for (const perfil of (perfis ?? []) as Array<{ entity_id: string; status: null | string }>) {
      statusPorId.set(perfil.entity_id, perfil.status === "review" ? "validacao" : "ativa");
    }
    for (const relacao of (relacoes ?? []) as Array<{
      entity_id: string;
      relationship_type: string;
    }>) {
      const alvo = relacao.relationship_type === "corretor" ? corretoresPorId : sociosPorId;
      alvo.set(relacao.entity_id, (alvo.get(relacao.entity_id) ?? 0) + 1);
    }
  }

  // CADs por imobiliária no empreendimento. Conta pela ENTIDADE (o vínculo cliente→imobiliária),
  // com o nome normalizado como plano B para as CADs antigas que só têm o texto: cruzar apenas
  // por nome fazia a AVANCA aparecer com 5 CADs e a J&F, que tem dezenas, com zero — a esteira
  // guarda o apelido que o corretor digitou e a ficha credenciada tem a razão social.
  const cads = await carregarCads(ids);
  const cadsPorEntidade = new Map<string, number>();
  const cadsPorNome = new Map<string, number>();
  for (const cad of cads) {
    if (cad.imobiliariaEntityId) {
      cadsPorEntidade.set(
        cad.imobiliariaEntityId,
        (cadsPorEntidade.get(cad.imobiliariaEntityId) ?? 0) + 1,
      );
      continue;
    }
    const nome = slugDoNome(cad.imobiliaria ?? "");
    if (!nome) continue;
    cadsPorNome.set(nome, (cadsPorNome.get(nome) ?? 0) + 1);
  }

  const lista: ImobiliariaDoPainel[] = entityIds.map((id) => {
    const entidade = entidades.get(id);
    const nome = entidade?.nome ?? "Sem nome";
    return {
      cadastradaEm: entidade?.criadoEm ?? null,
      cads: (cadsPorEntidade.get(id) ?? 0) + (cadsPorNome.get(slugDoNome(nome)) ?? 0),
      corretores: corretoresPorId.get(id) ?? 0,
      documento: entidade?.documento ?? null,
      nome,
      socios: sociosPorId.get(id) ?? 0,
      status: statusPorId.get(id) ?? "ativa",
    };
  });

  lista.sort(
    (a, b) => b.cads - a.cads || (b.cadastradaEm ?? "").localeCompare(a.cadastradaEm ?? ""),
  );

  cacheImobs.set(chave, { dados: lista, em: Date.now() });
  return lista;
}
