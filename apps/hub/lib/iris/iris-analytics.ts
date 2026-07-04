import type { SupabaseClient } from "@supabase/supabase-js";

import { type C2xPeriodo, resolvePeriodoRange } from "@/lib/guardian/c2x-analytics";

// Analytics da IRIS (caredesk) para o modo ASSISTENTE da CACÁ: chamadas/atendimentos abertos
// por fila, por colaborador, por status, e quem está esperando resposta há mais tempo. Usa o
// Supabase client do contexto (já disponível). Ver [[project-caca-admin-assistant-mode]].

type TicketRow = {
  id: string;
  status: string;
  queue_id: string | null;
  assigned_to_user_id: string | null;
  contact_id: string | null;
  updated_at: string | null;
  subject: string | null;
};

export type IrisEspera = {
  fila: string;
  operador: string;
  cliente: string;
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
    .select("id, status, queue_id, assigned_to_user_id, contact_id, updated_at, subject")
    .neq("status", "closed")
    .limit(500);

  if (error) {
    console.error("[iris] loadIrisAtendimentosResumo failed", error.message);

    return null;
  }

  const rows = (tickets ?? []) as TicketRow[];

  const contactIds = Array.from(
    new Set(rows.map((row) => row.contact_id).filter(Boolean)),
  ) as string[];

  const [{ data: queues }, { data: users }, { data: contacts }] =
    await Promise.all([
      client.from("caredesk_queues").select("id, name"),
      client.from("hub_users").select("id, display_name, email"),
      contactIds.length
        ? client
            .from("caredesk_contacts")
            .select("id, display_name")
            .in("id", contactIds)
        : Promise.resolve({ data: [] as { id: string; display_name: string | null }[] }),
    ]);

  const contactName = new Map(
    (contacts ?? []).map((c: { id: string; display_name: string | null }) => [
      c.id,
      c.display_name?.trim() || "Sem nome",
    ]),
  );

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
        cliente: row.contact_id
          ? contactName.get(row.contact_id) ?? "Sem nome"
          : "Sem nome",
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

export type IrisConversa = {
  cliente: string;
  perfil: string;
  statusTicket: string;
  mensagens: { de: string; texto: string }[];
};

// Lê a CONVERSA de um atendimento (pelo nome do cliente): as últimas mensagens + o perfil
// básico do contato (PF/PJ, cidade). Pro perfil completo (comprador/imobiliária/prospect) a
// CACÁ cruza com consultar_cliente_c2x. Áudio do cliente aparece como marcador (a transcrição
// não fica no corpo). Ver [[project-caca-admin-assistant-mode]].
export async function loadIrisConversa(
  client: SupabaseClient,
  termo: string,
): Promise<IrisConversa | null> {
  const clean = String(termo ?? "").trim();

  if (!clean) {
    return null;
  }

  const { data: contacts } = await client
    .from("caredesk_contacts")
    .select("id, display_name, person_type, document, city, state")
    .ilike("display_name", `%${clean}%`)
    .limit(1);

  const contact = contacts?.[0] as
    | {
        id: string;
        display_name: string | null;
        person_type: string | null;
        document: string | null;
        city: string | null;
        state: string | null;
      }
    | undefined;

  if (!contact) {
    return null;
  }

  const { data: tickets } = await client
    .from("caredesk_tickets")
    .select("id, status, updated_at")
    .eq("contact_id", contact.id)
    .order("updated_at", { ascending: false })
    .limit(1);

  const ticket = tickets?.[0] as
    | { id: string; status: string; updated_at: string | null }
    | undefined;

  if (!ticket) {
    return null;
  }

  const { data: msgs } = await client
    .from("caredesk_messages")
    .select("direction, sender_type, body")
    .eq("ticket_id", ticket.id)
    .order("created_at", { ascending: true })
    .limit(30);

  const mensagens = ((msgs ?? []) as {
    direction: string | null;
    sender_type: string | null;
    body: string | null;
  }[]).map((m) => ({
    de: m.direction === "outbound" ? "CACÁ/operador" : "Cliente",
    texto: m.body?.trim() || "(sem texto)",
  }));

  const perfilPartes = [
    contact.person_type === "company" ? "Pessoa jurídica" : "Pessoa física",
    [contact.city, contact.state].filter(Boolean).join("/") || null,
  ].filter(Boolean);

  return {
    cliente: contact.display_name?.trim() || "Sem nome",
    mensagens,
    perfil: perfilPartes.join(" · "),
    statusTicket: ticket.status,
  };
}

export type IrisMovimentacaoPeriodo = {
  periodoLabel: string;
  finalizados: number; // tickets encerrados no período (closed_at)
  criados: number; // tickets abertos/criados no período
};

// Movimentação da Iris num período: quantos atendimentos foram FINALIZADOS (closed_at) e
// quantos foram CRIADOS no intervalo. Responde "quantos tickets fechamos ontem/essa semana".
export async function loadIrisMovimentacaoPeriodo(
  client: SupabaseClient,
  periodo: C2xPeriodo,
): Promise<IrisMovimentacaoPeriodo | null> {
  const { from, to, label } = resolvePeriodoRange(periodo);
  const fromIso = from.toISOString();
  const toIso = to.toISOString();

  try {
    const [finalizados, criados] = await Promise.all([
      client
        .from("caredesk_tickets")
        .select("id", { count: "exact", head: true })
        .gte("closed_at", fromIso)
        .lt("closed_at", toIso),
      client
        .from("caredesk_tickets")
        .select("id", { count: "exact", head: true })
        .gte("created_at", fromIso)
        .lt("created_at", toIso),
    ]);

    return {
      criados: criados.count ?? 0,
      finalizados: finalizados.count ?? 0,
      periodoLabel: label,
    };
  } catch (error) {
    console.error(
      "[iris] loadIrisMovimentacaoPeriodo failed",
      error instanceof Error ? error.message : error,
    );

    return null;
  }
}
