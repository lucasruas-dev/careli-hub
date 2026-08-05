// AUDITORIA FINAL v2 (leitura apenas): agrega sinais POR CPF — ha entidades duplicadas
// (uma rica com ficha/docs + uma vazia "identity") e o cruzamento por entidade unica perdia sinal.
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
const texto = (v) => (typeof v === "string" && v.trim() ? v.trim() : null);
const EC = {
  1: "Solteiro (a)",
  2: "Casado (a)",
  3: "Divorciado (a)",
  4: "Separado (a) judicialmente",
  5: "Viúvo (a)",
  6: "União Estável",
};
const REGIME = {
  1: "Comunhão parcial de bens",
  2: "Comunhão universal de bens",
  3: "Separação de bens",
  4: "Participação final nos aquestos",
  5: "Regime misto",
  6: "Pacto antenupcial",
};
const ecLabel = (id) => EC[Number(id)] ?? (id == null ? "(vazio)" : `id ${id}`);

// ── 1. Universo Apolo (TODAS as entidades do universo, agrupadas por CPF) ────
const universo = [];
for (let off = 0; ; off += 1000) {
  const lote = await ler(
    "apolo_entities",
    `select=id,display_name,document_masked,entity_kind,metadata,created_at` +
      `&or=(metadata->>c2xSynced.eq.true,created_at.gte.2026-08-01T00:00:00-03:00)` +
      `&limit=1000&offset=${off}`,
  );
  universo.push(...lote);
  if (lote.length < 1000) break;
}
const pf = universo.filter((e) => e.entity_kind !== "pj");
const ids = pf.map((e) => e.id);

const fichas = new Map();
const relConj = new Map();
const docsPorEnt = new Map();
for (let i = 0; i < ids.length; i += 100) {
  const fatia = ids.slice(i, i + 100).join(",");
  for (const e of await ler("apolo_esteira", `select=entity_id,ficha&entity_id=in.(${fatia})`))
    fichas.set(e.entity_id, e.ficha ?? {});
  for (const r of await ler(
    "apolo_relationships",
    `select=entity_id,label&relationship_type=eq.conjuge&entity_id=in.(${fatia})`,
  ))
    if (!relConj.has(r.entity_id)) relConj.set(r.entity_id, r);
  for (const d of await ler(
    "apolo_documents",
    `select=entity_id,document_type,label&entity_id=in.(${fatia})`,
  )) {
    const l = docsPorEnt.get(d.entity_id) ?? [];
    l.push(d);
    docsPorEnt.set(d.entity_id, l);
  }
}

// Grupos por CPF (fallback: c2xUserId como chave sintética)
const grupos = new Map(); // chave -> {entidades:[]}
for (const e of pf) {
  const cpf = digitos(e.document_masked);
  const chave = cpf.length === 11 ? `cpf:${cpf}` : e.metadata?.c2xUserId ? `uid:${e.metadata.c2xUserId}` : `ent:${e.id}`;
  const g = grupos.get(chave) ?? { entidades: [] };
  g.entidades.push(e);
  grupos.set(chave, g);
}

// ── 2. C2X ──────────────────────────────────────────────────────────────────
const conn = await mysql.createConnection({
  host: env.GUARDIAN_DB_HOST,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
  password: env.GUARDIAN_DB_PASSWORD,
  database: env.GUARDIAN_DB_NAME,
});
const users = new Map();
const cpfsLimpos = [...grupos.keys()].filter((k) => k.startsWith("cpf:")).map((k) => k.slice(4));
for (let i = 0; i < cpfsLimpos.length; i += 300) {
  const [rows] = await conn.query(
    `SELECT id, name, cpf, civil_state_id, property_regime_id FROM users
      WHERE REPLACE(REPLACE(REPLACE(cpf,'.',''),'-',''),' ','') IN (?)`,
    [cpfsLimpos.slice(i, i + 300)],
  );
  for (const r of rows) users.set(r.id, r);
}
const uidsPedidos = [...grupos.keys()].filter((k) => k.startsWith("uid:")).map((k) => Number(k.slice(4)));
const uidsFaltando = uidsPedidos.filter((u) => !users.has(u));
if (uidsFaltando.length) {
  const [rows] = await conn.query(
    `SELECT id, name, cpf, civil_state_id, property_regime_id FROM users WHERE id IN (?)`,
    [uidsFaltando],
  );
  for (const r of rows) users.set(r.id, r);
}
const userIds = [...users.keys()];
const spousesPorUser = new Map();
for (let i = 0; i < userIds.length; i += 500) {
  const [rows] = await conn.query(
    `SELECT ownertable_id, name, cpf FROM spouses WHERE ownertable_type='User' AND ownertable_id IN (?)`,
    [userIds.slice(i, i + 500)],
  );
  for (const r of rows) {
    const l = spousesPorUser.get(r.ownertable_id) ?? [];
    l.push(r);
    spousesPorUser.set(r.ownertable_id, l);
  }
}
await conn.end();

// user -> grupo
const grupoDoUser = (u) => {
  const cpf = digitos(u.cpf);
  if (cpf.length === 11 && grupos.has(`cpf:${cpf}`)) return grupos.get(`cpf:${cpf}`);
  if (grupos.has(`uid:${u.id}`)) return grupos.get(`uid:${u.id}`);
  for (const g of grupos.values())
    if (g.entidades.some((e) => Number(e.metadata?.c2xUserId) === u.id)) return g;
  return null;
};

// ── 3. Cruzamento agregado ──────────────────────────────────────────────────
const casos = [];
const usados = new Set();

for (const u of users.values()) {
  const g = grupoDoUser(u);
  if (!g) continue;
  const chave = g.entidades[0].id;
  if (usados.has(chave)) continue;
  usados.add(chave);

  // Agrega sinais de TODAS as entidades irmãs
  let fichaEc = null,
    cadEc = null,
    regimeFichaOuCad = null,
    conjugeFicha = null,
    conjugeRel = null;
  const docsConjuge = [];
  const certidoes = [];
  let nome = null;
  for (const e of g.entidades) {
    if (!nome || (e.metadata?.cadastro && Object.keys(e.metadata.cadastro).length)) nome = e.display_name;
    const f = fichas.get(e.id) ?? {};
    const c = e.metadata?.cadastro ?? {};
    // ficha ganha do cadastro para "o que subiu", mas para SINAL vale qualquer fonte 2/6
    if (fichaEc == null && f.estadoCivilId != null) fichaEc = String(f.estadoCivilId);
    if (cadEc == null && c.estadoCivilId != null) cadEc = String(c.estadoCivilId);
    const reg = texto(String(f.regimeBensId ?? "")) ?? texto(String(c.regimeBensId ?? ""));
    if (regimeFichaOuCad == null && reg) regimeFichaOuCad = reg;
    if (!conjugeFicha) conjugeFicha = texto(f.conjugeNome) ?? texto(f.conjugeCpf);
    if (!conjugeRel && relConj.has(e.id)) conjugeRel = texto(relConj.get(e.id).label) ?? "(sem nome)";
    for (const d of docsPorEnt.get(e.id) ?? []) {
      const alvo = `${d.document_type ?? ""} ${d.label ?? ""}`;
      if (/conjuge|c[oô]njuge|casament|matrimoni/i.test(alvo))
        docsConjuge.push(`${d.document_type}${d.label ? ` [${d.label}]` : ""}`);
      else if (
        /certid[aã]o/i.test(alvo) &&
        !/nasciment|averbad|obito|[oó]bito|negativa/i.test(alvo)
      )
        certidoes.push(`${d.document_type}${d.label ? ` [${d.label}]` : ""}`);
    }
  }
  const spouses = spousesPorUser.get(u.id) ?? [];
  const cpf = digitos(u.cpf) || digitos(g.entidades[0].document_masked);
  nome = nome ?? u.name;

  const ec = u.civil_state_id == null ? null : Number(u.civil_state_id);
  const c2xCasado = ec === 2 || ec === 6;
  const ficha26 = fichaEc === "2" || fichaEc === "6";
  const cad26 = cadEc === "2" || cadEc === "6";

  if (!c2xCasado) {
    const fortes = [];
    if (spouses.length) fortes.push(`cônjuge cadastrado no C2X (spouses): ${spouses[0].name}`);
    if (ficha26) fortes.push(`ficha do Apolo diz ${ecLabel(fichaEc)}`);
    if (cad26 && !ficha26) fortes.push(`cadastro importado do Asana diz ${ecLabel(cadEc)}`);
    if (conjugeFicha) fortes.push(`cônjuge preenchido na ficha: ${conjugeFicha}`);
    if (conjugeRel) fortes.push(`relacionamento cônjuge no Apolo: ${conjugeRel}`);
    if (docsConjuge.length) fortes.push(`documento do cônjuge anexado: ${docsConjuge.join(" ; ")}`);

    const regimeC2x = u.property_regime_id != null;
    if (fortes.length || certidoes.length || regimeC2x || regimeFichaOuCad) {
      const extras = [];
      if (certidoes.length) extras.push(`certidão anexada: ${certidoes.join(" ; ")}`);
      if (regimeC2x) extras.push(`regime de bens no C2X: ${REGIME[u.property_regime_id] ?? u.property_regime_id}`);
      else if (regimeFichaOuCad)
        extras.push(`regime de bens informado no Apolo: ${REGIME[Number(regimeFichaOuCad)] ?? regimeFichaOuCad}`);
      let prioridade, problema, evidencia;
      if (fortes.length) {
        prioridade = "alta";
        problema = `${ecLabel(ec)} no C2X com sinal forte de casado(a)/união estável`;
        evidencia = `C2X: ${ecLabel(ec)} × ${fortes.join("; ")}${extras.length ? "; " + extras.join("; ") : ""}`;
      } else if (certidoes.length) {
        prioridade = "media";
        problema = `${ecLabel(ec)} no C2X mas tem certidão anexada no Apolo (conferir se é de casamento)`;
        evidencia = `C2X: ${ecLabel(ec)} × ${extras.join("; ")}`;
      } else {
        prioridade = "baixa";
        problema = `${ecLabel(ec)} com regime de bens preenchido (incoerência)`;
        evidencia = `C2X: ${ecLabel(ec)} × ${extras.join("; ")} (regime de bens só existe com casamento/união)`;
      }
      casos.push({ nome, cpf, problema, evidencia, prioridade, _tipo: "A" });
    }
  } else {
    const semSpouse = spouses.length === 0;
    const semRegime = u.property_regime_id == null;
    if (semSpouse || semRegime) {
      const conjugeApolo = conjugeFicha ?? conjugeRel ?? null;
      const provaConjuge = conjugeApolo
        ? `cônjuge "${conjugeApolo}" registrado no Apolo e não subiu`
        : docsConjuge.length
          ? `documento do cônjuge anexado no Apolo (${docsConjuge.join(" ; ")}) e nenhum cônjuge subiu`
          : null;
      const partes = [];
      if (semSpouse) partes.push("sem cônjuge em spouses");
      if (semRegime) partes.push("sem regime de bens");
      casos.push({
        nome,
        cpf,
        problema: `${ecLabel(ec)} no C2X ${partes.join(" e ")}`,
        evidencia: `C2X: ${ecLabel(ec)}, spouses = ${spouses.length}, regime = ${u.property_regime_id ? REGIME[u.property_regime_id] : "(vazio)"} × Apolo: ${provaConjuge ?? "também sem cônjuge registrado (ficha, relacionamento e documentos)"}`,
        prioridade: provaConjuge ? "alta" : "media",
        _tipo: "B",
      });
    }
  }
}

const porPrioridade = { alta: 0, media: 0, baixa: 0 };
for (const c of casos) porPrioridade[c.prioridade]++;
const resumo = {
  universo_entidades: universo.length,
  universo_pf: pf.length,
  grupos_por_cpf: grupos.size,
  usuarios_c2x_cruzados: users.size,
  casos_total: casos.length,
  por_prioridade: porPrioridade,
  nao_casado_com_sinal_de_casado: casos.filter((c) => c._tipo === "A").length,
  casado_sem_conjuge_ou_regime: casos.filter((c) => c._tipo === "B").length,
};
console.log(JSON.stringify(resumo, null, 2));
const ordem = { alta: 0, media: 1, baixa: 2 };
casos.sort((a, b) => ordem[a.prioridade] - ordem[b.prioridade] || a.nome.localeCompare(b.nome));
fs.writeFileSync(
  path.resolve(process.cwd(), "audit-estado-civil-resultado2.json"),
  JSON.stringify({ resumo, casos }, null, 2),
  "utf8",
);
console.log("gravado audit-estado-civil-resultado2.json");
for (const c of casos) console.log(`[${c.prioridade}] ${c.nome} — ${c.problema}`);
