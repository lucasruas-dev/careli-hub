// O FINANCEIRO DE UMA VENDA IMPORTADA, LIDO DA CARTEIRA DO APOLO — e de lugar nenhum mais.
//
// Lucas (18/09/2026): *"a única coisa que vamos utilizar o c2x é a questão financeira, mesmo assim
// ela tem que morar dentro da carteira no apolo"* · *"tudo tem que ser alimentado pelo panteon"*.
//
// ⚠️ ESTE ARQUIVO NÃO LÊ O C2X, E NÃO PODE PASSAR A LER. Nada de `mysql2`, nada de
// `lib/guardian/db`, nada de `getHadesDbPool`. As telas de carteira que existem hoje
// (`carteira.ts`, `extrato-cliente-c2x.ts`, `termo-de-rescisao-server.ts`) leem o legado ao vivo;
// aqui a fonte é a cópia da carteira que mora no Panteon, em duas tabelas:
//
//     apolo_carteira_vendas    uma linha por venda sincronizada (o marcador)
//     apolo_carteira_parcelas  uma linha por parcela (`c2x_payment_id` é a chave)
//
// ⚠️ E AS DUAS AINDA NÃO EXISTEM (medido em 18/09/2026: nenhuma tabela `apolo_carteira_*` no banco).
// A migration e a escrita no sync precisam de OK do Lucas e ficaram fora da rodada. Até lá, a leitura
// responde "nunca sincronizada" para toda venda importada, e a tela diz isso em vez de inventar
// valor, recorrer ao C2X ou usar o retrato por pessoa (`apolo_financial_snapshots`), que soma todas
// as vendas da pessoa e não identifica a venda.
//
// ⚠️ E A TELA NÃO DIZ "SEM LANÇAMENTOS" NESSE CASO. O retrato por pessoa de 18/09/2026 tem as parcelas
// de 4 dos 6 distratos em análise (62 a 185, o total igual ao valor da venda com até R$ 1 de
// diferença, pago R$ 0,01). O que falta é a carteira separada por venda, e é o que a frase diz (ver
// `CARTEIRA_AINDA_SEM_A_VENDA` em `lib/temis/dados-do-contrato.ts`). Mostrar o retrato por pessoa
// quando ele identifica a venda (uma unidade, total igual ao valor) é decisão do Lucas, pendente.
//
// ⚠️ O MARCADOR EXISTE PARA SEPARAR DUAS AUSÊNCIAS. "Nunca sincronizou" e "sincronizou e não tem
// parcela nenhuma" pedem reações opostas: a primeira é pendência nossa; a segunda é um fato da
// venda (no VOL 4881 o Hércules registra ato pago e a carteira está vazia, e isso tem de aparecer
// como divergência, não como "ainda não carregou").
//
// ⚠️ LEITURA QUE FALHOU NÃO É "SEM CARTEIRA". A mesma lição de `lerCadDaEsteira`: um blip de rede que
// virasse "sem lançamentos" faria o distrato ser apurado como venda sem pagamento. Falha é `erro`.
// A única exceção é a tabela que ainda não existe, que é exatamente a pendência conhecida acima.

import type { SupabaseClient } from "@supabase/supabase-js";

import { ehTabelaAusente } from "@/lib/temis/tabela-ausente";

import {
  type ExtratoClienteContrato,
  type ExtratoClienteParcelaBruta,
  type ExtratoClienteRelatorio,
  hojeEmBrasilia,
  mensaisDoContrato,
  mensalidadePlausivel,
  mensalidadeTipica,
  montarExtratoDoContrato,
  parcelaAtiva,
  TIPO_ATO,
  TIPO_AVULSO,
  TIPO_MENSAL,
  TIPO_SINAL,
} from "./extrato-cliente";

// ── O QUE SAI DAQUI ──────────────────────────────────────────────────────────

/**
 * Os tipos de parcela como a análise precisa separá-los.
 *
 * ⚠️ "reforco" NÃO EXISTE NO C2X, e é por isso que ele está aqui. O legado grava anual,
 * intermediária e balão com o MESMO `parcel_type_id = 3` da mensal (AR 3716: uma de R$ 22.250,25 no
 * meio de 87 de R$ 674,25). Somá-los às mensais faria a tela anunciar "88 mensais" e uma mensalidade
 * média que ninguém paga. A régua é a mesma do extrato (`mensalidadePlausivel`): mais de três vezes a
 * mediana é reforço, não mensalidade.
 */
export type TipoNaCarteira = "ato" | "avulso" | "mensal" | "reforco" | "sinal";

export type ResumoDoTipo = {
  /** Soma CONTRATUAL (`initial_value`) do que está em aberto. Zero em contrato encerrado. */
  aberto: number;
  /** Soma do que ENTROU (`paid_value` das pagas). */
  pago: number;
  quantidade: number;
  /** Soma contratual de todas as parcelas ativas daquele tipo. */
  valorContratual: number;
  /** Soma contratual das vencidas em aberto. */
  vencido: number;
};

export type CarteiraDaVenda =
  | { situacao: "nativa" }
  | {
      motivo: "nunca_sincronizada" | "sem_parcela";
      situacao: "sem_carteira";
      /** 'YYYY-MM-DDTHH:mm…' da última sincronização; `null` quando nunca houve. */
      sincronizadaEm: null | string;
    }
  | ({ situacao: "ok"; sincronizadaEm: string } & ResumoDaCarteira)
  | { error: string; situacao: "erro" };

export type ResumoDaCarteira = {
  /** Ato + sinal, em valor de contrato. */
  entrada: number;
  /** Mensais + reforços (tudo que é `parcel_type_id = 3`), em valor de contrato. */
  financiado: number;
  /** A mensalidade típica (mediana das mensais). Zero sem mensais. */
  mensalidade: number;
  /** Quantas MENSAIS (sem os reforços). É o número que a tela chama de "parcelas". */
  parcelasMensais: number;
  porTipo: Record<TipoNaCarteira, ResumoDoTipo>;
  relatorio: ExtratoClienteRelatorio;
};

// ── AS LINHAS COMO ELAS CHEGAM ───────────────────────────────────────────────

/** Uma linha de `apolo_carteira_parcelas` (o contrato de leitura de 18/09/2026). */
export type LinhaDaParcelaNaCarteira = {
  a_excluir: boolean | null;
  boleto_url: null | string;
  c2x_payment_id: number | string;
  competencia: null | string;
  descricao: null | string;
  fatura_url: null | string;
  juros: null | number | string;
  multa: null | number | string;
  pagamento: null | string;
  parcela_atual: null | number | string;
  parcela_total: null | number | string;
  sinal_atual: null | number | string;
  sinal_total: null | number | string;
  status_id: null | number | string;
  tipo_id: null | number | string;
  tipo_nome: null | string;
  valor_inicial: null | number | string;
  valor_pago: null | number | string;
  vencimento: null | string;
};

type LinhaDaVendaNaCarteira = {
  estagio_c2x: null | number | string;
  parcelas: null | number | string;
  sincronizada_em: null | string;
};

/**
 * O cabeçalho da venda, montado SÓ com o Panteon (`hercules_propostas`, `hercules_unidades`,
 * `hercules_empreendimentos`). Quem já leu essas linhas (a Têmis) passa-as prontas e economiza as
 * três viagens.
 */
export type VendaParaCarteira = {
  area?: null | number | string;
  codigoDaUnidade?: null | string;
  dataAssinatura?: null | string;
  dataAto?: null | string;
  empreendimentoCodigo?: null | string;
  empreendimentoNome?: null | string;
  /** `hercules_propostas.etapa_c2x` — reserva do estágio quando o marcador não o tiver. */
  estagio?: null | number | string;
  lote?: null | string;
  /** `hercules_propostas.origem_c2x_id` = `acquisition_requests.id`. UNIQUE, sem ambiguidade. */
  origemC2xId: null | number | string;
  planoParcelas?: null | number | string;
  precoTabela?: null | number | string;
  quadra?: null | string;
};

// ── A LEITURA ────────────────────────────────────────────────────────────────

/** O PostgREST devolve no máximo 1.000 linhas por página (o teto do projeto). */
const PAGINA = 1000;

/** Cancelado (7), em distrato (10) e distratado (11): a mesma régua de `extrato-cliente-c2x.ts`. */
const ESTAGIOS_ENCERRADOS = [7, 10, 11];

let tabelaAusenteJaAvisada = false;

/**
 * A carteira de uma venda, pelo id da proposta.
 *
 * Nativa (nasceu no Panteon, sem `origem_c2x_id`) devolve `nativa`: a venda nativa tem cronograma
 * congelado na própria proposta e não precisa disto.
 */
export async function carteiraDaVenda(
  sb: SupabaseClient,
  propostaId: string,
  hoje: string = hojeEmBrasilia(),
): Promise<CarteiraDaVenda> {
  try {
    const { data, error } = await sb
      .from("hercules_propostas")
      .select(
        "data_assinatura, data_ato, empreendimento_id, etapa_c2x, origem_c2x_id, plano_parcelas, unidade_id",
      )
      .eq("id", propostaId)
      .maybeSingle();
    if (error) return { error: `hercules_propostas: ${error.message}`, situacao: "erro" };

    const proposta = data as null | {
      data_assinatura: null | string;
      data_ato: null | string;
      empreendimento_id: null | string;
      etapa_c2x: null | number;
      origem_c2x_id: null | number | string;
      plano_parcelas: null | number;
      unidade_id: null | string;
    };
    if (!proposta || !idDaVenda(proposta.origem_c2x_id)) return { situacao: "nativa" };

    const [unidade, empreendimento] = await Promise.all([
      proposta.unidade_id
        ? sb
            .from("hercules_unidades")
            .select("area, codigo, lote, preco_tabela, quadra")
            .eq("id", proposta.unidade_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      proposta.empreendimento_id
        ? sb
            .from("hercules_empreendimentos")
            .select("codigo, nome")
            .eq("id", proposta.empreendimento_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    if (unidade.error) return { error: `hercules_unidades: ${unidade.error.message}`, situacao: "erro" };
    if (empreendimento.error) {
      return { error: `hercules_empreendimentos: ${empreendimento.error.message}`, situacao: "erro" };
    }

    const u = unidade.data as null | Record<string, null | number | string>;
    const e = empreendimento.data as null | Record<string, null | string>;

    return carteiraDaVendaImportada(
      sb,
      {
        area: u?.area,
        codigoDaUnidade: u?.codigo as null | string | undefined,
        dataAssinatura: proposta.data_assinatura,
        dataAto: proposta.data_ato,
        empreendimentoCodigo: e?.codigo,
        empreendimentoNome: e?.nome,
        estagio: proposta.etapa_c2x,
        lote: u?.lote as null | string | undefined,
        origemC2xId: proposta.origem_c2x_id,
        planoParcelas: proposta.plano_parcelas,
        precoTabela: u?.preco_tabela,
        quadra: u?.quadra as null | string | undefined,
      },
      hoje,
    );
  } catch (erro) {
    return { error: erro instanceof Error ? erro.message : String(erro), situacao: "erro" };
  }
}

/**
 * A carteira de uma venda cujo cabeçalho quem chama já leu.
 *
 * ⚠️ NUNCA LANÇA. A Têmis chama isto de dentro da montagem do contrato, e um erro solto derrubaria a
 * análise inteira por causa de um bloco. O erro volta como `situacao: "erro"`, e quem mostra decide.
 */
export async function carteiraDaVendaImportada(
  sb: SupabaseClient,
  venda: VendaParaCarteira,
  hoje: string = hojeEmBrasilia(),
): Promise<CarteiraDaVenda> {
  const vendaId = idDaVenda(venda.origemC2xId);
  if (!vendaId) return { situacao: "nativa" };

  try {
    const { data: marcador, error: erroDoMarcador } = await sb
      .from("apolo_carteira_vendas")
      .select("estagio_c2x, parcelas, sincronizada_em")
      .eq("acquisition_request_c2x_id", vendaId)
      .maybeSingle();

    if (erroDoMarcador) {
      // ⚠️ A TABELA AUSENTE É A PENDÊNCIA CONHECIDA, NÃO UMA FALHA. Ver o topo: a migration espera o
      // OK do Lucas. Um `console.info` por processo, e não um `console.error` por card aberto.
      if (ehTabelaAusente(erroDoMarcador, "apolo_carteira_vendas")) {
        if (!tabelaAusenteJaAvisada) {
          tabelaAusenteJaAvisada = true;
          console.info(
            "[apolo][carteira-da-venda] apolo_carteira_vendas ainda não existe: toda venda importada responde 'nunca sincronizada'.",
          );
        }
        return { motivo: "nunca_sincronizada", situacao: "sem_carteira", sincronizadaEm: null };
      }
      return { error: `apolo_carteira_vendas: ${erroDoMarcador.message}`, situacao: "erro" };
    }

    const linhaDaVenda = marcador as LinhaDaVendaNaCarteira | null;
    if (!linhaDaVenda) {
      return { motivo: "nunca_sincronizada", situacao: "sem_carteira", sincronizadaEm: null };
    }

    const sincronizadaEm = String(linhaDaVenda.sincronizada_em ?? "").trim();
    const parcelas: ExtratoClienteParcelaBruta[] = [];

    // ⚠️ PAGINADO, SEMPRE. O PostgREST corta em 1.000 linhas sem avisar; uma venda de 180 mensais
    // cabe numa página, mas a regra da casa é não depender disso (ver o teto de 1.000).
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await sb
        .from("apolo_carteira_parcelas")
        .select(
          "a_excluir, boleto_url, c2x_payment_id, competencia, descricao, fatura_url, juros, multa, pagamento, parcela_atual, parcela_total, sinal_atual, sinal_total, status_id, tipo_id, tipo_nome, valor_inicial, valor_pago, vencimento",
        )
        .eq("acquisition_request_c2x_id", vendaId)
        .order("c2x_payment_id", { ascending: true })
        .range(de, de + PAGINA - 1);

      if (error) {
        if (ehTabelaAusente(error, "apolo_carteira_parcelas")) {
          return { motivo: "nunca_sincronizada", situacao: "sem_carteira", sincronizadaEm: null };
        }
        return { error: `apolo_carteira_parcelas: ${error.message}`, situacao: "erro" };
      }

      const pagina = Array.isArray(data) ? (data as LinhaDaParcelaNaCarteira[]) : [];
      parcelas.push(...pagina.map(parcelaDaCarteira));
      if (pagina.length < PAGINA) break;
    }

    const contrato = contratoDaVenda(venda, vendaId, linhaDaVenda.estagio_c2x);
    const resumo = resumirCarteira(parcelas, contrato, hoje);

    if (resumo.porTipoTotal === 0) {
      return {
        motivo: "sem_parcela",
        situacao: "sem_carteira",
        sincronizadaEm: sincronizadaEm || null,
      };
    }

    const { porTipoTotal: _contagem, ...semContagem } = resumo;
    return { ...semContagem, sincronizadaEm, situacao: "ok" };
  } catch (erro) {
    return { error: erro instanceof Error ? erro.message : String(erro), situacao: "erro" };
  }
}

// ── A PARTE PURA ─────────────────────────────────────────────────────────────

/**
 * A linha gravada no Panteon, no formato que o extrato do Apolo já sabe ler.
 *
 * ⚠️ O MOLDE É `mapearParcela` (`extrato-cliente-c2x.ts`), mas este arquivo NÃO o importa: aquele
 * módulo arrasta o driver do MySQL. A tradução é a mesma, coluna a coluna, e zero em
 * `parcela_atual`/`sinal_*` vira nulo, como o contrato de leitura pede.
 */
export function parcelaDaCarteira(linha: LinhaDaParcelaNaCarteira): ExtratoClienteParcelaBruta {
  return {
    aExcluir: linha.a_excluir === true,
    boletoUrl: textoOuNulo(linha.boleto_url),
    competencia: dataOuNulo(linha.competencia),
    descricao: textoOuNulo(linha.descricao),
    faturaUrl: textoOuNulo(linha.fatura_url),
    id: Number(linha.c2x_payment_id),
    juros: numero(linha.juros),
    multa: numero(linha.multa),
    pagamento: dataOuNulo(linha.pagamento),
    parcelaAtual: positivoOuNulo(linha.parcela_atual),
    parcelaTotal: positivoOuNulo(linha.parcela_total),
    sinalAtual: positivoOuNulo(linha.sinal_atual),
    sinalTotal: positivoOuNulo(linha.sinal_total),
    statusId: numero(linha.status_id),
    tipo: textoOuNulo(linha.tipo_nome),
    tipoId: numero(linha.tipo_id),
    valorInicial: numero(linha.valor_inicial),
    valorPago: numero(linha.valor_pago),
    vencimento: dataOuNulo(linha.vencimento),
  };
}

/**
 * O resumo que a análise mostra, montado sobre o MESMO extrato que o cliente recebe.
 *
 * ⚠️ PAGO SAI DE `realizados`, E O EM ABERTO DE `abertas` — nunca de `saldoAValorDeHoje`. O saldo a
 * valor de hoje tem o defeito do PAN-114 (levanta parcela sem boleto para a mensalidade vigente), e
 * num distrato o número que importa é o que o comprador PAGOU. Em contrato encerrado o extrato
 * esvazia `abertas`, e aqui o em aberto fica zero pelo mesmo motivo: não se cobra o que já acabou.
 */
export function resumirCarteira(
  parcelas: ExtratoClienteParcelaBruta[],
  contrato: ExtratoClienteContrato,
  hoje: string,
): ResumoDaCarteira & { porTipoTotal: number } {
  const relatorio = montarExtratoDoContrato({ contrato, hoje, parcelas });
  const ativas = parcelas.filter(parcelaAtiva);
  const tipica = mensalidadeTipica(mensaisDoContrato(ativas));

  const tipoDe = (tipoId: number, valorContratual: number): null | TipoNaCarteira => {
    if (tipoId === TIPO_ATO) return "ato";
    if (tipoId === TIPO_SINAL) return "sinal";
    if (tipoId === TIPO_AVULSO) return "avulso";
    if (tipoId === TIPO_MENSAL) {
      // ⚠️ SÓ A GRANDE É REFORÇO. `mensalidadePlausivel` também recusa a parcela MENOR que um terço da
      // mediana (serve ao extrato, que mede degrau), e aqui isso punha um resíduo de R$ 200 no meio
      // de mensais de R$ 1.000 como "Anuais e reforços" (revisão de 18/09/2026). Anual, intermediária
      // e balão são maiores que a mensal; a pequena continua sendo mensal.
      return mensalidadePlausivel(valorContratual, tipica) || valorContratual < tipica
        ? "mensal"
        : "reforco";
    }
    return null;
  };

  const porTipo: Record<TipoNaCarteira, ResumoDoTipo> = {
    ato: vazio(),
    avulso: vazio(),
    mensal: vazio(),
    reforco: vazio(),
    sinal: vazio(),
  };

  let total = 0;
  for (const linha of [...relatorio.realizados, ...relatorio.abertas]) {
    const tipo = tipoDe(linha.tipoId, linha.valorContratual);
    if (!tipo) continue;
    total += 1;
    const alvo = porTipo[tipo];
    alvo.quantidade += 1;
    alvo.valorContratual += linha.valorContratual;
    if (linha.situacao === "paga") alvo.pago += linha.valorPago ?? 0;
    else alvo.aberto += linha.valorContratual;
    if (linha.situacao === "vencida") alvo.vencido += linha.valorContratual;
  }

  // ⚠️ NO CONTRATO ENCERRADO, AS ABERTAS NÃO ESTÃO NO RELATÓRIO — e a QUANTIDADE contratada também
  // não. Contá-las de `ativas` devolveria o prazo que o contrato teve; contá-las do relatório, só o
  // que foi pago. Quem lê "parcelas" quer o contratado: ele vem de `ativas`, e o dinheiro em aberto
  // continua zero (acima).
  if (contrato.encerrado) {
    for (const tipo of Object.keys(porTipo) as TipoNaCarteira[]) {
      porTipo[tipo].quantidade = 0;
      porTipo[tipo].valorContratual = 0;
    }
    total = 0;
    for (const parcela of ativas) {
      const tipo = tipoDe(parcela.tipoId, parcela.valorInicial);
      if (!tipo) continue;
      total += 1;
      porTipo[tipo].quantidade += 1;
      porTipo[tipo].valorContratual += parcela.valorInicial;
    }
  }

  for (const tipo of Object.keys(porTipo) as TipoNaCarteira[]) {
    const alvo = porTipo[tipo];
    alvo.aberto = centavos(alvo.aberto);
    alvo.pago = centavos(alvo.pago);
    alvo.valorContratual = centavos(alvo.valorContratual);
    alvo.vencido = centavos(alvo.vencido);
  }

  return {
    entrada: centavos(porTipo.ato.valorContratual + porTipo.sinal.valorContratual),
    financiado: centavos(porTipo.mensal.valorContratual + porTipo.reforco.valorContratual),
    mensalidade: centavos(tipica),
    parcelasMensais: porTipo.mensal.quantidade,
    porTipo,
    porTipoTotal: total,
    relatorio,
  };
}

/** O cabeçalho que `montarExtratoDoContrato` pede, só com o que o Panteon tem. */
function contratoDaVenda(
  venda: VendaParaCarteira,
  vendaId: number,
  estagioDaCarteira: null | number | string,
): ExtratoClienteContrato {
  const estagio = numero(estagioDaCarteira) || numero(venda.estagio);
  return {
    area: numeroOuNulo(venda.area),
    codigo: textoOuNulo(venda.codigoDaUnidade) ?? `Venda ${vendaId}`,
    dataAssinatura: dataOuNulo(venda.dataAssinatura),
    dataAto: dataOuNulo(venda.dataAto),
    empreendimentoCodigo: textoOuNulo(venda.empreendimentoCodigo) ?? "-",
    empreendimentoNome: textoOuNulo(venda.empreendimentoNome),
    encerrado: ESTAGIOS_ENCERRADOS.includes(estagio),
    estagio,
    estagioNome: null,
    id: vendaId,
    // O índice e os juros são do plano, e o plano do C2X não mora no Panteon: o extrato escreve
    // "conforme a cláusula de correção do contrato" em vez de nomear índice que não sabe.
    indiceCorrecao: null,
    jurosContratuais: null,
    lote: textoOuNulo(venda.lote),
    planoPadraoParcelas: numeroOuNulo(venda.planoParcelas),
    planoParcelas: numeroOuNulo(venda.planoParcelas),
    planoPersonalizado: false,
    precoTabela: numeroOuNulo(venda.precoTabela),
    quadra: textoOuNulo(venda.quadra),
    titulares: [],
  };
}

// ── AJUDANTES ────────────────────────────────────────────────────────────────

function idDaVenda(bruto: unknown): null | number {
  const n = Number(String(bruto ?? "").trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

function vazio(): ResumoDoTipo {
  return { aberto: 0, pago: 0, quantidade: 0, valorContratual: 0, vencido: 0 };
}

function centavos(valor: number): number {
  return Math.round((Number.isFinite(valor) ? valor : 0) * 100) / 100;
}

function numero(valor: unknown): number {
  const n = typeof valor === "number" ? valor : Number(String(valor ?? "").trim() || 0);
  return Number.isFinite(n) ? n : 0;
}

function numeroOuNulo(valor: unknown): null | number {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

function positivoOuNulo(valor: unknown): null | number {
  const n = numeroOuNulo(valor);
  return n !== null && n > 0 ? n : null;
}

function textoOuNulo(valor: unknown): null | string {
  const t = String(valor ?? "").trim();
  return t || null;
}

/** 'YYYY-MM-DD…' → 'YYYY-MM-DD'. O extrato compara datas como texto, e a hora quebraria a ordem. */
function dataOuNulo(valor: unknown): null | string {
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(valor ?? "").trim());
  return m?.[1] ?? null;
}
