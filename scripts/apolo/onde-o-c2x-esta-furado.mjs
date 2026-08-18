// Onde o C2X está furado, POR EMPREENDIMENTO — sem precisar do /list.
//
// A régua: documento que a D4Sign diz FINALIZADO tem, por definição, todas as assinaturas
// colhidas. Se o C2X ainda marca aquele envio como "em aberto" (7) ou "aguardando" (3), toda linha
// pendente dele é pendência que não existe. Isso sai do CATÁLOGO em lote (8 páginas, ~3 s), sem uma
// chamada por documento — então dá para varrer o acervo INTEIRO, não só um recorte.
//
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa. ⚠️ Nenhum dado pessoal na saída.
//
//   node scripts/apolo/onde-o-c2x-esta-furado.mjs
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

const BASE = "https://secure.d4sign.com.br/api/v1";
const url = (rota) =>
  BASE + rota + (rota.includes("?") ? "&" : "?") +
  "tokenAPI=" + env.D4SIGN_TOKEN_API + "&cryptKey=" + env.D4SIGN_CRYPT_KEY;

// ── 1. O catálogo inteiro da D4Sign ──
const catalogo = new Map();
for (let pg = 1; pg <= 40; pg += 1) {
  let corpo = null;
  try {
    const r = await fetch(url("/documents?pg=" + pg), { signal: AbortSignal.timeout(20000) });
    corpo = r.ok ? await r.json() : null;
  } catch {
    corpo = null;
  }
  const itens = (Array.isArray(corpo) ? corpo : []).filter((x) => x && x.uuidDoc);
  for (const d of itens) catalogo.set(d.uuidDoc, Number(d.statusId));
  if (itens.length === 0) break;
}
console.log("catalogo D4Sign: " + catalogo.size + " documentos");

// ── 2. Todos os envios do C2X, com as linhas pendentes de cada um ──
const conexao = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [linhas] = await conexao.query(
  "select cs.id envio, cs.uuidDoc uuid, cs.contract_signature_status_id st,\n" +
    "       e.code emp, e.name empNome, count(*) total,\n" +
    "       sum(case when ss.signed = 1 then 1 else 0 end) assinadas\n" +
    "  from contract_signatures cs\n" +
    "  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id\n" +
    "  join acquisition_requests ar on ar.id = arc.acquisition_request_id\n" +
    "  join enterprise_unities u on u.id = ar.enterprise_unity_id\n" +
    "  join enterprises e on e.id = u.enterprise_id\n" +
    "  join contract_signature_signers ss on ss.contract_signature_id = cs.id\n" +
    " where cs.send_document_signature = 1\n" +
    "   and cs.contract_signature_status_id <> 6\n" +
    "   and cs.uuidDoc is not null and cs.uuidDoc <> ''\n" +
    " group by cs.id, cs.uuidDoc, cs.contract_signature_status_id, e.code, e.name",
);
await conexao.end();

// ── 3. Onde o C2X mostra pendência que a D4Sign já fechou ──
const porEmp = new Map();
let totalFalsas = 0;
let totalEnvios = 0;
let canceladosVivos = 0;
let foraDoCatalogo = 0;

for (const l of linhas) {
  const st = catalogo.get(l.uuid);
  const alvo = porEmp.get(l.emp) ?? {
    canceladas: 0,
    envios: 0,
    falsas: 0,
    finalizadosAbertos: 0,
    nome: l.empNome,
    pendentes: 0,
  };
  alvo.envios += 1;
  const pendentes = Number(l.total) - Number(l.assinadas);
  alvo.pendentes += pendentes;
  totalEnvios += 1;

  if (st === undefined) {
    foraDoCatalogo += 1;
  } else if (st === 6) {
    // A D4Sign cancelou e o C2X não sabe: o envio inteiro é pendência fantasma.
    alvo.canceladas += pendentes;
    canceladosVivos += 1;
  } else if ((st === 4 || st === 5) && pendentes > 0) {
    // Finalizado na D4Sign = todos assinaram. Toda linha pendente aqui é falsa.
    alvo.falsas += pendentes;
    alvo.finalizadosAbertos += 1;
    totalFalsas += pendentes;
  }
  porEmp.set(l.emp, alvo);
}

console.log("envios do C2X com uuid: " + totalEnvios + " | fora do catalogo: " + foraDoCatalogo);
console.log("");
console.log("=== PENDENCIA QUE NAO EXISTE, por empreendimento ===");
console.log("(finalizado no D4Sign e ainda pendente no C2X)");
console.log("");
console.log(
  "emp".padEnd(7) + "envios".padStart(7) + "pendentes".padStart(11) +
    "FALSAS".padStart(9) + "docs".padStart(6) + "  cancelados(linhas)",
);
const ordenado = [...porEmp.entries()].sort((a, b) => b[1].falsas - a[1].falsas);
for (const [code, v] of ordenado) {
  if (v.falsas === 0 && v.canceladas === 0) continue;
  console.log(
    String(code).padEnd(7) + String(v.envios).padStart(7) + String(v.pendentes).padStart(11) +
      String(v.falsas).padStart(9) + String(v.finalizadosAbertos).padStart(6) +
      "  " + v.canceladas,
  );
}
console.log("");
console.log("TOTAL de assinaturas cobradas indevidamente: " + totalFalsas);
console.log("envios que a D4Sign cancelou e o C2X mostra vivos: " + canceladosVivos);
console.log("");
console.log("=== os empreendimentos LIMPOS (C2X batendo com a D4Sign) ===");
const limpos = ordenado.filter(([, v]) => v.falsas === 0 && v.canceladas === 0);
console.log(limpos.length === 0 ? "  (nenhum)" : "  " + limpos.map(([c]) => c).join(", "));
const todosLimpos = [...porEmp.entries()].filter(([, v]) => v.falsas === 0 && v.canceladas === 0);
console.log("  total: " + todosLimpos.length + " de " + porEmp.size + " empreendimentos");
