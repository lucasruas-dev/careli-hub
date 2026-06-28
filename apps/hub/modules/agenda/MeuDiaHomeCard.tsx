"use client";

import { Surface } from "@repo/uix";
import { CalendarClock, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import {
  loadMeuDia,
  type AgendaItem,
  type AgendaItemPriority,
  type AgendaMeeting,
} from "@/modules/agenda/data";

// Resumo COMPACTO do "Meu dia" para a Home (digest): top da agenda + tarefas em
// foco + contagem do Asana. O planner completo mora em /agenda ("ver tudo").

const AGENDA_LIMIT = 3;
const TASK_LIMIT = 5;

type AgendaLine =
  | { id: string; kind: "meeting"; meeting: AgendaMeeting; time: number }
  | { id: string; kind: "retorno"; item: AgendaItem; time: number };

export function MeuDiaHomeCard({ className }: { className?: string }) {
  const [items, setItems] = useState<AgendaItem[]>([]);
  const [meetings, setMeetings] = useState<AgendaMeeting[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    loadMeuDia()
      .then((snapshot) => {
        if (!active) return;
        setItems(snapshot.items);
        setMeetings(snapshot.meetings);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const now = useMemo(() => new Date(), [items, meetings]);
  const startToday = useMemo(() => atStartOfDay(now), [now]);
  const endToday = useMemo(() => atEndOfDay(now), [now]);

  const agendaLines = useMemo<AgendaLine[]>(() => {
    const lines: AgendaLine[] = [];
    for (const meeting of meetings) {
      const time = meeting.startsAt ? Date.parse(meeting.startsAt) : NaN;
      if (Number.isNaN(time) || time < startToday || time > endToday) continue;
      lines.push({ id: `m:${meeting.id}`, kind: "meeting", meeting, time });
    }
    for (const item of items) {
      if (item.kind !== "retorno" || !item.dueAt) continue;
      const time = Date.parse(item.dueAt);
      if (Number.isNaN(time) || time > endToday) continue;
      lines.push({ id: `r:${item.id}`, kind: "retorno", item, time });
    }
    return lines.sort((a, b) => a.time - b.time);
  }, [items, meetings, startToday, endToday]);

  const tarefas = useMemo(
    () => items.filter((item) => item.kind === "tarefa"),
    [items],
  );
  const focusTasks = useMemo(
    () => [...tarefas].sort((a, b) => taskRank(a, startToday, endToday) - taskRank(b, startToday, endToday)).slice(0, TASK_LIMIT),
    [tarefas, startToday, endToday],
  );

  const retornosHoje = items.filter(
    (item) =>
      item.kind === "retorno" &&
      item.dueAt !== null &&
      Date.parse(item.dueAt) >= startToday &&
      Date.parse(item.dueAt) <= endToday,
  ).length;
  const atrasadas = items.filter(
    (item) => item.dueAt !== null && Date.parse(item.dueAt) < startToday,
  ).length;

  return (
    <Surface
      bordered
      className={`border-[#d9e0e7] bg-white p-5 shadow-[0_14px_34px_rgb(16_24_32_/_0.07)] ${className ?? ""}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="grid size-8 place-items-center rounded-lg bg-[#2563eb]/10 text-[#2563eb]">
            <CalendarClock size={18} />
          </span>
          <div>
            <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-[#667085]">Hoje</p>
            <p className="m-0 text-sm font-semibold text-[#17202f]">Meu dia</p>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <MiniStat label="retornos" value={retornosHoje} />
          <MiniStat label="tarefas" value={tarefas.length} />
          <MiniStat danger label="atrasadas" value={atrasadas} />
        </div>
      </div>

      <div className="mt-4 grid gap-5 md:grid-cols-2">
        <div>
          <p className="m-0 mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-[#485466]">
            <CalendarClock className="text-[#94a3b8]" size={13} /> Agenda de hoje
          </p>
          {loading ? (
            <SkeletonLines />
          ) : agendaLines.length === 0 ? (
            <EmptyLine text="Sem compromissos para hoje." />
          ) : (
            agendaLines.slice(0, AGENDA_LIMIT).map((line) => (
              <div
                className="flex items-center gap-2.5 border-t border-[#edf0f4] py-1.5 first:border-t-0"
                key={line.id}
              >
                <span className="min-w-9 text-xs text-[#667085]">{formatTime(line.time)}</span>
                <span className="flex-1 truncate text-[13px] text-[#17202f]">
                  {line.kind === "meeting" ? line.meeting.title : line.item.title}
                </span>
                <Tag tone={line.kind === "meeting" ? "success" : "accent"}>
                  {line.kind === "meeting" ? "reuniao" : "retorno"}
                </Tag>
              </div>
            ))
          )}
          {agendaLines.length > AGENDA_LIMIT ? (
            <p className="m-0 pt-1.5 text-xs text-[#667085]">+{agendaLines.length - AGENDA_LIMIT} mais hoje</p>
          ) : null}
        </div>

        <div>
          <p className="m-0 mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-[#485466]">
            <ListChecks className="text-[#94a3b8]" size={13} /> Tarefas em foco
          </p>
          {loading ? (
            <SkeletonLines />
          ) : focusTasks.length === 0 ? (
            <EmptyLine text="Nenhuma tarefa aberta." />
          ) : (
            focusTasks.map((task) => (
              <div
                className="flex items-center gap-2.5 border-t border-[#edf0f4] py-1.5 first:border-t-0"
                key={task.id}
              >
                <span
                  className="size-[7px] flex-none rounded-full"
                  style={{ background: priorityColor(task.priority) }}
                />
                <span className="flex-1 truncate text-[13px] text-[#17202f]">{task.title}</span>
                <span
                  className="whitespace-nowrap text-[11px]"
                  style={{ color: task.dueAt && Date.parse(task.dueAt) < startToday ? "#c24135" : "#667085" }}
                >
                  {formatDue(task.dueAt, startToday, endToday)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </Surface>
  );
}

function MiniStat({ danger, label, value }: { danger?: boolean; label: string; value: number }) {
  return (
    <div className="text-center">
      <p className={`m-0 text-lg font-semibold ${danger && value > 0 ? "text-[#c24135]" : "text-[#17202f]"}`}>{value}</p>
      <p className="m-0 text-[10px] uppercase tracking-wide text-[#667085]">{label}</p>
    </div>
  );
}

function Tag({ children, tone }: { children: ReactNode; tone: "accent" | "success" }) {
  const styles =
    tone === "success"
      ? "bg-[#14804a]/12 text-[#14804a]"
      : "bg-[#2563eb]/12 text-[#2563eb]";
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${styles}`}>{children}</span>;
}

function EmptyLine({ text }: { text: string }) {
  return <p className="m-0 py-2 text-[13px] text-[#667085]">{text}</p>;
}

function SkeletonLines() {
  return (
    <div className="grid gap-2 py-1">
      {[0, 1, 2].map((index) => (
        <div className="h-4 animate-pulse rounded bg-[#edf0f4]" key={index} />
      ))}
    </div>
  );
}

function taskRank(item: AgendaItem, startToday: number, endToday: number): number {
  const dueWeight = (() => {
    if (!item.dueAt) return 3;
    const time = Date.parse(item.dueAt);
    if (Number.isNaN(time)) return 3;
    if (time < startToday) return 0;
    if (time <= endToday) return 1;
    return 2;
  })();
  const priorityWeight = { urgente: 0, alta: 1, media: 2, baixa: 3 }[item.priority ?? "baixa"] ?? 3;
  return dueWeight * 10 + priorityWeight;
}

function priorityColor(priority: AgendaItemPriority | null): string {
  switch (priority) {
    case "urgente":
      return "#E24B4A";
    case "alta":
      return "#BA7517";
    case "media":
      return "#2563eb";
    default:
      return "#888780";
  }
}

function atStartOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

function atEndOfDay(date: Date): number {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy.getTime();
}

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDue(dueAt: string | null, startToday: number, endToday: number): string {
  if (!dueAt) return "";
  const time = Date.parse(dueAt);
  if (Number.isNaN(time)) return "";
  if (time < startToday) {
    const days = Math.round((startToday - time) / 86_400_000);
    return days <= 1 ? "ontem" : `${days}d atras`;
  }
  if (time <= endToday) return "hoje";
  const days = Math.round((time - startToday) / 86_400_000);
  return days === 1 ? "amanha" : new Date(time).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}
