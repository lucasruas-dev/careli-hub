import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id); const bkById = new Map(bk.map(b=>[b.id,b]));
const res = {};
const [x] = await c.query("SELECT c.id, c.acquisition_request_id, c.created_at, c.updated_at, c.acquisition_request_contract_status_id st, ar.client_id, u.name cliente, eu.enterprise_id, eu.block, eu.lot FROM acquisition_request_contracts c JOIN acquisition_requests ar ON ar.id=c.acquisition_request_id JOIN users u ON u.id=ar.client_id JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id WHERE c.id IN (2767,2772,2773,2826,2827)");
res.contratosSuspeitos = x.map(r=>({contrato:r.id, ar:r.acquisition_request_id, cliente:r.cliente, lote:"Q"+r.block+" L"+r.lot, ent:r.enterprise_id, criado:r.created_at, atualizado:r.updated_at, status:r.st}));
// existe algum contrato do Vale que cita GABRIEL FLORES PARREIRAS?
const [g] = await c.query("SELECT id, acquisition_request_id FROM acquisition_request_contracts WHERE acquisition_request_id IN ("+ids.join(",")+") AND (complete_text LIKE '%GABRIEL FLORES%' OR complete_text LIKE '%10842%')");
res.contratosQueCitamGabriel = g;
// usuarios incorporadores criados pela migracao
const [inc] = await c.query("SELECT id,name,email,cnpj,profile_id,created_at,updated_at,who_registered_id FROM users WHERE id IN (4199,4734,4735)");
res.incorporadores = inc;
// descricao das parcelas cita quadra/lote?
const [pay] = await c.query("SELECT id, acquisition_request_id, description, reference_date, due_date, initial_value FROM payments WHERE acquisition_request_id IN ("+ids.join(",")+") LIMIT 12");
res.amostraParcelas = pay;
// parcelas com descricao contendo LOTE/QUADRA
const [payL] = await c.query("SELECT COUNT(*) n FROM payments WHERE acquisition_request_id IN ("+ids.join(",")+") AND (description LIKE '%LOTE%' OR description LIKE '%QUADRA%' OR description LIKE '%Q0%')");
res.parcelasComLoteNaDescricao = payL[0].n;
// escrow/split das parcelas (conta de recebimento)
const [sd] = await c.query("SELECT COUNT(*) total, SUM(CASE WHEN split_data IS NULL THEN 0 ELSE 1 END) comSplit, SUM(CASE WHEN escrow_id IS NULL THEN 0 ELSE 1 END) comEscrow FROM payments WHERE acquisition_request_id IN ("+ids.join(",")+")");
res.parcelasSplit = sd[0];
await c.end();
fs.writeFileSync("audit-vlo-res9.json", JSON.stringify(res,null,1));
console.log(JSON.stringify(res,null,1).slice(0,7000));
