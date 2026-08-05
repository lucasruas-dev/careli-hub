// RELATÓRIOS PÓS-LANÇAMENTO (pedido do Lucas, 03/08) — dois PDFs no Desktop:
//   1) PROPOSTAS_SEM_PA.pdf  — quem tem proposta no Vale do Ouro e não teve PA registrada
//   2) PIX_PAGOS.pdf         — os PIX pagos em três visões: comprou / devolver / esteve no evento
// Fonte: /tmp/dados-relatorios.json (gerado pelo levantamento que cruza Panteon × C2X).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { PDFDocument, StandardFonts, rgb } = requireDoRepo("pdf-lib");

const dados = JSON.parse(fs.readFileSync(process.argv[2] || "C:/Users/lucas/AppData/Local/Temp/dados-relatorios.json", "utf8"));
const casa = process.env.USERPROFILE || ".";

const LARG = 842, ALT = 595, MARGEM = 32;
const TINTA = rgb(0.1, 0.1, 0.12), FRACO = rgb(0.45, 0.45, 0.5), LINHA = rgb(0.86, 0.86, 0.88);
const ZEBRA = rgb(0.965, 0.965, 0.975), DOURADO = rgb(0.66, 0.53, 0.29), ALERTA = rgb(0.7, 0.2, 0.15);
const VERDE = rgb(0.24, 0.45, 0.2);
const fmtCpf = (d) => (String(d).length === 11 ? `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}` : d);
const fmtData = (iso) => (iso ? new Date(iso).toLocaleDateString("pt-BR") : "—");

async function montar({ arquivo, colunas, grupos, subtitulo, titulo }) {
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
    pagina.drawText(titulo, { color: TINTA, font: bold, size: 16, x: MARGEM, y: ALT - 54 });
    pagina.drawText(subtitulo, { color: FRACO, font: fonte, size: 9, x: MARGEM, y: ALT - 69 });
    y = ALT - 92;
  };
  const cabecalho = () => {
    pagina.drawLine({ color: TINTA, end: { x: LARG - MARGEM, y: y + 12 }, start: { x: MARGEM, y: y + 12 }, thickness: 1 });
    for (const col of colunas) pagina.drawText(col.titulo, { color: FRACO, font: bold, size: 7, x: col.x, y });
    pagina.drawLine({ color: LINHA, end: { x: LARG - MARGEM, y: y - 6 }, start: { x: MARGEM, y: y - 6 }, thickness: 0.6 });
    y -= 20;
  };

  nova();
  for (const g of grupos) {
    if (y < MARGEM + 70) nova();
    y -= 4;
    pagina.drawText(g.titulo.toUpperCase(), { color: g.cor ?? TINTA, font: bold, size: 11, x: MARGEM, y });
    y -= 13;
    pagina.drawText(g.nota, { color: FRACO, font: fonte, size: 8.5, x: MARGEM, y });
    y -= 14;
    cabecalho();
    if (!g.linhas.length) {
      pagina.drawText("Nenhum registro nesta visão.", { color: FRACO, font: fonte, size: 9, x: MARGEM + 8, y });
      y -= 22;
      continue;
    }
    let zebra = false;
    for (const l of g.linhas) {
      if (y < MARGEM + 22) { nova(); cabecalho(); zebra = false; }
      if (zebra) pagina.drawRectangle({ color: ZEBRA, height: 13, width: LARG - MARGEM * 2 + 8, x: MARGEM - 4, y: y - 3.5 });
      zebra = !zebra;
      for (const col of colunas) {
        pagina.drawText(cortar(l[col.chave], col.largura, 8.5, col.bold ? bold : fonte), {
          color: col.cor ? col.cor(l) : TINTA, font: col.bold ? bold : fonte, size: 8.5, x: col.x, y,
        });
      }
      y -= 13.5;
    }
    y -= 10;
  }
  paginas.forEach((p, i) => {
    p.drawText(`Página ${i + 1} de ${paginas.length}`, { color: FRACO, font: fonte, size: 7.5, x: LARG - MARGEM - 62, y: MARGEM - 14 });
    p.drawText(`Panteon · gerado em ${new Date().toLocaleString("pt-BR")}`, { color: FRACO, font: fonte, size: 7.5, x: MARGEM, y: MARGEM - 14 });
  });
  const saida = path.join(casa, "Desktop", arquivo);
  fs.writeFileSync(saida, await pdf.save());
  return saida;
}

// ── 1) PROPOSTAS SEM PA ───────────────────────────────────────────────────
const semPa = dados.semPa.sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));
const p1 = await montar({
  arquivo: "PROPOSTAS_SEM_PA.pdf",
  colunas: [
    { chave: "cliente", titulo: "CLIENTE", x: MARGEM, largura: 230, bold: true },
    { chave: "cpfFmt", titulo: "CPF", x: MARGEM + 240, largura: 110 },
    { chave: "lotes", titulo: "LOTE(S)", x: MARGEM + 355, largura: 120 },
    { chave: "carteira", titulo: "CARTEIRA", x: MARGEM + 480, largura: 70 },
    { chave: "etapa", titulo: "ETAPA NO C2X", x: MARGEM + 555, largura: 130 },
    { chave: "noEvento", titulo: "ESTEVE NO EVENTO", x: MARGEM + 690, largura: 90,
      cor: (l) => (l.noEvento === "sim" ? VERDE : ALERTA) },
  ],
  grupos: [{
    cor: ALERTA,
    linhas: semPa.map((s) => ({ ...s, cpfFmt: fmtCpf(s.cpf) })),
    nota: "Proposta aberta no Vale do Ouro sem a foto da PA registrada no bip da secretaria. A PA é a folha preenchida no salão: sem ela, o atendimento remoto não tem como conferir a proposta.",
    titulo: `${semPa.length} propostas sem PA`,
  }],
  subtitulo: `Clientes com proposta aberta e sem PA · ${semPa.length} de ${dados.semPa.length + 108} compradores`,
  titulo: "Propostas sem PA registrada",
});

// ── 2) PIX PAGOS ──────────────────────────────────────────────────────────
const pix = dados.pix.sort((a, b) => a.cliente.localeCompare(b.cliente, "pt-BR"));
const compraram = pix.filter((p) => p.comprou);
const devolverEvento = pix.filter((p) => !p.comprou && p.esteveNoEvento);
const devolverAusente = pix.filter((p) => !p.comprou && !p.esteveNoEvento);
const p2 = await montar({
  arquivo: "PIX_PAGOS.pdf",
  colunas: [
    { chave: "cliente", titulo: "CLIENTE", x: MARGEM, largura: 215, bold: true },
    { chave: "cpfFmt", titulo: "CPF", x: MARGEM + 225, largura: 105 },
    { chave: "pagoFmt", titulo: "PIX PAGO EM", x: MARGEM + 335, largura: 75 },
    { chave: "lotes", titulo: "LOTE(S) COMPRADO(S)", x: MARGEM + 415, largura: 130 },
    { chave: "imobiliaria", titulo: "IMOBILIÁRIA", x: MARGEM + 550, largura: 130 },
    { chave: "chavePix", titulo: "CHAVE P/ DEVOLUÇÃO", x: MARGEM + 685, largura: 95 },
  ],
  grupos: [
    {
      cor: VERDE,
      linhas: compraram.map((p) => ({ ...p, cpfFmt: fmtCpf(p.cpf), pagoFmt: fmtData(p.pagoEm) })),
      nota: "PIX de R$ 1.000 pago e unidade comprada: o valor entra no negócio, nada a devolver.",
      titulo: `${compraram.length} pagaram e COMPRARAM`,
    },
    {
      cor: ALERTA,
      linhas: devolverEvento.map((p) => ({ ...p, cpfFmt: fmtCpf(p.cpf), pagoFmt: fmtData(p.pagoEm) })),
      nota: "Pagaram, foram ao evento e saíram sem unidade. DEVOLVER o PIX. Quem tem chave cadastrada já dá para devolver hoje; os demais precisam ser contatados.",
      titulo: `${devolverEvento.length} pagaram, ESTIVERAM no evento e NÃO compraram`,
    },
    {
      cor: ALERTA,
      linhas: devolverAusente.map((p) => ({ ...p, cpfFmt: fmtCpf(p.cpf), pagoFmt: fmtData(p.pagoEm) })),
      nota: "Pagaram o PIX e não apareceram no evento (sem check-in). DEVOLVER o PIX.",
      titulo: `${devolverAusente.length} pagaram, NÃO foram ao evento e NÃO compraram`,
    },
  ],
  subtitulo: `${pix.length} PIX pagos · ${compraram.length} viraram venda · ${devolverEvento.length + devolverAusente.length} a devolver`,
  titulo: "PIX pagos: quem comprou e quem receberá de volta",
});

console.log("gerados:");
console.log(" ", p1);
console.log(" ", p2);
console.log(`resumo · sem PA: ${semPa.length} · PIX: ${compraram.length} compraram, ${devolverEvento.length + devolverAusente.length} a devolver`);
