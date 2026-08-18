// SONDA read-only parte 3: detalhes que decidem o desenho.
//
//  a) `/documents/{uuidSafe}/safe` filtra mesmo pelo cofre? (reduz o catalogo)
//  b) existe webhook cadastrado no D4Sign? (o C2X tem create_webhook=0 em 100% das linhas)
//  c) o payload completo de `/documents/{uuid}/list`: o que e publico e o que e sensivel
//  d) o documento do C2X que NAO existe no catalogo do D4Sign
//
// ⚠️ READ-ONLY. ⚠️ Credenciais nunca impressas. ⚠️ Nada sensivel na saida.
//
//   node scripts/apolo/sonda-d4sign-detalhe.mjs <pasta-de-saida>
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
    /* html */
  }
  return { json, ms: Math.round(performance.now() - t0), status: resp.status, texto: json ? null : texto.slice(0, 200) };
}

const COFRE = "f1911d72-516e-429c-a0c9-fe00d670984d";
diz("# SONDA D4SIGN parte 3 - detalhes de desenho");
diz("");

// ── a) filtro por cofre ─────────────────────────────────────────────────────
diz("## a) `/documents/{uuidSafe}/safe` filtra pelo cofre?");
diz("");
const geral = await pegar("/documents?pg=1");
const doCofre = await pegar("/documents/" + COFRE + "/safe?pg=1");
diz("- `GET /documents?pg=1`         cabecalho: " + JSON.stringify(geral.json[0]));
diz("- `GET /documents/{safe}/safe`  cabecalho: " + JSON.stringify(doCofre.json[0]));
const cofresDistintos = new Set(doCofre.json.slice(1).map((d) => d.uuidSafe));
diz("- cofres distintos dentro da resposta filtrada: " + cofresDistintos.size + " -> " + (cofresDistintos.size === 1 ? "FILTRA de verdade" : "NAO filtra"));
diz("- safeName visto: " + JSON.stringify([...new Set(doCofre.json.slice(1).map((d) => d.safeName))]));

// ── b) webhook ──────────────────────────────────────────────────────────────
diz("");
diz("## b) webhook cadastrado no D4Sign");
diz("");
const algum = geral.json[1];
const wh = await pegar("/documents/" + algum.uuidDoc + "/webhooks");
const mascararUrl = (u) => {
  try {
    const x = new URL(String(u));
    return x.protocol + "//" + x.hostname + x.pathname.replace(/[^/]/g, "x");
  } catch {
    return "<nao-e-url>";
  }
};
diz("- `GET /documents/{uuid}/webhooks`: HTTP " + wh.status + " em " + wh.ms + "ms");
if (Array.isArray(wh.json)) {
  for (const w of wh.json) diz("    uuid=" + String(w.uuid || "").slice(0, 8) + "... webhook_url(mascarada)=" + mascararUrl(w.webhook_url));
}
diz("- LEMBRE: no C2X, create_webhook = 0 em 100% das 3.675 linhas de contract_signatures.");

// ── c) payload completo do /list ────────────────────────────────────────────
diz("");
diz("## c) payload completo de `/documents/{uuid}/list` - o que e publico e o que e sensivel");
diz("");
const finalizado = geral.json.slice(1).find((d) => d.statusName === "Finalizado");
const parcial = geral.json.slice(1).find((d) => d.statusName === "Aguardando Assinaturas");
const PUBLICO = new Set(["signed", "type", "nomenclatura", "foreign", "certificadoicpbr", "assinatura_presencial", "email_sent", "email_sent_status", "date", "date_trigger", "upload_allowed", "docauth", "docauthandselfie", "auth_pix", "key_signer"]);
const SENSIVEL = new Set(["user_document", "email", "embed_smsnumber", "password_code", "email_sent_message", "user_name", "embed_methodauth"]);
for (const [rotulo, alvo] of [["FINALIZADO", finalizado], ["AGUARDANDO ASSINATURAS", parcial]]) {
  if (!alvo) continue;
  const r = await pegar("/documents/" + alvo.uuidDoc + "/list");
  const lista = (Array.isArray(r.json) && r.json[0] && r.json[0].list) || [];
  diz("");
  diz("### documento " + rotulo + " (" + lista.length + " signatarios), HTTP " + r.status + " em " + r.ms + "ms");
  const assinou = lista.filter((s) => String(s.signed) === "1").length;
  diz("- signed=1: " + assinou + " | signed=0: " + (lista.length - assinou));
  const s = lista[0];
  if (s) {
    diz("- campos do signatario, classificados:");
    for (const k of Object.keys(s)) {
      const v = s[k];
      const classe = SENSIVEL.has(k) ? "SENSIVEL " : PUBLICO.has(k) ? "publico  " : "revisar  ";
      let mostrar;
      if (k === "sign_info" && v && typeof v === "object") mostrar = "{" + Object.keys(v).join(",") + "}  <- IP, GEO e USER_AGENT aqui";
      else if (SENSIVEL.has(k)) mostrar = v == null || v === "" ? JSON.stringify(v) : "<mascarado>";
      else mostrar = JSON.stringify(v);
      diz("    [" + classe + "] " + k.padEnd(22) + " = " + mostrar);
    }
  }
  // ordem / sequencia de assinatura
  const naoAssinou = lista.filter((x) => String(x.signed) !== "1");
  diz("- ha campo explicito de ORDEM/sequencia? " + (Object.keys(s || {}).some((k) => /order|sequen|ordem|priorid/i.test(k)) ? "SIM" : "NAO - so `date` (convite) e `date_trigger`"));
  diz("- DATA da assinatura: sign_info.date_signed / sign_info.date_signed_atom (ISO com fuso)");
  if (naoAssinou.length) {
    diz("- quem NAO assinou: sign_info = " + JSON.stringify(naoAssinou[0].sign_info) + " (vazio quando signed=0)");
  }
}

// ── d) o documento ausente ──────────────────────────────────────────────────
diz("");
diz("## d) o uuidDoc do C2X que nao aparece no catalogo");
diz("");
const catalogo = new Set();
for (let pg = 1; pg <= Number(geral.json[0].total_pages); pg += 1) {
  const r = await pegar("/documents?pg=" + pg);
  if (Array.isArray(r.json)) for (const d of r.json.slice(1)) if (d && d.uuidDoc) catalogo.add(d.uuidDoc);
}
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const [todos] = await c.query(
  "select distinct uuidDoc, contract_signature_status_id st from contract_signatures where uuidDoc is not null and uuidDoc <> ''",
);
await c.end();
const faltando = todos.filter((t) => !catalogo.has(t.uuidDoc));
diz("- catalogo D4Sign: " + catalogo.size + " | uuidDoc no C2X: " + todos.length + " | faltando: " + faltando.length);
for (const f of faltando) {
  const r = await pegar("/documents/" + f.uuidDoc);
  const d = Array.isArray(r.json) ? r.json[0] : r.json;
  diz("    " + String(f.uuidDoc).slice(0, 8) + "... (C2X status " + f.st + ") -> GET direto: HTTP " + r.status + " " + JSON.stringify(d && (d.message || d.statusName)));
}
// e o inverso: documentos no D4Sign que o C2X nao conhece
const conhecidos = new Set(todos.map((t) => t.uuidDoc));
let soNoD4 = 0;
for (const u of catalogo) if (!conhecidos.has(u)) soNoD4 += 1;
diz("- documentos que existem no D4Sign e o C2X NAO conhece: " + soNoD4);

fs.writeFileSync(path.join(saida, "sonda-d4sign-detalhe.md"), linhas.join("\n"));
console.log("");
console.log("-> " + path.join(saida, "sonda-d4sign-detalhe.md"));
