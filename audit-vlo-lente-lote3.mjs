import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const res = {};
res.backupTimestamp = new Date(1785763642150).toISOString();
const [cols] = await c.query("SHOW COLUMNS FROM acquisition_request_contracts");
res.contratoCols = cols.map(r=>r.Field);
const [ct] = await c.query("SELECT id, acquisition_request_id, created_at, updated_at, signature_date, LENGTH(complete_text) len, complete_text FROM acquisition_request_contracts WHERE acquisition_request_id IN ("+ids.join(",")+")");
res.contratos = ct.length;
res.contratosPorAR = new Set(ct.map(r=>r.acquisition_request_id)).size;
if(ct[0]) res.amostraTexto = String(ct[0].complete_text||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").slice(0,1200);
fs.writeFileSync("audit-vlo-contratos-raw.json", JSON.stringify(ct.map(r=>({id:r.id,ar:r.acquisition_request_id,created_at:r.created_at,updated_at:r.updated_at,txt:String(r.complete_text||"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ")})),null,0));
// janela de alteracao: o que mais mexeu no banco no dia da migracao
const [arTouched] = await c.query("SELECT ar.id, ar.enterprise_unity_id, ar.updated_at, eu.enterprise_id, eu.block, eu.lot FROM acquisition_requests ar LEFT JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE ar.updated_at >= '2026-08-01 00:00:00' ORDER BY ar.updated_at");
res.arsTocadasDesde01ago = arTouched.length;
const idSet = new Set(ids);
res.arsTocadasForaDoBackup = arTouched.filter(a=>!idSet.has(a.id)).map(a=>({id:a.id,ent:a.enterprise_id,lote:"Q"+a.block+" L"+a.lot,updated_at:a.updated_at}));
const [euTouched] = await c.query("SELECT id, enterprise_id, block, lot, created_at, updated_at FROM enterprise_unities WHERE updated_at >= '2026-08-01 00:00:00' ORDER BY updated_at");
res.unidadesTocadasDesde01ago = euTouched.length;
res.unidadesTocadasForaDoVale = euTouched.filter(u=>![35,36,37].includes(u.enterprise_id)).map(u=>({id:u.id,ent:u.enterprise_id,lote:"Q"+u.block+" L"+u.lot,updated_at:u.updated_at}));
const [novas] = await c.query("SELECT MIN(id) minId, MAX(id) maxId, MIN(created_at) minC, MAX(created_at) maxC, COUNT(*) n, enterprise_id FROM enterprise_unities WHERE enterprise_id IN (35,36,37) GROUP BY enterprise_id");
res.faixaIds = novas;
const [colide] = await c.query("SELECT id, enterprise_id FROM enterprise_unities WHERE id BETWEEN (SELECT MIN(id) FROM enterprise_unities WHERE enterprise_id IN (36,37)) AND (SELECT MAX(id) FROM enterprise_unities WHERE enterprise_id IN (36,37)) AND enterprise_id NOT IN (36,37)");
res.idsIntercalados = colide;
// pagamentos ligados as 280 propostas
const [pay] = await c.query("SELECT acquisition_request_id, COUNT(*) n, SUM(CASE WHEN payment_status_id=5 THEN 1 ELSE 0 END) liquidadas FROM payments WHERE acquisition_request_id IN ("+ids.join(",")+") GROUP BY acquisition_request_id");
res.propostasComPagamento = pay.length;
res.totalParcelas = pay.reduce((s,p)=>s+p.n,0);
// historico: alguma mudanca de estagio no dia da migracao?
const [hist] = await c.query("SELECT acquisition_request_id, old_acquisition_request_stage_id o, new_acquisition_request_stage_id n, created_at FROM acquisition_request_historics WHERE created_at >= '2026-08-01 00:00:00' ORDER BY created_at");
res.historicosDesde01ago = hist.length;
res.historicosAmostra = hist.slice(-15);
await c.end();
fs.writeFileSync("audit-vlo-res3.json", JSON.stringify(res,null,1));
console.log(JSON.stringify(res,null,1).slice(0,7000));
