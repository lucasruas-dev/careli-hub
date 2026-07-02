"use client";

import { Badge, Button } from "@repo/uix";
import {
  CalendarClock,
  Check,
  ChevronRight,
  Clock,
  ExternalLink,
  Loader2,
  Mail,
  MessageCircle,
  Phone,
  Plus,
  RefreshCw,
  Users,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";

import {
  createAgendaItem,
  deleteAgendaItem,
  loadMeuDia,
  updateAgendaItem,
  type AgendaItem,
  type AgendaItemChannel,
  type AgendaItemKind,
  type AgendaItemPriority,
  type AgendaMeeting,
  type AsanaBridgeTask,
} from "@/modules/agenda/data";

const ACCENT = "#2563eb";
const DANGER = "var(--uix-color-danger)";
const WARNING = "var(--uix-color-warning)";
const SUCCESS = "var(--uix-color-success)";

type DueBucket = "atrasado" | "hoje" | "embreve" | "semprazo";

type TaskRow = {
  clientName: string | null;
  dueAt: string | null;
  id: string;
  item: AgendaItem | null;
  priority: AgendaItemPriority | null;
  source: "asana" | "native";
  title: string;
  url: string | null;
};

type AgendaEntry =
  | { kind: "meeting"; meeting: AgendaMeeting; sortTime: number }
  | { kind: "retorno"; item: AgendaItem; sortTime: number };

export function MeuDiaPage() {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [meetings, setMeetings] = useState<AgendaMeeting[]>([]);
  const [asana, setAsana] = useState<AsanaBridgeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  // `now` recalcula DE PROPOSITO quando os dados recarregam (mantem "hoje"
  // fresco em tela aberta) — as deps extras sao intencionais.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [items, meetings]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = await loadMeuDia();
      setItems(snapshot.items);
      setMeetings(snapshot.meetings);
      setAsana(snapshot.asana);
    } catch {
      setError("Nao foi possivel carregar a sua agenda agora.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startOfToday = useMemo(() => startOfDay(now), [now]);
  const endOfToday = useMemo(() => endOfDay(now), [now]);

  // Agenda (hoje): reunioes de hoje + retornos de hoje/atrasados, por horario.
  const agendaEntries = useMemo<AgendaEntry[]>(() => {
    const entries: AgendaEntry[] = [];

    for (const meeting of meetings) {
      const time = meeting.startsAt ? Date.parse(meeting.startsAt) : NaN;
      if (Number.isNaN(time) || time < startOfToday.getTime() || time > endOfToday.getTime()) {
        continue;
      }
      entries.push({ kind: "meeting", meeting, sortTime: time });
    }

    for (const item of items) {
      if (item.kind !== "retorno" || !item.dueAt) {
        continue;
      }
      const time = Date.parse(item.dueAt);
      if (Number.isNaN(time) || time > endOfToday.getTime()) {
        continue;
      }
      entries.push({ kind: "retorno", item, sortTime: time });
    }

    return entries.sort((a, b) => a.sortTime - b.sortTime);
  }, [items, meetings, startOfToday, endOfToday]);

  // Tarefas: nativas (kind tarefa) + Asana (read-only), agrupadas por prazo.
  const taskRows = useMemo<TaskRow[]>(() => {
    const native: TaskRow[] = items
      .filter((item) => item.kind === "tarefa")
      .map((item) => ({
        clientName: item.clientName,
        dueAt: item.dueAt,
        id: item.id,
        item,
        priority: item.priority,
        source: "native",
        title: item.title,
        url: null,
      }));
    const asanaRows: TaskRow[] = asana.map((task) => ({
      clientName: task.workspaceName,
      dueAt: task.dueAt,
      id: `asana:${task.id}`,
      item: null,
      priority: null,
      source: "asana",
      title: task.title,
      url: task.url,
    }));
    return [...native, ...asanaRows];
  }, [items, asana]);

  const groupedTasks = useMemo(() => {
    const groups: Record<DueBucket, TaskRow[]> = {
      atrasado: [],
      hoje: [],
      embreve: [],
      semprazo: [],
    };
    for (const row of taskRows) {
      groups[dueBucket(row.dueAt, startOfToday, endOfToday)].push(row);
    }
    for (const key of Object.keys(groups) as DueBucket[]) {
      groups[key].sort((a, b) => dueSortValue(a.dueAt) - dueSortValue(b.dueAt));
    }
    return groups;
  }, [taskRows, startOfToday, endOfToday]);

  const weekDays = useMemo(() => buildWeek(now), [now]);
  const countsByDay = useMemo(() => {
    const counts = new Map<string, number>();
    const bump = (iso: string | null) => {
      if (!iso) return;
      const key = dayKey(new Date(iso));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    };
    for (const item of items) {
      if (item.kind === "retorno") bump(item.dueAt);
    }
    for (const meeting of meetings) bump(meeting.startsAt);
    return counts;
  }, [items, meetings]);

  const handleComplete = useCallback(async (item: AgendaItem) => {
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    const updated = await updateAgendaItem(item.id, { status: "concluido" });
    if (!updated) {
      void refresh();
    }
  }, [refresh]);

  const handleDelete = useCallback(async (item: AgendaItem) => {
    setItems((current) => current.filter((entry) => entry.id !== item.id));
    const ok = await deleteAgendaItem(item.id);
    if (!ok) {
      void refresh();
    }
  }, [refresh]);

  const handleCreated = useCallback((item: AgendaItem) => {
    setItems((current) => [item, ...current]);
    setShowForm(false);
  }, []);

  const nowTime = now.getTime();
  const agoraIndex = agendaEntries.findIndex((entry) => entry.sortTime >= nowTime);
  const agoraPosition = agoraIndex === -1 ? agendaEntries.length : agoraIndex;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <header style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 600, color: "var(--uix-text-primary)" }}>Meu dia</h1>
          <p style={{ margin: "4px 0 0", fontSize: 14, color: "var(--uix-text-secondary)" }}>
            {capitalize(now.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }))}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => void refresh()} size="sm" startIcon={<RefreshCw size={15} />} variant="ghost">
            Atualizar
          </Button>
          <Button onClick={() => setShowForm((value) => !value)} size="sm" startIcon={<Plus size={15} />} variant="primary">
            Adicionar
          </Button>
        </div>
      </header>

      {showForm ? <AddForm onCreated={handleCreated} /> : null}

      <WeekStrip days={weekDays} counts={countsByDay} todayKey={dayKey(now)} />

      {error ? (
        <div style={{ ...cardStyle, borderColor: DANGER, color: DANGER }}>{error}</div>
      ) : null}

      {loading ? (
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--uix-text-muted)", fontSize: 14, padding: "2rem 0", justifyContent: "center" }}>
          <Loader2 className="animate-spin" size={16} /> Carregando a sua agenda…
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 42%) minmax(0, 1fr)", gap: 20, alignItems: "start" }}>
          <section>
            <SectionTitle icon={<CalendarClock size={15} />} note={`${agendaEntries.length} hoje`} title="Agenda" />
            <div style={cardStyle}>
              {agendaEntries.length === 0 ? (
                <EmptyHint text="Sem reunioes nem retornos para hoje." />
              ) : (
                agendaEntries.map((entry, index) => (
                  <div key={entryKey(entry)}>
                    {index === agoraPosition ? <NowLine now={now} /> : null}
                    {entry.kind === "meeting" ? (
                      <MeetingRow meeting={entry.meeting} />
                    ) : (
                      <RetornoRow item={entry.item} now={now} onComplete={handleComplete} />
                    )}
                  </div>
                ))
              )}
              {agoraPosition === agendaEntries.length && agendaEntries.length > 0 ? <NowLine now={now} /> : null}
            </div>
          </section>

          <section>
            <SectionTitle icon={<Check size={15} />} note={`${taskRows.length}`} title="Tarefas" />
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <TaskGroup color={DANGER} label="Atrasado" onComplete={handleComplete} onDelete={handleDelete} rows={groupedTasks.atrasado} />
              <TaskGroup color={WARNING} label="Hoje" onComplete={handleComplete} onDelete={handleDelete} rows={groupedTasks.hoje} />
              <TaskGroup label="Em breve" onComplete={handleComplete} onDelete={handleDelete} rows={groupedTasks.embreve} />
              <TaskGroup label="Sem prazo" onComplete={handleComplete} onDelete={handleDelete} rows={groupedTasks.semprazo} />
              {taskRows.length === 0 ? (
                <div style={cardStyle}>
                  <EmptyHint text="Nenhuma tarefa aberta. Use Adicionar para criar." />
                </div>
              ) : null}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function WeekStrip({ counts, days, todayKey }: { counts: Map<string, number>; days: Date[]; todayKey: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 6 }}>
      {days.map((day) => {
        const key = dayKey(day);
        const isToday = key === todayKey;
        const count = counts.get(key) ?? 0;
        return (
          <div
            key={key}
            style={{
              textAlign: "center",
              padding: "8px 0 9px",
              borderRadius: 12,
              background: isToday ? "color-mix(in srgb, #2563eb 12%, transparent)" : "transparent",
            }}
          >
            <div style={{ fontSize: 11, color: isToday ? ACCENT : "var(--uix-text-muted)" }}>
              {day.toLocaleDateString("pt-BR", { weekday: "short" }).slice(0, 3)}
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, marginTop: 2, color: isToday ? ACCENT : "var(--uix-text-primary)" }}>
              {day.getDate()}
            </div>
            <div style={{ fontSize: 11, marginTop: 3, color: isToday ? ACCENT : "var(--uix-text-secondary)" }}>
              {count > 0 ? count : "·"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function NowLine({ now }: { now: Date }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 2px" }}>
      <span style={{ fontSize: 11, color: ACCENT, fontWeight: 600, minWidth: 38 }}>{formatTime(now)}</span>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: ACCENT, flex: "none" }} />
      <span style={{ height: 2, background: ACCENT, flex: 1, borderRadius: 2 }} />
      <span style={{ fontSize: 11, color: ACCENT }}>agora</span>
    </div>
  );
}

function MeetingRow({ meeting }: { meeting: AgendaMeeting }) {
  return (
    <div style={agendaRowStyle}>
      <div style={{ minWidth: 38, textAlign: "right", fontSize: 12, color: "var(--uix-text-muted)", paddingTop: 2 }}>
        {meeting.startsAt ? formatTime(new Date(meeting.startsAt)) : "—"}
      </div>
      <div style={{ flex: 1, minWidth: 0, borderLeft: `2px solid ${SUCCESS}`, paddingLeft: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--uix-text-primary)" }}>{meeting.title}</span>
          <Badge variant="success">Reuniao</Badge>
        </div>
        <div style={{ fontSize: 12, color: "var(--uix-text-secondary)", marginTop: 1 }}>
          {meeting.hostName ?? "Chronos"}
        </div>
      </div>
    </div>
  );
}

function RetornoRow({ item, now, onComplete }: { item: AgendaItem; now: Date; onComplete: (item: AgendaItem) => void }) {
  const overdue = item.dueAt ? Date.parse(item.dueAt) < now.getTime() : false;
  const channel = channelMeta(item.channel);
  return (
    <div style={agendaRowStyle}>
      <div style={{ minWidth: 38, textAlign: "right", fontSize: 12, fontWeight: overdue ? 600 : 400, color: overdue ? DANGER : "var(--uix-text-muted)", paddingTop: 2 }}>
        {item.dueAt ? formatTime(new Date(item.dueAt)) : "—"}
      </div>
      <div style={{ flex: 1, minWidth: 0, borderLeft: `2px solid ${overdue ? DANGER : ACCENT}`, paddingLeft: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--uix-text-primary)" }}>{item.title}</span>
          {overdue ? <Badge variant="danger">Atrasado</Badge> : <Badge variant="info">Retorno</Badge>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--uix-text-secondary)", marginTop: 2 }}>
          <channel.Icon size={12} />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {[item.clientName, item.description].filter(Boolean).join(" · ") || channel.label}
          </span>
          {item.attendanceProtocol ? <ProtocolChip protocol={item.attendanceProtocol} /> : null}
        </div>
      </div>
      <button aria-label="Concluir retorno" onClick={() => onComplete(item)} style={checkButtonStyle} title="Concluir">
        <Check size={14} />
      </button>
    </div>
  );
}

function TaskGroup({
  color,
  label,
  onComplete,
  onDelete,
  rows,
}: {
  color?: string;
  label: string;
  onComplete: (item: AgendaItem) => void;
  onDelete: (item: AgendaItem) => void;
  rows: TaskRow[];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "0 4px 6px" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: color ?? "var(--uix-text-secondary)" }}>{label}</span>
        <span style={{ fontSize: 12, color: "var(--uix-text-muted)" }}>{rows.length}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {rows.map((row) => (
          <TaskCard key={row.id} onComplete={onComplete} onDelete={onDelete} row={row} />
        ))}
      </div>
    </div>
  );
}

function TaskCard({ onComplete, onDelete, row }: { onComplete: (item: AgendaItem) => void; onDelete: (item: AgendaItem) => void; row: TaskRow }) {
  const dot = priorityColor(row.priority);
  return (
    <div style={{ ...cardStyle, padding: "10px 12px", display: "flex", alignItems: "flex-start", gap: 10 }}>
      {row.source === "native" && row.item ? (
        <button aria-label="Concluir tarefa" onClick={() => onComplete(row.item as AgendaItem)} style={checkButtonStyle} title="Concluir">
          <Check size={13} />
        </button>
      ) : (
        <span style={{ width: 18, height: 18, flex: "none", marginTop: 1 }} />
      )}
      {dot ? <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flex: "none", marginTop: 6 }} /> : null}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 500, color: "var(--uix-text-primary)" }}>{row.title}</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          {row.clientName ? (
            <span style={{ fontSize: 12, color: "var(--uix-text-secondary)" }}>{row.clientName}</span>
          ) : null}
          {row.item?.attendanceProtocol ? <ProtocolChip protocol={row.item.attendanceProtocol} /> : null}
          {row.source === "asana" ? <Badge variant="info">Asana</Badge> : null}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "none" }}>
        {row.dueAt ? (
          <span style={{ fontSize: 11, color: "var(--uix-text-muted)", whiteSpace: "nowrap" }}>{formatDueChip(row.dueAt)}</span>
        ) : null}
        {row.source === "asana" && row.url ? (
          <a href={row.url} rel="noreferrer" target="_blank" style={{ color: "var(--uix-text-muted)", display: "inline-flex" }} title="Abrir no Asana">
            <ExternalLink size={14} />
          </a>
        ) : null}
        {row.source === "native" && row.item ? (
          <button aria-label="Remover tarefa" onClick={() => onDelete(row.item as AgendaItem)} style={{ background: "transparent", border: "none", color: "var(--uix-text-muted)", cursor: "pointer", display: "inline-flex", padding: 0 }} title="Remover">
            <X size={14} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

function AddForm({ onCreated }: { onCreated: (item: AgendaItem) => void }) {
  const [kind, setKind] = useState<AgendaItemKind>("tarefa");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [priority, setPriority] = useState<AgendaItemPriority | "">("");
  const [channel, setChannel] = useState<AgendaItemChannel | "">("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!title.trim() || saving) {
      return;
    }
    setSaving(true);
    const dueAt = due ? new Date(due).toISOString() : null;
    const created = await createAgendaItem({
      channel: kind === "retorno" && channel ? channel : null,
      dueAt,
      kind,
      module: "hub",
      priority: kind === "tarefa" && priority ? priority : null,
      remindAt: kind === "retorno" ? dueAt : null,
      title: title.trim(),
    });
    setSaving(false);
    if (created) {
      onCreated(created);
      setTitle("");
      setDue("");
      setPriority("");
      setChannel("");
    }
  };

  return (
    <div style={{ ...cardStyle, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <SegBtn active={kind === "tarefa"} onClick={() => setKind("tarefa")}>Tarefa</SegBtn>
        <SegBtn active={kind === "retorno"} onClick={() => setKind("retorno")}>Retorno</SegBtn>
      </div>
      <input
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => { if (event.key === "Enter") void submit(); }}
        placeholder={kind === "tarefa" ? "O que precisa ser feito?" : "Quem retornar e por quê?"}
        style={inputStyle}
        value={title}
      />
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <label style={fieldLabelStyle}>
          {kind === "tarefa" ? "Prazo" : "Quando retornar"}
          <input onChange={(event) => setDue(event.target.value)} style={inputStyle} type="datetime-local" value={due} />
        </label>
        {kind === "tarefa" ? (
          <label style={fieldLabelStyle}>
            Prioridade
            <select onChange={(event) => setPriority(event.target.value as AgendaItemPriority | "")} style={inputStyle} value={priority}>
              <option value="">Normal</option>
              <option value="urgente">Urgente</option>
              <option value="alta">Alta</option>
              <option value="media">Média</option>
              <option value="baixa">Baixa</option>
            </select>
          </label>
        ) : (
          <label style={fieldLabelStyle}>
            Canal
            <select onChange={(event) => setChannel(event.target.value as AgendaItemChannel | "")} style={inputStyle} value={channel}>
              <option value="">—</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="ligacao">Ligação</option>
              <option value="email">E-mail</option>
              <option value="presencial">Presencial</option>
              <option value="outro">Outro</option>
            </select>
          </label>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <Button isLoading={saving} onClick={() => void submit()} size="sm" variant="primary">
          Criar {kind === "tarefa" ? "tarefa" : "retorno"}
        </Button>
      </div>
    </div>
  );
}

function SegBtn({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        border: `1px solid ${active ? ACCENT : "var(--uix-border-subtle)"}`,
        background: active ? "color-mix(in srgb, #2563eb 10%, transparent)" : "transparent",
        color: active ? ACCENT : "var(--uix-text-secondary)",
        borderRadius: 8,
        fontSize: 13,
        padding: "5px 14px",
        cursor: "pointer",
      }}
      type="button"
    >
      {children}
    </button>
  );
}

function ProtocolChip({ protocol }: { protocol: string }) {
  return (
    <a
      href={`/hades/cobranca?from=atendimento&reopenAt=${encodeURIComponent(protocol)}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        fontSize: 11,
        color: ACCENT,
        textDecoration: "none",
        whiteSpace: "nowrap",
      }}
      title="Abrir atendimento"
    >
      {protocol} <ChevronRight size={11} />
    </a>
  );
}

function SectionTitle({ icon, note, title }: { icon: ReactNode; note?: string; title: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 10 }}>
      <span style={{ color: "var(--uix-text-secondary)", display: "inline-flex" }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--uix-text-primary)" }}>{title}</span>
      {note ? <span style={{ fontSize: 12, color: "var(--uix-text-muted)" }}>· {note}</span> : null}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <div style={{ fontSize: 13, color: "var(--uix-text-muted)", padding: "8px 2px" }}>{text}</div>;
}

const cardStyle: CSSProperties = {
  background: "var(--uix-surface-raised)",
  border: "1px solid var(--uix-border-subtle)",
  borderRadius: 12,
  padding: 12,
};

const agendaRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "8px 2px",
};

const checkButtonStyle: CSSProperties = {
  width: 18,
  height: 18,
  flex: "none",
  marginTop: 1,
  borderRadius: "50%",
  border: "1.5px solid var(--uix-border-strong)",
  background: "transparent",
  color: "var(--uix-text-muted)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
};

const inputStyle: CSSProperties = {
  height: 36,
  borderRadius: 8,
  border: "1px solid var(--uix-border-subtle)",
  background: "var(--uix-surface-base)",
  color: "var(--uix-text-primary)",
  padding: "0 10px",
  fontSize: 14,
  width: "100%",
};

const fieldLabelStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "var(--uix-text-secondary)",
  minWidth: 180,
  flex: 1,
};

function channelMeta(channel: AgendaItemChannel | null) {
  switch (channel) {
    case "whatsapp":
      return { Icon: MessageCircle, label: "WhatsApp" };
    case "ligacao":
      return { Icon: Phone, label: "Ligacao" };
    case "email":
      return { Icon: Mail, label: "E-mail" };
    case "presencial":
      return { Icon: Users, label: "Presencial" };
    default:
      return { Icon: Clock, label: "Retorno" };
  }
}

function priorityColor(priority: AgendaItemPriority | null): string | null {
  switch (priority) {
    case "urgente":
      return DANGER;
    case "alta":
      return WARNING;
    case "media":
      return ACCENT;
    case "baixa":
      return "var(--uix-text-muted)";
    default:
      return null;
  }
}

function dueBucket(dueAt: string | null, startOfToday: Date, endOfToday: Date): DueBucket {
  if (!dueAt) {
    return "semprazo";
  }
  const time = Date.parse(dueAt);
  if (Number.isNaN(time)) {
    return "semprazo";
  }
  if (time < startOfToday.getTime()) {
    return "atrasado";
  }
  if (time <= endOfToday.getTime()) {
    return "hoje";
  }
  return "embreve";
}

function dueSortValue(dueAt: string | null): number {
  if (!dueAt) {
    return Number.POSITIVE_INFINITY;
  }
  const time = Date.parse(dueAt);
  return Number.isNaN(time) ? Number.POSITIVE_INFINITY : time;
}

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function buildWeek(reference: Date): Date[] {
  const start = startOfDay(reference);
  const day = start.getDay();
  const mondayOffset = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - mondayOffset);
  return Array.from({ length: 7 }, (_unused, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDueChip(dueAt: string): string {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffDays = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (diffDays === 0) {
    return formatTime(date);
  }
  if (diffDays === -1) {
    return "ontem";
  }
  if (diffDays === 1) {
    return "amanha";
  }
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function entryKey(entry: AgendaEntry): string {
  return entry.kind === "meeting" ? `m:${entry.meeting.id}` : `r:${entry.item.id}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
