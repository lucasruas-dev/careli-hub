import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));

const [types] = await c.query("SELECT * FROM enterprise_unity_types");
const [units] = await c.query("SELECT id,enterprise_id,name,block,lot,area,price,registration,registration_number,registration_book_number,sale_status_id,secured_lot,sale_blocked,enterprise_unity_type_id,created_at,updated_at FROM enterprise_unities WHERE enterprise_id IN (35,36,37)");
const byId = new Map(units.map(u=>[u.id,u]));
const keyOf = u=>`${u.enterprise_id}|${String(u.block)}|${String(u.lot)}`;
const byKey = new Map(); const dupKeys=[];
for (const u of units){ const k=keyOf(u); if(byKey.has(k)) dupKeys.push(k); else byKey.set(k,u); }

const ids = bk.map(b=>b.id);
const [ars] = await c.query("SELECT id,code,enterprise_unity_id,client_id,client_2_id,client_3_id,client_4_id,client_5_id,corretor_id,open,acquisition_request_stage_id,created_at,updated_at FROM acquisition_requests WHERE id IN ("+ids.join(",")+")");
const arById = new Map(ars.map(a=>[a.id,a]));

const clientIds = new Set();
for(const a of ars){ for(const f of ["client_id","client_2_id","client_3_id","client_4_id","client_5_id"]) if(a[f]) clientIds.add(a[f]); }
const [usersRows] = await c.query("SELECT id,name FROM users WHERE id IN ("+([...clientIds].join(",")||"0")+")");
const uName = new Map(usersRows.map(u=>[u.id,u.name]));

const [allArs] = await c.query("SELECT ar.id,ar.enterprise_unity_id,ar.client_id,ar.open,ar.acquisition_request_stage_id,eu.enterprise_id,eu.block,eu.lot FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE eu.enterprise_id IN (35,36,37)");
const allArsByEnterprise = allArs.reduce((m,a)=>{m[a.enterprise_id]=(m[a.enterprise_id]||0)+1;return m;},{});
const idSet = new Set(ids);
const strayNotInBackup = allArs.filter(a=>!idSet.has(a.id)).map(a=>({id:a.id,ent:a.enterprise_id,block:a.block,lot:a.lot,stage:a.acquisition_request_stage_id,open:a.open,client:a.client_id}));

const problems = [];
const chk = {existe:0, blockLot:0, empreendimento:0, price:0, area:0, registration:0, clientPresente:0, stage:0, open:0, origIntacta:0};
const norm = v => v===null||v===undefined?null:String(v).trim();
const num = v => v===null||v===undefined?null:Number(v);
const rows = [];
for (const b of bk){
  const ar = arById.get(b.id);
  if(!ar){ problems.push({tipo:"PROPOSTA_SUMIU", id:b.id, block:b.block, lot:b.lot}); continue; }
  chk.existe++;
  const orig = byId.get(b.enterprise_unity_id);
  const now = byId.get(ar.enterprise_unity_id);
  const cliente = uName.get(ar.client_id) || ("(client_id "+ar.client_id+")");
  const rec = {id:b.id, code:ar.code, cliente, client_id:ar.client_id,
    co:[ar.client_2_id,ar.client_3_id,ar.client_4_id,ar.client_5_id].filter(Boolean),
    antes:{unit:b.enterprise_unity_id, block:b.block, lot:b.lot, tipo:b.tipo, open:b.open, stage:b.acquisition_request_stage_id},
    agora:{unit:ar.enterprise_unity_id, ent:now?now.enterprise_id:null, block:now?now.block:null, lot:now?now.lot:null, type:now?now.enterprise_unity_type_id:null, open:ar.open, stage:ar.acquisition_request_stage_id}};
  rows.push(rec);
  if(!now){ problems.push({tipo:"UNIDADE_ATUAL_FORA_DO_VALE", id:b.id, cliente, unidade:ar.enterprise_unity_id, antes:"Q"+b.block+" L"+b.lot}); continue; }
  if(!orig){ problems.push({tipo:"UNIDADE_ORIGINAL_SUMIU", id:b.id, cliente, unidade_orig:b.enterprise_unity_id}); }
  if(norm(now.block)===norm(b.block) && norm(now.lot)===norm(b.lot)) chk.blockLot++;
  else problems.push({tipo:"LOTE_TROCADO", id:b.id, cliente, antes:"Q"+b.block+" L"+b.lot, depois:"Q"+now.block+" L"+now.lot, unidade_antes:b.enterprise_unity_id, unidade_depois:now.id});
  const tipoOrig = orig ? orig.enterprise_unity_type_id : (String(b.tipo).toLowerCase().includes("extern")?2:1);
  const espera = tipoOrig===1?37:36;
  if(now.enterprise_id===espera) chk.empreendimento++;
  else problems.push({tipo:"EMPREENDIMENTO_ERRADO", id:b.id, cliente, lote:"Q"+b.block+" L"+b.lot, tipo_orig:b.tipo, esperado:espera, atual:now.enterprise_id});
  if(orig){
    if(num(orig.price)===num(now.price)) chk.price++; else problems.push({tipo:"PRECO_DIFERENTE", id:b.id, cliente, lote:"Q"+b.block+" L"+b.lot, antes:orig.price, depois:now.price, unidade_antes:orig.id, unidade_depois:now.id});
    if(num(orig.area)===num(now.area)) chk.area++; else problems.push({tipo:"AREA_DIFERENTE", id:b.id, cliente, lote:"Q"+b.block+" L"+b.lot, antes:orig.area, depois:now.area});
    if(norm(orig.registration)===norm(now.registration) && norm(orig.registration_number)===norm(now.registration_number)) chk.registration++;
    else problems.push({tipo:"MATRICULA_DIFERENTE", id:b.id, cliente, lote:"Q"+b.block+" L"+b.lot, antes:{r:orig.registration,rn:orig.registration_number}, depois:{r:now.registration,rn:now.registration_number}});
    if(norm(orig.block)===norm(b.block)&&norm(orig.lot)===norm(b.lot)) chk.origIntacta++;
    else problems.push({tipo:"UNIDADE_ORIGINAL_ALTERADA", id:b.id, unidade:orig.id, backup:"Q"+b.block+" L"+b.lot, hoje:"Q"+orig.block+" L"+orig.lot});
  }
  if(ar.client_id) chk.clientPresente++; else problems.push({tipo:"SEM_COMPRADOR", id:b.id, lote:"Q"+b.block+" L"+b.lot});
  if(ar.acquisition_request_stage_id===b.acquisition_request_stage_id) chk.stage++; else problems.push({tipo:"ESTAGIO_MUDOU", id:b.id, cliente, lote:"Q"+b.block+" L"+b.lot, antes:b.acquisition_request_stage_id, depois:ar.acquisition_request_stage_id});
  if(ar.open===b.open) chk.open++; else problems.push({tipo:"OPEN_MUDOU", id:b.id, cliente, lote:"Q"+b.block+" L"+b.lot, antes:b.open, depois:ar.open});
}
const porUnidade = {};
for(const r of rows){ (porUnidade[r.agora.unit] = porUnidade[r.agora.unit] || []).push(r); }
const colisoes = Object.entries(porUnidade).filter(([,v])=>v.length>1).map(([u,v])=>({unidade:+u, propostas:v.map(x=>({id:x.id,cliente:x.cliente,lote:"Q"+x.antes.block+" L"+x.antes.lot,stage:x.agora.stage,open:x.agora.open}))}));
const porOrigem = {};
for(const r of rows){ (porOrigem[r.antes.unit] = porOrigem[r.antes.unit] || []).push(r); }
const multiOrigem = Object.entries(porOrigem).filter(([,v])=>v.length>1).map(([u,v])=>({unidadeOrig:+u, n:v.length, ids:v.map(x=>x.id), destinos:v.map(x=>x.agora.unit)}));

fs.writeFileSync("audit-vlo-resultado.json", JSON.stringify({chk, totalBackup:bk.length, arsEncontradas:ars.length, problems, colisoes, multiOrigem, allArsByEnterprise, allArsTotal:allArs.length, stray:strayNotInBackup, dupKeys, unitTotal:units.length, types}, null, 1));
fs.writeFileSync("audit-vlo-rows.json", JSON.stringify(rows, null, 1));
console.log("CHK", JSON.stringify(chk), "totalBackup", bk.length, "arsEncontradas", ars.length);
console.log("problemas:", problems.length);
console.log(JSON.stringify(problems.slice(0,40), null, 1));
console.log("colisoes(mesma unidade destino):", colisoes.length, JSON.stringify(colisoes.slice(0,10)));
console.log("multiOrigem(mesma unidade origem):", multiOrigem.length, JSON.stringify(multiOrigem.slice(0,10)));
console.log("ARs por empreendimento", JSON.stringify(allArsByEnterprise), "total", allArs.length, "stray", strayNotInBackup.length);
console.log("stray sample", JSON.stringify(strayNotInBackup.slice(0,25)));
console.log("dupKeys", JSON.stringify(dupKeys));
await c.end();
