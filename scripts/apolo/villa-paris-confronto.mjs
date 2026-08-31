// VILLA PARIS: o que o C2X gravou BATE com o que o cliente declarou no Apolo?
//
// O corte anterior mostrou 35 de 35 compradores COM profissão e nacionalidade no C2X — nenhum
// campo vazio. Mas "preenchido" não é "certo": a amostra veio com EMPRESÁRIO(A) repetido em
// sequência, o que cheira a valor default aplicado em massa. Campo com o dado errado é pior que
// campo vazio, porque ninguém vai conferir antes de imprimir o contrato.
//
// Este script confronta, pessoa a pessoa: o que a ficha do Apolo diz × o que está no C2X.
//
// Uso (da raiz do repo):
//   node scripts/apolo/villa-paris-confronto.mjs
//
// ⚠️ SÓ LEITURA nos dois lados.
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

const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  return resp.json();
};

const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// 1. Compradores do Villa Paris no C2X
const [ars] = await c.query(
  `select ar.id as ar_id, s.name as etapa, un.name as unidade,
          ar.client_id, ar.client_2_id, ar.client_3_id, ar.client_4_id, ar.client_5_id
     from acquisition_requests ar
     join enterprise_unities un on un.id = ar.enterprise_unity_id
     left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
    where un.enterprise_id = 38`,
);

const ids = new Set();
const unidadePorCliente = new Map();
for (const a of ars) {
  for (const k of ["client_id", "client_2_id", "client_3_id", "client_4_id", "client_5_id"]) {
    if (!a[k]) continue;
    ids.add(a[k]);
    if (!unidadePorCliente.has(a[k])) unidadePorCliente.set(a[k], `${a.unidade} (${a.etapa})`);
  }
}

const [fichas] = await c.query(
  `select u.id, u.name, u.cpf, u.nacionality, u.profession_id, p.name as profissao, u.updated_at
     from users u left join professions p on p.id = u.profession_id
    where u.id in (?)`,
  [[...ids]],
);

// 2. A ficha do Apolo das mesmas pessoas, pelo CPF
const cpfs = fichas.map((f) => soDigitos(f.cpf)).filter(Boolean);
const entidades = [];
for (let i = 0; i < cpfs.length; i += 60) {
  const lote = cpfs.slice(i, i + 60);
  const ors = lote.map((d) => `document_masked.ilike.*${d.slice(0, 3)}*`).join(",");
  entidades.push(
    ...(await ler(
      "apolo_entities",
      `or=(${ors})&entity_kind=eq.pf&select=id,display_name,document_masked,metadata&limit=2000`,
    )),
  );
}
const apoloPorCpf = new Map();
for (const e of entidades) {
  const d = soDigitos(e.document_masked);
  if (d) apoloPorCpf.set(d, e);
}

// ⚠️ A FICHA VIVE EM TRES LUGARES, e o sync le os tres em cascata:
//   metadata.cadastro  <  apolo_esteira.ficha  <  metadata.cadastroEditado
// Olhar so o primeiro faz a ficha parecer vazia quando o dado esta na esteira. E o erro que eu
// cometi no primeiro corte. Ver lib/apolo/cadastro-cascata.ts (unirCadastroEFicha).
const idsEnt = [...apoloPorCpf.values()].map((e) => e.id);
const esteiraPorEntidade = new Map();
for (let i = 0; i < idsEnt.length; i += 100) {
  const lote = idsEnt.slice(i, i + 100);
  const linhas = await ler(
    "apolo_esteira",
    `entity_id=in.(${lote.join(",")})&select=entity_id,ficha,atualizado_em,created_at&limit=2000`,
  );
  for (const l of linhas) {
    // A MAIS RECENTE vence: uma CAD por pessoa POR EMPREENDIMENTO gera varias linhas.
    const atual = esteiraPorEntidade.get(l.entity_id);
    const quando = l.atualizado_em ?? l.created_at ?? "";
    if (!atual || quando > atual.quando) esteiraPorEntidade.set(l.entity_id, { ficha: l.ficha ?? {}, quando });
  }
}

// 3. O catálogo de profissões do C2X, para traduzir o id que o Apolo guarda
const [profs] = await c.query(`select id, name from professions`);
const nomeDaProfissao = new Map(profs.map((p) => [String(p.id), p.name]));

// 4. Confronto
const divergentes = [];
const semApolo = [];
const iguais = [];
// ⚠️ A ASSIMETRIA QUE INTERESSA: o Apolo em branco e o C2X preenchido. O sync roda uma cascata
// que completa profissao/nacionalidade na subida (c2x-write-server.ts ~2051), entao a FICHA DO
// APOLO pode parecer vazia enquanto o C2X — de onde sai o contrato — esta completo.
const soNoC2x = [];

for (const f of fichas) {
  const d = soDigitos(f.cpf);
  const e = apoloPorCpf.get(d);
  if (!e) {
    semApolo.push(f);
    continue;
  }
  const cad = {
    ...(e.metadata?.cadastro ?? {}),
    ...(esteiraPorEntidade.get(e.id)?.ficha ?? {}),
    ...(e.metadata?.cadastroEditado ?? {}),
  };
  const apoloProfNome = cad.profissaoId ? nomeDaProfissao.get(String(cad.profissaoId)) : null;
  const apoloNac = (cad.nacionalidade ?? "").trim();

  const profDiverge = apoloProfNome && apoloProfNome !== f.profissao;
  const nacDiverge =
    apoloNac && apoloNac.toLowerCase() !== String(f.nacionality ?? "").trim().toLowerCase();

  if (!apoloNac && String(f.nacionality ?? "").trim()) {
    soNoC2x.push({ campo: "nacionalidade", nome: f.name, c2x: f.nacionality });
  }
  if (!apoloProfNome && f.profissao) {
    soNoC2x.push({ campo: "profissao", nome: f.name, c2x: f.profissao });
  }

  if (profDiverge || nacDiverge) {
    divergentes.push({
      nome: f.name,
      cpf: f.cpf,
      c2xId: f.id,
      unidade: unidadePorCliente.get(f.id),
      profC2x: f.profissao,
      profApolo: apoloProfNome,
      profDiverge,
      nacC2x: f.nacionality,
      nacApolo: apoloNac,
      nacDiverge,
    });
  } else {
    iguais.push(f);
  }
}

console.log("=".repeat(78));
console.log("VILLA PARIS — o C2X bate com o que o cliente declarou no Apolo?");
console.log("=".repeat(78));
console.log(`Compradores no C2X:        ${fichas.length}`);
console.log(`  com ficha no Apolo:      ${fichas.length - semApolo.length}`);
console.log(`  batendo:                 ${iguais.length}`);
console.log(`  DIVERGENTES:             ${divergentes.length}`);
console.log(`  sem ficha no Apolo:      ${semApolo.length} (não dá para conferir)`);

console.log(`
${"=".repeat(78)}`);
console.log("CAMPOS QUE SÓ EXISTEM NO C2X (a cascata INTEIRA do Apolo está em branco)");
console.log("=".repeat(78));
const nacSo = soNoC2x.filter((x) => x.campo === "nacionalidade");
const proSo = soNoC2x.filter((x) => x.campo === "profissao");
console.log(`  nacionalidade: ${nacSo.length} de ${fichas.length}`);
console.log(`  profissão:     ${proSo.length} de ${fichas.length}`);
for (const x of nacSo.slice(0, 8)) console.log(`    nac  ${x.nome} -> C2X "${x.c2x}"`);
for (const x of proSo.slice(0, 8)) console.log(`    prof ${x.nome} -> C2X "${x.c2x}"`);

// 5. A distribuição das profissões — um valor repetido demais denuncia default
const contagem = {};
for (const f of fichas) contagem[f.profissao ?? "(nulo)"] = (contagem[f.profissao ?? "(nulo)"] ?? 0) + 1;
console.log(`\nDISTRIBUIÇÃO DAS PROFISSÕES NO C2X:`);
for (const [nome, n] of Object.entries(contagem).sort((a, b) => b[1] - a[1])) {
  const barra = "#".repeat(n);
  console.log(`  ${String(nome).slice(0, 34).padEnd(34)} ${String(n).padStart(3)} ${barra}`);
}

if (divergentes.length) {
  console.log(`\n${"=".repeat(78)}`);
  console.log(`DIVERGENTES (${divergentes.length}) — o contrato sairia com o dado errado`);
  console.log("=".repeat(78));
  for (const d of divergentes) {
    console.log(`\n  [${d.c2xId}] ${d.nome} — ${d.unidade ?? ""}`);
    if (d.profDiverge) console.log(`     profissão:    C2X "${d.profC2x}"  ×  Apolo "${d.profApolo}"`);
    if (d.nacDiverge) console.log(`     nacionalidade: C2X "${d.nacC2x}"  ×  Apolo "${d.nacApolo}"`);
  }
}

if (semApolo.length) {
  console.log(`\nSEM FICHA NO APOLO (${semApolo.length}):`);
  for (const f of semApolo) console.log(`  [${f.id}] ${f.name} — ${f.cpf}`);
}

await c.end();
