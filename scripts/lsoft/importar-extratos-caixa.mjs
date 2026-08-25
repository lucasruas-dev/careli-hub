// IMPORTA OS EXTRATOS DA CAIXA (CIWEB) do Vale do Sol para o Panteon.
//
// Lucas (25/08/2026): *"todos os pagamentos da caixa estão nos extratos"*. O LSoft não sabe desse
// dinheiro: ele tem R$ 598 mil baixados nas parcelas de subsídio, o extrato tem R$ 8,44 mi.
//
// COMO USAR (da máquina que enxerga o \\SERVIDOR):
//   node scripts/lsoft/importar-extratos-caixa.mjs            → ENSAIO, não grava
//   node scripts/lsoft/importar-extratos-caixa.mjs --gravar    → grava de verdade
//
// ⚠️ SÓ `CR DESBLOQ` ENTRA. Das 31 rubricas do extrato, é a única que é entrada de dinheiro da
// Caixa. As outras (RESG AUT, RG CDB 95, aplicações) são movimentação da própria construtora e
// abateriam dívida de cliente com dinheiro que não é dele.
//
// ⚠️ REIMPORTAR É SEGURO. A trava única (conta, contrato, data, valor, posição no dia) faz o
// upsert ignorar o que já existe — o extrato do mês vem com os meses anteriores juntos.
//
// ⚠️ ENCODING: os arquivos são ASCII puro no conteúdo, mas o NOME tem acento ("MARÇO 2026.txt").
// Lemos em latin1 para o nome não quebrar o parser.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const RAIZ = "//SERVIDOR/Dados/Atalho Amanda/VALE DO SOL/CIWEB CEF/EXTRATOS";
const GRAVAR = process.argv.includes("--gravar");

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");

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

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function acharTxt(dir) {
  const saida = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, item.name);
    if (item.isDirectory()) saida.push(...acharTxt(p));
    else if (item.name.toLowerCase().endsWith(".txt")) saida.push(p);
  }
  return saida;
}

// ── 1. Ler os extratos ──────────────────────────────────────────────────────
const arquivos = acharTxt(RAIZ);
console.log(`${arquivos.length} arquivos em ${RAIZ}`);

const creditos = [];
let totalLinhas = 0;
for (const arq of arquivos) {
  const linhas = fs.readFileSync(arq, "latin1").split(/\r?\n/).filter((l) => l.trim());
  for (const linha of linhas.slice(1)) {
    const campos = linha.split(";").map((c) => c.replace(/^"|"$/g, "").trim());
    if (campos.length < 6) continue;
    const [conta, data, doc, historico, valor, dc] = campos;
    if (!/^\d{8}$/.test(data)) continue;
    totalLinhas++;
    if (historico !== "CR DESBLOQ" || dc !== "C") continue;
    const n = Number(valor);
    if (!Number.isFinite(n) || n <= 0) continue;
    creditos.push({
      arquivo_origem: path.basename(arq),
      conta,
      contrato_caixa: doc,
      data_movimento: `${data.slice(0, 4)}-${data.slice(4, 6)}-${data.slice(6, 8)}`,
      historico,
      valor: n,
    });
  }
}
console.log(`${totalLinhas} lancamentos lidos · ${creditos.length} sao CR DESBLOQ`);

// ── 2. Marcar principal x secundario dentro de cada (contrato, dia) ─────────
// O maior credito do dia e a liberacao principal; os menores ficam a parte na tela.
const porGrupo = new Map();
for (const c of creditos) {
  const chave = `${c.contrato_caixa}|${c.data_movimento}`;
  if (!porGrupo.has(chave)) porGrupo.set(chave, []);
  porGrupo.get(chave).push(c);
}
for (const itens of porGrupo.values()) {
  itens.sort((a, b) => b.valor - a.valor);
  itens.forEach((c, i) => {
    c.posicao_no_dia = i + 1;
    c.eh_principal = i === 0;
  });
}

const principal = creditos.filter((c) => c.eh_principal).reduce((s, c) => s + c.valor, 0);
const secundario = creditos.filter((c) => !c.eh_principal).reduce((s, c) => s + c.valor, 0);
const contratos = new Set(creditos.map((c) => c.contrato_caixa));

console.log(`\n### O QUE A CAIXA LIBEROU`);
console.log(`  total:      R$ ${(principal + secundario).toFixed(2)}`);
console.log(`  principal:  R$ ${principal.toFixed(2)} (o maior credito de cada medicao)`);
console.log(`  secundario: R$ ${secundario.toFixed(2)} (os menores, mostrados a parte)`);
console.log(`  contratos:  ${contratos.size} · medicoes: ${porGrupo.size}`);

if (!GRAVAR) {
  console.log(`\nENSAIO — nada foi gravado. Rode com --gravar para valer.`);
  process.exit(0);
}

// ── 3. Gravar (upsert idempotente pela trava unica) ────────────────────────
let gravados = 0;
for (let i = 0; i < creditos.length; i += 500) {
  const lote = creditos.slice(i, i + 500);
  const { error } = await supabase
    .from("lsoft_credito_da_caixa")
    .upsert(lote, {
      ignoreDuplicates: true,
      onConflict: "conta,contrato_caixa,data_movimento,valor,posicao_no_dia",
    });
  if (error) {
    console.error(`  ERRO no lote ${i}: ${error.message}`);
    process.exit(1);
  }
  gravados += lote.length;
  console.log(`  ${gravados}/${creditos.length}`);
}

const { count } = await supabase
  .from("lsoft_credito_da_caixa")
  .select("id", { count: "exact", head: true });
console.log(`\n### tabela agora tem ${count} creditos`);
