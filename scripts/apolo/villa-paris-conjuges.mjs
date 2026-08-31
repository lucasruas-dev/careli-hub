// VILLA PARIS: os CÔNJUGES sobem sem profissão e sem nacionalidade — e é isso que trava o contrato.
//
// O corte anterior isolou o problema: os 35 COMPRADORES estão completos no C2X (35/35, batendo com
// o Apolo). Quem está vazio é o CÔNJUGE, que também assina a escritura: 15 dos 17 sem os dois
// campos, 6 deles em contratos já gerados.
//
// A causa está no código, não nos dados:
//   • lib/apolo/c2x-write-server.ts:576 monta o cônjuge com `profession: null` — FIXO. O caminho
//     existe até o fim (c2x-write.ts:185 já faz `profession_id: matchProfissaoId(...)`), só a
//     origem está amarrada em nulo.
//   • nacionalidade do cônjuge não existe em `ApoloC2xSpouse` nem em `spouseAttributes`, embora a
//     coluna `spouses.nacionality` exista no C2X.
//
// Este script responde a pergunta que decide o conserto: para esses cônjuges, o Apolo TEM o dado
// (então é reenviar) ou não tem (então é buscar com o cliente)?
//
// Uso (da raiz do repo):
//   node scripts/apolo/villa-paris-conjuges.mjs
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
const semAcento = (t) =>
  String(t ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// 1. Os cônjuges do Villa Paris, do lado do C2X
const [conjuges] = await c.query(
  `select distinct sp.id, sp.name as conjuge, sp.cpf, sp.nacionality, sp.profession_id,
          p.name as profissao, u.id as titular_id, u.name as titular,
          s.name as etapa, un.name as unidade
     from spouses sp
     join users u on u.id = sp.ownertable_id and sp.ownertable_type = 'User'
     join acquisition_requests ar on ar.client_id = u.id
     join enterprise_unities un on un.id = ar.enterprise_unity_id
     left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
     left join professions p on p.id = sp.profession_id
    where un.enterprise_id = 38
    order by u.name`,
);

const [profs] = await c.query(`select id, name from professions`);
const nomeDaProfissao = new Map(profs.map((p) => [String(p.id), p.name]));

// 2. Os relacionamentos 'conjuge' do Apolo, onde a ficha completa mora desde 23/08
const titularCpfs = new Set();
const [titulares] = await c.query(
  `select id, cpf from users where id in (?)`,
  [[...new Set(conjuges.map((x) => x.titular_id))]],
);
for (const t of titulares) if (t.cpf) titularCpfs.add(soDigitos(t.cpf));

const entidades = [];
for (const cpf of titularCpfs) {
  const achados = await ler(
    "apolo_entities",
    `document_masked=ilike.*${cpf.slice(0, 3)}*&entity_kind=eq.pf&select=id,display_name,document_masked&limit=200`,
  );
  entidades.push(...achados.filter((e) => soDigitos(e.document_masked) === cpf));
}

const relPorEntidade = new Map();
const idsEnt = entidades.map((e) => e.id);
for (let i = 0; i < idsEnt.length; i += 100) {
  const lote = idsEnt.slice(i, i + 100);
  if (!lote.length) continue;
  const linhas = await ler(
    "apolo_relationships",
    `entity_id=in.(${lote.join(",")})&relationship_type=eq.conjuge&select=entity_id,label,metadata&limit=1000`,
  );
  for (const l of linhas) relPorEntidade.set(l.entity_id, l);
}
const entPorCpf = new Map(entidades.map((e) => [soDigitos(e.document_masked), e]));
const cpfPorTitularId = new Map(titulares.map((t) => [t.id, soDigitos(t.cpf)]));

// 3. O confronto
const vazio = (v) => !String(v ?? "").trim();
const semProfissao = (f) => !f.profession_id || Number(f.profession_id) === 25;

const daParaReenviar = [];
const precisaPerguntar = [];
const jaOk = [];

const vistos = new Set();
for (const cj of conjuges) {
  const chave = `${cj.id}`;
  if (vistos.has(chave)) continue;
  vistos.add(chave);

  const faltaNac = vazio(cj.nacionality);
  const faltaPro = semProfissao(cj);
  if (!faltaNac && !faltaPro) {
    jaOk.push(cj);
    continue;
  }

  const cpfTitular = cpfPorTitularId.get(cj.titular_id);
  const ent = cpfTitular ? entPorCpf.get(cpfTitular) : null;
  const rel = ent ? relPorEntidade.get(ent.id) : null;
  const meta = rel?.metadata ?? {};

  // Confere que o relacionamento é da MESMA pessoa antes de aproveitar o dado — nome do C2X e do
  // Apolo podem divergir, e casar errado colocaria a profissão de outra pessoa no contrato.
  const mesmoCpf = meta.cpf && soDigitos(meta.cpf) === soDigitos(cj.cpf);
  const mesmoNome = rel?.label && semAcento(rel.label) === semAcento(cj.conjuge);
  const confiavel = Boolean(mesmoCpf || mesmoNome);

  const nacApolo = confiavel ? (meta.nacionalidade ?? "").trim() : "";
  const profApolo = confiavel && meta.profissaoId ? nomeDaProfissao.get(String(meta.profissaoId)) : null;
  const profLivre = confiavel ? (meta.profissaoOutro ?? "").trim() : "";

  const registro = {
    ...cj,
    faltaNac,
    faltaPro,
    nacApolo,
    profApolo,
    profLivre,
    casouPor: mesmoCpf ? "CPF" : mesmoNome ? "nome" : null,
  };

  const resolveNac = !faltaNac || Boolean(nacApolo);
  const resolvePro = !faltaPro || Boolean(profApolo);
  if (resolveNac && resolvePro) daParaReenviar.push(registro);
  else precisaPerguntar.push(registro);
}

console.log("=".repeat(78));
console.log("VILLA PARIS — cônjuges: dá para reenviar, ou precisa perguntar ao cliente?");
console.log("=".repeat(78));
console.log(`Cônjuges cadastrados no C2X:  ${vistos.size}`);
console.log(`  já completos:               ${jaOk.length}`);
console.log(`  o Apolo TEM o dado:         ${daParaReenviar.length}  <- só reenviar`);
console.log(`  sem fonte em lugar nenhum:  ${precisaPerguntar.length}  <- perguntar ao cliente`);

if (daParaReenviar.length) {
  console.log(`\n${"=".repeat(78)}`);
  console.log("DÁ PARA REENVIAR (o dado está no Apolo)");
  console.log("=".repeat(78));
  for (const r of daParaReenviar) {
    console.log(`  ${(r.unidade || "").padEnd(9)} ${String(r.conjuge).slice(0, 30).padEnd(30)} casou por ${r.casouPor}`);
    if (r.faltaNac) console.log(`      nacionalidade -> "${r.nacApolo}"`);
    if (r.faltaPro) console.log(`      profissão     -> "${r.profApolo}"`);
  }
}

if (precisaPerguntar.length) {
  console.log(`\n${"=".repeat(78)}`);
  console.log("SEM FONTE — precisa buscar com o cliente");
  console.log("=".repeat(78));
  for (const r of precisaPerguntar) {
    const falta = [r.faltaNac && "nacionalidade", r.faltaPro && "profissão"].filter(Boolean).join(" + ");
    const achou = r.casouPor ? `ficha do Apolo achada por ${r.casouPor}, mas sem o campo` : "sem ficha no Apolo";
    console.log(
      `  ${(r.unidade || "").padEnd(9)} ${String(r.conjuge).slice(0, 30).padEnd(30)} ${(r.etapa || "").padEnd(18)} falta ${falta}`,
    );
    console.log(`      ${achou}${r.profLivre ? ` · profissão digitada: "${r.profLivre}"` : ""}`);
  }
}

await c.end();
