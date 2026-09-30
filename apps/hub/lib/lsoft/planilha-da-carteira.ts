import ExcelJS from "exceljs";

import { formatarDocumento } from "@/lib/apolo/documento";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { FUSO_DA_CASA, hojeNaCasa } from "@/lib/guardian/hoje-na-casa";
import {
  type ClienteDaCarteira,
  EMPREENDIMENTOS_DO_LSOFT,
  lerCarteiraDoLsoft,
  type StatusDaValidacao,
} from "@/lib/lsoft/carteira";
import { CATEGORIA_PATRIMONIO } from "@/lib/lsoft/categorias";
import { clientesDaTela, type FiltroDaExportacao } from "@/lib/lsoft/filtro-da-tela";
import { parcelasQueFicam } from "@/lib/lsoft/na-carteira";

// A CARTEIRA DO LSOFT EM XLSX: o botão "Excel" da tela LSoft Integração.
//
// Pedido do Lucas (29/09/2026), olhando a tela no portal da Cecílio Rocha: *"coloca exportação
// para xlsx por favor nessa tela"*.
//
// ⚠️ O ARQUIVO É MONTADO NO SERVIDOR, e não com o que a tela já tem. A lista da tela traz UMA linha
// por cliente com os totais; as parcelas só chegam quando alguém abre a ficha de um cliente. Quem
// exporta quer as duas coisas (o resumo e as parcelas), e o navegador não tem a segunda. Por isso a
// rota refaz a leitura da lista com o MESMO filtro da tela (busca e empreendimento no servidor, os
// dois checkboxes por `clientesDaTela`, a mesma função que a tela usa) e lê as parcelas desses
// clientes.
//
// ⚠️ TRÊS ABAS. "Clientes" é a tabela da tela, com os números da MESMA view que alimenta a tela
// (não recalculados aqui: uma segunda conta seria uma segunda verdade). "Parcelas" é o detalhe,
// linha a linha. "Sobre" diz de onde o arquivo veio: a planilha viaja por e-mail sem a tela junto,
// e quem abre precisa saber o filtro, a data da carga e as regras de soma.
//
// ⚠️ DATA VAI COMO TEXTO `dd/mm/aaaa`. Escrever `Date` reabre a armadilha do fuso do ExcelJS (o
// serial nasce em UTC e, aberto no Brasil, mostra o dia anterior). Dinheiro vai como NÚMERO com
// formato de moeda: quem exporta soma e filtra na planilha. CPF vai como TEXTO formatado: só
// dígitos o Excel leria como número e comeria o zero à esquerda. O molde é o extrato do portal
// (lib/apolo/incorporador/planilha-do-extrato.ts).
//
// ⚠️ O QUE JÁ ESTÁ NO FINANCEIRO NÃO ENTRA (Lucas, 29/09/2026: o Garden validado *"é só copiar e
// colar na carteira"* do Financeiro). A aba Clientes já vem sem essa parte (`lerCarteiraDoLsoft`
// desconta); a aba Parcelas tira as parcelas que o Financeiro lê (o par cliente e empreendimento,
// na categoria do Financeiro), pela mesma régua (`parcelasQueFicam`, lib/lsoft/na-carteira.ts). Sem
// isso, o cliente que também tem Giant Towers sairia só com o Giant Towers na aba Clientes e com as
// parcelas do Garden na aba Parcelas.
//
// ⚠️ LEITURA INCOMPLETA NÃO VIRA ARQUIVO. Toda leitura aqui é paginada, conferida contra a contagem
// do banco e LANÇA erro no primeiro tropeço. Planilha com parcela faltando e cara de completa é
// pior do que nenhuma planilha: quem abre soma e acredita.
//
// ⚠️ CABE NA VERCEL, com folga. A resposta de função é cortada acima de 4,5 MB. Medido em
// 29/09/2026 contra o banco real, "Todos os empreendimentos" sem filtro (o maior recorte possível):
// 475 clientes, 32.660 parcelas, 1,54 MB, ~8 s de leitura e ~2 s de montagem, da máquina do Lucas.
// Na mesma medição, as contagens e o A receber que saem das parcelas fecharam com a view em 475 de
// 475 clientes (e em 120 de 120 no Vale do Sol, com a regra da Caixa), então a régua da aba
// Parcelas é a mesma dos números da aba Clientes.

// ── A LEITURA ───────────────────────────────────────────────────────────────

/** A curadoria do subsídio da Caixa (MCMV) numa parcela. Ver migration 0103. */
export type SituacaoDoSubsidio = "a_validar" | "confirmada" | "rejeitada";

/** Uma parcela como o arquivo precisa dela. */
export type ParcelaDoArquivo = {
  categoriaLsoft: null | number;
  clienteCodigo: string;
  dataRecebido: null | string;
  empreendimento: string;
  id: string;
  lote: null | string;
  observacoes: null | string;
  paga: boolean;
  parcela: null | string;
  parcelaNumero: null | number;
  parcelaTotal: null | number;
  quadra: null | string;
  /** Nulo = parcela comum, que nunca foi candidata a subsídio da Caixa. */
  subsidio: null | SituacaoDoSubsidio;
  valor: null | number;
  valorRecebido: null | number;
  vencimento: null | string;
};

type LinhaDoBanco = Record<string, unknown>;

type RespostaDoBanco = {
  count: null | number;
  data: null | unknown[];
  error: null | { message: string };
};

/** O mínimo do cliente do Supabase que a leitura usa. O real é `createApoloAdminClient()`. */
type ClienteDoBanco = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** O PostgREST devolve no máximo 1.000 linhas por consulta, e corta SEM erro. */
const PAGINA = 1000;

/**
 * Códigos de cliente por consulta.
 *
 * ⚠️ `.in()` COM LISTA GRANDE ESTOURA A URL: medido nesta casa, 700 ids = 400 Bad Request. 100 é o
 * lote que `classificacao.ts` já usa.
 */
const LOTE_DE_CLIENTES = 100;

/** Lotes lidos ao mesmo tempo. Quatro fecham 475 clientes em duas rodadas sem encher o banco. */
const LOTES_SIMULTANEOS = 4;

/**
 * O teto de linhas de uma leitura sem paginação no PostgREST. `lerCarteiraDoLsoft` lê a view dos
 * clientes numa consulta só; se a lista chegar a este número, ela pode ter sido cortada calada.
 */
export const TETO_DA_LISTA = 1000;

const COLUNAS_DA_PARCELA =
  "id, cliente_codigo, empreendimento, categoria_lsoft, parcela, parcela_numero, parcela_total, vencimento, valor, paga, valor_recebido, data_recebido, observacoes, quadra, lote";

/**
 * Lê TODAS as linhas de uma consulta, página a página, e prova que leu todas.
 *
 * ⚠️ `.order("id")` É OBRIGATÓRIO NA CONSULTA QUE CHEGA AQUI. Sem ordem fixa o PostgREST pode
 * repetir uma linha numa página e pular outra na seguinte, e o total ainda bate (medido em
 * 24/09/2026 nesta mesma tabela). Por isso a conferência é dupla: nenhum id repetido E a quantidade
 * lida igual à contagem que o banco deu na primeira página. Qualquer uma das duas falhando derruba
 * a leitura inteira, em vez de entregar um pedaço.
 */
async function lerPaginado(
  consulta: (contar: boolean) => { range: (de: number, ate: number) => PromiseLike<RespostaDoBanco> },
  rotulo: string,
): Promise<LinhaDoBanco[]> {
  const vistas = new Set<string>();
  const linhas: LinhaDoBanco[] = [];
  let esperado: null | number = null;

  for (let de = 0; ; de += PAGINA) {
    const { count, data, error } = await consulta(de === 0).range(de, de + PAGINA - 1);
    if (error) throw new Error(`Leitura de ${rotulo} falhou: ${error.message}`);
    if (de === 0) esperado = count;

    const bloco = (data ?? []) as LinhaDoBanco[];
    for (const linha of bloco) {
      const id = String(linha.id ?? "");
      if (vistas.has(id)) throw new Error(`Leitura de ${rotulo} instável: a linha ${id} veio duas vezes.`);
      vistas.add(id);
      linhas.push(linha);
    }
    if (bloco.length < PAGINA) break;
  }

  if (esperado === null) throw new Error(`Leitura de ${rotulo} sem contagem: não dá para provar que veio inteira.`);
  if (linhas.length !== esperado) {
    throw new Error(`Leitura de ${rotulo} incompleta: vieram ${linhas.length} de ${esperado}.`);
  }
  return linhas;
}

/** Roda `fazer` em lotes de `tamanho`, `simultaneos` de cada vez, e devolve tudo NA ORDEM dos lotes. */
async function emLotes<T, R>(
  itens: readonly T[],
  tamanho: number,
  simultaneos: number,
  fazer: (lote: T[]) => Promise<R[]>,
): Promise<R[]> {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) lotes.push(itens.slice(i, i + tamanho));

  const resultados: R[][] = new Array(lotes.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < lotes.length) {
      const indice = proximo;
      proximo += 1;
      resultados[indice] = await fazer(lotes[indice] as T[]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(simultaneos, lotes.length) }, trabalhador));
  return resultados.flat();
}

const texto = (valor: unknown): null | string => {
  const t = String(valor ?? "").trim();
  return t === "" ? null : t;
};

const numeroOuNulo = (valor: unknown): null | number => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
};

/**
 * Quando a mesma parcela tem mais de uma marca, vale a que MOVE dinheiro na view: a confirmada é a
 * única que tira a parcela da carteira do cliente (0107: `situacao = 'confirmada' and classe =
 * 'caixa'`). O índice único da 0103 é pela digital, não por `parcela_id`, então a duplicata é
 * possível depois de um religamento; a regra só evita que a ordem de leitura decida.
 */
const PESO_DA_MARCA: Record<SituacaoDoSubsidio, number> = { a_validar: 2, confirmada: 3, rejeitada: 1 };

/**
 * As parcelas dos clientes do recorte, com a marca do subsídio da Caixa em cada uma.
 *
 * ⚠️ COM EMPREENDIMENTO ESCOLHIDO, SÓ AS PARCELAS DELE. A tela, nesse caso, lê a view por
 * empreendimento, e o cliente que tem imóvel em dois lugares aparece só com o dinheiro daquele. Ler
 * todas as parcelas dele faria o arquivo somar o que a tela não mostra.
 *
 * ⚠️ A MARCA É LIDA PELO CLIENTE E CASADA PELA PARCELA, como a ficha faz (`lerFichaDoLsoft`). A
 * view casa por `parcela_id`; ler pelo cliente é só o jeito de não mandar 33 mil ids na URL.
 */
export async function lerParcelasDoRecorte(
  admin: ClienteDoBanco,
  recorte: { codigos: readonly string[]; empreendimento: null | string },
): Promise<ParcelaDoArquivo[]> {
  if (recorte.codigos.length === 0) return [];

  const [linhas, marcas] = await Promise.all([
    emLotes(recorte.codigos, LOTE_DE_CLIENTES, LOTES_SIMULTANEOS, (lote) =>
      lerPaginado((contar) => {
        let q = admin
          .from("lsoft_parcelas")
          .select(COLUNAS_DA_PARCELA, contar ? { count: "exact" } : undefined)
          .in("cliente_codigo", lote);
        if (recorte.empreendimento) q = q.eq("empreendimento", recorte.empreendimento);
        return q.order("id");
      }, "parcelas"),
    ),
    emLotes(recorte.codigos, LOTE_DE_CLIENTES, LOTES_SIMULTANEOS, (lote) =>
      lerPaginado(
        (contar) =>
          admin
            .from("lsoft_classificacao_de_parcela")
            .select("id, parcela_id, classe, situacao", contar ? { count: "exact" } : undefined)
            .in("cliente_codigo", lote)
            .order("id"),
        "subsídio da Caixa",
      ),
    ),
  ]);

  // Só a classe `caixa` é subsídio. A `carteira` existe no CHECK (0103), mas quer dizer "dívida do
  // cliente", que é o mesmo que não ter marca nenhuma.
  const subsidioPorParcela = new Map<string, SituacaoDoSubsidio>();
  for (const marca of marcas) {
    const parcelaId = texto(marca.parcela_id);
    const situacao = texto(marca.situacao) as null | SituacaoDoSubsidio;
    if (!parcelaId || texto(marca.classe) !== "caixa" || !situacao || !(situacao in PESO_DA_MARCA)) continue;
    const atual = subsidioPorParcela.get(parcelaId);
    if (!atual || PESO_DA_MARCA[situacao] > PESO_DA_MARCA[atual]) subsidioPorParcela.set(parcelaId, situacao);
  }

  // Cada parcela é de um cliente só, então lotes diferentes não repetem id. Se repetirem, algo mudou
  // no banco durante a leitura (uma carga rodando), e o arquivo não é confiável.
  const ids = new Set<string>();
  return linhas.map((p) => {
    const id = String(p.id ?? "");
    if (ids.has(id)) throw new Error(`Leitura de parcelas instável: a parcela ${id} veio em dois lotes.`);
    ids.add(id);
    return {
      categoriaLsoft: numeroOuNulo(p.categoria_lsoft),
      clienteCodigo: String(p.cliente_codigo ?? ""),
      dataRecebido: texto(p.data_recebido),
      empreendimento: String(p.empreendimento ?? ""),
      id,
      lote: texto(p.lote),
      observacoes: texto(p.observacoes),
      paga: Boolean(p.paga),
      parcela: texto(p.parcela),
      parcelaNumero: numeroOuNulo(p.parcela_numero),
      parcelaTotal: numeroOuNulo(p.parcela_total),
      quadra: texto(p.quadra),
      subsidio: subsidioPorParcela.get(id) ?? null,
      valor: numeroOuNulo(p.valor),
      valorRecebido: numeroOuNulo(p.valor_recebido),
      vencimento: texto(p.vencimento),
    };
  });
}

/**
 * O patrimônio em aberto do recorte INTEIRO (categoria 17, não paga, no empreendimento escolhido),
 * de todos os clientes, e não só dos que a tela filtrou. É a prova da lista ANTES dos checkboxes.
 *
 * ⚠️ POR QUE ANTES DO FILTRO. "Só patrimônio" filtra pelo MESMO número que pode ter vindo zerado
 * calado (ver `divergenciaDoPatrimonio`). Conferido só depois do filtro, o cliente com o patrimônio
 * zerado já tinha saído da lista, e a conferência comparava vazio com vazio: sai um arquivo "ok"
 * com 0 cliente(s), ou sem os clientes da página que falhou, e cara de completo. Achado da revisão
 * de 29/09/2026, reproduzido com a leitura do patrimônio falhando e o checkbox marcado.
 *
 * ⚠️ É A MESMA CONSULTA DE `lerCarteiraDoLsoft` (sem `.in()`, então sem risco de URL grande: a 17
 * em aberto cabe em poucas páginas), mas pelo `lerPaginado`: ordenada, contada, e LANÇA no tropeço.
 */
export async function lerPatrimonioDoRecorte(
  admin: ClienteDoBanco,
  empreendimento: null | string,
): Promise<Array<Pick<ParcelaDoArquivo, "categoriaLsoft" | "clienteCodigo" | "paga" | "valor">>> {
  const linhas = await lerPaginado((contar) => {
    let q = admin
      .from("lsoft_parcelas")
      .select("id, cliente_codigo, valor", contar ? { count: "exact" } : undefined)
      .eq("categoria_lsoft", CATEGORIA_PATRIMONIO)
      .eq("paga", false);
    if (empreendimento) q = q.eq("empreendimento", empreendimento);
    return q.order("id");
  }, "patrimônio");

  return linhas.map((p) => ({
    categoriaLsoft: CATEGORIA_PATRIMONIO,
    clienteCodigo: String(p.cliente_codigo ?? ""),
    paga: false,
    valor: numeroOuNulo(p.valor),
  }));
}

/**
 * Confere o patrimônio da lista contra o das parcelas, cliente a cliente.
 *
 * ⚠️ POR QUE CONFERIR. `lerCarteiraDoLsoft` soma o patrimônio numa leitura à parte e, se ela falha,
 * segue com o patrimônio ZERADO e só loga (decisão de 24/09/2026: perder a tela inteira por causa
 * da tag seria pior). Na tela isso é tolerável; no arquivo seria uma coluna "Patrimônio a receber"
 * errada sem aviso. As parcelas lidas aqui são a prova: a regra é a mesma (categoria 17, não paga,
 * no mesmo recorte), então os números têm de fechar. Não fechou = alguma das duas leituras veio
 * torta, e o arquivo não sai.
 *
 * Só olha os clientes de `clientes`: parcela de quem não está na lista é ignorada, então a prova
 * pode vir do recorte inteiro (`lerPatrimonioDoRecorte`) contra uma lista com busca.
 */
export function divergenciaDoPatrimonio(
  clientes: readonly Pick<ClienteDaCarteira, "codigo" | "patrimonioAReceber" | "patrimonioParcelasAbertas">[],
  parcelas: readonly Pick<ParcelaDoArquivo, "categoriaLsoft" | "clienteCodigo" | "paga" | "valor">[],
): null | string {
  const porCliente = new Map<string, { parcelas: number; valor: number }>();
  for (const parcela of parcelas) {
    if (parcela.paga || parcela.categoriaLsoft !== CATEGORIA_PATRIMONIO) continue;
    const atual = porCliente.get(parcela.clienteCodigo) ?? { parcelas: 0, valor: 0 };
    atual.parcelas += 1;
    atual.valor += parcela.valor ?? 0;
    porCliente.set(parcela.clienteCodigo, atual);
  }

  const divergentes = clientes.filter((cliente) => {
    const lido = porCliente.get(cliente.codigo) ?? { parcelas: 0, valor: 0 };
    return (
      lido.parcelas !== cliente.patrimonioParcelasAbertas ||
      Math.abs(lido.valor - cliente.patrimonioAReceber) > 0.005
    );
  });

  return divergentes.length > 0
    ? `O patrimônio de ${divergentes.length} cliente(s) não fechou entre a lista e as parcelas. Tente de novo em instantes.`
    : null;
}

// ── AS LINHAS DO ARQUIVO (puras) ────────────────────────────────────────────

/** `2026-09-23` -> `23/09/2026`. Sem `Date` no meio: é recorte de string, e não tem fuso. */
function dia(iso: null | string): string {
  const d = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

const COMO_INSTANTE = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  month: "2-digit",
  timeZone: FUSO_DA_CASA,
  year: "numeric",
});

/**
 * Um INSTANTE (a carga, a geração do arquivo) em `dd/mm/aaaa hh:mm`, no fuso de São Paulo.
 * Montado peça a peça porque o `format` do pt-BR muda a vírgula entre versões do ICU.
 */
export function instanteNaCasa(valor: Date | null | string): string {
  const data = valor instanceof Date ? valor : new Date(String(valor ?? ""));
  if (!valor || Number.isNaN(data.getTime())) return "";
  const partes = Object.fromEntries(COMO_INSTANTE.formatToParts(data).map((p) => [p.type, p.value]));
  return `${partes.day}/${partes.month}/${partes.year} ${partes.hour}:${partes.minute}`;
}

/**
 * Texto limpo para a célula. Caractere de controle (quebra de linha, tabulação, e os invisíveis
 * que o Access às vezes guarda) vira espaço: alguns deles nem são XML válido, e um só estraga o
 * arquivo inteiro. Filtrado por CÓDIGO, e não por regex com escape, para o fonte não ganhar byte
 * invisível.
 */
function limpo(valor: null | string | undefined): string {
  return [...String(valor ?? "")]
    .map((caractere) => ((caractere.codePointAt(0) ?? 0) < 0x20 ? " " : caractere))
    .join("")
    .replace(/ {2,}/g, " ")
    .trim();
}

const ROTULO_DA_VALIDACAO: Record<StatusDaValidacao, string> = {
  dispensado: "Dispensado",
  em_analise: "Em análise",
  pendente: "Pendente",
  validado: "Validado",
};

const ROTULO_DO_SUBSIDIO: Record<SituacaoDoSubsidio, string> = {
  a_validar: "A validar",
  confirmada: "Confirmada",
  rejeitada: "Rejeitada",
};

export type SituacaoDaParcela = "A vencer" | "Paga" | "Vencida";

/**
 * A situação da parcela, com a MESMA régua das views que dão os números da tela.
 *
 * ⚠️ A RÉGUA É `not paga and vencimento < current_date` (0097, `lsoft_carteira_por_cliente`, e 0107,
 * `lsoft_carteira_por_cliente_empreendimento`): ESTRITAMENTE menor. A parcela que vence hoje ainda
 * está a vencer; vencimento em branco nunca vence (no Postgres, `null < data` não é verdadeiro).
 *
 * ⚠️ `hoje` É O DIA DE SÃO PAULO, e chega de fora (`hojeNaCasa`) para o teste controlar o relógio.
 * O dia de UTC viraria amanhã às 21h e, das 21h à meia-noite, a parcela de hoje sairia "Vencida".
 *
 * ⚠️ E A VIEW PODE ESTAR NO OUTRO FUSO. O `current_date` dela é o da sessão do Postgres, que
 * nenhuma migration fixa (o padrão do Supabase é UTC). Se for UTC, das 21h à meia-noite a aba
 * Clientes (números da view) conta como vencida a parcela que vence hoje, e a aba Parcelas não.
 * Fora dessa janela as duas fecham (medido em 29/09/2026, às 14h: 475 de 475 clientes). Alinhar
 * de vez é trocar `current_date` nas views 0097 e 0107, que é migration: decisão do Lucas.
 */
export function situacaoDaParcela(
  parcela: Pick<ParcelaDoArquivo, "paga" | "vencimento">,
  hoje: string,
): SituacaoDaParcela {
  if (parcela.paga) return "Paga";
  const vencimento = String(parcela.vencimento ?? "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(vencimento) && vencimento < hoje) return "Vencida";
  return "A vencer";
}

/** O CPF como a tela mostra: o formatado do LSoft, e só na falta dele o formatado aqui. */
function documentoDoCliente(cliente: Pick<ClienteDaCarteira, "cpf" | "cpfFormatado">): string {
  return limpo(cliente.cpfFormatado ?? (cliente.cpf ? formatarDocumento(cliente.cpf) : ""));
}

export type LinhaDoCliente = {
  abertas: number;
  aReceber: number;
  cadastroC2x: string;
  cliente: string;
  codigo: string;
  documento: string;
  empreendimentos: string;
  pagas: number;
  parcelas: number;
  patrimonio: string;
  patrimonioAReceber: number;
  proximoVencimento: string;
  recebido: number;
  unidades: string;
  validacao: string;
  vencidas: number;
  vencido: number;
};

/**
 * Uma linha da aba Clientes: a linha da tela, com as unidades todas (a tela mostra só duas).
 *
 * ⚠️ COM EMPREENDIMENTO ESCOLHIDO, "Cadastro p/ C2X" SAI EM BRANCO. A view por empreendimento (0104,
 * refeita na 0107) não tem `campos_c2x_preenchidos` nem `campos_c2x_total` (só a 0097 tem), e
 * `lerCarteiraDoLsoft` completa o que falta com 0 e 9: o mesmo cliente sairia "9/9 Validado" em
 * Todos e "0/9 Validado" no Vale do Sol, numa planilha que vai para a incorporadora. Branco com a
 * explicação na aba Sobre é honesto; o conserto de raiz (as duas colunas na view, que também
 * corrige o Progresso da tela) é migration, decisão do Lucas. Achado da revisão de 29/09/2026.
 */
export function linhaDoCliente(cliente: ClienteDaCarteira, porEmpreendimento = false): LinhaDoCliente {
  return {
    abertas: cliente.parcelasAbertas,
    aReceber: cliente.saldoAberto,
    cadastroC2x: porEmpreendimento ? "" : `${cliente.camposC2xPreenchidos}/${cliente.camposC2xTotal}`,
    cliente: limpo(cliente.nome),
    codigo: limpo(cliente.codigo),
    documento: documentoDoCliente(cliente),
    empreendimentos: cliente.empreendimentos.map(limpo).join(", "),
    pagas: cliente.parcelasPagas,
    parcelas: cliente.parcelas,
    patrimonio: cliente.patrimonioParcelasAbertas > 0 ? "Sim" : "Não",
    patrimonioAReceber: cliente.patrimonioAReceber,
    proximoVencimento: dia(cliente.proximoVencimento),
    recebido: cliente.totalRecebido,
    unidades: cliente.unidades.map(limpo).join(", "),
    validacao: ROTULO_DA_VALIDACAO[cliente.statusValidacao] ?? limpo(cliente.statusValidacao),
    vencidas: cliente.parcelasVencidas,
    vencido: cliente.saldoVencido,
  };
}

export type LinhaDaParcela = {
  cliente: string;
  codigo: string;
  documento: string;
  empreendimento: string;
  lote: string;
  observacoes: string;
  parcela: string;
  patrimonio: string;
  quadra: string;
  recebidoEm: string;
  situacao: SituacaoDaParcela;
  subsidio: string;
  valor: null | number;
  valorRecebido: null | number;
  vencimento: string;
};

/** Uma linha da aba Parcelas. `cliente` é o da lista (nome e CPF saem de lá, como na tela). */
export function linhaDaParcela(
  parcela: ParcelaDoArquivo,
  cliente: Pick<ClienteDaCarteira, "cpf" | "cpfFormatado" | "nome"> | undefined,
  hoje: string,
): LinhaDaParcela {
  const numeracao =
    parcela.parcela ??
    (parcela.parcelaNumero !== null && parcela.parcelaTotal !== null
      ? `${parcela.parcelaNumero}/${parcela.parcelaTotal}`
      : null);

  return {
    cliente: limpo(cliente?.nome),
    codigo: limpo(parcela.clienteCodigo),
    documento: cliente ? documentoDoCliente(cliente) : "",
    empreendimento: limpo(parcela.empreendimento),
    lote: limpo(parcela.lote),
    observacoes: limpo(parcela.observacoes),
    parcela: limpo(numeracao),
    patrimonio: parcela.categoriaLsoft === CATEGORIA_PATRIMONIO ? "Sim" : "Não",
    quadra: limpo(parcela.quadra),
    recebidoEm: dia(parcela.dataRecebido),
    situacao: situacaoDaParcela(parcela, hoje),
    subsidio: parcela.subsidio ? ROTULO_DO_SUBSIDIO[parcela.subsidio] : "",
    valor: parcela.valor,
    // ⚠️ PARCELA EM ABERTO COM RECEBIDO ZERO VIRA CÉLULA VAZIA: o banco guarda 0 onde a verdade é
    // "nada recebido ainda", e 30 mil zeros na coluna escondem os recebimentos de verdade. Em
    // aberto com valor recebido (baixa parcial) aparece, porque ali o número diz alguma coisa.
    valorRecebido: !parcela.paga && (parcela.valorRecebido ?? 0) === 0 ? null : parcela.valorRecebido,
    vencimento: dia(parcela.vencimento),
  };
}

/**
 * A ordem da aba Parcelas: a dos clientes na aba Clientes (a da tela), e dentro de cada um do
 * vencimento mais antigo ao mais novo. Sem vencimento vai para o fim; o id desempata para duas
 * gerações do mesmo arquivo saírem iguais.
 */
export function ordenarParcelas(
  parcelas: readonly ParcelaDoArquivo[],
  ordemDosClientes: readonly string[],
): ParcelaDoArquivo[] {
  const posicao = new Map(ordemDosClientes.map((codigo, indice) => [codigo, indice]));
  const fim = Number.MAX_SAFE_INTEGER;
  return [...parcelas].sort(
    (a, b) =>
      (posicao.get(a.clienteCodigo) ?? fim) - (posicao.get(b.clienteCodigo) ?? fim) ||
      (a.vencimento ?? "9999-99-99").localeCompare(b.vencimento ?? "9999-99-99") ||
      (a.parcelaNumero ?? fim) - (b.parcelaNumero ?? fim) ||
      a.id.localeCompare(b.id),
  );
}

// ── O ARQUIVO ───────────────────────────────────────────────────────────────

type Coluna<L> = { chave: keyof L & string; largura: number; moeda?: boolean; titulo: string };

export const COLUNAS_DOS_CLIENTES: readonly Coluna<LinhaDoCliente>[] = [
  { chave: "codigo", largura: 12, titulo: "Código" },
  { chave: "cliente", largura: 38, titulo: "Cliente" },
  { chave: "documento", largura: 20, titulo: "CPF/CNPJ" },
  { chave: "empreendimentos", largura: 24, titulo: "Empreendimentos" },
  { chave: "unidades", largura: 24, titulo: "Unidades" },
  { chave: "patrimonio", largura: 12, titulo: "Patrimônio" },
  { chave: "cadastroC2x", largura: 15, titulo: "Cadastro p/ C2X" },
  { chave: "validacao", largura: 13, titulo: "Validação" },
  { chave: "parcelas", largura: 10, titulo: "Parcelas" },
  { chave: "pagas", largura: 9, titulo: "Pagas" },
  { chave: "abertas", largura: 11, titulo: "Em aberto" },
  { chave: "vencidas", largura: 10, titulo: "Vencidas" },
  { chave: "proximoVencimento", largura: 14, titulo: "Próximo vencimento" },
  { chave: "recebido", largura: 16, moeda: true, titulo: "Recebido" },
  { chave: "aReceber", largura: 16, moeda: true, titulo: "A receber" },
  { chave: "vencido", largura: 16, moeda: true, titulo: "Vencido" },
  { chave: "patrimonioAReceber", largura: 16, moeda: true, titulo: "Patrimônio a receber" },
];

export const COLUNAS_DAS_PARCELAS: readonly Coluna<LinhaDaParcela>[] = [
  { chave: "codigo", largura: 12, titulo: "Código" },
  { chave: "cliente", largura: 34, titulo: "Cliente" },
  { chave: "documento", largura: 20, titulo: "CPF/CNPJ" },
  { chave: "empreendimento", largura: 18, titulo: "Empreendimento" },
  { chave: "patrimonio", largura: 11, titulo: "Patrimônio" },
  { chave: "quadra", largura: 8, titulo: "Quadra" },
  { chave: "lote", largura: 8, titulo: "Lote" },
  { chave: "parcela", largura: 10, titulo: "Parcela" },
  { chave: "vencimento", largura: 12, titulo: "Vencimento" },
  { chave: "valor", largura: 15, moeda: true, titulo: "Valor" },
  { chave: "situacao", largura: 10, titulo: "Situação" },
  { chave: "recebidoEm", largura: 12, titulo: "Recebido em" },
  { chave: "valorRecebido", largura: 15, moeda: true, titulo: "Valor recebido" },
  { chave: "subsidio", largura: 14, titulo: "Subsídio Caixa" },
  { chave: "observacoes", largura: 50, titulo: "Observações do LSoft" },
];

/**
 * Uma aba de tabela, no padrão das exportações da casa: cabeçalho em negrito congelado com filtro,
 * uma linha por item, TOTAL em negrito no fim, moeda como número formatado.
 */
function escreverTabela<L extends Record<string, unknown>>(
  livro: ExcelJS.Workbook,
  nome: string,
  colunas: readonly Coluna<L>[],
  linhas: readonly L[],
  total: Partial<Record<keyof L & string, number | string>>,
): void {
  const aba = livro.addWorksheet(nome);
  aba.columns = colunas.map((c) => ({ key: c.chave, width: c.largura }));

  const cabecalho = aba.addRow(colunas.map((c) => c.titulo));
  cabecalho.font = { bold: true };
  // Sem isto, quem rola até a linha 8.000 não sabe mais qual coluna é o vencimento e qual é o
  // recebido. O filtro é o que a pessoa faria na mão logo depois de abrir.
  aba.views = [{ state: "frozen", ySplit: 1 }];
  aba.autoFilter = { from: { column: 1, row: 1 }, to: { column: colunas.length, row: 1 } };

  // ⚠️ VAZIO É `null`, E NÃO "": a célula fica vazia de verdade (o filtro do Excel mostra "(Vazias)")
  // e um valor que não existe nunca vira zero numa soma.
  const celula = (valor: unknown) => (valor === "" || valor === undefined ? null : valor);
  aba.addRows(linhas.map((linha) => colunas.map((c) => celula(linha[c.chave]))));

  const rodape = aba.addRow(colunas.map((c) => celula(total[c.chave])));
  rodape.font = { bold: true };

  for (const [indice, coluna] of colunas.entries()) {
    const daPlanilha = aba.getColumn(indice + 1);
    if (coluna.moeda) {
      // Número com formato de moeda: a planilha soma e filtra. Texto "R$ 1.520,92" não faria nem
      // um nem outro.
      daPlanilha.numFmt = "R$ #,##0.00";
      daPlanilha.alignment = { horizontal: "right" };
    }
    if (coluna.chave === "documento") daPlanilha.alignment = { horizontal: "left" };
  }
}

const somar = <L>(linhas: readonly L[], pega: (linha: L) => null | number) =>
  linhas.reduce((soma, linha) => soma + (pega(linha) ?? 0), 0);

export type EntradaDaPlanilha = {
  /** Para "Gerado em" e para o "hoje" da situação das parcelas. Injetado para o teste. */
  agora: Date;
  /** Os clientes EXATAMENTE como a tela mostra, na mesma ordem. */
  clientes: readonly ClienteDaCarteira[];
  /** O filtro da tela. `empreendimento` já validado: vazio = todos. */
  filtro: FiltroDaExportacao;
  /** As parcelas desses clientes, no recorte do empreendimento. */
  parcelas: readonly ParcelaDoArquivo[];
  /** Quando a carga do LSoft rodou (o carimbo do cabeçalho da tela). */
  sincronizadoEm: null | string;
};

/**
 * As regras de soma, escritas no arquivo. Dependem do recorte porque as views são duas.
 *
 * ⚠️ O RECEBIDO TAMBÉM TEM REGRA, e ela não é a da aba Parcelas. As duas views somam o recebido SÓ
 * da parcela paga (0097 e 0107: `filter (where ... paga)`), e a por empreendimento ainda tira a
 * Caixa confirmada (0107: `not p.eh_caixa and p.paga`). A aba Parcelas mostra o recebido de toda
 * parcela, inclusive a baixa parcial de parcela em aberto e a da Caixa (o próprio comentário da 0107
 * registra R$ 598 mil de recebido do LSoft em parcela da Caixa). Sem isto escrito, o total de
 * "Valor recebido" passa do "Recebido" da aba Clientes e ninguém sabe por quê. Achado da revisão de
 * 29/09/2026.
 */
function notasDoArquivo(porEmpreendimento: boolean, hoje: string): Array<[string, string]> {
  return [
    [
      "Vencida",
      `Parcela não paga com vencimento antes de ${dia(hoje)} (o dia de hoje em São Paulo). A que vence hoje ainda está a vencer.`,
    ],
    porEmpreendimento
      ? [
          "A receber",
          "O Recebido, o A receber, o Vencido e as contagens de parcelas do cliente NÃO contam a parcela confirmada como subsídio da Caixa: quem paga essa é a Caixa, por medição de obra. Na aba Parcelas ela aparece com Subsídio Caixa = Confirmada. A parcela ainda a validar continua contando.",
        ]
      : [
          "A receber",
          "Com todos os empreendimentos, o Recebido, o A receber, o Vencido e as contagens de parcelas somam TODAS as parcelas do cliente, inclusive as confirmadas como subsídio da Caixa. É o mesmo número que a tela mostra nessa visão. Para ver a carteira do cliente sem o subsídio, escolha o empreendimento antes de exportar.",
        ],
    [
      "Recebido",
      "O Recebido da aba Clientes soma só o que foi recebido em parcela já paga. Baixa parcial de parcela ainda em aberto não entra nele.",
    ],
    [
      "Patrimônio",
      "O patrimônio (categoria 17 do LSoft) já está dentro do A receber. A coluna Patrimônio a receber mostra essa parte; não é um valor a mais.",
    ],
    [
      "Financeiro",
      "A carteira que já passou para o Financeiro do portal (por cliente e empreendimento, como o Garden validado) não entra neste arquivo: nem nos números da aba Clientes, nem na aba Parcelas. Ela é acompanhada no Financeiro. O cliente que ainda tem outra carteira aqui aparece só com ela.",
    ],
    ...(porEmpreendimento
      ? ([
          [
            "Cadastro p/ C2X",
            "Com um empreendimento escolhido, esta coluna fica em branco: o andamento do cadastro só está disponível na visão de todos os empreendimentos. Para vê-lo, exporte com Todos os empreendimentos.",
          ],
        ] as Array<[string, string]>)
      : []),
    [
      "Aba Parcelas",
      porEmpreendimento
        ? "Todas as parcelas destes clientes neste recorte, pagas e em aberto, inclusive as marcadas como subsídio da Caixa. O total de Valor soma pagas e em aberto, e o de Valor recebido inclui a baixa parcial de parcela em aberto e o que foi recebido em parcela da Caixa. Por isso esses totais não batem com o Recebido e o A receber da aba Clientes, que deixam de fora a Caixa confirmada."
        : "Todas as parcelas destes clientes neste recorte, pagas e em aberto, inclusive as marcadas como subsídio da Caixa. O total de Valor soma pagas e em aberto, e o de Valor recebido inclui a baixa parcial de parcela em aberto. Por isso esses totais não batem com o Recebido e o A receber da aba Clientes.",
    ],
  ];
}

/**
 * Monta o arquivo, com as três abas.
 *
 * ⚠️ SEM CLIENTE NENHUM, O ARQUIVO SAI MESMO ASSIM, coerente: cabeçalhos, total "0 cliente(s)" e a
 * aba Sobre dizendo o filtro. A tela desabilita o botão quando a lista está vazia; se a lista
 * esvaziar entre a tela e o clique, um arquivo que diz "0" com o filtro escrito explica mais do que
 * um erro.
 */
export async function planilhaDaCarteiraLsoft(entrada: EntradaDaPlanilha): Promise<ArrayBuffer> {
  const hoje = hojeNaCasa(entrada.agora);
  const empreendimento = entrada.filtro.empreendimento.trim();

  const clientes = entrada.clientes.map((cliente) => linhaDoCliente(cliente, Boolean(empreendimento)));
  const clientePorCodigo = new Map(entrada.clientes.map((c) => [c.codigo, c]));
  const parcelas = ordenarParcelas(
    entrada.parcelas,
    entrada.clientes.map((c) => c.codigo),
  ).map((p) => linhaDaParcela(p, clientePorCodigo.get(p.clienteCodigo), hoje));

  const livro = new ExcelJS.Workbook();
  livro.created = entrada.agora;

  escreverTabela(livro, "Clientes", COLUNAS_DOS_CLIENTES, clientes, {
    abertas: somar(clientes, (l) => l.abertas),
    aReceber: somar(clientes, (l) => l.aReceber),
    codigo: `${clientes.length} cliente(s)`,
    pagas: somar(clientes, (l) => l.pagas),
    parcelas: somar(clientes, (l) => l.parcelas),
    patrimonioAReceber: somar(clientes, (l) => l.patrimonioAReceber),
    recebido: somar(clientes, (l) => l.recebido),
    vencidas: somar(clientes, (l) => l.vencidas),
    vencido: somar(clientes, (l) => l.vencido),
  });

  escreverTabela(livro, "Parcelas", COLUNAS_DAS_PARCELAS, parcelas, {
    codigo: `${parcelas.length} parcela(s)`,
    valor: somar(parcelas, (l) => l.valor),
    valorRecebido: somar(parcelas, (l) => l.valorRecebido),
  });

  const sobre = livro.addWorksheet("Sobre");
  sobre.columns = [
    { key: "item", width: 26 },
    { key: "valor", width: 100 },
  ];
  const linhasDoSobre: Array<[string, number | string]> = [
    ["Tela", "LSoft Integração"],
    ["Empreendimento", empreendimento || "Todos os empreendimentos"],
    ["Busca", entrada.filtro.busca.trim() || "Nenhuma"],
    ["Só o que falta validar", entrada.filtro.somentePendentes ? "Sim" : "Não"],
    ["Só patrimônio", entrada.filtro.somentePatrimonio ? "Sim" : "Não"],
    ["Dados do LSoft de", instanteNaCasa(entrada.sincronizadoEm) || "Sem carga registrada"],
    ["Gerado em", instanteNaCasa(entrada.agora)],
    ["Clientes", clientes.length],
    ["Parcelas", parcelas.length],
    ...notasDoArquivo(Boolean(empreendimento), hoje),
  ];
  for (const [item, valor] of linhasDoSobre) {
    const linha = sobre.addRow([item, valor]);
    linha.getCell(1).font = { bold: true };
    linha.getCell(2).alignment = { horizontal: "left", vertical: "top", wrapText: true };
    linha.getCell(1).alignment = { vertical: "top" };
  }

  return (await livro.xlsx.writeBuffer()) as ArrayBuffer;
}

/** O nome do arquivo: `lsoft-<empreendimento>-<aaaa-mm-dd>.xlsx`, ou `lsoft-todos-...`. */
export function nomeDoArquivo(empreendimento: null | string, hojeIso: string): string {
  // Sem acento e sem espaço: o nome viaja por e-mail e por Windows. O corte dos combinantes (a
  // faixa 0x300-0x36f que o NFD separa da letra) é por CÓDIGO, e não por intervalo de regex:
  // escrito como regex, ele vira byte invisível no fonte (mesma escolha do extrato do portal).
  const semAcento = [...limpo(empreendimento).normalize("NFD")]
    .filter((caractere) => {
      const codigo = caractere.codePointAt(0) ?? 0;
      return codigo < 0x300 || codigo > 0x36f;
    })
    .join("");
  const pedaco = semAcento
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  return `lsoft-${pedaco || "todos"}-${hojeIso.slice(0, 10)}.xlsx`;
}

// ── A EXPORTAÇÃO INTEIRA (o que as duas rotas chamam) ───────────────────────

/** O empreendimento que vale: fora da lista do espelho é ignorado, igual `lerCarteiraDoLsoft` faz. */
export function empreendimentoDoRecorte(valor: null | string | undefined): null | string {
  const nome = String(valor ?? "").trim();
  return nome && EMPREENDIMENTOS_DO_LSOFT.includes(nome as never) ? nome : null;
}

export type Exportacao =
  | { arquivo: ArrayBuffer; clientes: number; nome: string; ok: true; parcelas: number }
  | { erro: string; ok: false };

/**
 * Lê o recorte da tela e devolve o arquivo pronto.
 *
 * ⚠️ A MESMA PORTA DE ENTRADA FICA NA ROTA: quem chega aqui já passou pela autorização da tela em
 * cada lugar (`authorizeApoloRead` no /lsoft, `autorizar` + `portalVeBaseLsoft` no portal). Isto só
 * lê com a service role, como `lerCarteiraDoLsoft` já faz.
 */
export async function exportarCarteiraDoLsoft(
  filtro: FiltroDaExportacao,
  agora: Date = new Date(),
): Promise<Exportacao> {
  const empreendimento = empreendimentoDoRecorte(filtro.empreendimento);
  const busca = filtro.busca.trim();

  const carteira = await lerCarteiraDoLsoft({ busca, empreendimento });
  if (!carteira.ok) return { erro: carteira.erro, ok: false };

  if (carteira.clientes.length >= TETO_DA_LISTA) {
    return {
      erro: `A lista chegou a ${TETO_DA_LISTA} clientes, o teto de uma leitura, e pode estar incompleta. Filtre por empreendimento e exporte por partes.`,
      ok: false,
    };
  }

  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  // ⚠️ A PROVA DO PATRIMÔNIO VEM ANTES DOS CHECKBOXES, sobre a lista inteira: "Só patrimônio" filtra
  // pelo número que ela prova, e conferir depois do filtro deixaria passar calado justamente o
  // cliente que o zeramento tirou da lista. Ver `lerPatrimonioDoRecorte`.
  try {
    const patrimonio = await lerPatrimonioDoRecorte(admin, empreendimento);
    const divergenciaDaLista = divergenciaDoPatrimonio(carteira.clientes, patrimonio);
    if (divergenciaDaLista) return { erro: divergenciaDaLista, ok: false };
  } catch (falha) {
    return { erro: falha instanceof Error ? falha.message : "Leitura do patrimônio falhou.", ok: false };
  }

  const clientes = clientesDaTela(carteira.clientes, filtro);

  let parcelas: ParcelaDoArquivo[];
  try {
    parcelas = await lerParcelasDoRecorte(admin, {
      codigos: clientes.map((c) => c.codigo),
      empreendimento,
    });
  } catch (falha) {
    return { erro: falha instanceof Error ? falha.message : "Leitura das parcelas falhou.", ok: false };
  }

  // ⚠️ O QUE O FINANCEIRO LÊ SAI DA ABA PARCELAS, como já saiu dos números da aba Clientes. Com um
  // empreendimento escolhido, quem tem aquele empreendimento no Financeiro só está na lista se
  // sobrou parcela fora da categoria dele, e é ela que fica; em Todos, tira o Garden (124) de quem
  // ficou aqui por ter outra carteira.
  parcelas = parcelasQueFicam(
    parcelas,
    new Map(clientes.map((cliente) => [cliente.codigo, cliente.empreendimentosNaCarteira])),
  );

  // A segunda conferência, agora contra as parcelas que vão para o arquivo: se uma carga do LSoft
  // rodou entre as leituras, a aba Parcelas e a coluna de patrimônio da aba Clientes descolariam.
  const divergencia = divergenciaDoPatrimonio(clientes, parcelas);
  if (divergencia) return { erro: divergencia, ok: false };

  const arquivo = await planilhaDaCarteiraLsoft({
    agora,
    clientes,
    filtro: { ...filtro, busca, empreendimento: empreendimento ?? "" },
    parcelas,
    sincronizadoEm: carteira.resumo.sincronizadoEm,
  });

  return {
    arquivo,
    clientes: clientes.length,
    nome: nomeDoArquivo(empreendimento, hojeNaCasa(agora)),
    ok: true,
    parcelas: parcelas.length,
  };
}
