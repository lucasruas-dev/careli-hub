// O EXTRATO DO CLIENTE em PDF timbrado (pdf-lib). Monta o documento em memória e devolve os
// BYTES — mesmo molde do `modules/apolo/blocks/cadastro/cad-pdf.ts`, inclusive o embed da logo
// em base64 e o best-effort (se o PNG falhar, o extrato sai sem logo em vez de não sair).
//
// ESTA PEÇA VAI PARA A MÃO DO CLIENTE. Duas consequências que mandam no layout:
//
//  • O NÚMERO PRINCIPAL É O SALDO A VALOR DE HOJE, e a ressalva vem logo abaixo dele, em corpo
//    de texto — não em rodapé de 6pt. O saldo nominal continua impresso, como linha secundária,
//    porque é ele que consta no contrato; mas nunca sozinho. Ver o cabeçalho de
//    `lib/apolo/extrato-cliente.ts` para o porquê.
//  • AS 110 PARCELAS EM ABERTO NÃO SÃO IMPRESSAS UMA A UMA. Viram resumo por ano. O que sai
//    linha a linha é o que o cliente pediu (os pagamentos realizados) e o que ele precisa ver
//    (as parcelas em atraso).
//
// Paleta: grafite com preto, sem cor de enfeite (regra do Lucas). O único dourado da página é o
// da própria marca.
import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";

import { periodicidadeDaTaxa } from "@/lib/apolo/periodicidade-da-taxa";
// ⚠️ O CABEÇALHO, OS ÍCONES E OS CARTÕES MORAM NO PAPEL TIMBRADO desde 16/09/2026, quando os dois
// termos (acordo e rescisão) passaram a seguir este extrato como referência visual. O código é o
// mesmo que estava aqui, movido: os bytes do PDF gerado antes e depois da mudança são idênticos.
// A ficha (titular e linha de campos) e a tabela subiram no mesmo dia, pela mesma razão, com a
// mesma prova: o sha256 de oito extratos (um lote, consolidado e encerrado) igual antes e depois.
import {
  cabecalhoComBlocoADireita,
  campoEmDestaque,
  type Cartao,
  desenharCartoes,
  desenharIcone,
  desenharTabelaLimpa,
  linhaDeCampos,
} from "@/lib/apolo/pdf-timbrado";
import {
  contarParcelas,
  dataBr,
  dinheiro,
  percentualSimples,
  resumoPorAno,
  situacaoParaOComprador,
  type ExtratoClienteContrato,
  type ExtratoClienteData,
  type ExtratoClienteParcela,
  type ExtratoClienteRelatorio,
} from "@/lib/apolo/extrato-cliente";

const INK = rgb(0.051, 0.078, 0.11); // #0d141c — preto grafite
const TEXT = rgb(0.118, 0.161, 0.231); // #1e293b
const SOFT_TEXT = rgb(0.353, 0.404, 0.471); // #5a6778
const MUTE = rgb(0.58, 0.639, 0.722); // #94a3b8
const LINE = rgb(0.886, 0.91, 0.941); // #e2e8f0
const BAND = rgb(0.965, 0.973, 0.98); // #f6f8fa
const DARK_BAND = rgb(0.208, 0.239, 0.286); // #353d49

/** O título da peça. Constante porque a largura dele decide o espaço do nome à direita. */
const TITULO_DA_PECA = "Extrato de Pagamentos e Saldo Devedor";

const A4 = { h: 841.89, w: 595.28 };
const MARGIN = 42;
const USABLE = A4.w - MARGIN * 2;
const FOOT = MARGIN + 6;

type Ctx = {
  bold: PDFFont;
  doc: PDFDocument;
  font: PDFFont;
  page: PDFPage;
  y: number;
};

/** Sanitiza para o WinAnsi das fontes padrão (acento latino passa; emoji e travessão, não). */
function limpar(valor: string): string {
  return (valor ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/·/g, "-")
    // Os controles \x09/\x0A/\x0D estao na classe NEGADA de proposito: tab, LF e
    // CR sao os unicos invisiveis que o pdf-lib aceita; o resto (emoji, setas, espaco fino)
    // estouraria o WinAnsi em runtime -- no meio da emissao do extrato que vai para o cliente.
    // eslint-disable-next-line no-control-regex
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

function escrever(
  ctx: Ctx,
  texto: string,
  opcoes: {
    color?: ReturnType<typeof rgb>;
    font?: PDFFont;
    size?: number;
    x: number;
    y: number;
  },
): void {
  ctx.page.drawText(limpar(texto), {
    color: opcoes.color ?? TEXT,
    font: opcoes.font ?? ctx.font,
    size: opcoes.size ?? 8.5,
    x: opcoes.x,
    y: opcoes.y,
  });
}

function escreverDireita(
  ctx: Ctx,
  texto: string,
  opcoes: {
    color?: ReturnType<typeof rgb>;
    direita: number;
    font?: PDFFont;
    size?: number;
    y: number;
  },
): void {
  const font = opcoes.font ?? ctx.font;
  const size = opcoes.size ?? 8.5;
  const largura = font.widthOfTextAtSize(limpar(texto), size);

  escrever(ctx, texto, {
    color: opcoes.color,
    font,
    size,
    x: opcoes.direita - largura,
    y: opcoes.y,
  });
}

function regua(ctx: Ctx, cor = LINE, espessura = 0.7): void {
  ctx.page.drawLine({
    color: cor,
    end: { x: A4.w - MARGIN, y: ctx.y },
    start: { x: MARGIN, y: ctx.y },
    thickness: espessura,
  });
}

function quebrar(texto: string, font: PDFFont, size: number, maxW: number): string[] {
  const palavras = limpar(texto).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [""];

  const linhas: string[] = [];
  let atual = palavras[0] ?? "";

  for (let i = 1; i < palavras.length; i += 1) {
    const palavra = palavras[i] ?? "";
    const tentativa = `${atual} ${palavra}`;
    if (font.widthOfTextAtSize(tentativa, size) <= maxW) {
      atual = tentativa;
    } else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  linhas.push(atual);
  return linhas;
}

/** Corta um texto que não cabe na coluna, com reticências. Tabela não pode estourar a célula. */
function encurtar(texto: string, font: PDFFont, size: number, maxW: number): string {
  const limpo = limpar(texto);
  if (font.widthOfTextAtSize(limpo, size) <= maxW) {
    return limpo;
  }

  let corte = limpo;
  while (corte.length > 1 && font.widthOfTextAtSize(`${corte}...`, size) > maxW) {
    corte = corte.slice(0, -1);
  }
  return `${corte}...`;
}

function novaPagina(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([A4.w, A4.h]);
  ctx.y = A4.h - MARGIN;
}

function garantirEspaco(ctx: Ctx, altura: number): void {
  if (ctx.y - altura < FOOT + 16) {
    novaPagina(ctx);
  }
}

function tituloDeSecao(ctx: Ctx, titulo: string): void {
  garantirEspaco(ctx, 30);
  ctx.y -= 10;
  escrever(ctx, titulo.toUpperCase(), { color: INK, font: ctx.bold, size: 8.5, x: MARGIN, y: ctx.y });
  ctx.y -= 5;
  regua(ctx, INK, 0.9);
  ctx.y -= 12;
}

function paragrafo(ctx: Ctx, texto: string, size = 7.8): void {
  const linhas = quebrar(texto, ctx.font, size, USABLE);
  garantirEspaco(ctx, linhas.length * (size + 2.6));

  for (const linha of linhas) {
    escrever(ctx, linha, { color: SOFT_TEXT, size, x: MARGIN, y: ctx.y });
    ctx.y -= size + 2.6;
  }
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// BLOCOS
// ────────────────────────────────────────────────────────────────────────────────────────────

async function desenharCabecalho(
  ctx: Ctx,
  relatorio: ExtratoClienteRelatorio,
): Promise<void> {
  const contrato = relatorio.contrato;

  // Título CENTRADO NA PÁGINA (pedido do Lucas, 27/08) — não no espaço que sobra entre a logo e
  // o bloco da direita. O centro é o da folha, então o título fica alinhado com os cartões de
  // total logo abaixo; a logo à esquerda e o empreendimento à direita ficam nas laterais.
  //
  // ⚠️ NOME LONGO DO EMPREENDIMENTO QUEBRA EM DUAS LINHAS, NÃO É CORTADO. Com o título no centro
  // sobram ~90pt à direita, e "CONDOMINIO RECANTO DO PARA" (73 contratos vivos) virava
  // "CONDOMINIO RECA…" no papel do cliente. A régua está em `cabecalhoComBlocoADireita`.
  await cabecalhoComBlocoADireita(ctx, {
    destaque: contrato.empreendimentoNome ?? contrato.empreendimentoCodigo,
    linhas: [
      descreverUnidade(relatorio),
      ...(contrato.area ? [`Área ${formatarArea(contrato.area)} m²`] : []),
    ],
    subtitulo: `Posição em ${dataBr(relatorio.posicaoEm)}`,
    titulo: TITULO_DA_PECA,
  });
}

function desenharFicha(ctx: Ctx, relatorio: ExtratoClienteRelatorio): void {
  const contrato = relatorio.contrato;
  const titulares = contrato.titulares.length
    ? contrato.titulares
        .map((titular) =>
          titular.documentoMascarado
            ? `${titular.nome} (${titular.documentoMascarado})`
            : titular.nome,
        )
        .join("  |  ")
    : "-";

  campoEmDestaque(ctx, contrato.titulares.length > 1 ? "Titulares" : "Titular", titulares);

  // ⚠️ AS COLUNAS TÊM LARGURAS DIFERENTES, e não a mesma. Com o quarto para cada uma, o plano saía
  // cortado — "60x - IPCA ANUAL - juros 8..." — justamente depois de ganhar a informação que
  // faltava. Uma data ocupa dez caracteres e o plano ocupa trinta e cinco: dividir igual é o que
  // fez o campo mais informativo ser o único a não caber.
  linhaDeCampos(ctx, [
    { peso: 0.2, rotulo: "Contrato / unidade", valor: contrato.codigo },
    { peso: 0.15, rotulo: "Data do ato", valor: dataBr(contrato.dataAto) },
    { peso: 0.42, rotulo: "Plano", valor: descricaoDoPlano(contrato) },
    // Vocabulário do comprador, não o estágio interno da venda ("Faturado", "Em assinatura").
    { peso: 0.23, rotulo: "Situação", valor: situacaoParaOComprador(contrato) },
  ]);

  if (contrato.encerrado) {
    // Tarja escura: quem lê a peça precisa saber, antes dos números, que não há mais contrato.
    garantirEspaco(ctx, 30);
    ctx.page.drawRectangle({
      color: DARK_BAND,
      height: 20,
      width: USABLE,
      x: MARGIN,
      y: ctx.y - 20,
    });
    escrever(
      ctx,
      `Contrato ${situacaoParaOComprador(contrato).toUpperCase()}. Este extrato reflete apenas os valores já pagos.`,
      { color: rgb(1, 1, 1), font: ctx.bold, size: 8, x: MARGIN + 10, y: ctx.y - 13.5 },
    );
    ctx.y -= 30;
  }
}

/**
 * O plano em uma linha: parcelamento, correção e juros.
 *
 * ⚠️ ANTES SAÍA SÓ O PARCELAMENTO, E VINHA DO MOLDE. O extrato do TIAGO EUSTAQUIO (LOS0302)
 * estampava "144x - IPCA ANUAL" no topo e "27 de 62 parcelas quitadas" logo abaixo: o 144 era o
 * `commercial_plans.parcels`, que descreve o produto que a mesa vende, e o 62 era o contrato dele.
 * Dois números na mesma página, discordando, num documento que vai para o cliente.
 *
 * ⚠️ OS TRÊS JUNTOS PORQUE UM SÓ NÃO SE CONFERE. Pedido do Lucas (02/09/2026): *"vamos trazer isso
 * para todos, assim não tem como errado (...) parcelamento - correção - juros"*. Com o
 * parcelamento sozinho, um número errado passa; com os três, quem lê reconhece o próprio contrato.
 *
 * ⚠️ E O PERSONALIZADO É DITO, NÃO ESCONDIDO. 428 contratos têm `custom_commercial_plan = 1` — o
 * plano comercial foi ponto de partida, não descrição. Quando o parcelamento do contrato difere do
 * plano, os dois aparecem: some com o do plano e o cliente que ligar perguntando "meu plano não era
 * de 144?" não encontra a resposta em lugar nenhum.
 */
export function descricaoDoPlano(contrato: ExtratoClienteContrato): string {
  const partes: string[] = [];

  // ⚠️ O QUE ESTÁ NO SISTEMA HOJE, e só isso. Decisão do Lucas (02/09/2026). Cheguei a mostrar
  // também o parcelamento do plano de origem nos contratos ajustados ("60x (plano de 144x)"), e
  // ele cortou: o extrato é do contrato que vale agora, e um segundo número entre parênteses é
  // exatamente o tipo de coisa que faz o cliente perguntar qual dos dois é o dele.
  if (contrato.planoParcelas) partes.push(`${contrato.planoParcelas}x`);
  if (contrato.indiceCorrecao) partes.push(contrato.indiceCorrecao);
  // ⚠️ A UNIDADE DO JURO NÃO É SEMPRE ANUAL, e escrever "a.a." fixo errava em 853 dos contratos
  // com juros (662 clientes, 594 com contrato vivo) — num documento que vai para a mão do
  // comprador. Foi o Lucas quem viu, na ficha da unidade do Hércules: *"acho que esse juros é ao
  // mês não?"*. O `contractual_interest` do C2X guarda 8.0000 ao ano na Lavra do Ouro e 0.7207 ao
  // mês em outro produto, a mesma taxa econômica de dois jeitos; a régua do corte é a do cadastro
  // de planos, importada e não copiada.
  if (typeof contrato.jurosContratuais === "number" && contrato.jurosContratuais > 0) {
    const unidade = periodicidadeDaTaxa(contrato.jurosContratuais) === "anual" ? "a.a." : "a.m.";
    partes.push(`juros ${porcentagem(contrato.jurosContratuais)} ${unidade}`);
  }

  return partes.length > 0 ? partes.join(" · ") : "-";
}

/** `8` → `8%`; `8.5` → `8,5%`. */
function porcentagem(valor: number): string {
  return `${valor.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
}

function desenharNumeros(ctx: Ctx, relatorio: ExtratoClienteRelatorio): void {
  const { contrato, totais } = relatorio;

  const caixas: Cartao[] = [
    {
      apoio: totais.parcelasTotal
        ? `${totais.parcelasPagas} de ${contarParcelas(totais.parcelasTotal)} quitadas`
        : "Nenhum pagamento registrado",
      icone: "moeda",
      rotulo: "Total já pago",
      valor: dinheiro(totais.totalPago),
    },
  ];

  if (!contrato.encerrado) {
    caixas.push({
      apoio:
        totais.mensalidadeVigente > 0
          ? `${contarParcelas(totais.parcelasAbertas)} em aberto - vigente ${dinheiro(totais.mensalidadeVigente)}`
          : `${contarParcelas(totais.parcelasAbertas)} em aberto`,
      icone: "saldo",
      rotulo: "Saldo devedor (a valor de hoje)",
      valor: dinheiro(totais.saldoAValorDeHoje),
    });

    caixas.push(
      totais.vencidasQuantidade > 0
        ? {
            apoio: `${contarParcelas(totais.vencidasQuantidade)} - mais antiga em ${dataBr(totais.vencidaMaisAntiga)}`,
            icone: "alerta",
            rotulo: "Em atraso (valores originais)",
            valor: dinheiro(totais.vencidasTotal),
          }
        : {
            apoio: totais.proximoVencimento
              ? `Vence em ${dataBr(totais.proximoVencimento.vencimento)}`
              : "Nenhuma parcela a vencer",
            icone: "relogio",
            rotulo: "Próximo vencimento",
            valor: totais.proximoVencimento
              ? dinheiro(totais.proximoVencimento.valor)
              : "-",
          },
    );
  }

  desenharCartoes(ctx, caixas);

  // O saldo NOMINAL vem impresso SEMPRE QUE DIFERE do saldo a valor de hoje: é o número que
  // consta no contrato e o cliente vai conferir. Fica como linha secundária, com o nome certo,
  // para não competir com o número que ele vai usar. Quando não há defasagem os dois são o mesmo
  // e repetir só polui a peça.
  if (!contrato.encerrado && totais.saldoNominal > 0 && totais.defasagem > 0) {
    escrever(ctx, "Saldo pelos valores originais de contrato", {
      color: MUTE,
      size: 7.4,
      x: MARGIN,
      y: ctx.y,
    });
    escreverDireita(ctx, dinheiro(totais.saldoNominal), {
      color: SOFT_TEXT,
      direita: A4.w - MARGIN,
      font: ctx.bold,
      size: 7.8,
      y: ctx.y,
    });
    ctx.y -= 12;
  }
}

function linhaDeParcela(parcela: ExtratoClienteParcela, pago: boolean): string[] {
  const base = [
    pago ? dataBr(parcela.pagamento) : dataBr(parcela.vencimento),
    parcela.tipo,
    parcela.numero,
    parcela.competencia ?? "-",
    pago ? dataBr(parcela.vencimento) : `${parcela.diasAtraso} dias`,
  ];
  if (!pago) return [...base, dinheiro(parcela.valorContratual)];

  // ⚠️ DUAS COLUNAS, E NÃO UMA CONTA. O C2X guarda o valor da parcela (`initial_value`) e o total
  // recebido (`paid_value`), mas NÃO guarda a composição: medido no banco inteiro, `mulct_value` é
  // zero nas 15.655 parcelas pagas e 5.153 das que pagaram a mais não têm juros registrados.
  //
  // Escrever "juros R$ 0,00" para quem pagou R$ 11,45 de juros seria mentir com cara de precisão.
  // Mostrando os dois lado a lado, a diferença fica VISÍVEL sem que o extrato afirme o que ela é —
  // e quando são iguais, o cliente lê num relance que não pagou acréscimo. Decisão do Lucas
  // (01/09/2026): "no campo valor de parcela deixamos o valor real daquela parcela, que pode ser o
  // valor total ou não".
  return [...base, dinheiro(parcela.valorContratual), dinheiro(parcela.valorPago ?? 0)];
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// MONTAGEM
// ────────────────────────────────────────────────────────────────────────────────────────────

/** Monta o PDF de UM contrato (ou de vários, um por página) e devolve os bytes. */
export async function montarExtratoClientePdf(
  data: ExtratoClienteData,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle(
    `Extrato de pagamentos - ${data.cliente.nome ?? "cliente"} - ${dataBr(data.posicaoEm)}`,
  );
  doc.setProducer("Careli");
  doc.setCreator("Careli");

  const ctx: Ctx = { bold, doc, font, page: doc.addPage([A4.w, A4.h]), y: A4.h - MARGIN };

  if (!data.contratos.length) {
    escrever(ctx, "Não há contrato com parcelas registradas para este cliente.", {
      color: MUTE,
      size: 9,
      x: MARGIN,
      y: ctx.y - 20,
    });
    return doc.save();
  }

  // Mais de um lote: abre com o consolidado. É a resposta à primeira pergunta de quem tem
  // vários contratos ("quanto eu devo no total?"), que 12 páginas de detalhe não respondem.
  const temResumo = data.contratos.length > 1;
  if (temResumo) {
    await desenharResumoConsolidado(ctx, data);
  }

  for (let indice = 0; indice < data.contratos.length; indice += 1) {
    // Cada contrato começa numa página: o cliente costuma repassar o extrato de UM lote.
    if (indice > 0 || temResumo) {
      novaPagina(ctx);
    }

    await desenharContrato(ctx, data.contratos[indice]!);
  }

  desenharRodapes(doc, font, data);

  return doc.save();
}

/**
 * FOLHA DE ROSTO de quem tem mais de um lote. Sem ela o cliente com 6 contratos recebe 12
 * páginas e nenhuma responde "quanto eu devo no total", que é a primeira pergunta dele.
 *
 * Só os totais e a lista dos lotes: o detalhe de cada um vem nas páginas seguintes.
 */
async function desenharResumoConsolidado(
  ctx: Ctx,
  data: ExtratoClienteData,
): Promise<void> {
  const contratos = data.contratos;
  const vivos = contratos.filter((relatorio) => !relatorio.contrato.encerrado);

  const soma = (pegar: (relatorio: ExtratoClienteRelatorio) => number, lista = contratos) =>
    lista.reduce((total, relatorio) => total + pegar(relatorio), 0);

  const totalPago = soma((r) => r.totais.totalPago);
  const saldo = soma((r) => r.totais.saldoAValorDeHoje, vivos);
  const saldoNominal = soma((r) => r.totais.saldoNominal, vivos);
  const emAtraso = soma((r) => r.totais.vencidasTotal, vivos);
  const parcelasPagas = soma((r) => r.totais.parcelasPagas);
  const parcelasAbertas = soma((r) => r.totais.parcelasAbertas, vivos);
  const parcelasVencidas = soma((r) => r.totais.vencidasQuantidade, vivos);

  // Cabeçalho próprio: a logo, o título e — no lugar do empreendimento — a contagem de lotes.
  // Mesmo cuidado do cabeçalho de contrato: o título está no centro, então o rótulo da direita
  // só pode ocupar o que sobra — senão encosta nele (aconteceu com "RESUMO CONSOLIDADO" inteiro).
  await cabecalhoComBlocoADireita(ctx, {
    destaque: "RESUMO CONSOLIDADO",
    linhas: [`${contratos.length} lotes`],
    subtitulo: `Posição em ${dataBr(data.posicaoEm)}`,
    titulo: TITULO_DA_PECA,
  });
  const direita = A4.w - MARGIN;

  // Titular: aqui é o do cliente, não o do contrato (pode variar de lote para lote).
  escrever(ctx, "TITULAR", { color: MUTE, font: ctx.bold, size: 6, x: MARGIN, y: ctx.y });
  ctx.y -= 11;
  const titular = data.cliente.documentoMascarado
    ? `${data.cliente.nome ?? "-"} (${data.cliente.documentoMascarado})`
    : (data.cliente.nome ?? "-");
  escrever(ctx, encurtar(titular, ctx.bold, 10, USABLE), {
    color: INK,
    font: ctx.bold,
    size: 10,
    x: MARGIN,
    y: ctx.y,
  });
  ctx.y -= 22;

  // Os mesmos três cartões do extrato de um lote, agora somando todos.
  const caixas: Cartao[] = [
    {
      apoio: `${contarParcelas(parcelasPagas)} quitadas em ${contratos.length} lotes`,
      icone: "moeda",
      rotulo: "Total já pago (todos os lotes)",
      valor: dinheiro(totalPago),
    },
    {
      apoio: `${contarParcelas(parcelasAbertas)} em aberto`,
      icone: "saldo",
      rotulo: "Saldo devedor total (a valor de hoje)",
      valor: dinheiro(saldo),
    },
    parcelasVencidas > 0
      ? {
          apoio: `${contarParcelas(parcelasVencidas)} em atraso`,
          icone: "alerta",
          rotulo: "Em atraso (valores originais)",
          valor: dinheiro(emAtraso),
        }
      : {
          apoio: "Nenhuma parcela em atraso",
          icone: "relogio",
          rotulo: "Situação",
          valor: "Em dia",
        },
  ];

  const gap = 10;
  const colW = (USABLE - gap * (caixas.length - 1)) / caixas.length;
  const altura = 62;
  const topoDosCartoes = ctx.y;

  caixas.forEach((caixa, indice) => {
    const x = MARGIN + indice * (colW + gap);
    ctx.page.drawRectangle({
      borderColor: LINE,
      borderWidth: 0.7,
      color: BAND,
      height: altura,
      width: colW,
      x,
      y: topoDosCartoes - altura,
    });
    desenharIcone(ctx, caixa.icone, x + 12, topoDosCartoes - 22);
    escrever(ctx, caixa.rotulo.toUpperCase(), {
      color: MUTE,
      font: ctx.bold,
      size: 5.8,
      x: x + 12,
      y: topoDosCartoes - 33,
    });
    escrever(ctx, caixa.valor, {
      color: INK,
      font: ctx.bold,
      size: 15,
      x: x + 12,
      y: topoDosCartoes - 50,
    });
    escrever(ctx, encurtar(caixa.apoio, ctx.font, 6.6, colW - 24), {
      color: MUTE,
      size: 6.6,
      x: x + 12,
      y: topoDosCartoes - 58,
    });
  });

  ctx.y = topoDosCartoes - altura - 6;

  if (saldoNominal > 0 && Math.abs(saldo - saldoNominal) > 0.5) {
    escrever(ctx, "Saldo pelos valores originais de contrato", {
      color: MUTE,
      size: 6.8,
      x: MARGIN,
      y: ctx.y,
    });
    escreverDireita(ctx, dinheiro(saldoNominal), {
      color: MUTE,
      direita,
      font: ctx.bold,
      size: 6.8,
      y: ctx.y,
    });
    ctx.y -= 14;
  }

  ctx.y -= 4;
  paragrafo(
    ctx,
    "O detalhamento de cada lote (pagamentos realizados, reajustes aplicados e parcelas em aberto) vem nas páginas seguintes, um lote por vez.",
  );
  ctx.y -= 6;

  tituloDeSecao(ctx, `Lotes deste cliente (${contratos.length})`);
  desenharTabelaLimpa(ctx, {
    colunas: [
      { align: "left", label: "Lote", peso: 0.14 },
      { align: "left", label: "Empreendimento", peso: 0.3 },
      { align: "left", label: "Situação", peso: 0.16 },
      { align: "right", label: "Já pago", peso: 0.2 },
      { align: "right", label: "Saldo devedor", peso: 0.2 },
    ],
    linhas: contratos.map((relatorio) => [
      relatorio.contrato.codigo,
      encurtar(
        relatorio.contrato.empreendimentoNome ?? relatorio.contrato.empreendimentoCodigo,
        ctx.font,
        8,
        USABLE * 0.3 - 8,
      ),
      relatorio.contrato.encerrado
        ? (relatorio.contrato.estagioNome ?? "Encerrado")
        : relatorio.totais.vencidasQuantidade > 0
          ? `${relatorio.totais.vencidasQuantidade} em atraso`
          : "Em dia",
      dinheiro(relatorio.totais.totalPago),
      relatorio.contrato.encerrado ? "-" : dinheiro(relatorio.totais.saldoAValorDeHoje),
    ]),
    total: ["Total", "", "", dinheiro(totalPago), dinheiro(saldo)],
    vazio: "Nenhum lote.",
  });
}

async function desenharContrato(
  ctx: Ctx,
  relatorio: ExtratoClienteRelatorio,
): Promise<void> {
  await desenharCabecalho(ctx, relatorio);
  desenharFicha(ctx, relatorio);
  desenharNumeros(ctx, relatorio);

  // As ressalvas ficam colocadas AQUI, logo abaixo dos números, e não no rodapé: é o número
  // grande que precisa vir acompanhado do que ele não cobre.
  ctx.y -= 6;
  for (const nota of relatorio.notas) {
    paragrafo(ctx, nota);
  }
  ctx.y -= 4;

  const eventos = relatorio.eventos.filter((evento) => evento.tipo !== "fronteira");
  if (eventos.length) {
    tituloDeSecao(ctx, "Reajustes e alterações de valor aplicados");
    for (const evento of eventos) {
      const linhas = quebrar(evento.rotulo, ctx.font, 7.8, USABLE - 12);
      garantirEspaco(ctx, linhas.length * 10.4 + 4);
      linhas.forEach((linha, indice) => {
        if (indice === 0) {
          ctx.page.drawCircle({ borderWidth: 0, color: INK, size: 1.5, x: MARGIN + 2, y: ctx.y + 2.6 });
        }
        escrever(ctx, linha, { color: TEXT, size: 7.8, x: MARGIN + 12, y: ctx.y });
        ctx.y -= 10.4;
      });
      ctx.y -= 2;
    }
  }

  const vencidas = relatorio.abertas.filter((parcela) => parcela.situacao === "vencida");
  if (vencidas.length) {
    tituloDeSecao(ctx, `Parcelas em atraso (${vencidas.length})`);
    desenharTabelaLimpa(ctx, {
      colunas: [
        { label: "Vencimento", peso: 0.15 },
        { label: "Tipo", peso: 0.14 },
        { label: "Parcela", peso: 0.12 },
        { label: "Competência", peso: 0.16 },
        { label: "Atraso", peso: 0.15 },
        { align: "right", label: "Valor original", peso: 0.28 },
      ],
      linhas: vencidas.map((parcela) => linhaDeParcela(parcela, false)),
      total: ["Total em atraso", "", "", "", "", dinheiro(relatorio.totais.vencidasTotal)],
      vazio: "Nenhuma parcela em atraso.",
    });
    paragrafo(
      ctx,
      "Os valores acima não incluem juros e multa, que são calculados no momento do pagamento.",
      7,
    );
  }

  tituloDeSecao(ctx, `Pagamentos realizados (${relatorio.realizados.length})`);
  // "Pago em" em vez de "Pagamento": o rótulo antigo se lia como FORMA de pagamento, e a coluna
  // sempre trouxe a DATA. Os pesos somam 1 e foram reequilibrados para caber a coluna nova.
  desenharTabelaLimpa(ctx, {
    colunas: [
      { label: "Pago em", peso: 0.14 },
      { label: "Tipo", peso: 0.12 },
      { label: "Parcela", peso: 0.11 },
      { label: "Competência", peso: 0.14 },
      { label: "Vencimento", peso: 0.14 },
      { align: "right", label: "Valor da parcela", peso: 0.175 },
      { align: "right", label: "Total pago", peso: 0.175 },
    ],
    linhas: relatorio.realizados.map((parcela) => linhaDeParcela(parcela, true)),
    // "Totais", e não "Total pago": com DUAS somas no rodapé, o rótulo antigo ficava à esquerda
    // do total CONTRATUAL e dizia que aqueles R$ 2.904.120,19 foram pagos — quando o que o
    // cliente pagou é o número da última coluna. Cada soma se identifica pelo cabeçalho da sua
    // coluna; o rótulo da linha só diz que ali termina a tabela.
    total: [
      "Totais",
      "",
      "",
      "",
      "",
      dinheiro(relatorio.totais.totalContratualPago),
      dinheiro(relatorio.totais.totalPago),
    ],
    vazio: "Nenhum pagamento registrado até a data desta posição.",
  });

  // A frase só aparece quando há diferença — dizer "R$ 0,00 de acréscimo" em contrato em dia é
  // ruído, e pior, planta a dúvida de que houve cobrança extra.
  const acrescimos =
    Math.round((relatorio.totais.totalPago - relatorio.totais.totalContratualPago) * 100) / 100;
  if (acrescimos > 0.01) {
    paragrafo(
      ctx,
      // ⚠️ NÃO DIZER "acréscimo por atraso" AQUI. Medido no banco em 01/09/2026: das 5.171 parcelas
      // pagas acima do valor de contrato sem juros classificados, 1.419 (R$ 169.480,68) foram
      // pagas EM DIA — a diferença ali é REAJUSTE que não foi gravado na parcela (o `initial_value`
      // do legado envelhece), média de 6,46%, e não mora. Escrever "multa" no extrato de quem pagou
      // no prazo é pior que a coluna em branco de ontem. A frase descreve o FATO (os dois valores
      // diferem) e não a CAUSA, que só se sabe parcela a parcela.
      `A diferença entre o valor das parcelas e o total pago é de ${dinheiro(acrescimos)}. Ela pode corresponder a reajuste do contrato ou a encargos de pagamento fora do vencimento; a apuração é feita em cada pagamento.`,
      7,
    );
  } else if (acrescimos < -0.01) {
    paragrafo(
      ctx,
      `Em algumas parcelas o valor recebido foi inferior ao valor da parcela, somando ${dinheiro(Math.abs(acrescimos))}. Consulte a central de atendimento para o detalhamento.`,
      7,
    );
  }

  if (!relatorio.contrato.encerrado && relatorio.abertas.length) {
    const anos = resumoPorAno(relatorio.abertas);
    tituloDeSecao(ctx, `Parcelas em aberto por ano (${relatorio.abertas.length})`);
    desenharTabelaLimpa(ctx, {
      colunas: [
        { label: "Ano", peso: 0.22 },
        { label: "Parcelas", peso: 0.2 },
        { align: "right", label: "Valores originais", peso: 0.29 },
        { align: "right", label: "A valor de hoje", peso: 0.29 },
      ],
      linhas: anos.map((linha) => [
        linha.ano,
        String(linha.quantidade),
        dinheiro(linha.nominal),
        dinheiro(linha.atualizado),
      ]),
      total: [
        "Saldo devedor",
        String(relatorio.totais.parcelasAbertas),
        dinheiro(relatorio.totais.saldoNominal),
        dinheiro(relatorio.totais.saldoAValorDeHoje),
      ],
      vazio: "Nenhuma parcela em aberto.",
    });

    if (relatorio.totais.defasagem > 0) {
      paragrafo(
        ctx,
        `A coluna "a valor de hoje" traz as parcelas que ainda não tiveram boleto emitido para a parcela vigente de ${dinheiro(relatorio.totais.mensalidadeVigente)} (${percentualSimples(relatorio.totais.defasagem)} acima do valor original de ${dinheiro(relatorio.totais.mensalidadeBase)}). Nenhum reajuste futuro foi projetado.`,
        7,
      );
    }
  }
}

function desenharRodapes(
  doc: PDFDocument,
  font: PDFFont,
  data: ExtratoClienteData,
): void {
  const paginas = doc.getPages();

  paginas.forEach((pagina, indice) => {
    pagina.drawLine({
      color: LINE,
      end: { x: A4.w - MARGIN, y: FOOT + 4 },
      start: { x: MARGIN, y: FOOT + 4 },
      thickness: 0.7,
    });

    const esquerda = limpar(
      `Documento emitido pela Careli em ${dataBr(data.posicaoEm)} · valores sujeitos à conferência com o contrato.`,
    );
    pagina.drawText(esquerda, { color: MUTE, font, size: 6.6, x: MARGIN, y: FOOT - 8 });

    const direita = `${indice + 1}/${paginas.length}`;
    const largura = font.widthOfTextAtSize(direita, 6.6);
    pagina.drawText(direita, {
      color: MUTE,
      font,
      size: 6.6,
      x: A4.w - MARGIN - largura,
      y: FOOT - 8,
    });
  });
}

function descreverUnidade(relatorio: ExtratoClienteRelatorio): string {
  const { codigo, lote, quadra } = relatorio.contrato;
  const partes: string[] = [];

  if (quadra) partes.push(`Quadra ${quadra}`);
  if (lote) partes.push(`Lote ${lote}`);

  return partes.length ? `${partes.join(", ")} (${codigo})` : codigo;
}

function formatarArea(area: number): string {
  return new Intl.NumberFormat("pt-BR", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(area);
}

/** Nome do arquivo: "Extrato - <cliente> - <unidade> - dd-mm-aaaa.pdf". */
export function nomeDoArquivoExtrato(data: ExtratoClienteData): string {
  const cliente = (data.cliente.nome ?? "Cliente").trim();
  const unidade =
    data.contratos.length === 1
      ? data.contratos[0]?.contrato.codigo
      : `${data.contratos.length} contratos`;
  const dia = dataBr(data.posicaoEm).replace(/\//g, "-");

  return sanitizarNome(`Extrato - ${cliente} - ${unidade ?? "-"} - ${dia}.pdf`);
}

/** Tira o que quebra `Content-Disposition` / nome de arquivo no Windows. */
function sanitizarNome(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(new RegExp("[\u0300-\u036f]", "g"), "")
    .replace(/[\\/:*?"<>|\r\n]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
