// AUDITORIA (leitura apenas): duplicados e anomalias estruturais no C2X pos-lancamento Vale do Ouro.
// Universo: users ligados a entidades do Apolo sincronizadas (metadata.c2xSynced=true) ou criadas 01-02/08
//           + qualquer user criado no C2X em 01-02/08.
// Saida: JSON em stdout com as secoes a..f.
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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const digitos = (v) => String(v ?? "").replace(/\D/g, "");

const lerTudo = async (tabela, query) => {
  const out = [];
  for (let offset = 0; ; offset += 1000) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/${tabela}?${query}&limit=1000&offset=${offset}`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } },
    );
    if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
    const page = await resp.json();
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
};

// ---------- 1. Apolo: entidades do universo ----------
const entidades = await lerTudo(
  "apolo_entities",
  "select=id,display_name,document_masked,entity_kind,metadata,created_at&or=(metadata->>c2xSynced.eq.true,created_at.gte.2026-08-01)",
);
const docsApolo = new Set();
const c2xIdsApolo = new Set();
for (const e of entidades) {
  const d = digitos(e.document_masked);
  if (d.length === 11 || d.length === 14) docsApolo.add(d);
  const cid = e.metadata?.c2xUserId;
  if (cid) c2xIdsApolo.add(Number(cid));
}

// ---------- 2. C2X: users completos ----------
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [users] = await c.query(
  `SELECT id, name, cpf, cnpj, email, person_type_id, profile_id, vinculed_by_id,
          who_registered_id, imobiliaria_id, user_status_id, created_at
     FROM users`,
);
const porId = new Map(users.map((u) => [u.id, u]));
const nomeDe = (id) => (id && porId.get(id) ? porId.get(id).name : null);

const inicio0108 = new Date("2026-08-01T00:00:00-03:00").getTime();
const fim0208 = new Date("2026-08-03T00:00:00-03:00").getTime();
const criadoNaJanela = (u) => {
  const t = new Date(u.created_at).getTime();
  return t >= inicio0108 && t < fim0208;
};

const universo = new Set();
for (const u of users) {
  const doc = digitos(u.cpf) || digitos(u.cnpj);
  if (c2xIdsApolo.has(u.id) || (doc && docsApolo.has(doc)) || criadoNaJanela(u)) universo.add(u.id);
}

const resumo = {
  apolo_entidades_universo: entidades.length,
  c2x_users_total: users.length,
  c2x_users_universo: universo.size,
  c2x_users_criados_01_02_08: users.filter(criadoNaJanela).length,
};

// ---------- (a) mesmo CPF/CNPJ em mais de um user ----------
const porDoc = new Map();
for (const u of users) {
  for (const doc of [digitos(u.cpf), digitos(u.cnpj)]) {
    if (doc.length !== 11 && doc.length !== 14) continue;
    if (!porDoc.has(doc)) porDoc.set(doc, []);
    porDoc.get(doc).push(u);
  }
}
const dupDoc = [];
for (const [doc, lista] of porDoc) {
  const idsUnicos = [...new Set(lista.map((u) => u.id))];
  if (idsUnicos.length < 2) continue;
  if (!lista.some((u) => universo.has(u.id))) continue;
  dupDoc.push({
    doc,
    users: idsUnicos.map((id) => {
      const u = porId.get(id);
      return {
        id,
        nome: u.name,
        profile_id: u.profile_id,
        status: u.user_status_id,
        criado: u.created_at,
      };
    }),
  });
}

// ---------- (b) mesmo e-mail em mais de um user ----------
const porEmail = new Map();
for (const u of users) {
  const e = String(u.email ?? "").trim().toLowerCase();
  if (!e || !e.includes("@")) continue;
  if (!porEmail.has(e)) porEmail.set(e, []);
  porEmail.get(e).push(u);
}
const dupEmail = [];
for (const [email, lista] of porEmail) {
  if (lista.length < 2) continue;
  if (!lista.some((u) => universo.has(u.id))) continue;
  dupEmail.push({
    email,
    users: lista.map((u) => ({ id: u.id, nome: u.name, cpf: digitos(u.cpf) || digitos(u.cnpj), criado: u.created_at })),
  });
}

// ---------- (c) tipo trocado ----------
const tipoTrocado = users
  .filter((u) => universo.has(u.id))
  .filter(
    (u) =>
      (u.person_type_id === 1 && digitos(u.cnpj).length > 0) ||
      (u.person_type_id === 2 && digitos(u.cpf).length > 0),
  )
  .map((u) => ({
    id: u.id,
    nome: u.name,
    person_type_id: u.person_type_id,
    cpf: digitos(u.cpf),
    cnpj: digitos(u.cnpj),
  }));

// ---------- (d) nome com lixo ----------
const nomeLixo = [];
for (const u of users) {
  if (!universo.has(u.id)) continue;
  const n = String(u.name ?? "");
  const problemas = [];
  if (!n.trim()) problemas.push("nome vazio");
  if (/\d/.test(n)) problemas.push("numeros no nome");
  if (/\s{2,}/.test(n)) problemas.push("espacos duplos");
  if (/\bteste?\b/i.test(n)) problemas.push("contem 'teste'");
  const letras = n.replace(/[^a-zA-ZÀ-ÿ]/g, "");
  if (letras.length >= 4 && n === n.toLowerCase()) problemas.push("tudo minusculo");
  if (n.trim() && n.trim().split(/\s+/).length === 1 && letras.length > 0)
    problemas.push("uma palavra so");
  if (problemas.length)
    nomeLixo.push({
      id: u.id,
      nome: n,
      cpf: digitos(u.cpf) || digitos(u.cnpj),
      problemas,
      criado: u.created_at,
    });
}

// ---------- (e) comprador sem vinculed_by_id ----------
// "criados por nos" = criado na janela 01-02/08 OU ligado a entidade do Apolo com created_at recente (esteira, >= 25/07)
const inicioEsteira = new Date("2026-07-20T00:00:00-03:00").getTime();
const semVinculo = users
  .filter((u) => universo.has(u.id))
  .filter((u) => u.profile_id === 2) // Cliente
  .filter((u) => !u.vinculed_by_id)
  .filter((u) => new Date(u.created_at).getTime() >= inicioEsteira)
  .map((u) => ({
    id: u.id,
    nome: u.name,
    cpf: digitos(u.cpf) || digitos(u.cnpj),
    criado: u.created_at,
    who_registered: nomeDe(u.who_registered_id),
    imobiliaria_id_col: u.imobiliaria_id,
  }));

// distribuicao who_registered_id dos criados na janela (pra entender quem e "nos")
const whoDist = {};
for (const u of users.filter(criadoNaJanela)) {
  const k = nomeDe(u.who_registered_id) ?? `id:${u.who_registered_id}`;
  whoDist[k] = (whoDist[k] ?? 0) + 1;
}

// ---------- (f) 2+ pedidos vivos da mesma unidade pro mesmo comprador ----------
const [ars] = await c.query(
  `SELECT ar.id, ar.code, ar.enterprise_unity_id, ar.client_id, ar.acquisition_request_stage_id AS stage,
          ar.created_at, eu.block, eu.lot, ent.code AS emp
     FROM acquisition_requests ar
     LEFT JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
     LEFT JOIN enterprises ent ON ent.id = eu.enterprise_id
    WHERE ar.acquisition_request_stage_id NOT IN (7, 8, 10, 11)`,
);
const stageNome = {
  1: "Reservado",
  2: "Analise de credito",
  3: "Contrato gerado",
  4: "Faturado",
  5: "Em assinatura",
  6: "Finalizado",
  9: "Proposta realizada",
};
const porClienteUnidade = new Map();
for (const ar of ars) {
  const k = `${ar.client_id}|${ar.enterprise_unity_id}`;
  if (!porClienteUnidade.has(k)) porClienteUnidade.set(k, []);
  porClienteUnidade.get(k).push(ar);
}
const pedidosDup = [];
for (const [, lista] of porClienteUnidade) {
  if (lista.length < 2) continue;
  const cliente = porId.get(lista[0].client_id);
  const novo = lista.some((ar) => new Date(ar.created_at).getTime() >= inicio0108);
  if (!universo.has(lista[0].client_id) && !novo) continue;
  pedidosDup.push({
    cliente: cliente?.name,
    cpf: digitos(cliente?.cpf) || digitos(cliente?.cnpj),
    unidade: `${lista[0].emp ?? "?"} Q${lista[0].block ?? "?"} L${lista[0].lot ?? "?"} (unity ${lista[0].enterprise_unity_id})`,
    pedidos: lista.map((ar) => ({
      id: ar.id,
      code: ar.code,
      stage: stageNome[ar.stage] ?? ar.stage,
      criado: ar.created_at,
    })),
  });
}

await c.end();

const out = {
  resumo,
  whoDist,
  a_cpf_duplicado: dupDoc,
  b_email_duplicado: dupEmail,
  c_tipo_trocado: tipoTrocado,
  d_nome_lixo: nomeLixo,
  e_sem_vinculo: semVinculo,
  f_pedidos_duplicados: pedidosDup,
};
fs.writeFileSync("audit-dup-resultado.json", JSON.stringify(out, null, 2));
console.log(
  JSON.stringify(
    {
      resumo,
      contagens: {
        a: dupDoc.length,
        b: dupEmail.length,
        c: tipoTrocado.length,
        d: nomeLixo.length,
        e: semVinculo.length,
        f: pedidosDup.length,
      },
    },
    null,
    2,
  ),
);
