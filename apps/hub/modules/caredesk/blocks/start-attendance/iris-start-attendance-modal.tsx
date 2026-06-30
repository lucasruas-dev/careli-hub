"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import {
  Check,
  ChevronDown,
  Headset,
  Info,
  Loader2,
  MessageCircle,
  Search,
  Send,
  Ticket,
  Wallet,
  X,
} from "lucide-react";
import type {
  IrisApoloClientOption,
  IrisApoloContextEntity,
  IrisData,
  IrisMetaPhoneNumberLink,
  IrisMetaPhoneNumberOption,
  IrisMetaTemplateOption,
  IrisMetaTemplatesResponse,
  IrisOptInTemplate,
  IrisQueueConfig,
  IrisTemplate,
  IrisTemplateFeedback,
  IrisTicket,
  IrisTicketProfileConfig,
} from "../../types/iris-types";

export type IrisStartAttendanceModalHelpers = {
  TemplateFeedbackBox: ComponentType<{ feedback: unknown }>;
  createIrisTemplateFeedback: (
    feedback: IrisTemplateFeedback,
  ) => IrisTemplateFeedback;
  createIrisTemplateFeedbackFromPayload: (
    payload: IrisMetaTemplatesResponse | null | undefined,
    fallbackMessage: string,
  ) => IrisTemplateFeedback;
  defaultIrisQueueId: (
    queues: IrisQueueConfig[],
    preferredQueueLabel?: string | null,
  ) => string;
  extractIrisApoloClientOptions: (payload: unknown) => IrisApoloClientOption[];
  findMetaPhoneNumberOption: (
    phoneNumbers: IrisMetaPhoneNumberOption[],
    id?: string | null,
  ) => IrisMetaPhoneNumberOption | null;
  formatMetaPhoneNumberOption: (
    phoneNumber?: IrisMetaPhoneNumberOption | null,
  ) => string;
  formatPhoneForDisplay: (value: string) => string;
  formatSelectedTemplatePhoneForDisplay: (input: {
    phoneNumber?: IrisMetaPhoneNumberOption | null;
    phoneNumberId?: string | null;
    template?: IrisTemplate | null;
  }) => string;
  getIrisAccessToken: () => Promise<string>;
  irisOptInTemplate: IrisOptInTemplate;
  isMetaTemplateApprovedStatus: (status?: string | null) => boolean;
  isMetaTemplateUnavailableStatus: (status?: string | null) => boolean;
  normalizeIrisSelectionLabel: (value?: string | null) => string;
  phoneNumberLinkFeedback: (
    link?: IrisMetaPhoneNumberLink | null,
  ) => string | null;
  readIrisTemplateSyncNotificationId: (
    sync?: IrisMetaTemplatesResponse["localTemplateSync"],
  ) => string | null;
  readTemplateButtons: (template?: IrisTemplate | null) => string[];
  readTemplateMetadataString: (
    template: IrisTemplate | null | undefined,
    key: string,
  ) => string | null;
  readTemplateMetaName: (template?: IrisTemplate | null) => string | null;
  readTemplateMetaStatus: (template?: IrisTemplate | null) => string | null;
  readTemplateQueueLabel: (template?: IrisTemplate | null) => string;
  readTemplateSubjectLabel: (template?: IrisTemplate | null) => string;
  renderSelectedIrisTemplatePreview: (
    template: IrisTemplate,
    firstName: string,
  ) => string;
  sortIrisProfiles: (
    first: IrisTicketProfileConfig,
    second: IrisTicketProfileConfig,
  ) => number;
  sortIrisQueues: (first: IrisQueueConfig, second: IrisQueueConfig) => number;
  sortIrisTemplatesForSetup: (
    first: IrisTemplate,
    second: IrisTemplate,
  ) => number;
  templateStatusLabel: (status?: string | null) => string;
  templateStatusTone: (status?: string | null) => string;
};

type IrisStartAttendanceModalProps = {
  data: IrisData;
  helpers: IrisStartAttendanceModalHelpers;
  initialQueueLabel?: string | null;
  onClose: () => void;
  onTicketCreated: (ticketId?: string) => void;
  onTemplatesSynced?: () => void;
};

// O que personaliza o template do contato ativo: tickets (protocolo + assunto,
// fila de atendimento) ou parcelas (resumo das vencidas, igual ao Hades).
type IrisStartContextMode = "tickets" | "parcelas";

type IrisStartOverdueRow = {
  id: string;
  number: string;
  reference: string;
  unitCode: string | null;
  value: string;
};

// Check 1 (regra Lucas 30/jun): cliente já com ticket ativo NO MESMO NÚMERO —
// devolvido pelo backend pra bloquear a abertura e oferecer abrir o existente.
type IrisActiveTicketBlock = {
  assigneeLabel: string | null;
  protocol: string;
  queueLabel: string | null;
  status: string | null;
  ticketId: string;
};

// Form de abertura de janela da Iris (estilo Hades). Busca o cliente no Apolo,
// escolhe assunto + template aprovado e personaliza com tickets ou parcelas.
// Tenta a janela de 24h aberta primeiro; se fechada, envia o template aprovado.
export function IrisStartAttendanceModal({
  data,
  helpers,
  initialQueueLabel,
  onClose,
  onTicketCreated,
}: IrisStartAttendanceModalProps) {
  const {
    defaultIrisQueueId,
    extractIrisApoloClientOptions,
    formatPhoneForDisplay,
    getIrisAccessToken,
    irisOptInTemplate,
    isMetaTemplateApprovedStatus,
    isMetaTemplateUnavailableStatus,
    readTemplateMetaName,
    readTemplateMetaStatus,
    readTemplateMetadataString,
    sortIrisProfiles,
    sortIrisQueues,
    sortIrisTemplatesForSetup,
  } = helpers;

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IrisApoloClientOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedClient, setSelectedClient] =
    useState<IrisApoloClientOption | null>(null);

  const [entityDetail, setEntityDetail] =
    useState<IrisApoloContextEntity | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const [contextMode, setContextMode] =
    useState<IrisStartContextMode>("tickets");
  const [selectedTicketId, setSelectedTicketId] = useState("");
  const [selectedInstallments, setSelectedInstallments] = useState<Set<string>>(
    new Set(),
  );

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [blockedTicket, setBlockedTicket] =
    useState<IrisActiveTicketBlock | null>(null);

  const activeQueues = useMemo(
    () =>
      data.queues
        .filter((queue) => queue.status === "active")
        .sort(sortIrisQueues),
    [data.queues, sortIrisQueues],
  );
  const [selectedQueueId, setSelectedQueueId] = useState(() =>
    defaultIrisQueueId(data.queues, initialQueueLabel),
  );
  const selectedQueue =
    activeQueues.find((queue) => queue.id === selectedQueueId) ??
    activeQueues[0] ??
    null;
  const subjectOptions = useMemo(
    () =>
      data.profiles
        .filter(
          (profile) =>
            profile.status === "active" &&
            (!selectedQueue || profile.queueId === selectedQueue.id),
        )
        .sort(sortIrisProfiles),
    [data.profiles, selectedQueue, sortIrisProfiles],
  );
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const selectedProfile =
    subjectOptions.find((profile) => profile.id === selectedProfileId) ??
    subjectOptions[0] ??
    null;

  const templateOptions = useMemo(
    () =>
      data.templates
        .filter(
          (template) =>
            template.channelKind === "whatsapp" &&
            Boolean(readTemplateMetaName(template)) &&
            template.status !== "paused" &&
            !isMetaTemplateUnavailableStatus(readTemplateMetaStatus(template)),
        )
        .sort(sortIrisTemplatesForSetup),
    [
      data.templates,
      isMetaTemplateUnavailableStatus,
      readTemplateMetaName,
      readTemplateMetaStatus,
      sortIrisTemplatesForSetup,
    ],
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const selectedTemplate =
    templateOptions.find((template) => template.id === selectedTemplateId) ??
    templateOptions[0] ??
    null;

  useEffect(() => {
    if (!activeQueues.length) {
      setSelectedQueueId("");
      return;
    }
    if (
      !selectedQueueId ||
      !activeQueues.some((queue) => queue.id === selectedQueueId)
    ) {
      setSelectedQueueId(defaultIrisQueueId(activeQueues, initialQueueLabel));
    }
  }, [activeQueues, defaultIrisQueueId, initialQueueLabel, selectedQueueId]);

  useEffect(() => {
    if (!subjectOptions.length) {
      setSelectedProfileId("");
      return;
    }
    if (
      !selectedProfileId ||
      !subjectOptions.some((profile) => profile.id === selectedProfileId)
    ) {
      setSelectedProfileId(subjectOptions[0]?.id ?? "");
    }
  }, [selectedProfileId, subjectOptions]);

  useEffect(() => {
    if (!templateOptions.length) {
      setSelectedTemplateId("");
      return;
    }
    if (
      !selectedTemplateId ||
      !templateOptions.some((template) => template.id === selectedTemplateId)
    ) {
      setSelectedTemplateId(templateOptions[0]?.id ?? "");
    }
  }, [selectedTemplateId, templateOptions]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setResults([]);
      return;
    }

    let active = true;
    const timeout = window.setTimeout(async () => {
      setSearching(true);
      setError("");
      try {
        const accessToken = await getIrisAccessToken();
        const response = await fetch(
          `/api/iris/apolo/search?q=${encodeURIComponent(normalized)}&limit=12`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        const payload = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Nao foi possivel buscar no Apolo.",
          );
        }
        if (active) {
          setResults(extractIrisApoloClientOptions(payload));
        }
      } catch (searchError) {
        if (active) {
          setResults([]);
          setError(
            searchError instanceof Error
              ? searchError.message
              : "Nao foi possivel buscar no Apolo.",
          );
        }
      } finally {
        if (active) {
          setSearching(false);
        }
      }
    }, 320);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [extractIrisApoloClientOptions, getIrisAccessToken, query]);

  // Limpa as selecoes ao trocar de cliente.
  useEffect(() => {
    setSelectedTicketId("");
    setSelectedInstallments(new Set());
    setBlockedTicket(null);
    setError("");
  }, [selectedClient]);

  // Hidrata o portfolio (parcelas/contrato) do cliente — mesma fonte do cockpit.
  useEffect(() => {
    if (!selectedClient) {
      setEntityDetail(null);
      return;
    }
    let active = true;
    void (async () => {
      setLoadingDetail(true);
      try {
        const accessToken = await getIrisAccessToken();
        const candidate = digitsOnly(selectedClient.phone) || selectedClient.label;
        const response = await fetch(
          `/api/apolo/relationships?q=${encodeURIComponent(candidate)}&limit=20`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          data?: { entities?: IrisApoloContextEntity[] };
        } | null;
        if (!active) return;
        const entities = Array.isArray(payload?.data?.entities)
          ? payload?.data?.entities ?? []
          : [];
        const match =
          entities.find((entity) => entity.id === selectedClient.id) ??
          entities[0] ??
          null;
        setEntityDetail(match);
      } catch {
        if (active) setEntityDetail(null);
      } finally {
        if (active) setLoadingDetail(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [getIrisAccessToken, selectedClient]);

  const clientTickets = useMemo(() => {
    if (!selectedClient) return [] as IrisTicket[];
    const phoneDigits = digitsOnly(selectedClient.phone);
    return data.tickets
      .filter((ticket) => {
        const entityId = ticket.crm360Registration?.entityId;
        if (entityId && entityId === selectedClient.id) {
          return true;
        }
        const ticketPhone = digitsOnly(ticket.contactPhone ?? "");
        return (
          Boolean(phoneDigits) &&
          Boolean(ticketPhone) &&
          (ticketPhone.endsWith(phoneDigits) ||
            phoneDigits.endsWith(ticketPhone))
        );
      })
      .sort((first, second) =>
        (second.createdAt ?? "").localeCompare(first.createdAt ?? ""),
      )
      .slice(0, 8);
  }, [data.tickets, selectedClient]);

  const overdue = useMemo<IrisStartOverdueRow[]>(() => {
    if (!entityDetail?.commercialLinks) return [];
    const rows: IrisStartOverdueRow[] = [];
    entityDetail.commercialLinks.forEach((link) => {
      (link.installments ?? []).forEach((installment) => {
        if (
          !installment.status ||
          !installment.status.toLowerCase().includes("venc")
        ) {
          return;
        }
        rows.push({
          id:
            installment.id ??
            `${link.unitCode ?? ""}-${installment.number ?? ""}-${installment.reference ?? ""}`,
          number: installment.number ?? "-",
          reference: installment.reference ?? "-",
          unitCode: link.unitCode ?? null,
          value: installment.value ?? "-",
        });
      });
    });
    return rows;
  }, [entityDetail]);

  const selectedTicket =
    clientTickets.find((ticket) => ticket.id === selectedTicketId) ?? null;

  // Ao escolher um ticket, herda o assunto dele se houver um perfil igual.
  useEffect(() => {
    if (contextMode !== "tickets" || !selectedTicket) return;
    const match = subjectOptions.find(
      (profile) =>
        profile.name.trim().toLowerCase() ===
        selectedTicket.subject.trim().toLowerCase(),
    );
    if (match) setSelectedProfileId(match.id);
  }, [contextMode, selectedTicket, subjectOptions]);

  function toggleInstallment(id: string) {
    setSelectedInstallments((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllInstallments() {
    setSelectedInstallments((current) => {
      const every =
        overdue.length > 0 && overdue.every((row) => current.has(row.id));
      return every ? new Set<string>() : new Set(overdue.map((row) => row.id));
    });
  }

  const selectedInstallmentRows = overdue.filter((row) =>
    selectedInstallments.has(row.id),
  );
  const installmentLabels = selectedInstallmentRows.map(
    (row) =>
      `${row.unitCode ? `${row.unitCode} · ` : ""}${row.number} · ${row.reference}`,
  );
  const allInstallmentsSelected =
    overdue.length > 0 && overdue.every((row) => selectedInstallments.has(row.id));

  const firstName = selectedClient?.firstName ?? irisOptInTemplate.exampleName;
  const startTemplateName =
    readTemplateMetaName(selectedTemplate) ??
    selectedTemplate?.slug.replace(/-/g, "_") ??
    irisOptInTemplate.name;
  const startTemplateLanguage =
    readTemplateMetadataString(selectedTemplate, "metaLanguage") ??
    irisOptInTemplate.language;
  const templateApproved = isMetaTemplateApprovedStatus(
    readTemplateMetaStatus(selectedTemplate),
  );

  const referenceProtocol =
    contextMode === "tickets"
      ? selectedTicket?.protocol ?? "(gerado na abertura)"
      : "(gerado na abertura)";
  const previewParams =
    contextMode === "tickets"
      ? [firstName, referenceProtocol, selectedProfile?.name ?? "-"]
      : [
          firstName,
          formatStartInstallmentSummary(installmentLabels),
          "(gerado na abertura)",
        ];
  const previewText = selectedTemplate?.body
    ? renderStartTemplatePreview(selectedTemplate.body, previewParams)
    : null;

  const canStart =
    Boolean(selectedClient) &&
    Boolean(selectedQueue) &&
    Boolean(selectedProfile) &&
    Boolean(selectedTemplate) &&
    !submitting;

  async function submit() {
    if (!selectedClient || !selectedQueue || !selectedProfile) return;
    setSubmitting(true);
    setError("");
    setBlockedTicket(null);

    try {
      const accessToken = await getIrisAccessToken();
      const requestPayload = {
        apoloEntityId: selectedClient.id,
        apoloProfileLabel: selectedClient.profileLabel,
        contactName: selectedClient.label,
        firstName: selectedClient.firstName,
        metadata: {
          contextMode,
          relatedInstallments:
            contextMode === "parcelas" ? installmentLabels : [],
          relatedTickets:
            contextMode === "tickets" && selectedTicket
              ? [selectedTicket.protocol]
              : [],
        },
        phone: selectedClient.phone,
        profileId: selectedProfile.id,
        queueId: selectedQueue.id,
        subject: selectedProfile.name,
        templateContext: contextMode === "tickets" ? "atendimento" : undefined,
        templateId: selectedTemplate?.id,
        templateLanguage: startTemplateLanguage,
        templateName: startTemplateName,
        templateReferenceProtocol:
          contextMode === "tickets" ? selectedTicket?.protocol : undefined,
      };

      const attempt = async (sendTemplate: boolean) => {
        const response = await fetch("/api/iris/tickets", {
          body: JSON.stringify({ ...requestPayload, sendTemplate }),
          cache: "no-store",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const payload = await response.json().catch(() => null);
        return { payload, response };
      };

      const windowAttempt = await attempt(false);
      if (windowAttempt.response.ok) {
        onTicketCreated(windowAttempt.payload?.ticket?.id);
        return;
      }

      // Check 1: cliente já tem atendimento ativo nesse número — não abre outro,
      // oferece abrir o existente.
      const activeTicket = windowAttempt.payload
        ?.activeTicket as IrisActiveTicketBlock | undefined;
      if (
        windowAttempt.response.status === 409 &&
        activeTicket?.ticketId
      ) {
        setBlockedTicket(activeTicket);
        setSubmitting(false);
        return;
      }

      const windowError =
        windowAttempt.payload?.error ??
        "Nao foi possivel iniciar o atendimento.";
      const needsTemplate =
        windowAttempt.response.status === 409 &&
        typeof windowError === "string" &&
        windowError.toLowerCase().includes("janela de 24h");
      if (!needsTemplate) {
        throw new Error(windowError);
      }

      if (!selectedTemplate) {
        throw new Error(
          "Janela de 24h fechada. Selecione um template aprovado para iniciar o contato.",
        );
      }

      const templateAttempt = await attempt(true);
      if (!templateAttempt.response.ok) {
        throw new Error(
          templateAttempt.payload?.error ??
            "Nao foi possivel iniciar o atendimento.",
        );
      }
      onTicketCreated(templateAttempt.payload?.ticket?.id);
    } catch (ticketError) {
      setError(
        ticketError instanceof Error
          ? ticketError.message
          : "Nao foi possivel iniciar o atendimento.",
      );
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar"
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#101820] text-white">
              <Headset className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Abrir atendimento
              </h2>
              <p className="text-[11px] text-slate-500">
                cria o protocolo AT (Iris) e a janela de 24h
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-50"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-5 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          {selectedClient ? (
            <div className="flex items-center gap-3 rounded-xl bg-slate-50/80 px-3 py-2.5">
              <div className="flex size-9 items-center justify-center rounded-full bg-[#101820]/10 text-[11px] font-semibold text-[#101820]">
                {initials(selectedClient.label)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-950">
                  {selectedClient.label}
                </p>
                <p className="truncate text-[11px] text-slate-500">
                  {selectedClient.profileLabel} ·{" "}
                  {formatPhoneForDisplay(selectedClient.phone)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedClient(null);
                  setResults([]);
                  setQuery("");
                }}
                className="flex shrink-0 items-center gap-1 rounded-md border border-slate-200/70 bg-white px-2 py-1 text-[11px] font-semibold text-slate-600 hover:bg-slate-50"
              >
                <Search className="size-3" aria-hidden="true" />
                trocar
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3">
                <Search className="size-4 text-[#101820]" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar cliente no Apolo por nome ou telefone..."
                  className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
                />
                {searching ? (
                  <Loader2
                    className="size-4 animate-spin text-slate-400"
                    aria-hidden="true"
                  />
                ) : null}
              </div>
              {query.trim().length >= 2 ? (
                <div className="max-h-60 overflow-y-auto rounded-lg border border-slate-200/70 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                  {results.length ? (
                    results.map((client) => (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => setSelectedClient(client)}
                        className="flex w-full flex-col gap-0.5 border-b border-slate-100 px-3 py-2 text-left last:border-b-0 hover:bg-slate-50"
                      >
                        <span className="truncate text-sm font-semibold text-slate-950">
                          {client.label}
                        </span>
                        <span className="truncate text-[11px] text-slate-500">
                          {client.profileLabel} ·{" "}
                          {formatPhoneForDisplay(client.phone)}
                        </span>
                      </button>
                    ))
                  ) : (
                    <p className="px-3 py-6 text-center text-xs text-slate-400">
                      {searching
                        ? "Buscando no Apolo..."
                        : "Nenhum cliente localizado com telefone para WhatsApp."}
                    </p>
                  )}
                </div>
              ) : (
                <p className="px-1 text-[11px] text-slate-400">
                  Digite pelo menos 2 caracteres para buscar.
                </p>
              )}
            </div>
          )}

          {selectedClient ? (
            blockedTicket ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3.5">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                      <Info className="size-4" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-amber-900">
                        Cliente já está em atendimento
                      </p>
                      <p className="mt-0.5 text-xs leading-relaxed text-amber-800">
                        {blockedTicket.protocol}
                        {blockedTicket.queueLabel
                          ? ` · ${blockedTicket.queueLabel}`
                          : ""}
                        {blockedTicket.assigneeLabel
                          ? ` · ${blockedTicket.assigneeLabel}`
                          : ""}
                        . Não dá pra abrir um segundo ticket nesse número —
                        continue no atendimento que já existe.
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => onTicketCreated(blockedTicket.ticketId)}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1f2c3a]"
                >
                  <Headset className="size-4" aria-hidden="true" />
                  Abrir o atendimento existente
                </button>
              </div>
            ) : (
            <>
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100/70 p-1">
                {(
                  [
                    { icon: Ticket, label: "Tickets", value: "tickets" },
                    { icon: Wallet, label: "Parcelas", value: "parcelas" },
                  ] as const
                ).map((option) => {
                  const Icon = option.icon;
                  const active = contextMode === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setContextMode(option.value)}
                      className={`flex h-8 items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold transition-colors ${
                        active
                          ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200"
                          : "text-slate-500 hover:text-slate-700"
                      }`}
                    >
                      <Icon className="size-4" aria-hidden="true" />
                      {option.label}
                    </button>
                  );
                })}
              </div>

              {contextMode === "tickets" ? (
                <div>
                  <p className="mb-1.5 text-[11px] font-semibold text-slate-500">
                    Ticket relacionado{" "}
                    <span className="font-normal text-slate-400">
                      (referencia o protocolo no template)
                    </span>
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200/70 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                    {clientTickets.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-slate-400">
                        Sem tickets anteriores deste cliente. O template usa o
                        protocolo gerado na abertura.
                      </p>
                    ) : (
                      clientTickets.map((ticket) => {
                        const checked = selectedTicketId === ticket.id;
                        return (
                          <button
                            type="button"
                            key={ticket.id}
                            onClick={() =>
                              setSelectedTicketId(checked ? "" : ticket.id)
                            }
                            className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50"
                          >
                            <span
                              className={`flex size-4 items-center justify-center rounded-full ${
                                checked
                                  ? "bg-emerald-600 text-white"
                                  : "border border-slate-300"
                              }`}
                            >
                              {checked ? (
                                <Check className="size-3" aria-hidden="true" />
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-slate-700">
                              <span className="font-semibold text-slate-900">
                                {ticket.protocol}
                              </span>{" "}
                              · {ticket.subject}
                            </span>
                            <span className="shrink-0 text-[11px] text-slate-400">
                              {formatStartDate(ticket.createdAt)}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <div className="mb-1.5 flex items-end justify-between gap-2">
                    <p className="text-[11px] font-semibold text-slate-500">
                      Parcelas relacionadas{" "}
                      <span className="font-normal text-slate-400">
                        (resumo no template)
                      </span>
                    </p>
                    {overdue.length > 0 ? (
                      <button
                        type="button"
                        onClick={toggleAllInstallments}
                        className="shrink-0 whitespace-nowrap rounded-md border border-emerald-600/25 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
                      >
                        {allInstallmentsSelected ? "Limpar" : "Selecionar todas"}
                      </button>
                    ) : null}
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200/70 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                    {loadingDetail && overdue.length === 0 ? (
                      <p className="flex items-center gap-2 px-3 py-4 text-xs text-slate-400">
                        <Loader2
                          className="size-4 animate-spin"
                          aria-hidden="true"
                        />
                        Carregando parcelas do cliente…
                      </p>
                    ) : overdue.length === 0 ? (
                      <p className="px-3 py-4 text-xs text-slate-400">
                        Sem parcelas vencidas carregadas para este cliente.
                      </p>
                    ) : (
                      overdue.map((row) => {
                        const checked = selectedInstallments.has(row.id);
                        return (
                          <button
                            type="button"
                            key={row.id}
                            onClick={() => toggleInstallment(row.id)}
                            className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50"
                          >
                            <span
                              className={`flex size-4 items-center justify-center rounded ${
                                checked
                                  ? "bg-emerald-600 text-white"
                                  : "border border-slate-300"
                              }`}
                            >
                              {checked ? (
                                <Check className="size-3" aria-hidden="true" />
                              ) : null}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-slate-700">
                              {row.unitCode ? (
                                <span className="text-emerald-700">
                                  {row.unitCode}
                                  {" · "}
                                </span>
                              ) : null}
                              <span className="font-semibold text-slate-900">
                                {row.number}
                              </span>{" "}
                              · {row.reference}
                            </span>
                            <span className="shrink-0 font-semibold text-slate-950">
                              {row.value}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                  {overdue.length > 0 ? (
                    <p className="mt-1 text-[11px] text-slate-500">
                      {selectedInstallmentRows.length} de {overdue.length}{" "}
                      selecionadas
                    </p>
                  ) : null}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-500">
                    Assunto
                  </span>
                  <div className="relative">
                    <select
                      value={selectedProfile?.id ?? ""}
                      onChange={(event) =>
                        setSelectedProfileId(event.target.value)
                      }
                      disabled={!subjectOptions.length}
                      className="h-9 w-full appearance-none rounded-lg border border-slate-200/70 bg-white px-2 pr-7 text-sm text-slate-700 outline-none focus:border-[#101820]/40 disabled:bg-slate-50 disabled:text-slate-400"
                    >
                      {subjectOptions.length ? (
                        subjectOptions.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.name}
                          </option>
                        ))
                      ) : (
                        <option value="">Sem assuntos na fila</option>
                      )}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                      aria-hidden="true"
                    />
                  </div>
                </label>
                <div>
                  <span className="mb-1 block text-[11px] font-semibold text-slate-500">
                    Canal
                  </span>
                  <div className="flex h-9 items-center gap-1.5 rounded-lg border border-slate-200/70 px-2.5 text-sm text-slate-700">
                    <MessageCircle
                      className="size-4 text-emerald-600"
                      aria-hidden="true"
                    />
                    WhatsApp · {selectedQueue?.name ?? "Atendimento"}
                  </div>
                </div>
              </div>

              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold text-slate-500">
                  Template aprovado (Meta)
                </span>
                <div className="relative">
                  <select
                    value={selectedTemplate?.id ?? ""}
                    onChange={(event) =>
                      setSelectedTemplateId(event.target.value)
                    }
                    disabled={!templateOptions.length}
                    className="h-9 w-full appearance-none rounded-lg border border-slate-200/70 bg-white px-2 pr-7 text-sm text-slate-700 outline-none focus:border-[#101820]/40 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    {templateOptions.length ? (
                      templateOptions.map((template) => (
                        <option key={template.id} value={template.id}>
                          {template.name}
                        </option>
                      ))
                    ) : (
                      <option value="">Nenhum template aprovado</option>
                    )}
                  </select>
                  <ChevronDown
                    className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                    aria-hidden="true"
                  />
                </div>
                {selectedTemplate && !templateApproved ? (
                  <p className="mt-1 text-[10px] font-semibold text-amber-700">
                    Esse template ainda nao consta aprovado na Meta — so envia com
                    a janela aberta.
                  </p>
                ) : null}
              </label>

              {selectedTemplate ? (
                <div>
                  <p className="mb-1 text-[11px] font-semibold text-slate-500">
                    Pré-visualização{" "}
                    <span className="font-normal text-slate-400">
                      (enviada só com a janela de 24h fechada)
                    </span>
                  </p>
                  <div className="rounded-lg border border-slate-200/70 bg-slate-50/70 px-3 py-2 text-xs leading-relaxed whitespace-pre-line text-slate-700">
                    {previewText ?? "Template aprovado."}
                  </div>
                </div>
              ) : null}

              {error ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {error}
                </p>
              ) : null}
            </>
            )
          ) : error ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Info className="size-3.5" aria-hidden="true" />
            Janela aberta reaproveita a conversa
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border border-slate-200/70 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            {blockedTicket ? null : (
              <button
                type="button"
                disabled={!canStart}
                onClick={() => void submit()}
                aria-label="Abrir atendimento"
                className="flex h-9 items-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1f2c3a] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
                Abrir
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

function digitsOnly(value: string) {
  return value.replace(/\D+/g, "");
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

// Mesmo corte do backend (3 visiveis + "+N parcela(s)") pra nao estourar o
// template do WhatsApp.
function formatStartInstallmentSummary(labels: string[]) {
  if (!labels.length) return "Sem parcela informada";
  const preview = labels.slice(0, 3).join(" | ");
  const suffix = labels.length > 3 ? ` +${labels.length - 3} parcela(s)` : "";
  return `${preview}${suffix}`;
}

function renderStartTemplatePreview(body: string, params: string[]) {
  return body.replace(/{{\s*(\d+)\s*}}/g, (placeholder, rawIndex) => {
    const index = Number.parseInt(rawIndex, 10);
    if (Number.isNaN(index) || index <= 0) return placeholder;
    return params[index - 1] ?? placeholder;
  });
}

function formatStartDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}
