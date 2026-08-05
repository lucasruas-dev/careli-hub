import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id); const bkById = new Map(bk.map(b=>[b.id,b]));
const res = {};
// A) quem e ANTONIO CASTRO JUNIOR e onde ele aparece
const [ant] = await c.query("SELECT id,name,cpf FROM users WHERE name LIKE '%ANTONIO CASTRO%' OR cpf='10508552648' OR cpf='105.085.526-48'");
res.antonio = ant;
if(ant.length){
  const [arAnt] = await c.query("SELECT ar.id, ar.client_id, ar.acquisition_request_stage_id, ar.open, ar.created_at, eu.enterprise_id, eu.block, eu.lot FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE ar.client_id IN ("+ant.map(a=>a.id).join(",")+") OR ar.client_2_id IN ("+ant.map(a=>a.id).join(",")+")");
  res.propostasDoAntonio = arAnt.map(a=>({ar:a.id, ent:a.enterprise_id, lote:"Q"+a.block+" L"+a.lot, stage:a.acquisition_request_stage_id, open:a.open, backup:bkById.get(a.id)?("Q"+bkById.get(a.id).block+" L"+bkById.get(a.id).lot):"(fora do backup)"}));
}
// B) ARs com mais de um contrato
const [multi] = await c.query("SELECT acquisition_request_id, COUNT(*) n, GROUP_CONCAT(id) contratos FROM acquisition_request_contracts WHERE acquisition_request_id IN ("+ids.join(",")+") GROUP BY 1 HAVING n>1");
res.arsComVariosContratos = multi;
// C) todos os contratos: extrair nome do COMPRADOR e comparar com client_id atual (busca por CPF do titular tb)
const contratos = JSON.parse(fs.readFileSync("audit-vlo-contratos-raw.json","utf8"));
const [ars] = await c.query("SELECT id,enterprise_unity_id,client_id,client_2_id FROM acquisition_requests WHERE id IN ("+ids.join(",")+")");
const arById = new Map(ars.map(a=>[a.id,a]));
const cids = new Set(); for(const a of ars) for(const f of ["client_id","client_2_id"]) if(a[f]) cids.add(a[f]);
const [us] = await c.query("SELECT id,name,cpf,cnpj FROM users WHERE id IN ("+[...cids].join(",")+")");
const uMap = new Map(us.map(u=>[u.id,u]));
const [units] = await c.query("SELECT id,enterprise_id,block,lot FROM enterprise_unities WHERE enterprise_id IN (35,36,37)");
const uById = new Map(units.map(u=>[u.id,u]));
const dig = s=>String(s||"").replace(/\D/g,"");
const strip = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z ]/g," ").replace(/\s+/g," ").trim();
let okNomeOuCpf=0; const divergentes=[];
for(const ct of contratos){
  const ar = arById.get(ct.ar); if(!ar) continue;
  const u = uById.get(ar.enterprise_unity_id);
  const cli = uMap.get(ar.client_id);
  const up = ct.txt.toUpperCase(); const j = up.indexOf("COMPRADOR(ES) E DEVEDOR");
  const sec = j>=0 ? ct.txt.slice(j, j+900) : ct.txt;
  const secN = strip(sec);
  const nome = strip(cli?.name);
  const cpfs = new Set((sec.match(/\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2}/g)||[]).map(dig));
  const cpfCli = dig(cli?.cpf || cli?.cnpj);
  const bateNome = nome && secN.includes(nome);
  const bateCpf = cpfCli && cpfs.has(cpfCli);
  if(bateNome || bateCpf) okNomeOuCpf++;
  else divergentes.push({ar:ct.ar, contrato:ct.id, clienteNaProposta:cli?.name, cpfProposta:cpfCli?cpfCli.slice(0,3)+"***"+cpfCli.slice(-2):null, loteAtual:"Q"+u.block+" L"+u.lot, ent:u.enterprise_id, loteBackup:"Q"+bkById.get(ct.ar).block+" L"+bkById.get(ct.ar).lot, trechoContrato: sec.replace(/\s+/g," ").slice(0,260)});
}
res.contratoCompradorConfere = okNomeOuCpf;
res.contratoCompradorDivergente = divergentes;
// D) incorporadores e contas asaas
const [inc] = await c.query("SELECT id,name,cnpj,cpf,asaas_account_id IS NOT NULL tem_conta, asaas_wallet_id IS NOT NULL tem_wallet, is_gestora_recebiveis FROM users WHERE id IN (4199,4734,4735)");
res.incorporadores = inc;
// E) payments: colunas de vinculo com cliente
const [pcols] = await c.query("SHOW COLUMNS FROM payments");
res.paymentsTodasCols = pcols.map(r=>r.Field).join(", ");
await c.end();
fs.writeFileSync("audit-vlo-res8.json", JSON.stringify(res,null,1));
console.log(JSON.stringify(res,null,1).slice(0,9000));
