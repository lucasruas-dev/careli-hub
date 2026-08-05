// RELATÓRIO DE TRIAGEM DA DEVOLUÇÃO DE PIX (pedido do Lucas, 03/08).
//
// A pergunta que ele fez e que este relatório responde: dos que pagaram PIX e não compraram,
// QUEM chegou a ter PA emitida? Porque PA emitida com fluxo concluído no evento não é
// desistência — é venda que ficou sem lançamento no C2X. Devolver o PIX desses seria erro.
//
// Três grupos, em ordem de urgência:
//   A) TEM PA e concluiu    -> NÃO devolver ainda: conferir a PA (link no relatório) e decidir
//   B) sem PA, foi ao evento -> desistiu no meio: devolver
//   C) sem PA, não apareceu  -> não veio: devolver
//
//   node scripts/prometeu/relatorio-pix-devolucao.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { PDFDocument, StandardFonts, rgb } = requireDoRepo("pdf-lib");

const linhas = JSON.parse(
  fs.readFileSync(process.argv[2] || "C:/Users/lucas/AppData/Local/Temp/dados-pix-cenario.json", "utf8"),
);
const casa = process.env.USERPROFILE || ".";

const LARG = 842, ALT = 595, MARGEM = 32;
const TINTA = rgb(0.1, 0.1, 0.12), FRACO = rgb(0.45, 0.45, 0.5), LINHA = rgb(0.86, 0.86, 0.88);
const ZEBRA = rgb(0.965, 0.965, 0.975), DOURADO = rgb(0.66, 0.53, 0.29);
const ALERTA = rgb(0.7, 0.2, 0.15), VERDE = rgb(0.24, 0.45, 0.2), AZUL = rgb(0.15, 0.35, 0.6);

const fmtCpf = (d) => (String(d).length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : d);
const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");
const rotuloEtapa = (e) => ({
  concluido: "concluiu o fluxo", negociacao: "estava no salão", recepcao: "parou na recepção",
  secretaria: "estava na secretaria", cancelado: "cancelado",
}[e] ?? e);

const pdf = await PDFDocument.create();
const fonte = await pdf.embedFont(StandardFonts.Helvetica);
const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
const paginas = [];
let pagina = null, y = 0;

const sanear = (t) => String(t ?? "").replace(/[^\x20-\xFF]/g, "?");
const cortar = (t, larg, tam, f = fonte) => {
  let s = sanear(t);
  if (f.widthOfTextAtSize(s, tam) <= larg) return s;
  while (s.length > 1 && f.widthOfTextAtSize(`${s}...`, tam) > larg) s = s.slice(0, -1);
  return `${s}...`;
};
const nova = () => {
  pagina = pdf.addPage([LARG, ALT]);
  paginas.push(pagina);
  pagina.drawText("VALE DO OURO · PÓS-LANÇAMENTO", { color: DOURADO, font: bold, size: 9, x: MARGEM, y: ALT - 32 });
  pagina.drawText("Devolução de PIX: triagem antes de devolver", { color: TINTA, font: bold, size: 16, x: MARGEM, y: ALT - 54 });
  pagina.drawText(
    `${linhas.length} pessoas pagaram o PIX de R$ 1.000 e não têm unidade comprada — mas nem todas são desistência`,
    { color: FRACO, font: fonte, size: 9, x: MARGEM, y: ALT - 69 },
  );
  y = ALT - 92;
};

const comPa = linhas.filter((l) => l.temPa).sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));
const semPaEvento = linhas.filter((l) => !l.temPa && l.esteveNoEvento).sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));
const semPaAusente = linhas.filter((l) => !l.temPa && !l.esteveNoEvento).sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));

const COLS = [
  { chave: "cliente", titulo: "CLIENTE", x: MARGEM, largura: 215, bold: true },
  { chave: "cpfFmt", titulo: "CPF", x: MARGEM + 225, largura: 100 },
  { chave: "pagoFmt", titulo: "PIX PAGO", x: MARGEM + 330, largura: 62 },
  { chave: "etapaTxt", titulo: "ATÉ ONDE FOI NO EVENTO", x: MARGEM + 397, largura: 128 },
  { chave: "imobiliaria", titulo: "IMOBILIÁRIA", x: MARGEM + 530, largura: 145 },
  { chave: "chaveTxt", titulo: "CHAVE PIX", x: MARGEM + 680, largura: 100,
    cor: (l) => (l.chavePix ? VERDE : ALERTA) },
];

const cabecalho = () => {
  pagina.drawLine({ color: TINTA, end: { x: LARG - MARGEM, y: y + 12 }, start: { x: MARGEM, y: y + 12 }, thickness: 1 });
  for (const c of COLS) pagina.drawText(c.titulo, { color: FRACO, font: bold, size: 7, x: c.x, y });
  pagina.drawLine({ color: LINHA, end: { x: LARG - MARGEM, y: y - 6 }, start: { x: MARGEM, y: y - 6 }, thickness: 0.6 });
  y -= 20;
};

function grupo({ cor, linhas: lista, nota, titulo, comLink }) {
  if (y < MARGEM + 80) nova();
  y -= 4;
  pagina.drawText(sanear(titulo.toUpperCase()), { color: cor, font: bold, size: 11.5, x: MARGEM, y });
  y -= 13;
  for (const parte of nota) {
    pagina.drawText(cortar(parte, LARG - MARGEM * 2, 8.5), { color: FRACO, font: fonte, size: 8.5, x: MARGEM, y });
    y -= 11;
  }
  y -= 4;
  cabecalho();
  let zebra = false;
  for (const l of lista) {
    if (y < MARGEM + (comLink ? 34 : 22)) { nova(); cabecalho(); zebra = false; }
    if (zebra) pagina.drawRectangle({ color: ZEBRA, height: 13, width: LARG - MARGEM * 2 + 8, x: MARGEM - 4, y: y - 3.5 });
    zebra = !zebra;
    const dados = {
      ...l, chaveTxt: l.chavePix || "PEDIR AO CLIENTE", cpfFmt: fmtCpf(l.cpf),
      etapaTxt: rotuloEtapa(l.etapaEvento), pagoFmt: fmtData(l.pagoEm),
    };
    for (const c of COLS) {
      pagina.drawText(cortar(dados[c.chave], c.largura, 8.5, c.bold ? bold : fonte), {
        color: c.cor ? c.cor(l) : TINTA, font: c.bold ? bold : fonte, size: 8.5, x: c.x, y,
      });
    }
    y -= 13.5;
    if (comLink && l.paUrl) {
      pagina.drawText("ver a PA:", { color: FRACO, font: bold, size: 7, x: MARGEM + 12, y });
      const texto = cortar(l.paUrl, 700, 6.5);
      pagina.drawText(texto, { color: AZUL, font: fonte, size: 6.5, x: MARGEM + 52, y });
      pagina.drawLine({ color: AZUL, end: { x: MARGEM + 52 + fonte.widthOfTextAtSize(texto, 6.5), y: y - 1.5 }, start: { x: MARGEM + 52, y: y - 1.5 }, thickness: 0.4 });
      y -= 12;
    }
  }
  y -= 12;
}

nova();

// Resumo em uma linha, para quem só lê o topo.
pagina.drawText(
  `${comPa.length} PRECISAM DE ANÁLISE (têm PA) · ${semPaEvento.length + semPaAusente.length} podem ser devolvidos`,
  { color: TINTA, font: bold, size: 11, x: MARGEM, y },
);
y -= 22;

grupo({
  comLink: true,
  cor: ALERTA,
  linhas: comPa,
  nota: [
    "NÃO DEVOLVER AINDA. Estes pagaram, foram ao evento, preencheram a PROPOSTA no salão (a PA foi fotografada) e concluíram o fluxo —",
    "mas não existe proposta no C2X para eles. Pode ser venda real que ficou sem lançamento, não desistência. Abra a PA pelo link e decida:",
    "se a venda aconteceu, lançar no C2X (o PIX vira parte do negócio); se o cliente desistiu depois de preencher, aí sim devolver.",
  ],
  titulo: `A · ${comPa.length} com PA emitida — analisar antes de devolver`,
});

grupo({
  cor: TINTA,
  linhas: semPaEvento,
  nota: [
    "Pagaram, entraram no evento e saíram sem preencher proposta (nenhuma PA registrada). Desistência no meio do caminho: DEVOLVER.",
  ],
  titulo: `B · ${semPaEvento.length} foram ao evento, sem PA — devolver`,
});

grupo({
  cor: TINTA,
  linhas: semPaAusente,
  nota: [
    "Pagaram o PIX e não fizeram check-in no evento. Não apareceram: DEVOLVER.",
  ],
  titulo: `C · ${semPaAusente.length} não apareceram no evento — devolver`,
});

if (y < MARGEM + 60) nova();
y -= 4;
pagina.drawText("COMO USAR", { color: DOURADO, font: bold, size: 10, x: MARGEM, y });
y -= 14;
const semChave = linhas.filter((l) => !l.chavePix).length;
for (const passo of [
  `1. Grupo A (${comPa.length}): abrir a PA pelo link, conferir com o corretor e decidir entre lançar a venda ou devolver.`,
  `2. Grupos B e C (${semPaEvento.length + semPaAusente.length}): devolução liberada.`,
  `3. ${semChave} das ${linhas.length} pessoas ainda não informaram a chave PIX — precisam ser contatadas antes da devolução.`,
  "4. A PA de cada cliente também está no cadastro dele no Apolo (documento tipo PA), caso o link expire (7 dias).",
]) {
  pagina.drawText(cortar(passo, LARG - MARGEM * 2, 9), { color: TINTA, font: fonte, size: 9, x: MARGEM, y });
  y -= 13;
}

paginas.forEach((p, i) => {
  p.drawText(`Página ${i + 1} de ${paginas.length}`, { color: FRACO, font: fonte, size: 7.5, x: LARG - MARGEM - 62, y: MARGEM - 14 });
  p.drawText(`Panteon · Prometeu × Apolo × C2X · gerado em ${new Date().toLocaleString("pt-BR")}`, { color: FRACO, font: fonte, size: 7.5, x: MARGEM, y: MARGEM - 14 });
});

const saida = path.join(casa, "Desktop", "PIX_DEVOLUCAO_TRIAGEM.pdf");
fs.writeFileSync(saida, await pdf.save());
console.log(`A(analisar): ${comPa.length} · B(evento sem PA): ${semPaEvento.length} · C(ausentes): ${semPaAusente.length}`);
console.log(saida);
