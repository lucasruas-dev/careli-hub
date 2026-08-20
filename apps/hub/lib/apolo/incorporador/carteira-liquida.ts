import { numeroDaParcela } from "@/lib/apolo/numero-da-parcela";
import { getHadesDbPool } from "@/lib/guardian/db";
import {
  liquidoDaParcela,
  type LinhaDeSplit,
  type ParcelaParaLiquido,
  type PerfilDeParcela,
  type PoliticaDoEmpreendimento,
  type ResultadoLiquido,
  somarLiquido,
} from "@/lib/apolo/liquido-incorporador";

// A CARTEIRA DO INCORPORADOR, em BRUTO e em LÍQUIDO.
//
// Pedido do Lucas (17/08/2026): *"quero que o incorporador tenha acesso à tela da carteira do
// empreendimento dele; o que temos que ter adicional é trazer os valores líquidos, pois nessa tela
// temos os valores brutos"*.
//
// ⚠️ O LÍQUIDO NÃO É UM PERCENTUAL DO BRUTO, e essa é a razão desta leitura existir em vez de uma
// multiplicação na tela. Cada parcela tem o SEU rateio, e a fatia do incorporador muda conforme o
// tipo (ato, sinal, parcela do financiamento) e conforme a ENTRADA QUE AQUELE CLIENTE FECHOU. A
// regra inteira mora em `liquido-incorporador.ts`; aqui só se busca o que ela precisa.
//
// A fonte preferida é o `split_data` do próprio pagamento: é o rateio REAL, o mesmo que o Asaas
// executou. A fórmula é o plano B, para o que é antigo demais para ter split.
//
// ⚠️ UMA LEITURA SÓ PARA TUDO. A soma da carteira, o líquido POR UNIDADE e os INDICADORES do BI
// (previsto × transferido × inadimplência) saem TODOS das mesmas linhas cruas lidas aqui. Fazer
// uma segunda consulta no C2X com filtros "quase iguais" é como os números de duas abas da mesma
// tela começam a divergir — e divergência de dinheiro com o cliente vira reunião.

export type ParcelaDaCarteira = {
  competencia: null | string;
  liquido: null | number;
  motivo?: string;
  pagoEm: null | string;
  perfil: PerfilDeParcela;
  unidade: string;
  valor: number;
};

/** O líquido agregado de UMA unidade (bloco+lote), somando só as parcelas PAGAS dela. */
export type CarteiraPorUnidade = {
  bruto: number;
  liquido: number;
  parcelasPagas: number;
  semLiquido: number;
  /** Rótulo bloco+lote ("Q02 L18"). O id é a chave; isto é só para a tela. */
  unidade: string;
  /** `enterprise_unities.id` — a MESMA chave de `ApoloCarteiraUnit.id`, para a rota casar. */
  unitId: string;
};

export type SituacaoDaParcela = "a_vencer" | "paga" | "vencida";

/** Rótulos externos do perfil. "Outro" cobre taxa/acordo, que não entram no rateio padrão. */
export const PERFIL_LABELS: Record<PerfilDeParcela, string> = {
  ato: "Ato",
  outro: "Outro",
  parcela: "Parcela",
  sinal: "Sinal",
};

/** Um bucket de KPI: soma e contagem, sem esconder o que não deu para calcular. */
export type TotalLiquido = {
  bruto: number;
  liquido: number;
  parcelas: number;
  semLiquido: number;
};

export type MesDaSerie = {
  /** Inadimplente ÷ previsto do mês, JÁ em 0–100 (a tela não multiplica de novo). */
  inadimplenciaPct: number;
  /** Líquido das parcelas VENCIDAS com vencimento neste mês. */
  inadimplente: number;
  /** "YYYY-MM". */
  mes: string;
  /**
   * Líquido das parcelas com VENCIMENTO neste mês que JÁ venceram (pagas ou não).
   *
   * ⚠️ "que já venceram" só restringe o mês CORRENTE — nos anteriores, tudo já venceu. Sem isso, a
   * barra do mês em curso comparava o vencido com um previsto que ainda vai crescer até o dia 31,
   * e o percentual saía menor do que a realidade.
   */
  previsto: number;
  /** Líquido das parcelas PAGAS com PAGAMENTO neste mês. */
  transferido: number;
};

/**
 * Uma linha do extrato analítico (a tabela da página "Gestão de Carteira" do BI).
 *
 * ⚠️ SÓ NOME, NUNCA DOCUMENTO. Cliente e imobiliária por nome é permitido (o incorporador é parte
 * do contrato); CPF/CNPJ, telefone e e-mail não saem por aqui em hipótese nenhuma.
 */
export type ExtratoParcela = {
  cliente: null | string;
  /** Nome de MERCADO do empreendimento (via `nomePorCode`), nunca o código da divisão interna. */
  empreendimento: null | string;
  imobiliaria: null | string;
  liquido: null | number;
  motivo?: string;
  /** "n/total" da parcela, como o comprador vê no boleto. */
  numero: string;
  pagoEm: null | string;
  perfil: string;
  situacao: SituacaoDaParcela;
  unidade: string;
  valor: number;
  vencimento: null | string;
};

/**
 * O recorte do extrato, aplicado NO SERVIDOR.
 *
 * ⚠️ POR QUE NÃO DÁ PARA FILTRAR NA TELA. O extrato tem teto de payload (`EXTRATO_TETO`), e o
 * corte acontecia ANTES do filtro: com 12.614 parcelas, as 2.000 "mais recentes por vencimento"
 * eram todas de 2037 a 2039 — todas a vencer. Filtrar por "Paga" ou "Vencida" na tela varria um
 * recorte onde nenhuma delas existia e devolvia vazio; e o seletor de ano, montado a partir das
 * mesmas 2.000, só oferecia 2037, 2038 e 2039. Lucas, 20/08/2026: *"nos indicadores quando eu
 * seleciono paga ou vencida vem em branco"*.
 *
 * Filtrar aqui é o que faz o teto voltar a ser só um teto de payload, e não um recorte que decide
 * em silêncio o que o usuário pode procurar.
 */
export type FiltroDoExtrato = {
  /** "YYYY" do vencimento. */
  ano?: null | string;
  /** Nome do cliente, unidade ou imobiliária. */
  busca?: null | string;
  direcao?: "asc" | "desc";
  /** "MM" do vencimento. */
  mes?: null | string;
  ordenarPor?: ColunaDoExtrato;
  perfil?: null | string;
  situacao?: null | SituacaoDaParcela;
};

/** As colunas por onde o extrato pode ser ordenado (pedido do Lucas, 20/08/2026). */
export type ColunaDoExtrato =
  | "cliente"
  | "liquido"
  | "pagamento"
  | "situacao"
  | "unidade"
  | "valor"
  | "vencimento";

export type IndicadoresDaCarteira = {
  contadores: { clientes: number; parcelas: number; unidades: number };
  /** Até `EXTRATO_TETO` linhas, das mais recentes por vencimento. O total real está ao lado. */
  extrato: ExtratoParcela[];
  /** Quantas parcelas o FILTRO encontrou (pode passar de `EXTRATO_TETO`, que é só o teto do envio). */
  extratoTotal: number;
  /**
   * O que os seletores da tela devem oferecer, apurado sobre TODAS as parcelas.
   *
   * ⚠️ NÃO PODE SAIR DO `extrato` ENVIADO. Era assim que a tela montava a lista de anos, e por
   * isso ela só mostrava 2037-2039: os anos das 2.000 linhas que sobraram do corte.
   */
  opcoesDoExtrato: { anos: string[]; perfis: string[] };
  /**
   * Os totais DO RECORTE FILTRADO — a resposta para "quanto eu recebo em dezembro?".
   *
   * Pedido do Lucas (20/08/2026): *"falta trazer os cenários... se o cliente quiser saber quanto
   * que ele vai receber em dezembro, não tem como saber, então precisamos de indicadores dinâmicos
   * que tem correlação com os filtros que estamos fazendo"*.
   *
   * ⚠️ CONTA SOBRE O FILTRO INTEIRO, não sobre as linhas enviadas. O extrato tem teto de payload:
   * somar o que chegou na tela responderia "quanto recebo em dezembro" com a soma das primeiras
   * 2.000 de dezembro, que é uma resposta errada com cara de certa.
   */
  totaisDoRecorte: {
    aVencer: TotalLiquido;
    pagas: TotalLiquido;
    /** Todas as parcelas do recorte, qualquer situação. */
    total: TotalLiquido;
    vencidas: TotalLiquido;
  };
  kpis: {
    /**
     * Inadimplência A VALOR PRESENTE, JÁ em 0–100, nas DUAS visões.
     *
     * Pedido do Lucas (20/08/2026): *"a inadimplência o cálculo tem que ser no valor presente...
     * não sobre o contrato total mas sim sobre o que deveríamos ter recebido até a data
     * presente"*, e *"ter duas visões, uma bruto... e outra da líquida, para o incorporador saber
     * o cenário dele somente e não inflado com os valores de outros participantes"*.
     *
     * ⚠️ O DENOMINADOR É `previstoAteHoje`, NÃO a receita da carteira inteira. Dividir pelo total
     * do contrato mistura o que venceu com o que só vence em 2039: no CER dava 0,2% onde o número
     * real passa de 10%. O indicador ficava mais tranquilizador quanto MAIS LONGO o financiamento,
     * que é o oposto do que ele existe para dizer.
     *
     * `bruta` é sobre o valor cheio da parcela; `liquida` é sobre a parte que é DELE, já descontado
     * o rateio — é a que responde "qual é o meu cenário", sem inflar com a fatia dos outros.
     */
    inadimplenciaPct: { bruta: number; liquida: number };
    /** Vencidas e não pagas, pela DATA DE VENCIMENTO (regra do BI do Lucas). */
    inadimplente: TotalLiquido;
    /** O denominador do valor presente: TODAS as parcelas já vencidas até hoje, pagas ou não. */
    previstoAteHoje: TotalLiquido;
    /** Todas as parcelas da carteira ativa: pagas + a vencer + vencidas. */
    receitaLiquida: TotalLiquido;
    /** Só as pagas, pela DATA DE PAGAMENTO (regra do BI do Lucas). */
    transferida: TotalLiquido;
  };
  motivos: string[];
  /** 12 meses, do mais antigo ao atual. */
  serieMensal: MesDaSerie[];
};

export type CarteiraLiquida = {
  bruto: number;
  /** Preenchido só quando a leitura pediu os indicadores (custa a consulta ampliada). */
  indicadores: IndicadoresDaCarteira | null;
  liquido: number;
  /** Quantas parcelas o líquido veio do split real (e não da fórmula). */
  porSplit: number;
  /** Parcelas em que não deu para calcular, e por quê. A tela mostra em vez de somar errado. */
  motivos: string[];
  /** `true` quando a leitura bateu no teto e a lista NÃO é completa. A tela avisa. */
  parcial: boolean;
  parcelas: ParcelaDaCarteira[];
  porUnidade: CarteiraPorUnidade[];
  semLiquido: number;
  total: number;
};

/**
 * Uma linha crua da consulta. Exportada porque as agregações (`agregarPorUnidade`,
 * `montarIndicadores`) são funções PURAS sobre ela — é assim que os testes rodam sem C2X.
 */
export type LinhaCruaDaCarteira = {
  cliente: null | string;
  competence: null | string;
  /** 'YYYY-MM-DD'. Formatada no MySQL para a comparação com "hoje" ser de string, sem fuso. */
  due_date: null | string;
  enterprise_code: string;
  entrada_contratada: null | number;
  imobiliaria: null | string;
  parcel_type: null | string;
  parcela_n: null | number;
  parcela_total: null | number;
  /** `current_signal_parcel` — qual parcela DO SINAL. Zerado fora do tipo "Sinal". */
  sinal_n: null | number;
  /** `total_signal_parcels` — em quantas vezes o SINAL foi parcelado. */
  sinal_total: null | number;
  payment_date: null | string;
  /** `payments.id` — o cursor da paginação por lote. */
  payment_id: number;
  /** `acquisition_requests.custom_commercial_plan`: 1 = o contrato negociou plano próprio. */
  plano_personalizado: null | number;
  split_data: unknown;
  status_id: null | number;
  unit_block: null | string;
  /** `enterprise_unities.id`, para casar com `ApoloCarteiraUnit.id` na rota. */
  unit_id: number | string;
  unit_lot: null | string;
  unit_price: null | number;
  /** `paid_value` — o que o comprador PAGOU. Nulo na parcela em aberto. */
  valor: null | number;
  /** `initial_value` — o principal da parcela. É o "valor" da parcela não paga. */
  valor_previsto: null | number;
};

// ⚠️ LEITURA EM LOTES, COM TETO. O `limit 5000` fixo antigo truncava empreendimento grande em
// silêncio (o Vista Alegre tem 284 parcelas pagas, mas um consolidado de grupo passa de 5.000 com
// folga). A paginação é por `payments.id` (keyset): estável, sem OFFSET caro, e cada lote cabe na
// memória. O teto de 30.000 existe para um erro de escopo nunca virar um SELECT sem fim — se
// bater, `parcial` vem `true` e a tela avisa em vez de somar errado calada.
const LOTE = 5000;
const TETO = 30000;

/** Máximo de linhas do extrato analítico no payload. O total real segue em `extratoTotal`. */
export const EXTRATO_TETO = 2000;

/**
 * O tipo de parcela do C2X vira o perfil que a regra do líquido entende.
 *
 * O `parcel_types.name` do legado usa nomes de negócio ("Ato", "Sinal", "Parcela", "Balão"…), e a
 * regra só precisa saber em qual dos quatro grupos de rateio a parcela cai.
 */
export function perfilDaParcela(tipo: null | string): PerfilDeParcela {
  const t = (tipo ?? "").trim().toLowerCase();
  if (!t) return "outro";
  if (t.includes("ato")) return "ato";
  if (t.includes("sinal")) return "sinal";
  // Balão e intercalada são financiamento: entram no mesmo rateio da parcela mensal.
  if (t.includes("parcela") || t.includes("balao") || t.includes("balão") || t.includes("mensal")) {
    return "parcela";
  }
  return "outro";
}

/** O `split_data` do C2X é JSON e vem em formatos diferentes conforme a época do pagamento. */
export function lerSplit(cru: unknown): LinhaDeSplit[] | null {
  if (!cru) return null;

  let valor: unknown = cru;
  if (typeof cru === "string") {
    try {
      valor = JSON.parse(cru);
    } catch {
      return null;
    }
  }

  const lista = Array.isArray(valor)
    ? valor
    : Array.isArray((valor as { splits?: unknown })?.splits)
      ? ((valor as { splits: unknown[] }).splits)
      : null;

  if (!lista) return null;

  const linhas: LinhaDeSplit[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const registro = item as Record<string, unknown>;

    // O valor pago de verdade. `fixedValue` é o que o Asaas executou; os outros nomes aparecem em
    // pagamentos de épocas diferentes.
    const bruto =
      registro.fixedValue ?? registro.value ?? registro.valor ?? registro.amount ?? null;
    const valorNum = Number(bruto);
    if (!Number.isFinite(valorNum)) continue;

    linhas.push({
      nome:
        typeof registro.name === "string"
          ? registro.name
          : typeof registro.nome === "string"
            ? registro.nome
            : null,
      perfil:
        typeof registro.profile === "string"
          ? registro.profile
          : typeof registro.perfil === "string"
            ? registro.perfil
            : null,
      valor: valorNum,
    });
  }

  return linhas.length > 0 ? linhas : null;
}

/**
 * A situação da parcela, na mesma régua do Hades (`lib/apolo/carteira.ts`):
 * paga quando há valor pago e data; vencida quando o status é 7 ou o vencimento passou e o status
 * não é dos "não cobráveis" (1, 2) nem pago (5); a vencer no resto.
 *
 * `hoje` chega como 'YYYY-MM-DD' para a comparação ser de string com a data formatada no MySQL —
 * sem objeto Date, sem surpresa de fuso.
 */
export function situacaoDaLinha(
  linha: Pick<LinhaCruaDaCarteira, "due_date" | "payment_date" | "status_id" | "valor">,
  hoje: string,
): SituacaoDaParcela {
  if (Number(linha.valor ?? 0) > 0 && linha.payment_date) return "paga";

  const status = Number(linha.status_id ?? 0);
  if (status === 7) return "vencida";
  if (linha.due_date && linha.due_date < hoje && status !== 1 && status !== 2 && status !== 5) {
    return "vencida";
  }
  return "a_vencer";
}

/** O valor da linha para a conta: o PAGO quando quitada, o PRINCIPAL quando em aberto. */
function valorDaLinha(linha: LinhaCruaDaCarteira, situacao: SituacaoDaParcela): number {
  return situacao === "paga" ? Number(linha.valor ?? 0) : Number(linha.valor_previsto ?? 0);
}

/** Monta a entrada da regra do líquido a partir da linha crua. */
function parcelaParaLiquido(
  linha: LinhaCruaDaCarteira,
  valor: number,
  nomeDoIncorporador: null | string | undefined,
): ParcelaParaLiquido {
  return {
    entradaPctContratada: linha.entrada_contratada,
    nomeDoIncorporador: nomeDoIncorporador ?? null,
    perfil: perfilDaParcela(linha.parcel_type),
    split: lerSplit(linha.split_data),
    valor,
    valorUnidade: linha.unit_price,
  };
}

const POLITICA_VAZIA: PoliticaDoEmpreendimento = {
  comissaoPct: null,
  entradaPct: null,
  gestaoCarteiraPct: null,
};

function politicaDe(
  politicaPorCode: Map<string, PoliticaDoEmpreendimento>,
  code: null | string,
): PoliticaDoEmpreendimento {
  return politicaPorCode.get(String(code ?? "")) ?? POLITICA_VAZIA;
}

function rotuloDaUnidade(linha: Pick<LinhaCruaDaCarteira, "unit_block" | "unit_lot">): string {
  const rotulo = [linha.unit_block, linha.unit_lot]
    .map((parte) => String(parte ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return rotulo || "—";
}

/**
 * Agrega o líquido POR UNIDADE, contando SÓ as parcelas pagas (carteira = o que já entrou).
 *
 * Função pura de propósito: recebe as linhas cruas e devolve a lista pronta para a rota casar com
 * `ApoloCarteiraUnit.id`. Unidade sem parcela paga simplesmente não aparece — a rota trata a
 * ausência como "líquido ainda não apurado", nunca como R$ 0,00.
 */
export function agregarPorUnidade(
  linhas: LinhaCruaDaCarteira[],
  politicaPorCode: Map<string, PoliticaDoEmpreendimento>,
  nomeDoIncorporador?: null | string,
  hoje: string = isoDia(Date.now()),
): CarteiraPorUnidade[] {
  const porUnidade = new Map<string, CarteiraPorUnidade>();

  for (const linha of linhas) {
    if (situacaoDaLinha(linha, hoje) !== "paga") continue;

    const unitId = String(linha.unit_id ?? "").trim();
    if (!unitId) continue;

    const valor = Number(linha.valor ?? 0);
    const resultado = liquidoDaParcela(
      parcelaParaLiquido(linha, valor, nomeDoIncorporador),
      politicaDe(politicaPorCode, linha.enterprise_code),
    );

    const alvo = porUnidade.get(unitId) ?? {
      bruto: 0,
      liquido: 0,
      parcelasPagas: 0,
      semLiquido: 0,
      unidade: rotuloDaUnidade(linha),
      unitId,
    };

    alvo.bruto += valor;
    alvo.parcelasPagas += 1;
    if (resultado.liquido === null) alvo.semLiquido += 1;
    else alvo.liquido += resultado.liquido;

    porUnidade.set(unitId, alvo);
  }

  return [...porUnidade.values()].sort((a, b) =>
    a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }),
  );
}

function totalVazio(): TotalLiquido {
  return { bruto: 0, liquido: 0, parcelas: 0, semLiquido: 0 };
}

function acumular(total: TotalLiquido, valor: number, liquido: null | number): void {
  total.bruto += valor;
  total.parcelas += 1;
  if (liquido === null) total.semLiquido += 1;
  else total.liquido += liquido;
}

function isoDia(agoraMs: number): string {
  return new Date(agoraMs).toISOString().slice(0, 10);
}

/** Os 12 meses "YYYY-MM" que terminam no mês de `agoraMs`, do mais antigo ao atual. */
function janelaDeMeses(agoraMs: number): string[] {
  const agora = new Date(agoraMs);
  const meses: string[] = [];
  for (let i = 11; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth() - i, 1));
    meses.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return meses;
}

/**
 * Os KPIs do BI de Gestão de Carteira, sobre as MESMAS linhas cruas da carteira.
 *
 * A referência é o "Careli - Dashboard Recanto.pbit" do Lucas, MAS a regra do líquido é a nossa
 * (`liquidoDaParcela`, com a política POR EMPREENDIMENTO e o `split_data` real primeiro). Os 7%
 * fixos e as correções por `payments.id` do Power BI são hardcode do BI, não regra da Careli —
 * de propósito, os números daqui podem divergir dos dele nesses pontos.
 *
 * Regras herdadas do BI:
 *   • Receita Líquida       = soma do líquido de TODAS as parcelas da carteira;
 *   • Transferida           = líquido das PAGAS, pela DATA DE PAGAMENTO;
 *   • Inadimplente          = líquido das VENCIDAS não pagas, pela DATA DE VENCIMENTO;
 *   • % Inadimplência       = inadimplente ÷ previsto (aqui JÁ multiplicado por 100 — lição do
 *     bug da TelaCarteira que mostrava 0,3% onde era 30%);
 *   • contadores            = parcelas, clientes únicos (por nome), unidades únicas.
 */
export function montarIndicadores(
  linhas: LinhaCruaDaCarteira[],
  opcoes: {
    agoraMs: number;
    /** Código da divisão -> nome de mercado. Sem o mapa, `empreendimento` sai nulo no extrato. */
    nomePorCode?: Map<string, string>;
    /** O recorte do extrato. Sem ele, sai a carteira inteira ordenada por vencimento. */
    filtroDoExtrato?: FiltroDoExtrato;
    nomeDoIncorporador?: null | string;
    politicaPorCode: Map<string, PoliticaDoEmpreendimento>;
  },
): IndicadoresDaCarteira {
  const hoje = isoDia(opcoes.agoraMs);
  const meses = janelaDeMeses(opcoes.agoraMs);
  const naJanela = new Set(meses);

  const receitaLiquida = totalVazio();
  const transferida = totalVazio();
  const inadimplente = totalVazio();
  const previstoAteHoje = totalVazio();

  const serie = new Map<string, MesDaSerie>(
    meses.map((mes) => [
      mes,
      { inadimplenciaPct: 0, inadimplente: 0, mes, previsto: 0, transferido: 0 },
    ]),
  );

  const clientes = new Set<string>();
  const unidades = new Set<string>();
  const motivos = new Set<string>();
  const extrato: ExtratoParcela[] = [];

  for (const linha of linhas) {
    const situacao = situacaoDaLinha(linha, hoje);
    const valor = valorDaLinha(linha, situacao);
    const resultado: ResultadoLiquido = liquidoDaParcela(
      parcelaParaLiquido(linha, valor, opcoes.nomeDoIncorporador),
      politicaDe(opcoes.politicaPorCode, linha.enterprise_code),
    );

    if (resultado.liquido === null && resultado.motivo) motivos.add(resultado.motivo);

    // ── KPIs ────────────────────────────────────────────────────────────────
    acumular(receitaLiquida, valor, resultado.liquido);
    if (situacao === "paga") acumular(transferida, valor, resultado.liquido);
    if (situacao === "vencida") acumular(inadimplente, valor, resultado.liquido);

    // ⚠️ O DENOMINADOR DO VALOR PRESENTE: a parcela entra pelo VENCIMENTO, não pelo pagamento, e
    // entra tendo sido paga ou não. É a pergunta "quanto já deveria ter entrado até hoje" — e a
    // parcela paga faz parte dela tanto quanto a vencida, senão o percentual daria sempre 100%.
    if ((linha.due_date ?? "") && (linha.due_date as string).slice(0, 10) <= hoje) {
      acumular(previstoAteHoje, valor, resultado.liquido);
    }

    // ── Contadores ──────────────────────────────────────────────────────────
    const cliente = String(linha.cliente ?? "").trim();
    if (cliente) clientes.add(cliente.toLowerCase());
    const unitId = String(linha.unit_id ?? "").trim();
    if (unitId) unidades.add(unitId);

    // ── Série mensal ────────────────────────────────────────────────────────
    const liquido = resultado.liquido ?? 0;
    const mesVencimento = (linha.due_date ?? "").slice(0, 7);
    if (naJanela.has(mesVencimento)) {
      const mes = serie.get(mesVencimento)!;

      // ⚠️ NO MÊS CORRENTE, SÓ O QUE JÁ VENCEU ENTRA NO PREVISTO. Somar o mês inteiro dilui o
      // vencido com parcelas que ainda nem chegaram na data: no CER, em 20/08, o denominador
      // pegava até os vencimentos de 21 a 31/08 e a barra mostrava 6,1% onde a inadimplência real
      // do período era 7%. Era o MESMO defeito do card antigo (dividir pelo que ainda não venceu),
      // sobrevivendo no gráfico — o Lucas viu os dois números na mesma tela e estranhou, com razão.
      //
      // Nos meses passados isto não muda nada: o mês inteiro já venceu, então a condição é sempre
      // verdadeira. Ela só age no mês corrente, que é justamente onde a distorção existe.
      const jaVenceu = (linha.due_date ?? "").slice(0, 10) <= hoje;
      if (jaVenceu) mes.previsto += liquido;
      if (situacao === "vencida") mes.inadimplente += liquido;
    }
    if (situacao === "paga") {
      const mesPagamento = (linha.payment_date ?? "").slice(0, 7);
      if (naJanela.has(mesPagamento)) serie.get(mesPagamento)!.transferido += liquido;
    }

    // ── Extrato analítico ───────────────────────────────────────────────────
    extrato.push({
      cliente: cliente || null,
      empreendimento:
        opcoes.nomePorCode?.get(String(linha.enterprise_code ?? "").trim().toUpperCase()) ?? null,
      imobiliaria: String(linha.imobiliaria ?? "").trim() || null,
      liquido: resultado.liquido,
      motivo: resultado.motivo,
      // ⚠️ A RÉGUA É COMPARTILHADA (lib/apolo/numero-da-parcela.ts). Montar a string aqui na mão
      // foi o que fez o extrato mostrar "0/156" em Ato e Sinal: `total_parcels` vale 156 em toda
      // linha, e o contador do Ato/Sinal mora em OUTRO par de campos.
      numero: numeroDaParcela({
        parcelaAtual: linha.parcela_n,
        parcelaTotal: linha.parcela_total,
        sinalAtual: linha.sinal_n,
        sinalTotal: linha.sinal_total,
        tipo: linha.parcel_type,
      }),
      pagoEm: linha.payment_date,
      perfil: PERFIL_LABELS[perfilDaParcela(linha.parcel_type)],
      situacao,
      unidade: rotuloDaUnidade(linha),
      valor,
      vencimento: linha.due_date,
    });
  }

  for (const mes of serie.values()) {
    mes.inadimplenciaPct = mes.previsto > 0 ? (mes.inadimplente / mes.previsto) * 100 : 0;
  }

  // ⚠️ AS OPÇÕES DOS SELETORES SAEM DAQUI, do extrato INTEIRO — antes de qualquer filtro ou
  // corte. Tirá-las da lista já recortada foi o que fez a tela oferecer só 2037-2039.
  const opcoesDoExtrato = {
    anos: [...new Set(extrato.map((p) => (p.vencimento ?? "").slice(0, 4)).filter(Boolean))].sort(
      (a, b) => a.localeCompare(b),
    ),
    perfis: [...new Set(extrato.map((p) => p.perfil).filter(Boolean))].sort(),
  };

  // ⚠️ FILTRA ANTES DE CORTAR. Esta ordem é o conserto: o teto passa a limitar o ENVIO, e não o
  // que o usuário consegue procurar.
  const recorte = filtrarExtrato(extrato, opcoes.filtroDoExtrato);
  ordenarExtrato(recorte, opcoes.filtroDoExtrato);

  // Os totais do recorte, sobre TODAS as linhas que o filtro pegou — antes do corte de payload.
  const totaisDoRecorte = {
    aVencer: totalVazio(),
    pagas: totalVazio(),
    total: totalVazio(),
    vencidas: totalVazio(),
  };

  for (const parcela of recorte) {
    acumular(totaisDoRecorte.total, parcela.valor, parcela.liquido);
    if (parcela.situacao === "paga") acumular(totaisDoRecorte.pagas, parcela.valor, parcela.liquido);
    else if (parcela.situacao === "vencida") {
      acumular(totaisDoRecorte.vencidas, parcela.valor, parcela.liquido);
    } else acumular(totaisDoRecorte.aVencer, parcela.valor, parcela.liquido);
  }

  return {
    contadores: {
      clientes: clientes.size,
      parcelas: linhas.length,
      unidades: unidades.size,
    },
    extrato: recorte.slice(0, EXTRATO_TETO),
    extratoTotal: recorte.length,
    kpis: {
      // Sem nenhum vencimento ainda, o percentual é 0 e não divisão por zero: antes do primeiro
      // vencimento não existe inadimplência possível.
      inadimplenciaPct: {
        bruta: previstoAteHoje.bruto > 0 ? (inadimplente.bruto / previstoAteHoje.bruto) * 100 : 0,
        liquida:
          previstoAteHoje.liquido > 0
            ? (inadimplente.liquido / previstoAteHoje.liquido) * 100
            : 0,
      },
      inadimplente,
      previstoAteHoje,
      receitaLiquida,
      transferida,
    },
    motivos: [...motivos],
    opcoesDoExtrato,
    totaisDoRecorte,
    serieMensal: meses.map((mes) => serie.get(mes)!),
  };
}

/** Aplica o recorte do extrato. Sem filtro, devolve a lista inteira. */
function filtrarExtrato(
  extrato: ExtratoParcela[],
  filtro: FiltroDoExtrato | undefined,
): ExtratoParcela[] {
  if (!filtro) return extrato;

  const busca = (filtro.busca ?? "").trim().toLowerCase();
  const ano = (filtro.ano ?? "").trim();
  const mes = (filtro.mes ?? "").trim();
  const perfil = (filtro.perfil ?? "").trim();
  const situacao = filtro.situacao ?? null;

  if (!busca && !ano && !mes && !perfil && !situacao) return extrato;

  return extrato.filter((parcela) => {
    const vencimento = parcela.vencimento ?? "";
    if (ano && vencimento.slice(0, 4) !== ano) return false;
    if (mes && vencimento.slice(5, 7) !== mes) return false;
    if (perfil && parcela.perfil !== perfil) return false;
    if (situacao && parcela.situacao !== situacao) return false;
    if (!busca) return true;

    return [parcela.unidade, parcela.cliente, parcela.imobiliaria]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(busca);
  });
}

/**
 * Ordena o extrato NO LUGAR, pela coluna pedida.
 *
 * ⚠️ O PADRÃO É VENCIMENTO CRESCENTE, e mudou de propósito (Lucas, 20/08/2026: *"quando eu coloco
 * a vencer inicia da maior para menor... assim se o usuário quiser saber o que vai vencer no
 * próximo mês ele sabe"*). Descendente colocava 2039 na primeira linha: a informação mais distante
 * possível ocupando o lugar mais nobre da tela.
 *
 * Parcela sem data vai sempre para o FIM, nos dois sentidos: ausência de data não é "muito antigo"
 * nem "muito no futuro", e deixá-la ordenar como string vazia jogaria essas linhas para o topo.
 */
function ordenarExtrato(extrato: ExtratoParcela[], filtro: FiltroDoExtrato | undefined): void {
  const coluna = filtro?.ordenarPor ?? "vencimento";
  const fator = filtro?.direcao === "desc" ? -1 : 1;

  const texto = (valor: null | string) => (valor ?? "").toLowerCase();
  const data = (valor: null | string) => valor ?? "";

  extrato.sort((a, b) => {
    if (coluna === "valor") return (a.valor - b.valor) * fator;
    if (coluna === "liquido") return ((a.liquido ?? -1) - (b.liquido ?? -1)) * fator;
    if (coluna === "cliente") return texto(a.cliente).localeCompare(texto(b.cliente), "pt-BR") * fator;
    if (coluna === "unidade") return a.unidade.localeCompare(b.unidade, "pt-BR", { numeric: true }) * fator;
    if (coluna === "situacao") return a.situacao.localeCompare(b.situacao) * fator;

    const chaveA = coluna === "pagamento" ? data(a.pagoEm) : data(a.vencimento);
    const chaveB = coluna === "pagamento" ? data(b.pagoEm) : data(b.vencimento);
    // Sem data vai para o fim nos DOIS sentidos, por isso o `fator` não entra aqui.
    if (!chaveA && !chaveB) return 0;
    if (!chaveA) return 1;
    if (!chaveB) return -1;

    return chaveA.localeCompare(chaveB) * fator;
  });
}

/**
 * Lê as linhas cruas do C2X (READ-ONLY), em lotes por `payments.id`.
 *
 * `incluirNaoPagas = false` lê SÓ o que foi pago (a carteira recebida — o comportamento original).
 * `true` amplia para as parcelas em aberto da carteira ativa (status 6 e 7, sem as apagadas), que
 * os indicadores precisam para previsto e inadimplente. O subconjunto PAGO é idêntico nos dois
 * modos, de propósito: é a garantia de que a soma da carteira e os KPIs saem da mesma fonte.
 */
async function lerLinhasDaCarteira(
  codes: string[],
  incluirNaoPagas: boolean,
): Promise<{ linhas: LinhaCruaDaCarteira[]; parcial: boolean } | { erro: string }> {
  const pool = getHadesDbPool();
  if (!pool.ok) {
    return { erro: `Configuracao C2X ausente: ${pool.missing.join(", ")}.` };
  }

  const marcadores = codes.map(() => "?").join(", ");
  const filtroPagas = "(p.paid_value > 0 and p.payment_date is not null)";
  const filtro = incluirNaoPagas
    ? `(${filtroPagas} or (p.payment_status_id in (6, 7)
         and (p.payment_to_delete is null or p.payment_to_delete = 0)))`
    : filtroPagas;
  const nome = (a: string) =>
    `coalesce(nullif(trim(${a}.name), ''), nullif(trim(${a}.fantasy_name), ''), nullif(trim(${a}.social_name), ''))`;

  const linhas: LinhaCruaDaCarteira[] = [];
  let cursor = 0;
  let parcial = false;

  for (;;) {
    const [lote] = await pool.pool.query(
      `select
         p.id                                  as payment_id,
         e.code                                as enterprise_code,
         eu.id                                 as unit_id,
         eu.block                              as unit_block,
         eu.lot                                as unit_lot,
         eu.price                              as unit_price,
         pt.name                               as parcel_type,
         ${nome("cli")}                        as cliente,
         ${nome("imo")}                        as imobiliaria,
         p.current_total_parcel                as parcela_n,
         p.total_parcels                       as parcela_total,
         p.current_signal_parcel               as sinal_n,
         p.total_signal_parcels                as sinal_total,
         p.payment_status_id                   as status_id,
         p.paid_value                          as valor,
         p.initial_value                       as valor_previsto,
         date_format(p.due_date, '%Y-%m-%d')      as due_date,
         date_format(p.payment_date, '%Y-%m-%d')  as payment_date,
         date_format(p.reference_date, '%m/%Y')   as competence,
         p.split_data,
         cps.initial_input_value               as entrada_contratada,
         ar.custom_commercial_plan             as plano_personalizado
       from payments p
       join acquisition_requests ar on ar.id = p.acquisition_request_id
       join enterprise_unities eu on eu.id = ar.enterprise_unity_id
       join enterprises e on e.id = eu.enterprise_id
       left join parcel_types pt on pt.id = p.parcel_type_id
       left join commercial_plans cps on cps.id = ar.commercial_plan_id
       left join users cli on cli.id = ar.client_id
       left join users imo on imo.id = cli.vinculed_by_id
      where e.code in (${marcadores})
        and ${filtro}
        and p.id > ?
      order by p.id asc
      limit ${LOTE}`,
      [...codes, cursor],
    );

    const cruas = lote as LinhaCruaDaCarteira[];
    linhas.push(...cruas);

    // Lote incompleto = acabou. Lote cheio com o teto batido = truncou, e a resposta VAI dizer.
    if (cruas.length < LOTE) break;
    if (linhas.length >= TETO) {
      parcial = true;
      break;
    }
    cursor = Number(cruas[cruas.length - 1]?.payment_id ?? 0);
    if (!cursor) break;
  }

  return { linhas, parcial };
}

/**
 * Lê as parcelas dos empreendimentos e devolve bruto e líquido — e, quando pedido, os indicadores.
 *
 * ⚠️ A SOMA DA CARTEIRA É SÓ O QUE FOI PAGO. A carteira do incorporador é o que ele já recebeu;
 * parcela a vencer não tem split executado, e projetá-la pela fórmula daria um "líquido" que
 * ninguém recebeu ainda. (Medido: existem pagamentos com `split_data` preenchido e `paid_value`
 * nulo — o rateio é definido antes da quitação. Filtrar por `paid_value > 0` é o que separa
 * recebido de previsto.) As parcelas em aberto entram SÓ nos indicadores (previsto/inadimplente),
 * e só quando `indicadores` é pedido, porque a consulta ampliada custa mais.
 *
 * ⚠️ A ENTRADA CONTRATADA TEM UM BURACO CONHECIDO, e ele está registrado aqui porque erra dinheiro
 * quando o split não existe. `acquisition_requests.custom_commercial_plan` é um BOOLEANO (não uma
 * FK), e medido em 17/08/2026: dos 2.844 contratos com plano, os 157 marcados como personalizados
 * apontam, em `commercial_plan_id`, para um plano DO EMPREENDIMENTO (`acquisition_request_id` nulo)
 * — ou seja, o valor que se lê é o da tabela base, não o que aquele cliente negociou. Onde o C2X
 * guarda a entrada personalizada ainda não foi encontrado.
 *
 * Isso NÃO afeta o Vale do Ouro hoje: medido, 68 de 68 pagamentos do VOC têm `split_data`, e o
 * split é a fonte preferida — a entrada só entra na fórmula de fallback. Mas para empreendimento
 * antigo, sem split, a conta usaria a entrada errada nesses 157 contratos. `plano_personalizado`
 * vem na consulta justamente para quem for mexer nisso ter o sinal na mão.
 *
 * @param codes Códigos JÁ FILTRADOS pelo escopo da sessão. Esta função NÃO autoriza nada: quem
 *   chama tem que ter passado por `codigosDaSessao`.
 */
export async function carteiraLiquidaDoIncorporador(input: {
  codes: string[];
  /** Quando presente, a leitura amplia para as parcelas em aberto e calcula os KPIs do BI. */
  indicadores?: {
    agoraMs: number;
    /** O recorte do extrato, aplicado no servidor. Ver `FiltroDoExtrato`. */
    filtroDoExtrato?: FiltroDoExtrato;
    nomePorCode?: Map<string, string>;
  };
  nomeDoIncorporador?: null | string;
  politicaPorCode: Map<string, PoliticaDoEmpreendimento>;
}): Promise<{ data: CarteiraLiquida; ok: true } | { error: string; ok: false }> {
  const codes = [...new Set(input.codes.map((c) => c.trim().toUpperCase()).filter(Boolean))];
  if (codes.length === 0) {
    return {
      data: {
        bruto: 0,
        indicadores: null,
        liquido: 0,
        motivos: [],
        parcial: false,
        parcelas: [],
        porSplit: 0,
        porUnidade: [],
        semLiquido: 0,
        total: 0,
      },
      ok: true,
    };
  }

  try {
    const leitura = await lerLinhasDaCarteira(codes, Boolean(input.indicadores));
    if ("erro" in leitura) return { error: leitura.erro, ok: false };

    const hoje = isoDia(input.indicadores?.agoraMs ?? Date.now());

    // A soma da carteira e o líquido por unidade contam SÓ as pagas, mesmo quando a leitura veio
    // ampliada para os indicadores: o subconjunto pago é idêntico nos dois modos.
    const pagas = leitura.linhas.filter((linha) => situacaoDaLinha(linha, hoje) === "paga");

    // ⚠️ A POLÍTICA É POR EMPREENDIMENTO, e a % de gestão de carteira muda entre eles mesmo para o
    // mesmo incorporador (regra do Lucas). Somar tudo com uma política só daria o número errado em
    // quem tem mais de um produto conosco — por isso o agrupamento por código.
    let bruto = 0;
    let liquido = 0;
    let porSplit = 0;
    let semLiquido = 0;
    const motivos = new Set<string>();

    const porCode = new Map<string, ParcelaParaLiquido[]>();
    for (const linha of pagas) {
      const code = String(linha.enterprise_code ?? "");
      const lista = porCode.get(code) ?? [];
      lista.push(
        parcelaParaLiquido(linha, Number(linha.valor ?? 0), input.nomeDoIncorporador),
      );
      porCode.set(code, lista);
    }

    for (const [code, doCode] of porCode) {
      const soma = somarLiquido(doCode, politicaDe(input.politicaPorCode, code));
      bruto += soma.bruto;
      liquido += soma.liquido;
      porSplit += soma.porSplit;
      semLiquido += soma.semLiquido;
      for (const motivo of soma.motivos) motivos.add(motivo);
    }

    // A lista resumida mantém o contrato antigo: as 500 pagas mais recentes, por data de
    // pagamento. O líquido vem POR PARCELA, com a política do empreendimento DELA — não dá para
    // ratear o total, porque a fatia muda conforme o tipo da parcela e a entrada do contrato.
    const recentes = [...pagas]
      .sort((a, b) => (b.payment_date ?? "").localeCompare(a.payment_date ?? ""))
      .slice(0, 500);

    return {
      data: {
        bruto,
        indicadores: input.indicadores
          ? montarIndicadores(leitura.linhas, {
              agoraMs: input.indicadores.agoraMs,
              filtroDoExtrato: input.indicadores.filtroDoExtrato,
              nomeDoIncorporador: input.nomeDoIncorporador,
              nomePorCode: input.indicadores.nomePorCode,
              politicaPorCode: input.politicaPorCode,
            })
          : null,
        liquido,
        motivos: [...motivos],
        parcial: leitura.parcial,
        parcelas: recentes.map((linha) => {
          const r = liquidoDaParcela(
            parcelaParaLiquido(linha, Number(linha.valor ?? 0), input.nomeDoIncorporador),
            politicaDe(input.politicaPorCode, linha.enterprise_code),
          );

          return {
            competencia: linha.competence,
            liquido: r.liquido,
            motivo: r.motivo,
            pagoEm: linha.payment_date,
            perfil: perfilDaParcela(linha.parcel_type),
            unidade: `${linha.unit_block ?? ""}${linha.unit_lot ?? ""}`.trim() || "—",
            valor: Number(linha.valor ?? 0),
          };
        }),
        porSplit,
        porUnidade: agregarPorUnidade(
          pagas,
          input.politicaPorCode,
          input.nomeDoIncorporador,
          hoje,
        ),
        semLiquido,
        total: pagas.length,
      },
      ok: true,
    };
  } catch (error) {
    console.error("[apolo][incorporador] falha ao ler a carteira liquida", error);
    return { error: "Nao foi possivel ler a carteira agora.", ok: false };
  }
}
