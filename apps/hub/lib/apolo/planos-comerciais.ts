// PLANOS COMERCIAIS — a regra de cálculo, pura e sem dependências.
//
// ⚠️ POR QUE ESTE ARQUIVO EXISTE (Lucas, 28-29/08/2026): *"cada empreendimento vai ter uma
// tabela, planos comerciais, vamos ter que alimentar isso em outro lugar (...) esse
// empreendimento é price, mas o mais comum seria sacoc"*. Até aqui os três planos da Proposta
// de Aquisição estavam FIXOS em modules/prometeu/blocks/pa/imprimir-pa.ts, com os números do
// Villa Paris, impressos em qualquer lançamento.
//
// ⚠️ O QUE A MEDIÇÃO NO C2X MOSTROU (29/08/2026) — e que muda o cálculo, não só os números:
//
//   1. DOS 24 EMPREENDIMENTOS com planos cadastrados, 21 são SACOOC e 3 são PRICE. O plano
//      NORMAL vai de 37 a 200 parcelas. Não existe "número da casa": cada lançamento é um.
//
//   2. NOS 9 EMPREENDIMENTOS SACOOC com parcelas já emitidas, a parcela do contrato é a
//      AMORTIZAÇÃO PURA — financiado ÷ n, sem juros embutidos. Conferido contra `payments`,
//      contrato a contrato. O único PRICE com parcelas emitidas (MDS) bate na Price exata.
//      Ou seja: `enterprises.enterprise_table_id` de fato governa a matemática do boleto.
//
//   3. A CONVENÇÃO DA TAXA no C2X é a EQUIVALENTE, não a proporcional. As taxas mensais
//      gravadas são 0,6434 e 0,7207, que são (1,08)^(1/12)−1 e (1,09)^(1/12)−1 exatas. A
//      proporcional de 8% seria 0,6667, que não aparece uma única vez no banco.
//      ⚠️ O comentário antigo de imprimir-pa.ts afirmava o contrário. Estava errado.
//
// A PA TEM QUE ANUNCIAR O QUE O C2X VAI EMITIR. Quando os dois divergem, quem está errado é o
// papel — o boleto vem do C2X. Por isso o sistema de amortização não é enfeite: é a diferença
// entre prometer 120× de R$ 2.402 e emitir 180× de R$ 1.100.

export type SistemaAmortizacao = "price" | "sac" | "sacoc";

/** anual | mensal — a unidade de `jurosTaxa`. Ver o aviso em `taxaMensal`. */
export type PeriodicidadeJuros = "anual" | "mensal";

/** Como uma taxa ANUAL vira mensal. Só se aplica quando a periodicidade é anual. */
export type ConvencaoJuros = "equivalente" | "proporcional";

export type IndiceCorrecao =
  | "IGPM_ANUAL"
  | "INCC_M_MENSAL"
  | "IPCA_ANUAL"
  | "IPCA_MENSAL"
  | "SEM_CORRECAO";

export type PlanoComercial = {
  /** % de entrada/sinal, de 0 a 100 — como o C2X grava e como o comercial fala. NUNCA fração. */
  entradaPercentual: number;
  indiceCorrecao: IndiceCorrecao;
  /** A taxa crua. Nulo = plano sem juros (é o caso de INVESTIDOR e CURTO em quase todos). */
  jurosTaxa: null | number;
  jurosConvencao: ConvencaoJuros;
  jurosPeriodicidade: PeriodicidadeJuros;
  nome: string;
  parcelas: number;
  sistemaAmortizacao: SistemaAmortizacao;
  /** Onde o plano entra na folha. Nulo = existe no cadastro mas não vai ao papel. */
  slot: null | SlotDaPa;
};

export type SlotDaPa = "avista" | "curto" | "investidor" | "normal";

/**
 * Como a parcela se comporta ao longo do contrato. Vai para o rodapé da linha do plano,
 * porque "120× de R$ 1.100" significa coisas diferentes em cada sistema e o cliente assina
 * embaixo.
 */
export type NaturezaDaParcela =
  /** Não muda (fora correção monetária): Price, ou SACOC/SAC sem juros. */
  | "fixa"
  /** Sobe de degrau no aniversário: SACOC com juros. É o valor do primeiro ciclo. */
  | "inicial"
  /** Decresce mês a mês: SAC. É a primeira, a maior de todas. */
  | "primeira";

export type ParcelaCalculada = {
  financiado: null | number;
  naturezaDaParcela: NaturezaDaParcela;
  parcela: null | number;
  parcelas: number;
  sinal: null | number;
};

const INDICES: Record<IndiceCorrecao, string> = {
  IGPM_ANUAL: "IGP-M anual",
  INCC_M_MENSAL: "INCC-M mensal",
  IPCA_ANUAL: "IPCA anual",
  IPCA_MENSAL: "IPCA mensal",
  SEM_CORRECAO: "sem correção",
};

/**
 * Converte a taxa contratual para a taxa MENSAL usada no cálculo.
 *
 * ⚠️ A PERIODICIDADE NÃO É DETALHE. No C2X, `contractual_interest` guarda 8.0000 (ao ano) na
 * Lavra do Ouro e 0.6434 (ao mês) no Villa Paris — a MESMA taxa econômica, gravada de dois
 * jeitos, sem nada no schema dizendo qual é qual. Ler errado multiplica ou divide a parcela
 * por doze.
 *
 * ⚠️ A CONVENÇÃO É ESCOLHA DE DINHEIRO, e o default é a EQUIVALENTE porque é o que o C2X
 * grava: 0,6434% é (1,08)^(1/12)−1 com quatro casas, e 0,7207% é (1,09)^(1/12)−1. A
 * proporcional (i/12) continua disponível por plano, mas tem que ser escolhida à vista, não
 * herdada em silêncio — num financiamento de 120 parcelas ela custa ~1% a mais por parcela.
 */
export function taxaMensal(plano: PlanoComercial): number {
  const taxa = plano.jurosTaxa;
  if (taxa == null || taxa <= 0) return 0;
  const fracao = taxa / 100;
  if (plano.jurosPeriodicidade === "mensal") return fracao;
  if (plano.jurosConvencao === "proporcional") return fracao / 12;
  return (1 + fracao) ** (1 / 12) - 1;
}

/** Parcela da Tabela Price: PV · i ÷ (1 − (1+i)^−n). Com i = 0, vira divisão simples. */
export function parcelaPrice(
  financiado: number,
  taxaAoMes: number,
  parcelas: number,
): number {
  if (parcelas <= 0) return 0;
  if (taxaAoMes <= 0) return financiado / parcelas;
  const fator = (1 + taxaAoMes) ** -parcelas;
  return (financiado * taxaAoMes) / (1 - fator);
}

/**
 * A parcela que o contrato do SACOC realmente emite: a amortização pura.
 *
 * ⚠️ NÃO É O SAC DO LIVRO. No SAC clássico a parcela do mês k é amortização + juros sobre o
 * saldo, e decresce. No SACOC da casa — modelo decodificado na Lavra do Ouro e validado
 * célula a célula — a parcela EMITIDA é só a amortização; os juros são acumulados numa curva
 * teórica e cobrados de uma vez no aniversário, quando a parcela sobe de degrau.
 *
 * Medido em 9 de 9 empreendimentos SACOOC com parcelas emitidas. Villa Paris, unidade de
 * R$ 220.000 com 10% de sinal: 180 parcelas de R$ 1.100,00 = 198.000 ÷ 180, exato.
 */
export function parcelaSacoc(financiado: number, parcelas: number): number {
  if (parcelas <= 0) return 0;
  return financiado / parcelas;
}

/**
 * A PRIMEIRA parcela do SAC clássico — a maior, porque incide sobre o saldo cheio.
 *
 * Nenhum empreendimento usa isto hoje (o C2X só tem PRICE e SACOOC em `enterprise_tables`).
 * Existe porque "SAC" e "SACOC" são palavras vizinhas e alguém vai cadastrar uma achando que
 * é a outra; sem a distinção no código, o erro sairia calado no papel.
 */
export function primeiraParcelaSac(
  financiado: number,
  taxaAoMes: number,
  parcelas: number,
): number {
  if (parcelas <= 0) return 0;
  return financiado / parcelas + financiado * taxaAoMes;
}

/**
 * A parcela NIVELADA do primeiro ciclo do SACOC: amortização mais a média dos juros teóricos
 * dos doze primeiros meses.
 *
 * ⚠️ NÃO É O QUE A FOLHA IMPRIME HOJE, e a diferença é uma decisão comercial em aberto: a
 * amortização pura é o que o boleto traz no primeiro ano, e esta é o que o cliente passa a
 * pagar do 13º mês em diante. Imprimir a primeira anuncia uma parcela que sobe depois;
 * imprimir esta anuncia uma parcela maior do que o primeiro boleto. Fica aqui para a escolha
 * ser um parâmetro, e não uma reescrita.
 */
export function parcelaNiveladaSacoc(
  financiado: number,
  taxaAoMes: number,
  parcelas: number,
  mesesDoCiclo = 12,
): number {
  const amortizacao = parcelaSacoc(financiado, parcelas);
  if (taxaAoMes <= 0 || parcelas <= 0) return amortizacao;
  const ciclo = Math.min(mesesDoCiclo, parcelas);
  let juros = 0;
  for (let k = 1; k <= ciclo; k += 1) {
    juros += amortizacao * (1 + taxaAoMes) ** k - amortizacao;
  }
  return amortizacao + juros / ciclo;
}

/**
 * O que sai na linha do plano: sinal, quantas parcelas e de quanto.
 *
 * Sem preço de tabela devolve nulos — a folha imprime a linha em branco, para preencher à
 * mão, em vez de sumir com o plano.
 */
export function calcularParcela(
  plano: PlanoComercial,
  precoTabela: null | number,
): ParcelaCalculada {
  const i = taxaMensal(plano);
  const natureza: NaturezaDaParcela =
    plano.sistemaAmortizacao === "sac"
      ? "primeira"
      : plano.sistemaAmortizacao === "sacoc" && i > 0
        ? "inicial"
        : "fixa";

  if (precoTabela == null) {
    return {
      financiado: null,
      naturezaDaParcela: natureza,
      parcela: null,
      parcelas: plano.parcelas,
      sinal: null,
    };
  }

  const sinal = (precoTabela * plano.entradaPercentual) / 100;
  const financiado = precoTabela - sinal;

  const parcela =
    plano.sistemaAmortizacao === "price"
      ? parcelaPrice(financiado, i, plano.parcelas)
      : plano.sistemaAmortizacao === "sac"
        ? primeiraParcelaSac(financiado, i, plano.parcelas)
        : parcelaSacoc(financiado, plano.parcelas);

  return {
    financiado,
    naturezaDaParcela: natureza,
    parcela,
    parcelas: plano.parcelas,
    sinal,
  };
}

/** "8% a.a." / "0,6434% a.m." / "" quando não há juros. */
export function textoDaTaxa(plano: PlanoComercial): string {
  const taxa = plano.jurosTaxa;
  if (taxa == null || taxa <= 0) return "";
  const numero = String(Number(taxa.toFixed(4))).replace(".", ",");
  return `${numero}% ${plano.jurosPeriodicidade === "anual" ? "a.a." : "a.m."}`;
}

/**
 * A frase miúda no fim da linha do plano — "Price, 8% a.a. + IPCA anual".
 *
 * ⚠️ DERIVADA, NUNCA DIGITADA. Antes ela era string fixa ao lado de números calculados, e as
 * duas podiam discordar sem ninguém perceber: a linha dizia "Price 8%" enquanto a conta usava
 * outra taxa. Saindo do mesmo objeto que alimenta o cálculo, elas não têm como divergir.
 */
export function fraseDeCorrecao(plano: PlanoComercial): string {
  const partes: string[] = [];
  const taxa = textoDaTaxa(plano);

  if (!taxa) {
    partes.push("sem juros");
  } else if (plano.sistemaAmortizacao === "price") {
    partes.push(`Price, ${taxa}`);
  } else if (plano.sistemaAmortizacao === "sac") {
    partes.push(`SAC, ${taxa}, parcela decrescente`);
  } else {
    partes.push(`${taxa}, reajuste no aniversário`);
  }

  partes.push(
    plano.indiceCorrecao === "SEM_CORRECAO"
      ? "sem correção"
      : `com ${INDICES[plano.indiceCorrecao]}`,
  );
  return partes.join(", ");
}

/**
 * O NOME DO PLANO NO PAPEL — INVESTIDOR, CURTO, NORMAL, À VISTA.
 *
 * ⚠️ VEM DO SLOT, E NÃO DO NOME CADASTRADO (Lucas, 29/08: *"sempre vamos colocar um nome como
 * normal, curto, investidor"*). O `nome` do C2X é o rótulo interno de quem cadastrou, e cada
 * empreendimento inventou o seu: "PLANO-NORMAL", "PLANO COMERCIAL 84", "10% ENTRADA + 144
 * PARCELAS", "NORMAL2". Três consequências de imprimir esse nome cru, todas reais:
 *
 *   • o corretor lia um vocabulário diferente a cada lançamento, e é ele quem explica o plano
 *     ao cliente em voz alta;
 *   • a cláusula saía como "PLANO PLANO-NORMAL", porque o texto prefixa a palavra e metade dos
 *     nomes já vem com ela;
 *   • nome de 26 caracteres aperta a folha — o rótulo entra duas vezes, na linha e na cláusula.
 *
 * O nome cadastrado continua no banco: serve para reconciliar com o C2X e para a tela mostrar
 * qual plano de lá deu origem a este. Ele só não vai ao papel.
 *
 * Plano sem slot cai no nome cadastrado: é melhor um rótulo estranho do que uma linha anônima.
 */
export function rotuloDoPlano(plano: PlanoComercial): string {
  const doSlot: Record<SlotDaPa, string> = {
    avista: "À VISTA",
    curto: "CURTO",
    investidor: "INVESTIDOR",
    normal: "NORMAL",
  };
  if (plano.slot) return doSlot[plano.slot];
  return plano.nome.trim().toUpperCase() || "PLANO";
}

/** "IPCA anual" — o nome do índice como ele aparece no texto do contrato. */
export function nomeDoIndice(indice: IndiceCorrecao): string {
  return INDICES[indice];
}

/** "20%" — o rótulo do sinal, sem casas quando é redondo. */
export function textoDoSinal(plano: PlanoComercial): string {
  const n = Number(plano.entradaPercentual.toFixed(2));
  return `${String(n).replace(".", ",")}%`;
}

/**
 * OS PLANOS DE ÚLTIMO RECURSO — quando o lançamento não tem plano em lugar nenhum.
 *
 * ⚠️ São os números do documento oficial do Villa Paris, que estavam fixos em imprimir-pa.ts
 * até 29/08/2026. Continuam aqui por UMA razão: no dia do evento a folha tem que sair. Uma PA
 * que se recusa a imprimir por falta de cadastro para o lançamento inteiro.
 *
 * ⚠️ MAS ELES ESTÃO ERRADOS PARA QUASE TODO EMPREENDIMENTO — inclusive para o próprio Villa
 * Paris, cujo C2X emite 180 parcelas, e não 120. Por isso o fallback grita na TELA do posto,
 * antes de imprimir. No papel ele não se anuncia: carimbar "provisório" num documento que o
 * cliente assina é pior do que o problema que resolve.
 */
export const PLANOS_PADRAO_DA_CASA: PlanoComercial[] = [
  {
    entradaPercentual: 20,
    indiceCorrecao: "SEM_CORRECAO",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    jurosTaxa: null,
    nome: "INVESTIDOR",
    parcelas: 12,
    sistemaAmortizacao: "sacoc",
    slot: "investidor",
  },
  {
    entradaPercentual: 30,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    jurosTaxa: null,
    nome: "CURTO",
    parcelas: 36,
    sistemaAmortizacao: "sacoc",
    slot: "curto",
  },
  {
    entradaPercentual: 10,
    indiceCorrecao: "IPCA_ANUAL",
    jurosConvencao: "equivalente",
    jurosPeriodicidade: "anual",
    jurosTaxa: 8,
    nome: "NORMAL",
    parcelas: 120,
    sistemaAmortizacao: "price",
    slot: "normal",
  },
];

/** A ordem em que os planos saem na folha, seguindo o documento oficial. */
const ORDEM_DOS_SLOTS: SlotDaPa[] = ["investidor", "curto", "normal", "avista"];

export function ordenarParaAFolha(planos: PlanoComercial[]): PlanoComercial[] {
  return [...planos].sort((a, b) => {
    const ia = a.slot ? ORDEM_DOS_SLOTS.indexOf(a.slot) : 99;
    const ib = b.slot ? ORDEM_DOS_SLOTS.indexOf(b.slot) : 99;
    if (ia !== ib) return ia - ib;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}
