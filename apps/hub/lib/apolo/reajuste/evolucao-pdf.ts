import {
  abrirDocumento,
  alturaDeParagrafos,
  cabecalhoTimbrado,
  type Cartao,
  desenharCartoes,
  desenharRodapes,
  desenharTabelaLimpa,
  dinheiro,
  garantirEspaco,
  paragrafo,
  sanitizarNomeDeArquivo,
  tituloDeSecao,
  topico,
} from "@/lib/apolo/pdf-timbrado";
import { type CenarioDeProjecao } from "@/lib/apolo/reajuste/projecao";
import { type EvolucaoDoContrato } from "@/lib/apolo/reajuste/projecao-do-contrato";
import { type LinhaDoQuadro, type QuadroAnual } from "@/lib/apolo/reajuste/quadro-anual";

// A EVOLUÇÃO DA PARCELA EM PDF TIMBRADO — o quadro do contrato, nos três cenários.
//
// Lucas (23/09/2026): *"agora falta criar o relatório em PDF igual temos os outros"*; (24/09):
// *"pode fazer as três visões em um relatório só"*, *"podemos dividir pelas visões, ter um quadro
// otimista, tendência, conservador"* e *"trazer o quadro desde a primeira parcela, aplicar os juros e
// apontar o crescimento do juros e da correção"*.
//
// ⚠️ MESMA APURAÇÃO DA TELA: o PDF desenha o `QuadroAnual` que `projecao-do-contrato.ts` montou, e
// não refaz conta nenhuma. A regra (a da Lavra: índice + juros em soma simples, na curva SACOC da
// casa, no aniversário do contrato) está escrita em `quadro-anual.ts`.
//
// ⚠️ UM QUADRO POR CENÁRIO, cada um do primeiro ao último ano. Os anos já apurados são IGUAIS nos
// três (índice publicado); só os estimados divergem. Três quadros deixam isso visível: o leitor vê
// onde termina o fato e começa a faixa. Quando NENHUM ano é estimado (contrato sem correção, ou que
// já passou por todos os aniversários), os três seriam idênticos, e sai um quadro só, dizendo por quê.
//
// ⚠️ ESTE PAPEL PODE CHEGAR AO CLIENTE: o ano estimado vem marcado com asterisco, a premissa de cada
// cenário vai escrita, e o rodapé de TODA página diz que é a conta do contrato e que o valor devido é
// o do boleto — a folha circula solta, e a página 2 sozinha não pode virar promessa.
//
// ⚠️ O QUE FICOU DE FORA, DE PROPÓSITO: o valor que a cobrança lançou e os degraus que já aconteceram
// no caixa. Lucas (24/09/2026): *"não quero saber se recebemos ou não esses valores"*. Misturar o
// caixa com a conta do contrato poria dois números para a mesma parcela na mesma folha.

const TITULO_DA_PECA = "Evolução da Parcela";

const ORDEM: CenarioDeProjecao[] = ["otimista", "tendencia", "conservador"];

const NOME_DO_CENARIO: Record<CenarioDeProjecao, string> = {
  conservador: "Cenário conservador",
  otimista: "Cenário otimista",
  tendencia: "Cenário tendência",
};

const JANELA_DO_CENARIO: Record<CenarioDeProjecao, string> = {
  conservador: "média de 10 anos do índice, com folga para cima",
  otimista: "média dos últimos 3 anos do índice, com folga para baixo",
  tendencia: "média dos últimos 5 anos do índice",
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Tamanho do texto que abre cada quadro. */
const TAMANHO_DA_PREMISSA = 8.2;

/** "AAAAMM" -> "ago/25". Curto de propósito: o período ocupa duas datas na mesma célula. */
function mesCurto(aaaamm: string): string {
  return `${MESES[Number(aaaamm.slice(4, 6)) - 1] ?? "?"}/${aaaamm.slice(2, 4)}`;
}

function percentual(valor: number, casas = 2): string {
  return `${valor.toFixed(casas).replace(".", ",")}%`;
}

/**
 * A célula da correção.
 *
 * ⚠️ COM SINAL. O teste antigo era `correcao > 0`, e a correção NEGATIVA (o IGP-M acumulou 12 meses
 * abaixo de zero entre 2023 e 2024) caía no "-": a linha não fechava com a parcela, e o índice sumia.
 */
function correcaoDaLinha(linha: LinhaDoQuadro): string {
  if (linha.origem === "indisponivel") return "não calculada";
  if (linha.origem === "sem-correcao") return "sem correção";
  if (linha.origem === "sem-reajuste") return "-";
  return `${dinheiro(linha.correcao)} (${percentual(linha.indicePct)})`;
}

export type DadosDaEvolucaoPdf = {
  cenario: string;
  cliente: { documentoMascarado: null | string; nome: null | string };
  contratos: EvolucaoDoContrato[];
  /** 'YYYY-MM-DD' da apuração. */
  posicaoEm: string;
};

export async function montarEvolucaoPdf(dados: DadosDaEvolucaoPdf): Promise<Uint8Array> {
  const ctx = await abrirDocumento(TITULO_DA_PECA);

  await cabecalhoTimbrado(ctx, {
    contexto: `Posição em ${dados.posicaoEm.split("-").reverse().join("/")}`,
    titulo: TITULO_DA_PECA,
  });

  ctx.y -= 6;
  paragrafo(
    ctx,
    `Titular: ${dados.cliente.nome ?? "-"}${
      dados.cliente.documentoMascarado ? ` (${dados.cliente.documentoMascarado})` : ""
    }`,
    { size: 8 },
  );

  ctx.y -= 4;
  paragrafo(
    ctx,
    "Este relatório mostra a evolução da parcela do contrato, do primeiro ao último ano, separando " +
      "o que é amortização, o que é juros e o que é correção pelo índice. Os anos já apurados usam o " +
      "índice publicado; os seguintes são estimados em três cenários, do mais otimista ao mais " +
      "conservador, porque o índice futuro é uma faixa e não um número.",
    { justificado: true, size: 8.2 },
  );

  for (const contrato of dados.contratos) {
    desenharContrato(ctx, contrato);
  }

  ctx.y -= 8;
  tituloDeSecao(ctx, "Como a parcela é calculada");
  topico(
    ctx,
    "No primeiro ano do contrato a parcela é a amortização: o valor financiado dividido pelo " +
      "número de parcelas.",
  );
  topico(
    ctx,
    "A cada aniversário do contrato, a taxa do ano é o índice de correção acumulado dos 12 meses " +
      "até o aniversário somado aos juros do contrato. Na tabela SACOC, a parcela passa a cobrar os " +
      "juros teóricos do ano anterior, e fica fixa até o próximo aniversário.",
  );
  topico(
    ctx,
    "Na tabela PRICE os juros já estão dentro da parcela desde o início, e o aniversário aplica " +
      "apenas a correção pelo índice.",
  );
  topico(
    ctx,
    "Os anos marcados com asterisco (*) usam um índice estimado, conforme o cenário. O índice real " +
      "pode vir acima ou abaixo, e o valor devido de cada parcela é sempre o do boleto.",
  );

  desenharRodapes(
    ctx.doc,
    ctx.font,
    "Conta do contrato, com índice estimado nos anos futuros. O valor devido de cada parcela é o do boleto.",
  );
  return ctx.doc.save();
}

function desenharContrato(ctx: Ctx, contrato: EvolucaoDoContrato): void {
  ctx.y -= 10;
  garantirEspaco(ctx, 120);
  tituloDeSecao(ctx, `${contrato.empreendimento ?? "Contrato"} · ${contrato.codigo}`);

  const ehPrice = contrato.sistema === "price";
  const juros = contrato.jurosAnualPct;
  const cartoes: Cartao[] = [
    {
      // Na PRICE a parcela de origem já traz juros: chamá-la de amortização seria mentir no papel.
      apoio: ehPrice ? "parcela do 1º ano, já com juros" : "a amortização, parcela do 1º ano",
      icone: "igual",
      rotulo: "Valor de contrato",
      valor: dinheiro(contrato.mensalidadeBase),
    },
    {
      apoio: ehPrice ? "PRICE: juros já na parcela" : "SACOC: juros + índice no aniversário",
      icone: "moeda",
      rotulo: "Juros do contrato",
      valor: ehPrice ? "na parcela" : juros == null ? "não registrado" : `${percentual(juros)} a.a.`,
    },
    {
      apoio:
        contrato.indiceNoAno != null
          ? `${percentual(contrato.indiceNoAno)} nos últimos 12 meses`
          : "índice de correção",
      icone: "relogio",
      rotulo: "Correção do contrato",
      valor: contrato.indiceDoContrato ?? "não registrada",
    },
  ];
  desenharCartoes(ctx, cartoes);

  if (contrato.motivo) {
    ctx.y -= 6;
    paragrafo(ctx, contrato.motivo, { size: 8 });
  }

  const quadros = contrato.quadros;
  if (!quadros) return;

  const temEstimativa = ORDEM.some((cenario) =>
    quadros[cenario]?.linhas.some((linha) => linha.origem === "estimado"),
  );
  if (!temEstimativa) {
    desenharQuadro(ctx, contrato, quadros.tendencia, null);
    return;
  }
  for (const cenario of ORDEM) {
    const quadro = quadros[cenario];
    if (quadro) desenharQuadro(ctx, contrato, quadro, cenario);
  }
}

/**
 * Um quadro, precedido da premissa dele.
 *
 * ⚠️ O QUADRO NÃO SE PARTE. `desenharTabelaLimpa` reserva espaço linha a linha, e com três quadros
 * por contrato a linha de total caía sozinha no topo da página seguinte, sem cabeçalho e sem o nome
 * do cenário (medido em 24/09/2026 com dois contratos de 120 meses): o leitor a atribuía ao cenário
 * que vinha logo abaixo. Reservar a altura do bloco inteiro antes de começar leva o quadro todo para
 * a página nova, e o maior deles (240 meses, 21 linhas) cabe folgado numa página.
 */
function desenharQuadro(
  ctx: Ctx,
  contrato: EvolucaoDoContrato,
  quadro: QuadroAnual,
  cenario: CenarioDeProjecao | null,
): void {
  const ehPrice = quadro.sistema === "price";
  const semCorrecao = quadro.linhas.some((linha) => linha.origem === "sem-correcao");
  const taxa = cenario ? contrato.mesTipicoPorCenario?.[cenario] : null;
  const premissa = cenario
    ? `${NOME_DO_CENARIO[cenario]}: nos anos estimados (*), ${
        taxa != null ? `${percentual(taxa)} ao mês` : "a média"
      } de ${contrato.indice ?? "índice"}, ${JANELA_DO_CENARIO[cenario]}.`
    : semCorrecao
      ? "O contrato não tem correção monetária, então o quadro é o mesmo em qualquer cenário."
      : "Todos os anos deste contrato usam o índice já publicado, então o quadro é o mesmo em qualquer cenário.";

  ctx.y -= 10;
  const alturaDoBloco =
    alturaDeParagrafos([premissa], ctx.font, TAMANHO_DA_PREMISSA) +
    4 + // respiro entre a premissa e a tabela
    15 + // cabeçalho da tabela
    quadro.linhas.length * 11.5 +
    22 + // linha de total
    8; // folga
  garantirEspaco(ctx, alturaDoBloco);

  paragrafo(ctx, premissa, { size: TAMANHO_DA_PREMISSA });

  ctx.y -= 4;
  desenharTabelaLimpa(ctx, {
    colunas: [
      { label: "Período", peso: 0.2 },
      { align: "right", label: "Parcelas", peso: 0.1 },
      { align: "right", label: ehPrice ? "Parcela de origem" : "Amortização", peso: 0.17 },
      { align: "right", label: "Juros", peso: 0.16 },
      { align: "right", label: `Correção${contrato.indice ? ` (${contrato.indice})` : ""}`, peso: 0.19 },
      { align: "right", label: "Parcela", peso: 0.18 },
    ],
    linhas: quadro.linhas.map((l) => [
      `${mesCurto(l.de)} a ${mesCurto(l.ate)}${l.origem === "estimado" ? " *" : ""}`,
      l.deParcela === l.ateParcela ? String(l.deParcela) : `${l.deParcela} a ${l.ateParcela}`,
      dinheiro(l.amortizacao),
      l.juros > 0 ? dinheiro(l.juros) : "-",
      correcaoDaLinha(l),
      dinheiro(l.parcela),
    ]),
    total: [
      "Total do contrato",
      "",
      dinheiro(quadro.totalDeAmortizacao),
      // Na PRICE os juros moram na parcela de origem: "R$ 0,00" diria que o contrato não tem juros.
      ehPrice ? "-" : dinheiro(quadro.totalDeJuros),
      semCorrecao ? "-" : dinheiro(quadro.totalDeCorrecao),
      dinheiro(quadro.totalDoContrato),
    ],
    vazio: "Sem quadro para este contrato.",
  });
}

/** O contexto do pdf-timbrado, só para tipar o desenho acima. */
type Ctx = Awaited<ReturnType<typeof abrirDocumento>>;

/**
 * O nome do arquivo, no MESMO formato do extrato ("Extrato - Fulano - LOS0617 - 24-09-2026.pdf").
 *
 * ⚠️ ESPAÇO NO NOME É O PADRÃO DAQUI, e não um descuido: as duas peças caem na mesma pasta de
 * download do atendente, e um nome com traço e outro com espaço faz o par parecer de sistemas
 * diferentes.
 */
export function nomeDoArquivoEvolucao(dados: DadosDaEvolucaoPdf): string {
  const cliente = (dados.cliente.nome ?? "Cliente").trim();
  const unidade =
    dados.contratos.length === 1
      ? (dados.contratos[0]?.codigo ?? "-")
      : `${dados.contratos.length} contratos`;
  const dia = dados.posicaoEm.split("-").reverse().join("-");

  return sanitizarNomeDeArquivo(`Evolucao da Parcela - ${cliente} - ${unidade} - ${dia}.pdf`);
}
