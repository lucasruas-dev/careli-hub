// READ-ONLY. Mostra um trecho de uma minuta do C2X e tenta descobrir o formato das variáveis.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
const id = Number(process.argv[2] || 85);
const [[m]] = await c.query("select id, name, text from draft_contracts where id = ?", [id]);
const t = String(m.text ?? "");
console.log(`#${m.id} ${m.name} · ${t.length} chars`);
console.log("\n--- PRIMEIROS 2500 CHARS ---\n");
console.log(t.slice(0, 2500));
console.log("\n--- PADRÕES CANDIDATOS ---");
for (const [rot, re] of [
  ["{{x}}", /\{\{\s*[\w.]+\s*\}\}/g], ["{x}", /\{[\w.]{2,60}\}/g], ["[x]", /\[[\w. ]{2,60}\]/g],
  ["%x%", /%[\w.]{2,60}%/g], ["<<x>>", /<<[\w. ]{2,60}>>/g], ["$x$", /\$[\w.]{2,60}\$/g],
  ["#x#", /#[\w.]{2,60}#/g],
]) {
  const a = [...t.matchAll(re)].map((x) => x[0]);
  console.log(`${rot}: ${a.length} ocorrências · ${[...new Set(a)].slice(0, 12).join(" ")}`);
}
await c.end();
