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
import type {
  OperationalTimelineEvent,
  PortfolioUnit,
  QueueClient,
} from "@/modules/guardian/attendance/types";

type WhatsAppConversationPanelProps = {
  client: QueueClient;
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
type TicketChannel = "WhatsApp" | "ligação" | "e-mail" | "presencial" | "todos";
type TicketProfile = {
  id: string;
  name: string;
  description: string;
  category: string;
  active: boolean;
  requiresUnit: boolean;
  requiresInstallment: boolean;
  createsSla: boolean;
  defaultSlaHours: number;
  defaultPriority: "Crítica" | "Alta" | "Média" | "Baixa";
  allowedChannel: TicketChannel;
  displayOrder: number;
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
  protocol: string;
  origin: TicketOrigin;
  profileId: string;
  profileName: string;
  profileCategory: string;
  priority: TicketProfile["defaultPriority"];
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

const ticketProfiles: TicketProfile[] = [
  {
    id: "first-contact",
    name: "Primeiro contato",
    description: "Abertura inicial de relacionamento operacional para inadimplência recente.",
    category: "Contato",
    active: true,
    requiresUnit: false,
    requiresInstallment: false,
    createsSla: true,
    defaultSlaHours: 24,
    defaultPriority: "Média",
    allowedChannel: "todos",
    displayOrder: 1,
  },
  {
    id: "collection",
    name: "Cobrança",
    description: "Contato ativo para recuperação de parcelas vencidas.",
    category: "Cobrança",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 8,
    defaultPriority: "Alta",
    allowedChannel: "todos",
    displayOrder: 2,
  },
  {
    id: "payment-reminder",
    name: "Lembrete de pagamento",
    description: "Lembrete preventivo ou reforço de compromisso já combinado.",
    category: "Cobrança",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 12,
    defaultPriority: "Média",
    allowedChannel: "WhatsApp",
    displayOrder: 3,
  },
  {
    id: "boleto-copy",
    name: "Enviar boleto C2X",
    description: "Consulta e envio do boleto original mantido pelo C2X.",
    category: "Financeiro",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 4,
    defaultPriority: "Alta",
    allowedChannel: "WhatsApp",
    displayOrder: 4,
  },
  {
    id: "negotiation",
    name: "Negociação",
    description: "Simulação e condução de proposta para regularização do saldo.",
    category: "Negociação",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 6,
    defaultPriority: "Alta",
    allowedChannel: "todos",
    displayOrder: 5,
  },
  {
    id: "promise",
    name: "Promessa de pagamento",
    description: "Registro de promessa feita pelo cliente com data e valor combinados.",
    category: "Compromisso",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 24,
    defaultPriority: "Alta",
    allowedChannel: "WhatsApp",
    displayOrder: 6,
  },
  {
    id: "agreement-formalization",
    name: "Formalização de acordo",
    description: "Coleta de confirmação e formalização de acordo operacional.",
    category: "Acordo",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 6,
    defaultPriority: "Alta",
    allowedChannel: "todos",
    displayOrder: 7,
  },
  {
    id: "broken-promise",
    name: "Quebra de promessa",
    description: "Tratativa posterior ao não cumprimento de promessa registrada.",
    category: "Risco",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 4,
    defaultPriority: "Crítica",
    allowedChannel: "todos",
    displayOrder: 8,
  },
  {
    id: "reactivation",
    name: "Reativação de acordo",
    description: "Retomada de acordo quebrado ou negociação interrompida.",
    category: "Acordo",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 8,
    defaultPriority: "Alta",
    allowedChannel: "todos",
    displayOrder: 9,
  },
  {
    id: "registration-update",
    name: "Atualização cadastral",
    description: "Correção ou complemento de dados cadastrais do cliente.",
    category: "Cadastro",
    active: true,
    requiresUnit: false,
    requiresInstallment: false,
    createsSla: false,
    defaultSlaHours: 0,
    defaultPriority: "Baixa",
    allowedChannel: "todos",
    displayOrder: 10,
  },
  {
    id: "financial-question",
    name: "Dúvida financeira",
    description: "Esclarecimento de valores, atualização, juros, boletos e vencimentos.",
    category: "Financeiro",
    active: true,
    requiresUnit: true,
    requiresInstallment: false,
    createsSla: true,
    defaultSlaHours: 12,
    defaultPriority: "Média",
    allowedChannel: "todos",
    displayOrder: 11,
  },
  {
    id: "legal-forwarding",
    name: "Encaminhamento jurídico",
    description: "Ticket crítico para orientar ou registrar avanço ao jurídico.",
    category: "Jurídico",
    active: true,
    requiresUnit: true,
    requiresInstallment: true,
    createsSla: true,
    defaultSlaHours: 2,
    defaultPriority: "Crítica",
    allowedChannel: "todos",
    displayOrder: 12,
  },
];

const whatsAppTicketProfiles = ticketProfiles
  .filter((profile) => profile.active && (profile.allowedChannel === "WhatsApp" || profile.allowedChannel === "todos"))
  .sort((a, b) => a.displayOrder - b.displayOrder);

export function WhatsAppConversationPanel({
  client,
  initialOrigin = "Careli iniciou",
  onClose,
  onTimelineEvent,
  open,
}: WhatsAppConversationPanelProps) {
  const [selectedUnitId, setSelectedUnitId] = useState(client.carteira.unidades[0]?.id ?? "");
  const [templateOpen, setTemplateOpen] = useState(false);
  const [operationDrawer, setOperationDrawer] = useState<OperationDrawerMode | null>(null);
  const [ticketSetupOpen, setTicketSetupOpen] = useState(initialOrigin === "Careli iniciou");
  const [ticketIncomplete, setTicketIncomplete] = useState(initialOrigin === "Cliente iniciou");
  const [ticketCloseOpen, setTicketCloseOpen] = useState(false);
  const [ticket, setTicket] = useState<WhatsAppTicket>({
    protocol: guardianProtocol(184),
    origin: initialOrigin,
    profileId: "negotiation",
    profileName: "Negociação",
    profileCategory: "Negociação",
    priority: "Alta",
    slaHours: 6,
    relatedInstallments: ["03/60", "04/60"],
    status: initialOrigin === "Cliente iniciou" ? "Aguardando operador" : "Pendente",
  });
  const [feedback, setFeedback] = useState("");
  const [draft, setDraft] = useState("");
  const [showPreviousTickets, setShowPreviousTickets] = useState(false);
  const [conversationListCollapsed, setConversationListCollapsed] = useState(false);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [messages, setMessages] = useState<WhatsAppMessage[]>(() => buildMessages(client));
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

  const ticketClosed = ticket.status === "Encerrado" || ticket.status === "Cancelado";
  const ticketActive = ticket.status !== "Pendente" && !ticketClosed;
  const currentTicketProfile = whatsAppTicketProfiles.find((profile) => profile.id === ticket.profileId);
  const ticketChecklist: TicketChecklistItem[] = [
    { id: "profile", label: "Perfil", ok: Boolean(ticket.profileId && ticket.profileName) },
    { id: "unit", label: "Unidade", ok: !currentTicketProfile?.requiresUnit || Boolean(selectedUnitId) },
    {
      id: "installments",
      label: "Parcelas",
      ok: !currentTicketProfile?.requiresInstallment || ticket.relatedInstallments.length > 0,
      warning: Boolean(currentTicketProfile?.requiresInstallment && ticket.relatedInstallments.length === 0),
    },
    { id: "priority", label: "Prioridade", ok: Boolean(ticket.priority) },
    { id: "sla", label: "SLA", ok: !currentTicketProfile?.createsSla || ticket.slaHours > 0 },
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
      description: `Operador abriu o Ticket ${ticket.protocol} no CareDesk para tratar mensagem recebida do cliente.`,
      occurredAt: "11/05/2026 12:30",
      operator: client.responsavel,
      status: "Registrado",
      unitCode: selectedUnit?.matricula,
      unitLabel: selectedUnit?.unidadeLote,
    });
  }, [client.id, client.responsavel, initialOrigin, onTimelineEvent, selectedUnit?.matricula, selectedUnit?.unidadeLote, ticket.protocol]);

  if (!open) return null;

  function openTicket(profileId: string, unitId?: string, relatedInstallments: string[] = []) {
    if (unitId) setSelectedUnitId(unitId);
    const unit = client.carteira.unidades.find((item) => item.id === unitId) ?? selectedUnit;
    const profile = whatsAppTicketProfiles.find((item) => item.id === profileId) ?? whatsAppTicketProfiles[0];
    const completingAutoTicket = ticketIncomplete;

    setTicket((current) => ({
      ...current,
      origin: current.origin,
      profileId: profile.id,
      profileName: profile.name,
      profileCategory: profile.category,
      priority: profile.defaultPriority,
      slaHours: profile.defaultSlaHours,
      relatedInstallments,
      status: "Em atendimento",
      openedAt: "11/05/2026 12:30",
    }));
    setTicketSetupOpen(false);
    setTicketIncomplete(false);
    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: completingAutoTicket ? `${client.id}-whatsapp-ticket-completed` : `${client.id}-whatsapp-ticket-open`,
      protocol: ticket.protocol,
      type: "Observação operacional",
      title: completingAutoTicket ? "Dados do ticket completados" : "Ticket WhatsApp iniciado pela Careli",
      description: completingAutoTicket
        ? `Dados obrigatórios do Ticket ${ticket.protocol} completados pelo operador. Perfil: ${profile.name}.`
        : `Atendimento iniciado pela Careli no WhatsApp com perfil ${profile.name}. Prioridade ${profile.defaultPriority}${profile.createsSla ? ` e SLA de ${profile.defaultSlaHours}h` : ""}.`,
      occurredAt: "11/05/2026 12:30",
      operator: client.responsavel,
      status: "Registrado",
      unitCode: unit?.matricula,
      unitLabel: unit?.unidadeLote,
    });
  }

  function changeTicketProfile(profileId: string) {
    const profile = whatsAppTicketProfiles.find((item) => item.id === profileId);
    if (!profile || profile.id === ticket.profileId || !ticketActive) return;

    setTicket((current) => ({
      ...current,
      profileId: profile.id,
      profileName: profile.name,
      profileCategory: profile.category,
      priority: profile.defaultPriority,
      slaHours: profile.defaultSlaHours,
      relatedInstallments:
        profile.requiresInstallment && current.relatedInstallments.length === 0
          ? ["03/60"]
          : current.relatedInstallments,
    }));
    setFeedback(`Perfil do ticket alterado para ${profile.name}. Histórico operacional atualizado.`);
    onTimelineEvent(client.id, {
      actionType: "ticket",
      id: `${client.id}-whatsapp-ticket-profile-${profile.id}`,
      protocol: ticket.protocol,
      type: "Observação operacional",
      title: "Perfil do ticket alterado",
      description: `Perfil do Ticket ${ticket.protocol} alterado para ${profile.name}. Prioridade padrão ${profile.defaultPriority}${profile.createsSla ? `, SLA ${profile.defaultSlaHours}h` : ", sem SLA"}.`,
      occurredAt: "11/05/2026 12:42",
      operator: client.responsavel,
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

  function sendMessage(kind: MessageKind = "text") {
    if (!operationReady) return;
    const body = draft.trim();
    if (kind === "text" && !body) return;

    const nextIndex = messages.length + 1;
    const message: WhatsAppMessage = {
      id: `${client.id}-sent-${nextIndex}`,
      author: "operator",
      body:
        kind === "audio"
          ? "Mensagem de áudio enviada"
          : kind === "document"
            ? "Boleto original do C2X enviado para conferência"
            : body,
      date: "Hoje",
      duration: kind === "audio" ? "0:28" : undefined,
      fileName: kind === "document" ? "boleto-original-c2x.pdf" : undefined,
      kind,
      operator: client.responsavel,
      status: "enviada",
      ticketProtocol: ticket.protocol,
      time: "12:40",
    };

    setMessages((current) => [...current, message]);
    setDraft("");
    onTimelineEvent(client.id, {
      actionType: "Mensagem WhatsApp",
      id: `${client.id}-whatsapp-live-${nextIndex}`,
      protocol: ticket.protocol,
      type: "WhatsApp enviado",
      title:
        kind === "audio"
          ? "Áudio WhatsApp enviado"
          : kind === "document"
            ? "Documento WhatsApp enviado"
            : "Mensagem WhatsApp enviada",
      description: `Operador enviou ${kind === "text" ? "mensagem" : kind === "audio" ? "áudio" : "documento"} no ticket ${ticket.protocol}: ${message.body}`,
      occurredAt: "11/05/2026 12:40",
      operator: client.responsavel,
      unitCode: selectedUnit?.matricula,
      unitLabel: selectedUnit?.unidadeLote,
      status: "Enviado",
    });
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
                        <span
                          title="Ticket criado automaticamente após mensagem recebida."
                          className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15"
                        >
                          ⚡ Autoaberto
                        </span>
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
                      {whatsAppTicketProfiles.map((profile) => (
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
                          protocol: guardianProtocol(185),
                          origin: "Careli iniciou",
                          profileId: "first-contact",
                          profileName: "Primeiro contato",
                          profileCategory: "Contato",
                          priority: "Média",
                          slaHours: 24,
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
                  <span>⚠ Complete o ticket para iniciar o atendimento</span>
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
              <ComposerIconButton disabled={!operationReady} label="Emoji" onClick={() => setDraft((current) => `${current}🙂`)}>
                <Smile className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <ComposerIconButton disabled={!operationReady} label="Anexar arquivo" onClick={() => sendMessage("document")}>
                <Paperclip className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={operationReady ? "Escrever mensagem WhatsApp..." : "Ticket incompleto"}
                disabled={!operationReady}
                className="min-h-11 flex-1 resize-none bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-400"
              />
              <ComposerIconButton disabled={!operationReady} label="Enviar áudio" onClick={() => sendMessage("audio")}>
                <Mic className="size-4" aria-hidden="true" />
              </ComposerIconButton>
              <button
                type="button"
                disabled={!operationReady}
                onClick={() => sendMessage("text")}
                title={operationReady ? "Enviar mensagem" : blockedTooltip}
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
                aria-label={operationReady ? "Enviar mensagem" : blockedTooltip}
              >
                <Send className="size-4" aria-hidden="true" />
              </button>
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
              <button
                type="button"
                onClick={() => setContextCollapsed(false)}
                title="Expandir contexto"
                className="flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                aria-label="Expandir contexto"
              >
                <PanelRightOpen className="size-4" aria-hidden="true" />
              </button>
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
          client={client}
          defaultProfileId={ticket.profileId}
          mode={ticketIncomplete ? "complete" : "open"}
          onOpenTicket={openTicket}
          selectedUnitId={selectedUnit?.id}
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
  client,
  defaultProfileId,
  mode = "open",
  onOpenTicket,
  selectedUnitId,
}: {
  client: QueueClient;
  defaultProfileId: string;
  mode?: "open" | "complete";
  onOpenTicket: (profileId: string, unitId?: string, relatedInstallments?: string[]) => void;
  selectedUnitId?: string;
}) {
  const [profileId, setProfileId] = useState(defaultProfileId);
  const [unitId, setUnitId] = useState(selectedUnitId ?? client.carteira.unidades[0]?.id ?? "");
  const [relatedInstallments, setRelatedInstallments] = useState<string[]>(["03/60", "04/60"]);
  const [initialNote, setInitialNote] = useState("");
  const selectedProfile = whatsAppTicketProfiles.find((profile) => profile.id === profileId) ?? whatsAppTicketProfiles[0];
  const installmentOptions = ["03/60", "04/60", "05/60", "06/60"];
  const missingProfile = !profileId;
  const missingUnit = selectedProfile.requiresUnit && !unitId;
  const missingInstallment = selectedProfile.requiresInstallment && relatedInstallments.length === 0;
  const missingPriority = !selectedProfile.defaultPriority;
  const missingSla = selectedProfile.createsSla && selectedProfile.defaultSlaHours <= 0;
  const canOpenTicket = !missingProfile && !missingUnit && !missingInstallment && !missingPriority && !missingSla;

  function toggleInstallment(installment: string) {
    setRelatedInstallments((current) =>
      current.includes(installment)
        ? current.filter((item) => item !== installment)
        : [...current, installment]
    );
  }

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-950/25 px-4 backdrop-blur-[2px]">
      <section className="w-full max-w-4xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.2)]">
        <header className="border-b border-slate-100 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
            {mode === "complete" ? "Completar ticket" : "Abertura de ticket"}
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">
            {mode === "complete" ? "Completar dados do atendimento" : "Iniciar atendimento WhatsApp"}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {mode === "complete"
              ? "Complete os dados operacionais do ticket criado automaticamente pela mensagem do cliente."
              : "Selecione um perfil cadastrado no Setup para aplicar prioridade, SLA e exigências operacionais."}
          </p>
        </header>

        <div className="grid max-h-[68vh] gap-4 overflow-y-auto p-5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin] lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadonlyField label="Cliente" value={client.nome} />
              <ReadonlyField label="Telefone" value={client.dados360.telefone} />
              <ReadonlyField label="Canal" value="WhatsApp" />
              <ReadonlyField label="Operador responsável" value={client.responsavel} />
            </div>

            <label className="block rounded-xl border border-[#A07C3B]/15 bg-[#A07C3B]/5 p-3">
              <span className="mb-2 block text-xs font-semibold text-[#7A5E2C]">Perfil do ticket</span>
              <select
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
                className="h-10 w-full rounded-lg border border-[#A07C3B]/20 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition-colors focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
              >
                {whatsAppTicketProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-sm leading-6 text-slate-600">{selectedProfile.description}</p>
            </label>

            <div className="grid gap-3 sm:grid-cols-3">
              <ReadonlyField label="Categoria" value={selectedProfile.category} />
              <ReadonlyField label="Prioridade padrão" value={selectedProfile.defaultPriority} />
              <ReadonlyField label="SLA padrão" value={selectedProfile.createsSla ? `${selectedProfile.defaultSlaHours} horas` : "Não gera SLA"} />
            </div>

            {selectedProfile.requiresUnit ? (
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-slate-500">Cod. unidade obrigatório</span>
                <select
                  value={unitId}
                  onChange={(event) => setUnitId(event.target.value)}
                  className="h-10 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-800 outline-none transition-colors focus:border-[#A07C3B]/35 focus:ring-2 focus:ring-[#A07C3B]/10"
                >
                  {client.carteira.unidades.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.matricula} · {unit.empreendimento} · {unit.unidadeLote}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <ReadonlyField label="Unidade relacionada" value="Opcional para este perfil" />
            )}

            {selectedProfile.requiresInstallment ? (
              <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
                <p className="text-xs font-semibold text-slate-500">Parcelas relacionadas obrigatórias</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {installmentOptions.map((installment) => {
                    const active = relatedInstallments.includes(installment);

                    return (
                      <button
                        key={installment}
                        type="button"
                        onClick={() => toggleInstallment(installment)}
                        className={`h-8 rounded-lg px-3 text-xs font-semibold transition-colors ${
                          active
                            ? "bg-[#A07C3B] text-white"
                            : "border border-slate-200/70 bg-white text-slate-600 hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5"
                        }`}
                      >
                        {installment}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <ReadonlyField label="Parcelas relacionadas" value="Não obrigatório para este perfil" />
            )}

            <label className="block rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <span className="text-xs font-semibold text-slate-500">Observação inicial, se necessário</span>
              <textarea
                value={initialNote}
                onChange={(event) => setInitialNote(event.target.value)}
                className="mt-2 min-h-20 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm leading-6 text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
                placeholder="Contexto breve do atendimento..."
              />
            </label>
          </div>

          <aside className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Perfis cadastrados no Setup</p>
            <div className="mt-3 space-y-2">
              {whatsAppTicketProfiles.slice(0, 8).map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => setProfileId(profile.id)}
                  className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                    profile.id === profileId
                      ? "border-[#A07C3B]/30 bg-white"
                      : "border-slate-200/70 bg-white/60 hover:bg-white"
                  }`}
                >
                  <p className="text-xs font-semibold text-slate-950">{profile.name}</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">
                    {profile.category} · {profile.defaultPriority} · {profile.createsSla ? `${profile.defaultSlaHours}h` : "sem SLA"}
                  </p>
                </button>
              ))}
            </div>
          </aside>
        </div>

        <footer className="border-t border-slate-100 p-4">
          {!canOpenTicket ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              {missingProfile
                ? "Selecione um perfil de ticket."
                : missingUnit
                  ? "Selecione uma unidade para este perfil."
                  : missingInstallment
                    ? "Selecione ao menos uma parcela relacionada para este perfil."
                    : missingPriority
                      ? "Defina a prioridade do perfil."
                      : "Defina o SLA do perfil."}
            </p>
          ) : null}
          <button
            type="button"
            disabled={!canOpenTicket}
            onClick={() => onOpenTicket(profileId, unitId, relatedInstallments)}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            {mode === "complete" ? "Salvar e assumir atendimento" : "Abrir ticket"}
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
      <section className="w-full max-w-xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.2)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Encerrar atendimento</p>
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
            <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">Observação final</span>
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
  const [promisedDate, setPromisedDate] = useState("20/05/2026");
  const [originalValue, setOriginalValue] = useState(client.agreement.originalDebt);
  const [discount, setDiscount] = useState(client.agreement.discount);
  const [entry, setEntry] = useState(client.agreement.entry);
  const [entryDueDate, setEntryDueDate] = useState("18/05/2026");
  const [installmentsCount, setInstallmentsCount] = useState(`${client.agreement.installmentsCount}`);
  const [firstDueDate, setFirstDueDate] = useState("10/06/2026");
  const c2xBoletos = useMemo(() => buildC2xBoletos(client), [client]);
  const [selectedBoletoId, setSelectedBoletoId] = useState(c2xBoletos[0]?.id ?? "");
  const selectedBoleto = c2xBoletos.find((boleto) => boleto.id === selectedBoletoId) ?? c2xBoletos[0];
  const [note, setNote] = useState(
    isPromise
      ? "Promessa registrada a partir de conversa positiva no WhatsApp."
      : isBoleto
        ? "Envio do boleto original consultado no C2X pelo WhatsApp."
        : mode === "installments"
          ? "Consulta de parcelas e boletos originais do C2X registrada no atendimento."
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
        occurredAt: "11/05/2026 12:44",
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
      occurredAt: "11/05/2026 12:44",
      operator: client.responsavel,
      status: isPromise ? "Prometido" : "Gerado",
      unitCode: unit?.matricula,
      unitLabel: unit?.unidadeLote,
    });
  }

  return (
    <div className="absolute inset-0 z-30 flex justify-end bg-slate-950/25 backdrop-blur-[2px]">
      <aside className="flex h-full w-full max-w-xl flex-col border-l border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
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
                <ReadonlyField label="Parcelas relacionadas" value="04/60, 05/60" />
                <EditableField label="Valor prometido" value={promisedValue} onChange={setPromisedValue} />
                <EditableField label="Data prometida" value={promisedDate} onChange={setPromisedDate} />
              </>
            ) : isAgreement ? (
              <>
                <ReadonlyField label="Parcelas incluídas" value="03/60, 04/60, 05/60" />
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
                <ReadonlyField label="Ação do Guardian" value={isBoleto ? "Enviar boleto original" : "Consultar boletos originais"} />
                <ReadonlyField label="Saldo em atraso" value={client.saldoDevedor} />
                <ReadonlyField label="Preparado para" value="visualizado, vencido, pago e reenvio" />
              </>
            )}
          </div>

          {isBoleto || mode === "installments" ? (
            <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Consulta C2X</p>
                  <p className="mt-1 text-sm font-semibold text-slate-950">Boletos originais vinculados à unidade</p>
                </div>
                <span className="w-fit rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500 ring-1 ring-slate-200">
                  Guardian não gera boletos
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
                      <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">Preview C2X</p>
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
            <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">Observação</span>
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
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Contexto</p>
            <h3 className="mt-1 truncate text-sm font-semibold text-slate-950">{client.nome}</h3>
            <p className="mt-0.5 text-xs text-slate-500">{client.dados360.telefone}</p>
          </div>
          <button
            type="button"
            onClick={onCollapse}
            title="Recolher contexto"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-50 hover:text-[#7A5E2C]"
            aria-label="Recolher contexto"
          >
            <PanelRightClose className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg bg-slate-100/70 p-1 [scrollbar-width:none]">
          {contextTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                aria-label={tab.label}
                className={`flex size-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                  activeTab === tab.id ? "bg-white text-[#7A5E2C] shadow-sm" : "text-slate-500 hover:bg-white/70"
                }`}
              >
                <Icon className="size-4" aria-hidden="true" />
              </button>
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
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">Unidades</p>
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
              <button
                type="button"
                title="Completar perfil, unidade e parcelas do ticket autoaberto."
                onClick={onCompleteTicket}
                className="inline-flex h-9 w-full items-center justify-center rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35]"
              >
                Completar ticket
              </button>
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
      <section className="w-full max-w-2xl rounded-2xl border border-slate-200/70 bg-white shadow-[0_20px_70px_rgba(15,23,42,0.2)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Templates WhatsApp</p>
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
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="group relative flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] focus-visible:ring-2 focus-visible:ring-[#A07C3B]/20"
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="pointer-events-none absolute left-1/2 top-full z-30 mt-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.12)] group-hover:block">
        {label}
      </span>
    </button>
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      className="group relative flex size-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      <Icon className="size-4" aria-hidden="true" />
      <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-[0_10px_30px_rgba(15,23,42,0.12)] group-hover:block">
        {label}
      </span>
    </button>
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
        <span
          key={item.id}
          title={item.ok ? `${item.label} validado` : `${item.label} obrigatório`}
          className={`inline-flex h-6 items-center gap-1 rounded-full px-2 text-[11px] font-semibold ring-1 ${
            item.ok
              ? "bg-emerald-50 text-emerald-700 ring-emerald-100"
              : "bg-amber-50 text-amber-800 ring-amber-200"
          } ${compact ? "px-1.5" : ""}`}
        >
          <span aria-hidden="true">{item.ok ? "✔" : "⚠"}</span>
          {item.label}
        </span>
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
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex size-10 shrink-0 items-center justify-center rounded-xl text-slate-500 transition-colors hover:bg-white hover:text-[#A07C3B] disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent"
    >
      {children}
    </button>
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
  const currentProtocol = guardianProtocol(184);

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
      body: "Consigo prometer R$ 1.200,00 para sexta-feira.",
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
      body: `Olá, ${firstName(client.nome)} 🙂. Identificamos pendências no empreendimento ${client.carteira.empreendimento}. Podemos te ajudar a regularizar?`,
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
      body: "Pode me mandar uma proposta com entrada menor? Se couber no orçamento eu confirmo.",
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
    { id: client.id, name: client.nome, preview: "Pode me mandar uma proposta com entrada menor?", time: "09:18" },
    { id: "mock-2", name: "Mariana Costa Lima", preview: "Vou conferir o boleto C2X.", time: "08:44" },
    { id: "mock-3", name: "Bruno Azevedo", preview: "Preciso reagendar a promessa.", time: "Ontem" },
  ];
}

function buildC2xBoletos(client: QueueClient): C2xBoleto[] {
  const base = client.parcelas.ultimaParcela;

  return [
    {
      id: `${client.id}-c2x-03`,
      parcela: "03/60",
      vencimento: "10/05/2026",
      valor: base,
      status: "Vencido",
      linhaDigitavel: "00190.00009 01234.567890 12345.678901 1 11110000000000",
    },
    {
      id: `${client.id}-c2x-04`,
      parcela: "04/60",
      vencimento: "10/06/2026",
      valor: base,
      status: "Aberto",
      linhaDigitavel: "00190.00009 09876.543210 98765.432109 7 11110000000000",
    },
    {
      id: `${client.id}-c2x-05`,
      parcela: "05/60",
      vencimento: "10/07/2026",
      valor: base,
      status: "Aberto",
      linhaDigitavel: "00190.00009 45678.901234 56789.012345 4 11110000000000",
    },
  ];
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





