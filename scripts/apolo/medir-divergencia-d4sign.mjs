// MEDIÇÃO read-only: quanto o painel que lê o C2X vai discordar da tela que lê a D4Sign.
//
// Por que existe: em 18/08/2026 a tela Contratos (Apolo e portal) passou a ler a D4Sign, mas TRÊS
// leitores continuaram no C2X puro — /api/apolo/painel-assinatura, /api/publico/bi/assinaturas e
// /publico/painel (o painel do coordenador). Se a divergência for grande, o dono vê dois números
// diferentes para a mesma coisa e é a tela NOVA que perde a confiança. Este script mede o tamanho
// exato da diferença, ASSINATURA POR ASSINATURA, e cronometra a carga.
//
// ⚠️ READ-ONLY: só GET no D4Sign e SELECT no C2X.
// ⚠️ CREDENCIAL: sai de apps/hub/.env.local e NUNCA é impressa.
// ⚠️ PRIVACIDADE: nome, CPF, IP e geolocalização não são impressos. O e-mail é usado só como
//    chave de casamento em memória e não vai para a saída.
//
//   node scripts/apolo/medir-divergencia-d4sign.mjs
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

const TOKEN = env.D4SIGN_TOKEN_API;
const CRYPT = env.D4SIGN_CRYPT_KEY;
if (!TOKEN || !CRYPT) {
  console.error("sem credencial D4Sign no .env.local");
  process.exit(1);
}

const BASE = "https://secure.d4sign.com.br/api/v1";
const url = (rota) =>
  BASE + rota + (rota.includes("?") ? "&" : "?") + "tokenAPI=" + TOKEN + "&cryptKey=" + CRYPT;

async function pegar(rota) {
  const t = Date.now();
  try {
    const r = await fetch(url(rota), { signal: AbortSignal.timeout(20000) });
    const corpo = r.ok ? await r.json() : null;
    return { corpo, ms: Date.now() - t, ok: r.ok };
  } catch {
    return { corpo: null, ms: Date.now() - t, ok: false };
  }
}

async function emParalelo(itens, n, fn) {
  const saida = new Array(itens.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < itens.length) {
        const meu = i;
        i += 1;
        saida[meu] = await fn(itens[meu]);
      }
    }),
  );
  return saida;
}

// ── 1. O recorte da tela: Vale do Ouro (VOL 36 + VOC 37), a MESMA query do painel ──
const conexao = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const CONSULTA = [
  "select cs.id envio, cs.uuidDoc uuid, cs.contract_signature_status_id st,",
  "       ss.signed assinado, usr.email email, e.name emp",
  "  from contract_signatures cs",
  "  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id",
  "  join acquisition_requests ar on ar.id = arc.acquisition_request_id",
  "  join enterprise_unities u on u.id = ar.enterprise_unity_id",
  "  join enterprises e on e.id = u.enterprise_id",
  "  join contract_signature_signers ss on ss.contract_signature_id = cs.id",
  "  left join contract_signers csg on csg.id = ss.contract_signer_id",
  "  left join signers sg on sg.id = csg.signer_id",
  "  left join users usr on usr.id = sg.user_id",
  " where u.enterprise_id in (36, 37) and cs.contract_signature_status_id <> 6",
].join("\n");

const [linhas] = await conexao.query(CONSULTA);
await conexao.end();

const porEnvio = new Map();
for (const l of linhas) {
  if (!porEnvio.has(l.envio)) {
    porEnvio.set(l.envio, { emp: l.emp, linhas: [], st: l.st, uuid: l.uuid });
  }
  porEnvio.get(l.envio).linhas.push({
    assinado: Number(l.assinado) === 1,
    email: String(l.email ?? "").trim().toLowerCase(),
  });
}

const envios = [...porEnvio.values()];
const comUuid = envios.filter((e) => e.uuid);
const assinadasC2x = linhas.filter((l) => Number(l.assinado) === 1).length;
console.log(
  "RECORTE VOC+VOL: " + envios.length + " envios (" + comUuid.length + " com uuid) | " +
    linhas.length + " linhas de assinatura | " + assinadasC2x + " marcadas assinadas no C2X",
);

// ── 2. Catálogo em lote (o caminho que a tela usa): tempo FRIO ──
const docs = new Map();
let paginas = 0;
const tCatalogo = Date.now();
for (let pg = 1; pg <= 40; pg += 1) {
  const r = await pegar("/documents?pg=" + pg);
  paginas += 1;
  const lista = Array.isArray(r.corpo) ? r.corpo : [];
  const itens = lista.filter((x) => x && x.uuidDoc);
  for (const d of itens) docs.set(d.uuidDoc, { nome: d.statusName, st: Number(d.statusId) });
  if (itens.length === 0) break;
}
const msCatalogo = Date.now() - tCatalogo;
console.log(
  "CATALOGO: " + docs.size + " documentos em " + paginas + " paginas, " + msCatalogo + "ms (" +
    (msCatalogo / 1000).toFixed(1) + "s) [FRIO, sequencial]",
);

// ── 3. O que a D4Sign diz do recorte ──
let semNoCatalogo = 0;
let terminais = 0;
let emMovimento = 0;
let cancelados = 0;
const paraDetalhe = [];
for (const e of comUuid) {
  const d = docs.get(e.uuid);
  if (!d) {
    semNoCatalogo += 1;
    continue;
  }
  if (d.st === 6) {
    cancelados += 1;
    continue;
  }
  if (d.st === 4 || d.st === 5) {
    terminais += 1;
    continue;
  }
  emMovimento += 1;
  paraDetalhe.push(e);
}
console.log(
  "DO RECORTE: " + terminais + " finalizados no D4Sign | " + cancelados + " CANCELADOS | " +
    emMovimento + " em movimento | " + semNoCatalogo + " fora do catalogo",
);

// ── 4. O detalhe assinante a assinante ──
const tDetalhe = Date.now();
const detalhes = await emParalelo(paraDetalhe, 6, async (e) => {
  const r = await pegar("/documents/" + e.uuid + "/list");
  const arr = Array.isArray(r.corpo) ? r.corpo : [];
  const bloco = arr.find((x) => x && Array.isArray(x.list));
  const lista = bloco ? bloco.list : [];
  return {
    e,
    ms: r.ms,
    ok: r.ok,
    sig: lista.map((s) => ({
      assinou: String(s && s.signed) === "1",
      email: String((s && s.email) ?? "").trim().toLowerCase(),
    })),
  };
});
const msDetalhe = Date.now() - tDetalhe;
const tempos = detalhes.filter((d) => d && d.ok).map((d) => d.ms).sort((a, b) => a - b);
console.log(
  "DETALHE: " + paraDetalhe.length + " documentos em " + msDetalhe + "ms (" +
    (msDetalhe / 1000).toFixed(1) + "s), 6 em paralelo | mediana " +
    (tempos[Math.floor(tempos.length / 2)] ?? 0) + "ms",
);

// ── 5. A CONTA que interessa ──
let d4AssinouC2xNao = 0;
let c2xAssinouD4Nao = 0;
let conferidas = 0;
let semCasar = 0;
let terminalC2xPendente = 0;

for (const e of comUuid) {
  const d = docs.get(e.uuid);
  if (!d) continue;
  // finalizado = todo mundo daquele documento assinou. O C2X que ainda mostra pendente ali está
  // errado por definição, sem precisar perguntar assinante a assinante.
  if (d.st === 4 || d.st === 5) {
    const faltando = e.linhas.filter((l) => !l.assinado).length;
    if (faltando > 0) {
      d4AssinouC2xNao += faltando;
      terminalC2xPendente += 1;
    }
    conferidas += e.linhas.length;
  }
}

for (const det of detalhes) {
  if (!det || !det.ok || det.sig.length === 0) continue;
  const porEmail = new Map(det.sig.filter((s) => s.email).map((s) => [s.email, s.assinou]));
  for (const l of det.e.linhas) {
    if (!l.email || !porEmail.has(l.email)) {
      semCasar += 1;
      continue;
    }
    conferidas += 1;
    const d4 = porEmail.get(l.email);
    if (d4 && !l.assinado) d4AssinouC2xNao += 1;
    if (!d4 && l.assinado) c2xAssinouD4Nao += 1;
  }
}

console.log("");
console.log("=== DIVERGENCIA DE ASSINATURA (o que os dois paineis vao mostrar diferente) ===");
console.log("  conferidas: " + conferidas + " de " + linhas.length + " linhas");
console.log("  D4Sign diz ASSINADO e o C2X diz pendente: " + d4AssinouC2xNao + "   <-- cobranca indevida hoje");
console.log("  C2X diz assinado e a D4Sign diz pendente: " + c2xAssinouD4Nao);
console.log("  contratos FINALIZADOS no D4Sign e pendentes no C2X: " + terminalC2xPendente);
console.log("  assinantes que nao casaram por e-mail: " + semCasar);
console.log("  cancelados que HOJE aparecem como pendencia viva: " + cancelados);
console.log("");
console.log(
  "TEMPO DE UMA CARGA: catalogo " + (msCatalogo / 1000).toFixed(1) +
    "s (1x a cada 5min, Hub inteiro) + o detalhe que couber no teto de 20",
);
