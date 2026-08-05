import fs from "node:fs"; import path from "node:path"; import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(fs.readFileSync("apps/hub/.env.local","utf8").split("\n").filter(l=>l.includes("=")&&!l.trim().startsWith("#")).map(l=>{const i=l.indexOf("=");return[l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^["']|["']$/g,"")]}));
const c = await mysql.createConnection({host:env.GUARDIAN_DB_HOST,user:env.GUARDIAN_DB_USER,password:env.GUARDIAN_DB_PASSWORD,database:env.GUARDIAN_DB_NAME,port:+(env.GUARDIAN_DB_PORT||3306),dateStrings:true,connectTimeout:20000});
const bk = JSON.parse(fs.readFileSync("C:/Users/lucas/Desktop/BACKUP_PROPOSTAS_VLO_1785763642150.json","utf8"));
const ids = bk.map(b=>b.id);
const res = {};
// contrato 2767 - secao do comprador
const [ct] = await c.query("SELECT complete_text FROM acquisition_request_contracts WHERE id=2767");
const t = String(ct[0].complete_text||"").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ");
const i = t.toUpperCase().indexOf("COMPRADOR");
res.contrato2767_comprador = t.slice(i, i+700);
// quantos contratos das 280 estao com o comprador em placeholder
const contratos = JSON.parse(fs.readFileSync("audit-vlo-contratos-raw.json","utf8"));
let placeholder=0; const semNome=[];
for(const x of contratos){ const up=x.txt.toUpperCase(); const j=up.indexOf("COMPRADOR"); const trecho=up.slice(j,j+260);
  if(trecho.includes("[●]")||trecho.includes("[?]")) placeholder++; }
res.contratosComCompradorPlaceholder = placeholder;
// config dos empreendimentos
const [ecols] = await c.query("SHOW COLUMNS FROM enterprises");
const campos = ecols.map(r=>r.Field).filter(f=>/plan|draft|asaas|manager|captivator|incorporador|coordenador|split|account|name|code|city/i.test(f));
const [ents] = await c.query("SELECT id, "+campos.join(", ")+" FROM enterprises WHERE id IN (35,36,37)");
res.configEmpreendimentos = ents;
// planos comerciais por empreendimento
const [plans] = await c.query("SELECT enterprise_id, COUNT(*) n FROM commercial_plans WHERE enterprise_id IN (35,36,37) GROUP BY 1");
res.planosPorEmpreendimento = plans;
const [planoDas280] = await c.query("SELECT cp.id, cp.name, cp.enterprise_id, cp.acquisition_request_id, COUNT(ar.id) usos FROM commercial_plans cp JOIN acquisition_requests ar ON ar.commercial_plan_id=cp.id WHERE ar.id IN ("+ids.join(",")+") GROUP BY cp.id, cp.name, cp.enterprise_id, cp.acquisition_request_id");
res.planosUsadosPelas280 = planoDas280;
// draft_contracts por empreendimento
const [dcs] = await c.query("SELECT id, name, enterprise_id, enterprise_unity_type_id FROM draft_contracts WHERE enterprise_id IN (35,36,37)");
res.modelosContratoPorEmpreendimento = dcs;
// splits
const [sp] = await c.query("SELECT * FROM split_enterprises WHERE enterprise_id IN (35,36,37)");
res.splits = sp;
// pagamentos: colunas e vinculo com conta
const [pcols] = await c.query("SHOW COLUMNS FROM payments");
res.paymentsCols = pcols.map(r=>r.Field).filter(f=>/asaas|account|wallet|enterprise|escrow|split/i.test(f));
const [pay] = await c.query("SELECT id, acquisition_request_id, payment_status_id, initial_value, due_date, payment_asaas_url IS NOT NULL tem_asaas FROM payments WHERE acquisition_request_id IN ("+ids.join(",")+")");
res.parcelas = {total: pay.length, comBoletoAsaas: pay.filter(p=>p.tem_asaas).length, liquidadas: pay.filter(p=>p.payment_status_id===5).length};
// imobiliarias vinculadas aos empreendimentos
const [ei] = await c.query("SELECT enterprise_id, COUNT(*) n FROM enterprises_imobiliarias WHERE enterprise_id IN (35,36,37) GROUP BY 1");
res.imobiliariasPorEmpreendimento = ei;
const [ce] = await c.query("SELECT enterprise_id, COUNT(*) n FROM corretores_enterprises WHERE enterprise_id IN (35,36,37) GROUP BY 1");
res.corretoresPorEmpreendimento = ce;
await c.end();
fs.writeFileSync("audit-vlo-res7.json", JSON.stringify(res,null,1));
console.log(JSON.stringify(res,null,1).slice(0,10000));
