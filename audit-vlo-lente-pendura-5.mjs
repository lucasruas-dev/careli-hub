import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const q = async (s,p)=>{const [r]=await c.query(s,p);return r;};
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const out = {};

// 1) placeholder de quadra literal no texto
out.placeholder = (await q(`SELECT
   SUM(complete_text LIKE '%QUADRA [%') q_placeholder,
   SUM(complete_text LIKE '%[●]%') bolinha,
   COUNT(*) total
  FROM acquisition_request_contracts WHERE acquisition_request_id IN (?)`,[ids]))[0];
// contratos que citam quadra de verdade
out.contratos_com_quadra = await q(`SELECT arc.id, arc.acquisition_request_id ar, arc.draft_contract_id
  FROM acquisition_request_contracts arc WHERE arc.acquisition_request_id IN (?) AND arc.complete_text NOT LIKE '%QUADRA [%'`,[ids]);

// 2) commercial_plans: estrutura e vinculo
out.cols_cp = (await q("SHOW COLUMNS FROM commercial_plans")).map(r=>r.Field);
out.cp_sample = await q(`SELECT * FROM commercial_plans WHERE acquisition_request_id IN (?) LIMIT 2`,[ids]);
out.ar_plan_link = (await q(`SELECT COUNT(*) total, SUM(cp.id IS NULL) sem_plano, SUM(cp.enterprise_id=35) plano_no_35, SUM(cp.acquisition_request_id=ar.id) plano_da_propria
  FROM acquisition_requests ar LEFT JOIN commercial_plans cp ON cp.id=ar.commercial_plan_id WHERE ar.id IN (?)`,[ids]))[0];
out.ar_plan_alheio = await q(`SELECT ar.id, ar.commercial_plan_id, cp.acquisition_request_id dono_do_plano, cp.enterprise_id
  FROM acquisition_requests ar JOIN commercial_plans cp ON cp.id=ar.commercial_plan_id
  WHERE ar.id IN (?) AND (cp.acquisition_request_id IS NULL OR cp.acquisition_request_id<>ar.id) LIMIT 20`,[ids]);

// 3) vinculos por empreendimento (corretor/imobiliaria/cliente/usuario/split)
const cnt = async (tab) => await q(`SELECT enterprise_id, COUNT(*) n FROM ${tab} WHERE enterprise_id IN (35,36,37) GROUP BY enterprise_id`);
out.vinculos = {
  corretores_enterprises: await cnt('corretores_enterprises'),
  enterprises_imobiliarias: await cnt('enterprises_imobiliarias'),
  enterprises_users: await cnt('enterprises_users'),
  clients_enterprises: await cnt('clients_enterprises'),
  split_enterprises: await cnt('split_enterprises'),
  commercial_policies: await cnt('commercial_policies'),
  enterprise_admin_fee_profiles: await cnt('enterprise_admin_fee_profiles'),
  enterprise_sale_status_colors: await cnt('enterprise_sale_status_colors'),
  enterprise_asaas_notification_configs: await cnt('enterprise_asaas_notification_configs'),
};
out.eu_users = await q(`SELECT eu.enterprise_id, COUNT(*) n FROM enterprise_unities_users euu JOIN enterprise_unities eu ON eu.id=euu.enterprise_unity_id WHERE eu.enterprise_id IN (35,36,37) GROUP BY eu.enterprise_id`);

// 4) corretor das 280 propostas tem vinculo com o empreendimento novo?
out.corretor_sem_vinculo = await q(`SELECT eu.enterprise_id, COUNT(DISTINCT ar.corretor_id) corretores_sem_vinculo, COUNT(*) propostas
  FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id
  LEFT JOIN corretores_enterprises ce ON ce.enterprise_id=eu.enterprise_id AND ce.corretor_id=ar.corretor_id
  WHERE ar.id IN (?) AND ar.corretor_id IS NOT NULL AND ce.id IS NULL GROUP BY eu.enterprise_id`,[ids]);
out.cols_ce = (await q("SHOW COLUMNS FROM corretores_enterprises")).map(r=>r.Field);

// 5) assinaturas detalhe
out.assin_det = await q(`SELECT cs.id, arc.acquisition_request_id ar, cs.contract_signature_status_id st, cs.contract_type, cs.uuidDoc,
   cs.created_at, cs.updated_at, u.name cliente, eu.enterprise_id, eu.block, eu.lot,
   (SELECT COUNT(*) FROM contract_signature_signers x WHERE x.contract_signature_id=cs.id) signers
  FROM contract_signatures cs JOIN acquisition_request_contracts arc ON arc.id=cs.acquisition_request_contract_id
  JOIN acquisition_requests ar ON ar.id=arc.acquisition_request_id
  LEFT JOIN users u ON u.id=ar.client_id LEFT JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id
  WHERE arc.acquisition_request_id IN (?)`,[ids]);

// 6) unidades gemeas: created_at e ids
out.unid_datas = await q(`SELECT enterprise_id, MIN(id) min_id, MAX(id) max_id, MIN(created_at) c0, MAX(created_at) c1, MIN(updated_at) u0, MAX(updated_at) u1 FROM enterprise_unities WHERE enterprise_id IN (35,36,37) GROUP BY enterprise_id`);
// unidade do 35 sem gemea e vice-versa
out.sem_gemea = await q(`SELECT o.id, o.block, o.lot, o.enterprise_unity_type_id tipo FROM enterprise_unities o
  LEFT JOIN enterprise_unities d ON d.block=o.block AND d.lot=o.lot AND d.enterprise_id=IF(o.enterprise_unity_type_id=1,37,36)
  WHERE o.enterprise_id=35 AND d.id IS NULL`);
out.gemea_sem_origem = await q(`SELECT d.id, d.enterprise_id, d.block, d.lot FROM enterprise_unities d
  LEFT JOIN enterprise_unities o ON o.block=d.block AND o.lot=d.lot AND o.enterprise_id=35
  WHERE d.enterprise_id IN (36,37) AND o.id IS NULL`);
// duplicidade de (block,lot) dentro de 36/37
out.dup_gemeas = await q(`SELECT enterprise_id, block, lot, COUNT(*) n FROM enterprise_unities WHERE enterprise_id IN (36,37) GROUP BY 1,2,3 HAVING COUNT(*)>1`);

// 7) sale_status das unidades destino x proposta ativa
out.status_x_proposta = await q(`SELECT eu.enterprise_id, eu.sale_status_id, COUNT(*) n FROM enterprise_unities eu WHERE eu.enterprise_id IN (35,36,37) GROUP BY 1,2 ORDER BY 1,2`);
out.vendida_sem_proposta = await q(`SELECT eu.id, eu.enterprise_id, eu.block, eu.lot, eu.sale_status_id
  FROM enterprise_unities eu LEFT JOIN acquisition_requests ar ON ar.enterprise_unity_id=eu.id AND ar.open=1
  WHERE eu.enterprise_id IN (36,37) AND eu.sale_status_id<>1 AND ar.id IS NULL`);
out.proposta_ativa_unidade_disponivel = await q(`SELECT ar.id, u.name cliente, eu.enterprise_id, eu.block, eu.lot, eu.sale_status_id, ar.acquisition_request_stage_id stage
  FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id LEFT JOIN users u ON u.id=ar.client_id
  WHERE ar.id IN (?) AND ar.open=1 AND eu.sale_status_id=1`,[ids]);

fs.writeFileSync("audit-vlo-out5.json", JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1).slice(0,11000));
await c.end();
