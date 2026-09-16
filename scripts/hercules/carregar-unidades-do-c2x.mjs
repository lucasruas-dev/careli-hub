// CARGA INICIAL DAS UNIDADES: C2X -> Panteon.
//
// Pedido do Lucas (01/09/2026): *"pode migrar todas as unidade do c2x para o panteon, cria a tabela
// e já salva"*, junto com *"esquece c2x"*.
//
// ⚠️ ISTO É UMA CARGA, NÃO UMA SINCRONIZAÇÃO. Roda uma vez, o Panteon passa a ser dono das
// unidades, e ninguém volta ao legado para lê-las. Não existe job, não existe caminho de volta.
// A idempotência (`origem_c2x_id`) serve para poder rodar de novo sem duplicar enquanto a carga
// está sendo conferida — não para manter as duas bases em dia.
//
// ⚠️ A SITUAÇÃO NÃO VEM COPIADA CRUA. O C2X guarda `sale_status_id` mais dois flags
// (`sale_blocked`, `secured_lot`), e a regra de qual balde a unidade cai já existe testada em
// `lib/apolo/balde-da-unidade.ts` — foi ela que resolveu o caso do Villa Paris, onde 27 unidades em
// status 5 não entravam em balde nenhum e os cards não fechavam com o total. Aqui aplicamos a mesma
// regra na carga, para o Panteon nascer com a contagem certa.
//
// ⚠️ PREÇO DO JDG ESTÁ ERRADO NO LEGADO, e o Lucas sabe: *"os valores das unidades do jdg, estão
// erradas, vou precisar atualizar esses valores"*. A carga traz o que existe hoje; a correção vem
// pela tela de atualização em massa. Por isso o relatório final destaca o JDG.
//
// Uso (da raiz do repo):
//   node scripts/hercules/carregar-unidades-do-c2x.mjs            # ENSAIO: não grava
//   node scripts/hercules/carregar-unidades-do-c2x.mjs --gravar   # grava
//   node scripts/hercules/carregar-unidades-do-c2x.mjs --gravar --empreendimentos ACP,JDG
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

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

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SECRET_KEY;
const GRAVAR = process.argv.includes("--gravar");
// SÓ SITUAÇÃO: recarrega apenas `situacao` das unidades que já existem, sem tocar em preço,
// matrícula, extensos nem `segmento_id`. É o modo para corrigir a régua de vendido/negociação
// (02/09/2026) sem passar por cima do que a tela ou a segmentação já ajustaram.
const SO_SITUACAO = process.argv.includes("--so-situacao");
// ⚠️ O QUE NAO ENTRA NO PANTEON. Lucas (11/09/2026): *"esse sdt, tsc, tudo que e teste nao precisa
// existir dentro do panteon"* e, depois, *"ADT pode ficar de fora tambem"*.
//
// A lista tem DUAS naturezas, e a distincao importa para quem mexer nisso depois:
//
//   SDT ("SERVIDOR DE TREINAMENTO") e TSC ("TESTE SPLIT CARELI") sao ENSAIO. As 18 propostas deles
//   nunca foram faturadas e o cliente das duas e a propria Nivea.
//
//   ADT ("CARELI - ADITIVOS") NAO e ensaio: tem 31 propostas e DUAS FATURADAS, com clientes reais,
//   de 14/12/2025 a 16/07/2026. Ele esta fora por DECISAO DE ESCOPO, tomada com esse numero na
//   mesa: nao e um empreendimento, e um balcao de aditivos contratuais que o legado modelou como
//   empreendimento para caber. Trazer isso para ca do jeito que esta ensinaria o Panteon a errar o
//   modelo. ⚠️ A consequencia esta aceita e registrada: essas 31 propostas, as duas faturadas
//   inclusive, NAO existem no Panteon — quem procurar por elas aqui nao acha.
const FORA_DO_PANTEON = ["ADT", "SDT", "TSC"];
const iExceto = process.argv.indexOf("--exceto");
const EXCETO = new Set(
  iExceto > 0
    ? (process.argv[iExceto + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean)
    : FORA_DO_PANTEON,
);
const iEmp = process.argv.indexOf("--empreendimentos");
const FILTRO = iEmp > 0 ? (process.argv[iEmp + 1] ?? "").split(",").map((s) => s.trim()).filter(Boolean) : null;

const texto = (v) => {
  const t = String(v ?? "").trim();
  return t || null;
};
const numero = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/**
 * O balde da unidade, na mesma ordem de precedência de `lib/apolo/balde-da-unidade.ts`.
 *
 * ⚠️ A ORDEM IMPORTA e não é alfabética: vendido ganha de bloqueado, que ganha de reservado. Uma
 * unidade vendida que também está marcada como bloqueada é VENDIDA — o bloqueio é resíduo de antes
 * da venda. Inverter faria a unidade sumir do relatório de vendas.
 */
function situacaoDaUnidade(u) {
  const status = Number(u.sale_status_id ?? 0);
  // ⚠️ A RÉGUA É A DE `lib/apolo/balde-da-unidade.ts` (SALE_STATUS): 1 = disponível, 2 = reservado,
  // 3 = EM NEGOCIAÇÃO, 4 = VENDIDO, 5 = bloqueado. A versão anterior deste script tratava só o 3
  // como vendida e deixava o 4 cair em "disponivel" — o Lavra do Ouro (474 vendidos no C2X)
  // apareceu no Panteon com ZERO vendidas, e 11 lotes vendidos do Vale do Ouro viraram
  // disponíveis. Achado na revisão de 02/09/2026 (mapa do Hércules interno).
  //
  // Em negociação e vendido viram os dois "vendida", como a tela de Vendas do Apolo já faz
  // (`mapUnitRow`): `hercules_unidades` não tem valor próprio para negociação — esse estágio, no
  // Hércules, é a venda em rascunho, não a unidade.
  if (status === 3 || status === 4) return "vendida";
  if (status === 5 || Number(u.sale_blocked ?? 0) === 1) return "bloqueada";
  if (status === 2) return "reservada";
  return "disponivel";
}

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [linhas] = await c.query(`
  select u.id, u.enterprise_id, e.code, e.name as empreendimento,
         u.name, u.block, u.lot, u.area, u.price,
         u.extensive_area, u.extensive_price,
         u.registration, u.registration_number, u.registration_book_number,
         u.sale_status_id, u.sale_blocked, u.secured_lot, u.enterprise_unity_type_id
    from enterprise_unities u
    join enterprises e on e.id = u.enterprise_id
   order by e.code, u.name`);
await c.end();

const alvoDoC2x = (FILTRO ? linhas.filter((l) => FILTRO.includes(String(l.code))) : linhas).filter(
  (l) => !EXCETO.has(String(l.code)),
);
if (EXCETO.size > 0) {
  console.log(`  fora do Panteon: ${[...EXCETO].join(", ")}
`);
}

// ── PRODUTO COM DONO NÃO RECEBE A CARGA ───────────────────────────────
//
// ⚠️ DECISÃO D2 DO LUCAS (16/09/2026): o estoque do produto que tem DONO marcado
// (`hercules_empreendimentos.operado_por`, migration 0170; hoje o Garden 39 da Cecílio) passou a ser
// mantido no Panteon. O time do incorporador corrige preço, área e matrícula pelo portal, e a aba
// Unidades lê `hercules_unidades`. Esta carga reescreve exatamente preço, área, matrícula e situação
// por código: rodar com o Garden dentro apagaria, calada, cada correção que a Cecílio gravou. E o
// produto nascido no Panteon (id >= 100000) nunca é do C2X; se um dia um id desses aparecer lá, é
// colisão, não carga.
//
// ⚠️ FALHA FECHADA. Sem conseguir ler o cadastro, não há como provar que nenhum produto tem dono, e a
// carga para aqui. Só a coluna ausente (a 0170 não aplicada neste banco) é lida como "ninguém tem
// dono ainda", e mesmo assim o id do Panteon continua fora.
const PRIMEIRO_ID_DO_PANTEON = 100000;
const comDono = new Map();
{
  const PAGINA = 1000;
  let colunas = "codigo,c2x_enterprise_id,operado_por";
  for (let de = 0; ; de += PAGINA) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/hercules_empreendimentos?select=${colunas}&workspace_id=eq.careli&order=codigo`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Range: `${de}-${de + PAGINA - 1}`,
          "Range-Unit": "items",
        },
      },
    );
    if (!resp.ok) {
      const corpo = await resp.text();
      if (colunas.includes("operado_por") && (corpo.includes("42703") || corpo.includes("PGRST204"))) {
        console.log("\n  A migration 0170 não está aplicada aqui: nenhum produto tem dono marcado ainda.");
        colunas = "codigo,c2x_enterprise_id";
        de -= PAGINA;
        continue;
      }
      console.error(`\n  FALHOU ao ler o cadastro de empreendimentos: ${resp.status} ${corpo.slice(0, 200)}`);
      console.error("  A carga para aqui de propósito: gravar agora poderia apagar o estoque de um produto com dono.");
      process.exit(1);
    }
    const pagina = await resp.json();
    for (const linha of pagina) {
      const id = String(linha.c2x_enterprise_id ?? "").trim();
      if (!id) continue;
      const dono = String(linha.operado_por ?? "").trim();
      if (dono || Number(id) >= PRIMEIRO_ID_DO_PANTEON) {
        comDono.set(id, dono ? `operado por ${dono}` : "nascido no Panteon");
      }
    }
    if (pagina.length < PAGINA) break;
  }
}

const pulados = new Map();
const alvo = alvoDoC2x.filter((l) => {
  const id = String(l.enterprise_id);
  if (Number(id) < PRIMEIRO_ID_DO_PANTEON && !comDono.has(id)) return true;
  const chave = `${l.code} (${id}, ${comDono.get(id) ?? "nascido no Panteon"})`;
  pulados.set(chave, (pulados.get(chave) ?? 0) + 1);
  return false;
});
for (const [produto, quantas] of pulados) {
  console.log(`  PULADO: ${produto}, ${quantas} unidades do C2X não tocam no estoque mantido no Panteon.`);
}

const registros = alvo.map((u) => ({
  area: numero(u.area),
  // A matrícula tem dois campos no legado; `registration_number` é o número e `registration` às
  // vezes traz o texto inteiro. Preferimos o número, com o outro de reserva.
  area_extenso: texto(u.extensive_area),
  bloqueio_motivo: null,
  codigo: texto(u.name) ?? `SEM-CODIGO-${u.id}`,
  enterprise_id: String(u.enterprise_id),
  lote: texto(u.lot),
  matricula: texto(u.registration_number) ?? texto(u.registration),
  matricula_livro: texto(u.registration_book_number),
  origem_c2x_id: Number(u.id),
  preco_extenso: texto(u.extensive_price),
  preco_tabela: numero(u.price),
  quadra: texto(u.block),
  situacao: situacaoDaUnidade(u),
  tipo_unidade: u.enterprise_unity_type_id == null ? null : String(u.enterprise_unity_type_id),
  workspace_id: "careli",
}));

// ── O BLOQUEIO FEITO AQUI SOBREVIVE À CARGA ───────────────────────────
//
// ⚠️ SEM ISTO, A CARGA APAGA O TRABALHO DO COORDENADOR EM SILÊNCIO. Desde 14/09/2026 o coordenador
// bloqueia lote pela tela Venda (Lucas: *"o coordenador pode bloquear as unidades"*), e esse
// bloqueio existe SÓ no Panteon — o C2X não sabe dele. Como este script reescreve `situacao` a
// partir do legado e manda `bloqueio_motivo: null` no corpo, a próxima carga devolveria o lote para
// `disponivel` e zeraria a justificativa. Sem erro, sem log, sem linha no relatório: o lote voltaria
// a ser oferecido no site público e ninguém saberia por quê.
//
// ⚠️ O SINAL É O CARIMBO, e é por isso que a 0163 o criou. Bloqueio vindo do C2X não tem
// `bloqueado_em` (são 1.554 linhas assim, todas do retrato de 01/09); bloqueio nosso tem. Só o
// segundo é preservado — o primeiro continua sendo o que o legado disser, que é o certo, porque a
// origem dele é o legado.
const bloqueadosAqui = new Set();
{
  // ⚠️ PAGINA, PORQUE O PostgREST CORTA EM 1.000 LINHAS **SEM ERRO**. É a armadilha mais cara desta
  // casa: a resposta vem 200, com mil linhas, e parece completa. Do bloqueio 1.001 em diante a
  // chave não entraria no conjunto, a linha manteria a `situacao` vinda do C2X e o upsert devolveria
  // o lote para 'disponivel' apagando a justificativa — calado. Hoje são zero bloqueios nativos,
  // então o laço dá uma volta só; o dia em que passar de mil é justamente o dia em que ninguém
  // estaria olhando.
  const PAGINA = 1000;
  for (let de = 0; ; de += PAGINA) {
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/hercules_unidades?select=enterprise_id,codigo&bloqueado_em=not.is.null&workspace_id=eq.careli&order=codigo`,
      {
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          Range: `${de}-${de + PAGINA - 1}`,
          "Range-Unit": "items",
        },
      },
    );

    if (!resp.ok) {
      const corpo = await resp.text();
      // ⚠️ "COLUNA NÃO EXISTE" (42703) NÃO É FALHA DE LEITURA — é ambiente sem a migration 0163.
      // Sem esta distinção, o ENSAIO (que não grava nada) abortava com a mensagem errada, dizendo
      // que a carga pararia para não apagar bloqueio — num banco onde bloqueio nativo nem existe.
      if (corpo.includes("42703")) {
        console.log("\n  A migration 0163 não está aplicada aqui: não há bloqueio do Panteon a preservar.");
        break;
      }
      // Falha FECHADA: sem saber quem está bloqueado aqui, gravar apagaria bloqueios sem aviso.
      console.error(`\n  FALHOU ao ler os bloqueios do Panteon: ${resp.status} ${corpo.slice(0, 200)}`);
      console.error("  A carga para aqui de propósito — gravar agora apagaria bloqueio do coordenador.");
      process.exit(1);
    }

    const pagina = await resp.json();
    for (const linha of pagina) {
      bloqueadosAqui.add(`${linha.enterprise_id}|${linha.codigo}`);
    }
    if (pagina.length < PAGINA) break;
  }
}

// ⚠️ TIRAR A COLUNA DO CORPO, E NÃO ESCREVER 'bloqueada' POR CIMA. `merge-duplicates` só atualiza o
// que vai no corpo: sem `situacao` e sem `bloqueio_motivo`, a linha bloqueada mantém as duas como
// estão e recebe normalmente preço, área e matrícula atualizados do legado. Mandar 'bloqueada' de
// volta daria no mesmo para a situação, mas apagaria a justificativa junto.
let preservados = 0;
for (const r of registros) {
  if (!bloqueadosAqui.has(`${r.enterprise_id}|${r.codigo}`)) continue;
  delete r.situacao;
  delete r.bloqueio_motivo;
  preservados += 1;
}

// Relatório antes de gravar: é a chance de perceber que algo veio errado.
const porEmp = new Map();
for (const [i, r] of registros.entries()) {
  const code = String(alvo[i].code);
  if (!porEmp.has(code)) porEmp.set(code, { comPreco: 0, semCodigo: 0, situacoes: {}, total: 0 });
  const g = porEmp.get(code);
  g.total += 1;
  if (r.preco_tabela) g.comPreco += 1;
  if (r.codigo.startsWith("SEM-CODIGO-")) g.semCodigo += 1;
  g.situacoes[r.situacao] = (g.situacoes[r.situacao] ?? 0) + 1;
}

console.log(GRAVAR ? "CARGA — GRAVANDO\n" : "ENSAIO — nada será gravado\n");
console.log(`${registros.length} unidades em ${porEmp.size} empreendimentos\n`);
console.log("  cód.   total  c/preço  s/código  situações");
for (const [code, g] of [...porEmp.entries()].sort((a, b) => b[1].total - a[1].total)) {
  const s = Object.entries(g.situacoes).map(([k, v]) => `${k}:${v}`).join(" ");
  console.log(
    `  ${code.padEnd(6)} ${String(g.total).padStart(5)} ${String(g.comPreco).padStart(8)} ${String(g.semCodigo).padStart(9)}  ${s}`,
  );
}

const semPreco = registros.filter((r) => !r.preco_tabela).length;
const semArea = registros.filter((r) => !r.area).length;
console.log(`\n  sem preço: ${semPreco}   ·   sem área: ${semArea}`);
// ⚠️ SILÊNCIO AQUI SERIA PIOR DO QUE O DEFEITO. Quem roda a carga precisa ver que houve bloqueio
// preservado — se o número vier maior do que o esperado, é sinal de que alguém bloqueou lote demais.
console.log(`  bloqueios do Panteon preservados: ${preservados}`);
console.log("  ⚠️ O preço do JDG é conhecidamente errado no legado e será corrigido pela tela.");

if (!GRAVAR) {
  console.log("\n  Confira acima e rode de novo com --gravar.");
  process.exit(0);
}

// Grava em lotes.
// ⚠️ O `on_conflict` usa (workspace_id, enterprise_id, codigo) e NÃO o `origem_c2x_id`, apesar de
// este último ser o identificador natural da carga. Motivo: o índice de origem é PARCIAL
// (`where origem_c2x_id is not null`) e o PostgREST recusa índice parcial em ON CONFLICT — devolve
// 42P10 "no unique or exclusion constraint matching". A constraint de código é completa e serve ao
// mesmo propósito: rodar duas vezes atualiza em vez de duplicar.
// ⚠️ No modo --so-situacao o upsert manda SÓ a chave e a situação: `merge-duplicates` atualiza as
// colunas presentes e deixa as outras como estão. Unidade que ainda não existe no Panteon nasce
// só com a chave e a situação — o resto entra numa carga completa depois.
// ⚠️ NO MODO --so-situacao, O BLOQUEADO SAI DA LISTA INTEIRA. Ali o corpo é só chave + situação, e
// um registro cuja `situacao` foi removida acima viraria um upsert que não atualiza nada — ou, pior,
// gravaria `undefined`. Fora da lista, a linha bloqueada fica intocada, que é o que se quer.
const paraGravar = SO_SITUACAO
  ? registros
      .filter((r) => r.situacao !== undefined)
      .map((r) => ({
        codigo: r.codigo,
        enterprise_id: r.enterprise_id,
        origem_c2x_id: r.origem_c2x_id,
        situacao: r.situacao,
        workspace_id: r.workspace_id,
      }))
  : registros;
if (SO_SITUACAO) console.log("  Modo --so-situacao: só a coluna `situacao` será atualizada.\n");

let gravadas = 0;
for (let i = 0; i < paraGravar.length; i += 400) {
  const lote = paraGravar.slice(i, i + 400);
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/hercules_unidades?on_conflict=workspace_id,enterprise_id,codigo`,
    {
      body: JSON.stringify(lote),
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      method: "POST",
    },
  );
  if (!resp.ok) {
    console.error(`\n  FALHOU no lote ${i}: ${resp.status} ${(await resp.text()).slice(0, 400)}`);
    process.exit(1);
  }
  gravadas += lote.length;
  process.stdout.write(`\r  gravadas ${gravadas}/${registros.length}`);
}
console.log(`\n\n  Pronto. ${gravadas} unidades no Panteon.`);

// ── A MARCA DO ESPELHO, REAPLICADA ────────────────────────────────────
//
// ⚠️ A CARGA CRIA A DUPLICIDADE QUE A 0161 MARCOU. Ela lê `enterprise_unities` do C2X sem noção
// de que o pai (LAB=31, VLO=35) e o filho (as glebas) descrevem o MESMO terreno, e grava uma linha
// para cada. A coluna `espelho_de` é quem diz qual das duas responde por situação e preço.
//
// ⚠️ O UPSERT ACIMA NÃO DEVERIA APAGAR A MARCA — `resolution=merge-duplicates` só atualiza as
// colunas que vão no corpo, e `espelho_de` não vai. Mas "não deveria" é frágil demais para uma
// marca cujo sumiço não dá erro nenhum: quem trocar este upsert por um que substitua a linha
// inteira devolve 714 terrenos ao estado de mostrar dois valores, e ninguém fica sabendo.
// Reaplicar é barato e idempotente.
//
// ⚠️ E TERRENO NOVO NASCE MARCADO: lote cadastrado no pai depois desta carga também ganha a marca
// aqui, sem ninguém ter de lembrar de rodar nada.
if (GRAVAR && !FILTRO) {
  const marcar = await fetch(`${SUPABASE_URL}/rest/v1/rpc/marcar_espelhos_de_unidade`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  if (marcar.ok) {
    const quantas = await marcar.json().catch(() => null);
    console.log(`  espelho: ${quantas ?? "?"} linhas do pai apontando para a linha viva.`);
  } else {
    // ⚠️ AVISA ALTO E NÃO DERRUBA. A carga em si deu certo, e sair com erro aqui faria parecer
    // que as unidades não entraram. Mas sem a marca o mesmo terreno volta a mostrar dois valores,
    // e isso precisa aparecer para quem rodou.
    console.error(
      `\n  ⚠️ A MARCA DO ESPELHO NÃO FOI REAPLICADA (${marcar.status}). As unidades entraram, mas o` +
        ` mesmo terreno pode voltar a mostrar dois valores. Rode marcar_espelhos_de_unidade() à mão.`,
    );
  }
}
