import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id); const bkById = new Map(bk.map(b=>[b.id,b]));
const contratos = JSON.parse(fs.readFileSync("audit-vlo-contratos-raw.json","utf8"));
const [ars] = await c.query("SELECT id,code,enterprise_unity_id,client_id,client_2_id,client_3_id,client_4_id,client_5_id,corretor_id,acquisition_request_stage_id,open,created_at,updated_at FROM acquisition_requests WHERE id IN ("+ids.join(",")+")");
const arById = new Map(ars.map(a=>[a.id,a]));
const [units] = await c.query("SELECT id,enterprise_id,name,block,lot,price FROM enterprise_unities WHERE enterprise_id IN (35,36,37)");
const uById = new Map(units.map(u=>[u.id,u]));
const cids = new Set(); for(const a of ars) for(const f of ["client_id","client_2_id","client_3_id","client_4_id","client_5_id"]) if(a[f]) cids.add(a[f]);
const [us] = await c.query("SELECT id,name,cpf,cnpj,profile_id FROM users WHERE id IN ("+[...cids].join(",")+")");
const uMap = new Map(us.map(u=>[u.id,u]));
const res = {};
// 1) contratos criados ANTES da migracao?
const mig = "2026-08-03 10:26:00";
res.contratosCriadosAntesDaMigracao = contratos.filter(x=>x.created_at < mig).length;
res.contratosCriadosDepois = contratos.filter(x=>x.created_at >= mig).map(x=>({contrato:x.id, ar:x.ar, created_at:x.created_at}));
res.contratoMaisNovo = contratos.map(x=>x.created_at).sort().slice(-1)[0];
res.contratosAtualizadosDepois = contratos.filter(x=>x.updated_at && x.updated_at >= mig).length;
// 2) nome do comprador no texto do contrato x client_id atual
const strip = s => String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toUpperCase().replace(/[^A-Z ]/g," ").replace(/\s+/g," ").trim();
let nomeOk=0; const nomeDiv=[];
for(const ct of contratos){
  const ar = arById.get(ct.ar); if(!ar) continue;
  const nome = strip(uMap.get(ar.client_id)?.name);
  const txt = strip(ct.txt);
  const u = uById.get(ar.enterprise_unity_id);
  if(nome && txt.includes(nome)) nomeOk++;
  else {
    const partes = nome.split(" ").filter(p=>p.length>2);
    const hits = partes.filter(p=>txt.includes(p)).length;
    nomeDiv.push({ar:ct.ar, contrato:ct.id, cliente:uMap.get(ar.client_id)?.name, lote:"Q"+u.block+" L"+u.lot, ent:u.enterprise_id, partesEncontradas:hits+"/"+partes.length});
  }
}
res.contratoNomeCompradorBate = nomeOk; res.contratoNomeDivergente = nomeDiv;
// 3) code da proposta x unidade atual
const codePat = ars.map(a=>({id:a.id, code:a.code, unidade:uById.get(a.enterprise_unity_id)?.name, ent:uById.get(a.enterprise_unity_id)?.enterprise_id}));
res.amostraCodes = codePat.slice(0,8);
res.codesComVLO = codePat.filter(x=>String(x.code||"").toUpperCase().includes("VLO")).length;
// 4) sanidade de co-compradores
const coProblemas=[];
for(const a of ars){
  const co = [a.client_2_id,a.client_3_id,a.client_4_id,a.client_5_id].filter(Boolean);
  if(co.includes(a.client_id)) coProblemas.push({tipo:"CO_IGUAL_AO_PRINCIPAL", ar:a.id});
  for(const x of co) if(!uMap.get(x)) coProblemas.push({tipo:"CO_COMPRADOR_INEXISTENTE", ar:a.id, user:x});
  if(new Set(co).size!==co.length) coProblemas.push({tipo:"CO_DUPLICADO", ar:a.id});
}
res.propostasComCoComprador = ars.filter(a=>a.client_2_id||a.client_3_id||a.client_4_id||a.client_5_id).length;
res.coProblemas = coProblemas;
res.compradoresDistintos = new Set(ars.map(a=>a.client_id)).size;
res.propostasSemCorretor = ars.filter(a=>!a.corretor_id).length;
// 5) pagamentos: parcela aponta p/ proposta; confirma que nenhuma ficou orfa e que o valor bate com a unidade
const [pay] = await c.query("SELECT id, acquisition_request_id, initial_value, payment_status_id, due_date, parcel_type_id, current_total_parcel, total_parcels FROM payments WHERE acquisition_request_id IN ("+ids.join(",")+")");
res.parcelas = pay.length;
res.parcelasPorStatus = pay.reduce((m,p)=>{m[p.payment_status_id]=(m[p.payment_status_id]||0)+1;return m;},{});
// 6) unidades do 35 sem proposta mas com status vendido/reservado (espelho manual)
const [u35] = await c.query("SELECT eu.id, eu.block, eu.lot, eu.sale_status_id, (SELECT COUNT(*) FROM acquisition_requests ar WHERE ar.enterprise_unity_id=eu.id) n FROM enterprise_unities eu WHERE eu.enterprise_id=35");
res.masterplan35 = {total:u35.length, comProposta:u35.filter(x=>x.n>0).length, ocupadasSemProposta:u35.filter(x=>x.sale_status_id!==1 && x.n===0).length, disponiveis:u35.filter(x=>x.sale_status_id===1).length};
// 7) distribuicao de status nas gemeas x propostas vivas
const [gem] = await c.query("SELECT eu.enterprise_id, eu.sale_status_id, COUNT(*) n FROM enterprise_unities eu WHERE eu.enterprise_id IN (35,36,37) GROUP BY 1,2");
res.statusPorEmpreendimento = gem;
const vivas = ars.filter(a=>![7,8,11].includes(a.acquisition_request_stage_id));
res.propostasVivas = vivas.length;
const unidadesVivas = new Set(vivas.map(a=>a.enterprise_unity_id));
res.unidadesComPropostaViva = unidadesVivas.size;
const [statusUnidVivas] = await c.query("SELECT id, enterprise_id, block, lot, sale_status_id FROM enterprise_unities WHERE id IN ("+[...unidadesVivas].join(",")+")");
res.unidadeVivaMarcadaDisponivel = statusUnidVivas.filter(u=>u.sale_status_id===1).map(u=>({unidade:u.id, ent:u.enterprise_id, lote:"Q"+u.block+" L"+u.lot}));
// 8) duas propostas VIVAS na mesma unidade (dois donos p/ o mesmo lote)
const cnt = {}; for(const a of vivas) cnt[a.enterprise_unity_id]=(cnt[a.enterprise_unity_id]||0)+1;
res.unidadesComMaisDeUmaPropostaViva = Object.entries(cnt).filter(([,n])=>n>1).map(([u,n])=>{
  const un = uById.get(+u);
  return {unidade:+u, ent:un.enterprise_id, lote:"Q"+un.block+" L"+un.lot, n, propostas: vivas.filter(a=>a.enterprise_unity_id===+u).map(a=>({ar:a.id, cliente:uMap.get(a.client_id)?.name, stage:a.acquisition_request_stage_id, criada:a.created_at}))};
});
await c.end();
fs.writeFileSync("audit-vlo-res5.json", JSON.stringify(res,null,1));
console.log(JSON.stringify(res,null,1).slice(0,12000));
