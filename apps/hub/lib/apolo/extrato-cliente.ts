// EXTRATO DO CLIENTE COMPRADOR — "quanto eu já paguei e quanto ainda devo".
//
// É o relatório que o backoffice monta à mão toda semana quando o comprador liga. Sai em tela
// (aba Financeiro do cockpit) e em PDF timbrado, com o MESMO cálculo: esta lib é a régua única.
//
// ⚠️ NÃO CONFUNDIR com `lib/apolo/extrato.ts`. Aquele é o extrato por PARTICIPANTE (o split das
// comissões de imobiliária/incorporador). Este é o do COMPRADOR, e vai para a mão dele.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// AS SEIS COISAS QUE O C2X FAZ E QUE ESTE ARQUIVO PRECISA DESARMAR
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// 1. `paid_value` SEM `payment_date` É DINHEIRO FANTASMA. A integração Asaas pré-preenche o
//    `paid_value` com o valor esperado quando emite o boleto. Medido no banco inteiro: 707
//    parcelas com status 7 (atrasada), sem data de pagamento e com `paid_value` somando
//    R$ 443.864,34 que NINGUÉM pagou. Aqui, PAGO É `payment_date is not null` — e o valor é o
//    `paid_value`, sem fallback (as 114 linhas "pagas com zero" são Ato de valor 0,00 legítimo,
//    conferido contra `initial_value`). Mesma trava que a carteira já usa.
//    ⚠️ COM UMA EXCEÇÃO MEDIDA: `payment_status_id = 5` é a baixa explícita do C2X ("paga"), e
//    existem 2 linhas assim SEM `payment_date` (AR 67 parcela 29 e o Ato do AR 4853). Cobrar de
//    novo o que o sistema declara pago é o pior erro possível nesta peça, então status 5 também
//    é pago — o que continua fora é o `paid_value` sozinho em parcela status 6/7.
//
// 2. `reference_date` NÃO É ORDEM NEM VENCIMENTO. É rótulo de competência, e é REESCRITO quando
//    a parcela entra em acordo (AR 383: as parcelas 9, 10, 11 e 13 viraram todas 04/2026,
//    apagando a competência original). A ordem canônica das mensais é `current_total_parcel`.
//
// 3. ACORDO APARECE DE DUAS FORMAS: reescrevendo a parcela mensal (várias com o MESMO
//    vencimento, valores decrescentes) ou criando um `Avulso` com a explicação no `description`.
//    As mensais empilhadas saem da série de degraus — senão a mora vira "reajuste". O Avulso
//    ENTRA no saldo: é dívida real (AR 2519 tem R$ 1.189,29 em três avulsos de acordo).
//
// 4. JUROS E MULTA DE PARCELA VENCIDA NÃO EXISTEM NO C2X. De 102.007 parcelas em aberto, ZERO
//    têm `interest_value` ou `mulct_value` > 0 — os campos só são preenchidos DEPOIS do
//    pagamento. Este relatório portanto NÃO promete "valor atualizado para quitação", e diz
//    isso em texto na peça.
//
// 5. A DEFASAGEM. Não existe campo de reajuste no C2X: a correção anual é aplicada À MÃO sobre
//    `initial_value`, e na prática só quando a parcela recebe boleto. Parcela sem boleto carrega
//    o valor CONTRATUAL CRU. Medido: AR 183 tem 22,6% de defasagem (parcelas com boleto a
//    R$ 477,98, as de 2027 em diante ainda a R$ 389,79). Somar o nominal e entregar ao cliente
//    é assinar um documento que SUBESTIMA a dívida em R$ 9.348,14. Daí o "saldo a valor de
//    hoje": traz cada mensal sem boleto para a MENSALIDADE VIGENTE. Não projeta reajuste
//    futuro: corrigir o que já foi corrigido no mundo real é atualizar; adivinhar o IPCA de
//    2027 é inventar.
//
//    ⚠️ E A ÂNCORA NÃO É "A ÚLTIMA PARCELA COM BOLETO". Foi assim na primeira versão e errava
//    137 contratos (R$ 1,16 mi subestimados), por três motivos medidos:
//      • o backoffice emite dois boletos no mesmo dia (competência atrasada + a do mês), e as
//        duas parcelas MAIS RECENTES saíam da conta como se fossem acordo (AR 207: a âncora
//        recuava de R$ 477,98 para R$ 416,78, e a mesma página dizia as duas coisas);
//      • o valor novo pode estar numa parcela que ainda não recebeu boleto (AR 242: o valor
//        corrente R$ 403,95 está nas parcelas 26-28, e as 29-30 receberam boleto com o valor
//        VELHO, R$ 383,94 — a âncora andava para trás no tempo);
//      • uma INTERMEDIÁRIA gravada como `parcel_type_id = 3` vira "mensalidade" (AR 3716: a
//        parcela 88 é um balão de R$ 22.250,25 entre 87 mensais de R$ 674,25 — o saldo saía
//        R$ 1,84 mi num contrato de R$ 56 mil, com "3200,0%" impresso ao cliente).
//    A âncora de hoje: o MAIOR `initial_value` entre as mensais PLAUSÍVEIS (perto da mediana do
//    contrato — o balão fica de fora) que ainda estão vivas hoje: as em aberto e as cobradas no
//    último ciclo anual. Reajuste só sobe, e a janela impede que um valor antigo de contrato
//    renegociado volte a ancorar o saldo.
//
// ⚠️ ESTE MÓDULO É PURO DE PROPÓSITO — nada de mysql2 aqui. Ele é importado pelo PAINEL, que é
// "use client"; um `import { getHadesDbPool }` nesta linha arrastaria o driver MySQL para o
// bundle do navegador e quebraria o build. A leitura do C2X mora em `extrato-cliente-c2x.ts`,
// que importa daqui. Tela, PDF e rota compartilham ESTA régua.
//
// 6. O REAJUSTE NÃO É EVENTO GRAVADO. Ele aparece como DEGRAU no valor das mensais ao longo do
//    tempo. `detectarEventosDeValor` acha os degraus e — isto é o que impede a mentira — só
//    chama de "reajuste" o que se comporta como reajuste. Ver o comentário da função.
import { numeroDaParcela } from "@/lib/apolo/numero-da-parcela";

// ────────────────────────────────────────────────────────────────────────────────────────────
// TIPOS
// ────────────────────────────────────────────────────────────────────────────────────────────

/** `parcel_types.id` — o C2X só usa estes quatro. */
export const TIPO_ATO = 1;
export const TIPO_SINAL = 2;
export const TIPO_MENSAL = 3;
export const TIPO_AVULSO = 4;

/**
 * A linha de `payments` como sai do banco, já normalizada (datas como 'YYYY-MM-DD', números
 * como number). É a entrada da parte PURA — os testes montam estas à mão.
 */
export type ExtratoClienteParcelaBruta = {
  /** `payment_to_delete` — linha marcada para exclusão, some do extrato. */
  aExcluir: boolean;
  /** `payment_asaas_url` (PDF do boleto). */
  boletoUrl: null | string;
  /** `reference_date` — a COMPETÊNCIA, 'YYYY-MM-DD'. Rótulo, não ordem (ver nota 2). */
  competencia: null | string;
  descricao: null | string;
  /** `payment_asaas_invoice_url` (página da fatura). */
  faturaUrl: null | string;
  id: number;
  /** `interest_value` — juros, só preenchido DEPOIS do pagamento. */
  juros: number;
  /** `mulct_value` — multa; 0,00 no banco inteiro, mantido por simetria. */
  multa: number;
  /** `payment_date` — 'YYYY-MM-DD' ou null. NULL = não pago, não importa o `paid_value`. */
  pagamento: null | string;
  /** `current_total_parcel` — a ordem canônica das mensais. */
  parcelaAtual: null | number;
  /** `total_parcels`. */
  parcelaTotal: null | number;
  /** `current_signal_parcel`. */
  sinalAtual: null | number;
  /** `total_signal_parcels`. */
  sinalTotal: null | number;
  /** `payment_status_id`: 5 paga, 6 a vencer, 7 vencida. */
  statusId: number;
  /** `parcel_types.name` — só para exibir. */
  tipo: null | string;
  /** `parcel_type_id` — é por ele que a lógica decide. */
  tipoId: number;
  /** `initial_value` — o valor CONTRATUAL da parcela (pode estar defasado; ver nota 5). */
  valorInicial: number;
  /** `paid_value` — só vale quando há `pagamento`. */
  valorPago: number;
  /** `due_date` — 'YYYY-MM-DD'. */
  vencimento: null | string;
};

export type ExtratoClienteSituacao = "a_vencer" | "paga" | "vencida";

/** Uma linha do extrato, pronta para a tela e para o PDF. */
export type ExtratoClienteParcela = {
  /** Só para vencidas; 0 nas demais. */
  diasAtraso: number;
  /** `description` do C2X — é onde o acordo se explica ("ACORDO - PARCELAS 01/2026..."). */
  descricao: null | string;
  /** Vencimento compartilhado com outra mensal do mesmo contrato = acordo/empilhamento. */
  empilhada: boolean;
  id: number;
  /** MM/AAAA da competência, ou null. */
  competencia: null | string;
  /** Juros efetivamente cobrados no pagamento (0 nas abertas — o C2X não projeta). */
  juros: number;
  multa: number;
  /** "1/1", "2/4", "37/144" — a numeração como o cliente vê no boleto. */
  numero: string;
  /** `current_total_parcel`, para ordenar as mensais. 0 quando não é mensal. */
  ordem: number;
  /** 'YYYY-MM-DD' do pagamento, ou null. */
  pagamento: null | string;
  situacao: ExtratoClienteSituacao;
  /** Nome do tipo ("Ato", "Sinal", "Parcela", "Avulso"). */
  tipo: string;
  tipoId: number;
  /**
   * ABERTAS: o valor trazido à mensalidade vigente quando a parcela ainda não recebeu boleto
   * (ver nota 5). PAGAS: igual ao `valorPago`. É o número que soma no saldo a valor de hoje.
   */
  valorAtual: number;
  /** `initial_value` cru — o valor de contrato, sem correção aplicada. */
  valorContratual: number;
  /** O que o cliente pagou de fato. null nas abertas. */
  valorPago: null | number;
  /** Tem boleto emitido (`payment_asaas_url` ou `payment_asaas_invoice_url`). */
  temBoleto: boolean;
  /** True quando `valorAtual` foi levantado para a mensalidade vigente. */
  trazidaAValorDeHoje: boolean;
  /** 'YYYY-MM-DD' do vencimento. */
  vencimento: null | string;
};

export type ExtratoClienteEventoTipo = "alteracao" | "fronteira" | "reajuste";

/** Um degrau no valor das mensais. Ver `detectarEventosDeValor`. */
export type ExtratoClienteEvento = {
  /** MM/AAAA em que o degrau aparece. */
  competencia: null | string;
  de: number;
  /** `current_total_parcel` da parcela em que o degrau começa. */
  parcela: number;
  para: number;
  /** Em quantas parcelas consecutivas o valor novo se manteve. */
  persistencia: number;
  /** Frase pronta, a mesma na tela e no PDF. */
  rotulo: string;
  tipo: ExtratoClienteEventoTipo;
  /** Fração: 0.0575 = +5,75%. */
  variacao: number;
};

export type ExtratoClienteTitular = {
  /**
   * CPF/CNPJ mascarado — é o ÚNICO formato que sai daqui. O documento inteiro não viaja no
   * JSON da rota: nem a tela nem o PDF o usam, e o extrato circula por WhatsApp e e-mail.
   */
  documentoMascarado: null | string;
  nome: string;
  /** 1 = titular principal (`client_id`), 2..5 = coadquirentes. */
  ordem: number;
  /** `percentage_client_N`, quando houver. */
  percentual: null | number;
};

export type ExtratoClienteTotais = {
  /** Defasagem medida: mensalidade vigente ÷ mensalidade base − 1. 0 quando não há. */
  defasagem: number;
  diasAtrasoMax: number;
  /** `initial_value` da primeira mensal — a linha contratual de origem. */
  mensalidadeBase: number;
  /** A última mensal COM boleto: o valor que o cliente paga hoje. Âncora do saldo. */
  mensalidadeVigente: number;
  parcelasAbertas: number;
  parcelasPagas: number;
  parcelasTotal: number;
  /** 'YYYY-MM-DD' + valor da próxima parcela a vencer. */
  proximoVencimento: null | { valor: number; vencimento: string };
  primeiroPagamento: null | string;
  /** Saldo trazido à mensalidade vigente — o número principal da peça. */
  saldoAValorDeHoje: number;
  /** Soma crua de `initial_value` das abertas. Envelhece mal; nunca vai sozinho. */
  saldoNominal: number;
  /**
   * Soma do `initial_value` das parcelas PAGAS — o valor de contrato do que já foi quitado.
   *
   * Existe para o extrato poder imprimir "valor da parcela" ao lado de "total pago" sem afirmar
   * o que é a diferença entre os dois. O C2X guarda o total recebido, NÃO a composição: medido no
   * banco inteiro, `mulct_value` é 0,00 nas 15.655 parcelas pagas e 5.153 das 5.742 que pagaram
   * acima do valor original não têm `interest_value`. Decompor em juros e multa seria imprimir
   * "R$ 0,00 de juros" para quem pagou R$ 11,45 — mentira com cara de precisão. As duas colunas
   * lado a lado deixam a diferença VISÍVEL sem que a peça diga o que ela é.
   *
   * ⚠️ Pode ficar ACIMA do `totalPago`: existem 158 parcelas no banco recebidas por menos que o
   * valor de contrato (pagamento parcial), uma delas de R$ 125.746,40 baixada com R$ 44.011,24.
   * Quem consome este par de números não pode supor que a diferença é sempre positiva.
   */
  totalContratualPago: number;
  /** Soma dos `paid_value` das parcelas com data de pagamento. */
  totalPago: number;
  ultimoPagamento: null | string;
  vencidasTotal: number;
  vencidasQuantidade: number;
  /** 'YYYY-MM-DD' do vencimento mais antigo em aberto. */
  vencidaMaisAntiga: null | string;
};

export type ExtratoClienteContrato = {
  /** Nome da unidade no C2X (LOU1819) — é o que o cliente chama de "meu contrato". */
  codigo: string;
  area: null | number;
  /** 'YYYY-MM-DD' do ato. */
  dataAto: null | string;
  dataAssinatura: null | string;
  empreendimentoCodigo: string;
  empreendimentoNome: null | string;
  /** Contrato cancelado/em distrato/distratado: sai sem bloco de saldo. */
  encerrado: boolean;
  estagio: number;
  estagioNome: null | string;
  id: number;
  /**
   * `index_monetary_corrections.name` do plano, quando existe. NULL na maioria — e aí a peça
   * escreve "conforme a cláusula de correção do contrato", sem nomear índice que não sabe.
   */
  indiceCorrecao: null | string;
  jurosContratuais: null | number;
  lote: null | string;
  /** O parcelamento do CONTRATO (de `payments.total_parcels`). */
  planoParcelas: null | number;
  /** O do plano comercial, para comparar quando o contrato é personalizado. */
  planoPadraoParcelas: null | number;
  /** `acquisition_requests.custom_commercial_plan`: o plano foi ajustado para este contrato. */
  planoPersonalizado: boolean;
  /** `enterprise_unities.price` — preço de tabela da unidade. */
  precoTabela: null | number;
  quadra: null | string;
  titulares: ExtratoClienteTitular[];
};

/** O extrato de UM contrato/unidade. */
export type ExtratoClienteRelatorio = {
  abertas: ExtratoClienteParcela[];
  contrato: ExtratoClienteContrato;
  eventos: ExtratoClienteEvento[];
  /** As ressalvas, prontas. A honestidade vai na peça, não numa nota escondida. */
  notas: string[];
  /** 'YYYY-MM-DD' — a data da apuração, impressa no cabeçalho. */
  posicaoEm: string;
  realizados: ExtratoClienteParcela[];
  totais: ExtratoClienteTotais;
};

export type ExtratoClienteData = {
  cliente: {
    c2xId: number;
    /** Mascarado, sempre. Ver `ExtratoClienteTitular.documentoMascarado`. */
    documentoMascarado: null | string;
    nome: null | string;
  };
  contratos: ExtratoClienteRelatorio[];
  posicaoEm: string;
};

// ────────────────────────────────────────────────────────────────────────────────────────────
// PARTE PURA — o cálculo. Tudo aqui é testável sem banco.
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Tolerância de comparação de dinheiro: um centavo. */
const CENTAVO = 0.005;

/** Degrau precisa persistir por 3 competências para contar como evento (ver a função). */
const PERSISTENCIA_MINIMA = 3;

/** Alta a partir da qual o degrau é reajuste, e não ruído. */
const REAJUSTE_MINIMO = 0.02;

/**
 * Abaixo disto o degrau não vira linha nenhuma na peça. É arredondamento do próprio C2X — o
 * AR 99 (LOU1911) tem parcelas de R$ 515,55 e R$ 515,54 na mesma sequência, e um centavo saía
 * impresso ao cliente como "Alteração de valor (-0,0%)".
 */
const VARIACAO_MINIMA = 0.005;

/** `payment_status_id` que compõem a carteira ativa (mesma régua da carteira/Hades). */
const STATUS_ATIVOS = [5, 6, 7];

/** `payment_status_id = 5` é a baixa explícita do C2X: paga, mesmo sem `payment_date`. */
const STATUS_PAGA = 5;

/**
 * Quantas vezes o mesmo valor pago precisa se repetir para ser aceito como valor de parcela.
 *
 * Mora do Asaas é juros por DIA: dois atrasos diferentes dão dois valores diferentes. Um valor
 * que se repete em três parcelas é o valor da mensalidade, não encargo. Medido: no AR 58 os
 * R$ 419,61 aparecem 2x (mora de 24 e de 25 dias) e os R$ 408,06, 8x — só o segundo é parcela.
 */
const OCORRENCIAS_PARA_CORROBORAR = 3;

/**
 * Quanto uma mensal pode se afastar da mediana do contrato e ainda ser mensalidade.
 *
 * O C2X grava intermediária/balão com o MESMO `parcel_type_id = 3` da mensal (AR 3716: uma de
 * R$ 22.250,25 no meio de 87 de R$ 674,25 — 33x). Fora desta faixa a linha continua no extrato
 * como dívida, mas não serve de régua para medir mensalidade nem reajuste.
 */
const FATOR_MENSALIDADE_ATIPICA = 3;

/**
 * A janela do "valor corrente da mensalidade": ~13 meses, um ciclo anual de reajuste com folga.
 * Parcela cobrada há mais tempo que isso é história — inclusive a de um contrato renegociado,
 * que senão voltaria a ancorar o saldo pelo valor velho, maior.
 */
const JANELA_VIGENTE_DIAS = 400;

/** A linha existe de verdade: não está marcada para exclusão e tem status de carteira. */
export function parcelaAtiva(parcela: ExtratoClienteParcelaBruta): boolean {
  return !parcela.aExcluir && STATUS_ATIVOS.includes(parcela.statusId);
}

/**
 * PAGO É A DATA OU A BAIXA, NUNCA O VALOR. Ver a nota 1 do cabeçalho: `paid_value` vem
 * pré-preenchido pelo Asaas na emissão do boleto, então `paid_value > 0` sozinho não significa
 * nada — mas `payment_status_id = 5` é o C2X declarando a parcela quitada, e há 2 linhas assim
 * sem data. Sem esta segunda porta, o extrato cobrava de novo o que o sistema deu por pago.
 */
export function parcelaPaga(parcela: ExtratoClienteParcelaBruta): boolean {
  return Boolean(parcela.pagamento) || parcela.statusId === STATUS_PAGA;
}

/** Boleto emitido. Mesmo predicado do `hasBoletoLink` da CACÁ, sobre os campos crus. */
export function temBoleto(parcela: ExtratoClienteParcelaBruta): boolean {
  return Boolean((parcela.boletoUrl ?? "").trim() || (parcela.faturaUrl ?? "").trim());
}

/**
 * Os valores pagos que se REPETEM na série — os únicos que podem valer como valor de parcela.
 *
 * Quando paga, o `initial_value` às vezes ficou velho: o reajuste entrou só no boleto e ninguém
 * voltou para corrigir a linha (AR 183, parcelas 13 a 26: `initial_value` 389,79 e o cliente
 * pagando 412,20 — o reajuste REAL do contrato só existe ali). Mas o valor pago também carrega
 * MORA que o C2X não gravou em `interest_value` (medido: 707 parcelas), e aí a leitura ingênua
 * anuncia ao cliente um reajuste que nunca houve, com valor de origem e percentual errados
 * (AR 67: "de R$ 395,71 para R$ 412,20, +4,2%" quando o contrato diz 389,79 → 412,20, +5,75%).
 *
 * O que separa um do outro é a REPETIÇÃO AO LONGO DOS MESES: mora é juro por dia, cada atraso
 * dá um valor diferente; mensalidade corrigida se repete mês após mês. Contam-se DATAS DE
 * PAGAMENTO DISTINTAS, não parcelas — senão a quitação de um bloco de atrasadas, todas pelo
 * mesmo valor no mesmo dia, se corrobora sozinha (AR 187: R$ 475,00 nas parcelas 23, 25 e 26,
 * pagas juntas em 20/04/2026, viravam "mensalidade" e produziam uma queda de 13% logo depois).
 */
export function valoresCorroborados(
  serie: ExtratoClienteParcelaBruta[],
): ReadonlySet<number> {
  const datasPorValor = new Map<number, Set<string>>();

  for (const parcela of serie) {
    if (!parcelaPaga(parcela)) {
      continue;
    }
    const centavos = emCentavos(parcela.valorPago - parcela.juros - parcela.multa);
    if (centavos <= 0) {
      continue;
    }
    const datas = datasPorValor.get(centavos) ?? new Set<string>();
    // Baixa sem data (status 5) conta como ocasião própria — ver `parcelaPaga`.
    datas.add(parcela.pagamento ?? `#${parcela.id}`);
    datasPorValor.set(centavos, datas);
  }

  return new Set(
    Array.from(datasPorValor.entries())
      .filter(([, datas]) => datas.size >= OCORRENCIAS_PARA_CORROBORAR)
      .map(([centavos]) => centavos),
  );
}

/**
 * O valor que a parcela REALMENTE representa na linha do tempo do contrato: o maior entre o
 * `initial_value` e o pago LIMPO de encargos — este último SÓ quando corroborado (ver acima).
 * Sem corroboração o valor pago é ignorado e vale a linha de contrato.
 */
export function valorEfetivo(
  parcela: ExtratoClienteParcelaBruta,
  corroborados: ReadonlySet<number> = new Set(),
): number {
  if (!parcelaPaga(parcela)) {
    return parcela.valorInicial;
  }

  const limpo = parcela.valorPago - parcela.juros - parcela.multa;

  if (!corroborados.has(emCentavos(limpo))) {
    return parcela.valorInicial;
  }

  return Math.max(parcela.valorInicial, limpo);
}

/**
 * Vencimentos compartilhados por DUAS OU MAIS mensais do mesmo contrato = empilhamento por
 * acordo (existem 388 grupos assim no banco). Elas saem da série de degraus: os valores
 * decrescentes de um acordo (AR 383: 495,63 / 490,81 / 486,15 / 497,72 todas em 23/04/2026)
 * viram uma cascata de falsos "reajustes" se entrarem.
 */
export function vencimentosEmpilhados(
  parcelas: ExtratoClienteParcelaBruta[],
): Set<string> {
  const contagem = new Map<string, number>();

  for (const parcela of parcelas) {
    if (parcela.tipoId !== TIPO_MENSAL || !parcela.vencimento) {
      continue;
    }
    contagem.set(parcela.vencimento, (contagem.get(parcela.vencimento) ?? 0) + 1);
  }

  return new Set(
    Array.from(contagem.entries())
      .filter(([, total]) => total > 1)
      .map(([data]) => data),
  );
}

/**
 * TODAS as mensais do contrato, na ordem canônica (`current_total_parcel`, ver a nota 2).
 * Inclui as empilhadas por acordo: elas são dívida real e são evidência de valor cobrado —
 * o que elas não podem fazer é medir degrau (para isso existe a `serieMensal`).
 */
export function mensaisDoContrato(
  parcelas: ExtratoClienteParcelaBruta[],
): ExtratoClienteParcelaBruta[] {
  return parcelas
    .filter((parcela) => parcela.tipoId === TIPO_MENSAL && (parcela.parcelaAtual ?? 0) > 0)
    .sort((a, b) => (a.parcelaAtual ?? 0) - (b.parcelaAtual ?? 0));
}

/** A mediana do `initial_value` das mensais — o "tamanho normal" da mensalidade deste contrato. */
export function mensalidadeTipica(mensais: ExtratoClienteParcelaBruta[]): number {
  const valores = mensais
    .map((parcela) => parcela.valorInicial)
    .filter((valor) => valor > 0)
    .sort((a, b) => a - b);

  if (!valores.length) {
    return 0;
  }

  const meio = Math.floor(valores.length / 2);

  return valores.length % 2
    ? (valores[meio] ?? 0)
    : ((valores[meio - 1] ?? 0) + (valores[meio] ?? 0)) / 2;
}

/**
 * A linha se comporta como MENSALIDADE, e não como intermediária/balão/entrada disfarçada de
 * `parcel_type_id = 3`. Ver `FATOR_MENSALIDADE_ATIPICA` e o AR 3716.
 */
export function mensalidadePlausivel(valor: number, tipica: number): boolean {
  if (tipica <= 0 || valor <= 0) {
    return true;
  }

  return valor <= tipica * FATOR_MENSALIDADE_ATIPICA && valor * FATOR_MENSALIDADE_ATIPICA >= tipica;
}

/**
 * A SÉRIE canônica para MEDIR DEGRAU: as mensais plausíveis, sem as empilhadas, na ordem do
 * número da parcela.
 *
 * Se algum dos dois filtros esvaziar a série (contrato inteiro renegociado, ou plano em que a
 * mediana cai numa intermediária), volta com o conjunto anterior: melhor medir com ruído do que
 * não medir.
 */
export function serieMensal(
  parcelas: ExtratoClienteParcelaBruta[],
): ExtratoClienteParcelaBruta[] {
  const mensais = mensaisDoContrato(parcelas);
  const tipica = mensalidadeTipica(mensais);

  const tipicas = mensais.filter((parcela) =>
    mensalidadePlausivel(parcela.valorInicial, tipica),
  );
  const base = tipicas.length ? tipicas : mensais;

  const empilhados = vencimentosEmpilhados(parcelas);
  const limpa = base.filter(
    (parcela) => !parcela.vencimento || !empilhados.has(parcela.vencimento),
  );

  return limpa.length ? limpa : base;
}

/**
 * A MENSALIDADE VIGENTE: o maior `initial_value` entre as mensais PLAUSÍVEIS que ainda estão
 * vivas hoje — as em aberto e as que foram cobradas dentro do último ciclo anual.
 *
 * É a âncora do saldo a valor de hoje. As três regras, cada uma paga com um erro medido (ver a
 * nota 5 do cabeçalho):
 *
 *  • PLAUSÍVEL: o balão de R$ 22.250,25 do AR 3716 não é mensalidade e não levanta 83 parcelas
 *    de R$ 674,25 com ele.
 *  • MAIOR, não "a última": reajuste só sobe, e o valor novo tanto pode estar numa parcela sem
 *    boleto (AR 242) quanto numa que o filtro de acordo tira da série (AR 207, dois boletos no
 *    mesmo dia). Perseguir a "última" fazia a âncora andar para trás no tempo.
 *  • VIVA HOJE: sem a janela, um contrato renegociado para baixo voltaria a ser ancorado no
 *    valor velho, maior, e o extrato cobraria o que o acordo desfez.
 *
 * Sem nenhuma parcela viva (contrato antigo, todo vencido), cai nas cobradas; sem nada, 0.
 */
export function mensalidadeVigente(
  mensais: ExtratoClienteParcelaBruta[],
  hoje: string,
): number {
  const tipica = mensalidadeTipica(mensais);
  // Ordena aqui, e não só em `mensaisDoContrato`: `superadasPorCobrancaMenor` lê a série de trás
  // para frente e depende da ordem das parcelas, e esta função é exportada.
  const plausiveis = mensais
    .filter(
      (parcela) => parcela.valorInicial > 0 && mensalidadePlausivel(parcela.valorInicial, tipica),
    )
    .sort((a, b) => (a.parcelaAtual ?? 0) - (b.parcelaAtual ?? 0));

  if (!plausiveis.length) {
    return 0;
  }

  const cobrada = (parcela: ExtratoClienteParcelaBruta) =>
    temBoleto(parcela) || parcelaPaga(parcela);
  const emAberto = (parcela: ExtratoClienteParcelaBruta) =>
    !parcelaPaga(parcela) && (!parcela.vencimento || parcela.vencimento >= hoje);
  const cobradaNoCiclo = (parcela: ExtratoClienteParcelaBruta) =>
    cobrada(parcela) &&
    Boolean(parcela.vencimento) &&
    diasEntre(parcela.vencimento ?? hoje, hoje) <= JANELA_VIGENTE_DIAS;

  const vivas = plausiveis.filter(
    (parcela) => emAberto(parcela) || cobradaNoCiclo(parcela),
  );
  const cobradas = plausiveis.filter(cobrada);
  const consideradas = vivas.length ? vivas : cobradas.length ? cobradas : plausiveis;
  const superadas = superadasPorCobrancaMenor(plausiveis);

  const elegiveis = consideradas.filter((parcela) => !superadas.has(parcela.id));

  return (elegiveis.length ? elegiveis : consideradas).reduce(
    (maior, atual) => Math.max(maior, atual.valorInicial),
    0,
  );
}

/**
 * As parcelas que NÃO podem ancorar o saldo porque o próprio C2X já emitiu, DEPOIS delas, um
 * boleto de valor MENOR que não é a linha original do contrato.
 *
 * É a assinatura do acordo escalonado: o AR 417 (LOS1614) tem as parcelas 20-23 em R$ 672,80,
 * as 24-25 em R$ 557,37 e as 30 em diante na base de R$ 452,43, tudo com boleto. Ancorar no
 * maior levantava as futuras em 48,7% — uma parcela majorada por três meses virava "a
 * mensalidade do cliente".
 *
 * ⚠️ O "que não é a base" é o que separa isto da DEFASAGEM. No AR 242 a cobrança posterior menor
 * é exatamente o valor original do contrato: ali o boleto novo saiu com o valor velho porque
 * ninguém aplicou a correção, e a parcela maior continua sendo a mensalidade vigente.
 */
function superadasPorCobrancaMenor(
  plausiveis: ExtratoClienteParcelaBruta[],
): ReadonlySet<number> {
  // A linha original é a MAIS BAIXA da série, não a primeira: reajuste só sobe, e existe
  // contrato cuja série começa no meio, já reescrita (AR 4049 abre na parcela 27).
  const base = plausiveis.reduce(
    (menor, atual) => Math.min(menor, atual.valorInicial),
    Number.POSITIVE_INFINITY,
  );
  const superadas = new Set<number>();

  // Varredura de trás para frente: o menor valor já cobrado adiante, ignorando a linha de base.
  let menorAdiante = Number.POSITIVE_INFINITY;

  for (let indice = plausiveis.length - 1; indice >= 0; indice -= 1) {
    const parcela = plausiveis[indice];
    if (!parcela) {
      continue;
    }

    if (parcela.valorInicial > menorAdiante + CENTAVO) {
      superadas.add(parcela.id);
    }

    if (temBoleto(parcela) && Math.abs(parcela.valorInicial - base) > CENTAVO) {
      menorAdiante = Math.min(menorAdiante, parcela.valorInicial);
    }
  }

  return superadas;
}

/**
 * OS DEGRAUS — e por que nem todo degrau vira "reajuste".
 *
 * O reajuste não está gravado em lugar nenhum do C2X. Ele só existe como mudança de valor entre
 * mensais consecutivas. Mas há três outras coisas que também mudam o valor, e chamar qualquer
 * uma delas de "reajuste" numa peça assinada pela Careli seria mentir para o cliente:
 *
 *  • RETORNO À LINHA CONTRATUAL. A partir de certo ponto as parcelas simplesmente voltam ao
 *    valor de origem — não porque baixaram, mas porque a correção nunca chegou nelas (não têm
 *    boleto). Isso não é evento: é a FRONTEIRA DA DEFASAGEM. Quando esse retorno persiste até o
 *    fim da série, ele vira a nota do relatório (tipo "fronteira"); em qualquer outro caso,
 *    é descartado. Foi esta regra que matou o falso "reajuste" dos AR 87/88.
 *  • MORA. Juros diários do Asaas embutidos no valor pago produzem degraus pequenos que duram
 *    uma ou duas competências. Daí a exigência de persistir por 3.
 *  • RENEGOCIAÇÃO/ACORDO. Queda grande e persistente. É real, mas não é reajuste — sai como
 *    "Alteração de valor", sem rótulo que ela não merece.
 *
 * Só o que sobra — alta persistente de 2% ou mais — é chamado de reajuste.
 */
export function detectarEventosDeValor(
  serie: ExtratoClienteParcelaBruta[],
  vigente = 0,
): ExtratoClienteEvento[] {
  if (serie.length < 2) {
    return [];
  }

  const corroborados = valoresCorroborados(serie);
  const valores = serie.map((parcela) => valorEfetivo(parcela, corroborados));
  const base = serie[0]?.valorInicial ?? valores[0] ?? 0;
  const eventos: ExtratoClienteEvento[] = [];

  // Os patamares por onde a série já passou. Cair de volta num deles, numa parcela que nunca
  // recebeu boleto, é a correção que não chegou — nunca um acordo (ver `classificarDegrau`).
  const patamares = new Set<number>([emCentavos(base)]);

  let corrente = valores[0] ?? 0;

  for (let indice = 1; indice < serie.length; indice += 1) {
    const novo = valores[indice] ?? 0;

    if (Math.abs(novo - corrente) <= CENTAVO) {
      patamares.add(emCentavos(novo));
      continue;
    }

    // Quantas parcelas consecutivas seguram o valor novo.
    let persistencia = 1;
    while (
      indice + persistencia < valores.length &&
      Math.abs((valores[indice + persistencia] ?? 0) - novo) <= CENTAVO
    ) {
      persistencia += 1;
    }

    const ateOFim = indice + persistencia >= valores.length;
    const variacao = corrente > 0 ? novo / corrente - 1 : 0;
    const parcela = serie[indice];
    const tipo = classificarDegrau({
      ateOFim,
      base,
      corrente,
      novo,
      patamarConhecido: patamares.has(emCentavos(novo)),
      persistencia,
      semBoleto: parcela ? !temBoleto(parcela) : true,
      variacao,
      vigente,
    });

    if (tipo) {
      eventos.push({
        competencia: competenciaCurta(parcela?.competencia ?? null),
        de: corrente,
        parcela: parcela?.parcelaAtual ?? indice + 1,
        para: novo,
        persistencia,
        rotulo: rotuloDoEvento(tipo, {
          competencia: competenciaCurta(parcela?.competencia ?? null),
          de: corrente,
          para: novo,
          variacao,
        }),
        tipo,
        variacao,
      });
    }

    patamares.add(emCentavos(novo));
    corrente = novo;
  }

  // O MESMO DEGRAU NÃO SAI DUAS VEZES NA PEÇA. Uma série serrilhada por mora (AR 58: 408,06,
  // 389,79, 408,06...) produz o mesmo "de → para" em dois pontos, e o cliente leria dois
  // reajustes idênticos onde houve um. Fica o primeiro, que é onde a correção começou.
  const vistos = new Set<string>();

  return eventos.filter((evento) => {
    const chave = `${evento.tipo}:${emCentavos(evento.de)}:${emCentavos(evento.para)}`;
    if (vistos.has(chave)) {
      return false;
    }
    vistos.add(chave);
    return true;
  });
}

function classificarDegrau({
  ateOFim,
  base,
  corrente,
  novo,
  patamarConhecido,
  persistencia,
  semBoleto,
  variacao,
  vigente,
}: {
  ateOFim: boolean;
  base: number;
  corrente: number;
  novo: number;
  patamarConhecido: boolean;
  persistencia: number;
  semBoleto: boolean;
  variacao: number;
  vigente: number;
}): ExtratoClienteEventoTipo | null {
  // Voltou para a linha contratual: não é evento. Se, além disso, cair DA MENSALIDADE VIGENTE e
  // persistir até o fim, é a fronteira da defasagem — o relatório usa isso como NOTA, não como
  // evento.
  //
  // ⚠️ A EXIGÊNCIA DE VIR DA VIGENTE NÃO É DECORAÇÃO. Sem ela, o AR 292 (MDS0802) produzia uma
  // "fronteira" falsa: a parcela 1 foi paga com R$ 25,46 de mora que o C2X NÃO gravou em
  // `interest_value` (medido: 899,77 de contrato, 925,23 pagos, juros 0,00), então o valor
  // efetivo da primeira parcela ficou acima da base e a segunda "caiu" de volta. Aquele
  // contrato não tem reajuste nenhum — é inadimplente desde a parcela 2 —, e o extrato ia
  // anunciar uma defasagem inexistente ao cliente.
  // A FRONTEIRA DA DEFASAGEM: cai DA MENSALIDADE VIGENTE, em parcela que nunca recebeu boleto,
  // e fica assim até o fim da série. É o ponto exato onde a correção parou de alcançar as linhas
  // do banco — vira a NOTA do relatório, nunca uma linha de "alteração de valor".
  //
  // ⚠️ O DESTINO NÃO PRECISA SER A PRIMEIRA LINHA DO CONTRATO. Foi a versão anterior, e ela
  // deixava passar os casos em que as parcelas futuras carregam um valor que nunca foi cobrado
  // (AR 227: pagou de 383,94 a 470,81 e as parcelas de 2027 constam por 380,69; AR 4049: a
  // série começa no meio, já reescrita). Sem isso, a queda saía impressa como acordo.
  //
  // ⚠️ E A EXIGÊNCIA DE VIR DA VIGENTE NÃO É DECORAÇÃO — ver o AR 292 no comentário acima.
  if (variacao < 0 && semBoleto && ateOFim && Math.abs(corrente - vigente) <= CENTAVO) {
    return "fronteira";
  }

  if (Math.abs(novo - base) <= CENTAVO) {
    return null;
  }

  // Queda para um patamar por onde a série já passou, em parcela sem boleto: também é a
  // correção que não chegou, só que num trecho que ainda tem parcelas cobradas depois.
  if (variacao < 0 && semBoleto && patamarConhecido) {
    return null;
  }

  if (persistencia < PERSISTENCIA_MINIMA || Math.abs(variacao) < VARIACAO_MINIMA) {
    return null;
  }

  return variacao >= REAJUSTE_MINIMO ? "reajuste" : "alteracao";
}

function rotuloDoEvento(
  tipo: ExtratoClienteEventoTipo,
  dados: { competencia: null | string; de: number; para: number; variacao: number },
): string {
  const quando = dados.competencia ? ` em ${dados.competencia}` : "";
  const de = dinheiro(dados.de);
  const para = dinheiro(dados.para);
  const pct = percentual(dados.variacao);

  if (tipo === "reajuste") {
    return `Reajuste contratual aplicado${quando}: de ${de} para ${para} (${pct}).`;
  }

  if (tipo === "alteracao") {
    return `Alteração de valor${quando}: de ${de} para ${para} (${pct}).`;
  }

  // Vale tanto para o retorno à primeira linha do contrato quanto para a parada num patamar
  // intermediário: nos dois casos é a correção que ainda não alcançou aquelas linhas.
  return `A partir da parcela com competência${quando} as parcelas ainda constam por ${para}, sem a correção anual aplicada; ela é lançada na emissão de cada boleto.`;
}

/**
 * Monta o extrato de UM contrato. Função pura: recebe o cabeçalho do contrato, as linhas de
 * `payments` e a data de referência; devolve a peça inteira, ressalvas incluídas.
 */
export function montarExtratoDoContrato({
  contrato,
  hoje,
  parcelas,
}: {
  contrato: ExtratoClienteContrato;
  hoje: string;
  parcelas: ExtratoClienteParcelaBruta[];
}): ExtratoClienteRelatorio {
  const ativas = parcelas.filter(parcelaAtiva);
  const mensais = mensaisDoContrato(ativas);
  const tipica = mensalidadeTipica(mensais);
  // A ÂNCORA LÊ TODAS AS MENSAIS, a série de degraus lê as limpas. São perguntas diferentes:
  // "quanto vale a mensalidade hoje" aceita a parcela empilhada por acordo como evidência de
  // cobrança; "onde o valor mudou" não, senão a cascata de mora vira reajuste.
  const vigente = mensalidadeVigente(mensais, hoje);
  const serie = serieMensal(ativas);
  const empilhados = vencimentosEmpilhados(ativas);
  const eventos = detectarEventosDeValor(serie, vigente);

  const linhas = ativas.map((parcela) =>
    montarLinha({ empilhados, hoje, parcela, tipica, vigente }),
  );

  // A "mensalidade base" impressa é o valor que as parcelas DEFASADAS ainda carregam — ou seja,
  // o menor valor entre as que precisaram ser trazidas à vigente. Não é `serie[0]`: existe
  // contrato cuja parcela 1 já foi reescrita para um valor corrigido, e aí a base lida no início
  // da série mediria zero de defasagem enquanto o saldo aparece levantado, sem explicação na
  // peça. Sem nenhuma parcela levantada, não há defasagem a declarar.
  const levantadas = linhas.filter((linha) => linha.trazidaAValorDeHoje);
  const base = levantadas.length
    ? Math.min(...levantadas.map((linha) => linha.valorContratual))
    : (serie[0]?.valorInicial ?? 0);

  const realizados = linhas
    .filter((linha) => linha.situacao === "paga")
    .sort(ordenarPorPagamento);

  // CONTRATO ENCERRADO NÃO TEM PARCELA EM ABERTO — e a lista some INTEIRA, não só os totais.
  //
  // A versão anterior zerava `saldo*` e `vencidasTotal` mas deixava as linhas de pé, apostando
  // que o C2X apagava as parcelas no cancelamento. Não apaga: o AR 271 (MDS0203, cancelado) tem
  // 120 parcelas em aberto, e a peça saía com "PARCELAS EM ATRASO (3)", três linhas de
  // R$ 1.204,87 e "Total em atraso: R$ 0,00" na mesma página em que a tarja dizia que não há
  // saldo a apresentar. Cobrança fantasma num documento que vai à mão do cliente.
  const abertas = contrato.encerrado
    ? []
    : linhas.filter((linha) => linha.situacao !== "paga").sort(ordenarPorVencimento);

  const vencidas = abertas.filter((linha) => linha.situacao === "vencida");
  const aVencer = abertas.filter((linha) => linha.situacao === "a_vencer");
  const proxima = aVencer[0];

  const totais: ExtratoClienteTotais = {
    defasagem: base > 0 && vigente > base ? vigente / base - 1 : 0,
    diasAtrasoMax: vencidas.reduce((maior, linha) => Math.max(maior, linha.diasAtraso), 0),
    mensalidadeBase: base,
    mensalidadeVigente: contrato.encerrado ? 0 : vigente,
    parcelasAbertas: abertas.length,
    parcelasPagas: realizados.length,
    parcelasTotal: contrato.encerrado ? realizados.length : linhas.length,
    primeiroPagamento: datasDePagamento(realizados)[0] ?? null,
    proximoVencimento:
      proxima?.vencimento != null
        ? { valor: proxima.valorAtual, vencimento: proxima.vencimento }
        : null,
    saldoAValorDeHoje: soma(abertas.map((linha) => linha.valorAtual)),
    saldoNominal: soma(abertas.map((linha) => linha.valorContratual)),
    // O par de colunas da tabela "Pagamentos realizados": o valor de contrato das parcelas
    // quitadas e o que de fato entrou. Mesma lista (`realizados`), duas somas — o rodapé da
    // tabela fecha com as linhas impressas acima dele.
    totalContratualPago: soma(realizados.map((linha) => linha.valorContratual)),
    totalPago: soma(realizados.map((linha) => linha.valorPago ?? 0)),
    ultimoPagamento: datasDePagamento(realizados).at(-1) ?? null,
    vencidaMaisAntiga: vencidas[0]?.vencimento ?? null,
    vencidasQuantidade: vencidas.length,
    vencidasTotal: soma(vencidas.map((linha) => linha.valorContratual)),
  };

  return {
    abertas,
    contrato,
    eventos,
    notas: montarNotas({ contrato, eventos, hoje, totais }),
    posicaoEm: hoje,
    realizados,
    totais,
  };
}

function montarLinha({
  empilhados,
  hoje,
  parcela,
  tipica,
  vigente,
}: {
  empilhados: Set<string>;
  hoje: string;
  parcela: ExtratoClienteParcelaBruta;
  tipica: number;
  vigente: number;
}): ExtratoClienteParcela {
  const paga = parcelaPaga(parcela);
  const boleto = temBoleto(parcela);
  const vencida = !paga && Boolean(parcela.vencimento) && (parcela.vencimento ?? "") < hoje;

  // A ÚNICA correção que este relatório aplica: mensal em aberto que nunca recebeu boleto
  // carrega o valor cru do contrato. Trazer para a mensalidade vigente é atualizar o que JÁ foi
  // corrigido no mundo real e não chegou à linha do banco. Ato, Sinal e Avulso não entram: não
  // são corrigidos por índice, e o Avulso de acordo tem valor negociado. Uma intermediária
  // disfarçada de mensal (ver `mensalidadePlausivel`) também não: ela não segue o índice.
  const elegivel =
    !paga &&
    parcela.tipoId === TIPO_MENSAL &&
    !boleto &&
    mensalidadePlausivel(parcela.valorInicial, tipica) &&
    parcela.valorInicial < vigente - CENTAVO;

  return {
    competencia: competenciaCurta(parcela.competencia),
    descricao: (parcela.descricao ?? "").trim() || null,
    diasAtraso: vencida ? diasEntre(parcela.vencimento ?? hoje, hoje) : 0,
    empilhada:
      parcela.tipoId === TIPO_MENSAL &&
      Boolean(parcela.vencimento) &&
      empilhados.has(parcela.vencimento ?? ""),
    id: parcela.id,
    juros: paga ? parcela.juros : 0,
    multa: paga ? parcela.multa : 0,
    numero: numeroDaParcela({
      parcelaAtual: parcela.parcelaAtual,
      parcelaTotal: parcela.parcelaTotal,
      sinalAtual: parcela.sinalAtual,
      sinalTotal: parcela.sinalTotal,
      tipo: parcela.tipo,
    }),
    ordem: parcela.parcelaAtual ?? 0,
    pagamento: parcela.pagamento,
    situacao: paga ? "paga" : vencida ? "vencida" : "a_vencer",
    temBoleto: boleto,
    tipo: (parcela.tipo ?? "").trim() || nomeDoTipo(parcela.tipoId),
    tipoId: parcela.tipoId,
    trazidaAValorDeHoje: elegivel,
    // Nas pagas o "valor atual" é o que entrou no caixa; nas abertas, o valor de cobrança.
    valorAtual: paga ? parcela.valorPago : elegivel ? vigente : parcela.valorInicial,
    valorContratual: parcela.valorInicial,
    valorPago: paga ? parcela.valorPago : null,
    vencimento: parcela.vencimento,
  };
}

/**
 * As ressalvas. Ficam NA PEÇA, em corpo de texto, não em rodapé escondido — é a diferença entre
 * um documento que o backoffice vai ter que desdizer em seis meses e um que se sustenta.
 */
function montarNotas({
  contrato,
  eventos,
  hoje,
  totais,
}: {
  contrato: ExtratoClienteContrato;
  eventos: ExtratoClienteEvento[];
  hoje: string;
  totais: ExtratoClienteTotais;
}): string[] {
  const notas: string[] = [];

  if (contrato.encerrado) {
    // Sem jargão de sistema na peça do cliente: "no C2X" saía impresso.
    notas.push(
      `Contrato ${situacaoParaOComprador(contrato).toLowerCase()}. Este extrato reflete apenas os valores já pagos; não há saldo devedor a apresentar.`,
    );
    notas.push(
      "Para tratativas sobre o encerramento do contrato, procure a central de atendimento.",
    );
    return notas;
  }

  const indice = contrato.indiceCorrecao
    ? `pelo índice ${contrato.indiceCorrecao}`
    : "conforme a cláusula de correção do contrato";

  if (totais.mensalidadeVigente > 0) {
    notas.push(
      `Saldo apurado com a parcela vigente de ${dinheiro(totais.mensalidadeVigente)} (posição de ${dataBr(hoje)}). As parcelas futuras ainda serão corrigidas anualmente ${indice}, portanto este valor tende a variar.`,
    );
  }

  if (totais.defasagem > 0) {
    // ⚠️ A DIREÇÃO. `defasagem` é vigente/base − 1: quanto a VIGENTE está ACIMA do valor
    // original. Escrever "X% abaixo da parcela vigente" com esse mesmo número invertia a
    // conta (389,79 está 18,5% abaixo de 477,98, não 22,6%) — e a peça se contradizia, porque
    // o rodapé da tabela já dizia "22,6% acima do valor original".
    notas.push(
      `As parcelas mais distantes ainda constam pelo valor original de contrato (${dinheiro(totais.mensalidadeBase)}); a parcela vigente está ${percentualSimples(totais.defasagem)} acima desse valor, porque a correção anual é aplicada na emissão de cada boleto. O saldo pelos valores originais seria de ${dinheiro(totais.saldoNominal)}.`,
    );
  }

  notas.push(
    "Os valores em aberto não incluem juros e multa de parcelas em atraso, que são apurados na data do pagamento.",
  );
  notas.push(
    "Para quitação antecipada, solicite o cálculo específico à central de atendimento.",
  );

  if (eventos.some((evento) => evento.tipo === "alteracao")) {
    // ⚠️ NÃO PROMETA ACORDO. A nota anterior dizia que toda alteração "reflete renegociações ou
    // acordos registrados no contrato". Varridos os eventos do banco inteiro, UM tinha acordo
    // registrado; o resto era mora paga e defasagem — a peça entregava ao cliente uma redução
    // negociada que ninguém negociou. O que o relatório sabe é que o valor mudou; quem sabe o
    // porquê é a central.
    notas.push(
      "As alterações de valor listadas abaixo foram apuradas pela variação do valor das parcelas ao longo do contrato. Para o detalhamento de cada uma, procure a central de atendimento.",
    );
  }

  return notas;
}

/**
 * O ESTÁGIO DO C2X EM VOCABULÁRIO DE COMPRADOR.
 *
 * "Faturado", "Contrato gerado", "Em assinatura" e "Reservado" são etapas do processo interno de
 * venda; impressas no campo "Situação" de um extrato, não dizem nada a quem comprou o lote — e
 * "Faturado" chega a sugerir cobrança fechada. O que o cliente precisa ler é se o contrato está
 * ativo ou encerrado.
 */
export function situacaoParaOComprador(contrato: ExtratoClienteContrato): string {
  if (contrato.estagio === 7) return "Cancelado";
  if (contrato.estagio === 10) return "Em distrato";
  if (contrato.estagio === 11) return "Distratado";
  if (contrato.encerrado) return contrato.estagioNome ?? "Encerrado";
  // 6 = "Finalizado" no C2X. Não é sinônimo de quitado, e prometer quitação por estágio seria
  // exatamente o tipo de número seco que este relatório evita.
  if (contrato.estagio === 6) return "Contrato finalizado";
  // 1 Reservado, 2 Análise de crédito, 9 Proposta realizada: ainda não é contrato em curso.
  if ([1, 2, 9].includes(contrato.estagio)) return "Em contratação";

  return "Contrato ativo";
}

export type ExtratoClienteAno = {
  /** Ano do vencimento. */
  ano: string;
  /** Soma trazida à mensalidade vigente. */
  atualizado: number;
  /** Soma pelos valores originais de contrato. */
  nominal: number;
  quantidade: number;
};

/**
 * As parcelas em aberto agrupadas por ano de vencimento.
 *
 * Um contrato de 144 meses tem 110+ linhas em aberto; imprimir todas viraria um calhamaço de
 * seis páginas que o cliente não lê e que a Careli paga para imprimir. O ano responde a pergunta
 * que ele faz ("quanto falta e até quando"), e as vencidas — as que importam linha a linha —
 * saem listadas em bloco próprio.
 */
export function resumoPorAno(abertas: ExtratoClienteParcela[]): ExtratoClienteAno[] {
  const mapa = new Map<string, ExtratoClienteAno>();

  for (const parcela of abertas) {
    const ano = (parcela.vencimento ?? "").slice(0, 4) || "-";
    const atual = mapa.get(ano) ?? { ano, atualizado: 0, nominal: 0, quantidade: 0 };

    atual.atualizado += parcela.valorAtual;
    atual.nominal += parcela.valorContratual;
    atual.quantidade += 1;
    mapa.set(ano, atual);
  }

  return Array.from(mapa.values())
    .map((linha) => ({
      ...linha,
      atualizado: Math.round(linha.atualizado * 100) / 100,
      nominal: Math.round(linha.nominal * 100) / 100,
    }))
    .sort((a, b) => a.ano.localeCompare(b.ano));
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// FORMATADORES compartilhados (a tela e o PDF usam os mesmos, para dizerem a MESMA coisa).
// ────────────────────────────────────────────────────────────────────────────────────────────

export function dinheiro(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number.isFinite(valor) ? valor : 0);
}

/** Formata a magnitude com uma casa e separador de milhar — "3.200,0", não "3200,0". */
function numeroPtBr(valor: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 1,
    minimumFractionDigits: 1,
  }).format(Number.isFinite(valor) ? valor : 0);
}

export function percentual(fracao: number): string {
  const pct = (Number.isFinite(fracao) ? fracao : 0) * 100;
  const sinal = pct > 0 ? "+" : "";
  return `${sinal}${numeroPtBr(pct)}%`;
}

/** Só a magnitude, sem sinal — para frases que já dizem a direção ("10,0% acima de"). */
export function percentualSimples(fracao: number): string {
  return `${numeroPtBr(Math.abs(Number.isFinite(fracao) ? fracao : 0) * 100)}%`;
}

/** "1 parcela" / "3 parcelas" — a peça vai ao cliente, e "1 parcelas" denuncia o robô. */
export function contarParcelas(quantidade: number): string {
  return `${quantidade} ${quantidade === 1 ? "parcela" : "parcelas"}`;
}

/** 'YYYY-MM-DD' -> 'dd/mm/aaaa'. Devolve "-" para vazio. */
export function dataBr(valor: null | string): string {
  const match = valor ? /^(\d{4})-(\d{2})-(\d{2})/.exec(valor) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "-";
}

/** 'YYYY-MM-DD' -> 'MM/AAAA'. */
export function competenciaCurta(valor: null | string): null | string {
  const match = valor ? /^(\d{4})-(\d{2})/.exec(valor) : null;
  return match ? `${match[2]}/${match[1]}` : null;
}

/**
 * Mascara CPF/CNPJ para impressão: preserva o miolo (que o titular reconhece) e esconde o começo
 * e o fim. O extrato circula por WhatsApp e e-mail; documento inteiro impresso é vazamento
 * gratuito.
 */
export function mascararDocumento(valor: null | string): null | string {
  const digitos = (valor ?? "").replace(/\D/g, "");

  if (digitos.length === 11) {
    return `***.${digitos.slice(3, 6)}.${digitos.slice(6, 9)}-**`;
  }

  if (digitos.length === 14) {
    return `**.${digitos.slice(2, 5)}.${digitos.slice(5, 8)}/${digitos.slice(8, 12)}-**`;
  }

  return (valor ?? "").trim() || null;
}

/** Data de hoje no fuso de Brasília — o servidor do C2X roda em UTC e viraria o dia às 21h. */
export function hojeEmBrasilia(agora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  }).format(agora);

  return partes;
}

function nomeDoTipo(tipoId: number): string {
  if (tipoId === TIPO_ATO) return "Ato";
  if (tipoId === TIPO_SINAL) return "Sinal";
  if (tipoId === TIPO_MENSAL) return "Parcela";
  if (tipoId === TIPO_AVULSO) return "Avulso";
  return "-";
}

/** As datas de pagamento realmente registradas, em ordem — sem as baixas sem data. */
function datasDePagamento(realizados: ExtratoClienteParcela[]): string[] {
  return realizados
    .map((linha) => linha.pagamento)
    .filter((data): data is string => Boolean(data))
    .sort((a, b) => a.localeCompare(b));
}

/** Dinheiro como inteiro de centavos: chave estável para comparar valores pagos. */
function emCentavos(valor: number): number {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100);
}

function soma(valores: number[]): number {
  // Arredonda no fim: somar centavos em ponto flutuante rende 43229.659999999996.
  return Math.round(valores.reduce((total, valor) => total + valor, 0) * 100) / 100;
}

function diasEntre(inicio: string, fim: string): number {
  const a = Date.parse(`${inicio}T00:00:00Z`);
  const b = Date.parse(`${fim}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    return 0;
  }
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function ordenarPorPagamento(a: ExtratoClienteParcela, b: ExtratoClienteParcela): number {
  // Parcela com baixa e SEM data de pagamento existe (status 5, ver `parcelaPaga`): sem o
  // fallback ela iria para o topo da lista, antes do primeiro pagamento real do cliente.
  const chave = (a.pagamento ?? a.vencimento ?? "").localeCompare(
    b.pagamento ?? b.vencimento ?? "",
  );
  return chave !== 0 ? chave : a.ordem - b.ordem || a.id - b.id;
}

function ordenarPorVencimento(a: ExtratoClienteParcela, b: ExtratoClienteParcela): number {
  const chave = (a.vencimento ?? "").localeCompare(b.vencimento ?? "");
  return chave !== 0 ? chave : a.ordem - b.ordem || a.id - b.id;
}
