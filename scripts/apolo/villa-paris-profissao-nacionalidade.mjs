// VILLA PARIS: os cadastros chegaram ao C2X com profissão e nacionalidade?
//
// Pergunta do Lucas (31/08/2026): "subimos o cadastro sem a profissão e sem as nacionalidades,
// precisamos desses dados para gerar os contratos".
//
// O Apolo TEM os dados (46 de 51 com nacionalidade, 49 com profissão em apolo_entities). A dúvida
// é o outro lado: o que efetivamente gravou no C2X. Este script cruza pelo CPF, no banco do C2X —
// nunca pelo nosso carimbo `c2xSynced`, que é o que dizemos ter feito, não o que aconteceu.
//
// Uso (da raiz do repo):
//   node scripts/apolo/villa-paris-profissao-nacionalidade.mjs
//
// ⚠️ SÓ LEITURA nos dois lados. Nenhum UPDATE, nenhum INSERT.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

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
const EVENTO_VILLA_PARIS = "54dfd6ce-8c4b-49df-80dd-58d819d4d56a";

const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  return resp.json();
};

const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");

// ---------------------------------------------------------------------------
// 1. Quem são as 51 pessoas, e o que o Apolo tem delas
// ---------------------------------------------------------------------------
const credenciados = await ler(
  "prometeu_credenciados",
  `evento_id=eq.${EVENTO_VILLA_PARIS}&select=nome,documento,entity_id&limit=1000`,
);

const ids = credenciados.map((c) => c.entity_id).filter(Boolean);
const entidades = [];
// ⚠️ `.in()` estoura a URL em lotes grandes; 100 por vez é o limite seguro da casa.
for (let i = 0; i < ids.length; i += 100) {
  const lote = ids.slice(i, i + 100);
  entidades.push(
    ...(await ler(
      "apolo_entities",
      `id=in.(${lote.join(",")})&select=id,display_name,document_masked,metadata&limit=1000`,
    )),
  );
}
const porId = new Map(entidades.map((e) => [e.id, e]));

const pessoas = credenciados
  .filter((c) => c.entity_id && porId.has(c.entity_id))
  .map((c) => {
    const e = porId.get(c.entity_id);
    const cad = e.metadata?.cadastro ?? {};
    return {
      cpf: soDigitos(c.documento || e.document_masked),
      nome: c.nome || e.display_name,
      apoloNacionalidade: (cad.nacionalidade ?? "").trim(),
      apoloProfissaoId: (cad.profissaoId ?? "").trim(),
      apoloProfissaoOutro: (cad.profissaoOutro ?? "").trim(),
      sincronizado: e.metadata?.c2xSynced === true,
    };
  })
  .filter((p) => p.cpf);

console.log(`Villa Paris: ${credenciados.length} credenciados, ${pessoas.length} com CPF legível.`);

// ---------------------------------------------------------------------------
// 2. O que o C2X tem — a fonte que vale, porque é dela que sai o contrato
// ---------------------------------------------------------------------------
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// Primeiro: como as colunas se chamam de verdade neste banco.
const [colunas] = await c.query(
  `select column_name, data_type from information_schema.columns
    where table_schema = ? and table_name = 'users'
      and (column_name like '%nacion%' or column_name like '%nation%'
           or column_name like '%profiss%' or column_name like '%profess%')
    order by column_name`,
  [env.GUARDIAN_DB_NAME],
);
console.log("\nColunas do C2X em `users`:");
for (const col of colunas) console.log(`  ${col.column_name} (${col.data_type})`);

const cpfs = pessoas.map((p) => p.cpf);
const [linhas] = await c.query(
  `select u.id, u.name, u.cpf, u.nacionality, u.profession_id, p.name as profissao_nome
     from users u
     left join professions p on p.id = u.profession_id
    where replace(replace(replace(u.cpf, '.', ''), '-', ''), ' ', '') in (?)`,
  [cpfs],
);

const noC2x = new Map(linhas.map((l) => [soDigitos(l.cpf), l]));

// ---------------------------------------------------------------------------
// 3. O confronto
// ---------------------------------------------------------------------------
const semNoC2x = [];
const semNacionalidade = [];
const semProfissao = [];
const semFonteNoApolo = [];

for (const p of pessoas) {
  const l = noC2x.get(p.cpf);
  if (!l) {
    semNoC2x.push(p);
    continue;
  }
  const nacC2x = (l.nacionality ?? "").trim();
  // 25 = "PROFISSÃO NÃO DECLARADA", o default que o C2X aplica quando o campo vai nulo.
  const profVazia = !l.profession_id || Number(l.profession_id) === 25;

  if (!nacC2x) {
    semNacionalidade.push({ ...p, c2xId: l.id });
    if (!p.apoloNacionalidade) semFonteNoApolo.push({ ...p, falta: "nacionalidade" });
  }
  if (profVazia) {
    semProfissao.push({ ...p, c2xId: l.id, profissaoNoC2x: l.profissao_nome ?? null });
    if (!p.apoloProfissaoId) semFonteNoApolo.push({ ...p, falta: "profissao" });
  }
}

console.log(`\n${"=".repeat(70)}`);
console.log("RESULTADO");
console.log("=".repeat(70));
console.log(`Encontrados no C2X pelo CPF: ${pessoas.length - semNoC2x.length} de ${pessoas.length}`);
console.log(`SEM nacionalidade no C2X:    ${semNacionalidade.length}`);
console.log(`SEM profissão no C2X:        ${semProfissao.length}`);
console.log(
  `  destes, o Apolo TEM o dado (dá para reenviar): ` +
    `nacionalidade ${semNacionalidade.filter((p) => p.apoloNacionalidade).length}, ` +
    `profissão ${semProfissao.filter((p) => p.apoloProfissaoId).length}`,
);

if (semNoC2x.length) {
  console.log(`\nNÃO ESTÃO NO C2X (${semNoC2x.length}):`);
  for (const p of semNoC2x) console.log(`  ${p.nome} — ${p.cpf}`);
}

if (semNacionalidade.length) {
  console.log(`\nSEM NACIONALIDADE NO C2X (${semNacionalidade.length}):`);
  for (const p of semNacionalidade) {
    console.log(
      `  [${p.c2xId}] ${p.nome} — Apolo: ${p.apoloNacionalidade || "(também vazio)"}`,
    );
  }
}

if (semProfissao.length) {
  console.log(`\nSEM PROFISSÃO NO C2X (${semProfissao.length}):`);
  for (const p of semProfissao) {
    const daApolo = p.apoloProfissaoId
      ? `id ${p.apoloProfissaoId}`
      : p.apoloProfissaoOutro
        ? `digitada "${p.apoloProfissaoOutro}"`
        : "(também vazio)";
    console.log(`  [${p.c2xId}] ${p.nome} — C2X: ${p.profissaoNoC2x ?? "nulo"} · Apolo: ${daApolo}`);
  }
}

if (semFonteNoApolo.length) {
  console.log(`\n⚠️ SEM FONTE EM LUGAR NENHUM (${semFonteNoApolo.length}) — precisa perguntar ao cliente:`);
  for (const p of semFonteNoApolo) console.log(`  ${p.nome} — falta ${p.falta}`);
}

await c.end();
