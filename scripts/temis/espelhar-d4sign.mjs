// O ESPELHO DA D4SIGN PELA LINHA DE COMANDO: o ensaio e a carga inicial (F3 do plano da fonte única,
// docs/assinatura/fonte-unica-do-contrato.md, seção 6).
//
//   node scripts/temis/espelhar-d4sign.mjs                          ENSAIO: lê C2X, catálogo e Panteon; /list numa amostra de 10; não grava
//   node scripts/temis/espelhar-d4sign.mjs --so 3806                ensaio de um envio (até 50, separados por vírgula)
//   node scripts/temis/espelhar-d4sign.mjs --gravar                 grava; 1 chamada a cada 2 s; NÃO move venda
//   node scripts/temis/espelhar-d4sign.mjs --gravar --mover-vendas  depois da prova e do OK
//   node scripts/temis/espelhar-d4sign.mjs --gravar --refazer       refaz o /list de quem já tem conferido_em
//
// ⚠️ RODE DA RAIZ DO MONOREPO, DE MADRUGADA. `--gravar` E `--mover-vendas` SÓ COM OK DO LUCAS, CADA UM, e só
// depois da 0195 aplicada e da cota da D4Sign confirmada (F0). O ensaio roda sem a 0195 (diz
// `semA0195: true`) e não escreve NADA: nem a vez, nem `tentado_em`, nem a pausa.
//
// ⚠️ A REGRA NÃO MORA AQUI. Quem decide é `apps/hub/lib/assinatura/espelho-d4sign/espelho.ts` (a mesma função
// do cron), carregada pelo `jiti` com o apelido `@` apontando para `apps/hub` (o padrão de
// `scripts/lsoft/reconciliar-trilha.mjs`). Reserva, se o jiti tropeçar: `npx tsx --tsconfig apps/hub/tsconfig.json`.
//
// ⚠️ SEM DADO PESSOAL NA SAÍDA: o relatório só tem ids, códigos e contagens. As credenciais do C2X e da
// D4Sign vão do `.env.local` para `process.env` deste processo e não são impressas em lugar nenhum (a da
// D4Sign viaja na query string, dentro de `d4sign-consulta.ts`, e nunca sai em log nem erro).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const raiz = process.cwd();
const hub = path.resolve(raiz, "apps/hub");
const req = createRequire(path.resolve(hub, "package.json"));
const { createClient } = req("@supabase/supabase-js");
const { createJiti } = req("jiti");

const args = process.argv.slice(2);
const tem = (flag) => args.includes(flag);
const valorDe = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

const gravar = tem("--gravar");
const moverVendas = tem("--mover-vendas");
const refazer = tem("--refazer");
const soBruto = valorDe("--so");

if (moverVendas && !gravar) {
  console.error("--mover-vendas só vale junto com --gravar.");
  process.exit(2);
}

// O worktree pode não ter .env.local (não é versionado): cai no do checkout principal.
const ENV_LOCAL = [path.resolve(hub, ".env.local"), path.resolve(raiz, "../../careli-hub/apps/hub/.env.local")].find((p) =>
  fs.existsSync(p),
);
if (!ENV_LOCAL) {
  console.error("não achei apps/hub/.env.local");
  process.exit(2);
}
for (const linha of fs.readFileSync(ENV_LOCAL, "utf8").split("\n")) {
  if (!linha.includes("=") || linha.trim().startsWith("#")) continue;
  const i = linha.indexOf("=");
  const nome = linha.slice(0, i).trim();
  const valor = linha.slice(i + 1).trim().replace(/^["']|["']$/g, "");
  if (nome && process.env[nome] === undefined) process.env[nome] = valor;
}

const jiti = createJiti(import.meta.url, { alias: { "@": hub } });
const { espelharD4Sign, lerSoDoPedido } = await jiti.import(path.resolve(hub, "lib/assinatura/espelho-d4sign/espelho.ts"));
const { getHadesDbPool } = await jiti.import(path.resolve(hub, "lib/guardian/db.ts"));

const so = lerSoDoPedido(soBruto ?? null);
if (so === null) {
  console.error("--so aceita até 50 números de envio, separados por vírgula.");
  process.exit(2);
}

const poolResult = getHadesDbPool();
if (!poolResult.ok) {
  // Só os NOMES do que falta.
  console.error(`C2X sem configuração: ${poolResult.missing.join(", ")}`);
  process.exit(2);
}

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// A vazão da carga inicial (seção 6): 1 chamada à D4Sign a cada 2 s, sem paralelo. O ensaio lista uma
// amostra de 10 (ou os do `--so`); o `--gravar` segue o recorte da carga até acabar.
const opcoes = {
  concorrencia: 1,
  gravar,
  intervaloMs: 2_000,
  moverVendas,
  orcamentoMs: Number.POSITIVE_INFINITY,
  refazer,
  so,
  tetoDeListas: so ? so.length : gravar ? Number.POSITIVE_INFINITY : 10,
};

console.log(
  `espelho da D4Sign: ${gravar ? "GRAVANDO" : "ENSAIO (nada é gravado)"}${moverVendas ? ", movendo vendas" : ""}${
    so ? `, só ${so.length} envio(s)` : ""
  }`,
);

let relatorio;
try {
  relatorio = await espelharD4Sign({ admin, opcoes, pool: poolResult.pool });
} finally {
  await poolResult.pool.end().catch(() => undefined);
}

console.log(JSON.stringify(relatorio, null, 2));
if (relatorio.falhas.length > 0) process.exitCode = 1;
