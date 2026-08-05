// RELATÓRIO DE RESERVAS — PDF em paisagem, uma linha por cliente + unidade.
//
// Pedido do Lucas (01/08, durante o evento): lista com imobiliária, cliente, status e o tempo da
// última proposta; SÓ o status "Reservado"; paisagem; cabeçalho em todas as páginas.
//
// A FONTE É O CSV EXPORTADO DA TELA DE UNIDADES DO C2X ("Baixar em Excel"), e não uma consulta
// nossa ao banco. Motivo: a tela já resolve duas coisas que a consulta erra com facilidade — a
// imobiliária vem com o código dela (IMO402 - MOURA...), que é o vínculo do PEDIDO, não o
// `vinculed_by_id` do cliente; e o "Tempo da última proposta" já vem calculado no mesmo critério
// que o time lê na tela. Relatório que diverge da tela que o time olha não serve para nada.
//
// Uso (da raiz do repo):
//   node scripts/prometeu/relatorio-reservas.mjs "C:/Users/lucas/Downloads/enterprise_unities-....csv"
// Sem argumento, pega o CSV de unidades mais recente da pasta Downloads.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { PDFDocument, StandardFonts, rgb } = requireDoRepo("pdf-lib");

const STATUS_DO_RELATORIO = "Reservado";

// ── entrada ───────────────────────────────────────────────────────────────
const casa = process.env.USERPROFILE || process.env.HOME || ".";
let entrada = process.argv[2];
if (!entrada) {
  const downloads = path.join(casa, "Downloads");
  const candidatos = fs
    .readdirSync(downloads)
    .filter((f) => f.startsWith("enterprise_unities") && f.endsWith(".csv"))
    .map((f) => ({ nome: f, quando: fs.statSync(path.join(downloads, f)).mtimeMs }))
    .sort((a, b) => b.quando - a.quando);
  if (candidatos.length === 0) {
    console.error("Não achei nenhum CSV de unidades em Downloads. Exporte pelo 'Baixar em Excel' da tela de unidades.");
    process.exit(1);
  }
  entrada = path.join(downloads, candidatos[0].nome);
}
console.log(`Lendo: ${path.basename(entrada)}`);

// O export vem com BOM e separador ';' (padrão brasileiro do Excel).
const bruto = fs.readFileSync(entrada, "utf8").replace(/^\uFEFF/, "");
const linhasCsv = bruto.split(/\r?\n/).filter((l) => l.trim());
const cabecalho = linhasCsv[0].split(";").map((c) => c.trim());
const idx = (nome) => cabecalho.findIndex((c) => c.toLowerCase().startsWith(nome.toLowerCase()));

const COL = {
  cliente: idx("Cliente da última proposta"),
  corretorImob: idx("Corretor/Imobiliária"),
  dataProposta: idx("Data da última proposta"),
  quadra: idx("Quadra"),
  lote: idx("Lote"),
  status: idx("Status de venda"),
  tempo: idx("Tempo da última proposta"),
  unidade: idx("Código da unidade"),
};
const faltando = Object.entries(COL).filter(([, i]) => i < 0);
if (faltando.length > 0) {
  console.error(`O CSV não tem as colunas: ${faltando.map(([k]) => k).join(", ")}`);
  process.exit(1);
}

// "IMO402 - MOURA NEGOCIOS IMOBILIARIOS" -> nome legível; "CLI3885 - JONATA" -> só o nome. O
// código serve ao sistema, não a quem lê a lista impressa.
const semCodigo = (v) => String(v ?? "").replace(/^\s*(?:IMO|CLI|COR)\d+\s*-\s*/i, "").trim() || "—";

const registros = linhasCsv
  .slice(1)
  .map((l) => l.split(";"))
  .filter((c) => (c[COL.status] ?? "").trim() === STATUS_DO_RELATORIO)
  .map((c) => ({
    cliente: semCodigo(c[COL.cliente]),
    dataProposta: (c[COL.dataProposta] ?? "").trim() || "—",
    imobiliaria: semCodigo(c[COL.corretorImob]),
    lote: (c[COL.lote] ?? "").trim(),
    quadra: (c[COL.quadra] ?? "").trim(),
    status: (c[COL.status] ?? "").trim(),
    tempo: (c[COL.tempo] ?? "").trim() || "—",
    unidade: (c[COL.unidade] ?? "").trim(),
  }))
  // Agrupado por imobiliária e, dentro dela, por cliente: é como o coordenador cobra.
  .sort(
    (a, b) =>
      a.imobiliaria.localeCompare(b.imobiliaria, "pt-BR") ||
      a.cliente.localeCompare(b.cliente, "pt-BR") ||
      a.unidade.localeCompare(b.unidade),
  );

if (registros.length === 0) {
  console.log(`Nenhuma unidade com status "${STATUS_DO_RELATORIO}".`);
  process.exit(0);
}

// "02:31:46" -> segundos, só para destacar quem passou de 3h.
const horasDe = (hms) => {
  const m = String(hms).match(/^(\d+):(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) + Number(m[2]) / 60 : 0;
};

// ── PDF ───────────────────────────────────────────────────────────────────
const pdf = await PDFDocument.create();
const fonte = await pdf.embedFont(StandardFonts.Helvetica);
const fonteBold = await pdf.embedFont(StandardFonts.HelveticaBold);

const LARGURA = 842; // A4 paisagem
const ALTURA = 595;
const MARGEM = 32;
const TINTA = rgb(0.1, 0.1, 0.12);
const FRACO = rgb(0.45, 0.45, 0.5);
const LINHA = rgb(0.86, 0.86, 0.88);
const ZEBRA = rgb(0.965, 0.965, 0.975);
const DOURADO = rgb(0.66, 0.53, 0.29);
const ALERTA = rgb(0.7, 0.2, 0.15);

const COLUNAS = [
  { chave: "imobiliaria", titulo: "IMOBILIÁRIA", x: MARGEM, largura: 215 },
  { chave: "cliente", titulo: "CLIENTE", x: MARGEM + 222, largura: 235 },
  { chave: "unidade", titulo: "UNIDADE", x: MARGEM + 464, largura: 72 },
  { chave: "status", titulo: "STATUS", x: MARGEM + 543, largura: 66 },
  { chave: "dataProposta", titulo: "DATA DA PROPOSTA", x: MARGEM + 616, largura: 96 },
  { chave: "tempo", titulo: "TEMPO DA ÚLT. PROPOSTA", x: MARGEM + 706, largura: 72 },
];

const cortar = (texto, largura, tamanho, f = fonte) => {
  let t = String(texto ?? "");
  if (f.widthOfTextAtSize(t, tamanho) <= largura) return t;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, tamanho) > largura) t = t.slice(0, -1);
  return `${t}...`;
};

const geradoEm = new Date().toLocaleString("pt-BR");
const clientesDistintos = new Set(registros.map((r) => r.cliente)).size;

let pagina = null;
let y = 0;
const paginas = [];

// CABEÇALHO EM TODAS AS PÁGINAS (pedido do Lucas).
const novaPagina = () => {
  pagina = pdf.addPage([LARGURA, ALTURA]);
  paginas.push(pagina);

  pagina.drawText("RESERVAS · VALE DO OURO", {
    color: DOURADO, font: fonteBold, size: 9, x: MARGEM, y: ALTURA - 34,
  });
  pagina.drawText("Unidades reservadas por cliente", {
    color: TINTA, font: fonteBold, size: 17, x: MARGEM, y: ALTURA - 56,
  });
  pagina.drawText(
    `${registros.length} unidades · ${clientesDistintos} clientes · status ${STATUS_DO_RELATORIO} · gerado em ${geradoEm}`,
    { color: FRACO, font: fonte, size: 9, x: MARGEM, y: ALTURA - 71 },
  );

  const yCab = ALTURA - 96;
  pagina.drawLine({
    color: TINTA, end: { x: LARGURA - MARGEM, y: yCab + 13 }, start: { x: MARGEM, y: yCab + 13 }, thickness: 1.2,
  });
  for (const col of COLUNAS) {
    pagina.drawText(cortar(col.titulo, col.largura, 7, fonteBold), {
      color: FRACO, font: fonteBold, size: 7, x: col.x, y: yCab,
    });
  }
  pagina.drawLine({
    color: LINHA, end: { x: LARGURA - MARGEM, y: yCab - 7 }, start: { x: MARGEM, y: yCab - 7 }, thickness: 0.6,
  });
  y = yCab - 22;
};

novaPagina();

const ALTURA_LINHA = 16.5;
let zebra = false;
let imobAnterior = null;

for (const r of registros) {
  if (y < MARGEM + 24) {
    novaPagina();
    imobAnterior = null; // o nome da imobiliária se repete no topo da página nova
  }

  // Troca de imobiliária: um respiro e a zebra reinicia, para o olho achar o bloco.
  if (r.imobiliaria !== imobAnterior) {
    if (imobAnterior !== null) y -= 5;
    if (y < MARGEM + 24) novaPagina();
    imobAnterior = r.imobiliaria;
    zebra = false;
  }

  if (zebra) {
    pagina.drawRectangle({
      color: ZEBRA, height: ALTURA_LINHA - 3.5, width: LARGURA - MARGEM * 2 + 8, x: MARGEM - 4, y: y - 4,
    });
  }
  zebra = !zebra;

  for (const col of COLUNAS) {
    const ehTempo = col.chave === "tempo";
    const destaque = ehTempo && horasDe(r.tempo) >= 3;
    pagina.drawText(cortar(r[col.chave], col.largura, 8.5, ehTempo ? fonteBold : fonte), {
      color: destaque ? ALERTA : TINTA,
      font: ehTempo || col.chave === "unidade" ? fonteBold : fonte,
      size: 8.5,
      x: col.x,
      y,
    });
  }
  y -= ALTURA_LINHA;
}

paginas.forEach((p, i) => {
  p.drawText(`Página ${i + 1} de ${paginas.length}`, {
    color: FRACO, font: fonte, size: 7.5, x: LARGURA - MARGEM - 62, y: MARGEM - 12,
  });
  p.drawText("Panteon · Prometeu · dados do C2X", {
    color: FRACO, font: fonte, size: 7.5, x: MARGEM, y: MARGEM - 12,
  });
});

const saida = path.join(casa, "Desktop", "RESERVAS_VALE_DO_OURO.pdf");
fs.writeFileSync(saida, await pdf.save());

const porImob = {};
for (const r of registros) porImob[r.imobiliaria] = (porImob[r.imobiliaria] ?? 0) + 1;
console.log(`\nUnidades reservadas: ${registros.length} · clientes: ${clientesDistintos}`);
console.log(`Imobiliárias: ${Object.keys(porImob).length} · páginas: ${paginas.length}`);
console.log("\nTop imobiliárias:");
for (const [nome, n] of Object.entries(porImob).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
  console.log(`  ${String(n).padStart(3)} · ${nome}`);
}
console.log(`\nArquivo: ${saida}`);
