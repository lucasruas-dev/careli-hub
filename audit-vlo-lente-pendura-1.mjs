import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const q = async (s,p)=>{const [r]=await c.query(s,p);return r;};
const out = {};

out.enterprises = await q("SELECT id,name,divulgation_name,code,enterprise_type_id,city_id FROM enterprises WHERE id IN (35,36,37)");
out.cols_arc = (await q("SHOW COLUMNS FROM acquisition_request_contracts")).map(r=>r.Field);
out.cols_pay = (await q("SHOW COLUMNS FROM payments")).map(r=>r.Field);
out.cols_cs = (await q("SHOW COLUMNS FROM contract_signatures")).map(r=>r.Field);
out.cols_css = (await q("SHOW COLUMNS FROM contract_signature_signers")).map(r=>r.Field);
out.cols_arh = (await q("SHOW COLUMNS FROM acquisition_request_historics")).map(r=>r.Field);
out.cols_eu = (await q("SHOW COLUMNS FROM enterprise_unities")).map(r=>r.Field);
out.cols_ar = (await q("SHOW COLUMNS FROM acquisition_requests")).map(r=>r.Field);
// tabelas que referenciam acquisition_request
out.tabs_ar = await q(`SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND COLUMN_NAME IN ('acquisition_request_id','enterprise_unity_id','enterprise_id') ORDER BY COLUMN_NAME, TABLE_NAME`,[env.GUARDIAN_DB_NAME]);
out.unidades = await q("SELECT enterprise_id, COUNT(*) n, SUM(enterprise_unity_type_id=1) t1, SUM(enterprise_unity_type_id=2) t2 FROM enterprise_unities WHERE enterprise_id IN (35,36,37) GROUP BY enterprise_id");
out.propostas_por_emp = await q(`SELECT eu.enterprise_id, COUNT(*) n FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE eu.enterprise_id IN (35,36,37) GROUP BY eu.enterprise_id`);
console.log(JSON.stringify(out,null,1));
await c.end();
