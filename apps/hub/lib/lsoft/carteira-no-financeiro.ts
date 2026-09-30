// A CARTEIRA DO LSOFT DENTRO DO FINANCEIRO DO PORTAL — hoje, só o Garden.
//
// O pedido do Lucas (29/09/2026): os clientes do Garden que o time adm validou com OK na planilha
// saem da tela LSoft Integração e aparecem na carteira do Financeiro do portal da Cecílio. Nas
// palavras dele: *"uma coisa simples, que já está validado"*, *"é só copiar e colar na carteira"* e
// *"esquece o c2x, cecilio não tem nenhum vinculo com o legado c2x"*.
//
// ⚠️ "COPIAR E COLAR" SEM DUPLICAR DINHEIRO. As parcelas continuam em `lsoft_parcelas` (o espelho),
// e quem está "na carteira" é marcado em `lsoft_clientes.empreendimentos_na_carteira` (migration
// 0199, do lado LSoft). Este arquivo LÊ esse espelho e devolve as unidades e o resumo NO MESMO
// FORMATO que `/api/incorporador/carteira` já entrega para o C2X, para a TelaCarteira mostrar as
// duas fontes na mesma tabela e nos mesmos cartões. A baixa continua sendo dada na ficha do LSoft
// (o `PainelDoCliente`), que a tela abre ao clicar na unidade.
//
// ⚠️ A RÉGUA CAMPO A CAMPO, C2X (lib/apolo/carteira.ts, `runCarteiraQueries`) × LSOFT (aqui):
//   • totalContract / totalPortfolio (VGV, "Carteira total")
//       C2X: principal (`initial_value`) das parcelas da carteira ativa (status 5, 6 e 7).
//       LSoft: RECEBIDO das pagas + NOMINAL (`valor`) das abertas. É a "Carteira total" da tela
//       LSoft Integração (`saldo_aberto + total_recebido` da view 0107), e fecha por construção:
//       VGV = pago + a receber + vencido.
//   • paidAmount (Pago / Recebido)
//       C2X: principal das pagas (status 5), e não o `paid_value`.
//       LSoft: o `valor_recebido` das pagas (`paga = true`), e NÃO o `valor` nominal.
//       ⚠️ AQUI O GARDEN NÃO SEGUE O C2X, DE PROPÓSITO (revisão de 29/09/2026). O pedido é *"é só
//       copiar e colar na carteira"* (Lucas, 29/09/2026): o time adm validou os 106 olhando o
//       "Recebido" da tela LSoft Integração, que é o recebido, e a ficha que abre no clique mostra o
//       recebido parcela a parcela. Com o nominal, o Recebido do Financeiro mudava na colagem:
//       medido em 29/09/2026 nos 106, R$ 4.598.301,40 nominais contra R$ 4.484.836,13 recebidos
//       (juros de quem pagou atrasado, desconto de quem pagou antes), e o Pago da linha divergia da
//       ficha em 105 dos 106 clientes. Nenhuma parcela paga dos 106 está sem `valor_recebido`.
//   • toReceiveAmount (A receber)
//       C2X: principal do status 6 (em aberto, ainda "em dia" no legado).
//       LSoft: `valor` das não pagas com vencimento >= hoje (ou sem vencimento).
//   • overdueAmount / overdueInstallments (Vencido)
//       C2X: `OUTSTANDING` (principal + juros + multa − pago) das vencidas (`OVERDUE`: status 7 ou
//       vencimento < hoje).
//       LSoft: `valor` das não pagas com vencimento < hoje. O espelho não tem juros nem multa, e a
//       parcela vencida não tem pagamento parcial (conferido: nenhuma aberta com `valor_recebido`).
//   • maxOverdueDays (maior atraso): dias entre hoje e o vencimento da vencida MAIS ANTIGA, como o
//       `datediff(curdate(), due_date)` do C2X.
//   • expectedToDate (Previsto até hoje): o que venceu até hoje INCLUSIVE, pago ou não, como o
//       `due_date <= curdate()` do C2X. É o denominador da inadimplência, e é NOMINAL também nas
//       pagas: previsto é o que era devido, e não o que entrou.
//   • delinquencyRate: vencido ÷ previsto até hoje, a valor presente (Lucas, 20/08/2026).
//   • recoveryAmount (Recuperação): C2X soma o `paid_value` das pagas com pagamento no mês corrente;
//       LSoft soma o `valor_recebido` das pagas com `data_recebido` no mês corrente.
//   • contracts: as LINHAS, uma por (cliente, lote novo), como o C2X conta uma por contrato.
//       clients: os clientes DISTINTOS (o C2X faz `count(distinct client_id)`). Com dois lotes, o
//       mesmo cliente é um cliente e dois contratos. criticalContracts: linhas com mais de 3 vencidas,
//       como o C2X (por contrato).
//   • overdueClients: clientes distintos com pelo menos uma vencida em qualquer das linhas.
//
// ⚠️ "HOJE" É O DE SÃO PAULO (`hojeNaCasa`), e não o `current_date` do banco. As views do LSoft
// (0097/0107) usam `current_date`, que está em UTC e vira o dia às 21h: das 21h à meia-noite elas
// chamam de vencida a parcela que vence hoje. Por isso os números saem das PARCELAS, e não da view.
//
// ⚠️ POR QUE AS PARCELAS E NÃO A VIEW 0107, AO CONTRÁRIO DO QUE O PLANO DIZIA. O Recebido e a
// Carteira total saem iguais aos da view (ver a régua acima), mas o resto não cabe nela: o vencido
// dela está no fuso errado (acima), e ela não tem o previsto até hoje, a recuperação do mês nem o
// maior atraso. As parcelas são a mesma fonte que a view agrega, lidas uma vez só, e dão tudo isso
// no dia de São Paulo. A régua da view é mantida onde ela decide dinheiro:
// a parcela CONFIRMADA como subsídio da Caixa sai da carteira do cliente (0107: `situacao =
// 'confirmada' and classe = 'caixa'`). No Garden não há nenhuma (conferido em 29/09/2026), e a regra
// fica para o dia em que houver.
//
// ⚠️ O LOTE É O NOVO, O DO BOLETO (decisão do Lucas, 29/09/2026). O Garden foi renumerado e o LSoft
// guarda o lote antigo (medido: "Q13 L365" no LSoft para um lote que o boleto chama de "Q13 L20").
// O lote novo mora em `boletos_documentos` (empreendimento `garden`), e o casamento é pelo CPF, só
// dígitos dos dois lados. Medido em 29/09/2026: os 106 que sobem casam, 6 deles com dois lotes.
//
// ⚠️ UMA LINHA POR LOTE, E NÃO POR CLIENTE (Lucas, 29/09/2026, olhando o cliente de dois lotes que
// aparecia numa linha só: *"se ele tem dois lotes, tem que ter duas linhas"*). As parcelas de cada
// cliente são repartidas pelo lote ANTIGO que o LSoft gravou nelas, convertido para o novo pelo mapa
// conferido (lib/lsoft/lotes-do-garden.ts), e cada lote vira uma linha com os números SÓ das
// parcelas dele. A sequência que o LSoft lança para dois lotes do mesmo CPF ("LOTE: 216 E 217") é
// repartida em partes iguais, como o hub já cobra (um boleto por lote, de valor igual). Nenhum
// dinheiro nasce nem some na partilha: cada parcela cai numa linha, ou em partes que somam ela no
// centavo, e a soma das linhas é a mesma de quando era uma por cliente (conferido em 29/09/2026 nos
// 106: carteira R$ 35.041.558,35, recebido R$ 4.484.836,13, em aberto R$ 30.556.722,22). As regras
// de quem vai para onde estão em `dividirPorLote`.

import { createApoloAdminClient } from "@/lib/apolo/server";
import type { ApoloCarteiraSummary } from "@/lib/apolo/carteira";
import { type CatalogoParaId, idsDoC2xDasSiglas } from "@/lib/apolo/c2x-pelo-id";
import { GARDEN } from "@/lib/lsoft/categorias";
import { loteNovoDoAntigo, lotesCitadosNoTexto, partesDoLoteNovo } from "@/lib/lsoft/lotes-do-garden";
import { COLUNA_NA_CARTEIRA, colunaNaCarteiraAusente } from "@/lib/lsoft/na-carteira";

// ── QUEM ENTRA ──────────────────────────────────────────────────────────────

/** Um empreendimento cuja carteira o Financeiro lê do espelho do LSoft, e não do C2X. */
export type EmpreendimentoDoLsoftNoFinanceiro = {
  /** `lsoft_parcelas.categoria_lsoft`. No Garden, 124 (a categoria É o empreendimento). */
  categoriaLsoft: number;
  /**
   * O `enterprises.id` do C2X que a sessão do portal carrega para este empreendimento. É por ELE que
   * a rota sabe se o recorte pedido inclui o empreendimento, e nunca pela sigla (PAN-124: a sigla
   * muda no renome, o id não).
   */
  c2xEnterpriseId: number;
  /** O nome em `lsoft_parcelas.empreendimento` e em `empreendimentos_na_carteira`. */
  chaveLsoft: string;
  /** O nome de mercado, quando o seletor do portal não trouxer um. */
  nomePadrao: string;
  /** O prefixo do código da unidade, o mesmo do C2X e do masterplan ("GDN0614"). */
  prefixoDoCodigo: string;
  /** `boletos_documentos.empreendimento` (o slug de lib/apolo/boletos/empreendimentos.ts). */
  slugDoBoleto: string;
};

/**
 * ⚠️ SÓ O GARDEN, E DE PROPÓSITO. É o único com carteira validada para subir (29/09/2026). O Vale
 * do Sol e o Vale do Ouro - 2 também vivem no LSoft, mas ninguém validou a carteira deles para o
 * Financeiro; entrar aqui por consequência de refactor seria mostrar ao loteador um número que o
 * time adm ainda não conferiu.
 */
export const EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO: readonly EmpreendimentoDoLsoftNoFinanceiro[] = [
  {
    c2xEnterpriseId: 39,
    categoriaLsoft: 124,
    chaveLsoft: GARDEN,
    nomePadrao: "Garden",
    prefixoDoCodigo: "GDN",
    slugDoBoleto: "garden",
  },
];

/** Um empreendimento do LSoft que o recorte pedido inclui, com as siglas que o representam. */
export type EmpreendimentoNoRecorte = {
  /** As siglas do recorte que traduzem SÓ para este empreendimento (para o nome e para o líquido). */
  codes: string[];
  empreendimento: EmpreendimentoDoLsoftNoFinanceiro;
};

/**
 * O que a rota pede ao C2X e o que ela lê do LSoft, a partir do recorte já resolvido.
 *
 * ⚠️ O EMPREENDIMENTO DO LSOFT NÃO VAI MAIS AO C2X. No legado o Garden tem zero parcela em carteira
 * ativa, e somar as duas fontes do mesmo empreendimento é exatamente o erro que se quer evitar: no
 * dia em que alguém lançar uma parcela do Garden no C2X, ela apareceria duas vezes.
 *
 * ⚠️ A SIGLA SÓ SAI DO LÍQUIDO QUANDO O CATÁLOGO A TRADUZ INTEIRA PARA O EMPREENDIMENTO DO LSOFT. Sigla
 * que o catálogo não conhece (um renome recente) fica na lista: o C2X devolve zero para ela, que é o
 * mesmo que não pedir. O bruto não depende disso, porque vai pelo id.
 */
export function recorteDoLsoft(entrada: {
  catalogo: CatalogoParaId;
  codes: readonly string[];
  /** Os `enterprises.id` do recorte, como a rota já os traduziu (`idsDoC2xDasSiglasAoVivo`). */
  ids: readonly number[];
  lista?: readonly EmpreendimentoDoLsoftNoFinanceiro[];
}): { codesDoC2x: string[]; idsDoC2x: number[]; noRecorte: EmpreendimentoNoRecorte[] } {
  const lista = entrada.lista ?? EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO;
  const presentes = lista.filter((emp) => entrada.ids.includes(emp.c2xEnterpriseId));
  const idsDoLsoft = new Set(presentes.map((emp) => emp.c2xEnterpriseId));

  const noRecorte: EmpreendimentoNoRecorte[] = presentes.map((empreendimento) => ({
    codes: [],
    empreendimento,
  }));
  const codesDoC2x: string[] = [];

  for (const code of entrada.codes) {
    const ids = idsDoC2xDasSiglas([code], { catalogo: entrada.catalogo }, { excluir: [] }).ids;
    const soDoLsoft = ids.length > 0 && ids.every((id) => idsDoLsoft.has(id));
    if (!soDoLsoft) {
      codesDoC2x.push(code);
      continue;
    }
    for (const item of noRecorte) {
      if (ids.includes(item.empreendimento.c2xEnterpriseId)) item.codes.push(code);
    }
  }

  return {
    codesDoC2x,
    idsDoC2x: entrada.ids.filter((id) => !idsDoLsoft.has(id)),
    noRecorte,
  };
}

// ── O FORMATO DE SAÍDA (o mesmo da rota) ────────────────────────────────────

/**
 * Uma unidade do LSoft como o portal a mostra: os campos de `UnidadeDoPortal` (a rota) mais a
 * origem e o código do cliente no LSoft, que a tela usa para abrir a ficha.
 *
 * ⚠️ O QUE NÃO EXISTE NO LSOFT SAI NULO, E A TELA DIZ ISSO. Líquido: a política comercial do Garden
 * é nula, então não há rateio para aplicar (a tela escreve "não apurado"). Contrato assinado,
 * faturamento e imobiliária: o espelho não tem.
 */
export type UnidadeDoLsoftNoPortal = {
  /**
   * O que a linha precisa dizer ao loteador além dos números, sempre pelo lote NOVO: outro lote no
   * mesmo CPF, lote a confirmar, lote em conferência, parcelas divididas com outro lote. O que é
   * defeito do LSoft (parcela sem lote, lote de outro CPF, numeração antiga) não vem aqui: fica nas
   * `notas` de `dividirPorLote`, que são do time adm.
   */
  avisos: string[];
  block: null | string;
  client: null | string;
  code: string;
  contractCode: null;
  empreendimento: null | string;
  faturadoAt: null;
  /**
   * `lsoft:<código>:<unidade>` ("lsoft:00000123:GDN1226"), ou `lsoft:<código>` na linha sem lote.
   * Nunca colide com o id numérico do C2X nem com o uuid do Panteon.
   *
   * ⚠️ O LOTE ENTRA NO ID DESDE QUE O CLIENTE PODE TER DUAS LINHAS. A tabela chaveia a linha por id +
   * contrato + comprador (modules/incorporador/chave-da-linha.ts), e no LSoft contrato é nulo e o
   * comprador é o mesmo nas duas: com o id só do cliente, as duas linhas teriam a mesma chave, que é
   * o defeito que deixou linha órfã na tabela em 21/09/2026.
   */
  id: string;
  imobiliaria: null;
  liquido: null;
  lot: null | string;
  /** O código do cliente no LSoft: é por ele que a tela abre a ficha (`PainelDoCliente`). */
  lsoftCodigo: string;
  maxOverdueDays: number;
  origem: "lsoft";
  overdueAmount: number;
  overdueInstallments: number;
  paidAmount: number;
  temContrato: false;
  toReceiveAmount: number;
  totalContract: number;
};

export type CarteiraDoLsoftNoPortal = {
  summary: ApoloCarteiraSummary;
  units: UnidadeDoLsoftNoPortal[];
};

// ── AS ENTRADAS PURAS ───────────────────────────────────────────────────────

export type ClienteDaCarteiraNoFinanceiro = { codigo: string; cpf: null | string; nome: string };

export type ParcelaDaCarteiraNoFinanceiro = {
  clienteCodigo: string;
  dataRecebido: null | string;
  id: string;
  /** O lote ANTIGO que o LSoft gravou na coluna (`lsoft_parcelas.lote`). Decide a linha da parcela. */
  lote: null | string;
  /** O texto da parcela no LSoft: dá o lote quando a coluna está vazia, e cita os outros lotes. */
  observacoes: null | string;
  paga: boolean;
  /** A quadra que o LSoft gravou (numeração antiga): desempata qual lote do boleto é o principal. */
  quadra: null | string;
  valor: number;
  valorRecebido: number;
  vencimento: null | string;
};

/** Um lote novo do boleto: o CPF (só dígitos), o rótulo ("Q06 L14") e se a conversão é incerta. */
export type LoteDoBoleto = { documento: string; incerta: boolean; unidade: string };

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/** Reais para centavos inteiros: a soma de milhares de parcelas em ponto flutuante deixa resíduo. */
const emCentavos = (valor: number): number => Math.round((Number.isFinite(valor) ? valor : 0) * 100);
const emReais = (centavos: number): number => centavos / 100;

/**
 * "Q06 L14", "Q6-L14", "q06 l14" → quadra "06" e lote "14". Qualquer outra coisa: nulo. A régua é
 * a de lib/lsoft/lotes-do-garden.ts, a mesma que converte o lote antigo, para as duas pontas
 * escreverem o lote novo igual.
 */
export function quadraELoteDoBoleto(unidade: string): null | { lote: string; quadra: string } {
  return partesDoLoteNovo(unidade);
}

/** "GDN" + quadra(2) + lote(2): o código que o C2X e o masterplan dão ao lote ("GDN0614"). */
export function codigoDaUnidade(prefixo: string, quadra: string, lote: string): string {
  return `${prefixo}${quadra}${lote}`;
}

/** O rótulo curto do lote, como a planilha de boletos e a ficha do LSoft escrevem: "Q06 L14". */
const rotuloDoLote = (quadra: string, lote: string): string => `Q${quadra} L${lote}`;

/** Um lote novo do boleto de um CPF, já lido: quadra e lote com dois dígitos, e o rótulo. */
export type LoteDoCpf = { incerta: boolean; lote: string; quadra: string; rotulo: string };

/**
 * Os lotes do boleto deste CPF, sem repetir, na ordem de quem é o PRINCIPAL:
 *   1. o lote de conversão CERTA antes do incerto (`boletos_parcelas.unidade_incerta`, 0118: os
 *      lotes em que as duas fontes da renumeração discordam);
 *   2. o lote cuja quadra aparece nas parcelas do LSoft (a quadra mudou pouco na renumeração: casa
 *      em 100 dos 106 que sobem);
 *   3. quadra e lote crescentes, para a escolha não depender da ordem de leitura.
 * Medido em 29/09/2026: um dos 106 tem no boleto um segundo lote, INCERTO e de outra quadra, que a
 * validação da planilha não reconhece como dele. Sem os passos 1 e 2 ele viraria o principal.
 */
export function lotesDoCpf(entrada: {
  cpf: null | string;
  lotes: readonly LoteDoBoleto[];
  quadrasNoLsoft: ReadonlySet<number>;
}): LoteDoCpf[] {
  const cpf = soDigitos(entrada.cpf);
  if (!cpf) return [];

  const candidatos: LoteDoCpf[] = [];
  for (const lote of entrada.lotes) {
    if (soDigitos(lote.documento) !== cpf) continue;
    const partes = quadraELoteDoBoleto(lote.unidade);
    if (!partes) continue;
    candidatos.push({ incerta: lote.incerta, ...partes, rotulo: rotuloDoLote(partes.quadra, partes.lote) });
  }

  // O mesmo lote duas vezes (a leitura não repete, mas a régua não depende disso).
  const unicos = [...new Map(candidatos.map((c) => [c.rotulo, c])).values()];

  return unicos.sort((a, b) => {
    if (a.incerta !== b.incerta) return a.incerta ? 1 : -1;
    const aCasa = entrada.quadrasNoLsoft.has(Number(a.quadra));
    const bCasa = entrada.quadrasNoLsoft.has(Number(b.quadra));
    if (aCasa !== bCasa) return aCasa ? -1 : 1;
    return Number(a.quadra) - Number(b.quadra) || Number(a.lote) - Number(b.lote);
  });
}

/**
 * O rótulo com que a linha cita outro lote do boleto.
 *
 * ⚠️ O OUTRO LOTE INCERTO VAI MARCADO. Medido em 29/09/2026 contra a planilha validada: 105 dos 106
 * saem idênticos; no que sobra, o principal é o validado e o boleto ainda liga o mesmo CPF a um lote
 * incerto que a validação não reconhece. Citar esse lote sem a marca afirmaria ao loteador uma posse
 * que ninguém confirmou.
 */
const citacaoDoLote = (lote: LoteDoCpf): string => `${lote.rotulo}${lote.incerta ? " (em conferência)" : ""}`;

/**
 * Qual lote do boleto é o principal deste cliente, e quais outros o mesmo CPF tem (na ordem de
 * `lotesDoCpf`). É a leitura só do boleto: quem decide as linhas é `dividirPorLote`.
 */
export function loteDoCliente(entrada: {
  cpf: null | string;
  lotes: readonly LoteDoBoleto[];
  quadrasNoLsoft: ReadonlySet<number>;
}): { outros: string[]; principal: null | { incerta: boolean; lote: string; quadra: string } } {
  const [primeiro, ...resto] = lotesDoCpf(entrada);
  if (!primeiro) return { outros: [], principal: null };
  return {
    outros: resto.map(citacaoDoLote),
    principal: { incerta: primeiro.incerta, lote: primeiro.lote, quadra: primeiro.quadra },
  };
}

/** Uma linha da carteira antes dos números: o lote novo, as parcelas dele e o que a linha diz. */
export type LoteDaCarteira = {
  /**
   * O que a linha diz AO LOTEADOR, e vai para a tela do portal: só lote NOVO, como o boleto e o
   * mapa escrevem. Lote em conferência, lote a confirmar, parcelas divididas com outro lote do mesmo
   * CPF, outro lote do mesmo CPF.
   */
  avisos: string[];
  /** Nulo = "Lote a confirmar" (o CPF não tem boleto do empreendimento). */
  lote: null | { incerta: boolean; lote: string; quadra: string };
  /**
   * O que o TIME ADM precisa corrigir ou conferir no LSoft, e o loteador não: parcela sem lote, lote
   * antigo fora do mapa, lote que o boleto dá a outro CPF, lote antigo citado sem número novo.
   *
   * ⚠️ NÃO VAI PARA A UNIDADE DA TELA (`montarCarteiraDoLsoft` não copia; revisão de 29/09/2026). O
   * portal é de cliente externo e já se proíbe CPF e código interno no texto (ver "Lote a
   * confirmar"); a numeração antiga e o erro de digitação do LSoft são a mesma coisa. E o "(sem
   * número novo)" ainda enganava: medido em 29/09/2026, nos 15 clientes em que ele aparecia, o
   * boleto do lote novo vale o dobro (ou o triplo) de um lote, igual à parcela do LSoft, isto é, os
   * lotes antigos foram REUNIDOS no novo, e não sumiram da planta. Fica aqui, puro e testado, para
   * o ensaio e para a tela LSoft Integração, que é interna.
   */
  notas: string[];
  /**
   * As parcelas da linha. ⚠️ A parcela repartida (ver `dividirPorLote`) aparece em cada linha com o
   * MESMO id e só a parte daquele lote em `valor` e `valorRecebido`.
   */
  parcelas: ParcelaDaCarteiraNoFinanceiro[];
};

/** "1 parcela", "8 parcelas". */
const parcelasPorExtenso = (n: number): string => `${n} ${n === 1 ? "parcela" : "parcelas"}`;

/** "a", "a e b", "a, b e c". */
function emLista(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? "";
  return `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
}

/** "o lote Q04 L13", "os lotes Q04 L13 e Q04 L14". */
const oLote = (rotulos: readonly string[]): string =>
  `${rotulos.length === 1 ? "o lote" : "os lotes"} ${emLista(rotulos)}`;

/**
 * `centavos` em `n` partes iguais, com o resto (menos de `n` centavos) na PRIMEIRA. A soma das partes
 * é exatamente o todo: nenhum centavo nasce nem some na divisão.
 */
export function partesIguaisEmCentavos(centavos: number, n: number): number[] {
  const base = Math.trunc(centavos / n);
  const resto = centavos - base * n;
  return Array.from({ length: n }, (_, i) => base + (i === 0 ? resto : 0));
}

/** A parcela em `n` partes iguais de `valor` e de `valorRecebido`, no centavo (resto na primeira). */
function repartirParcela(parcela: ParcelaDaCarteiraNoFinanceiro, n: number): ParcelaDaCarteiraNoFinanceiro[] {
  const valores = partesIguaisEmCentavos(emCentavos(parcela.valor), n);
  const recebidos = partesIguaisEmCentavos(emCentavos(parcela.valorRecebido), n);
  return valores.map((valor, i) => ({ ...parcela, valor: emReais(valor), valorRecebido: emReais(recebidos[i] ?? 0) }));
}

/** A lista tem dinheiro (nominal ou recebido)? Lote só de parcela zerada não vira linha (ver `montarCarteiraDoLsoft`). */
const temDinheiro = (parcelas: readonly ParcelaDaCarteiraNoFinanceiro[] | undefined): boolean =>
  (parcelas ?? []).some((p) => emCentavos(p.valor) !== 0 || emCentavos(p.valorRecebido) !== 0);

/** Soma um item a um conjunto dentro de um mapa, criando o conjunto na primeira vez. */
function anotar<T>(mapa: Map<string, Set<T>>, chave: string, item: T): void {
  const conjunto = mapa.get(chave) ?? new Set<T>();
  conjunto.add(item);
  mapa.set(chave, conjunto);
}

/**
 * Reparte as parcelas de UM cliente em linhas, uma por lote novo, e diz o que cada linha avisa ao
 * loteador (`avisos`) e o que fica para o time adm (`notas`). PURA. As regras (Lucas, 29/09/2026:
 * *"se ele tem dois lotes, tem que ter duas linhas"*):
 *
 *   • O LOTE DA PARCELA é o da coluna `lote` do LSoft; com a coluna vazia, o primeiro lote que o
 *     texto (`observacoes`) cita. Convertido para o novo pelo mapa (lib/lsoft/lotes-do-garden.ts).
 *   • ⚠️ A LINHA SÓ NASCE PARA LOTE QUE O BOLETO LIGA AO CPF. O lote convertido que o boleto do
 *     cliente não tem vai para a linha principal, com nota. Medido em 29/09/2026: 2 parcelas anuais
 *     de um cliente (a 4ª e a 6ª de 7) estão no LSoft com o lote de OUTRO cliente, que tem 91 parcelas
 *     nele, e o boleto dá esse lote a outro CPF. É erro de digitação do LSoft; uma linha própria
 *     mostraria ao loteador o mesmo lote em dois compradores.
 *   • Parcela SEM LOTE (nem na coluna nem no texto) e lote FORA DO MAPA vão para a linha principal,
 *     com nota dizendo quantas são.
 *   • ⚠️ SEQUÊNCIA CONJUNTA DE LOTES DO MESMO CPF É REPARTIDA EM PARTES IGUAIS (revisão de
 *     29/09/2026, que desfez o "fica no primeiro"). O LSoft lança "LOTE: 216 E 217" como UMA
 *     sequência, com o 216 na coluna. Quando TODOS os lotes que a parcela cita (coluna e texto)
 *     convertem para lotes que o boleto liga ao mesmo CPF, cada lote recebe uma parte igual de cada
 *     parcela, no centavo, com o resto no lote da coluna. A divisão não é inventada: medido em
 *     29/09/2026 nos 4 clientes assim (dois lotes no boleto, uma sequência no LSoft), a parcela do
 *     LSoft vale o DOBRO da de um lote (4.238,10 contra 2.119,05; a anual, 20.000 contra 10.000), e o
 *     hub já cobra meio a meio: um boleto por lote, de valor igual (2.119,05 cada em 03/2026). E é
 *     o pedido: *"a partir de setembro, quem alimenta a carteira é o hub"* (Lucas, 29/09/2026).
 *   • ⚠️ SE ALGUM LOTE CITADO NÃO CONVERTE, OU É DE OUTRO CPF, A PARCELA NÃO É REPARTIDA: fica
 *     inteira no lote da coluna. Medido em 29/09/2026: nos 15 clientes com lote antigo sem número
 *     novo na sequência ("LOTE: 90/91"), o boleto é UM só, do lote novo que reuniu os antigos, e vale
 *     a parcela inteira. Repartir ali seria tirar dinheiro do único lote que existe.
 *   • A LINHA PRINCIPAL é o primeiro lote do boleto (ordem de `lotesDoCpf`) que tem dinheiro nas
 *     parcelas próprias; sem nenhum, o primeiro com parcela; sem nenhum, o primeiro do boleto. Só ela
 *     leva as notas do cliente e o "O mesmo CPF também tem".
 *   • Lote do boleto sem linha (sem parcela, ou só com parcela zerada) entra como aviso na linha
 *     principal ("O mesmo CPF também tem o lote X"), a não ser que alguma linha já diga que as
 *     parcelas dela cobrem esse lote.
 *   • CPF sem boleto do empreendimento: uma linha só, "Lote a confirmar", como era antes da partilha.
 */
export function dividirPorLote(entrada: {
  cpf: null | string;
  lotes: readonly LoteDoBoleto[];
  nomeDoEmpreendimento: string;
  parcelas: readonly ParcelaDaCarteiraNoFinanceiro[];
}): LoteDaCarteira[] {
  const quadras = new Set<number>();
  for (const parcela of entrada.parcelas) {
    const quadra = Number(soDigitos(parcela.quadra));
    if (quadra > 0) quadras.add(quadra);
  }

  const doCpf = lotesDoCpf({ cpf: entrada.cpf, lotes: entrada.lotes, quadrasNoLsoft: quadras });
  if (doCpf.length === 0) {
    if (entrada.parcelas.length === 0) return [];
    return [
      {
        // ⚠️ O TEXTO VAI PARA A TELA DO LOTEADOR: sem CPF, sem código interno, e dizendo o que falta.
        avisos: [`Lote a confirmar: não há boleto do ${entrada.nomeDoEmpreendimento} neste CPF.`],
        lote: null,
        notas: [],
        parcelas: [...entrada.parcelas],
      },
    ];
  }

  const doCpfPorRotulo = new Map(doCpf.map((lote) => [lote.rotulo, lote]));
  const porLote = new Map<string, ParcelaDaCarteiraNoFinanceiro[]>();
  const juntar = (rotulo: string, parcela: ParcelaDaCarteiraNoFinanceiro) => {
    const lista = porLote.get(rotulo) ?? [];
    lista.push(parcela);
    porLote.set(rotulo, lista);
  };

  /** Com quais lotes cada linha divide parcelas, e quantas parcelas dela são divididas. */
  const repartidoCom = new Map<string, Set<string>>();
  const repartidasPorLote = new Map<string, number>();
  /** Lotes do MESMO CPF que as parcelas inteiras de cada linha dizem cobrir (vão ao loteador). */
  const cobreDoCpf = new Map<string, Set<string>>();
  /** Lotes antigos sem número novo e lotes de outro CPF que as parcelas citam (vão às notas). */
  const citaSemConversao = new Map<string, Set<string>>();
  const citaDeOutroCpf = new Map<string, Set<string>>();

  const paraOPrincipal: ParcelaDaCarteiraNoFinanceiro[] = [];
  let semLote = 0;
  const foraDoMapa = new Map<string, number>();
  const foraDoCpf = new Map<string, number>();

  for (const parcela of entrada.parcelas) {
    // A coluna passa pela mesma leitura do texto: "397" e um eventual "216/217" saem iguais.
    const daColuna = lotesCitadosNoTexto(`LOTE ${parcela.lote ?? ""}`);
    const doTexto = lotesCitadosNoTexto(parcela.observacoes);
    const antigo = daColuna[0] ?? doTexto[0] ?? null;

    if (antigo === null) {
      semLote += 1;
      paraOPrincipal.push(parcela);
      continue;
    }
    const novo = loteNovoDoAntigo(parcela.quadra, antigo);
    if (novo === null) {
      foraDoMapa.set(antigo, (foraDoMapa.get(antigo) ?? 0) + 1);
      paraOPrincipal.push(parcela);
      continue;
    }
    if (!doCpfPorRotulo.has(novo)) {
      foraDoCpf.set(novo, (foraDoCpf.get(novo) ?? 0) + 1);
      paraOPrincipal.push(parcela);
      continue;
    }

    // Os outros lotes que a parcela cita. O texto só vale quando cita o próprio lote da parcela:
    // texto que fala de outro lote e não deste é texto velho, e não uma sequência conjunta.
    const citados = [...new Set([...daColuna.slice(1), ...(doTexto.includes(antigo) ? doTexto : [])])]
      .filter((numero) => numero !== antigo)
      .map((numero) => ({ antigo: numero, novo: loteNovoDoAntigo(null, numero) }))
      // Outro número antigo do MESMO lote novo não é outro lote.
      .filter((citado) => citado.novo !== novo);

    const todosDoCpf = citados.every((citado) => citado.novo !== null && doCpfPorRotulo.has(citado.novo));
    if (citados.length > 0 && todosDoCpf) {
      const destinos = [novo, ...new Set(citados.map((citado) => citado.novo as string))];
      const partes = repartirParcela(parcela, destinos.length);
      destinos.forEach((rotulo, i) => {
        juntar(rotulo, partes[i]!);
        repartidasPorLote.set(rotulo, (repartidasPorLote.get(rotulo) ?? 0) + 1);
        for (const outro of destinos) if (outro !== rotulo) anotar(repartidoCom, rotulo, outro);
      });
      continue;
    }

    juntar(novo, parcela);
    for (const citado of citados) {
      if (citado.novo === null) anotar(citaSemConversao, novo, citado.antigo);
      else if (doCpfPorRotulo.has(citado.novo)) anotar(cobreDoCpf, novo, citado.novo);
      else anotar(citaDeOutroCpf, novo, citado.novo);
    }
  }

  // ⚠️ O PRINCIPAL SE ESCOLHE ANTES DE RECEBER O QUE NÃO TEM LOTE, e pelo DINHEIRO: um lote só de
  // parcela zerada não vira linha (a porta de `montarCarteiraDoLsoft`), e as notas e o "mesmo CPF"
  // sumiriam com ele.
  const principal =
    doCpf.find((lote) => temDinheiro(porLote.get(lote.rotulo))) ??
    doCpf.find((lote) => porLote.has(lote.rotulo)) ??
    doCpf[0]!;
  for (const parcela of paraOPrincipal) juntar(principal.rotulo, parcela);

  const cobertosPeloLoteador = new Set([...cobreDoCpf.values()].flatMap((lotes) => [...lotes]));
  // O outro lote do CPF citado ao loteador leva a marca de conferência, como no "mesmo CPF".
  const citar = (rotulos: Iterable<string>): string[] =>
    [...rotulos].map((rotulo) => {
      const doBoleto = doCpfPorRotulo.get(rotulo);
      return doBoleto ? citacaoDoLote(doBoleto) : rotulo;
    });

  const linhas: LoteDaCarteira[] = [];
  // O principal primeiro, depois os outros na ordem do boleto: a ordem da tela é outra (a da
  // rota), mas quem ler a lista crua vê a linha que carrega os avisos do cliente em cima.
  for (const lote of [principal, ...doCpf.filter((l) => l !== principal)]) {
    const parcelas = porLote.get(lote.rotulo);
    if (!parcelas) continue;
    const avisos: string[] = [];
    const notas: string[] = [];

    if (lote.incerta) avisos.push("Lote em conferência: a troca do lote antigo pelo novo ainda tem dúvida.");

    const repartidos = citar(repartidoCom.get(lote.rotulo) ?? []);
    if (repartidos.length > 0) {
      // A ficha que o clique abre mostra a parcela INTEIRA; a linha mostra a parte do lote. Sem este
      // aviso, o loteador veria a metade do valor e acharia que faltou dinheiro. Curto: a célula da
      // tela tem 220 px.
      const n = repartidasPorLote.get(lote.rotulo) ?? 0;
      const quais = n === parcelas.length ? "Parcelas divididas" : `${parcelasPorExtenso(n)} ${n === 1 ? "dividida" : "divididas"}`;
      const como = repartidos.length === 1 ? "meio a meio" : "em partes iguais";
      const juntos = repartidos.length === 1 ? "os dois lotes estão" : `os ${repartidos.length + 1} lotes estão`;
      avisos.push(`${quais} ${como} com ${oLote(repartidos)}: na ficha, ${juntos} numa parcela só.`);
    }

    const cobre = citar(cobreDoCpf.get(lote.rotulo) ?? []);
    if (cobre.length > 0) avisos.push(`As parcelas deste lote cobrem também ${oLote(cobre)}.`);

    const semConversao = [...(citaSemConversao.get(lote.rotulo) ?? [])];
    if (semConversao.length > 0) {
      notas.push(
        `As parcelas deste lote citam também ${semConversao.length === 1 ? "o lote antigo" : "os lotes antigos"} ${emLista(semConversao)}, que o mapa não converte.`,
      );
    }
    const deOutroCpf = [...(citaDeOutroCpf.get(lote.rotulo) ?? [])];
    if (deOutroCpf.length > 0) {
      notas.push(`As parcelas deste lote citam também ${oLote(deOutroCpf)}, que o boleto não liga a este CPF.`);
    }

    if (lote === principal) {
      if (semLote > 0) notas.push(`${parcelasPorExtenso(semLote)} sem lote no LSoft.`);
      for (const [antigo, n] of foraDoMapa) {
        notas.push(`${parcelasPorExtenso(n)} no lote antigo ${antigo}, sem conversão para o lote novo.`);
      }
      for (const [novo, n] of foraDoCpf) {
        notas.push(`${parcelasPorExtenso(n)} no LSoft com o lote ${novo}, que o boleto não liga a este CPF.`);
      }

      const semLinha = doCpf.filter(
        (l) => l !== principal && !temDinheiro(porLote.get(l.rotulo)) && !cobertosPeloLoteador.has(l.rotulo),
      );
      if (semLinha.length > 0) {
        avisos.push(
          `O mesmo CPF também tem ${semLinha.length === 1 ? "o lote" : "os lotes"} ${semLinha.map(citacaoDoLote).join(", ")}.`,
        );
      }
    }

    linhas.push({
      avisos,
      lote: { incerta: lote.incerta, lote: lote.lote, quadra: lote.quadra },
      notas,
      parcelas,
    });
  }
  return linhas;
}

/** Dias corridos de `de` até `ate`, as duas em `AAAA-MM-DD`. O `datediff` do MySQL. */
export function diasEntre(de: string, ate: string): number {
  const inicio = Date.parse(`${de.slice(0, 10)}T00:00:00Z`);
  const fim = Date.parse(`${ate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 0;
  return Math.round((fim - inicio) / 86_400_000);
}

/**
 * A carteira por unidade e o resumo, no formato da rota. PURA: quem lê o banco é
 * `lerCarteiraDoLsoftNoFinanceiro`, e o teste controla tudo daqui.
 *
 * @param caixa   Ids das parcelas CONFIRMADAS como subsídio da Caixa: saem da carteira (régua 0107).
 * @param hoje    `AAAA-MM-DD` no fuso da casa (`hojeNaCasa`).
 */
export function montarCarteiraDoLsoft(entrada: {
  caixa?: ReadonlySet<string>;
  clientes: readonly ClienteDaCarteiraNoFinanceiro[];
  hoje: string;
  lotes: readonly LoteDoBoleto[];
  nomeDoEmpreendimento: string;
  parcelas: readonly ParcelaDaCarteiraNoFinanceiro[];
  prefixoDoCodigo: string;
}): CarteiraDoLsoftNoPortal {
  const hoje = entrada.hoje.slice(0, 10);
  const mesCorrente = hoje.slice(0, 7);
  const caixa = entrada.caixa ?? new Set<string>();

  const parcelasPorCliente = new Map<string, ParcelaDaCarteiraNoFinanceiro[]>();
  for (const parcela of entrada.parcelas) {
    if (caixa.has(parcela.id)) continue;
    const lista = parcelasPorCliente.get(parcela.clienteCodigo) ?? [];
    lista.push(parcela);
    parcelasPorCliente.set(parcela.clienteCodigo, lista);
  }

  const units: UnidadeDoLsoftNoPortal[] = [];
  let clientes = 0;
  let criticos = 0;
  let inadimplentes = 0;
  let parcelasVencidas = 0;
  let previsto = 0;
  let pago = 0;
  let aReceber = 0;
  let recuperacao = 0;
  let total = 0;
  let vencido = 0;

  // O mesmo código repetido na entrada não pode contar o dinheiro duas vezes.
  const vistos = new Set<string>();

  for (const cliente of entrada.clientes) {
    if (vistos.has(cliente.codigo)) continue;
    vistos.add(cliente.codigo);

    const linhasDoCliente = dividirPorLote({
      cpf: cliente.cpf,
      lotes: entrada.lotes,
      nomeDoEmpreendimento: entrada.nomeDoEmpreendimento,
      parcelas: parcelasPorCliente.get(cliente.codigo) ?? [],
    });
    let clienteNaTela = false;
    let clienteComVencida = false;

    for (const linha of linhasDoCliente) {
      let uPago = 0;
      let uAReceber = 0;
      let uVencido = 0;
      let uVencidas = 0;
      let uPrevisto = 0;
      let uRecuperacao = 0;
      let maisAntiga: null | string = null;

      for (const parcela of linha.parcelas) {
        const valor = emCentavos(parcela.valor);
        const vencimento = parcela.vencimento?.slice(0, 10) ?? null;

        if (vencimento !== null && vencimento <= hoje) uPrevisto += valor;

        if (parcela.paga) {
          // ⚠️ O RECEBIDO, E NÃO O NOMINAL: é o "Recebido" da tela LSoft Integração e da ficha (ver
          // a régua no cabeçalho). O previsto, acima, continua nominal.
          const recebido = emCentavos(parcela.valorRecebido);
          uPago += recebido;
          if (parcela.dataRecebido?.slice(0, 7) === mesCorrente) uRecuperacao += recebido;
        } else if (vencimento !== null && vencimento < hoje) {
          uVencido += valor;
          // ⚠️ A parcela repartida entre dois lotes conta como vencida em CADA um: são dois contratos
          // e dois boletos no hub, e cada lote tem a sua parcela em atraso (o C2X conta por contrato).
          uVencidas += 1;
          if (maisAntiga === null || vencimento < maisAntiga) maisAntiga = vencimento;
        } else {
          // Sem vencimento conta como a receber: não dá para chamar de vencido o que não tem data.
          uAReceber += valor;
        }
      }

      // A "Carteira total" da tela LSoft: o recebido mais o saldo aberto (a receber + vencido).
      const uTotal = uPago + uAReceber + uVencido;
      // A mesma porta do C2X (`having total_contract > 0 or overdue_amount > 0`): cliente marcado sem
      // parcela nenhuma no empreendimento (ou lote só com parcela zerada) não vira linha vazia.
      if (uTotal <= 0 && uVencido <= 0) continue;

      const lote = linha.lote;
      const code = lote ? codigoDaUnidade(entrada.prefixoDoCodigo, lote.quadra, lote.lote) : "Lote a confirmar";

      units.push({
        // ⚠️ SÓ OS AVISOS: as `notas` da linha são do time adm e não vão ao portal (ver LoteDaCarteira).
        avisos: linha.avisos,
        block: lote?.quadra ?? null,
        client: cliente.nome.trim() || null,
        code,
        contractCode: null,
        empreendimento: entrada.nomeDoEmpreendimento,
        faturadoAt: null,
        id: lote ? `lsoft:${cliente.codigo}:${code}` : `lsoft:${cliente.codigo}`,
        imobiliaria: null,
        liquido: null,
        lot: lote?.lote ?? null,
        // ⚠️ AS DUAS LINHAS DO MESMO CLIENTE ABREM A MESMA FICHA. A ficha do LSoft é por cliente e
        // mostra as parcelas dos dois lotes, cada uma com o seu lote; é lá que a baixa é dada.
        lsoftCodigo: cliente.codigo,
        maxOverdueDays: maisAntiga ? Math.max(diasEntre(maisAntiga, hoje), 0) : 0,
        origem: "lsoft",
        overdueAmount: emReais(uVencido),
        overdueInstallments: uVencidas,
        paidAmount: emReais(uPago),
        temContrato: false,
        toReceiveAmount: emReais(uAReceber),
        totalContract: emReais(uTotal),
      });

      clienteNaTela = true;
      if (uVencidas > 0) clienteComVencida = true;
      if (uVencidas > 3) criticos += 1;
      parcelasVencidas += uVencidas;
      previsto += uPrevisto;
      pago += uPago;
      aReceber += uAReceber;
      recuperacao += uRecuperacao;
      total += uTotal;
      vencido += uVencido;
    }

    if (clienteNaTela) clientes += 1;
    if (clienteComVencida) inadimplentes += 1;
  }

  // A mesma ordem de partida do C2X (`order by overdue_amount desc, eu.block, eu.lot`); a tela
  // reordena, mas o Excel e quem ler o payload cru veem o mesmo desenho das duas fontes.
  units.sort(
    (a, b) =>
      b.overdueAmount - a.overdueAmount ||
      String(a.block ?? "").localeCompare(String(b.block ?? "")) ||
      String(a.lot ?? "").localeCompare(String(b.lot ?? "")),
  );

  return {
    summary: {
      // Clientes distintos; contratos são as linhas (um cliente de dois lotes: 1 e 2).
      clients: clientes,
      contracts: units.length,
      criticalContracts: criticos,
      delinquencyRate: previsto > 0 ? vencido / previsto : 0,
      expectedToDate: emReais(previsto),
      overdueAmount: emReais(vencido),
      overdueClients: inadimplentes,
      overdueInstallments: parcelasVencidas,
      paidAmount: emReais(pago),
      recoveryAmount: emReais(recuperacao),
      toReceiveAmount: emReais(aReceber),
      totalPortfolio: emReais(total),
    },
    units,
  };
}

/** O resumo de uma carteira vazia: o que o LSoft devolve antes da migration 0199. */
export function resumoVazio(): ApoloCarteiraSummary {
  return {
    clients: 0,
    contracts: 0,
    criticalContracts: 0,
    delinquencyRate: 0,
    expectedToDate: 0,
    overdueAmount: 0,
    overdueClients: 0,
    overdueInstallments: 0,
    paidAmount: 0,
    recoveryAmount: 0,
    toReceiveAmount: 0,
    totalPortfolio: 0,
  };
}

/**
 * O resumo do C2X somado ao do LSoft, para os cartões da tela.
 *
 * ⚠️ OS VALORES ABSOLUTOS SOMAM; A INADIMPLÊNCIA É RECALCULADA DEPOIS DA SOMA. Média de percentuais
 * daria o mesmo peso a um empreendimento de R$ 50 mil e a um de R$ 35 milhões: a taxa certa do
 * conjunto é o vencido de todos sobre o previsto de todos, a mesma régua a valor presente de cada
 * lado (Lucas, 20/08/2026).
 *
 * ⚠️ CLIENTES E CONTRATOS SOMAM SEM DEDUPLICAR, e é certo: o C2X conta `users` do legado e o LSoft
 * conta clientes do espelho, populações que não se cruzam (o Garden tem zero no C2X, e o
 * empreendimento do LSoft não é mais pedido ao C2X; ver `recorteDoLsoft`).
 */
export function somarResumos(
  c2x: ApoloCarteiraSummary,
  lsoft: ApoloCarteiraSummary,
): ApoloCarteiraSummary {
  const dinheiro = (campo: keyof ApoloCarteiraSummary) =>
    emReais(emCentavos(Number(c2x[campo])) + emCentavos(Number(lsoft[campo])));

  const overdueAmount = dinheiro("overdueAmount");
  const expectedToDate = dinheiro("expectedToDate");

  return {
    clients: c2x.clients + lsoft.clients,
    contracts: c2x.contracts + lsoft.contracts,
    criticalContracts: c2x.criticalContracts + lsoft.criticalContracts,
    delinquencyRate: expectedToDate > 0 ? overdueAmount / expectedToDate : 0,
    expectedToDate,
    overdueAmount,
    overdueClients: c2x.overdueClients + lsoft.overdueClients,
    overdueInstallments: c2x.overdueInstallments + lsoft.overdueInstallments,
    paidAmount: dinheiro("paidAmount"),
    recoveryAmount: dinheiro("recoveryAmount"),
    toReceiveAmount: dinheiro("toReceiveAmount"),
    totalPortfolio: dinheiro("totalPortfolio"),
  };
}

/** A carteira que a rota monta: resumo e unidades, de uma fonte ou das duas. */
export type CarteiraDaRota<U> = { summary: ApoloCarteiraSummary; units: U[] };

/**
 * A carteira do C2X com a do LSoft somada: o resumo por `somarResumos` e as unidades de uma depois
 * das outras. Sem LSoft (`null`), devolve a do C2X intacta: o portal que não vê o LSoft e o recorte
 * sem o empreendimento dele recebem exatamente o que recebiam.
 */
export function juntarNaCarteira<U>(
  c2x: CarteiraDaRota<U>,
  lsoft: CarteiraDaRota<U> | null,
): CarteiraDaRota<U> {
  if (!lsoft) return c2x;
  return {
    summary: somarResumos(c2x.summary, lsoft.summary),
    units: [...c2x.units, ...lsoft.units],
  };
}

// ── A LEITURA (servidor) ────────────────────────────────────────────────────

type LinhaDoBanco = Record<string, unknown>;
type ErroDoBanco = { code?: null | string; message: string };
type RespostaDoBanco = { count: null | number; data: null | unknown[]; error: ErroDoBanco | null };
type ClienteDoBanco = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** O PostgREST devolve no máximo 1.000 linhas por consulta, e corta SEM erro. */
const PAGINA = 1000;
/** `.in()` com lista grande estoura a URL (700 ids = 400 medido nesta casa); 100 é o lote da casa. */
const LOTE_DE_CLIENTES = 100;

/**
 * Lê TODAS as linhas, página a página, e prova que leu todas: ordem fixa, nenhuma chave repetida e
 * a quantidade igual à contagem exata da primeira página. É a régua de `lerPaginado`
 * (planilha-da-carteira.ts), que não é exportada; sem ordem fixa o PostgREST repete uma linha e
 * pula outra entre páginas, e o total ainda bate (medido em 24/09/2026 em `lsoft_parcelas`).
 *
 * Devolve o erro do banco em vez de lançar: quem chama precisa distinguir "a coluna ainda não
 * existe" (lista vazia) de qualquer outra falha.
 */
async function lerTudo(
  consulta: (contar: boolean) => { range: (de: number, ate: number) => PromiseLike<RespostaDoBanco> },
  chave: string,
  rotulo: string,
): Promise<{ erro: ErroDoBanco } | { linhas: LinhaDoBanco[] }> {
  const vistas = new Set<string>();
  const linhas: LinhaDoBanco[] = [];
  let esperado: null | number = null;

  for (let de = 0; ; de += PAGINA) {
    const { count, data, error } = await consulta(de === 0).range(de, de + PAGINA - 1);
    if (error) return { erro: error };
    if (de === 0) esperado = count;

    const bloco = (data ?? []) as LinhaDoBanco[];
    for (const linha of bloco) {
      const id = String(linha[chave] ?? "");
      if (vistas.has(id)) {
        return { erro: { message: `Leitura de ${rotulo} instável: ${id} veio duas vezes.` } };
      }
      vistas.add(id);
      linhas.push(linha);
    }
    if (bloco.length < PAGINA) break;
  }

  if (esperado === null) {
    return { erro: { message: `Leitura de ${rotulo} sem contagem: não dá para provar que veio inteira.` } };
  }
  if (linhas.length !== esperado) {
    return { erro: { message: `Leitura de ${rotulo} incompleta: vieram ${linhas.length} de ${esperado}.` } };
  }
  return { linhas };
}

/** Lotes lidos ao mesmo tempo: os 106 do Garden são 2 lotes, e a rota tem 30 s para responder. */
const LOTES_SIMULTANEOS = 4;

/**
 * Lê em lotes de 100 códigos, até `LOTES_SIMULTANEOS` de cada vez, e devolve as linhas na ordem dos
 * lotes. A primeira falha vale para todos: carteira pela metade não sai.
 */
async function emLotes(
  codigos: readonly string[],
  ler: (lote: string[]) => Promise<{ erro: ErroDoBanco } | { linhas: LinhaDoBanco[] }>,
): Promise<{ erro: ErroDoBanco } | { linhas: LinhaDoBanco[] }> {
  const lotes: string[][] = [];
  for (let i = 0; i < codigos.length; i += LOTE_DE_CLIENTES) lotes.push(codigos.slice(i, i + LOTE_DE_CLIENTES));

  const resultados: Array<{ erro: ErroDoBanco } | { linhas: LinhaDoBanco[] }> = new Array(lotes.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < lotes.length) {
      const indice = proximo;
      proximo += 1;
      resultados[indice] = await ler(lotes[indice] ?? []);
    }
  };
  await Promise.all(Array.from({ length: Math.min(LOTES_SIMULTANEOS, lotes.length) }, trabalhador));

  const linhas: LinhaDoBanco[] = [];
  for (const resultado of resultados) {
    if ("erro" in resultado) return resultado;
    linhas.push(...resultado.linhas);
  }
  return { linhas };
}

const texto = (valor: unknown): null | string => {
  const t = String(valor ?? "").trim();
  return t === "" ? null : t;
};

const numero = (valor: unknown): number => {
  const n = Number(valor ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export type LeituraDoLsoftNoFinanceiro =
  | {
      data: CarteiraDoLsoftNoPortal & {
        /** `true` = a migration 0199 ainda não rodou; a carteira sai vazia, como a tela era antes. */
        colunaAusente: boolean;
      };
      ok: true;
    }
  | { erro: string; ok: false };

/**
 * A carteira de UM empreendimento do LSoft que está no Financeiro, pronta para somar à do C2X.
 *
 * ⚠️ TUDO OU NADA. Qualquer leitura que falhe (parcelas, subsídio, boletos) devolve `ok: false`, e a
 * rota mostra a carteira do C2X sem o empreendimento, com um aviso. A exceção é a coluna ainda não
 * existir (migration 0199 não aplicada): aí ninguém está no Financeiro, e a resposta certa é vazio.
 *
 * @param hoje `AAAA-MM-DD` no fuso da casa (`hojeNaCasa`).
 * @param nome O nome de mercado que o seletor do portal usa para este empreendimento.
 */
export async function lerCarteiraDoLsoftNoFinanceiro(entrada: {
  empreendimento: EmpreendimentoDoLsoftNoFinanceiro;
  hoje: string;
  nome: string;
}): Promise<LeituraDoLsoftNoFinanceiro> {
  const admin: ClienteDoBanco | null = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  const { empreendimento, hoje, nome } = entrada;
  const vazia = (colunaAusente: boolean): LeituraDoLsoftNoFinanceiro => ({
    data: { colunaAusente, summary: resumoVazio(), units: [] },
    ok: true,
  });

  const clientes = await lerTudo(
    (contar) =>
      admin
        .from("lsoft_clientes")
        .select("codigo, nome, cpf", contar ? { count: "exact" } : undefined)
        .contains(COLUNA_NA_CARTEIRA, [empreendimento.chaveLsoft])
        .order("codigo"),
    "codigo",
    "clientes na carteira",
  );
  if ("erro" in clientes) {
    // ⚠️ SÓ "A COLUNA AINDA NÃO EXISTE" VIRA VAZIO (a régua é a do lado LSoft, `na-carteira.ts`).
    // Qualquer outra falha é falha: tratá-la como vazio esconderia a carteira sem aviso.
    if (colunaNaCarteiraAusente(clientes.erro)) return vazia(true);
    return { erro: clientes.erro.message, ok: false };
  }

  const listaDeClientes: ClienteDaCarteiraNoFinanceiro[] = clientes.linhas.map((linha) => ({
    codigo: String(linha.codigo ?? ""),
    cpf: texto(linha.cpf),
    nome: String(linha.nome ?? ""),
  }));
  if (listaDeClientes.length === 0) return vazia(false);

  const codigos = listaDeClientes.map((cliente) => cliente.codigo);

  const [parcelas, marcas, documentos, incertas] = await Promise.all([
    emLotes(codigos, (lote) =>
      lerTudo(
        (contar) =>
          admin
            .from("lsoft_parcelas")
            .select(
              // `lote` e `observacoes` repartem as parcelas em linhas, uma por lote (`dividirPorLote`).
              "id, cliente_codigo, valor, valor_recebido, paga, vencimento, data_recebido, quadra, lote, observacoes",
              contar ? { count: "exact" } : undefined,
            )
            .eq("empreendimento", empreendimento.chaveLsoft)
            .eq("categoria_lsoft", empreendimento.categoriaLsoft)
            .in("cliente_codigo", lote)
            .order("id"),
        "id",
        "parcelas",
      ),
    ),
    // A régua da 0107: só a marca CONFIRMADA de classe `caixa` tira a parcela da carteira.
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
        "id",
        "subsídio da Caixa",
      ),
    ),
    // O empreendimento inteiro (144 linhas no Garden em 29/09/2026): mandar 106 CPFs na URL para
    // economizar 38 linhas não compensa, e CPF na URL fica em log de proxy.
    lerTudo(
      (contar) =>
        admin
          .from("boletos_documentos")
          .select("id, documento, unidade", contar ? { count: "exact" } : undefined)
          .eq("workspace_id", "careli")
          .eq("empreendimento", empreendimento.slugDoBoleto)
          .order("id"),
      "id",
      "lotes do boleto",
    ),
    lerTudo(
      (contar) =>
        admin
          .from("boletos_parcelas")
          .select("id, unidade", contar ? { count: "exact" } : undefined)
          .eq("workspace_id", "careli")
          .eq("empreendimento", empreendimento.slugDoBoleto)
          .eq("unidade_incerta", true)
          .order("id"),
      "id",
      "lotes incertos",
    ),
  ]);

  if ("erro" in parcelas) return { erro: parcelas.erro.message, ok: false };
  if ("erro" in marcas) return { erro: marcas.erro.message, ok: false };
  if ("erro" in documentos) return { erro: documentos.erro.message, ok: false };
  if ("erro" in incertas) return { erro: incertas.erro.message, ok: false };
  const linhasDasParcelas = parcelas.linhas;
  const linhasDasMarcas = marcas.linhas;
  const linhasDosDocumentos = documentos.linhas;
  const linhasIncertas = incertas.linhas;

  // Cada parcela é de um cliente só; id repetido entre lotes = o banco mudou no meio da leitura.
  const idsDasParcelas = new Set<string>();
  for (const linha of linhasDasParcelas) {
    const id = String(linha.id ?? "");
    if (idsDasParcelas.has(id)) {
      return { erro: `Leitura de parcelas instável: a parcela ${id} veio em dois lotes.`, ok: false };
    }
    idsDasParcelas.add(id);
  }

  const incertos = new Set(
    linhasIncertas.map((linha) => {
      const partes = quadraELoteDoBoleto(String(linha.unidade ?? ""));
      return partes ? rotuloDoLote(partes.quadra, partes.lote) : "";
    }),
  );

  return {
    data: {
      colunaAusente: false,
      ...montarCarteiraDoLsoft({
        caixa: new Set(linhasDasMarcas.map((linha) => String(linha.parcela_id ?? ""))),
        clientes: listaDeClientes,
        hoje,
        lotes: linhasDosDocumentos.map((linha) => {
          const unidade = String(linha.unidade ?? "");
          const partes = quadraELoteDoBoleto(unidade);
          return {
            documento: soDigitos(linha.documento),
            incerta: partes ? incertos.has(rotuloDoLote(partes.quadra, partes.lote)) : false,
            unidade,
          };
        }),
        nomeDoEmpreendimento: nome,
        parcelas: linhasDasParcelas.map((linha) => ({
          clienteCodigo: String(linha.cliente_codigo ?? ""),
          dataRecebido: texto(linha.data_recebido),
          id: String(linha.id ?? ""),
          lote: texto(linha.lote),
          observacoes: texto(linha.observacoes),
          paga: Boolean(linha.paga),
          quadra: texto(linha.quadra),
          valor: numero(linha.valor),
          valorRecebido: numero(linha.valor_recebido),
          vencimento: texto(linha.vencimento),
        })),
        prefixoDoCodigo: empreendimento.prefixoDoCodigo,
      }),
    },
    ok: true,
  };
}

/** O que a rota recebe do LSoft para o recorte pedido: a carteira somável e o que a tela avisa. */
export type LsoftDoRecorte = {
  /** Texto para a tela quando algum empreendimento do LSoft não pôde ser lido. Nulo = tudo lido. */
  aviso: null | string;
  carteira: CarteiraDoLsoftNoPortal;
  /** Os nomes de mercado dos empreendimentos do LSoft que o recorte inclui ("Garden"). */
  empreendimentos: string[];
};

/**
 * Lê a carteira de cada empreendimento do LSoft que o recorte inclui e soma numa só.
 *
 * ⚠️ A FALHA DO LSOFT NÃO DERRUBA O FINANCEIRO. O empreendimento que não pôde ser lido fica FORA da
 * carteira (nunca zerado dentro dela, que o loteador leria como "ninguém me pagou") e a tela recebe
 * o aviso. O detalhe técnico fica no log do servidor: o portal é de cliente externo, e a mensagem
 * do banco pode citar tabela e coluna.
 *
 * @param nomePorCode O mapa sigla → nome de mercado da rota (o nome do PAI, como o resto da tela).
 */
export async function carteiraDoLsoftNoRecorte(entrada: {
  hoje: string;
  noRecorte: readonly EmpreendimentoNoRecorte[];
  nomePorCode: ReadonlyMap<string, string>;
}): Promise<LsoftDoRecorte> {
  const nomes = entrada.noRecorte.map(
    (item) =>
      item.codes.map((code) => entrada.nomePorCode.get(code.toUpperCase())).find(Boolean) ??
      item.empreendimento.nomePadrao,
  );

  const leituras = await Promise.all(
    entrada.noRecorte.map((item, indice) =>
      lerCarteiraDoLsoftNoFinanceiro({
        empreendimento: item.empreendimento,
        hoje: entrada.hoje,
        nome: nomes[indice] ?? item.empreendimento.nomePadrao,
      }).catch(
        (falha: unknown): LeituraDoLsoftNoFinanceiro => ({
          erro: falha instanceof Error ? falha.message : String(falha),
          ok: false,
        }),
      ),
    ),
  );

  let carteira: CarteiraDoLsoftNoPortal = { summary: resumoVazio(), units: [] };
  const falharam: string[] = [];

  leituras.forEach((leitura, indice) => {
    const nome = nomes[indice] ?? "";
    if (!leitura.ok) {
      console.error(`[incorporador/carteira] falha ao ler a carteira do LSoft (${nome}):`, leitura.erro);
      falharam.push(nome);
      return;
    }
    carteira = juntarNaCarteira(carteira, leitura.data);
  });

  return {
    aviso:
      falharam.length > 0
        ? `Não foi possível ler a carteira ${falharam.length === 1 ? "do" : "de"} ${falharam.join(", ")} agora. Ela ficou fora desta tela; tente de novo em alguns minutos.`
        : null,
    carteira,
    empreendimentos: nomes,
  };
}
