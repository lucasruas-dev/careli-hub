// ESTUDO parte 2 — como os dados de assinatura ESTÃO PREENCHIDOS de verdade (leitura pura).
//
// Schema diz o que cabe; isto diz o que existe. Sem esta parte, o painel é desenhado em cima de
// coluna que o C2X nunca preencheu — foi o que aconteceu com `contract_signatures.statusId`.
//
//   node scripts/apolo/estudo-assinaturas-perfil.mjs <pasta-de-saida>
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const saida = process.argv[2];
fs.mkdirSync(saida, { recursive: true });

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

const linhas = [];
const diz = (t) => { linhas.push(t); console.log(t); };

async function bloco(titulo, sql, params = []) {
  diz(`\n### ${titulo}`);
  try {
    const [rows] = await c.query(sql, params);
    if (!rows.length) { diz("  (vazio)"); return []; }
    for (const r of rows) diz(`  ${JSON.stringify(r)}`);
    return rows;
  } catch (e) {
    diz(`  ERRO: ${e.message}`);
    return [];
  }
}

// ── Como a proposta chega no empreendimento ──────────────────────────────────
diz("## COLUNAS DE acquisition_requests (só as que ligam)\n");
const [colsAr] = await c.query(
  `select column_name, column_type from information_schema.columns
    where table_schema = ? and table_name = 'acquisition_requests' order by ordinal_position`,
  [env.GUARDIAN_DB_NAME],
);
for (const col of colsAr) diz(`  ${col.COLUMN_NAME.padEnd(38)} ${col.COLUMN_TYPE}`);

diz("\n\n## PERFIL DOS DADOS\n");

await bloco(
  "contract_signatures por status",
  `select cs.contract_signature_status_id as status_id, s.name as status,
          count(*) as n,
          sum(cs.link_pdf_signed_file is not null and cs.link_pdf_signed_file <> '') as com_pdf,
          sum(cs.statusId is not null) as com_statusid_texto,
          min(cs.created_at) as primeiro, max(cs.created_at) as ultimo
     from contract_signatures cs
     left join contract_signature_statuses s on s.id = cs.contract_signature_status_id
    group by cs.contract_signature_status_id, s.name order by n desc`,
);

await bloco(
  "contract_signatures por contract_type",
  `select contract_type, count(*) as n,
          count(distinct acquisition_request_contract_id) as contratos
     from contract_signatures group by contract_type order by n desc`,
);

await bloco(
  "quantos ENVIOS por contrato (a memória diz 2)",
  `select envios, count(*) as contratos from (
     select acquisition_request_contract_id, count(*) as envios
       from contract_signatures group by acquisition_request_contract_id
   ) t group by envios order by envios`,
);

await bloco(
  "contract_signature_signers: assinou ou não",
  `select signed, count(*) as n,
          sum(date_signed is not null) as com_data,
          count(distinct contract_signature_id) as envios
     from contract_signature_signers group by signed order by n desc`,
);

await bloco(
  "contract_signature_signers por tipo de signatário",
  `select t.name as tipo, count(*) as n, sum(ss.signed = 1) as assinaram
     from contract_signature_signers ss
     left join contract_signature_types t on t.id = ss.contract_signature_type_id
    group by t.name order by n desc`,
);

await bloco(
  "acquisition_request_contracts: status e data de assinatura",
  `select arc.acquisition_request_contract_status_id as status_id, st.name as status,
          count(*) as n,
          sum(arc.signature_date is not null) as com_data_assinatura,
          sum(arc.signature_date_brokerage is not null) as com_data_corretagem
     from acquisition_request_contracts arc
     left join acquisition_request_contract_statuses st
            on st.id = arc.acquisition_request_contract_status_id
    group by arc.acquisition_request_contract_status_id, st.name order by n desc`,
);

await bloco(
  "os 3 empreendimentos do Vale do Ouro",
  `select id, code, name from enterprises where id in (35, 36, 37)`,
);

await c.end();
fs.writeFileSync(path.join(saida, "02-perfil.md"), linhas.join("\n"), "utf8");
console.log(`\nescrito em ${path.join(saida, "02-perfil.md")}`);
