/*
 * MEDIÇÃO DO ESPELHO DO VALE DO OURO — READ-ONLY (só SELECT no C2X).
 *
 *   node apps/hub/scripts/apolo/medir-espelho-vale-do-ouro.mjs
 *
 * Prova, com número, o que a regra ENTERPRISE_MIRRORS (lib/guardian/c2x-analytics.ts) corrige:
 * o VLO (35) é o registro HISTÓRICO do Vale do Ouro de antes da divisão, e as 298 unidades dele
 * são as MESMAS de VOC (37) + VOL (36), par a par por quadra/lote. Quem soma os três conta o
 * Vale do Ouro duas vezes.
 *
 * Imprime:
 *   1. o total geral ANTES  (somando o espelho — o que a tela mostrava até 18/08/2026);
 *   2. o total geral DEPOIS (sem o espelho — o que `loadApoloEnterprises` passa a somar);
 *   3. o detalhe dos quatro empreendimentos "VALE DO OURO";
 *   4. o pareamento quadra/lote entre o espelho e as divisões vivas (a prova de que é cópia).
 *
 * ⚠️ NÃO escreve nada. O único acesso ao legado é `pool.query` com SELECT.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import mysql from "mysql2/promise";

const here = path.dirname(fileURLToPath(import.meta.url));

for (const line of readFileSync(path.join(here, "..", "..", ".env.local"), "utf8").split(
  /\r?\n/,
)) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());

  if (match && process.env[match[1]] === undefined) {
    process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
}

// Mesmas constantes do código de produção (lib/guardian/c2x-analytics.ts). Copiadas de propósito:
// o script é .mjs e não importa TypeScript — se divergirem, a checagem final abaixo acusa.
const EXCLUDED_ENTERPRISE_CODES = ["TSC", "SDT", "LAB", "LAG"];
const MIRROR_ENTERPRISE_CODES = ["VLO"];

// O que a auditoria de 18/08/2026 mediu na tela "todos os empreendimentos" do Apolo.
const ESPERADO = {
  antes: { unidades: 4560, valor: 1068042231.43 },
  depois: { unidades: 4262, valor: 1040273342.43 },
};

const brl = (valor) =>
  valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, style: "currency", currency: "BRL" });

async function main() {
  const pool = mysql.createPool({
    database: process.env.GUARDIAN_DB_NAME,
    host: process.env.GUARDIAN_DB_HOST,
    password: process.env.GUARDIAN_DB_PASSWORD,
    port: Number(process.env.GUARDIAN_DB_PORT ?? 3306),
    user: process.env.GUARDIAN_DB_USER,
    connectionLimit: 2,
  });

  try {
    // A MESMA leitura de `loadApoloEnterprises` (lib/apolo/empreendimentos.ts), reduzida ao que
    // interessa aqui: uma linha por empreendimento, com unidades e valor da carteira.
    const placeholders = EXCLUDED_ENTERPRISE_CODES.map(() => "?").join(", ");
    const [linhas] = await pool.query(
      `select e.id, e.code, e.name,
              count(u.id) as total_units,
              coalesce(sum(u.price), 0) as total_value
         from enterprises e
         left join enterprise_unities u on u.enterprise_id = e.id
        where e.code not in (${placeholders})
        group by e.id, e.code, e.name
        order by e.code`,
      EXCLUDED_ENTERPRISE_CODES,
    );

    const somar = (rows) =>
      rows.reduce(
        (acc, row) => ({
          unidades: acc.unidades + Number(row.total_units ?? 0),
          valor: acc.valor + Number(row.total_value ?? 0),
        }),
        { unidades: 0, valor: 0 },
      );

    const espelhos = linhas.filter((row) =>
      MIRROR_ENTERPRISE_CODES.includes(String(row.code ?? "").toUpperCase()),
    );
    const vivos = linhas.filter(
      (row) => !MIRROR_ENTERPRISE_CODES.includes(String(row.code ?? "").toUpperCase()),
    );

    const antes = somar(linhas);
    const depois = somar(vivos);
    const espelho = somar(espelhos);

    console.log("\n═══ TOTAL GERAL DA TELA DE EMPREENDIMENTOS ═══");
    console.log(`  ANTES  (com o espelho): ${antes.unidades} un · ${brl(antes.valor)}`);
    console.log(`  DEPOIS (sem o espelho): ${depois.unidades} un · ${brl(depois.valor)}`);
    console.log(`  espelho retirado:       ${espelho.unidades} un · ${brl(espelho.valor)}`);

    console.log("\n═══ OS QUATRO 'VALE DO OURO' NO C2X ═══");
    const [vale] = await pool.query(
      `select e.id, e.code, e.name,
              count(u.id) as total_units,
              coalesce(sum(u.price), 0) as total_value
         from enterprises e
         left join enterprise_unities u on u.enterprise_id = e.id
        where upper(e.name) like '%VALE DO OURO%'
        group by e.id, e.code, e.name
        order by e.id`,
    );

    for (const row of vale) {
      const marca = MIRROR_ENTERPRISE_CODES.includes(String(row.code ?? "").toUpperCase())
        ? "  ← ESPELHO (histórico, fora das somas)"
        : EXCLUDED_ENTERPRISE_CODES.includes(String(row.code ?? "").toUpperCase())
          ? "  ← excluído (EXCLUDED_ENTERPRISE_CODES)"
          : "";
      console.log(
        `  ${String(row.id).padStart(3)} ${String(row.code ?? "-").padEnd(4)} ${String(row.name ?? "-").padEnd(24)}` +
          ` ${String(row.total_units).padStart(4)} un · ${brl(Number(row.total_value))}${marca}`,
      );
    }

    const vivosDoVale = vale.filter(
      (row) =>
        !MIRROR_ENTERPRISE_CODES.includes(String(row.code ?? "").toUpperCase()) &&
        !EXCLUDED_ENTERPRISE_CODES.includes(String(row.code ?? "").toUpperCase()),
    );
    const somaVivos = somar(vivosDoVale);
    console.log(
      `  divisões vivas somadas:  ${somaVivos.unidades} un · ${brl(somaVivos.valor)}` +
        `  (espelho: ${espelho.unidades} un · ${brl(espelho.valor)})`,
    );

    console.log("\n═══ PROVA DE QUE O ESPELHO É CÓPIA (par a par por quadra/lote) ═══");
    const [[pares]] = await pool.query(
      `select count(*) as pareadas
         from enterprise_unities m
         join enterprise_unities c
           on trim(c.block) = trim(m.block)
          and trim(c.lot) = trim(m.lot)
          and c.enterprise_id in (36, 37)
        where m.enterprise_id = 35`,
    );
    const [[master]] = await pool.query(
      `select count(*) as total from enterprise_unities where enterprise_id = 35`,
    );
    console.log(
      `  unidades do espelho (35): ${master.total} · com gêmeo em VOC/VOL: ${pares.pareadas}` +
        (Number(pares.pareadas) === Number(master.total) ? "  ✅ todas" : "  ⚠️ sobra alguma"),
    );

    console.log("\n═══ CONFERE COM A AUDITORIA DE 18/08/2026 ═══");
    let falhas = 0;
    const conferir = (nome, medido, esperado) => {
      const ok =
        medido.unidades === esperado.unidades &&
        Math.abs(medido.valor - esperado.valor) < 0.005;
      if (!ok) falhas += 1;
      console.log(
        `  ${ok ? "✅" : "❌"} ${nome}: medido ${medido.unidades} un · ${brl(medido.valor)}` +
          ` | esperado ${esperado.unidades} un · ${brl(esperado.valor)}`,
      );
    };

    conferir("ANTES ", antes, ESPERADO.antes);
    conferir("DEPOIS", depois, ESPERADO.depois);
    console.log("");

    process.exitCode = falhas === 0 ? 0 : 1;
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error("[medir-espelho] falhou:", error?.message ?? error);
  process.exitCode = 1;
});
