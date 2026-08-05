// DEBUG (leitura apenas): por que o universo == criados na janela?
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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const digitos = (v) => String(v ?? "").replace(/\D/g, "");

const lerTudo = async (tabela, query) => {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/${tabela}?${query}&limit=1000&offset=${offset}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
    const page = await resp.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
};

const entidades = await lerTudo(
  "apolo_entities",
  "select=id,display_name,document_masked,entity_kind,metadata,created_at&or=(metadata->>c2xSynced.eq.true,created_at.gte.2026-08-01)",
);
console.log("entidades:", entidades.length);
const docsApolo = new Set();
const c2xIdsApolo = new Set();
for (const e of entidades) {
  const d = digitos(e.document_masked);
  if (d.length === 11 || d.length === 14) docsApolo.add(d);
  const cid = e.metadata?.c2xUserId;
  if (cid) c2xIdsApolo.add(Number(cid));
}
console.log("docsApolo:", docsApolo.size, "c2xIdsApolo:", c2xIdsApolo.size);
console.log("exemplo c2xIds:", [...c2xIdsApolo].slice(0, 10));

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const [users] = await c.query(
  "SELECT id, name, cpf, cnpj, email, created_at FROM users",
);
console.log("users:", users.length, "max id:", Math.max(...users.map((u) => u.id)));

const matchId = users.filter((u) => c2xIdsApolo.has(u.id));
console.log("users com id em c2xIdsApolo:", matchId.length);
const matchDoc = users.filter((u) => {
  const d = digitos(u.cpf) || digitos(u.cnpj);
  return d && docsApolo.has(d);
});
console.log("users com doc em docsApolo:", matchDoc.length);

// datas dos matched
const inicio = new Date("2026-08-01T00:00:00-03:00").getTime();
const fim = new Date("2026-08-03T00:00:00-03:00").getTime();
const foraJanela = [...new Set([...matchId, ...matchDoc])].filter((u) => {
  const t = new Date(u.created_at).getTime();
  return t < inicio || t >= fim;
});
console.log("matched fora da janela 01-02/08:", foraJanela.length);
console.log(
  "amostra fora:",
  foraJanela.slice(0, 5).map((u) => ({ id: u.id, criado: u.created_at })),
);

// e-mails vazios entre os da janela
const naJanela = users.filter((u) => {
  const t = new Date(u.created_at).getTime();
  return t >= inicio && t < fim;
});
const semEmail = naJanela.filter((u) => !String(u.email ?? "").trim());
console.log("na janela:", naJanela.length, "sem email:", semEmail.length);

// user 4319 e 4732
for (const id of [4319, 4732]) {
  const u = users.find((x) => x.id === id);
  console.log(id, u ? { criado: u.created_at, temCpf: !!u.cpf } : "NAO EXISTE");
}
await c.end();
