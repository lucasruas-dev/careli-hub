// Geracao da CAD como PDF de verdade (pdf-lib). Monta o documento em memoria e devolve os
// BYTES -- nada de browser aqui: quem monta a CAD e o SERVIDOR (rota /api/apolo/cadastro/salvar),
// porque e la que nasce o codigo de autenticacao impresso no rodape. O operador baixa o mesmo
// arquivo que foi guardado no drive.

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
  // Codigo de autenticacao gerado no SERVIDOR e registrado na entidade. Vai impresso no
  // rodape: e por ele que se confere se a ficha e legitima ou forjada.
  autenticacao?: string;
  data: string; // dd/mm/aaaa
  hora: string; // HH:MM
  nome: string;
  papel: string; // "Prospect" etc.
  secoes: CadSecao[];
  // Titulo impresso no topo. Default "Cadastro de CAD"; a imobiliaria usa o proprio.
  titulo?: string;
  vinculo: string; // imobiliaria / corretor (vazio na imobiliaria: ela nao se vincula a outra)
};

// Paleta identica ao documento aprovado.
const INK = rgb(0.051, 0.078, 0.11); // #0d141c
const TEXT = rgb(0.118, 0.161, 0.231); // #1e293b
const MUTE = rgb(0.58, 0.639, 0.722); // #94a3b8
const SOFT = rgb(0.886, 0.91, 0.941); // #e2e8f0

const A4 = { h: 841.89, w: 595.28 };
const MARGIN = 42;
const COL_GAP = 16;
// 3 colunas + fonte menor pra ficha inteira (titular + conjuge) caber em UMA pagina.
const COLS = 3;

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

const VAL_SIZE = 8;
const LABEL_SIZE = 5.6;
const LINE_STEP = VAL_SIZE + 1.6;
const LABEL_GAP = 7.5; // distancia do label ate a 1a linha do valor
const CAMPO_RESPIRO = 4;
// Altura do bloco do titulo da secao (respiro + texto + regua + respiro).
const TITULO_H = 7 + 6 + 10;

function larguraDe(campo: CadCampo, colW: number, usableW: number): number {
  return campo.full ? usableW : colW;
}

// Mede a altura que o campo vai ocupar, SEM desenhar. O layout mede antes de escrever.
function medirCampo(ctx: Ctx, largura: number, campo: CadCampo): number {
  const linhas = wrap(campo.value || "-", ctx.font, VAL_SIZE, largura);
  return LABEL_GAP + linhas.length * LINE_STEP + CAMPO_RESPIRO;
}

// Desenha um campo (label em cima, valor embaixo) a partir de topY.
// NAO quebra pagina: quem decide a quebra e o drawSecao, que mede a linha inteira antes.
// (Era a quebra aqui dentro que dessincronizava o cursor e jogava um campo por pagina.)
function drawCampo(ctx: Ctx, x: number, largura: number, campo: CadCampo, topY: number): void {
  const linhas = wrap(campo.value || "-", ctx.font, VAL_SIZE, largura);
  let y = topY;

  ctx.page.drawText(clean(campo.label).toUpperCase(), {
    color: MUTE,
    font: ctx.bold,
    size: LABEL_SIZE,
    x,
    y,
  });
  y -= LABEL_GAP;

  for (const linha of linhas) {
    ctx.page.drawText(linha || "-", {
      color: TEXT,
      font: ctx.font,
      size: VAL_SIZE,
      x,
      y,
    });
    y -= LINE_STEP;
  }
}

function drawSecao(ctx: Ctx, secao: CadSecao): void {
  const usableW = A4.w - MARGIN * 2;
  const colW = (usableW - COL_GAP * (COLS - 1)) / COLS;

  // 1) Monta as LINHAS: campo `full` ocupa a linha inteira; os demais preenchem as COLS colunas.
  const linhas: CadCampo[][] = [];
  let grupo: CadCampo[] = [];
  for (const campo of secao.fields) {
    if (campo.full) {
      if (grupo.length) {
        linhas.push(grupo);
        grupo = [];
      }
      linhas.push([campo]);
      continue;
    }
    grupo.push(campo);
    if (grupo.length === COLS) {
      linhas.push(grupo);
      grupo = [];
    }
  }
  if (grupo.length) {
    linhas.push(grupo);
  }

  // 2) Titulo anda junto com a primeira linha (evita titulo orfao no pe da pagina).
  const alturaPrimeira = linhas.length
    ? Math.max(
        ...linhas[0]!.map((campo) => medirCampo(ctx, larguraDe(campo, colW, usableW), campo)),
      )
    : 0;
  if (ctx.y - (TITULO_H + alturaPrimeira) < MARGIN) {
    novaPagina(ctx);
  }

  ctx.y -= 7;
  ctx.page.drawText(clean(secao.title).toUpperCase(), {
    color: INK,
    font: ctx.bold,
    size: 9,
    x: MARGIN,
    y: ctx.y,
  });
  ctx.y -= 6;
  ctx.page.drawLine({
    color: SOFT,
    end: { x: A4.w - MARGIN, y: ctx.y },
    start: { x: MARGIN, y: ctx.y },
    thickness: 0.7,
  });
  ctx.y -= 10;

  // 3) Desenha linha a linha: mede, quebra ANTES se nao couber, e escreve os campos da linha
  //    sempre no mesmo topo (colunas alinhadas, nada partido no meio).
  for (const linha of linhas) {
    const altura = Math.max(
      ...linha.map((campo) => medirCampo(ctx, larguraDe(campo, colW, usableW), campo)),
    );

    if (ctx.y - altura < MARGIN) {
      novaPagina(ctx);
    }

    const topo = ctx.y;
    linha.forEach((campo, index) => {
      const x = campo.full ? MARGIN : MARGIN + index * (colW + COL_GAP);
      drawCampo(ctx, x, larguraDe(campo, colW, usableW), campo, topo);
    });
    ctx.y = topo - altura;
  }
}

// Monta o PDF em memoria (sem baixar). Node-safe: usado no teste de layout.
export async function montarCadPdf(cad: CadDoc): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(cad.arquivo);

  const ctx: Ctx = { bold, doc, font, page: doc.addPage([A4.w, A4.h]), y: A4.h - MARGIN };

  // Campo sem valor nao ocupa espaco na ficha (era o "RG: -" solto). Secao que fica sem
  // nenhum campo tambem sai.
  const secoes = cad.secoes
    .map((secao) => ({
      ...secao,
      fields: secao.fields.filter((campo) => {
        const valor = (campo.value ?? "").trim();
        return valor && valor !== "-" && valor !== "—";
      }),
    }))
    .filter((secao) => secao.fields.length > 0);

  // ---------- cabecalho ----------
  ctx.page.drawText(cad.titulo || "Cadastro de CAD", {
    color: INK,
    font: bold,
    size: 14,
    x: MARGIN,
    y: ctx.y - 3,
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
  // So imprime o vinculo quando existe (a ficha da imobiliaria nao tem esse campo).
  if (cad.vinculo) {
    metaRight("Imobiliaria / corretor", cad.vinculo, 11);
  }

  ctx.y -= 20;
  ctx.page.drawLine({
    color: INK,
    end: { x: A4.w - MARGIN, y: ctx.y },
    start: { x: MARGIN, y: ctx.y },
    thickness: 1.4,
  });
  ctx.y -= 18;

  // nome + papel (na mesma linha: o papel vai a direita, economizando altura).
  ctx.page.drawText(clean(cad.nome), { color: INK, font: bold, size: 11.5, x: MARGIN, y: ctx.y });
  const papelW = font.widthOfTextAtSize(clean(cad.papel), 8);
  ctx.page.drawText(clean(cad.papel), {
    color: MUTE,
    font,
    size: 8,
    x: A4.w - MARGIN - papelW,
    y: ctx.y,
  });
  // Respiro antes da 1a secao: sem isto o titulo "IDENTIFICACAO" cola no nome.
  ctx.y -= 12;

  // ---------- secoes ----------
  for (const secao of secoes) drawSecao(ctx, secao);

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
    // Codigo de autenticacao a DIREITA (e o que se confere pra saber se a ficha e legitima).
    // O nome do arquivo saiu do rodape: era redundante (ja e o nome do arquivo) e, sendo longo,
    // colidia com o codigo no centro -- os dois textos se sobrepunham.
    if (cad.autenticacao) {
      const rotulo = "Autenticacao: ";
      const codigo = clean(cad.autenticacao);
      const larguraRotulo = font.widthOfTextAtSize(rotulo, 7.5);
      const larguraCodigo = bold.widthOfTextAtSize(codigo, 7.5);
      const x = A4.w - MARGIN - larguraRotulo - larguraCodigo;
      p.drawText(rotulo, { color: MUTE, font, size: 7.5, x, y: MARGIN - 20 });
      p.drawText(codigo, {
        color: TEXT,
        font: bold,
        size: 7.5,
        x: x + larguraRotulo,
        y: MARGIN - 20,
      });
    }
  }

  return doc.save();
}

