// CAÇA AOS DADOS: profissão e nacionalidade dos 11 cônjuges do Villa Paris.
//
// "eu preciso da profissão e nacionalidade" (Lucas, 31/08/2026). O conserto do código faz o
// próximo cadastro subir completo, mas não preenche o passado. Antes de mandar alguém ligar para
// onze clientes, vale varrer tudo o que já temos — o dado pode estar guardado em algum lugar que
// ninguém cruzou ainda.
//
// Onde procurar, e por quê:
//   1. O PRÓPRIO C2X, em outra ficha. Cônjuge de um contrato costuma ser COMPRADOR de outro: se
//      ele tem `users` própria, a profissão está lá preenchida. Casa por CPF.
//   2. Outras linhas de `spouses` com o mesmo CPF — a mesma pessoa cadastrada em outra venda.
//   3. A ficha da esteira do Apolo (`apolo_esteira.ficha`), campos conjuge*.
//   4. O relacionamento 'conjuge' do Apolo, onde o wizard grava desde 23/08.
//   5. `cpf_validations`, que carrega spouse_id e pode ter sobrado dado de validação.
//
// Uso (da raiz do repo):
//   node scripts/apolo/villa-paris-cacar-conjuges.mjs
//
// ⚠️ SÓ LEITURA em todos os lados. Nada é gravado.
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
const vazio = (v) => !String(v ?? "").trim();

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// Os pendentes
const [pendentes] = await c.query(
  `select distinct sp.id as spouse_id, sp.name as conjuge, sp.cpf as conjuge_cpf,
          sp.nacionality, sp.profession_id, sp.identification_number, sp.birthday,
          u.id as titular_id, u.name as titular, u.cpf as titular_cpf
     from spouses sp
     join users u on u.id = sp.ownertable_id and sp.ownertable_type = 'User'
     join acquisition_requests ar on ar.client_id = u.id
     join enterprise_unities un on un.id = ar.enterprise_unity_id
    where un.enterprise_id = 38
      and (sp.nacionality is null or sp.nacionality = ''
           or sp.profession_id is null or sp.profession_id = 25)`,
);

const porId = new Map();
for (const p of pendentes) if (!porId.has(p.spouse_id)) porId.set(p.spouse_id, p);
const lista = [...porId.values()];
console.log(`Cônjuges pendentes: ${lista.length}\n`);

const cpfs = lista.map((p) => soDigitos(p.conjuge_cpf)).filter(Boolean);

// FONTE 1 — o cônjuge tem ficha PRÓPRIA de comprador no C2X?
const [comoUsuario] = cpfs.length
  ? await c.query(
      `select u.id, u.name, u.cpf, u.nacionality, u.profession_id, p.name as profissao,
              u.naturalness
         from users u left join professions p on p.id = u.profession_id
        where replace(replace(replace(u.cpf,'.',''),'-',''),' ','') in (?)`,
      [cpfs],
    )
  : [[]];
const fichaPropria = new Map(comoUsuario.map((u) => [soDigitos(u.cpf), u]));

// FONTE 2 — a mesma pessoa como cônjuge em OUTRA venda, já preenchida
const [outrosSpouses] = cpfs.length
  ? await c.query(
      `select sp.id, sp.name, sp.cpf, sp.nacionality, sp.profession_id, p.name as profissao
         from spouses sp left join professions p on p.id = sp.profession_id
        where replace(replace(replace(sp.cpf,'.',''),'-',''),' ','') in (?)
          and ((sp.nacionality is not null and sp.nacionality <> '')
               or (sp.profession_id is not null and sp.profession_id <> 25))`,
      [cpfs],
    )
  : [[]];
const outroRegistro = new Map();
for (const s of outrosSpouses) {
  const d = soDigitos(s.cpf);
  if (!outroRegistro.has(d)) outroRegistro.set(d, s);
}

// FONTE 3 e 4 — a ficha da esteira e o relacionamento do Apolo, pelo TITULAR
const titularCpfs = [...new Set(lista.map((p) => soDigitos(p.titular_cpf)).filter(Boolean))];
const entidades = [];
for (const cpf of titularCpfs) {
  const achados = await ler(
    "apolo_entities",
    `document_masked=ilike.*${cpf.slice(0, 3)}*&entity_kind=eq.pf&select=id,document_masked&limit=200`,
  );
  entidades.push(...achados.filter((e) => soDigitos(e.document_masked) === cpf));
}
const entPorCpf = new Map(entidades.map((e) => [soDigitos(e.document_masked), e.id]));
const idsEnt = [...entPorCpf.values()];

const esteiraPorEnt = new Map();
const relPorEnt = new Map();
for (let i = 0; i < idsEnt.length; i += 100) {
  const lote = idsEnt.slice(i, i + 100);
  if (!lote.length) continue;
  for (const l of await ler(
    "apolo_esteira",
    `entity_id=in.(${lote.join(",")})&select=entity_id,ficha,atualizado_em&limit=2000`,
  )) {
    const a = esteiraPorEnt.get(l.entity_id);
    if (!a || String(l.atualizado_em ?? "") > String(a.quando ?? "")) {
      esteiraPorEnt.set(l.entity_id, { ficha: l.ficha ?? {}, quando: l.atualizado_em });
    }
  }
  for (const l of await ler(
    "apolo_relationships",
    `entity_id=in.(${lote.join(",")})&relationship_type=eq.conjuge&select=entity_id,label,metadata&limit=1000`,
  )) {
    relPorEnt.set(l.entity_id, l);
  }
}

const [profs] = await c.query(`select id, name from professions`);
const nomeProf = new Map(profs.map((p) => [String(p.id), p.name]));

// O confronto: para cada pendente, a melhor fonte encontrada
const achou = [];
const semNada = [];

for (const p of lista) {
  const cpfCj = soDigitos(p.conjuge_cpf);
  const entId = entPorCpf.get(soDigitos(p.titular_cpf));
  const ficha = entId ? (esteiraPorEnt.get(entId)?.ficha ?? {}) : {};
  const rel = entId ? relPorEnt.get(entId) : null;
  const relMeta = rel?.metadata ?? {};
  const relEhMesmaPessoa = relMeta.cpf && soDigitos(relMeta.cpf) === cpfCj;

  const fontes = [];
  const u = fichaPropria.get(cpfCj);
  if (u) {
    fontes.push({
      fonte: `ficha própria no C2X (user ${u.id})`,
      nacionalidade: u.nacionality,
      profissao: u.profession_id && Number(u.profession_id) !== 25 ? u.profissao : null,
      naturalidade: u.naturalness,
    });
  }
  const o = outroRegistro.get(cpfCj);
  if (o && o.id !== p.spouse_id) {
    fontes.push({
      fonte: `cônjuge em outra venda (spouse ${o.id})`,
      nacionalidade: o.nacionality,
      profissao: o.profession_id && Number(o.profession_id) !== 25 ? o.profissao : null,
    });
  }
  if (ficha.conjugeNacionalidade || ficha.conjugeProfissaoId || ficha.conjugeNaturalidade) {
    fontes.push({
      fonte: "ficha da esteira (Apolo)",
      nacionalidade: ficha.conjugeNacionalidade,
      profissao: ficha.conjugeProfissaoId ? nomeProf.get(String(ficha.conjugeProfissaoId)) : null,
      naturalidade: ficha.conjugeNaturalidade,
      livre: ficha.conjugeProfissaoOutro,
    });
  }
  if (relEhMesmaPessoa && (relMeta.nacionalidade || relMeta.profissaoId || relMeta.naturalidade)) {
    fontes.push({
      fonte: "relacionamento do Apolo",
      nacionalidade: relMeta.nacionalidade,
      profissao: relMeta.profissaoId ? nomeProf.get(String(relMeta.profissaoId)) : null,
      naturalidade: relMeta.naturalidade,
      livre: relMeta.profissaoOutro,
    });
  }

  const melhorNac = fontes.find((f) => !vazio(f.nacionalidade));
  const melhorPro = fontes.find((f) => !vazio(f.profissao));
  const naturalidade = fontes.find((f) => !vazio(f.naturalidade));

  if (melhorNac || melhorPro || naturalidade) {
    achou.push({ ...p, melhorNac, melhorPro, naturalidade, fontes });
  } else {
    semNada.push(p);
  }
}

console.log("=".repeat(78));
console.log("O QUE JÁ TEMOS EM CASA");
console.log("=".repeat(78));
console.log(`  com alguma fonte:  ${achou.length}`);
console.log(`  sem nada:          ${semNada.length}`);

for (const a of achou) {
  console.log(`\n  ${a.conjuge} (cônjuge de ${a.titular})`);
  if (a.melhorNac) console.log(`     nacionalidade "${a.melhorNac.nacionalidade}" — ${a.melhorNac.fonte}`);
  if (a.melhorPro) console.log(`     profissão     "${a.melhorPro.profissao}" — ${a.melhorPro.fonte}`);
  if (!a.melhorNac && a.naturalidade)
    console.log(`     naturalidade  "${a.naturalidade.naturalidade}" — dá para derivar a nacionalidade`);
}

if (semNada.length) {
  console.log(`\n${"=".repeat(78)}`);
  console.log("SEM NENHUMA FONTE — só perguntando ao cliente");
  console.log("=".repeat(78));
  for (const p of semNada) {
    console.log(`  ${String(p.conjuge).padEnd(34)} CPF ${p.conjuge_cpf ?? "—"} · cônjuge de ${p.titular}`);
  }
}

await c.end();
