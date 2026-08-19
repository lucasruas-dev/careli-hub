// CONFERENCIA read-only: a situacao do masterplan bate com o C2X?
//
// Pedido do Lucas (19/08/2026): "no masterplan o valor esta errado, me retorna 6 disponivel, e
// alguns lotes que realmente esta disponivel consta como vendido... teve cancelamento ontem que o
// masterplan nao atualizou" · "o masterplan e dinamico, nao pode ser estatico".
//
// ⚠️ O ARQUIVO COM DADOS NAO E O DE public/ — aquele e so a casca (HTML/CSS). O de verdade vive em
// apps/hub/masterplans-internos/, fora do public de proposito: ele carrega preco e NOME do
// comprador de cada lote.
//
// ⚠️ READ-ONLY. ⚠️ Credencial do .env.local, nunca impressa.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const req = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = req("mysql2/promise");
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

// 0=Disponivel 1=Reservado 2=Vendido 3=Bloqueado — a legenda do proprio HTML.
const SITUACOES = ["Disponivel", "Reservado", "Vendido", "Bloqueado"];

const arquivo = "apps/hub/masterplans-internos/vale-do-ouro.html";
const html = fs.readFileSync(arquivo, "utf8");
const geradoEm = fs.statSync(arquivo).mtime.toLocaleDateString("pt-BR");

const doArquivo = new Map();
const contaArquivo = {};
for (const linha of html.split("\n")) {
  // [quadra, "lote", situacao, area, valor, "comprador", "poligono"]
  const m = linha.match(/^\[\s*("?)([^",]+)\1\s*,\s*"([^"]+)"\s*,\s*(\d+)/);
  if (!m) continue;
  const chave = `${String(m[2]).trim().toUpperCase()}-${String(m[3]).trim().padStart(2, "0")}`;
  const situacao = SITUACOES[Number(m[4])] ?? "?";
  doArquivo.set(chave, situacao);
  contaArquivo[situacao] = (contaArquivo[situacao] || 0) + 1;
}

console.log(`### O ARQUIVO (gerado em ${geradoEm}): ${doArquivo.size} lotes`);
for (const [s, n] of Object.entries(contaArquivo).sort((a, b) => b[1] - a[1])) {
  console.log("   " + String(n).padStart(4) + "  " + s);
}

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME,
  host: env.GUARDIAN_DB_HOST,
  password: env.GUARDIAN_DB_PASSWORD,
  port: Number(env.GUARDIAN_DB_PORT || 3306),
  user: env.GUARDIAN_DB_USER,
});

const [linhas] = await c.query(
  `select e.code emp, u.block quadra, u.lot lote, u.sale_blocked bloqueado,
          st.name estagio, ar.acquisition_request_stage_id estagio_id
     from enterprise_unities u
     join enterprises e on e.id = u.enterprise_id
     left join acquisition_requests ar on ar.id = (
       select ar2.id from acquisition_requests ar2
        where ar2.enterprise_unity_id = u.id order by ar2.created_at desc, ar2.id desc limit 1)
     left join acquisition_request_stages st on st.id = ar.acquisition_request_stage_id
    where e.code in ('VOL','VOC','VLO')`,
);
await c.end();

// A regua da tela de Vendas: proposta viva = vendido; senao, bloqueado ou disponivel.
const VIVOS = new Set([3, 4, 5, 9]);
const divergentes = [];
const porEmp = {};

// ⚠️ A CHAVE QUADRA-LOTE COLIDE ENTRE OS TRES CODIGOS. O Vale do Ouro foi dividido (VLO -> VOC+VOL):
// VLO ficou como historico com os 298 lotes originais, e VOC+VOL repetem as MESMAS quadras e lotes.
// Casar sem desempate faz o lote vivo ser sobrescrito pelo fantasma do historico — foi o que sujou a
// primeira medicao (a amostra so mostrava VLO).
const PRIORIDADE = { VOC: 2, VLO: 0, VOL: 2 };
const atualPorChave = new Map();

for (const l of linhas) {
  const chave = `${String(l.quadra).trim().toUpperCase()}-${String(l.lote).trim().padStart(2, "0")}`;
  const estagio = Number(l.estagio_id ?? 0);
  const atual = VIVOS.has(estagio) ? "Vendido" : l.bloqueado ? "Bloqueado" : "Disponivel";

  porEmp[l.emp] ??= {};
  porEmp[l.emp][atual] = (porEmp[l.emp][atual] || 0) + 1;

  const antes = atualPorChave.get(chave);
  const peso = PRIORIDADE[l.emp] ?? 1;
  // Entre dois vivos (VOC e VOL nao se sobrepoem hoje) o primeiro vale; contra o VLO, o vivo ganha.
  if (!antes || peso > antes.peso) {
    atualPorChave.set(chave, { emp: l.emp, estagio: l.estagio ?? "sem proposta", peso, situacao: atual });
  }
}

for (const [chave, atual] of atualPorChave) {
  const noArquivo = doArquivo.get(chave);
  if (noArquivo && noArquivo !== atual.situacao) {
    divergentes.push({
      atual: atual.situacao,
      chave,
      emp: atual.emp,
      estagio: atual.estagio,
      noArquivo,
    });
  }
}

console.log(`\n### O C2X AGORA: ${linhas.length} unidades`);
for (const [emp, contas] of Object.entries(porEmp)) {
  const texto = Object.entries(contas)
    .sort((a, b) => b[1] - a[1])
    .map(([s, n]) => `${n} ${s.toLowerCase()}`)
    .join(" · ");
  console.log(`   ${emp}: ${texto}`);
}

console.log(`\n### DIVERGENCIAS: ${divergentes.length} de ${doArquivo.size} lotes do arquivo`);
const porTipo = {};
for (const d of divergentes) {
  const chave = `${d.noArquivo} -> ${d.atual}`;
  porTipo[chave] = (porTipo[chave] || 0) + 1;
}
for (const [tipo, n] of Object.entries(porTipo).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${String(n).padStart(4)}  arquivo diz ${tipo}`);
}

console.log("\n### AMOSTRA");
for (const d of divergentes.slice(0, 15)) {
  console.log(
    `   ${d.chave.padEnd(8)} ${d.emp}  arquivo=${d.noArquivo.padEnd(11)} c2x=${d.atual.padEnd(11)} (${d.estagio})`,
  );
}
