// SEMEIA O CADASTRO DE EMPREENDIMENTOS DO PANTEON: PAI E FILHOS (migration 0123).
//
// Lucas (02/09/2026): *"a partir de hoje vamos cadastrar os empreendimentos dentro do panteon (...)
// ter o empreendimento pai, e os filhos (...) hoje eu não tenho esse agrupamento para o Vale do
// Ouro, está todo solto, tem que unificar"*.
//
// Foi uma IMPORTAÇÃO ÚNICA: leu o C2X uma vez (read-only, como sempre) para não digitar 36 nomes e
// cidades à mão, e gravou no Panteon. Depois disso o cadastro vive aqui e o C2X não é mais
// consultado para isso (*"não quero consultar c2x, quero importar"*).
//
// ⚠️ DESDE 24/09/2026 ELE SÓ INSERE O QUE FALTA. Lucas, depois de a Nívea renomear no C2X o 43 de
// RECANTO DO VALE/RDV para PORTAL DO IBITURUNA/PDI: *"Tivemos que mudar de nome"*; e *"pode"* para
// travar as portas por onde o C2X ainda mexe no Panteon. Até então este script fazia UPSERT por código
// e regravava `nome`, `c2x_enterprise_id`, `pai_id` e `vendendo` de toda linha herdada. Rodado depois
// de um renome no legado, ele traria o nome do C2X por cima do que o Panteon decidiu (a Aldeia, o 42,
// já diverge desde 12/09), e no 43 bateria no índice único do id e pararia no meio. A regra de quem
// insere e quem é deixado em paz mora em `semear-empreendimentos-plano.mjs`, testada sem banco.
//
// ⚠️ E EXIGE A MESMA TRAVA DAS OUTRAS CARGAS DO LEGADO, ENCERRADAS EM 21/09/2026. Era o único script
// de carga sem ela (os outros três: importar-fluxo-de-venda, carregar-unidades-do-c2x e
// importar-eventos-da-proposta). O ensaio continua livre.
//
// ⚠️ NÃO SOBRESCREVE NADA, e ainda assim não pendura filho em produto que não é da carga: com dono
// marcado (`operado_por`, D2 de 16/09/2026), nascido no Panteon (id >= 100000) ou criado pelo hub ou
// pelo portal.
//
// Uso (da RAIZ do monorepo):
//   node scripts/hercules/semear-empreendimentos.mjs            # ensaio: lê e mostra o que faltaria
//   node scripts/hercules/semear-empreendimentos.mjs --gravar --carga-do-legado-autorizada

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

import { agruparPaisEFilhos, planejarSemeadura } from "./semear-empreendimentos-plano.mjs";

// ── 0. A TRAVA, ANTES DE QUALQUER CONEXÃO ──────────────────────────────────────────────────────
//
// CARGA DO LEGADO ENCERRADA EM 21/09/2026. Lucas: *"nao vou mais fazer isso"*. É o fim do caminho
// aberto em 11/09 (*"depois disso fazemos todo operacional comercial dentro do panteon"*).
//
// POR QUE UMA TRAVA, E NÃO SÓ UM COMENTÁRIO. Comentário no topo não para quem copiou o comando de um
// chat antigo. Esta trava para, e para ANTES de ler o .env, abrir o C2X ou o Supabase: quem esqueceu
// a flag não chega nem perto do banco.
const GRAVAR = process.argv.includes("--gravar");
const CARGA_AUTORIZADA = process.argv.includes("--carga-do-legado-autorizada");
if (GRAVAR && !CARGA_AUTORIZADA) {
  for (const linha of [
    "",
    'CARGA DO LEGADO ENCERRADA (decisao do Lucas, 21/09/2026: "nao vou mais fazer isso").',
    "",
    "  O cadastro do empreendimento vive no Panteon. Semear de novo pode trazer o nome e a sigla",
    "  que o C2X tem hoje para dentro do cadastro (o 43 foi renomeado la em 24/09).",
    "",
    "  O ensaio continua liberado: rode sem --gravar, que ele so le e mostra o que faltaria.",
    "  Se a carga for mesmo necessaria, peca o ok ao Lucas e rode com:",
    "    --gravar --carga-do-legado-autorizada",
    "  Mesmo assim ela so INSERE o que falta: nada que ja existe no Panteon e reescrito.",
    "",
  ]) {
    console.error(linha);
  }
  process.exit(1);
}

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");
const { createClient } = requireDoRepo("@supabase/supabase-js");

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const WORKSPACE = "careli";

// ── 1. LER O C2X (uma vez) ─────────────────────────────────────────────────────
const c2x = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});
const [linhas] = await c2x.query(`
  select e.id, e.code, e.name, c.name as cidade, s.name as estado
  from enterprises e
  left join cities c on c.id = e.city_id
  left join states s on s.id = c.state_id
  order by e.id`);
await c2x.end();

// ── 2. AGRUPAR ─────────────────────────────────────────────────────────────────
const pais = agruparPaisEFilhos(linhas);
console.log(`C2X: ${pais.length} pais, ${pais.reduce((n, p) => n + p.filhos.length, 0)} filhos\n`);

// ── 3. LER O QUE O PANTEON JÁ TEM ──────────────────────────────────────────────
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const chave = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
if (!url || !chave) {
  console.error("Sem NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no apps/hub/.env.local.");
  process.exit(1);
}
const supabase = createClient(url, chave, { auth: { persistSession: false } });

// ⚠️ FALHA FECHADA NA LEITURA. Sem ler o cadastro inteiro não há como provar o que falta: para, sem
// gravar nada. Só as colunas da 0170 ausentes (`operado_por`, `criado_origem`) são toleradas, e aí
// sobra a régua do id do Panteon.
const COLUNAS_BASE = "id,codigo,nome,c2x_enterprise_id,pai_id,vendendo,ordem";
const COLUNAS_COM_0170 = `${COLUNAS_BASE},operado_por,criado_origem`;

// Paginado: o PostgREST corta em 1.000 linhas SEM ERRO, e o que some é o fim da lista.
async function lerCadastro(selecao) {
  const lidas = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase
      .from("hercules_empreendimentos")
      .select(selecao)
      .eq("workspace_id", WORKSPACE)
      .order("id", { ascending: true })
      .range(de, de + 999);
    if (error) return { error, linhas: [] };
    lidas.push(...(data ?? []));
    if ((data ?? []).length < 1000) return { error: null, linhas: lidas };
  }
}

let com0170 = true;
let leitura = await lerCadastro(COLUNAS_COM_0170);
const sem0170 = (e) => ["42703", "PGRST204"].includes(e?.code) || /operado_por|criado_origem/.test(e?.message ?? "");
if (leitura.error && sem0170(leitura.error)) {
  console.log("  (a migration 0170 não está aplicada aqui: confiro só o id do Panteon)");
  com0170 = false;
  leitura = await lerCadastro(COLUNAS_BASE);
}
if (leitura.error) {
  console.error(`Não deu para ler o cadastro do Panteon (${leitura.error.message}); nada foi gravado.`);
  process.exit(1);
}
const existentes = leitura.linhas;

// ── 4. O PLANO: SÓ O QUE FALTA ─────────────────────────────────────────────────
const plano = planejarSemeadura(pais, existentes);

const SIMBOLO = { conflito: "!", existe: "=", inserir: "+", pulado: "-" };
for (const p of plano) {
  console.log(`${SIMBOLO[p.acao]} ${p.codigo.padEnd(4)} ${p.nome}${p.motivo ? `  (${p.motivo})` : ""}`);
  for (const d of p.divergencias ?? []) console.log(`       difere do C2X, vale o Panteon: ${d}`);
  if (p.motivoDosFilhos) console.log(`       filhos não pendurados: ${p.motivoDosFilhos}`);
  for (const f of p.filhos) {
    console.log(`     └ ${SIMBOLO[f.acao]} ${f.codigo.padEnd(4)}${f.motivo ? `  (${f.motivo})` : ""}`);
    for (const d of f.divergencias ?? []) console.log(`         difere do C2X, vale o Panteon: ${d}`);
  }
}

const aInserir = plano.reduce(
  (n, p) => n + (p.acao === "inserir" ? 1 : 0) + p.filhos.filter((f) => f.acao === "inserir").length,
  0,
);
console.log(`\n${aInserir} linha(s) a inserir. Nenhuma linha existente é alterada.`);

// ── 5. GRAVAR: SÓ INSERT ───────────────────────────────────────────────────────
//
// ⚠️ INSERT, NUNCA UPSERT. Se alguém criou a mesma linha entre a leitura e a escrita, o índice único
// recusa e o script para: é o comportamento certo, porque a alternativa (upsert) reescreveria a
// linha de quem chegou primeiro. E `c2x_enterprise_id: null` do pai só do Panteon vai EXPLÍCITO: a
// coluna tem default da sequence (0170), e omitir daria ao LOX um id de produto nascido aqui.
async function inserir(linha) {
  const { data, error } = await supabase
    .from("hercules_empreendimentos")
    .insert({
      ...linha,
      atualizado_em: new Date().toISOString(),
      ...(com0170 ? { criado_origem: "semeador" } : {}),
      workspace_id: WORKSPACE,
    })
    .select("id")
    .single();
  // ⚠️ CHECAR `error` SEMPRE: o PostgREST falha calado em NOT NULL / índice único.
  if (error || !data?.id) throw new Error(`${linha.codigo}: ${error?.message ?? "sem id de volta"}`);
  return data.id;
}

// ⚠️ SEM `process.exit` NO ENSAIO: com o cliente do Supabase ainda com conexão aberta, o exit forçado
// derruba o Node no Windows ("Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"). O script só
// termina, e o processo sai quando as conexões fecham.
if (!GRAVAR) {
  console.log("Ensaio. Para gravar: --gravar --carga-do-legado-autorizada (com o ok do Lucas).");
} else {
  let inseridas = 0;
  for (const p of plano) {
    let paiId = p.acao === "existe" && !p.motivoDosFilhos ? p.existenteId : null;
    if (p.acao === "inserir") {
      paiId = await inserir(p.linha);
      inseridas += 1;
      console.log(`inserido ${p.codigo} ${p.nome}`);
    }
    if (!paiId) continue;
    for (const f of p.filhos) {
      if (f.acao !== "inserir") continue;
      await inserir({ ...f.linha, pai_id: paiId });
      inseridas += 1;
      console.log(`inserido ${f.codigo} (filho de ${p.codigo})`);
    }
  }
  console.log(`\n${inseridas} linha(s) inserida(s). Nada existente foi alterado.`);
}
