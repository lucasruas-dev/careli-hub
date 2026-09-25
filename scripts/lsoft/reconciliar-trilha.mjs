// RELIGA a trilha de edição do LSoft às parcelas novas, depois de uma carga.
//
// Irmão de `reconciliar-classificacao.mjs`. Desde a migration 0188 a trilha não é mais apagada
// junto com as parcelas: a FK virou `SET NULL`, e a linha fica órfã guardando a impressão digital
// e o retrato da parcela. Este script devolve cada linha órfã à parcela nova equivalente.
//
//   node scripts/lsoft/reconciliar-trilha.mjs --ensaio            relata, não grava
//   node scripts/lsoft/reconciliar-trilha.mjs --simular-recarga   prova: finge que a carga rodou
//   node scripts/lsoft/reconciliar-trilha.mjs                     grava
//
// ⚠️ A DECISÃO NÃO MORA AQUI. Quem decide qual parcela nova recebe cada linha é
// `apps/hub/lib/lsoft/religar-trilha.ts`, que é puro e testado (os casos difíceis, como dois lotes
// do mesmo cliente com o mesmo valor, estão provados lá). Este script só lê, chama e grava. É
// carregado pelo `jiti`, para não existir uma segunda cópia da regra que um dia discorde da primeira.
//
// ⚠️ --simular-recarga NÃO ESCREVE NADA. Ele troca os ids das parcelas em memória e zera o
// `parcela_id` das linhas, exatamente o estado que a carga deixa, e mostra o que seria religado.
// É o jeito de provar que a carga é segura ANTES de rodá-la.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");
const { createJiti } = req("jiti");

const jiti = createJiti(import.meta.url);
const { planejarReligamentoDaTrilha } = await jiti.import(
  path.resolve(process.cwd(), "apps/hub/lib/lsoft/religar-trilha.ts"),
);

const ensaio = process.argv.includes("--ensaio");
const simular = process.argv.includes("--simular-recarga");

// O worktree não tem .env.local (não é versionado): cai no do checkout principal.
const ENV_LOCAL = [
  path.resolve(process.cwd(), "apps/hub/.env.local"),
  path.resolve(process.cwd(), "../../careli-hub/apps/hub/.env.local"),
].find((p) => fs.existsSync(p));
if (!ENV_LOCAL) throw new Error("não achei apps/hub/.env.local");

const env = Object.fromEntries(
  fs
    .readFileSync(ENV_LOCAL, "utf8")
    .split("\n")
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    }),
);

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ⚠️ PostgREST corta em 1.000 linhas SEM ERRO. Tudo pagina.
//
// ⚠️ E A PAGINAÇÃO PRECISA DE ORDEM FIXA. Sem `order`, o Postgres não garante que duas páginas
// seguidas não se sobreponham: uma linha pode vir repetida e outra pode não vir, e o TOTAL CONTINUA
// BATENDO. Medido em 24/09/2026 rodando a simulação três vezes seguidas: 159 religadas com 1 órfã,
// depois 160 com zero, depois 160 com zero. A órfã era uma parcela viva que a leitura pulou.
// Conferir o total não pega isso; por isso a leitura também confere ids distintos no fim.
async function lerTudo(tabela, colunas, filtro) {
  const linhas = [];
  const passo = 1000;
  for (let de = 0; ; de += passo) {
    let consulta = supabase.from(tabela).select(colunas).order("id").range(de, de + passo - 1);
    if (filtro) consulta = filtro(consulta);
    const { data, error } = await consulta;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(data ?? []));
    if (!data || data.length < passo) break;
  }
  const distintos = new Set(linhas.map((l) => l.id)).size;
  if (distintos !== linhas.length) {
    throw new Error(`${tabela}: ${linhas.length} linhas lidas mas ${distintos} ids distintos. Leitura instável, abortado.`);
  }
  return linhas;
}

let linhas = await lerTudo(
  "lsoft_clientes_edicoes",
  "id, parcela_id, impressao_digital, ordinal, cliente_codigo, empreendimento_no_momento, vencimento_no_momento, valor_no_momento",
  (c) => c.not("impressao_digital", "is", null),
);

if (linhas.length === 0) {
  console.log("nenhuma linha de trilha de parcela para reconciliar.");
  process.exit(0);
}

const empreendimentos = [...new Set(linhas.map((l) => l.empreendimento_no_momento).filter(Boolean))];
let parcelas = await lerTudo(
  "lsoft_parcelas",
  "id, cliente_codigo, empreendimento, parcela, vencimento, valor, observacoes, origem",
  (c) => c.in("empreendimento", empreendimentos),
);

console.log(`${linhas.length} linhas de trilha · ${parcelas.length} parcelas em ${empreendimentos.join(", ")}`);

if (simular) {
  // O estado que a carga deixa: toda parcela com id novo, toda trilha com parcela_id nulo.
  parcelas = parcelas.map((p, i) => ({ ...p, id: `simulada-${String(i).padStart(6, "0")}` }));
  linhas = linhas.map((l) => ({ ...l, parcela_id: null }));
  console.log("SIMULAÇÃO: ids das parcelas trocados e trilha zerada, em memória. Nada será gravado.");
}

const plano = planejarReligamentoDaTrilha(linhas, parcelas);
const c = plano.contagem;
const grupos = c.jaLigados + c.religadosPorDigital + c.religadosPorVencimentoEValor + c.religadosSoPorValor + c.orfaos;

console.log(`
  parcelas com trilha (grupos):     ${grupos}
  já ligadas (parcela viva):        ${c.jaLigados}
  religadas pela digital exata:     ${c.religadosPorDigital}
  religadas por vencimento+valor:   ${c.religadosPorVencimentoEValor}    (parcela paga ou observação corrigida)
  religadas só por valor:           ${c.religadosSoPorValor}    (vencimento também mudou; só quando única)
  ÓRFÃS (sem par seguro):           ${c.orfaos}
  linhas a atualizar:               ${plano.atualizacoes.length}`);

if (plano.orfaos.length > 0) {
  console.log("\n  órfãs, ficam como estão para alguém olhar:");
  for (const o of plano.orfaos.slice(0, 25)) console.log(`    ${o.chave} · ${o.linhas} linha(s)`);
  if (plano.orfaos.length > 25) console.log(`    ... e mais ${plano.orfaos.length - 25}`);
}

if (ensaio || simular) {
  console.log(`\n${simular ? "SIMULAÇÃO" : "ENSAIO"}: nada gravado.`);
  process.exit(0);
}

if (plano.atualizacoes.length === 0) {
  console.log("\nnada a religar.");
  process.exit(0);
}

// Agrupa por parcela de destino: uma baixa gera três linhas, e um update com `.in()` por destino
// faz uma chamada por parcela em vez de três. Lotes de 200 ids: `.in()` longo estoura a URL.
const porDestino = new Map();
for (const u of plano.atualizacoes) {
  const lista = porDestino.get(u.parcela_id) ?? [];
  lista.push(u.id);
  porDestino.set(u.parcela_id, lista);
}

let feitas = 0;
for (const [parcelaId, ids] of porDestino) {
  for (let i = 0; i < ids.length; i += 200) {
    const bloco = ids.slice(i, i + 200);
    const { error } = await supabase.from("lsoft_clientes_edicoes").update({ parcela_id: parcelaId }).in("id", bloco);
    if (error) throw new Error(`update para ${parcelaId}: ${error.message}`);
    feitas += bloco.length;
  }
  process.stdout.write(`\r  religando: ${feitas}/${plano.atualizacoes.length}`);
}
process.stdout.write("\n");
console.log(`${feitas} linhas de trilha religadas.`);
