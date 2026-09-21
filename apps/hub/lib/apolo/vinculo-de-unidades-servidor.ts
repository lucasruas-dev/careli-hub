// O VÍNCULO DA UNIDADE COM A DIVISÃO E COM A CATEGORIA — a porta única dos três caminhos.
//
// Lucas (21/09/2026): *"eu preciso também vincular as unidades no filho, categoria (quando
// existir), ou seja, eu ainda não tenho esse fluxo pronto e preciso"*. E em 15/09/2026, sobre as
// formas: *"vai ocorrer das duas formas, normalmente vamos subir em massa essa configuração na
// importação de unidades, mas teremos cenários que precisamos cadastrar uma unidade nova e apontar
// essa estrutura, ou até mesmo atualizar"*.
//
// OS TRÊS CAMINHOS CAEM AQUI, e é de propósito:
//   • planilha  → as linhas casam por quadra + lote (`casarPlanilhaDeVinculo`) e viram seleção;
//   • unitário  → a ficha da unidade manda UM id: é o caminho em massa com um item só;
//   • em massa  → a tela manda os ids que o operador marcou, depois de filtrar.
//
// ⚠️ UMA PORTA, E NÃO TRÊS. Três rotas seriam três lugares para lembrar do gêmeo do terreno, da
// categoria que precisa ser da família e da trava da divisão com venda viva — e no dia em que uma
// delas mudasse, duas ficariam para trás. A régua pura mora em `lib/hercules/unidade-vinculo.ts` e
// em `lib/hercules/vinculo-da-unidade.ts`; aqui fica o que só o banco responde.
//
// ⚠️ A PRÉVIA É OBRIGATÓRIA NO DESENHO, MAS NÃO NO PROTOCOLO. `previa` não grava nada e `aplicar`
// recalcula tudo do zero: entre um clique e outro alguém pode ter vendido o lote. Confiar no que a
// tela mandou seria carimbar em cima de um retrato velho.
//
// ⚠️ MUDAR A DIVISÃO EXIGE CONFIRMAÇÃO EXPLÍCITA (`confirmarDivisao`). Trocar a categoria é barato
// e reversível; trocar a divisão muda quem enxerga o lote no portal, qual minuta sai, qual comissão
// vale e deixa o código apontando para o masterplan da gleba antiga. Ver o cabeçalho de
// `planoDeMudancaDeDivisao`.
//
// ⚠️ O CARIMBO É O PADRÃO DA 0163 (quem, quando, por onde), e o código roda sem ele. As colunas da
// migration 0181 podem não existir ainda: a gravação tenta com elas e repete sem elas quando o
// Postgres responde 42703/PGRST204 (coluna ausente) ou 23514 (o CHECK da origem). O vínculo é o que
// não pode faltar; o carimbo é o detalhe.

import { lerCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { ehIdDoPai, PREFIXO_DO_PAI } from "@/lib/hercules/expandir-id-do-painel";
import { COLUNAS_DO_APARTAMENTO } from "@/lib/hercules/nome-da-unidade";
import { ehColunaDaUnidadeVerticalAusente } from "@/lib/hercules/unidade-nova";
import { identidadeDoTerreno } from "@/lib/hercules/vinculo-da-unidade";
import {
  casarPlanilhaDeVinculo,
  categoriaCompativel,
  chaveDaColunaDeVinculo,
  type DivisaoDaFamilia,
  filtrarUnidades,
  type FiltroDeUnidades,
  lerCsvDeVinculo,
  type LinhaDaPlanilhaDeVinculo,
  type PlanoDeDivisao,
  planoDeMudancaDeDivisao,
  type PreviaDoVinculo,
  previaDoVinculo,
  type RelatorioDaPlanilhaDeVinculo,
  type UnidadeDoUniverso,
} from "@/lib/hercules/unidade-vinculo";

import { createApoloAdminClient } from "./server";

const WORKSPACE = "careli";

/** O PostgREST corta em 1.000 linhas SEM erro: toda leitura de lista pagina. */
const PAGINA = 1000;

/** `.in()` vai na URL e estoura perto de 400 itens: leitura e gravação por lista vão em lotes. */
const LOTE_DO_IN = 100;

/** Teto por chamada, o mesmo da tela de vínculo que já está no ar. Acima disto, a tela pagina. */
export const TETO_DE_UNIDADES = 500;

/**
 * Teto da PLANILHA, que é outro número e por um motivo.
 *
 * ⚠️ A ABA "SUBIR PLANILHA" NÃO TEM FILTRO DE QUADRA NEM CAMPO DE FAIXA — eles só existem na aba
 * "Escolher na lista". Até 21/09/2026 a planilha caa no teto de 500 e a frase da recusa mandava o
 * operador *"dividir a seleção (por quadra ou por faixa de lotes)"*, ou seja, usar um recorte que a
 * aba dele não tem. E o Lucas disse que este é o caminho NORMAL: *"normalmente vamos subir em massa
 * essa configuração na importação de unidades"*.
 *
 * ⚠️ O NÚMERO É MEDIDO, e não escolhido no chute. A maior família em 21/09/2026 é o Lagoa Bonita,
 * com 907 linhas (Vale do Ouro 600, Cidade Jardim 532, Lavra do Ouro 493). 2.000 cobre o
 * loteamento inteiro com folga de mais do dobro. O que o teto protege é o `maxDuration = 60` da
 * rota, e aí o que conta não é o número de linhas e sim o de IDAS AO BANCO: as leituras vão em
 * páginas de 1.000 e as gravações em lotes de 100 e 200, então 2.000 linhas são por volta de 90
 * consultas — na mesma ordem de grandeza das 25 que as 532 do Cidade Jardim custam hoje.
 *
 * ⚠️ A TELA CONTINUA DIVIDINDO (`vinculo-de-unidades.ts`, `emBlocos`), e isso não é redundância:
 * o teto é a última linha de defesa de quem colar um arquivo de outro tamanho direto na rota.
 */
export const TETO_DA_PLANILHA = 2000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Por onde o vínculo foi feito. Vai para o carimbo, e é o que responde "como isso entrou aqui?". */
export type OrigemDoVinculo = "ficha" | "massa" | "planilha";

const ORIGENS: readonly OrigemDoVinculo[] = ["ficha", "massa", "planilha"];

type ClienteAdmin = NonNullable<ReturnType<typeof createApoloAdminClient>>;

export type Falha = { detalhe?: string; error: string; ok: false; status: number };
export type Sucesso<T> = { data: T; ok: true };

function falha(status: number, error: string, detalhe?: string): Falha {
  return { ...(detalhe ? { detalhe } : {}), error, ok: false, status };
}

function texto(valor: unknown): null | string {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo ? limpo : null;
}

/** Divide uma lista em pedaços de `tamanho`. */
function emLotes<T>(lista: readonly T[], tamanho: number): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamanho) lotes.push(lista.slice(i, i + tamanho));
  return lotes;
}

// ─────────────────────────────────────────────────────────────────────────────
// A FAMÍLIA
// ─────────────────────────────────────────────────────────────────────────────

export type FamiliaResolvida = {
  /** Os `c2x_enterprise_id` do pai e de todas as divisões. É o universo do vínculo. */
  ids: string[];
  /** O pai e as divisões, com nome e código, para a tela e para a planilha. */
  divisoes: DivisaoDaFamilia[];
  /** O nome do conjunto, para as frases. */
  nome: string;
};

/**
 * A família a partir do que a tela mandou.
 *
 * O pedido chega em três formatos, e os três existem hoje:
 *   • `"31"`            → o `c2x_enterprise_id` do produto;
 *   • `"pai:<uuid>"`    → a linha do painel que é um pai (`expandir-id-do-painel`);
 *   • `"group:Lagoa Bonita"` + `codigo` → a ficha CONSOLIDADA, que não tem id de empreendimento:
 *     o Apolo monta a linha do produto agrupado com um rótulo, não com uma chave. O caminho de
 *     volta é o CÓDIGO de uma das etapas, que a ficha já tem em mãos. Foi assim que as duas
 *     categorias do Lagoa Bonita apareceram como "nenhuma categoria" na tela.
 *
 * ⚠️ SOBE E DESCE. Se a tela está na gleba, o pai entra; se está no pai, as glebas entram. É isso
 * que põe o gêmeo do terreno dentro do universo — sem ele o vínculo carimba metade do chão.
 */
export function resolverFamilia(
  cadastro: readonly LinhaDoCadastro[],
  pedido: { codigo?: null | string; enterpriseId?: null | string },
): Falha | Sucesso<FamiliaResolvida> {
  const alvo = String(pedido.enterpriseId ?? "").trim();
  const codigo = String(pedido.codigo ?? "").trim().toUpperCase();

  let linha: LinhaDoCadastro | undefined;
  if (ehIdDoPai(alvo)) {
    linha = cadastro.find((l) => l.id === alvo.slice(PREFIXO_DO_PAI.length));
  } else if (alvo.startsWith("group:")) {
    linha = codigo ? cadastro.find((l) => l.codigo === codigo) : undefined;
  } else if (alvo) {
    linha = cadastro.find((l) => l.c2xEnterpriseId === alvo);
  }
  // O código sozinho ainda é um caminho válido: a ficha consolidada às vezes só tem ele.
  if (!linha && codigo) linha = cadastro.find((l) => l.codigo === codigo);

  if (!linha) return falha(404, "Empreendimento não encontrado.");

  const raizId = linha.paiId ?? linha.id;
  const raiz = cadastro.find((l) => l.id === raizId) ?? linha;
  const daFamilia = cadastro.filter((l) => l.id === raizId || l.paiId === raizId);

  const divisoes: DivisaoDaFamilia[] = [];
  for (const l of daFamilia) {
    const enterpriseId = texto(l.c2xEnterpriseId);
    if (!enterpriseId) continue;
    divisoes.push({
      codigo: String(l.codigo ?? "").toUpperCase(),
      enterpriseId,
      nome: l.nome ?? enterpriseId,
      pai: l.id === raizId,
    });
  }

  if (divisoes.length === 0) {
    return falha(
      409,
      "Este empreendimento está sem o id do sistema anterior no cadastro, e é ele que a unidade guarda.",
      "c2x_enterprise_id ausente em hercules_empreendimentos para a família inteira.",
    );
  }

  return {
    data: { divisoes, ids: divisoes.map((d) => d.enterpriseId), nome: raiz.nome ?? divisoes[0]!.nome },
    ok: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LEITURAS
// ─────────────────────────────────────────────────────────────────────────────

/** A linha de `hercules_unidades` que o vínculo lê, com o carimbo quando a 0181 já existe. */
export type LinhaDoUniverso = UnidadeDoUniverso & {
  vinculo_em?: null | string;
  vinculo_origem?: null | string;
  vinculo_por_nome?: null | string;
};

const COLUNAS_DO_UNIVERSO =
  "id,codigo,quadra,lote,situacao,categoria_id,enterprise_id,espelho_de";
const COLUNAS_DO_CARIMBO = ",vinculo_em,vinculo_por_nome,vinculo_origem";

/**
 * O erro do Supabase é "o carimbo do vínculo (0181) não está disponível"?
 *
 * ⚠️ TRÊS CÓDIGOS, E SÓ QUANDO A MENSAGEM NOMEIA O CARIMBO. 42703/PGRST204 = a migration ainda não
 * foi aplicada; 23514 = ela foi, e o CHECK de `vinculo_origem` recusou um valor que uma versão
 * futura da tela inventou. Nos três casos o VÍNCULO ainda pode e deve ser gravado — perder o
 * carimbo é barato, perder o vínculo é o pedido do Lucas indo embora.
 *
 * ⚠️ E NUNCA SEM O NOME NA MENSAGEM: esses códigos valem para qualquer coluna, e engolir um erro de
 * digitação em `categoria_id` esconderia o defeito que mais importa.
 */
export function ehCarimboDoVinculoIndisponivel(erro: unknown): boolean {
  if (!erro || typeof erro !== "object") return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  if (code !== "23514" && code !== "42703" && code !== "PGRST204") return false;
  const mensagem = typeof message === "string" ? message.toLowerCase() : "";
  return /vinculo_(em|origem|por|por_nome)|hercules_unidades_vinculo_origem_valida/.test(mensagem);
}

/**
 * Todas as unidades da família, paginadas.
 *
 * ⚠️ PAGINA, e o Lagoa Bonita é a prova: 907 unidades só na família dele. Sem paginar, o gêmeo do
 * lote 908 em diante simplesmente não apareceria e o carimbo sairia pela metade.
 *
 * ⚠️ E LÊ DUAS COLUNAS QUE PODEM NÃO EXISTIR — as do apartamento (0171) e as do carimbo (0181). Cada
 * ausência faz a leitura repetir sem elas, nunca derrubar a tela.
 */
export async function lerUniversoDaFamilia(
  admin: ClienteAdmin,
  familia: readonly string[],
): Promise<{ semCarimbo: boolean; unidades: LinhaDoUniverso[] }> {
  const unidades: LinhaDoUniverso[] = [];
  if (familia.length === 0) return { semCarimbo: false, unidades };

  let carimbo = COLUNAS_DO_CARIMBO;
  let apartamento = COLUNAS_DO_APARTAMENTO;

  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await admin
      .from("hercules_unidades")
      .select(`${COLUNAS_DO_UNIVERSO}${carimbo}${apartamento}`)
      .eq("workspace_id", WORKSPACE)
      .in("enterprise_id", [...familia])
      .order("quadra", { ascending: true })
      .order("lote", { ascending: true })
      .range(de, de + PAGINA - 1);

    if (error && carimbo && ehCarimboDoVinculoIndisponivel(error)) {
      carimbo = "";
      de -= PAGINA;
      continue;
    }
    if (error && apartamento && ehColunaDaUnidadeVerticalAusente(error)) {
      apartamento = "";
      de -= PAGINA;
      continue;
    }
    if (error) throw new Error(String((error as { message?: string }).message ?? error));

    const pagina = (data ?? []) as unknown as LinhaDoUniverso[];
    unidades.push(...pagina);
    if (pagina.length < PAGINA) break;
  }

  return { semCarimbo: carimbo === "", unidades };
}

/**
 * Quais das unidades têm venda viva (proposta aberta ou reserva viva).
 *
 * ⚠️ PELA ETAPA, E NÃO PELA COLUNA `situacao` DA UNIDADE. É a mesma pergunta que o cadastro já faz
 * antes de mexer em preço: `aberta` nunca volta para false, e a reserva grava a linha dela ANTES de
 * marcar a unidade como reservada — nesse intervalo a unidade ainda está 'disponivel' com reserva
 * viva.
 *
 * ⚠️ FALHA LANÇA. Sem conseguir provar que não há venda andando, a divisão não muda: quem chama
 * transforma isso em recusa, nunca em "pode".
 */
export async function lerVendasVivas(
  admin: ClienteAdmin,
  unidadeIds: readonly string[],
): Promise<Set<string>> {
  const vivas = new Set<string>();
  if (unidadeIds.length === 0) return vivas;

  for (const lote of emLotes([...unidadeIds], LOTE_DO_IN)) {
    const { data: propostas, error: erroDasPropostas } = await admin
      .from("hercules_propostas")
      .select("unidade_id")
      .eq("workspace_id", WORKSPACE)
      .in("unidade_id", lote)
      .not("etapa", "in", '("cancelado","distrato")');
    if (erroDasPropostas) throw new Error(erroDasPropostas.message);
    for (const p of (propostas ?? []) as { unidade_id: null | string }[]) {
      if (p.unidade_id) vivas.add(p.unidade_id);
    }

    const { data: reservas, error: erroDasReservas } = await admin
      .from("hercules_reservas")
      .select("unidade_id")
      .eq("workspace_id", WORKSPACE)
      .in("unidade_id", lote)
      .in("situacao", ["ativa", "proposta"]);
    if (erroDasReservas) throw new Error(erroDasReservas.message);
    for (const r of (reservas ?? []) as { unidade_id: null | string }[]) {
      if (r.unidade_id) vivas.add(r.unidade_id);
    }
  }

  return vivas;
}

export type CategoriaDaFamilia = { enterpriseId: string; id: string; nome: string };

/**
 * As categorias da família.
 *
 * ⚠️ DA FAMÍLIA INTEIRA, E NÃO DO PRODUTO. Medido em 21/09/2026: as 907 unidades com categoria
 * apontam para as duas categorias cadastradas no Lagoa Bonita PAI (31), e 412 delas são linhas das
 * glebas. Ler só o `enterprise_id` do produto faria a planilha da gleba dizer "a categoria
 * Condomínio não existe" para a categoria que carimba 750 lotes.
 */
export async function lerCategoriasDaFamilia(
  admin: ClienteAdmin,
  familia: readonly string[],
): Promise<CategoriaDaFamilia[]> {
  if (familia.length === 0) return [];
  const { data, error } = await admin
    .from("temis_categorias")
    .select("id,nome,enterprise_id,ativa")
    .eq("workspace_id", WORKSPACE)
    .in("enterprise_id", [...familia])
    .order("nome", { ascending: true });

  if (error) throw new Error(error.message);

  return ((data ?? []) as { ativa: boolean | null; enterprise_id: null | string; id: string; nome: null | string }[])
    .filter((c) => c.ativa !== false)
    .map((c) => ({
      enterpriseId: String(c.enterprise_id ?? ""),
      id: c.id,
      nome: String(c.nome ?? ""),
    }));
}

// ─────────────────────────────────────────────────────────────────────────────
// O PEDIDO
// ─────────────────────────────────────────────────────────────────────────────

export type AcaoDoVinculo = "aplicar" | "previa" | "universo";

const ACOES: readonly AcaoDoVinculo[] = ["aplicar", "previa", "universo"];

type Corpo = {
  acao?: unknown;
  codigo?: unknown;
  /** `true` = o operador leu os avisos da divisão e confirmou. Sem isso, a divisão não anda. */
  confirmarDivisao?: unknown;
  /** O alvo quando a seleção vem por ids. `null` desvincula; ausente = não mexe na categoria. */
  categoriaId?: unknown;
  csv?: unknown;
  divisaoDestino?: unknown;
  enterpriseId?: unknown;
  filtro?: unknown;
  linhas?: unknown;
  origem?: unknown;
  unidadeIds?: unknown;
};

/** Uma mudança pedida para UMA unidade, já resolvida (o que vem da planilha e o que vem dos ids). */
type MudancaPedida = {
  /** Ausente = a categoria não muda. `null` = tirar a categoria. */
  categoriaId?: null | string;
  /** Ausente = a divisão não muda. */
  divisaoDestino?: string;
  unidadeId: string;
};

function ehAcao(valor: unknown): valor is AcaoDoVinculo {
  return typeof valor === "string" && (ACOES as readonly string[]).includes(valor);
}

function origemDoCorpo(valor: unknown): OrigemDoVinculo {
  const cru = String(valor ?? "").trim().toLowerCase();
  return (ORIGENS as readonly string[]).includes(cru) ? (cru as OrigemDoVinculo) : "massa";
}

function filtroDoCorpo(valor: unknown): FiltroDeUnidades {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
  const cru = valor as Record<string, unknown>;
  const lista = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((i) => String(i ?? "").trim()).filter(Boolean) : [];
  return {
    ...(typeof cru.categoria === "string"
      ? { categoria: cru.categoria as FiltroDeUnidades["categoria"] }
      : {}),
    divisoes: lista(cru.divisoes),
    faixa: texto(cru.faixa),
    quadras: lista(cru.quadras),
    situacoes: lista(cru.situacoes),
    termo: texto(cru.termo),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// A PRÉVIA E A GRAVAÇÃO
// ─────────────────────────────────────────────────────────────────────────────

export type PreviaDaCategoria = {
  categoriaId: null | string;
  nome: string;
  previa: PreviaDoVinculo;
};

export type PreviaDaDivisao = { destino: string; nome: string; plano: PlanoDeDivisao };

export type PrevisaoDoVinculo = {
  categorias: PreviaDaCategoria[];
  divisoes: PreviaDaDivisao[];
  /** Só quando a seleção veio de planilha. */
  planilha: null | RelatorioDaPlanilhaDeVinculo;
  /** O que precisa ser lido antes de confirmar. */
  avisos: string[];
  /** O que não vai acontecer, com a frase do motivo. */
  recusas: { motivo: string; rotulo: string; unidadeId: string }[];
  resumo: { linhas: number; movem: number; mudam: number; terrenos: number };
};

/**
 * A gravação de UM grupo de categoria, em lotes.
 *
 * ⚠️ TENTA COM O CARIMBO E REPETE SEM ELE. A 0181 pode não estar aplicada; o vínculo é o que não
 * pode faltar. Sem o carimbo o vínculo grava igual, e quem lê a unidade vê o campo ausente — que é
 * exatamente o sinal de "esta linha foi carimbada antes de existir carimbo", o mesmo desenho que a
 * 0163 usa para separar bloqueio do legado de bloqueio nosso.
 */
async function gravarCategoria(
  admin: ClienteAdmin,
  ids: readonly string[],
  categoriaId: null | string,
  carimbo: Record<string, null | string>,
): Promise<{ gravadas: number; semCarimbo: boolean }> {
  let comCarimbo = true;
  let gravadas = 0;

  for (const lote of emLotes([...ids], 200)) {
    const mudanca = {
      atualizado_em: carimbo.vinculo_em,
      categoria_id: categoriaId,
      ...(comCarimbo ? carimbo : {}),
    };
    let { data, error } = await admin
      .from("hercules_unidades")
      .update(mudanca)
      .eq("workspace_id", WORKSPACE)
      .in("id", lote)
      .select("id");

    if (error && comCarimbo && ehCarimboDoVinculoIndisponivel(error)) {
      comCarimbo = false;
      ({ data, error } = await admin
        .from("hercules_unidades")
        .update({ atualizado_em: carimbo.vinculo_em, categoria_id: categoriaId })
        .eq("workspace_id", WORKSPACE)
        .in("id", lote)
        .select("id"));
    }
    if (error) throw new Error(error.message);
    gravadas += (data ?? []).length;
  }

  return { gravadas, semCarimbo: !comCarimbo };
}

/**
 * A gravação da mudança de divisão, EM LOTE e CONDICIONAL.
 *
 * ⚠️ O UPDATE CARREGA A TRAVA (`in('situacao', ['disponivel','bloqueada'])` e o `enterprise_id` de
 * origem). Entre a prévia e o clique cabe uma reserva: quem chegar depois casa zero linhas, e o
 * `select` mostra isso — a resposta diz quantas de fato andaram, nunca quantas foram pedidas.
 *
 * ⚠️ E O LOTE É O QUE TIRA ESTA TELA DO TIMEOUT. Até 21/09/2026 era uma ida ao banco POR UNIDADE:
 * 40 lotes, 40 gravações. A tela deixa marcar centenas de uma vez (o botão "Marcar os N visíveis"
 * não tem teto), `TETO_DE_UNIDADES` é 500 e a rota declara `maxDuration = 60` — 500 idas e voltas
 * sequenciais ao Supabase dentro de 60s é o cenário de timeout, e timeout da Vercel chega na tela
 * como erro de JSON. A gravação da categoria já ia em lote; esta passou a ir também.
 *
 * ⚠️ AGRUPA POR (DE, PARA) porque as duas pontas entram no `where`: a origem é a trava contra
 * mover o lote que já se moveu. Um lote por par, e cada par em pedaços de `LOTE_DO_IN`.
 */
async function gravarDivisao(
  admin: ClienteAdmin,
  mover: readonly { de: string; para: string; unidadeId: string }[],
  carimbo: Record<string, null | string>,
): Promise<{ movidas: number; perdidas: string[] }> {
  let comCarimbo = true;
  let movidas = 0;
  const perdidas: string[] = [];

  const porPar = new Map<string, { de: string; ids: string[]; para: string }>();
  for (const passo of mover) {
    const chave = `${passo.de} ${passo.para}`;
    const grupo = porPar.get(chave) ?? { de: passo.de, ids: [], para: passo.para };
    grupo.ids.push(passo.unidadeId);
    porPar.set(chave, grupo);
  }

  for (const grupo of porPar.values()) {
    for (const lote of emLotes(grupo.ids, LOTE_DO_IN)) {
      const gravar = () =>
        admin
          .from("hercules_unidades")
          .update(
            comCarimbo
              ? { atualizado_em: carimbo.vinculo_em, enterprise_id: grupo.para, ...carimbo }
              : { atualizado_em: carimbo.vinculo_em, enterprise_id: grupo.para },
          )
          .eq("workspace_id", WORKSPACE)
          .in("id", lote)
          .eq("enterprise_id", grupo.de)
          .in("situacao", ["bloqueada", "disponivel"])
          .select("id");

      let { data, error } = await gravar();
      if (error && comCarimbo && ehCarimboDoVinculoIndisponivel(error)) {
        comCarimbo = false;
        ({ data, error } = await gravar());
      }
      if (error) throw new Error(error.message);

      // ⚠️ QUEM ANDOU É QUEM VOLTOU NO `select`, e o resto é PERDIDA — a mesma conta que o laço
      // fazia uma unidade por vez, agora por diferença de conjunto.
      const andaram = new Set(((data ?? []) as { id: string }[]).map((l) => l.id));
      movidas += andaram.size;
      for (const id of lote) if (!andaram.has(id)) perdidas.push(id);
    }
  }

  return { movidas, perdidas };
}

// ─────────────────────────────────────────────────────────────────────────────
// A AÇÃO
// ─────────────────────────────────────────────────────────────────────────────

export type EntradaDoVinculo = {
  /** Relógio injetável para o teste. */
  agora?: Date;
  autor: { id: null | string; nome: null | string };
  /** O corpo do pedido, cru. */
  corpo: unknown;
  /** Injetável para o teste: o cliente do Supabase e o cadastro de empreendimentos. */
  duble?: {
    admin: ClienteAdmin;
    cadastro: LinhaDoCadastro[];
  };
};

/**
 * O pedido inteiro, do começo ao fim. NUNCA LANÇA: toda falha vira `{ ok: false, status, error }`.
 *
 *   • `universo` → as unidades da família, as categorias e as divisões. Não escreve.
 *   • `previa`   → o que mudaria. Não escreve.
 *   • `aplicar`  → grava, recalculando tudo de novo a partir do banco.
 */
export async function executarVinculoDeUnidades(
  entrada: EntradaDoVinculo,
): Promise<Falha | Sucesso<unknown>> {
  const corpo = (entrada.corpo && typeof entrada.corpo === "object" ? entrada.corpo : {}) as Corpo;
  const acao = corpo.acao;
  if (!ehAcao(acao)) return falha(400, "Ação desconhecida.");

  const admin = entrada.duble?.admin ?? createApoloAdminClient();
  if (!admin) {
    return falha(503, "Vínculo de unidades indisponível.", "Supabase sem configuração.");
  }

  let cadastro: LinhaDoCadastro[];
  try {
    cadastro = entrada.duble?.cadastro ?? (await lerCadastroDeEmpreendimentos()).linhas;
  } catch (erro) {
    return falha(503, "Não foi possível carregar os empreendimentos agora.", String(erro));
  }

  const familia = resolverFamilia(cadastro, {
    codigo: texto(corpo.codigo),
    enterpriseId: texto(corpo.enterpriseId),
  });
  if (!familia.ok) return familia;

  const agora = entrada.agora ?? new Date();

  try {
    const [universo, categorias] = await Promise.all([
      lerUniversoDaFamilia(admin, familia.data.ids),
      lerCategoriasDaFamilia(admin, familia.data.ids),
    ]);

    if (acao === "universo") {
      const filtro = filtroDoCorpo(corpo.filtro);
      const alvo = texto(corpo.categoriaId);
      const recortadas = filtrarUnidades(universo.unidades, filtro, { categoriaAlvo: alvo });
      return {
        data: {
          categorias,
          divisoes: familia.data.divisoes,
          empreendimento: { ids: familia.data.ids, nome: familia.data.nome },
          semCarimbo: universo.semCarimbo,
          // ⚠️ UM TERRENO, UMA LINHA — e a escolhida é a VIVA. O mesmo lote existe no pai e na
          // gleba; mostrar os dois faria o operador escolher duas vezes o mesmo chão e a contagem
          // mentir. Quem carimba o gêmeo é `planoDeVinculo`, na gravação.
          unidades: umaLinhaPorTerreno(recortadas).map((u) => ({
            apartamento: u.apartamento ?? "",
            categoriaId: u.categoria_id ?? null,
            codigo: u.codigo ?? "",
            enterpriseId: String(u.enterprise_id ?? ""),
            id: u.id,
            lote: u.lote ?? "",
            quadra: u.quadra ?? "",
            situacao: u.situacao ?? "",
            torre: u.torre ?? "",
            vinculo: u.vinculo_em
              ? { em: u.vinculo_em, origem: u.vinculo_origem ?? null, por: u.vinculo_por_nome ?? null }
              : null,
          })),
        },
        ok: true,
      };
    }

    // ── A seleção: por ids (tela e ficha) ou por planilha ──
    const pedido = resolverSelecao(corpo, {
      categorias,
      divisoes: familia.data.divisoes,
      familia: familia.data.ids,
      universo: universo.unidades,
    });
    if (!pedido.ok) return pedido;

    const { mudancas, planilha } = pedido.data;
    if (mudancas.length === 0) {
      return {
        data: previsaoVazia(planilha),
        ok: true,
      };
    }
    // ⚠️ DOIS TETOS, E CADA UM COM A FRASE DO SEU CAMINHO. Quem escolheu na lista divide por quadra
    // ou por faixa — filtros que aquela aba tem. Quem subiu planilha não tem filtro nenhum, e a
    // frase dele precisa falar do ARQUIVO. Ver `TETO_DA_PLANILHA`.
    const teto = planilha ? TETO_DA_PLANILHA : TETO_DE_UNIDADES;
    if (mudancas.length > teto) {
      return falha(
        422,
        planilha
          ? `A planilha traz ${mudancas.length} lotes para mudar, e são no máximo ${TETO_DA_PLANILHA} por envio. Divida o arquivo em duas partes e envie uma de cada vez.`
          : `São no máximo ${TETO_DE_UNIDADES} unidades por vez. Divida a seleção (por quadra ou por faixa de lotes) e envie em partes.`,
      );
    }

    // ⚠️ A VENDA VIVA É LIDA UMA VEZ, PARA OS DOIS LADOS. A categoria só a mostra (não trava); a
    // divisão recusa com ela. Sem esta leitura, a divisão mudaria no meio de uma negociação.
    const vivas = await lerVendasVivas(
      admin,
      mudancas.map((m) => m.unidadeId),
    );
    const universoComVenda: LinhaDoUniverso[] = universo.unidades.map((u) =>
      vivas.has(u.id) ? { ...u, temVendaViva: true } : u,
    );

    const previsao = montarPrevisao(mudancas, {
      categorias,
      divisoes: familia.data.divisoes,
      planilha,
      universo: universoComVenda,
    });

    if (acao === "previa") return { data: previsao, ok: true };

    // ── Gravar ──
    const querDivisao = previsao.divisoes.some((d) => d.plano.mover.length > 0);
    if (querDivisao && corpo.confirmarDivisao !== true) {
      return falha(
        409,
        "Mudar a divisão da unidade precisa de confirmação: leia os avisos da prévia antes de aplicar.",
      );
    }

    const carimbo: Record<string, null | string> = {
      vinculo_em: agora.toISOString(),
      vinculo_origem: origemDoCorpo(corpo.origem),
      vinculo_por: entrada.autor.id && UUID.test(entrada.autor.id) ? entrada.autor.id : null,
      vinculo_por_nome: texto(entrada.autor.nome),
    };

    let gravadas = 0;
    let semCarimbo = false;
    for (const grupo of previsao.categorias) {
      if (grupo.previa.ids.length === 0) continue;
      const feito = await gravarCategoria(admin, grupo.previa.ids, grupo.categoriaId, carimbo);
      gravadas += feito.gravadas;
      semCarimbo = semCarimbo || feito.semCarimbo;
    }

    let movidas = 0;
    const perdidas: string[] = [];
    for (const grupo of previsao.divisoes) {
      if (grupo.plano.mover.length === 0) continue;
      const feito = await gravarDivisao(admin, grupo.plano.mover, carimbo);
      movidas += feito.movidas;
      perdidas.push(...feito.perdidas);
    }

    return {
      data: {
        avisos: previsao.avisos,
        gravadas,
        movidas,
        // ⚠️ O QUE ESCAPOU ENTRE A PRÉVIA E O CLIQUE aparece na resposta, e não some. Uma reserva
        // que nasceu no meio faz o update condicional casar zero linhas: dizer "movidas: 3" quando
        // uma ficou para trás é a mentira mais cara desta tela.
        naoMovidas: perdidas.length,
        planilha: previsao.planilha,
        porParentesco: previsao.categorias.reduce((n, c) => n + c.previa.porParentesco, 0),
        recusas: previsao.recusas,
        semCarimbo,
        // ⚠️ O PAINEL VERDE CONTA O QUE MUDOU, E NÃO O QUE FOI MARCADO. A tela imprime este número
        // como "N lotes atualizados"; remarcar uma quadra inteira que já está na categoria grava
        // ZERO linhas (de propósito, para não sujar `atualizado_em` nem o carimbo de 907 linhas) e
        // dizia "30 lotes atualizados" assim mesmo. A prévia já acertava; o resultado, não.
        terrenos: previsao.resumo.mudam,
      },
      ok: true,
    };
  } catch (erro) {
    console.error("[apolo][unidades][vinculo]", erro);
    return falha(
      500,
      "Não foi possível concluir o vínculo agora. Nada foi gravado além do que a resposta disser.",
      erro instanceof Error ? erro.message : String(erro),
    );
  }
}

/**
 * Um terreno, uma linha — e a escolhida é a VIVA (a gleba vence o registro antigo do pai).
 *
 * ⚠️ A CHAVE É A IDENTIDADE DA RÉGUA (`identidadeDoTerreno`), nunca uma cópia escrita aqui. Duas
 * formas de dizer "é o mesmo chão" é a divergência pai × gleba que a 0161 existe para acabar.
 *
 * ⚠️ E POR IDENTIDADE, NÃO POR QUADRA+LOTE. Agrupar por quadra+lote ESCONDIA um lote vivo: nas 17
 * chaves em que duas glebas da mesma família repetem o número (medido em 21/09/2026), a lista
 * mostrava uma linha onde existem duas, e qual das duas dependia do `.order()` do banco, que
 * empata. O operador nunca conseguia marcar a outra — e o carimbo alcançava as duas.
 */
function umaLinhaPorTerreno(linhas: readonly LinhaDoUniverso[]): LinhaDoUniverso[] {
  const porChave = new Map<string, LinhaDoUniverso>();
  for (const l of linhas) {
    const chave = identidadeDoTerreno(l);
    const atual = porChave.get(chave);
    if (!atual || (atual.espelho_de && !l.espelho_de)) porChave.set(chave, l);
  }
  return [...porChave.values()];
}

function previsaoVazia(planilha: null | RelatorioDaPlanilhaDeVinculo): PrevisaoDoVinculo {
  return {
    avisos: [],
    categorias: [],
    divisoes: [],
    planilha,
    recusas: [],
    resumo: { linhas: 0, movem: 0, mudam: 0, terrenos: 0 },
  };
}

/**
 * A seleção, venha ela de ids ou de planilha.
 *
 * ⚠️ A PLANILHA E OS IDS PRODUZEM A MESMA COISA. Se cada caminho tivesse o próprio jeito de dizer
 * "esta unidade vai para esta categoria", a prévia da planilha e a prévia da tela discordariam no
 * dia em que uma regra mudasse — e o operador confiaria na que viu por último.
 */
function resolverSelecao(
  corpo: Corpo,
  contexto: {
    categorias: readonly CategoriaDaFamilia[];
    divisoes: readonly DivisaoDaFamilia[];
    familia: readonly string[];
    universo: readonly LinhaDoUniverso[];
  },
):
  | Falha
  | Sucesso<{ mudancas: MudancaPedida[]; planilha: null | RelatorioDaPlanilhaDeVinculo }> {
  const temPlanilha =
    (typeof corpo.csv === "string" && corpo.csv.trim() !== "") || Array.isArray(corpo.linhas);

  if (temPlanilha) {
    const linhas: LinhaDaPlanilhaDeVinculo[] =
      typeof corpo.csv === "string" && corpo.csv.trim() !== ""
        ? lerCsvDeVinculo(corpo.csv)
        : (corpo.linhas as LinhaDaPlanilhaDeVinculo[]).map((l) => linhaDaPlanilhaNaChave(l));

    if (linhas.length === 0) return falha(400, "A planilha veio vazia.");

    const relatorio = casarPlanilhaDeVinculo(linhas, {
      categorias: contexto.categorias,
      divisoes: contexto.divisoes,
      familia: contexto.familia,
      universo: contexto.universo,
    });

    return {
      data: {
        mudancas: relatorio.casaram.map((c) => ({
          ...("categoriaId" in c ? { categoriaId: c.categoriaId ?? null } : {}),
          ...(c.divisaoDestino ? { divisaoDestino: c.divisaoDestino } : {}),
          unidadeId: c.unidadeId,
        })),
        planilha: relatorio,
      },
      ok: true,
    };
  }

  const ids = [
    ...new Set(
      (Array.isArray(corpo.unidadeIds) ? corpo.unidadeIds : [])
        .map((i) => String(i ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (ids.length === 0) return falha(422, "Escolha ao menos uma unidade.");

  const mexeNaCategoria = "categoriaId" in corpo;
  const categoriaId = texto(corpo.categoriaId);
  const divisaoDestino = texto(corpo.divisaoDestino);

  if (!mexeNaCategoria && !divisaoDestino) {
    return falha(422, "Diga o que mudar: a categoria, a divisão, ou as duas.");
  }

  // ⚠️ A CATEGORIA PRECISA SER DA FAMÍLIA, e a conferência é aqui e não só na planilha. Um id de
  // categoria de outro empreendimento no corpo carimbaria o lote com a minuta errada, e nada na
  // tela denunciaria: o nome da categoria só aparece depois, na geração do contrato.
  if (categoriaId) {
    const achada = contexto.categorias.find((c) => c.id === categoriaId);
    if (!achada) return falha(404, "Categoria não encontrada neste empreendimento.");
    const porId = new Map(contexto.universo.map((u) => [u.id, u]));
    for (const id of ids) {
      const unidade = porId.get(id);
      if (!unidade) continue;
      const compativel = categoriaCompativel(achada, unidade, contexto.familia);
      if (!compativel.ok) return falha(409, compativel.motivo);
    }
  }

  return {
    data: {
      mudancas: ids.map((unidadeId) => ({
        ...(mexeNaCategoria ? { categoriaId } : {}),
        ...(divisaoDestino ? { divisaoDestino } : {}),
        unidadeId,
      })),
      planilha: null,
    },
    ok: true,
  };
}

/** A linha que a tela leu do arquivo, com os cabeçalhos crus, nas chaves que a régua entende. */
function linhaDaPlanilhaNaChave(bruta: unknown): LinhaDaPlanilhaDeVinculo {
  if (!bruta || typeof bruta !== "object" || Array.isArray(bruta)) return {};
  const saida: LinhaDaPlanilhaDeVinculo = {};
  for (const [chaveCrua, valor] of Object.entries(bruta as Record<string, unknown>)) {
    // A chave exata vence; senão vale a MESMA régua de cabeçalho do CSV, porque a tela lê o xlsx no
    // navegador e manda os cabeçalhos como o operador os escreveu ("Quadra", "Gleba", "Categoria").
    const exata =
      chaveCrua === "categoria" ||
      chaveCrua === "codigo" ||
      chaveCrua === "divisao" ||
      chaveCrua === "lote" ||
      chaveCrua === "quadra";
    const chave = exata ? chaveCrua : chaveDaColunaDeVinculo(chaveCrua);
    if (chave && saida[chave] === undefined) saida[chave] = valor;
  }
  return saida;
}

/** Junta as mudanças por alvo e devolve a prévia de cada grupo. */
function montarPrevisao(
  mudancas: readonly MudancaPedida[],
  contexto: {
    categorias: readonly CategoriaDaFamilia[];
    divisoes: readonly DivisaoDaFamilia[];
    planilha: null | RelatorioDaPlanilhaDeVinculo;
    universo: readonly LinhaDoUniverso[];
  },
): PrevisaoDoVinculo {
  const nomeDaCategoria = new Map(contexto.categorias.map((c) => [c.id, c.nome]));
  const nomeDaDivisao = new Map(contexto.divisoes.map((d) => [d.enterpriseId, d.nome]));

  const porCategoria = new Map<string, string[]>();
  const porDivisao = new Map<string, string[]>();
  for (const m of mudancas) {
    if ("categoriaId" in m) {
      const chave = m.categoriaId ?? "";
      porCategoria.set(chave, [...(porCategoria.get(chave) ?? []), m.unidadeId]);
    }
    if (m.divisaoDestino) {
      porDivisao.set(m.divisaoDestino, [...(porDivisao.get(m.divisaoDestino) ?? []), m.unidadeId]);
    }
  }

  const categorias: PreviaDaCategoria[] = [...porCategoria.entries()].map(([chave, ids]) => {
    const categoriaId = chave || null;
    return {
      categoriaId,
      nome: categoriaId ? (nomeDaCategoria.get(categoriaId) ?? "categoria") : "sem categoria",
      previa: previaDoVinculo(ids, contexto.universo, { categoriaAlvo: categoriaId, nomeDaCategoria }),
    };
  });

  const divisoes: PreviaDaDivisao[] = [...porDivisao.entries()].map(([destino, ids]) => ({
    destino,
    nome: nomeDaDivisao.get(destino) ?? destino,
    plano: planoDeMudancaDeDivisao(ids, contexto.universo, {
      destino,
      divisoes: contexto.divisoes,
    }),
  }));

  const avisos = divisoes.flatMap((d) => d.plano.avisos);
  const recusas = divisoes.flatMap((d) => d.plano.recusas);
  const terrenos = categorias.reduce((n, c) => n + c.previa.terrenos, 0);
  // Os que de fato MUDAM: o escolhido menos o que já estava na categoria alvo.
  const mudam = categorias.reduce((n, c) => n + (c.previa.terrenos - c.previa.jaEstao), 0);

  const comVenda = categorias.reduce((n, c) => n + c.previa.vendaAndando, 0);
  if (comVenda > 0) {
    // ⚠️ ESTA FRASE FICOU FALSA EM 21/09/2026, e foi reescrita. Ela dizia que a categoria "muda
    // mesmo assim" porque *"a proposta já congelou as condições dela"* — era verdade quando a
    // categoria só escolhia PLANO DE PAGAMENTO. Desde a cadeia do contrato, a categoria decide a
    // MINUTA e os ANEXOS, e a cadeia é montada a partir de `hercules_unidades.categoria_id` NO
    // MOMENTO da geração (`cadeia-do-contrato.ts`). Trocar a categoria de um lote com proposta viva
    // e contrato ainda não gerado troca o texto e as peças que aquela venda vai imprimir. Medido na
    // mesma data: 2.604 propostas vivas, 290 em unidades do Lagoa Bonita, e 289 dessas 290 ainda
    // não têm linha em `hercules_documentos` — ou seja, o contrato delas ainda vai ser montado. A
    // tela tranquilizava exatamente quem deveria parar para conferir.
    avisos.push(
      `${comVenda === 1 ? "1 lote escolhido tem" : `${comVenda} lotes escolhidos têm`} venda em andamento. ` +
        "As condições já contratadas (entrada, parcelas, juros) NÃO mudam: a proposta congelou isso quando nasceu. " +
        "Mas o CONTRATO que ainda não foi gerado passa a sair pela minuta e pelos anexos da categoria nova.",
    );
  }

  return {
    avisos,
    categorias,
    divisoes,
    planilha: contexto.planilha,
    recusas,
    resumo: {
      linhas: categorias.reduce((n, c) => n + c.previa.ids.length, 0),
      movem: divisoes.reduce((n, d) => n + d.plano.mover.length, 0),
      /** Terrenos que MUDAM de categoria. É o que o painel do resultado conta. */
      mudam,
      /** Terrenos ESCOLHIDOS, incluindo os que já estavam na categoria. */
      terrenos,
    },
  };
}
