// SONDA read-only da API do D4Sign (https://secure.d4sign.com.br/api/v1).
//
// Objetivo: descobrir se dá para LISTAR status de muitos documentos numa chamada só
// (ou se é 1 GET por documento), medir o custo real de cada chamada e catalogar os
// campos que voltam — para decidir se a tela de contratos do portal do incorporador
// pode ser servida direto da API ou precisa de cache/sincronização.
//
// ⚠️ READ-ONLY: só GET. Nada de POST/PUT/DELETE aqui.
// ⚠️ CREDENCIAL: tokenAPI e cryptKey saem de apps/hub/.env.local e NUNCA são impressos.
// ⚠️ PRIVACIDADE: CPF, e-mail, nome, IP e geolocalização do assinante são mascarados
//    na saída — inclusive nos JSONs de evidência gravados em disco.
//
//   node scripts/apolo/sonda-d4sign-api.mjs <pasta-de-saida>
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

const TOKEN = env.D4SIGN_TOKEN_API;
const CRYPT = env.D4SIGN_CRYPT_KEY;
if (!TOKEN || !CRYPT) {
  console.error("credenciais D4Sign ausentes no .env.local");
  process.exit(1);
}
const BASE = "https://secure.d4sign.com.br/api/v1";
const auth = () => new URLSearchParams({ cryptKey: CRYPT, tokenAPI: TOKEN }).toString();

const linhas = [];
const diz = (t) => {
  linhas.push(t);
  console.log(t);
};

// ── mascaramento: nada sensível vai para o relatório ────────────────────────
const mascararCpf = (v) => String(v ?? "").replace(/\d(?=\d{2})/g, "x");
const mascararEmail = (v) => {
  const s = String(v ?? "");
  const i = s.indexOf("@");
  return i < 1 ? "xxx" : s[0] + "xxx@xxx" + s.slice(s.lastIndexOf("."));
};
const mascararNome = (v) => {
  const p = String(v ?? "").trim().split(/\s+/);
  return p.length > 1 ? p[0] + " " + p[1][0] + "xxx" : String(v ?? "?")[0] + "xxx";
};
const mascararValor = (chave, valor) => {
  if (valor == null) return valor;
  const k = String(chave).toLowerCase();
  if (k.includes("document") && /^[\d.\-/]+$/.test(String(valor))) return mascararCpf(valor);
  if (k.includes("email")) return mascararEmail(valor);
  if (k.includes("geolocation") || k === "ip" || k.includes("user_agent") || k.includes("agent"))
    return "<mascarado>";
  if (k === "user_name" || k === "display_name" || k === "name_signer") return mascararNome(valor);
  return valor;
};
const mascararProfundo = (v) => {
  if (Array.isArray(v)) return v.map(mascararProfundo);
  if (v && typeof v === "object") {
    const o = {};
    for (const [k, val] of Object.entries(v)) {
      o[k] = val && typeof val === "object" ? mascararProfundo(val) : mascararValor(k, val);
    }
    return o;
  }
  return v;
};

// ── chamada instrumentada ───────────────────────────────────────────────────
async function pegar(caminho) {
  const url = BASE + caminho + (caminho.includes("?") ? "&" : "?") + auth();
  const t0 = performance.now();
  let resp;
  let texto;
  try {
    resp = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
    texto = await resp.text();
  } catch (e) {
    return { erro: String(e && e.message ? e.message : e), ms: Math.round(performance.now() - t0), status: 0 };
  }
  const ms = Math.round(performance.now() - t0);
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    /* pode vir HTML de erro */
  }
  const cabecalhos = {};
  for (const [k, v] of resp.headers.entries()) {
    if (/rate|limit|retry|remaining|quota/i.test(k)) cabecalhos[k] = v;
  }
  return { cabecalhos, json, ms, status: resp.status, texto: json ? null : String(texto).slice(0, 300) };
}

const resumo = (r) => "HTTP " + r.status + " em " + r.ms + "ms" + (r.erro ? " (erro: " + r.erro + ")" : "");
const forma = (j) => {
  if (Array.isArray(j)) return "array[" + j.length + "]";
  if (j && typeof j === "object") return "objeto{" + Object.keys(j).slice(0, 10).join(",") + "}";
  return String(j);
};

// ── 0. uuidDocs REAIS do C2X, em estados diferentes ─────────────────────────
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const [amostra] = await c.query(
  "select contract_signature_status_id st, uuidDoc, uuidSafe, uuidFolder" +
    "  from contract_signatures" +
    " where uuidDoc is not null and uuidDoc <> ''" +
    " group by contract_signature_status_id, uuidDoc, uuidSafe, uuidFolder",
);
await c.end();

const porStatus = new Map();
for (const a of amostra) {
  if (!porStatus.has(a.st)) porStatus.set(a.st, []);
  porStatus.get(a.st).push(a);
}
const NOME_STATUS_C2X = {
  1: "Processando",
  2: "Aguardando Signatarios",
  3: "Aguardando Assinaturas",
  4: "Finalizado",
  5: "Arquivado",
  6: "Cancelado",
  7: "Em aberto",
};
const cofre = (amostra.find((a) => a.uuidSafe) || {}).uuidSafe || null;

diz("# SONDA D4SIGN - evidencia de campo");
diz("");
diz("Data: " + new Date().toISOString());
diz("Base: " + BASE + " - autenticacao por query string (cryptKey + tokenAPI)");
diz("");
diz("## Amostra vinda do C2X");
for (const [st, lista] of [...porStatus].sort((a, b) => b[1].length - a[1].length)) {
  diz("- status " + st + " (" + (NOME_STATUS_C2X[st] || "?") + "): " + lista.length + " uuidDoc distintos");
}
diz("- cofre (uuidSafe) usado por todos: " + cofre);

// ── 1. ENDPOINTS DE LISTAGEM EM LOTE ────────────────────────────────────────
diz("");
diz("## 1. Endpoints de listagem em lote");
diz("");
const candidatos = [
  ["/documents", "lista geral de documentos"],
  ["/documents?pg=1", "lista geral, pagina 1"],
  ["/documents?pg=2", "lista geral, pagina 2"],
  ["/documents?pg=50", "lista geral, pagina 50 (fim?)"],
  ["/safes", "lista de cofres"],
  ["/documents/" + cofre + "/safe", "documentos do cofre"],
  ["/documents/" + cofre + "/safe?pg=1", "documentos do cofre, pagina 1"],
  ["/documents/" + cofre + "/safe?pg=2", "documentos do cofre, pagina 2"],
  ["/folders/" + cofre, "pastas do cofre"],
];
const achados = {};
for (const [caminho, desc] of candidatos) {
  const r = await pegar(caminho);
  achados[caminho] = r;
  diz("- `GET " + caminho.replace(cofre, "{uuidSafe}") + "` - " + desc + ": " + resumo(r) + " -> " + forma(r.json));
  if (r.texto) diz("    corpo nao-JSON: " + r.texto.replace(/\s+/g, " ").slice(0, 160));
  if (Array.isArray(r.json) && r.json.length) {
    diz("    chaves do 1o item: " + Object.keys(r.json[0]).join(", "));
  }
}
fs.writeFileSync(path.join(saida, "01-listagem.json"), JSON.stringify(mascararProfundo(achados), null, 2));

// ── 2. CUSTO: 1 chamada e 10 em sequência ───────────────────────────────────
diz("");
diz("## 2. Custo medido");
diz("");
const finalizados = (porStatus.get(4) || []).slice(0, 12);
const uma = await pegar("/documents/" + finalizados[0].uuidDoc);
diz("- uma chamada `/documents/{uuid}`: " + resumo(uma));
const tempos = [];
for (const d of finalizados.slice(0, 10)) {
  const r = await pegar("/documents/" + d.uuidDoc);
  tempos.push({ ms: r.ms, status: r.status });
}
const ms = tempos.map((t) => t.ms).sort((a, b) => a - b);
const soma = ms.reduce((s, v) => s + v, 0);
diz(
  "- 10 chamadas em sequencia: min " + ms[0] + "ms | mediana " + ms[Math.floor(ms.length / 2)] +
    "ms | media " + Math.round(soma / ms.length) + "ms | max " + ms[ms.length - 1] + "ms | total " + soma + "ms",
);
diz("- status devolvidos: " + JSON.stringify([...new Set(tempos.map((t) => t.status))]));
diz("- cabecalhos de rate limit vistos: " + JSON.stringify(uma.cabecalhos));
const dezList = [];
for (const d of finalizados.slice(0, 10)) {
  const r = await pegar("/documents/" + d.uuidDoc + "/list");
  dezList.push({ ms: r.ms, status: r.status });
}
const msL = dezList.map((t) => t.ms).sort((a, b) => a - b);
const somaL = msL.reduce((s, v) => s + v, 0);
diz(
  "- 10 chamadas `/list`: min " + msL[0] + "ms | mediana " + msL[Math.floor(msL.length / 2)] +
    "ms | media " + Math.round(somaL / msL.length) + "ms | max " + msL[msL.length - 1] + "ms | total " + somaL + "ms",
);
diz("- status `/list`: " + JSON.stringify([...new Set(dezList.map((t) => t.status))]));

// 5 chamadas em PARALELO, para ver se o servidor aceita concorrencia
const t0p = performance.now();
const paralelo = await Promise.all(
  finalizados.slice(0, 5).map((d) => pegar("/documents/" + d.uuidDoc)),
);
diz(
  "- 5 chamadas em PARALELO: " + Math.round(performance.now() - t0p) + "ms no total | status " +
    JSON.stringify([...new Set(paralelo.map((r) => r.status))]),
);

// ── 3. CAMPOS por estado ────────────────────────────────────────────────────
diz("");
diz("## 3. Campos por estado (C2X -> D4Sign)");
const porEstado = {};
for (const [st, lista] of porStatus) {
  const alvo = lista[0];
  const doc = await pegar("/documents/" + alvo.uuidDoc);
  const lst = await pegar("/documents/" + alvo.uuidDoc + "/list");
  porEstado[st] = { doc: mascararProfundo(doc.json), list: mascararProfundo(lst.json) };
  const d = Array.isArray(doc.json) ? doc.json[0] : doc.json;
  diz("");
  diz("### C2X status " + st + " (" + (NOME_STATUS_C2X[st] || "?") + ") - uuidDoc " + String(alvo.uuidDoc).slice(0, 8) + "...");
  diz(
    "- `/documents/{uuid}`: " + resumo(doc) + " -> statusId=" + (d && d.statusId) + " statusName=" +
      JSON.stringify(d && d.statusName),
  );
  diz("  chaves: " + (d ? Object.keys(d).join(", ") : "-"));
  if (d) diz("  statusComment=" + JSON.stringify(d.statusComment) + " whoCanceled=" + JSON.stringify(d.whoCanceled));
  const lj = Array.isArray(lst.json) ? lst.json[0] : lst.json;
  const signatarios = (lj && lj.list) || [];
  diz(
    "- `/documents/{uuid}/list`: " + resumo(lst) + " -> " + signatarios.length + " signatario(s); chaves: " +
      (signatarios[0] ? Object.keys(signatarios[0]).join(", ") : "-"),
  );
  for (const s of signatarios.slice(0, 5)) {
    diz(
      "    . " + mascararNome(s.user_name) + " | signed=" + JSON.stringify(s.signed) + " | doc=" +
        mascararCpf(s.user_document) + " | " + mascararEmail(s.email) + " | key=" + String(s.key_signer || "").slice(0, 6) + "...",
    );
    const extras = Object.keys(s).filter((k) => /date|hora|hour|time|order|sequen|type|status|act/i.test(k));
    if (extras.length) diz("      campos de data/ordem: " + extras.map((k) => k + "=" + JSON.stringify(s[k])).join(" "));
    if (s.sign_info) {
      const info = typeof s.sign_info === "string" ? s.sign_info : JSON.stringify(s.sign_info);
      diz("      sign_info (" + typeof s.sign_info + "): " + info.replace(/\s+/g, " ").slice(0, 400));
    }
  }
}
fs.writeFileSync(path.join(saida, "03-campos-por-estado.json"), JSON.stringify(porEstado, null, 2));

fs.writeFileSync(path.join(saida, "sonda-d4sign.md"), linhas.join("\n"));
console.log("");
console.log("-> " + path.join(saida, "sonda-d4sign.md"));
