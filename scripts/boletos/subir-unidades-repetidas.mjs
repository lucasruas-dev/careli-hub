// SOBE AS LINHAS QUE FICARAM DE FORA POR APARTAMENTO REPETIDO, com a unidade marcada.
//
// Uso:
//   node scripts/boletos/subir-unidades-repetidas.mjs            (ensaio)
//   node scripts/boletos/subir-unidades-repetidas.mjs --gravar
//
// ⚠️ TRÊS APARTAMENTOS DO VALE DO SOL APARECEM DUAS VEZES na planilha, cada um com uma pessoa
// diferente (nome, telefone, dia de vencimento e número de parcelas distintos). Como a unidade é a
// chave da parcela, do cadastro e da referência da cobrança, gravar as duas derrubava a carga
// inteira — e escolher uma emitiria no CPF da outra. As seis ficaram de fora.
//
// ⚠️ FICAR DE FORA VIROU O PROBLEMA. Lucas (02/09/2026): *"pois aí eu altero a unidade"* — a
// unidade virou campo editável hoje, mas só dá para editar o que existe. Sem linha no banco, não há
// o que corrigir na tela, e as seis ficariam esperando uma planilha nova.
//
// ⚠️ A SEGUNDA OCORRÊNCIA GANHA UM SUFIXO VISÍVEL, e não um número silencioso. `406 BL 04 (2)` diz
// na própria tela que aquilo está por conferir; `406 BL 04-B` ou um contador escondido pareceriam
// cadastro normal e sobreviveriam meses.
//
// ⚠️ AS DUAS ENTRAM COMO `unidade_incerta`, então o boleto sai como "Vale do Sol - Parcela 19 de
// 48", sem apartamento nenhum. Nenhuma das duas afirma um número que ninguém confirmou — inclusive
// a primeira, porque não se sabe qual das duas está certa.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const req = createRequire(path.resolve(raiz, "apps/hub/package.json"));
const ExcelJS = req("exceljs");
const { createClient } = req("@supabase/supabase-js");
const esbuild = req("esbuild");

const ARQUIVO = "C:/Users/lucas/Downloads/05b30114-4687-4451-a728-31446aac2026.xlsx";
const ABA = "BOLETOS VALE SOL";
const SLUG = "vale-do-sol";
const REPETIDAS = ["406 BL 04", "408 BL 01", "101 BL 01"];

const gravar = process.argv.includes("--gravar");

const compilado = await esbuild.build({
  bundle: true,
  entryPoints: [path.resolve(raiz, "apps/hub/lib/apolo/boletos/carga.ts")],
  format: "esm",
  platform: "node",
  write: false,
});
const { lerAba, linhaDoCliente, valorDaCelula, vereditoDaLinha } = await import(
  `data:text/javascript;base64,${Buffer.from(compilado.outputFiles[0].text).toString("base64")}`
);

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

const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(ARQUIVO);
const ws = wb.getWorksheet(ABA);

function gradeDaAba(planilha) {
  const grade = [];
  planilha.eachRow({ includeEmpty: true }, (linha) => {
    const l = [];
    linha.eachCell({ includeEmpty: true }, (celula, col) => {
      const bruto = valorDaCelula(celula);
      l[col - 1] = {
        texto: bruto instanceof Date || bruto === null ? null : String(bruto),
        valor: bruto,
      };
    });
    grade.push(l);
  });
  return grade;
}

const grade = gradeDaAba(ws);
const primeira = lerAba(ABA, grade, "0000-00");
if ("motivo" in primeira) {
  console.error(`não deu para ler a aba: ${primeira.motivo}`);
  process.exit(1);
}

// A ordem em que aparecem na planilha decide quem fica com a unidade original.
const ordem = new Map();
const linhas = [];

for (const mes of primeira.meses) {
  const r = lerAba(ABA, grade, mes);
  if ("motivo" in r) continue;

  const vistasNoMes = new Map();
  for (const c of r.clientes) {
    const unidade = (c.unidade ?? "").trim();
    if (!REPETIDAS.includes(unidade) || !c.nome) continue;

    // A MESMA pessoa precisa receber a MESMA unidade em todas as competências, senão ela vira duas
    // carteiras. A ordem é fixada na primeira vez que o nome aparece.
    const chaveDaPessoa = `${unidade}|${c.nome.trim()}`;
    if (!ordem.has(chaveDaPessoa)) {
      const quantas = [...ordem.keys()].filter((k) => k.startsWith(`${unidade}|`)).length;
      ordem.set(chaveDaPessoa, quantas);
    }
    const posicao = ordem.get(chaveDaPessoa);
    const unidadeFinal = posicao === 0 ? unidade : `${unidade} (${posicao + 1})`;

    if (vistasNoMes.has(unidadeFinal)) continue;
    vistasNoMes.set(unidadeFinal, true);

    const v = vereditoDaLinha(linhaDoCliente(c));
    if (!v.emite && v.motivo === "sem-valor") continue;

    linhas.push({
      bloqueio: v.emite ? null : v.explicacao,
      competencia: mes,
      empreendimento: SLUG,
      nome: c.nome,
      origem: path.basename(ARQUIVO),
      parcela_atual: c.parcelaAtual ?? null,
      total_parcelas: c.totalParcelas ?? null,
      unidade: unidadeFinal,
      // ⚠️ AS DUAS SÃO INCERTAS, inclusive a que ficou com o número original: não se sabe qual das
      // duas pessoas é a dona dele. O boleto sai sem apartamento até alguém confirmar.
      unidade_incerta: true,
      valor: v.emite ? v.valor : (c.valor ?? null),
      vencimento_dia: c.vencimento ?? null,
      workspace_id: "careli",
    });
  }
}

const setembro = linhas.filter((l) => l.competencia === "2026-09");
console.log(`${linhas.length} parcelas em ${primeira.meses.length} competências`);
console.log(`\nComo cada pessoa ficou (competência de setembro):`);
for (const l of setembro.sort((a, b) => a.unidade.localeCompare(b.unidade))) {
  const marca = l.unidade.includes("(") ? "  << por conferir" : "";
  console.log(
    `   ${l.unidade.padEnd(16)} dia ${String(l.vencimento_dia ?? "?").padStart(2)}  R$ ${String(Number(l.valor ?? 0).toFixed(2)).padStart(9)}  ${l.nome}${marca}`,
  );
}

if (!gravar) {
  console.log("\nENSAIO — nada foi gravado. Rode com --gravar para valer.");
  process.exit(0);
}

let gravadas = 0;
for (let i = 0; i < linhas.length; i += 500) {
  const lote = linhas.slice(i, i + 500);
  const { data, error } = await sb
    .from("boletos_parcelas")
    .upsert(lote, { onConflict: "workspace_id,empreendimento,unidade,competencia" })
    .select("id");
  if (error) {
    console.error(`\n❌ ${error.message}`);
    process.exit(1);
  }
  gravadas += data.length;
}
console.log(`\n✓ ${gravadas} parcelas gravadas, todas marcadas como unidade a conferir.`);
