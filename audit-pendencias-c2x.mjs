// LENTE: os que subiram com PENDÊNCIA — campos obrigatórios de contrato vazios no C2X.
// Universo: entidades do Apolo com c2xSynced=true ∪ criadas >= 01/08. Como o sync C2X→Apolo criou
// ESPELHOS (mesmo CPF, outra entidade, sem ficha), o agrupamento é por PESSOA (CPF): a ficha do
// Apolo usada na comparação é a união das fontes de TODAS as entidades daquele CPF
// (esteira.ficha > metadata.cadastro > apolo_addresses). Um caso por user do C2X.
// LEITURA APENAS nos dois bancos.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const ler = async (tabela, query) => {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/${tabela}?${query}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!resp.ok) throw new Error(`${tabela}: ${resp.status} ${await resp.text()}`);
  return resp.json();
};

const digitos = (v) => String(v ?? "").replace(/\D/g, "");
const texto = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());
const PLACEHOLDERS = new Set(["", "-", ".", "n/a", "na", "nao informado", "não informado", "nao consta", "não consta", "x", "xx", "xxx", "0", "null", "undefined", "sem informacao", "sem informação"]);
const vazio = (v) => PLACEHOLDERS.has(texto(v).toLowerCase());

// ── 1. Universo ──
const selecao = "select=id,display_name,entity_kind,document_masked,created_at,cadastro:metadata->cadastro,c2xUserId:metadata->>c2xUserId,c2xSynced:metadata->>c2xSynced";
const sincadas = await ler("apolo_entities", `${selecao}&metadata->>c2xSynced=eq.true&limit=2000`);
const criadas0108 = await ler("apolo_entities", `${selecao}&created_at=gte.2026-08-01&limit=2000`);
const porId = new Map();
for (const e of [...sincadas, ...criadas0108]) porId.set(e.id, e);
const universo = [...porId.values()];

const pf = universo.filter((e) => e.entity_kind === "pf" && digitos(e.document_masked).length === 11);
const fora = universo.filter((e) => !pf.includes(e));
console.log(`Universo: ${universo.length} | PF com CPF: ${pf.length} | fora (PJ/sem CPF): ${fora.length}`);

// grupos por pessoa (CPF)
const grupos = new Map();
for (const e of pf) {
  const cpf = digitos(e.document_masked);
  if (!grupos.has(cpf)) grupos.set(cpf, []);
  grupos.get(cpf).push(e);
}
// dentro do grupo, a entidade SINCADA (a que tem a ficha do lançamento) vem primeiro
for (const g of grupos.values()) g.sort((a, b) => (b.c2xSynced === "true" ? 1 : 0) - (a.c2xSynced === "true" ? 1 : 0));
console.log(`Pessoas (CPFs únicos): ${grupos.size}`);

// ── 2. Fichas da esteira + endereços do Apolo (lotes de 100) ──
const ids = pf.map((e) => e.id);
const fichaPorEntidade = new Map();
const endApoloPorEntidade = new Map();
for (let i = 0; i < ids.length; i += 100) {
  const bloco = ids.slice(i, i + 100).join(",");
  for (const f of await ler("apolo_esteira", `select=entity_id,etapa,ficha&entity_id=in.(${bloco})`)) {
    fichaPorEntidade.set(f.entity_id, f);
  }
  for (const a of await ler("apolo_addresses", `select=entity_id,street,postal_code,city,state,number,district&entity_id=in.(${bloco})`)) {
    if (!endApoloPorEntidade.has(a.entity_id)) endApoloPorEntidade.set(a.entity_id, a);
  }
}
console.log(`Fichas esteira: ${fichaPorEntidade.size} | apolo_addresses: ${endApoloPorEntidade.size}`);

// ── 3. C2X: users por CPF (e por c2xUserId, para CPF que não bater) ──
const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});
const limpo = (col) => `REPLACE(REPLACE(REPLACE(${col},'.',''),'-',''),'/','')`;
const CAMPOS_USER = `id, name, ${limpo("cpf")} cpf_limpo, birthday, naturalness, mother_name, rg, identification_number, profession_id, civil_state_id`;

const userPorCpf = new Map();
const userPorId = new Map();
const cpfs = [...grupos.keys()];
for (let i = 0; i < cpfs.length; i += 200) {
  const bloco = cpfs.slice(i, i + 200);
  const [rows] = await c.query(
    `SELECT ${CAMPOS_USER} FROM users WHERE ${limpo("cpf")} IN (${bloco.map(() => "?").join(",")})`,
    bloco,
  );
  for (const r of rows) { userPorCpf.set(r.cpf_limpo, r); userPorId.set(r.id, r); }
}
const idsC2x = [...new Set(pf.map((e) => Number(e.c2xUserId)).filter((n) => Number.isFinite(n) && n > 0 && !userPorId.has(n)))];
for (let i = 0; i < idsC2x.length; i += 200) {
  const bloco = idsC2x.slice(i, i + 200);
  const [rows] = await c.query(
    `SELECT ${CAMPOS_USER} FROM users WHERE id IN (${bloco.map(() => "?").join(",")})`,
    bloco,
  );
  for (const r of rows) userPorId.set(r.id, r);
}

const todosUserIds = [...userPorId.keys()];
const temEnderecoC2x = new Set();
for (let i = 0; i < todosUserIds.length; i += 300) {
  const bloco = todosUserIds.slice(i, i + 300);
  const [rows] = await c.query(
    `SELECT ownertable_id, address, zipcode FROM addresses
      WHERE ownertable_type='User' AND ownertable_id IN (${bloco.map(() => "?").join(",")})`,
    bloco,
  );
  for (const r of rows) {
    if (!vazio(r.address) || !vazio(r.zipcode)) temEnderecoC2x.add(r.ownertable_id);
  }
}
await c.end();

// ── 4. Ficha completa da PESSOA: união das fontes de todas as entidades do grupo ──
const fichaDoGrupo = (entidades) => {
  const fontes = [];
  for (const e of entidades) {
    const fic = fichaPorEntidade.get(e.id)?.ficha;
    if (fic && Object.keys(fic).length) fontes.push(fic); // ficha do operador ganha
  }
  for (const e of entidades) if (e.cadastro) fontes.push(e.cadastro);
  const pega = (campo) => {
    for (const f of fontes) { const v = texto(f[campo]); if (!vazio(v)) return v; }
    return "";
  };
  let endA = null;
  for (const e of entidades) { endA = endApoloPorEntidade.get(e.id); if (endA) break; }
  const logradouro = pega("logradouro") || texto(endA?.street);
  const cep = pega("cep") || texto(endA?.postal_code);
  const cidade = pega("cidade") || texto(endA?.city);
  return {
    dataNascimento: pega("dataNascimento"),
    endereco: logradouro || cep
      ? [logradouro, pega("numero") || texto(endA?.number), cidade, pega("uf") || texto(endA?.state), cep && `CEP ${cep}`].filter(Boolean).join(", ")
      : "",
    estadoCivilId: pega("estadoCivilId"),
    naturalidade: pega("naturalidade"),
    nomeMae: pega("nomeMae"),
    profissaoId: pega("profissaoId"),
    rg: pega("rg"),
  };
};

const ESTADO_CIVIL = { 1: "Solteiro (a)", 2: "Casado (a)", 3: "Divorciado (a)", 4: "Separado (a) judicialmente", 5: "Viúvo (a)", 6: "União Estável" };

// ── 5. Varredura: um caso por pessoa ──
const casos = [];
let completos = 0;
const semMatch = [];
const contagemCampo = {};

for (const [cpf, entidades] of grupos) {
  const comUserId = entidades.find((e) => e.c2xUserId);
  const u = userPorCpf.get(cpf) ?? (comUserId ? userPorId.get(Number(comUserId.c2xUserId)) : undefined);
  if (!u) { semMatch.push({ cpf, nome: entidades[0].display_name }); continue; }

  const apolo = fichaDoGrupo(entidades);
  const faltas = [];
  const checa = (rotulo, valorC2x, valorFicha) => {
    if (!vazio(valorC2x)) return;
    faltas.push({ campo: rotulo, recuperavel: !vazio(valorFicha), valorFicha: texto(valorFicha) });
  };

  checa("naturalidade", u.naturalness, apolo.naturalidade);
  checa("nome da mãe", u.mother_name, apolo.nomeMae);
  if (vazio(u.rg) && vazio(u.identification_number)) {
    faltas.push({ campo: "RG", recuperavel: !vazio(apolo.rg), valorFicha: texto(apolo.rg) });
  }
  if (u.profession_id == null || Number(u.profession_id) === 0) {
    faltas.push({ campo: "profissão", recuperavel: !vazio(apolo.profissaoId), valorFicha: apolo.profissaoId ? `id ${apolo.profissaoId}` : "" });
  }
  if (u.civil_state_id == null || Number(u.civil_state_id) === 0) {
    const rotulo = ESTADO_CIVIL[Number(apolo.estadoCivilId)] ?? (apolo.estadoCivilId ? `id ${apolo.estadoCivilId}` : "");
    faltas.push({ campo: "estado civil", recuperavel: !vazio(apolo.estadoCivilId), valorFicha: rotulo });
  }
  if (u.birthday == null) {
    faltas.push({ campo: "nascimento", recuperavel: !vazio(apolo.dataNascimento), valorFicha: apolo.dataNascimento });
  }
  if (!temEnderecoC2x.has(u.id)) {
    faltas.push({ campo: "endereço", recuperavel: !vazio(apolo.endereco), valorFicha: apolo.endereco });
  }

  if (faltas.length === 0) { completos += 1; continue; }
  for (const f of faltas) contagemCampo[f.campo] = (contagemCampo[f.campo] ?? 0) + 1;

  const recuperaveis = faltas.filter((f) => f.recuperavel);
  const evid = faltas
    .map((f) => (f.recuperavel ? `${f.campo}: C2X vazio × ficha "${f.valorFicha}"` : `${f.campo}: vazio no C2X e na ficha do Apolo`))
    .join("; ");
  casos.push({
    cpf,
    evidencia: evid,
    nFaltas: faltas.length,
    nRecuperaveis: recuperaveis.length,
    nome: u.name || entidades[0].display_name || "(sem nome)",
    prioridade: recuperaveis.length > 0 ? "alta" : "media",
    problema: recuperaveis.length
      ? `Subiu pro C2X sem ${faltas.map((f) => f.campo).join(", ")}; a ficha do Apolo tem ${recuperaveis.length === faltas.length ? "todos" : `${recuperaveis.length} de ${faltas.length}`}`
      : `Subiu pro C2X sem ${faltas.map((f) => f.campo).join(", ")}; a ficha do Apolo também não tem`,
    userId: u.id,
  });
}

casos.sort((a, b) => b.nFaltas - a.nFaltas || b.nRecuperaveis - a.nRecuperaveis);

console.log(`\n${"=".repeat(60)}`);
console.log(`Pessoas varridas ............ ${grupos.size}`);
console.log(`Sem match no C2X ............ ${semMatch.length}`);
console.log(`TUDO preenchido (ok) ........ ${completos}`);
console.log(`COM PENDÊNCIA ............... ${casos.length}`);
console.log(`  alta (ficha tem o dado) ... ${casos.filter((x) => x.prioridade === "alta").length}`);
console.log(`  media (falta nos dois) .... ${casos.filter((x) => x.prioridade === "media").length}`);
console.log(`Por campo: ${JSON.stringify(contagemCampo)}`);
console.log(`Sem match: ${JSON.stringify(semMatch)}`);
console.log("=".repeat(60));

fs.writeFileSync(path.resolve(process.cwd(), "audit-pendencias-resultado.json"), JSON.stringify({
  casos, completos, contagemCampo, fora: fora.length, pessoas: grupos.size, semMatch,
}, null, 1));
console.log("Resultado: audit-pendencias-resultado.json");
