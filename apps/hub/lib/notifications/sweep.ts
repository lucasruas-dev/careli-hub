import type { SupabaseClient } from "@supabase/supabase-js";

import { loadHadesOverview } from "@/lib/guardian/overview";
import { publishHubNotification } from "@/lib/notifications/publish";
import { createPushServiceClient } from "@/lib/notifications/push";

// Varredura ÚNICA de notificações baseadas em ESTADO (não em evento ao vivo): roda por
// cron em baixa frequência e dispara avisos quando uma condição vence. Cada fonte tem
// dedup PRÓPRIO para NUNCA re-notificar (consciência de custo: o cron pode rodar várias
// vezes sem gerar spam nem fatura). Tudo best-effort: uma fonte que falha não derruba as
// outras nem o cron.

const SWEEP_BATCH = 200;
// Janela de antecedência para "reunião começando": avisa quem participa entre agora e
// +20min. Casa com o cron de 15min (pega toda reunião uma vez, sem duplicar via dedup).
const MEETING_LOOKAHEAD_MS = 20 * 60 * 1000;

export type NotificationSweepResult = {
  agendaReminders: number;
  hadesCritical: number;
  meetingReminders: number;
};

export async function runNotificationSweep(): Promise<NotificationSweepResult> {
  const client = createPushServiceClient();

  if (!client) {
    return { agendaReminders: 0, hadesCritical: 0, meetingReminders: 0 };
  }

  const [agendaReminders, meetingReminders, hadesCritical] = await Promise.all([
    sweepAgendaReminders(client).catch(() => 0),
    sweepMeetingReminders(client).catch(() => 0),
    sweepHadesCriticalDigest(client).catch(() => 0),
  ]);

  return { agendaReminders, hadesCritical, meetingReminders };
}

// --- Meu dia: tarefas/retornos com lembrete vencido. Dedup NATIVO via reminded_at. ---

type AgendaReminderRow = {
  assigned_to_user_id: string | null;
  id: string;
  kind: string;
  title: string;
};

async function sweepAgendaReminders(client: SupabaseClient): Promise<number> {
  const nowIso = new Date().toISOString();
  const { data, error } = await client
    .from("hub_agenda_items")
    .select("id,kind,title,assigned_to_user_id")
    .lte("remind_at", nowIso)
    .is("reminded_at", null)
    .not("assigned_to_user_id", "is", null)
    .in("status", ["aberto", "em_andamento"])
    .limit(SWEEP_BATCH);

  if (error || !data) {
    return 0;
  }

  const rows = data as AgendaReminderRow[];
  let sent = 0;

  for (const row of rows) {
    if (!row.assigned_to_user_id) {
      continue;
    }

    const isRetorno = row.kind === "retorno";

    await publishHubNotification(
      {
        actionHref: "/",
        context: { entityId: row.id, entityType: "agenda-item" },
        kind: isRetorno ? "agenda" : "tarefa",
        moduleId: "agenda",
        push: { url: "/" },
        recipientUserIds: [row.assigned_to_user_id],
        severity: "info",
        title: isRetorno
          ? `Hora do retorno: ${row.title}`
          : `Lembrete de tarefa: ${row.title}`,
      },
      client,
    );

    // Dedup: marca como lembrada (nunca mais entra na varredura).
    await client
      .from("hub_agenda_items")
      .update({ reminded_at: new Date().toISOString() })
      .eq("id", row.id);

    sent += 1;
  }

  return sent;
}

// --- Chronos: reuniões começando em ~20min. Dedup via hub_notifications (sem migration):
// busca os avisos de reunião ja emitidos na ultima hora e pula os repetidos. ---

type MeetingReminderRow = {
  id: string;
  starts_at: string | null;
  title: string | null;
};

type MeetingParticipantRow = {
  meeting_id: string;
  user_id: string | null;
};

async function sweepMeetingReminders(client: SupabaseClient): Promise<number> {
  const now = Date.now();
  const windowEndIso = new Date(now + MEETING_LOOKAHEAD_MS).toISOString();
  const nowIso = new Date(now).toISOString();

  const { data: meetingsData, error: meetingsError } = await client
    .from("chronos_meetings")
    .select("id,title,starts_at")
    .gte("starts_at", nowIso)
    .lte("starts_at", windowEndIso)
    .limit(SWEEP_BATCH);

  if (meetingsError || !meetingsData || meetingsData.length === 0) {
    return 0;
  }

  const meetings = meetingsData as MeetingReminderRow[];
  const meetingIds = meetings.map((meeting) => meeting.id);

  const { data: participantsData } = await client
    .from("chronos_participants")
    .select("meeting_id,user_id")
    .in("meeting_id", meetingIds)
    .not("user_id", "is", null);

  const participants = (participantsData ?? []) as MeetingParticipantRow[];
  const recipientsByMeeting = new Map<string, Set<string>>();

  for (const participant of participants) {
    if (!participant.user_id) {
      continue;
    }

    const set = recipientsByMeeting.get(participant.meeting_id) ?? new Set();
    set.add(participant.user_id);
    recipientsByMeeting.set(participant.meeting_id, set);
  }

  // Dedup: ja avisou desta reuniao na ultima hora? (context.meetingReminderId)
  const sinceIso = new Date(now - 60 * 60 * 1000).toISOString();
  const { data: alreadyData } = await client
    .from("hub_notifications")
    .select("context")
    .eq("module_id", "chronos")
    .gte("created_at", sinceIso)
    .limit(1000);

  const alreadyNotified = new Set(
    ((alreadyData ?? []) as { context: Record<string, unknown> | null }[])
      .map((row) => row.context?.meetingReminderId)
      .filter((value): value is string => typeof value === "string"),
  );

  let sent = 0;

  for (const meeting of meetings) {
    if (alreadyNotified.has(meeting.id)) {
      continue;
    }

    const recipients = [...(recipientsByMeeting.get(meeting.id) ?? new Set())];

    if (recipients.length === 0) {
      continue;
    }

    await publishHubNotification(
      {
        actionHref: "/chronos",
        context: { entityId: meeting.id, meetingReminderId: meeting.id },
        kind: "agenda",
        moduleId: "chronos",
        push: { url: "/chronos" },
        recipientUserIds: recipients,
        severity: "info",
        title: `Reunião em breve: ${meeting.title ?? "Reunião"}`,
      },
      client,
    );

    sent += recipients.length;
  }

  return sent;
}

// --- Hades: RESUMO diário de contratos críticos (não por contrato = sem spam). Roda só
// uma vez por dia (janela 12:00-12:14 BRT) e avisa os admins. Dedup pela janela + dedup
// de hub_notifications no mesmo dia. ---

async function sweepHadesCriticalDigest(client: SupabaseClient): Promise<number> {
  if (!isHadesDigestWindow()) {
    return 0;
  }

  // Já enviou o resumo hoje? (evita re-disparo se o cron rodar 2x na janela)
  const startOfDayIso = startOfDayBrtIso();
  const { count: alreadyCount } = await client
    .from("hub_notifications")
    .select("id", { count: "exact", head: true })
    .eq("module_id", "hades")
    .eq("kind", "alerta")
    .gte("created_at", startOfDayIso);

  if ((alreadyCount ?? 0) > 0) {
    return 0;
  }

  const criticalCount = await countHadesCriticalContracts();

  if (criticalCount <= 0) {
    return 0;
  }

  const admins = await listAdminUserIds(client);

  if (admins.length === 0) {
    return 0;
  }

  await publishHubNotification(
    {
      actionHref: "/hades",
      body: "Resumo diário da carteira — abrir cobrança.",
      context: { entityType: "hades-critical-digest" },
      kind: "alerta",
      moduleId: "hades",
      push: { url: "/hades" },
      recipientUserIds: admins,
      severity: "warning",
      title: `${criticalCount} contratos críticos na carteira`,
    },
    client,
  );

  return admins.length;
}

function isHadesDigestWindow(): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).formatToParts(new Date());
  const hour = Number.parseInt(
    parts.find((part) => part.type === "hour")?.value ?? "0",
    10,
  );
  const minute = Number.parseInt(
    parts.find((part) => part.type === "minute")?.value ?? "0",
    10,
  );

  return hour === 12 && minute < 15;
}

function startOfDayBrtIso(): string {
  const dayFormatter = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  });

  return new Date(`${dayFormatter.format(new Date())}T00:00:00-03:00`).toISOString();
}

async function countHadesCriticalContracts(): Promise<number> {
  // Mesma fonte do dashboard Hades (overview do C2X, read-only). Roda 1x/dia na janela
  // do digest; se o pool do C2X estiver indisponível, volta 0 (best-effort, sem aviso).
  const result = await loadHadesOverview();

  return result.ok ? result.data.summary.criticalContracts : 0;
}

async function listAdminUserIds(client: SupabaseClient): Promise<string[]> {
  const { data } = await client
    .from("hub_users")
    .select("id")
    .eq("role", "admin")
    .limit(50);

  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}
