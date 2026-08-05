// DIVISÃO DO VALE DO OURO — VLO (35) → VOC (37, internas·Cecílio) + VOL (36, externas·Lino).
// Pedido do Lucas, 02/08: replicar as unidades nos dois empreendimentos novos, transferir as
// propostas e aposentar as unidades do VLO. Padrão Lagoa Bonita (família de empreendimentos).
//
// TRÊS FASES, cada uma só roda com a flag explícita (sem flag = ENSAIO, zero escrita):
//   --criar-unidades   FASE 1: POST na API oficial (mesma via das 298 originais).
//   --mover-propostas  FASE 2: UPDATE acquisition_requests.enterprise_unity_id no MySQL
//                      (EXCEÇÃO à regra read-only, autorizada pelo Lucas para esta migração).
//                      Backup completo das linhas ANTES, no Desktop.
//   --aposentar-vlo    FASE 3: sale_blocked=1 + sale_status 5 nas 298 do VLO (não vender lá).
//
// A equivalência é por (block, lot): quadra/lote NÃO mudam — é o que mantém os contratos
// gerados válidos (os três empreendimentos se chamam VALE DO OURO no papel).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const requireDoRepo = createRequire(path.resolve(process.cwd(), "apps/hub/package.json"));
const mysql = requireDoRepo("mysql2/promise");

const env = Object.fromEntries(
  fs.readFileSync(path.resolve(process.cwd(), "apps/hub/.env.local"), "utf8")
    .split("\n").filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")]; }),
);

const VLO = 35, VOL = 36, VOC = 37;
const DESTINO = { "Unidade externa": { id: VOL, prefixo: "VOL" }, "Unidade interna": { id: VOC, prefixo: "VOC" } };
const HOST_PRODUCAO = "https://sistema.careli.adm.br";
const CAMINHO = "/api/v1/integrations/panteon/enterprise_units";

const args = process.argv.slice(2);
const criarUnidades = args.includes("--criar-unidades");
const moverPropostas = args.includes("--mover-propostas");
const aposentarVlo = args.includes("--aposentar-vlo");
const casa = process.env.USERPROFILE || ".";

const c = await mysql.createConnection({
  database: env.GUARDIAN_DB_NAME, host: env.GUARDIAN_DB_HOST, password: env.GUARDIAN_DB_PASSWORD,
  port: +(env.GUARDIAN_DB_PORT || 3306), user: env.GUARDIAN_DB_USER,
});

// ── o mapa: unidades do VLO + (se existirem) as equivalentes já criadas em VOC/VOL ──
const [orig] = await c.query(
  `SELECT eu.id, eu.name, eu.block, eu.lot, eu.area, eu.price, eu.registration,
          eu.registration_number, eu.registration_book_number, eu.sale_status_id,
          eu.sale_blocked, eu.secured_lot, eu.extensive_area, eu.extensive_price,
          t.name tipo
     FROM enterprise_unities eu
     LEFT JOIN enterprise_unity_types t ON t.id = eu.enterprise_unity_type_id
    WHERE eu.enterprise_id = ?`, [VLO]);
const [novasJa] = await c.query(
  `SELECT id, enterprise_id, block, lot FROM enterprise_unities WHERE enterprise_id IN (?, ?)`,
  [VOL, VOC]);
const chave = (e, b, l) => `${e}|${String(b).trim()}|${String(l).trim()}`;
const novasPorChave = new Map(novasJa.map((u) => [chave(u.enterprise_id, u.block, u.lot), u.id]));

const semTipo = orig.filter((u) => !DESTINO[u.tipo]);
if (semTipo.length) {
  console.error(`ABORTA: ${semTipo.length} unidades do VLO sem tipo interna/externa (ex.: ${semTipo[0].name}).`);
  process.exit(1);
}

console.log(`VLO: ${orig.length} unidades → VOC ${orig.filter((u) => u.tipo === "Unidade interna").length} · VOL ${orig.filter((u) => u.tipo === "Unidade externa").length}`);
console.log(`Já criadas nos destinos: ${novasJa.length}`);

// ── FASE 1: criar as unidades ─────────────────────────────────────────────
if (criarUnidades) {
  const token = env.C2X_WRITE_API_TOKEN;
  if (!token) { console.error("Sem C2X_WRITE_API_TOKEN."); process.exit(1); }
  console.log(`\nFASE 1 · destino ${HOST_PRODUCAO} (produção)`);
  let criadas = 0, puladas = 0, erros = 0;
  for (const u of orig) {
    const destino = DESTINO[u.tipo];
    if (novasPorChave.has(chave(destino.id, u.block, u.lot))) { puladas++; continue; }
    const numero = String(u.name ?? "").replace(/^VLO/i, "") || `${u.block}${u.lot}`;
    const payload = {
      area: u.area, block: u.block, enterprise_id: destino.id,
      enterprise_unity_type_id: u.tipo === "Unidade interna" ? 1 : 2,
      extensive_area: u.extensive_area, extensive_price: u.extensive_price,
      lot: u.lot, name: `${destino.prefixo}${numero}`, price: u.price,
      registration: u.registration, registration_book_number: u.registration_book_number,
      registration_number: u.registration_number,
      sale_blocked: u.sale_blocked, sale_status_id: u.sale_status_id,
      secured_lot: u.secured_lot,
    };
    // ⚠️ O C2X autentica com `Authorization: <token>` CRU (sem "Bearer") + `access_token`, o
    // mesmo formato de lib/apolo/c2x-write.ts e do subir-unidades-c2x.mjs. Mandar "Bearer"
    // devolve 401 e parece token revogado — foi o que me custou uma manhã em 03/08.
    const r = await fetch(`${HOST_PRODUCAO}${CAMINHO}`, {
      body: JSON.stringify(payload),
      headers: {
        access_token: token,
        Authorization: token,
        "content-type": "application/json",
      },
      method: "POST",
    });
    if (r.ok) criadas++;
    else if (r.status === 409) puladas++;
    else { erros++; console.error(`  ERRO ${r.status} em ${payload.name}: ${(await r.text()).slice(0, 120)}`); }
    if ((criadas + puladas + erros) % 50 === 0) console.log(`  ...${criadas + puladas + erros}/${orig.length}`);
  }
  console.log(`FASE 1: criadas ${criadas} · puladas(já existiam) ${puladas} · erros ${erros}`);
}

// ── FASE 2: mover as propostas ────────────────────────────────────────────
if (moverPropostas) {
  const [novas2] = await c.query(
    `SELECT id, enterprise_id, block, lot FROM enterprise_unities WHERE enterprise_id IN (?, ?)`,
    [VOL, VOC]);
  const mapa2 = new Map(novas2.map((u) => [chave(u.enterprise_id, u.block, u.lot), u.id]));
  const [props] = await c.query(
    `SELECT ar.id, ar.enterprise_unity_id, ar.open, ar.acquisition_request_stage_id,
            eu.block, eu.lot, t.name tipo
       FROM acquisition_requests ar
       JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id
       LEFT JOIN enterprise_unity_types t ON t.id = eu.enterprise_unity_type_id
      WHERE eu.enterprise_id = ?`, [VLO]);

  const plano = [];
  for (const p of props) {
    const destino = DESTINO[p.tipo];
    const novaId = destino ? mapa2.get(chave(destino.id, p.block, p.lot)) : null;
    if (!novaId) { console.error(`SEM DESTINO para proposta ${p.id} (Q${p.block} L${p.lot} ${p.tipo}) — rode a fase 1 antes.`); process.exit(1); }
    plano.push({ de: p.enterprise_unity_id, novaId, propostaId: p.id });
  }
  const backup = path.join(casa, "Desktop", `BACKUP_PROPOSTAS_VLO_${Date.now()}.json`);
  fs.writeFileSync(backup, JSON.stringify(props, null, 1));
  console.log(`\nFASE 2 · ${plano.length} propostas · backup: ${backup}`);
  let movidas = 0;
  for (const m of plano) {
    await c.query(`UPDATE acquisition_requests SET enterprise_unity_id = ? WHERE id = ? AND enterprise_unity_id = ?`,
      [m.novaId, m.propostaId, m.de]);
    movidas++;
    if (movidas % 50 === 0) console.log(`  ...${movidas}/${plano.length}`);
  }
  console.log(`FASE 2: movidas ${movidas}. Para DESFAZER: o backup tem (id, enterprise_unity_id) originais.`);
}

// ── FASE 3: aposentar as unidades do VLO ──────────────────────────────────
if (aposentarVlo) {
  const [r] = await c.query(
    `UPDATE enterprise_unities SET sale_blocked = 1, sale_status_id = 5 WHERE enterprise_id = ?`, [VLO]);
  console.log(`\nFASE 3: ${r.affectedRows} unidades do VLO bloqueadas (sale_blocked=1, status 5).`);
}

if (!criarUnidades && !moverPropostas && !aposentarVlo) {
  // ENSAIO: mostra o plano e uma amostra da equivalência.
  const amostra = orig.slice(0, 4).map((u) => {
    const d = DESTINO[u.tipo];
    return `${u.name} (Q${u.block} L${u.lot}, ${u.tipo}) → ${d.prefixo} · status ${u.sale_status_id}`;
  });
  console.log("\nENSAIO (nada foi escrito). Amostra da divisão:");
  for (const a of amostra) console.log("  " + a);
  const [props] = await c.query(
    `SELECT COUNT(*) qtd, SUM(ar.open=1) abertas FROM acquisition_requests ar
      JOIN enterprise_unities eu ON eu.id = ar.enterprise_unity_id WHERE eu.enterprise_id = ?`, [VLO]);
  console.log(`Propostas a mover na fase 2: ${props[0].qtd} (${props[0].abertas} abertas).`);
}

await c.end();
