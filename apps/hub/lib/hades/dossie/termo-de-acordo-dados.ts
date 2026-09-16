// DO ACORDO GRAVADO AO PAPEL — de onde sai cada número do termo de acordo, e quando ele é recusado.
//
// A rota (`app/api/guardian/termo-de-acordo/route.ts`) só busca: o compromisso no Supabase e o
// cliente no C2X. Tudo o que é DECISÃO mora aqui, puro, para o teste cobrar sem banco: qual valor é
// "o débito negociado", qual data o congela, e em que situação o papel não pode sair.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ O DÉBITO NEGOCIADO JÁ ESTÁ GRAVADO NO ACORDO. Esta lib não recalcula nada.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// Quando o operador envia o acordo, a tela (`ProposalModal` em `PropostasPanel.tsx`) grava no
// `metadata` do compromisso:
//   - `original_amount`  — a soma das parcelas vencidas que ele marcou (o "total nominal");
//   - `agreement_amount` — original − desconto + juros + multa (o "valor atualizado");
//   - `c2x_parcelas`     — os ids (`payments.id` do C2X) das parcelas cobertas.
// E `submitted_at` recebe o carimbo de cada envio (`carimboAoCriar`, também no reenvio de uma
// edição), junto com o metadata novo. É ESSA a data em que o débito foi congelado.
//
// Medido em 16/09/2026 no Supabase de produção, nos 18 acordos existentes: `agreement_amount` =
// `total_amount` = soma das parcelas do acordo em 18 de 18. Então o valor atualizado que o termo
// imprime é o que o gestor analisa e o que os boletos cobram — não uma conta feita na hora de
// imprimir. ⚠️ E ESSE VALOR NÃO VEM DA RÉGUA DO PAPEL MODELO: nos 18 acordos a atualização é juros
// de 1% e multa de 2% FIXOS sobre o nominal, digitados pelo operador, sem desconto e sem pro rata
// de meses. No caso real do modelo o débito subiu 8,11% em cinco meses. O papel imprime o que o
// acordo decidiu; a régua é pergunta para o dono do produto, não para esta lib.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ AS PARCELAS EM ATRASO VÊM DO C2X, E POR ISSO SÃO CONFERIDAS CONTRA O QUE FOI CONGELADO
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// O compromisso guarda só os ids e a soma; número, vencimento e valor de cada parcela vêm do C2X, da
// MESMA leitura que a tela do Hades usa (`loadHadesAttendanceClient`). E o C2X muda depois do
// acordo. Medido em 16/09/2026 (SELECT em `payments` pelos ids de `c2x_parcelas`): 16 dos 18 acordos
// batem centavo a centavo com `original_amount`; em AC-000023, 5 das 6 parcelas foram PAGAS depois
// do envio (e o C2X gravou juros e multa na baixa: a soma virou R$ 3.023,73 contra R$ 2.936,58); em
// AC-000027 as duas parcelas não existem mais. Imprimir o C2X de hoje nesses casos daria um termo
// que diz "vencidas e não pagas" sobre parcelas pagas, ou um "Total nominal" que não é o do acordo.
// Então o papel só sai quando o C2X ainda confirma o débito congelado — e, quando não confirma, a
// recusa diz o que mudou, em uma frase, para o operador revisar o acordo.

import { dinheiro } from "@/lib/apolo/pdf-timbrado";

import { type AcordoParaOGate, motivoParaNaoEmitirOTermo } from "./termo-de-acordo-gate";
import {
  type DadosDoTermoDeAcordo,
  fecharParcelasComTotal,
  type ParcelaEmAtraso,
} from "./termo-de-acordo-pdf";

// ────────────────────────────────────────────────────────────────────────────────────────────
// O QUE A MONTAGEM RECEBE (estrutural: o `GuardianCompromissoDetail` e o `QueueClient` servem)
// ────────────────────────────────────────────────────────────────────────────────────────────

export type AcordoParaOTermo = Omit<AcordoParaOGate, "parcelas"> & {
  createdAt: string;
  parcelas: { amount: number; dueDate: string; sequence: number }[];
  submittedAt: null | string;
  totalAmount: number;
};

/** Uma parcela do contrato como a tela do Hades a carrega do C2X. */
export type ParcelaDoC2xNoHades = {
  acquisitionRequestId: string;
  /** 'YYYY-MM-DD'. */
  dueDateInput: string;
  id: string;
  /** "Parcela 06/120", "Sinal 01/04", "Ato". */
  number: string;
  status: string;
  unitCode?: string;
  valueNumber: number;
};

export type ClienteDoHadesParaOTermo = {
  c2xInstallments?: ParcelaDoC2xNoHades[];
  carteira: {
    unidades: { empreendimento: string; lote: string; matricula: string; quadra: string }[];
  };
  cpf: string;
  dados360: {
    endereco?: string;
    estadoCivil: string;
    nacionalidade: string;
    profissao: string;
  };
  nome: string;
};

export type TermoMontado =
  | { dados: DadosDoTermoDeAcordo; ok: true }
  /** 409: o acordo não está em condição de ter termo. 422: o C2X não confirma o que foi acordado. */
  | { motivo: string; ok: false; status: 409 | 422 };

// ────────────────────────────────────────────────────────────────────────────────────────────
// AS PEQUENAS RÉGUAS (exportadas porque o teste cobra cada uma)
// ────────────────────────────────────────────────────────────────────────────────────────────

const VAZIO = "-";

const centavos = (valor: number): number =>
  Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;

/** Número vindo de jsonb: aceita 6180 e "6180.00"; qualquer outra coisa é `null`, nunca zero. */
function numeroOuNulo(valor: unknown): null | number {
  const numero = typeof valor === "string" ? Number(valor) : valor;
  return typeof numero === "number" && Number.isFinite(numero) ? numero : null;
}

/** '2026-05-15' → '15/05/2026', lido campo a campo (sem fuso, que tira um dia no Brasil). */
export function dataCurta(dataIso: null | string | undefined): string {
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(dataIso ?? "");
  return partes ? `${partes[3]}/${partes[2]}/${partes[1]}` : VAZIO;
}

const FORMATO_DE_BRASILIA = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "America/Sao_Paulo",
  year: "numeric",
});

/**
 * Um instante (timestamptz) escrito como o dia em que aconteceu EM BRASÍLIA.
 *
 * ⚠️ `submitted_at` É UTC. Um acordo enviado às 22h de 14/09 está gravado como 01h de 15/09; sem o
 * fuso, o termo diria que o débito foi apurado num dia em que ninguém mexeu nele.
 */
export function diaEmBrasilia(instante: null | string | undefined): string {
  if (!instante) return VAZIO;
  const data = new Date(instante);
  return Number.isNaN(data.getTime()) ? VAZIO : FORMATO_DE_BRASILIA.format(data);
}

/**
 * "Hoje" para a data de emissão, como um `Date` cujo `getDate()` é o dia de Brasília.
 *
 * ⚠️ O SERVIDOR DA VERCEL RODA EM UTC, e a data de emissão do rodapé do termo (e o nome do arquivo)
 * lê `getDate()`. Às 22h de Brasília já é o dia seguinte em UTC: sem isto, o termo impresso à noite
 * sairia datado de amanhã.
 */
export function hojeEmBrasilia(agora: Date = new Date()): Date {
  const [dia, mes, ano] = FORMATO_DE_BRASILIA.format(agora).split("/").map(Number);
  return new Date(ano ?? 1970, (mes ?? 1) - 1, dia ?? 1);
}

/**
 * O número da parcela como o termo imprime.
 *
 * ⚠️ O PAPEL JÁ DIZ QUE É PARCELA (a coluna "PARCELA" da tabela de parcelas em atraso), e o C2X, pela
 * tela do Hades, também: sem tirar o prefixo a célula diria "Parcela 06/120" embaixo do cabeçalho
 * "PARCELA". Sinal e Ato ficam como estão ("Sinal 01/04"): é o tipo que o C2X dá, e escondê-lo
 * mudaria o que foi negociado.
 */
export function numeroDaParcela(numero: string): string {
  return numero.replace(/^\s*parcela\s+/i, "").trim() || numero;
}

/** "Q13" + "L01" → "Quadra 13 - Lote 01"; sem quadra nem lote, o código da unidade. */
export function unidadeEmTexto(unidade: { lote: string; matricula: string; quadra: string }): string {
  const quadra = /^sem /i.test(unidade.quadra) ? "" : unidade.quadra.replace(/^q/i, "");
  const lote = /^sem /i.test(unidade.lote) ? "" : unidade.lote.replace(/^l/i, "");
  const partes = [quadra && `Quadra ${quadra}`, lote && `Lote ${lote}`].filter(Boolean);
  return partes.length ? partes.join(" - ") : unidade.matricula;
}

/** "15/05/2026", ou "15/03/2026 a 15/05/2026" quando o acordo cobre vencimentos diferentes. */
export function vencimentoConsiderado(datasIso: string[]): string {
  const validas = datasIso.filter((data) => /^\d{4}-\d{2}-\d{2}/.test(data)).sort();
  const primeira = validas[0];
  const ultima = validas[validas.length - 1];
  if (!primeira || !ultima) return VAZIO;
  return primeira === ultima
    ? dataCurta(primeira)
    : `${dataCurta(primeira)} a ${dataCurta(ultima)}`;
}

/** Os ids das parcelas do C2X que o acordo cobre, como texto (a tela grava texto). */
export function idsDasParcelasCobertas(metadata: Record<string, unknown>): string[] {
  const valor = metadata.c2x_parcelas;
  if (!Array.isArray(valor)) return [];
  return valor
    .filter((id): id is number | string => typeof id === "string" || typeof id === "number")
    .map((id) => String(id).trim())
    .filter(Boolean);
}

/**
 * "1 das 6 parcelas ... já consta paga", "5 das 6 ... já constam pagas", "A parcela ... já consta
 * paga". A frase vai para a tela: concordância errada ali parece sistema mal feito.
 */
export function quantasDas(quantas: number, total: number, singular: string, plural: string): string {
  if (total === 1) return `A parcela ${singular}`;
  return `${quantas} das ${total} parcelas ${quantas === 1 ? singular : plural}`;
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// A MONTAGEM
// ────────────────────────────────────────────────────────────────────────────────────────────

const REVISE = "revise o acordo antes de emitir o termo.";

function recusa(motivo: string): TermoMontado {
  return { motivo, ok: false, status: 422 };
}

/**
 * Os dados do termo, ou a frase que diz por que ele não sai.
 *
 * ⚠️ NENHUMA RECUSA AQUI É EXCEÇÃO. Um `throw` viraria 500 com "erro ao gerar" na tela, e a pessoa
 * não saberia se é o sistema ou o acordo. Cada caso que o C2X ou o registro podem produzir devolve
 * a frase, e só defeito de programação sobe como erro.
 */
export function montarDadosDoTermoDeAcordo({
  acordo,
  cliente,
  emitidoEm,
}: {
  acordo: AcordoParaOTermo;
  cliente: ClienteDoHadesParaOTermo;
  emitidoEm: Date;
}): TermoMontado {
  const motivo = motivoParaNaoEmitirOTermo(acordo);
  if (motivo) return { motivo, ok: false, status: 409 };

  const contrato = String(acordo.acquisitionRequestC2xId);
  const ids = idsDasParcelasCobertas(acordo.metadata);
  if (!ids.length) {
    return recusa(
      "Este acordo não registra quais parcelas em atraso ele cobre; refaça o acordo para emitir o termo.",
    );
  }

  const doCliente = cliente.c2xInstallments ?? [];
  // ⚠️ CONTRATO SUMIDO NÃO É "PARCELA SUMIDA". A leitura da tela só traz contrato vivo
  // (`contratoVivoWhere`): um distrato no meio do caminho apaga TODAS as parcelas de uma vez, e a
  // frase certa para isso é outra.
  if (!doCliente.some((parcela) => parcela.acquisitionRequestId === contrato)) {
    return recusa(
      "O contrato deste acordo não aparece mais na carteira ativa do C2X (pode ter sido cancelado ou distratado), então o termo não é emitido.",
    );
  }

  const porId = new Map(doCliente.map((parcela) => [parcela.id, parcela]));
  const cobertas = ids
    .map((id) => porId.get(id))
    .filter((parcela): parcela is ParcelaDoC2xNoHades => Boolean(parcela));

  const faltando = ids.length - cobertas.length;
  if (faltando > 0) {
    return recusa(
      `${quantasDas(faltando, ids.length, "que este acordo cobre não existe mais no C2X (cancelada ou reemitida)", "que este acordo cobre não existem mais no C2X (canceladas ou reemitidas)")}; ${REVISE}`,
    );
  }

  const deOutroContrato = cobertas.filter((parcela) => parcela.acquisitionRequestId !== contrato).length;
  if (deOutroContrato > 0) {
    return recusa(
      `${quantasDas(deOutroContrato, ids.length, "deste acordo é de outra unidade", "deste acordo são de outra unidade")}, e o acordo vale para uma unidade por vez; ${REVISE}`,
    );
  }

  // ⚠️ "Vencida e não paga" é o que o papel afirma. Parcela liquidada depois do envio desmente o
  // documento — foi o caso medido em AC-000023.
  const pagas = cobertas.filter((parcela) => parcela.status === "Liquidada").length;
  if (pagas > 0) {
    return recusa(
      `${quantasDas(pagas, ids.length, "que este acordo cobre já consta paga no C2X, e o termo diria que está em aberto", "que este acordo cobre já constam pagas no C2X, e o termo diria que estão em aberto")}; ${REVISE}`,
    );
  }

  const somaHoje = centavos(cobertas.reduce((soma, parcela) => soma + centavos(parcela.valueNumber), 0));
  const nominalDoAcordo = numeroOuNulo(acordo.metadata.original_amount);
  if (nominalDoAcordo !== null && Math.abs(somaHoje - centavos(nominalDoAcordo)) >= 0.01) {
    return recusa(
      `As parcelas em atraso deste acordo somam hoje ${dinheiro(somaHoje)} no C2X, mas o acordo foi montado sobre ${dinheiro(nominalDoAcordo)}; ${REVISE}`,
    );
  }

  const codigo = cobertas[0]?.unitCode;
  const unidade = cliente.carteira.unidades.find((item) => item.matricula === codigo);
  if (!unidade) {
    return recusa(
      "A unidade deste acordo não foi encontrada na carteira do cliente no C2X, e o termo não sai sem ela.",
    );
  }

  // O valor atualizado é o que o acordo gravou; registro antigo sem o campo cai no total das
  // parcelas, que é o mesmo número em 18 de 18 acordos medidos.
  const valorAtualizado = centavos(
    numeroOuNulo(acordo.metadata.agreement_amount) ?? acordo.totalAmount,
  );
  const parcelasDoAcordo = [...acordo.parcelas]
    .sort((a, b) => a.sequence - b.sequence)
    .map((parcela) => ({ valor: parcela.amount, vencimento: dataCurta(parcela.dueDate) }));

  // A mesma trava que o desenho aplica, antes do desenho: divergência além do centavo vira frase,
  // e não um 500.
  try {
    fecharParcelasComTotal(parcelasDoAcordo, valorAtualizado);
  } catch (erro) {
    return recusa((erro as Error).message);
  }

  const parcelasEmAtraso: ParcelaEmAtraso[] = [...cobertas]
    .sort((a, b) => a.dueDateInput.localeCompare(b.dueDateInput) || a.id.localeCompare(b.id))
    .map((parcela) => ({
      numero: numeroDaParcela(parcela.number),
      valor: parcela.valueNumber,
      vencimento: dataCurta(parcela.dueDateInput),
    }));

  const ultimoVencimentoDoAcordo = acordo.parcelas
    .map((parcela) => parcela.dueDate)
    .sort()
    .at(-1);

  return {
    dados: {
      comprador: {
        cpf: cliente.cpf,
        endereco: cliente.dados360.endereco ?? VAZIO,
        estadoCivil: cliente.dados360.estadoCivil,
        nacionalidade: cliente.dados360.nacionalidade,
        nome: cliente.nome,
        profissao: cliente.dados360.profissao,
      },
      debito: {
        apuradoEm: diaEmBrasilia(acordo.submittedAt ?? acordo.createdAt),
        parcelas: parcelasEmAtraso,
        previsaoDePagamento: dataCurta(ultimoVencimentoDoAcordo),
        valorAtualizado,
        vencimentoConsiderado: vencimentoConsiderado(cobertas.map((parcela) => parcela.dueDateInput)),
      },
      emitidoEm,
      empreendimento: unidade.empreendimento,
      parcelasDoAcordo,
      pv: unidade.matricula,
      unidade: unidadeEmTexto(unidade),
    },
    ok: true,
  };
}
