import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const q = async (s,p)=>{const [r]=await c.query(s,p);return r;};
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const out = {};

out.sale_statuses = await q("SELECT * FROM sale_statuses");
out.arc_status = await q("SELECT * FROM acquisition_request_contract_statuses");
// os 7 contratos da minuta 70: quadra citada bate?
const c70 = await q(`SELECT arc.id, arc.acquisition_request_id ar, arc.complete_text, eu.enterprise_id, eu.block, eu.lot, eu.registration, u.name cliente
  FROM acquisition_request_contracts arc JOIN acquisition_requests ar ON ar.id=arc.acquisition_request_id
  LEFT JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id LEFT JOIN users u ON u.id=ar.client_id
  WHERE arc.acquisition_request_id IN (?) AND arc.draft_contract_id=70`,[ids]);
const strip = s => (s||"").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&[a-z]+;/g," ").replace(/\s+/g," ");
const numOnly = v => String(v??"").replace(/\D/g,"").replace(/^0+/,"")||"0";
out.minuta70 = c70.map(r=>{const t=strip(r.complete_text);return {
  id:r.id, ar:r.ar, cliente:r.cliente, emp:r.enterprise_id, q:numOnly(r.block), l:numOnly(r.lot),
  trecho:(t.match(/.{0,220}quadra.{0,220}/i)||[""])[0].slice(0,440),
  q_txt:[...new Set([...t.matchAll(/quadra[:\s\-nºo\.]*([0-9]{1,3})/gi)].map(m=>numOnly(m[1])))],
  l_txt:[...new Set([...t.matchAll(/lote[:\s\-nºo\.]*([0-9]{1,3})/gi)].map(m=>numOnly(m[1])))],
  cita_vale:/vale\s+do\s+ouro/i.test(t), cita_matricula: t.includes(String(r.registration||'zzz'))
};});

// split_data / asaas dos pagamentos
out.pay_amostra = await q(`SELECT p.id, p.acquisition_request_id ar, p.payment_status_id st, p.initial_value, p.paid_value, p.due_date,
   p.payment_asaas_id, LEFT(p.split_data,400) split, p.description, p.parcel_type_id, p.current_total_parcel, p.total_parcels, p.updated_at
  FROM payments p WHERE p.acquisition_request_id IN (?) ORDER BY p.payment_status_id, p.id LIMIT 8`,[ids]);
out.pay_split_nao_nulo = (await q(`SELECT COUNT(*) n FROM payments WHERE acquisition_request_id IN (?) AND split_data IS NOT NULL AND split_data<>''`,[ids]))[0].n;
out.pay_com_asaas = (await q(`SELECT COUNT(*) n FROM payments WHERE acquisition_request_id IN (?) AND payment_asaas_id IS NOT NULL AND payment_asaas_id<>''`,[ids]))[0].n;
out.pagos = await q(`SELECT p.id, p.acquisition_request_id ar, p.paid_value, p.payment_date, u.name cliente, eu.enterprise_id, eu.block, eu.lot, ar2.acquisition_request_stage_id stage
  FROM payments p JOIN acquisition_requests ar2 ON ar2.id=p.acquisition_request_id LEFT JOIN users u ON u.id=ar2.client_id
  LEFT JOIN enterprise_unities eu ON eu.id=ar2.enterprise_unity_id
  WHERE p.acquisition_request_id IN (?) AND p.payment_status_id=5`,[ids]);
out.pagos_resumo = {n: out.pagos.length, total: out.pagos.reduce((a,b)=>a+Number(b.paid_value),0),
  por_emp: out.pagos.reduce((a,b)=>{a[b.enterprise_id]=(a[b.enterprise_id]||0)+1;return a;},{}),
  em_proposta_cancelada: out.pagos.filter(p=>[7,8,11].includes(p.stage)).map(p=>({ar:p.ar,cliente:p.cliente,q:p.block,l:p.lot,valor:p.paid_value}))};

// parcelas vs total_parcels declarado
out.parcelas_incoerentes = await q(`SELECT acquisition_request_id ar, COUNT(*) reais, MAX(total_parcels) declarado
  FROM payments WHERE acquisition_request_id IN (?) GROUP BY acquisition_request_id HAVING COUNT(*)<>MAX(total_parcels)+0 LIMIT 30`,[ids]);
// propostas em stage 3 SEM pagamento (deveriam ter sinal?)
out.stage3_sem_pagamento = await q(`SELECT ar.id, ar.code, u.name cliente, eu.enterprise_id, eu.block, eu.lot
  FROM acquisition_requests ar LEFT JOIN payments p ON p.acquisition_request_id=ar.id LEFT JOIN users u ON u.id=ar.client_id
  LEFT JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id
  WHERE ar.id IN (?) AND ar.acquisition_request_stage_id=3 GROUP BY ar.id HAVING COUNT(p.id)=0`,[ids]);

// historico: quantos por proposta e se alguma perdeu historico
out.hist_por_proposta = await q(`SELECT ar.id, COUNT(h.id) n FROM acquisition_requests ar LEFT JOIN acquisition_request_historics h ON h.acquisition_request_id=ar.id WHERE ar.id IN (?) GROUP BY ar.id HAVING COUNT(h.id)=0`,[ids]);

// contratos duplicados por proposta
out.contratos_dup = await q(`SELECT acquisition_request_id ar, COUNT(*) n, GROUP_CONCAT(id) ids FROM acquisition_request_contracts WHERE acquisition_request_id IN (?) GROUP BY acquisition_request_id HAVING COUNT(*)>1`,[ids]);

fs.writeFileSync("audit-vlo-out6.json", JSON.stringify(out,null,1));
console.log(JSON.stringify({...out, minuta70: out.minuta70.map(m=>({...m, trecho: m.trecho.slice(0,300)})), pagos: undefined},null,1).slice(0,10000));
await c.end();
