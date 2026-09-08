// BACKFILL do endereço que o sync nunca trouxe.
//
//   node scripts/apolo/backfill-endereco-c2x.mjs            # ensaio (não grava)
//   node scripts/apolo/backfill-endereco-c2x.mjs --gravar
//
// Lucas, 08/09/2026, olhando a tabela das imobiliárias credenciadas com a coluna de endereço
// vazia: *"uai, porque está sem endereço? tudo tem que subir com endereço"*.
//
// ⚠️ O LEGADO SEMPRE TEVE O ENDEREÇO. `buildAddressRows` (lib/apolo/server.ts) gravava
// `street: "Endereco cadastral"` e só cidade/UF, porque a consulta do sync lia apenas `cities` e
// `states` — nunca as colunas `address`, `number`, `district`, `complement` e `zipcode` da tabela
// `addresses` do C2X. Medido em 08/09/2026: das 426 imobiliárias, **424 têm rua, número, bairro E
// CEP** lá. A origem já foi consertada; este script é para as linhas que já estão gravadas.
//
// ⚠️ O SYNC NÃO CONSERTA SOZINHO, e isso é de propósito: `apolo_addresses` sobe com
// `ignorarDuplicados: true` porque o operador edita a MESMA linha (a de id determinístico) pela
// tela de cadastro. Deixar o sync atualizá-la devolveria o endereço editado à mão para o do
// legado. Por isso o conserto das linhas antigas é um passo separado, com uma regra estreita.
//
// ⚠️ E A REGRA É ESTREITA DE PROPÓSITO: só se altera a linha cujo `street` é EXATAMENTE o rótulo
// "Endereco cadastral". Endereço digitado por gente nunca é tocado. Nada é apagado: os campos que
// o C2X não tiver ficam como estão.
//
// ⚠️ O LEGADO É READ-ONLY. Aqui só se lê do MySQL; a escrita é toda no Supabase.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const RAIZ = path.resolve(process.cwd());
const req = createRequire(path.resolve(RAIZ, "apps/hub/package.json"));
const mysql = req("mysql2/promise");
const { createClient } = req("@supabase/supabase-js");

const gravar = process.argv.includes("--gravar");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(RAIZ, "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      return [l.slice(0, i).trim(), v];
    }),
);

const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const conn = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
  ...(String(env.GUARDIAN_DB_SSL).toLowerCase() === "true"
    ? { ssl: { rejectUnauthorized: false } }
    : {}),
});

const texto = (v) => {
  const t = (v ?? "").toString().trim();
  return t || null;
};

// ⚠️ O CEP VEM EM DUAS GRAFIAS DO LEGADO — "32.639-514" e "35655000" convivem na mesma coluna.
// O padrão desta tabela são os oito dígitos crus (medido: as grafias mais frequentes de
// `apolo_addresses.postal_code` são todas sem pontuação), e quem imprime formata. Gravar as duas
// faria o mesmo campo sair de um jeito num contrato e de outro no seguinte.
const cep = (v) => {
  const digitos = (v ?? "").toString().replace(/\D/g, "");
  return digitos.length === 8 ? digitos : texto(v);
};

// ── 1. O QUE O C2X TEM ──────────────────────────────────────────────────────
// A MESMA linha que a consulta do sync escolhe: a mais recente por updated_at, desempatada pelo id.
const [linhasC2x] = await conn.query(`
  select u.id as user_id,
         nullif(trim(a.address), '')    as street,
         nullif(trim(a.number), '')     as number,
         nullif(trim(a.complement), '') as complement,
         nullif(trim(a.district), '')   as district,
         nullif(trim(a.zipcode), '')    as zipcode
    from users u
    join addresses a on a.id = (
      select a2.id from addresses a2
       where a2.ownertable_type = 'User' and a2.ownertable_id = u.id
       order by a2.updated_at desc, a2.id desc
       limit 1
    )
   where nullif(trim(a.address), '') is not null
`);

const porUserId = new Map(linhasC2x.map((l) => [String(l.user_id), l]));
console.log(`C2X: ${porUserId.size} usuários com rua preenchida.`);

// ── 2. QUEM É QUEM NO PANTEON ───────────────────────────────────────────────
// ⚠️ PAGINADO. O PostgREST corta em 1.000 linhas SEM ERRO, e são 4.761 vínculos: sem paginar, o
// script diria "nada a fazer" para quatro em cada cinco cadastros.
const entidadePorUserId = new Map();
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb
    .from("apolo_source_links")
    .select("entity_id, source_id")
    .eq("source_system", "c2x")
    .eq("source_table", "users")
    .order("source_id")
    .range(de, de + 999);
  if (error) throw new Error(`apolo_source_links: ${error.message}`);
  for (const l of data ?? []) entidadePorUserId.set(String(l.source_id), l.entity_id);
  if (!data || data.length < 1000) break;
}
console.log(`Panteon: ${entidadePorUserId.size} entidades ligadas a users do C2X.`);

// ── 3. AS LINHAS COM O RÓTULO ───────────────────────────────────────────────
const comRotulo = [];
for (let de = 0; ; de += 1000) {
  const { data, error } = await sb
    .from("apolo_addresses")
    .select("id, entity_id, city, state, street, number, district, postal_code")
    .eq("street", "Endereco cadastral")
    .order("id")
    .range(de, de + 999);
  if (error) throw new Error(`apolo_addresses: ${error.message}`);
  comRotulo.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}
console.log(`Panteon: ${comRotulo.length} endereços com o rótulo "Endereco cadastral".`);

// ── 4. O CRUZAMENTO ─────────────────────────────────────────────────────────
const porEntidade = new Map();
for (const [userId, entityId] of entidadePorUserId) {
  const doC2x = porUserId.get(userId);
  if (doC2x) porEntidade.set(entityId, doC2x);
}

const aGravar = [];
let semCorrespondencia = 0;
for (const linha of comRotulo) {
  const doC2x = porEntidade.get(linha.entity_id);
  if (!doC2x) {
    semCorrespondencia += 1;
    continue;
  }
  aGravar.push({
    id: linha.id,
    // Nada é apagado: o que o C2X não tem fica como está.
    ...(texto(doC2x.complement) ? { complement: texto(doC2x.complement) } : {}),
    ...(texto(doC2x.district) ? { district: texto(doC2x.district) } : {}),
    ...(texto(doC2x.number) ? { number: texto(doC2x.number) } : {}),
    ...(cep(doC2x.zipcode) ? { postal_code: cep(doC2x.zipcode) } : {}),
    street: texto(doC2x.street),
    updated_at: new Date().toISOString(),
  });
}

console.log(
  `\nA corrigir: ${aGravar.length}` +
    `\nSem endereço no C2X (ficam com o rótulo): ${semCorrespondencia}`,
);

console.log("\nAmostra do que sairia:");
for (const linha of aGravar.slice(0, 5)) {
  const partes = [linha.street, linha.number, linha.district, linha.postal_code].filter(Boolean);
  console.log("  " + partes.join(", "));
}

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode de novo com --gravar.");
  await conn.end();
  process.exit(0);
}

// ── 5. A GRAVAÇÃO ───────────────────────────────────────────────────────────
// ⚠️ UM UPDATE POR LINHA, EM LOTES. Upsert aqui exigiria mandar a linha inteira e devolveria a
// NULO tudo que este script não conhece (label, is_primary, status, metadata, country).
// ⚠️ QUATRO MIL E SEISCENTAS CHAMADAS DERRUBAM A CONEXÃO EM ALGUM PONTO, e derrubaram: a primeira
// execução morreu em 250/4.634 com `fetch failed`, que é falha de rede, não do dado. Sem repetição
// o script pararia no meio e — como ele é idempotente, tocando só a linha que ainda tem o rótulo —
// alguém teria de rodar de novo sem saber quantas faltavam.
async function comRepeticao(tarefa, quem) {
  let ultimoErro = null;
  for (let tentativa = 1; tentativa <= 4; tentativa += 1) {
    try {
      const { error } = await tarefa();
      if (!error) return;
      ultimoErro = error.message;
    } catch (e) {
      ultimoErro = e instanceof Error ? e.message : String(e);
    }
    await new Promise((ok) => setTimeout(ok, 400 * tentativa));
  }
  throw new Error(`update ${quem}: ${ultimoErro}`);
}

let feitos = 0;
for (const linha of aGravar) {
  const { id, ...campos } = linha;
  await comRepeticao(() => sb.from("apolo_addresses").update(campos).eq("id", id), id);
  feitos += 1;
  if (feitos % 250 === 0) console.log(`  ${feitos}/${aGravar.length}`);
}

console.log(`\nPronto: ${feitos} endereços corrigidos.`);
await conn.end();
