// AS POLÍTICAS COMERCIAIS DE UM PRODUTO, COMO O PORTAL AS MOSTRA — planos, faixas de prazo e
// categorias, só para leitura.
//
// Lucas (16/09/2026), desenhando o portal da Cecílio Rocha como réplica do Hércules: *"a Cecilio
// quem vai fazer e o proprio time deles (...) eles meio que vao andar sozinhos sem o time
// administrativo da Careli"*. O que fica com a Careli são os planos de pagamento: continuam
// cadastrados no Apolo, e o time da Cecílio precisa VÊ-LOS dentro de Produtos, com a *"escrita no
// plano investidor da disponibilidade do plano"* (a ressalva, migration 0168).
//
// ⚠️ O PORTAL MOSTRA O QUE A MESA DE VENDA VENDE, e não uma segunda leitura do cadastro. Por isso
// as três regras que a rota `incorporador/venda` aplica aos planos estão aqui, reusadas e não
// reescritas:
//
//   1. PANTEON ANTES DO C2X, POR EMPREENDIMENTO (`planosPreferindoOPanteon`): empreendimento com
//      plano em `temis_planos` não mostra os do legado; sem nenhum, mostra os slotados do C2X.
//   2. O MENOR RECORTE CONFIGURADO GANHA (`itensDoMenorRecorte`): categoria, depois o próprio
//      produto (filho), depois o pai. O pai não soma com o filho: se o filho tem plano, o do pai
//      não aparece.
//   3. A FAIXA DE PRAZO É A DO PRÓPRIO EMPREENDIMENTO, sem herdar do pai: é o que o simulador
//      recebe (`faixasDePrazo[enterpriseId]`, ver `faixa-no-formulario-do-plano.ts`).
//
// Uma tela que mostrasse "os planos do VOC e os do VLO" juntos anunciaria ao time da Cecílio seis
// planos onde a proposta só deixa escolher três, e foi exatamente esse o defeito que a régua única
// de recorte consertou na Mesa.
//
// ⚠️ NADA INTERNO SAI DAQUI. `observacao` (nota de quem cadastrou, "são de teste") e a minuta que o
// plano assina ficam no Apolo: não são selecionadas, então não há como vazarem por descuido na tela.

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ordenarParaAFolha,
  type PlanoComercial,
  rotuloDoPlano,
  type SistemaAmortizacao,
  type SlotDaPa,
  textoDaTaxa,
  textoDoSinal,
} from "@/lib/apolo/planos-comerciais";
import type { PlanosDoEmpreendimento } from "@/lib/apolo/planos-comerciais-c2x";
import {
  colunasComAsNovas,
  comoPlano,
  type LinhaDoPlano,
  type PlanoDoPanteon,
  planosPreferindoOPanteon,
  semAColunaQueFaltou,
} from "@/lib/hercules/planos-do-panteon";
import type { FaixaDePrazo } from "@/lib/hercules/premissa-do-prazo";
import {
  itensDoMenorRecorte,
  type OrigemDoRecorte,
} from "@/lib/hercules/recorte-da-unidade";
import { rotuloDoIndice, rotuloDoSistema } from "@/lib/temis/planos";

type Cliente = Pick<SupabaseClient, "from">;

const WORKSPACE = "careli";
const LOTE_DO_IN = 100;
const PAGINA = 1000;

// ── Tipos ─────────────────────────────────────────────────────────────────────

export type FonteDoPlano = "c2x" | "panteon";

/** O plano lido, antes de virar texto. Só a montagem usa; a tela recebe `PlanoDoPortal`. */
export type PlanoLido = {
  anuaisQuantidade: null | number;
  anuaisValor: null | number;
  categoriaId: null | string;
  /** O desconto do plano sobre a tabela (0178). Zero = sem desconto; o C2X não tem. */
  descontoPercentual: number;
  enterpriseId: string;
  entradaPercentual: number;
  fonte: FonteDoPlano;
  id: string;
  /** Texto, e não `IndiceCorrecao`: o código vem de `temis_indices`, que pode estar à frente do build. */
  indiceCorrecao: string;
  jurosPeriodicidade: "anual" | "mensal";
  jurosTaxa: null | number;
  nome: string;
  ordem: number;
  parcelas: number;
  ressalva: null | string;
  sistemaAmortizacao: SistemaAmortizacao;
  slot: null | SlotDaPa;
};

/** Um plano pronto para a tela: tudo já em português, nada para a tela calcular. */
export type PlanoDoPortal = {
  /** "5 anuais de R$ 25.000,00". Nulo = plano sem anual. */
  anuais: null | string;
  /**
   * "8% sobre a tabela". Nulo = plano sem desconto.
   *
   * ⚠️ O TIME DA CECÍLIO PRECISA VER O DESCONTO DO PLANO AQUI, porque é o preço dele: o Investidor
   * Parcelado do Garden vende a 92% da tabela, e sem esta linha a aba anunciaria o plano pelo preço
   * cheio que a Mesa não cobra.
   */
  desconto: null | string;
  /** "20%", ou "sem entrada". */
  entrada: string;
  fonte: FonteDoPlano;
  id: string;
  /** "IPCA anual", "sem correção". */
  indice: string;
  /** "8% a.a.", ou "sem juros". */
  juros: string;
  nome: string;
  /**
   * O nome com que o plano sai na folha da proposta ("INVESTIDOR"), quando é outro. Nulo quando o
   * plano não vai à folha ou quando o nome cadastrado já é esse.
   */
  nomeNaProposta: null | string;
  parcelas: number;
  /** A etiqueta âmbar ("válido para as próximas 16 unidades"). Nula = sem ressalva. */
  ressalva: null | string;
  /** "Tabela SACOC". */
  tabela: string;
  /** "amortização pura". */
  tabelaDetalhe: null | string;
};

/** Uma faixa de prazo em português. Nulo num campo = a faixa não opina sobre ele. */
export type FaixaDoPortal = {
  entrada: null | string;
  indice: null | string;
  juros: null | string;
  prazo: string;
};

export type CategoriaDoPortal = {
  /** A categoria de cima, quando esta é subcategoria. */
  dentroDe: null | string;
  id: string;
  nome: string;
  /**
   * Os planos PRÓPRIOS da categoria. Vazio = a unidade desta categoria segue os planos gerais do
   * produto, e a tela diz isso em vez de parecer que a categoria não tem plano nenhum.
   */
  planos: PlanoDoPortal[];
  /** Quantas unidades DESTE produto estão na categoria. */
  unidades: number;
};

export type BlocoDePoliticas = {
  categorias: CategoriaDoPortal[];
  /**
   * O C2X não respondeu e este produto dependia dele (não tem plano no Panteon). A tela avisa em vez
   * de dizer "nenhum plano cadastrado": falha técnica não pode virar afirmação de negócio.
   */
  consultaIncompleta: boolean;
  faixas: FaixaDoPortal[];
  /** De que degrau vieram os planos gerais. Nulo = nenhum plano. */
  origemDosPlanos: null | OrigemDoRecorte;
  planos: PlanoDoPortal[];
  /** Os produtos a que este bloco vale. Quase sempre um só. */
  produtos: { codigo: string; nome: string }[];
};

export type PoliticasDoProduto = {
  blocos: BlocoDePoliticas[];
  /** Nenhum plano, faixa ou categoria em bloco nenhum, e nenhuma consulta incompleta. */
  vazio: boolean;
};

/** Um empreendimento do recorte pedido, com o pai de quem ele herda. */
export type ProdutoDoRecorte = {
  codigo: string;
  enterpriseId: string;
  nome: string;
  /** O `c2x_enterprise_id` do pai no cadastro do Panteon. Nulo = não tem pai (ou é o próprio). */
  paiEnterpriseId: null | string;
};

/**
 * Uma linha de `temis_planos`. É o tipo da leitura do Panteon (`planos-do-panteon.ts`); o que o
 * portal pode ver é decidido pelo `select` de `lerPlanosDoPortal`, que não pede nada interno.
 */
export type LinhaDoPlanoDoPortal = LinhaDoPlano;

/** Uma linha de `temis_categorias`, só com o que o portal pode ver. */
export type LinhaDaCategoria = {
  ativa: boolean | null;
  categoria_pai_id: null | string;
  enterprise_id: string;
  id: string;
  nome: null | string;
  ordem: null | number;
};

/** Uma unidade com categoria: é o que decide se a categoria do PAI vale para este produto. */
export type UnidadeComCategoria = {
  categoria_id: null | string;
  enterprise_id: number | string;
};

// ── Linha do banco → plano ────────────────────────────────────────────────────

/**
 * O plano do Panteon, já normalizado por `comoPlano`, no formato da montagem.
 *
 * ⚠️ AQUI NÃO SE NORMALIZA NADA (16/09/2026). Esta função era `planoDaLinha`, uma segunda conversão
 * da linha de `temis_planos` com os mesmos tratamentos da Mesa (SACOC como padrão, slot estranho
 * vira nulo, anuais em par, ressalva limpa). Agora a conversão é UMA, a de `planos-do-panteon.ts`, e
 * isto só troca nomes: `fonte` e o índice DO CADASTRO (a tela mostra o código cru que o build ainda
 * não conhece, em vez de fingir "sem correção").
 */
export function planoLidoDoPanteon(plano: PlanoDoPanteon): PlanoLido {
  return {
    anuaisQuantidade: plano.anuaisQuantidade,
    anuaisValor: plano.anuaisValor,
    categoriaId: plano.categoriaId ?? null,
    descontoPercentual: plano.descontoPercentual,
    enterpriseId: plano.enterpriseId ?? "",
    entradaPercentual: plano.entradaPercentual,
    fonte: "panteon",
    id: plano.id ?? "",
    indiceCorrecao: plano.indiceDoCadastro,
    jurosPeriodicidade: plano.jurosPeriodicidade,
    jurosTaxa: plano.jurosTaxa,
    nome: plano.nome,
    ordem: plano.ordem,
    parcelas: plano.parcelas,
    ressalva: plano.ressalva,
    sistemaAmortizacao: plano.sistemaAmortizacao,
    slot: plano.slot,
  };
}

/**
 * Os planos slotados do C2X, no mesmo formato. Só entram quando o empreendimento não tem nenhum no
 * Panteon (regra 1 do topo). A ordem é a da folha (`ordenarParaAFolha`), porque é a única ordem que
 * o legado tem.
 */
export function planosDoC2xLidos(grupo: PlanosDoEmpreendimento): PlanoLido[] {
  return ordenarParaAFolha(grupo.planos).map((plano, indice) => ({
    anuaisQuantidade: null,
    anuaisValor: null,
    categoriaId: null,
    descontoPercentual: 0,
    enterpriseId: String(grupo.enterpriseId),
    entradaPercentual: plano.entradaPercentual,
    fonte: "c2x",
    id: `c2x:${grupo.enterpriseId}:${plano.slot ?? plano.nome}`,
    indiceCorrecao: plano.indiceCorrecao,
    jurosPeriodicidade: plano.jurosPeriodicidade,
    jurosTaxa: plano.jurosTaxa,
    nome: plano.nome,
    ordem: indice,
    parcelas: plano.parcelas,
    ressalva: null,
    sistemaAmortizacao: plano.sistemaAmortizacao,
    slot: plano.slot,
  }));
}

// ── Plano → texto ─────────────────────────────────────────────────────────────

const dinheiro = (valor: number): string =>
  valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

/**
 * Só para os formatadores de `planos-comerciais.ts` (taxa, sinal, rótulo da folha), que pedem um
 * `PlanoComercial` inteiro e leem três campos dele.
 *
 * ⚠️ O ÍNDICE AQUI NÃO É LIDO POR NINGUÉM, e por isso pode cair em SEM_CORRECAO quando o código é
 * desconhecido do build. O texto do índice sai de `rotuloDoIndice`, que mostra o código cru em vez
 * de fingir "sem correção".
 */
function paraOsFormatadores(plano: {
  entradaPercentual: number;
  jurosPeriodicidade: "anual" | "mensal";
  jurosTaxa: null | number;
  nome: string;
  parcelas: number;
  slot: null | SlotDaPa;
}): PlanoComercial {
  return {
    entradaPercentual: plano.entradaPercentual,
    indiceCorrecao: "SEM_CORRECAO",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: plano.jurosPeriodicidade,
    jurosTaxa: plano.jurosTaxa,
    nome: plano.nome,
    parcelas: plano.parcelas,
    sistemaAmortizacao: "sacoc",
    slot: plano.slot,
  };
}

/** Compara nomes sem caixa nem acento: "Investidor" e "INVESTIDOR" são o mesmo rótulo. */
function mesmoRotulo(a: string, b: string): boolean {
  const limpo = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  return limpo(a) === limpo(b);
}

/**
 * O índice como a tela escreve (`rotuloDoIndice`). Sem o build conhecer o código, o próprio código:
 * melhor um "TR_ANUAL" estranho do que um "sem correção" falso.
 */
const textoDoIndice = rotuloDoIndice;

export function planoParaATela(plano: PlanoLido): PlanoDoPortal {
  const formatavel = paraOsFormatadores(plano);
  // ⚠️ `rotuloDoSistema` ESCREVE "Tabela SACOC — amortização pura", com travessão, e o texto de tela
  // da casa não usa travessão. A frase é a mesma (a palavra "Tabela" é decisão do Lucas, ver lá); só
  // é partida em duas linhas em vez de reescrita aqui.
  const [tabela, ...detalhe] = rotuloDoSistema(plano.sistemaAmortizacao).split(" — ");
  const rotuloDaFolha = plano.slot ? rotuloDoPlano(formatavel) : null;

  return {
    anuais:
      plano.anuaisQuantidade && plano.anuaisValor
        ? `${plano.anuaisQuantidade} ${plano.anuaisQuantidade === 1 ? "anual" : "anuais"} de ${dinheiro(plano.anuaisValor)}`
        : null,
    desconto:
      plano.descontoPercentual > 0
        ? `${plano.descontoPercentual.toLocaleString("pt-BR", { maximumFractionDigits: 3 })}% sobre a tabela`
        : null,
    entrada: plano.entradaPercentual > 0 ? textoDoSinal(formatavel) : "sem entrada",
    fonte: plano.fonte,
    id: plano.id,
    indice: textoDoIndice(plano.indiceCorrecao),
    juros: textoDaTaxa(formatavel) || "sem juros",
    nome: plano.nome || rotuloDoPlano(formatavel),
    nomeNaProposta:
      rotuloDaFolha && !mesmoRotulo(rotuloDaFolha, plano.nome) ? rotuloDaFolha : null,
    parcelas: plano.parcelas,
    ressalva: plano.ressalva,
    tabela: tabela ?? plano.sistemaAmortizacao,
    tabelaDetalhe: detalhe.length ? detalhe.join(" — ") : null,
  };
}

/**
 * A faixa em português.
 *
 * ⚠️ "NÃO OPINA" É NULO, E "SEM JUROS" É TEXTO. É a distinção que `premissaDoPrazo` protege
 * (`defineJuros`): uma faixa que não fala de juros não quer dizer que o plano não tem juros, e a
 * tela escreve "segue o plano" para a primeira, nunca "sem juros".
 */
export function faixaParaATela(faixa: FaixaDePrazo): FaixaDoPortal {
  const periodicidade = faixa.jurosPeriodicidade === "anual" ? "anual" : "mensal";
  const formatavel = paraOsFormatadores({
    entradaPercentual: faixa.entradaPercentual ?? 0,
    jurosPeriodicidade: periodicidade,
    jurosTaxa: faixa.jurosTaxa,
    nome: "",
    parcelas: faixa.parcelaMaxima,
    slot: null,
  });

  const prazo =
    faixa.parcelaMinima === faixa.parcelaMaxima
      ? `${faixa.parcelaMinima} ${faixa.parcelaMinima === 1 ? "parcela" : "parcelas"}`
      : `${faixa.parcelaMinima} a ${faixa.parcelaMaxima} parcelas`;

  return {
    entrada:
      faixa.defineEntrada && faixa.entradaPercentual !== null
        ? faixa.entradaPercentual > 0
          ? textoDoSinal(formatavel)
          : "sem entrada"
        : null,
    indice:
      faixa.defineIndice && faixa.indiceCorrecao ? textoDoIndice(faixa.indiceCorrecao) : null,
    juros: faixa.defineJuros ? textoDaTaxa(formatavel) || "sem juros" : null,
    prazo,
  };
}

// ── A montagem ────────────────────────────────────────────────────────────────

/** A ordem do cadastro: `ordem`, e o prazo como desempate (a mesma da aba Planos do Apolo). */
function porOrdem(a: PlanoLido, b: PlanoLido): number {
  return a.ordem - b.ordem || a.parcelas - b.parcelas || a.id.localeCompare(b.id);
}

/**
 * Monta o que a aba de políticas do portal mostra.
 *
 * `planosDoC2x` NULO quer dizer "o C2X não respondeu", e é diferente de lista vazia ("respondeu, e
 * não há plano slotado"). Os dois pedem frases opostas na tela.
 */
export function montarPoliticasDoProduto(entrada: {
  categorias: readonly LinhaDaCategoria[];
  faixas: Readonly<Record<string, readonly FaixaDePrazo[]>>;
  planosDoC2x: null | readonly PlanosDoEmpreendimento[];
  planosDoPanteon: readonly PlanoLido[];
  produtos: readonly ProdutoDoRecorte[];
  unidades: readonly UnidadeComCategoria[];
}): PoliticasDoProduto {
  // Regra 1: a união por empreendimento, pela MESMA função da Mesa. Os grupos do Panteon são
  // montados aqui só para ela decidir; o que ela devolve é reconhecido pela referência do grupo,
  // para os planos voltarem com id, anuais e ressalva.
  const gruposDoPanteon = new Map<PlanosDoEmpreendimento, PlanoLido[]>();
  const porEmpreendimento = new Map<string, PlanoLido[]>();
  for (const plano of entrada.planosDoPanteon) {
    const lista = porEmpreendimento.get(plano.enterpriseId) ?? [];
    lista.push(plano);
    porEmpreendimento.set(plano.enterpriseId, lista);
  }
  for (const [enterpriseId, planos] of porEmpreendimento) {
    gruposDoPanteon.set(
      { code: "", enterpriseId, planos: planos.map(paraOsFormatadores), tabelaDoEmpreendimento: null },
      planos,
    );
  }

  const combinados: PlanoLido[] = planosPreferindoOPanteon(
    [...(entrada.planosDoC2x ?? [])],
    [...gruposDoPanteon.keys()],
  )
    .flatMap((grupo) => gruposDoPanteon.get(grupo) ?? planosDoC2xLidos(grupo))
    .sort(porOrdem);

  const comPlanoNoPanteon = new Set(porEmpreendimento.keys());
  const nomeDaCategoria = new Map(
    entrada.categorias.map((c) => [c.id, String(c.nome ?? "").trim()]),
  );

  // Quantas unidades de cada produto estão em cada categoria.
  const unidadesPorProduto = new Map<string, Map<string, number>>();
  for (const unidade of entrada.unidades) {
    const categoria = String(unidade.categoria_id ?? "").trim();
    if (!categoria) continue;
    const produto = String(unidade.enterprise_id).trim();
    const contagem = unidadesPorProduto.get(produto) ?? new Map<string, number>();
    contagem.set(categoria, (contagem.get(categoria) ?? 0) + 1);
    unidadesPorProduto.set(produto, contagem);
  }

  const blocos = new Map<string, BlocoDePoliticas>();

  for (const produto of entrada.produtos) {
    const recorte = {
      categoriaId: null,
      enterpriseId: produto.enterpriseId,
      paiEnterpriseId: produto.paiEnterpriseId,
    };

    // Regra 2: o degrau que vale para a unidade SEM categoria.
    const geral = itensDoMenorRecorte(recorte, combinados);

    // Regra 3: a faixa do próprio empreendimento.
    const faixas = [...(entrada.faixas[produto.enterpriseId] ?? [])]
      .sort((a, b) => a.parcelaMinima - b.parcelaMinima)
      .map(faixaParaATela);

    const contagem = unidadesPorProduto.get(produto.enterpriseId) ?? new Map<string, number>();
    const donos = new Set(
      [produto.enterpriseId, produto.paiEnterpriseId].filter((id): id is string => Boolean(id)),
    );

    const categorias = entrada.categorias
      .filter((c) => donos.has(String(c.enterprise_id).trim()))
      .map((c) => {
        const escolha = itensDoMenorRecorte({ ...recorte, categoriaId: c.id }, combinados);
        return {
          ativa: c.ativa !== false,
          dentroDe: c.categoria_pai_id ? (nomeDaCategoria.get(c.categoria_pai_id) ?? null) : null,
          doProprio: String(c.enterprise_id).trim() === produto.enterpriseId,
          id: c.id,
          nome: String(c.nome ?? "").trim() || "Categoria sem nome",
          ordem: Number(c.ordem) || 0,
          // Só os planos PRÓPRIOS: se a categoria não tem, a unidade dela cai nos gerais.
          planos: escolha.origem === "categoria" ? escolha.itens.map(planoParaATela) : [],
          unidades: contagem.get(c.id) ?? 0,
        };
      })
      // ⚠️ A CATEGORIA DO PAI SÓ APARECE SE TIVER UNIDADE DESTE PRODUTO. Ela atravessa os filhos
      // ("Condomínio" do Lagoa Bonita cobre lotes do LBF, do LBR e do LBP), e listar para o dono de
      // uma gleba uma categoria que só existe nas glebas dos outros é mostrar a divisão alheia. A do
      // próprio produto aparece se estiver ativa ou tiver plano, mesmo sem unidade ainda.
      .filter((c) =>
        c.doProprio ? c.ativa || c.planos.length > 0 || c.unidades > 0 : c.unidades > 0,
      )
      .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, "pt-BR"))
      .map(({ dentroDe, id, nome, planos, unidades }) => ({ dentroDe, id, nome, planos, unidades }));

    const bloco: BlocoDePoliticas = {
      categorias,
      consultaIncompleta:
        entrada.planosDoC2x === null && !comPlanoNoPanteon.has(produto.enterpriseId),
      faixas,
      origemDosPlanos: geral.origem,
      planos: geral.itens.map(planoParaATela),
      produtos: [{ codigo: produto.codigo, nome: produto.nome }],
    };

    // ⚠️ PRODUTOS QUE RESOLVEM IGUAL VIRAM UM BLOCO SÓ. Três glebas que herdam os mesmos planos do
    // pai mostrariam a mesma lista três vezes; a assinatura ignora só a contagem de unidades, que é
    // somada.
    const assinatura = JSON.stringify({
      c: bloco.categorias.map((c) => [c.id, c.planos.map((p) => p.id)]),
      f: bloco.faixas,
      i: bloco.consultaIncompleta,
      o: bloco.origemDosPlanos,
      p: bloco.planos.map((p) => p.id),
    });
    const existente = blocos.get(assinatura);
    if (!existente) {
      blocos.set(assinatura, bloco);
      continue;
    }
    existente.produtos.push(...bloco.produtos);
    existente.categorias.forEach((categoria, indice) => {
      categoria.unidades += bloco.categorias[indice]?.unidades ?? 0;
    });
  }

  const lista = [...blocos.values()];
  return {
    blocos: lista,
    vazio: lista.every(
      (b) =>
        !b.consultaIncompleta &&
        b.planos.length === 0 &&
        b.faixas.length === 0 &&
        b.categorias.length === 0,
    ),
  };
}

// ── As leituras ───────────────────────────────────────────────────────────────

const COLUNAS_DO_PLANO =
  "id,enterprise_id,categoria_id,nome,parcelas,entrada_percentual,juros_taxa,juros_periodicidade,indice_correcao,sistema_amortizacao,slot,ordem,anuais_quantidade,anuais_valor";

function emLotes(ids: readonly string[]): string[][] {
  const unicos = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))];
  const lotes: string[][] = [];
  for (let de = 0; de < unicos.length; de += LOTE_DO_IN) {
    lotes.push(unicos.slice(de, de + LOTE_DO_IN));
  }
  return lotes;
}

/**
 * Os planos ATIVOS de `temis_planos` destes empreendimentos (ids do C2X).
 *
 * ⚠️ LANÇA EM FALHA, em vez de devolver vazio: "nenhum plano cadastrado" a partir de um timeout é
 * afirmação de negócio feita por falha técnica. A rota responde 503.
 *
 * ⚠️ A RESSALVA PODE AINDA NÃO EXISTIR (migration 0168 pendente): o primeiro erro que for DELA faz a
 * leitura seguir sem a coluna, e a tela mostra os planos sem etiqueta. Qualquer outro erro lança.
 * O DESCONTO (0178) tem a mesma tolerância: sem a coluna, o plano aparece sem desconto.
 */
export async function lerPlanosDoPortal(
  cliente: Cliente,
  enterpriseIds: readonly string[],
): Promise<PlanoLido[]> {
  const linhas: LinhaDoPlanoDoPortal[] = [];
  let novas = { desconto: true, ressalva: true };

  for (const lote of emLotes(enterpriseIds)) {
    for (let de = 0; ; ) {
      const { data, error } = await cliente
        .from("temis_planos")
        .select(colunasComAsNovas(COLUNAS_DO_PLANO, novas))
        .eq("workspace_id", WORKSPACE)
        .eq("ativo", true)
        .in("enterprise_id", lote)
        .order("ordem", { ascending: true })
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);

      const semElas = error ? semAColunaQueFaltou(error, novas) : null;
      if (semElas) {
        novas = semElas;
        continue;
      }
      if (error) throw new Error(error.message);

      const pagina = (data ?? []) as unknown as LinhaDoPlanoDoPortal[];
      linhas.push(...pagina);
      if (pagina.length < PAGINA) break;
      de += PAGINA;
    }
  }

  return linhas.map((linha) => planoLidoDoPanteon(comoPlano(linha)));
}

/** As categorias destes empreendimentos, ativas ou não (a montagem decide o que aparece). Lança em falha. */
export async function lerCategoriasDoPortal(
  cliente: Cliente,
  enterpriseIds: readonly string[],
): Promise<LinhaDaCategoria[]> {
  const linhas: LinhaDaCategoria[] = [];

  for (const lote of emLotes(enterpriseIds)) {
    const { data, error } = await cliente
      .from("temis_categorias")
      .select("id,enterprise_id,nome,ordem,ativa,categoria_pai_id")
      .eq("workspace_id", WORKSPACE)
      .in("enterprise_id", lote)
      .order("ordem", { ascending: true });

    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as LinhaDaCategoria[]));
  }

  return linhas;
}

/**
 * As unidades COM categoria destes empreendimentos: só `enterprise_id` e `categoria_id`.
 *
 * ⚠️ PAGINA, porque um produto grande passa de mil unidades e o PostgREST corta em 1.000 sem erro:
 * a contagem de uma categoria sairia menor, e a do pai poderia sumir da tela por "não ter unidade".
 * Lança em falha: sem a contagem, a montagem não tem como esconder a categoria das glebas alheias.
 */
export async function lerUnidadesComCategoria(
  cliente: Cliente,
  enterpriseIds: readonly string[],
): Promise<UnidadeComCategoria[]> {
  const linhas: UnidadeComCategoria[] = [];

  for (const lote of emLotes(enterpriseIds)) {
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await cliente
        .from("hercules_unidades")
        .select("id,enterprise_id,categoria_id")
        .eq("workspace_id", WORKSPACE)
        .in("enterprise_id", lote)
        .not("categoria_id", "is", null)
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);

      if (error) throw new Error(error.message);
      const pagina = (data ?? []) as UnidadeComCategoria[];
      linhas.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
  }

  return linhas;
}
