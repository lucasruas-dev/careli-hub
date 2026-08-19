// RECONCILIACAO read-only: onde foi parar CADA UM dos 108 CADs com PIX pago?
//
// Pergunta do Lucas (19/08/2026): "e o resto das pendencias, nao estao entre os 108?".
// A conta tem que fechar: 108 = baixados agora + ja baixados antes + PIX compartilhado +
// sem Ato no C2X + nao encontrados. E, do outro lado, dizer quais das parcelas ainda vencidas
// pertencem a alguem que pagou PIX.
//
// ⚠️ READ-ONLY nos dois bancos. ⚠️ Credenciais do .env.local, nunca impressas.
// ⚠️ CPF e nome NAO vao para a saida.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const rest = async (caminho) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${caminho}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
};

const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");

const esteira = await rest(
  "apolo_esteira?empreendimento=eq.VALE%20DO%20OURO&pago_em=not.is.null" +
    "&select=entity_id,pago_em,pagamento_ref&limit=1000",
);

const entidades = [];
for (let inicio = 0; ; inicio += 1000) {
  const pagina = await rest(
    `apolo_entities?select=id,document_masked&order=id&offset=${inicio}&limit=1000`,
  );
  entidades.push(...pagina);
  if (pagina.length < 1000) break;
}
const cpfPorEntity = new Map(entidades.map((e) => [e.id, soDigitos(e.document_masked)]));

const cads = esteira.map((e) => ({
  cpf: cpfPorEntity.get(e.entity_id) ?? "",
  entityId: e.entity_id,
  pagoEm: e.pago_em?.slice(0, 10),
  ref: e.pagamento_ref,
}));

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const cpfs = cads.map((c2) => c2.cpf).filter((v) => v.length === 11);

// A pessoa existe no C2X?
const [usuarios] = await c.query(
  `select id, replace(replace(replace(cpf,'.',''),'-',''),' ','') cpf
     from users
    where replace(replace(replace(cpf,'.',''),'-',''),' ','') in (?)`,
  [cpfs],
);
const cpfsNoC2x = new Set(usuarios.map((u) => u.cpf));

// O Ato de R$ 1.000 dela no Vale do Ouro.
const [atos] = await c.query(
  `select replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') cpf,
          p.id payment_id, concat(e.code, u.block, u.lot) unidade,
          date_format(p.payment_date,'%Y-%m-%d') pago_em, ps.name situacao
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join users usr on usr.id = ar.client_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where e.code in ('VOC','VOL','VLO','VOR') and pt.name like '%to%' and p.initial_value = 1000
      and replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') in (?)`,
  [cpfs],
);
const atosPorCpf = new Map();
for (const a of atos) {
  const lista = atosPorCpf.get(a.cpf) ?? [];
  lista.push(a);
  atosPorCpf.set(a.cpf, lista);
}

// Quais refs de PIX cobrem mais de uma unidade AINDA em aberto.
const abertosPorRef = new Map();
for (const cad of cads) {
  for (const a of atosPorCpf.get(cad.cpf) ?? []) {
    if (a.pago_em) continue;
    const lista = abertosPorRef.get(cad.ref) ?? [];
    lista.push(a);
    abertosPorRef.set(cad.ref, lista);
  }
}

const balde = { compartilhado: [], nenhumAto: [], quitado: [], semCpf: [], semPessoa: [] };
for (const cad of cads) {
  if (cad.cpf.length !== 11) { balde.semCpf.push(cad); continue; }
  if (!cpfsNoC2x.has(cad.cpf)) { balde.semPessoa.push(cad); continue; }
  const lista = atosPorCpf.get(cad.cpf) ?? [];
  if (lista.length === 0) { balde.nenhumAto.push(cad); continue; }
  const abertos = (abertosPorRef.get(cad.ref) ?? []).length;
  if (abertos > 1) { balde.compartilhado.push(cad); continue; }
  balde.quitado.push(cad);
}

console.log("# OS 108 CADs COM PIX PAGO — ONDE CADA UM ESTA");
console.log("");
console.log("  Ato JA QUITADO no C2X ..............: " + balde.quitado.length);
console.log("  PIX dividido entre lotes (pendente) : " + balde.compartilhado.length +
  "  -> " + [...new Set(balde.compartilhado.map((c2) => c2.ref))].length + " PIX");
console.log("  pessoa existe, mas SEM Ato de 1.000 : " + balde.nenhumAto.length);
console.log("  pessoa NAO encontrada no C2X .......: " + balde.semPessoa.length);
console.log("  CAD sem CPF utilizavel .............: " + balde.semCpf.length);
console.log("  ----------------------------------------------");
console.log("  soma ...............................: " +
  (balde.quitado.length + balde.compartilhado.length + balde.nenhumAto.length +
   balde.semPessoa.length + balde.semCpf.length) + " de " + cads.length);

// E o outro lado: das parcelas AINDA vencidas, quantas sao de gente que pagou PIX?
const [vencidos] = await c.query(
  `select concat(e.code, u.block, u.lot) unidade, p.id,
          replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') cpf
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join users usr on usr.id = ar.client_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
    where e.code in ('VOC','VOL','VLO','VOR') and pt.name like '%to%'
      and p.initial_value = 1000 and p.payment_date is null and p.due_date < curdate()
    order by concat(e.code, u.block, u.lot)`,
);
const cpfsPagantes = new Set(cads.map((c2) => c2.cpf).filter(Boolean));
const vencComPix = vencidos.filter((v) => cpfsPagantes.has(v.cpf));
const vencSemPix = vencidos.filter((v) => !cpfsPagantes.has(v.cpf));

console.log("");
console.log("# AS " + vencidos.length + " PARCELAS AINDA VENCIDAS");
console.log("  de quem ESTA nos 108 (PIX pago) ....: " + vencComPix.length);
console.log("  de quem NAO esta nos 108 ...........: " + vencSemPix.length);
console.log("");
console.log("  as que sao de quem pagou PIX:");
for (const v of vencComPix) console.log("    " + v.unidade + " (pay " + v.id + ")");


// ── OS QUE PAGARAM E NAO TEM "ATO" DE R$ 1.000 ──────────────────────────────
// Pagaram a pre-venda: o dinheiro entrou. Se nao ha Ato de R$ 1.000 no C2X, ou a venda ainda nao
// foi montada, ou a parcela de entrada tem outro valor/tipo. Sem olhar, ninguem sabe se falta
// lancamento ou se o dinheiro esta em outro lugar.
const cpfsSemAto = balde.nenhumAto.map((c2) => c2.cpf);
if (cpfsSemAto.length > 0) {
  const [oQueTem] = await c.query(
    `select replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') cpf,
            e.code emp, concat(e.code, u.block, u.lot) unidade,
            st.name estagio,
            (select count(*) from payments p2 where p2.acquisition_request_id = ar.id) parcelas,
            (select min(p3.initial_value) from payments p3
               join parcel_types pt3 on pt3.id = p3.parcel_type_id
              where p3.acquisition_request_id = ar.id and pt3.name like '%to%') valor_do_ato
       from acquisition_requests ar
       join users usr on usr.id = ar.client_id
       join enterprise_unities u on u.id = ar.enterprise_unity_id
       join enterprises e on e.id = u.enterprise_id
       left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
      where replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') in (?)`,
    [cpfsSemAto],
  );
  const porCpf2 = new Map();
  for (const l of oQueTem) {
    const lista = porCpf2.get(l.cpf) ?? [];
    lista.push(l);
    porCpf2.set(l.cpf, lista);
  }
  console.log("");
  console.log("# OS " + cpfsSemAto.length + " QUE PAGARAM E NAO TEM ATO DE R$ 1.000");
  let semProposta = 0;
  for (const cpf of cpfsSemAto) {
    const linhas2 = porCpf2.get(cpf) ?? [];
    if (linhas2.length === 0) { semProposta += 1; continue; }
    for (const l of linhas2) {
      console.log("  " + String(l.unidade).padEnd(10) + " · " + String(l.estagio ?? "-").padEnd(22) +
        " · " + l.parcelas + " parcelas · Ato de R$ " +
        (l.valor_do_ato === null ? "NENHUM" : Number(l.valor_do_ato).toLocaleString("pt-BR")));
    }
  }
  console.log("  sem NENHUMA proposta no Vale do Ouro: " + semProposta);
}

await c.end();
