// GRAVA a nacionalidade dos cônjuges do Villa Paris no C2X.
//
// Autorizado pelo Lucas em 31/08/2026 ("pode", "pode fazer vc mesmo"). A nacionalidade dos 11 foi
// apurada NO DOCUMENTO de identidade de cada um — ver villa-paris-conjuges-nacionalidade.mjs, que
// é a fonte desta lista. Nada aqui é deduzido na hora.
//
// ⚠️ POR QUE ESTE SCRIPT É CAUTELOSO
//
// 1. A API do C2X NÃO TEM update de cadastro. Conferido por OPTIONS:
//      /api/v1/users/{id}  ->  Allow: OPTIONS, DELETE      (nada de PUT/PATCH)
//      /api/v1/users       ->  Allow: OPTIONS, GET, POST, PUT, HEAD
//    O `PUT /users/{documento}` do nosso OpenAPI é o que PEDIMOS ao time do Sulivam, não o que
//    existe. Sobra o PUT na coleção: não documentado e nunca usado pelo nosso código.
//
// 2. `spouse_attributes` SEM `id` faz o Rails CRIAR um segundo cônjuge em vez de atualizar. Num
//    contrato já gerado, cônjuge duplicado é pior que campo vazio. Por isso o `id` vai sempre, e
//    por isso o script CONTA os cônjuges antes e depois de cada gravação.
//
// 3. O payload é o MENOR possível: o CPF que identifica, e só o campo que muda. Mandar o objeto
//    inteiro apagaria o que o C2X sabe e o Panteon não.
//
// 4. ⚠️ "SUCESSO" DA API DO C2X MENTE — já aconteceu na baixa de pagamento. Nenhuma gravação é
//    dada por boa pela resposta HTTP: cada uma é conferida LENDO O BANCO depois.
//
// Uso (da raiz do repo):
//   node scripts/apolo/villa-paris-gravar-nacionalidade.mjs              # ENSAIO: não grava nada
//   node scripts/apolo/villa-paris-gravar-nacionalidade.mjs --um         # grava só o 1º (cancelado)
//   node scripts/apolo/villa-paris-gravar-nacionalidade.mjs --confirmar  # grava os 11
//
// A ordem é deliberada: o primeiro da lista é de uma proposta CANCELADA. Se o PUT se comportar
// mal, o estrago não cai num contrato vivo.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { NACIONALIDADE_APURADA } from "./villa-paris-conjuges-nacionalidade.mjs";

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

const BASE = env.C2X_WRITE_API_URL;
const TOKEN = env.C2X_WRITE_API_TOKEN; // ⚠️ nunca logar
const ENSAIO = !process.argv.includes("--confirmar") && !process.argv.includes("--um");
const SO_UM = process.argv.includes("--um");

const norm = (t) =>
  String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// Quem está pendente AGORA, com o id do cônjuge e o CPF do titular (a chave do PUT).
const [pendentes] = await c.query(
  `select distinct sp.id as spouse_id, sp.name as conjuge, sp.nacionality,
          u.id as titular_id, u.cpf as titular_cpf, u.name as titular,
          s.name as etapa, un.name as unidade
     from spouses sp
     join users u on u.id = sp.ownertable_id and sp.ownertable_type = 'User'
     join acquisition_requests ar on ar.client_id = u.id
     join enterprise_unities un on un.id = ar.enterprise_unity_id
     left join acquisition_request_stages s on s.id = ar.acquisition_request_stage_id
    where un.enterprise_id = 38
      and (sp.nacionality is null or sp.nacionality = '')`,
);

const porConjuge = new Map();
for (const p of pendentes) {
  const k = norm(p.conjuge);
  if (!porConjuge.has(k)) porConjuge.set(k, { ...p, unidades: [p.unidade] });
  else {
    const a = porConjuge.get(k);
    if (!a.unidades.includes(p.unidade)) a.unidades.push(p.unidade);
    if (p.etapa === "Contrato gerado") a.etapa = p.etapa;
  }
}

// Casa o apurado com o pendente, e coloca os CANCELADOS na frente.
const fila = NACIONALIDADE_APURADA.map((a) => ({ apurado: a, alvo: porConjuge.get(norm(a.conjuge)) }))
  .filter((x) => x.alvo)
  .sort((a, b) => {
    const peso = (x) => (x.alvo.etapa === "Contrato gerado" ? 1 : 0);
    return peso(a) - peso(b);
  });

console.log("=".repeat(76));
console.log(ENSAIO ? "ENSAIO — nada será gravado" : SO_UM ? "GRAVANDO O PRIMEIRO (cancelado)" : "GRAVANDO OS 11");
console.log("=".repeat(76));
console.log(`Pendentes no C2X agora: ${porConjuge.size} · na fila: ${fila.length}\n`);

/** Conta os cônjuges do titular. É assim que se detecta duplicata criada pelo PUT. */
async function retrato(titularId) {
  const [linhas] = await c.query(
    `select id, name, nacionality, profession_id from spouses
      where ownertable_type = 'User' and ownertable_id = ? order by id`,
    [titularId],
  );
  return linhas;
}

let gravados = 0;
let falhas = 0;

for (const { apurado, alvo } of fila) {
  const rotulo = `${alvo.conjuge} (${alvo.unidades.join(", ")}, ${alvo.etapa})`;
  if (ENSAIO) {
    console.log(`  [ensaio] spouse ${alvo.spouse_id} · ${rotulo}`);
    console.log(`           nacionality: "" -> "${apurado.nacionalidade}"  (${apurado.documento})`);
    continue;
  }

  const antes = await retrato(alvo.titular_id);
  const corpo = {
    cpf: String(alvo.titular_cpf ?? "").replace(/\D/g, ""),
    spouse_attributes: { id: alvo.spouse_id, nacionality: apurado.nacionalidade },
  };

  let http = 0;
  let resposta = "";
  try {
    const r = await fetch(`${BASE}/api/v1/users`, {
      body: JSON.stringify(corpo),
      // ⚠️ SEM "Bearer" — o C2X recusa o formato padrão.
      headers: { Authorization: TOKEN, "Content-Type": "application/json" },
      method: "PUT",
    });
    http = r.status;
    resposta = (await r.text()).slice(0, 200).replace(/\s+/g, " ");
  } catch (e) {
    resposta = e instanceof Error ? e.message : String(e);
  }

  // A VERDADE ESTÁ NO BANCO, não na resposta.
  const depois = await retrato(alvo.titular_id);
  const linha = depois.find((x) => x.id === alvo.spouse_id);
  const gravou = String(linha?.nacionality ?? "").trim() !== "";
  const duplicou = depois.length > antes.length;

  console.log(`  spouse ${alvo.spouse_id} · ${rotulo}`);
  console.log(`     HTTP ${http} · banco: nacionality = ${JSON.stringify(linha?.nacionality ?? null)}`);

  if (duplicou) {
    console.log(`     🔴 PAROU AQUI: o PUT CRIOU cônjuge (${antes.length} -> ${depois.length}).`);
    console.log(`        Duplicata em contrato é pior que campo vazio. Nada mais será gravado.`);
    console.log(`        Resposta: ${resposta}`);
    falhas += 1;
    break;
  }
  if (!gravou) {
    console.log(`     ✗ não gravou. Resposta: ${resposta}`);
    falhas += 1;
    // Se o primeiro não passa, os outros dez não vão passar: para e mostra o motivo.
    if (gravados === 0) {
      console.log(`\n  Parando: o endpoint não aceitou a atualização. Sem tentativa em série.`);
      break;
    }
    continue;
  }

  console.log(`     ✓ gravado`);
  gravados += 1;
  if (SO_UM) {
    console.log(`\n  --um: parando após o primeiro, como combinado. Confira e rode --confirmar.`);
    break;
  }
}

if (!ENSAIO) {
  console.log(`\n${"=".repeat(76)}`);
  console.log(`gravados: ${gravados} · falhas: ${falhas}`);
  const [restam] = await c.query(
    `select count(distinct sp.id) as n
       from spouses sp
       join users u on u.id = sp.ownertable_id and sp.ownertable_type='User'
       join acquisition_requests ar on ar.client_id = u.id
       join enterprise_unities un on un.id = ar.enterprise_unity_id
      where un.enterprise_id = 38 and (sp.nacionality is null or sp.nacionality = '')`,
  );
  console.log(`ainda sem nacionalidade no C2X: ${Object.values(restam[0])[0]}`);
}

await c.end();
