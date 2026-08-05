// AUDITORIA (leitura apenas): lente "o que o time cadastrou em 01/08 na pressa"
// Universo: apolo_entities criadas em 01/08 (source=apolo) + as com c2xSynced=true.
// Checks: (a) valores repetidos em massa; (b) nome da mae vazio/igual; (c) email/telefone
// inventado ou repetido; (d) nascimento improvavel; (e) criada ontem sem documento.
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

const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  return resp.json();
};

const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const SEL = "id,display_name,entity_kind,document_masked,created_at,metadata";

// ── 1. Universo ──────────────────────────────────────────────────────────────
const inicio = "2026-08-01T03:00:00Z"; // 01/08 00:00 BRT
const fim = "2026-08-02T03:00:00Z";
const criadasOntem = await ler(
  "apolo_entities",
  `select=${SEL}&created_at=gte.${inicio}&created_at=lt.${fim}&metadata->>source=eq.apolo&limit=2000`,
);
const syncadas = await ler(
  "apolo_entities",
  `select=${SEL}&metadata->>c2xSynced=eq.true&limit=3000`,
);
const porId = new Map();
for (const e of [...criadasOntem, ...syncadas]) porId.set(e.id, e);
const universo = [...porId.values()];
const idsOntem = new Set(criadasOntem.map((e) => e.id));
console.log(
  `universo=${universo.length} (ontem=${criadasOntem.length}, syncadas=${syncadas.length})`,
);

// ── 2. Esteira (ficha), contatos, documentos — em lotes de 100 ───────────────
const todosIds = universo.map((e) => e.id);
const fichaPorEntidade = new Map();
const contatosPorEntidade = new Map();
const docsPorEntidade = new Map();
for (let i = 0; i < todosIds.length; i += 100) {
  const bloco = todosIds.slice(i, i + 100).join(",");
  const est = await ler("apolo_esteira", `select=entity_id,etapa,ficha&entity_id=in.(${bloco})`);
  for (const r of est) fichaPorEntidade.set(r.entity_id, r);
  const cts = await ler(
    "apolo_contacts",
    `select=entity_id,contact_type,value,normalized_value&entity_id=in.(${bloco})`,
  );
  for (const r of cts) {
    if (!contatosPorEntidade.has(r.entity_id)) contatosPorEntidade.set(r.entity_id, []);
    contatosPorEntidade.get(r.entity_id).push(r);
  }
  const docs = await ler("apolo_documents", `select=entity_id&entity_id=in.(${bloco})`);
  for (const r of docs) docsPorEntidade.set(r.entity_id, (docsPorEntidade.get(r.entity_id) ?? 0) + 1);
}
console.log(
  `fichas=${fichaPorEntidade.size} contatos=${contatosPorEntidade.size} comDocs=${docsPorEntidade.size}`,
);

// ── 3. C2X: users por CPF/CNPJ + lookups ─────────────────────────────────────
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;
const docsUniverso = [...new Set(universo.map((e) => digitos(e.document_masked)).filter((d) => d.length === 11 || d.length === 14))];
const c2xPorDoc = new Map();
for (let i = 0; i < docsUniverso.length; i += 200) {
  const bloco = docsUniverso.slice(i, i + 200);
  const marcas = bloco.map(() => "?").join(",");
  const [rows] = await c.query(
    `SELECT id, name, ${limpo("cpf")} cpf_limpo, ${limpo("cnpj")} cnpj_limpo, email, cellphone, phone,
            birthday, mother_name, naturalness, civil_state_id, property_regime_id, schooling_id,
            salary_range_id, profession_id, rg, created_at
       FROM users
      WHERE ${limpo("cpf")} IN (${marcas}) OR ${limpo("cnpj")} IN (${marcas})`,
    [...bloco, ...bloco],
  );
  for (const r of rows) {
    if (r.cpf_limpo) c2xPorDoc.set(r.cpf_limpo, r);
    if (r.cnpj_limpo) c2xPorDoc.set(r.cnpj_limpo, r);
  }
}
const [civil] = await c.query("SELECT id, name FROM civil_states");
const civilNome = new Map(civil.map((r) => [r.id, r.name]));
await c.end();
console.log(`c2x users achados=${c2xPorDoc.size}`);

// ── 4. Montagem por entidade ─────────────────────────────────────────────────
const linhas = universo.map((e) => {
  const doc = digitos(e.document_masked);
  const cad = e.metadata?.cadastro ?? {};
  const fic = fichaPorEntidade.get(e.id)?.ficha ?? {};
  const junta = (k) => fic[k] ?? cad[k] ?? null; // ficha da esteira manda
  const contatos = contatosPorEntidade.get(e.id) ?? [];
  const emails = contatos.filter((x) => x.contact_type === "email").map((x) => (x.normalized_value || x.value || "").toLowerCase().trim());
  const fones = contatos.filter((x) => x.contact_type === "phone" || x.contact_type === "whatsapp").map((x) => digitos(x.normalized_value || x.value));
  return {
    id: e.id,
    nome: e.display_name,
    kind: e.entity_kind,
    doc,
    criadaOntem: idsOntem.has(e.id),
    createdAt: e.created_at,
    synced: e.metadata?.c2xSynced === true,
    nomeMae: junta("nomeMae"),
    dataNascimento: junta("dataNascimento"),
    naturalidade: junta("naturalidade"),
    escolaridadeId: junta("escolaridadeId"),
    estadoCivilId: junta("estadoCivilId"),
    rendaId: junta("rendaId"),
    patrimonio: cad.patrimonio ?? null,
    emails,
    fones,
    nDocs: docsPorEntidade.get(e.id) ?? 0,
    c2x: c2xPorDoc.get(doc) ?? null,
  };
});

// ── 5. Checks ────────────────────────────────────────────────────────────────
const achados = { a_repetidos: {}, b_mae: [], c_contato: [], d_nascimento: [], e_semdoc: [] };

// (a) repeticoes em massa — contagens no universo (só PF p/ campos de pessoa)
const pf = linhas.filter((l) => l.kind === "pf");
const conta = (arr, fn) => {
  const m = new Map();
  for (const x of arr) {
    const v = fn(x);
    if (v == null || v === "") continue;
    if (!m.has(v)) m.set(v, []);
    m.get(v).push(x);
  }
  return [...m.entries()].sort((x, y) => y[1].length - x[1].length);
};
achados.a_repetidos.naturalidade = conta(pf, (l) => l.naturalidade).slice(0, 8).map(([v, xs]) => [v, xs.length]);
achados.a_repetidos.escolaridade = conta(pf, (l) => l.escolaridadeId).map(([v, xs]) => [v, xs.length]);
achados.a_repetidos.patrimonio = conta(pf, (l) => l.patrimonio).map(([v, xs]) => [v, xs.length]);
achados.a_repetidos.renda = conta(pf, (l) => l.rendaId).map(([v, xs]) => [v, xs.length]);
achados.a_repetidos.estadoCivil = conta(pf, (l) => l.estadoCivilId).map(([v, xs]) => [v, xs.length]);
achados.a_repetidos.dataNascimento_dup = conta(pf, (l) => l.dataNascimento)
  .filter(([, xs]) => xs.length >= 3)
  .map(([v, xs]) => [v, xs.map((x) => `${x.nome}|${x.doc}`)]);
achados.a_repetidos.nomeMae_dup = conta(pf, (l) => (l.nomeMae || "").toUpperCase().trim())
  .filter(([, xs]) => xs.length >= 2)
  .map(([v, xs]) => [v, xs.map((x) => `${x.nome}|${x.doc}`)]);
// e no C2X: email/cellphone repetidos entre users do universo
const comC2x = linhas.filter((l) => l.c2x);
achados.a_repetidos.c2x_email_dup = conta(comC2x, (l) => (l.c2x.email || "").toLowerCase().trim())
  .filter(([, xs]) => xs.length >= 2)
  .map(([v, xs]) => [v, xs.map((x) => `${x.nome}|${x.doc}`)]);
achados.a_repetidos.c2x_cell_dup = conta(comC2x, (l) => digitos(l.c2x.cellphone))
  .filter(([v, xs]) => v && xs.length >= 2)
  .map(([v, xs]) => [v, xs.map((x) => `${x.nome}|${x.doc}`)]);

// (b) nome da mae vazio ou igual ao da pessoa (na ficha e no C2X)
for (const l of pf) {
  const maeFicha = (l.nomeMae || "").trim();
  const maeC2x = (l.c2x?.mother_name || "").trim();
  const nomeUp = l.nome.toUpperCase().trim();
  if (l.c2x && !maeC2x) achados.b_mae.push({ ...resumo(l), sinal: `C2X mother_name vazio × ficha "${maeFicha || "(vazio tambem)"}"` });
  else if (l.c2x && maeC2x.toUpperCase() === nomeUp) achados.b_mae.push({ ...resumo(l), sinal: `C2X mother_name igual ao nome da pessoa ("${maeC2x}")` });
  else if (!l.c2x && !maeFicha) achados.b_mae.push({ ...resumo(l), sinal: "ficha sem nome da mae (nao subiu ainda)" });
  else if (maeFicha && maeFicha.toUpperCase() === nomeUp) achados.b_mae.push({ ...resumo(l), sinal: `ficha: nome da mae igual ao da pessoa ("${maeFicha}")` });
}

// (c) email inventado / telefone invalido ou repetido
const emailInvalido = (em) => {
  if (!em) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return "formato invalido";
  const dom = em.split("@")[1];
  if (/gmial|gamil|gmali|hotmial|hotmal|outlok|yahho|bol\.co$|\.con$|\.comm$/.test(dom)) return `dominio com erro de digitacao (${dom})`;
  return null;
};
const foneInvalido = (f) => {
  if (!f) return null;
  const d = digitos(f);
  if (d.length < 10 || d.length > 13) return `comprimento ${d.length} digitos`;
  const corpo = d.slice(-9);
  if (/^(\d)\1+$/.test(corpo)) return "digitos todos repetidos";
  return null;
};
for (const l of linhas) {
  const emailsTodos = [...new Set([...(l.emails ?? []), (l.c2x?.email || "").toLowerCase().trim()].filter(Boolean))];
  for (const em of emailsTodos) {
    const p = emailInvalido(em);
    if (p) achados.c_contato.push({ ...resumo(l), sinal: `email "${em}": ${p}` });
  }
  const fonesTodos = [...new Set([...(l.fones ?? []), digitos(l.c2x?.cellphone), digitos(l.c2x?.phone)].filter(Boolean))];
  for (const f of fonesTodos) {
    const p = foneInvalido(f);
    if (p) achados.c_contato.push({ ...resumo(l), sinal: `telefone ${f}: ${p}` });
  }
}

// (d) nascimento improvavel (<16 ou >95 em 01/08/2026) — ficha e C2X
const idadeEm = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(+d)) return null;
  return (Date.parse("2026-08-01") - +d) / (365.25 * 24 * 3600 * 1000);
};
for (const l of pf) {
  const nasFicha = l.dataNascimento;
  const nasC2x = l.c2x?.birthday ? new Date(l.c2x.birthday).toISOString().slice(0, 10) : null;
  for (const [fonte, val] of [["C2X", nasC2x], ["ficha", nasFicha]]) {
    if (!val) continue;
    const idade = idadeEm(val);
    if (idade != null && (idade < 16 || idade > 95)) {
      achados.d_nascimento.push({ ...resumo(l), sinal: `${fonte}: nascimento ${val} = ${idade.toFixed(1)} anos` });
      break; // um por pessoa, priorizando C2X
    }
  }
  // divergencia ficha × C2X de nascimento (dado de contrato)
  if (nasFicha && nasC2x && nasFicha !== nasC2x) {
    achados.d_nascimento.push({ ...resumo(l), sinal: `DIVERGE: C2X ${nasC2x} × ficha ${nasFicha}` });
  }
}

// (e) criadas ontem sem documento no Apolo
for (const l of linhas.filter((x) => x.criadaOntem && x.nDocs === 0)) {
  achados.e_semdoc.push({ ...resumo(l), sinal: `criada ${l.createdAt.slice(0, 16)} sem nenhum documento em apolo_documents` });
}

function resumo(l) {
  return { nome: l.nome, doc: l.doc, kind: l.kind, synced: l.synced, criadaOntem: l.criadaOntem, c2xId: l.c2x?.id ?? null };
}

// resumo de nao-achados no C2X (contexto)
const syncSemC2x = linhas.filter((l) => l.synced && !l.c2x).length;
console.log(`synced sem user no C2X pelo doc: ${syncSemC2x}`);

fs.writeFileSync("audit-lente-pressa-out.json", JSON.stringify(achados, null, 1));
console.log("counts:", {
  b_mae: achados.b_mae.length,
  c_contato: achados.c_contato.length,
  d_nascimento: achados.d_nascimento.length,
  e_semdoc: achados.e_semdoc.length,
});
console.log("repetidos:", JSON.stringify(achados.a_repetidos, null, 1).slice(0, 4000));
