// CRUZAMENTO read-only: quem PAGOU o PIX pelo Panteon e continua com o "Ato" de R$ 1.000 em
// aberto no C2X?
//
// Pedido do Lucas (19/08/2026): "precisamos dar baixa nos 1000 que estao vencidos para unidades
// que ja pagaram esse valor para gente". Este script NAO escreve nada: ele produz a LISTA que
// qualquer baixa teria de usar, com a evidencia de pagamento ao lado de cada linha.
//
// ⚠️ READ-ONLY nos dois bancos. ⚠️ Credenciais do .env.local, nunca impressas.
// ⚠️ Nome de cliente NAO vai para a saida: a chave e o id do C2X e a unidade.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

// 1. Do Panteon: os CADs do Vale do Ouro com PIX pago e vinculo com usuario do C2X.
const resposta = await fetch(
  `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
  { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY } },
).catch(() => null);

// A RPC pode nao existir; o caminho garantido e a API REST tabela a tabela.
const rest = async (caminho) => {
  const r = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${caminho}`, {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });
  if (!r.ok) throw new Error(`Supabase ${r.status} em ${caminho.split("?")[0]}`);
  return r.json();
};

const esteira = await rest(
  "apolo_esteira?empreendimento=eq.VALE%20DO%20OURO&pago_em=not.is.null" +
    "&select=entity_id,pago_em,pagamento_ref,etapa&limit=1000",
);
const sync = await rest("apolo_c2x_sync?c2x_user_id=not.is.null&select=entity_id,c2x_user_id&limit=5000");
const userPorEntity = new Map(sync.map((s) => [s.entity_id, Number(s.c2x_user_id)]));

const pagos = esteira
  .map((e) => ({ ...e, c2xUserId: userPorEntity.get(e.entity_id) ?? null }))
  .filter((e) => e.c2xUserId !== null);

console.log("### PANTEON");
console.log("  CADs do Vale do Ouro com PIX pago : " + esteira.length);
console.log("  desses, com vinculo no C2X        : " + pagos.length);
console.log("  sem vinculo (nao da para casar)   : " + (esteira.length - pagos.length));

// 2. Do C2X: o Ato de R$ 1.000 de cada um desses clientes.
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

const ids = [...new Set(pagos.map((p) => p.c2xUserId))];
const [linhas] = await c.query(
  `select p.id payment_id, ar.client_id, e.code emp, concat(e.code, u.block, u.lot) unidade,
          u.id unit_id, e.id enterprise_id,
          date_format(p.due_date, '%Y-%m-%d') vence,
          date_format(p.payment_date, '%Y-%m-%d') pago_em_c2x,
          ps.name situacao, p.initial_value valor
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where e.code in ('VOC','VOL','VLO','VOR') and p.initial_value = 1000
      and pt.name like '%to%' and ar.client_id in (?)`,
  [ids],
);
await c.end();

const porCliente = new Map();
for (const l of linhas) {
  const lista = porCliente.get(Number(l.client_id)) ?? [];
  lista.push(l);
  porCliente.set(Number(l.client_id), lista);
}

const emAberto = [];
const jaBaixado = [];
const semAto = [];
for (const p of pagos) {
  const doCliente = porCliente.get(p.c2xUserId) ?? [];
  if (doCliente.length === 0) { semAto.push(p); continue; }
  for (const l of doCliente) {
    (l.pago_em_c2x ? jaBaixado : emAberto).push({ ...l, pagoNoPanteon: p.pago_em?.slice(0, 10), ref: p.pagamento_ref });
  }
}

console.log("\n### CRUZAMENTO (PIX pago no Panteon x Ato no C2X)");
console.log("  ja baixado no C2X (nada a fazer)  : " + jaBaixado.length);
console.log("  EM ABERTO no C2X (candidatos)     : " + emAberto.length);
console.log("  pagou mas nao tem Ato no C2X      : " + semAto.length);

console.log("\n### OS CANDIDATOS A BAIXA");
for (const l of emAberto) {
  console.log("  " + String(l.unidade).padEnd(10) + " · payment_id " + String(l.payment_id).padEnd(8) +
    " · unit " + String(l.unit_id).padEnd(6) + " · emp " + String(l.enterprise_id).padEnd(3) +
    " · vence " + l.vence + " · " + String(l.situacao ?? "-").padEnd(12) +
    " · PIX pago em " + l.pagoNoPanteon + " · ref " + l.ref);
}

// ── A LISTA QUE O SCRIPT DE BAIXA CONSOME ───────────────────────────────────
//
// ⚠️ SÓ AS CONFERIDAS: 1 PIX de R$ 1.000 para 1 unidade. Onde o mesmo PIX aparece em mais de uma
// unidade (cliente com vários lotes), NADA entra aqui — a pré-venda foi cobrada por PESSOA e o
// Ato é por UNIDADE, então quem decide em qual lote lançar é o dono, não o script.
const porRef = new Map();
for (const l of emAberto) {
  const lista = porRef.get(l.ref) ?? [];
  lista.push(l);
  porRef.set(l.ref, lista);
}
const conferidas = [...porRef.values()].filter((itens) => itens.length === 1).flat();
const arquivo = path.resolve(process.cwd(), "scripts/apolo/baixa-ato-1000-conferidas.json");
fs.writeFileSync(
  arquivo,
  JSON.stringify(
    conferidas.map((l) => ({
      dataDoPix: l.pagoNoPanteon,
      empresaId: Number(l.enterprise_id),
      paymentId: Number(l.payment_id),
      refAsaas: l.ref,
      unidade: l.unidade,
      unitId: Number(l.unit_id),
    })),
    null,
    2,
  ),
);
console.log("");
console.log("### LISTA PARA A BAIXA: " + conferidas.length + " unidades");
console.log("    " + arquivo);
