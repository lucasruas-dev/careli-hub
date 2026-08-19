// RELATORIO FINAL da baixa do "Ato" de R$ 1.000 no Vale do Ouro (19/08/2026).
//
// Pedido do Lucas: "no final me faz um relatorio dos que foram baixados e os que estao pendente".
//
// ⚠️ READ-ONLY nos dois bancos. ⚠️ Credenciais do .env.local, nunca impressas.
// ⚠️ Os numeros saem do BANCO no momento da geracao, nao de um acumulado do que eu achei que fiz.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
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

const rest = async (caminho) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${caminho}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
};

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// As DUAS rodadas: a primeira casou a pessoa pela tabela de sync do Panteon, a segunda por CPF —
// e foi a segunda que recuperou quem não tinha linha de sync (o caso da LIDIA, VOL0411).
const baixadas = [
  ...JSON.parse(fs.readFileSync("scripts/apolo/baixa-ato-1000-conferidas.json", "utf8")),
  ...JSON.parse(fs.readFileSync("scripts/apolo/baixa-rodada2-conferidas.json", "utf8")),
];

// 1. O estado REAL das 65 no C2X.
const [feitas] = await c.query(
  `select p.id, concat(e.code, u.block, u.lot) unidade, ps.name situacao,
          date_format(p.payment_date, '%d/%m/%Y') pago_em, p.paid_value
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where p.id in (?)
    order by concat(e.code, u.block, u.lot)`,
  [baixadas.map((b) => b.paymentId)],
);

// 2. O que continua VENCIDO no Vale do Ouro depois da operacao.
const [vencidos] = await c.query(
  `select concat(e.code, u.block, u.lot) unidade, p.id,
          date_format(p.due_date, '%d/%m/%Y') vence, ar.client_id
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
    where e.code in ('VOC','VOL','VLO','VOR') and pt.name like '%to%'
      and p.initial_value = 1000 and p.payment_date is null and p.due_date < curdate()
    order by concat(e.code, u.block, u.lot)`,
);

// 3. Quem pagou PIX no Panteon (para separar "vencido com PIX" de "vencido sem nenhum registro").
const esteira = await rest(
  "apolo_esteira?empreendimento=eq.VALE%20DO%20OURO&pago_em=not.is.null&select=entity_id,pago_em,pagamento_ref&limit=1000",
);
// ⚠️ PAGINADO e por CPF. Ver o comentário em cruzar-por-cpf.mjs: casar pela tabela de sync perde
// quem nunca foi sincronizado, e um limit curto corta o resto.
const entidades = [];
for (let inicio = 0; ; inicio += 1000) {
  const pagina = await rest(`apolo_entities?select=id,document_masked&order=id&offset=${inicio}&limit=1000`);
  entidades.push(...pagina);
  if (pagina.length < 1000) break;
}
const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");
const cpfPorEntity = new Map(entidades.map((e) => [e.id, soDigitos(e.document_masked)]));
const pagouPix = new Map();
for (const e of esteira) {
  const cpf = cpfPorEntity.get(e.entity_id);
  if (cpf) pagouPix.set(cpf, { pagoEm: e.pago_em?.slice(0, 10), ref: e.pagamento_ref });
}

const [cpfs] = await c.query(
  "select id, replace(replace(replace(cpf,'.',''),'-',''),' ','') cpf from users where id in (?)",
  [[...new Set(vencidos.map((v) => Number(v.client_id)))]],
);
const cpfPorUser = new Map(cpfs.map((u) => [Number(u.id), u.cpf]));
const temPix = (v) => pagouPix.has(cpfPorUser.get(Number(v.client_id)) ?? "");

const comPix = vencidos.filter(temPix);
const semPix = vencidos.filter((v) => !temPix(v));

// ── SAIDA ───────────────────────────────────────────────────────────────────
const brl = (v) => "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
const ok = feitas.filter((f) => f.situacao === "Pago" && f.pago_em);

console.log("# RELATORIO — BAIXA DO ATO DE R$ 1.000 · VALE DO OURO · 19/08/2026");
console.log("");
console.log("## BAIXADOS");
console.log("  unidades baixadas .......: " + ok.length);
console.log("  valor total .............: " + brl(ok.reduce((s, f) => s + Number(f.paid_value), 0)));
console.log("  todas com status Pago ...: " + (ok.length === feitas.length ? "sim" : "NAO"));
console.log("  todas com data do PIX ...: " + (feitas.every((f) => f.pago_em) ? "sim" : "NAO"));
console.log("");
console.log("## PENDENTES (seguem vencidos no C2X)");
console.log("  total ainda vencido .....: " + vencidos.length + "  (" + brl(vencidos.length * 1000) + ")");
console.log("  COM PIX pago no Panteon .: " + comPix.length + "  <- decisao sua (PIX dividido entre lotes)");
console.log("  SEM registro de pagamento: " + semPix.length + "  <- nao ha prova de pagamento");

const linhas = [
  "situacao;unidade;payment_id;detalhe",
  ...ok.map((f) => `BAIXADO;${f.unidade};${f.id};pago em ${f.pago_em} · ${brl(f.paid_value)}`),
  ...comPix.map((v) => {
    const pix = pagouPix.get(cpfPorUser.get(Number(v.client_id)) ?? "") ?? {};
    return `PENDENTE - PIX COMPARTILHADO;${v.unidade};${v.id};venceu ${v.vence} · PIX ${pix.ref ?? "?"} pago em ${pix.pagoEm ?? "?"}`;
  }),
  ...semPix.map((v) => `PENDENTE - SEM PAGAMENTO;${v.unidade};${v.id};venceu ${v.vence} · nenhum PIX localizado`),
];

const destino = path.resolve(
  process.env.USERPROFILE || process.env.HOME || ".",
  "Desktop",
  "RELATORIO_BAIXA_VALE_DO_OURO_FINAL.csv",
);
fs.writeFileSync(destino, "﻿" + linhas.join("\r\n"), "utf8");
console.log("");
console.log("planilha: " + destino);
await c.end();
