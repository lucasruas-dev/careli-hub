// CONFERENCIA read-only: o Huber esta cadastrado como coordenador de quais empreendimentos?
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa.
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

const [quem] = await c.query(
  "select u.id, u.name, p.name perfil from users u left join profiles p on p.id = u.profile_id where u.name like ?",
  ["%HUBER%"],
);
console.log("### quem e o Huber no C2X");
for (const r of quem) console.log("  id " + r.id + " · perfil no cadastro: " + r.perfil);

for (const r of quem) {
  const [emps] = await c.query(
    `select e.code, e.id,
            case when e.coordenador_id = ? then 'COORDENADOR'
                 when e.manager_id = ? then 'GERENTE'
                 when e.captivator_id = ? then 'CAPTADOR' end papel
       from enterprises e
      where e.coordenador_id = ? or e.manager_id = ? or e.captivator_id = ?`,
    [r.id, r.id, r.id, r.id, r.id, r.id],
  );
  console.log("\n### empreendimentos em que o id " + r.id + " tem papel: " + (emps.length || "NENHUM"));
  for (const e of emps) console.log("  " + e.code + " (id " + e.id + ") -> " + e.papel);
}

// E como ele aparece HOJE nas assinaturas do VOC.
const [linhas] = await c.query(
  `select distinct ss.user_name, pf.name perfil_c2x, e.code emp
     from contract_signature_signers ss
     join contract_signatures cs on cs.id = ss.contract_signature_id
     join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
     join acquisition_requests ar on ar.id = arc.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join contract_signers csg on csg.id = ss.contract_signer_id
     left join signers sg on sg.id = csg.signer_id
     left join users usr on usr.id = sg.user_id
     left join profiles pf on pf.id = usr.profile_id
    where ss.user_name like ? limit 5`,
  ["%HUBER%"],
);
console.log("\n### como ele chega hoje nas assinaturas");
for (const l of linhas) console.log("  " + l.emp + " · perfil generico: " + l.perfil_c2x);
await c.end();
