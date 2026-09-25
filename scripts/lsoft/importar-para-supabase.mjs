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
// ⚠️ A ESCRITA É NO ESPELHO NOSSO, nunca no LSoft, que segue read-only. `--ensaio` confere a leitura
// dos CSVs e para antes de gravar.
//
// ⚠️ DESDE 24/09/2026 A CARGA GRAVA ANTES DE APAGAR, e só apaga os empreendimentos que vieram nela.
// A ordem e o "desfazer" moram em `apps/hub/lib/lsoft/carga.ts`, que é testado. O motivo está no
// registro de `lsoft_sincronizacoes`: em 08/09 uma carga falhou depois de apagar tudo e o espelho
// ficou vazio por 41 minutos; outra, só do Vale do Ouro, apagou o Garden e o Vale do Sol.
//
// ⚠️ NO FIM, OS DOIS RELIGADORES RODAM SOZINHOS: a trilha de edição (0188) e a classificação da
// Caixa (0103). Sem eles, entre a carga e alguém lembrar de rodá-los, a tela mostra baixas sem
// parcela e o dinheiro da Caixa como dívida do cliente.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");
const { createJiti } = req("jiti");
const jiti = createJiti(import.meta.url);
const lib = (arquivo) => jiti.import(path.resolve(process.cwd(), "apps/hub/lib/lsoft", arquivo));
const { executarCarga } = await lib("carga.ts");
const { mesclarCliente } = await lib("mesclar-cliente.ts");
const { divergenciasDaCarga } = await lib("divergencia-da-carga.ts");
const { classificarTitulo } = await lib("categorias.ts");

const aceitarPerdaDeEdicao = process.argv.includes("--aceitar-perda-de-edicao");

const pasta = process.argv[2];
const ensaio = process.argv.includes("--ensaio");
if (!pasta) throw new Error("informe a pasta com os CSVs (LSOFT_CLIENTES.csv etc.)");

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

// ⚠️ DE QUAL CATEGORIA VEIO, E DE QUAL EMPREENDIMENTO É (migration 0189).
//
// Os extratores antigos (Garden e Vale do Sol, Vale do Ouro) mandam o NOME pronto e não mandam a
// categoria; cada um desses nomes veio de uma categoria só, então ela é deduzida do nome. O extrator
// por categoria (extrair-por-categoria.ps1) manda a CATEGORIA e deixa o nome em branco: quem decide o
// nome é a regra testada de lib/lsoft/categorias.ts, que lê o texto de OBSERVACOES quando a
// categoria mistura produtos (a 17 e a 115).
//
// Título que nem a categoria nem o texto identificam vai para "A classificar", e NÃO é descartado:
// o time precisa vê-lo para classificar. Antes, sem empreendimento, ele sumia em silêncio.
const CATEGORIA_DO_NOME = { Garden: 124, "Vale do Sol": 102, "Vale do Ouro - 2": 69 };
function origemDaParcela(l) {
  const categoria = texto(l.CATEGORIA);
  if (categoria !== null) {
    const c = classificarTitulo({ categoria, observacoes: l.OBSERVACOES });
    return { categoria_lsoft: Number(categoria), empreendimento: c.empreendimento ?? "A classificar" };
  }
  const nome = texto(l.EMPREENDIMENTO);
  const deduzida = nome ? CATEGORIA_DO_NOME[nome] : undefined;
  if (deduzida === undefined) {
    throw new Error(`linha sem CATEGORIA e com empreendimento "${nome}", que não tem categoria conhecida. Use extrair-por-categoria.ps1.`);
  }
  return { categoria_lsoft: deduzida, empreendimento: nome };
}

function montarParcela(l, origem) {
  const partes = partesDaParcela(l.PARCELA);
  const unidade = unidadeDasObservacoes(l.OBSERVACOES);
  const recebido = numero(l.VALORRECEBIDO);
  const daOrigem = origemDaParcela(l);
  return {
    boleto: texto(l.BOLETO),
    categoria_lsoft: daOrigem.categoria_lsoft,
    cliente_codigo: texto(l.CLIENTE),
    data_recebido: data(l.DATARECEBIDO),
    empreendimento: daOrigem.empreendimento,
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

// ── LEITURA DO QUE O BANCO JÁ TEM (só leitura, roda também no ensaio) ──────
//
// ⚠️ ORDEM FIXA E CONFERÊNCIA DE DISTINTOS em toda leitura paginada: sem `order`, uma página pode
// repetir uma linha e pular outra, e o total bate (medido em 24/09/2026 no reconciliar-trilha).
async function lerTudo(tabela, colunas, ordem, filtro) {
  const linhas = [];
  for (let de = 0; ; de += 1000) {
    let q = supabase.from(tabela).select(colunas).order(ordem).range(de, de + 999);
    if (filtro) q = filtro(q);
    const { data: bloco, error } = await q;
    if (error) throw new Error(`${tabela}: ${error.message}`);
    linhas.push(...(bloco ?? []));
    if (!bloco || bloco.length < 1000) break;
  }
  if (new Set(linhas.map((l) => l[ordem])).size !== linhas.length) {
    throw new Error(`${tabela}: leitura instável (ids repetidos), abortado antes de gravar qualquer coisa.`);
  }
  return linhas;
}

const empreendimentosDaCarga = [...new Set(parcelas.map((p) => p.empreendimento))].sort();

// O cadastro: o que o banco tem e o que o time corrigiu na tela (trilha sem o prefixo "parcela.").
const colunasDoCliente = [...new Set(clientes.flatMap((c) => Object.keys(c)))].join(", ");
const clientesDoBanco = new Map(
  (await lerTudo("lsoft_clientes", colunasDoCliente, "codigo")).map((c) => [c.codigo, c]),
);
const editadosNaTela = new Map();
for (const e of await lerTudo("lsoft_clientes_edicoes", "id, cliente_codigo, campo", "id", (q) =>
  q.not("campo", "like", "parcela.%"),
)) {
  const s = editadosNaTela.get(e.cliente_codigo) ?? new Set();
  s.add(e.campo);
  editadosNaTela.set(e.cliente_codigo, s);
}
const clientesMesclados = clientes.map((c) =>
  mesclarCliente(c, clientesDoBanco.get(c.codigo), editadosNaTela.get(c.codigo)),
);
const preservados = clientesMesclados.reduce(
  (n, c, i) => n + Object.keys(c).filter((k) => k !== "empreendimentos" && c[k] !== clientes[i][k]).length,
  0,
);
console.log(`cadastro: ${clientesDoBanco.size} clientes já no banco · ${preservados} campo(s) preservados do banco em vez de apagados`);

// ── A CARGA DESFARIA ALGUMA EDIÇÃO DO TIME? ─────────────────────────────────
//
// ⚠️ SÓ A TRILHA DAS PARCELAS QUE ESTA CARGA VAI APAGAR, ou seja, das categorias dela. Filtrar pelo
// nome do empreendimento misturaria as coisas: a carga da 17 traz "Vale do Sol", mas não apaga o Vale
// do Sol da 102, e a trilha dele não corre risco nenhum. Contar essa trilha como "sem par" travaria
// a carga à toa.
const categoriasDaCarga = new Set(parcelas.map((p) => p.categoria_lsoft));
const trilhaToda = await lerTudo(
  "lsoft_clientes_edicoes",
  "id, parcela_id, impressao_digital, ordinal, cliente_codigo, empreendimento_no_momento, vencimento_no_momento, valor_no_momento, campo, valor_novo, criado_em, parcela_rotulo",
  "id",
  (q) => q.not("impressao_digital", "is", null).not("parcela_id", "is", null),
);
const categoriaDaParcela = new Map();
const idsReferenciados = [...new Set(trilhaToda.map((l) => l.parcela_id))];
for (let i = 0; i < idsReferenciados.length; i += 100) {
  // Lotes de 100: `.in()` longo estoura a URL do PostgREST (ver reference_postgrest_in_url_limite).
  const { data: bloco, error } = await supabase
    .from("lsoft_parcelas")
    .select("id, categoria_lsoft")
    .in("id", idsReferenciados.slice(i, i + 100));
  if (error) throw new Error(`lsoft_parcelas (categoria da trilha): ${error.message}`);
  for (const p of bloco ?? []) categoriaDaParcela.set(p.id, p.categoria_lsoft);
}
const trilha = trilhaToda.filter((l) => categoriasDaCarga.has(categoriaDaParcela.get(l.parcela_id)));
const conferencia = divergenciasDaCarga(
  trilha,
  parcelas.map((p, i) => ({ ...p, id: `carga-${String(i).padStart(6, "0")}` })),
);
const perdas = conferencia.divergencias.length + conferencia.semParcela.length;
console.log(
  `edições do time nestes empreendimentos: ${conferencia.parcelasEditadas} parcela(s) · ` +
    `${conferencia.divergencias.length} campo(s) que a carga DESFARIA · ` +
    `${conferencia.semParcela.length} parcela(s) editada(s) que a carga não traz`,
);
for (const d of conferencia.divergencias.slice(0, 20)) {
  console.log(`   ${d.cliente_codigo} · ${d.parcela_rotulo} · ${d.campo}: na tela "${d.naTela}" → a carga grava "${d.naCarga}"`);
}
if (conferencia.divergencias.length > 20) console.log(`   ... e mais ${conferencia.divergencias.length - 20}`);
for (const s of conferencia.semParcela.slice(0, 10)) {
  console.log(`   ${s.cliente_codigo} · ${s.parcela_rotulo} · editada em ${s.campos.join(", ")}: SEM PAR na carga`);
}

if (ensaio) {
  console.log(`\nENSAIO: nada gravado. Empreendimentos desta carga: ${empreendimentosDaCarga.join(", ")}.`);
  console.log(perdas === 0 ? "A carga pode rodar sem desfazer trabalho do time." : "A carga real vai PARAR aqui (ver acima).");
  process.exit(0);
}

// ⚠️ A TRAVA. Decisão do Lucas (19/08/2026): depois da carga única, o Panteon é a verdade. Uma carga
// que desfaz baixa ou correção feita na tela não roda sem alguém dizer, com todas as letras, que
// aceita perder aquilo. Para empreendimento novo não existe edição, e ela passa sozinha.
if (perdas > 0 && !aceitarPerdaDeEdicao) {
  console.error(
    `\nCARGA RECUSADA antes de gravar qualquer coisa: ela desfaria ${perdas} edição(ões) do time (lista acima).\n` +
      `Confira no LSoft. Só rode com --aceitar-perda-de-edicao se o LSoft estiver certo e a tela, errada.`,
  );
  process.exit(1);
}

// ⚠️ UMA CARGA POR VEZ. Duas cargas do mesmo empreendimento ao mesmo tempo apagam uma a outra (cada
// uma trata a outra como "antiga"). Recusa se existe outra aberta nos últimos 30 minutos.
const { data: abertas, error: erroAbertas } = await supabase
  .from("lsoft_sincronizacoes")
  .select("id, iniciado_em, erro")
  .is("concluido_em", null)
  .gte("iniciado_em", new Date(Date.now() - 30 * 60 * 1000).toISOString());
if (erroAbertas) throw new Error(`não consegui conferir cargas em andamento: ${erroAbertas.message}`);
if ((abertas ?? []).length > 0) {
  console.error(`\nCARGA RECUSADA: já existe outra em andamento (${abertas.map((a) => a.iniciado_em).join(", ")}).`);
  process.exit(1);
}

// ⚠️ A MARCA DESTA CARGA vai IGUAL em `sincronizado_em` de todas as parcelas. É ela que separa as
// novas das antigas na hora de apagar, e as desta carga das outras na hora de desfazer.
//
// ⚠️ A IGUALDADE É EXATA, e é isso que torna a marca segura. Medido em 24/09/2026 contra o banco,
// só lendo: uma marca real com microssegundos casa com as suas 500 parcelas nos três jeitos de
// escrever o mesmo instante (-03:00, Z, +00:00), e dá ZERO quando truncada em milissegundos. Ou
// seja, duas cargas nunca se confundem. Esta marca sai do `Date`, com milissegundos, e é o MESMO
// literal na gravação e no filtro, então bate. O "Z" é só precaução: a versão atual do supabase-js
// codifica o "+" certo, mas "Z" não depende disso.
const marca = new Date().toISOString();

// ⚠️ A MARCA FICA ANOTADA NO REGISTRO desde o começo. Se o processo morrer entre gravar as novas e
// apagar as antigas (Ctrl+C, queda de energia), o registro fica aberto dizendo QUAL marca sobrou, e
// a próxima carga do mesmo empreendimento limpa essas parcelas sozinha (elas viram "antigas").
const { data: sincronizacao, error: erroSincronizacao } = await supabase
  .from("lsoft_sincronizacoes")
  .insert({ erro: `em andamento · marca ${marca} · ${empreendimentosDaCarga.join(", ")}` })
  .select("id")
  .single();
if (erroSincronizacao || !sincronizacao) {
  throw new Error(`não consegui abrir o registro da carga: ${erroSincronizacao?.message ?? "sem retorno"}`);
}

// ⚠️ A PARCELA MUDA DE TABELA NO LSOFT quando é paga (sai de RECEBER, entra em RECEBIDOS), sem id
// estável entre as duas. Por isso cada carga SUBSTITUI o empreendimento inteiro, em vez de tentar
// atualizar parcela a parcela: é o que impede a mesma parcela de aparecer aberta e paga.
const banco = {
  async gravarClientes(lote) {
    const { error } = await supabase.from("lsoft_clientes").upsert(lote, { onConflict: "codigo" });
    return error ? { erro: error.message } : {};
  },
  async gravarParcelas(lote) {
    const { error } = await supabase.from("lsoft_parcelas").insert(lote);
    return error ? { erro: error.message } : {};
  },
  // ⚠️ POR CATEGORIA, não por empreendimento (migration 0189): a carga da 17 traz Vale do Sol e não
  // pode apagar o Vale do Sol que veio da 102.
  async apagarAntigas(categorias, marcaDaCarga) {
    const { error } = await supabase
      .from("lsoft_parcelas")
      .delete()
      .in("categoria_lsoft", categorias)
      .neq("sincronizado_em", marcaDaCarga);
    return error ? { erro: error.message } : {};
  },
  async apagarDaCarga(marcaDaCarga) {
    const { error } = await supabase.from("lsoft_parcelas").delete().eq("sincronizado_em", marcaDaCarga);
    return error ? { erro: error.message } : {};
  },
  // Só leitura, com o MESMO filtro do apagamento: é a prova de que ele efetivou ou não.
  async contarAntigas(categorias, marcaDaCarga) {
    const { count, error } = await supabase
      .from("lsoft_parcelas")
      .select("id", { count: "exact", head: true })
      .in("categoria_lsoft", categorias)
      .neq("sincronizado_em", marcaDaCarga);
    return error ? { erro: error.message } : { total: count ?? undefined };
  },
};

const resultado = await executarCarga({
  aoProgresso: (etapa, feitas, total) => process.stdout.write(`\r  ${etapa}: ${feitas}/${total}   `),
  banco,
  // ⚠️ O cadastro MESCLADO, não o cru do LSoft: o cru apagaria com nulo o que o MOST e o time
  // preencheram. Foi assim que 200 mães e 218 nascimentos sumiram em 08/09 e 16/09.
  clientes: clientesMesclados,
  marca,
  parcelas,
});
process.stdout.write("\n");

if (!resultado.ok) {
  // O passo e se o espelho ficou intacto vão no texto do erro: a tabela não tem coluna para isso, e
  // quem abrir o registro precisa saber na hora se a tela da Cecílio está normal ou não.
  const situacao = resultado.espelhoIntacto
    ? "espelho INTACTO (a carga anterior continua valendo)"
    : "espelho COM SOBRAS desta carga";
  await supabase
    .from("lsoft_sincronizacoes")
    .update({
      concluido_em: new Date().toISOString(),
      erro: `[${resultado.passo}] ${resultado.erro} · ${situacao}`,
      ok: false,
    })
    .eq("id", sincronizacao.id);
  console.error(`\nCARGA FALHOU no passo "${resultado.passo}": ${resultado.erro}`);
  console.error(situacao);
  process.exit(1);
}

await supabase
  .from("lsoft_sincronizacoes")
  .update({
    clientes: resultado.clientes,
    concluido_em: new Date().toISOString(),
    // Tira o "em andamento"; o aviso fica se o apagamento respondeu erro mas tinha efetivado.
    erro: resultado.aviso ?? null,
    ok: true,
    parcelas: resultado.parcelas,
  })
  .eq("id", sincronizacao.id);

if (resultado.aviso) console.log(`\naviso: ${resultado.aviso}`);
console.log(`\ncarga concluída: ${resultado.parcelas} parcelas em ${resultado.empreendimentos.join(", ")}.`);

// ── OS DOIS RELIGADORES ─────────────────────────────────────────────────────
//
// ⚠️ RODAM COMO PROCESSO À PARTE, com o mesmo comando que se roda à mão. Assim o que roda aqui é
// exatamente o que foi testado e simulado contra produção, e não uma segunda cópia da lógica.
//
// ⚠️ FALHA AQUI NÃO DESFAZ A CARGA. A carga já está certa; o que ficou para trás são vínculos, e os
// dois scripts podem ser rodados de novo a qualquer momento sem estrago. Por isso só avisa.
let religamentoOk = true;
for (const script of ["reconciliar-trilha.mjs", "reconciliar-classificacao.mjs"]) {
  console.log(`\n── ${script} ──`);
  const r = spawnSync(process.execPath, [path.resolve(process.cwd(), "scripts/lsoft", script)], {
    cwd: process.cwd(),
    stdio: "inherit",
  });
  if (r.status !== 0) {
    religamentoOk = false;
    console.error(`⚠️ ${script} terminou com código ${r.status}. Rode de novo à mão: node scripts/lsoft/${script}`);
  }
}

console.log(religamentoOk ? "\nimportação concluída e religada." : "\nimportação concluída; RELIGAMENTO PENDENTE (ver acima).");
