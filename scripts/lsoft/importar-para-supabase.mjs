// IMPORTA a carteira do LSoft (Garden e Vale do Sol) para o Supabase.
//
// Pedido do Lucas (19/08/2026): tela própria para ver cadastro e parcelas, como POC da integração
// com Apolo e C2X.
//
//   node scripts/lsoft/importar-para-supabase.mjs <pasta-dos-csv>
//   node scripts/lsoft/importar-para-supabase.mjs <pasta-dos-csv> --ensaio
//
// ⚠️ RODA DAQUI, NÃO DA VERCEL. O LSoft vive em `\\SERVIDOR\Sistema` (rede local da Cecílio); só a
// máquina que enxerga esse caminho consegue gerar os CSVs e alimentar o espelho.
//
// ⚠️ ENSAIO É O PADRÃO EM SPIRIT, MAS NÃO NO CÓDIGO: aqui a escrita é upsert idempotente numa
// tabela ESPELHO nossa (nada é enviado ao LSoft, que segue read-only), então rodar de novo apenas
// atualiza. Ainda assim `--ensaio` existe para conferir a leitura antes de gravar.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");

const pasta = process.argv[2];
const ensaio = process.argv.includes("--ensaio");
if (!pasta) throw new Error("informe a pasta com os CSVs (LSOFT_CLIENTES.csv etc.)");

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

// ── LEITURA DO CSV ──────────────────────────────────────────────────────────
// O CSV vem do Export-Csv do PowerShell: separador ";", tudo entre aspas, aspas internas dobradas.
function lerCsv(arquivo) {
  const texto = fs.readFileSync(path.join(pasta, arquivo), "utf8").replace(/^﻿/, "");
  const linhas = [];
  let campo = "";
  let atual = [];
  let dentroDeAspas = false;

  for (let i = 0; i < texto.length; i += 1) {
    const c = texto[i];
    if (dentroDeAspas) {
      if (c === '"' && texto[i + 1] === '"') { campo += '"'; i += 1; }
      else if (c === '"') dentroDeAspas = false;
      else campo += c;
      continue;
    }
    if (c === '"') dentroDeAspas = true;
    else if (c === ";") { atual.push(campo); campo = ""; }
    else if (c === "\n") { atual.push(campo); linhas.push(atual); atual = []; campo = ""; }
    else if (c !== "\r") campo += c;
  }
  if (campo || atual.length) { atual.push(campo); linhas.push(atual); }

  const cabecalho = linhas.shift() ?? [];
  return linhas
    .filter((l) => l.length === cabecalho.length)
    .map((l) => Object.fromEntries(cabecalho.map((nome, i) => [nome, l[i]])));
}

// ── CONVERSORES ─────────────────────────────────────────────────────────────
const texto = (v) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};
const digitos = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d === "" ? null : d;
};
/** "10/09/2026 00:00:00" ou "10/09/2026" -> "2026-09-10". */
const data = (v) => {
  const m = String(v ?? "").match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
/** "2119,05" -> 2119.05. O CSV sai com vírgula decimal. */
const numero = (v) => {
  const t = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
};

/**
 * "007/084" -> { numero: 7, total: 84 }.
 *
 * Aceita também "1/36" e devolve nulos quando não casa: nem toda linha tem parcela.
 */
function partesDaParcela(v) {
  const m = String(v ?? "").match(/(\d+)\s*\/\s*(\d+)/);
  return m ? { numero: Number(m[1]), total: Number(m[2]) } : { numero: null, total: null };
}

/**
 * Tira lote e quadra do texto livre das observações.
 *
 * ⚠️ O LSOFT NÃO TEM CAMPO DE UNIDADE, e o formato varia de lançamento para lançamento:
 *   "LOTE: 109 QUADRA: 08"     · "LOTE 3 QUADRA 8 70.000 PERMUTA"
 *   "LOTE: 367 - QUADRA: 13"   · e antigos com "APARTAMENTO 302- 1 VAGA"
 * Por isso o texto original SEMPRE é guardado junto: o parse é uma conveniência para a tela
 * agrupar e filtrar, não a verdade. Quando o número não bater com o Apolo, é no texto que se olha.
 */
function unidadeDasObservacoes(obs) {
  const t = String(obs ?? "").toUpperCase();
  const lote = t.match(/LOTE\s*:?\s*(\d+)/);
  const quadra = t.match(/QUADRA\s*:?\s*(\d+)/);
  return {
    lote: lote ? String(Number(lote[1])) : null,
    quadra: quadra ? String(Number(quadra[1])) : null,
  };
}

// ── CARGA ───────────────────────────────────────────────────────────────────
const clientesCsv = lerCsv("LSOFT_CLIENTES.csv");
const receberCsv = lerCsv("LSOFT_A_RECEBER.csv");
const recebidosCsv = lerCsv("LSOFT_RECEBIDOS.csv");

console.log(`lidos: ${clientesCsv.length} clientes · ${receberCsv.length} a receber · ${recebidosCsv.length} recebidos`);

// Em quais empreendimentos cada cliente aparece.
const empreendimentosPorCliente = new Map();
for (const l of [...receberCsv, ...recebidosCsv]) {
  const cod = texto(l.CLIENTE);
  if (!cod) continue;
  const atual = empreendimentosPorCliente.get(cod) ?? new Set();
  if (l.EMPREENDIMENTO) atual.add(l.EMPREENDIMENTO);
  empreendimentosPorCliente.set(cod, atual);
}

const clientes = clientesCsv.map((c) => ({
  bairro: texto(c.BAIRRO),
  bloqueado: /^(sim|true|-1|1)$/i.test(String(c.BLOQUEADO ?? "").trim()),
  celular: texto(c.CELULAR),
  cep: texto(c.CEP),
  cidade: texto(c.CIDADE),
  codigo: texto(c.CODIGO),
  conjuge: texto(c.CONJUGE),
  cpf: digitos(c.CPF),
  cpf_formatado: texto(c.CPF),
  data_cadastro: data(c.DATACADAST),
  email: texto(c.EMAIL),
  empreendimentos: [...(empreendimentosPorCliente.get(texto(c.CODIGO)) ?? [])],
  endereco: texto(c.ENDERECO),
  estado: texto(c.ESTADO),
  mae: texto(c.MAE),
  nascimento: data(c.NASCIMENTO),
  nome: texto(c.NOME) ?? "(sem nome)",
  pai: texto(c.PAI),
  rg: texto(c.RG),
  telefone: texto(c.TELEFONE),
  vendedor: texto(c.VENDEDOR),
}));

const codigosConhecidos = new Set(clientes.map((c) => c.codigo));

function montarParcela(l, origem) {
  const partes = partesDaParcela(l.PARCELA);
  const unidade = unidadeDasObservacoes(l.OBSERVACOES);
  const recebido = numero(l.VALORRECEBIDO);
  return {
    boleto: texto(l.BOLETO),
    cliente_codigo: texto(l.CLIENTE),
    data_recebido: data(l.DATARECEBIDO),
    empreendimento: texto(l.EMPREENDIMENTO),
    lote: unidade.lote,
    nro_nota: texto(l.NRONOTA),
    observacoes: texto(l.OBSERVACOES),
    origem,
    // "Paga" = veio da tabela de recebidos, ou tem valor recebido registrado.
    paga: origem === "recebido" || recebido > 0,
    parcela: texto(l.PARCELA),
    parcela_numero: partes.numero,
    parcela_total: partes.total,
    quadra: unidade.quadra,
    situacao: texto(l.SITUACAO),
    valor: numero(l.VALOR),
    valor_recebido: recebido,
    vencimento: data(l.VENCIMENTO),
  };
}

const parcelas = [
  ...receberCsv.map((l) => montarParcela(l, "receber")),
  ...recebidosCsv.map((l) => montarParcela(l, "recebido")),
  // Parcela órfã (cliente que não veio no cadastro) quebraria a foreign key e derrubaria o lote
  // inteiro. Fica de fora, contada abaixo.
].filter((p) => p.cliente_codigo && codigosConhecidos.has(p.cliente_codigo) && p.empreendimento);

const orfas = receberCsv.length + recebidosCsv.length - parcelas.length;

console.log(`preparados: ${clientes.length} clientes · ${parcelas.length} parcelas` +
  (orfas > 0 ? ` (${orfas} descartadas por não ter cliente no cadastro)` : ""));
console.log(`com lote/quadra identificados: ${parcelas.filter((p) => p.lote || p.quadra).length}`);

if (ensaio) {
  console.log("\nENSAIO — nada gravado. Amostra:");
  console.log(JSON.stringify(clientes[0], null, 2));
  console.log(JSON.stringify(parcelas[0], null, 2));
  process.exit(0);
}

const { data: sincronizacao } = await supabase
  .from("lsoft_sincronizacoes")
  .insert({})
  .select("id")
  .single();

async function emLotes(tabela, linhas, conflito) {
  let feitas = 0;
  for (let i = 0; i < linhas.length; i += 500) {
    const lote = linhas.slice(i, i + 500);
    const { error } = await supabase.from(tabela).upsert(lote, { onConflict: conflito });
    if (error) throw new Error(`${tabela}: ${error.message}`);
    feitas += lote.length;
    process.stdout.write(`\r  ${tabela}: ${feitas}/${linhas.length}`);
  }
  process.stdout.write("\n");
  return feitas;
}

try {
  // ⚠️ A PARCELA MUDA DE TABELA NO LSOFT quando é paga (sai de RECEBER, entra em RECEBIDOS). Como
  // não há id estável entre as duas, a recarga limpa e regrava: é o que garante que uma parcela
  // quitada não fique duplicada, aparecendo como aberta e paga ao mesmo tempo.
  await supabase.from("lsoft_parcelas").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  await emLotes("lsoft_clientes", clientes, "codigo");
  await emLotes("lsoft_parcelas", parcelas);

  await supabase
    .from("lsoft_sincronizacoes")
    .update({
      clientes: clientes.length,
      concluido_em: new Date().toISOString(),
      ok: true,
      parcelas: parcelas.length,
    })
    .eq("id", sincronizacao.id);

  console.log("\nimportação concluída.");
} catch (erro) {
  await supabase
    .from("lsoft_sincronizacoes")
    .update({ concluido_em: new Date().toISOString(), erro: String(erro), ok: false })
    .eq("id", sincronizacao.id);
  throw erro;
}
