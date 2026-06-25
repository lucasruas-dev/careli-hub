/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Bot,
  CalendarCheck,
  Check,
  CheckCheck,
  Clock3,
  FileText,
  HandCoins,
  LockKeyhole,
  MessageCircle,
  Mic,
  Paperclip,
  Send,
  Smile,
  Sparkles,
  X,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  OperationalTimelineEvent,
  PortfolioUnit,
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

type MessageStatus = "enviada" | "entregue" | "lida";
type MessageKind = "text" | "audio" | "document";
type OperationDrawerMode = "promise" | "agreement" | "boleto" | "installments";
type ContextTab = "info" | "actions" | "ai" | "history";
type TicketOrigin = "Cliente iniciou" | "Careli iniciou";
type HadesTicketPriority = "Crítica" | "Alta" | "Média" | "Baixa";
type IrisTicketPriority = "low" | "medium" | "high" | "critical";
type IrisTicketProfileOption = {
  category: string;
  description?: string | null;
  id: string;
  name: string;
  priority: IrisTicketPriority;
  queueId?: string | null;
  queueLabel?: string | null;
  requiredFields: string[];
  slaFirstResponseMinutes: number;
  slaResolutionMinutes: number;
  slug: string;
  status: string;
};
type IrisTicketChannelOption = {
  id: string;
  kind?: string | null;
  name: string;
  provider?: string | null;
  slug?: string | null;
  status: string;
};
type IrisTicketQueueOption = {
  defaultPriority: IrisTicketPriority;
  id: string;
  name: string;
  slug: string;
  status: string;
};
type IrisTicketTemplateOption = {
  body?: string | null;
  category?: string | null;
  id: string;
  language: string;
  metaStatus: string;
  name: string;
  slug?: string | null;
  templateName: string;
};
type IrisTicketOptions = {
  channels: IrisTicketChannelOption[];
  operator: {
    avatarUrl?: string | null;
    label: string;
  };
  profiles: IrisTicketProfileOption[];
  queues: IrisTicketQueueOption[];
  templates: IrisTicketTemplateOption[];
};
type TicketStatus =
  | "Pendente"
  | "Aguardando operador"
  | "Em atendimento"
  | "Aguardando cliente"
  | "Aguardando pagamento"
  | "Convertido em promessa"
  | "Convertido em acordo"
  | "Encerrado"
  | "Cancelado";

type WhatsAppTicket = {
  attendanceProtocol?: string;
  collectionProtocol?: string;
  irisMessageId?: string;
  irisTicketId?: string;
  protocol: string;
  origin: TicketOrigin;
  profileId: string;
  profileName: string;
  profileCategory: string;
  priority: HadesTicketPriority;
  slaHours: number;
  relatedInstallments: string[];
  status: TicketStatus;
  openedAt?: string;
  closedAt?: string;
  duration?: string;
  result?: string;
  nextStep?: string;
  finalNote?: string;
};

type WhatsAppMessage = {
  id: string;
  author: "client" | "operator";
  body: string;
  date: string;
  duration?: string;
  fileName?: string;
  kind: MessageKind;
  operator?: string;
  status?: MessageStatus;
  ticketProtocol: string;
  time: string;
};

type TicketCycle = {
  protocol: string;
  profileName: string;
  operator: string;
  openedAt: string;
  status: TicketStatus;
  unitCode?: string;
  unitLabel?: string;
};

type TicketChecklistItem = {
  id: string;
  label: string;
  ok: boolean;
  warning?: boolean;
};

type C2xBoleto = {
  id: string;
  parcela: string;
  vencimento: string;
  valor: string;
  status: "Aberto" | "Vencido" | "Pago";
  linhaDigitavel: string;
};

const templates = [
  {
    id: "friendly",
    title: "Cobrança amigável",
    body: "Olá, tudo bem? Identificamos parcelas em aberto e queremos ajudar a regularizar da forma mais confortável possível. Podemos avaliar juntos uma alternativa?",
  },
  {
    id: "due",
    title: "Lembrete de vencimento",
    body: "Passando para lembrar do vencimento combinado. Se precisar, posso reenviar o boleto original do C2X por aqui.",
  },
  {
    id: "boleto",
    title: "Enviar boleto C2X",
    body: "Estou enviando o boleto original do C2X para conferência e pagamento. O ideal é compensar até o vencimento informado.",
  },
  {
    id: "agreement",
    title: "Proposta de acordo",
    body: "Conseguimos simular uma composição com entrada reduzida e parcelamento do saldo vencido. Quer que eu formalize a proposta para sua análise?",
  },
  {
    id: "promise",
    title: "Confirmação de promessa",
    body: "Perfeito, vou registrar a promessa de pagamento para a data combinada e acompanhar a compensação. Qual valor você consegue confirmar?",
  },
  {
    id: "broken",
    title: "Quebra de promessa",
    body: "Não localizamos a compensação da promessa anterior. Podemos reagendar uma nova data ou montar um acordo mais aderente ao seu momento?",
  },
];

const IRIS_OPT_IN_TEMPLATE = {
  language: "pt_BR",
  name: "iris_opt_in_teste_v1",
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
  const operatorLabel = irisTicketOptions.operator.label || client.responsavel;

  const ticketClosed = ticket.status === "Encerrado" || ticket.status === "Cancelado";
  const ticketActive = ticket.status !== "Pendente" && !ticketClosed;
  const currentTicketProfile = irisTicketProfiles.find((profile) => profile.id === ticket.profileId);
  const ticketChecklist: TicketChecklistItem[] = [
    { id: "profile", label: "Perfil", ok: Boolean(ticket.profileId && ticket.profileName) },
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
    const primaryUnit = selectedUnits[0] ?? selectedUnit;
    const profile = irisTicketProfiles.find((item) => item.id === profileId) ?? irisTicketProfiles[0];
    const channel =
      irisWhatsAppChannels.find((item) => item.id === options.channelId) ??
      irisWhatsAppChannels[0];
    const template =
      irisTicketOptions.templates.find((item) => item.id === options.templateId) ??
      irisTicketOptions.templates[0];

    if (!profile) {
      throw new Error("Selecione um perfil real da Iris para abrir o ticket.");
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
          relatedInstallments,
          selectedUnitIds,
          unitCodes: selectedUnits.map((unit) => unit?.matricula).filter(Boolean),
          unitLabels: selectedUnits.map((unit) => unit?.unidadeLote).filter(Boolean),
        },
        sourceEntityId: client.c2xAcquisitionRequestId ?? client.id,
        sourceEntityType: "hades-collection-client",
        sourceModule: "hades",
        subject: `Cobranca Hades - ${profile.name}`,
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
    setFeedback(`Cobranca ${collectionProtocol} vinculada ao atendimento ${attendanceProtocol} na Iris.`);
    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: completingAutoTicket ? `${client.id}-whatsapp-ticket-completed` : `${client.id}-whatsapp-ticket-open`,
      protocol: collectionProtocol,
      type: "Observação operacional",
      title: completingAutoTicket ? "Dados do ticket completados na Iris" : "Ticket WhatsApp iniciado pela Iris",
      description: completingAutoTicket
        ? `Dados obrigatórios da cobranca ${collectionProtocol} completados pelo operador via Iris. Atendimento raiz: ${attendanceProtocol}. Perfil: ${profile.name}.`
        : `Cobranca ${collectionProtocol} iniciada pelo Hades via Iris/Meta e vinculada ao atendimento ${attendanceProtocol}. Perfil ${profile.name}, prioridade ${mapIrisPriority(profile.priority)} e SLA ${formatSlaMinutes(profile.slaFirstResponseMinutes)}.`,
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
          ? buildInstallmentOptions(client).slice(0, 1).map((item) => item.value)
          : current.relatedInstallments,
    }));
    setFeedback(`Perfil do ticket alterado para ${profile.name}. Histórico operacional atualizado.`);
    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: `${client.id}-whatsapp-ticket-profile-${profile.id}`,
      protocol: ticket.protocol,
      type: "Observação operacional",
      title: "Perfil do ticket alterado",
      description: `Perfil do Ticket ${ticket.protocol} alterado para ${profile.name}. Prioridade padrao ${mapIrisPriority(profile.priority)}, SLA ${formatSlaMinutes(profile.slaFirstResponseMinutes)}.`,
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
    setFeedback(`Ticket ${ticket.protocol} encerrado e registrado no histórico operacional.`);
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
      setFeedback("Envio de audio e documento deve ser conduzido pela Iris no ticket real.");
      return;
    }
    if (!ticket.irisTicketId) {
      setFeedback("Abra o ticket pela Iris antes de enviar mensagens externas.");
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

      if (!response.ok) {
        throw new Error(
          payload?.error ?? "Nao foi possivel enviar a mensagem pela Iris.",
        );
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
    } catch (error) {
      setFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel enviar a mensagem pela Iris.",
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
    setFeedback(
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
                <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">Inbox WhatsApp</p>
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
                    <span className="shrink-0">Perfil</span>
                    <select
                      value={ticket.profileId}
                      onChange={(event) => changeTicketProfile(event.target.value)}
                      className="h-6 max-w-52 bg-transparent text-xs font-semibold text-slate-700 outline-none"
                    >
                      {irisTicketProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="flex w-fit items-center gap-1 rounded-lg border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                  <HeaderToolbarButton icon={ArrowLeft} label="Voltar para atendimento" onClick={onClose} />
                  {ticketActive ? (
                    <HeaderToolbarButton icon={X} label="Encerrar atendimento" onClick={() => setTicketCloseOpen(true)} />
                  ) : ticketClosed ? (
                    <HeaderToolbarButton
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
                          status: "Pendente",
                        });
                        setTicketSetupOpen(true);
                      }}
                    />
                  ) : null}
                  <HeaderToolbarButton icon={Minimize2} label="Minimizar" onClick={() => undefined} />
                </div>
              </div>
            </div>
          </header>

          {feedback ? (
            <div className="mx-4 mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700">
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
                          <TicketSeparator cycle={cycle} compact />
                          {cycleMessages.map((message, index) => (
                            <MessageBubble
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
                    <TicketSeparator cycle={cycle} />
                    {cycleMessages.map((message, index) => (
                      <MessageBubble
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
                <TicketChecklist items={ticketChecklist} />
              </div>
            ) : null}

            <div className="mb-2 flex items-center justify-between gap-2">
              <OperationalToolbar
                disabled={!operationReady}
                disabledTooltip={blockedTooltip}
                onOpenOperation={openOperation}
                onUseTemplate={() => {
                  if (operationReady) setTemplateOpen(true);
                }}
              />
              {operationReady ? <TicketChecklist items={ticketChecklist} compact /> : null}
            </div>

            <div className={`flex items-end gap-2 rounded-xl border border-slate-200/70 bg-slate-50/70 p-2 transition-opacity ${operationReady ? "opacity-100" : "opacity-55"}`}>
              <ComposerIconButton disabled={!operationReady || sendingMessage} label="Emoji" onClick={() => setDraft((current) => `${current}??`)}>
                <Smile className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <ComposerIconButton disabled={!operationReady || sendingMessage} label="Anexar arquivo" onClick={() => sendMessage("document")}>
                <Paperclip className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={operationReady ? "Escrever mensagem WhatsApp..." : "Ticket incompleto"}
                disabled={!operationReady || sendingMessage}
                className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <ComposerIconButton disabled={!operationReady || sendingMessage} label="Enviar áudio" onClick={() => sendMessage("audio")}>
                <Mic className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <Tooltip content={operationReady ? "Enviar mensagem" : blockedTooltip} placement="top">
                <button
                  type="button"
                  disabled={!operationReady || sendingMessage}
                  onClick={() => sendMessage("text")}
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
                  aria-label={operationReady ? "Enviar mensagem" : blockedTooltip}
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
            <ClientContextPanel
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
        <TemplateModal
          onClose={() => setTemplateOpen(false)}
          onSelect={(body) => {
            setDraft(body);
            setTemplateOpen(false);
          }}
        />
      ) : null}

      {operationDrawer && operationReady ? (
        <OperationDrawer
          client={client}
          mode={operationDrawer}
          onClose={() => setOperationDrawer(null)}
          onSaved={handleOperationSaved}
          selectedUnit={selectedUnit}
          ticket={ticket}
        />
      ) : null}

      {ticketSetupOpen ? (
        <TicketSetupModal
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
        <TicketCloseModal
          onClose={() => setTicketCloseOpen(false)}
          onSubmit={closeTicket}
          ticket={ticket}
        />
      ) : null}
    </section>
  );
}

function MessageBubble({ message, showDate }: { message: WhatsAppMessage; showDate: boolean }) {
  const sent = message.author === "operator";

  return (
    <>
      {showDate ? <DateSeparator label={message.date} /> : null}
      <div className={`flex ${sent ? "justify-end" : "justify-start"}`}>
        <div
          className={`max-w-[82%] rounded-2xl px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ring-1 ${
            sent ? "bg-[#A07C3B]/8 text-slate-900 ring-[#A07C3B]/15" : "bg-white text-slate-900 ring-slate-200/70"
          }`}
        >
          <MessageContent message={message} />
          <div className="mt-2 flex items-center justify-end gap-1.5 text-[11px] text-slate-400">
            {message.operator ? <span>{message.operator}</span> : null}
            <span>{message.time}</span>
            {sent ? <MessageStatusIcon status={message.status ?? "enviada"} /> : null}
          </div>
        </div>
      </div>
    </>
  );
}

function MessageContent({ message }: { message: WhatsAppMessage }) {
  if (message.kind === "audio") {
    return (
      <div className="flex min-w-56 items-center gap-3">
        <div className="flex size-9 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100">
          <Mic className="size-4" aria-hidden="true" />
        </div>
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full w-2/3 rounded-full bg-[#A07C3B]" />
        </div>
        <span className="text-xs font-semibold text-slate-500">{message.duration}</span>
      </div>
    );
  }

  if (message.kind === "document") {
    return (
      <div className="flex min-w-64 items-center gap-3 rounded-xl border border-slate-200/70 bg-white/70 p-3">
        <FileText className="size-5 shrink-0 text-[#A07C3B]" aria-hidden="true" />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-950">{message.fileName}</p>
          <p className="mt-0.5 text-xs text-slate-500">{message.body}</p>
        </div>
      </div>
    );
  }

  return <p className="text-sm leading-6">{message.body}</p>;
}

function MessageStatusIcon({ status }: { status: MessageStatus }) {
  if (status === "lida") return <CheckCheck className="size-3.5 text-sky-500" aria-hidden="true" />;
  if (status === "entregue") return <CheckCheck className="size-3.5 text-slate-400" aria-hidden="true" />;
  return <Check className="size-3.5 text-slate-400" aria-hidden="true" />;
}

function TicketSeparator({ compact = false, cycle }: { compact?: boolean; cycle: TicketCycle }) {
  return (
    <div className={`relative ${compact ? "py-1" : "py-2"}`}>
      <div className="absolute left-0 right-0 top-1/2 h-px bg-slate-200/80" aria-hidden="true" />
      <div
        className={`relative mx-auto w-fit max-w-full border border-slate-200/70 bg-white text-center shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
          compact ? "rounded-xl px-3 py-2" : "rounded-2xl px-4 py-3"
        }`}
      >
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="rounded-full bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
            Ticket {cycle.protocol}
          </span>
          <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
            {cycle.status}
          </span>
        </div>
        <p className={`${compact ? "mt-1 text-xs" : "mt-2 text-sm"} font-semibold text-slate-950`}>
          {cycle.profileName}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          {cycle.openedAt} · {cycle.operator}
          {cycle.unitCode ? ` · ${cycle.unitCode}` : ""}
        </p>
      </div>
    </div>
  );
}

function TicketSetupModal({
  channels,
  client,
  defaultProfileId,
  error,
  linkedAttendanceProtocol,
  loading,
  mode = "open",
  onClose,
  onOpenTicket,
  operatorLabel,
  profiles,
  queues,
  selectedUnitId,
  templates,
}: {
  channels: IrisTicketChannelOption[];
  client: QueueClient;
  defaultProfileId: string;
  error?: string;
  linkedAttendanceProtocol?: string | null;
  loading?: boolean;
  mode?: "open" | "complete";
  onClose: () => void;
  onOpenTicket: (
    profileId: string,
    unitIds?: string[],
    relatedInstallments?: string[],
    options?: { channelId?: string; initialNote?: string; queueId?: string; templateId?: string },
  ) => Promise<void>;
  operatorLabel: string;
  profiles: IrisTicketProfileOption[];
  queues: IrisTicketQueueOption[];
  selectedUnitId?: string;
  templates: IrisTicketTemplateOption[];
}) {
  const preferredQueueId = findPreferredQueueId(queues, profiles);
  const initialQueueId =
    profiles.find((profile) => profile.id === defaultProfileId)?.queueId ??
    preferredQueueId ??
    queues[0]?.id ??
    "";
  const initialProfileId =
    defaultProfileId ||
    findDefaultProfileId(profiles, initialQueueId) ||
    profiles[0]?.id ||
    "";
  const initialTemplateId = templates[0]?.id ?? "";
  const [queueId, setQueueId] = useState(initialQueueId);
  const [profileId, setProfileId] = useState(initialProfileId);
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(
    selectedUnitId
      ? [selectedUnitId]
      : client.carteira.unidades[0]?.id
        ? [client.carteira.unidades[0].id]
        : [],
  );
  const [templateId, setTemplateId] = useState(initialTemplateId);
  const [relatedInstallments, setRelatedInstallments] = useState<string[]>([]);
  const [initialNote, setInitialNote] = useState("");
  const [slaExpanded, setSlaExpanded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const profilesForQueue = queueId
    ? profiles.filter((profile) => profile.queueId === queueId)
    : profiles;
  const selectedProfile =
    profilesForQueue.find((profile) => profile.id === profileId) ??
    profiles.find((profile) => profile.id === profileId) ??
    null;
  const selectedQueue =
    queues.find((queue) => queue.id === queueId) ??
    (selectedProfile?.queueId
      ? queues.find((queue) => queue.id === selectedProfile.queueId)
      : null) ??
    null;
  const selectedChannel = channels.find((channel) => channel.id === channelId) ?? null;
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? null;
  const selectedUnits = selectedUnitIds
    .map((unitId) => client.carteira.unidades.find((unit) => unit.id === unitId))
    .filter(Boolean);
  const installmentOptions = useMemo(
    () => buildInstallmentOptions(client, selectedUnitIds),
    [client, selectedUnitIds],
  );
  const templateApproved = Boolean(selectedTemplate?.id && selectedTemplate.metaStatus === "APPROVED");
  const missingProfile = !profileId;
  const missingChannel = !channelId;
  const missingQueue = !queueId;
  const missingTemplate = !templateId;
  const missingUnit = requiresIrisUnit(selectedProfile) && selectedUnitIds.length === 0;
  const missingInstallment =
    requiresIrisInstallment(selectedProfile) && relatedInstallments.length === 0;
  const missingPriority = !selectedProfile?.priority;
  const missingSla = createsIrisSla(selectedProfile) && selectedProfile.slaFirstResponseMinutes <= 0;
  const canOpenTicket =
    !loading &&
    !error &&
    templateApproved &&
    !missingChannel &&
    !missingQueue &&
    !missingTemplate &&
    !missingProfile &&
    !missingUnit &&
    !missingInstallment &&
    !missingPriority &&
    !missingSla &&
    !submitting;

  useEffect(() => {
    if (queueId || !queues.length) return;
    setQueueId(findPreferredQueueId(queues, profiles) ?? queues[0]?.id ?? "");
  }, [profiles, queueId, queues]);

  useEffect(() => {
    const availableProfiles = queueId
      ? profiles.filter((profile) => profile.queueId === queueId)
      : profiles;

    if (availableProfiles.some((profile) => profile.id === profileId)) return;

    setProfileId(
      availableProfiles.find((profile) => profile.slug === "cobranca")?.id ??
        availableProfiles[0]?.id ??
        "",
    );
  }, [profileId, profiles, queueId]);

  useEffect(() => {
    if (channelId || !channels.length) return;
    setChannelId(channels[0]?.id ?? "");
  }, [channelId, channels]);

  useEffect(() => {
    if (templateId || !templates.length) return;
    setTemplateId(templates[0]?.id ?? "");
  }, [templateId, templates]);

  useEffect(() => {
    setRelatedInstallments((current) => {
      const next = current.filter((installment) =>
        installmentOptions.some((option) => option.value === installment),
      );

      return next.length === current.length ? current : next;
    });
  }, [installmentOptions]);

  function toggleUnit(unitId: string) {
    setSelectedUnitIds((current) => {
      if (current.includes(unitId)) {
        const next = current.filter((item) => item !== unitId);
        return next.length ? next : current;
      }

      return [...current, unitId];
    });
  }

  function toggleInstallment(installment: string) {
    setRelatedInstallments((current) =>
      current.includes(installment)
        ? current.filter((item) => item !== installment)
        : [...current, installment]
    );
  }

  async function handleOpenTicket() {
    if (!canOpenTicket) return;

    setSubmitting(true);
    setFormError("");

    try {
      await onOpenTicket(profileId, selectedUnitIds, relatedInstallments, {
        channelId,
        initialNote,
        queueId,
        templateId,
      });
    } catch (openError) {
      setFormError(
        openError instanceof Error
          ? openError.message
          : "Nao foi possivel abrir o ticket pela Iris.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fechar abertura de ticket"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative z-10 w-full max-w-4xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.2)]">
        <header className="border-b border-slate-100 px-5 py-4">
          <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">
            {mode === "complete" ? "Completar cobranca" : "Abertura Iris"}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">
            {mode === "complete" ? "Completar dados da cobranca" : "Iniciar cobranca pela Iris"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "complete"
              ? "Complete os dados operacionais da cobranca criada a partir do atendimento do cliente."
              : "A Iris cria o atendimento AT e o Hades registra a cobranca CB vinculada a esse atendimento."}
          </p>
        </header>

        <div className="grid max-h-[68vh] gap-4 overflow-y-auto p-5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadonlyField label="Cliente" value={client.nome} />
              <ReadonlyField label="Telefone" value={client.dados360.telefone} />
              <label className="min-w-0 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
                <span className="text-xs font-medium text-slate-500">Canal</span>
                <select
                  value={channelId}
                  onChange={(event) => setChannelId(event.target.value)}
                  className="mt-1 h-7 w-full min-w-0 rounded-md border border-transparent bg-slate-50/80 px-2 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-[#A07C3B]/35 focus:bg-white focus:ring-2 focus:ring-[#A07C3B]/10"
                >
                  {channels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name}
                    </option>
                  ))}
                </select>
              </label>
              <ReadonlyField label="Operador Iris" value={operatorLabel} />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
                <span className="text-xs font-medium text-slate-500">Fila Iris</span>
                <select
                  value={queueId}
                  onChange={(event) => setQueueId(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-transparent bg-slate-50/80 px-2 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-[#A07C3B]/35 focus:bg-white focus:ring-2 focus:ring-[#A07C3B]/10"
                >
                  {queues.map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-3 py-2.5">
                <span className="text-xs font-semibold text-[#7A5E2C]">Perfil</span>
                <select
                  value={profileId}
                  onChange={(event) => setProfileId(event.target.value)}
                  className="mt-1 h-9 w-full rounded-lg border border-[#A07C3B]/20 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition-colors focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
                >
                  {profilesForQueue.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="block rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
              <span className="text-xs font-medium text-slate-500">Template Meta aprovado</span>
              <select
                value={templateId}
                onChange={(event) => setTemplateId(event.target.value)}
                className="mt-1 h-9 w-full rounded-lg border border-transparent bg-slate-50/80 px-2 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-[#A07C3B]/35 focus:bg-white focus:ring-2 focus:ring-[#A07C3B]/10"
              >
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-xs font-medium text-slate-500">
                {selectedTemplate?.templateName ?? "Aguardando template aprovado na Iris."}
              </p>
            </label>

            {requiresIrisUnit(selectedProfile) ? (
              <div className="rounded-xl border border-slate-200/70 bg-white p-3">
                <p className="text-xs font-semibold text-slate-500">Unidade vinculada a cobranca</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {client.carteira.unidades.map((unit) => {
                    const active = selectedUnitIds.includes(unit.id);

                    return (
                      <button
                        key={unit.id}
                        type="button"
                        onClick={() => toggleUnit(unit.id)}
                        className={`min-h-9 rounded-lg px-3 py-1.5 text-left text-xs font-semibold transition-colors ${
                          active
                            ? "bg-[#A07C3B] text-white"
                            : "border border-slate-200/70 bg-white text-slate-600 hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
                        }`}
                      >
                        {unit.matricula} · {unit.unidadeLote}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <ReadonlyField label="Unidade relacionada" value="Opcional para este perfil" />
            )}

            {requiresIrisInstallment(selectedProfile) ? (
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-500">Parcelas relacionadas</p>
                  <span className="text-xs font-semibold text-[#7A5E2C]">
                    {relatedInstallments.length} selecionada(s)
                  </span>
                </div>
                {installmentOptions.length ? (
                  <select
                    multiple
                    value={relatedInstallments}
                    onChange={(event) =>
                      setRelatedInstallments(
                        Array.from(event.currentTarget.selectedOptions).map((option) => option.value),
                      )
                    }
                    className="mt-3 min-h-40 w-full rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
                  >
                    {installmentOptions.map((installment) => (
                      <option key={installment.value} value={installment.value}>
                        {installment.label}
                      </option>
                    ))}
                  </select>
                ) : (
                    <p className="text-sm font-medium text-slate-500">
                      Aguardando parcelas reais do C2X para a unidade selecionada.
                    </p>
                )}
              </div>
            ) : (
              <ReadonlyField label="Parcelas relacionadas" value="Nao obrigatorio para este perfil" />
            )}

            <label className="block rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <span className="text-xs font-semibold text-slate-500">Observacao inicial, se necessario</span>
              <textarea
                value={initialNote}
                onChange={(event) => setInitialNote(event.target.value)}
                className="mt-2 min-h-20 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
                placeholder="Contexto breve do atendimento..."
              />
            </label>
          </div>

          <aside className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">Iris</p>
            <div className="mt-3 grid gap-2">
              <ReadonlyField label="Canal" value={selectedChannel?.name ?? EMPTY_FIELD} />
              <ReadonlyField label="Fila" value={selectedQueue?.name ?? EMPTY_FIELD} />
              <ReadonlyField label="Template" value={selectedTemplate?.name ?? EMPTY_FIELD} />
              <ReadonlyField label="Protocolo Iris" value={linkedAttendanceProtocol ?? "AT gerado na abertura"} />
              <ReadonlyField
                label="Protocolo Hades"
                value={linkedAttendanceProtocol ? "CB sera vinculado ao AT existente" : "CB vinculado ao AT"}
              />
            </div>
            <button
              type="button"
              onClick={() => setSlaExpanded((current) => !current)}
              className="mt-3 inline-flex h-9 w-full items-center justify-between rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:text-[#7A5E2C]"
            >
              SLA e prioridade
              <span>{slaExpanded ? "Ocultar" : "Expandir"}</span>
            </button>
            {slaExpanded ? (
              <div className="mt-3 grid gap-2">
                <ReadonlyField label="Categoria" value={selectedProfile?.category ?? EMPTY_FIELD} />
                <ReadonlyField label="Prioridade" value={selectedProfile ? mapIrisPriority(selectedProfile.priority) : EMPTY_FIELD} />
                <ReadonlyField label="Primeira resposta" value={selectedProfile ? formatSlaMinutes(selectedProfile.slaFirstResponseMinutes) : EMPTY_FIELD} />
                <ReadonlyField label="Resolucao" value={selectedProfile ? formatSlaMinutes(selectedProfile.slaResolutionMinutes) : EMPTY_FIELD} />
              </div>
            ) : null}
            <p className="mt-3 text-xs leading-5 text-slate-500">
              {selectedUnits.length
                ? `Unidade(s): ${selectedUnits.map((unit) => unit?.matricula).filter(Boolean).join(", ")}`
                : "Selecione a unidade para carregar as parcelas."}
            </p>
          </aside>
        </div>

        <footer className="border-t border-slate-100 p-4">
          {error || formError || !templateApproved || !canOpenTicket ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              {error
                ? error
                : formError
                  ? formError
                  : !templateApproved
                    ? "Selecione um template Meta aprovado dentro da Iris."
                    : loading
                      ? "Carregando estrutura real da Iris."
                      : missingChannel
                        ? "Selecione o canal WhatsApp da Iris."
                        : missingQueue
                          ? "Selecione a fila da Iris."
                          : missingTemplate
                            ? "Selecione o template Meta aprovado."
                            : missingProfile
                              ? "Selecione um perfil."
                              : missingUnit
                                ? "Selecione uma ou mais unidades para este perfil."
                                : missingInstallment
                                  ? "Selecione ao menos uma parcela relacionada."
                                  : missingPriority
                                    ? "Defina a prioridade do perfil."
                                    : "Defina o SLA do perfil."}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!canOpenTicket}
            onClick={handleOpenTicket}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            {submitting
              ? "Abrindo pela Iris..."
              : mode === "complete"
                ? "Salvar e assumir atendimento"
                : "Abrir ticket pela Iris"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function TicketCloseModal({
  onClose,
  onSubmit,
  ticket,
}: {
  onClose: () => void;
  onSubmit: (result: string, nextStep: string, finalNote: string) => void;
  ticket: WhatsAppTicket;
}) {
  const [result, setResult] = useState("Cliente orientado com proposta enviada");
  const [nextStep, setNextStep] = useState("Aguardar retorno do cliente até amanhã");
  const [finalNote, setFinalNote] = useState("Atendimento encerrado com histórico consolidado para acompanhamento.");

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fechar encerramento de ticket"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative z-10 w-full max-w-xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.2)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">Encerrar atendimento</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Ticket {ticket.protocol}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar encerramento"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="space-y-3 p-5">
          <EditableField label="Resultado do atendimento" value={result} onChange={setResult} />
          <EditableField label="Próximo passo" value={nextStep} onChange={setNextStep} />
          <label className="block rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <span className="text-xs font-semibold tracking-normal text-slate-400">Observação final</span>
            <textarea
              value={finalNote}
              onChange={(event) => setFinalNote(event.target.value)}
              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>
        </div>

        <footer className="border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={() => onSubmit(result, nextStep, finalNote)}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35]"
          >
            Encerrar ticket
          </button>
        </footer>
      </section>
    </div>
  );
}

function OperationDrawer({
  client,
  mode,
  onClose,
  onSaved,
  selectedUnit,
  ticket,
}: {
  client: QueueClient;
  mode: OperationDrawerMode;
  onClose: () => void;
  onSaved: (mode: OperationDrawerMode, event: OperationalTimelineEvent) => void;
  selectedUnit?: PortfolioUnit;
  ticket: WhatsAppTicket;
}) {
  const isPromise = mode === "promise";
  const isAgreement = mode === "agreement";
  const isBoleto = mode === "boleto";
  const [unitId, setUnitId] = useState(selectedUnit?.id ?? client.carteira.unidades[0]?.id ?? "");
  const unit = client.carteira.unidades.find((item) => item.id === unitId) ?? client.carteira.unidades[0];
  const [promisedValue, setPromisedValue] = useState(client.parcelas.ultimaParcela);
  const [promisedDate, setPromisedDate] = useState("-");
  const [originalValue, setOriginalValue] = useState(client.agreement.originalDebt);
  const [discount, setDiscount] = useState(client.agreement.discount);
  const [entry, setEntry] = useState(client.agreement.entry);
  const [entryDueDate, setEntryDueDate] = useState("-");
  const [installmentsCount, setInstallmentsCount] = useState(`${client.agreement.installmentsCount}`);
  const [firstDueDate, setFirstDueDate] = useState("-");
  const c2xBoletos = useMemo(() => buildC2xBoletos(client), [client]);
  const [selectedBoletoId, setSelectedBoletoId] = useState(c2xBoletos[0]?.id ?? "");
  const selectedBoleto = c2xBoletos.find((boleto) => boleto.id === selectedBoletoId) ?? c2xBoletos[0];
  const [note, setNote] = useState(
    isPromise
      ? "-"
      : isBoleto
        ? "-"
        : mode === "installments"
          ? "-"
          : client.agreement.aiSuggestion.composition
  );

  const agreementCalc = calculateAgreement(originalValue, discount, entry, installmentsCount);

  function save() {
    if (isBoleto || mode === "installments") {
      onSaved(mode, {
        actionType: isBoleto ? "Envio de boleto C2X" : "Consulta de boleto C2X",
        id: `${client.id}-${mode}-whatsapp-${unit?.id ?? "unit"}-${selectedBoleto?.id ?? "boleto"}`,
        protocol: ticket.protocol,
        type: isBoleto ? "Boleto C2X" : "Observação operacional",
        title: isBoleto ? "Boleto C2X enviado pelo WhatsApp" : "Boletos C2X consultados",
        description: isBoleto
          ? `Boleto original do C2X enviado para a parcela ${selectedBoleto?.parcela ?? "-"} da unidade ${unit?.matricula ?? "-"} a partir do Ticket ${ticket.protocol}. Linha digitável registrada para auditoria operacional.`
          : `Operador consultou parcelas e boletos originais do C2X da unidade ${unit?.matricula ?? "-"} durante o Ticket ${ticket.protocol}.`,
        occurredAt: "-",
        operator: client.responsavel,
        status: isBoleto ? "Enviado" : "Registrado",
        unitCode: unit?.matricula,
        unitLabel: unit?.unidadeLote,
      });
      return;
    }

    onSaved(mode, {
      actionType: isPromise ? "Promessa WhatsApp" : "Acordo WhatsApp",
      id: `${client.id}-${mode}-whatsapp-${isPromise ? "promise" : "agreement"}`,
      protocol: ticket.protocol,
      type: isPromise ? "Promessa de pagamento" : "Acordo gerado",
      title: isPromise ? "Promessa criada pelo WhatsApp" : "Acordo criado pelo WhatsApp",
      description: isPromise
        ? `Origem: WhatsApp • Ticket ${ticket.protocol}. Promessa de ${promisedValue} para ${promisedDate}, unidade ${unit?.matricula ?? "-"}. Workflow sinalizado como Promessa realizada.`
        : `Origem: WhatsApp • Ticket ${ticket.protocol}. Acordo em negociação com valor negociado de ${agreementCalc.negotiatedValue}, entrada de ${entry} e ${installmentsCount} parcela(s). Workflow sinalizado como Em negociação.`,
      occurredAt: "-",
      operator: client.responsavel,
      status: isPromise ? "Prometido" : "Gerado",
      unitCode: unit?.matricula,
      unitLabel: unit?.unidadeLote,
    });
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-slate-950/25 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fechar operacao"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <aside className="relative z-10 flex h-full w-full max-w-xl flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">
              WhatsApp operacional
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {isPromise ? "Registrar promessa" : isAgreement ? "Criar acordo" : isBoleto ? "Enviar boleto" : "Consultar parcelas"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">{client.nome} · {client.dados360.telefone}</p>
            <p className="mt-1 text-xs font-semibold text-[#7A5E2C]">Origem: WhatsApp • Ticket {ticket.protocol}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar formulário"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <div className="grid gap-3 sm:grid-cols-2">
            <ReadonlyField label="Cliente" value={client.nome} />
            <ReadonlyField label="Telefone" value={client.dados360.telefone} />
            <label className="min-w-0 rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-3 py-2.5 sm:col-span-2">
              <span className="text-xs font-semibold text-[#7A5E2C]">Unidade relacionada à ação</span>
              <select
                value={unit?.id ?? ""}
                onChange={(event) => setUnitId(event.target.value)}
                className="mt-2 h-9 w-full rounded-lg border border-[#A07C3B]/20 bg-white px-3 text-sm font-semibold text-slate-700 outline-none"
              >
                {client.carteira.unidades.map((portfolioUnit) => (
                  <option key={portfolioUnit.id} value={portfolioUnit.id}>
                    {portfolioUnit.matricula} · {portfolioUnit.empreendimento} · {portfolioUnit.unidadeLote}
                  </option>
                ))}
              </select>
            </label>
            <ReadonlyField label="Empreendimento" value={unit?.empreendimento ?? client.carteira.empreendimento} />
            <ReadonlyField label="Cod. unidade" value={unit?.matricula ?? "-"} />
            <ReadonlyField label="Unidade/lote" value={unit?.unidadeLote ?? "-"} />
            <ReadonlyField label="Canal" value="WhatsApp" />
            <ReadonlyField label="Operador responsável" value={client.responsavel} />
            <ReadonlyField label="Ticket de origem" value={ticket.protocol} />
            <ReadonlyField label="Status inicial" value={isPromise ? "Promessa realizada" : isAgreement ? "Em negociação" : "Registrado"} />

            {isPromise ? (
              <>
                <ReadonlyField label="Parcelas relacionadas" value="-" />
                <EditableField label="Valor prometido" value={promisedValue} onChange={setPromisedValue} />
                <EditableField label="Data prometida" value={promisedDate} onChange={setPromisedDate} />
              </>
            ) : isAgreement ? (
              <>
                <ReadonlyField label="Parcelas incluídas" value="-" />
                <EditableField label="Valor original" value={originalValue} onChange={setOriginalValue} />
                <EditableField label="Desconto" value={discount} onChange={setDiscount} />
                <ReadonlyField label="Valor negociado" value={agreementCalc.negotiatedValue} />
                <EditableField label="Entrada" value={entry} onChange={setEntry} />
                <EditableField label="Vencimento da entrada" value={entryDueDate} onChange={setEntryDueDate} />
                <EditableField label="Quantidade de parcelas" value={installmentsCount} onChange={setInstallmentsCount} />
                <ReadonlyField label="Valor das parcelas" value={agreementCalc.installmentValue} />
                <EditableField label="Primeiro vencimento" value={firstDueDate} onChange={setFirstDueDate} />
                <ReadonlyField label="Saldo parcelado" value={agreementCalc.installmentBalance} />
                <ReadonlyField label="% de entrada" value={`${agreementCalc.entryRate}%`} />
                <ReadonlyField label="Recuperação estimada" value={`${agreementCalc.recoveryRate}%`} />
              </>
            ) : (
              <>
                <ReadonlyField label="Fonte financeira" value="C2X" />
                <ReadonlyField label="Ação do Hades" value={isBoleto ? "Enviar boleto original" : "Consultar boletos originais"} />
                <ReadonlyField label="Saldo em atraso" value={client.saldoDevedor} />
                <ReadonlyField label="Preparado para" value="visualizado, vencido, pago e reenvio" />
              </>
            )}
          </div>

          {isBoleto || mode === "installments" ? (
            <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">Consulta C2X</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">Boletos originais vinculados à unidade</p>
                </div>
                <span className="w-fit rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  Hades não gera boletos
                </span>
              </div>

              <div className="mt-3 grid gap-2">
                {c2xBoletos.map((boleto) => {
                  const active = selectedBoleto?.id === boleto.id;

                  return (
                    <button
                      key={boleto.id}
                      type="button"
                      onClick={() => setSelectedBoletoId(boleto.id)}
                      className={`rounded-lg border p-3 text-left transition-colors ${
                        active
                          ? "border-[#A07C3B]/30 bg-white shadow-sm"
                          : "border-slate-200/70 bg-white/70 hover:border-[#A07C3B]/20 hover:bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-950">Parcela {boleto.parcela}</p>
                        <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                          {boleto.status}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <ReadonlyField label="Vencimento" value={boleto.vencimento} />
                        <ReadonlyField label="Valor" value={boleto.valor} />
                        <ReadonlyField label="Linha digitável" value={boleto.linhaDigitavel} />
                      </div>
                    </button>
                  );
                })}
              </div>

              {selectedBoleto ? (
                <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold tracking-normal text-slate-400">Preview C2X</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">Boleto original • Parcela {selectedBoleto.parcela}</p>
                      <p className="mt-1 font-mono text-xs text-slate-500">{selectedBoleto.linhaDigitavel}</p>
                    </div>
                    <span className="rounded-md bg-[#A07C3B]/5 px-2 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                      C2X
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          <label className="mt-4 block rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <span className="text-xs font-semibold tracking-normal text-slate-400">Observação</span>
            <textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </label>
        </div>

        <footer className="border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={save}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35]"
          >
            {isPromise ? <CalendarCheck className="size-4" aria-hidden="true" /> : isAgreement ? <HandCoins className="size-4" aria-hidden="true" /> : <FileText className="size-4" aria-hidden="true" />}
            {isPromise ? "Salvar promessa" : isAgreement ? "Salvar acordo" : isBoleto ? "Enviar boleto" : "Registrar consulta"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function ClientContextPanel({
  client,
  onCollapse,
  onCompleteTicket,
  onOpenOperation,
  onSelectUnit,
  onUseTemplate,
  operationReady,
  previousTickets,
  selectedUnit,
  selectedUnitId,
  ticket,
  ticketChecklist,
  ticketIncomplete,
}: {
  client: QueueClient;
  onCollapse: () => void;
  onCompleteTicket: () => void;
  onOpenOperation: (mode: OperationDrawerMode) => void;
  onSelectUnit: (unitId: string) => void;
  onUseTemplate: () => void;
  operationReady: boolean;
  previousTickets: TicketCycle[];
  selectedUnit?: PortfolioUnit;
  selectedUnitId?: string;
  ticket: WhatsAppTicket;
  ticketChecklist: TicketChecklistItem[];
  ticketIncomplete: boolean;
}) {
  const [activeTab, setActiveTab] = useState<ContextTab>("info");
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const visibleTickets = historyExpanded ? previousTickets : previousTickets.slice(-2);
  const contextTabs: { id: ContextTab; label: string; icon: typeof MessageCircle }[] = [
    { id: "info", label: "Informações", icon: FileText },
    { id: "actions", label: "Ações", icon: CalendarCheck },
    { id: "ai", label: "IA", icon: Bot },
    { id: "history", label: "Histórico", icon: Clock3 },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-slate-100 p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">Contexto</p>
            <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">{client.nome}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{client.dados360.telefone}</p>
          </div>
          <Tooltip content="Recolher contexto" placement="bottom">
            <button
              type="button"
              onClick={onCollapse}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
              aria-label="Recolher contexto"
            >
              <PanelRightClose className="size-4" aria-hidden="true" />
            </button>
          </Tooltip>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg bg-slate-100/70 p-1 [scrollbar-width:none]">
          {contextTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Tooltip key={tab.id} content={tab.label} placement="bottom">
                <button
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  aria-label={tab.label}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                    activeTab === tab.id ? "bg-white text-[#7A5E2C] shadow-sm" : "text-slate-500 hover:bg-white/70"
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              </Tooltip>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
        {activeTab === "info" ? (
          <div className="space-y-3">
            <div className="grid gap-2">
            <ContextItem label="Cliente" value={client.nome} />
            <ContextItem label="Telefone" value={client.dados360.telefone} />
            <ContextItem label="Saldo em atraso" value={client.saldoDevedor} />
            <ContextItem label="Workflow" value={client.workflow.stage} />
            <ContextItem label="Operador" value={client.responsavel} />
            <ContextItem label="Protocolo" value={ticket.protocol} />
            <ContextItem label="Perfil" value={ticket.profileName} />
            <ContextItem label="SLA" value={ticket.slaHours > 0 ? `${ticket.slaHours}h · Atenção` : "Sem SLA"} />
            <ContextItem label="Prioridade" value={ticket.priority} />
            <ContextItem label="Origem" value={ticket.origin} />
            <ContextItem label="Unidade vinculada" value={selectedUnit?.matricula ?? "-"} />
            </div>
            <div className="space-y-2">
              <p className="text-xs font-semibold tracking-normal text-slate-400">Unidades</p>
              {client.carteira.unidades.map((unit) => {
              const active = selectedUnitId === unit.id;

              return (
                <button
                  key={unit.id}
                  type="button"
                  onClick={() => onSelectUnit(unit.id)}
                  className={`w-full rounded-xl border px-3 py-2 text-left transition-colors ${
                    active
                      ? "border-[#A07C3B]/30 bg-white text-slate-950 shadow-sm"
                      : "border-slate-200/70 bg-slate-50/70 text-slate-700 hover:border-[#A07C3B]/25 hover:bg-white"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-xs font-semibold text-[#7A5E2C]">Cod. {unit.matricula}</p>
                      <p className="truncate text-sm font-semibold">{unit.empreendimento}</p>
                      <p className="text-xs text-slate-500">Quadra {unit.quadra} · Lote {unit.lote}</p>
                    </div>
                    <span className="shrink-0 rounded-full bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200/70">
                      {unit.unidadeLote}
                    </span>
                  </div>
                </button>
              );
            })}
            </div>
          </div>
        ) : null}

        {activeTab === "actions" ? (
          <div className="space-y-3">
            {!operationReady ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="flex items-center gap-2 text-xs font-semibold text-amber-800">
                  <LockKeyhole className="size-3.5" aria-hidden="true" />
                  <span>Complete o ticket para operar</span>
                </div>
                <TicketChecklist items={ticketChecklist} className="mt-2" />
              </div>
            ) : null}
            {ticketIncomplete ? (
              <Tooltip content="Completar perfil, unidade e parcelas do ticket autoaberto." placement="top" className="w-full" triggerClassName="w-full">
                <button
                  type="button"
                  onClick={onCompleteTicket}
                  className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35]"
                >
                  Completar ticket
                </button>
              </Tooltip>
            ) : null}
            <OperationalToolbar
              disabled={!operationReady}
              disabledTooltip="Complete o ticket para iniciar o atendimento."
              onOpenOperation={onOpenOperation}
              onUseTemplate={onUseTemplate}
              vertical
            />
          </div>
        ) : null}

        {activeTab === "ai" ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-4">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-[#A07C3B]" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-950">IA da conversa</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                Cliente demonstra abertura para composição. Recomenda confirmar valor possível, registrar promessa
                com data curta ou formalizar acordo com entrada acessível.
              </p>
            </div>
            <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
              <div className="flex items-center gap-2">
                <Bot className="size-4 text-[#A07C3B]" aria-hidden="true" />
                <p className="text-sm font-semibold text-slate-950">Resumo IA</p>
              </div>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Histórico recente: cobrança amigável enviada, cliente pediu boleto C2X e sinalizou pagamento parcial.
              </p>
            </div>
            <ContextItem label="Próxima ação sugerida" value={client.aiSuggestion} />
          </div>
        ) : null}

        {activeTab === "history" ? (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => setHistoryExpanded((current) => !current)}
              className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-slate-200/70 bg-white px-3 text-xs font-semibold text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-slate-950"
            >
              {historyExpanded ? "Ocultar tickets anteriores" : `Ver tickets anteriores (${previousTickets.length})`}
            </button>
            {historyExpanded ? (
              <p className="text-center text-[11px] font-medium text-slate-400">Histórico completo preparado para versão futura</p>
            ) : null}
            <div className="space-y-2">
              {visibleTickets.map((cycle) => (
                <div key={cycle.protocol} className="rounded-lg border border-slate-200/70 bg-slate-50/70 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-xs font-semibold text-[#7A5E2C]">{cycle.protocol}</p>
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200/70">
                      {cycle.status}
                    </span>
                  </div>
                  <p className="mt-2 text-sm font-semibold text-slate-950">{cycle.profileName}</p>
                  <p className="mt-1 text-xs text-slate-500">{cycle.openedAt} · {cycle.operator}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function TemplateModal({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: (body: string) => void;
}) {
  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/20 px-4">
      <button
        type="button"
        aria-label="Fechar templates"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative z-10 w-full max-w-2xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.2)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">Templates WhatsApp</p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Usar template</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar templates"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid max-h-[520px] gap-3 overflow-y-auto p-5 sm:grid-cols-2">
          {templates.map((template) => (
            <button
              key={template.id}
              type="button"
              onClick={() => onSelect(template.body)}
              className="rounded-xl border border-slate-200/70 bg-slate-50/60 p-4 text-left transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
            >
              <p className="text-sm font-semibold text-slate-950">{template.title}</p>
              <p className="mt-2 line-clamp-3 text-sm leading-6 text-slate-600">{template.body}</p>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function HeaderToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: typeof MessageCircle;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="bottom">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/20"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function OperationalToolbar({
  disabled = false,
  disabledTooltip,
  onOpenOperation,
  onUseTemplate,
  vertical = false,
}: {
  disabled?: boolean;
  disabledTooltip: string;
  onOpenOperation: (mode: OperationDrawerMode) => void;
  onUseTemplate: () => void;
  vertical?: boolean;
}) {
  const actions: Array<{
    icon: typeof MessageCircle;
    label: string;
    onClick: () => void;
  }> = [
    { icon: FileText, label: "Template", onClick: onUseTemplate },
    { icon: CalendarCheck, label: "Promessa", onClick: () => onOpenOperation("promise") },
    { icon: HandCoins, label: "Acordo", onClick: () => onOpenOperation("agreement") },
    { icon: FileText, label: "Enviar boleto", onClick: () => onOpenOperation("boleto") },
    { icon: CalendarCheck, label: "Parcelas", onClick: () => onOpenOperation("installments") },
  ];

  return (
    <div
      className={`flex w-fit gap-1 rounded-lg border border-slate-200/70 bg-white p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
        vertical ? "flex-wrap" : "items-center"
      }`}
      aria-label="Toolbar operacional"
    >
      {actions.map((action) => (
        <ToolbarIconButton
          key={action.label}
          disabled={disabled}
          icon={action.icon}
          label={action.label}
          onClick={action.onClick}
          tooltip={disabled ? disabledTooltip : action.label}
        />
      ))}
    </div>
  );
}

function ToolbarIconButton({
  disabled,
  icon: Icon,
  label,
  onClick,
  tooltip,
}: {
  disabled: boolean;
  icon: typeof MessageCircle;
  label: string;
  onClick: () => void;
  tooltip: string;
}) {
  return (
    <Tooltip content={tooltip} placement="top">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={tooltip}
        className="flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </Tooltip>
  );
}

function TicketChecklist({
  className = "",
  compact = false,
  items,
}: {
  className?: string;
  compact?: boolean;
  items: TicketChecklistItem[];
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {items.map((item) => (
        <Tooltip key={item.id} content={item.ok ? `${item.label} validado` : `${item.label} obrigatório`} placement="top">
          <span
            className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold ring-1 ${
              item.ok
                ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
                : "bg-amber-50 text-amber-800 ring-amber-200"
            } ${compact ? "px-1.5" : ""}`}
          >
            <span aria-hidden="true">{item.ok ? "?" : "!"}</span>
            {item.label}
          </span>
        </Tooltip>
      ))}
    </div>
  );
}

function ComposerIconButton({
  children,
  disabled = false,
  label,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <Tooltip content={label} placement="top">
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-label={label}
        className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-white hover:text-[#A07C3B] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ContextItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function mapIrisTicketOptions(payload: any): IrisTicketOptions {
  const queues = Array.isArray(payload?.queues)
    ? payload.queues.map((queue: any) => ({
        defaultPriority: normalizeIrisPriority(queue.default_priority),
        id: String(queue.id ?? ""),
        name: String(queue.name ?? "Iris"),
        slug: String(queue.slug ?? ""),
        status: String(queue.status ?? "active"),
      }))
    : [];
  const queueById = new Map(queues.map((queue) => [queue.id, queue]));
  const channels = Array.isArray(payload?.channels)
    ? payload.channels.map((channel: any) => ({
        id: String(channel.id ?? ""),
        kind: channel.kind ?? null,
        name: String(channel.name ?? "WhatsApp Iris"),
        provider: channel.provider ?? null,
        slug: channel.slug ?? null,
        status: String(channel.status ?? "active"),
      }))
    : [];
  const profiles = Array.isArray(payload?.profiles)
    ? payload.profiles.map((profile: any) => {
        const queue = profile.queue_id ? queueById.get(String(profile.queue_id)) : null;

        return {
          category: String(profile.category ?? "Atendimento"),
          description: typeof profile.description === "string" ? profile.description : null,
          id: String(profile.id ?? ""),
          name: String(profile.name ?? "Perfil Iris"),
          priority: normalizeIrisPriority(profile.priority),
          queueId: profile.queue_id ? String(profile.queue_id) : null,
          queueLabel: queue?.name ?? null,
          requiredFields: normalizeRequiredFields(profile.required_fields),
          slaFirstResponseMinutes: Number(profile.sla_first_response_minutes ?? 60),
          slaResolutionMinutes: Number(profile.sla_resolution_minutes ?? 480),
          slug: String(profile.slug ?? ""),
          status: String(profile.status ?? "active"),
        };
      })
    : [];
  const templates = Array.isArray(payload?.templates)
    ? payload.templates.map((template: any) => ({
        body: typeof template.body === "string" ? template.body : null,
        category: template.category ?? null,
        id: String(template.id ?? ""),
        language: String(template.language ?? IRIS_OPT_IN_TEMPLATE.language),
        metaStatus: String(template.metaStatus ?? "APPROVED"),
        name: String(template.name ?? "Template Iris"),
        slug: template.slug ?? null,
        templateName: String(template.templateName ?? template.slug ?? IRIS_OPT_IN_TEMPLATE.name),
      }))
    : [];

  return {
    channels: channels.filter((channel) => channel.id),
    operator: {
      avatarUrl: payload?.operator?.avatarUrl ?? null,
      label: String(payload?.operator?.label ?? EMPTY_FIELD),
    },
    profiles: profiles.filter((profile) => profile.id),
    queues: queues.filter((queue) => queue.id),
    templates: templates.filter((template) => template.id),
  };
}

function findPreferredQueueId(
  queues: IrisTicketQueueOption[],
  profiles: IrisTicketProfileOption[],
) {
  const queue =
    queues.find((item) => isCollectionText(item.slug)) ??
    queues.find((item) => isCollectionText(item.name)) ??
    null;

  if (queue?.id) return queue.id;

  return profiles.find((profile) => isCollectionText(profile.category))?.queueId ?? null;
}

function findDefaultProfileId(
  profiles: IrisTicketProfileOption[],
  queueId?: string | null,
) {
  const scopedProfiles = queueId
    ? profiles.filter((profile) => profile.queueId === queueId)
    : profiles;

  return (
    scopedProfiles.find((profile) => profile.slug === "cobranca")?.id ??
    scopedProfiles.find((profile) => isCollectionText(profile.name))?.id ??
    scopedProfiles[0]?.id ??
    null
  );
}

function isCollectionText(value?: string | null) {
  const normalized = normalizeOptionText(value);

  return normalized.includes("cobranca");
}

function normalizeOptionText(value?: string | null) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function normalizeAttendanceProtocol(value?: string | null) {
  const normalized = String(value ?? "").trim().toUpperCase();

  return /^AT-\d{1,12}$/.test(normalized) ? normalized : null;
}

function findLatestAttendanceProtocol(client: QueueClient) {
  return (
    client.timeline
      ?.map((event) => normalizeAttendanceProtocol(event.protocol))
      .filter(Boolean)
      .at(-1) ?? null
  );
}

function normalizeRequiredFields(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).filter(Boolean);
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return normalizeRequiredFields(parsed);
    } catch {
      return value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function normalizeIrisPriority(value: unknown): IrisTicketPriority {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "medium";
}

function mapIrisPriority(priority: IrisTicketPriority) {
  if (priority === "critical") return "Crítica";
  if (priority === "high") return "Alta";
  if (priority === "low") return "Baixa";
  return "Média";
}

function requiresIrisUnit(profile?: IrisTicketProfileOption | null) {
  if (!profile) return false;

  return (
    profile.requiredFields.includes("source_entity_id") ||
    ["enviar-boleto-c2x", "negociacao", "formalizacao-acordo", "duvida-contratual"].includes(profile.slug)
  );
}

function requiresIrisInstallment(profile?: IrisTicketProfileOption | null) {
  if (!profile) return false;

  return [
    "cobranca",
    "enviar-boleto-c2x",
    "negociacao",
    "promessa-pagamento",
    "formalizacao-acordo",
    "quebra-promessa",
  ].includes(profile.slug);
}

function createsIrisSla(profile?: IrisTicketProfileOption | null) {
  return Boolean(profile && profile.slaFirstResponseMinutes > 0);
}

function formatSlaMinutes(minutes: number) {
  if (!minutes || minutes <= 0) return "Sem SLA";
  if (minutes < 60) return `${minutes} min`;

  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${hours} horas` : `${minutes} min`;
}

function templateStatusLabel(status?: string | null) {
  if (!status) return "Nao localizado";
  if (status === "APPROVED") return "Aprovado";
  if (status === "PENDING") return "Pendente";
  if (status === "REJECTED") return "Rejeitado";
  if (status === "PAUSED") return "Pausado";
  return status;
}

function buildInstallmentOptions(client: QueueClient, selectedUnitIds: string[] = []) {
  const allowedUnitIds = new Set(selectedUnitIds);

  return (client.c2xInstallments ?? [])
    .filter((installment) => !allowedUnitIds.size || allowedUnitIds.has(installment.unitId))
    .map((installment) => ({
      label: `${installment.unitCode ?? installment.unitLabel ?? "Unidade"} · ${installment.number} · ${installment.dueDate} · ${installment.value}`,
      value: `${installment.id} | ${installment.unitId} | ${installment.number} | ${installment.dueDate} | ${installment.value}`,
    }));
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

function formatDateTime(value?: string | null) {
  if (!value) return EMPTY_FIELD;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return EMPTY_FIELD;

  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  });
}

function formatTime(value?: string | null) {
  if (!value) return EMPTY_FIELD;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return EMPTY_FIELD;

  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function EditableField({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="min-w-0 rounded-xl border border-slate-200/70 bg-white px-3 py-2.5">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-7 w-full min-w-0 rounded-md border border-transparent bg-slate-50/80 px-2 text-sm font-semibold text-slate-950 outline-none transition-colors focus:border-[#A07C3B]/35 focus:bg-white focus:ring-2 focus:ring-[#A07C3B]/10"
      />
    </label>
  );
}

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center">
      <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200/70">
        {label}
      </span>
    </div>
  );
}

function buildMessages(client: QueueClient): WhatsAppMessage[] {
  const currentProtocol = EMPTY_FIELD;

  return [
    {
      id: `${client.id}-msg-empty`,
      author: "operator",
      body: EMPTY_FIELD,
      date: EMPTY_FIELD,
      kind: "text",
      operator: client.responsavel,
      status: "entregue",
      ticketProtocol: currentProtocol,
      time: EMPTY_FIELD,
    },
  ];

  return [
    {
      id: `${client.id}-msg-history-1`,
      author: "operator",
      body: "Primeiro contato realizado para confirmar melhor canal de atendimento.",
      date: "02/05/2026",
      kind: "text",
      operator: client.responsavel,
      status: "lida",
      ticketProtocol: guardianProtocol(179),
      time: "10:12",
    },
    {
      id: `${client.id}-msg-history-2`,
      author: "client",
      body: "Prefiro tratar pelo WhatsApp, consigo responder mais rápido por aqui.",
      date: "02/05/2026",
      kind: "text",
      ticketProtocol: guardianProtocol(179),
      time: "10:18",
    },
    {
      id: `${client.id}-msg-history-3`,
      author: "operator",
      body: "Enviei o boleto original do C2X e mantive o vencimento exibido na consulta.",
      date: "05/05/2026",
      fileName: "boleto-c2x-parcela-03.pdf",
      kind: "document",
      operator: client.responsavel,
      status: "entregue",
      ticketProtocol: guardianProtocol(180),
      time: "14:03",
    },
    {
      id: `${client.id}-msg-history-4`,
      author: "client",
      body: "Recebi, mas não vou conseguir pagar tudo nessa data.",
      date: "05/05/2026",
      kind: "text",
      ticketProtocol: guardianProtocol(180),
      time: "14:26",
    },
    {
      id: `${client.id}-msg-history-5`,
      author: "operator",
      body: "Podemos registrar uma promessa parcial e acompanhar a compensação.",
      date: "07/05/2026",
      kind: "text",
      operator: client.responsavel,
      status: "lida",
      ticketProtocol: guardianProtocol(181),
      time: "11:35",
    },
    {
      id: `${client.id}-msg-history-6`,
      author: "client",
      body: EMPTY_FIELD,
      date: "07/05/2026",
      kind: "text",
      ticketProtocol: guardianProtocol(181),
      time: "11:42",
    },
    {
      id: `${client.id}-msg-history-7`,
      author: "operator",
      body: "Não localizamos a compensação da promessa. Quer reagendar ou simular um acordo?",
      date: "09/05/2026",
      kind: "text",
      operator: client.responsavel,
      status: "entregue",
      ticketProtocol: guardianProtocol(182),
      time: "15:08",
    },
    {
      id: `${client.id}-msg-history-8`,
      author: "client",
      body: "Vamos simular acordo, tive uma despesa fora do previsto.",
      date: "09/05/2026",
      kind: "text",
      ticketProtocol: guardianProtocol(182),
      time: "15:21",
    },
    {
      id: `${client.id}-msg-1`,
      author: "operator",
      body: `Olá, ${firstName(client.nome)} ??. Identificamos pendências no empreendimento ${client.carteira.empreendimento}. Podemos te ajudar a regularizar?`,
      date: "10/05/2026",
      kind: "text",
      operator: client.responsavel,
      status: "lida",
      ticketProtocol: guardianProtocol(183),
      time: "16:48",
    },
    {
      id: `${client.id}-msg-2`,
      author: "client",
      body: "Boa tarde. Consigo pagar uma parte essa semana, mas preciso entender o valor atualizado.",
      date: "10/05/2026",
      kind: "text",
      ticketProtocol: guardianProtocol(183),
      time: "17:02",
    },
    {
      id: `${client.id}-msg-3`,
      author: "operator",
      body: "Boleto original do C2X enviado",
      date: "10/05/2026",
      fileName: "boleto-original-c2x.pdf",
      kind: "document",
      operator: client.responsavel,
      status: "entregue",
      ticketProtocol: guardianProtocol(183),
      time: "17:04",
    },
    {
      id: `${client.id}-msg-4`,
      author: "operator",
      body: `Hoje o saldo em atraso está em ${client.saldoDevedor}. Posso simular entrada e parcelamento para reduzir o impacto.`,
      date: "10/05/2026",
      kind: "text",
      operator: client.responsavel,
      status: "entregue",
      ticketProtocol: currentProtocol,
      time: "17:05",
    },
    {
      id: `${client.id}-msg-5`,
      author: "client",
      body: "Áudio recebido",
      date: "Hoje",
      duration: "0:19",
      kind: "audio",
      ticketProtocol: currentProtocol,
      time: "09:16",
    },
    {
      id: `${client.id}-msg-6`,
      author: "client",
      body: EMPTY_FIELD,
      date: "Hoje",
      kind: "text",
      ticketProtocol: currentProtocol,
      time: "09:18",
    },
  ];
}

function buildTicketCycles(
  client: QueueClient,
  currentTicket: WhatsAppTicket,
  selectedUnit?: PortfolioUnit
): TicketCycle[] {
  const fallbackUnit = selectedUnit ?? client.carteira.unidades[0];

  return [
    {
      protocol: currentTicket.protocol,
      profileName: currentTicket.profileName || EMPTY_FIELD,
      operator: client.responsavel,
      openedAt: currentTicket.openedAt ?? EMPTY_FIELD,
      status: currentTicket.status,
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
  ];

  const previous: TicketCycle[] = [
    {
      protocol: guardianProtocol(178),
      profileName: "Atualização cadastral",
      operator: "Camila Rocha",
      openedAt: "29/04/2026 • 09:20",
      status: "Encerrado",
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
    {
      protocol: guardianProtocol(179),
      profileName: "Primeiro contato",
      operator: client.responsavel,
      openedAt: "02/05/2026 • 10:12",
      status: "Encerrado",
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
    {
      protocol: guardianProtocol(180),
      profileName: "Enviar boleto C2X",
      operator: client.responsavel,
      openedAt: "05/05/2026 • 14:03",
      status: "Encerrado",
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
    {
      protocol: guardianProtocol(181),
      profileName: "Promessa de pagamento",
      operator: client.responsavel,
      openedAt: "07/05/2026 • 11:35",
      status: "Convertido em promessa",
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
    {
      protocol: guardianProtocol(182),
      profileName: "Quebra de promessa",
      operator: client.responsavel,
      openedAt: "09/05/2026 • 15:08",
      status: "Encerrado",
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
    {
      protocol: guardianProtocol(183),
      profileName: "Cobrança",
      operator: client.responsavel,
      openedAt: "10/05/2026 • 16:48",
      status: "Aguardando cliente",
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
  ];

  return [
    ...previous,
    {
      protocol: currentTicket.protocol,
      profileName: currentTicket.profileName,
      operator: client.responsavel,
      openedAt: currentTicket.openedAt ?? "11/05/2026 • 12:30",
      status: currentTicket.status,
      unitCode: fallbackUnit?.matricula,
      unitLabel: fallbackUnit?.unidadeLote,
    },
  ];
}
function buildConversationList(client: QueueClient) {
  return [
    { id: client.id, name: client.nome, preview: "-", time: "-" },
  ];
}

function buildC2xBoletos(client: QueueClient): C2xBoleto[] {
  return (client.c2xInstallments ?? []).map((installment) => ({
    id: installment.id,
    linhaDigitavel: "-",
    parcela: installment.number,
    status: installment.status,
    valor: installment.value,
    vencimento: installment.dueDate,
  }));
}

function calculateAgreement(originalValue: string, discount: string, entry: string, installmentsCount: string) {
  const original = parseMoney(originalValue);
  const discountRate = Number.parseFloat(discount.replace(/[^\d,.-]/g, "").replace(",", ".")) / 100 || 0;
  const negotiated = Math.max(original * (1 - discountRate), 0);
  const entryValue = parseMoney(entry);
  const count = Math.max(Number.parseInt(installmentsCount, 10) || 1, 1);
  const balance = Math.max(negotiated - entryValue, 0);

  return {
    entryRate: negotiated > 0 ? Math.round((entryValue / negotiated) * 100) : 0,
    installmentBalance: formatMoney(balance),
    installmentValue: formatMoney(balance / count),
    negotiatedValue: formatMoney(negotiated),
    recoveryRate: original > 0 ? Math.round((negotiated / original) * 100) : 0,
  };
}

function parseMoney(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  return Number.parseFloat(normalized) || 0;
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function guardianProtocol(seed: number) {
  return `GDN-${String(Math.max(seed, 1)).padStart(6, "0")}`;
}

function firstName(name: string) {
  return name.split(" ")[0] ?? name;
}





