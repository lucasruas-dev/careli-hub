import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const res = {};
const campos = ["code","client_id","corretor_id","draft_contract_id","commercial_plan_id","custom_commercial_plan","billing_date","acquisition_request_stage_id","open","acquisition_request_type_id","annual_value","due_day_id","purchase_together","quantity_signal_parcels","first_signal_payment","act_date","sign_date","client_2_id","percentage_client_1","approval_status","rejection_reason","observation","registered_by_id","last_updated_by_id"];
const sel = campos.map(f=>`SUM(CASE WHEN ${f} IS NULL THEN 0 ELSE 1 END) AS ${f}`).join(", ");
const [migradas] = await c.query(`SELECT COUNT(*) total, ${sel} FROM acquisition_requests WHERE id IN (${ids.join(",")})`);
res.preenchimento_280_migradas = migradas[0];
const [controle] = await c.query(`SELECT COUNT(*) total, ${sel} FROM acquisition_requests WHERE id NOT IN (${ids.join(",")}) AND created_at >= '2026-01-01'`);
res.preenchimento_controle_2026 = controle[0];
const [controleTudo] = await c.query(`SELECT COUNT(*) total, ${sel} FROM acquisition_requests WHERE id NOT IN (${ids.join(",")})`);
res.preenchimento_controle_todas = controleTudo[0];
// updated_at das 280: todas no mesmo minuto da migracao?
const [upd] = await c.query(`SELECT DATE_FORMAT(updated_at,'%Y-%m-%d %H:%i') m, COUNT(*) n FROM acquisition_requests WHERE id IN (${ids.join(",")}) GROUP BY 1 ORDER BY 1`);
res.updatedAtDas280 = upd;
const [lub] = await c.query(`SELECT last_updated_by_id, COUNT(*) n FROM acquisition_requests WHERE id IN (${ids.join(",")}) GROUP BY 1`);
res.lastUpdatedBy = lub;
// contrato 2767 (nome divergente)
const [ct] = await c.query("SELECT id, acquisition_request_id, created_at, LENGTH(complete_text) len, complete_text FROM acquisition_request_contracts WHERE id=2767");
const t = String(ct[0].complete_text||"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ");
res.contrato2767 = {len: ct[0].len, created_at: ct[0].created_at, trecho: t.slice(0,900)};
const [ar4341] = await c.query("SELECT * FROM acquisition_requests WHERE id=4341");
res.ar4341 = {client_id: ar4341[0].client_id, client_2_id: ar4341[0].client_2_id, stage: ar4341[0].acquisition_request_stage_id, open: ar4341[0].open, unidade: ar4341[0].enterprise_unity_id, created_at: ar4341[0].created_at, updated_at: ar4341[0].updated_at};
const [u4341] = await c.query("SELECT id,name FROM users WHERE id IN (?,?)", [ar4341[0].client_id, ar4341[0].client_2_id||0]);
res.ar4341Clientes = u4341;
// plano comercial: aponta pro enterprise antigo?
const [pl] = await c.query(`SELECT cp.id, cp.enterprise_id, cp.acquisition_request_id, COUNT(*) OVER() total FROM commercial_plans cp WHERE cp.id IN (SELECT commercial_plan_id FROM acquisition_requests WHERE id IN (${ids.join(",")}) AND commercial_plan_id IS NOT NULL)`);
res.planosDas280 = pl.reduce((m,p)=>{const k = p.enterprise_id? ("enterprise_"+p.enterprise_id) : "custom_por_proposta"; m[k]=(m[k]||0)+1; return m;},{});
res.planosTotal = pl.length;
// draft_contract das 280 x empreendimento
const [dc] = await c.query(`SELECT dc.id, dc.name, dc.enterprise_id, COUNT(ar.id) n FROM draft_contracts dc JOIN acquisition_requests ar ON ar.draft_contract_id=dc.id WHERE ar.id IN (${ids.join(",")}) GROUP BY dc.id, dc.name, dc.enterprise_id`);
res.draftContracts = dc;
await c.end();
fs.writeFileSync("audit-vlo-res6.json", JSON.stringify(res,null,1));
console.log(JSON.stringify(res,null,1).slice(0,12000));
