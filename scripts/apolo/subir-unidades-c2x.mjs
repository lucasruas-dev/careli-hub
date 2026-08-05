// Sobe as unidades do Vale do Ouro para o C2X, a partir da planilha já conferida.
//
// Uso (da raiz do repo):
//   node scripts/apolo/subir-unidades-c2x.mjs                 -> ENSAIO: mostra o que subiria
//   node scripts/apolo/subir-unidades-c2x.mjs --enviar --n=5  -> envia as 5 primeiras de verdade
//   node scripts/apolo/subir-unidades-c2x.mjs --enviar        -> envia todas
//   node scripts/apolo/subir-unidades-c2x.mjs --conferir      -> só lê o C2X e mostra o que já está lá
//
// O contrato do POST /api/v1/integrations/panteon/enterprise_units foi descoberto perguntando à
// própria API em camadas (01/08). Obrigatórios: enterprise_id, block, lot, area, price. Aceitos
// também: name, registration, registration_number, registration_book_number, sale_status_id,
// enterprise_unity_type_id, sale_blocked, secured_lot.
//
// O ensaio é o padrão de propósito: criar unidade não tem desfazer, e matrícula errada vira
// contrato errado.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const ExcelJS = requireDoRepo("exceljs");
const mysql = requireDoRepo("mysql2/promise");

const casa = process.env.USERPROFILE || process.env.HOME || ".";
const PLANILHA = path.join(casa, "Desktop", "UNIDADES_VALE_DO_OURO_PREENCHIDA.xlsx");

// Vale do Ouro na tabela `enterprises` do C2X (code VLO).
const EMPREENDIMENTO_ID = 35;
const PREFIXO_DO_NOME = "VLO";
const CAMINHO = "/api/v1/integrations/panteon/enterprise_units";

const args = process.argv.slice(2);
const enviarDeVerdade = args.includes("--enviar");
const soConferir = args.includes("--conferir");
const limite = Number(args.find((a) => a.startsWith("--n="))?.slice(4)) || Infinity;

// ⚠️ O HOST NÃO VEM DA ENV DE PROPÓSITO. O `.env.local` aponta para `teste.careli.adm.br`, que é o
// certo para o app rodando na máquina do dev — e foi o que fez a primeira tentativa cair no
// ambiente errado (lá o endpoint nem existe, devolve 404). Aqui o destino é escrito por extenso,
// à vista, e aparece em letras grandes antes de qualquer envio. É a mesma lição do incidente de
// 01/08 com os cadastros de cliente: destino invisível é destino errado.
const HOST_PRODUCAO = "https://sistema.careli.adm.br";
const host = (args.find((a) => a.startsWith("--host="))?.slice(7) || HOST_PRODUCAO).replace(/\/+$/, "");

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

const conectarC2x = () =>
  mysql.createConnection({
    database: env.GUARDIAN_DB_NAME,
    dateStrings: true,
    host: env.GUARDIAN_DB_HOST,
    password: env.GUARDIAN_DB_PASSWORD,
    port: Number(env.GUARDIAN_DB_PORT || 3306),
    user: env.GUARDIAN_DB_USER,
  });

// O que já existe lá — é assim que sabemos o que criar e o que conferir depois. Só leitura.
async function unidadesNoC2x() {
  const c = await conectarC2x();
  const [rows] = await c.query(
    `SELECT id, name, block, lot, area, price, registration_number, sale_status_id,
            enterprise_unity_type_id
       FROM enterprise_unities WHERE enterprise_id = ?`,
    [EMPREENDIMENTO_ID],
  );
  await c.end();
  return rows;
}

if (soConferir) {
  const jaLa = await unidadesNoC2x();
  console.log(`Vale do Ouro tem ${jaLa.length} unidades no C2X.`);
  const semMatricula = jaLa.filter((u) => !u.registration_number);
  if (semMatricula.length) console.log(`⚠️  ${semMatricula.length} sem matrícula.`);
  for (const u of jaLa.slice(0, 10)) {
    console.log(
      `  ${u.id} ${u.name} · Q${u.block} L${u.lot} · ${u.area}m² · R$ ${u.price} · matrícula ${u.registration_number || "—"} · status ${u.sale_status_id} · tipo ${u.enterprise_unity_type_id}`,
    );
  }
  process.exit(0);
}

// ── lê a planilha conferida ───────────────────────────────────────────────
const wb = new ExcelJS.Workbook();
await wb.xlsx.readFile(PLANILHA);
const ws = wb.worksheets[0];
const cel = (row, n) => {
  const v = row.getCell(n).value;
  if (v === null || v === undefined) return "";
  if (typeof v === "object") return String(v.result ?? v.text ?? "");
  return String(v);
};

const unidades = [];
for (let i = 2; i <= ws.rowCount; i++) {
  const row = ws.getRow(i);
  const quadra = cel(row, 1).trim();
  const lote = cel(row, 2).trim();
  if (!quadra || !lote) continue;
  unidades.push({
    area: Number(cel(row, 3)),
    lote,
    matricula: cel(row, 5).trim(),
    quadra,
    statusId: Number(cel(row, 9)),
    tipoId: Number(cel(row, 7)),
    valor: Number(cel(row, 4)),
  });
}

// PADRÃO DA CASA: quadra e lote sempre com DOIS DÍGITOS — "1" vira "01". Vale para os campos
// `block` e `lot`, não só para o nome. É como o Lagoa Bonita está gravado no C2X (block "C01",
// lot "01") e é o que mantém a ordenação certa nas telas e nos relatórios: sem isso o lote 10
// aparece antes do 2. Números com 3+ dígitos passam inteiros.
const doisDigitos = (v) => String(v).trim().padStart(2, "0");
const nomeDaUnidade = (u) => `${PREFIXO_DO_NOME}${doisDigitos(u.quadra)}${doisDigitos(u.lote)}`;

const montarPayload = (u) => ({
  area: u.area,
  block: doisDigitos(u.quadra),
  enterprise_id: EMPREENDIMENTO_ID,
  enterprise_unity_type_id: u.tipoId,
  lot: doisDigitos(u.lote),
  name: nomeDaUnidade(u),
  price: u.valor,
  registration: u.matricula,
  registration_number: u.matricula,
  sale_status_id: u.statusId,
});

// ── o que falta subir ─────────────────────────────────────────────────────
const jaLa = await unidadesNoC2x();
// Compara nos DOIS lados já com dois dígitos: o C2X guarda "01" e a planilha traz "1". Sem essa
// normalização o script acharia que nada existe e criaria tudo de novo, em duplicidade.
const jaExiste = new Set(jaLa.map((u) => `${doisDigitos(u.block)}|${doisDigitos(u.lot)}`));
const aSubir = unidades.filter(
  (u) => !jaExiste.has(`${doisDigitos(u.quadra)}|${doisDigitos(u.lote)}`),
);

console.log(`Planilha: ${unidades.length} unidades`);
console.log(`Já no C2X: ${jaLa.length}`);
console.log(`A subir: ${aSubir.length}`);

const problemas = aSubir.filter(
  (u) => !u.matricula || !Number.isFinite(u.area) || !Number.isFinite(u.valor) || !u.statusId || !u.tipoId,
);
if (problemas.length > 0) {
  console.error(`\n⛔ ${problemas.length} sem dado obrigatório. Nada foi enviado:`);
  for (const p of problemas.slice(0, 10)) console.error(`  Q${p.quadra} L${p.lote}`);
  process.exit(1);
}

const lote = aSubir.slice(0, limite);

if (!enviarDeVerdade) {
  console.log(`\n── ENSAIO (nada foi enviado) ──`);
  console.log(`Iriam agora: ${lote.length}`);
  console.log(`\nExemplo do corpo que sai:`);
  console.log(JSON.stringify(montarPayload(lote[0]), null, 2));
  console.log(`\nPara enviar de verdade:`);
  console.log(`  node scripts/apolo/subir-unidades-c2x.mjs --enviar --n=5`);
  process.exit(0);
}

// ── envio ─────────────────────────────────────────────────────────────────
const base = host;
const token = env.C2X_WRITE_API_TOKEN;
if (!token) {
  console.error("Falta C2X_WRITE_API_TOKEN em apps/hub/.env.local");
  process.exit(1);
}

const destino = new URL(base).host;
console.log(`\n╔═══════════════════════════════════════════════════════`);
console.log(`║  DESTINO: ${destino}`);
console.log(`║  ${destino === "sistema.careli.adm.br" ? "É o C2X de PRODUÇÃO." : "⚠️  NÃO é o C2X de produção!"}`);
console.log(`╚═══════════════════════════════════════════════════════`);
console.log(`\nEnviando ${lote.length}...\n`);

let ok = 0;
const falhas = [];
for (const u of lote) {
  const inicio = Date.now();
  try {
    const resp = await fetch(`${base}${CAMINHO}`, {
      body: JSON.stringify(montarPayload(u)),
      headers: {
        Accept: "application/json",
        access_token: token,
        Authorization: token,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const texto = await resp.text();
    const ms = Date.now() - inicio;
    if (resp.status === 200 || resp.status === 201) {
      ok += 1;
      console.log(`  ✅ Q${u.quadra} L${u.lote} · matrícula ${u.matricula} · ${ms}ms`);
    } else {
      falhas.push({ resposta: texto.slice(0, 200), status: resp.status, u });
      console.log(`  ❌ Q${u.quadra} L${u.lote} · HTTP ${resp.status} · ${texto.slice(0, 120)}`);
    }
  } catch (erro) {
    falhas.push({ resposta: String(erro), status: null, u });
    console.log(`  ❌ Q${u.quadra} L${u.lote} · ${erro}`);
  }
}

console.log(`\nEnviadas: ${ok} · Falhas: ${falhas.length}`);

// Confere no banco: a API dizer "criei" não é prova de que criou — lição do incidente com os
// cadastros de cliente, em que 8 responderam sucesso e foram parar no ambiente de teste.
const depois = await unidadesNoC2x();
console.log(`\nConferência no banco do C2X: ${depois.length} unidades no Vale do Ouro (antes: ${jaLa.length}).`);
if (depois.length - jaLa.length !== ok) {
  console.log(`⚠️  A API confirmou ${ok}, mas o banco ganhou ${depois.length - jaLa.length}. Conferir.`);
}
