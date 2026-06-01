"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";
import { Search, Send, Smartphone, X } from "lucide-react";
import type {
  IrisApoloClientOption,
  IrisData,
  IrisMetaPhoneNumberLink,
  IrisMetaPhoneNumberOption,
  IrisMetaTemplateOption,
  IrisMetaTemplatesResponse,
  IrisOptInTemplate,
  IrisQueueConfig,
  IrisTemplate,
  IrisTemplateFeedback,
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

export function IrisStartAttendanceModal({
  data,
  helpers,
  initialQueueLabel,
  onClose,
  onTicketCreated,
  onTemplatesSynced,
}: IrisStartAttendanceModalProps) {
  const {
    TemplateFeedbackBox,
    createIrisTemplateFeedback,
    createIrisTemplateFeedbackFromPayload,
    defaultIrisQueueId,
    extractIrisApoloClientOptions,
    findMetaPhoneNumberOption,
    formatMetaPhoneNumberOption,
    formatPhoneForDisplay,
    formatSelectedTemplatePhoneForDisplay,
    getIrisAccessToken,
    irisOptInTemplate,
    isMetaTemplateApprovedStatus,
    isMetaTemplateUnavailableStatus,
    normalizeIrisSelectionLabel,
    phoneNumberLinkFeedback,
    readIrisTemplateSyncNotificationId,
    readTemplateButtons,
    readTemplateMetadataString,
    readTemplateMetaName,
    readTemplateMetaStatus,
    readTemplateQueueLabel,
    readTemplateSubjectLabel,
    renderSelectedIrisTemplatePreview,
    sortIrisProfiles,
    sortIrisQueues,
    sortIrisTemplatesForSetup,
    templateStatusLabel,
    templateStatusTone,
  } = helpers;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<IrisApoloClientOption[]>([]);
  const [selectedClient, setSelectedClient] =
    useState<IrisApoloClientOption | null>(null);
  const [searching, setSearching] = useState(false);
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
  const activeContactTemplates = useMemo(
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
  const templateOptions = useMemo(() => {
    const queueLabel = normalizeIrisSelectionLabel(selectedQueue?.name);
    const subjectLabel = normalizeIrisSelectionLabel(selectedProfile?.name);

    return activeContactTemplates.filter((template) => {
      return (
        normalizeIrisSelectionLabel(readTemplateQueueLabel(template)) ===
          queueLabel &&
        normalizeIrisSelectionLabel(readTemplateSubjectLabel(template)) ===
          subjectLabel
      );
    });
  }, [
    activeContactTemplates,
    normalizeIrisSelectionLabel,
    readTemplateQueueLabel,
    readTemplateSubjectLabel,
    selectedProfile,
    selectedQueue,
  ]);
  const [selectedLocalTemplateId, setSelectedLocalTemplateId] = useState("");
  const selectedLocalTemplate =
    templateOptions.find(
      (template) => template.id === selectedLocalTemplateId,
    ) ??
    templateOptions[0] ??
    null;
  const [templateStatus, setTemplateStatus] = useState<string | null>(null);
  const [templateMeta, setTemplateMeta] =
    useState<IrisMetaTemplateOption | null>(null);
  const [templatePhoneLink, setTemplatePhoneLink] =
    useState<IrisMetaPhoneNumberLink | null>(null);
  const [templatePhoneNumbers, setTemplatePhoneNumbers] = useState<
    IrisMetaPhoneNumberOption[]
  >([]);
  const templateSyncNotifiedRef = useRef(new Set<string>());
  const [selectedTemplatePhoneNumberId, setSelectedTemplatePhoneNumberId] =
    useState("");
  const [templateFeedback, setTemplateFeedback] = useState<
    IrisTemplateFeedback | string
  >("");
  const [error, setError] = useState("");
  const [startingTicket, setStartingTicket] = useState(false);
  const selectedLocalTemplatePhoneNumberId = readTemplateMetadataString(
    selectedLocalTemplate,
    "metaPhoneNumberId",
  );

  const firstName = selectedClient?.firstName ?? irisOptInTemplate.exampleName;
  const preview = selectedLocalTemplate
    ? renderSelectedIrisTemplatePreview(selectedLocalTemplate, firstName)
    : "";
  const templateButtons = selectedLocalTemplate
    ? readTemplateButtons(selectedLocalTemplate)
    : [];
  const templateApproved = isMetaTemplateApprovedStatus(templateStatus);
  const startTemplateName =
    templateMeta?.name ??
    readTemplateMetaName(selectedLocalTemplate) ??
    selectedLocalTemplate?.slug.replace(/-/g, "_") ??
    irisOptInTemplate.name;
  const startTemplateLanguage =
    templateMeta?.language ??
    readTemplateMetadataString(selectedLocalTemplate, "metaLanguage") ??
    irisOptInTemplate.language;
  const selectedTemplatePhoneNumber = findMetaPhoneNumberOption(
    templatePhoneNumbers,
    selectedTemplatePhoneNumberId,
  );
  const selectedTemplatePhoneLabel = formatSelectedTemplatePhoneForDisplay({
    phoneNumber: selectedTemplatePhoneNumber,
    template: selectedLocalTemplate,
    phoneNumberId: selectedTemplatePhoneNumberId,
  });
  const selectedTemplatePhoneDisplayNumber =
    selectedTemplatePhoneNumber?.displayPhoneNumber ??
    readTemplateMetadataString(selectedLocalTemplate, "metaPhoneDisplayNumber");
  const templatePhoneDisplayMissing = Boolean(
    selectedTemplatePhoneNumberId && !selectedTemplatePhoneDisplayNumber,
  );
  const selectedTemplatePhoneNumberIsListed = templatePhoneNumbers.some(
    (phoneNumber) => phoneNumber.id === selectedTemplatePhoneNumberId,
  );
  const templatePhoneMismatch =
    templatePhoneLink?.checkStatus === "checked" &&
    templatePhoneLink.linked === false;
  const templateReadyToSend =
    Boolean(selectedLocalTemplate) &&
    templateApproved &&
    Boolean(selectedTemplatePhoneNumberId) &&
    !templatePhoneMismatch;
  const templateCanStart = Boolean(selectedQueue) && Boolean(selectedProfile);

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
      setSelectedLocalTemplateId("");
      return;
    }

    if (
      !selectedLocalTemplateId ||
      !templateOptions.some(
        (template) => template.id === selectedLocalTemplateId,
      )
    ) {
      setSelectedLocalTemplateId(templateOptions[0]?.id ?? "");
    }
  }, [selectedLocalTemplateId, templateOptions]);

  useEffect(() => {
    const templatePhoneNumberId = readTemplateMetadataString(
      selectedLocalTemplate,
      "metaPhoneNumberId",
    );

    setSelectedTemplatePhoneNumberId(templatePhoneNumberId ?? "");
  }, [readTemplateMetadataString, selectedLocalTemplate]);

  useEffect(() => {
    let active = true;

    async function loadTemplateStatus() {
      const templateName = readTemplateMetaName(selectedLocalTemplate);
      const templateLanguage = readTemplateMetadataString(
        selectedLocalTemplate,
        "metaLanguage",
      );
      const effectivePhoneNumberId =
        selectedLocalTemplatePhoneNumberId ?? selectedTemplatePhoneNumberId;

      if (!selectedLocalTemplate || !templateName) {
        setTemplateStatus(null);
        setTemplateMeta(null);
        setTemplatePhoneLink(null);
        setTemplatePhoneNumbers([]);
        setSelectedTemplatePhoneNumberId("");
        setTemplateFeedback(
          createIrisTemplateFeedback({
            message:
              selectedProfile && selectedQueue
                ? "Nenhum template aprovado localizado para esta fila e assunto."
                : "Escolha fila e assunto para localizar templates aprovados.",
            title: "Template obrigatorio",
            tone: "warning",
          }),
        );
        return;
      }

      setTemplateStatus(readTemplateMetaStatus(selectedLocalTemplate));
      setTemplateMeta({
        language: templateLanguage ?? irisOptInTemplate.language,
        name: templateName,
        status: readTemplateMetaStatus(selectedLocalTemplate),
      });

      try {
        const accessToken = await getIrisAccessToken();
        const params = new URLSearchParams({
          language: templateLanguage ?? irisOptInTemplate.language,
          name: templateName,
        });

        if (effectivePhoneNumberId) {
          params.set("phoneNumberId", effectivePhoneNumberId);
        }

        const response = await fetch(
          `/api/iris/meta/templates?${params.toString()}`,
          {
            cache: "no-store",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        const payload = (await response
          .json()
          .catch(() => null)) as IrisMetaTemplatesResponse | null;

        if (!active) {
          return;
        }

        if (!response.ok) {
          setTemplateFeedback(
            createIrisTemplateFeedbackFromPayload(
              payload,
              "Nao foi possivel consultar o template Meta neste ambiente.",
            ),
          );
          return;
        }

        const templateSyncId = readIrisTemplateSyncNotificationId(
          payload?.localTemplateSync,
        );
        if (
          templateSyncId &&
          !templateSyncNotifiedRef.current.has(templateSyncId)
        ) {
          templateSyncNotifiedRef.current.add(templateSyncId);
          onTemplatesSynced?.();
        }

        const template = payload?.templates?.[0];
        const phoneNumbers = Array.isArray(payload?.phoneNumbers)
          ? payload.phoneNumbers
          : [];
        const selectedPhoneNumberId =
          payload?.selectedPhoneNumberId ??
          effectivePhoneNumberId ??
          phoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ??
          phoneNumbers[0]?.id ??
          "";
        setTemplatePhoneNumbers(phoneNumbers);
        setSelectedTemplatePhoneNumberId(
          (current) => current || selectedPhoneNumberId,
        );
        setTemplateStatus(template?.status ?? "NOT_FOUND");
        setTemplateMeta(
          template ?? {
            language: templateLanguage ?? irisOptInTemplate.language,
            name: templateName,
            status: "NOT_FOUND",
          },
        );
        setTemplatePhoneLink(payload?.phoneNumberLink ?? null);
        const phoneMismatch =
          payload?.phoneNumberLink?.checkStatus === "checked" &&
          payload.phoneNumberLink.linked === false;
        setTemplateFeedback(
          phoneMismatch
            ? createIrisTemplateFeedback({
                action:
                  "Crie ou selecione um template aprovado para o telefone de envio escolhido.",
                cause:
                  "Existe template aprovado com esse nome em outra WABA, mas ele nao pertence ao telefone selecionado.",
                message:
                  "O template aprovado nao esta vinculado ao telefone de envio deste atendimento.",
                title: "Telefone divergente",
                tone: "error",
              })
            : createIrisTemplateFeedback({
                action: phoneNumberLinkFeedback(payload?.phoneNumberLink),
                cause: payload?.ignoredTemplateCount
                  ? "Existe template com esse nome em outra WABA, mas ele nao pertence ao telefone de envio selecionado."
                  : undefined,
                message: template
                  ? `Template Meta ${templateStatusLabel(template.status)}.`
                  : "Template nao encontrado na Meta para este telefone, nome e idioma.",
                title: template
                  ? "Consulta concluida"
                  : "Template nao localizado",
                tone: template ? "success" : "warning",
              }),
        );
      } catch (templateError) {
        if (active) {
          setTemplateFeedback(
            createIrisTemplateFeedback({
              message:
                templateError instanceof Error
                  ? templateError.message
                  : "Nao foi possivel consultar o template Meta.",
              title: "Falha ao consultar a Meta",
              tone: "error",
            }),
          );
        }
      }
    }

    void loadTemplateStatus();

    return () => {
      active = false;
    };
  }, [
    createIrisTemplateFeedback,
    createIrisTemplateFeedbackFromPayload,
    getIrisAccessToken,
    irisOptInTemplate.language,
    onTemplatesSynced,
    phoneNumberLinkFeedback,
    readIrisTemplateSyncNotificationId,
    readTemplateMetaName,
    readTemplateMetaStatus,
    readTemplateMetadataString,
    selectedLocalTemplate,
    selectedLocalTemplatePhoneNumberId,
    selectedProfile,
    selectedQueue,
    selectedTemplatePhoneNumberId,
    templateStatusLabel,
  ]);

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
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
          },
        );
        const payload = await response.json().catch(() => null);

        if (!response.ok) {
          throw new Error(
            payload?.error ?? "Nao foi possivel buscar no CRM 360.",
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
              : "Nao foi possivel buscar no CRM 360.",
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

  async function startTicket() {
    if (!selectedClient || !templateCanStart) {
      return;
    }

    setStartingTicket(true);
    setError("");

    try {
      const accessToken = await getIrisAccessToken();
      const requestPayload = {
        apoloEntityId: selectedClient.id,
        apoloProfileLabel: selectedClient.profileLabel,
        contactName: selectedClient.label,
        firstName: selectedClient.firstName,
        metadata: {
          activeContactTemplateId: selectedLocalTemplate?.id,
          activeContactTemplateName: selectedLocalTemplate?.name,
          activeContactTemplateQueue: selectedQueue?.name,
          activeContactTemplateSubject: selectedProfile?.name,
        },
        phone: selectedClient.phone,
        phoneNumberId: selectedTemplatePhoneNumberId,
        profileId: selectedProfile?.id,
        queueId: selectedQueue?.id,
        subject: selectedProfile?.name,
        templateId: selectedLocalTemplate?.id,
        templateLanguage: startTemplateLanguage,
        templateName: startTemplateName,
      };

      const attemptStartTicket = async (sendTemplate: boolean) => {
        const response = await fetch("/api/iris/tickets", {
          body: JSON.stringify({
            ...requestPayload,
            sendTemplate,
          }),
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

      const windowAttempt = await attemptStartTicket(false);

      if (windowAttempt.response.ok) {
        onTicketCreated(windowAttempt.payload?.ticket?.id);
        return;
      }

      const windowError =
        windowAttempt.payload?.error ??
        "Nao foi possivel iniciar o atendimento.";
      const requiresTemplate =
        windowAttempt.response.status === 409 &&
        typeof windowError === "string" &&
        windowError.toLowerCase().includes("janela de 24h fechada");

      if (!requiresTemplate) {
        throw new Error(windowError);
      }

      if (!templateReadyToSend) {
        throw new Error(
          "Janela de 24h fechada. Selecione template aprovado e telefone de envio para iniciar o contato ativo.",
        );
      }

      const templateAttempt = await attemptStartTicket(true);

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
    } finally {
      setStartingTicket(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 py-6 backdrop-blur-[2px]">
      <button
        type="button"
        aria-label="Fechar novo atendimento"
        onClick={onClose}
        className="absolute inset-0 cursor-default"
      />
      <section className="relative z-10 flex max-h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-[0_24px_90px_rgba(15,23,42,0.24)]">
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
              Contato ativo
            </p>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              Novo atendimento
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Buscar cliente no CRM 360 e iniciar o atendimento. Se a janela de
              24h estiver aberta, a Iris reaproveita a conversa sem novo
              template.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar formulario"
            className="flex size-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-900"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-5 xl:grid-cols-[minmax(0,1fr)_360px] [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          <div className="min-w-0 space-y-4">
            <label className="block rounded-xl border border-slate-200/70 bg-slate-50/70 p-3">
              <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                Cliente CRM 360 / Apolo
              </span>
              <div className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3 text-sm text-slate-500">
                <Search className="size-4 text-[#A07C3B]" aria-hidden="true" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por cliente ou telefone..."
                  className="min-w-0 flex-1 bg-transparent text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
                />
              </div>
              {searching ? (
                <p className="mt-2 text-xs font-medium text-slate-500">
                  Buscando no CRM 360...
                </p>
              ) : null}
            </label>

            <div className="rounded-xl border border-slate-200/70">
              <div className="border-b border-slate-100 bg-slate-50/70 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-slate-400">
                Resultado da busca
              </div>
              <div className="max-h-72 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                {results.length ? (
                  results.map((client) => {
                    const active = selectedClient?.id === client.id;

                    return (
                      <button
                        key={client.id}
                        type="button"
                        onClick={() => setSelectedClient(client)}
                        className={[
                          "mb-2 grid w-full gap-1 rounded-lg border px-3 py-2 text-left transition-colors last:mb-0",
                          active
                            ? "border-[#A07C3B]/35 bg-[#A07C3B]/5"
                            : "border-slate-200/70 bg-white hover:bg-slate-50",
                        ].join(" ")}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <p className="truncate text-sm font-semibold text-slate-950">
                            {client.label}
                          </p>
                          <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                            CRM 360
                          </span>
                        </div>
                        <p className="truncate text-xs text-slate-500">
                          {client.profileLabel} ·{" "}
                          {formatPhoneForDisplay(client.phone)}
                        </p>
                        <p className="truncate text-xs text-slate-400">
                          {client.documentMasked ??
                            client.locationLabel ??
                            "Cadastro Apolo"}
                        </p>
                      </button>
                    );
                  })
                ) : (
                  <div className="px-3 py-8 text-center text-sm text-slate-500">
                    {query.trim().length < 2
                      ? "Digite pelo menos 2 caracteres para buscar."
                      : "Nenhum cliente localizado com telefone para WhatsApp."}
                  </div>
                )}
              </div>
            </div>
          </div>

          <aside className="min-w-0 space-y-4">
            <div className="rounded-xl border border-slate-200/70 bg-white p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                    Template Meta
                  </p>
                  <h3 className="mt-1 text-sm font-semibold text-slate-950">
                    {selectedLocalTemplate?.name ?? "Escolha um template"}
                  </h3>
                  <p className="mt-0.5 truncate text-xs font-medium text-slate-500">
                    {[selectedQueue?.name, selectedProfile?.name]
                      .filter(Boolean)
                      .join(" / ") || "Fila e assunto"}
                  </p>
                </div>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${templateStatusTone(templateStatus)}`}
                >
                  {templateStatusLabel(templateStatus)}
                </span>
              </div>

              <div className="mt-4 space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                    Fila
                  </span>
                  <select
                    value={selectedQueue?.id ?? ""}
                    onChange={(event) => {
                      setSelectedQueueId(event.target.value);
                      setSelectedProfileId("");
                      setSelectedLocalTemplateId("");
                    }}
                    className="mt-2 h-10 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/60"
                  >
                    <option value="">Selecione a fila</option>
                    {activeQueues.map((queue) => (
                      <option key={queue.id} value={queue.id}>
                        {queue.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                    Assunto
                  </span>
                  <select
                    value={selectedProfile?.id ?? ""}
                    onChange={(event) => {
                      setSelectedProfileId(event.target.value);
                      setSelectedLocalTemplateId("");
                    }}
                    disabled={!selectedQueue || !subjectOptions.length}
                    className="mt-2 h-10 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/60 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">Selecione o assunto</option>
                    {subjectOptions.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block">
                  <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                    Template aprovado
                  </span>
                  <select
                    value={selectedLocalTemplate?.id ?? ""}
                    onChange={(event) =>
                      setSelectedLocalTemplateId(event.target.value)
                    }
                    disabled={!selectedProfile || !templateOptions.length}
                    className="mt-2 h-10 w-full rounded-lg border border-slate-200/70 bg-white px-3 text-sm font-semibold text-slate-700 outline-none transition-colors focus:border-[#A07C3B]/60 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">Selecione o template</option>
                    {templateOptions.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 truncate text-xs font-medium text-slate-500">
                    {templateOptions.length
                      ? `${templateOptions.length} template(s) aprovado(s) para esta combinacao.`
                      : "Nenhum template aprovado para esta fila e assunto."}
                  </p>
                </label>
              </div>

              <label className="mt-4 block">
                <span className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                  Telefone de envio
                </span>
                <div className="mt-2 flex h-10 items-center gap-2 rounded-lg border border-slate-200/70 bg-white px-3">
                  <Smartphone
                    className="size-4 shrink-0 text-[#A07C3B]"
                    aria-hidden="true"
                  />
                  <select
                    value={selectedTemplatePhoneNumberId}
                    onChange={(event) =>
                      setSelectedTemplatePhoneNumberId(event.target.value)
                    }
                    disabled={
                      !selectedLocalTemplate ||
                      Boolean(selectedLocalTemplatePhoneNumberId)
                    }
                    className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-700 outline-none disabled:cursor-not-allowed disabled:text-slate-500"
                  >
                    <option value="">Selecione o telefone</option>
                    {selectedTemplatePhoneNumberId &&
                    !selectedTemplatePhoneNumberIsListed ? (
                      <option value={selectedTemplatePhoneNumberId}>
                        {selectedTemplatePhoneLabel}
                      </option>
                    ) : null}
                    {templatePhoneNumbers.map((phoneNumber) => (
                      <option key={phoneNumber.id} value={phoneNumber.id}>
                        {formatMetaPhoneNumberOption(phoneNumber)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-slate-500">
                  {selectedLocalTemplatePhoneNumberId
                    ? `${selectedTemplatePhoneLabel} esta salvo no template aprovado.`
                    : selectedTemplatePhoneNumber
                      ? `${formatMetaPhoneNumberOption(selectedTemplatePhoneNumber)} define a WABA do template.`
                      : "A Iris consulta e cria o template na WABA do telefone selecionado."}
                </p>
              </label>

              <div className="mt-4 rounded-xl border border-[#e7dfd3] bg-[#f8f4ec] p-3">
                {selectedLocalTemplate ? (
                  <>
                    <p className="text-sm font-medium leading-6 text-slate-800">
                      {preview}
                    </p>
                    {templateButtons.length ? (
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        {templateButtons.map((button) => (
                          <span
                            key={button}
                            className="inline-flex h-9 items-center justify-center rounded-lg border border-emerald-100 bg-white text-sm font-semibold text-emerald-700"
                          >
                            {button}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="text-sm font-medium leading-6 text-slate-500">
                    Escolha fila e assunto para carregar os templates aprovados.
                  </p>
                )}
              </div>

              <p className="mt-3 text-xs leading-5 text-slate-500">
                No contato ativo, a Iris envia template aprovado apenas quando a
                janela de 24h estiver fechada.
              </p>

              <TemplateFeedbackBox feedback={templateFeedback} />
            </div>

            <div className="rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
              <p className="text-xs font-semibold uppercase tracking-normal text-slate-400">
                Atendimento
              </p>
              <div className="mt-3 space-y-2">
                <ReadonlyMini
                  label="Cliente"
                  value={selectedClient?.label ?? "-"}
                />
                <ReadonlyMini
                  label="Telefone"
                  value={
                    selectedClient
                      ? formatPhoneForDisplay(selectedClient.phone)
                      : "-"
                  }
                />
                <ReadonlyMini label="Origem" value="Ativo" />
                <ReadonlyMini label="Status inicial" value="Espera" />
                <ReadonlyMini label="Fila" value={selectedQueue?.name ?? "-"} />
                <ReadonlyMini
                  label="Assunto"
                  value={selectedProfile?.name ?? "-"}
                />
                <ReadonlyMini
                  label="Template"
                  value={selectedLocalTemplate?.name ?? "-"}
                />
              </div>
            </div>
          </aside>
        </div>

        <footer className="border-t border-slate-100 p-4">
          {error ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              {error}
            </p>
          ) : null}
          {templatePhoneMismatch ? (
            <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
              O template aprovado nao pertence ao telefone de envio selecionado.
              Crie ou selecione um template aprovado para este telefone.
            </p>
          ) : null}
          {templatePhoneDisplayMissing ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              A Meta ainda nao retornou o numero exibivel deste telefone. A Iris
              vai usar o ID do telefone selecionado e a validacao server-side da
              WABA.
            </p>
          ) : null}
          {!selectedLocalTemplate ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Se a janela de 24h estiver fechada, selecione um template aprovado
              para iniciar o contato ativo.
            </p>
          ) : !templateApproved ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Se a janela de 24h estiver fechada, o template precisa estar
              aprovado pela Meta antes de iniciar contato ativo real.
            </p>
          ) : null}
          {selectedLocalTemplate && !selectedTemplatePhoneNumberId ? (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-800">
              Se a janela de 24h estiver fechada, selecione o telefone de envio.
              Esse telefone define onde o template existe na Meta.
            </p>
          ) : null}
          <button
            type="button"
            onClick={startTicket}
            disabled={!selectedClient || !templateCanStart || startingTicket}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#101820] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#1f2c3a] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send className="size-4" aria-hidden="true" />
            {startingTicket
              ? "Iniciando atendimento..."
              : "Iniciar atendimento"}
          </button>
        </footer>
      </section>
    </div>
  );
}

function ReadonlyMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200/70 bg-white px-3 py-2">
      <p className="text-[11px] font-semibold uppercase tracking-normal text-slate-400">
        {label}
      </p>
      <p className="mt-0.5 truncate text-sm font-semibold text-slate-800">
        {value}
      </p>
    </div>
  );
}
