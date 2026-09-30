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
//   • contracts / clients: no LSoft o contrato é o cliente naquele empreendimento (uma linha por
//       cliente), então os dois contam o mesmo. criticalContracts: mais de 3 vencidas, como o C2X.
//   • overdueClients: clientes com pelo menos uma vencida.
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

import { createApoloAdminClient } from "@/lib/apolo/server";
import type { ApoloCarteiraSummary } from "@/lib/apolo/carteira";
import { type CatalogoParaId, idsDoC2xDasSiglas } from "@/lib/apolo/c2x-pelo-id";
import { GARDEN } from "@/lib/lsoft/categorias";
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
  /** O que a linha precisa dizer além dos números: outro lote no mesmo CPF, lote a confirmar. */
  avisos: string[];
  block: null | string;
  client: null | string;
  code: string;
  contractCode: null;
  empreendimento: null | string;
  faturadoAt: null;
  /** `lsoft:<código>`: nunca colide com o id numérico do C2X nem com o uuid do Panteon. */
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
  paga: boolean;
  /** A quadra que o LSoft gravou (numeração antiga): só desempata qual lote do boleto é o principal. */
  quadra: null | string;
  valor: number;
  valorRecebido: number;
  vencimento: null | string;
};

/** Um lote novo do boleto: o CPF (só dígitos), o rótulo ("Q06 L14") e se a conversão é incerta. */
export type LoteDoBoleto = { documento: string; incerta: boolean; unidade: string };

const soDigitos = (valor: unknown): string => String(valor ?? "").replace(/\D/g, "");

/** "Q06 L14", "Q6-L14", "q06 l14" → quadra "06" e lote "14". Qualquer outra coisa: nulo. */
export function quadraELoteDoBoleto(unidade: string): null | { lote: string; quadra: string } {
  const casa = String(unidade ?? "").trim().match(/^Q\s*0*(\d{1,3})\s*[-\s/]?\s*L\s*0*(\d{1,4})$/i);
  if (!casa) return null;
  return { lote: String(casa[2]).padStart(2, "0"), quadra: String(casa[1]).padStart(2, "0") };
}

/** "GDN" + quadra(2) + lote(2): o código que o C2X e o masterplan dão ao lote ("GDN0614"). */
export function codigoDaUnidade(prefixo: string, quadra: string, lote: string): string {
  return `${prefixo}${quadra}${lote}`;
}

/** O rótulo curto do lote, como a planilha de boletos e a ficha do LSoft escrevem: "Q06 L14". */
const rotuloDoLote = (quadra: string, lote: string): string => `Q${quadra} L${lote}`;

/**
 * Qual lote do boleto é o da carteira deste cliente, e quais outros o mesmo CPF tem.
 *
 * ⚠️ CLIENTE COM MAIS DE UM LOTE MOSTRA UM E CITA OS OUTROS. A carteira do LSoft é por cliente, não
 * por lote: as parcelas dos dois lotes vêm juntas no mesmo código, e partir o dinheiro entre eles
 * seria inventar uma divisão que o espelho não tem. A ordem de quem vira o principal:
 *   1. o lote de conversão CERTA antes do incerto (`boletos_parcelas.unidade_incerta`, 0118: os
 *      lotes em que as duas fontes da renumeração discordam);
 *   2. o lote cuja quadra aparece nas parcelas do LSoft (a quadra mudou pouco na renumeração: casa
 *      em 100 dos 106 que sobem);
 *   3. quadra e lote crescentes, para a escolha não depender da ordem de leitura.
 * Medido em 29/09/2026: um dos 106 tem no boleto um segundo lote, INCERTO e de outra quadra, que a
 * validação da planilha não reconhece como dele. Sem os passos 1 e 2 ele viraria o principal.
 */
export function loteDoCliente(entrada: {
  cpf: null | string;
  lotes: readonly LoteDoBoleto[];
  quadrasNoLsoft: ReadonlySet<number>;
}): { outros: string[]; principal: null | { incerta: boolean; lote: string; quadra: string } } {
  const cpf = soDigitos(entrada.cpf);
  if (!cpf) return { outros: [], principal: null };

  const candidatos = entrada.lotes
    .filter((lote) => soDigitos(lote.documento) === cpf)
    .map((lote) => ({ ...lote, partes: quadraELoteDoBoleto(lote.unidade) }))
    .filter(
      (lote): lote is LoteDoBoleto & { partes: { lote: string; quadra: string } } =>
        lote.partes !== null,
    );

  // O mesmo lote duas vezes (a leitura não repete, mas a régua não depende disso).
  const unicos = [...new Map(candidatos.map((c) => [rotuloDoLote(c.partes.quadra, c.partes.lote), c])).values()];

  unicos.sort((a, b) => {
    if (a.incerta !== b.incerta) return a.incerta ? 1 : -1;
    const aCasa = entrada.quadrasNoLsoft.has(Number(a.partes.quadra));
    const bCasa = entrada.quadrasNoLsoft.has(Number(b.partes.quadra));
    if (aCasa !== bCasa) return aCasa ? -1 : 1;
    return (
      Number(a.partes.quadra) - Number(b.partes.quadra) ||
      Number(a.partes.lote) - Number(b.partes.lote)
    );
  });

  const [primeiro, ...resto] = unicos;
  if (!primeiro) return { outros: [], principal: null };

  return {
    // ⚠️ O OUTRO LOTE INCERTO VAI MARCADO. Medido em 29/09/2026 contra a planilha validada: 105 dos
    // 106 saem idênticos; no que sobra, o principal é o validado e o boleto ainda liga o mesmo CPF
    // a um lote incerto que a validação não reconhece. Citar esse lote sem a marca afirmaria ao
    // loteador uma posse que ninguém confirmou.
    outros: resto.map(
      (c) => `${rotuloDoLote(c.partes.quadra, c.partes.lote)}${c.incerta ? " (em conferência)" : ""}`,
    ),
    principal: { incerta: primeiro.incerta, lote: primeiro.partes.lote, quadra: primeiro.partes.quadra },
  };
}

/** Dias corridos de `de` até `ate`, as duas em `AAAA-MM-DD`. O `datediff` do MySQL. */
export function diasEntre(de: string, ate: string): number {
  const inicio = Date.parse(`${de.slice(0, 10)}T00:00:00Z`);
  const fim = Date.parse(`${ate.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(inicio) || !Number.isFinite(fim)) return 0;
  return Math.round((fim - inicio) / 86_400_000);
}

/** Reais para centavos inteiros: a soma de milhares de parcelas em ponto flutuante deixa resíduo. */
const emCentavos = (valor: number): number => Math.round((Number.isFinite(valor) ? valor : 0) * 100);
const emReais = (centavos: number): number => centavos / 100;

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
  let criticos = 0;
  let inadimplentes = 0;
  let parcelasVencidas = 0;
  let previsto = 0;
  let pago = 0;
  let aReceber = 0;
  let recuperacao = 0;
  let total = 0;
  let vencido = 0;

  // Um cliente, uma linha: o mesmo código repetido na entrada não pode contar o dinheiro duas vezes.
  const vistos = new Set<string>();

  for (const cliente of entrada.clientes) {
    if (vistos.has(cliente.codigo)) continue;
    vistos.add(cliente.codigo);

    const parcelas = parcelasPorCliente.get(cliente.codigo) ?? [];
    let uPago = 0;
    let uAReceber = 0;
    let uVencido = 0;
    let uVencidas = 0;
    let uPrevisto = 0;
    let uRecuperacao = 0;
    let maisAntiga: null | string = null;
    const quadras = new Set<number>();

    for (const parcela of parcelas) {
      const valor = emCentavos(parcela.valor);
      const vencimento = parcela.vencimento?.slice(0, 10) ?? null;
      const quadra = Number(soDigitos(parcela.quadra));
      if (quadra > 0) quadras.add(quadra);

      if (vencimento !== null && vencimento <= hoje) uPrevisto += valor;

      if (parcela.paga) {
        // ⚠️ O RECEBIDO, E NÃO O NOMINAL: é o "Recebido" da tela LSoft Integração e da ficha (ver
        // a régua no cabeçalho). O previsto, acima, continua nominal.
        const recebido = emCentavos(parcela.valorRecebido);
        uPago += recebido;
        if (parcela.dataRecebido?.slice(0, 7) === mesCorrente) uRecuperacao += recebido;
      } else if (vencimento !== null && vencimento < hoje) {
        uVencido += valor;
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
    // parcela nenhuma no empreendimento não vira linha vazia na tabela.
    if (uTotal <= 0 && uVencido <= 0) continue;

    const { outros, principal } = loteDoCliente({
      cpf: cliente.cpf,
      lotes: entrada.lotes,
      quadrasNoLsoft: quadras,
    });

    // ⚠️ O TEXTO VAI PARA A TELA DO LOTEADOR: sem CPF, sem código interno, e dizendo o que falta.
    const avisos: string[] = [];
    if (!principal) {
      avisos.push(`Lote a confirmar: não há boleto do ${entrada.nomeDoEmpreendimento} neste CPF.`);
    } else if (principal.incerta) {
      avisos.push("Lote em conferência: a troca do lote antigo pelo novo ainda tem dúvida.");
    }
    if (outros.length > 0) {
      avisos.push(`O mesmo CPF também tem ${outros.length === 1 ? "o lote" : "os lotes"} ${outros.join(", ")}.`);
    }

    units.push({
      avisos,
      block: principal?.quadra ?? null,
      client: cliente.nome.trim() || null,
      code: principal
        ? codigoDaUnidade(entrada.prefixoDoCodigo, principal.quadra, principal.lote)
        : "Lote a confirmar",
      contractCode: null,
      empreendimento: entrada.nomeDoEmpreendimento,
      faturadoAt: null,
      id: `lsoft:${cliente.codigo}`,
      imobiliaria: null,
      liquido: null,
      lot: principal?.lote ?? null,
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

    if (uVencidas > 0) inadimplentes += 1;
    if (uVencidas > 3) criticos += 1;
    parcelasVencidas += uVencidas;
    previsto += uPrevisto;
    pago += uPago;
    aReceber += uAReceber;
    recuperacao += uRecuperacao;
    total += uTotal;
    vencido += uVencido;
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
      clients: units.length,
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
              "id, cliente_codigo, valor, valor_recebido, paga, vencimento, data_recebido, quadra",
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
