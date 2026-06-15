import type { ApoloDashboardData } from "@/lib/apolo/types";
import { searchChronosInternalInvitees } from "@/lib/chronos/client";
import { toDateTimeLocalValue } from "@/lib/chronos/calendar";
import {
  getInviteeKey,
  hasChronosInviteeContact,
  mapApoloEntityToChronosInvitee,
  parseLines,
  type ChronosAgendaInvitee,
  type ChronosInviteeSource,
} from "@/lib/chronos/invitees";
import type { ChronosMeeting, ChronosUpdateInput } from "@/lib/chronos/types";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { PanteonLoadingMark } from "@/components/panteon/panteon-loading";
import {
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type ChronosCalendarEventEditorModalProps = {
  meeting: ChronosMeeting;
  onClose: () => void;
  onDelete: (meetingId: string) => Promise<void>;
  onSave: (input: ChronosUpdateInput) => Promise<void>;
  saving: boolean;
};

type ChronosApoloSearchState = "error" | "idle" | "loading" | "ready";
type ChronosAgendaAgentMessage = {
  content: string;
  id: string;
  role: "athena" | "user";
};

export function ChronosCalendarEventEditorModal({
  meeting,
  onClose,
  onDelete,
  onSave,
  saving,
}: ChronosCalendarEventEditorModalProps) {
  const initialStartsAt = useMemo(
    () =>
      meeting.startsAt
        ? toDateTimeLocalValue(new Date(meeting.startsAt))
        : toDateTimeLocalValue(new Date()),
    [meeting.startsAt],
  );
  const initialEndsAt = useMemo(() => {
    if (meeting.endsAt) {
      return toDateTimeLocalValue(new Date(meeting.endsAt));
    }

    const fallbackDate = meeting.startsAt
      ? new Date(meeting.startsAt)
      : new Date();

    fallbackDate.setHours(fallbackDate.getHours() + 1);

    return toDateTimeLocalValue(fallbackDate);
  }, [meeting.endsAt, meeting.startsAt]);
  const calendarOptions = readCalendarOptions(meeting.metadata.calendarOptions);
  const [title, setTitle] = useState(meeting.title);
  const [startsAt, setStartsAt] = useState(initialStartsAt);
  const [endsAt, setEndsAt] = useState(initialEndsAt);
  const [allDay, setAllDay] = useState(calendarOptions.allDay);
  const [objective, setObjective] = useState(meeting.objective ?? "");
  const [agenda, setAgenda] = useState(readAgendaLines(meeting).join("\n"));
  const [agendaBrief, setAgendaBrief] = useState("");
  const [agendaAgentDraft, setAgendaAgentDraft] = useState("");
  const [agendaAgentMessages, setAgendaAgentMessages] = useState<
    ChronosAgendaAgentMessage[]
  >([
    {
      content:
        "Me conte o objetivo, contexto ou alteracoes que voce quer na pauta. Eu monto a previa ao lado para validacao.",
      id: "athena-intro",
      role: "athena",
    },
  ]);
  const [inviteeSource, setInviteeSource] =
    useState<ChronosInviteeSource>("internal");
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ChronosAgendaInvitee[]>(
    [],
  );
  const [selectedInvitees, setSelectedInvitees] = useState<
    ChronosAgendaInvitee[]
  >(() => mapParticipantsToInvitees(meeting));
  const [contactSearchStatus, setContactSearchStatus] =
    useState<ChronosApoloSearchState>("idle");
  const [contactSearchError, setContactSearchError] = useState<string | null>(
    null,
  );
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [notificationMinutes, setNotificationMinutes] = useState(
    String(calendarOptions.notificationMinutes ?? 10),
  );
  const [availability, setAvailability] = useState<"busy" | "free">(
    calendarOptions.availability,
  );
  const [visibility, setVisibility] = useState<"default" | "private" | "public">(
    calendarOptions.visibility,
  );
  const [guestCanModify, setGuestCanModify] = useState(
    calendarOptions.guestPermissions.canModify,
  );
  const [guestCanInviteOthers, setGuestCanInviteOthers] = useState(
    calendarOptions.guestPermissions.canInviteOthers,
  );
  const [guestCanSeeList, setGuestCanSeeList] = useState(
    calendarOptions.guestPermissions.canSeeGuestList,
  );
  const [agendaAgentLoading, setAgendaAgentLoading] = useState(false);
  const [agendaAgentError, setAgendaAgentError] = useState<string | null>(null);
  const [agendaAgentOpen, setAgendaAgentOpen] = useState(false);

  useEffect(() => {
    const normalizedQuery = contactQuery.trim();

    if (normalizedQuery.length < 2) {
      setContactOptions([]);
      setContactSearchError(null);
      setContactSearchStatus("idle");
      return;
    }

    let active = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      void searchInvitees();
    }, 240);

    async function searchInvitees() {
      try {
        setContactSearchStatus("loading");
        setContactSearchError(null);

        const options =
          inviteeSource === "internal"
            ? await searchInternalInvitees(normalizedQuery)
            : await searchExternalInvitees(normalizedQuery, controller.signal);

        if (!active) {
          return;
        }

        setContactOptions(
          options.filter(
            (invitee) =>
              !selectedInvitees.some(
                (selectedInvitee) =>
                  getInviteeKey(selectedInvitee) === getInviteeKey(invitee),
              ),
          ),
        );
        setContactSearchStatus("ready");
      } catch (error) {
        if (!active) {
          return;
        }

        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setContactOptions([]);
        setContactSearchError(
          error instanceof Error
            ? error.message
            : inviteeSource === "internal"
              ? "Nao foi possivel buscar o time interno."
              : "Nao foi possivel buscar contatos no Apolo.",
        );
        setContactSearchStatus("error");
      }
    }

    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [contactQuery, inviteeSource, selectedInvitees]);

  function handleStartsAtChange(value: string) {
    setStartsAt(value);

    if (!endsAt || new Date(endsAt).getTime() <= new Date(value).getTime()) {
      const nextEnd = new Date(value);
      nextEnd.setHours(nextEnd.getHours() + 1);
      setEndsAt(toDateTimeLocalValue(nextEnd));
    }
  }

  function addInvitee(invitee: ChronosAgendaInvitee) {
    setSelectedInvitees((currentInvitees) =>
      currentInvitees.some(
        (currentInvitee) => getInviteeKey(currentInvitee) === getInviteeKey(invitee),
      )
        ? currentInvitees
        : [...currentInvitees, invitee].slice(0, 30),
    );
    setContactQuery("");
    setContactOptions([]);
    setContactSearchStatus("idle");
  }

  function removeInvitee(inviteeKey: string) {
    setSelectedInvitees((currentInvitees) =>
      currentInvitees.filter((invitee) => getInviteeKey(invitee) !== inviteeKey),
    );
  }

  async function handleSave() {
    const schedule = buildSchedulePayload({ allDay, endsAt, startsAt });

    await onSave({
      action: "update_schedule",
      agenda: parseLines(agenda),
      calendarOptions: {
        allDay,
        availability,
        guestPermissions: {
          canInviteOthers: guestCanInviteOthers,
          canModify: guestCanModify,
          canSeeGuestList: guestCanSeeList,
        },
        notificationMinutes: Number(notificationMinutes) || 10,
        visibility,
      },
      endsAt: schedule.endsAt,
      meetingId: meeting.id,
      objective,
      participants: selectedInvitees.map((invitee) => ({
        displayName: invitee.displayName,
        email: invitee.email,
        organization:
          invitee.organization ??
          (invitee.source === "internal" ? "Careli" : undefined),
        role: "participant" as const,
        userId: invitee.userId,
      })),
      startsAt: schedule.startsAt,
      title,
    });
  }

  async function handleGenerateAgenda() {
    const chatInstruction = agendaBrief.trim();

    if (!chatInstruction && !agendaAgentDraft.trim()) {
      setAgendaAgentError("Envie uma mensagem para Athena montar a pauta.");
      return;
    }

    try {
      setAgendaAgentLoading(true);
      setAgendaAgentError(null);

      const conversationContext = agendaAgentMessages
        .filter((message) => message.role === "user")
        .map((message) => message.content)
        .concat(chatInstruction ? [chatInstruction] : [])
        .join("\n\n");

      if (chatInstruction) {
        setAgendaAgentMessages((currentMessages) => [
          ...currentMessages,
          {
            content: chatInstruction,
            id: `user-${Date.now()}`,
            role: "user",
          },
        ]);
        setAgendaBrief("");
      }

      const accessToken = await getChronosApoloAccessToken();
      const response = await fetch("/api/chronos/meetings/agent", {
        body: JSON.stringify({
          action: "generate_agenda",
          context: {
            agendaBrief: conversationContext,
            currentAgenda: parseLines(agendaAgentDraft || agenda),
            endsAt,
            objective,
            participants: selectedInvitees.map((invitee) => ({
              displayName: invitee.displayName,
              email: invitee.email,
              organization:
                invitee.organization ??
                (invitee.source === "internal" ? "Careli" : undefined),
            })),
            startsAt,
            title,
          },
          meetingId: meeting.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            agenda?: unknown;
            agendaMarkdown?: unknown;
            bulletPoints?: unknown;
            error?: string;
            title?: unknown;
          }
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Nao foi possivel gerar a pauta.");
      }

      const agendaTitle =
        typeof payload?.title === "string" ? payload.title.trim() : "";
      const nextAgenda = Array.isArray(payload?.bulletPoints)
        ? payload.bulletPoints
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : Array.isArray(payload?.agenda)
          ? payload.agenda
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
          : [];

      if (nextAgenda.length === 0) {
        throw new Error("Athena nao retornou itens de pauta.");
      }

      const agendaMarkdown =
        typeof payload?.agendaMarkdown === "string"
          ? payload.agendaMarkdown.trim()
          : "";

      setAgendaAgentDraft(
        agendaMarkdown ||
          formatExecutiveAgenda(agendaTitle || "Pauta executiva", nextAgenda),
      );
      setAgendaAgentMessages((currentMessages) => [
        ...currentMessages,
        {
          content:
            "Atualizei a previa da pauta. Confira o resultado ao lado e me envie outro ajuste se quiser refinar antes de aplicar.",
          id: `athena-${Date.now()}`,
          role: "athena",
        },
      ]);
    } catch (error) {
      setAgendaAgentError(
        error instanceof Error
          ? error.message
          : "Nao foi possivel gerar a pauta.",
      );
    } finally {
      setAgendaAgentLoading(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Excluir "${meeting.title}" da agenda Chronos?`)) {
      return;
    }

    await onDelete(meeting.id);
  }

  return (
    <section className="grid h-full grid-rows-[auto_minmax(0,1fr)] bg-[#f3f6fa] text-[#101820]">
      <header className="flex items-center justify-between gap-3 border-b border-[#d9e0e7] bg-white px-5 py-4">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            aria-label="Fechar edicao"
            className="grid h-10 w-10 place-items-center rounded-full border border-[#d9e0e7] bg-white text-[#526078] transition hover:bg-[#f8fafc] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" size={20} />
          </button>
          <CalendarClock aria-hidden="true" className="text-[#A07C3B]" size={22} />
          <input
            aria-label="Titulo do evento"
            className="min-w-0 flex-1 border-0 bg-transparent text-2xl font-semibold text-[#101820] outline-none placeholder:text-[#98a2b3]"
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Titulo"
            value={title}
          />
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            aria-label="Excluir evento"
            className="grid h-10 w-10 place-items-center rounded-md text-red-600 transition hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-red-200 disabled:cursor-wait disabled:opacity-55"
            disabled={saving}
            onClick={() => void handleDelete()}
            type="button"
          >
            <Trash2 aria-hidden="true" size={18} />
          </button>
          <button
            className="inline-flex h-10 items-center gap-2 rounded-md bg-[#101820] px-4 text-sm font-semibold text-white transition hover:bg-[#1f2937] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-wait disabled:opacity-55"
            disabled={saving || !title.trim()}
            onClick={() => void handleSave()}
            type="button"
          >
            {saving ? (
              <PanteonLoadingMark inverse size="xs" />
            ) : (
              <Save aria-hidden="true" size={16} />
            )}
            Salvar
          </button>
        </div>
      </header>

      <div className="min-h-0 overflow-auto p-6">
        <div className="mx-auto grid max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(20rem,0.75fr)]">
          <div className="grid gap-4 rounded-lg border border-[#d9e0e7] bg-white p-5">
            <div className="grid gap-3">
              <div className="grid gap-4 md:grid-cols-2">
                <label className="grid gap-1 text-sm font-semibold text-[#344054]">
                  Inicio
                  <input
                    className="h-11 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none transition focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                    onChange={(event) => handleStartsAtChange(event.target.value)}
                    type={allDay ? "date" : "datetime-local"}
                    value={allDay ? toDateOnlyInput(startsAt) : startsAt}
                  />
                </label>
                <label className="grid gap-1 text-sm font-semibold text-[#344054]">
                  Fim
                  <input
                    className="h-11 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none transition focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                    min={allDay ? toDateOnlyInput(startsAt) : startsAt}
                    onChange={(event) => setEndsAt(event.target.value)}
                    type={allDay ? "date" : "datetime-local"}
                    value={allDay ? toDateOnlyInput(endsAt) : endsAt}
                  />
                </label>
              </div>
              <label className="flex w-fit items-center gap-2 text-sm font-semibold text-[#344054]">
                <input
                  checked={allDay}
                  className="h-4 w-4 accent-[#A07C3B]"
                  onChange={(event) => setAllDay(event.target.checked)}
                  type="checkbox"
                />
                Dia inteiro
              </label>
            </div>

            <div className="grid gap-1">
              <div className="flex items-center justify-between gap-3">
                <label
                  className="text-sm font-semibold text-[#344054]"
                  htmlFor="chronos-event-agenda"
                >
                  Pauta
                </label>
                <button
                  aria-label="Gerar pauta com Athena"
                  className="grid h-9 w-9 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#A07C3B] transition hover:bg-[#fff8ec] hover:text-[#7a5b24] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-wait disabled:opacity-55"
                  disabled={agendaAgentLoading || saving || !title.trim()}
                  onClick={() => {
                    setAgendaAgentDraft(agenda);
                    setAgendaAgentError(null);
                    setAgendaAgentOpen(true);
                  }}
                  title="Gerar pauta com Athena"
                  type="button"
                >
                  {agendaAgentLoading ? (
                    <PanteonLoadingMark size="xs" />
                  ) : (
                    <Bot aria-hidden="true" size={16} />
                  )}
                </button>
              </div>
              <div
                aria-label="Pauta formatada"
                className="max-h-[22rem] min-h-40 overflow-y-auto overflow-x-hidden rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-3 py-3 text-sm leading-6 text-[#101820] outline-none transition focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                id="chronos-event-agenda"
                role="region"
                tabIndex={0}
              >
                {agenda.trim() ? (
                  <ChronosAgendaTextPreview
                    items={parseChronosAgendaTextPreview(agenda)}
                  />
                ) : (
                  <span className="font-semibold text-[#98a2b3]">
                    Adicionar pauta
                  </span>
                )}
              </div>
              {agendaAgentError ? (
                <span className="text-xs font-semibold text-red-600">
                  {agendaAgentError}
                </span>
              ) : null}
            </div>

            <label className="grid gap-1 text-sm font-semibold text-[#344054]">
              Descricao
              <textarea
                className="min-h-48 resize-y rounded-md border border-[#d9e0e7] bg-[#f8fafc] px-3 py-3 text-sm leading-6 text-[#101820] outline-none transition focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                onChange={(event) => setObjective(event.target.value)}
                placeholder="Adicionar descricao"
                value={objective}
              />
            </label>

            <div className="border-t border-[#edf0f4] pt-1">
              <button
                className="inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-[#526078] transition hover:bg-[#f5f7fa] hover:text-[#101820]"
                onClick={() => setShowMoreOptions((current) => !current)}
                type="button"
              >
                {showMoreOptions ? (
                  <ChevronUp aria-hidden="true" size={14} />
                ) : (
                  <ChevronDown aria-hidden="true" size={14} />
                )}
                Mais opcoes
              </button>
            </div>

            {showMoreOptions ? (
              <div className="grid gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
                <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
                  <Clock3
                    aria-hidden="true"
                    className="mt-2 justify-self-center text-[#667085]"
                    size={17}
                  />
                  <div className="grid gap-2 sm:grid-cols-3">
                    <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
                      Notificacao
                      <input
                        className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                        min={0}
                        onChange={(event) =>
                          setNotificationMinutes(event.target.value)
                        }
                        type="number"
                        value={notificationMinutes}
                      />
                    </label>
                    <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
                      Agenda
                      <select
                        className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                        onChange={(event) =>
                          setAvailability(event.target.value as "busy" | "free")
                        }
                        value={availability}
                      >
                        <option value="busy">Ocupado</option>
                        <option value="free">Livre</option>
                      </select>
                    </label>
                    <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
                      Visibilidade
                      <select
                        className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                        onChange={(event) =>
                          setVisibility(
                            event.target.value as "default" | "private" | "public",
                          )
                        }
                        value={visibility}
                      >
                        <option value="default">Padrao</option>
                        <option value="private">Privado</option>
                        <option value="public">Publico</option>
                      </select>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
                  <ShieldCheck
                    aria-hidden="true"
                    className="mt-1 justify-self-center text-[#667085]"
                    size={17}
                  />
                  <div className="grid gap-2 text-sm font-semibold text-[#344054]">
                    <label className="flex items-center gap-2">
                      <input
                        checked={guestCanModify}
                        className="h-4 w-4 accent-[#A07C3B]"
                        onChange={(event) => setGuestCanModify(event.target.checked)}
                        type="checkbox"
                      />
                      Convidados podem modificar o evento
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        checked={guestCanInviteOthers}
                        className="h-4 w-4 accent-[#A07C3B]"
                        onChange={(event) =>
                          setGuestCanInviteOthers(event.target.checked)
                        }
                        type="checkbox"
                      />
                      Convidados podem convidar outras pessoas
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        checked={guestCanSeeList}
                        className="h-4 w-4 accent-[#A07C3B]"
                        onChange={(event) => setGuestCanSeeList(event.target.checked)}
                        type="checkbox"
                      />
                      Convidados podem ver a lista de participantes
                    </label>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <aside className="grid content-start gap-4 rounded-lg border border-[#d9e0e7] bg-white p-5">
            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-3">
                <p className="m-0 text-xs font-bold uppercase text-[#667085]">
                  Convidados ({selectedInvitees.length})
                </p>
                <UsersRound aria-hidden="true" className="text-[#A07C3B]" size={17} />
              </div>
              <div className="inline-grid w-fit grid-cols-2 rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-0.5">
                {[
                  { id: "internal", label: "Interno" },
                  { id: "external", label: "Apolo" },
                ].map((option) => (
                  <button
                    aria-pressed={inviteeSource === option.id}
                    className={`h-8 rounded px-3 text-xs font-semibold transition ${
                      inviteeSource === option.id
                        ? "bg-[#101820] text-white"
                        : "text-[#667085] hover:bg-white hover:text-[#101820]"
                    }`}
                    key={option.id}
                    onClick={() => {
                      setInviteeSource(option.id as ChronosInviteeSource);
                      setContactQuery("");
                      setContactOptions([]);
                      setContactSearchStatus("idle");
                      setContactSearchError(null);
                    }}
                    type="button"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <div className="relative">
                <Search
                  aria-hidden="true"
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#98a2b3]"
                  size={15}
                />
                <input
                  className="h-9 w-full rounded-md border border-[#d9e0e7] bg-[#fafbfc] pl-9 pr-3 text-sm text-[#101820] outline-none placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                  onChange={(event) => setContactQuery(event.target.value)}
                  placeholder={
                    inviteeSource === "internal"
                      ? "Buscar time interno"
                      : "Buscar convidados no Apolo"
                  }
                  type="search"
                  value={contactQuery}
                />
              </div>
              {contactSearchStatus === "loading" ? (
                <span className="text-xs font-semibold text-[#667085]">
                  {inviteeSource === "internal"
                    ? "Buscando cadastro interno..."
                    : "Buscando contatos reais do Apolo..."}
                </span>
              ) : null}
              {contactSearchError ? (
                <span className="text-xs font-semibold text-red-600">
                  {contactSearchError}
                </span>
              ) : null}
              {contactOptions.length > 0 ? (
                <div className="grid max-h-44 overflow-auto rounded-md border border-[#edf0f4] bg-white p-1">
                  {contactOptions.map((invitee) => (
                    <button
                      className="grid gap-0.5 rounded px-2 py-2 text-left text-sm transition hover:bg-[#f8fafc] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                      key={getInviteeKey(invitee)}
                      onClick={() => addInvitee(invitee)}
                      type="button"
                    >
                      <span className="font-semibold text-[#101820]">
                        {invitee.displayName}
                      </span>
                      <span className="truncate text-xs text-[#667085]">
                        {[
                          invitee.email,
                          invitee.organization ??
                            (invitee.source === "internal" ? "Careli" : null),
                        ]
                          .filter(Boolean)
                          .join(" / ")}
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="grid gap-1">
              {selectedInvitees.length > 0 ? (
                selectedInvitees.map((invitee) => (
                  <div
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-[#f8fafc]"
                    key={getInviteeKey(invitee)}
                  >
                    <span
                      aria-hidden="true"
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[#eaf3ff] text-xs font-bold uppercase text-[#0b66d8]"
                    >
                      {getInviteeInitials(invitee.displayName)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[#344054]">
                      {invitee.displayName}
                    </span>
                    <button
                      aria-label={`Remover ${invitee.displayName}`}
                      className="grid h-7 w-7 place-items-center rounded-md text-[#667085] transition hover:bg-[#edf0f4] hover:text-[#101820]"
                      onClick={() => removeInvitee(getInviteeKey(invitee))}
                      type="button"
                    >
                      <X aria-hidden="true" size={14} />
                    </button>
                  </div>
                ))
              ) : (
                <span className="rounded-md border border-dashed border-[#d9e0e7] bg-[#fafbfc] p-3 text-sm text-[#667085]">
                  Nenhum convidado adicional registrado.
                </span>
              )}
            </div>

            <div className="border-t border-[#edf0f4] pt-4">
              <p className="m-0 text-xs font-bold uppercase text-[#667085]">
                Contexto
              </p>
              <dl className="mt-4 grid gap-3 text-sm">
                <div>
                  <dt className="font-semibold text-[#667085]">Protocolo</dt>
                  <dd className="m-0 text-[#101820]">{meeting.protocol}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-[#667085]">Host</dt>
                  <dd className="m-0 text-[#101820]">
                    {meeting.hostName ?? "Host Chronos"}
                  </dd>
                </div>
              </dl>
            </div>
          </aside>
        </div>
      </div>
      {agendaAgentOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#101820]/35 px-4 backdrop-blur-sm">
          <div className="grid max-h-[calc(100vh-4rem)] w-full max-w-5xl grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-[#d9e0e7] bg-white shadow-[0_24px_80px_rgb(16_24_32_/_0.28)]">
            <div className="flex items-start justify-between gap-3 border-b border-[#edf0f4] px-5 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-md border border-[#eadfce] bg-[#fff8ec] text-[#A07C3B]">
                    <Bot aria-hidden="true" size={17} />
                  </span>
                  <div className="min-w-0">
                    <p className="m-0 text-base font-semibold text-[#101820]">
                      Athena
                    </p>
                    <p className="m-0 text-xs font-semibold text-[#667085]">
                      Converse, revise e valide a pauta antes de aplicar no evento.
                    </p>
                  </div>
                </div>
              </div>
              <button
                aria-label="Fechar agente de pauta"
                className="grid h-9 w-9 place-items-center rounded-md text-[#667085] transition hover:bg-[#f5f7fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onClick={() => setAgendaAgentOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={17} />
              </button>
            </div>

            <div className="grid min-h-0 gap-0 overflow-hidden md:grid-cols-[minmax(18rem,0.92fr)_minmax(22rem,1.25fr)]">
              <div className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto] border-r border-[#edf0f4] bg-[#fbfcfd]">
                <div className="grid content-start gap-3 overflow-y-auto px-5 py-4">
                  {agendaAgentMessages.map((message) => (
                    <div
                      className={`grid max-w-[92%] gap-1 rounded-lg px-3 py-2 text-sm leading-5 shadow-sm ${
                        message.role === "user"
                          ? "justify-self-end bg-[#101820] text-white"
                          : "justify-self-start border border-[#eadfce] bg-white text-[#344054]"
                      }`}
                      key={message.id}
                    >
                      <span
                        className={`text-[11px] font-bold uppercase ${
                          message.role === "user" ? "text-white/70" : "text-[#A07C3B]"
                        }`}
                      >
                        {message.role === "user" ? "Voce" : "Athena"}
                      </span>
                      <span>{message.content}</span>
                    </div>
                  ))}
                  {agendaAgentError ? (
                    <span className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                      {agendaAgentError}
                    </span>
                  ) : null}
                </div>
                <div className="grid gap-2 border-t border-[#edf0f4] bg-white p-4">
                  <textarea
                    aria-label="Mensagem para Athena"
                    className="min-h-24 resize-none rounded-md border border-[#d9e0e7] bg-white px-3 py-2 text-sm leading-5 text-[#101820] outline-none transition placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                    onChange={(event) => setAgendaBrief(event.target.value)}
                    onKeyDown={(event) => {
                      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
                        event.preventDefault();
                        void handleGenerateAgenda();
                      }
                    }}
                    placeholder="Escreva o objetivo, contexto ou ajuste. Ex.: deixe mais executivo e reduza para 45 minutos."
                    value={agendaBrief}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <button
                      className="h-9 rounded-md px-3 text-sm font-semibold text-[#526078] transition hover:bg-[#f5f7fa] hover:text-[#101820]"
                      onClick={() => setAgendaAgentOpen(false)}
                      type="button"
                    >
                      Cancelar
                    </button>
                    <button
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm font-semibold text-[#344054] transition hover:bg-[#f8fafc] hover:text-[#101820] disabled:cursor-wait disabled:opacity-55"
                      disabled={
                        agendaAgentLoading ||
                        saving ||
                        !title.trim() ||
                        (!agendaBrief.trim() && !agendaAgentDraft.trim())
                      }
                      onClick={() => void handleGenerateAgenda()}
                      type="button"
                    >
                      {agendaAgentLoading ? (
                        <PanteonLoadingMark inverse size="xs" />
                      ) : (
                        <Bot aria-hidden="true" size={15} />
                      )}
                      Enviar
                    </button>
                  </div>
                </div>
              </div>

              <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-white">
                <div className="border-b border-[#edf0f4] px-5 py-4">
                  <p className="m-0 text-sm font-semibold text-[#101820]">
                    Resultado da pauta
                  </p>
                  <p className="m-0 mt-1 text-xs font-semibold text-[#667085]">
                    Valide o texto antes de aplicar no campo final.
                  </p>
                </div>
                <textarea
                  aria-label="Resultado da pauta Athena"
                  className="min-h-0 resize-none border-0 bg-[#f8fafc] px-5 py-4 text-sm leading-6 text-[#101820] outline-none transition placeholder:text-[#98a2b3] focus:bg-white"
                  onChange={(event) => setAgendaAgentDraft(event.target.value)}
                  placeholder="A pauta gerada aparece aqui para revisao."
                  value={agendaAgentDraft}
                />
                <div className="flex justify-end border-t border-[#edf0f4] bg-white px-5 py-4">
                  <button
                    className="h-9 rounded-md bg-[#101820] px-4 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:opacity-55"
                    disabled={!agendaAgentDraft.trim()}
                    onClick={() => {
                      setAgenda(agendaAgentDraft);
                      setAgendaAgentOpen(false);
                    }}
                    type="button"
                  >
                    Validar e aplicar pauta
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

async function searchInternalInvitees(query: string) {
  const invitees = await searchChronosInternalInvitees(query);

  return invitees.map((invitee) => ({
    displayName: invitee.displayName,
    email: invitee.email,
    entityId: invitee.userId,
    operationalProfile: invitee.operationalProfile,
    organization: "Careli",
    role: invitee.role,
    source: "internal" as const,
    userId: invitee.userId,
  }));
}

async function getChronosApoloAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Sessao administrativa ausente.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token ?? null;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
}

async function searchExternalInvitees(query: string, signal: AbortSignal) {
  const accessToken = await getChronosApoloAccessToken();
  const params = new URLSearchParams({
    limit: "8",
    q: query,
  });
  const response = await fetch(`/api/apolo/relationships?${params.toString()}`, {
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
    signal,
  });
  const payload = (await response.json().catch(() => null)) as
    | { data?: ApoloDashboardData; error?: string }
    | null;

  if (!response.ok || !payload?.data) {
    throw new Error(payload?.error ?? "Nao foi possivel buscar no Apolo.");
  }

  return payload.data.entities
    .map(mapApoloEntityToChronosInvitee)
    .filter(hasChronosInviteeContact)
    .map((invitee) => ({
      ...invitee,
      source: "external" as const,
    }));
}

function readCalendarOptions(value: unknown) {
  const options =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as {
          allDay?: unknown;
          availability?: unknown;
          guestPermissions?: unknown;
          notificationMinutes?: unknown;
          visibility?: unknown;
        })
      : {};
  const guestPermissions =
    options.guestPermissions &&
    typeof options.guestPermissions === "object" &&
    !Array.isArray(options.guestPermissions)
      ? (options.guestPermissions as Record<string, unknown>)
      : {};

  return {
    allDay: options.allDay === true,
    availability: options.availability === "free" ? "free" : "busy",
    guestPermissions: {
      canInviteOthers: guestPermissions.canInviteOthers !== false,
      canModify: guestPermissions.canModify === true,
      canSeeGuestList: guestPermissions.canSeeGuestList !== false,
    },
    notificationMinutes:
      typeof options.notificationMinutes === "number"
        ? options.notificationMinutes
        : 10,
    visibility:
      options.visibility === "private" || options.visibility === "public"
        ? options.visibility
        : "default",
  } as const;
}

function readAgendaLines(meeting: ChronosMeeting) {
  return Array.isArray(meeting.metadata.agenda)
    ? meeting.metadata.agenda
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean)
    : [];
}

type ChronosAgendaTextPreviewItem =
  | { id: string; text: string; type: "body" | "bullet" | "heading" | "numbered" | "subheading" };

function parseChronosAgendaTextPreview(value: string): ChronosAgendaTextPreviewItem[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((line, index) => {
      const cleanLine = line.replace(/^[-–—]\s*$/, "").trim();

      if (!cleanLine || cleanLine === "***" || cleanLine === "---") {
        return null;
      }

      if (cleanLine.startsWith("### ")) {
        return {
          id: `${index}-${cleanLine}`,
          text: stripAgendaMarkdown(cleanLine.replace(/^###\s+/, "")),
          type: "subheading" as const,
        };
      }

      if (cleanLine.startsWith("## ")) {
        return {
          id: `${index}-${cleanLine}`,
          text: stripAgendaMarkdown(cleanLine.replace(/^##\s+/, "")),
          type: "heading" as const,
        };
      }

      if (/^\d+\.\s+/.test(cleanLine)) {
        return {
          id: `${index}-${cleanLine}`,
          text: cleanLine,
          type: "numbered" as const,
        };
      }

      if (/^[\u2022*-]\s+/.test(cleanLine)) {
        return {
          id: `${index}-${cleanLine}`,
          text: cleanLine.replace(/^[\u2022*-]\s+/, ""),
          type: "bullet" as const,
        };
      }

      return {
        id: `${index}-${cleanLine}`,
        text: cleanLine,
        type: "body" as const,
      };
    })
    .filter((item): item is ChronosAgendaTextPreviewItem => Boolean(item));
}

function ChronosAgendaTextPreview({
  items,
}: {
  items: ChronosAgendaTextPreviewItem[];
}) {
  if (items.length === 0) {
    return <span className="font-semibold text-[#98a2b3]">Adicionar pauta</span>;
  }

  return (
    <div className="grid gap-2 text-sm leading-6 text-[#344054]">
      {items.map((item) => {
        if (item.type === "heading") {
          return (
            <p className="m-0 text-base font-semibold leading-6 text-[#101820]" key={item.id}>
              {renderAgendaInlineMarkdown(item.text)}
            </p>
          );
        }

        if (item.type === "subheading") {
          return (
            <p className="m-0 mt-2 text-xs font-bold uppercase tracking-[0.08em] text-[#101820]" key={item.id}>
              {renderAgendaInlineMarkdown(item.text)}
            </p>
          );
        }

        if (item.type === "numbered") {
          return (
            <p className="m-0 font-semibold text-[#101820]" key={item.id}>
              {renderAgendaInlineMarkdown(item.text)}
            </p>
          );
        }

        if (item.type === "bullet") {
          return (
            <div className="grid grid-cols-[0.55rem_1fr] gap-2" key={item.id}>
              <span className="mt-[0.65rem] h-1 w-1 rounded-full bg-[#A07C3B]" />
              <p className="m-0">{renderAgendaInlineMarkdown(item.text)}</p>
            </div>
          );
        }

        return (
          <p className="m-0" key={item.id}>
            {renderAgendaInlineMarkdown(item.text)}
          </p>
        );
      })}
    </div>
  );
}

function stripAgendaMarkdown(value: string) {
  return value.replace(/\*\*/g, "").trim();
}

function renderAgendaInlineMarkdown(value: string) {
  const parts = value.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);

  if (parts.length === 0) {
    return value;
  }

  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong className="font-semibold text-[#101820]" key={`${part}-${index}`}>
          {part.slice(2, -2)}
        </strong>
      );
    }

    return <span key={`${part}-${index}`}>{part}</span>;
  });
}

function formatExecutiveAgenda(title: string, bulletPoints: string[]) {
  return [
    `## ${title.trim() || "Pauta executiva"}`,
    "",
    ...bulletPoints.map((item) => `• ${item}`),
  ].join("\n");
}

function mapParticipantsToInvitees(meeting: ChronosMeeting): ChronosAgendaInvitee[] {
  return meeting.participants
    .filter((participant) => participant.role !== "host")
    .map((participant) => ({
      displayName: participant.displayName,
      email: participant.email ?? undefined,
      entityId: participant.userId ?? participant.email ?? participant.id,
      organization: participant.organization ?? undefined,
      role: participant.role,
      source: participant.userId ? "internal" : "external",
      userId: participant.userId ?? undefined,
    }));
}

function buildSchedulePayload({
  allDay,
  endsAt,
  startsAt,
}: {
  allDay: boolean;
  endsAt: string;
  startsAt: string;
}) {
  if (!allDay) {
    return {
      endsAt: new Date(endsAt).toISOString(),
      startsAt: new Date(startsAt).toISOString(),
    };
  }

  const start = new Date(`${toDateOnlyInput(startsAt)}T00:00:00`);
  const end = new Date(`${toDateOnlyInput(endsAt)}T23:59:59`);

  return {
    endsAt: end.toISOString(),
    startsAt: start.toISOString(),
  };
}

function toDateOnlyInput(value: string) {
  return value.includes("T") ? value.slice(0, 10) : value;
}

function getInviteeInitials(displayName: string) {
  const initials = displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("");

  return initials || "?";
}
