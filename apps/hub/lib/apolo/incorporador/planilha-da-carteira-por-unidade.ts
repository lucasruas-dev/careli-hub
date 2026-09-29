import { diaNaTela } from "@/lib/apolo/incorporador/dia-na-tela";
import { FUSO_DA_CASA } from "@/lib/guardian/hoje-na-casa";

// A CARTEIRA POR UNIDADE EM XLSX: o botão "Excel" da tabela "Carteira por unidade", no portal do
// incorporador (a aba se chama Financeiro na casca do Hércules e Carteira no portal padrão).
//
// Lucas (29/09/2026), depois de pedir o Excel na tela LSoft Integração da Cecílio: *"na tela do
// financeiro tbm"*. O que faltava exportar ali era a tabela "Carteira por unidade"; o extrato da
// aba Indicadores já tinha o botão dele (planilha-do-extrato.ts).
//
// ⚠️ O ARQUIVO É O RECORTE DA TELA, E É MONTADO NO NAVEGADOR. É a diferença para o extrato, que
// refaz a leitura no servidor. Lá é obrigatório: o extrato chega à tela cortado em 2.000 linhas e a
// carteira tem dezenas de milhares de parcelas. Aqui não há corte nenhum: a rota
// /api/incorporador/carteira manda TODAS as unidades do recorte em `units`, e a busca, o seletor
// Todas/Inadimplentes/Em dia e a ordenação rodam no navegador, sobre essa lista inteira. Então o
// que está na tela JÁ É o recorte completo, e refazer a leitura ao C2X (a consulta cara desta tela)
// só para montar a planilha seria pagar duas vezes pelo mesmo dado.
//
// ⚠️ O EXCELJS ENTRA POR IMPORT DINÂMICO, DENTRO DA FUNÇÃO. Este arquivo é importado pela tela do
// navegador; um `import ExcelJS from "exceljs"` no topo colocaria a biblioteca inteira no bundle de
// quem nunca exporta. É o padrão de CadastroDeUnidades.tsx e EmissaoDeBoletos.tsx. Pelo mesmo
// motivo este arquivo NÃO importa nada de planilha-do-extrato.ts (que importa o ExcelJS no topo,
// porque roda no servidor): o recorte do nome do arquivo está repetido aqui de propósito.
//
// ⚠️ AS REGRAS DA CASA PARA XLSX, as mesmas do extrato e dos boletos: cabeçalho em negrito,
// congelado e com filtro; linha de TOTAL no fim, em negrito; dinheiro como NÚMERO com formato de
// moeda (quem exporta soma na planilha); data como TEXTO dd/mm/aaaa (escrever `Date` reabre a
// armadilha do fuso do ExcelJS, que grava em UTC e mostra o dia anterior no Brasil); nulo vira
// célula vazia, nunca zero; e o arquivo DIZ quando não está inteiro.

/** O filtro da tela (o seletor Todas/Inadimplentes/Em dia). Estrutural: é o mesmo tipo da tela. */
export type FiltroDaPlanilha = "em_dia" | "inadimplente" | "todos";

/** A ordem da tela (o cabeçalho clicável). Estrutural: é o mesmo tipo da tela. */
export type OrdemDaPlanilha = {
  coluna: "codigo" | "faturado" | "liquido" | "situacao" | "vencido" | "vgv";
  direcao: "asc" | "desc";
};

/**
 * O que a planilha lê de uma unidade.
 *
 * ⚠️ TIPO PRÓPRIO, E NÃO O DA TELA. `UnidadeDaTela` é local de TelaCarteira.tsx e não é exportado;
 * a tela passa as unidades dela e o TypeScript confere, campo a campo, que elas cabem aqui. Se a
 * rota mudar um campo que a planilha usa, quebra a compilação, e não o arquivo de quem baixa.
 */
export type UnidadeDaPlanilha = {
  block: null | string;
  client: null | string;
  code: string;
  contractCode: null | string;
  empreendimento: null | string;
  faturadoAt: null | string;
  imobiliaria: null | string;
  /** `null` = o líquido desta unidade ainda não foi apurado. Nunca vira zero. */
  liquido: null | { liquido: number; semLiquido: number };
  lot: null | string;
  maxOverdueDays: number;
  overdueAmount: number;
  overdueInstallments: number;
  paidAmount: number;
  temContrato: boolean;
  toReceiveAmount: number;
  totalContract: number;
};

export type LinhaDaUnidade = {
  aReceber: number;
  comprador: string;
  contrato: string;
  contratoAssinado: string;
  empreendimento: string;
  faturado: string;
  imobiliaria: string;
  liquido: null | number;
  lote: string;
  maiorAtraso: number;
  pago: number;
  /** `null` quando a unidade não tem líquido nenhum: não há conta de "quantas faltam". */
  parcelasSemLiquido: null | number;
  parcelasVencidas: number;
  quadra: string;
  situacao: string;
  unidade: string;
  vencido: number;
  vgv: number;
};

export type ColunaDaPlanilha = {
  chave: keyof LinhaDaUnidade;
  largura: number;
  moeda?: boolean;
  titulo: string;
};

/**
 * As colunas do arquivo.
 *
 * ⚠️ MAIS COLUNAS DO QUE A TELA, e é de propósito. Na tela, quadra/lote/empreendimento são a
 * segunda linha da célula de unidade, comprador e imobiliária dividem uma célula, e "3 vencida(s) ·
 * 45d" é um selo. Numa planilha, cada informação na sua coluna é o que deixa filtrar e somar; e o
 * empreendimento entra sempre, porque o arquivo viaja por e-mail sem a tela junto.
 */
export const COLUNAS_DA_PLANILHA: readonly ColunaDaPlanilha[] = [
  { chave: "unidade", largura: 14, titulo: "Unidade" },
  { chave: "quadra", largura: 9, titulo: "Quadra" },
  { chave: "lote", largura: 9, titulo: "Lote" },
  { chave: "empreendimento", largura: 24, titulo: "Empreendimento" },
  { chave: "comprador", largura: 36, titulo: "Comprador" },
  { chave: "imobiliaria", largura: 28, titulo: "Imobiliária" },
  { chave: "contrato", largura: 14, titulo: "Contrato" },
  { chave: "faturado", largura: 12, titulo: "Faturado" },
  { chave: "vgv", largura: 15, moeda: true, titulo: "VGV" },
  { chave: "pago", largura: 15, moeda: true, titulo: "Pago" },
  { chave: "aReceber", largura: 15, moeda: true, titulo: "A receber" },
  { chave: "vencido", largura: 15, moeda: true, titulo: "Vencido" },
  { chave: "parcelasVencidas", largura: 10, titulo: "Parcelas vencidas" },
  { chave: "maiorAtraso", largura: 10, titulo: "Maior atraso (dias)" },
  { chave: "liquido", largura: 15, moeda: true, titulo: "Valor líquido" },
  { chave: "parcelasSemLiquido", largura: 10, titulo: "Parcelas sem líquido" },
  { chave: "situacao", largura: 13, titulo: "Situação" },
  { chave: "contratoAssinado", largura: 10, titulo: "Contrato assinado" },
];

const ROTULO_DO_FILTRO: Record<FiltroDaPlanilha, string> = {
  em_dia: "Em dia",
  inadimplente: "Inadimplentes",
  todos: "Todas",
};

const ROTULO_DA_ORDEM: Record<OrdemDaPlanilha["coluna"], string> = {
  codigo: "Unidade",
  faturado: "Faturado",
  liquido: "Valor líquido",
  situacao: "Situação",
  vencido: "Vencido",
  vgv: "VGV",
};

/**
 * Texto limpo para a célula: sem caractere de controle (quebra de linha e tabulação vindas do
 * cadastro viram espaço) e sem espaço nas pontas.
 *
 * ⚠️ O CORTE É POR CÓDIGO, e não por intervalo de regex: escrito como regex, o intervalo de
 * controle vira byte invisível no fonte e a linha fica impossível de editar depois (a mesma
 * armadilha do nome do arquivo, abaixo).
 */
function texto(valor: null | string | undefined): string {
  return [...String(valor ?? "")]
    .map((caractere) => ((caractere.codePointAt(0) ?? 0) < 0x20 ? " " : caractere))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tira os acentos (os combinantes 0x300-0x36f que o NFD separa da letra), por código. */
function semAcento(valor: string): string {
  return [...valor.normalize("NFD")]
    .filter((caractere) => {
      const codigo = caractere.codePointAt(0) ?? 0;
      return codigo < 0x300 || codigo > 0x36f;
    })
    .join("");
}

/** Número que a planilha pode somar. O que não for número finito vira zero (nunca `NaN`). */
function numero(valor: number): number {
  return Number.isFinite(valor) ? valor : 0;
}

/** Soma de dinheiro fechada no centavo: somar 3.000 unidades em ponto flutuante deixa resíduo. */
function somaEmCentavos(valores: number[]): number {
  return Math.round(valores.reduce((soma, valor) => soma + valor, 0) * 100) / 100;
}

/**
 * A situação da unidade na planilha.
 *
 * ⚠️ O MESMO CRITÉRIO DO SELETOR DA TELA (`filtrarUnidades`): "Inadimplentes" é quem tem parcela
 * vencida, "Em dia" é quem não tem. Quem filtra a coluna no Excel chega às mesmas unidades que
 * chegaria pelo seletor.
 */
export function situacaoDaUnidade(unidade: Pick<UnidadeDaPlanilha, "overdueInstallments">): string {
  return unidade.overdueInstallments > 0 ? "Inadimplente" : "Em dia";
}

/** Uma unidade, no formato do arquivo. */
export function linhaDaUnidade(unidade: UnidadeDaPlanilha): LinhaDaUnidade {
  return {
    aReceber: numero(unidade.toReceiveAmount),
    comprador: texto(unidade.client),
    contrato: texto(unidade.contractCode),
    contratoAssinado: unidade.temContrato ? "Sim" : "Não",
    empreendimento: texto(unidade.empreendimento),
    // A régua de dia da casa, a mesma da tela: meia-noite em UTC é DIA, e não cai para o dia
    // anterior no fuso de São Paulo. O nulo, que na tela é "-", aqui é célula vazia.
    faturado: diaNaTela(unidade.faturadoAt, ""),
    imobiliaria: texto(unidade.imobiliaria),
    // ⚠️ `null` VIRA CÉLULA VAZIA, e não zero: líquido nulo quer dizer "não deu para apurar", e
    // zero somaria como se a unidade não rendesse nada ao incorporador.
    liquido: unidade.liquido ? numero(unidade.liquido.liquido) : null,
    lote: texto(unidade.lot),
    maiorAtraso: numero(unidade.maxOverdueDays),
    pago: numero(unidade.paidAmount),
    parcelasSemLiquido: unidade.liquido ? numero(unidade.liquido.semLiquido) : null,
    parcelasVencidas: numero(unidade.overdueInstallments),
    quadra: texto(unidade.block),
    situacao: situacaoDaUnidade(unidade),
    unidade: texto(unidade.code),
    vencido: numero(unidade.overdueAmount),
    vgv: numero(unidade.totalContract),
  };
}

/**
 * O nome do recorte escolhido na tela: o produto e, se houver, o filho. `null` = "Todos".
 *
 * O filho que já carrega o nome do pai no próprio nome não o repete: "Vale do Ouro, Vale do Ouro
 * Chácaras" seria ruído no nome do arquivo.
 */
export function nomeDoRecorte(
  produto: null | string | undefined,
  filho: null | string | undefined,
): null | string {
  const pai = texto(produto);
  const recorte = texto(filho);
  if (!recorte) return pai || null;
  if (!pai) return recorte;
  return semAcento(recorte).toLowerCase().includes(semAcento(pai).toLowerCase())
    ? recorte
    : `${pai}, ${recorte}`;
}

/** Um produto do seletor da tela (o PAI, com os recortes dentro), como a rota da carteira o manda. */
export type ProdutoDoSeletor = {
  filhos?: readonly { id: string; nome: string }[];
  id: string;
  nome: string;
};

/**
 * O que vai no arquivo quando a consulta pediu um recorte que a lista de produtos não conhece.
 * Não acontece pela tela (os chips só mandam ids da própria lista), mas se acontecer o arquivo não
 * pode dizer "Todos" sobre um pedaço da carteira.
 */
export const RECORTE_NAO_IDENTIFICADO = "Recorte não identificado";

/**
 * O nome do recorte de onde as unidades VIERAM: o `filtro` que a rota devolve junto com elas (é o
 * próprio `?code` que gerou aquela resposta), procurado na lista de produtos da mesma resposta.
 *
 * ⚠️ NUNCA PELO CHIP ESCOLHIDO AGORA. Enquanto o recorte novo carrega, a tela continua mostrando
 * as unidades do anterior; tirar o nome do chip fazia o Excel baixado nessa janela sair com o nome
 * de um empreendimento e as unidades de outro (achado da revisão de 29/09/2026: clicar em "Vale do
 * Ouro" com "Todos" na tela e baixar dava `carteira-vale-do-ouro.xlsx` com compradores da Lagoa
 * Bonita). O arquivo viaja para contador e sócio; o rótulo tem de ser o do dado.
 *
 * A precedência é a mesma do nome do arquivo do extrato, no servidor: produto primeiro, recorte
 * depois. Sem filtro e com um produto só, o arquivo leva o nome dele (a mesma regra da tela, onde o
 * produto único já é o escolhido); com vários, é "Todos" (`null`).
 */
export function recorteDaConsulta(
  filtro: null | string | undefined,
  produtos: readonly ProdutoDoSeletor[],
): null | string {
  if (!filtro) return produtos.length === 1 ? nomeDoRecorte(produtos[0]?.nome, null) : null;

  const produto = produtos.find((p) => p.id === filtro);
  if (produto) return nomeDoRecorte(produto.nome, null);

  for (const pai of produtos) {
    const filho = (pai.filhos ?? []).find((f) => f.id === filtro);
    if (filho) return nomeDoRecorte(pai.nome, filho.nome);
  }

  return RECORTE_NAO_IDENTIFICADO;
}

/** O nome do arquivo: `carteira-<recorte>-<aaaa-mm-dd>.xlsx`, ou só a data sem recorte. */
export function nomeDoArquivo(recorte: null | string, hojeIso: string): string {
  // Sem acento e sem espaço: o nome do arquivo viaja por e-mail e por Windows.
  const pedaco = semAcento(texto(recorte))
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const data = hojeIso.slice(0, 10);
  return pedaco ? `carteira-${pedaco}-${data}.xlsx` : `carteira-${data}.xlsx`;
}

/** O instante da consulta, como a pessoa leu no cabeçalho da tela: "29/09/2026 às 14:32". */
function momentoNaCasa(valor: Date | null | string | undefined): string {
  if (!valor) return "";
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const diaDaConsulta = data.toLocaleDateString("pt-BR", { timeZone: FUSO_DA_CASA });
  const hora = data.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSO_DA_CASA,
  });
  return `${diaDaConsulta} às ${hora}`;
}

/** Texto vazio vira célula VAZIA de verdade: string "" conta como preenchida no Excel. */
function celula(valor: null | number | string): null | number | string {
  return valor === "" ? null : valor;
}

/**
 * Monta o arquivo.
 *
 * ⚠️ AS UNIDADES CHEGAM NA ORDEM DA TELA e saem nela: quem ordenou por "Vencido, maior primeiro"
 * abre a planilha com o maior vencido no topo.
 */
export async function planilhaDaCarteiraPorUnidade(input: {
  busca: string;
  /** O instante da consulta que a tela mostra no cabeçalho ("Consultado às ..."). */
  consultadoEm: Date | null | string;
  filtro: FiltroDaPlanilha;
  /**
   * O líquido da carteira, como a tela o recebeu. `null` = não deu para calcular nenhuma parcela;
   * `parcial` = a leitura bateu no teto e o líquido pode estar incompleto.
   */
  liquido: null | { parcial: boolean };
  ordem: OrdemDaPlanilha;
  /** O nome do recorte escolhido (ver `nomeDoRecorte`). `null` = "Todos". */
  recorte: null | string;
  unidades: readonly UnidadeDaPlanilha[];
}): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;

  const linhas = input.unidades.map(linhaDaUnidade);

  const livro = new ExcelJS.Workbook();
  livro.created = new Date();
  const aba = livro.addWorksheet("Carteira");

  aba.columns = COLUNAS_DA_PLANILHA.map((c) => ({ key: c.chave, width: c.largura }));

  const cabecalho = aba.addRow(COLUNAS_DA_PLANILHA.map((c) => c.titulo));
  cabecalho.font = { bold: true };
  // Sem isto, quem rola até a unidade 2.000 não sabe mais qual coluna é o pago e qual é o vencido.
  // O filtro é o que a pessoa faria na mão logo depois de abrir.
  aba.views = [{ state: "frozen", ySplit: 1 }];
  aba.autoFilter = {
    from: { column: 1, row: 1 },
    to: { column: COLUNAS_DA_PLANILHA.length, row: 1 },
  };

  for (const linha of linhas) {
    aba.addRow(COLUNAS_DA_PLANILHA.map((c) => celula(linha[c.chave])));
  }

  const comLiquido = linhas.filter((l) => l.liquido !== null);

  // ⚠️ O ARQUIVO DIZ QUANDO NÃO ESTÁ INTEIRO. As unidades estão todas aqui (a rota não corta
  // unidade), mas o LÍQUIDO pode não estar: a leitura das parcelas para o rateio tem teto, e há
  // empreendimento que passa dele sozinho. A tela avisa em vermelho; a planilha viaja sem a tela,
  // então o aviso vai escrito na linha do total. E sem líquido nenhum, o total do líquido fica
  // vazio (e não R$ 0,00, que quem recebe leria como "não entrou nada").
  const aviso =
    input.liquido === null
      ? "SEM VALOR LÍQUIDO: não foi possível calcular agora"
      : input.liquido.parcial
        ? "PARCIAL: o valor líquido pode estar incompleto, a leitura bateu no teto"
        : "";

  const total = aba.addRow(
    COLUNAS_DA_PLANILHA.map((c) => {
      if (c.chave === "unidade") return `${linhas.length} unidade(s)`;
      if (c.chave === "empreendimento") return celula(aviso);
      if (c.chave === "vgv") return somaEmCentavos(linhas.map((l) => l.vgv));
      if (c.chave === "pago") return somaEmCentavos(linhas.map((l) => l.pago));
      if (c.chave === "aReceber") return somaEmCentavos(linhas.map((l) => l.aReceber));
      if (c.chave === "vencido") return somaEmCentavos(linhas.map((l) => l.vencido));
      if (c.chave === "liquido") {
        return comLiquido.length > 0
          ? somaEmCentavos(comLiquido.map((l) => l.liquido ?? 0))
          : null;
      }
      return null;
    }),
  );
  total.font = { bold: true };

  for (const [indice, coluna] of COLUNAS_DA_PLANILHA.entries()) {
    if (!coluna.moeda) continue;
    // Número com formato de moeda: a planilha soma e filtra. Texto "R$ 1.520,92" não faria nem um
    // nem outro.
    const daPlanilha = aba.getColumn(indice + 1);
    daPlanilha.numFmt = "R$ #,##0.00";
    daPlanilha.alignment = { horizontal: "right" };
  }

  // ── A ABA "Sobre": de onde veio o arquivo ────────────────────────────────
  // Quem recebe a planilha por e-mail não tem a tela junto: sem isto, não dá para saber se ela é a
  // carteira inteira ou "só os inadimplentes que batem com Silva".
  const sobre = livro.addWorksheet("Sobre");
  sobre.columns = [{ width: 24 }, { width: 90 }];

  const semLiquido = linhas.length - comLiquido.length;
  const itens: [string, number | string][] = [
    // ⚠️ SÓ O TÍTULO DA TABELA, que é o mesmo em todo portal. O nome da aba muda: é "Financeiro"
    // na casca do Hércules (Cecílio) e "Carteira" no portal padrão; escrever "Financeiro" aqui
    // mandaria quem recebeu o arquivo procurar uma aba que o menu dele não tem.
    ["Tela", "Carteira por unidade"],
    ["Recorte", texto(input.recorte) || "Todos"],
    ["Busca", texto(input.busca) || "Nenhuma"],
    ["Filtro", ROTULO_DO_FILTRO[input.filtro] ?? texto(input.filtro)],
    [
      "Ordem",
      `${ROTULO_DA_ORDEM[input.ordem.coluna] ?? texto(input.ordem.coluna)}, ${
        input.ordem.direcao === "asc" ? "crescente" : "decrescente"
      }`,
    ],
    ["Consultado em", momentoNaCasa(input.consultadoEm) || "-"],
    ["Unidades", linhas.length],
    [
      "Valor líquido",
      // "Do incorporador", e não "sua": o arquivo é encaminhado (contador, sócio), e quem o lê
      // não é necessariamente quem clicou.
      "A parte do incorporador em cada parcela paga, já descontado o rateio (comissão, gestão e coordenação). Célula vazia: ainda não apurado.",
    ],
  ];
  if (semLiquido > 0 && input.liquido !== null) {
    itens.push(["Unidades sem líquido", semLiquido]);
  }
  if (aviso) {
    itens.push([
      "Aviso",
      input.liquido === null
        ? "Não foi possível calcular o valor líquido agora. As demais colunas estão completas."
        : "A carteira deste recorte é muito grande e a leitura foi limitada: os valores de líquido podem estar incompletos. As demais colunas estão completas.",
    ]);
  }

  for (const [campo, valor] of itens) {
    const linha = sobre.addRow([campo, valor]);
    linha.getCell(1).font = { bold: true };
    linha.getCell(2).alignment = { horizontal: "left", wrapText: true };
  }

  return (await livro.xlsx.writeBuffer()) as ArrayBuffer;
}
