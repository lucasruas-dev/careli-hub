import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  IrisAgruparPor,
  IrisMetrica,
  PanteonRange,
} from "./registry";

// Builder da IRIS (caredesk) pro SUPER MOTOR. Roda sobre o Supabase (JS client, service role
// do contexto da CACÁ) e agrega em memória — mesmo padrão validado do lib/iris/iris-analytics.
// O volume de tickets é baixo (centenas), então carregar as linhas do recorte e contar em JS
// é seguro; count-only usa head:true. Filtros por nome (fila/colaborador) são resolvidos a id
// ANTES da query, então nada de string do usuário entra em predicado cru.

// Estágios terminais: um ticket nesses status não conta como "em aberto".
const TERMINAL_STATUSES = ["closed", "resolved", "cancelled"];

// Rótulo humano dos status (pra agrupar por status ficar legível).
const STATUS_LABEL: Record<string, string> = {
  cancelled: "Cancelado",
  closed: "Finalizado",
  new: "Novo",
  open: "Em atendimento",
  pending: "Pendente",
  resolved: "Resolvido",
  waiting_customer: "Aguardando cliente",
  waiting_operator: "Aguardando operador",
};

type TicketRow = {
  id: string;
  status: string | null;
  queue_id: string | null;
  assigned_to_user_id: string | null;
  created_at: string | null;
  closed_at: string | null;
};

export type IrisBuilderInput = {
  metrica: IrisMetrica;
  agruparPor: IrisAgruparPor | null;
  filtros: Record<string, string>;
  range: PanteonRange | null;
};

export type IrisQueryResult = {
  total: number;
  grupos: { grupo: string; valor: number }[] | null;
  observacoes: string[];
};

const ROW_CAP = 1000;

// Data no fuso de São Paulo (UTC-3) → chave do bucket temporal.
function spParts(iso: string): { dia: string; mes: string; semana: string } {
  const shifted = new Date(new Date(iso).getTime() - 3 * 60 * 60 * 1000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");

  return {
    dia: `${y}-${m}-${d}`,
    mes: `${y}-${m}`,
    semana: isoWeekLabel(shifted),
  };
}

// Semana ISO (segunda a domingo) no formato "semana NN/AAAA".
function isoWeekLabel(date: Date): string {
  const target = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dayNr = (target.getUTCDay() + 6) % 7;

  target.setUTCDate(target.getUTCDate() - dayNr + 3);

  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;

  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);

  const week =
    1 +
    Math.round(
      (target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000),
    );

  return `semana ${String(week).padStart(2, "0")}/${target.getUTCFullYear()}`;
}

async function resolveFilterIds(
  client: SupabaseClient,
  table: string,
  column: string,
  term: string,
): Promise<string[]> {
  const { data } = await client
    .from(table)
    .select("id")
    .ilike(column, `%${term}%`)
    .limit(50);

  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

export async function runIrisAnalyticsQuery(
  client: SupabaseClient,
  input: IrisBuilderInput,
): Promise<IrisQueryResult> {
  const observacoes: string[] = [];

  // Monta o select/where. Usa o mesmo builder de query pra count-only e pra carregar linhas.
  const buildQuery = (head: boolean) => {
    let query = head
      ? client
          .from("caredesk_tickets")
          .select("id", { count: "exact", head: true })
      : client
          .from("caredesk_tickets")
          .select("id, status, queue_id, assigned_to_user_id, created_at, closed_at")
          .limit(ROW_CAP + 1);

    // Recorte da métrica.
    if (input.metrica === "tickets_abertos") {
      query = query.not("status", "in", `(${TERMINAL_STATUSES.join(",")})`);
    } else if (input.metrica === "aguardando_operador") {
      query = query.eq("status", "waiting_operator");
    } else if (input.metrica === "aguardando_cliente") {
      query = query.eq("status", "waiting_customer");
    } else if (input.metrica === "tickets_criados" && input.range) {
      query = query
        .gte("created_at", input.range.from.toISOString())
        .lt("created_at", input.range.to.toISOString());
    } else if (input.metrica === "tickets_finalizados" && input.range) {
      query = query
        .gte("closed_at", input.range.from.toISOString())
        .lt("closed_at", input.range.to.toISOString());
    }

    return query;
  };

  // Filtros de dimensão (resolvidos a id antes, exceto status que é valor direto).
  const filterQueue = input.filtros.fila
    ? await resolveFilterIds(client, "caredesk_queues", "name", input.filtros.fila)
    : null;
  const filterUser = input.filtros.colaborador
    ? await resolveFilterIds(
        client,
        "hub_users",
        "display_name",
        input.filtros.colaborador,
      )
    : null;

  // Builder do PostgREST é genérico demais pra tipar aqui sem fricção — o retorno
  // é sempre re-encadeado nos mesmos métodos (.in/.eq/.gte), então unknown+cast local.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const applyFilters = (query: any) => {
    let q = query;

    if (filterQueue) {
      q = q.in("queue_id", filterQueue.length ? filterQueue : ["__none__"]);
    }

    if (filterUser) {
      q = q.in(
        "assigned_to_user_id",
        filterUser.length ? filterUser : ["__none__"],
      );
    }

    if (input.filtros.status) {
      q = q.eq("status", input.filtros.status);
    }

    return q;
  };

  // Sem agrupamento → count exato (barato). Estado ou evento, mesma coisa.
  if (!input.agruparPor) {
    const { count, error } = await applyFilters(buildQuery(true));

    if (error) {
      throw new Error(error.message);
    }

    return { grupos: null, observacoes, total: count ?? 0 };
  }

  // Com agrupamento → carrega as linhas do recorte e conta em JS.
  const { data, error } = await applyFilters(buildQuery(false));

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TicketRow[];

  if (rows.length > ROW_CAP) {
    observacoes.push(
      `Muitos atendimentos no recorte (mais de ${ROW_CAP}); o agrupamento pode estar truncado — estreite o período.`,
    );
    rows.length = ROW_CAP;
  }

  // Mapas de nome pras dimensões fila/colaborador.
  const needsQueue = input.agruparPor === "fila";
  const needsUser = input.agruparPor === "colaborador";

  const [queueName, userName] = await Promise.all([
    needsQueue ? loadQueueNameMap(client) : null,
    needsUser ? loadUserNameMap(client) : null,
  ]);

  const dateField =
    input.metrica === "tickets_finalizados" ? "closed_at" : "created_at";

  const counts = new Map<string, number>();

  for (const row of rows) {
    let key: string;

    switch (input.agruparPor) {
      case "fila":
        key = row.queue_id
          ? queueName?.get(row.queue_id) ?? "Sem fila"
          : "Sem fila";
        break;
      case "colaborador":
        key = row.assigned_to_user_id
          ? userName?.get(row.assigned_to_user_id) ?? "Operador"
          : "Sem operador";
        break;
      case "status":
        key = row.status
          ? STATUS_LABEL[row.status] ?? row.status
          : "Sem status";
        break;
      default: {
        const iso = row[dateField as "created_at" | "closed_at"];

        key = iso ? spParts(iso)[input.agruparPor] : "sem data";
      }
    }

    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const isTimeBucket =
    input.agruparPor === "dia" ||
    input.agruparPor === "semana" ||
    input.agruparPor === "mes";

  const grupos = Array.from(counts.entries())
    .map(([grupo, valor]) => ({ grupo, valor }))
    .sort((first, second) =>
      isTimeBucket
        ? first.grupo.localeCompare(second.grupo)
        : second.valor - first.valor,
    );

  return {
    grupos,
    observacoes,
    total: rows.length,
  };
}

async function loadQueueNameMap(
  client: SupabaseClient,
): Promise<Map<string, string>> {
  const { data } = await client.from("caredesk_queues").select("id, name");

  return new Map(
    ((data ?? []) as { id: string; name: string | null }[]).map((row) => [
      row.id,
      row.name?.trim() || "Sem fila",
    ]),
  );
}

async function loadUserNameMap(
  client: SupabaseClient,
): Promise<Map<string, string>> {
  const { data } = await client
    .from("hub_users")
    .select("id, display_name, email");

  return new Map(
    ((data ?? []) as {
      id: string;
      display_name: string | null;
      email: string | null;
    }[]).map((row) => [row.id, row.display_name || row.email || "Operador"]),
  );
}
