// SONDA read-only parte 2: a LISTAGEM em lote do D4Sign e a divergencia contra o C2X.
//
// A parte 1 (sonda-d4sign-api.mjs) mostrou que `GET /documents` responde 200 com
// 501 itens: o item [0] e um cabecalho de paginacao. Aqui a gente abre esse formato,
// varre o catalogo inteiro (poucas paginas), e cruza com os uuidDoc do C2X para medir
// o tamanho real do buraco de status.
//
// ⚠️ READ-ONLY. ⚠️ Credenciais nunca impressas. ⚠️ Nada sensivel na saida.
//
//   node scripts/apolo/sonda-d4sign-listagem.mjs <pasta-de-saida>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

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

const saida = process.argv[2];
if (!saida) {
  console.error("informe a pasta de saída");
  process.exit(1);
}
fs.mkdirSync(saida, { recursive: true });

const BASE = "https://secure.d4sign.com.br/api/v1";
const auth = () => new URLSearchParams({ cryptKey: env.D4SIGN_CRYPT_KEY, tokenAPI: env.D4SIGN_TOKEN_API }).toString();

const linhas = [];
const diz = (t) => {
  linhas.push(t);
  console.log(t);
};

async function pegar(caminho) {
  const t0 = performance.now();
  const resp = await fetch(BASE + caminho + (caminho.includes("?") ? "&" : "?") + auth(), {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  const texto = await resp.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    /* html de erro */
  }
  return { json, ms: Math.round(performance.now() - t0), status: resp.status, texto: json ? null : texto.slice(0, 200) };
}

diz("# SONDA D4SIGN parte 2 - listagem em lote e divergencia");
diz("");

// ── 1. A forma da listagem ──────────────────────────────────────────────────
const p1 = await pegar("/documents?pg=1");
const cabec = p1.json[0];
const primeiroDoc = p1.json[1];
diz("## 1. Forma de `GET /documents?pg=N`");
diz("");
diz("- HTTP " + p1.status + " em " + p1.ms + "ms");
diz("- item [0] = cabecalho de paginacao: " + JSON.stringify(cabec));
diz("- itens [1..N] = documentos. Chaves de um documento:");
diz("  " + Object.keys(primeiroDoc).join(", "));
diz("- exemplo (nome do arquivo truncado, e um contrato real):");
for (const [k, v] of Object.entries(primeiroDoc)) {
  const val = k === "nameDoc" ? String(v).slice(0, 18) + "..." : v;
  diz("    " + k.padEnd(16) + " = " + JSON.stringify(val));
}

// ── 2. Varredura do catalogo inteiro ────────────────────────────────────────
diz("");
diz("## 2. Catalogo inteiro (todas as paginas)");
diz("");
const totalPaginas = Number(cabec.total_pages);
const totalDocs = Number(cabec.total_documents);
diz("- total_documents = " + totalDocs + " | total_pages = " + totalPaginas + " | por pagina = " + cabec.total_in_this_page);
const t0 = performance.now();
const catalogo = new Map();
const temposPagina = [];
for (let pg = 1; pg <= totalPaginas; pg += 1) {
  const r = await pegar("/documents?pg=" + pg);
  temposPagina.push(r.ms);
  if (r.status !== 200 || !Array.isArray(r.json)) {
    diz("- pagina " + pg + ": HTTP " + r.status + " (parou aqui)");
    break;
  }
  for (const d of r.json.slice(1)) if (d && d.uuidDoc) catalogo.set(d.uuidDoc, d);
}
const msTotal = Math.round(performance.now() - t0);
diz(
  "- varredura completa: " + temposPagina.length + " chamadas em " + msTotal + "ms (" +
    Math.round(msTotal / 1000) + "s) | media " + Math.round(temposPagina.reduce((s, v) => s + v, 0) / temposPagina.length) + "ms por pagina",
);
diz("- documentos unicos coletados: " + catalogo.size);
const porStatusD4 = {};
for (const d of catalogo.values()) {
  const chave = d.statusId + " " + d.statusName;
  porStatusD4[chave] = (porStatusD4[chave] || 0) + 1;
}
diz("- distribuicao de status no D4Sign (catalogo inteiro):");
for (const [k, v] of Object.entries(porStatusD4).sort((a, b) => b[1] - a[1])) diz("    " + k.padEnd(28) + v);

// ── 3. Cruzamento com o C2X ─────────────────────────────────────────────────
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const [linhasC2x] = await c.query(
  "select cs.uuidDoc, max(cs.contract_signature_status_id) st, e.id emp, e.name empNome" +
    "  from contract_signatures cs" +
    "  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id" +
    "  join acquisition_requests ar on ar.id = arc.acquisition_request_id" +
    "  join enterprise_unities eu on eu.id = ar.enterprise_unity_id" +
    "  join enterprises e on e.id = eu.enterprise_id" +
    " where cs.uuidDoc is not null and cs.uuidDoc <> ''" +
    " group by cs.uuidDoc, e.id, e.name",
);
await c.end();

const NOME = { 1: "Processando", 2: "Aguard.Signatarios", 3: "Aguard.Assinaturas", 4: "Finalizado", 5: "Arquivado", 6: "Cancelado", 7: "Em aberto" };
const EQUIV = { 3: 3, 4: 4, 6: 6, 7: null };

diz("");
diz("## 3. Divergencia C2X x D4Sign (todos os uuidDoc do C2X)");
diz("");
let achados = 0;
let ausentes = 0;
let iguais = 0;
const matriz = {};
for (const l of linhasC2x) {
  const d = catalogo.get(l.uuidDoc);
  if (!d) {
    ausentes += 1;
    continue;
  }
  achados += 1;
  const chave = "C2X " + l.st + " " + (NOME[l.st] || "?") + "  ->  D4S " + d.statusId + " " + d.statusName;
  matriz[chave] = (matriz[chave] || 0) + 1;
  if (EQUIV[l.st] === Number(d.statusId)) iguais += 1;
}
diz("- uuidDoc do C2X: " + linhasC2x.length + " | encontrados no catalogo D4Sign: " + achados + " | AUSENTES: " + ausentes);
diz("- status batendo: " + iguais + " (" + Math.round((iguais / achados) * 100) + "%) | DIVERGENTES: " + (achados - iguais));
diz("- matriz de transicao:");
for (const [k, v] of Object.entries(matriz).sort((a, b) => b[1] - a[1])) {
  diz("    " + k.padEnd(58) + v);
}

// ── 4. Escopo que interessa (empreendimentos do portal) ─────────────────────
const ESCOPO = { 27: "LAGOA BONITA", 29: "VISTA ALEGRE", 31: "LAGOA BONITA MASTERPLAN", 32: "LAGOA BONITA", 33: "LAGOA BONITA", 35: "VALE DO OURO (VLO)", 36: "VALE DO OURO (VOL)", 37: "VALE DO OURO (VOC)", 39: "GARDEN", 41: "VALE DO OURO EXTRAS" };
diz("");
diz("## 4. Escopo do portal (VAL, LBF/LBR/LBP, VOC/VOL/VLO, GDN)");
diz("");
const porEmp = {};
for (const l of linhasC2x) {
  if (!ESCOPO[l.emp]) continue;
  const d = catalogo.get(l.uuidDoc);
  const k = l.emp + " " + l.empNome;
  porEmp[k] = porEmp[k] || { docs: 0, noD4: 0, d4: {}, divergentes: 0 };
  porEmp[k].docs += 1;
  if (d) {
    porEmp[k].noD4 += 1;
    porEmp[k].d4[d.statusName] = (porEmp[k].d4[d.statusName] || 0) + 1;
    if (EQUIV[l.st] !== Number(d.statusId)) porEmp[k].divergentes += 1;
  }
}
let totalEscopo = 0;
for (const [k, v] of Object.entries(porEmp).sort((a, b) => b[1].docs - a[1].docs)) {
  totalEscopo += v.docs;
  diz("- " + k.padEnd(26) + " docs=" + String(v.docs).padStart(4) + " noD4Sign=" + String(v.noD4).padStart(4) + " divergentes=" + String(v.divergentes).padStart(4) + "  " + JSON.stringify(v.d4));
}
diz("- TOTAL do escopo: " + totalEscopo + " documentos");

// ── 5. Endpoints extras ─────────────────────────────────────────────────────
diz("");
diz("## 5. Outros endpoints testados");
diz("");
const cofres = await pegar("/safes");
diz("- `GET /safes`: HTTP " + cofres.status + " em " + cofres.ms + "ms -> " + (Array.isArray(cofres.json) ? cofres.json.length + " cofres" : "?"));
const alvo = [...catalogo.values()][0];
for (const caminho of [
  "/documents/" + alvo.uuidDoc + "/webhooks",
  "/documents/" + alvo.uuidDoc + "/status",
  "/documents/" + alvo.uuidDoc + "/logs",
  "/account/balance",
]) {
  const r = await pegar(caminho);
  diz(
    "- `GET " + caminho.replace(alvo.uuidDoc, "{uuid}") + "`: HTTP " + r.status + " em " + r.ms + "ms -> " +
      (Array.isArray(r.json) ? "array[" + r.json.length + "] chaves=" + (r.json[0] ? Object.keys(r.json[0]).join("|") : "-") : r.json ? "objeto{" + Object.keys(r.json).join(",") + "}" : String(r.texto || "").replace(/\s+/g, " ").slice(0, 120)),
  );
}

fs.writeFileSync(path.join(saida, "sonda-d4sign-listagem.md"), linhas.join("\n"));
fs.writeFileSync(
  path.join(saida, "02-catalogo-status.json"),
  JSON.stringify({ porStatusD4, total: catalogo.size, totalDocs, totalPaginas }, null, 2),
);
console.log("");
console.log("-> " + path.join(saida, "sonda-d4sign-listagem.md"));
