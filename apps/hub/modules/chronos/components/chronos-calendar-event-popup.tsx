import { searchChronosInternalInvitees } from "@/lib/chronos/client";
import {
  addMinutesToDateTimeLocal,
  buildChronosRecurrenceInput,
  getChronosRecurrenceOptions,
  type ChronosCustomRecurrenceEnd,
  type ChronosCustomRecurrenceFrequency,
  type ChronosRecurrenceMode,
} from "@/lib/chronos/calendar";
import {
  getInviteeKey,
  hasChronosInviteeContact,
  mapAgendaInviteeToApoloInvitee,
  mapAgendaInviteeToHubInvitee,
  mapApoloEntityToChronosInvitee,
  mapHubInviteeToAgendaInvitee,
  parseLines,
  type ChronosAgendaInvitee,
  type ChronosInviteeSource,
} from "@/lib/chronos/invitees";
import {
  buildAbsoluteExternalRoomLink,
  buildExternalRoomLink,
} from "@/lib/chronos/rooms";
import {
  defaultChronosMeetingProfiles,
  type ChronosCalendarEventKind,
  type ChronosCreateMeetingInput,
  type ChronosMeetingLocationMode,
  type ChronosMeetingProfile,
  type ChronosRoom,
} from "@/lib/chronos/types";
import type { ApoloDashboardData } from "@/lib/apolo/types";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { PanteonLoadingMark } from "@/components/panteon/panteon-loading";
import {
  Bot,
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Clock3,
  ExternalLink,
  FileText,
  ListChecks,
  MapPin,
  Repeat2,
  Save,
  Search,
  ShieldCheck,
  UsersRound,
  Video,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type ChronosApoloSearchState = "error" | "idle" | "loading" | "ready";
export function ChronosCalendarEventPopup({
  initialStartsAt,
  onCancel,
  onCreate,
  profiles,
  rooms,
  saving,
}: {
  initialStartsAt: string;
  onCancel: () => void;
  onCreate: (input: ChronosCreateMeetingInput) => Promise<void>;
  profiles: ChronosMeetingProfile[];
  rooms: ChronosRoom[];
  saving: boolean;
}) {
  const activeProfiles = useMemo(
    () => profiles.filter((profile) => profile.status === "active"),
    [profiles],
  );
  const [title, setTitle] = useState("");
  const [startsAt, setStartsAt] = useState(initialStartsAt);
  const [endsAt, setEndsAt] = useState(() =>
    addMinutesToDateTimeLocal(initialStartsAt, 60),
  );
  const [calendarEventKind, setCalendarEventKind] =
    useState<ChronosCalendarEventKind>("event");
  const [profileId, setProfileId] = useState(
    activeProfiles[0]?.id ?? "external",
  );
  const [locationMode, setLocationMode] =
    useState<ChronosMeetingLocationMode>("online");
  const [roomId, setRoomId] = useState(rooms[0]?.id ?? "");
  const [locationAddress, setLocationAddress] = useState("");
  const [objective, setObjective] = useState("");
  const [agenda, setAgenda] = useState("");
  const [agendaAgentContext, setAgendaAgentContext] = useState("");
  const [agendaAgentError, setAgendaAgentError] = useState<string | null>(null);
  const [agendaAgentLoading, setAgendaAgentLoading] = useState(false);
  const [agendaAgentOpen, setAgendaAgentOpen] = useState(false);
  const [inviteeSource, setInviteeSource] =
    useState<ChronosInviteeSource>("internal");
  const [contactQuery, setContactQuery] = useState("");
  const [contactOptions, setContactOptions] = useState<ChronosAgendaInvitee[]>(
    [],
  );
  const [selectedInvitees, setSelectedInvitees] = useState<
    ChronosAgendaInvitee[]
  >([]);
  const [contactSearchStatus, setContactSearchStatus] =
    useState<ChronosApoloSearchState>("idle");
  const [contactSearchError, setContactSearchError] = useState<string | null>(
    null,
  );
  const [showMoreOptions, setShowMoreOptions] = useState(false);
  const [recurrenceMode, setRecurrenceMode] =
    useState<ChronosRecurrenceMode>("none");
  const [customRepeatInterval, setCustomRepeatInterval] = useState("1");
  const [customRepeatFrequency, setCustomRepeatFrequency] =
    useState<ChronosCustomRecurrenceFrequency>("weekly");
  const [customRepeatEnd, setCustomRepeatEnd] =
    useState<ChronosCustomRecurrenceEnd>("never");
  const [customRepeatUntil, setCustomRepeatUntil] = useState("");
  const [notificationMinutes, setNotificationMinutes] = useState("10");
  const [availability, setAvailability] = useState<"busy" | "free">("busy");
  const [visibility, setVisibility] = useState<"default" | "private" | "public">(
    "default",
  );
  const [guestCanModify, setGuestCanModify] = useState(false);
  const [guestCanInviteOthers, setGuestCanInviteOthers] = useState(true);
  const [guestCanSeeList, setGuestCanSeeList] = useState(true);
  const selectedProfile =
    activeProfiles.find((profile) => profile.id === profileId) ??
    activeProfiles[0] ??
    defaultChronosMeetingProfiles[0];
  const selectedRoom = rooms.find((room) => room.id === roomId) ?? null;
  const selectedRoomPath = selectedRoom ? buildExternalRoomLink(selectedRoom.slug) : "";
  const selectedRoomUrl = selectedRoom
    ? buildAbsoluteExternalRoomLink(selectedRoom.slug)
    : "";
  const eventKinds: Array<{ id: ChronosCalendarEventKind; label: string }> = [
    { id: "event", label: "Evento" },
    { id: "task", label: "Tarefa" },
    { id: "out_of_office", label: "Ausente" },
    { id: "appointment", label: "Agendamento" },
  ];
  const recurrenceOptions = getChronosRecurrenceOptions(new Date(startsAt));

  useEffect(() => {
    setStartsAt(initialStartsAt);
    setEndsAt(addMinutesToDateTimeLocal(initialStartsAt, 60));
  }, [initialStartsAt]);

  useEffect(() => {
    setRoomId((currentRoomId) => currentRoomId || rooms[0]?.id || "");
  }, [rooms]);

  useEffect(() => {
    setProfileId((currentProfileId) =>
      activeProfiles.some((profile) => profile.id === currentProfileId)
        ? currentProfileId
        : activeProfiles[0]?.id ?? "external",
    );
  }, [activeProfiles]);

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

  async function searchInternalInvitees(query: string) {
    const invitees = await searchChronosInternalInvitees(query);

    return invitees.map(mapHubInviteeToAgendaInvitee);
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

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCancel();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel]);

  function handleStartsAtChange(value: string) {
    setStartsAt(value);

    if (!endsAt || new Date(endsAt).getTime() <= new Date(value).getTime()) {
      setEndsAt(addMinutesToDateTimeLocal(value, 60));
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

  async function handleGenerateAgenda() {
    try {
      setAgendaAgentLoading(true);
      setAgendaAgentError(null);

      const accessToken = await getChronosApoloAccessToken();
      const response = await fetch("/api/chronos/meetings/agent", {
        body: JSON.stringify({
          action: "generate_agenda",
          context: {
            agendaBrief: agendaAgentContext,
            currentAgenda: parseLines(agenda),
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
      const bulletPoints = Array.isArray(payload?.bulletPoints)
        ? payload.bulletPoints
            .map((item) => (typeof item === "string" ? item.trim() : ""))
            .filter(Boolean)
        : Array.isArray(payload?.agenda)
          ? payload.agenda
              .map((item) => (typeof item === "string" ? item.trim() : ""))
              .filter(Boolean)
          : [];

      if (bulletPoints.length === 0) {
        throw new Error("Athena nao retornou itens de pauta.");
      }

      const agendaMarkdown =
        typeof payload?.agendaMarkdown === "string"
          ? payload.agendaMarkdown.trim()
          : "";

      setAgenda(
        agendaMarkdown ||
          formatExecutiveAgenda(agendaTitle || "Pauta executiva", bulletPoints),
      );
      setAgendaAgentOpen(false);
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const internalInvitees = selectedInvitees.filter(
      (invitee) => invitee.source === "internal",
    );
    const externalInvitees = selectedInvitees.filter(
      (invitee) => invitee.source === "external",
    );

    await onCreate({
      agenda: parseLines(agenda),
      apoloInvitees: externalInvitees.map(mapAgendaInviteeToApoloInvitee),
      calendarEventKind,
      calendarOptions: {
        availability,
        guestPermissions: {
          canInviteOthers: guestCanInviteOthers,
          canModify: guestCanModify,
          canSeeGuestList: guestCanSeeList,
        },
        notificationMinutes: Number(notificationMinutes) || 10,
        visibility,
      },
      endsAt,
      hubInvitees: internalInvitees.map(mapAgendaInviteeToHubInvitee),
      locationAddress:
        locationMode === "offline" ? locationAddress.trim() : undefined,
      locationMode,
      meetingType: selectedProfile.meetingType,
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
      profileId: selectedProfile.id,
      recurrence: buildChronosRecurrenceInput({
        customEnd: customRepeatEnd,
        customFrequency: customRepeatFrequency,
        customInterval: Number(customRepeatInterval) || 1,
        customUntil: customRepeatUntil,
        mode: recurrenceMode,
        startsAt,
      }),
      roomId: locationMode === "online" ? roomId : undefined,
      startsAt,
      title,
    });
  }

  return (
    <form
      className="relative z-10 grid max-h-[calc(100vh-8rem)] w-full max-w-[34rem] gap-3 overflow-auto rounded-lg border border-[#d9e0e7] bg-white p-4 shadow-[0_22px_70px_rgb(16_24_32_/_0.22)]"
      onSubmit={handleSubmit}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="grid h-7 w-7 place-items-center rounded-md text-[#667085]">
          <CalendarClock aria-hidden="true" size={17} />
        </span>
        <button
          aria-label="Fechar popup de evento"
          className="grid h-8 w-8 place-items-center rounded-md text-[#667085] transition hover:bg-[#f5f7fa] hover:text-[#101820] focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
          onClick={onCancel}
          type="button"
        >
          <X aria-hidden="true" size={17} />
        </button>
      </div>

      <div className="grid gap-3 pl-10">
        <input
          className="h-11 border-0 border-b-2 border-[#d9e0e7] bg-transparent px-0 text-xl font-semibold text-[#101820] outline-none placeholder:text-[#667085] focus:border-[#A07C3B]"
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Adicionar titulo"
          required
          value={title}
        />

        <div className="flex gap-1 overflow-x-auto">
          {eventKinds.map((kind) => (
            <button
              aria-pressed={calendarEventKind === kind.id}
              className={`h-8 shrink-0 rounded-md px-3 text-xs font-semibold transition ${
                calendarEventKind === kind.id
                  ? "bg-[#d8edf8] text-[#075985]"
                  : "text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
              }`}
              key={kind.id}
              onClick={() => setCalendarEventKind(kind.id)}
              type="button"
            >
              {kind.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-3">
        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3">
          <Clock3 aria-hidden="true" className="justify-self-center text-[#667085]" size={17} />
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
              Inicio
              <input
                className="h-9 rounded-md border border-[#d9e0e7] bg-[#fafbfc] px-3 text-sm font-medium normal-case text-[#101820] outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                onChange={(event) => handleStartsAtChange(event.target.value)}
                required
                type="datetime-local"
                value={startsAt}
              />
            </label>
            <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
              Fim
              <input
                className="h-9 rounded-md border border-[#d9e0e7] bg-[#fafbfc] px-3 text-sm font-medium normal-case text-[#101820] outline-none focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
                min={startsAt}
                onChange={(event) => setEndsAt(event.target.value)}
                required
                type="datetime-local"
                value={endsAt}
              />
            </label>
          </div>
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
          <UsersRound aria-hidden="true" className="justify-self-center text-[#667085]" size={17} />
          <div className="grid gap-2">
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
                        invitee.phone,
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
            {selectedInvitees.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {selectedInvitees.map((invitee) => (
                  <span
                    className="inline-flex min-h-7 items-center gap-1 rounded-md border border-[#d9e0e7] bg-white px-2 text-xs font-semibold text-[#344054]"
                    key={getInviteeKey(invitee)}
                  >
                    {invitee.displayName}
                    <span className="rounded bg-[#edf0f4] px-1 py-0.5 text-[10px] uppercase text-[#667085]">
                      {invitee.source === "internal" ? "Interno" : "Apolo"}
                    </span>
                    <button
                      aria-label={`Remover ${invitee.displayName}`}
                      className="grid h-5 w-5 place-items-center rounded text-[#667085] hover:bg-[#f5f7fa] hover:text-[#101820]"
                      onClick={() => removeInvitee(getInviteeKey(invitee))}
                      type="button"
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[#667085]">
                Use Interno para o time da empresa e Apolo para convidados externos.
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
          {locationMode === "online" ? (
            <Video aria-hidden="true" className="mt-2 justify-self-center text-[#A07C3B]" size={17} />
          ) : (
            <MapPin aria-hidden="true" className="mt-2 justify-self-center text-[#A07C3B]" size={17} />
          )}
          <div className="grid gap-2">
            <div className="inline-grid w-fit grid-cols-2 rounded-md border border-[#d9e0e7] bg-[#f8fafc] p-0.5">
              {[
                { id: "online", label: "Online" },
                { id: "offline", label: "Presencial" },
              ].map((option) => (
                <button
                  aria-pressed={locationMode === option.id}
                  className={`h-8 rounded px-3 text-xs font-semibold transition ${
                    locationMode === option.id
                      ? "bg-[#101820] text-white"
                      : "text-[#667085] hover:bg-white hover:text-[#101820]"
                  }`}
                  key={option.id}
                  onClick={() =>
                    setLocationMode(option.id as ChronosMeetingLocationMode)
                  }
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            {locationMode === "online" ? (
              <div className="grid gap-1.5">
                <select
                  className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm text-[#344054] outline-none transition focus:border-[#A07C3B] focus:bg-[#fafbfc]"
                  disabled={rooms.length === 0}
                  onChange={(event) => setRoomId(event.target.value)}
                  value={roomId}
                >
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.name}
                    </option>
                  ))}
                </select>
                {selectedRoom ? (
                  <a
                    className="inline-flex w-fit max-w-full items-center gap-1.5 rounded-md border border-[#d9e0e7] bg-[#fafbfc] px-2 py-1 text-xs font-semibold text-[#526078] transition hover:border-[#A07C3B] hover:text-[#A07C3B]"
                    href={selectedRoomPath}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink aria-hidden="true" size={12} />
                    <span className="truncate">{selectedRoomUrl}</span>
                  </a>
                ) : null}
              </div>
            ) : (
              <input
                className="h-9 rounded-md border border-[#d9e0e7] bg-white px-3 text-sm text-[#101820] outline-none placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:bg-[#fafbfc] focus:ring-2 focus:ring-[#A07C3B]/20"
                onChange={(event) => setLocationAddress(event.target.value)}
                placeholder="Endereco presencial"
                required={locationMode === "offline"}
                value={locationAddress}
              />
            )}
          </div>
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-center gap-3">
          <CalendarClock aria-hidden="true" className="justify-self-center text-[#667085]" size={17} />
          <select
            className="h-9 rounded-md border border-transparent bg-white px-2 text-sm text-[#344054] outline-none transition hover:border-[#edf0f4] focus:border-[#A07C3B] focus:bg-[#fafbfc]"
            onChange={(event) => setProfileId(event.target.value)}
            value={selectedProfile.id}
          >
            {activeProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </select>
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
          <FileText aria-hidden="true" className="mt-2 justify-self-center text-[#667085]" size={17} />
          <textarea
            className="min-h-16 resize-none rounded-md border border-transparent bg-white p-2 text-sm outline-none transition hover:border-[#edf0f4] focus:border-[#A07C3B] focus:bg-[#fafbfc] focus:ring-2 focus:ring-[#A07C3B]/20"
            onChange={(event) => setObjective(event.target.value)}
            placeholder="Adicionar descricao"
            value={objective}
          />
        </div>

        <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
          <ListChecks aria-hidden="true" className="mt-2 justify-self-center text-[#667085]" size={17} />
          <div className="grid gap-2">
            <div className="flex items-start gap-2">
              <textarea
                className="min-h-16 flex-1 resize-none rounded-md border border-transparent bg-white p-2 text-sm outline-none transition hover:border-[#edf0f4] focus:border-[#A07C3B] focus:bg-[#fafbfc] focus:ring-2 focus:ring-[#A07C3B]/20"
                onChange={(event) => setAgenda(event.target.value)}
                placeholder="Adicionar pauta"
                value={agenda}
              />
              <button
                aria-label="Gerar pauta com Athena"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#d9e0e7] bg-white text-[#A07C3B] transition hover:bg-[#fff8ec] hover:text-[#7a5b24] focus-visible:ring-2 focus-visible:ring-[#A07C3B] disabled:cursor-wait disabled:opacity-55"
                disabled={agendaAgentLoading || saving || !title.trim()}
                onClick={() => {
                  setAgendaAgentError(null);
                  setAgendaAgentOpen(true);
                }}
                type="button"
              >
                {agendaAgentLoading ? (
                  <PanteonLoadingMark size="xs" />
                ) : (
                  <Bot aria-hidden="true" size={16} />
                )}
              </button>
            </div>
            {agendaAgentError ? (
              <span className="text-xs font-semibold text-red-600">
                {agendaAgentError}
              </span>
            ) : null}
          </div>
        </div>

        {showMoreOptions ? (
          <div className="grid gap-3 rounded-md border border-[#edf0f4] bg-[#fafbfc] p-3">
            <div className="grid grid-cols-[1.75rem_minmax(0,1fr)] items-start gap-3">
              <Repeat2
                aria-hidden="true"
                className="mt-2 justify-self-center text-[#667085]"
                size={17}
              />
              <div className="grid gap-2">
                <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
                  Repete
                  <select
                    className="h-9 rounded-md border border-[#d9e0e7] bg-white px-2 text-sm font-medium normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                    onChange={(event) =>
                      setRecurrenceMode(event.target.value as ChronosRecurrenceMode)
                    }
                    value={recurrenceMode}
                  >
                    {recurrenceOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                {recurrenceMode === "custom" ? (
                  <div className="grid gap-2 rounded-md border border-[#d9e0e7] bg-white p-2">
                    <div className="grid gap-2 sm:grid-cols-[5rem_minmax(0,1fr)]">
                      <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
                        A cada
                        <input
                          className="h-9 rounded-md border border-[#d9e0e7] px-2 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                          min={1}
                          onChange={(event) =>
                            setCustomRepeatInterval(event.target.value)
                          }
                          type="number"
                          value={customRepeatInterval}
                        />
                      </label>
                      <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
                        Frequencia
                        <select
                          className="h-9 rounded-md border border-[#d9e0e7] px-2 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                          onChange={(event) =>
                            setCustomRepeatFrequency(
                              event.target.value as ChronosCustomRecurrenceFrequency,
                            )
                          }
                          value={customRepeatFrequency}
                        >
                          <option value="daily">dia(s)</option>
                          <option value="weekly">semana(s)</option>
                          <option value="monthly">mes(es)</option>
                          <option value="yearly">ano(s)</option>
                        </select>
                      </label>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[8rem_minmax(0,1fr)]">
                      <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
                        Termina
                        <select
                          className="h-9 rounded-md border border-[#d9e0e7] px-2 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B]"
                          onChange={(event) =>
                            setCustomRepeatEnd(
                              event.target.value as ChronosCustomRecurrenceEnd,
                            )
                          }
                          value={customRepeatEnd}
                        >
                          <option value="never">Nunca</option>
                          <option value="on_date">Em uma data</option>
                        </select>
                      </label>
                      <label className="grid gap-1 text-[11px] font-bold uppercase text-[#667085]">
                        Ate
                        <input
                          className="h-9 rounded-md border border-[#d9e0e7] px-2 text-sm normal-case text-[#101820] outline-none focus:border-[#A07C3B] disabled:opacity-50"
                          disabled={customRepeatEnd !== "on_date"}
                          onChange={(event) => setCustomRepeatUntil(event.target.value)}
                          type="date"
                          value={customRepeatUntil}
                        />
                      </label>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>

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
                    onChange={(event) => setNotificationMinutes(event.target.value)}
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

      <div className="flex items-center justify-end gap-2 border-t border-[#edf0f4] pt-3">
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
        <button
          className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-[#101820] px-4 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-wait disabled:opacity-60"
          disabled={saving}
          type="submit"
        >
          {saving ? (
            <PanteonLoadingMark inverse size="xs" />
          ) : (
            <Save aria-hidden="true" size={15} />
          )}
          Salvar
        </button>
      </div>

      {agendaAgentOpen ? (
        <div className="absolute inset-0 z-20 grid place-items-center rounded-lg bg-white/75 px-4 backdrop-blur-sm">
          <div className="grid w-full max-w-md gap-3 rounded-lg border border-[#d9e0e7] bg-white p-4 shadow-[0_22px_70px_rgb(16_24_32_/_0.18)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="m-0 text-sm font-bold text-[#101820]">
                  Contexto para Athena
                </p>
                <p className="m-0 mt-1 text-xs font-semibold text-[#667085]">
                  Informe objetivo, decisoes esperadas, riscos ou publico.
                </p>
              </div>
              <button
                aria-label="Fechar contexto da pauta"
                className="grid h-8 w-8 place-items-center rounded-md text-[#667085] transition hover:bg-[#f5f7fa] hover:text-[#101820]"
                onClick={() => setAgendaAgentOpen(false)}
                type="button"
              >
                <X aria-hidden="true" size={16} />
              </button>
            </div>
            <textarea
              className="min-h-32 resize-y rounded-md border border-[#d9e0e7] bg-[#fafbfc] px-3 py-3 text-sm leading-5 text-[#101820] outline-none transition placeholder:text-[#98a2b3] focus:border-[#A07C3B] focus:ring-2 focus:ring-[#A07C3B]/20"
              onChange={(event) => setAgendaAgentContext(event.target.value)}
              placeholder="Ex.: alinhar cronograma, validar riscos comerciais, definir responsaveis e proximos passos..."
              value={agendaAgentContext}
            />
            <div className="flex items-center justify-end gap-2">
              <button
                className="h-9 rounded-md px-3 text-sm font-semibold text-[#526078] transition hover:bg-[#f5f7fa] hover:text-[#101820]"
                onClick={() => setAgendaAgentOpen(false)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md bg-[#101820] px-3 text-sm font-semibold text-white transition hover:bg-[#1f2937] disabled:cursor-wait disabled:opacity-55"
                disabled={agendaAgentLoading}
                onClick={() => void handleGenerateAgenda()}
                type="button"
              >
                {agendaAgentLoading ? (
                  <PanteonLoadingMark inverse size="xs" />
                ) : (
                  <Bot aria-hidden="true" size={15} />
                )}
                Gerar pauta
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </form>
  );
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

function formatExecutiveAgenda(title: string, bulletPoints: string[]) {
  return [
    `## ${title.trim() || "Pauta executiva"}`,
    "",
    ...bulletPoints.map((item) => `• ${item}`),
  ].join("\n");
}
