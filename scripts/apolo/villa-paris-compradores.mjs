// VILLA PARIS: quem são os COMPRADORES no C2X, e o que falta na ficha deles.
//
// O primeiro corte (credenciados do Prometeu) deu 48 de 48 com profissão e nacionalidade. Mas
// quem gera contrato não é quem se credenciou: é quem COMPROU. As duas listas se cruzam sem
// coincidir — houve credenciado que não fechou, e comprador que chegou por fora do salão.
//
// Este script parte das UNIDADES do Villa Paris (RVP) e desce até a ficha de cada proponente,
// incluindo cônjuge e os demais compradores da mesma proposta (client_2..client_5) — que também
// assinam o contrato e também precisam de profissão e nacionalidade.
//
// Uso (da raiz do repo):
//   node scripts/apolo/villa-paris-compradores.mjs
//
// ⚠️ SÓ LEITURA. Nenhum UPDATE.
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

// 1. O empreendimento
const [emps] = await c.query(
  `select id, name, code from enterprises where code like '%RVP%' or name like '%Villa Paris%'`,
);
console.log("Empreendimento(s):");
for (const e of emps) console.log(`  [${e.id}] ${e.code} — ${e.name}`);
if (!emps.length) {
  console.log("Nenhum empreendimento casou. Abortando.");
  await c.end();
  process.exit(0);
}
const empIds = emps.map((e) => e.id);

// 2. As propostas/reservas do empreendimento, com TODOS os compradores da mesma AR
const [ars] = await c.query(
  `select ar.id                as ar_id,
          ar.acquisition_request_stage_id as stage_id,
          s.name               as etapa,
          u.name               as unidade,
          ar.client_id, ar.client_2_id, ar.client_3_id, ar.client_4_id, ar.client_5_id,
          ar.created_at
     from acquisition_requests ar
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
    where u.enterprise_id in (?)
    order by ar.created_at desc`,
  [empIds],
);

console.log(`\nPropostas/reservas no Villa Paris: ${ars.length}`);
const porEtapa = {};
for (const a of ars) porEtapa[a.etapa ?? `stage ${a.stage_id}`] = (porEtapa[a.etapa ?? `stage ${a.stage_id}`] ?? 0) + 1;
for (const [etapa, n] of Object.entries(porEtapa).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${etapa}: ${n}`);
}

// 3. Todos os clientes envolvidos (titular + co-compradores)
const clienteIds = new Set();
for (const a of ars) {
  for (const k of ["client_id", "client_2_id", "client_3_id", "client_4_id", "client_5_id"]) {
    if (a[k]) clienteIds.add(a[k]);
  }
}
console.log(`\nPessoas nas propostas (titulares + co-compradores): ${clienteIds.size}`);

if (!clienteIds.size) {
  await c.end();
  process.exit(0);
}

// 4. A ficha de cada um, e o cônjuge (que também assina)
const [fichas] = await c.query(
  `select u.id, u.name, u.cpf, u.cnpj, u.nacionality, u.profession_id,
          p.name as profissao, u.civil_state_id, cs.name as estado_civil,
          u.foreigner
     from users u
     left join professions p     on p.id = u.profession_id
     left join civil_states cs   on cs.id = u.civil_state_id
    where u.id in (?)`,
  [[...clienteIds]],
);

// 5. Cônjuges — assinam o contrato e têm ficha própria.
// ⚠️ `users` NÃO tem spouse_id neste banco; o vínculo mora em outro lugar. Fica para o próximo
// corte em vez de sumir calado: por ora o relatório cobre titulares e co-compradores.
const conjugeIds = [];
let conjuges = [];
if (conjugeIds.length) {
  const [linhas] = await c.query(
    `select u.id, u.name, u.cpf, u.nacionality, u.profession_id, p.name as profissao
       from users u left join professions p on p.id = u.profession_id
      where u.id in (?)`,
    [conjugeIds],
  );
  conjuges = linhas;
}

const vazio = (v) => !String(v ?? "").trim();
// 25 = "PROFISSÃO NÃO DECLARADA": o default que o C2X aplica quando o campo sobe nulo. Para um
// contrato, isso é tão inútil quanto o campo em branco.
const semProfissao = (f) => !f.profession_id || Number(f.profession_id) === 25;

const relatorio = (titulo, lista) => {
  const nac = lista.filter((f) => vazio(f.nacionality));
  const pro = lista.filter(semProfissao);
  console.log(`\n${"=".repeat(70)}`);
  console.log(`${titulo} — ${lista.length} pessoas`);
  console.log("=".repeat(70));
  console.log(`  sem nacionalidade: ${nac.length}`);
  console.log(`  sem profissão:     ${pro.length}`);
  if (nac.length) {
    console.log("\n  SEM NACIONALIDADE:");
    for (const f of nac) console.log(`    [${f.id}] ${f.name} — ${f.cpf ?? f.cnpj ?? "sem doc"}`);
  }
  if (pro.length) {
    console.log("\n  SEM PROFISSÃO:");
    for (const f of pro) {
      console.log(
        `    [${f.id}] ${f.name} — ${f.cpf ?? f.cnpj ?? "sem doc"} · atual: ${f.profissao ?? "nulo"}`,
      );
    }
  }
};

relatorio("COMPRADORES (titulares e co-compradores)", fichas);
if (conjuges.length) relatorio("CÔNJUGES (também assinam)", conjuges);

// 6. Amostra dos valores, para ver se o que está lá presta
console.log(`\n${"=".repeat(70)}`);
console.log("AMOSTRA DO QUE ESTÁ GRAVADO (10 primeiros)");
console.log("=".repeat(70));
for (const f of fichas.slice(0, 10)) {
  console.log(
    `  ${String(f.name).slice(0, 34).padEnd(34)} | nac: ${String(f.nacionality ?? "—").padEnd(12)} | prof: ${f.profissao ?? "—"}`,
  );
}

await c.end();
