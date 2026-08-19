// Gera o JSON NOMINAL do relatorio da baixa do Ato de R$ 1.000 no Vale do Ouro.
//
// Pedido do Lucas (19/08/2026): "faz completo, html, trazendo os nomes, cpf e as unidades dos
// clientes que estao pendentes, os que deram baixa".
//
// ⚠️ READ-ONLY nos dois bancos. ⚠️ Credenciais do .env.local, nunca impressas.
// ⚠️ A SAIDA TEM DADO PESSOAL (nome + CPF) e vai para arquivo local, nunca para o console.
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
const cpfBonito = (v) => {
  const d = soDigitos(v);
  return d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : (v ?? "—");
};
const dataBR = (iso) => (iso ? iso.split("-").reverse().join("/") : null);

// ── PANTEON: quem pagou PIX ─────────────────────────────────────────────────
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
const pixPorCpf = new Map();
for (const e of esteira) {
  const cpf = cpfPorEntity.get(e.entity_id);
  if (cpf) pixPorCpf.set(cpf, { pagoEm: e.pago_em?.slice(0, 10), ref: e.pagamento_ref });
}

// ── C2X ─────────────────────────────────────────────────────────────────────
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// Todas as parcelas de Ato de R$ 1.000 do Vale do Ouro, com o dono.
const [parcelas] = await c.query(
  `select p.id payment_id, usr.name cliente,
          replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') cpf,
          concat(e.code, u.block, u.lot) unidade, e.code emp,
          ps.name situacao,
          date_format(p.payment_date,'%Y-%m-%d') pago_em,
          date_format(p.due_date,'%Y-%m-%d') vence,
          p.paid_value, p.initial_value
     from payments p
     join acquisition_requests ar on ar.id = p.acquisition_request_id
     join users usr on usr.id = ar.client_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join parcel_types pt on pt.id = p.parcel_type_id
     left join payment_statuses ps on ps.id = p.payment_status_id
    where e.code in ('VOC','VOL','VLO','VOR') and pt.name like '%to%' and p.initial_value = 1000
    order by usr.name`,
);

const baixadas = new Set(
  [
    ...JSON.parse(fs.readFileSync("scripts/apolo/baixa-ato-1000-conferidas.json", "utf8")),
    ...JSON.parse(fs.readFileSync("scripts/apolo/baixa-rodada2-conferidas.json", "utf8")),
  ].map((b) => b.paymentId),
);

// 1. AS QUE FORAM BAIXADAS NESTA OPERACAO.
const feitas = parcelas
  .filter((p) => baixadas.has(Number(p.payment_id)))
  .map((p) => ({
    cliente: p.cliente,
    cpf: cpfBonito(p.cpf),
    pagoEm: dataBR(p.pago_em),
    paymentId: Number(p.payment_id),
    unidade: p.unidade,
  }));

// 2. AS QUE SEGUEM VENCIDAS, separadas por causa.
const vencidas = parcelas.filter((p) => !p.pago_em && p.vence < "2026-08-19");

// Quais refs de PIX cobrem mais de uma unidade ainda em aberto = o grupo "vários lotes".
const abertasPorRef = new Map();
for (const v of vencidas) {
  const pix = pixPorCpf.get(v.cpf);
  if (!pix) continue;
  const lista = abertasPorRef.get(pix.ref) ?? [];
  lista.push(v);
  abertasPorRef.set(pix.ref, lista);
}
const refsCompartilhadas = new Set(
  [...abertasPorRef.entries()].filter(([, l]) => l.length > 1).map(([ref]) => ref),
);

const variosLotes = [];
const semRegistro = [];
for (const v of vencidas) {
  const pix = pixPorCpf.get(v.cpf);
  const linha = {
    cliente: v.cliente,
    cpf: cpfBonito(v.cpf),
    paymentId: Number(v.payment_id),
    pixEm: pix ? dataBR(pix.pagoEm) : null,
    unidade: v.unidade,
    vence: dataBR(v.vence),
  };
  if (pix && refsCompartilhadas.has(pix.ref)) variosLotes.push({ ...linha, ref: pix.ref });
  else semRegistro.push(linha);
}

// 3. QUEM PAGOU E NAO TEM PARCELA (venda cancelada ou sem proposta).
const cpfsComParcela = new Set(parcelas.map((p) => p.cpf));
const semParcela = [...pixPorCpf.keys()].filter((cpf) => !cpfsComParcela.has(cpf));
const [ondeEstao] = await c.query(
  `select usr.name cliente, replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') cpf,
          concat(e.code, u.block, u.lot) unidade, st.name estagio
     from acquisition_requests ar
     join users usr on usr.id = ar.client_id
     join enterprise_unities u on u.id = ar.enterprise_unity_id
     join enterprises e on e.id = u.enterprise_id
     left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
    where e.code in ('VOC','VOL','VLO','VOR')
      and replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') in (?)`,
  [semParcela.length ? semParcela : ["-"]],
);
const [nomes] = await c.query(
  `select usr.name cliente, replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') cpf
     from users usr
    where replace(replace(replace(usr.cpf,'.',''),'-',''),' ','') in (?)`,
  [semParcela.length ? semParcela : ["-"]],
);
const nomePorCpf = new Map(nomes.map((n) => [n.cpf, n.cliente]));
const propostaPorCpf = new Map();
for (const o of ondeEstao) {
  const lista = propostaPorCpf.get(o.cpf) ?? [];
  lista.push(o);
  propostaPorCpf.set(o.cpf, lista);
}

const devolucao = semParcela.map((cpf) => {
  const props = propostaPorCpf.get(cpf) ?? [];
  const pix = pixPorCpf.get(cpf);
  return {
    cliente: nomePorCpf.get(cpf) ?? "(não encontrado no C2X)",
    cpf: cpfBonito(cpf),
    estagio: props[0]?.estagio ?? "Sem proposta no Vale do Ouro",
    pixEm: dataBR(pix?.pagoEm),
    unidade: props.map((p) => p.unidade).join(" · ") || "—",
  };
});

await c.end();

const ordenar = (a, b) => String(a.cliente).localeCompare(String(b.cliente), "pt-BR");
const saida = {
  devolucao: devolucao.sort(ordenar),
  feitas: feitas.sort(ordenar),
  geradoEm: "19/08/2026",
  semRegistro: semRegistro.sort(ordenar),
  variosLotes: variosLotes.sort(ordenar),
};

fs.writeFileSync(
  path.resolve(process.cwd(), "scripts/apolo/dados-nominais.json"),
  JSON.stringify(saida, null, 2),
);

// ⚠️ Só CONTAGENS no console: nome e CPF ficam no arquivo.
console.log("baixadas ......: " + saida.feitas.length);
console.log("varios lotes ..: " + saida.variosLotes.length);
console.log("sem registro ..: " + saida.semRegistro.length);
console.log("devolucao .....: " + saida.devolucao.length);
