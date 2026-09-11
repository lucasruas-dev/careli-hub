// AS CONDIÇÕES COMERCIAIS DA ETAPA 1 — a proposta que o operador confere antes de abrir o contrato.
//
// Lucas (10/09/2026): *"a primeira tela tinha que trazer a proposta comercial não veio"*.
//
// ⚠️ SAI DO CRONOGRAMA CONGELADO, E NÃO DE UMA CONTA NOVA. `hercules_propostas.condicoes` é a foto
// do que o PDF da proposta imprimiu e o cliente leu — a mesma regra que `dados-do-contrato.ts` já
// segue para entrada e financiado ("recalcular aqui faria o contrato discordar do papel"). Uma
// conta refeita na tela passaria a divergir do papel no dia em que o plano do empreendimento
// mudar, e quem confere estaria conferindo contra outro documento.
//
// ⚠️ E OS RÓTULOS SÃO OS DA FOLHA DA PROPOSTA (`lib/hercules/proposta-para-pdf.ts`), de propósito.
// Quem analisa na Têmis confere contra o papel que o comprador recebeu; dois vocabulários para o
// mesmo número obrigam a traduzir de cabeça, e é traduzindo de cabeça que se erra.
import type { SupabaseClient } from "@supabase/supabase-js";

import type { ModoDoAjuste } from "@/lib/hercules/ajuste-de-preco";
import type { Cronograma, ParcelaDoCronograma } from "@/lib/hercules/cronograma";

import { periodicidadeDaTaxa } from "@/lib/apolo/periodicidade-da-taxa";

/** Um dos números grandes do topo: rótulo pequeno, valor forte, e uma linha de contexto. */
export type DestaqueComercial = {
  /** "R$ 414,29 por m²", "10% · 2× de R$ 7.250,00". Vazio = sem linha de contexto. */
  detalhe: string;
  rotulo: string;
  valor: string;
};

/** Uma linha da tabela de condições: o que foi combinado, em texto. */
export type CondicaoComercial = {
  /** `true` quando o dado não existe na proposta. A tela pinta como pendência. */
  faltando: boolean;
  rotulo: string;
  valor: string;
};

/** O que foi abatido (ou acrescido) sobre a tabela, com as duas medidas que a análise precisa. */
export type DescontoDaProposta = {
  /** `true` quando o preço SUBIU. É legítimo, e é outra conversa — não é desconto. */
  acrescimo: boolean;
  /** "3,33%" — sempre calculado sobre a tabela congelada, não sobre a de hoje. */
  emPercentual: string;
  /** "R$ 5.000,00" — sem sinal; quem diz a direção é `acrescimo`. */
  emReais: string;
  /**
   * Em que moeda o coordenador PENSOU o desconto.
   *
   * ⚠️ IMPORTA NA ANÁLISE. 5% e R$ 7.500 dão o mesmo número num lote de R$ 150.000, mas só um dos
   * dois foi o combinado — e quem aprova desconto pensa em percentual, quem fecha pensa em reais.
   */
  modo: ModoDoAjuste;
  /** "R$ 150.000,00" — a tabela no dia em que a proposta nasceu. */
  tabela: string;
};

export type ComercialDaAnalise = {
  condicoes: CondicaoComercial[];
  destaques: DestaqueComercial[];
  /**
   * O desconto que foi dado nesta venda. `null` quando não houve, ou quando a proposta é anterior
   * à 0151 e não congelou a tabela.
   *
   * ⚠️ SAI DA PRÓPRIA PROPOSTA, E NÃO DE UMA COMPARAÇÃO COM O CADASTRO. Comparar
   * `hercules_propostas.valor` com `hercules_unidades.preco_tabela` é uma TAUTOLOGIA: a carga
   * inicial escreveu o mesmo número nos dois lados (`importar-fluxo-de-venda.mjs`, "u.price as
   * valor"), e medido em 10/09/2026, 4.856 das 4.863 propostas batem ao centavo. E ler o cadastro
   * na hora de analisar faria o passado mudar toda vez que alguém corrigisse o preço do lote — a
   * proposta de agosto "ganharia desconto" porque o preço subiu em outubro.
   *
   * ⚠️ NADA DISSO OLHA O LEGADO. Lucas (10/09/2026): *"já cansei de falar que não vamos usar o
   * legado mais como referência"*. A tabela e o ajuste ficam congelados na proposta, no Panteon,
   * desde a 0151.
   */
  desconto: DescontoDaProposta | null;
  /** Tudo que o comprador desembolsa. `null` quando o cronograma não tem totais. */
  total: null | string;
};

const MOEDA = new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" });

function reais(valor: number): string {
  return MOEDA.format(Number.isFinite(valor) ? valor : 0);
}

function numero(valor: unknown): null | number {
  if (typeof valor === "number") return Number.isFinite(valor) ? valor : null;
  if (typeof valor === "string" && valor.trim()) {
    const n = Number(valor);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** `2026-11-10` → `10/11/2026`. Vazio quando não há data. */
function dataBR(iso: null | string | undefined): string {
  const bruto = String(iso ?? "").trim();
  // ⚠️ FATIA A STRING, NÃO CONSTRÓI `Date`. `new Date("2026-11-10")` é meia-noite UTC, que em
  // Brasília (−03:00) é o dia 9 — a primeira parcela sairia um dia antes da combinada.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "";
}

function porcentagem(valor: number): string {
  const texto = valor.toLocaleString("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  });
  return `${texto}%`;
}

/**
 * "1× à vista em 10/10/2026" · "2× de R$ 7.250,00".
 *
 * Espelha `comoSeAnunciaAEntrada` da folha da proposta: uma parcela se anuncia pela data, várias
 * pelo valor de cada uma.
 */
function comoSeAnunciaAEntrada(entrada: ParcelaDoCronograma[]): string {
  if (entrada.length === 0) return "sem entrada";
  if (entrada.length === 1) {
    const quando = dataBR(entrada[0]?.vencimento);
    return quando ? `1× em ${quando}` : "1×";
  }
  return `${entrada.length}× de ${reais(entrada[0]?.valor ?? 0)}`;
}

/** O último vencimento de todas as séries — a data em que o contrato acaba. */
function ultimoVencimento(c: Cronograma): string {
  const todas = [...c.entrada, ...c.mensais, ...c.anuais].map((p) => p.vencimento).filter(Boolean);
  return todas.length > 0 ? todas.sort().at(-1) ?? "" : "";
}

function condicao(rotulo: string, valor: string): CondicaoComercial {
  const limpo = valor.trim();
  return { faltando: !limpo, rotulo, valor: limpo || "não informado" };
}

type LinhaDaProposta = {
  ajuste_modo: null | string;
  ajuste_valor: null | number | string;
  condicoes: unknown;
  contrato_parcelas: null | number;
  dia_vencimento: null | number | string;
  plano_correcao: null | string;
  plano_juros: null | number | string;
  plano_nome: null | string;
  plano_parcelas: null | number;
  preco_tabela: null | number | string;
  unidade_id: null | string;
  valor: null | number | string;
};

/** O cronograma gravado, com as três séries garantidas como array. */
function cronogramaGravado(bruto: unknown): Cronograma | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const c = bruto as Partial<Cronograma>;
  const serie = (v: unknown): ParcelaDoCronograma[] =>
    Array.isArray(v) ? (v as ParcelaDoCronograma[]) : [];
  return {
    anuais: serie(c.anuais),
    entrada: serie(c.entrada),
    mensais: serie(c.mensais),
    reajustes: Array.isArray(c.reajustes) ? c.reajustes : [],
    totais: {
      anuais: numero(c.totais?.anuais) ?? 0,
      entrada: numero(c.totais?.entrada) ?? 0,
      financiado: numero(c.totais?.financiado) ?? 0,
      geral: numero(c.totais?.geral) ?? 0,
      mensais: numero(c.totais?.mensais) ?? 0,
    },
  };
}

/**
 * A proposta comercial da etapa 1.
 *
 * `null` quando a proposta não existe ou não tem cronograma gravado — o caso das 4.857 importadas
 * do C2X, que nasceram sem `condicoes`. A tela mostra o que sabe (o bloco de campos da análise) e
 * diz que o fluxo de pagamento não foi gravado, em vez de desenhar uma tabela com zeros.
 */
export async function comercialDaProposta(
  sb: SupabaseClient,
  propostaId: string,
): Promise<ComercialDaAnalise | null> {
  const { data } = await sb
    .from("hercules_propostas")
    .select(
      "ajuste_modo, ajuste_valor, condicoes, contrato_parcelas, dia_vencimento, plano_correcao, plano_juros, plano_nome, plano_parcelas, preco_tabela, unidade_id, valor",
    )
    .eq("id", propostaId)
    .maybeSingle();

  const proposta = data as LinhaDaProposta | null;
  if (!proposta) return null;

  const cronograma = cronogramaGravado(proposta.condicoes);
  if (!cronograma) return null;

  const negociado = numero(proposta.valor) ?? 0;

  // ⚠️ SÓ A ÁREA VEM DA UNIDADE. O preço de tabela agora sai da PRÓPRIA proposta (`preco_tabela`,
  // congelado na 0151): a área de um lote não muda, o preço dele muda toda semana.
  let area: null | number = null;
  if (proposta.unidade_id) {
    const { data: u } = await sb
      .from("hercules_unidades")
      .select("area")
      .eq("id", proposta.unidade_id)
      .maybeSingle();
    area = numero((u as { area?: unknown } | null)?.area);
  }

  const primeiraMensal = cronograma.mensais[0] ?? null;
  const primeiraDeTodas = cronograma.entrada[0] ?? primeiraMensal;

  // ── OS DESTAQUES ──
  const destaques: DestaqueComercial[] = [
    {
      detalhe: area && area > 0 ? `${reais(negociado / area)} por m²` : "",
      rotulo: "Valor da unidade",
      valor: reais(negociado),
    },
    {
      // A % da entrada sai do que foi negociado de verdade (entrada ÷ valor), e não da % sugerida
      // pelo plano: é o número que o comprador vai pagar.
      detalhe: `${
        negociado > 0 ? `${porcentagem((cronograma.totais.entrada / negociado) * 100)} · ` : ""
      }${comoSeAnunciaAEntrada(cronograma.entrada)}`,
      rotulo: "Entrada",
      valor: reais(cronograma.totais.entrada),
    },
    {
      detalhe: `${cronograma.mensais.length} mensais${
        cronograma.anuais.length > 0 ? ` + ${cronograma.anuais.length} anuais` : ""
      }`,
      rotulo: "Financiado",
      valor: reais(cronograma.totais.financiado),
    },
  ];

  // ⚠️ SEM SÉRIE MENSAL O DESTAQUE SOME, em vez de imprimir "R$ 0,00" — entrada de 100% é venda à
  // vista, é legítima, e uma parcela zerada no meio da tela parece defeito do sistema.
  if (primeiraMensal) {
    destaques.push({
      detalhe: `1ª em ${dataBR(primeiraMensal.vencimento)}`,
      rotulo: "Parcela mensal",
      valor: reais(primeiraMensal.valor),
    });
  }

  // ── AS CONDIÇÕES ──
  const juros = numero(proposta.plano_juros) ?? 0;
  const correcao = String(proposta.plano_correcao ?? "").trim();

  const condicoes: CondicaoComercial[] = [
    condicao("Plano", String(proposta.plano_nome ?? "").trim()),
    // ⚠️ O PRAZO É O DO CONTRATO, NUNCA `plano_parcelas`: aquele é o tamanho do MOLDE, que serve
    // centenas de vendas. Foi o molde no lugar do contrato que estampou "144x" no extrato de um
    // contrato de 62 parcelas.
    condicao(
      "Parcelas mensais",
      String(proposta.contrato_parcelas ?? (cronograma.mensais.length || "")),
    ),
  ];

  if (cronograma.anuais.length > 0) {
    // Só entra quando existe: "Parcelas anuais: 0" faz quem lê procurar do que se trata.
    condicoes.push(
      condicao(
        "Parcelas anuais",
        `${cronograma.anuais.length} de ${reais(cronograma.anuais[0]?.valor ?? 0)}`,
      ),
    );
  }

  // ⚠️ A CORREÇÃO SAI DO CRONOGRAMA, NÃO DA COLUNA `plano_correcao` — e isto foi medido, não
  // suposto. A proposta do Otavio (TST Q01 L03) tem `plano_correcao` NULO e mesmo assim 10 faixas
  // de reajuste com `temIpca`, levando a parcela de R$ 1.012,50 a R$ 1.954,32 em dez anos. Ler a
  // coluna faria a tela de análise escrever "sem correção" num contrato que quase dobra a parcela
  // — exatamente o erro que esta tela existe para impedir. O cronograma é a foto do que o cliente
  // leu; a coluna é preenchimento de cadastro, e nas propostas nativas ela vem vazia.
  const temReajuste = cronograma.reajustes.some((f) => f.temIpca);
  const nomeDoIndice = correcao
    ? (() => {
        // A sigla mantém a caixa alta (IPCA, INCC); o resto não grita.
        const [sigla, ...resto] = correcao.split(/\s+/);
        return [sigla, ...resto.map((w) => w.toLocaleLowerCase("pt-BR"))].join(" ");
      })()
    : "";

  condicoes.push(
    condicao("Primeira parcela", dataBR(primeiraDeTodas?.vencimento)),
    condicao("Última parcela", dataBR(ultimoVencimento(cronograma))),
    condicao(
      "Vencimento",
      proposta.dia_vencimento ? `todo dia ${proposta.dia_vencimento}` : "",
    ),
    // ⚠️ SEM TAXA GRAVADA, A TELA DIZ QUE NÃO SABE — e não "sem juros". Afirmar ausência de juros
    // a partir de uma coluna vazia é a mesma classe de erro da correção acima, e num contrato de
    // dez anos custa caro. Marcado como pendência, alguém confere; escrito como "sem juros",
    // ninguém confere nunca.
    //
    // ⚠️ E A TAXA DO LEGADO NÃO DIZ A UNIDADE: chutar "a.a." erra num terço dos contratos — o mesmo
    // banco guarda 8,0 (ao ano) e 0,7207 (ao mês). A régua é `periodicidadeDaTaxa`, importada da
    // mesa de venda e não copiada.
    condicao(
      "Juros",
      juros > 0
        ? `${porcentagem(juros)} ${periodicidadeDaTaxa(juros) === "anual" ? "a.a." : "a.m."}`
        : "",
    ),
    condicao(
      "Correção",
      temReajuste
        ? `${nomeDoIndice || "índice não gravado"} · ${cronograma.reajustes.length} ciclos`
        : "sem correção",
    ),
  );

  // ⚠️ A PARCELA QUE CRESCE PRECISA APARECER INTEIRA. O destaque mostra a PRIMEIRA mensal, que é a
  // menor de todas quando há reajuste — mostrar só ela deixaria o operador analisar um contrato de
  // R$ 1.012,50 que na verdade termina em R$ 1.954,32.
  const ultimaMensal = cronograma.mensais.at(-1) ?? null;
  if (temReajuste && primeiraMensal && ultimaMensal && ultimaMensal.valor > primeiraMensal.valor) {
    condicoes.push(
      condicao(
        "Parcela ao fim",
        `${reais(primeiraMensal.valor)} → ${reais(ultimaMensal.valor)}`,
      ),
    );
  }

  return {
    condicoes,
    desconto: descontoDaProposta(proposta, negociado),
    destaques,
    total: cronograma.totais.geral > 0 ? reais(cronograma.totais.geral) : null,
  };
}

/**
 * O desconto desta venda, a partir do que a PRÓPRIA proposta congelou.
 *
 * ⚠️ EXIGE AS DUAS PONTAS: a tabela do dia e o ajuste registrado. Sem tabela não há sobre o que
 * calcular percentual; sem ajuste, a diferença entre tabela e negociado pode ser qualquer coisa
 * (a carga do C2X escreveu o mesmo número nos dois lados, e as propostas anteriores à 0151 não
 * têm nenhum dos dois). Preferir silêncio a um desconto inventado: um alerta errado ensina o
 * operador a ignorar todos.
 *
 * ⚠️ E O VALOR EM REAIS SAI DA SUBTRAÇÃO, não do `ajuste_valor`. No modo percentual o registrado é
 * "-5", que não é dinheiro; a diferença medida entre tabela e negociado é o que o comprador de
 * fato deixou de pagar, já com o arredondamento em centavos que a proposta aplicou.
 */
export function descontoDaProposta(
  proposta: Pick<LinhaDaProposta, "ajuste_modo" | "ajuste_valor" | "preco_tabela">,
  negociado: number,
): DescontoDaProposta | null {
  const modo = String(proposta.ajuste_modo ?? "").trim();
  if (modo !== "percentual" && modo !== "reais") return null;

  const tabela = numero(proposta.preco_tabela);
  if (tabela === null || tabela <= 0 || negociado <= 0) return null;

  const diferenca = negociado - tabela;
  if (Math.abs(diferenca) < 0.01) return null;

  return {
    acrescimo: diferenca > 0,
    emPercentual: porcentagem(Math.abs((diferenca / tabela) * 100)),
    emReais: reais(Math.abs(diferenca)),
    modo,
    tabela: reais(tabela),
  };
}
