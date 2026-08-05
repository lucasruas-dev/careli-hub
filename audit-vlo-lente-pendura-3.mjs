import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const q = async (s,p)=>{const [r]=await c.query(s,p);return r;};
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const out = {};

// enterprises: colunas de modelo de contrato / asaas
out.cols_ent = (await q("SHOW COLUMNS FROM enterprises")).map(r=>r.Field);
out.ent = await q("SELECT * FROM enterprises WHERE id IN (35,36,37)");
out.drafts = await q("SELECT id, enterprise_id, name, created_at FROM draft_contracts WHERE enterprise_id IN (35,36,37)");
out.cols_dc = (await q("SHOW COLUMNS FROM draft_contracts")).map(r=>r.Field);

// propostas por stage x tem contrato
out.stage_x_contrato = await q(`SELECT ar.acquisition_request_stage_id stage, COUNT(*) props, SUM(arc.id IS NOT NULL) com_contrato
 FROM acquisition_requests ar LEFT JOIN (SELECT acquisition_request_id, MIN(id) id FROM acquisition_request_contracts GROUP BY acquisition_request_id) arc ON arc.acquisition_request_id=ar.id
 WHERE ar.id IN (?) GROUP BY ar.acquisition_request_stage_id ORDER BY 1`,[ids]);

// contratos + unidade atual da proposta
const arc = await q(`SELECT arc.id, arc.acquisition_request_id ar_id, arc.acquisition_request_contract_status_id st, arc.draft_contract_id,
  arc.signature_date, arc.created_at, arc.updated_at, CHAR_LENGTH(arc.complete_text) tam, arc.complete_text,
  ar.code, ar.acquisition_request_stage_id stage, ar.enterprise_unity_id,
  eu.enterprise_id, eu.block, eu.lot, eu.registration, eu.area, eu.price, u.name cliente
 FROM acquisition_request_contracts arc
 JOIN acquisition_requests ar ON ar.id=arc.acquisition_request_id
 LEFT JOIN enterprise_unities eu ON eu.id=ar.enterprise_unity_id
 LEFT JOIN users u ON u.id=ar.client_id
 WHERE arc.acquisition_request_id IN (?)`,[ids]);
out.n_contratos = arc.length;
const bkById = new Map(bk.map(b=>[b.id,b]));
const strip = s => (s||"").replace(/<[^>]*>/g," ").replace(/&nbsp;/g," ").replace(/&[a-z]+;/g," ").replace(/\s+/g," ");
const numOnly = v => String(v??"").replace(/\D/g,"").replace(/^0+/,"")||"0";
out.contratos_texto = [];
out.draft_ids = {};
for (const r of arc) {
  const t = strip(r.complete_text);
  out.draft_ids[r.draft_contract_id] = (out.draft_ids[r.draft_contract_id]||0)+1;
  const mQ = [...t.matchAll(/quadra[:\s\-nºo\.]*([0-9]{1,3})/gi)].map(m=>numOnly(m[1]));
  const mL = [...t.matchAll(/lote[:\s\-nºo\.]*([0-9]{1,3})/gi)].map(m=>numOnly(m[1]));
  const mMat = [...t.matchAll(/matr[ií]cula[^0-9]{0,20}([0-9\.]{3,15})/gi)].map(m=>numOnly(m[1]));
  const b = bkById.get(r.ar_id);
  out.contratos_texto.push({
    id:r.id, ar:r.ar_id, code:r.code, cliente:r.cliente, stage:r.stage, st:r.st, draft:r.draft_contract_id,
    emp:r.enterprise_id, q_unid:numOnly(r.block), l_unid:numOnly(r.lot), mat_unid:numOnly(r.registration),
    q_txt:[...new Set(mQ)], l_txt:[...new Set(mL)], mat_txt:[...new Set(mMat)], tam:r.tam,
    menciona_vale: /vale\s+do\s+ouro/i.test(t),
    menciona_vlo: /\bVLO\b/i.test(t), menciona_voc: /\bVOC\b/.test(t), menciona_vol: /\bVOL\b/.test(t),
    q_bk: numOnly(b?.block), l_bk: numOnly(b?.lot),
    updated: r.updated_at, created: r.created_at
  });
}
// amostra de texto de 1 contrato (trecho de qualificacao do imovel + vendedor)
const amostra = arc.find(r=>r.tam>1000);
if (amostra) {
  const t = strip(amostra.complete_text);
  out.amostra = { ar: amostra.ar_id, cliente: amostra.cliente, emp: amostra.enterprise_id, q: amostra.block, l: amostra.lot,
    inicio: t.slice(0,1800), trecho_lote: (t.match(/.{0,400}quadra.{0,400}/i)||[""])[0] };
}
fs.writeFileSync("audit-vlo-out3.json", JSON.stringify(out,null,1));
console.log("contratos:", out.n_contratos, "drafts usados:", JSON.stringify(out.draft_ids));
console.log(JSON.stringify({ent:out.ent.map(e=>Object.fromEntries(Object.entries(e).filter(([k,v])=>/id$|name|code|plan|draft|asaas/i.test(k)))), drafts:out.drafts, stage_x_contrato:out.stage_x_contrato},null,1));
await c.end();
