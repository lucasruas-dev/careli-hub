// Comprovante da consulta de crédito Serasa, em PDF (pdf-lib). Ao contrário da CAD (que leva SÓ o
// status, decisão do Lucas), o COMPROVANTE carrega os VALORES: score, veredito e o detalhamento
// das restrições. Traz um QR code que aponta para /publico/verificar — quem recebe confere a
// autenticidade, e os detalhes só abrem com a senha do empreendimento.
//
// Mesma identidade visual da CAD (paleta, logo C2X centralizada, rodapé com código de
// autenticação). Layout de "recibo" (label à esquerda, valor à direita), não o grid de campos da
// ficha.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

import { C2X_LOGO_PNG_BASE64 } from "@/modules/apolo/blocks/cadastro/cad-logo";

const INK = rgb(0.051, 0.078, 0.11);
const TEXT = rgb(0.118, 0.161, 0.231);
const MUTE = rgb(0.58, 0.639, 0.722);
const SOFT = rgb(0.886, 0.91, 0.941);
const VERDE = rgb(0.086, 0.639, 0.29); // aprovado
const VERMELHO = rgb(0.86, 0.15, 0.15); // reprovado

const A4 = { h: 841.89, w: 595.28 };
const MARGIN = 42;

export type ComprovanteRestricao = { quantidade: number; rotulo: string; valor: number };

export type ComprovanteDados = {
  ambiente: string; // "producao" | "homologacao"
  autenticacao: string; // código impresso no rodapé
  cliente: string;
  data: string; // "dd/mm/aaaa HH:MM"
  documento: string; // CPF/CNPJ formatado
  empreendimento?: string;
  faixa?: string; // faixa/risco do score, se houver
  protocolo: string; // id da consulta
  qrUrl: string; // URL que o QR aponta (/publico/verificar?c=token)
  restricoes: ComprovanteRestricao[];
  score: number | null;
  scoreModelo?: string;
  veredito: { aprovado: boolean; limite: number; motivo: string; total: number };
};

function clean(value: string): string {
  return (value ?? "")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, "");
}

function brl(v: number): string {
  return clean(
    new Intl.NumberFormat("pt-BR", { currency: "BRL", style: "currency" }).format(
      Number.isFinite(v) ? v : 0,
    ),
  );
}

export async function montarComprovantePdf(d: ComprovanteDados): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.setTitle(`Comprovante de credito - ${d.cliente}`);

  const page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;

  const text = (
    t: string,
    x: number,
    yy: number,
    size: number,
    f: PDFFont = font,
    color = TEXT,
  ) => page.drawText(clean(t), { color, font: f, size, x, y: yy });

  // Valor alinhado à direita da margem.
  const textRight = (t: string, yy: number, size: number, f: PDFFont = font, color = TEXT) => {
    const w = f.widthOfTextAtSize(clean(t), size);
    page.drawText(clean(t), { color, font: f, size, x: A4.w - MARGIN - w, y: yy });
  };

  // ---------- cabeçalho (logo C2X centralizada) ----------
  try {
    const logo = await doc.embedPng(Buffer.from(C2X_LOGO_PNG_BASE64, "base64"));
    const larguraLogo = 72;
    const alturaLogo = (logo.height / logo.width) * larguraLogo;
    page.drawImage(logo, {
      height: alturaLogo,
      width: larguraLogo,
      x: (A4.w - larguraLogo) / 2,
      y: y - alturaLogo,
    });
    y -= alturaLogo + 14;
  } catch {
    // sem logo: título assume o topo
  }

  // Título e meta CENTRALIZADOS, abaixo da logo (pedido do Lucas).
  const centro = (t: string, yy: number, size: number, f: PDFFont = font, color = TEXT) => {
    const w = f.widthOfTextAtSize(clean(t), size);
    page.drawText(clean(t), { color, font: f, size, x: (A4.w - w) / 2, y: yy });
  };

  centro("Comprovante de análise de crédito", y - 3, 14, bold, INK);
  y -= 20;
  centro(`Emitido em ${d.data}    |    Protocolo ${d.protocolo}`, y, 8.5, font, MUTE);
  y -= 12;
  if (d.ambiente && d.ambiente !== "producao") {
    centro("Ambiente: HOMOLOGAÇÃO (teste)", y, 8.5, bold, VERMELHO);
    y -= 12;
  }
  y -= 6;
  page.drawLine({
    color: INK,
    end: { x: A4.w - MARGIN, y },
    start: { x: MARGIN, y },
    thickness: 1.4,
  });
  y -= 18;

  // ---------- consultado ----------
  text(d.cliente, MARGIN, y, 11.5, bold, INK);
  y -= 13;
  text(`CPF/CNPJ ${d.documento}`, MARGIN, y, 8.5, font, MUTE);
  if (d.empreendimento) {
    const rot = `Empreendimento: ${d.empreendimento}`;
    const w = font.widthOfTextAtSize(clean(rot), 8.5);
    text(rot, A4.w - MARGIN - w, y, 8.5, font, MUTE);
  }
  y -= 20;

  // ---------- veredito em destaque ----------
  const aprovado = d.veredito.aprovado;
  const cor = aprovado ? VERDE : VERMELHO;
  page.drawRectangle({
    borderColor: cor,
    borderWidth: 1,
    color: rgb(1, 1, 1),
    height: 38,
    width: A4.w - MARGIN * 2,
    x: MARGIN,
    y: y - 38,
  });
  text(aprovado ? "APROVADO" : "REPROVADO", MARGIN + 12, y - 17, 12, bold, cor);
  text(clean(d.veredito.motivo || ""), MARGIN + 12, y - 30, 7.5, font, MUTE);
  y -= 38 + 20;

  // ---------- resultado (linhas label/valor) ----------
  const secao = (titulo: string) => {
    y -= 4;
    text(titulo.toUpperCase(), MARGIN, y, 9, bold, INK);
    y -= 6;
    page.drawLine({
      color: SOFT,
      end: { x: A4.w - MARGIN, y },
      start: { x: MARGIN, y },
      thickness: 0.7,
    });
    y -= 14;
  };
  const linha = (rot: string, val: string, corVal = TEXT, boldVal = false) => {
    text(rot, MARGIN, y, 9, font, MUTE);
    textRight(val, y, 9, boldVal ? bold : font, corVal);
    y -= 15;
  };

  secao("Resultado");
  linha("Score", d.score === null ? "não informado" : String(d.score));
  if (d.scoreModelo) linha("Modelo do score", d.scoreModelo);
  linha("Total de dívidas vencidas", brl(d.veredito.total), aprovado ? TEXT : VERMELHO, true);
  linha("Limite do empreendimento", brl(d.veredito.limite));

  // ---------- restrições ----------
  if (d.restricoes.length) {
    secao("Dívidas vencidas (detalhamento)");
    // cabeçalho da tabela
    text("Tipo", MARGIN, y, 7, bold, MUTE);
    const xQtd = A4.w - MARGIN - 200;
    const qtdLabel = "Qtd";
    text(qtdLabel, xQtd, y, 7, bold, MUTE);
    textRight("Valor", y, 7, bold, MUTE);
    y -= 13;
    for (const r of d.restricoes) {
      text(r.rotulo, MARGIN, y, 9, font, TEXT);
      text(String(r.quantidade), xQtd, y, 9, font, TEXT);
      textRight(brl(r.valor), y, 9, font, TEXT);
      y -= 14;
    }
  }

  // ---------- QR + nota de verificação ----------
  y -= 10;
  try {
    const qrPng = await QRCode.toBuffer(d.qrUrl, { margin: 1, type: "png", width: 320 });
    const qr = await doc.embedPng(qrPng);
    const lado = 88;
    const qrY = Math.max(MARGIN + 30, y - lado);
    page.drawImage(qr, { height: lado, width: lado, x: MARGIN, y: qrY });
    text("Verifique a autenticidade", MARGIN + lado + 14, qrY + lado / 2 - 3, 9, bold, INK);
  } catch {
    // sem QR: o comprovante ainda sai, com o link textual no rodapé
  }

  // ---------- rodapé ----------
  page.drawLine({
    color: SOFT,
    end: { x: A4.w - MARGIN, y: MARGIN - 8 },
    start: { x: MARGIN, y: MARGIN - 8 },
    thickness: 0.7,
  });
  text("Documento emitido por C2X - comprovante de consulta de crédito", MARGIN, MARGIN - 20, 7.5, font, MUTE);
  if (d.autenticacao) {
    const rotulo = "Autenticação: ";
    const codigo = clean(d.autenticacao);
    const larguraRotulo = font.widthOfTextAtSize(rotulo, 7.5);
    const larguraCodigo = bold.widthOfTextAtSize(codigo, 7.5);
    const x = A4.w - MARGIN - larguraRotulo - larguraCodigo;
    page.drawText(rotulo, { color: MUTE, font, size: 7.5, x, y: MARGIN - 20 });
    page.drawText(codigo, { color: TEXT, font: bold, size: 7.5, x: x + larguraRotulo, y: MARGIN - 20 });
  }

  return doc.save();
}
