import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const bkById = new Map(bk.map(b=>[b.id,b]));
const contratos = JSON.parse(fs.readFileSync("audit-vlo-contratos-raw.json","utf8"));
const [ars] = await c.query("SELECT id,code,enterprise_unity_id,client_id,client_2_id,client_3_id,client_4_id,client_5_id,acquisition_request_stage_id,open,created_at FROM acquisition_requests WHERE id IN ("+ids.join(",")+")");
const arById = new Map(ars.map(a=>[a.id,a]));
const [units] = await c.query("SELECT id,enterprise_id,block,lot,price,area,registration FROM enterprise_unities WHERE enterprise_id IN (35,36,37)");
const uById = new Map(units.map(u=>[u.id,u]));
const cids = new Set(); for(const a of ars) for(const f of ["client_id","client_2_id","client_3_id","client_4_id","client_5_id"]) if(a[f]) cids.add(a[f]);
const [us] = await c.query("SELECT id,name,cpf,cnpj FROM users WHERE id IN ("+[...cids].join(",")+")");
for(const u of us) u.cpf_cnpj = u.cpf || u.cnpj;
const uMap = new Map(us.map(u=>[u.id,u]));
const onlyDigits = s => String(s||"").replace(/\D/g,"");
const num2word = {};
const res = {contratos:contratos.length, okLote:0, okCpf:0, semLoteNoTexto:0, semCpfNoTexto:0, divergencias:[], quadraEncontrada:0, okQuadra:0};
for(const ct of contratos){
  const ar = arById.get(ct.ar); if(!ar) { res.divergencias.push({tipo:"CONTRATO_SEM_PROPOSTA", contrato:ct.id, ar:ct.ar}); continue; }
  const u = uById.get(ar.enterprise_unity_id);
  const bkRow = bkById.get(ct.ar);
  const txt = ct.txt;
  const mLote = txt.match(/LOTE\s*:?\s*(\d{1,3})\s*\(/i) || txt.match(/LOTE\s*n?[ºo°]?\s*:?\s*(\d{1,3})\b/i);
  const mQuadra = txt.match(/QUADRA\s*:?\s*(\d{1,3})\s*\(/i) || txt.match(/QUADRA\s*n?[ºo°]?\s*:?\s*(\d{1,3})\b/i);
  const cpfsTxt = new Set((txt.match(/\d{3}\.\d{3}\.\d{3}-\d{2}/g)||[]).map(onlyDigits));
  const cpfCli = onlyDigits(uMap.get(ar.client_id)?.cpf_cnpj);
  const cosCpf = [ar.client_2_id,ar.client_3_id,ar.client_4_id,ar.client_5_id].filter(Boolean).map(id=>onlyDigits(uMap.get(id)?.cpf_cnpj));
  if(mLote){
    const loteTxt = String(parseInt(mLote[1],10));
    const loteAtual = String(parseInt(u.lot,10));
    if(loteTxt===loteAtual) res.okLote++;
    else res.divergencias.push({tipo:"CONTRATO_LOTE_DIVERGENTE", ar:ct.ar, contrato:ct.id, cliente:uMap.get(ar.client_id)?.name, contratoDiz:"Lote "+loteTxt, unidadeAtual:"Q"+u.block+" L"+u.lot, backup:"Q"+bkRow.block+" L"+bkRow.lot, ent:u.enterprise_id});
  } else res.semLoteNoTexto++;
  if(mQuadra){
    res.quadraEncontrada++;
    const qTxt = String(parseInt(mQuadra[1],10)); const qAtual = String(parseInt(u.block,10));
    if(qTxt===qAtual) res.okQuadra++;
    else res.divergencias.push({tipo:"CONTRATO_QUADRA_DIVERGENTE", ar:ct.ar, contrato:ct.id, cliente:uMap.get(ar.client_id)?.name, contratoDiz:"Quadra "+qTxt, unidadeAtual:"Q"+u.block+" L"+u.lot, backup:"Q"+bkRow.block+" L"+bkRow.lot});
  }
  if(cpfsTxt.size===0) res.semCpfNoTexto++;
  else if(cpfCli && cpfsTxt.has(cpfCli)) res.okCpf++;
  else res.divergencias.push({tipo:"CONTRATO_CPF_COMPRADOR_NAO_BATE", ar:ct.ar, contrato:ct.id, cliente:uMap.get(ar.client_id)?.name, cpfClienteAtual:cpfCli?cpfCli.slice(0,3)+"***":null, cpfsNoContrato:[...cpfsTxt].map(x=>x.slice(0,3)+"***"), lote:"Q"+u.block+" L"+u.lot});
}
// valor do contrato x preco da unidade (checagem do preco que o cliente assinou)
const precoDiv = [];
for(const ct of contratos){
  const ar = arById.get(ct.ar); if(!ar) continue;
  const u = uById.get(ar.enterprise_unity_id);
  const vals = (ct.txt.match(/R\$\s*([\d\.]+,\d{2})/g)||[]).map(s=>Number(s.replace(/[^\d,]/g,"").replace(/\./g,"").replace(",",".")));
  const alvo = Number(u.price);
  const bate = vals.some(v=>Math.abs(v-alvo)<0.01);
  if(!bate) precoDiv.push({ar:ct.ar, precoUnidade:alvo, lote:"Q"+u.block+" L"+u.lot, valoresNoContrato:vals.slice(0,8)});
}
res.contratosComPrecoDaUnidade = contratos.length - precoDiv.length;
res.contratosSemPrecoBatendo = precoDiv.length;
res.precoDivAmostra = precoDiv.slice(0,10);
await c.end();
fs.writeFileSync("audit-vlo-res4.json", JSON.stringify(res,null,1));
console.log(JSON.stringify(res,null,1).slice(0,8000));
