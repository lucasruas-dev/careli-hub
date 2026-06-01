"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Bot,
  Clock3,
  LockKeyhole,
  MessageCircle,
  Mic,
  Paperclip,
  Send,
  Smile,
  X,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightOpen,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import { normalizeAttendanceProtocol } from "@/modules/guardian/attendance/attendance-routing";
import {
  HadesWhatsAppComposerIconButton,
  HadesWhatsAppHeaderToolbarButton,
} from "@/modules/guardian/attendance/components/hades-whatsapp-action-buttons";
import { HadesWhatsAppClientContextPanel } from "@/modules/guardian/attendance/components/hades-whatsapp-client-context-panel";
import { HadesWhatsAppOperationalToolbar } from "@/modules/guardian/attendance/components/hades-whatsapp-operational-toolbar";
import { HadesWhatsAppOperationDrawer } from "@/modules/guardian/attendance/components/hades-whatsapp-operation-drawer";
import { HadesWhatsAppTicketChecklist } from "@/modules/guardian/attendance/components/hades-whatsapp-ticket-checklist";
import { HadesWhatsAppTicketCloseModal } from "@/modules/guardian/attendance/components/hades-whatsapp-ticket-close-modal";
import { HadesWhatsAppTicketSetupModal } from "@/modules/guardian/attendance/components/hades-whatsapp-ticket-setup-modal";
import {
  HadesWhatsAppMessageBubble,
  HadesWhatsAppTicketSeparator,
} from "@/modules/guardian/attendance/components/hades-whatsapp-thread-view";
import { HadesWhatsAppTemplateModal } from "@/modules/guardian/attendance/components/hades-whatsapp-template-modal";
import { findLatestAttendanceProtocol } from "@/modules/guardian/attendance/hades-whatsapp-protocol";
import {
  feedbackToneClassName,
  formatDateTime,
  formatTime,
  type FeedbackTone,
} from "@/modules/guardian/attendance/hades-whatsapp-formatters";
import {
  hadesCustomerServiceWindowLabel,
  mapHadesCustomerServiceWindow,
} from "@/modules/guardian/attendance/hades-customer-service-window";
import {
  buildConversationList,
  buildMessages,
  buildTicketCycles,
  firstName,
  type MessageKind,
  type WhatsAppMessage,
} from "@/modules/guardian/attendance/hades-whatsapp-thread";
import type {
  OperationDrawerMode,
  TicketChecklistItem,
  TicketOrigin,
  WhatsAppTicket,
} from "@/modules/guardian/attendance/hades-whatsapp-types";
import {
  buildInstallmentOptions,
  resolveRelatedInstallmentLabels,
} from "@/modules/guardian/attendance/iris-ticket-installments";
import {
  createsIrisSla,
  findPreferredQueueId,
  formatSlaMinutes,
  mapIrisPriority,
  mapIrisTicketOptions,
  requiresIrisInstallment,
  requiresIrisUnit,
  type IrisTicketOptions,
} from "@/modules/guardian/attendance/iris-ticket-options";
import type {
  OperationalTimelineEvent,
  QueueClient,
} from "@/modules/guardian/attendance/types";

const EMPTY_FIELD = "-";

type WhatsAppConversationPanelProps = {
  client: QueueClient;
  initialAttendanceProtocol?: string | null;
  initialOrigin?: TicketOrigin;
  onClose: () => void;
  onTimelineEvent: (clientId: string, event: OperationalTimelineEvent) => void;
  open: boolean;
};

export function WhatsAppConversationPanel({
  client,
  initialAttendanceProtocol,
  initialOrigin = "Careli iniciou",
  onClose,
  onTimelineEvent,
  open,
}: WhatsAppConversationPanelProps) {
  const linkedAttendanceProtocol =
    normalizeAttendanceProtocol(initialAttendanceProtocol) ??
    findLatestAttendanceProtocol(client);
  const [selectedUnitId, setSelectedUnitId] = useState(client.carteira.unidades[0]?.id ?? "");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [operationDrawer, setOperationDrawer] = useState<OperationDrawerMode | null>(null);
  const [ticketSetupOpen, setTicketSetupOpen] = useState(initialOrigin === "Careli iniciou");
  const [ticketIncomplete, setTicketIncomplete] = useState(initialOrigin === "Cliente iniciou");
  const [ticketCloseOpen, setTicketCloseOpen] = useState(false);
  const [ticket, setTicket] = useState<WhatsAppTicket>({
    attendanceProtocol: linkedAttendanceProtocol ?? undefined,
    protocol: linkedAttendanceProtocol ?? EMPTY_FIELD,
    origin: initialOrigin,
    profileId: "",
    profileName: EMPTY_FIELD,
    profileCategory: EMPTY_FIELD,
    priority: EMPTY_FIELD,
    slaHours: 0,
    relatedInstallments: [],
    status: initialOrigin === "Cliente iniciou" ? "Aguardando operador" : "Pendente",
  });
  const [feedback, setFeedback] = useState("");
  const [feedbackTone, setFeedbackTone] = useState<FeedbackTone>("success");
  const [draft, setDraft] = useState("");
  const [showPreviousTickets, setShowPreviousTickets] = useState(false);
  const [conversationListCollapsed, setConversationListCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [messages, setMessages] = useState<WhatsAppMessage[]>(() => buildMessages(client));
  const [irisTicketOptions, setIrisTicketOptions] = useState<IrisTicketOptions>({
    channels: [],
    operator: { label: EMPTY_FIELD },
    profiles: [],
    queues: [],
    templates: [],
  });
  const [irisOptionsLoading, setIrisOptionsLoading] = useState(false);
  const [irisOptionsError, setIrisOptionsError] = useState("");
  const [sendingMessage, setSendingMessage] = useState(false);
  const autoTicketLoggedRef = useRef(false);

  const selectedUnit =
    client.carteira.unidades.find((unit) => unit.id === selectedUnitId) ?? client.carteira.unidades[0];
  const conversations = useMemo(() => buildConversationList(client), [client]);
  const ticketCycles = useMemo(
    () => buildTicketCycles(client, ticket, selectedUnit),
    [client, selectedUnit, ticket]
  );
  const currentTicketCycle = ticketCycles.find((cycle) => cycle.protocol === ticket.protocol) ?? ticketCycles[ticketCycles.length - 1];
  const previousTicketCycles = ticketCycles.filter((cycle) => cycle.protocol !== ticket.protocol);
  const visiblePreviousTicketCycles = previousTicketCycles.slice(-5);
  const archivedTicketCount = Math.max(previousTicketCycles.length - visiblePreviousTicketCycles.length, 0);
  const irisTicketProfiles = irisTicketOptions.profiles;
  const irisWhatsAppChannels = irisTicketOptions.channels;
  const irisCollectionQueueId = findPreferredQueueId(irisTicketOptions.queues, irisTicketProfiles);
  const irisCollectionSubjects = irisCollectionQueueId
    ? irisTicketProfiles.filter((profile) => profile.queueId === irisCollectionQueueId)
    : irisTicketProfiles;
  const irisCollectionSubjectOptions = irisCollectionSubjects.length
    ? irisCollectionSubjects
    : irisTicketProfiles;
  const operatorLabel = irisTicketOptions.operator.label || client.responsavel;

  const ticketClosed = ticket.status === "Encerrado" || ticket.status === "Cancelado";
  const ticketActive = ticket.status !== "Pendente" && !ticketClosed;
  const currentTicketProfile = irisTicketProfiles.find((profile) => profile.id === ticket.profileId);
  const ticketSubjectProfiles =
    currentTicketProfile && !irisCollectionSubjectOptions.some((profile) => profile.id === currentTicketProfile.id)
      ? [currentTicketProfile, ...irisCollectionSubjectOptions]
      : irisCollectionSubjectOptions;
  const ticketChecklist: TicketChecklistItem[] = [
    { id: "profile", label: "Assunto", ok: Boolean(ticket.profileId && ticket.profileName) },
    { id: "unit", label: "Unidade", ok: !requiresIrisUnit(currentTicketProfile) || Boolean(selectedUnitId) },
    {
      id: "installments",
      label: "Parcelas",
      ok: !requiresIrisInstallment(currentTicketProfile) || ticket.relatedInstallments.length > 0,
      warning: Boolean(requiresIrisInstallment(currentTicketProfile) && ticket.relatedInstallments.length === 0),
    },
    { id: "priority", label: "Prioridade", ok: Boolean(ticket.priority) },
    { id: "sla", label: "SLA", ok: !createsIrisSla(currentTicketProfile) || ticket.slaHours > 0 },
  ];
  const operationReady = ticketActive && !ticketIncomplete && ticketChecklist.every((item) => item.ok);
  const blockedTooltip = "Complete o ticket para iniciar o atendimento.";
  const customerServiceWindow = ticket.customerServiceWindow ?? null;
  const customerServiceWindowLabel = customerServiceWindow
    ? hadesCustomerServiceWindowLabel(customerServiceWindow)
    : null;
  const customerServiceWindowClosed = Boolean(customerServiceWindow && !customerServiceWindow.open);
  const sendMessageTooltip = !operationReady
    ? blockedTooltip
    : customerServiceWindowClosed
      ? "Janela WhatsApp fechada. A Iris verificara antes do envio."
      : "Enviar mensagem";
  const feedbackClassName = feedbackToneClassName(feedbackTone);

  useEffect(() => {
    if (initialOrigin !== "Cliente iniciou" || autoTicketLoggedRef.current) return;
    autoTicketLoggedRef.current = true;

    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: `${client.id}-whatsapp-ticket-auto-created`,
      protocol: ticket.protocol,
      type: "Observação operacional",
      title: "Ticket criado automaticamente",
      description: `Ticket ${ticket.protocol} criado automaticamente por mensagem recebida do cliente. Origem: Cliente iniciou.`,
      occurredAt: "11/05/2026 12:28",
      operator: client.responsavel,
      status: "Registrado",
      unitCode: selectedUnit?.matricula,
      unitLabel: selectedUnit?.unidadeLote,
    });
    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: `${client.id}-whatsapp-ticket-assumed`,
      protocol: ticket.protocol,
      type: "Observação operacional",
      title: "Operador assumiu atendimento",
      description: `Operador abriu o Ticket ${ticket.protocol} no Iris para tratar mensagem recebida do cliente.`,
      occurredAt: "11/05/2026 12:30",
      operator: client.responsavel,
      status: "Registrado",
      unitCode: selectedUnit?.matricula,
      unitLabel: selectedUnit?.unidadeLote,
    });
  }, [client.id, client.responsavel, initialOrigin, onTimelineEvent, selectedUnit?.matricula, selectedUnit?.unidadeLote, ticket.protocol]);

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function loadIrisTicketOptions() {
      setIrisOptionsLoading(true);
      setIrisOptionsError("");

      try {
        const accessToken = await getIrisAccessToken();
        const response = await fetch("/api/iris/tickets", {
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        const payload = await response.json().catch(() => null);

        if (cancelled) return;

        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Nao foi possivel carregar a estrutura real da Iris.",
          );
        }

        setIrisTicketOptions(mapIrisTicketOptions(payload));
      } catch (error) {
        if (!cancelled) {
          setIrisOptionsError(
            error instanceof Error
              ? error.message
              : "Nao foi possivel carregar a estrutura real da Iris.",
          );
          setIrisTicketOptions({
            channels: [],
            operator: { label: EMPTY_FIELD },
            profiles: [],
            queues: [],
            templates: [],
          });
        }
      } finally {
        if (!cancelled) {
          setIrisOptionsLoading(false);
        }
      }
    }

    void loadIrisTicketOptions();

    return () => {
      cancelled = true;
    };
  }, [open]);

  function showFeedback(message: string, tone: FeedbackTone = "success") {
    setFeedbackTone(tone);
    setFeedback(message);
  }

  if (!open) return null;

  async function openTicket(
    profileId: string,
    unitIds: string[] = [],
    relatedInstallments: string[] = [],
    options: { channelId?: string; initialNote?: string; queueId?: string; templateId?: string } = {}
  ) {
    const selectedUnitIds = unitIds.length ? unitIds : selectedUnitId ? [selectedUnitId] : [];
    if (selectedUnitIds[0]) setSelectedUnitId(selectedUnitIds[0]);
    const selectedUnits = selectedUnitIds
      .map((unitId) => client.carteira.unidades.find((item) => item.id === unitId))
      .filter(Boolean);
    const relatedInstallmentLabels = resolveRelatedInstallmentLabels(
      client,
      selectedUnitIds,
      relatedInstallments,
    );
    const primaryUnit = selectedUnits[0] ?? selectedUnit;
    const profile = irisTicketProfiles.find((item) => item.id === profileId) ?? irisTicketProfiles[0];
    const channel =
      irisWhatsAppChannels.find((item) => item.id === options.channelId) ??
      irisWhatsAppChannels[0];
    const template =
      irisTicketOptions.templates.find((item) => item.id === options.templateId) ??
      irisTicketOptions.templates[0];

    if (!profile) {
      throw new Error("Selecione um assunto real da Iris para abrir o ticket.");
    }

    if (!channel?.id) {
      throw new Error("Canal WhatsApp da Iris nao localizado.");
    }

    if (!template?.id) {
      throw new Error("Selecione um template Meta aprovado na Iris.");
    }

    const completingAutoTicket = ticketIncomplete;
    const existingAttendanceProtocol =
      normalizeAttendanceProtocol(ticket.attendanceProtocol) ??
      normalizeAttendanceProtocol(ticket.protocol) ??
      linkedAttendanceProtocol;
    const response = await fetch("/api/iris/tickets", {
      body: JSON.stringify({
        channelId: channel.id,
        contactName: client.nome,
        firstName: firstName(client.nome),
        linkedAttendanceProtocol: existingAttendanceProtocol,
        metadata: {
          attendanceProtocol: existingAttendanceProtocol,
          hadesClientId: client.id,
          linkedAttendanceProtocol: existingAttendanceProtocol,
          relatedInstallmentLabels,
          relatedInstallments,
          selectedUnitIds,
          unitCodes: selectedUnits.map((unit) => unit?.matricula).filter(Boolean),
          unitLabels: selectedUnits.map((unit) => unit?.unidadeLote).filter(Boolean),
        },
        phone: client.dados360.telefone,
        profileId: profile.id,
        queueId: options.queueId ?? profile.queueId,
        sendTemplate: !completingAutoTicket,
        sourceContext: {
          clientDocument: client.cpf,
          clientId: client.id,
          enterprise: primaryUnit?.empreendimento ?? client.carteira.empreendimento,
          linkedAttendanceProtocol: existingAttendanceProtocol,
          initialNote: options.initialNote?.trim() || null,
          relatedInstallmentLabels,
          relatedInstallments,
          selectedUnitIds,
          unitCodes: selectedUnits.map((unit) => unit?.matricula).filter(Boolean),
          unitLabels: selectedUnits.map((unit) => unit?.unidadeLote).filter(Boolean),
        },
        sourceEntityId: client.c2xAcquisitionRequestId ?? client.id,
        sourceEntityType: "hades-collection-client",
        sourceModule: "hades",
        subject: profile.name,
        templateId: template.id,
        templateLanguage: template.language,
        templateName: template.templateName,
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${await getIrisAccessToken()}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ticket?.id) {
      throw new Error(
        payload?.error ?? "Nao foi possivel abrir o ticket pela Iris.",
      );
    }

    const openedAt = payload.ticket.opened_at
      ? formatDateTime(payload.ticket.opened_at)
      : formatDateTime(new Date().toISOString());
    const attendanceProtocol = payload.ticket.protocol ?? EMPTY_FIELD;
    const collectionProtocol = payload.collectionProtocol ?? attendanceProtocol;

    setTicket((current) => ({
      ...current,
      attendanceProtocol,
      collectionProtocol,
      customerServiceWindow: mapHadesCustomerServiceWindow(payload.customerServiceWindow),
      irisMessageId: payload.messageId,
      irisTicketId: payload.ticket.id,
      origin: current.origin,
      profileId: profile.id,
      profileName: profile.name,
      profileCategory: profile.category,
      priority: mapIrisPriority(profile.priority),
      protocol: collectionProtocol,
      slaHours: Math.max(Math.ceil(profile.slaFirstResponseMinutes / 60), 1),
      relatedInstallments,
      status: "Aguardando cliente",
      openedAt,
    }));
    setTicketSetupOpen(false);
    setTicketIncomplete(false);
    showFeedback(`Cobranca ${collectionProtocol} vinculada ao atendimento ${attendanceProtocol} na Iris.`);
    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: completingAutoTicket ? `${client.id}-whatsapp-ticket-completed` : `${client.id}-whatsapp-ticket-open`,
      protocol: collectionProtocol,
      type: "Observação operacional",
      title: completingAutoTicket ? "Dados do ticket completados na Iris" : "Ticket WhatsApp iniciado pela Iris",
      description: completingAutoTicket
        ? `Dados obrigatórios da cobranca ${collectionProtocol} completados pelo operador via Iris. Atendimento raiz: ${attendanceProtocol}. Assunto: ${profile.name}.`
        : `Cobranca ${collectionProtocol} iniciada pelo Hades via Iris/Meta e vinculada ao atendimento ${attendanceProtocol}. Assunto: ${profile.name}, prioridade ${mapIrisPriority(profile.priority)} e SLA ${formatSlaMinutes(profile.slaFirstResponseMinutes)}.`,
      occurredAt: openedAt,
      operator: operatorLabel,
      status: "Registrado",
      unitCode: selectedUnits.map((unit) => unit?.matricula).filter(Boolean).join(", "),
      unitLabel: selectedUnits.map((unit) => unit?.unidadeLote).filter(Boolean).join(", "),
    });
  }

  function changeTicketProfile(profileId: string) {
    const profile = irisTicketProfiles.find((item) => item.id === profileId);
    if (!profile || profile.id === ticket.profileId || !ticketActive) return;

    setTicket((current) => ({
      ...current,
      profileId: profile.id,
      profileName: profile.name,
      profileCategory: profile.category,
      priority: mapIrisPriority(profile.priority),
      slaHours: Math.max(Math.ceil(profile.slaFirstResponseMinutes / 60), 1),
      relatedInstallments:
        requiresIrisInstallment(profile) && current.relatedInstallments.length === 0
          ? buildInstallmentOptions(client, selectedUnitId ? [selectedUnitId] : []).slice(0, 1).map((item) => item.value)
          : current.relatedInstallments,
    }));
    showFeedback(`Assunto do ticket alterado para ${profile.name}. Historico operacional atualizado.`);
    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: `${client.id}-whatsapp-ticket-profile-${profile.id}`,
      protocol: ticket.protocol,
      type: "Observação operacional",
      title: "Assunto do ticket alterado",
      description: `Assunto do Ticket ${ticket.protocol} alterado para ${profile.name}. Prioridade padrao ${mapIrisPriority(profile.priority)}, SLA ${formatSlaMinutes(profile.slaFirstResponseMinutes)}.`,
      occurredAt: "11/05/2026 12:42",
      operator: operatorLabel,
      status: "Registrado",
      unitCode: selectedUnit?.matricula,
      unitLabel: selectedUnit?.unidadeLote,
    });
  }

  function closeTicket(result: string, nextStep: string, finalNote: string) {
    setTicket((current) => ({
      ...current,
      closedAt: "11/05/2026 12:58",
      duration: "28 min",
      finalNote,
      nextStep,
      result,
      status: "Encerrado",
    }));
    setTicketCloseOpen(false);
    showFeedback(`Ticket ${ticket.protocol} encerrado e registrado no historico operacional.`);
    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: `${client.id}-whatsapp-ticket-closed`,
      protocol: ticket.protocol,
      type: "Observação operacional",
      title: "Ticket WhatsApp encerrado",
      description: `Resultado: ${result}. Próximo passo: ${nextStep}. ${finalNote}`,
      occurredAt: "11/05/2026 12:58",
      operator: client.responsavel,
      status: "Registrado",
      unitCode: selectedUnit?.matricula,
      unitLabel: selectedUnit?.unidadeLote,
    });
  }

  async function sendMessage(kind: MessageKind = "text") {
    if (!operationReady || sendingMessage) return;
    const body = draft.trim();
    if (kind === "text" && !body) return;
    if (kind !== "text") {
      showFeedback("Envio de audio e documento deve ser conduzido pela Iris no ticket real.", "warning");
      return;
    }
    if (!ticket.irisTicketId) {
      showFeedback("Abra o ticket pela Iris antes de enviar mensagens externas.", "warning");
      return;
    }

    const nextIndex = messages.length + 1;
    setSendingMessage(true);

    try {
      const response = await fetch("/api/iris/meta/messages", {
        body: JSON.stringify({
          body,
          ticketId: ticket.irisTicketId,
          to: client.dados360.telefone,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${await getIrisAccessToken()}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = await response.json().catch(() => null);
      const nextCustomerServiceWindow = mapHadesCustomerServiceWindow(
        payload?.customerServiceWindow,
      );

      if (nextCustomerServiceWindow) {
        setTicket((current) => ({
          ...current,
          customerServiceWindow: nextCustomerServiceWindow,
        }));
      }

      if (!response.ok) {
        showFeedback(
          payload?.error ?? "Nao foi possivel enviar a mensagem pela Iris.",
          response.status === 409 ? "warning" : "error",
        );
        return;
      }

      const message: WhatsAppMessage = {
        id: payload?.message?.id ?? `${client.id}-sent-${nextIndex}`,
        author: "operator",
        body,
        date: "Hoje",
        kind: "text",
        operator: operatorLabel,
        status: "enviada",
        ticketProtocol: ticket.protocol,
        time: formatTime(new Date().toISOString()),
      };

      setMessages((current) => [...current, message]);
      setDraft("");
      onTimelineEvent(client.id, {
        actionType: "Mensagem WhatsApp",
        id: `${client.id}-whatsapp-live-${nextIndex}`,
        protocol: ticket.protocol,
        type: "WhatsApp enviado",
        title: "Mensagem WhatsApp enviada",
        description: `Operador enviou mensagem pelo ticket Iris ${ticket.protocol}: ${message.body}`,
        occurredAt: formatDateTime(new Date().toISOString()),
        operator: operatorLabel,
        unitCode: selectedUnit?.matricula,
        unitLabel: selectedUnit?.unidadeLote,
        status: "Enviado",
      });
      showFeedback("Mensagem enviada pelo WhatsApp via Iris.");
    } catch (error) {
      showFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel enviar a mensagem pela Iris.",
        "error",
      );
    } finally {
      setSendingMessage(false);
    }
  }

  function handleOperationSaved(mode: OperationDrawerMode, event: OperationalTimelineEvent) {
    onTimelineEvent(client.id, event);
    setOperationDrawer(null);
    if (mode === "promise") {
      setTicket((current) => ({ ...current, status: "Convertido em promessa" }));
    }
    if (mode === "agreement") {
      setTicket((current) => ({ ...current, status: "Convertido em acordo" }));
    }
    showFeedback(
      mode === "promise"
        ? "Promessa registrada. Timeline atualizada e Workflow sinalizado como Promessa realizada."
        : mode === "agreement"
          ? "Acordo registrado. Timeline atualizada e Workflow sinalizado como Em negociação."
          : mode === "boleto"
            ? "Boleto C2X enviado. Timeline atualizada com protocolo e parcela relacionada."
            : "Parcelas consultadas. Timeline atualizada com protocolo e unidade relacionada."
    );
  }

  function openOperation(mode: OperationDrawerMode) {
    if (!operationReady) return;
    setOperationDrawer(mode);
  }

  return (
    <section className="relative flex h-[calc(100vh-112px)] min-h-0 w-full overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <aside
          className={`hidden shrink-0 border-r border-slate-100 bg-slate-50/70 transition-all duration-300 lg:flex lg:flex-col ${
            conversationListCollapsed ? "w-14" : "w-72"
          }`}
        >
          <div className={`${conversationListCollapsed ? "p-2" : "border-b border-slate-100 p-3"}`}>
            {conversationListCollapsed ? (
              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={() => setConversationListCollapsed(false)}
                  className="flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                  aria-label="Expandir lista de conversas"
                >
                  <PanelLeftOpen className="size-4" aria-hidden="true" />
                </button>
                <div className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                  <MessageCircle className="size-4" aria-hidden="true" />
                </div>
                <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                  {conversations.length}
                </span>
              </div>
            ) : (
              <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Inbox WhatsApp</p>
                <h2 className="mt-1 text-sm font-semibold text-slate-950">Conversas</h2>
              </div>
              <button
                type="button"
                onClick={() => setConversationListCollapsed(true)}
                className="flex size-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white hover:text-[#7A5E2C]"
                aria-label="Recolher lista de conversas"
              >
                <PanelLeftClose className="size-4" aria-hidden="true" />
              </button>
            </div>
            <div className="mt-3 rounded-lg border border-slate-200/70 bg-white px-3 py-1.5">
              <input
                aria-label="Buscar conversa"
                placeholder="Buscar conversa..."
                className="h-7 w-full bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
            <div className="mt-2 grid grid-cols-3 gap-1 rounded-lg bg-slate-100/70 p-1">
              {["Abertas", "Pendentes", "Encerradas"].map((filter, index) => (
                <button
                  key={filter}
                  type="button"
                  className={`h-7 rounded-md text-[11px] font-semibold transition-colors ${
                    index === 0 ? "bg-white text-[#7A5E2C] shadow-sm" : "text-slate-500 hover:bg-white/70"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
              </>
            )}
          </div>

          {!conversationListCollapsed ? (
          <div className="min-h-0 flex-1 overflow-y-auto p-2.5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`mb-2 w-full rounded-lg border px-3 py-2.5 text-left transition-colors ${
                  conversation.id === client.id
                    ? "border-[#A07C3B]/25 bg-[#A07C3B]/5"
                    : "border-slate-200/70 bg-white hover:bg-slate-50"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-950">{conversation.name}</p>
                  <span className="text-[11px] text-slate-400">{conversation.time}</span>
                </div>
                <p className="mt-1 line-clamp-1 text-xs text-slate-500">{conversation.preview}</p>
              </button>
            ))}
          </div>
          ) : null}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="shrink-0 border-b border-slate-100 bg-white">
            <div className="flex flex-col gap-2 px-4 py-2.5 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
                  <MessageCircle className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-slate-950">{client.nome}</h2>
                  <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs font-medium text-slate-500">
                    <span>{ticket.protocol}</span>
                    <span aria-hidden="true">•</span>
                    <span>{ticket.status}</span>
                    {ticketIncomplete ? (
                      <>
                        <span aria-hidden="true">•</span>
                        <Tooltip content="Ticket criado automaticamente após mensagem recebida." placement="bottom">
                          <span className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                            ? Autoaberto
                          </span>
                        </Tooltip>
                      </>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
                {ticketActive ? (
                  <label className="inline-flex h-9 max-w-full items-center gap-2 rounded-lg border border-slate-200/70 bg-slate-50/70 px-2 text-xs font-semibold text-slate-600">
                    <span className="shrink-0">Assunto</span>
                    <select
                      value={ticket.profileId}
                      onChange={(event) => changeTicketProfile(event.target.value)}
                      className="h-6 max-w-52 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                    >
                      {ticketSubjectProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="flex w-fit items-center gap-1 rounded-lg border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <HadesWhatsAppHeaderToolbarButton icon={ArrowLeft} label="Voltar para atendimento" onClick={onClose} />
                  {ticketActive ? (
                    <HadesWhatsAppHeaderToolbarButton icon={X} label="Encerrar atendimento" onClick={() => setTicketCloseOpen(true)} />
                  ) : ticketClosed ? (
                    <HadesWhatsAppHeaderToolbarButton
                      icon={MessageCircle}
                      label="Abrir novo ticket"
                      onClick={() => {
                        setTicket({
                          protocol: EMPTY_FIELD,
                          origin: "Careli iniciou",
                          profileId: "",
                          profileName: EMPTY_FIELD,
                          profileCategory: EMPTY_FIELD,
                          priority: "Média",
                          slaHours: 0,
                          relatedInstallments: [],
                          customerServiceWindow: null,
                          status: "Pendente",
                        });
                        setTicketSetupOpen(true);
                      }}
                    />
                  ) : null}
                  <HadesWhatsAppHeaderToolbarButton icon={Minimize2} label="Minimizar" onClick={() => undefined} />
                </div>
              </div>
            </div>
          </header>

          {feedback ? (
            <div className={`mx-4 mt-3 rounded-xl border px-3 py-2 text-sm font-medium ${feedbackClassName}`}>
              {feedback}
            </div>
          ) : null}

          <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/40 px-4 py-4 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            <div className="mx-auto max-w-5xl space-y-4">
              {visiblePreviousTicketCycles.length > 0 ? (
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowPreviousTickets((current) => !current)}
                    className="inline-flex h-9 items-center rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
                  >
                    {showPreviousTickets
                      ? "Ocultar tickets anteriores"
                      : `Ver tickets anteriores (${visiblePreviousTicketCycles.length})`}
                  </button>
                  {archivedTicketCount > 0 && showPreviousTickets ? (
                    <span className="text-[11px] font-medium text-slate-400">
                      Histórico completo preparado para paginação futura
                    </span>
                  ) : null}
                </div>
              ) : null}

              <div
                className={`grid transition-all duration-300 ease-out ${
                  showPreviousTickets ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                }`}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="space-y-4 pb-2">
                    {visiblePreviousTicketCycles.map((cycle) => {
                      const cycleMessages = messages.filter((message) => message.ticketProtocol === cycle.protocol);

                      return (
                        <div key={cycle.protocol} className="space-y-4">
                          <HadesWhatsAppTicketSeparator cycle={cycle} compact />
                          {cycleMessages.map((message, index) => (
                            <HadesWhatsAppMessageBubble
                              key={message.id}
                              message={message}
                              showDate={index > 0 && message.date !== cycleMessages[index - 1]?.date}
                            />
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {currentTicketCycle ? (() => {
                const cycle = currentTicketCycle;
                const cycleMessages = messages.filter((message) => message.ticketProtocol === cycle.protocol);

                return (
                  <div key={cycle.protocol} className="space-y-4">
                    <HadesWhatsAppTicketSeparator cycle={cycle} />
                    {cycleMessages.map((message, index) => (
                      <HadesWhatsAppMessageBubble
                        key={message.id}
                        message={message}
                        showDate={index > 0 && message.date !== cycleMessages[index - 1]?.date}
                      />
                    ))}
                  </div>
                );
              })() : null}
            </div>
          </div>

          <footer className="shrink-0 border-t border-slate-100 bg-white p-2.5">
            {!operationReady ? (
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  <span>? Complete o ticket para iniciar o atendimento</span>
                </div>
                <HadesWhatsAppTicketChecklist items={ticketChecklist} />
              </div>
            ) : null}

            {operationReady && customerServiceWindowLabel ? (
              <div
                className={`mb-2 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold ${
                  customerServiceWindow?.open
                    ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                {customerServiceWindow?.open ? (
                  <Clock3 className="size-3.5 shrink-0" aria-hidden="true" />
                ) : (
                  <LockKeyhole className="size-3.5 shrink-0" aria-hidden="true" />
                )}
                <span className="min-w-0">{customerServiceWindowLabel}</span>
              </div>
            ) : null}

            <div className="mb-2 flex items-center justify-between gap-2">
              <HadesWhatsAppOperationalToolbar
                disabled={!operationReady}
                disabledTooltip={blockedTooltip}
                onOpenOperation={openOperation}
                onUseTemplate={() => {
                  if (operationReady) setTemplateOpen(true);
                }}
              />
              {operationReady ? <HadesWhatsAppTicketChecklist items={ticketChecklist} compact /> : null}
            </div>

            <div className={`flex items-end gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-2 transition-opacity ${operationReady ? "opacity-100" : "opacity-55"}`}>
              <HadesWhatsAppComposerIconButton disabled={!operationReady || sendingMessage} label="Emoji" onClick={() => setDraft((current) => `${current}??`)}>
                <Smile className="size-4" aria-hidden="true" />
              </HadesWhatsAppComposerIconButton>
              <HadesWhatsAppComposerIconButton disabled={!operationReady || sendingMessage} label="Anexar arquivo" onClick={() => sendMessage("document")}>
                <Paperclip className="size-4" aria-hidden="true" />
              </HadesWhatsAppComposerIconButton>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={operationReady ? "Escrever mensagem WhatsApp..." : "Ticket incompleto"}
                disabled={!operationReady || sendingMessage}
                className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <HadesWhatsAppComposerIconButton disabled={!operationReady || sendingMessage} label="Enviar áudio" onClick={() => sendMessage("audio")}>
                <Mic className="size-4" aria-hidden="true" />
              </HadesWhatsAppComposerIconButton>
              <Tooltip content={sendMessageTooltip} placement="top">
                <button
                  type="button"
                  disabled={!operationReady || sendingMessage}
                  onClick={() => sendMessage("text")}
                  className={`flex size-10 shrink-0 items-center justify-center rounded-xl text-white transition-colors disabled:cursor-not-allowed disabled:bg-slate-300 ${
                    customerServiceWindowClosed
                      ? "bg-amber-600 hover:bg-amber-700"
                      : "bg-[#A07C3B] hover:bg-[#8E6F35]"
                  }`}
                  aria-label={sendMessageTooltip}
                >
                  <Send className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          </footer>
        </main>

        <aside
          className={`hidden shrink-0 border-l border-slate-100 bg-white transition-all duration-300 xl:block ${
            contextCollapsed ? "w-14" : "w-[380px]"
          }`}
        >
          {contextCollapsed ? (
            <div className="flex h-full flex-col items-center gap-3 p-2">
              <Tooltip content="Expandir contexto" placement="left">
                <button
                  type="button"
                  onClick={() => setContextCollapsed(false)}
                  className="flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                  aria-label="Expandir contexto"
                >
                  <PanelRightOpen className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
              <div className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                <Bot className="size-4" aria-hidden="true" />
              </div>
            </div>
          ) : (
            <HadesWhatsAppClientContextPanel
              client={client}
              onCollapse={() => setContextCollapsed(true)}
              onCompleteTicket={() => setTicketSetupOpen(true)}
              onOpenOperation={openOperation}
              onSelectUnit={setSelectedUnitId}
              onUseTemplate={() => {
                if (operationReady) setTemplateOpen(true);
              }}
              operationReady={operationReady}
              previousTickets={visiblePreviousTicketCycles}
              selectedUnit={selectedUnit}
              selectedUnitId={selectedUnit?.id}
              ticketChecklist={ticketChecklist}
              ticket={ticket}
              ticketIncomplete={ticketIncomplete}
            />
          )}
        </aside>

      {templateOpen ? (
        <HadesWhatsAppTemplateModal
          onClose={() => setTemplateOpen(false)}
          onSelect={(body) => {
            setDraft(body);
            setTemplateOpen(false);
          }}
        />
      ) : null}

      {operationDrawer && operationReady ? (
        <HadesWhatsAppOperationDrawer
          client={client}
          mode={operationDrawer}
          onClose={() => setOperationDrawer(null)}
          onSaved={handleOperationSaved}
          selectedUnit={selectedUnit}
          ticket={ticket}
        />
      ) : null}

      {ticketSetupOpen ? (
        <HadesWhatsAppTicketSetupModal
          channels={irisWhatsAppChannels}
          client={client}
          defaultProfileId={ticket.profileId}
          error={irisOptionsError}
          loading={irisOptionsLoading}
          mode={ticketIncomplete ? "complete" : "open"}
          onClose={() => {
            if (ticketIncomplete) {
              setTicketSetupOpen(false);
              return;
            }

            onClose();
          }}
          onOpenTicket={openTicket}
          operatorLabel={operatorLabel}
          profiles={irisTicketProfiles}
          queues={irisTicketOptions.queues}
          linkedAttendanceProtocol={linkedAttendanceProtocol}
          selectedUnitId={selectedUnit?.id}
          templates={irisTicketOptions.templates}
        />
      ) : null}

      {ticketCloseOpen ? (
        <HadesWhatsAppTicketCloseModal
          onClose={() => setTicketCloseOpen(false)}
          onSubmit={closeTicket}
          ticket={ticket}
        />
      ) : null}
    </section>
  );
}

async function getIrisAccessToken() {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const sessionResult = await client.auth.getSession();
  const accessToken = sessionResult.data.session?.access_token;

  if (sessionResult.error || !accessToken) {
    throw new Error("Sessao administrativa ausente.");
  }

  return accessToken;
}
