import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const res = {};
// tipos no backup
res.tipoBackup = bk.reduce((m,b)=>{m[b.tipo]=(m[b.tipo]||0)+1;return m;},{});
// tabelas que referenciam enterprise_unity_id
const [refs] = await c.query("SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME LIKE '%enterprise_unit%'");
res.tabelasComUnidade = refs;
// sale status lookup
const [ss] = await c.query("SELECT * FROM sale_statuses");
res.saleStatuses = ss;
// espelho de status entre 35 e gemeas
const [units] = await c.query("SELECT id,enterprise_id,block,lot,sale_status_id,secured_lot,sale_blocked,enterprise_unity_type_id,price,area,registration,registration_number,name,updated_at FROM enterprise_unities WHERE enterprise_id IN (35,36,37)");
const k = u=>String(u.block).trim()+"|"+String(u.lot).trim();
const m35 = new Map(units.filter(u=>u.enterprise_id===35).map(u=>[k(u),u]));
const twins = units.filter(u=>u.enterprise_id!==35);
const statusDiff=[], semGemea=[], tipoDiff=[], securedDiff=[], blockedDiff=[], nomeDiff=[];
for(const t of twins){
  const o = m35.get(k(t));
  if(!o){ semGemea.push({unidade:t.id, ent:t.enterprise_id, lote:"Q"+t.block+" L"+t.lot}); continue; }
  if(o.sale_status_id!==t.sale_status_id) statusDiff.push({lote:"Q"+t.block+" L"+t.lot, ent:t.enterprise_id, masterplan35:o.sale_status_id, gemea:t.sale_status_id, u35:o.id, ug:t.id});
  if(o.enterprise_unity_type_id!==t.enterprise_unity_type_id) tipoDiff.push({lote:"Q"+t.block+" L"+t.lot, ent:t.enterprise_id, t35:o.enterprise_unity_type_id, tg:t.enterprise_unity_type_id});
  if((o.secured_lot||0)!==(t.secured_lot||0)) securedDiff.push({lote:"Q"+t.block+" L"+t.lot, ent:t.enterprise_id, s35:o.secured_lot, sg:t.secured_lot});
  if((o.sale_blocked||0)!==(t.sale_blocked||0)) blockedDiff.push({lote:"Q"+t.block+" L"+t.lot, ent:t.enterprise_id, b35:o.sale_blocked, bg:t.sale_blocked});
  if(String(o.name||"")!==String(t.name||"")) nomeDiff.push({lote:"Q"+t.block+" L"+t.lot, ent:t.enterprise_id, n35:o.name, ng:t.name});
}
res.espelho = {twins:twins.length, statusDiff:statusDiff.length, semGemea, tipoDiff, securedDiff:securedDiff.length, blockedDiff:blockedDiff.length, nomeDiff:nomeDiff.length};
res.statusDiffAmostra = statusDiff.slice(0,40);
res.securedDiffAmostra = securedDiff.slice(0,20);
res.blockedDiffAmostra = blockedDiff.slice(0,20);
res.nomeDiffAmostra = nomeDiff.slice(0,10);
// unidades 35 sem gemea
const kTwin = new Set(twins.map(k));
res.u35SemGemea = units.filter(u=>u.enterprise_id===35 && !kTwin.has(k(u))).map(u=>({id:u.id,lote:"Q"+u.block+" L"+u.lot}));
// status x proposta aberta
const [openAr] = await c.query("SELECT ar.id, ar.enterprise_unity_id, ar.acquisition_request_stage_id, ar.open, eu.enterprise_id, eu.block, eu.lot, eu.sale_status_id FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE eu.enterprise_id IN (35,36,37)");
const vivas = openAr.filter(a=>![7,8,11].includes(a.acquisition_request_stage_id));
res.propostasVivas = vivas.length;
const dispComProposta = vivas.filter(a=>a.sale_status_id===1);
res.lotesDisponiveisComPropostaViva = dispComProposta.map(a=>({ar:a.id,ent:a.enterprise_id,lote:"Q"+a.block+" L"+a.lot,stage:a.acquisition_request_stage_id,status:a.sale_status_id}));
// gemea vendida x masterplan disponivel (risco de vender 2x no evento)
const vivasKey = new Set(vivas.map(a=>String(a.block).trim()+"|"+String(a.lot).trim()));
res.masterplanDisponivelComVendaNaGemea = [...vivasKey].filter(kk=>{const o=m35.get(kk); return o && o.sale_status_id===1;});
// enterprise_unities_users (vinculo unidade<->usuario) apontando p/ unidades do 35
const [euu] = await c.query("SELECT euu.*, eu.enterprise_id, eu.block, eu.lot FROM enterprise_unities_users euu JOIN enterprise_unities eu ON eu.id=euu.enterprise_unity_id WHERE eu.enterprise_id IN (35,36,37)");
res.vinculoUnidadeUsuario = euu.reduce((m,r)=>{m[r.enterprise_id]=(m[r.enterprise_id]||0)+1;return m;},{});
res.vinculoAmostra = euu.slice(0,10);
await c.end();
fs.writeFileSync("audit-vlo-res2.json", JSON.stringify(res,null,1));
console.log(JSON.stringify(res,null,1).slice(0,9000));
