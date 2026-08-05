// QUEM VEIO E NÃO LEVOU (pedido do Lucas, 03/08): todos que fizeram check-in no evento e não
// têm unidade comprada — onde pararam e o que ficou registrado no C2X.
//
// ⚠️ A COLUNA "PA" VEM DO C2X (correção do Lucas, 03/08): PA = Proposta de Aquisição, o registro
// em `acquisition_requests`. A foto tirada no bip da secretaria NÃO serve de prova aqui — ela é
// o papel; o que vale é o que foi lançado no sistema.
//
// A leitura que o relatório entrega: quem tem PA cancelada ESCOLHEU LOTE e desistiu (ou foi
// cancelado) — é o público mais quente, com o lote já identificado para retomar a conversa.
//
//   node scripts/prometeu/relatorio-nao-compraram.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { PDFDocument, StandardFonts, rgb } = requireDoRepo("pdf-lib");

const linhas = JSON.parse(
  fs.readFileSync(process.argv[2] || "C:/Users/lucas/AppData/Local/Temp/dados-nao-compraram.json", "utf8"),
);
const casa = process.env.USERPROFILE || ".";

const LARG = 842, ALT = 595, MARGEM = 32;
const TINTA = rgb(0.1, 0.1, 0.12), FRACO = rgb(0.45, 0.45, 0.5), LINHA = rgb(0.86, 0.86, 0.88);
const ZEBRA = rgb(0.965, 0.965, 0.975), DOURADO = rgb(0.66, 0.53, 0.29);
const ALERTA = rgb(0.7, 0.2, 0.15), VERDE = rgb(0.24, 0.45, 0.2);

const fmtCpf = (d) => (String(d).length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : d);
const hora = (iso) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", hour: "2-digit", minute: "2-digit", month: "2-digit" }) : "—");
const ETAPA_TXT = {
  cancelado: "cancelou", concluido: "concluiu o fluxo", negociacao: "salão de vendas",
  proposta: "proposta", recepcao: "recepção", reserva: "reserva", secretaria: "secretaria",
};

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
  pagina.drawText("Quem veio ao evento e não levou unidade", { color: TINTA, font: bold, size: 16, x: MARGEM, y: ALT - 54 });
  pagina.drawText(
    `${linhas.length} de 149 pessoas que fizeram check-in sairam sem unidade · PA = Proposta de Aquisição registrada no C2X`,
    { color: FRACO, font: fonte, size: 9, x: MARGEM, y: ALT - 69 },
  );
  y = ALT - 92;
};

const COLS = [
  { chave: "cliente", titulo: "CLIENTE", x: MARGEM, largura: 190, bold: true },
  { chave: "cpfFmt", titulo: "CPF", x: MARGEM + 198, largura: 95 },
  { chave: "chegouTxt", titulo: "CHEGOU", x: MARGEM + 296, largura: 70 },
  { chave: "etapaTxt", titulo: "PAROU EM", x: MARGEM + 368, largura: 92 },
  { chave: "paNum", titulo: "PA (C2X)", x: MARGEM + 462, largura: 52, bold: true,
    cor: (l) => (l.paC2x === "SIM" ? ALERTA : FRACO) },
  { chave: "paDetalhe", titulo: "SITUAÇÃO DA PA", x: MARGEM + 518, largura: 165,
    cor: (l) => (l.paC2x === "SIM" ? TINTA : FRACO) },
  { chave: "pixTxt", titulo: "PIX", x: MARGEM + 688, largura: 28, cor: (l) => (l.pagouPix ? VERDE : FRACO) },
  { chave: "imobiliaria", titulo: "IMOBILIÁRIA", x: MARGEM + 720, largura: 90 },
];
const cabecalho = () => {
  pagina.drawLine({ color: TINTA, end: { x: LARG - MARGEM, y: y + 12 }, start: { x: MARGEM, y: y + 12 }, thickness: 1 });
  for (const c of COLS) pagina.drawText(c.titulo, { color: FRACO, font: bold, size: 7, x: c.x, y });
  pagina.drawLine({ color: LINHA, end: { x: LARG - MARGEM, y: y - 6 }, start: { x: MARGEM, y: y - 6 }, thickness: 0.6 });
  y -= 20;
};

function grupo({ cor, lista, nota, titulo }) {
  if (y < MARGEM + 76) nova();
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
    if (y < MARGEM + 22) { nova(); cabecalho(); zebra = false; }
    if (zebra) pagina.drawRectangle({ color: ZEBRA, height: 13, width: LARG - MARGEM * 2 + 8, x: MARGEM - 4, y: y - 3.5 });
    zebra = !zebra;
    const d = {
      ...l, chegouTxt: hora(l.chegou), cpfFmt: fmtCpf(l.cpf),
      etapaTxt: ETAPA_TXT[l.etapaEvento] ?? l.etapaEvento,
      paNum: l.paC2x === "SIM" ? l.paNum : "—",
      pixTxt: l.pagouPix ? "sim" : "—",
    };
    for (const c of COLS) {
      pagina.drawText(cortar(d[c.chave], c.largura, 8.5, c.bold ? bold : fonte), {
        color: c.cor ? c.cor(l) : TINTA, font: c.bold ? bold : fonte, size: 8.5, x: c.x, y,
      });
    }
    y -= 13.5;
  }
  y -= 12;
}

const ordena = (a, b) => a.cliente.localeCompare(b.cliente, "pt-BR");
const comPa = linhas.filter((l) => l.paC2x === "SIM").sort(ordena);
const semPaFundo = linhas.filter((l) => l.paC2x !== "SIM" && ["concluido", "secretaria"].includes(l.etapaEvento)).sort(ordena);
const semPaSalao = linhas.filter((l) => l.paC2x !== "SIM" && ["negociacao", "proposta", "reserva"].includes(l.etapaEvento)).sort(ordena);
const semPaRecepcao = linhas.filter((l) => l.paC2x !== "SIM" && !["concluido", "negociacao", "proposta", "reserva", "secretaria"].includes(l.etapaEvento)).sort(ordena);

nova();
pagina.drawText(
  `${comPa.length} tiveram PA no C2X (com lote escolhido) · ${linhas.length - comPa.length} nunca chegaram a ter PA`,
  { color: TINTA, font: bold, size: 11, x: MARGEM, y },
);
y -= 14;
pagina.drawText(
  `${linhas.filter((l) => l.pagouPix).length} pagaram o PIX de R$ 1.000 · PA = registro de Proposta de Aquisição no C2X (a foto do bip não conta aqui)`,
  { color: FRACO, font: fonte, size: 9, x: MARGEM, y },
);
y -= 20;

grupo({
  cor: ALERTA,
  lista: comPa,
  nota: [
    "PRIORIDADE MÁXIMA. Estes ESCOLHERAM LOTE: a Proposta de Aquisição foi lançada no C2X e depois cancelada — o número da PA e a",
    "quadra/lote estão na tabela. É a lista mais quente do pós-evento: já sabemos o que cada um queria comprar. Vale entender com o",
    "corretor por que a PA caiu (crédito, desistência, troca de lote) e retomar; o lote pode ou não estar disponível hoje.",
  ],
  titulo: `A · ${comPa.length} tiveram PA registrada e cancelada`,
});
grupo({
  cor: TINTA,
  lista: semPaFundo,
  nota: [
    "Foram até a secretaria e concluíram o atendimento, mas NENHUMA PA foi lançada no C2X. Atendimento que terminou sem registro:",
    "conferir com a secretaria e com o corretor o que aconteceu (pode ser venda que não foi lançada).",
  ],
  titulo: `B · ${semPaFundo.length} concluíram o fluxo sem PA no sistema`,
});
grupo({
  cor: TINTA,
  lista: semPaSalao,
  nota: ["Passaram pelo corretor no salão e não avançaram. Perderam-se na negociação, antes de qualquer registro."],
  titulo: `C · ${semPaSalao.length} pararam no salão de vendas`,
});
grupo({
  cor: TINTA,
  lista: semPaRecepcao,
  nota: ["Entraram no evento e não chegaram a ser atendidos no salão. Público para a próxima campanha."],
  titulo: `D · ${semPaRecepcao.length} não passaram da recepção`,
});

if (y < MARGEM + 56) nova();
y -= 4;
pagina.drawText("COMO LER", { color: DOURADO, font: bold, size: 10, x: MARGEM, y });
y -= 14;
for (const nota of [
  "PA (C2X) = número da Proposta de Aquisição lançada no C2X. Sem número, nunca houve proposta no sistema.",
  "SITUAÇÃO DA PA = estado atual e o lote escolhido. Todas as PAs deste relatório estão canceladas (por isso a pessoa não tem unidade).",
  "PIX = pagou o sinal de R$ 1.000 na pré-venda. Quem pagou e não comprou também está no relatório de devolução.",
  "PAROU EM = última etapa do cliente na fila do evento (recepção, salão, secretaria ou concluiu).",
]) {
  pagina.drawText(cortar(nota, LARG - MARGEM * 2, 9), { color: TINTA, font: fonte, size: 9, x: MARGEM, y });
  y -= 13;
}

paginas.forEach((p, i) => {
  p.drawText(`Página ${i + 1} de ${paginas.length}`, { color: FRACO, font: fonte, size: 7.5, x: LARG - MARGEM - 62, y: MARGEM - 14 });
  p.drawText(`Panteon · Prometeu × C2X · gerado em ${new Date().toLocaleString("pt-BR")}`, { color: FRACO, font: fonte, size: 7.5, x: MARGEM, y: MARGEM - 14 });
});

const saida = path.join(casa, "Desktop", "EVENTO_NAO_COMPRARAM.pdf");
fs.writeFileSync(saida, await pdf.save());
console.log(`A(PA cancelada): ${comPa.length} · B(concluiu sem PA): ${semPaFundo.length} · C(salão): ${semPaSalao.length} · D(recepção): ${semPaRecepcao.length}`);
console.log(saida);
