import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const q = async (s,p)=>{const [r]=await c.query(s,p);return r;};
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const out = {};

// estado atual das 280 propostas
const cur = await q(`SELECT ar.id, ar.code, ar.enterprise_unity_id, ar.open, ar.acquisition_request_stage_id AS stage,
  ar.client_id, u.name AS cliente, u.cpf AS cpf,
  eu.enterprise_id, eu.block, eu.lot, eu.area, eu.price, eu.registration, eu.enterprise_unity_type_id AS tipo, eu.sale_status_id
 FROM acquisition_requests ar
 LEFT JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id
 LEFT JOIN users u ON u.id=ar.client_id
 WHERE ar.id IN (?)`,[ids]);
out.n_backup = bk.length; out.n_encontradas = cur.length;
const curById = new Map(cur.map(r=>[r.id,r]));
out.sumidas = ids.filter(i=>!curById.has(i));

// unidades originais (35)
const origIds = [...new Set(bk.map(b=>b.enterprise_unity_id))];
const orig = await q(`SELECT id, enterprise_id, block, lot, area, price, registration, enterprise_unity_type_id AS tipo, sale_status_id, sale_blocked, secured_lot FROM enterprise_unities WHERE id IN (?)`,[origIds]);
const origById = new Map(orig.map(r=>[r.id,r]));

// divergencias de mapeamento
const num = v => v==null?null:String(v).replace(/^0+/,'')||'0';
out.map_erros = [];
for (const b of bk) {
  const r = curById.get(b.id); if(!r) continue;
  const o = origById.get(b.enterprise_unity_id);
  const esperado = b.tipo && /interna/i.test(b.tipo) ? 37 : 36;
  const e = [];
  if (num(r.block)!==num(b.block) || num(r.lot)!==num(b.lot)) e.push(`lote mudou: backup Q${b.block}/L${b.lot} -> agora Q${r.block}/L${r.lot}`);
  if (r.enterprise_id!==esperado) e.push(`empresa errada: tipo "${b.tipo}" deveria ir p/ ${esperado===37?'VOC(37)':'VOL(36)'} mas esta em ${r.enterprise_id}`);
  if (o && r.tipo!==o.tipo) e.push(`tipo divergente: origem ${o.tipo} -> destino ${r.tipo}`);
  if (o && String(o.registration||'')!==String(r.registration||'')) e.push(`matricula: origem "${o.registration}" -> destino "${r.registration}"`);
  if (o && Number(o.area)!==Number(r.area)) e.push(`area: ${o.area} -> ${r.area}`);
  if (o && Number(o.price)!==Number(r.price)) e.push(`preco: ${o.price} -> ${r.price}`);
  if (r.open!==b.open) e.push(`open mudou: ${b.open} -> ${r.open}`);
  if (r.stage!==b.acquisition_request_stage_id) e.push(`stage mudou: ${b.acquisition_request_stage_id} -> ${r.stage}`);
  if (e.length) out.map_erros.push({id:b.id, cliente:r.cliente, code:r.code, quadra:b.block, lote:b.lot, erros:e});
}

// duas propostas na mesma unidade destino?
const byUnit = {};
for (const r of cur) (byUnit[r.enterprise_unity_id] ||= []).push(r);
out.unidade_com_mais_de_uma_proposta = Object.entries(byUnit).filter(([,v])=>v.length>1)
  .map(([u,v])=>({unidade:+u, emp:v[0].enterprise_id, q:v[0].block, l:v[0].lot, propostas:v.map(x=>({id:x.id,cliente:x.cliente,stage:x.stage,open:x.open}))}));

// pendurados: contagens por proposta
const cnt = async (tab,col='acquisition_request_id') => q(`SELECT ${col} ar, COUNT(*) n FROM ${tab} WHERE ${col} IN (?) GROUP BY ${col}`,[ids]);
const tot = async (tab,col='acquisition_request_id') => (await q(`SELECT COUNT(*) n FROM ${tab} WHERE ${col} IN (?)`,[ids]))[0].n;
out.totais_pendurados = {
  contratos: await tot('acquisition_request_contracts'),
  pagamentos: await tot('payments'),
  historicos: await tot('acquisition_request_historics'),
  planos_comerciais: await tot('commercial_plans'),
  reguas_reajuste: await tot('contract_adjustment_schedules'),
  corretores: await tot('acquisition_requests_corretores'),
  imobiliarias: await tot('acquisition_requests_imobiliarias'),
};
// orfaos globais (qualquer tabela apontando p/ AR inexistente)
const orfao = async (tab) => (await q(`SELECT COUNT(*) n FROM ${tab} t LEFT JOIN acquisition_requests ar ON ar.id=t.acquisition_request_id WHERE ar.id IS NULL AND t.acquisition_request_id IS NOT NULL`))[0].n;
out.orfaos_globais = {
  contratos: await orfao('acquisition_request_contracts'),
  pagamentos: await orfao('payments'),
  historicos: await orfao('acquisition_request_historics'),
  planos: await orfao('commercial_plans'),
  reguas: await orfao('contract_adjustment_schedules'),
  corretores: await orfao('acquisition_requests_corretores'),
  imobiliarias: await orfao('acquisition_requests_imobiliarias'),
};
// AR apontando p/ unidade inexistente (global)
out.ar_sem_unidade = await q(`SELECT ar.id, ar.enterprise_unity_id FROM acquisition_requests ar LEFT JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE eu.id IS NULL`);
// assinaturas ligadas a contratos inexistentes
out.assinaturas_orfas = (await q(`SELECT COUNT(*) n FROM contract_signatures cs LEFT JOIN acquisition_request_contracts arc ON arc.id=cs.acquisition_request_contract_id WHERE arc.id IS NULL`))[0].n;
out.signers_orfaos = (await q(`SELECT COUNT(*) n FROM contract_signature_signers css LEFT JOIN contract_signatures cs ON cs.id=css.contract_signature_id WHERE cs.id IS NULL`))[0].n;

// plano comercial da proposta aponta p/ empreendimento antigo?
out.planos_emp = await q(`SELECT cp.enterprise_id, COUNT(*) n FROM commercial_plans cp WHERE cp.acquisition_request_id IN (?) GROUP BY cp.enterprise_id`,[ids]);
out.planos_emp_35 = await q(`SELECT cp.id, cp.acquisition_request_id, cp.enterprise_id FROM commercial_plans cp WHERE cp.acquisition_request_id IN (?) AND cp.enterprise_id=35 LIMIT 20`,[ids]);

// propostas nas unidades do 35 que sobraram (deveria ser 0)
out.ar_ainda_no_35 = await q(`SELECT ar.id, ar.code, eu.block, eu.lot FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE eu.enterprise_id=35`);
// propostas em 36/37 fora do backup (criadas depois / inesperadas)
out.ar_extras_36_37 = await q(`SELECT ar.id, ar.code, eu.enterprise_id, eu.block, eu.lot, ar.created_at FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE eu.enterprise_id IN (36,37) AND ar.id NOT IN (?)`,[ids]);

fs.writeFileSync("audit-vlo-out2.json", JSON.stringify(out,null,1));
console.log(JSON.stringify({...out, map_erros: out.map_erros.slice(0,15), map_erros_n: out.map_erros.length},null,1).slice(0,9000));
await c.end();
