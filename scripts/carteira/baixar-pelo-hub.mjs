// A BAIXA DO HUB NA CARTEIRA DO GARDEN, rodada à mão.
//
// Pedido do Lucas (29/09/2026): *"a partir de setembro, quem alimenta a carteira é o hub"*. O boleto
// pago no Asaas (retrato em `boletos_pagamentos`) dá baixa na parcela do Garden no espelho do LSoft
// (`lsoft_parcelas`, categoria 124), para os clientes que já estão no Financeiro do portal.
//
//   node scripts/carteira/baixar-pelo-hub.mjs                              (ENSAIO: só lê e lista)
//   node scripts/carteira/baixar-pelo-hub.mjs --competencia 2026-09        (ENSAIO de um mês)
//   node scripts/carteira/baixar-pelo-hub.mjs --cliente 00000000           (ENSAIO de um cliente só)
//   node scripts/carteira/baixar-pelo-hub.mjs --gravar [--competencia AAAA-MM] [--cliente 00000000]
//
// ⚠️ `--cliente` LIMITA A LISTA E A GRAVAÇÃO. Com `--gravar --cliente X`, só as parcelas do X são
// baixadas (antes, a lista mostrava só o X e a gravação levava todos: achado da revisão de 29/09/2026).
//
// Rode da RAIZ do repositório.
//
// ⚠️ A RÉGUA NÃO MORA AQUI. Quem casa pagamento com parcela, quem decide o que é seguro e quem grava
// é `apps/hub/lib/lsoft/baixa-do-hub.ts`, a MESMA que a sincronização de pagamentos chama de hora em
// hora (`/api/boletos/pagamentos/sincronizar`). O ensaio mostra exatamente o que o cron faria.
//
// ⚠️ ENSAIO POR PADRÃO. Sem `--gravar`, só SELECT. Com `--gravar`, cada baixa passa pela porta da
// ficha (`salvarParcelaDoLsoft`), com trilha assinada "Hub · boleto Asaas <id da cobrança>", e a
// parcela já paga não é tocada. Sem `--competencia`, todas a partir de 2026-09; antes disso nada muda.
//
// ⚠️ A LISTA NÃO TEM NOME NEM CPF: código do cliente no LSoft, lote novo, lote antigo e parcela.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
if (!fs.existsSync(path.resolve(RAIZ, "apps/hub/package.json"))) {
  throw new Error("rode da raiz do repositório (não achei apps/hub/package.json)");
}

// ── Os argumentos ───────────────────────────────────────────────────────────
const argumentos = process.argv.slice(2);
const gravar = argumentos.includes("--gravar");
// ⚠️ OPÇÃO SEM VALOR PARA AQUI. `--gravar --cliente` (esqueceu o código) antes virava "sem filtro" e
// gravava todos; `--cliente --gravar` virava o cliente "--gravar". Os dois agora são erro.
const valoresDe = (bandeira) =>
  argumentos.flatMap((arg, i) => {
    if (arg !== bandeira) return [];
    const valor = argumentos[i + 1];
    if (!valor || valor.startsWith("--")) throw new Error(`${bandeira} sem valor`);
    return [valor];
  });
const competencias = valoresDe("--competencia");
for (const competencia of competencias) {
  if (!/^\d{4}-\d{2}$/.test(competencia)) throw new Error(`--competencia ${competencia}: use AAAA-MM`);
  if (competencia < "2026-09") throw new Error(`--competencia ${competencia}: a baixa do hub começa em 2026-09`);
}
const clientesPedidos = valoresDe("--cliente");
if (clientesPedidos.length > 1) throw new Error("--cliente: um código só por vez");
const soCliente = clientesPedidos[0] ?? null;
const conhecidos = new Set(["--gravar", "--competencia", "--cliente", ...competencias, ...(soCliente ? [soCliente] : [])]);
const estranhos = argumentos.filter((arg) => !conhecidos.has(arg));
if (estranhos.length > 0) throw new Error(`argumento desconhecido: ${estranhos.join(" ")}`);

// ── O .env ──────────────────────────────────────────────────────────────────
// O worktree não tem .env.local (não é versionado): cai no do checkout principal, como
// scripts/lsoft/importar-para-supabase.mjs faz. Vai para o `process.env` ANTES de importar a
// régua, porque é de lá que `createApoloAdminClient` lê a URL e a chave.
const ENV_LOCAL = [
  path.resolve(RAIZ, "apps/hub/.env.local"),
  path.resolve(RAIZ, "../../careli-hub/apps/hub/.env.local"),
].find((p) => fs.existsSync(p));
if (!ENV_LOCAL) throw new Error("não achei apps/hub/.env.local");

for (const linha of fs.readFileSync(ENV_LOCAL, "utf8").split("\n")) {
  if (!linha.includes("=") || linha.trim().startsWith("#")) continue;
  const i = linha.indexOf("=");
  const chave = linha.slice(0, i).trim();
  const valor = linha.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  if (chave && process.env[chave] === undefined) process.env[chave] = valor;
}

const req = createRequire(path.resolve(RAIZ, "apps/hub/package.json"));
const { createJiti } = req("jiti");
// O `@` do hub, como em scripts/carteira/subir-garden-para-carteira.mjs.
const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(RAIZ, "apps/hub") } });
const { aplicarBaixasDoHub, baixasParaGravar, decisoesDoCliente, lerBaixaDoHub } = await jiti.import(
  path.resolve(RAIZ, "apps/hub/lib/lsoft/baixa-do-hub.ts"),
);

// ── Utilidades ──────────────────────────────────────────────────────────────
const brl = (valor) =>
  valor === null || valor === undefined
    ? "-"
    : Number(valor).toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
const dia = (iso) => (iso ? String(iso).slice(0, 10).split("-").reverse().join("/") : "-");
const ROTULO = { baixa_nova: "BAIXA NOVA", conferir: "CONFERIR", ja_paga: "JÁ PAGA" };

// ── Ler e decidir ───────────────────────────────────────────────────────────
const modo = gravar ? "GRAVAR" : "ENSAIO";
console.log(`\n== Baixa do hub no Garden (${modo}) ==`);
console.log(`competências: ${competencias.length > 0 ? competencias.join(", ") : "todas a partir de 2026-09"}`);
console.log(`clientes: ${soCliente ? `só o ${soCliente} (lista e gravação)` : "todos os que estão no Financeiro"}`);

const leitura = await lerBaixaDoHub({ competencias });
if (leitura.colunaAusente) {
  console.log("A coluna empreendimentos_na_carteira (0199) não existe: ninguém está no Financeiro, nada a baixar.");
  process.exit(0);
}
const { decisoes, fora, totais } = leitura.resultado;

// ── A lista, por cliente, lote e parcela ────────────────────────────────────
// ⚠️ O MESMO RECORTE NA LISTA E NA GRAVAÇÃO: `alvo` é o que aparece e o que é gravado.
const alvo = soCliente ? decisoesDoCliente(decisoes, soCliente) : decisoes;
const ordem = { baixa_nova: 0, ja_paga: 1, conferir: 2 };
const ordenadas = [...alvo].sort(
  (a, b) =>
    ordem[a.classe] - ordem[b.classe] ||
    String(a.clienteCodigo ?? "~").localeCompare(String(b.clienteCodigo ?? "~")) ||
    a.unidade.localeCompare(b.unidade) ||
    a.competencia.localeCompare(b.competencia),
);

let classeAtual = null;
for (const d of ordenadas) {
  if (d.classe !== classeAtual) {
    classeAtual = d.classe;
    console.log(`\n-- ${ROTULO[d.classe]} --`);
  }
  const parcela = d.parcela
    ? `${d.parcela.rotulo ?? "?"} venc ${dia(d.parcela.vencimento)} (nominal ${brl(d.parcela.valor)}${
        d.parcela.paga ? `, ficha: paga ${brl(d.parcela.valorRecebido)} em ${dia(d.parcela.dataRecebido)}` : ", ficha: em aberto"
      })`
    : "sem parcela";
  console.log(
    [
      `cliente ${d.clienteCodigo ?? "?"}`,
      `${d.unidade} (antigo ${d.loteAntigo ?? "?"})`,
      d.competencia,
      parcela,
      `Asaas ${brl(d.valorPago)} em ${dia(d.pagoEm)}`,
      `cobrança ${d.cobrancaId}`,
    ].join(" | "),
  );
  if (d.classe === "baixa_nova" && d.baixa) {
    console.log(`    grava: paga, recebido ${brl(d.baixa.valorRecebido)} em ${dia(d.baixa.dataRecebido)}`);
  }
  if (d.observacao) console.log(`    ${d.observacao}`);
  if (d.motivo) console.log(`    motivo: ${d.motivo}`);
}

// ── Os totais ───────────────────────────────────────────────────────────────
console.log("\n== Totais (pagamentos pagos do Garden a partir de 2026-09, todos os clientes) ==");
for (const classe of ["baixa_nova", "ja_paga", "conferir"]) {
  console.log(`${ROTULO[classe].padEnd(11)} ${String(totais[classe].quantidade).padStart(4)}  ${brl(totais[classe].valor)}`);
}
const parcelas = baixasParaGravar(alvo);
console.log(
  `parcelas a baixar${soCliente ? ` do cliente ${soCliente}` : ""}: ${parcelas.length} (uma parcela de dois lotes junta dois boletos)`,
);
console.log(`avisos (o que a rodada automática escreve no log): ${decisoes.filter((d) => d.aviso).length}`);
console.log(`fora da conta: ${fora.naoPagos} boleto(s) não pago(s), ${fora.antesDoCorte} antes de 2026-09`);

const porMotivo = new Map();
for (const d of decisoes) {
  if (d.classe !== "conferir") continue;
  // O motivo sem os números que mudam de linha para linha, para agrupar.
  const chave = String(d.motivo).replace(/Q\d+ L\d+/g, "Qxx Lyy").replace(/\b\d{1,5}\b/g, "N");
  porMotivo.set(chave, (porMotivo.get(chave) ?? 0) + 1);
}
if (porMotivo.size > 0) {
  console.log("\nconferir, por motivo:");
  for (const [motivo, quantidade] of [...porMotivo].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(quantidade).padStart(4)}  ${motivo}`);
  }
}

// ── Gravar ──────────────────────────────────────────────────────────────────
if (!gravar) {
  console.log("\nENSAIO: nada foi gravado. Rode com --gravar para aplicar as baixas novas.");
  process.exit(0);
}

console.log(`\nGravando ${parcelas.length} baixa(s)${soCliente ? ` do cliente ${soCliente}` : ""}...`);
const escrita = await aplicarBaixasDoHub(alvo);
console.log(`aplicadas: ${escrita.aplicadas}; puladas (pagas por outra mão no meio): ${escrita.puladas}; falhas: ${escrita.falhas.length}`);
for (const falha of escrita.falhas) console.log(`  FALHA cobrança ${falha.cobrancas}: ${falha.erro}`);
process.exit(escrita.falhas.length > 0 ? 1 : 0);
