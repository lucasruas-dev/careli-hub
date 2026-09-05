// DO CRONOGRAMA PARA O PAPEL — o adaptador entre o que a rota calcula e o que o PDF imprime.
//
// `montarCronograma` devolve números e dias (`2026-10-10`, 583.33); `montarPropostaPdf` só aceita
// TEXTO pronto ("10 de outubro de 2026", "R$ 583,33"), porque um gerador que também formatasse
// seria um gerador que decide o que a folha diz. Este arquivo é a costura entre os dois.
//
// ⚠️ POR QUE ELE NÃO MORA NA ROTA. É a única parte desta história que dá para testar sem banco,
// sem gateway e sem sessão: o que a folha ANUNCIA ao comprador (a data da 1ª parcela, o total da
// entrada, quantas mensais, quando reajusta) nasce aqui. Dentro da rota, cada regra dessas só
// seria conferida abrindo o PDF a olho.
//
// ⚠️ NÃO FAZ CONTA DE DINHEIRO. Nenhuma. Todo valor vem pronto do cronograma, que por sua vez
// reusa `planos-comerciais.ts`. O que existe aqui é divisão para achar o preço do m² e a % da
// entrada — números de RÓTULO, que não voltam para lugar nenhum.
//
// ⚠️ SEM TRAVESSÃO NOS TEXTOS QUE O COMPRADOR LÊ (regra do Lucas para texto de cliente). Onde o
// mockup precisa de separador, o caractere é o ponto médio.

import { formatarDocumento } from "@/lib/apolo/documento";
import {
  INDICES,
  type PlanoComercial,
  textoDaTaxa,
} from "@/lib/apolo/planos-comerciais";

import type { Cronograma, ParcelaDoCronograma } from "./cronograma";
import { dataEscrita, diaDoCalendario } from "./proposta";
import type {
  CompradorDaProposta,
  ParcelaDaProposta,
  PropostaParaPdf,
} from "./proposta-pdf";

/**
 * Quantos dias a proposta vale.
 *
 * ⚠️ ESTÁ NO PAPEL PORQUE O PREÇO NÃO É ETERNO: a tabela reajusta e a unidade pode ser vendida
 * para outro cliente enquanto esta proposta circula no WhatsApp. Sete dias é o prazo que o
 * comercial pratica; o dia exato vai escrito para ninguém precisar contar.
 */
export const VALIDADE_DA_PROPOSTA_EM_DIAS = 7;

export type CompradorDaFolha = {
  cpf: string;
  nome: string;
  /** Percentual, 0 a 100 (nunca fração) — o mesmo de `CompradorDoPedido`. */
  participacao: number;
};

export type DadosDaFolha = {
  atendimento: {
    coordenador: null | string;
    corretor: null | string;
    imobiliaria: null | string;
    /** O telefone que o comprador liga se tiver dúvida. */
    telefone: null | string;
  };
  /** `000123` — o COD da venda, o mesmo desde a reserva. */
  codigo: string;
  compradores: CompradorDaFolha[];
  cronograma: Cronograma;
  diaDeVencimento: number;
  /** ISO do instante em que a proposta foi gerada. Vira a data de emissão e a base da validade. */
  emitidaEmIso: string;
  empreendimento: string;
  logoC2x: null | Uint8Array;
  logoEmpreendimento: null | Uint8Array;
  plano: PlanoComercial;
  unidade: {
    /** Metros quadrados. Ausente = a folha não anuncia preço por m². */
    area: null | number;
    cidade: null | string;
    /** "Quadra 03 · Lote 07" */
    nome: string;
    uf: null | string;
  };
  valorNegociado: number;
};

const MOEDA = new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" });

/**
 * "R$ 178.100,00".
 *
 * ⚠️ O ESPAÇO DO `Intl` É NÃO QUEBRÁVEL (U+00A0) e some da vista em log, teste e diff: um
 * `includes("R$ 178.100,00")` falha sem dizer por quê. Trocado aqui, como em `proposta.ts`.
 */
function reais(valor: number): string {
  return MOEDA.format(Number.isFinite(valor) ? valor : 0).replace(/\u00a0/g, " ");
}

/** "250,00" — número com duas casas, na vírgula do país. */
function decimal(valor: number): string {
  return (Number.isFinite(valor) ? valor : 0).toFixed(2).replace(".", ",");
}

/** "60%", "33,33%" — sem casas quando é redondo, porque "60,00%" se lê pior. */
function percentual(valor: number): string {
  const n = Number((Number.isFinite(valor) ? valor : 0).toFixed(2));
  return `${String(n).replace(".", ",")}%`;
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/**
 * "10 de outubro de 2026".
 *
 * ⚠️ LÊ OS DÍGITOS, NÃO CONSTRÓI `Date`. O cronograma já entrega `YYYY-MM-DD`, que É o dia; passar
 * isso por `new Date(...)` e formatar com `Intl` no fuso da máquina devolve 09 de outubro na
 * Vercel (UTC) e 10 no notebook — o mesmo defeito de fuso que `cronograma.ts` documenta e evita.
 */
function porExtenso(dia: string): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia ?? "").trim());
  if (!partes?.[1] || !partes[2] || !partes[3]) return "";
  const mes = MESES[Number(partes[2]) - 1];
  if (!mes) return "";
  return `${partes[3]} de ${mes} de ${partes[1]}`;
}

/**
 * `dias` dias depois de um `YYYY-MM-DD`, ainda como dia.
 *
 * ⚠️ MEIA-NOITE **UTC** NOS DOIS SENTIDOS. Somar em milissegundos só é seguro porque entra e sai
 * em UTC: com fuso local no meio, um dia de 23h (horário de verão, que ainda existe em outros
 * países e no histórico do Brasil) faria a validade cair no dia anterior.
 */
function somarDias(dia: string, dias: number): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dia ?? "").trim());
  if (!partes?.[1] || !partes[2] || !partes[3]) return "";
  const base = Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
  return new Date(base + dias * 86_400_000).toISOString().slice(0, 10);
}

/** "1 de 2" + a data por extenso, que é como o fluxo aparece na folha. */
function comoLinha(parcela: ParcelaDoCronograma): ParcelaDaProposta {
  return {
    ordem: `${parcela.numero} de ${parcela.total}`,
    valor: reais(parcela.valor),
    vencimento: porExtenso(parcela.vencimento),
  };
}

/** "1º ano", "2º ano" — o rótulo do ciclo de reajuste. */
function periodoDoCiclo(ciclo: number): string {
  return `${ciclo}º ano`;
}

/** O nome do sistema como o comercial escreve. */
function nomeDoSistema(plano: PlanoComercial): string {
  if (plano.sistemaAmortizacao === "price") return "Price";
  if (plano.sistemaAmortizacao === "sac") return "SAC";
  return "SACOC";
}

/**
 * "2× de R$ 5.000,00" · "3×, a 1ª de R$ 3.333,34" quando a divisão deixa resto.
 *
 * ⚠️ O RESTO DA DIVISÃO VAI NA PRIMEIRA (ver `repartirEmPartesIguais`), então anunciar "3× de
 * R$ 3.333,33" seria anunciar um centavo a menos do que a entrada negociada. Quando as parcelas
 * não são todas iguais, a folha diz qual é a diferente.
 */
function comoSeAnunciaAEntrada(entrada: ParcelaDoCronograma[]): string {
  const primeira = entrada[0];
  if (!primeira) return "sem entrada";
  if (entrada.length === 1) return `à vista, ${reais(primeira.valor)}`;

  const demais = entrada.slice(1);
  const todasIguais = demais.every((p) => p.valor === primeira.valor);
  return todasIguais
    ? `${entrada.length}× de ${reais(primeira.valor)}`
    : `${entrada.length}×, a 1ª de ${reais(primeira.valor)}`;
}

/** O último vencimento do contrato, olhando as três séries. */
function ultimoVencimento(cronograma: Cronograma): string {
  const todas = [...cronograma.entrada, ...cronograma.mensais, ...cronograma.anuais];
  return todas.reduce((maior, p) => (p.vencimento > maior ? p.vencimento : maior), "");
}

/**
 * O cronograma vira a folha que o comprador recebe.
 *
 * ⚠️ TUDO O QUE ESTÁ AQUI SAI DO CRONOGRAMA E DO PLANO, e nada é recebido pronto de fora: se a
 * rota pudesse passar "parcela mensal" por conta própria, a folha e o fluxo poderiam discordar
 * dentro do MESMO documento, e é o fluxo que vira boleto.
 */
export function montarFolhaDaProposta(dados: DadosDaFolha): PropostaParaPdf {
  const { cronograma, plano } = dados;
  const primeiraMensal = cronograma.mensais[0] ?? null;
  const primeiraDaEntrada = cronograma.entrada[0] ?? null;
  const primeiraDeTodas = primeiraDaEntrada ?? primeiraMensal;

  const emitidaEm = diaDoCalendario(dados.emitidaEmIso) ?? "";
  const valeAte = emitidaEm ? somarDias(emitidaEm, VALIDADE_DA_PROPOSTA_EM_DIAS) : "";

  const compradores: CompradorDaProposta[] = dados.compradores.map((c) => ({
    documento: formatarDocumento(c.cpf),
    nome: c.nome,
    participacao: percentual(c.participacao),
  }));

  const anuaisPorAno = cronograma.anuais[0]?.valor ?? 0;
  const taxa = textoDaTaxa(plano);
  const temCorrecao = plano.indiceCorrecao !== "SEM_CORRECAO";

  const condicoes: Array<{ rotulo: string; valor: string }> = [
    { rotulo: "Parcelas mensais", valor: String(cronograma.mensais.length) },
  ];
  // ⚠️ SÓ ENTRA QUANDO EXISTE. "Parcelas anuais: 0" faria o comprador procurar do que se trata.
  if (cronograma.anuais.length > 0) {
    condicoes.push({
      rotulo: "Parcelas anuais",
      valor: `${cronograma.anuais.length} de ${reais(anuaisPorAno)}`,
    });
  }
  condicoes.push(
    { rotulo: "Primeira parcela", valor: dataEscrita(primeiraDeTodas?.vencimento) },
    { rotulo: "Última parcela", valor: dataEscrita(ultimoVencimento(cronograma)) },
    { rotulo: "Vencimento", valor: `todo dia ${dados.diaDeVencimento}` },
    { rotulo: "Juros", valor: taxa || "sem juros" },
    {
      rotulo: "Correção",
      valor: temCorrecao ? INDICES[plano.indiceCorrecao] : "sem correção",
    },
    { rotulo: "Sistema", valor: nomeDoSistema(plano) },
  );

  const area = dados.unidade.area;
  const temArea = typeof area === "number" && Number.isFinite(area) && area > 0;

  const destaques: Array<{ detalhe: string; rotulo: string; valor: string }> = [
    {
      detalhe: temArea ? `${reais(dados.valorNegociado / (area as number))} por m²` : "",
      rotulo: "Valor da unidade",
      valor: reais(dados.valorNegociado),
    },
    {
      // A % da entrada é RÓTULO, e sai do que foi negociado de verdade (entrada ÷ valor), não da
      // % sugerida do plano: o comprador confere o número que ele vai pagar.
      detalhe: `${
        dados.valorNegociado > 0
          ? `${percentual((cronograma.totais.entrada / dados.valorNegociado) * 100)} · `
          : ""
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

  // ⚠️ SEM SÉRIE MENSAL O CARD SOME, em vez de imprimir "R$ 0,00". Entrada de 100% é venda à
  // vista, é legítima (o cronograma a aceita), e um destaque de parcela zerada no meio da folha
  // parece defeito do sistema para quem lê.
  if (primeiraMensal) {
    destaques.push({
      detalhe: `1ª em ${dataEscrita(primeiraMensal.vencimento)}`,
      rotulo: "Parcela mensal",
      valor: reais(primeiraMensal.valor),
    });
  }

  const observacoes: Array<{ texto: string; titulo: string }> = [];

  // ⚠️ A OBSERVAÇÃO DO REAJUSTE SÓ APARECE QUANDO HÁ REAJUSTE, e o texto é derivado do plano.
  // Escrever "reajusta todo ano" num plano SEM_CORRECAO e sem degrau prometeria ao comprador um
  // aumento que o contrato dele não tem, e ele leria isso como pegadinha.
  const temDegrau = cronograma.reajustes.length > 1;
  if (temDegrau || temCorrecao) {
    const sobreOsJuros = taxa
      ? ` Os valores da tabela acima consideram apenas os juros de ${taxa} previstos em contrato;`
      : " Os valores da tabela acima não embutem correção;";
    observacoes.push({
      texto:
        "A parcela é reajustada uma vez por ano, no aniversário do contrato. Entre um aniversário e outro o valor não muda." +
        (temCorrecao
          ? `${sobreOsJuros} a correção pelo ${INDICES[plano.indiceCorrecao]} do período é somada na mesma data e não está projetada, por depender de índice futuro.`
          : ""),
      titulo: "Sobre o reajuste.",
    });
  }

  observacoes.push({
    texto: `Os valores acima valem até ${dataEscrita(
      valeAte,
    )} e estão sujeitos à confirmação de disponibilidade da unidade e à aprovação de crédito.`,
    titulo: "Sobre esta proposta.",
  });

  const local = [dados.unidade.cidade, dados.unidade.uf].filter(Boolean).join(", ");
  const subtitulo = [
    dados.empreendimento,
    temArea ? `${decimal(area as number)} m²` : null,
    local || null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    anuais: cronograma.anuais.map(comoLinha),
    anuaisTotal: cronograma.anuais.length > 0 ? reais(cronograma.totais.anuais) : "",
    atendimento: dados.atendimento,
    codigo: dados.codigo,
    compradores,
    condicoes,
    destaques,
    emitidaEm: dataEscrita(dados.emitidaEmIso),
    empreendimento: dados.empreendimento,
    entrada: cronograma.entrada.map(comoLinha),
    entradaTotal: reais(cronograma.totais.entrada),
    logoC2x: dados.logoC2x,
    logoEmpreendimento: dados.logoEmpreendimento,
    observacoes,
    reajustes: cronograma.reajustes.map((faixa) => ({
      ate: dataEscrita(faixa.ate),
      de: dataEscrita(faixa.de),
      parcelas: `${faixa.parcelaInicial} a ${faixa.parcelaFinal}`,
      periodo: periodoDoCiclo(faixa.ciclo),
      temIpca: faixa.temIpca,
      valor: reais(faixa.valor),
    })),
    subtitulo,
    unidade: dados.unidade.nome,
  };
}
