// CARGA DO GARDEN — a única carteira cujo lote da planilha NÃO é o lote de hoje.
//
// Uso:
//   node scripts/boletos/carregar-garden.mjs            (ensaio, não grava)
//   node scripts/boletos/carregar-garden.mjs --gravar
//
// ⚠️ O GARDEN FOI RENUMERADO, E A PLANILHA DE BOLETOS AINDA USA O NÚMERO ANTIGO. Lucas, 02/09/2026:
// *"esses lotes são os antigos, hoje temos os novos dentro do sistema"*. O antigo é corrido pelo
// loteamento inteiro (109, 212, 421); o novo reinicia a cada quadra (Q08 L09). Carregar o antigo
// põe o boleto num lote que não existe mais e que o masterplan não acha.
//
// ⚠️ AS DUAS FONTES DE CONVERSÃO DISCORDAM, E A DIFERENÇA É DE UM LOTE. Medido em 02/09/2026:
//
//   Cliente                        controle financeiro    base revisada
//   JULIO CESAR FERREIRA BARBOSA   Q7 L23                 Q7 L24
//   AILTON ILARIO PINTO            Q7 L24                 Q7 L25
//   WAGNER LIBERIO DE SOUZA        Q7 L25                 Q7 L26
//   WARLLEY MACIEL DE MENDONÇA     Q7 L26                 Q7 L27
//   SAMUEL SOARES MOREIRA          Q7 L27                 Q7 L28
//
// Cinco clientes, todos deslocados na mesma direção: é erro sistemático de uma das planilhas, não
// divergência de cadastro. **A BASE REVISADA GANHA** — ela é mais nova e é a que virou o masterplan
// que já está publicado (*"já encaminhei uma base, tanto que o masterplan está pronto"*). Deixar o
// controle financeiro decidir poria cinco boletos no lote do vizinho.
//
// ⚠️ O MAPA AINDA SERVE PARA DESEMPATAR. Vinte clientes compraram mais de um lote, e a planilha de
// boletos tem uma linha por lote — o nome sozinho não diz qual linha é qual. Aí o mapa escolhe,
// mas só dentro do conjunto que a base revisada dá àquele cliente: se ele apontar para fora, o
// caso é reportado em vez de gravado.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const ExcelJS = req("exceljs");
const { createClient } = req("@supabase/supabase-js");

const BOLETOS = "C:/Users/lucas/Downloads/b22dcd5f-ad68-4763-9b67-3da835fb961f (1).xlsx";
const REVISADA = "C:/Users/lucas/Downloads/lotes revisados garden - lucas (1) atual.xlsx";
const FINANCEIRO = "C:/Users/lucas/Downloads/GARDEN CONTROLE FINANCEIRO.xlsx";

const gravar = process.argv.includes("--gravar");

const esbuild = req("esbuild");
const compilado = await esbuild.build({
  bundle: true,
  entryPoints: [path.resolve(raiz, "apps/hub/lib/apolo/boletos/carga.ts")],
  format: "esm",
  platform: "node",
  write: false,
});
const modulo = await import(
  `data:text/javascript;base64,${Buffer.from(compilado.outputFiles[0].text).toString("base64")}`
);
const { lerAba, linhaDoCliente, vereditoDaLinha, valorDaCelula } = modulo;

const env = Object.fromEntries(
  fs
    .readFileSync(path.resolve(raiz, "apps/hub/.env.local"), "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);
const sb = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

function texto(c) {
  const v = c.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    return String(v.result ?? v.text ?? v.richText?.map((x) => x.text).join("") ?? "");
  }
  return String(v);
}
/** Só os dígitos, sem zero à esquerda — `01` e `1` são a mesma quadra. */
const nq = (s) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");
const norm = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
/** `Q07 L25` — o formato do sistema, com dois dígitos, para ordenar e casar com o masterplan. */
const unidadeDe = (q, l) => `Q${String(nq(q)).padStart(2, "0")} L${String(nq(l)).padStart(2, "0")}`;

// ── AS TRÊS FONTES ──────────────────────────────────────────────────────────

const wbRev = new ExcelJS.Workbook();
await wbRev.xlsx.readFile(REVISADA);
const wsRev = wbRev.getWorksheet("Planilha1");
const porComprador = new Map();
const lotesNovos = new Set();
for (let r = 2; r <= wsRev.rowCount; r++) {
  const l = wsRev.getRow(r);
  const q = nq(texto(l.getCell(1)));
  const lo = nq(texto(l.getCell(2)));
  const comp = texto(l.getCell(7)).trim();
  if (!q || !lo) continue;
  lotesNovos.add(`${q}|${lo}`);
  if (!comp || comp === "—" || /n[ãa]o informado/i.test(comp)) continue;
  const k = norm(comp);
  if (!porComprador.has(k)) porComprador.set(k, []);
  porComprador.get(k).push({ lo, q });
}

const wbFin = new ExcelJS.Workbook();
await wbFin.xlsx.readFile(FINANCEIRO);
const wsFin = wbFin.getWorksheet("GARDEN RESIDENCE");
const mapa = new Map();
for (let r = 3; r <= wsFin.rowCount; r++) {
  const l = wsFin.getRow(r);
  const novo = nq(texto(l.getCell(1)));
  const antigo = nq(texto(l.getCell(2)));
  const q = nq(texto(l.getCell(3)));
  if (novo && antigo && q && !mapa.has(`${q}|${antigo}`)) mapa.set(`${q}|${antigo}`, novo);
}

const wbBol = new ExcelJS.Workbook();
await wbBol.xlsx.readFile(BOLETOS);
const wsBol = wbBol.getWorksheet("BOLETOS GARDEN");

// ── A CONVERSÃO ─────────────────────────────────────────────────────────────

/**
 * O lote de hoje para uma linha da planilha de boletos.
 *
 * A ordem não é gosto: a base revisada é a que está no masterplan publicado, então ela decide
 * sempre que sabe. O mapa só entra onde ela não sabe (cliente que não consta com nome) ou onde ela
 * dá mais de um lote ao mesmo cliente — e, nesse caso, ainda tem de apontar para um dos lotes dela.
 */
// ⚠️ TRÊS CASOS RESOLVIDOS NA MÃO CONTRA A TABELA, porque o casamento automático nao os alcanca:
// na tabela da Cecilio o nome esta abreviado ("JORGE EDUARDO", "Vera Lucia Campolina") ou a QUADRA
// difere da planilha de boletos (a MEIRE esta na Q08 da planilha e na Q09 da tabela). Decisao do
// Lucas (02/09/2026): *"tudo que nao conseguirmos validar, vamos seguir a tabela, a tabela que e a
// referencia"*. Ficam explicitos aqui, com o nome dos dois lados, para poderem ser conferidos.
const PELA_TABELA = {
  // planilha (quadra|lote antigo) -> tabela (quadra, lote novo)
  "12|25": { lote: "25", naTabela: "Vera Lucia Campolina", quadra: "12" },
  "8|2": { lote: "3", naTabela: "JORGE EDUARDO", quadra: "8" },
  "8|96": { lote: "8", naTabela: "MEIRE JANE VILELA DE ALMEIDA", quadra: "9" },
};

function loteDeHoje(quadra, loteAntigo, nome, jaUsados) {
  const daTabela = PELA_TABELA[`${quadra}|${loteAntigo}`];
  if (daTabela) {
    return { fonte: "tabela (a mao)", lote: daTabela.lote, mapaDiscorda: null, quadra: daTabela.quadra };
  }

  // ⚠️ A QUADRA PODE ESTAR EM BRANCO NA PLANILHA, E ISSO JA CUSTOU UMA COBRANCA. A GABRIELA
  // CRISTINA JACINTO (lote antigo 284) tem a celula da quadra vazia; com o filtro por quadra ela
  // nao casava com a tabela nem com o mapa, e a linha sumia -- R$ 2.207,12 que ninguem cobraria e
  // ninguem notaria, porque some do total tambem. Sem quadra, a tabela e consultada em TODAS as
  // quadras, e so vale se o nome aparecer uma vez so.
  const semQuadra = !quadra;
  const doMapa = semQuadra ? null : (mapa.get(`${quadra}|${loteAntigo}`) ?? null);
  const todosDaTabela = porComprador.get(norm(nome)) ?? [];
  const daRevisada = semQuadra ? todosDaTabela : todosDaTabela.filter((x) => x.q === quadra);
  if (semQuadra) {
    if (daRevisada.length === 1) {
      return { fonte: "tabela (quadra em branco na planilha)", lote: daRevisada[0].lo, mapaDiscorda: null, quadra: daRevisada[0].q };
    }
    return {
      fonte: null,
      lote: null,
      motivo: daRevisada.length === 0
        ? "quadra em branco na planilha e o nome nao consta na tabela"
        : `quadra em branco na planilha e o nome aparece ${daRevisada.length}x na tabela`,
    };
  }

  if (daRevisada.length === 1) {
    return { fonte: "revisada", lote: daRevisada[0].lo, mapaDiscorda: doMapa && doMapa !== daRevisada[0].lo ? doMapa : null };
  }

  if (daRevisada.length > 1) {
    // Cliente com vários lotes: o mapa desempata, desde que aponte para um deles.
    if (doMapa && daRevisada.some((x) => x.lo === doMapa)) {
      return { fonte: "revisada+mapa", lote: doMapa, mapaDiscorda: null };
    }
    // Sem desempate confiável: pega o primeiro lote dela ainda não usado, em ordem.
    const livre = daRevisada
      .map((x) => x.lo)
      .sort((a, b) => Number(a) - Number(b))
      .find((lo) => !jaUsados.has(`${quadra}|${lo}`));
    if (livre) return { fonte: "revisada (ordem)", lote: livre, mapaDiscorda: doMapa };
    return { fonte: null, lote: null, motivo: `cliente tem ${daRevisada.length} lotes na revisada e o mapa não desempata` };
  }

  if (doMapa) {
    if (!lotesNovos.has(`${quadra}|${doMapa}`)) {
      return { fonte: null, lote: null, motivo: `mapa aponta Q${quadra} L${doMapa}, que não existe na base revisada` };
    }
    return { fonte: "mapa", lote: doMapa, mapaDiscorda: null };
  }

  return { fonte: null, lote: null, motivo: "sem lote novo na revisada nem no mapa" };
}

// ── MONTAGEM DAS PARCELAS ───────────────────────────────────────────────────

function gradeDaAba(ws) {
  const grade = [];
  ws.eachRow({ includeEmpty: true }, (linha) => {
    const l = [];
    linha.eachCell({ includeEmpty: true }, (celula, col) => {
      const bruto = valorDaCelula(celula);
      l[col - 1] = { texto: bruto instanceof Date || bruto === null ? null : String(bruto), valor: bruto };
    });
    grade.push(l);
  });
  return grade;
}

const grade = gradeDaAba(wsBol);
const primeira = lerAba(wsBol.name, grade, "0000-00");
if ("motivo" in primeira) {
  console.error(`não deu para ler a aba: ${primeira.motivo}`);
  process.exit(1);
}
const meses = primeira.meses;
console.log(`${meses.length} competências: ${meses[0]} a ${meses[meses.length - 1]}`);

// A conversão é decidida UMA VEZ por cliente, e reaproveitada em todas as competências.
const jaUsados = new Set();
const conversao = new Map();
const foraDaConversao = [];
const discordancias = [];

for (const c of primeira.clientes) {
  const q = nq(c.quadra);
  const antigo = nq(c.lote);
  if (!c.nome) continue;
  // ⚠️ LINHA COM LOTE FALTANDO NAO PODE SUMIR EM SILENCIO. Antes um `continue` aqui engolia a
  // linha antes de qualquer relatorio: ela nao aparecia nem como convertida nem como pendente.
  if (!antigo) {
    foraDaConversao.push({ antigo, motivo: "sem lote na planilha", nome: c.nome, q });
    continue;
  }
  const chave = `${q}|${antigo}`;
  if (conversao.has(chave)) continue;

  const r = loteDeHoje(q, antigo, c.nome, jaUsados);
  if (!r.lote) {
    foraDaConversao.push({ antigo, motivo: r.motivo, nome: c.nome, q });
    continue;
  }
  // A quadra tambem pode mudar quando a tabela discorda da planilha (caso da MEIRE).
  const quadraFinal = r.quadra ?? q;
  jaUsados.add(`${quadraFinal}|${r.lote}`);
  conversao.set(chave, { fonte: r.fonte, unidade: unidadeDe(quadraFinal, r.lote) });
  if (r.mapaDiscorda) {
    discordancias.push({ antigo, mapa: r.mapaDiscorda, nome: c.nome, q, revisada: r.lote });
  }
}

console.log(`\n${conversao.size} lote(s) convertidos · ${foraDaConversao.length} sem conversão`);
const porFonte = {};
for (const v of conversao.values()) porFonte[v.fonte] = (porFonte[v.fonte] ?? 0) + 1;
for (const [f, n] of Object.entries(porFonte).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(3)} pela ${f}`);
}

if (discordancias.length) {
  console.log(`\n⚠️ ${discordancias.length} onde o controle financeiro DISCORDA da revisada (venceu a revisada):`);
  for (const d of discordancias) {
    console.log(`   Q${d.q} antigo ${d.antigo} — ${d.nome}: revisada L${d.revisada}, financeiro L${d.mapa}`);
  }
}
if (foraDaConversao.length) {
  console.log(`\n⚠️ ${foraDaConversao.length} SEM conversão — ficam de fora da carga:`);
  for (const f of foraDaConversao) console.log(`   Q${f.q} antigo ${f.antigo} — ${f.nome}: ${f.motivo}`);
}

const linhas = [];
for (const mes of meses) {
  const r = lerAba(wsBol.name, grade, mes);
  if ("motivo" in r) continue;
  for (const c of r.clientes) {
    const q = nq(c.quadra);
    const antigo = nq(c.lote);
    const conv = conversao.get(`${q}|${antigo}`);
    if (!conv) continue;
    const v = vereditoDaLinha(linhaDoCliente(c));
    if (!v.emite && v.motivo === "sem-valor") continue;
    linhas.push({
      bloqueio: v.emite ? null : v.explicacao,
      competencia: mes,
      empreendimento: "garden",
      nome: c.nome,
      origem: path.basename(BOLETOS),
      parcela_atual: c.parcelaAtual ?? null,
      total_parcelas: c.totalParcelas ?? null,
      unidade: conv.unidade,
      valor: v.emite ? v.valor : (c.valor ?? null),
      vencimento_dia: c.vencimento ?? null,
      workspace_id: "careli",
    });
  }
}

const vistos = new Set();
const duplicados = [];
for (const l of linhas) {
  const k = `${l.unidade}|${l.competencia}`;
  if (vistos.has(k)) duplicados.push(k);
  else vistos.add(k);
}

const emite = linhas.filter((l) => !l.bloqueio);
console.log(`\n${linhas.length} parcelas montadas · ${emite.length} emitem · ${linhas.length - emite.length} bloqueadas`);
const alvo = meses.find((m) => m >= "2026-09") ?? meses[meses.length - 1];
const doAlvo = emite.filter((l) => l.competencia === alvo);
const soma = doAlvo.reduce((s, l) => s + Number(l.valor ?? 0), 0);
console.log(`Em ${alvo}: ${doAlvo.length} boletos, R$ ${soma.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

if (duplicados.length) {
  console.log(`\n⚠️ ${duplicados.length} chave(s) repetida(s) — não grava assim:`);
  for (const d of duplicados.slice(0, 10)) console.log(`   ${d}`);
  process.exit(1);
}

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

// ⚠️ AS PARCELAS ANTIGAS SAEM ANTES. A carga de hoje já gravou o Garden com o lote ANTIGO
// (`Q8 L109`); como a chave mudou, o upsert não as alcança e elas ficariam como carteira fantasma,
// somando de novo na tela. O apagão é restrito a `empreendimento = 'garden'`.
const { count: antes } = await sb
  .from("boletos_parcelas")
  .select("id", { count: "exact", head: true })
  .eq("workspace_id", "careli")
  .eq("empreendimento", "garden");
const { error: erroDel } = await sb
  .from("boletos_parcelas")
  .delete()
  .eq("workspace_id", "careli")
  .eq("empreendimento", "garden");
if (erroDel) {
  console.error(`❌ ao limpar: ${erroDel.message}`);
  process.exit(1);
}
console.log(`\n${antes} parcela(s) antigas do Garden removidas (lote antigo).`);

let gravadas = 0;
for (let i = 0; i < linhas.length; i += 500) {
  const lote = linhas.slice(i, i + 500);
  const { data, error } = await sb
    .from("boletos_parcelas")
    .upsert(lote, { onConflict: "workspace_id,empreendimento,unidade,competencia" })
    .select("id");
  if (error) {
    console.error(`\n❌ lote ${i / 500 + 1}: ${error.message}`);
    process.exit(1);
  }
  gravadas += data.length;
  process.stdout.write(`\r  ${gravadas}/${linhas.length}`);
}
console.log(`\n\n✓ ${gravadas} parcelas do Garden gravadas com o lote de hoje.`);
