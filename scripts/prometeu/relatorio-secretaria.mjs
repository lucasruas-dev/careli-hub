// RELATÓRIO DE QUEM ESTÁ NA SECRETARIA — PDF em paisagem, agrupado por imobiliária.
//
// Pedido do Lucas (01/08, durante o evento): "tira uma lista de quem está na secretária,
// imobiliária e cliente". Serve para o coordenador cobrar as imobiliárias com gente parada.
//
// A fonte aqui é o PROMETEU (`prometeu_credenciados` na etapa `secretaria`), e não o C2X — a
// diferença importa: o C2X sabe da RESERVA, o Prometeu sabe de QUEM ESTÁ NA SALA agora. Uma
// pessoa pode estar esperando na secretaria sem ter reserva ainda, e é justamente ela que o
// coordenador precisa enxergar.
//
// Uso (da raiz do repo):
//   node scripts/prometeu/relatorio-secretaria.mjs
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { PDFDocument, StandardFonts, rgb } = requireDoRepo("pdf-lib");

// A partir daqui a espera vira vermelho no papel: é o mesmo limite que a tela usa para alertar.
const ALERTA_MIN = 90;

const casa = process.env.USERPROFILE || process.env.HOME || ".";
const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const S = env.NEXT_PUBLIC_SUPABASE_URL;
const K = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;

const resp = await fetch(
  `${S}/rest/v1/prometeu_credenciados?select=nome,documento,imobiliaria,corretor,etapa_desde,metadata&etapa=eq.secretaria&encerrado_em=is.null&order=etapa_desde.asc`,
  { headers: { apikey: K, Authorization: `Bearer ${K}` } },
);
if (!resp.ok) {
  console.error(`Falha ao ler a fila: ${resp.status}`);
  process.exit(1);
}
const brutos = await resp.json();

// ── AS UNIDADES VÊM DO C2X, cruzadas por CPF ──────────────────────────────
// Pedido do Lucas: "cruza esse relatório para trazer a unidade de cada um". Pedido de aquisição
// ABERTO em qualquer etapa (Reservado, Contrato gerado, Proposta): quem está na secretaria está
// fechando, e a unidade dele pode já ter avançado de etapa — esconder o contrato gerado seria
// mentir que a pessoa está sem lote.
const mysql = requireDoRepo("mysql2/promise");
const conexaoC2x = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  dateStrings: true,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const [pedidosAbertos] = await conexaoC2x.query(
  `SELECT REPLACE(REPLACE(REPLACE(u.cpf,'.',''),'-',''),'/','') AS cpf,
          eu.name AS unidade,
          s.name  AS etapa_pedido
     FROM acquisition_requests ar
     JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
     JOIN acquisition_request_stages s ON s.id = ar.acquisition_request_stage_id
     LEFT JOIN users u ON u.id = ar.client_id
    WHERE eu.enterprise_id = 35 AND ar.open = 1
    ORDER BY eu.name`,
);
await conexaoC2x.end();

const unidadesPorCpf = new Map();
for (const p of pedidosAbertos) {
  if (!p.cpf) continue;
  const lista = unidadesPorCpf.get(p.cpf) ?? [];
  lista.push(p.unidade);
  unidadesPorCpf.set(p.cpf, lista);
}

const agora = Date.now();
const registros = brutos
  .map((r) => {
    const desde = new Date(r.etapa_desde);
    const cpf = String(r.documento ?? "").replace(/\D/g, "");
    return {
      cliente: String(r.nome ?? "").trim() || "—",
      corretor: String(r.corretor ?? "").trim() || "—",
      desde,
      horaEntrada: desde.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
      imobiliaria: String(r.imobiliaria ?? "").trim() || "(sem imobiliária)",
      minutos: Math.max(0, Math.floor((agora - desde.getTime()) / 60000)),
      // "—" aqui é informação, não ausência de dado: a pessoa está na secretaria SEM pedido
      // aberto no C2X, e é exatamente quem o coordenador precisa perguntar o que houve.
      unidades: (unidadesPorCpf.get(cpf) ?? []).join(", ") || "—",
    };
  })
  // Por imobiliária e, dentro dela, quem espera há mais tempo primeiro — é a ordem da cobrança.
  .sort(
    (a, b) =>
      a.imobiliaria.localeCompare(b.imobiliaria, "pt-BR") || b.minutos - a.minutos,
  );

if (registros.length === 0) {
  console.log("Ninguém na secretaria agora.");
  process.exit(0);
}

const tempoLegivel = (min) => (min < 60 ? `${min}min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`);

// ── PDF ───────────────────────────────────────────────────────────────────
const pdf = await PDFDocument.create();
const fonte = await pdf.embedFont(StandardFonts.Helvetica);
const fonteBold = await pdf.embedFont(StandardFonts.HelveticaBold);

const LARGURA = 842;
const ALTURA = 595;
const MARGEM = 32;
const TINTA = rgb(0.1, 0.1, 0.12);
const FRACO = rgb(0.45, 0.45, 0.5);
const LINHA = rgb(0.86, 0.86, 0.88);
const ZEBRA = rgb(0.965, 0.965, 0.975);
const DOURADO = rgb(0.66, 0.53, 0.29);
const ALERTA = rgb(0.7, 0.2, 0.15);

const COLUNAS = [
  { chave: "imobiliaria", titulo: "IMOBILIÁRIA", x: MARGEM, largura: 185 },
  { chave: "cliente", titulo: "CLIENTE", x: MARGEM + 192, largura: 215 },
  { chave: "unidades", titulo: "UNIDADE(S)", x: MARGEM + 414, largura: 135 },
  { chave: "corretor", titulo: "CORRETOR", x: MARGEM + 556, largura: 108 },
  { chave: "horaEntrada", titulo: "CHEGOU", x: MARGEM + 670, largura: 46 },
  { chave: "espera", titulo: "ESPERANDO", x: MARGEM + 722, largura: 58 },
];

const cortar = (texto, largura, tamanho, f = fonte) => {
  let t = String(texto ?? "");
  if (f.widthOfTextAtSize(t, tamanho) <= largura) return t;
  while (t.length > 1 && f.widthOfTextAtSize(`${t}...`, tamanho) > largura) t = t.slice(0, -1);
  return `${t}...`;
};

const emAlerta = registros.filter((r) => r.minutos >= ALERTA_MIN).length;
const geradoEm = new Date().toLocaleString("pt-BR");
const imobiliarias = new Set(registros.map((r) => r.imobiliaria)).size;

let pagina = null;
let y = 0;
const paginas = [];

const novaPagina = () => {
  pagina = pdf.addPage([LARGURA, ALTURA]);
  paginas.push(pagina);

  pagina.drawText("SECRETARIA · VALE DO OURO", {
    color: DOURADO, font: fonteBold, size: 9, x: MARGEM, y: ALTURA - 34,
  });
  pagina.drawText("Clientes aguardando atendimento", {
    color: TINTA, font: fonteBold, size: 17, x: MARGEM, y: ALTURA - 56,
  });
  pagina.drawText(
    `${registros.length} pessoas · ${imobiliarias} imobiliárias · ${emAlerta} esperando +${Math.floor(ALERTA_MIN / 60)}h30 · gerado em ${geradoEm}`,
    { color: FRACO, font: fonte, size: 9, x: MARGEM, y: ALTURA - 71 },
  );

  const yCab = ALTURA - 96;
  pagina.drawLine({
    color: TINTA, end: { x: LARGURA - MARGEM, y: yCab + 13 }, start: { x: MARGEM, y: yCab + 13 }, thickness: 1.2,
  });
  for (const col of COLUNAS) {
    pagina.drawText(col.titulo, { color: FRACO, font: fonteBold, size: 7, x: col.x, y: yCab });
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
    imobAnterior = null;
  }

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

  const atrasado = r.minutos >= ALERTA_MIN;
  const valores = { ...r, espera: tempoLegivel(r.minutos) };

  for (const col of COLUNAS) {
    const ehEspera = col.chave === "espera";
    const ehUnidade = col.chave === "unidades";
    pagina.drawText(cortar(valores[col.chave], col.largura, 8.5, ehEspera || ehUnidade ? fonteBold : fonte), {
      color: ehEspera && atrasado ? ALERTA : TINTA,
      font: ehEspera || ehUnidade ? fonteBold : fonte,
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
  p.drawText("Panteon · Prometeu · fila da secretaria", {
    color: FRACO, font: fonte, size: 7.5, x: MARGEM, y: MARGEM - 12,
  });
});

const saida = path.join(casa, "Desktop", "SECRETARIA_VALE_DO_OURO.pdf");
fs.writeFileSync(saida, await pdf.save());

const porImob = {};
for (const r of registros) porImob[r.imobiliaria] = (porImob[r.imobiliaria] ?? 0) + 1;
console.log(`Na secretaria: ${registros.length} · imobiliárias: ${imobiliarias} · +1h30: ${emAlerta}`);
console.log(`Páginas: ${paginas.length}`);
console.log("\nPor imobiliária:");
for (const [nome, n] of Object.entries(porImob).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)} · ${nome}`);
}
console.log(`\nArquivo: ${saida}`);
