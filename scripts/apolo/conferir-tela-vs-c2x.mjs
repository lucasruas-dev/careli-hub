// CONFERÊNCIA read-only: a tela de contratos está batendo com o C2X?
//
// Pedido do dono (18/08/2026): *"olha se está batendo com o C2X, por favor"*.
//
// Diferença desta medição para a `medir-divergencia-d4sign.mjs`: aqui a query usa o filtro EXATO
// do painel — `cs.send_document_signature = 1` além do `status <> 6`. A primeira medição não tinha
// esse filtro e por isso contava envios que a tela nunca mostra, inflando a divergência. Este
// script é o que vale.
//
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa. ⚠️ Nome/e-mail não vão para a saída.
//
//   node scripts/apolo/conferir-tela-vs-c2x.mjs
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
const BASE = "https://secure.d4sign.com.br/api/v1";
const url = (rota) =>
  BASE + rota + (rota.includes("?") ? "&" : "?") + "tokenAPI=" + TOKEN + "&cryptKey=" + CRYPT;

async function pegar(rota) {
  try {
    const r = await fetch(url(rota), { signal: AbortSignal.timeout(20000) });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
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

/** A mesma normalizacao de `chaveDeNome` em lib/apolo/d4sign-assinaturas.ts. */
function chaveDeNome(nome) {
  return String(nome ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const conexao = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

// O FILTRO DA TELA, palavra por palavra (lib/apolo/painel-assinatura.ts):
//   where u.enterprise_id in (36, 37)
//     and cs.send_document_signature = 1
//     and cs.contract_signature_status_id <> 6
const FILTRO_DA_TELA =
  " where u.enterprise_id in (36, 37)\n" +
  "   and cs.send_document_signature = 1\n" +
  "   and cs.contract_signature_status_id <> 6";

const JOINS =
  "  from contract_signatures cs\n" +
  "  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id\n" +
  "  join acquisition_requests ar on ar.id = arc.acquisition_request_id\n" +
  "  join enterprise_unities u on u.id = ar.enterprise_unity_id\n" +
  "  join enterprises e on e.id = u.enterprise_id\n" +
  "  join contract_signature_signers ss on ss.contract_signature_id = cs.id\n" +
  "  left join contract_signers csg on csg.id = ss.contract_signer_id\n" +
  "  left join signers sg on sg.id = csg.signer_id\n" +
  "  left join users usr on usr.id = sg.user_id";

const [comFiltro] = await conexao.query(
  "select cs.id envio, cs.uuidDoc uuid, cs.contract_signature_status_id st, ss.signed assinado,\n" +
    "       usr.email email, ss.user_name nome, e.code emp,\n" +
    "       coalesce(nullif(trim(u.name), ''), concat(e.code, u.block, u.lot)) unidade\n" +
    JOINS + "\n" + FILTRO_DA_TELA,
);

// A MESMA coisa SEM o send_document_signature, para medir o que aquele filtro tira.
const [semFiltro] = await conexao.query(
  "select count(*) linhas, count(distinct cs.id) envios\n" + JOINS + "\n" +
    " where u.enterprise_id in (36, 37) and cs.contract_signature_status_id <> 6",
);
await conexao.end();

const linhas = comFiltro;
const envios = new Map();
for (const l of linhas) {
  if (!envios.has(l.envio)) envios.set(l.envio, { linhas: [], st: l.st, uuid: l.uuid });
  envios.get(l.envio).linhas.push({
    assinado: Number(l.assinado) === 1,
    email: String(l.email ?? "").trim().toLowerCase(),
    nome: chaveDeNome(String(l.nome ?? "")),
  });
}
const assinadas = linhas.filter((l) => Number(l.assinado) === 1).length;
const unidades = new Set(linhas.map((l) => l.emp + "|" + l.unidade));
const completos = [...envios.values()].filter((e) => e.linhas.every((l) => l.assinado)).length;

console.log("=== 1. O C2X, com o filtro EXATO da tela (VOC 37 + VOL 36) ===");
console.log("  linhas de assinatura : " + linhas.length);
console.log("  assinadas            : " + assinadas);
console.log("  pendentes            : " + (linhas.length - assinadas));
console.log("  envios               : " + envios.size);
console.log("  unidades distintas   : " + unidades.size);
console.log("  contratos completos  : " + completos);
console.log(
  "  (sem o send_document_signature seriam " + semFiltro[0].linhas + " linhas / " +
    semFiltro[0].envios + " envios -> o filtro tira " + (semFiltro[0].linhas - linhas.length) +
    " linhas)",
);

// ── 2. O que a rota PÚBLICA (mesma lib, C2X puro) serve em produção ──
console.log("");
console.log("=== 2. A rota publica em producao (/api/publico/bi/assinaturas) ===");
try {
  const r = await fetch("https://c2x.app.br/api/publico/bi/assinaturas", {
    signal: AbortSignal.timeout(45000),
  });
  const corpo = await r.json();
  const lista = corpo?.data?.linhas ?? [];
  const prodAssinadas = lista.filter((l) => l.assinou).length;
  const prodUnidades = new Set(lista.map((l) => l.emp + "|" + l.un));
  console.log("  linhas    : " + lista.length + (lista.length === linhas.length ? "  == BATE" : "  != DIVERGE de " + linhas.length));
  console.log("  assinadas : " + prodAssinadas + (prodAssinadas === assinadas ? "  == BATE" : "  != DIVERGE de " + assinadas));
  console.log("  unidades  : " + prodUnidades.size + (prodUnidades.size === unidades.size ? "  == BATE" : "  != DIVERGE de " + unidades.size));
} catch (erro) {
  console.log("  falhou: " + String(erro).slice(0, 80));
}

// ── 3. O que a D4Sign diz dos MESMOS envios ──
console.log("");
console.log("=== 3. A D4Sign sobre os mesmos envios (o que a tela nova poderia corrigir) ===");
const comUuid = [...envios.values()].filter((e) => e.uuid);
const catalogo = new Map();
for (let pg = 1; pg <= 40; pg += 1) {
  const corpo = await pegar("/documents?pg=" + pg);
  const itens = (Array.isArray(corpo) ? corpo : []).filter((x) => x && x.uuidDoc);
  for (const d of itens) catalogo.set(d.uuidDoc, Number(d.statusId));
  if (itens.length === 0) break;
}

let terminais = 0;
let cancelados = 0;
let emMovimento = 0;
let fora = 0;
const paraDetalhe = [];
for (const e of comUuid) {
  const st = catalogo.get(e.uuid);
  if (st === undefined) fora += 1;
  else if (st === 6) cancelados += 1;
  else if (st === 4 || st === 5) terminais += 1;
  else {
    emMovimento += 1;
    paraDetalhe.push(e);
  }
}
console.log(
  "  envios com uuid: " + comUuid.length + " | finalizados: " + terminais + " | cancelados: " +
    cancelados + " | em movimento: " + emMovimento + " | fora do catalogo: " + fora,
);

const detalhes = await emParalelo(paraDetalhe, 6, async (e) => {
  const corpo = await pegar("/documents/" + e.uuid + "/list");
  const bloco = (Array.isArray(corpo) ? corpo : []).find((x) => x && Array.isArray(x.list));
  return {
    e,
    sig: (bloco ? bloco.list : []).map((s) => ({
      // ⚠️ OS CAMPOS SÃO OS DE `lerSignatariosDaResposta` (lib/guardian/d4sign-consulta.ts), e
      // errar um deles produz medição limpa e falsa: o nome é `user_name` (não `name`), e
      // `assinou` exige `signed === "1"` E `sign_info` presente — só a flag não basta.
      assinou: String(s && s.signed) === "1" && Boolean(s && s.sign_info),
      email: String((s && s.email) ?? "").trim().toLowerCase(),
      nome: chaveDeNome((s && s.user_name) ?? ""),
    })),
  };
});

let d4SimC2xNao = 0;
let c2xSimD4Nao = 0;
let conferidas = 0;
let semCasar = 0;
let porNomeCasadas = 0;
let semCasarAssinadas = 0;
let semCasarPendentes = 0;
let semCasarSemIdentidade = 0;
let sigSobrando = 0;
for (const det of detalhes) {
  if (!det || det.sig.length === 0) continue;

  // DOIS PASSES, na mesma ordem de `conciliarDocumento`: e-mail primeiro (mais forte), nome
  // depois, e cada signatario casa com no maximo uma linha (por isso os Set de usados).
  const linhasUsadas = new Set();
  const sigUsados = new Set();
  const pares = new Map();

  const parear = (chaveDaLinha) => {
    det.sig.forEach((s, iSig) => {
      if (sigUsados.has(iSig)) return;
      const alvo = det.e.linhas.findIndex((l, iL) => !linhasUsadas.has(iL) && chaveDaLinha(s, l));
      if (alvo < 0) return;
      linhasUsadas.add(alvo);
      sigUsados.add(iSig);
      pares.set(alvo, s);
    });
  };

  parear((s, l) => Boolean(s.email) && s.email === l.email);
  const aposEmail = pares.size;
  parear((s, l) => Boolean(s.nome) && s.nome === l.nome);
  porNomeCasadas += pares.size - aposEmail;

  // Quem sobrou dos DOIS lados. Linha do C2X sem signatário na D4Sign é pendência de alguém que o
  // documento não convida a assinar; signatário sem linha é o contrário.
  sigSobrando += det.sig.length - sigUsados.size;
  det.e.linhas.forEach((l, iL) => {
    const s = pares.get(iL);
    if (!s) {
      semCasar += 1;
      if (l.assinado) semCasarAssinadas += 1;
      else semCasarPendentes += 1;
      if (!l.email && !l.nome) semCasarSemIdentidade += 1;
      return;
    }
    conferidas += 1;
    if (s.assinou && !l.assinado) d4SimC2xNao += 1;
    if (!s.assinou && l.assinado) c2xSimD4Nao += 1;
  });
}

console.log("  linhas conferidas assinante a assinante: " + conferidas);
console.log("  D4Sign ASSINADO e C2X pendente: " + d4SimC2xNao + "   <-- pendencia que nao existe");
console.log("  C2X assinado e D4Sign pendente: " + c2xSimD4Nao);
console.log("  casadas pelo NOME (o e-mail nao bastou): " + porNomeCasadas);
console.log("  nao casaram de jeito nenhum: " + semCasar);
console.log("     dessas, ASSINADAS no C2X : " + semCasarAssinadas);
console.log("     dessas, PENDENTES no C2X : " + semCasarPendentes + "   <-- pendencia que a D4Sign nao conhece");
console.log("     sem e-mail E sem nome no C2X: " + semCasarSemIdentidade + " (nao ha como casar)");
console.log("  signatarios da D4Sign sem linha no C2X: " + sigSobrando);

console.log("");
console.log("=== VEREDITO ===");
console.log(
  "  A tela mostra " + assinadas + " de " + linhas.length + " assinaturas (o que o C2X diz).",
);
console.log(
  "  A D4Sign diz que " + d4SimC2xNao + " dessas pendencias JA foram assinadas, e a tela nao corrige\n" +
    "  nenhuma no Vale do Ouro porque " + emMovimento + " em movimento > teto 20 e todos estao no catalogo.",
);
