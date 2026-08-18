// MEDIÇÃO read-only: onde vai o tempo ao abrir a tela de Contratos?
//
// Pedido do dono (18/08/2026): "está demorando muito para carregar as páginas... olha por favor
// essa demora". Antes de mexer em qualquer coisa, decompor o custo: quanto é o SQL do C2X, quanto
// é o catálogo do D4Sign e quanto custa UM detalhe de documento.
//
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa. ⚠️ Nenhum nome/e-mail na saída.
//
//   node scripts/apolo/medir-carga-contratos.mjs
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

const relogio = async (rotulo, fn) => {
  const t = Date.now();
  const r = await fn();
  console.log("  " + rotulo.padEnd(44) + String(Date.now() - t).padStart(7) + " ms");
  return r;
};

const JOINS = `
  from contract_signatures cs
  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
  join acquisition_requests ar on ar.id = arc.acquisition_request_id
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id
  join contract_signature_signers ss on ss.contract_signature_id = cs.id
  left join contract_signers csg on csg.id = ss.contract_signer_id
  left join signers sg on sg.id = csg.signer_id
  left join users usr on usr.id = sg.user_id`;

const conexao = await relogio("abrir conexão com o C2X (RDS)", () =>
  mysql.createConnection({
    database: env.GUARDIAN_DB_NAME,
    host: env.GUARDIAN_DB_HOST,
    password: env.GUARDIAN_DB_PASSWORD,
    port: Number(env.GUARDIAN_DB_PORT || 3306),
    user: env.GUARDIAN_DB_USER,
  }),
);

for (const [rotulo, escopo] of [
  ["PORTAL (VOC 37 + VOL 36)", "u.enterprise_id in (36, 37)"],
  ["APOLO sem filtro (acervo inteiro)", "1 = 1"],
]) {
  console.log("\n### " + rotulo);
  const linhas = await relogio("SQL do C2X (a lista da tela)", async () => {
    const [rows] = await conexao.query(`
      select cs.id envio, cs.uuidDoc uuid, ss.signed assinado, e.code emp,
             coalesce(nullif(trim(u.name), ''), concat(e.code, u.block, u.lot)) unidade
      ${JOINS}
      where ${escopo}
        and cs.send_document_signature = 1
        and cs.contract_signature_status_id <> 6`);
    return rows;
  });
  const uuids = new Set(linhas.map((l) => l.uuid).filter(Boolean));
  const unidades = new Set(linhas.map((l) => l.emp + "|" + l.unidade));
  console.log("  -> " + linhas.length + " linhas · " + uuids.size + " documentos · " + unidades.size + " unidades");
}

await conexao.end();

const base = "https://secure.d4sign.com.br/api/v1";
const cred = "tokenAPI=" + env.D4SIGN_TOKEN_API + "&cryptKey=" + env.D4SIGN_CRYPT_KEY;

console.log("\n### D4SIGN (o que a tela paga além do SQL)");
let paginas = 0;
let docs = 0;
let primeiro = null;
await relogio("catálogo em lote (todas as páginas)", async () => {
  for (let pg = 1; pg <= 20; pg += 1) {
    const r = await fetch(base + "/documents?pg=" + pg + "&" + cred, { cache: "no-store" });
    const j = await r.json().catch(() => []);
    const lista = Array.isArray(j) ? j.filter((x) => x && x.uuidDoc) : [];
    if (lista.length === 0) break;
    if (!primeiro) primeiro = lista[0].uuidDoc;
    paginas = pg;
    docs += lista.length;
  }
});
console.log("  -> " + docs + " documentos em " + paginas + " páginas");

if (primeiro) {
  await relogio("UM detalhe (/list de um documento)", async () =>
    (await fetch(base + "/documents/" + primeiro + "/list?" + cred)).json().catch(() => null),
  );
}
