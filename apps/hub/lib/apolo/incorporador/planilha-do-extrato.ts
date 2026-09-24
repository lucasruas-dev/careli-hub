import ExcelJS from "exceljs";

import { formatarDocumento } from "@/lib/apolo/documento";
import {
  type ExtratoParcela,
  type SituacaoDaParcela,
} from "@/lib/apolo/incorporador/carteira-liquida";

// O EXTRATO DA CARTEIRA EM XLSX — o botão de exportar do portal do incorporador.
//
// Lucas (23/09/2026): *"no portal do incorporador, na parte de carteira, temos a parte do extrato.
// preciso trazer o CPF para esse painel e ter um botão para exportar em xlsx"*.
//
// ⚠️ O ARQUIVO SAI DO RECORTE INTEIRO, E NÃO DAS LINHAS QUE A TELA RECEBEU — é a diferença para a
// planilha de boletos, que exporta o que está na tela. Lá isso é honesto: a competência cabe
// inteira no envio (334 boletos no maior mês medido). Aqui NÃO cabe: o extrato tem teto de payload
// de 2.000 linhas (`EXTRATO_TETO`) e a carteira do Vale do Ouro sozinha tem 27.721 parcelas
// (medido em 23/09/2026) — exportar "o que está na tela" entregaria 2.000 de 27.721 com cara de
// planilha completa, e o rodapé fecharia num total que não é o do filtro. Por isso a rota refaz a
// leitura com o MESMO filtro da tela e um teto próprio.
//
// ⚠️ E O ARQUIVO DIZ QUANDO NÃO ESTÁ INTEIRO. Há DOIS cortes possíveis, e os dois viram aviso na
// linha do total: o do FILTRO (mais linhas do que o teto do arquivo) e o da LEITURA — a consulta
// ao C2X para em 30.000 linhas, e medido em 23/09/2026 há empreendimento que passa disso sozinho
// (LOS 37.956, LOU 30.252). Planilha truncada em silêncio é pior do que planilha nenhuma: quem
// abre soma 30.000 linhas e acha que é a carteira.
//
// ⚠️ FILTRO E ORDEM SÃO OS DA TELA, e viajam na URL — os mesmos parâmetros que a rota da carteira
// já aceita. Quem filtra "vencidas de 2026" e clica em exportar recebe vencidas de 2026.
//
// ⚠️ DATA VAI COMO TEXTO `dd/mm/aaaa`. Escrever `Date` reabre a armadilha do fuso do ExcelJS (o
// serial nasce em UTC e, aberto no Brasil, mostra o dia anterior). Valor e líquido vão como
// NÚMERO, com formato de moeda: quem exporta soma na planilha.
//
// ⚠️ O DOCUMENTO VAI COMO TEXTO FORMATADO ("064.510.436-13"). Só dígitos o Excel leria como
// número e comeria o zero à esquerda — e CPF que começa com zero é comum.

/**
 * O teto de linhas do arquivo.
 *
 * Casado com o teto de LEITURA da carteira (`TETO` em carteira-liquida.ts, também 30.000): não
 * adianta o arquivo aceitar mais do que a consulta traz. Medido em 23/09/2026, o Vale do Ouro
 * inteiro dá 27.721 linhas e 1,39 MB de xlsx, montado em ~1s.
 */
export const LIMITE_DO_EXTRATO = 30000;

export type ColunaDoArquivo = {
  chave: keyof LinhaDoArquivo;
  largura: number;
  moeda?: boolean;
  titulo: string;
};

export type LinhaDoArquivo = {
  cliente: string;
  documento: string;
  empreendimento: string;
  imobiliaria: string;
  liquido: null | number;
  pagamento: string;
  parcela: string;
  perfil: string;
  situacao: string;
  unidade: string;
  valor: number;
  vencimento: string;
};

/**
 * As colunas, na ordem em que a tela as mostra.
 *
 * ⚠️ O EMPREENDIMENTO ENTRA SEMPRE, inclusive quando o portal tem um só. Na tela ele é a segunda
 * linha da célula de unidade; na planilha, que viaja por e-mail sem a tela junto, uma coluna a
 * mais é mais barata do que descobrir depois de qual loteamento era o arquivo.
 */
export const COLUNAS_DO_ARQUIVO: readonly ColunaDoArquivo[] = [
  { chave: "unidade", largura: 14, titulo: "Unidade" },
  { chave: "empreendimento", largura: 22, titulo: "Empreendimento" },
  { chave: "cliente", largura: 38, titulo: "Cliente" },
  { chave: "documento", largura: 20, titulo: "CPF/CNPJ" },
  { chave: "imobiliaria", largura: 28, titulo: "Imobiliária" },
  { chave: "perfil", largura: 12, titulo: "Perfil" },
  { chave: "parcela", largura: 12, titulo: "Parcela" },
  { chave: "vencimento", largura: 14, titulo: "Vencimento" },
  { chave: "pagamento", largura: 14, titulo: "Pagamento" },
  { chave: "valor", largura: 15, moeda: true, titulo: "Valor" },
  { chave: "liquido", largura: 15, moeda: true, titulo: "Valor líquido" },
  { chave: "situacao", largura: 13, titulo: "Situação" },
];

const SITUACAO: Record<SituacaoDaParcela, string> = {
  a_vencer: "A vencer",
  paga: "Paga",
  vencida: "Vencida",
};

/** `2026-09-23` -> `23/09/2026`. Sem `Date` no meio: é recorte de string, e não tem fuso. */
function dia(iso: null | string): string {
  const d = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return "";
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
}

function texto(valor: null | string | undefined): string {
  // eslint-disable-next-line no-control-regex
  return String(valor ?? "").replace(/[\u0000-\u001f]+/g, " ").trim();
}

/** Uma linha do extrato, no formato do arquivo. */
export function linhaDoArquivo(parcela: ExtratoParcela): LinhaDoArquivo {
  return {
    cliente: texto(parcela.cliente),
    documento: parcela.documento ? formatarDocumento(parcela.documento) : "",
    empreendimento: texto(parcela.empreendimento),
    imobiliaria: texto(parcela.imobiliaria),
    // ⚠️ `null` VIRA CÉLULA VAZIA, e não zero: o líquido nulo quer dizer "não deu para apurar"
    // (o motivo está no tooltip da tela). Zero somaria como se a parcela não rendesse nada.
    liquido: parcela.liquido,
    pagamento: dia(parcela.pagoEm),
    parcela: texto(parcela.numero),
    perfil: texto(parcela.perfil),
    situacao: SITUACAO[parcela.situacao] ?? texto(parcela.situacao),
    unidade: texto(parcela.unidade),
    valor: Number.isFinite(parcela.valor) ? parcela.valor : 0,
    vencimento: dia(parcela.vencimento),
  };
}

/** O nome do arquivo: o empreendimento quando há um só, e a data de hoje. */
export function nomeDoArquivo(carteira: null | string, hojeIso: string): string {
  // Sem acento e sem espaço: o nome do arquivo viaja por e-mail e por Windows. O corte dos
  // combinantes (a faixa 0x300-0x36f que o NFD separa da letra) é por CÓDIGO, e não por
  // intervalo de regex: escrito como regex, ele vira byte invisível no fonte e a linha fica
  // impossível de editar depois.
  const semAcento = [...texto(carteira).normalize("NFD")]
    .filter((caractere) => {
      const codigo = caractere.codePointAt(0) ?? 0;
      return codigo < 0x300 || codigo > 0x36f;
    })
    .join("");
  const pedaco = semAcento
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
  const data = hojeIso.slice(0, 10);
  return pedaco ? `extrato-${pedaco}-${data}.xlsx` : `extrato-${data}.xlsx`;
}

/**
 * Monta o arquivo.
 *
 * ⚠️ O TOTAL É DO ARQUIVO, e a contagem sai escrita na linha: quando o recorte passa do teto, quem
 * abre precisa saber que está vendo um pedaço — um total silenciosamente parcial é pior do que
 * nenhum total.
 */
export async function planilhaDoExtrato(input: {
  carteira: null | string;
  /** `true` = a LEITURA do C2X bateu no teto: nem o total do filtro é a carteira inteira. */
  leituraParcial?: boolean;
  parcelas: ExtratoParcela[];
  /** Quantas o filtro encontrou. Maior que `parcelas.length` = o teto do arquivo cortou. */
  total: number;
}): Promise<ArrayBuffer> {
  const linhas = input.parcelas.slice(0, LIMITE_DO_EXTRATO).map(linhaDoArquivo);

  const livro = new ExcelJS.Workbook();
  const aba = livro.addWorksheet("Extrato");

  aba.columns = COLUNAS_DO_ARQUIVO.map((c) => ({ key: c.chave, width: c.largura }));

  const cabecalho = aba.addRow(COLUNAS_DO_ARQUIVO.map((c) => c.titulo));
  cabecalho.font = { bold: true };
  // Sem isto, quem rola até a linha 8.000 não sabe mais qual coluna é o vencimento e qual é o
  // pagamento. O filtro é o que a pessoa faria na mão logo depois de abrir.
  aba.views = [{ state: "frozen", ySplit: 1 }];
  aba.autoFilter = {
    from: { column: 1, row: 1 },
    to: { column: COLUNAS_DO_ARQUIVO.length, row: 1 },
  };

  for (const linha of linhas) {
    aba.addRow(COLUNAS_DO_ARQUIVO.map((c) => linha[c.chave]));
  }

  const total = aba.addRow(
    COLUNAS_DO_ARQUIVO.map((c) => {
      if (c.chave === "unidade") return `${linhas.length} parcela(s)`;
      if (c.chave === "empreendimento") {
        // A leitura truncada é o aviso mais grave: nem o total do filtro fecha com a carteira.
        if (input.leituraParcial) return "PARCIAL: a leitura bateu no teto";
        if (input.total > linhas.length) return `de ${input.total} do filtro`;
        return "";
      }
      if (c.chave === "valor") return linhas.reduce((soma, l) => soma + l.valor, 0);
      if (c.chave === "liquido") return linhas.reduce((soma, l) => soma + (l.liquido ?? 0), 0);
      return "";
    }),
  );
  total.font = { bold: true };

  for (const [indice, coluna] of COLUNAS_DO_ARQUIVO.entries()) {
    const daPlanilha = aba.getColumn(indice + 1);
    if (coluna.moeda) {
      // Número com formato de moeda: a planilha soma e filtra. Texto "R$ 1.520,92" não faria nem
      // um nem outro.
      daPlanilha.numFmt = 'R$ #,##0.00';
      daPlanilha.alignment = { horizontal: "right" };
    }
    if (coluna.chave === "documento") daPlanilha.alignment = { horizontal: "left" };
  }

  return (await livro.xlsx.writeBuffer()) as ArrayBuffer;
}
