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

const alvo = FILTRO ? linhas.filter((l) => FILTRO.includes(String(l.code))) : linhas;

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
const paraGravar = SO_SITUACAO
  ? registros.map((r) => ({
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
