// Geracao do CAD como PDF de verdade (pdf-lib), espelhando o layout aprovado
// que o imprimirCad montava em HTML. Roda no browser: monta o documento em
// memoria e baixa o arquivo direto, sem passar pelo dialogo de impressao.

import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  rgb,
} from "pdf-lib";

export type CadCampo = { full?: boolean; label: string; value: string };
export type CadSecao = { fields: CadCampo[]; title: string };

export type CadDoc = {
  // "CAD - Nome - dd/mm/aaaa HH:MM" (vira o nome do arquivo).
  arquivo: string;
  data: string; // dd/mm/aaaa
  hora: string; // HH:MM
  nome: string;
  papel: string; // "Prospect" etc.
  secoes: CadSecao[];
  vinculo: string; // imobiliaria / corretor
};

// Paleta identica ao documento aprovado.
const INK = rgb(0.051, 0.078, 0.11); // #0d141c
const TEXT = rgb(0.118, 0.161, 0.231); // #1e293b
const MUTE = rgb(0.58, 0.639, 0.722); // #94a3b8
const SOFT = rgb(0.886, 0.91, 0.941); // #e2e8f0

const A4 = { h: 841.89, w: 595.28 };
const MARGIN = 48;
const COL_GAP = 22;

// Sanitiza para o WinAnsi das fontes padrao (evita erro com char fora do set).
function clean(value: string): string {
  return (value ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

type Ctx = {
  bold: PDFFont;
  doc: PDFDocument;
  font: PDFFont;
  page: PDFPage;
  y: number;
};

function novaPagina(ctx: Ctx): void {
  ctx.page = ctx.doc.addPage([A4.w, A4.h]);
  ctx.y = A4.h - MARGIN;
}

function garanteEspaco(ctx: Ctx, altura: number): void {
  if (ctx.y - altura < MARGIN) novaPagina(ctx);
}

// Quebra o texto em linhas que cabem na largura.
function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const palavras = clean(text).split(/\s+/).filter(Boolean);
  if (!palavras.length) return [""];
  const linhas: string[] = [];
  let atual = palavras[0] ?? "";
  for (let i = 1; i < palavras.length; i++) {
    const palavra = palavras[i] ?? "";
    const tent = `${atual} ${palavra}`;
    if (font.widthOfTextAtSize(tent, size) <= maxW) atual = tent;
    else {
      linhas.push(atual);
      atual = palavra;
    }
  }
  linhas.push(atual);
  return linhas;
}

function drawLabel(ctx: Ctx, x: number, label: string, size = 6.5): void {
  ctx.page.drawText(clean(label).toUpperCase(), {
    color: MUTE,
    font: ctx.bold,
    size,
    x,
    y: ctx.y,
    ...(letterSpacing(0.5)),
  });
}

// pdf-lib nao tem letter-spacing nativo; retornamos vazio (o visual ja fica fiel
// sem ele). Mantido como helper para clareza.
function letterSpacing(_v: number): Record<string, never> {
  return {} as Record<string, never>;
}

// Desenha um campo (label em cima, valor embaixo) numa coluna de largura colW.
function drawCampo(ctx: Ctx, x: number, colW: number, campo: CadCampo): number {
  const valSize = 9.5;
  const linhas = wrap(campo.value || "-", ctx.font, valSize, colW);
  const altura = 9 /*label*/ + linhas.length * (valSize + 2.5) + 8;
  garanteEspaco(ctx, altura);

  drawLabel(ctx, x, campo.label);
  ctx.y -= 10;
  for (const linha of linhas) {
    ctx.page.drawText(linha || "-", {
      color: TEXT,
      font: ctx.font,
      size: valSize,
      x,
      y: ctx.y,
    });
    ctx.y -= valSize + 2.5;
  }
  ctx.y -= 6;
  return altura;
}

function drawSecao(ctx: Ctx, secao: CadSecao): void {
  const usableW = A4.w - MARGIN * 2;
  const colW = (usableW - COL_GAP) / 2;

  // Titulo da secao.
  garanteEspaco(ctx, 40);
  ctx.y -= 8;
  ctx.page.drawText(clean(secao.title).toUpperCase(), {
    color: INK,
    font: ctx.bold,
    size: 7.5,
    x: MARGIN,
    y: ctx.y,
  });
  ctx.y -= 7;
  ctx.page.drawLine({
    color: SOFT,
    end: { x: A4.w - MARGIN, y: ctx.y },
    start: { x: MARGIN, y: ctx.y },
    thickness: 0.7,
  });
  ctx.y -= 16;

  // Campos em duas colunas (full = ocupa a linha toda).
  let col = 0; // 0 = esquerda, 1 = direita
  let rowTopY = ctx.y;
  let rowMaxDrop = 0;

  const fecharLinha = () => {
    if (col === 1) {
      ctx.y = rowTopY - rowMaxDrop;
      col = 0;
      rowMaxDrop = 0;
      rowTopY = ctx.y;
    }
  };

  for (const campo of secao.fields) {
    if (campo.full) {
      fecharLinha();
      rowTopY = ctx.y;
      // campo full: largura toda.
      const before = ctx.y;
      const linhas = wrap(campo.value || "-", ctx.font, 9.5, usableW);
      garanteEspaco(ctx, 10 + linhas.length * 12 + 8);
      drawLabel(ctx, MARGIN, campo.label);
      ctx.y -= 10;
      for (const linha of linhas) {
        ctx.page.drawText(linha || "-", { color: TEXT, font: ctx.font, size: 9.5, x: MARGIN, y: ctx.y });
        ctx.y -= 12;
      }
      ctx.y -= 6;
      rowTopY = ctx.y;
      void before;
      continue;
    }

    const x = MARGIN + col * (colW + COL_GAP);
    const startY = rowTopY;
    ctx.y = startY;
    const drop = drawCampo(ctx, x, colW, campo);
    rowMaxDrop = Math.max(rowMaxDrop, drop);

    if (col === 0) {
      col = 1;
      ctx.y = startY; // volta pro topo pra desenhar a coluna direita
    } else {
      ctx.y = startY - rowMaxDrop;
      col = 0;
      rowMaxDrop = 0;
      rowTopY = ctx.y;
    }
  }
  fecharLinha();
}

// Monta o PDF em memoria (sem baixar). Node-safe: usado no teste de layout.
export async function montarCadPdf(cad: CadDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(cad.arquivo);

  const ctx: Ctx = { bold, doc, font, page: doc.addPage([A4.w, A4.h]), y: A4.h - MARGIN };

  // ---------- cabecalho ----------
  ctx.page.drawText("Cadastro de CAD", {
    color: INK,
    font: bold,
    size: 17,
    x: MARGIN,
    y: ctx.y - 4,
  });
  // meta a direita (duas linhas).
  const metaRight = (rot: string, val: string, dy: number) => {
    const full = `${rot} ${val}`;
    const w = font.widthOfTextAtSize(full, 8.5);
    const x = A4.w - MARGIN - w;
    ctx.page.drawText(rot + " ", { color: MUTE, font, size: 8.5, x, y: ctx.y - dy });
    const rotW = font.widthOfTextAtSize(rot + " ", 8.5);
    ctx.page.drawText(val, { color: TEXT, font: bold, size: 8.5, x: x + rotW, y: ctx.y - dy });
  };
  metaRight("Enviado em", `${cad.data} as ${cad.hora}`, 0);
  metaRight("Imobiliaria / corretor", cad.vinculo || "-", 14);

  ctx.y -= 26;
  ctx.page.drawLine({
    color: INK,
    end: { x: A4.w - MARGIN, y: ctx.y },
    start: { x: MARGIN, y: ctx.y },
    thickness: 1.6,
  });
  ctx.y -= 26;

  // nome + papel.
  ctx.page.drawText(clean(cad.nome), { color: INK, font: bold, size: 13, x: MARGIN, y: ctx.y });
  ctx.y -= 13;
  ctx.page.drawText(clean(cad.papel), { color: MUTE, font, size: 8.5, x: MARGIN, y: ctx.y });
  ctx.y -= 6;

  // ---------- secoes ----------
  for (const secao of cad.secoes) drawSecao(ctx, secao);

  // ---------- rodape (em todas as paginas) ----------
  const paginas = doc.getPages();
  for (const p of paginas) {
    p.drawLine({
      color: SOFT,
      end: { x: A4.w - MARGIN, y: MARGIN - 8 },
      start: { x: MARGIN, y: MARGIN - 8 },
      thickness: 0.7,
    });
    p.drawText("Ficha gerada automaticamente", {
      color: MUTE,
      font,
      size: 7.5,
      x: MARGIN,
      y: MARGIN - 20,
    });
    const rw = font.widthOfTextAtSize(clean(cad.arquivo), 7.5);
    p.drawText(clean(cad.arquivo), {
      color: MUTE,
      font,
      size: 7.5,
      x: A4.w - MARGIN - rw,
      y: MARGIN - 20,
    });
  }

  return doc.save();
}

// Gera e baixa o CAD como PDF (roda no browser).
export async function gerarCadPdf(cad: CadDoc): Promise<void> {
  const bytes = await montarCadPdf(cad);
  baixar(bytes, `${cad.arquivo}.pdf`);
}

function baixar(bytes: Uint8Array, nomeArquivo: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo.replace(/[\\/:*?"<>|]+/g, " ").trim();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
