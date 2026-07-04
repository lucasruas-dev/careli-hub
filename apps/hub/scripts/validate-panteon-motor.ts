/*
 * Validação do SUPER MOTOR do Panteon (módulo C2X) contra o banco REAL — READ-ONLY.
 *
 *   npx tsx --tsconfig apps/hub/tsconfig.json apps/hub/scripts/validate-panteon-motor.ts
 *
 * Compara o caminho de produção (queryPanteon → builder → pool) com queries de REFERÊNCIA
 * independentes (as mesmas dos loaders já validados: movimentação, vendas por
 * empreendimento, ranking de imobiliárias) + cross-checks de consistência interna
 * (soma dos grupos == total, filtro == linha do grupo, período nomeado == janela custom).
 * Regra da operação: NENHUMA combinação nova entra no ar sem passar aqui.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Carrega o .env.local do apps/hub (GUARDIAN_DB_*) sem depender de flag do node.
// (Os imports estáticos abaixo são seguros: nenhum módulo lê env no import — só no uso.)
const here = path.dirname(fileURLToPath(import.meta.url));

for (const line of readFileSync(path.join(here, "..", ".env.local"), "utf8").split(
  /\r?\n/,
)) {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());

  if (match && process.env[match[1]!] === undefined) {
    // Tira aspas em volta (o .env.local usa "..." em alguns valores).
    process.env[match[1]!] = match[2]!.replace(/^["']|["']$/g, "");
  }
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RowDataPacket } from "mysql2/promise";

import { queryPanteon } from "@/lib/analytics/query-panteon";
import {
  displayEnterprise,
  EXCLUDED_ENTERPRISE_CODES,
  resolvePeriodoRange,
  type C2xPeriodo,
} from "@/lib/guardian/c2x-analytics";
import { getHadesDbPool } from "@/lib/guardian/db";

const EXCL = EXCLUDED_ENTERPRISE_CODES;
const EXCL_IN = EXCL.map(() => "?").join(", ");

let pass = 0;
let fail = 0;

function check(nome: string, ok: boolean, detalhe: string) {
  if (ok) {
    pass += 1;
    console.log(`  ✅ ${nome} — ${detalhe}`);
  } else {
    fail += 1;
    console.log(`  ❌ ${nome} — ${detalhe}`);
  }
}

let supabase: SupabaseClient | null = null;

async function motorTotal(raw: Record<string, unknown>): Promise<number> {
  const outcome = await queryPanteon(
    { modulo: "c2x", ...raw },
    { supabase },
  );

  if (!outcome.ok) {
    throw new Error(`motor falhou (${JSON.stringify(raw)}): ${outcome.erro}`);
  }

  return outcome.resultado.total;
}

async function motorGrupos(
  raw: Record<string, unknown>,
): Promise<{ total: number; grupos: Map<string, number> }> {
  const outcome = await queryPanteon(
    { modulo: "c2x", ...raw },
    { supabase },
  );

  if (!outcome.ok) {
    throw new Error(`motor falhou (${JSON.stringify(raw)}): ${outcome.erro}`);
  }

  return {
    grupos: new Map(
      (outcome.resultado.grupos ?? []).map((g) => [g.grupo, g.valor]),
    ),
    total: outcome.resultado.total,
  };
}

async function motorIris(
  raw: Record<string, unknown>,
): Promise<{ total: number; grupos: Map<string, number> }> {
  const outcome = await queryPanteon({ modulo: "iris", ...raw }, { supabase });

  if (!outcome.ok) {
    throw new Error(`motor iris falhou (${JSON.stringify(raw)}): ${outcome.erro}`);
  }

  return {
    grupos: new Map(
      (outcome.resultado.grupos ?? []).map((g) => [g.grupo, g.valor]),
    ),
    total: outcome.resultado.total,
  };
}

async function main() {
  const poolResult = getHadesDbPool();

  if (!poolResult.ok) {
    throw new Error(`GUARDIAN_DB_* ausente: ${poolResult.missing.join(", ")}`);
  }

  const pool = poolResult.pool;

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;

  supabase =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, {
          auth: { autoRefreshToken: false, persistSession: false },
        })
      : null;
  const ref = async <T extends RowDataPacket>(sql: string, params: unknown[]) =>
    (await pool.query<T[]>(sql, params))[0];

  // ---------- 1. Movimentação (evento) vs referência validada ----------
  console.log("\n[1] Movimentação por período (vs query de referência do resumo)");

  for (const periodo of ["este_mes", "mes_passado", "este_ano"] as C2xPeriodo[]) {
    const { from, to } = resolvePeriodoRange(periodo);
    const rows = await ref<RowDataPacket & { stage_id: number; n: unknown }>(
      `select h.new_acquisition_request_stage_id as stage_id, count(*) as n
       from acquisition_request_historics h
       join acquisition_requests ar on ar.id = h.acquisition_request_id
       join enterprise_unities eu on eu.id = ar.enterprise_unity_id
       join enterprises e on e.id = eu.enterprise_id
       where h.created_at >= ? and h.created_at < ? and e.code not in (${EXCL_IN})
       group by h.new_acquisition_request_stage_id`,
      [from, to, ...EXCL],
    );
    const byStage = new Map(rows.map((r) => [Number(r.stage_id), Number(r.n)]));
    const get = (...stages: number[]) =>
      stages.reduce((sum, stage) => sum + (byStage.get(stage) ?? 0), 0);

    const esperado = {
      cancelamentos: get(7, 10, 11),
      faturamentos: get(4),
      propostas: get(9),
      reservas: get(1),
      vendas: get(3, 5, 4),
    };

    for (const [metrica, valorRef] of Object.entries(esperado)) {
      const valorMotor = await motorTotal({ metrica, periodo });

      check(
        `${metrica} (${periodo})`,
        valorMotor === valorRef,
        `motor=${valorMotor} ref=${valorRef}`,
      );
    }
  }

  // ---------- 2. Carteira por empreendimento (estado) vs referência validada ----------
  console.log("\n[2] Unidades por empreendimento (vs query do painel validada)");

  const cartRows = await ref<
    RowDataPacket & {
      code: string | null;
      name: string | null;
      total: unknown;
      vendidas: unknown;
      disponiveis: unknown;
    }
  >(
    `select e.code, e.name, count(*) as total,
            sum(eu.sale_status_id = 4) as vendidas,
            sum(eu.sale_status_id = 1) as disponiveis
     from enterprise_unities eu
     join enterprises e on e.id = eu.enterprise_id
     where e.code not in (${EXCL_IN})
     group by e.code, e.name`,
    [...EXCL],
  );
  const refCart = new Map<
    string,
    { total: number; vendidas: number; disponiveis: number }
  >();

  for (const row of cartRows) {
    const key = displayEnterprise(row.code, row.name);
    const cur = refCart.get(key) ?? { disponiveis: 0, total: 0, vendidas: 0 };

    cur.total += Number(row.total);
    cur.vendidas += Number(row.vendidas);
    cur.disponiveis += Number(row.disponiveis);
    refCart.set(key, cur);
  }

  for (const metrica of [
    "unidades_vendidas",
    "unidades_disponiveis",
    "unidades_total",
  ] as const) {
    const campo =
      metrica === "unidades_vendidas"
        ? "vendidas"
        : metrica === "unidades_disponiveis"
          ? "disponiveis"
          : "total";
    const { grupos, total } = await motorGrupos({
      agrupar_por: "empreendimento",
      metrica,
    });
    let todosIguais = true;

    for (const [emp, valores] of refCart) {
      if ((grupos.get(emp) ?? 0) !== valores[campo]) {
        todosIguais = false;
        console.log(
          `     divergência ${emp}: motor=${grupos.get(emp) ?? 0} ref=${valores[campo]}`,
        );
      }
    }

    const totalRef = Array.from(refCart.values()).reduce(
      (sum, valores) => sum + valores[campo],
      0,
    );

    check(
      `${metrica} por empreendimento`,
      todosIguais && total === totalRef,
      `total motor=${total} ref=${totalRef} (${grupos.size} grupos)`,
    );
  }

  // ---------- 3. Ranking de imobiliárias (estado faturado) vs referência validada ----------
  console.log("\n[3] Unidades faturadas por imobiliária (vs ranking validado)");

  const rankRows = await ref<
    RowDataPacket & { imobiliaria: string | null; unidades: unknown }
  >(
    `select coalesce(nullif(trim(imob.fantasy_name), ''), nullif(trim(imob.social_name), ''),
                     nullif(trim(imob.name), ''), '(venda direta / sem imobiliária)') as imobiliaria,
            count(distinct ar.enterprise_unity_id) as unidades
     from acquisition_requests ar
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     join enterprises e on e.id = eu.enterprise_id
     join users cli on cli.id = ar.client_id
     left join users imob on imob.id = cli.vinculed_by_id
     where ar.acquisition_request_stage_id = 4 and e.code not in (${EXCL_IN})
     group by imobiliaria order by unidades desc limit 30`,
    [...EXCL],
  );
  const { grupos: rankMotor, total: totalFaturadas } = await motorGrupos({
    agrupar_por: "imobiliaria",
    metrica: "unidades_faturadas",
  });
  let rankOk = true;

  for (const row of rankRows) {
    const nome = row.imobiliaria ?? "-";

    if ((rankMotor.get(nome) ?? -1) !== Number(row.unidades)) {
      rankOk = false;
      console.log(
        `     divergência ${nome}: motor=${rankMotor.get(nome)} ref=${row.unidades}`,
      );
    }
  }

  check(
    "ranking imobiliárias",
    rankOk && rankMotor.size === rankRows.length,
    `${rankMotor.size} imobiliárias, top=${rankRows[0]?.imobiliaria} (${rankRows[0]?.unidades})`,
  );

  // Total distinto sem o join de cliente (detecta aquisição faturada sem comprador).
  const [semCli] = await ref<RowDataPacket & { n: unknown }>(
    `select count(distinct ar.enterprise_unity_id) as n
     from acquisition_requests ar
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     join enterprises e on e.id = eu.enterprise_id
     where ar.acquisition_request_stage_id = 4 and e.code not in (${EXCL_IN})`,
    [...EXCL],
  );

  check(
    "unidades_faturadas total (join cliente não altera)",
    totalFaturadas === Number(semCli?.n),
    `com join=${totalFaturadas} sem join=${Number(semCli?.n)}`,
  );

  // ---------- 4. Cross-checks de consistência do cubo ----------
  console.log("\n[4] Consistência interna (grupos x total x filtros x janelas)");

  const fatAno = await motorTotal({ metrica: "faturamentos", periodo: "este_ano" });
  const fatPorMes = await motorGrupos({
    agrupar_por: "mes",
    metrica: "faturamentos",
    periodo: "este_ano",
  });
  const somaMes = Array.from(fatPorMes.grupos.values()).reduce((a, b) => a + b, 0);

  check(
    "faturamentos este_ano: soma dos meses == total",
    somaMes === fatAno,
    `soma=${somaMes} total=${fatAno}`,
  );

  const fatPorEmp = await motorGrupos({
    agrupar_por: "empreendimento",
    metrica: "faturamentos",
    periodo: "este_ano",
  });
  const somaEmp = Array.from(fatPorEmp.grupos.values()).reduce((a, b) => a + b, 0);

  check(
    "faturamentos este_ano: soma dos empreendimentos == total",
    somaEmp === fatAno,
    `soma=${somaEmp} total=${fatAno}`,
  );

  const lavra = fatPorEmp.grupos.get("Lavra do Ouro") ?? 0;
  const lavraFiltrado = await motorTotal({
    filtros: { empreendimento: "Lavra do Ouro" },
    metrica: "faturamentos",
    periodo: "este_ano",
  });

  check(
    "filtro empreendimento == linha do grupo (Lavra do Ouro)",
    lavraFiltrado === lavra,
    `filtro=${lavraFiltrado} grupo=${lavra}`,
  );

  const vendasAno = await motorTotal({ metrica: "vendas", periodo: "este_ano" });
  const vendasPorEstagio = await motorGrupos({
    agrupar_por: "estagio",
    metrica: "vendas",
    periodo: "este_ano",
  });
  const somaEstagio = Array.from(vendasPorEstagio.grupos.values()).reduce(
    (a, b) => a + b,
    0,
  );

  check(
    "vendas este_ano: soma dos estágios == total",
    somaEstagio === vendasAno,
    `soma=${somaEstagio} total=${vendasAno} (${Array.from(vendasPorEstagio.grupos.keys()).join(" / ")})`,
  );

  const fatJunhoNomeado = await motorTotal({
    metrica: "faturamentos",
    periodo: "mes_passado",
  });
  const fatJunhoCustom = await motorTotal({
    data_fim: "2026-06-30",
    data_inicio: "2026-06-01",
    metrica: "faturamentos",
  });

  check(
    "mes_passado == janela custom (junho/2026)",
    fatJunhoNomeado === fatJunhoCustom,
    `nomeado=${fatJunhoNomeado} custom=${fatJunhoCustom}`,
  );

  const fat30 = await motorTotal({
    metrica: "faturamentos",
    periodo: "ultimos_30_dias",
  });
  const fatPorSemana = await motorGrupos({
    agrupar_por: "semana",
    metrica: "faturamentos",
    periodo: "ultimos_30_dias",
  });
  const somaSemana = Array.from(fatPorSemana.grupos.values()).reduce(
    (a, b) => a + b,
    0,
  );

  check(
    "faturamentos 30d: soma das semanas == total",
    somaSemana === fat30,
    `soma=${somaSemana} total=${fat30}`,
  );

  // ---------- 5. Métricas novas (referência independente no script) ----------
  console.log("\n[5] Métricas novas vs referência independente");

  const { from: anoFrom, to: anoTo } = resolvePeriodoRange("este_ano");
  const [cliRef] = await ref<RowDataPacket & { n: unknown }>(
    `select count(distinct ar.client_id) as n
     from acquisition_request_historics h
     join acquisition_requests ar on ar.id = h.acquisition_request_id
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     join enterprises e on e.id = eu.enterprise_id
     where h.created_at >= ? and h.created_at < ?
       and h.new_acquisition_request_stage_id = 4 and e.code not in (${EXCL_IN})`,
    [anoFrom, anoTo, ...EXCL],
  );
  const cliMotor = await motorTotal({
    metrica: "clientes_faturados",
    periodo: "este_ano",
  });

  check(
    "clientes_faturados este_ano",
    cliMotor === Number(cliRef?.n),
    `motor=${cliMotor} ref=${Number(cliRef?.n)}`,
  );

  const [valRef] = await ref<RowDataPacket & { v: unknown }>(
    `select coalesce(sum(eu.price), 0) as v
     from acquisition_request_historics h
     join acquisition_requests ar on ar.id = h.acquisition_request_id
     join enterprise_unities eu on eu.id = ar.enterprise_unity_id
     join enterprises e on e.id = eu.enterprise_id
     where h.created_at >= ? and h.created_at < ?
       and h.new_acquisition_request_stage_id = 4 and e.code not in (${EXCL_IN})`,
    [anoFrom, anoTo, ...EXCL],
  );
  const valMotor = await motorTotal({
    metrica: "valor_faturado",
    periodo: "este_ano",
  });

  check(
    "valor_faturado este_ano",
    Math.abs(valMotor - Number(valRef?.v)) < 0.01,
    `motor=${valMotor.toFixed(2)} ref=${Number(valRef?.v).toFixed(2)}`,
  );

  // Filtro por imobiliária: pega uma imobiliária ATIVA no ano (top do agrupamento de
  // faturamentos) pra exercitar o filtro com número > 0, e confere contra a linha do grupo.
  const fatPorImob = await motorGrupos({
    agrupar_por: "imobiliaria",
    metrica: "faturamentos",
    periodo: "este_ano",
  });
  const topAtiva = Array.from(fatPorImob.grupos.entries()).find(
    ([nome, valor]) => valor > 0 && !nome.startsWith("(venda direta"),
  );

  if (topAtiva) {
    const [nomeImob, valorGrupo] = topAtiva;
    const fatTop = await motorTotal({
      filtros: { imobiliaria: nomeImob },
      metrica: "faturamentos",
      periodo: "este_ano",
    });
    const cliTop = await motorTotal({
      filtros: { imobiliaria: nomeImob },
      metrica: "clientes_faturados",
      periodo: "este_ano",
    });

    check(
      `filtro imobiliária "${nomeImob}" == linha do grupo`,
      fatTop === valorGrupo && cliTop > 0 && cliTop <= fatTop,
      `filtro=${fatTop} grupo=${valorGrupo} clientes=${cliTop}`,
    );
  } else {
    check("filtro imobiliária ativa no ano", false, "nenhuma imobiliária com faturamento no ano");
  }

  // ---------- 6. Módulo IRIS (Supabase) vs referência independente ----------
  console.log("\n[6] Módulo Iris (atendimento) vs referência Supabase");

  // O .env.local pode apontar pra um Supabase de homolog fora do ar. Testa a conexão antes;
  // se não responder, PULA a seção (não derruba a suíte do C2X). Em prod/preview o env aponta
  // pro projeto vivo e a seção roda de verdade.
  const irisReachable = await (async () => {
    if (!supabase) {
      return false;
    }

    try {
      const { error } = await supabase
        .from("caredesk_tickets")
        .select("id", { count: "exact", head: true });

      return !error;
    } catch {
      return false;
    }
  })();

  if (!supabase || !irisReachable) {
    console.log(
      "  ⏭️  PULADO — Supabase do env não respondeu (provável homolog fora do ar). Rode com env de prod pra validar a Iris.",
    );
  } else {
    const sb = supabase;

    // Estado: abertos == não terminais; soma por fila == total.
    const terminal = ["closed", "resolved", "cancelled"];
    const { count: abertosRef } = await sb
      .from("caredesk_tickets")
      .select("id", { count: "exact", head: true })
      .not("status", "in", `(${terminal.join(",")})`);
    const abertos = await motorIris({ metrica: "tickets_abertos" });

    check(
      "tickets_abertos (total)",
      abertos.total === (abertosRef ?? -1),
      `motor=${abertos.total} ref=${abertosRef}`,
    );

    const abertosPorFila = await motorIris({
      agrupar_por: "fila",
      metrica: "tickets_abertos",
    });
    const somaFila = Array.from(abertosPorFila.grupos.values()).reduce(
      (a, b) => a + b,
      0,
    );

    check(
      "tickets_abertos: soma das filas == total",
      somaFila === abertosPorFila.total &&
        abertosPorFila.total === (abertosRef ?? -1),
      `soma=${somaFila} total=${abertosPorFila.total} (${abertosPorFila.grupos.size} filas)`,
    );

    // Aguardando operador/cliente vs contagem direta por status.
    for (const [metrica, status] of [
      ["aguardando_operador", "waiting_operator"],
      ["aguardando_cliente", "waiting_customer"],
    ] as const) {
      const { count } = await sb
        .from("caredesk_tickets")
        .select("id", { count: "exact", head: true })
        .eq("status", status);
      const motor = await motorIris({ metrica });

      check(
        `${metrica}`,
        motor.total === (count ?? -1),
        `motor=${motor.total} ref=${count}`,
      );
    }

    // Evento: finalizados este ano vs closed_at na janela; soma por dia == total.
    const { from: anoF, to: anoT } = resolvePeriodoRange("este_ano");
    const { count: finRef } = await sb
      .from("caredesk_tickets")
      .select("id", { count: "exact", head: true })
      .gte("closed_at", anoF.toISOString())
      .lt("closed_at", anoT.toISOString());
    const fin = await motorIris({
      metrica: "tickets_finalizados",
      periodo: "este_ano",
    });

    check(
      "tickets_finalizados este_ano",
      fin.total === (finRef ?? -1),
      `motor=${fin.total} ref=${finRef}`,
    );

    const finPorDia = await motorIris({
      agrupar_por: "dia",
      metrica: "tickets_finalizados",
      periodo: "este_ano",
    });
    const somaDia = Array.from(finPorDia.grupos.values()).reduce(
      (a, b) => a + b,
      0,
    );

    check(
      "tickets_finalizados: soma dos dias == total",
      somaDia === fin.total,
      `soma=${somaDia} total=${fin.total}`,
    );

    // Filtro por fila == linha do agrupamento.
    const topFila = Array.from(abertosPorFila.grupos.entries()).find(
      ([nome, valor]) => valor > 0 && nome !== "Sem fila",
    );

    if (topFila) {
      const [nomeFila, valorFila] = topFila;
      const filtrado = await motorIris({
        filtros: { fila: nomeFila },
        metrica: "tickets_abertos",
      });

      check(
        `filtro fila "${nomeFila}" == linha do grupo`,
        filtrado.total === valorFila,
        `filtro=${filtrado.total} grupo=${valorFila}`,
      );
    }
  }

  console.log(`\nResultado: ${pass} ✅ · ${fail} ❌`);
  await pool.end();

  if (fail > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("Validação abortou:", error);
  process.exitCode = 1;
});
