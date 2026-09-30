// SOBE A CARTEIRA DO GARDEN VALIDADO PARA O FINANCEIRO DO PORTAL (cecilio-rocha).
//
// Pedido do Lucas (29/09/2026): os clientes do Garden que o time adm validou com OK na planilha
// saem da tela LSoft Integração e aparecem na carteira do Financeiro; os com observação ficam na
// integração. *"uma coisa simples, que já está validado"*, *"é só copiar e colar na carteira"*, e
// *"esquece o c2x, cecilio não tem nenhum vinculo com o legado c2x"*: nada aqui fala com o C2X.
//
//   node scripts/carteira/subir-garden-para-carteira.mjs                       (ENSAIO: só lê e mostra)
//   node scripts/carteira/subir-garden-para-carteira.mjs --gravar              (sobe os 106)
//   node scripts/carteira/subir-garden-para-carteira.mjs --desfazer --ensaio   (mostra o que o desfazer faria)
//   node scripts/carteira/subir-garden-para-carteira.mjs --desfazer            (devolve os 106 à integração)
//
// Rode da RAIZ do repositório.
//
// ⚠️ "COPIAR E COLAR" SEM DUPLICAR. As parcelas continuam em `lsoft_parcelas`. O que este script
// grava é o MARCADOR `lsoft_clientes.empreendimentos_na_carteira` (migration 0199): com 'Garden'
// ali, o Financeiro lê as parcelas do Garden desse cliente e a integração deixa de mostrá-las. A
// baixa continua sendo dada na ficha do LSoft, com trilha.
//
// ⚠️ A LISTA É O JSON, e não uma consulta. `scripts/carteira/dados/garden-na-carteira-2026-09-29.json`
// tem os 106 que sobem (código do LSoft, unidade NOVA do boleto, status e observação) e os 35 que
// ficam, conferidos no centavo num projeto anterior. A carteira fica no lote novo do boleto
// (decisão do Lucas); o ensaio mostra lado a lado a unidade do JSON e a do espelho.
//
// ⚠️ ENSAIO POR PADRÃO. Sem `--gravar` nem `--desfazer`, só SELECT. O ensaio funciona antes da
// migration 0199 (a coluna ainda não existe: ele avisa e calcula como se a lista estivesse vazia);
// gravar e desfazer exigem a coluna.
//
// ⚠️ O ENSAIO BLOQUEIA A GRAVAÇÃO quando algo não fecha: código que não existe, cliente sem parcela
// do Garden, parcela do Garden fora da categoria 124 (a 17, patrimônio, sairia da integração sem ir
// para o Financeiro, que lê só a 124), subsídio da Caixa marcado no Garden (a view 0107 deixaria de
// ser igual à parte do Garden na 0097, e o desconto da tela erraria), ou a linha do Garden da view
// 0107 diferente da soma direta das parcelas.
//
// ⚠️ IDEMPOTENTE E CLIENTE A CLIENTE. Rodar duas vezes não duplica o 'Garden' nem a trilha; cada
// escrita tem o erro conferido e a quantidade de linhas afetada verificada, e a falha de um cliente
// não para os outros (o resumo diz quem falhou e o processo sai com código 1).
//
// ⚠️ `--desfazer` DESFAZ O QUE O `--gravar` FEZ, e não só a lista (revisão de 29/09/2026). Tirar
// só o 'Garden' devolvia os 95 à integração como "validado", fora do filtro "Só o que falta
// validar", com o carimbo do script e a observação "migrado para a carteira do Panteon", que
// deixava de ser verdade. Agora ele devolve, PELA TRILHA, status, carimbo (validado_em e
// validado_por) e observação ao valor de antes, mas só o campo que ainda está como o `--gravar`
// deixou: o que alguém mudou na tela depois disso fica como está, e vai para os avisos. A escrita
// do desfazer entra na trilha com outro autor (`AUTOR_DO_DESFAZER`), para um segundo desfazer não
// confundir a volta com a subida.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const RAIZ = process.cwd();
if (!fs.existsSync(path.resolve(RAIZ, "apps/hub/package.json"))) {
  throw new Error("rode da raiz do repositório (não achei apps/hub/package.json)");
}

const req = createRequire(path.resolve(RAIZ, "apps/hub/package.json"));
const { createClient } = req("@supabase/supabase-js");
const { createJiti } = req("jiti");
// O `@` do hub, como em scripts/temis/espelhar-d4sign.mjs: `na-carteira.ts` importa `@/lib/...`.
const jiti = createJiti(import.meta.url, { alias: { "@": path.resolve(RAIZ, "apps/hub") } });
// A mesma régua da tela: o que é lista vazia e o que é "coluna ainda não existe".
const { COLUNA_NA_CARTEIRA, colunaNaCarteiraAusente, devolucaoDoCampo, listaNaCarteira } = await jiti.import(
  path.resolve(RAIZ, "apps/hub/lib/lsoft/na-carteira.ts"),
);
const { hojeNaCasa } = await jiti.import(path.resolve(RAIZ, "apps/hub/lib/guardian/hoje-na-casa.ts"));
const { GARDEN } = await jiti.import(path.resolve(RAIZ, "apps/hub/lib/lsoft/categorias.ts"));

/** A categoria do LSoft que é o Garden (lib/lsoft/categorias.ts). O Financeiro lê só ela. */
const CATEGORIA_DO_GARDEN = 124;
const ARQUIVO = path.resolve(RAIZ, "scripts/carteira/dados/garden-na-carteira-2026-09-29.json");
const AUTOR = "script subir-garden-para-carteira (planilha do time adm, 29/09/2026)";
const AUTOR_DO_DESFAZER = "script subir-garden-para-carteira --desfazer";
/** Os campos do cadastro que o `--gravar` muda e o `--desfazer` devolve, além da lista. */
const CAMPOS_DA_VALIDACAO = ["status_validacao", "validado_em", "validado_por", "observacao_validacao"];
const PAGINA = 1000;
const LOTE = 100;

const gravar = process.argv.includes("--gravar");
const desfazer = process.argv.includes("--desfazer");
if (gravar && desfazer) throw new Error("--gravar e --desfazer ao mesmo tempo não fazem sentido");
// `--ensaio` junto de `--desfazer` só mostra; sozinho (ou sem nada) é o ensaio da subida.
const soMostrar = process.argv.includes("--ensaio");
if (gravar && soMostrar) throw new Error("--gravar com --ensaio: rode sem nada para o ensaio da subida");
const modo = gravar ? "GRAVAR" : desfazer ? (soMostrar ? "ENSAIO DO DESFAZER" : "DESFAZER") : "ENSAIO";
const escrever = gravar || (desfazer && !soMostrar);

// ── O .env ──────────────────────────────────────────────────────────────────
// O worktree não tem .env.local (não é versionado): cai no do checkout principal, como
// scripts/lsoft/importar-para-supabase.mjs faz.
const ENV_LOCAL = [
  path.resolve(RAIZ, "apps/hub/.env.local"),
  path.resolve(RAIZ, "../../careli-hub/apps/hub/.env.local"),
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

// ── Utilidades ──────────────────────────────────────────────────────────────
const brl = (valor) => valor.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
const centavos = (valor) => Math.round(valor * 100) / 100;
const texto = (v) => {
  const t = String(v ?? "").trim();
  return t === "" ? null : t;
};

/** "Q06-L14", "Q6 L14", quadra "06" + lote "014" -> "Q6-L14": só para comparar. */
function unidadeComparavel(quadra, lote) {
  const q = String(quadra ?? "").replace(/^0+(?=\d)/, "");
  const l = String(lote ?? "").replace(/^0+(?=\d)/, "");
  return `Q${q}-L${l}`;
}
const unidadeDoJson = (u) => {
  const m = String(u).match(/^Q0*(\d+\w*)-L0*(\d+\w*)$/i);
  return m ? `Q${m[1]}-L${m[2]}` : String(u);
};

function lotes(itens) {
  const saida = [];
  for (let i = 0; i < itens.length; i += LOTE) saida.push(itens.slice(i, i + LOTE));
  return saida;
}

/**
 * Lê tudo, página a página, e PROVA que leu tudo: ordem fixa, contagem exata na primeira página e
 * nenhuma chave repetida. O PostgREST corta em 1.000 sem erro, e sem ordem repete e pula linha.
 */
async function lerTudo(montar, chave, rotulo) {
  const linhas = [];
  const vistas = new Set();
  let esperado = null;
  for (let de = 0; ; de += PAGINA) {
    const { count, data, error } = await montar(de === 0).range(de, de + PAGINA - 1);
    if (error) {
      const falha = new Error(`leitura de ${rotulo} falhou: ${error.message}`);
      falha.causa = error;
      throw falha;
    }
    if (de === 0) esperado = count;
    for (const linha of data ?? []) {
      const k = chave(linha);
      if (vistas.has(k)) throw new Error(`leitura de ${rotulo} instável: ${k} veio duas vezes`);
      vistas.add(k);
      linhas.push(linha);
    }
    if ((data ?? []).length < PAGINA) break;
  }
  if (esperado === null || linhas.length !== esperado) {
    throw new Error(`leitura de ${rotulo} incompleta: vieram ${linhas.length} de ${esperado ?? "?"}`);
  }
  return linhas;
}

// ── 1. O JSON ───────────────────────────────────────────────────────────────
const plano = JSON.parse(fs.readFileSync(ARQUIVO, "utf8"));
const sobem = plano.sobem ?? [];
const ficam = plano.ficam ?? [];
const bloqueios = [];
const avisos = [];

const codigosQueSobem = sobem.map((s) => String(s.codigo));
const codigosQueFicam = ficam.map((f) => String(f.codigo));
if (new Set(codigosQueSobem).size !== codigosQueSobem.length) bloqueios.push("JSON: código repetido em 'sobem'");
for (const codigo of codigosQueSobem) {
  if (codigosQueFicam.includes(codigo)) bloqueios.push(`JSON: ${codigo} está em 'sobem' e em 'ficam'`);
}
for (const s of sobem) {
  if (s.decisao !== "OK") bloqueios.push(`JSON: ${s.codigo} sobe sem decisão OK (${s.decisao})`);
  if (s.status !== null && s.status !== "validado") bloqueios.push(`JSON: ${s.codigo} com status inesperado (${s.status})`);
  if (!texto(s.observacao)) bloqueios.push(`JSON: ${s.codigo} sem observação`);
}

// ── 2. O banco (só leitura) ─────────────────────────────────────────────────
const todosOsCodigos = [...codigosQueSobem, ...codigosQueFicam];
const COLUNAS_DO_CLIENTE = "codigo, status_validacao, observacao_validacao, validado_em, validado_por";

let colunaExiste = true;
const clientes = new Map();
for (const lote of lotes(todosOsCodigos)) {
  let linhas;
  try {
    linhas = await lerTudo(
      (contar) =>
        supabase
          .from("lsoft_clientes")
          .select(`${COLUNAS_DO_CLIENTE}, ${COLUNA_NA_CARTEIRA}`, contar ? { count: "exact" } : undefined)
          .in("codigo", lote)
          .order("codigo"),
      (l) => l.codigo,
      "clientes",
    );
  } catch (falha) {
    if (!colunaNaCarteiraAusente(falha.causa)) throw falha;
    // Antes da migration 0199: o ensaio segue como se a lista estivesse vazia.
    colunaExiste = false;
    linhas = await lerTudo(
      (contar) =>
        supabase
          .from("lsoft_clientes")
          .select(COLUNAS_DO_CLIENTE, contar ? { count: "exact" } : undefined)
          .in("codigo", lote)
          .order("codigo"),
      (l) => l.codigo,
      "clientes",
    );
  }
  for (const linha of linhas) clientes.set(linha.codigo, linha);
}

// As parcelas do Garden dos que sobem, uma a uma: é a soma que vai para o Financeiro.
const parcelasDoGarden = [];
for (const lote of lotes(codigosQueSobem)) {
  parcelasDoGarden.push(
    ...(await lerTudo(
      (contar) =>
        supabase
          .from("lsoft_parcelas")
          .select(
            "id, cliente_codigo, categoria_lsoft, paga, valor, valor_recebido, vencimento, quadra, lote",
            contar ? { count: "exact" } : undefined,
          )
          .in("cliente_codigo", lote)
          .eq("empreendimento", GARDEN)
          .order("id"),
      (l) => l.id,
      "parcelas do Garden",
    )),
  );
}

// As linhas da view por empreendimento (0107): a do Garden é a conferência; as outras dizem quem
// continua na integração com outra carteira.
const linhasDaView = [];
for (const lote of lotes(codigosQueSobem)) {
  linhasDaView.push(
    ...(await lerTudo(
      (contar) =>
        supabase
          .from("lsoft_carteira_por_cliente_empreendimento")
          .select(
            "codigo, empreendimento, parcelas, parcelas_pagas, parcelas_abertas, parcelas_vencidas, saldo_aberto, saldo_vencido, total_recebido, parcelas_caixa, parcelas_a_validar",
            contar ? { count: "exact" } : undefined,
          )
          .in("codigo", lote)
          .order("codigo")
          .order("empreendimento"),
      (l) => `${l.codigo}|${l.empreendimento}`,
      "view por empreendimento",
    )),
  );
}

// A curadoria da Caixa nas parcelas do Garden destes clientes (tem de ser zero).
const idsDoGarden = new Set(parcelasDoGarden.map((p) => p.id));
const marcas = [];
for (const lote of lotes(codigosQueSobem)) {
  marcas.push(
    ...(await lerTudo(
      (contar) =>
        supabase
          .from("lsoft_classificacao_de_parcela")
          .select("id, cliente_codigo, parcela_id, classe, situacao", contar ? { count: "exact" } : undefined)
          .in("cliente_codigo", lote)
          .order("id"),
      (l) => l.id,
      "classificação",
    )),
  );
}
const marcasNoGarden = marcas.filter((m) => idsDoGarden.has(m.parcela_id));

// A trilha dos campos da validação, só para o desfazer: é dela que sai o valor de antes. De TODOS os
// autores, em ordem: a última entrada de cada campo diz se alguém mexeu depois da subida.
const trilhaPorCampo = new Map();
if (desfazer) {
  for (const lote of lotes(codigosQueSobem)) {
    const entradas = await lerTudo(
      (contar) =>
        supabase
          .from("lsoft_clientes_edicoes")
          .select("id, cliente_codigo, campo, valor_anterior, valor_novo, autor, criado_em", contar ? { count: "exact" } : undefined)
          .in("cliente_codigo", lote)
          .in("campo", CAMPOS_DA_VALIDACAO)
          .order("criado_em")
          .order("id"),
      (l) => l.id,
      "trilha",
    );
    for (const entrada of entradas) {
      const chave = `${entrada.cliente_codigo}|${entrada.campo}`;
      trilhaPorCampo.set(chave, [...(trilhaPorCampo.get(chave) ?? []), entrada]);
    }
  }
}

// ── 3. A conta, cliente a cliente ───────────────────────────────────────────
const hoje = hojeNaCasa();
const porCliente = new Map(codigosQueSobem.map((c) => [c, []]));
for (const p of parcelasDoGarden) porCliente.get(p.cliente_codigo)?.push(p);

const somaVazia = () => ({ abertas: 0, emAberto: 0, pagas: 0, parcelas: 0, recebido: 0, vencidas: 0, vencido: 0 });
const total = somaVazia();
const linhasDeSaida = [];
const planoPorCliente = [];
let unidadesIguais = 0;
let unidadesDiferentes = 0;
let viewIgual = 0;

for (const s of sobem) {
  const codigo = String(s.codigo);
  const atual = clientes.get(codigo);
  if (!atual) {
    bloqueios.push(`${codigo}: não existe em lsoft_clientes`);
    continue;
  }

  const parcelas = porCliente.get(codigo) ?? [];
  const soma = somaVazia();
  for (const p of parcelas) {
    const valor = Number(p.valor ?? 0);
    soma.parcelas += 1;
    if (p.paga) {
      soma.pagas += 1;
      // A régua das views (0097 e 0107): recebido só de parcela paga.
      soma.recebido += Number(p.valor_recebido ?? 0);
    } else {
      soma.abertas += 1;
      soma.emAberto += valor;
      // ⚠️ Vencida com o dia de São Paulo (`hojeNaCasa`), estritamente antes de hoje.
      if (p.vencimento && String(p.vencimento).slice(0, 10) < hoje) {
        soma.vencidas += 1;
        soma.vencido += valor;
      }
    }
  }
  for (const campo of Object.keys(total)) total[campo] += soma[campo];

  if (parcelas.length === 0) bloqueios.push(`${codigo}: sem parcela do Garden no espelho`);
  const foraDa124 = parcelas.filter((p) => Number(p.categoria_lsoft) !== CATEGORIA_DO_GARDEN).length;
  if (foraDa124 > 0) bloqueios.push(`${codigo}: ${foraDa124} parcela(s) do Garden fora da categoria 124`);

  // A linha do Garden da view 0107 tem de ser a soma direta (é o que o desconto da tela usa).
  const daView = linhasDaView.find((l) => l.codigo === codigo && l.empreendimento === GARDEN);
  const bate =
    daView &&
    Number(daView.parcelas) === soma.parcelas &&
    Number(daView.parcelas_pagas) === soma.pagas &&
    Number(daView.parcelas_abertas) === soma.abertas &&
    Math.abs(Number(daView.saldo_aberto) - soma.emAberto) < 0.005 &&
    Math.abs(Number(daView.total_recebido) - soma.recebido) < 0.005 &&
    Number(daView.parcelas_caixa) === 0 &&
    Number(daView.parcelas_a_validar) === 0;
  if (bate) viewIgual += 1;
  else bloqueios.push(`${codigo}: a linha do Garden na view 0107 não bate com a soma das parcelas`);
  // Vencidas ficam fora da conferência estrita: a view usa o `current_date` do banco (UTC) e o
  // script o dia de São Paulo; das 21h à meia-noite as duas discordam da parcela de hoje.
  if (daView && Number(daView.parcelas_vencidas) !== soma.vencidas) {
    avisos.push(`${codigo}: vencidas ${soma.vencidas} aqui (dia de São Paulo) e ${daView.parcelas_vencidas} na view (UTC)`);
  }

  // Unidades: a do boleto (JSON) ao lado da do espelho. Diferença não bloqueia: a carteira fica no
  // lote NOVO do boleto (decisão do Lucas), e o LSoft pode ter o antigo.
  const doEspelho = [...new Set(parcelas.filter((p) => p.quadra || p.lote).map((p) => unidadeComparavel(p.quadra, p.lote)))].sort();
  const doJson = (s.unidades ?? []).map(unidadeDoJson).sort();
  const iguais = doEspelho.join() === doJson.join();
  if (iguais) unidadesIguais += 1;
  else unidadesDiferentes += 1;

  const outras = linhasDaView
    .filter((l) => l.codigo === codigo && l.empreendimento !== GARDEN)
    .map((l) => l.empreendimento);

  // O que muda.
  const naCarteiraAtual = colunaExiste ? listaNaCarteira(atual[COLUNA_NA_CARTEIRA]) : [];
  const naCarteiraNova = desfazer
    ? naCarteiraAtual.filter((e) => e !== GARDEN)
    : [...new Set([...naCarteiraAtual, GARDEN])];

  const mudancas = {};
  const trilha = [];
  const autorDaEscrita = desfazer ? AUTOR_DO_DESFAZER : AUTOR;
  const registrar = (campo, antes, depois) =>
    trilha.push({ autor: autorDaEscrita, autor_origem: "careli", campo, cliente_codigo: codigo, valor_anterior: antes, valor_novo: depois });

  if (naCarteiraNova.join("|") !== naCarteiraAtual.join("|")) {
    mudancas[COLUNA_NA_CARTEIRA] = naCarteiraNova;
    registrar(COLUNA_NA_CARTEIRA, naCarteiraAtual.join(", ") || null, naCarteiraNova.join(", ") || null);
  }

  if (!desfazer) {
    // Status nulo no JSON = não mexe no status (são os 11 que têm outra carteira ainda por validar).
    const statusAtual = texto(atual.status_validacao) ?? "pendente";
    if (s.status && s.status !== statusAtual) {
      mudancas.status_validacao = s.status;
      registrar("status_validacao", statusAtual, s.status);
      // O carimbo, como a tela faz: só no `validado`. Entra na trilha (a tela não registra o
      // carimbo) para o --desfazer devolver o de antes, e não apagar um carimbo antigo.
      if (s.status === "validado") {
        const agora = new Date().toISOString();
        mudancas.validado_em = agora;
        mudancas.validado_por = AUTOR;
        registrar("validado_em", texto(atual.validado_em), agora);
        registrar("validado_por", texto(atual.validado_por), AUTOR);
      }
    }
    // ⚠️ OBSERVAÇÃO QUE JÁ EXISTE NÃO É APAGADA: a do JSON entra depois dela. Em 29/09/2026 nenhum
    // dos 106 tinha observação, mas o time pode escrever uma antes de o script rodar.
    const obsAtual = texto(atual.observacao_validacao);
    const obsDoJson = texto(s.observacao);
    if (obsDoJson && !(obsAtual ?? "").includes(obsDoJson)) {
      const obsNova = obsAtual ? `${obsAtual} · ${obsDoJson}` : obsDoJson;
      mudancas.observacao_validacao = obsNova;
      registrar("observacao_validacao", obsAtual, obsNova);
    }
  } else {
    // ⚠️ O DESFAZER DEVOLVE CAMPO A CAMPO, PELA TRILHA DA SUBIDA. A regra (só volta o que ainda está
    // como o --gravar deixou) mora em `devolucaoDoCampo` (na-carteira.ts), com teste.
    let subidaNaTrilha = false;
    for (const campo of CAMPOS_DA_VALIDACAO) {
      const valorAtual = texto(atual[campo]);
      const devolucao = devolucaoDoCampo({
        autorDaSubida: AUTOR,
        autorDoDesfazer: AUTOR_DO_DESFAZER,
        campo,
        entradas: (trilhaPorCampo.get(`${codigo}|${campo}`) ?? []).map((e) => ({
          autor: e.autor,
          valorAnterior: e.valor_anterior,
          valorNovo: e.valor_novo,
        })),
        valorAtual,
      });
      if (devolucao.acao === "sem-subida") continue;
      subidaNaTrilha = true;
      if (devolucao.acao === "fica") {
        if (devolucao.aviso) avisos.push(`${codigo}: ${campo} ${devolucao.aviso}; fica como está`);
        continue;
      }
      mudancas[campo] = devolucao.valor;
      registrar(campo, campo === "status_validacao" ? (valorAtual ?? "pendente") : valorAtual, devolucao.valor);
    }
    if (!subidaNaTrilha && naCarteiraAtual.includes(GARDEN)) {
      avisos.push(`${codigo}: sem trilha da subida; só o Garden sai da lista, status e observação ficam`);
    }
  }

  planoPorCliente.push({ codigo, mudancas, naCarteiraNova, trilha });

  const status = mudancas.status_validacao
    ? `${texto(atual.status_validacao) ?? "pendente"} -> ${mudancas.status_validacao}`
    : `${texto(atual.status_validacao) ?? "pendente"} (não mexe)`;
  linhasDeSaida.push(
    [
      codigo,
      `boleto ${(s.unidades ?? []).join("+")}${iguais ? "" : ` | espelho ${doEspelho.join("+") || "sem unidade"}`}`,
      `${soma.parcelas} parc (${soma.pagas} pagas, ${soma.abertas} abertas, ${soma.vencidas} venc.)`,
      `aberto ${brl(centavos(soma.emAberto))}`,
      `recebido ${brl(centavos(soma.recebido))}`,
      `status ${status}`,
      `carteira [${naCarteiraAtual.join(",")}] -> [${naCarteiraNova.join(",")}]`,
      desfazer
        ? `devolve: ${CAMPOS_DA_VALIDACAO.filter((campo) => campo in mudancas).join(", ") || "nada além da lista"}`
        : outras.length > 0
          ? `fica na integração: ${outras.join(", ")}`
          : "sai da integração",
    ].join(" · "),
  );
}

if (marcasNoGarden.length > 0) bloqueios.push(`${marcasNoGarden.length} marca(s) de classificação em parcela do Garden destes clientes`);

// Os que FICAM: nenhum pode já estar com o Garden no Financeiro.
for (const codigo of codigosQueFicam) {
  const atual = clientes.get(codigo);
  if (!atual) avisos.push(`fica ${codigo}: não existe em lsoft_clientes`);
  else if (colunaExiste && listaNaCarteira(atual[COLUNA_NA_CARTEIRA]).includes(GARDEN)) {
    avisos.push(`fica ${codigo}: JÁ está com o Garden no Financeiro, e pela planilha devia ficar na integração`);
  }
}

// ── 4. O relatório ──────────────────────────────────────────────────────────
const comOutraCarteira = planoPorCliente.filter((p) =>
  linhasDaView.some((l) => l.codigo === p.codigo && l.empreendimento !== GARDEN),
).length;
const aMudar = planoPorCliente.filter((p) => Object.keys(p.mudancas).length > 0).length;

console.log(`\n== ${modo} · subir o Garden validado para o Financeiro · hoje ${hoje} (São Paulo) ==\n`);
console.log(`coluna ${COLUNA_NA_CARTEIRA}: ${colunaExiste ? "existe" : "AINDA NÃO EXISTE (migration 0199 não aplicada): ensaio calculado com a lista vazia"}`);
console.log("");
for (const linha of linhasDeSaida) console.log(linha);
console.log("");
console.log("-- O que vai para o Financeiro (Garden, categoria 124, direto do espelho) --");
console.log(`clientes ............ ${planoPorCliente.length} de ${sobem.length} do JSON`);
console.log(`parcelas ............ ${total.parcelas} (${total.pagas} pagas, ${total.abertas} em aberto, ${total.vencidas} vencidas)`);
console.log(`em aberto ........... ${brl(centavos(total.emAberto))}`);
console.log(`vencido ............. ${brl(centavos(total.vencido))}`);
console.log(`recebido ............ ${brl(centavos(total.recebido))} (só de parcela paga, a régua das views)`);
console.log("");
console.log("-- Conferências --");
console.log(`view 0107 (Garden) = soma das parcelas ... ${viewIgual} de ${planoPorCliente.length}`);
console.log(`marcas da Caixa no Garden destes ......... ${marcasNoGarden.length}`);
console.log(`unidade do boleto = do espelho ........... ${unidadesIguais} iguais, ${unidadesDiferentes} diferentes (fica o lote novo do boleto)`);
console.log(`continuam na integração com outra carteira ${comOutraCarteira}`);
if (desfazer) {
  const devolvidos = (campo) => planoPorCliente.filter((p) => campo in p.mudancas).length;
  console.log(`devolvidos pela trilha ................... status ${devolvidos("status_validacao")}, carimbo ${devolvidos("validado_em")}, observação ${devolvidos("observacao_validacao")}`);
} else {
  console.log(`status: ${sobem.filter((s) => s.status === "validado").length} viram validado, ${sobem.filter((s) => s.status === null).length} não mexem (têm outra carteira por validar)`);
}
console.log(`ficam na integração (JSON) ............... ${codigosQueFicam.length}`);
console.log(`clientes com alguma mudança .............. ${aMudar}`);
for (const aviso of avisos) console.log(`aviso: ${aviso}`);
for (const bloqueio of bloqueios) console.log(`BLOQUEIO: ${bloqueio}`);

if (!escrever) {
  console.log(`\n${modo}: nada foi gravado.${!desfazer && bloqueios.length > 0 ? " Há bloqueio(s): --gravar recusaria." : ""}`);
  process.exit(0);
}

// ── 5. A escrita (só com --gravar ou --desfazer) ────────────────────────────
if (!colunaExiste) {
  console.error("\nRECUSADO: a coluna ainda não existe. Aplique a migration 0199 antes.");
  process.exit(1);
}
// ⚠️ O BLOQUEIO SÓ SEGURA O --gravar. Desfazer é tirar o 'Garden' da lista, e tem de funcionar
// justamente quando algo deu errado depois de gravar.
if (gravar && bloqueios.length > 0) {
  console.error(`\nRECUSADO: ${bloqueios.length} bloqueio(s) acima. Nada foi gravado.`);
  process.exit(1);
}

const falhas = [];
let gravados = 0;
for (const item of planoPorCliente) {
  if (Object.keys(item.mudancas).length === 0) continue;

  // ⚠️ `.select` depois do update: sem ele, um `eq` que não casa nada volta "sem erro" e ninguém
  // percebe que o cliente não foi gravado.
  const { data, error } = await supabase
    .from("lsoft_clientes")
    .update(item.mudancas)
    .eq("codigo", item.codigo)
    .select("codigo");
  if (error || (data ?? []).length !== 1) {
    falhas.push(`${item.codigo}: ${error?.message ?? `${(data ?? []).length} linha(s) atualizada(s)`}`);
    continue;
  }
  gravados += 1;

  // A trilha não desfaz a gravação (a regra da tela, carteira.ts): se falhar, fica no relatório.
  const { error: erroTrilha } = await supabase.from("lsoft_clientes_edicoes").insert(item.trilha);
  if (erroTrilha) falhas.push(`${item.codigo}: gravado, mas a trilha falhou (${erroTrilha.message})`);
}

// A prova: relê a coluna dos 106.
const relidos = new Map();
for (const lote of lotes(codigosQueSobem)) {
  const linhas = await lerTudo(
    (contar) =>
      supabase
        .from("lsoft_clientes")
        .select(`codigo, ${COLUNA_NA_CARTEIRA}`, contar ? { count: "exact" } : undefined)
        .in("codigo", lote)
        .order("codigo"),
    (l) => l.codigo,
    "clientes (conferência)",
  );
  for (const linha of linhas) relidos.set(linha.codigo, listaNaCarteira(linha[COLUNA_NA_CARTEIRA]));
}
const certos = codigosQueSobem.filter((codigo) => (relidos.get(codigo) ?? []).includes(GARDEN) === gravar).length;

console.log(`\n${modo}: ${gravados} cliente(s) gravado(s); conferência: ${certos} de ${codigosQueSobem.length} ${gravar ? "com" : "sem"} o Garden no Financeiro.`);
for (const falha of falhas) console.error(`FALHA: ${falha}`);
process.exit(falhas.length > 0 || certos !== codigosQueSobem.length ? 1 : 0);
