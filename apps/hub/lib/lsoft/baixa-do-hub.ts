// A BAIXA DO HUB: o boleto pago no Asaas quita a parcela do Garden no espelho do LSoft.
//
// Pedido do Lucas (29/09/2026): *"a partir de setembro, quem alimenta a carteira é o hub"*, e antes
// disso, olhando o caso de um cliente com dois lotes cujos boletos de setembro estavam pagos no
// Asaas enquanto a ficha seguia "Vencida": *"subiu os valores de setembro que foi emitido por
// nos?"*. Não tinha subido: o pagamento morava em `boletos_pagamentos` (o retrato do Asaas) e a
// parcela em `lsoft_parcelas` (o espelho), e ninguém ligava um ao outro.
//
// O CAMINHO DE UM PAGAMENTO ATÉ A PARCELA:
//   cobrança paga (boletos_pagamentos, Garden, competência >= 2026-09)
//     → unidade do boleto ("Q12-L26" ou "Q12 L26") → lote ANTIGO pelo mapa conferido (lotes-do-garden)
//     → CPF da unidade (boletos_documentos) → cliente do LSoft MARCADO no Financeiro (0199)
//     → a parcela da categoria 124 daquele cliente que cobre aquele lote antigo e vence no mês da
//       competência.
//
// ⚠️ NUNCA POR VALOR. O boleto do hub é REAJUSTADO e a parcela do LSoft guarda o nominal: casar por
// valor erraria justamente onde o reajuste mexeu. O que casa é cliente + lote + mês; o valor do
// Asaas é o que entra como RECEBIDO, e o nominal da parcela fica como estava.
//
// ⚠️ UMA PARCELA PODE COBRIR MAIS DE UM LOTE ("LOTE: 216 E 217"), e o hub cobra isso de dois jeitos,
// os dois medidos em setembro de 2026 nos 106 clientes do Financeiro: um boleto só com o valor dos
// dois lotes (15 clientes), ou um boleto POR LOTE, cada um com metade (4 clientes, com a parcela
// ainda em aberto na ficha). No segundo jeito, baixar a parcela com o primeiro boleto que chegar
// gravaria metade do dinheiro como o recebido de uma parcela quitada. Por isso a parcela só é baixada
// quando TODOS os lotes dela que têm boleto próprio no mesmo CPF estão pagos no mês, e o recebido é
// a SOMA desses boletos.
//
// ⚠️ NA DÚVIDA, NÃO BAIXA: vai para a lista de conferência com o motivo. Parcela quitada por engano
// some da cobrança calada (ninguém cobra quem "pagou"); parcela que ficou em aberto aparece como
// vencida e alguém olha. O erro barato é o segundo. A conferência sai no ensaio do script e, na
// rodada automática, no log do servidor (`avisosDaBaixa`).
//
// ⚠️ ANTES DE SETEMBRO NADA MUDA (`DESDE_DA_BAIXA_DO_HUB`). Até agosto a baixa foi dada à mão, na
// ficha e no Access, e o time adm validou os 106 olhando esses números.
import { estaPago, foiDesfeito } from "@/lib/apolo/boletos/pagamento-do-asaas";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { salvarParcelaDoLsoft } from "@/lib/lsoft/carteira";
import { GARDEN } from "@/lib/lsoft/categorias";
import {
  loteAntigoDoNovo,
  loteNovoDoAntigo,
  lotesCitadosNoTexto,
  rotuloDoLoteNovo,
} from "@/lib/lsoft/lotes-do-garden";
import { CATEGORIA_NO_FINANCEIRO, COLUNA_NA_CARTEIRA, colunaNaCarteiraAusente } from "@/lib/lsoft/na-carteira";

// ── AS CONSTANTES ───────────────────────────────────────────────────────────

/** A primeira competência que o hub baixa sozinho (Lucas, 29/09/2026: "a partir de setembro"). */
export const DESDE_DA_BAIXA_DO_HUB = "2026-09";

/** `boletos_pagamentos.empreendimento` e `boletos_documentos.empreendimento` do Garden. */
export const SLUG_DO_GARDEN_NO_BOLETO = "garden";

/** A categoria do LSoft que o Financeiro lê do Garden (124). A MESMA régua da integração. */
const CATEGORIA_DO_GARDEN = CATEGORIA_NO_FINANCEIRO[GARDEN] ?? 124;

/**
 * Quem assina a baixa na trilha: `Hub · boleto Asaas pay_xxx` (ou `pay_a + pay_b` quando a parcela
 * cobre dois lotes cobrados em dois boletos). O id da cobrança liga a linha da ficha ao pagamento no
 * Asaas, e não é dado pessoal.
 *
 * ⚠️ O PREFIXO É LIDO DE VOLTA (`lerBaixaDoHub`): é por ele que a próxima rodada sabe qual cobrança
 * já baixou qual parcela. Mudar o texto faz o hub esquecer o que já fez.
 */
export const PREFIXO_DO_AUTOR = "Hub · boleto Asaas ";
const SEPARADOR_DE_COBRANCAS = " + ";

/**
 * A partir de quantas parcelas a série é a MENSAL. No Garden (medido em 29/09/2026, nos 106) as
 * mensais têm 72, 76, 80, 84 ou 90 parcelas; entrada e anual têm de 1 a 12.
 */
export const PARCELAS_DA_MENSAL = 24;

/**
 * O único motivo de conferência que é ROTINA, e não aviso: o boleto é de um cliente que ainda está
 * na integração (sem o Garden marcado no Financeiro), e a baixa dele segue manual. Em setembro de
 * 2026 eram 26 dos 27 pagamentos da conferência; escrever cada um no log toda hora esconderia o que
 * importa. A rodada automática conta estes numa linha só.
 */
export const MOTIVO_FORA_DO_FINANCEIRO = "O CPF do boleto não é de nenhum cliente do Garden que já está no Financeiro.";

/**
 * Quantas competências ANTERIORES à do mês a sincronização volta a perguntar ao Asaas, só na conta
 * do Garden e só enquanto houver boleto delas em aberto (ver `competenciasAtrasadas`).
 */
export const JANELA_DO_ATRASO = 2;

// ── OS TIPOS ────────────────────────────────────────────────────────────────

/** Uma linha de `boletos_pagamentos`, só com o que a baixa usa. */
export type PagamentoDoBoleto = {
  cobrancaId: string;
  competencia: string;
  pagoEm: null | string;
  sequencia: number;
  situacao: string;
  unidade: string;
  valorPago: null | number;
};

/** Um cliente do LSoft marcado com o Garden no Financeiro (0199). */
export type ClienteNoFinanceiro = { codigo: string; cpf: null | string };

/** Uma linha de `boletos_documentos`: de quem é a unidade. */
export type DocumentoDoBoleto = { documento: string; unidade: string };

/** De `boletos_parcelas`: quantas parcelas tem a série que o boleto daquela competência cobra. */
export type SerieDoBoleto = {
  competencia: string;
  sequencia: number;
  totalParcelas: null | number;
  unidade: string;
};

/** Uma parcela do Garden no espelho. */
export type ParcelaDoEspelho = {
  clienteCodigo: string;
  dataRecebido: null | string;
  /**
   * Quem editou a parcela por último (`lsoft_parcelas.editada_por`). É a SEGUNDA memória da baixa do
   * hub: `salvarParcelaDoLsoft` grava a parcela e depois a trilha, e se a trilha falhar ela só
   * registra no log e devolve ok. Sem esta segunda memória, a parcela baixada ficaria sem o registro
   * de qual cobrança a baixou.
   */
  editadaPor?: null | string;
  id: string;
  /** O lote ANTIGO, como o LSoft guarda (numeração corrida do loteamento). */
  lote: null | string;
  /** O texto do LSoft: é onde a parcela de dois lotes diz o segundo ("LOTE: 216 E 217"). */
  observacoes: null | string;
  paga: boolean;
  /** "007/084". */
  parcela: null | string;
  parcelaTotal: null | number;
  valor: number;
  valorRecebido: number;
  vencimento: null | string;
};

/**
 * Uma baixa que o hub já deu, lida da trilha: qual cobrança quitou qual parcela.
 *
 * `marcouPaga`: a trilha registra que o hub gravou `parcela.paga = paga` nesta parcela (a segunda
 * das duas chamadas de `aplicarBaixasDoHub`). Sem isso, o hub só gravou o recebido e a data, e a
 * rodada parou no meio.
 */
export type BaixaAnterior = { cobrancaId: string; marcouPaga?: boolean; parcelaId: string };

/** O mapa lote antigo ↔ novo. Por padrão, o conferido (lib/lsoft/lotes-do-garden.ts). */
export type MapaDeLotes = {
  /** "Q12 L26" → "397". Nulo = fora do mapa. */
  antigoDoNovo: (unidade: string) => null | string;
  /** "397" → "Q12 L26". Nulo = fora do mapa. */
  novoDoAntigo: (lote: string) => null | string;
};

export type ClasseDaBaixa = "baixa_nova" | "conferir" | "ja_paga";

/** O que será gravado na parcela: igual para todos os pagamentos que a quitam juntos. */
export type BaixaDaParcela = {
  cobrancas: string[];
  /** A data do ÚLTIMO boleto pago: é quando a parcela ficou inteira. */
  dataRecebido: string;
  parcelaId: string;
  /** A soma dos boletos, em reais com centavos exatos. */
  valorRecebido: number;
};

export type DecisaoDaBaixa = {
  /**
   * Precisa de gente olhando: toda `conferir`, menos a de rotina (o CPF de cliente que ainda está na
   * integração, com baixa manual), e a `ja_paga` cujo recebido da ficha difere do Asaas. É o que a
   * rodada automática escreve no log (`avisosDaBaixa`).
   */
  aviso: boolean;
  /** O que gravar (só em `baixa_nova`, e o mesmo objeto para os boletos da mesma parcela). */
  baixa: BaixaDaParcela | null;
  classe: ClasseDaBaixa;
  clienteCodigo: null | string;
  cobrancaId: string;
  competencia: string;
  /** O lote antigo que o mapa deu para a unidade do boleto. */
  loteAntigo: null | string;
  /** Por que não baixa (só em `conferir`). */
  motivo: null | string;
  /** O que vale a pena saber: recebido da ficha × Asaas numa `ja_paga`, parcela de dois lotes. */
  observacao: null | string;
  pagoEm: null | string;
  parcela: null | {
    dataRecebido: null | string;
    id: string;
    paga: boolean;
    rotulo: null | string;
    valor: number;
    valorRecebido: number;
    vencimento: null | string;
  };
  /** A unidade do boleto normalizada ("Q12 L26"), ou a crua quando não dá para ler. */
  unidade: string;
  valorPago: null | number;
};

export type TotaisDaBaixa = Record<ClasseDaBaixa, { quantidade: number; valor: number }>;

export type ResultadoDaDecisao = {
  decisoes: DecisaoDaBaixa[];
  /** O que nem entrou na conta, para o ensaio dizer que viu. */
  fora: { antesDoCorte: number; naoPagos: number };
  totais: TotaisDaBaixa;
};

// ── AS RÉGUAS PURAS ─────────────────────────────────────────────────────────

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/** Reais para centavos inteiros: comparar 2201.02 com 2201.0200000001 em ponto flutuante erra. */
const emCentavos = (valor: number): number => Math.round((Number.isFinite(valor) ? valor : 0) * 100);

/** "0397", " 397 " → "397". Vazio ou com letra/barra ("344/345") não casa com nada. */
function loteComparavel(lote: null | string | undefined): null | string {
  const t = String(lote ?? "").trim();
  if (!/^\d+$/.test(t)) return null;
  return String(Number(t));
}

/**
 * Os lotes antigos que a parcela cobre: o da coluna `lote` e os que o texto cita.
 *
 * ⚠️ A COLUNA SÓ GUARDA O PRIMEIRO. "LOTE: 216 E 217" vem com `lote = 216`; o 217 só existe no texto,
 * e a parcela é dos dois (medido: o boleto do 217 é do mesmo CPF e o valor da parcela é o dobro).
 */
function lotesDaParcela(parcela: ParcelaDoEspelho): string[] {
  const lotes: string[] = [];
  const daColuna = loteComparavel(parcela.lote);
  if (daColuna) lotes.push(daColuna);
  for (const citado of lotesCitadosNoTexto(parcela.observacoes)) {
    const numero = loteComparavel(citado);
    if (numero && !lotes.includes(numero)) lotes.push(numero);
  }
  return lotes;
}

/** O mapa conferido do Garden (lib/lsoft/lotes-do-garden.ts), só com o número do lote antigo. */
export const MAPA_DO_GARDEN: MapaDeLotes = {
  antigoDoNovo: (unidade) => loteComparavel(loteAntigoDoNovo(unidade)?.lote ?? null),
  // A quadra não veta (ver o cabeçalho de lotes-do-garden.ts): a numeração antiga é corrida.
  novoDoAntigo: (lote) => loteNovoDoAntigo(null, lote),
};

const mesDaCompetencia = (competencia: string): string => `${competencia.slice(5, 7)}/${competencia.slice(0, 4)}`;

/**
 * As competências anteriores à `atual` que a sincronização ainda precisa perguntar ao Asaas: no
 * máximo `janela`, nunca antes de `desde`, da mais antiga para a mais nova.
 *
 * ⚠️ POR QUE EXISTE (achado da revisão de 29/09/2026). A varredura de hora em hora pergunta ao Asaas
 * só as cobranças que VENCEM no mês corrente, e o webhook ainda não está configurado nas contas. A
 * partir de 01/10, o boleto de setembro pago com atraso continuaria OVERDUE em `boletos_pagamentos`
 * para sempre, e a parcela seguiria vencida na ficha com o dinheiro já em conta: o contrário de
 * *"quem alimenta a carteira é o hub"* (Lucas, 29/09/2026). Medido em 29/09: 12 boletos de setembro
 * do Garden vencidos, 8 deles de clientes do Financeiro.
 *
 * ⚠️ A JANELA É CURTA DE PROPÓSITO. Boleto que nunca é pago fica OVERDUE para sempre, e sem teto a
 * rota perguntaria ao Asaas o mesmo mês velho toda hora, indefinidamente. Duas competências cobrem o
 * atraso de até uns dois meses; o que passar disso se atualiza pedindo `?competencia=AAAA-MM` à mão.
 */
export function competenciasAtrasadas(
  atual: string,
  opcoes: { desde?: string; janela?: number } = {},
): string[] {
  if (!/^\d{4}-\d{2}$/.test(atual)) return [];
  const desde = opcoes.desde ?? DESDE_DA_BAIXA_DO_HUB;
  const janela = Math.max(0, Math.floor(opcoes.janela ?? JANELA_DO_ATRASO));
  const [ano, mes] = atual.split("-").map(Number) as [number, number];
  const lista: string[] = [];
  for (let volta = janela; volta >= 1; volta -= 1) {
    const indice = ano * 12 + (mes - 1) - volta;
    const competencia = `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, "0")}`;
    if (competencia >= desde) lista.push(competencia);
  }
  return lista;
}

const reais = (centavos: number): string =>
  (centavos / 100).toLocaleString("pt-BR", { currency: "BRL", style: "currency" });

function totaisVazios(): TotaisDaBaixa {
  return {
    baixa_nova: { quantidade: 0, valor: 0 },
    conferir: { quantidade: 0, valor: 0 },
    ja_paga: { quantidade: 0, valor: 0 },
  };
}

/** Um pagamento que já achou a sua parcela e espera o grupo dela fechar. */
type Casado = {
  base: DecisaoDaBaixa;
  cpf: string;
  escolhida: ParcelaDoEspelho;
  pagamento: PagamentoDoBoleto;
  unidade: string;
};

/**
 * Decide, para cada pagamento, se ele baixa uma parcela, se a parcela já estava paga ou se precisa
 * de gente olhando. PURA: `lerBaixaDoHub` lê o banco, e o teste controla tudo daqui.
 *
 * ⚠️ AS REGRAS DE SEGURANÇA, NA ORDEM EM QUE BARRAM:
 *   1. unidade ilegível ou fora do mapa: sem lote antigo não há parcela para achar;
 *   2. a unidade precisa de UM CPF no cadastro de boletos, e o CPF de um cliente MARCADO com o
 *      Garden no Financeiro: cliente que ainda está na integração segue com a baixa manual;
 *   3. das parcelas daquele cliente que cobrem aquele lote antigo e vencem no mês da competência,
 *      fica a da SÉRIE que o boleto cobra (`boletos_parcelas.total_parcelas`: 84 é a mensal, 8 é o
 *      resto da entrada). Sem a série no boleto, fica a mensal (`PARCELAS_DA_MENSAL`). Sobrou mais de
 *      uma ou nenhuma: conferir;
 *   4. a parcela de mais de um lote só é baixada com os boletos de TODOS os lotes dela que têm
 *      boleto próprio no mesmo CPF, pagos no mês, e o recebido é a soma (ver o cabeçalho). Lote dela
 *      com boleto em OUTRO CPF: conferir;
 *   5. a cobrança que já baixou uma parcela não baixa outra, e a parcela que outra cobrança já
 *      baixou não é baixada de novo (a trilha diz quem baixou o quê, e `editada_por` é a segunda
 *      memória quando a trilha falhou);
 *   6. a parcela que o hub já marcou como paga e que voltou a ficar em aberto NÃO é baixada de novo:
 *      alguém a reabriu na ficha, ou uma carga do LSoft aceitou desfazer a baixa, e nos dois casos
 *      foi decisão de gente;
 *   7. duas cobranças pagas para o mesmo lote no mesmo mês: nenhuma vence.
 */
export function decidirBaixasDoHub(entrada: {
  baixasAnteriores: readonly BaixaAnterior[];
  /** Ids das parcelas CONFIRMADAS como subsídio da Caixa: não são dívida do cliente (régua 0107). */
  caixa?: ReadonlySet<string>;
  clientes: readonly ClienteNoFinanceiro[];
  /** Só estas competências ('AAAA-MM'); vazio ou ausente = todas desde `desde`. */
  competencias?: readonly string[];
  desde?: string;
  documentos: readonly DocumentoDoBoleto[];
  /** Troca o mapa conferido por um de teste. */
  mapa?: MapaDeLotes;
  pagamentos: readonly PagamentoDoBoleto[];
  parcelas: readonly ParcelaDoEspelho[];
  series: readonly SerieDoBoleto[];
}): ResultadoDaDecisao {
  const desde = entrada.desde ?? DESDE_DA_BAIXA_DO_HUB;
  const soEstas = new Set(entrada.competencias ?? []);
  const caixa = entrada.caixa ?? new Set<string>();
  const mapa = entrada.mapa ?? MAPA_DO_GARDEN;

  // Os CPFs de cada unidade (normalmente um; mais de um é cadastro ambíguo e barra).
  const cpfsPorUnidade = new Map<string, Set<string>>();
  // Os CPFs com boleto numa unidade que o mapa não conhece (ver a parcela de mais de um lote).
  const cpfsComUnidadeForaDoMapa = new Set<string>();
  for (const doc of entrada.documentos) {
    const unidade = rotuloDoLoteNovo(doc.unidade);
    const cpf = soDigitos(doc.documento);
    if (cpf && (!unidade || !mapa.antigoDoNovo(unidade))) cpfsComUnidadeForaDoMapa.add(cpf);
    if (!unidade || !cpf) continue;
    const lista = cpfsPorUnidade.get(unidade) ?? new Set<string>();
    lista.add(cpf);
    cpfsPorUnidade.set(unidade, lista);
  }

  // Os clientes marcados por CPF (o mesmo CPF pode ter dois códigos no LSoft: cadastro duplicado).
  const clientesPorCpf = new Map<string, Set<string>>();
  for (const cliente of entrada.clientes) {
    const cpf = soDigitos(cliente.cpf);
    if (!cpf) continue;
    const lista = clientesPorCpf.get(cpf) ?? new Set<string>();
    lista.add(cliente.codigo);
    clientesPorCpf.set(cpf, lista);
  }

  const seriePorChave = new Map<string, null | number>();
  for (const serie of entrada.series) {
    const unidade = rotuloDoLoteNovo(serie.unidade);
    if (!unidade) continue;
    seriePorChave.set(`${unidade}|${serie.competencia}|${serie.sequencia}`, serie.totalParcelas);
  }

  const parcelasPorCliente = new Map<string, ParcelaDoEspelho[]>();
  for (const parcela of entrada.parcelas) {
    if (caixa.has(parcela.id)) continue;
    const lista = parcelasPorCliente.get(parcela.clienteCodigo) ?? [];
    lista.push(parcela);
    parcelasPorCliente.set(parcela.clienteCodigo, lista);
  }

  // ⚠️ AS DUAS MEMÓRIAS DO QUE O HUB JÁ FEZ: a trilha (`lsoft_clientes_edicoes`) e o
  // `editada_por` da própria parcela. `salvarParcelaDoLsoft` grava a parcela ANTES da trilha, e se a
  // trilha falhar ela só escreve no log e devolve ok (carteira.ts). Sem a segunda memória, a cobrança
  // que baixou essa parcela poderia baixar outra depois. O `editada_por` não diz se o hub chegou a
  // marcar "paga" (a última edição do hub pode ter sido o recebido), então ele não conta para a regra 6.
  const memorias: BaixaAnterior[] = [...entrada.baixasAnteriores];
  for (const parcela of entrada.parcelas) {
    for (const cobrancaId of cobrancasDoAutor(parcela.editadaPor)) memorias.push({ cobrancaId, parcelaId: parcela.id });
  }

  const parcelasPorCobranca = new Map<string, Set<string>>();
  const cobrancasPorParcela = new Map<string, Set<string>>();
  // As parcelas em que a trilha mostra o hub gravando `parcela.paga = paga` (regra 6).
  const marcadasPagasPeloHub = new Set<string>();
  for (const baixa of memorias) {
    const porCobranca = parcelasPorCobranca.get(baixa.cobrancaId) ?? new Set<string>();
    porCobranca.add(baixa.parcelaId);
    parcelasPorCobranca.set(baixa.cobrancaId, porCobranca);
    const porParcela = cobrancasPorParcela.get(baixa.parcelaId) ?? new Set<string>();
    porParcela.add(baixa.cobrancaId);
    cobrancasPorParcela.set(baixa.parcelaId, porParcela);
    if (baixa.marcouPaga) marcadasPagasPeloHub.add(baixa.parcelaId);
  }

  const decisoes: DecisaoDaBaixa[] = [];
  const casados: Casado[] = [];
  const fora = { antesDoCorte: 0, naoPagos: 0 };

  // A ordem de leitura não pode mudar o resultado: competência, unidade, cobrança.
  const pagamentos = [...entrada.pagamentos].sort(
    (a, b) =>
      a.competencia.localeCompare(b.competencia) ||
      a.unidade.localeCompare(b.unidade) ||
      a.cobrancaId.localeCompare(b.cobrancaId),
  );

  // ── 1. Cada pagamento procura a sua parcela ──
  for (const pagamento of pagamentos) {
    if (!/^\d{4}-\d{2}$/.test(pagamento.competencia) || pagamento.competencia < desde) {
      fora.antesDoCorte += 1;
      continue;
    }
    if (soEstas.size > 0 && !soEstas.has(pagamento.competencia)) continue;

    const unidade = rotuloDoLoteNovo(pagamento.unidade);
    const base: DecisaoDaBaixa = {
      aviso: false,
      baixa: null,
      classe: "conferir",
      clienteCodigo: null,
      cobrancaId: pagamento.cobrancaId,
      competencia: pagamento.competencia,
      loteAntigo: null,
      motivo: null,
      observacao: null,
      pagoEm: pagamento.pagoEm,
      parcela: null,
      unidade: unidade ?? pagamento.unidade,
      valorPago: pagamento.valorPago,
    };
    const conferir = (motivo: string) =>
      decisoes.push({ ...base, aviso: motivo !== MOTIVO_FORA_DO_FINANCEIRO, classe: "conferir", motivo });

    // ⚠️ O PAGAMENTO DESFEITO DEPOIS DA BAIXA NÃO É DESFEITO AQUI. Estorno e chargeback voltam a
    // abrir uma dívida, e reabrir parcela sozinho é decisão de dinheiro que o hub não toma calado:
    // vai para a conferência.
    if (!estaPago(pagamento.situacao)) {
      const baixadas = parcelasPorCobranca.get(pagamento.cobrancaId);
      if (foiDesfeito(pagamento.situacao) && baixadas && baixadas.size > 0) {
        conferir(
          `O Asaas desfez este pagamento (${pagamento.situacao}) depois que o hub deu baixa na parcela; reabra à mão se for o caso.`,
        );
      } else {
        fora.naoPagos += 1;
      }
      continue;
    }

    if (pagamento.valorPago === null || !pagamento.pagoEm) {
      conferir("Pagamento sem valor ou sem data no Asaas.");
      continue;
    }
    if (!unidade) {
      conferir("Unidade do boleto ilegível.");
      continue;
    }

    const antigo = mapa.antigoDoNovo(unidade);
    if (!antigo) {
      conferir(`Lote ${unidade} fora do mapa do lote antigo para o novo.`);
      continue;
    }
    base.loteAntigo = antigo;

    const cpfs = cpfsPorUnidade.get(unidade);
    if (!cpfs || cpfs.size === 0) {
      conferir(`Sem CPF para ${unidade} no cadastro de boletos.`);
      continue;
    }
    if (cpfs.size > 1) {
      conferir(`${unidade} tem mais de um CPF no cadastro de boletos.`);
      continue;
    }
    const cpf = [...cpfs][0] ?? "";
    const codigos = clientesPorCpf.get(cpf);
    if (!codigos || codigos.size === 0) {
      conferir(MOTIVO_FORA_DO_FINANCEIRO);
      continue;
    }
    if (codigos.size === 1) base.clienteCodigo = [...codigos][0] ?? null;

    const doMes = [...codigos]
      .flatMap((codigo) => parcelasPorCliente.get(codigo) ?? [])
      .filter(
        (parcela) =>
          parcela.vencimento?.slice(0, 7) === pagamento.competencia && lotesDaParcela(parcela).includes(antigo),
      );
    if (doMes.length === 0) {
      conferir(`Nenhuma parcela do lote antigo ${antigo} vencendo em ${mesDaCompetencia(pagamento.competencia)}.`);
      continue;
    }

    const serie = seriePorChave.get(`${unidade}|${pagamento.competencia}|${pagamento.sequencia}`) ?? null;
    // ⚠️ A SÉRIE DO BOLETO MANDA; SEM ELA, A MENSAL. Um cliente pode ter no mesmo mês a mensal
    // (n/084) e uma anual ou a entrada (n/007). O boleto do hub sabe qual série cobra; a parcela do
    // mês que não é dessa série fica como está. O `parcela_atual` do boleto NÃO é usado: ficou
    // parado no número da planilha de origem (medido: 6 no boleto, 007/084 no LSoft).
    const temSerie = serie !== null && serie > 0;
    const daSerie = temSerie
      ? doMes.filter((parcela) => parcela.parcelaTotal === serie)
      : doMes.filter((parcela) => (parcela.parcelaTotal ?? 0) >= PARCELAS_DA_MENSAL);

    if (daSerie.length === 0) {
      conferir(
        temSerie
          ? `Nenhuma parcela da série n/${String(serie).padStart(3, "0")} do lote antigo ${antigo} em ${mesDaCompetencia(pagamento.competencia)} (há ${doMes.length} de outra série).`
          : `O boleto não diz a série e nenhuma parcela mensal do lote antigo ${antigo} vence em ${mesDaCompetencia(pagamento.competencia)}.`,
      );
      continue;
    }
    if (daSerie.length > 1) {
      conferir(
        `${daSerie.length} parcelas da mesma série do lote antigo ${antigo} vencem em ${mesDaCompetencia(pagamento.competencia)}: não dá para escolher uma com segurança.`,
      );
      continue;
    }

    const escolhida = daSerie[0] as ParcelaDoEspelho;
    base.clienteCodigo = escolhida.clienteCodigo;
    base.parcela = {
      dataRecebido: escolhida.dataRecebido,
      id: escolhida.id,
      paga: escolhida.paga,
      rotulo: escolhida.parcela,
      valor: escolhida.valor,
      valorRecebido: escolhida.valorRecebido,
      vencimento: escolhida.vencimento,
    };
    casados.push({ base, cpf, escolhida, pagamento, unidade });
  }

  // ── 2. Cada parcela junta os seus boletos e decide uma vez só ──
  const porParcela = new Map<string, Casado[]>();
  for (const casado of casados) {
    const lista = porParcela.get(casado.escolhida.id) ?? [];
    lista.push(casado);
    porParcela.set(casado.escolhida.id, lista);
  }

  for (const grupo of porParcela.values()) {
    const primeiro = grupo[0] as Casado;
    const parcela = primeiro.escolhida;
    const todos = (motivo: string) => {
      for (const casado of grupo) decisoes.push({ ...casado.base, aviso: true, classe: "conferir", motivo });
    };

    // ⚠️ DOIS PAGOS PARA O MESMO LOTE NO MÊS: boleto reemitido e pago duas vezes, ou dois lotes novos
    // que o mapa mandou para o mesmo antigo. Nos dois casos, gente precisa olhar.
    const unidadesDoGrupo = grupo.map((casado) => casado.unidade);
    if (new Set(unidadesDoGrupo).size !== unidadesDoGrupo.length) {
      todos(`${grupo.length} cobranças pagas para o mesmo lote em ${mesDaCompetencia(primeiro.pagamento.competencia)}.`);
      continue;
    }
    if (new Set(grupo.map((casado) => casado.cpf)).size > 1) {
      todos("Boletos de CPFs diferentes apontam para a mesma parcela.");
      continue;
    }

    // Os lotes que a parcela cobre e, deles, os que têm BOLETO PRÓPRIO no mesmo CPF.
    //
    // ⚠️ LOTE CITADO FORA DO MAPA NÃO TEM BOLETO PRÓPRIO, e isso é medido, não suposto: o mapa é
    // exatamente o conjunto das unidades de boleto do Garden (143 de 144 em 29/09/2026; a que sobra
    // é um código solto, "00000487"). "LOTE: 351 E 352" com o 352 fora do mapa é o lote que a
    // renumeração juntou ao 351 num lote novo só, cobrado num boleto só. A exceção que barra: o
    // mesmo CPF ter boleto numa unidade que o mapa não conhece, porque aí o outro lote PODE estar
    // sendo cobrado nela, e a parcela seria quitada com metade do dinheiro.
    const lotes = lotesDaParcela(parcela);
    const semMapa = lotes.filter((lote) => !mapa.novoDoAntigo(lote));
    if (semMapa.length > 0 && cpfsComUnidadeForaDoMapa.has(primeiro.cpf)) {
      todos(
        `A parcela cobre o lote antigo ${semMapa.join(", ")}, fora do mapa, e o mesmo CPF tem boleto numa unidade que o mapa não conhece.`,
      );
      continue;
    }
    // ⚠️ LOTE DA PARCELA COM BOLETO EM OUTRO CPF (ou em mais de um CPF) BARRA. Antes, só contava
    // como "cobrado à parte" o boleto do MESMO CPF; o de outro CPF (cônjuge, cadastro trocado) era
    // tratado como "sem boleto próprio", e o boleto do primeiro lote quitava sozinho a parcela dos
    // dois, com metade do dinheiro: justamente o defeito que o cabeçalho diz evitar (achado da
    // revisão de 29/09/2026; latente, nenhum caso nos 106 naquele dia).
    const cobradosAParte: string[] = [];
    const deOutroCpf: string[] = [];
    for (const lote of lotes) {
      const unidade = mapa.novoDoAntigo(lote);
      const cpfsDoLote = unidade ? cpfsPorUnidade.get(unidade) : undefined;
      if (!unidade || !cpfsDoLote || cpfsDoLote.size === 0) continue;
      if (cpfsDoLote.size === 1 && cpfsDoLote.has(primeiro.cpf)) cobradosAParte.push(unidade);
      else deOutroCpf.push(unidade);
    }
    if (deOutroCpf.length > 0) {
      todos(
        `A parcela cobre ${lotes.length} lotes, e o boleto de ${deOutroCpf.join(", ")} está em outro CPF: não dá para saber quanto desta parcela já entrou.`,
      );
      continue;
    }
    const faltam = cobradosAParte.filter((unidade) => !unidadesDoGrupo.includes(unidade));
    if (faltam.length > 0) {
      todos(
        `A parcela cobre ${lotes.length} lotes cobrados em boletos separados, e o de ${faltam.join(", ")} ainda não está pago em ${mesDaCompetencia(primeiro.pagamento.competencia)}.`,
      );
      continue;
    }

    // A trilha: nenhuma cobrança do grupo baixou outra parcela, e ninguém de fora baixou esta.
    const cobrancas = grupo.map((casado) => casado.pagamento.cobrancaId).sort();
    const baixouOutra = cobrancas.some((id) =>
      [...(parcelasPorCobranca.get(id) ?? [])].some((parcelaId) => parcelaId !== parcela.id),
    );
    if (baixouOutra) {
      todos("Esta cobrança já deu baixa em outra parcela: não baixa uma segunda.");
      continue;
    }
    const deFora = [...(cobrancasPorParcela.get(parcela.id) ?? [])].filter((id) => !cobrancas.includes(id));
    if (deFora.length > 0) {
      todos("Outra cobrança já deu baixa nesta parcela: é pagamento em dobro ou lote trocado.");
      continue;
    }
    // ⚠️ A PARCELA QUE O HUB JÁ MARCOU COMO PAGA E ESTÁ EM ABERTO DE NOVO NÃO É BAIXADA OUTRA VEZ
    // (achado da revisão de 29/09/2026). Reabrir na ficha zera o recebido e a data, e a parcela fica
    // igual a uma que nunca foi baixada: sem esta regra, o cron a quitaria de novo no minuto 10
    // seguinte, toda hora, e ninguém conseguiria desfazer uma baixa do hub (o caso do mapa contestado,
    // em que a baixa caiu no lote errado). O mesmo vale para a carga do LSoft rodada com
    // `--aceitar-perda-de-edicao`: alguém disse com todas as letras que o LSoft está certo.
    // A nova tentativa SÓ vale quando a rodada anterior parou no meio: o hub gravou o recebido e a
    // data, e a trilha não tem o "paga" dele.
    if (!parcela.paga && marcadasPagasPeloHub.has(parcela.id)) {
      todos(
        "O hub já tinha dado baixa nesta parcela e ela voltou a ficar em aberto (reaberta na ficha ou desfeita por uma carga do LSoft): não baixa de novo sozinho.",
      );
      continue;
    }

    const somaEmCentavos = grupo.reduce((soma, casado) => soma + emCentavos(casado.pagamento.valorPago ?? 0), 0);
    const dataRecebido = grupo
      .map((casado) => String(casado.pagamento.pagoEm).slice(0, 10))
      .sort()
      .at(-1) as string;
    const deVarios =
      grupo.length > 1
        ? `Parcela de ${grupo.length} lotes (${[...unidadesDoGrupo].sort().join(" e ")}): recebido é a soma, ${reais(somaEmCentavos)}.`
        : lotes.length > 1
          ? `Parcela dos lotes antigos ${lotes.join(" e ")}, cobrada num boleto só.`
          : null;

    if (parcela.paga) {
      const bate = emCentavos(parcela.valorRecebido) === somaEmCentavos;
      const observacao = bate
        ? "Já paga na ficha com o mesmo valor do Asaas."
        : `Já paga na ficha com ${reais(emCentavos(parcela.valorRecebido))}; o Asaas recebeu ${reais(somaEmCentavos)}.`;
      for (const casado of grupo) {
        decisoes.push({
          ...casado.base,
          aviso: !bate,
          classe: "ja_paga",
          observacao: deVarios ? `${observacao} ${deVarios}` : observacao,
        });
      }
      continue;
    }

    const baixa: BaixaDaParcela = {
      cobrancas,
      dataRecebido,
      parcelaId: parcela.id,
      valorRecebido: somaEmCentavos / 100,
    };
    for (const casado of grupo) {
      decisoes.push({ ...casado.base, aviso: false, baixa, classe: "baixa_nova", observacao: deVarios });
    }
  }

  decisoes.sort(
    (a, b) =>
      a.competencia.localeCompare(b.competencia) ||
      a.unidade.localeCompare(b.unidade) ||
      a.cobrancaId.localeCompare(b.cobrancaId),
  );

  const totais = totaisVazios();
  for (const decisao of decisoes) {
    totais[decisao.classe].quantidade += 1;
    totais[decisao.classe].valor += emCentavos(decisao.valorPago ?? 0);
  }
  for (const classe of Object.keys(totais) as ClasseDaBaixa[]) totais[classe].valor /= 100;

  return { decisoes, fora, totais };
}

/** As baixas a gravar, uma por parcela (a parcela de dois lotes aparece em duas decisões). */
export function baixasParaGravar(decisoes: readonly DecisaoDaBaixa[]): BaixaDaParcela[] {
  const porParcela = new Map<string, BaixaDaParcela>();
  for (const decisao of decisoes) {
    if (decisao.classe !== "baixa_nova" || !decisao.baixa) continue;
    porParcela.set(decisao.baixa.parcelaId, decisao.baixa);
  }
  return [...porParcela.values()];
}

/**
 * Só as decisões de um cliente do LSoft: o que o script lista E GRAVA com `--cliente`.
 *
 * ⚠️ O FILTRO VALE PARA A GRAVAÇÃO, NÃO SÓ PARA A TELA (achado da revisão de 29/09/2026): antes,
 * `--gravar --cliente X` mostrava só o X e gravava as baixas de todos. A parcela de dois lotes não se
 * parte aqui: os boletos dela têm o mesmo cliente (o da parcela), e a baixa é um objeto só, com a
 * soma e as duas cobranças.
 */
export function decisoesDoCliente(decisoes: readonly DecisaoDaBaixa[], codigo: string): DecisaoDaBaixa[] {
  const alvo = codigo.trim();
  return decisoes.filter((decisao) => alvo !== "" && decisao.clienteCodigo === alvo);
}

/**
 * O que a rodada automática escreve no log: uma linha por decisão com `aviso`, e a contagem das
 * conferências de rotina (cliente ainda na integração) numa linha só.
 *
 * ⚠️ SEM NOME NEM CPF: id da cobrança, código do cliente no LSoft, lote novo e antigo, competência,
 * parcela e o motivo. É o que basta para achar a linha no Asaas e na ficha.
 *
 * ⚠️ EXISTE PORQUE "NA DÚVIDA, NÃO BAIXA" SÓ PROTEGE SE A DÚVIDA CHEGA A ALGUÉM (achado da revisão
 * de 29/09/2026). Antes, no cron, a conferência não aparecia em lugar nenhum: o estorno depois de
 * uma baixa do hub, o recebido da ficha diferente do Asaas e o mapa que não bate com o LSoft ficavam
 * calados. A tela para isso ainda não existe.
 */
export function avisosDaBaixa(decisoes: readonly DecisaoDaBaixa[]): { linhas: string[]; rotina: number } {
  const linhas: string[] = [];
  let rotina = 0;
  for (const decisao of decisoes) {
    if (decisao.classe === "conferir" && decisao.motivo === MOTIVO_FORA_DO_FINANCEIRO) rotina += 1;
    if (!decisao.aviso) continue;
    linhas.push(
      [
        decisao.classe === "ja_paga" ? "já paga com valor diferente" : "conferir",
        `cobrança ${decisao.cobrancaId}`,
        `cliente ${decisao.clienteCodigo ?? "?"}`,
        `${decisao.unidade} (antigo ${decisao.loteAntigo ?? "?"})`,
        decisao.competencia,
        ...(decisao.parcela ? [`parcela ${decisao.parcela.rotulo ?? "?"}`] : []),
        decisao.motivo ?? decisao.observacao ?? "",
      ].join(" · "),
    );
  }
  return { linhas, rotina };
}

// ── A ESCRITA ───────────────────────────────────────────────────────────────

type ResultadoDoSalvar = { alterados: number; ok: true } | { erro: string; ok: false };

export type DependenciasDaEscrita = {
  /** O estado da parcela AGORA, lido na hora de gravar. Nulo = a parcela sumiu. */
  lerParcela: (id: string) => Promise<null | { paga: boolean }>;
  salvar: (args: Parameters<typeof salvarParcelaDoLsoft>[0]) => Promise<ResultadoDoSalvar>;
};

export type ResultadoDaEscrita = {
  /** Ficaram para a próxima rodada: bateu o limite ou o prazo. */
  adiadas: number;
  /** Parcelas baixadas nesta rodada. */
  aplicadas: number;
  falhas: Array<{ cobrancas: string; erro: string }>;
  /** A parcela foi paga por outra mão entre a leitura e a escrita: não foi tocada. */
  puladas: number;
};

/** O autor da trilha para as cobranças que quitam uma parcela. */
export const autorDaBaixa = (cobrancas: readonly string[]): string =>
  `${PREFIXO_DO_AUTOR}${[...cobrancas].sort().join(SEPARADOR_DE_COBRANCAS)}`;

/** Os ids das cobranças de volta, a partir do autor da trilha. Vazio = não foi o hub. */
export function cobrancasDoAutor(autor: null | string | undefined): string[] {
  const t = String(autor ?? "");
  if (!t.startsWith(PREFIXO_DO_AUTOR)) return [];
  return t
    .slice(PREFIXO_DO_AUTOR.length)
    .split(SEPARADOR_DE_COBRANCAS)
    .map((id) => id.trim())
    .filter((id) => id !== "");
}

/**
 * Grava as baixas pela MESMA porta da ficha (`salvarParcelaDoLsoft`), com trilha.
 *
 * ⚠️ DUAS CHAMADAS, E NESTA ORDEM: primeiro o recebido e a data, depois o "paga". Numa chamada só,
 * `salvarParcelaDoLsoft` troca o valor recebido pelo NOMINAL sempre que a parcela vira paga com
 * recebido zerado (o "completa o que falta" dela sobrescreve o que veio junto), e a ficha mostraria
 * R$ 2.119,05 onde o Asaas recebeu R$ 2.201,02. Com o recebido já gravado, o "paga" não tem o que
 * completar. Se a segunda chamada falhar, a parcela fica EM ABERTO com o recebido preenchido (a
 * carteira ignora recebido de parcela aberta) e a próxima rodada termina o serviço.
 *
 * ⚠️ RELÊ A PARCELA ANTES DE GRAVAR. Entre a decisão e a escrita alguém pode ter dado a baixa na
 * ficha; gravar por cima trocaria o recebido e a data que o time conferiu.
 *
 * ⚠️ UMA FALHA NÃO PARA AS OUTRAS, e o limite e o prazo existem porque a rota da sincronização tem
 * 300 s e divide esse tempo com as sete contas do Asaas. O que sobra fica para a próxima hora.
 */
export async function aplicarBaixasDoHub(
  decisoes: readonly DecisaoDaBaixa[],
  opcoes: {
    deps?: DependenciasDaEscrita;
    /** Máximo de parcelas baixadas nesta rodada. */
    limite?: number;
    /** `Date.now()` a partir do qual não começa nenhuma baixa nova. */
    prazo?: number;
  } = {},
): Promise<ResultadoDaEscrita> {
  const deps = opcoes.deps ?? dependenciasDoBanco();
  const resultado: ResultadoDaEscrita = { adiadas: 0, aplicadas: 0, falhas: [], puladas: 0 };

  for (const baixa of baixasParaGravar(decisoes)) {
    const noLimite = opcoes.limite !== undefined && resultado.aplicadas >= opcoes.limite;
    const noPrazo = opcoes.prazo !== undefined && Date.now() >= opcoes.prazo;
    if (noLimite || noPrazo) {
      resultado.adiadas += 1;
      continue;
    }

    const cobrancas = baixa.cobrancas.join(SEPARADOR_DE_COBRANCAS);
    try {
      const agora = await deps.lerParcela(baixa.parcelaId);
      if (!agora) {
        resultado.falhas.push({ cobrancas, erro: "A parcela não existe mais no espelho." });
        continue;
      }
      if (agora.paga) {
        resultado.puladas += 1;
        continue;
      }

      const autor = autorDaBaixa(baixa.cobrancas);
      const recebido = await deps.salvar({
        autor,
        autorOrigem: "careli",
        campos: {
          data_recebido: baixa.dataRecebido,
          valor_recebido: (emCentavos(baixa.valorRecebido) / 100).toFixed(2),
        },
        parcelaId: baixa.parcelaId,
      });
      if (!recebido.ok) {
        resultado.falhas.push({ cobrancas, erro: recebido.erro });
        continue;
      }

      const paga = await deps.salvar({
        autor,
        autorOrigem: "careli",
        campos: { paga: "true" },
        parcelaId: baixa.parcelaId,
      });
      if (!paga.ok) {
        resultado.falhas.push({
          cobrancas,
          erro: `Recebido gravado, mas a parcela não foi marcada como paga: ${paga.erro}`,
        });
        continue;
      }
      resultado.aplicadas += 1;
    } catch (falha) {
      resultado.falhas.push({ cobrancas, erro: falha instanceof Error ? falha.message : String(falha) });
    }
  }

  return resultado;
}

function dependenciasDoBanco(): DependenciasDaEscrita {
  return {
    lerParcela: async (id) => {
      const admin = createApoloAdminClient();
      if (!admin) throw new Error("Supabase indisponível.");
      const { data, error } = await admin.from("lsoft_parcelas").select("id, paga").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return null;
      return { paga: Boolean((data as { paga?: unknown }).paga) };
    },
    salvar: (args) => salvarParcelaDoLsoft(args),
  };
}

// ── A LEITURA (servidor e script) ───────────────────────────────────────────

type LinhaDoBanco = Record<string, unknown>;
type ErroDoBanco = { code?: null | string; message: string };
type RespostaDoBanco = { count: null | number; data: null | unknown[]; error: ErroDoBanco | null };
type ClienteDoBanco = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** O PostgREST devolve no máximo 1.000 linhas por consulta, e corta SEM erro. */
const PAGINA = 1000;
/** `.in()` com lista grande estoura a URL; 100 é o lote da casa. */
const LOTE = 100;

/** A falha de leitura com o erro do banco junto: quem chama distingue "a coluna não existe". */
class FalhaDeLeitura extends Error {
  constructor(
    mensagem: string,
    readonly causa: ErroDoBanco | null = null,
  ) {
    super(mensagem);
  }
}

/**
 * Lê TODAS as linhas, página a página, e prova que leu todas: ordem fixa pela chave, nenhuma chave
 * repetida e a quantidade igual à contagem exata. Sem ordem fixa o PostgREST repete uma linha e pula
 * outra entre páginas, e o total ainda bate (medido em 24/09/2026 em `lsoft_parcelas`).
 */
async function lerTudo(
  consulta: (contar: boolean) => { range: (de: number, ate: number) => PromiseLike<RespostaDoBanco> },
  rotulo: string,
  chave = "id",
): Promise<LinhaDoBanco[]> {
  const vistas = new Set<string>();
  const linhas: LinhaDoBanco[] = [];
  let esperado: null | number = null;

  for (let de = 0; ; de += PAGINA) {
    const { count, data, error } = await consulta(de === 0).range(de, de + PAGINA - 1);
    if (error) throw new FalhaDeLeitura(`Leitura de ${rotulo}: ${error.message}`, error);
    if (de === 0) esperado = count;
    const bloco = (data ?? []) as LinhaDoBanco[];
    for (const linha of bloco) {
      const id = String(linha[chave] ?? "");
      if (vistas.has(id)) throw new FalhaDeLeitura(`Leitura de ${rotulo} instável: ${id} veio duas vezes.`);
      vistas.add(id);
      linhas.push(linha);
    }
    if (bloco.length < PAGINA) break;
  }

  if (esperado === null) throw new FalhaDeLeitura(`Leitura de ${rotulo} sem contagem.`);
  if (linhas.length !== esperado) {
    throw new FalhaDeLeitura(`Leitura de ${rotulo} incompleta: vieram ${linhas.length} de ${esperado}.`);
  }
  return linhas;
}

async function emLotes(codigos: readonly string[], ler: (lote: string[]) => Promise<LinhaDoBanco[]>) {
  const linhas: LinhaDoBanco[] = [];
  for (let i = 0; i < codigos.length; i += LOTE) linhas.push(...(await ler(codigos.slice(i, i + LOTE))));
  return linhas;
}

const texto = (valor: unknown): null | string => {
  const t = String(valor ?? "").trim();
  return t === "" ? null : t;
};

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const numeroOuNulo = (valor: unknown): null | number => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/** O último dia do mês de 'AAAA-MM', em 'AAAA-MM-DD'. */
function fimDoMes(competencia: string): string {
  const [ano, mes] = competencia.split("-").map(Number) as [number, number];
  const ultimo = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  return `${competencia}-${String(ultimo).padStart(2, "0")}`;
}

export type LeituraDaBaixa = {
  /** `true` = a migration 0199 não rodou: ninguém está no Financeiro, nada a baixar. */
  colunaAusente: boolean;
  resultado: ResultadoDaDecisao;
};

/**
 * Lê o que a decisão precisa e decide. SÓ LÊ: quem grava é `aplicarBaixasDoHub`.
 *
 * ⚠️ LÊ TODAS AS COMPETÊNCIAS DESDE SETEMBRO, e não só a que a sincronização acabou de trazer. O
 * pagamento que chegou por outra porta (o webhook, ou a sincronização pedida à mão para um mês
 * antigo) também precisa virar baixa, e a parcela já paga sai como `ja_paga` sem custo de escrita.
 *
 * ⚠️ QUALQUER LEITURA QUE FALHE LANÇA. Decidir baixa com metade dos clientes ou metade das
 * parcelas mandaria pagamento bom para a conferência, e com metade da trilha poderia baixar a mesma
 * cobrança duas vezes. A exceção é a coluna 0199 ainda não existir: aí ninguém está no Financeiro.
 */
export async function lerBaixaDoHub(opcoes: {
  admin?: ClienteDoBanco;
  competencias?: readonly string[];
  desde?: string;
} = {}): Promise<LeituraDaBaixa> {
  const admin = opcoes.admin ?? createApoloAdminClient();
  if (!admin) throw new Error("Supabase indisponível.");
  const desde = opcoes.desde ?? DESDE_DA_BAIXA_DO_HUB;
  const competencias = (opcoes.competencias ?? []).filter((c) => /^\d{4}-\d{2}$/.test(c) && c >= desde);
  const vazio = (colunaAusente: boolean): LeituraDaBaixa => ({
    colunaAusente,
    resultado: { decisoes: [], fora: { antesDoCorte: 0, naoPagos: 0 }, totais: totaisVazios() },
  });

  const linhasDosPagamentos = await lerTudo((contar) => {
    let consulta = admin
      .from("boletos_pagamentos")
      .select(
        "id, cobranca_id, competencia, sequencia, unidade, situacao, valor_pago, pago_em",
        contar ? { count: "exact" } : undefined,
      )
      .eq("workspace_id", "careli")
      .eq("empreendimento", SLUG_DO_GARDEN_NO_BOLETO)
      .gte("competencia", desde);
    if (competencias.length > 0) consulta = consulta.in("competencia", competencias);
    return consulta.order("id");
  }, "pagamentos do boleto");

  const pagamentos: PagamentoDoBoleto[] = linhasDosPagamentos.map((linha) => ({
    cobrancaId: String(linha.cobranca_id ?? ""),
    competencia: String(linha.competencia ?? ""),
    pagoEm: texto(linha.pago_em),
    sequencia: Number(linha.sequencia ?? 1) || 1,
    situacao: String(linha.situacao ?? ""),
    unidade: String(linha.unidade ?? ""),
    valorPago: numeroOuNulo(linha.valor_pago),
  }));
  if (pagamentos.length === 0) return vazio(false);

  let linhasDosClientes: LinhaDoBanco[];
  try {
    linhasDosClientes = await lerTudo(
      (contar) =>
        admin
          .from("lsoft_clientes")
          .select("codigo, cpf", contar ? { count: "exact" } : undefined)
          .contains(COLUNA_NA_CARTEIRA, [GARDEN])
          .order("codigo"),
      "clientes no Financeiro",
      "codigo",
    );
  } catch (falha) {
    if (falha instanceof FalhaDeLeitura && colunaNaCarteiraAusente(falha.causa)) return vazio(true);
    throw falha;
  }

  const clientes: ClienteNoFinanceiro[] = linhasDosClientes.map((linha) => ({
    codigo: String(linha.codigo ?? ""),
    cpf: texto(linha.cpf),
  }));
  const codigos = clientes.map((cliente) => cliente.codigo);

  // A janela de vencimento: do primeiro dia da competência mais antiga ao último da mais nova.
  const meses = [...new Set(pagamentos.map((p) => p.competencia).filter((c) => /^\d{4}-\d{2}$/.test(c)))].sort();
  const inicio = `${meses[0] ?? desde}-01`;
  const fim = fimDoMes(meses[meses.length - 1] ?? desde);

  const [linhasDasParcelas, linhasDaCaixa, linhasDosDocumentos, linhasDasSeries, linhasDaTrilha] = await Promise.all([
    emLotes(codigos, (lote) =>
      lerTudo(
        (contar) =>
          admin
            .from("lsoft_parcelas")
            .select(
              "id, cliente_codigo, lote, observacoes, parcela, parcela_total, vencimento, paga, valor, valor_recebido, data_recebido, editada_por",
              contar ? { count: "exact" } : undefined,
            )
            .eq("empreendimento", GARDEN)
            .eq("categoria_lsoft", CATEGORIA_DO_GARDEN)
            .in("cliente_codigo", lote)
            .gte("vencimento", inicio)
            .lte("vencimento", fim)
            .order("id"),
        "parcelas do Garden",
      ),
    ),
    // A régua da 0107: a parcela CONFIRMADA como subsídio da Caixa não é do cliente.
    emLotes(codigos, (lote) =>
      lerTudo(
        (contar) =>
          admin
            .from("lsoft_classificacao_de_parcela")
            .select("id, parcela_id", contar ? { count: "exact" } : undefined)
            .eq("classe", "caixa")
            .eq("situacao", "confirmada")
            .in("cliente_codigo", lote)
            .order("id"),
        "subsídio da Caixa",
      ),
    ),
    // O Garden inteiro (144 linhas em 29/09/2026): CPF na URL fica em log de proxy.
    lerTudo(
      (contar) =>
        admin
          .from("boletos_documentos")
          .select("id, documento, unidade", contar ? { count: "exact" } : undefined)
          .eq("workspace_id", "careli")
          .eq("empreendimento", SLUG_DO_GARDEN_NO_BOLETO)
          .order("id"),
      "cadastro de boletos",
    ),
    lerTudo(
      (contar) =>
        admin
          .from("boletos_parcelas")
          .select("id, unidade, competencia, sequencia, total_parcelas", contar ? { count: "exact" } : undefined)
          .eq("workspace_id", "careli")
          .eq("empreendimento", SLUG_DO_GARDEN_NO_BOLETO)
          .gte("competencia", inicio.slice(0, 7))
          .lte("competencia", fim.slice(0, 7))
          .order("id"),
      "séries do boleto",
    ),
    // O que o hub já baixou: é isto que impede a mesma cobrança de quitar duas parcelas. O campo e o
    // valor novo dizem se o hub chegou a marcar "paga" (a regra da parcela reaberta).
    lerTudo(
      (contar) =>
        admin
          .from("lsoft_clientes_edicoes")
          .select("id, autor, parcela_id, campo, valor_novo", contar ? { count: "exact" } : undefined)
          .like("autor", `${PREFIXO_DO_AUTOR}%`)
          .order("id"),
      "trilha da baixa do hub",
    ),
  ]);

  const baixasAnteriores: BaixaAnterior[] = [];
  for (const linha of linhasDaTrilha) {
    const parcelaId = texto(linha.parcela_id);
    if (!parcelaId) continue;
    const marcouPaga = texto(linha.campo) === "parcela.paga" && texto(linha.valor_novo) === "paga";
    for (const cobrancaId of cobrancasDoAutor(texto(linha.autor))) {
      baixasAnteriores.push({ cobrancaId, marcouPaga, parcelaId });
    }
  }

  return {
    colunaAusente: false,
    resultado: decidirBaixasDoHub({
      baixasAnteriores,
      caixa: new Set(linhasDaCaixa.map((linha) => String(linha.parcela_id ?? ""))),
      clientes,
      competencias,
      desde,
      documentos: linhasDosDocumentos.map((linha) => ({
        documento: String(linha.documento ?? ""),
        unidade: String(linha.unidade ?? ""),
      })),
      pagamentos,
      parcelas: linhasDasParcelas.map((linha) => ({
        clienteCodigo: String(linha.cliente_codigo ?? ""),
        dataRecebido: texto(linha.data_recebido),
        editadaPor: texto(linha.editada_por),
        id: String(linha.id ?? ""),
        lote: texto(linha.lote),
        observacoes: texto(linha.observacoes),
        paga: Boolean(linha.paga),
        parcela: texto(linha.parcela),
        parcelaTotal: numeroOuNulo(linha.parcela_total),
        valor: numero(linha.valor),
        valorRecebido: numero(linha.valor_recebido),
        vencimento: texto(linha.vencimento),
      })),
      series: linhasDasSeries.map((linha) => ({
        competencia: String(linha.competencia ?? ""),
        sequencia: Number(linha.sequencia ?? 1) || 1,
        totalParcelas: numeroOuNulo(linha.total_parcelas),
        unidade: String(linha.unidade ?? ""),
      })),
    }),
  };
}

// ── A RODADA AUTOMÁTICA ─────────────────────────────────────────────────────

/** O que a sincronização devolve da baixa: só contagens, nada pessoal. */
export type RodadaDaBaixa = {
  adiadas: number;
  aplicadas: number;
  /** Decisões que pedem gente olhando, escritas no log (`avisosDaBaixa`). */
  avisos: number;
  colunaAusente: boolean;
  falhas: number;
  puladas: number;
  totais: TotaisDaBaixa;
};

/**
 * Lê, decide e grava: o que a sincronização de pagamentos chama depois de gravar o retrato do
 * Asaas. O script `scripts/carteira/baixar-pelo-hub.mjs` faz o mesmo em ensaio.
 *
 * ⚠️ AS FALHAS E OS AVISOS VÃO PARA O LOG COM O ID DA COBRANÇA, e não com nome nem CPF: é o
 * suficiente para achar a linha no Asaas e na ficha. Aviso é a conferência que não é rotina e a
 * `ja_paga` com o recebido diferente do Asaas; a conferência de rotina (cliente ainda na integração)
 * sai numa linha só, com a contagem.
 */
export async function rodarBaixaDoHub(opcoes: { limite?: number; prazo?: number } = {}): Promise<RodadaDaBaixa> {
  const leitura = await lerBaixaDoHub();
  const escrita = await aplicarBaixasDoHub(leitura.resultado.decisoes, opcoes);
  for (const falha of escrita.falhas) {
    console.error("[lsoft][baixa-do-hub] baixa falhou", falha.cobrancas, falha.erro);
  }
  const avisos = avisosDaBaixa(leitura.resultado.decisoes);
  for (const linha of avisos.linhas) console.warn("[lsoft][baixa-do-hub]", linha);
  if (avisos.rotina > 0) {
    console.info(
      `[lsoft][baixa-do-hub] ${avisos.rotina} pagamento(s) de cliente que ainda não está no Financeiro: baixa manual.`,
    );
  }
  return {
    adiadas: escrita.adiadas,
    aplicadas: escrita.aplicadas,
    avisos: avisos.linhas.length,
    colunaAusente: leitura.colunaAusente,
    falhas: escrita.falhas.length,
    puladas: escrita.puladas,
    totais: leitura.resultado.totais,
  };
}
