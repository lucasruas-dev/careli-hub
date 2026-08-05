// EXCEÇÃO PONTUAL à regra "C2X read-only", autorizada pelo Lucas em 01/08/2026 ~2h da manhã.
//
// Por quê: as 298 unidades do Vale do Ouro subiram pela API com sale_status_id=5 (Bloqueado para
// venda) nos 108 lotes não-disponíveis, mas o badge vermelho da listagem obedece a OUTRO campo, o
// checkbox `sale_blocked` — e a API de integração não tem atualização (PUT/PATCH devolvem 405).
// A alternativa era o Lucas flegar 106 checkboxes à mão na madrugada do evento.
//
// O que faz: UPDATE de UMA coluna (sale_blocked 0->1), só nas unidades do Vale do Ouro (35) que
// já estão com sale_status_id=5. Backup do estado anterior vai para o Desktop antes de tocar em
// qualquer linha; a prova (contagem por status) sai no final.
//
// Para DESFAZER: os ids afetados estão no backup; sale_blocked=0 neles reverte tudo.
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

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// 1. BACKUP das linhas que serão tocadas.
const [alvo] = await c.query(
  "SELECT id, name, sale_status_id, sale_blocked FROM enterprise_unities WHERE enterprise_id = 35 AND sale_status_id = 5 AND sale_blocked = 0 ORDER BY name",
);
const backupPath = path.join(
  process.env.USERPROFILE || ".",
  "Desktop",
  "backup-sale-blocked-vale-do-ouro.json",
);
fs.writeFileSync(
  backupPath,
  JSON.stringify(
    { quando: new Date().toISOString(), motivo: "sale_blocked 0->1, autorizacao pontual do Lucas 01/08", linhas: alvo },
    null,
    1,
  ),
);
console.log(`backup: ${alvo.length} linhas -> ${backupPath}`);
if (alvo.length === 0) {
  console.log("nada a fazer — tudo já está com o checkbox certo.");
  process.exit(0);
}

// 2. UPDATE cirúrgico: lista explícita de ids + condições redundantes de propósito.
const ids = alvo.map((a) => a.id);
const [res] = await c.query(
  `UPDATE enterprise_unities SET sale_blocked = 1
    WHERE id IN (${ids.map(() => "?").join(",")})
      AND enterprise_id = 35 AND sale_status_id = 5 AND sale_blocked = 0`,
  ids,
);
console.log(`UPDATE: ${res.affectedRows} linhas (esperado ${ids.length})`);

// 3. PROVA.
const [depois] = await c.query(
  "SELECT sale_status_id, sale_blocked, COUNT(*) n FROM enterprise_unities WHERE enterprise_id = 35 GROUP BY sale_status_id, sale_blocked ORDER BY 1, 2",
);
console.log("estado final:", JSON.stringify(depois));
const [total] = await c.query("SELECT COUNT(*) n FROM enterprise_unities WHERE enterprise_id = 35");
console.log(`total no Vale do Ouro: ${total[0].n} (tem que ser 298)`);
await c.end();
