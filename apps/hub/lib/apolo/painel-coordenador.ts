// PAINEL DO COORDENADOR — a jornada da venda num lugar só: CAD, imobiliárias, assinatura e sinal.
//
// Fonte de CAD = APOLO, e só o Apolo. O Asana saiu de vez (Lucas, 14/08): ele deixou de ser a
// entrada de CAD quando o portal público entrou no ar, e continuar lendo de lá só produzia dois
// números para a mesma pergunta. Quem quiser o histórico do Asana tem as 575 linhas que já foram
// importadas para `apolo_esteira` — elas contam aqui como qualquer outra.
//
// ⚠️ EMPREENDIMENTO É `enterprise_id`, NUNCA O TEXTO. O mesmo loteamento aparece escrito de
// jeitos diferentes ("VALE DO OURO" e "Vale do Ouro" convivem hoje em `apolo_relationships`), e
// agrupar por texto parte o painel em dois empreendimentos com números pela metade.
//
// ⚠️ E O LINK É PELA CHAVE, NÃO PELO SLUG DO NOME (PAN-124 F6). A lista agrupa pelo cadastro do Panteon
// (os 5 pais com filhos, com o `group:<chave>` junto), e o link antigo abre por apelido; um link que não
// casa mostra o seletor, nunca o primeiro da lista. Ver ./painel-coordenador-lista.ts.
import type { RowDataPacket } from "mysql2";

import { getHadesDbPool } from "@/lib/guardian/db";
import { reguaEmCache } from "@/lib/hercules/cadastro-em-cache";

import { imobiliariaEntityIdEmLote } from "./imobiliaria-do-cliente";
import { grafiaCanonicaPorCliente } from "./imobiliaria-grafia";
import {
  acharNaLista,
  type EmpreendimentoDoPainel,
  montarListaDoPainel,
  slugDoNome,
} from "./painel-coordenador-lista";
import { createApoloAdminClient } from "./server";

export { slugDoNome, type EmpreendimentoDoPainel };

const TTL_MS = 5 * 60 * 1000;

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

  const [{ data: esteira }, { data: vinculos }, ehImobiliaria, nomesDoC2x, regua, nomesAnteriores] =
    await Promise.all([
      client.from("apolo_esteira").select("enterprise_id, empreendimento"),
      client
        .from("apolo_relationships")
        .select("entity_id, label, metadata")
        .eq("relationship_type", "empreendimento"),
      carregarIdsDeImobiliarias(),
      carregarNomes(),
      // Sem o cadastro, o painel ainda abre, cada id no seu lugar: nada agrupa, e o aviso fica no log.
      reguaEmCache().catch((erro) => {
        console.error("[painel-coordenador] cadastro do Panteon indisponível", erro);
        return null;
      }),
      carregarNomesAnteriores(client),
    ]);

  const lista = montarListaDoPainel({
    ehImobiliaria,
    esteira: (esteira ?? []) as Array<{ empreendimento: null | string; enterprise_id: null | string }>,
    nomesAnteriores,
    nomesDoC2x,
    regua,
    vinculos: (vinculos ?? []) as Array<{
      entity_id: string;
      label: null | string;
      metadata: null | { enterpriseId?: number | string };
    }>,
  });

  cacheLista.set("todos", { dados: lista, em: Date.now() });
  return lista;
}

/**
 * Os nomes que o C2X já deu a cada id, do retrato do vigia (F3, migration 0201): são apelidos para os
 * links antigos. Sem a tabela (0201 pendente) ou com erro, mapa vazio: os outros apelidos continuam.
 */
async function carregarNomesAnteriores(
  client: NonNullable<ReturnType<typeof createApoloAdminClient>>,
): Promise<Map<string, string[]>> {
  const { data, error } = await client
    .from("hercules_empreendimentos_c2x_retrato")
    .select("enterprise_id, nomes_anteriores")
    .limit(1000);
  if (error || !data) return new Map();
  return new Map(
    (data as Array<{ enterprise_id: string; nomes_anteriores: null | string[] }>).map((linha) => [
      String(linha.enterprise_id),
      linha.nomes_anteriores ?? [],
    ]),
  );
}

/**
 * O empreendimento do `?emp=`, ou `null`, e aí a página mostra o seletor. Aceita a chave do link novo
 * (o id ou `group:<chave>`), um id do C2X que ele contém e o slug de um nome que ele já teve.
 * ⚠️ NUNCA O PRIMEIRO DA LISTA: o slug que não casava abria outro empreendimento, com nome de cliente.
 */
export async function acharEmpreendimento(
  pedido: string,
): Promise<EmpreendimentoDoPainel | null> {
  return acharNaLista(await listarEmpreendimentos(), pedido);
}

// --- aba CAD -----------------------------------------------------------------------------------

const cacheCads: Cache<CadDoPainel[]> = new Map();

/**
 * As CADs do empreendimento, direto da esteira do Apolo — TODAS, qualquer que seja a origem
 * (portal público, cadastro manual ou o lote importado do Asana). Decisão do Lucas 14/08: o que
 * está no Apolo conta, ponto; separar por origem só esconderia metade do funil.
 */
export async function carregarCads(ids: readonly string[]): Promise<CadDoPainel[]> {
  const chave = ids.join(",");
  const guardado = doCache(cacheCads, chave);
  if (guardado) return guardado;

  const client = createApoloAdminClient();
  if (!client) return [];

  const { data, error } = await client
    .from("apolo_esteira")
    .select("entity_id, etapa, imobiliaria, chegou_em, pago_em, pagamento_ref")
    // Os ids como a esteira guarda: os do C2X em texto e o `group:<chave>` do grupo (PAN-124 F6).
    .in("enterprise_id", [...ids]);

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
  ids: readonly string[],
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
  const doGrupo = new Set(ids.map((id) => String(id).trim()));
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
