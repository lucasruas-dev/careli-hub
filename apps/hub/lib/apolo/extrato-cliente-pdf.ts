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

import { CARELI_LOGO_PNG_BASE64 } from "@/lib/apolo/careli-logo";
import {
  contarParcelas,
  dataBr,
  dinheiro,
  percentualSimples,
  resumoPorAno,
  situacaoParaOComprador,
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

type Coluna = {
  /** Alinhamento do conteúdo (números sempre à direita). */
  align?: "left" | "right";
  label: string;
  /** Fração de `USABLE`. A soma das frações deve dar 1. */
  peso: number;
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

/**
 * Cabe numa linha? Devolve uma. Não cabe? Quebra em DUAS, no espaço, preferindo o corte que
 * deixa as duas metades mais parecidas. Se nem assim couber, encolhe a fonte (até 7,5) e, no
 * limite, corta com reticências — mas isso só acontece com uma palavra única gigante.
 *
 * Existe porque cortar o nome do empreendimento no papel do cliente ("CONDOMINIO RECA…") é pior
 * do que usar duas linhas.
 */
function quebrarEmDuasLinhas(
  texto: string,
  font: PDFFont,
  size: number,
  maxW: number,
): { linhas: string[]; size: number } {
  const limpo = limpar(texto);

  for (const tamanho of [size, size - 1, size - 2]) {
    if (font.widthOfTextAtSize(limpo, tamanho) <= maxW) {
      return { linhas: [limpo], size: tamanho };
    }

    const palavras = limpo.split(/\s+/).filter(Boolean);
    if (palavras.length < 2) continue;

    let melhor: null | string[] = null;
    let melhorDiferenca = Infinity;

    for (let corte = 1; corte < palavras.length; corte++) {
      const a = palavras.slice(0, corte).join(" ");
      const b = palavras.slice(corte).join(" ");
      const larguraA = font.widthOfTextAtSize(a, tamanho);
      const larguraB = font.widthOfTextAtSize(b, tamanho);
      if (larguraA > maxW || larguraB > maxW) continue;

      const diferenca = Math.abs(larguraA - larguraB);
      if (diferenca < melhorDiferenca) {
        melhorDiferenca = diferenca;
        melhor = [a, b];
      }
    }

    if (melhor) return { linhas: melhor, size: tamanho };
  }

  return { linhas: [encurtar(limpo, font, size - 2, maxW)], size: size - 2 };
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
// ÍCONES — vetores mínimos, sem fonte de ícone. A regra da casa é "ícone acima do rótulo"; o
// que se ganha aqui é a leitura em varredura dos três números, não decoração.
// ────────────────────────────────────────────────────────────────────────────────────────────

type IconeTipo = "alerta" | "moeda" | "relogio" | "saldo";

function desenharIcone(ctx: Ctx, tipo: IconeTipo, x: number, y: number): void {
  const cor = INK;

  if (tipo === "moeda") {
    // Círculo cheio: o dinheiro que ENTROU.
    ctx.page.drawCircle({ borderWidth: 0, color: cor, size: 4, x: x + 4, y: y + 4 });
    return;
  }

  if (tipo === "saldo") {
    // Anel: o que ainda falta.
    ctx.page.drawCircle({
      borderColor: cor,
      borderWidth: 1.3,
      size: 4,
      x: x + 4,
      y: y + 4,
    });
    return;
  }

  if (tipo === "alerta") {
    // Triângulo (três linhas) + o pingo do "!".
    const pontos: Array<[number, number]> = [
      [x + 4, y + 8.4],
      [x + 8.4, y + 0.6],
      [x - 0.4, y + 0.6],
    ];
    for (let i = 0; i < pontos.length; i += 1) {
      const inicio = pontos[i]!;
      const fim = pontos[(i + 1) % pontos.length]!;
      ctx.page.drawLine({
        color: cor,
        end: { x: fim[0], y: fim[1] },
        start: { x: inicio[0], y: inicio[1] },
        thickness: 1.1,
      });
    }
    ctx.page.drawLine({
      color: cor,
      end: { x: x + 4, y: y + 5.6 },
      start: { x: x + 4, y: y + 2.6 },
      thickness: 1.1,
    });
    return;
  }

  // Relógio: anel + dois ponteiros.
  ctx.page.drawCircle({ borderColor: cor, borderWidth: 1.1, size: 4.2, x: x + 4, y: y + 4 });
  ctx.page.drawLine({
    color: cor,
    end: { x: x + 4, y: y + 6.6 },
    start: { x: x + 4, y: y + 4 },
    thickness: 1,
  });
  ctx.page.drawLine({
    color: cor,
    end: { x: x + 6.4, y: y + 4 },
    start: { x: x + 4, y: y + 4 },
    thickness: 1,
  });
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// BLOCOS
// ────────────────────────────────────────────────────────────────────────────────────────────

async function desenharCabecalho(
  ctx: Ctx,
  relatorio: ExtratoClienteRelatorio,
): Promise<void> {
  const topo = ctx.y;
  let colunaTexto = MARGIN;

  // Best-effort de propósito: sem a marca o extrato ainda é entregável; sem o extrato, não.
  try {
    const logo = await ctx.doc.embedPng(Buffer.from(CARELI_LOGO_PNG_BASE64, "base64"));
    const largura = 40;
    const altura = (logo.height / logo.width) * largura;
    ctx.page.drawImage(logo, {
      height: altura,
      width: largura,
      x: MARGIN,
      y: topo - altura,
    });
    colunaTexto = MARGIN + largura + 16;
  } catch {
    // sem logo: o título assume a margem.
  }

  const contrato = relatorio.contrato;

  // Título CENTRADO NA PÁGINA (pedido do Lucas, 27/08) — não no espaço que sobra entre a logo e
  // o bloco da direita. O centro é o da folha, então o título fica alinhado com os cartões de
  // total logo abaixo; a logo à esquerda e o empreendimento à direita ficam nas laterais.
  const larguraDoTitulo = ctx.bold.widthOfTextAtSize(limpar(TITULO_DA_PECA), 14);
  const inicioDoTitulo = Math.max(colunaTexto, (A4.w - larguraDoTitulo) / 2);

  escrever(ctx, TITULO_DA_PECA, {
    color: INK,
    font: ctx.bold,
    size: 14,
    x: inicioDoTitulo,
    y: topo - 14,
  });

  // A data acompanha o título: centrada no MESMO eixo dele, não na margem da logo.
  const subtitulo = `Posição em ${dataBr(relatorio.posicaoEm)}`;
  escrever(ctx, subtitulo, {
    color: MUTE,
    size: 8.5,
    x:
      inicioDoTitulo +
      (larguraDoTitulo - ctx.font.widthOfTextAtSize(limpar(subtitulo), 8.5)) / 2,
    y: topo - 27,
  });

  // ⚠️ O NOME DO EMPREENDIMENTO PRECISA CABER NO QUE SOBRA. Com o título centrado ele termina
  // por volta de x=432, e um nome longo ("ALDEIA DAS CACHOEIRAS DAS PEDRAS") encostaria nele —
  // por isso o espaço livre é medido a partir do fim REAL do título, com folga, e o nome é
  // encurtado para caber.
  const direita = A4.w - MARGIN;
  const fimDoTitulo = inicioDoTitulo + larguraDoTitulo + 18;
  const espacoDoEmpreendimento = Math.max(60, direita - fimDoTitulo);

  // ⚠️ NOME LONGO QUEBRA EM DUAS LINHAS, NÃO É CORTADO. Com o título no centro sobram ~90pt à
  // direita, e "CONDOMINIO RECANTO DO PARA" (73 contratos vivos) virava "CONDOMINIO RECA…" no
  // papel do cliente. Aqui ele desce para a segunda linha, e só encolhe a fonte se as duas
  // linhas ainda não couberem.
  const nomeEmpreendimento =
    contrato.empreendimentoNome ?? contrato.empreendimentoCodigo;
  const { linhas: linhasDoNome, size: sizeDoNome } = quebrarEmDuasLinhas(
    nomeEmpreendimento,
    ctx.bold,
    9.5,
    espacoDoEmpreendimento,
  );

  let yDireita = topo - 13;
  for (const linha of linhasDoNome) {
    escreverDireita(ctx, linha, {
      color: INK,
      direita,
      font: ctx.bold,
      size: sizeDoNome,
      y: yDireita,
    });
    yDireita -= sizeDoNome + 2.5;
  }

  escreverDireita(ctx, descreverUnidade(relatorio), {
    color: TEXT,
    direita,
    size: 8.5,
    y: yDireita - 1,
  });
  yDireita -= 11;

  if (contrato.area) {
    escreverDireita(ctx, `Área ${formatarArea(contrato.area)} m²`, {
      color: MUTE,
      direita,
      size: 8,
      y: yDireita - 1,
    });
    yDireita -= 11;
  }

  // O cabeçalho termina embaixo do que for mais alto: a coluna da direita (que cresce com o
  // nome quebrado) ou o bloco do título.
  ctx.y = Math.min(topo - 58, yDireita - 8);
  regua(ctx, INK, 1.4);
  ctx.y -= 16;
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

  campoLargo(ctx, contrato.titulares.length > 1 ? "Titulares" : "Titular", titulares);

  const campos: Array<[string, string]> = [
    ["Contrato / unidade", contrato.codigo],
    ["Data do ato", dataBr(contrato.dataAto)],
    [
      "Plano",
      contrato.planoParcelas
        ? `${contrato.planoParcelas}x${contrato.indiceCorrecao ? ` - ${contrato.indiceCorrecao}` : ""}`
        : (contrato.indiceCorrecao ?? "-"),
    ],
    // Vocabulário do comprador, não o estágio interno da venda ("Faturado", "Em assinatura").
    ["Situação", situacaoParaOComprador(contrato)],
  ];

  const colW = USABLE / campos.length;
  garantirEspaco(ctx, 24);
  const topo = ctx.y;

  campos.forEach(([rotulo, valor], indice) => {
    const x = MARGIN + indice * colW;
    escrever(ctx, rotulo.toUpperCase(), { color: MUTE, font: ctx.bold, size: 5.8, x, y: topo });
    escrever(ctx, encurtar(valor || "-", ctx.bold, 8.5, colW - 8), {
      color: TEXT,
      font: ctx.bold,
      size: 8.5,
      x,
      y: topo - 11,
    });
  });

  ctx.y = topo - 22;

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

function campoLargo(ctx: Ctx, rotulo: string, valor: string): void {
  const linhas = quebrar(valor, ctx.bold, 9, USABLE);
  garantirEspaco(ctx, 12 + linhas.length * 11);

  escrever(ctx, rotulo.toUpperCase(), {
    color: MUTE,
    font: ctx.bold,
    size: 5.8,
    x: MARGIN,
    y: ctx.y,
  });
  ctx.y -= 11;

  for (const linha of linhas) {
    escrever(ctx, linha, { color: INK, font: ctx.bold, size: 9, x: MARGIN, y: ctx.y });
    ctx.y -= 11;
  }
  ctx.y -= 5;
}

function desenharNumeros(ctx: Ctx, relatorio: ExtratoClienteRelatorio): void {
  const { contrato, totais } = relatorio;

  type Caixa = { apoio: string; icone: IconeTipo; rotulo: string; valor: string };

  const caixas: Caixa[] = [
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

  const gap = 10;
  const colW = (USABLE - gap * (caixas.length - 1)) / caixas.length;
  const altura = 62;

  garantirEspaco(ctx, altura + 8);
  const topo = ctx.y;

  caixas.forEach((caixa, indice) => {
    const x = MARGIN + indice * (colW + gap);

    ctx.page.drawRectangle({
      borderColor: LINE,
      borderWidth: 0.8,
      color: BAND,
      height: altura,
      width: colW,
      x,
      y: topo - altura,
    });

    desenharIcone(ctx, caixa.icone, x + 12, topo - 22);
    escrever(ctx, caixa.rotulo.toUpperCase(), {
      color: SOFT_TEXT,
      font: ctx.bold,
      size: 5.8,
      x: x + 12,
      y: topo - 32,
    });
    escrever(ctx, caixa.valor, {
      color: INK,
      font: ctx.bold,
      size: 15,
      x: x + 12,
      y: topo - 49,
    });
    escrever(ctx, encurtar(caixa.apoio, ctx.font, 6.6, colW - 24), {
      color: MUTE,
      size: 6.6,
      x: x + 12,
      y: topo - 58,
    });
  });

  ctx.y = topo - altura - 10;

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

function desenharTabela(
  ctx: Ctx,
  {
    colunas,
    linhas,
    total,
    vazio,
  }: {
    colunas: Coluna[];
    linhas: string[][];
    total?: string[];
    vazio: string;
  },
): void {
  const larguras = colunas.map((coluna) => coluna.peso * USABLE);
  const xs = larguras.reduce<number[]>((acc, largura, indice) => {
    acc.push(indice === 0 ? MARGIN : (acc[indice - 1] ?? MARGIN) + (larguras[indice - 1] ?? 0));
    return acc;
  }, []);

  const desenharCabecalhoTabela = () => {
    garantirEspaco(ctx, 20);
    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      if (coluna.align === "right") {
        escreverDireita(ctx, coluna.label.toUpperCase(), {
          color: MUTE,
          direita: x + largura,
          font: ctx.bold,
          size: 5.8,
          y: ctx.y,
        });
      } else {
        escrever(ctx, coluna.label.toUpperCase(), {
          color: MUTE,
          font: ctx.bold,
          size: 5.8,
          x,
          y: ctx.y,
        });
      }
    });
    ctx.y -= 5;
    regua(ctx, LINE, 0.7);
    ctx.y -= 10;
  };

  desenharCabecalhoTabela();

  if (!linhas.length) {
    escrever(ctx, vazio, { color: MUTE, size: 7.8, x: MARGIN, y: ctx.y });
    ctx.y -= 12;
    return;
  }

  for (const linha of linhas) {
    if (ctx.y - 12 < FOOT + 16) {
      novaPagina(ctx);
      desenharCabecalhoTabela();
    }

    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      const conteudo = linha[indice] ?? "";
      const size = 7.6;

      if (coluna.align === "right") {
        escreverDireita(ctx, conteudo, {
          color: TEXT,
          direita: x + largura,
          size,
          y: ctx.y,
        });
      } else {
        escrever(ctx, encurtar(conteudo, ctx.font, size, largura - 6), {
          color: TEXT,
          size,
          x,
          y: ctx.y,
        });
      }
    });

    ctx.y -= 11.5;
  }

  if (total) {
    garantirEspaco(ctx, 22);
    ctx.y += 2;
    regua(ctx, LINE, 0.7);
    ctx.y -= 11;

    colunas.forEach((coluna, indice) => {
      const x = xs[indice] ?? MARGIN;
      const largura = larguras[indice] ?? 0;
      const conteudo = total[indice] ?? "";
      if (!conteudo) return;

      if (coluna.align === "right") {
        escreverDireita(ctx, conteudo, {
          color: INK,
          direita: x + largura,
          font: ctx.bold,
          size: 8,
          y: ctx.y,
        });
      } else {
        escrever(ctx, conteudo, { color: INK, font: ctx.bold, size: 8, x, y: ctx.y });
      }
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
  const topo = ctx.y;
  let colunaTexto = MARGIN;

  try {
    const logo = await ctx.doc.embedPng(Buffer.from(CARELI_LOGO_PNG_BASE64, "base64"));
    const largura = 40;
    const altura = (logo.height / logo.width) * largura;
    ctx.page.drawImage(logo, { height: altura, width: largura, x: MARGIN, y: topo - altura });
    colunaTexto = MARGIN + largura + 16;
  } catch {
    // sem logo, o título assume a margem
  }

  const larguraDoTitulo = ctx.bold.widthOfTextAtSize(limpar(TITULO_DA_PECA), 14);
  const inicioDoTitulo = Math.max(colunaTexto, (A4.w - larguraDoTitulo) / 2);
  escrever(ctx, TITULO_DA_PECA, {
    color: INK,
    font: ctx.bold,
    size: 14,
    x: inicioDoTitulo,
    y: topo - 14,
  });

  const subtitulo = `Posição em ${dataBr(data.posicaoEm)}`;
  escrever(ctx, subtitulo, {
    color: MUTE,
    size: 8.5,
    x:
      inicioDoTitulo +
      (larguraDoTitulo - ctx.font.widthOfTextAtSize(limpar(subtitulo), 8.5)) / 2,
    y: topo - 27,
  });

  // Mesmo cuidado do cabeçalho de contrato: o título está no centro, então o rótulo da direita
  // só pode ocupar o que sobra — senão encosta nele (aconteceu com "RESUMO CONSOLIDADO" inteiro).
  const direita = A4.w - MARGIN;
  const espacoDaDireita = Math.max(
    60,
    direita - (inicioDoTitulo + larguraDoTitulo + 18),
  );
  const { linhas: linhasDoRotulo, size: sizeDoRotulo } = quebrarEmDuasLinhas(
    "RESUMO CONSOLIDADO",
    ctx.bold,
    9.5,
    espacoDaDireita,
  );

  let yDireita = topo - 13;
  for (const linha of linhasDoRotulo) {
    escreverDireita(ctx, linha, {
      color: INK,
      direita,
      font: ctx.bold,
      size: sizeDoRotulo,
      y: yDireita,
    });
    yDireita -= sizeDoRotulo + 2.5;
  }

  escreverDireita(ctx, `${contratos.length} lotes`, {
    color: TEXT,
    direita,
    size: 8.5,
    y: yDireita - 1,
  });

  ctx.y = Math.min(topo - 58, yDireita - 19);
  regua(ctx, INK, 1.4);
  ctx.y -= 16;

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
  type Caixa = { apoio: string; icone: IconeTipo; rotulo: string; valor: string };
  const caixas: Caixa[] = [
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
  desenharTabela(ctx, {
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
    desenharTabela(ctx, {
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
  desenharTabela(ctx, {
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
    desenharTabela(ctx, {
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
