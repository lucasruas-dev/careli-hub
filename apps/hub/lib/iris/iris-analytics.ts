import type { SupabaseClient } from "@supabase/supabase-js";

// Analytics da IRIS (caredesk) para o modo ASSISTENTE da CACÁ: chamadas/atendimentos abertos
// por fila, por colaborador, por status, e quem está esperando resposta há mais tempo. Usa o
// Supabase client do contexto (já disponível). Ver [[project-caca-admin-assistant-mode]].

type TicketRow = {
  id: string;
  status: string;
  queue_id: string | null;
  assigned_to_user_id: string | null;
  updated_at: string | null;
  subject: string | null;
};

export type IrisEspera = {
  fila: string;
  operador: string;
  assunto: string;
  minutosEspera: number;
};

export type IrisAtendimentosResumo = {
  abertosTotal: number;
  aguardandoOperador: number; // nós precisamos responder
  aguardandoCliente: number; // esperando o cliente
  porFila: { fila: string; abertos: number }[];
  porColaborador: { colaborador: string; abertos: number }[];
  esperandoMais: IrisEspera[]; // waiting_operator ordenado por tempo de espera
};

export async function loadIrisAtendimentosResumo(
  client: SupabaseClient,
): Promise<IrisAtendimentosResumo | null> {
  const { data: tickets, error } = await client
    .from("caredesk_tickets")
    .select("id, status, queue_id, assigned_to_user_id, updated_at, subject")
    .neq("status", "closed")
    .limit(500);

  if (error) {
    console.error("[iris] loadIrisAtendimentosResumo failed", error.message);

    return null;
  }

  const rows = (tickets ?? []) as TicketRow[];

  const [{ data: queues }, { data: users }] = await Promise.all([
    client.from("caredesk_queues").select("id, name"),
    client.from("hub_users").select("id, display_name, email"),
  ]);

  const queueName = new Map(
    (queues ?? []).map((q: { id: string; name: string | null }) => [
      q.id,
      q.name ?? "Sem fila",
    ]),
  );
  const userName = new Map(
    (users ?? []).map(
      (u: { id: string; display_name: string | null; email: string | null }) => [
        u.id,
        u.display_name ?? u.email ?? "Operador",
      ],
    ),
  );

  const now = Date.now();
  const porFila = new Map<string, number>();
  const porColaborador = new Map<string, number>();
  const esperandoMais: IrisEspera[] = [];
  let aguardandoOperador = 0;
  let aguardandoCliente = 0;

  for (const row of rows) {
    const fila = row.queue_id ? queueName.get(row.queue_id) ?? "Sem fila" : "Sem fila";
    porFila.set(fila, (porFila.get(fila) ?? 0) + 1);

    const operador = row.assigned_to_user_id
      ? userName.get(row.assigned_to_user_id) ?? "Operador"
      : "Sem operador";
    porColaborador.set(operador, (porColaborador.get(operador) ?? 0) + 1);

    if (row.status === "waiting_operator") {
      aguardandoOperador += 1;
      const updatedAt = row.updated_at ? new Date(row.updated_at).getTime() : now;
      esperandoMais.push({
        assunto: row.subject?.trim() || "Sem assunto",
        fila,
        minutosEspera: Math.max(0, Math.round((now - updatedAt) / 60000)),
        operador,
      });
    } else if (row.status === "waiting_customer") {
      aguardandoCliente += 1;
    }
  }

  esperandoMais.sort((first, second) => second.minutosEspera - first.minutosEspera);

  const toSorted = (map: Map<string, number>, key: "fila" | "colaborador") =>
    Array.from(map.entries())
      .map(([label, abertos]) =>
        key === "fila"
          ? { abertos, fila: label }
          : { abertos, colaborador: label },
      )
      .sort((a, b) => b.abertos - a.abertos);

  return {
    abertosTotal: rows.length,
    aguardandoCliente,
    aguardandoOperador,
    esperandoMais: esperandoMais.slice(0, 15),
    porColaborador: toSorted(porColaborador, "colaborador") as {
      colaborador: string;
      abertos: number;
    }[],
    porFila: toSorted(porFila, "fila") as { fila: string; abertos: number }[],
  };
}
