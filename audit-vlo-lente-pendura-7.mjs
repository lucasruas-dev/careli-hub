import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const q = async (s,p)=>{const [r]=await c.query(s,p);return r;};
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const out = {};
const o3 = JSON.parse(fs.readFileSync("audit-vlo-out3.json","utf8"));

// lote isolado: divergencia?
out.lote_divergente = o3.contratos_texto.filter(r=>!r.l_txt.includes(r.l_unid)).map(r=>({ar:r.ar,cliente:r.cliente,l_unid:r.l_unid,l_txt:r.l_txt}));
out.lote_ok = o3.contratos_texto.filter(r=>r.l_txt.includes(r.l_unid)).length;
out.mat_ok = o3.contratos_texto.filter(r=>r.mat_txt.includes(r.mat_unid)).length;
out.quadra_ok = o3.contratos_texto.filter(r=>r.q_txt.includes(r.q_unid)).length;
out.quadra_vazia = o3.contratos_texto.filter(r=>r.q_txt.length===0).length;
// lote do backup x lote do texto (o texto foi gerado ANTES da migracao)
out.lote_txt_vs_backup = o3.contratos_texto.filter(r=>!r.l_txt.includes(r.l_bk)).length;

// exemplo literal do placeholder
const ex = await q(`SELECT id, acquisition_request_id ar, SUBSTRING(complete_text, GREATEST(LOCATE('[●]', complete_text)-260,1), 420) trecho,
   (CHAR_LENGTH(complete_text)-CHAR_LENGTH(REPLACE(complete_text,'[●]','')))/3 ocorrencias
  FROM acquisition_request_contracts WHERE acquisition_request_id IN (?) AND complete_text LIKE '%[●]%' LIMIT 3`,[ids]);
out.exemplo_placeholder = ex.map(r=>({...r, trecho: r.trecho.replace(/<[^>]*>/g," ").replace(/\s+/g," ")}));
out.placeholder_ocorrencias = await q(`SELECT (CHAR_LENGTH(complete_text)-CHAR_LENGTH(REPLACE(complete_text,'[●]','')))/3 oc, COUNT(*) n
  FROM acquisition_request_contracts WHERE acquisition_request_id IN (?) GROUP BY 1 ORDER BY 1`,[ids]);

// assinatura com signers (AR 4538)
out.cs_status = await q("SELECT * FROM contract_signature_statuses");
out.signers_4538 = await q(`SELECT css.id, css.user_name, css.user_document, css.email, css.signed, css.date_signed, css.contract_signature_type_id
  FROM contract_signature_signers css WHERE css.contract_signature_id=3329`);
out.algum_assinado = (await q(`SELECT COUNT(*) n FROM contract_signature_signers css JOIN contract_signatures cs ON cs.id=css.contract_signature_id
  JOIN acquisition_request_contracts arc ON arc.id=cs.acquisition_request_contract_id
  WHERE arc.acquisition_request_id IN (?) AND css.signed=1`,[ids]))[0].n;
// contratos com signature_date preenchida (assinado)
out.contratos_assinados = await q(`SELECT id, acquisition_request_id ar, signature_date FROM acquisition_request_contracts
  WHERE acquisition_request_id IN (?) AND signature_date IS NOT NULL`,[ids]);

// coerencia: proposta em VOC(37) deve ter unidade tipo 1; VOL(36) tipo 2 (conferencia final direta no banco)
out.tipo_x_empresa = await q(`SELECT eu.enterprise_id, eu.enterprise_unity_type_id tipo, COUNT(*) n
  FROM acquisition_requests ar JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE ar.id IN (?) GROUP BY 1,2`,[ids]);
// conferencia final: proposta -> unidade destino tem MESMA matricula da unidade original do backup
const pares = bk.map(b=>[b.id,b.enterprise_unity_id]);
out.matricula_batendo = (await q(`SELECT SUM(o.registration=d.registration) ok, SUM(o.registration<>d.registration OR o.registration IS NULL OR d.registration IS NULL) nok, COUNT(*) total
  FROM acquisition_requests ar JOIN enterprise_unities d ON d.id=ar.enterprise_unity_id
  JOIN enterprise_unities o ON o.id=(SELECT eu2.id FROM enterprise_unities eu2 WHERE eu2.enterprise_id=35 AND eu2.block=d.block AND eu2.lot=d.lot)
  WHERE ar.id IN (?)`,[ids]))[0];
// preco/area destino x origem por matricula
out.divergencia_valor = await q(`SELECT ar.id, u.name cliente, d.enterprise_id, d.block, d.lot, o.price p35, d.price pdest, o.area a35, d.area adest
  FROM acquisition_requests ar JOIN enterprise_unities d ON d.id=ar.enterprise_unity_id
  JOIN enterprise_unities o ON o.enterprise_id=35 AND o.block=d.block AND o.lot=d.lot LEFT JOIN users u ON u.id=ar.client_id
  WHERE ar.id IN (?) AND (o.price<>d.price OR o.area<>d.area OR o.registration<>d.registration)`,[ids]);

fs.writeFileSync("audit-vlo-out7.json", JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1).slice(0,9000));
await c.end();
