// CARGA DA CARTEIRA MENSAL — a planilha do administrativo vira linhas de `boletos_parcelas`.
//
// Uso:
//   node scripts/boletos/carregar-parcelas.mjs <arquivo.xlsx>            (ensaio, nao grava)
//   node scripts/boletos/carregar-parcelas.mjs <arquivo.xlsx> --gravar   (grava no Supabase)
//   node scripts/boletos/carregar-parcelas.mjs <arquivo.xlsx> --empreendimento=ed-rubi,ed-jade
//
// ⚠️ ENSAIO POR PADRAO. A carga substitui a carteira do mes; uma coluna deslocada trocaria o valor
// de todo mundo, e ninguem confere 200 boletos a mao.
//
// ⚠️ A REGRA DE EMISSAO NAO E REESCRITA AQUI. Este script usa a MESMA `vereditoDaLinha` da tela e da
// rota, importada de apps/hub. Reimplementar "quem emite" num script de carga e como as duas
// verdades se separam: a tela diria 11 e o banco 12, e o 12o so apareceria no extrato do cliente.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const ExcelJS = req("exceljs");
const { createClient } = req("@supabase/supabase-js");

// ⚠️ A REGRA VEM DO CODIGO DE PRODUCAO, compilada na hora por esbuild (ja e dependencia do vitest).
// Sem isto, o script teria a sua propria copia da regra — e copias divergem em silencio.
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
const { lerAba, linhaDoCliente, vereditoDaLinha, valorDaCelula, empreendimentoDaAba } = modulo;

const arquivo = process.argv[2];
const gravar = process.argv.includes("--gravar");
const filtro = (process.argv.find((a) => a.startsWith("--empreendimento=")) ?? "")
  .replace("--empreendimento=", "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// !! UNIDADE COM DOIS CLIENTES NAO PODE SER ADIVINHADA, E TAMBEM NAO PODE SER IGNORADA EM SILENCIO.
// No Vale do Sol tres apartamentos aparecem com DUAS pessoas diferentes (nome, telefone, dia de
// vencimento e valor distintos): 406 BL 04, 408 BL 01 e 101 BL 01. A chave da tabela e a UNIDADE,
// entao gravar as duas linhas faz o upsert derrubar a carga inteira -- e escolher uma delas
// emitiria no CPF errado, porque `boletos_documentos` tambem guarda um documento por unidade.
//
// Por isso pular exige NOMEAR a unidade na linha de comando: cada exclusao e uma decisao declarada,
// que aparece no relatorio e some sozinha quando o administrativo corrigir a planilha.
const pular = (process.argv.find((a) => a.startsWith("--pular-unidade=")) ?? "")
  .replace("--pular-unidade=", "")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);
const puladas = [];

if (!arquivo) {
  console.error("Informe o arquivo: node scripts/boletos/carregar-parcelas.mjs <arquivo.xlsx> [--gravar]");
  process.exit(1);
}

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(arquivo);

// Descobre TODAS as competencias do arquivo lendo uma aba qualquer com cabecalho de meses.
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

const abas = wb.worksheets.filter((ws) => !/[íi]ndice/i.test(ws.name));
const competencias = new Set();
for (const ws of abas) {
  const r = lerAba(ws.name, gradeDaAba(ws), "0000-00");
  if (!("motivo" in r)) for (const m of r.meses) competencias.add(m);
}
const meses = [...competencias].sort();
console.log(`${meses.length} competencias no arquivo: ${meses[0]} ate ${meses[meses.length - 1]}`);

const linhas = [];
const semEmpreendimento = [];
let ignoradasPorFiltro = 0;

for (const ws of abas) {
  const grade = gradeDaAba(ws);
  const emp = empreendimentoDaAba(ws.name);
  if (!emp) {
    semEmpreendimento.push(ws.name);
    continue;
  }
  if (filtro.length > 0 && !filtro.includes(emp.slug)) {
    ignoradasPorFiltro += 1;
    continue;
  }

  for (const mes of meses) {
    const r = lerAba(ws.name, grade, mes);
    if ("motivo" in r) continue;

    for (const c of r.clientes) {
      const unidade = (c.unidade ?? "").trim();
      if (pular.includes(`${emp.slug}|${unidade}`)) {
        puladas.push({ competencia: mes, empreendimento: emp.slug, nome: c.nome, unidade });
        continue;
      }
      // Sem unidade nao ha como casar com o CPF nem identificar a cobranca.
      if (!unidade) continue;

      const v = vereditoDaLinha(linhaDoCliente(c));
      // ⚠️ LINHA SEM VALOR E SEM RECADO NAO VIRA REGISTRO. A planilha tem 23 colunas de mes e a
      // maioria dos clientes so ocupa algumas: gravar as vazias encheria a tabela de nada e faria a
      // tela mostrar "0 a emitir" em meses que nem existem para aquela unidade.
      if (!v.emite && v.motivo === "sem-valor") continue;

      linhas.push({
        bloqueio: v.emite ? null : v.explicacao,
        competencia: mes,
        empreendimento: emp.slug,
        nome: c.nome,
        origem: path.basename(arquivo),
        // ⚠️ "Parc. Atual" e "N Parc." vao para a mensagem do cliente ("parcela 9 de 120"). Sao as
        // colunas da planilha, e NAO uma contagem nossa: o cliente entrou no meio do contrato e a
        // contagem dele nao comeca no primeiro mes do arquivo.
        parcela_atual: c.parcelaAtual ?? null,
        total_parcelas: c.totalParcelas ?? null,
        unidade,
        valor: v.emite ? v.valor : (c.valor ?? null),
        vencimento_dia: c.vencimento ?? null,
        workspace_id: "careli",
      });
    }
  }
}

// ⚠️ DUAS LINHAS PARA A MESMA (unidade, competencia) derrubariam o upsert com "ON CONFLICT DO UPDATE
// command cannot affect row a second time". Melhor achar aqui, com os dois valores na frente.
const vistos = new Map();
const duplicados = [];
for (const l of linhas) {
  const chave = `${l.empreendimento}|${l.unidade}|${l.competencia}`;
  if (vistos.has(chave)) duplicados.push({ chave, valores: [vistos.get(chave).valor, l.valor] });
  else vistos.set(chave, l);
}

const porEmp = {};
for (const l of linhas) {
  porEmp[l.empreendimento] ??= { emitem: 0, bloqueadas: 0, total: 0 };
  if (l.bloqueio) porEmp[l.empreendimento].bloqueadas += 1;
  else {
    porEmp[l.empreendimento].emitem += 1;
    porEmp[l.empreendimento].total += Number(l.valor ?? 0);
  }
}

console.log(`\n${linhas.length} parcelas montadas:`);
for (const [e, n] of Object.entries(porEmp).sort((a, b) => b[1].emitem - a[1].emitem)) {
  console.log(
    `  ${e.padEnd(14)} ${String(n.emitem).padStart(4)} emitem  ${String(n.bloqueadas).padStart(3)} bloqueadas  R$ ${n.total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
  );
}

if (semEmpreendimento.length) {
  console.log(`\nAbas fora da lista (nao entram): ${semEmpreendimento.join(", ")}`);
}
if (ignoradasPorFiltro) console.log(`${ignoradasPorFiltro} aba(s) fora do --empreendimento`);

if (puladas.length) {
  const porUnidade = new Map();
  for (const p of puladas) {
    const k = `${p.empreendimento}|${p.unidade}`;
    if (!porUnidade.has(k)) porUnidade.set(k, new Set());
    porUnidade.get(k).add(p.nome);
  }
  console.log(
    String.fromCharCode(10) +
      `${puladas.length} linha(s) PULADAS por --pular-unidade (${porUnidade.size} unidade(s)):`,
  );
  for (const [k, nomes] of porUnidade) console.log(`  ${k} -- ${[...nomes].join(" / ")}`);
}

if (duplicados.length) {
  console.log(`\n⚠️ ${duplicados.length} chave(s) repetida(s) — a carga NAO roda assim:`);
  for (const d of duplicados.slice(0, 10)) console.log(`  ${d.chave}: ${d.valores.join(" / ")}`);
  process.exit(1);
}

// O recorte do mes corrente, que e o que o Lucas confere de olho.
const alvo = process.env.COMPETENCIA_ALVO ?? meses.find((m) => m >= "2026-09") ?? meses[meses.length - 1];
const doAlvo = linhas.filter((l) => l.competencia === alvo && !l.bloqueio);
console.log(`\nEm ${alvo}: ${doAlvo.length} boleto(s) a emitir`);
for (const l of doAlvo.sort((a, b) => a.empreendimento.localeCompare(b.empreendimento))) {
  console.log(
    `  ${l.empreendimento.padEnd(14)} un ${String(l.unidade).padEnd(10)} dia ${String(l.vencimento_dia ?? "?").padStart(2)}  R$ ${Number(l.valor).toFixed(2).padStart(10)}  ${l.nome}`,
  );
}

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

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

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY ?? env.SUPABASE_SECRET_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ⚠️ EM LOTES DE 500: o PostgREST estoura o tamanho da requisicao com milhares de linhas de uma vez,
// e a falha vem como erro de rede, sem dizer que o problema foi o tamanho.
let gravadas = 0;
for (let i = 0; i < linhas.length; i += 500) {
  const lote = linhas.slice(i, i + 500);
  const { data, error } = await supabase
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
console.log(`\n\n✓ ${gravadas} parcelas gravadas.`);
