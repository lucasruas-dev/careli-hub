// O EMPREENDIMENTO NO C2X PELO ID, E NUNCA PELA SIGLA (PAN-124). A régua pura: sem rede, sem banco.
//
// ⚠️ POR QUE ISTO EXISTE (Lucas, 24/09/2026: *"Tivemos que mudar de nome"*). O id do empreendimento no
// C2X (`enterprises.id`) nunca muda; a sigla (`enterprises.code`) muda sempre que alguém renomeia no
// legado. Em 24/09/2026 a Nívea trocou o 43 de RDV para PDI, e a busca do coordenador pela sigla voltou
// vazia sem erro. Não foi a primeira vez: o 30 foi de LAG para ADT em 16/07 (e aí a
// `EXCLUDED_ENTERPRISE_CODES` parou de excluir quem devia) e de ADT para ACT em 21/09. Cerca de 29
// consultas ao C2X ainda filtravam por `e.code in (...)`: carteira, cobrança, extrato, vendas, planos,
// política, portal do incorporador, assinaturas, reajuste e o motor da CACÁ. Um renome faz a carteira
// daquele empreendimento sumir da tela, sem nenhum aviso.
//
// ESTE ARQUIVO DIZ, A PARTIR DO QUE QUEM CHAMA JÁ TEM, QUAIS `enterprises.id` DO C2X CONSULTAR:
//   • ids do Panteon (o que a sessão, o settings e o cadastro guardam): o número do C2X passa como
//     está; `group:<Nome>` vira as DIVISÕES; id nascido no Panteon (>= 100000) não existe no C2X e
//     não vai para lá (`idsDoC2xDosPedidos`);
//   • sigla, quando é só isso que quem chama tem (a tela do Apolo manda `?codes=`): o CATÁLOGO traduz,
//     pela posição da sigla nas divisões (`idsDoC2xDasSiglas`). ⚠️ Sigla não é id: a guardada de antes
//     de um renome só se traduz enquanto o catálogo (ou o cadastro) ainda a conhece. A casca
//     (c2x-pelo-id-servidor.ts) diz o que cada caminho garante, e confere no C2X a sigla que a tela do
//     Apolo leu ao vivo;
//   • a exclusão de sempre (teste, masterplan da Lagoa Bonita), agora pelo id: `EXCLUDED_ENTERPRISE_IDS`
//     (lib/guardian/c2x-analytics.ts), aplicada por padrão nas duas funções.
// A leitura do catálogo e do cadastro fica em `c2x-pelo-id-servidor.ts`: aqui é só a régua, testável.
//
// ⚠️ SÓ O WHERE MUDA. Quem migra uma consulta troca `e.code in (...)` por `e.id in (...)` e mais nada:
// o SELECT continua devolvendo `e.code` (é rótulo e chave de muita tela) e o ORDER BY continua como está,
// porque o resultado tem de sair IDÊNTICO ao de hoje para quem não foi renomeado.

import type { EmpreendimentoDoCatalogo } from "@/lib/apolo/catalogo-empreendimentos";
import { ENTERPRISE_GROUPS, EXCLUDED_ENTERPRISE_IDS } from "@/lib/guardian/c2x-analytics";
import type { LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { ehIdDoPanteon } from "@/lib/hercules/produto-novo";

/** O pedaço do catálogo que a tradução usa: o id, as siglas e os ids das divisões, na mesma ordem. */
export type CatalogoParaId = ReadonlyArray<Pick<EmpreendimentoDoCatalogo, "codes" | "id" | "stageIds">>;

/** O pedaço do cadastro do Panteon (`hercules_empreendimentos`) que resolve um grupo nas divisões. */
export type CadastroParaId = ReadonlyArray<
  Pick<LinhaDoCadastro, "c2xEnterpriseId" | "codigo" | "id" | "nome" | "paiId">
>;

/**
 * O que quem chama já tem na mão. Tudo opcional: sem catálogo nem cadastro, o grupo ainda se resolve
 * pelos ids fixos de `ENTERPRISE_GROUPS`, e o id numérico não precisa de nenhum dos dois.
 */
export type FontesDoIdDoC2x = {
  cadastro?: CadastroParaId | null;
  catalogo?: CatalogoParaId | null;
};

export type OpcoesDoIdDoC2x = {
  /**
   * Os ids que NÃO vão ao C2X. Padrão: `EXCLUDED_ENTERPRISE_IDS` (o substituto da lista por sigla).
   * As agregações passam `ANALYTICS_EXCLUDED_ENTERPRISE_IDS` (tira também o espelho); quem pediu um
   * empreendimento específico e quer ele mesmo excluído (a ficha do cadastro) passa `[]`.
   */
  excluir?: readonly number[];
};

/** O resultado das traduções: os ids para o `in (...)` e o que não virou id nenhum (para o log). */
export type IdsDoC2x = {
  /** Sem repetição, em ordem crescente. Vazio = não há o que consultar no C2X. */
  ids: number[];
  /** O que veio e não achou id no C2X (sigla desconhecida, grupo sem divisão, id que não é id). */
  semId: string[];
};

export const PREFIXO_DO_GRUPO = "group:";

// Nome de coluna para o SQL montado aqui: `e.id`, `eu.enterprise_id`, `enterprise_id`. Qualquer outra
// coisa é erro de programação, e o texto vai colado no SQL: por isso a trava.
const COLUNA_SQL = /^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*)?$/i;

function normalizar(texto: unknown): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function sigla(texto: unknown): string {
  return String(texto ?? "").trim().toUpperCase();
}

function crescente(ids: Iterable<number>): number[] {
  return [...new Set(ids)].sort((a, b) => a - b);
}

/**
 * O número do C2X que este texto (ou número) representa, ou `null`.
 *
 * É id do C2X o inteiro positivo abaixo de 100000. Daí para cima é produto nascido no Panteon
 * (`ehIdDoPanteon`, a sequence da migration 0170), que não existe no legado. `group:...`, `pai:...`,
 * uuid e texto qualquer também não são.
 *
 * ⚠️ O ZZ TESTE (9001) PASSA, e é inofensivo: ele é do Panteon, mas está abaixo do corte, e o C2X não
 * tem id 9001 (o maior é 43, medido em 25/09/2026). A consulta simplesmente não acha nada, como a busca
 * pela sigla dele (TST) já não achava.
 */
export function idDoC2x(valor: unknown): null | number {
  const texto = String(valor ?? "").trim();
  if (!/^\d{1,15}$/.test(texto) || ehIdDoPanteon(texto)) return null;
  const numero = Number(texto);
  return Number.isSafeInteger(numero) && numero > 0 ? numero : null;
}

/** Os ids, sem os excluídos (padrão: `EXCLUDED_ENTERPRISE_IDS`), sem repetição e em ordem crescente. */
export function semExcluidos(
  ids: Iterable<number>,
  excluir: readonly number[] = EXCLUDED_ENTERPRISE_IDS,
): number[] {
  const fora = new Set(excluir);
  return crescente([...ids].filter((id) => !fora.has(id)));
}

/**
 * O `not in` da exclusão, pelo id, pronto para o WHERE: `e.id not in (?, ?, ?)` e os parâmetros.
 *
 * ⚠️ `e.id not in` E `e.code not in` SÓ SE DIFERENCIAM NA SIGLA NULA: a sigla nula ficava de fora (NULL
 * não passa em `not in`) e o id nunca é nulo. Medido em 25/09/2026: nenhuma sigla nula ou vazia no C2X.
 * Lista de exclusão vazia devolve `1 = 1`, para o WHERE continuar válido.
 */
export function filtroSemExcluidos(
  coluna = "e.id",
  excluir: readonly number[] = EXCLUDED_ENTERPRISE_IDS,
): { params: number[]; sql: string } {
  if (!COLUNA_SQL.test(coluna)) throw new Error(`Coluna inválida para o filtro do C2X: ${coluna}`);
  const params = crescente(excluir);
  if (params.length === 0) return { params, sql: "1 = 1" };
  return { params, sql: `${coluna} not in (${params.map(() => "?").join(", ")})` };
}

/**
 * O `in` pelos ids, pronto para o WHERE: `e.id in (?, ?)` e os parâmetros.
 *
 * ⚠️ LISTA VAZIA DEVOLVE `null`, e não `in ()` (que é erro de sintaxe no MySQL) nem `1 = 1` (que traria
 * o C2X inteiro). Quem recebe `null` não vai ao C2X: devolve o vazio que já devolvia quando não havia
 * código válido.
 */
export function filtroPorIds(
  coluna: string,
  ids: Iterable<number>,
): null | { params: number[]; sql: string } {
  if (!COLUNA_SQL.test(coluna)) throw new Error(`Coluna inválida para o filtro do C2X: ${coluna}`);
  const params = crescente([...ids].filter((id) => Number.isSafeInteger(id) && id > 0));
  if (params.length === 0) return null;
  return { params, sql: `${coluna} in (${params.map(() => "?").join(", ")})` };
}

/**
 * As divisões de `group:<Nome>`, pela UNIÃO das três fontes que conhecem o grupo.
 *
 *   1. o catálogo (a linha de id `group:<Nome>` e os `stageIds` dela): é o que as telas usam hoje;
 *   2. o cadastro do Panteon: as linhas cujo `pai_id` é o pai com esse nome (o LAB para a Lagoa
 *      Bonita, o VLO para o Vale do Ouro, o LOX, o RDX e o PDX, que não têm id no C2X);
 *   3. os ids fixos de `ENTERPRISE_GROUPS`.
 *
 * ⚠️ UNIÃO, E NÃO A PRIMEIRA QUE RESPONDER. O catálogo junta as divisões pela SIGLA do legado: se
 * alguém renomear o LBR no C2X, o catálogo passa a entregar a Lagoa Bonita com duas glebas, calado. O
 * cadastro do Panteon e os ids fixos não mudam com o renome. Medido em 25/09/2026: as três fontes dão
 * exatamente as mesmas divisões para os cinco grupos, então a união é, hoje, o mesmo conjunto que o
 * catálogo sozinho.
 *
 * ⚠️ O PAI NÃO ENTRA, SÓ AS DIVISÕES (a mesma composição de `ENTERPRISE_GROUPS`, do catálogo e de
 * lib/apolo/coordenador-do-empreendimento.ts). O pai da Lagoa Bonita é o LAB (31), excluído; o do Vale
 * do Ouro é o espelho VLO (35), que tem os mesmos lotes das divisões e contaria o loteamento duas vezes.
 */
export function divisoesDoGrupo(pedido: unknown, fontes: FontesDoIdDoC2x = {}): number[] {
  const texto = String(pedido ?? "").trim();
  if (!normalizar(texto).startsWith(PREFIXO_DO_GRUPO)) return [];
  const chave = normalizar(texto);
  const nome = normalizar(texto.slice(PREFIXO_DO_GRUPO.length));
  if (!nome) return [];

  const ids: number[] = [];
  const guardar = (valor: unknown) => {
    const id = idDoC2x(valor);
    if (id !== null) ids.push(id);
  };

  for (const emp of fontes.catalogo ?? []) {
    if (normalizar(emp.id) === chave) emp.stageIds.forEach(guardar);
  }

  const cadastro = fontes.cadastro ?? [];
  const pais = new Set(
    cadastro.filter((linha) => !linha.paiId && normalizar(linha.nome) === nome).map((l) => l.id),
  );
  for (const linha of cadastro) {
    if (linha.paiId && pais.has(linha.paiId)) guardar(linha.c2xEnterpriseId);
  }

  for (const grupo of ENTERPRISE_GROUPS) {
    if (normalizar(grupo.display) === nome) grupo.ids.forEach(guardar);
  }

  return crescente(ids);
}

/**
 * Os ids do C2X que respondem pelos ids que o Panteon guarda (sessão, settings, esteira, cadastro).
 *
 *   • número do C2X ("37", 37)            → ele mesmo;
 *   • `group:<Nome>`                      → as divisões (`divisoesDoGrupo`);
 *   • id nascido no Panteon (>= 100000)   → nada: não existe no C2X, e não vai para lá;
 *   • o resto (uuid, `pai:<uuid>`, vazio) → nada, e entra em `semId`.
 * Os excluídos saem no fim (padrão: `EXCLUDED_ENTERPRISE_IDS`).
 *
 * ⚠️ A EQUIVALÊNCIA SÓ VALE NO SENTIDO GRUPO → DIVISÕES, a mesma assimetria de `codesDosIds`
 * (lib/apolo/incorporador/escopo.ts): quem tem `group:Lagoa Bonita` é dono das três glebas; quem tem só
 * o 33 (LBF, do Fernando) NÃO lê a carteira do 27 (LBR, do Raposo). Esta função nunca amplia um id de
 * divisão para o grupo.
 *
 * ⚠️ TRADUÇÃO, NÃO PERMISSÃO. O que entra é o que sai, traduzido; quem decide o que a sessão pode ver
 * continua sendo o escopo (`empreendimentosPermitidos`, `codigosDoPedido`). `pai:<uuid>` não é
 * resolvido aqui justamente por isso: a expansão do pai precisa cruzar com a sessão, e isso mora em
 * lib/apolo/incorporador/codigos-do-pedido.ts.
 */
export function idsDoC2xDosPedidos(
  pedidos: Iterable<unknown>,
  fontes: FontesDoIdDoC2x = {},
  opcoes: OpcoesDoIdDoC2x = {},
): IdsDoC2x {
  const ids: number[] = [];
  const semId: string[] = [];

  for (const pedido of pedidos) {
    const texto = String(pedido ?? "").trim();
    if (!texto) continue;

    if (normalizar(texto).startsWith(PREFIXO_DO_GRUPO)) {
      const divisoes = divisoesDoGrupo(texto, fontes);
      if (divisoes.length > 0) ids.push(...divisoes);
      else semId.push(texto);
      continue;
    }

    const id = idDoC2x(texto);
    if (id !== null) ids.push(id);
    else if (!ehIdDoPanteon(texto)) semId.push(texto);
  }

  return { ids: semExcluidos(ids, opcoes.excluir), semId: [...new Set(semId)] };
}

/**
 * Os ids do C2X destas SIGLAS, quando é só sigla o que quem chama tem.
 *
 * O catálogo traduz pela POSIÇÃO: `codes[i]` é a sigla do `stageIds[i]` (no grupo, cada divisão; no
 * simples, ele mesmo). É a mesma tradução que `idsDosCodigos` (lib/hercules/estoque-da-situacao.ts) e
 * `codigoDoEmpreendimento` (a rota da proposta) já faziam, cada uma por conta própria.
 *
 * ⚠️ É O MESMO CONJUNTO DE HOJE. As siglas que o portal e as telas mandam saem do próprio catálogo (ou
 * de `loadApoloEnterprises`, que lê a mesma tabela), e nenhuma sigla se repete no C2X: a sigla X
 * traduzida pelo catálogo é o id que `e.code = X` acharia. O ganho vem depois: quando o catálogo passar
 * a mostrar a sigla do Panteon (e ela divergir da do legado), a tradução continua achando o id certo, e
 * a consulta pela sigla voltaria vazia.
 *
 * O cadastro do Panteon, se vier, é a segunda fonte, e só para a sigla que o catálogo não conhece. É o
 * caso da sigla GUARDADA antes de um renome: o cadastro sabe o id dela; o catálogo, não.
 *
 * Sigla sem id vai para `semId`: quem chama decide se isso é "nada a consultar" (o produto nascido no
 * Panteon, que nunca teve id no C2X) ou "o catálogo está velho".
 */
export function idsDoC2xDasSiglas(
  siglas: Iterable<unknown>,
  fontes: FontesDoIdDoC2x = {},
  opcoes: OpcoesDoIdDoC2x = {},
): IdsDoC2x {
  const pedidas = [...new Set([...siglas].map(sigla).filter(Boolean))];
  if (pedidas.length === 0) return { ids: [], semId: [] };

  const doCatalogo = new Map<string, number[]>();
  for (const emp of fontes.catalogo ?? []) {
    emp.codes.forEach((code, posicao) => {
      const id = idDoC2x(emp.stageIds[posicao]);
      if (id === null) return;
      const chave = sigla(code);
      doCatalogo.set(chave, [...(doCatalogo.get(chave) ?? []), id]);
    });
  }

  const doCadastro = new Map<string, number[]>();
  for (const linha of fontes.cadastro ?? []) {
    const id = idDoC2x(linha.c2xEnterpriseId);
    if (id === null) continue;
    const chave = sigla(linha.codigo);
    if (chave) doCadastro.set(chave, [...(doCadastro.get(chave) ?? []), id]);
  }

  const ids: number[] = [];
  const semId: string[] = [];
  for (const pedida of pedidas) {
    const achados = doCatalogo.get(pedida) ?? doCadastro.get(pedida);
    if (achados && achados.length > 0) ids.push(...achados);
    else semId.push(pedida);
  }

  return { ids: semExcluidos(ids, opcoes.excluir), semId };
}
