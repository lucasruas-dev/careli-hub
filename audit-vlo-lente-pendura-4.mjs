import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const q = async (s,p)=>{const [r]=await c.query(s,p);return r;};
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const out = {};
out.momento_backup = new Date(1785763642150).toISOString();

// incorporadores dos 3 empreendimentos
out.incorporadores = await q("SELECT id, name, fantasy_name, cnpj, person_type_id, email FROM users WHERE id IN (4199,4734,4735)");
// draft de corretagem 5 e 37
out.drafts_brokerage = await q("SELECT id, enterprise_id, name FROM draft_contracts WHERE id IN (5,37,69,70,71)");

// proposta stage 3 sem contrato
out.stage3_sem_contrato = await q(`SELECT ar.id, ar.code, ar.acquisition_request_stage_id stage, ar.open, ar.created_at, ar.updated_at,
   u.name cliente, eu.enterprise_id, eu.block, eu.lot
  FROM acquisition_requests ar LEFT JOIN acquisition_request_contracts arc ON arc.acquisition_request_id=ar.id
  LEFT JOIN users u ON u.id=ar.client_id LEFT JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id
  WHERE ar.id IN (?) AND ar.acquisition_request_stage_id=3 AND arc.id IS NULL`,[ids]);

// quem foi tocado depois do backup? (migracao rodou 03/08)
const since = "2026-08-02 00:00:00";
out.tocados_apos = {
  propostas: (await q(`SELECT COUNT(*) n FROM acquisition_requests WHERE id IN (?) AND updated_at>=?`,[ids,since]))[0].n,
  contratos: (await q(`SELECT COUNT(*) n FROM acquisition_request_contracts WHERE acquisition_request_id IN (?) AND updated_at>=?`,[ids,since]))[0].n,
  pagamentos: (await q(`SELECT COUNT(*) n FROM payments WHERE acquisition_request_id IN (?) AND updated_at>=?`,[ids,since]))[0].n,
  historicos: (await q(`SELECT COUNT(*) n FROM acquisition_request_historics WHERE acquisition_request_id IN (?) AND updated_at>=?`,[ids,since]))[0].n,
  planos: (await q(`SELECT COUNT(*) n FROM commercial_plans WHERE acquisition_request_id IN (?) AND updated_at>=?`,[ids,since]))[0].n,
  unidades_35: (await q(`SELECT COUNT(*) n FROM enterprise_unities WHERE enterprise_id=35 AND updated_at>=?`,[since]))[0].n,
  unidades_3637: (await q(`SELECT COUNT(*) n FROM enterprise_unities WHERE enterprise_id IN (36,37) AND updated_at>=?`,[since]))[0].n,
};
out.max_updates = await q(`SELECT 'ar' t, MAX(updated_at) mx FROM acquisition_requests WHERE id IN (?)
  UNION ALL SELECT 'arc', MAX(updated_at) FROM acquisition_request_contracts WHERE acquisition_request_id IN (?)
  UNION ALL SELECT 'pay', MAX(updated_at) FROM payments WHERE acquisition_request_id IN (?)
  UNION ALL SELECT 'arh', MAX(updated_at) FROM acquisition_request_historics WHERE acquisition_request_id IN (?)`,[ids,ids,ids,ids]);

// pagamentos: detalhe por proposta
out.pag_por_proposta = await q(`SELECT p.acquisition_request_id ar, COUNT(*) n, SUM(p.payment_status_id=5) liq, SUM(p.payment_status_id=6) avencer,
   SUM(p.payment_status_id=7) vencida, SUM(p.payment_to_delete=1) del, SUM(p.payment_asaas_id IS NOT NULL AND p.payment_asaas_id<>'') asaas,
   SUM(p.total_parcels) , MIN(p.due_date) mind, MAX(p.due_date) maxd
  FROM payments p WHERE p.acquisition_request_id IN (?) GROUP BY p.acquisition_request_id`,[ids]);
out.pag_resumo = {
  propostas_com_pagamento: out.pag_por_proposta.length,
  total_parcelas: out.pag_por_proposta.reduce((a,b)=>a+b.n,0),
};
out.pag_status = await q(`SELECT payment_status_id st, COUNT(*) n, SUM(paid_value) pago FROM payments WHERE acquisition_request_id IN (?) GROUP BY payment_status_id`,[ids]);
// pagamentos de propostas canceladas / sem contrato
out.pag_por_stage = await q(`SELECT ar.acquisition_request_stage_id stage, COUNT(DISTINCT ar.id) props, COUNT(p.id) parcelas
  FROM acquisition_requests ar JOIN payments p ON p.acquisition_request_id=ar.id WHERE ar.id IN (?) GROUP BY 1`,[ids]);

// assinaturas
out.assinaturas = await q(`SELECT cs.id, cs.acquisition_request_contract_id arc_id, cs.contract_signature_status_id st, cs.uuidDoc IS NOT NULL tem_uuid,
   arc.acquisition_request_id ar_id, (SELECT COUNT(*) FROM contract_signature_signers css WHERE css.contract_signature_id=cs.id) signers,
   (SELECT COUNT(*) FROM contract_signature_signers css WHERE css.contract_signature_id=cs.id AND css.signed=1) assinados, cs.updated_at
  FROM contract_signatures cs JOIN acquisition_request_contracts arc ON arc.id=cs.acquisition_request_contract_id
  WHERE arc.acquisition_request_id IN (?)`,[ids]);
out.assin_resumo = { n: out.assinaturas.length, sem_signer: out.assinaturas.filter(a=>a.signers===0).length,
  tocadas_apos: out.assinaturas.filter(a=>a.updated_at>=since).length };

// historicos: sanidade (ligados a propostas do conjunto), stage final bate com ultimo historico?
out.hist_incoerente = await q(`SELECT ar.id, ar.acquisition_request_stage_id stage_atual, h.new_acquisition_request_stage_id ultimo_hist, h.created_at
  FROM acquisition_requests ar JOIN acquisition_request_historics h ON h.id=(SELECT MAX(h2.id) FROM acquisition_request_historics h2 WHERE h2.acquisition_request_id=ar.id)
  WHERE ar.id IN (?) AND h.new_acquisition_request_stage_id<>ar.acquisition_request_stage_id`,[ids]);

// unidades do 35: status espelhado?
out.status_espelho = await q(`SELECT o.block, o.lot, o.enterprise_unity_type_id tipo, o.sale_status_id st35, o.sale_blocked bl35, o.secured_lot sec35,
   d.enterprise_id emp_destino, d.sale_status_id st_dest, d.sale_blocked bl_dest, d.secured_lot sec_dest
  FROM enterprise_unities o JOIN enterprise_unities d ON d.block=o.block AND d.lot=o.lot AND d.enterprise_id = IF(o.enterprise_unity_type_id=1,37,36)
  WHERE o.enterprise_id=35 AND (o.sale_status_id<>d.sale_status_id OR COALESCE(o.sale_blocked,0)<>COALESCE(d.sale_blocked,0))`);
out.n_status_espelho_div = out.status_espelho.length;

fs.writeFileSync("audit-vlo-out4.json", JSON.stringify(out,null,1));
const {pag_por_proposta, assinaturas, status_espelho, ...resumo} = out;
console.log(JSON.stringify({...resumo, status_espelho_amostra: status_espelho.slice(0,10)},null,1).slice(0,8000));
await c.end();
