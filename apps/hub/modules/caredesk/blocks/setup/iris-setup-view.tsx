/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BarChart3,
  Check,
  CheckCircle2,
  CircleStop,
  Clock3,
  ClipboardList,
  DatabaseZap,
  FileText,
  ImageIcon,
  Inbox,
  LayoutDashboard,
  MessageSquareText,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Route,
  Save,
  Search,
  Send,
  Settings2,
  SlidersHorizontal,
  Smartphone,
  TicketCheck,
  Trash2,
  Upload,
  Video,
  Workflow,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import {
  ActionPanel,
  BuilderCard,
  EmptyState,
  FilterSelect,
  KpiCard,
  ProgressLine,
  SetupField,
  SetupSection,
  toneBg,
  toneText,
} from "../shared/iris-ui";
import type {
  IrisData,
  IrisMetaPhoneNumberOption,
  IrisMetaTemplateLibraryPreset,
  IrisMetaTemplateMediaUploadResponse,
  IrisMetaTemplatesResponse,
  IrisPriority,
  IrisQueueConfig,
  IrisSnapshot,
  IrisTemplate,
  IrisTemplateArchiveResponse,
  IrisTemplateFeedback,
  IrisTemplateHeaderOption,
  IrisTemplateStatusFilter,
  IrisTemplateVariable,
  IrisTicketProfileConfig,
  IrisTone,
} from "../../types/iris-types";

let setupHelpers: any = {};
let IRIS_TEMPLATE_AUTO_REFRESH_MS: number = 45_000;
let IRIS_TEMPLATE_STATUS_FILTERS: IrisTemplateStatusFilter[] = [];
let IRIS_TEMPLATE_HEADER_OPTIONS: IrisTemplateHeaderOption[] = [];
let IRIS_META_TEMPLATE_LIBRARY_PRESETS: IrisMetaTemplateLibraryPreset[] = [];
let IRIS_META_TEMPLATE_VARIABLES: IrisTemplateVariable[] = [];
let priorityLabel: Record<IrisPriority, string> = {
  critical: "Critica",
  high: "Alta",
  low: "Baixa",
  medium: "Media",
};
let priorityOptions: IrisPriority[] = ["low", "medium", "high", "critical"];
let setupStatusLabel: Record<string, string> = {
  active: "Ativo",
  archived: "Arquivado",
  paused: "Pausado",
  planned: "Planejado",
};
let setupStatusOptions: string[] = ["planned", "active", "paused", "archived"];

export type IrisSetupViewProps = {
  constants: {
    IRIS_META_TEMPLATE_LIBRARY_PRESETS: IrisMetaTemplateLibraryPreset[];
    IRIS_META_TEMPLATE_VARIABLES: IrisTemplateVariable[];
    IRIS_TEMPLATE_AUTO_REFRESH_MS: number;
    IRIS_TEMPLATE_HEADER_OPTIONS: IrisTemplateHeaderOption[];
    IRIS_TEMPLATE_STATUS_FILTERS: IrisTemplateStatusFilter[];
    priorityLabel: Record<IrisPriority, string>;
    priorityOptions: IrisPriority[];
    setupStatusLabel: Record<string, string>;
    setupStatusOptions: string[];
  };
  data: Pick<IrisData, "profiles" | "queues" | "templates">;
  helpers: Record<string, unknown>;
  onProfilesChanged: (profiles: IrisTicketProfileConfig[]) => void;
  onQueuesChanged: (queues: IrisQueueConfig[]) => void;
  onTemplatesSynced: () => void;
  snapshot: IrisSnapshot;
};

export function IrisSetupView({
  constants,
  helpers,
  ...props
}: IrisSetupViewProps) {
  setupHelpers = helpers;
  IRIS_TEMPLATE_AUTO_REFRESH_MS = constants.IRIS_TEMPLATE_AUTO_REFRESH_MS;
  IRIS_TEMPLATE_STATUS_FILTERS = constants.IRIS_TEMPLATE_STATUS_FILTERS;
  IRIS_TEMPLATE_HEADER_OPTIONS = constants.IRIS_TEMPLATE_HEADER_OPTIONS;
  IRIS_META_TEMPLATE_LIBRARY_PRESETS = constants.IRIS_META_TEMPLATE_LIBRARY_PRESETS;
  IRIS_META_TEMPLATE_VARIABLES = constants.IRIS_META_TEMPLATE_VARIABLES;
  priorityLabel = constants.priorityLabel;
  priorityOptions = constants.priorityOptions;
  setupStatusLabel = constants.setupStatusLabel;
  setupStatusOptions = constants.setupStatusOptions;

  return <SetupView {...props} />;
}

function IrisTemplateFeedbackBox(props: any) {
  const Component = setupHelpers.IrisTemplateFeedbackBox;
  return <Component {...props} />;
}
function createQueueForm(...args: any[]) { return setupHelpers.createQueueForm(...args); }
function createProfileForm(...args: any[]) { return setupHelpers.createProfileForm(...args); }
function sortIrisProfiles(...args: any[]) { return setupHelpers.sortIrisProfiles(...args); }
function unique(...args: any[]) { return setupHelpers.unique(...args); }
function queueToForm(...args: any[]) { return setupHelpers.queueToForm(...args); }
function saveIrisQueue(...args: any[]) { return setupHelpers.saveIrisQueue(...args); }
function sortIrisQueues(...args: any[]) { return setupHelpers.sortIrisQueues(...args); }
function profileToForm(...args: any[]) { return setupHelpers.profileToForm(...args); }
function saveIrisTicketProfile(...args: any[]) { return setupHelpers.saveIrisTicketProfile(...args); }
function formatCount(...args: any[]) { return setupHelpers.formatCount(...args); }
function formatSlaMinutes(...args: any[]) { return setupHelpers.formatSlaMinutes(...args); }
function mapQueueRow(...args: any[]) { return setupHelpers.mapQueueRow(...args); }
function mapTicketProfileRow(...args: any[]) { return setupHelpers.mapTicketProfileRow(...args); }
function createIrisTemplateForm(...args: any[]) { return setupHelpers.createIrisTemplateForm(...args); }
function findIrisTemplateByMetaName(...args: any[]) { return setupHelpers.findIrisTemplateByMetaName(...args); }
function readTemplateMetaStatus(...args: any[]) { return setupHelpers.readTemplateMetaStatus(...args); }
function parseTemplateButtons(...args: any[]) { return setupHelpers.parseTemplateButtons(...args); }
function renderMetaTemplatePreview(...args: any[]) { return setupHelpers.renderMetaTemplatePreview(...args); }
function findMetaPhoneNumberOption(...args: any[]) { return setupHelpers.findMetaPhoneNumberOption(...args); }
function readTemplateQueueLabel(...args: any[]) { return setupHelpers.readTemplateQueueLabel(...args); }
function readTemplateStatusGroup(...args: any[]) { return setupHelpers.readTemplateStatusGroup(...args); }
function readTemplateSubjectLabel(...args: any[]) { return setupHelpers.readTemplateSubjectLabel(...args); }
function readTemplateMetaName(...args: any[]) { return setupHelpers.readTemplateMetaName(...args); }
function sortIrisTemplatesForSetup(...args: any[]) { return setupHelpers.sortIrisTemplatesForSetup(...args); }
function readTemplateHeaderFormat(...args: any[]) { return setupHelpers.readTemplateHeaderFormat(...args); }
function readTemplatePhoneLabel(...args: any[]) { return setupHelpers.readTemplatePhoneLabel(...args); }
function templateHeaderFormatLabel(...args: any[]) { return setupHelpers.templateHeaderFormatLabel(...args); }
function templateStatusTone(...args: any[]) { return setupHelpers.templateStatusTone(...args); }
function templateStatusLabel(...args: any[]) { return setupHelpers.templateStatusLabel(...args); }
function formatMetaPhoneNumberOption(...args: any[]) { return setupHelpers.formatMetaPhoneNumberOption(...args); }
function formatSelectedTemplatePhoneForDisplay(...args: any[]) { return setupHelpers.formatSelectedTemplatePhoneForDisplay(...args); }
function buildTemplateVariablesFromPreset(...args: any[]) { return setupHelpers.buildTemplateVariablesFromPreset(...args); }
function createIrisTemplateDraft(...args: any[]) { return setupHelpers.createIrisTemplateDraft(...args); }
function irisTemplateToForm(...args: any[]) { return setupHelpers.irisTemplateToForm(...args); }
function mergeTemplateVariable(...args: any[]) { return setupHelpers.mergeTemplateVariable(...args); }
function getIrisAccessToken(...args: any[]) { return setupHelpers.getIrisAccessToken(...args); }
function readIrisTemplateSyncNotificationId(...args: any[]) { return setupHelpers.readIrisTemplateSyncNotificationId(...args); }
function phoneNumberLinkFeedback(...args: any[]) { return setupHelpers.phoneNumberLinkFeedback(...args); }
function createIrisTemplateFeedbackFromPayload(...args: any[]) { return setupHelpers.createIrisTemplateFeedbackFromPayload(...args); }
function createIrisTemplateFeedback(...args: any[]) { return setupHelpers.createIrisTemplateFeedback(...args); }
function normalizeIrisSelectionLabel(...args: any[]) { return setupHelpers.normalizeIrisSelectionLabel(...args); }
function defaultIrisQueueId(...args: any[]) { return setupHelpers.defaultIrisQueueId(...args); }
function readTemplateButtons(...args: any[]) { return setupHelpers.readTemplateButtons(...args); }
function readTemplateMetadataString(...args: any[]) { return setupHelpers.readTemplateMetadataString(...args); }
function slugifyIrisProfile(...args: any[]) { return setupHelpers.slugifyIrisProfile(...args); }
function slugifyIrisQueue(...args: any[]) { return setupHelpers.slugifyIrisQueue(...args); }

type IrisSetupViewInnerProps = Omit<
  IrisSetupViewProps,
  "constants" | "helpers"
>;

function SetupView({
  data,
  onQueuesChanged,
  onProfilesChanged,
  onTemplatesSynced,
  snapshot,
}: IrisSetupViewInnerProps) {
  const firstQueueId = data.queues[0]?.id ?? "";
  const queueById = useMemo(
    () => new Map(data.queues.map((queue) => [queue.id, queue])),
    [data.queues],
  );
  const [selectedQueueId, setSelectedQueueId] = useState("all");
  const [editingQueueId, setEditingQueueId] = useState("");
  const [editingProfileId, setEditingProfileId] = useState("");
  const [queueForm, setQueueForm] = useState(() => createQueueForm());
  const [profileForm, setProfileForm] = useState(() =>
    createProfileForm(firstQueueId),
  );
  const [subjectSearch, setSubjectSearch] = useState("");
  const [savingQueue, setSavingQueue] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);
  const [queueFeedback, setQueueFeedback] = useState<string | null>(null);
  const [profileFeedback, setProfileFeedback] = useState<string | null>(null);
  const [queueModalOpen, setQueueModalOpen] = useState(false);
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [setupTab, setSetupTab] = useState<"profiles" | "templates">(
    "profiles",
  );
  const selectedQueue = data.queues.find(
    (queue) => queue.id === selectedQueueId,
  );

  useEffect(() => {
    if (!profileForm.queueId && firstQueueId) {
      setProfileForm((current) => ({
        ...current,
        queueId: firstQueueId,
      }));
    }
  }, [firstQueueId, profileForm.queueId]);

  const visibleProfiles = useMemo(
    () =>
      data.profiles
        .filter((profile) => {
          const matchesQueue =
            selectedQueueId === "all" || profile.queueId === selectedQueueId;
          const search = subjectSearch.trim().toLowerCase();
          const matchesSearch =
            !search ||
            [
              profile.name,
              profile.slug,
              profile.category,
              profile.queueLabel,
              profile.description,
            ]
              .filter(Boolean)
              .join(" ")
              .toLowerCase()
              .includes(search);

          return matchesQueue && matchesSearch;
        })
        .sort(sortIrisProfiles),
    [data.profiles, selectedQueueId, subjectSearch],
  );
  const activeProfiles = data.profiles.filter(
    (profile) => profile.status === "active",
  ).length;
  const activeQueues = data.queues.filter(
    (queue) => queue.status === "active",
  ).length;
  const categories = unique(
    data.profiles.map((profile) => profile.category).filter(Boolean),
  );

  function updateQueueForm(field: string, value: string) {
    setQueueFeedback(null);
    setQueueForm((current) => {
      const next = {
        ...current,
        [field]: value,
      };

      if (field === "name" && !editingQueueId) {
        next.slug = slugifyIrisQueue(value);
      }

      return next;
    });
  }

  function updateProfileForm(field: string, value: string) {
    setProfileFeedback(null);
    setProfileForm((current) => {
      const next = {
        ...current,
        [field]: value,
      };

      if (field === "name" && !editingProfileId) {
        next.slug = slugifyIrisProfile(value);
      }

      return next;
    });
  }

  function startNewQueue() {
    setEditingQueueId("");
    setQueueFeedback(null);
    setQueueForm(createQueueForm());
    setQueueModalOpen(true);
  }

  function startEditQueue(queue: IrisQueueConfig) {
    setEditingQueueId(queue.id);
    setQueueFeedback(null);
    setQueueForm(queueToForm(queue));
    setSelectedQueueId(queue.id);
    setProfileForm((current) => ({
      ...current,
      queueId: current.queueId || queue.id,
    }));
    setQueueModalOpen(true);
  }

  function startNewProfile() {
    setEditingProfileId("");
    setProfileFeedback(null);
    setProfileForm(
      createProfileForm(
        selectedQueueId === "all" ? firstQueueId : selectedQueueId,
      ),
    );
    setProfileModalOpen(true);
  }

  function startEditProfile(profile: IrisTicketProfileConfig) {
    setEditingProfileId(profile.id);
    setProfileFeedback(null);
    setProfileForm(profileToForm(profile));
    setProfileModalOpen(true);
  }

  async function saveQueue(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!queueForm.name.trim() || !queueForm.slug.trim()) {
      setQueueFeedback("Preencha nome e slug da fila.");
      return;
    }

    setSavingQueue(true);
    setQueueFeedback(null);

    try {
      const savedRow = await saveIrisQueue(queueForm);
      const savedQueue = mapQueueRow(savedRow);
      const nextQueues = [
        ...data.queues.filter(
          (queue) =>
            queue.id !== savedQueue.id && queue.slug !== savedQueue.slug,
        ),
        savedQueue,
      ].sort(sortIrisQueues);

      onQueuesChanged(nextQueues);
      setEditingQueueId(savedQueue.id);
      setSelectedQueueId(savedQueue.id);
      setQueueForm(queueToForm(savedQueue));
      setProfileForm((current) => ({
        ...current,
        queueId: current.queueId || savedQueue.id,
      }));
      setQueueFeedback("Fila salva no Iris.");
      setQueueModalOpen(false);
    } catch (error) {
      setQueueFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel salvar a fila do Iris.",
      );
    } finally {
      setSavingQueue(false);
    }
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!profileForm.queueId) {
      setProfileFeedback("Selecione uma fila antes de salvar o assunto.");
      return;
    }

    if (
      !profileForm.name.trim() ||
      !profileForm.slug.trim() ||
      !profileForm.category.trim()
    ) {
      setProfileFeedback("Preencha nome, slug e categoria do assunto.");
      return;
    }

    setSavingProfile(true);
    setProfileFeedback(null);

    try {
      const savedRow = await saveIrisTicketProfile(profileForm);
      const savedProfile = mapTicketProfileRow(
        savedRow,
        savedRow.queue_id ? queueById.get(savedRow.queue_id) : null,
      );
      const nextProfiles = [
        ...data.profiles.filter(
          (profile) =>
            profile.id !== savedProfile.id &&
            !(
              profile.queueId === savedProfile.queueId &&
              profile.slug === savedProfile.slug
            ),
        ),
        savedProfile,
      ].sort(sortIrisProfiles);

      onProfilesChanged(nextProfiles);
      setEditingProfileId(savedProfile.id);
      setProfileForm(profileToForm(savedProfile));
      setProfileFeedback("Assunto de atendimento salvo no Iris.");
      setProfileModalOpen(false);
    } catch (error) {
      setProfileFeedback(
        error instanceof Error
          ? error.message
          : "Nao foi possivel salvar o assunto do Iris.",
      );
    } finally {
      setSavingProfile(false);
    }
  }

  if (setupTab === "templates") {
    return (
      <div className="grid h-full min-h-0 gap-4 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
        <section className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-white p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A07C3B]">
                Setup Iris
              </p>
              <h3 className="mt-1 text-base font-semibold text-[#101820]">
                Templates Meta WhatsApp
              </h3>
            </div>
            <IrisSetupTabs active={setupTab} onChange={setSetupTab} />
          </div>

          <IrisTemplateSetupPanel
            profiles={data.profiles}
            queues={data.queues}
            onTemplatesSynced={onTemplatesSynced}
            templates={data.templates}
          />
        </section>
      </div>
    );
  }

  return (
    <div className="grid h-full min-h-0 gap-4 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
      <section className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-white p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#A07C3B]">
              Setup Iris
            </p>
            <h3 className="mt-1 text-base font-semibold text-[#101820]">
              Filas e assuntos
            </h3>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <IrisSetupTabs active={setupTab} onChange={setSetupTab} />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <IrisTemplateMetricCard
            icon={Workflow}
            label="Filas"
            value={formatCount(data.queues.length)}
          />
          <IrisTemplateMetricCard
            icon={Route}
            label="Filas ativas"
            tone="green"
            value={formatCount(activeQueues)}
          />
          <IrisTemplateMetricCard
            icon={MessageSquareText}
            label="Assuntos"
            tone="gold"
            value={formatCount(data.profiles.length)}
          />
          <IrisTemplateMetricCard
            icon={SlidersHorizontal}
            label="Categorias"
            tone="blue"
            value={formatCount(categories.length)}
          />
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
          <div className="min-w-0 space-y-3 xl:max-h-[calc(100vh-300px)] xl:overflow-y-auto xl:pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            <div className="rounded-2xl border border-[#dbe3ef] bg-[#fbfcfe] p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#8a96aa]">
                    Filas
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-[#101820]">
                    Rotas de atendimento
                  </h4>
                </div>
                <button
                  type="button"
                  onClick={startNewQueue}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-[#dbe3ef] bg-white text-[#A07C3B] transition-colors hover:border-[#A07C3B]/35"
                  aria-label="Nova fila"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="mt-3 space-y-2">
                <button
                  type="button"
                  onClick={() => setSelectedQueueId("all")}
                  className={[
                    "w-full rounded-xl border p-3 text-left transition-colors",
                    selectedQueueId === "all"
                      ? "border-[#101820] bg-white"
                      : "border-[#e4eaf3] bg-white hover:border-[#A07C3B]/35",
                  ].join(" ")}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-[#101820]">
                      Todas as filas
                    </span>
                    <span className="rounded-full bg-[#f4f6fa] px-2 py-0.5 text-[11px] font-semibold text-[#63708a]">
                      {formatCount(data.profiles.length)}
                    </span>
                  </div>
                </button>

                {data.queues.map((queue) => {
                  const selected = selectedQueueId === queue.id;
                  const queueSubjects = data.profiles.filter(
                    (profile) => profile.queueId === queue.id,
                  ).length;

                  return (
                    <div
                      key={queue.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedQueueId(queue.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedQueueId(queue.id);
                        }
                      }}
                      className={[
                        "w-full cursor-pointer rounded-xl border p-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[#A07C3B]/40",
                        selected
                          ? "border-[#A07C3B]/55 bg-[#fbf6ec]"
                          : "border-[#e4eaf3] bg-white hover:border-[#A07C3B]/35",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-full"
                              style={{ backgroundColor: queue.color }}
                            />
                            <span className="truncate text-sm font-semibold text-[#101820]">
                              {queue.name}
                            </span>
                          </div>
                          <p className="mt-1 truncate text-xs font-medium text-[#63708a]">
                            {queue.slug} | {queue.assignmentStrategy}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                            {setupStatusLabel[queue.status] ?? queue.status}
                          </span>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              startEditQueue(queue);
                            }}
                            aria-label="Editar fila"
                            className="grid h-7 w-7 place-items-center rounded-lg border border-[#dbe3ef] bg-white text-[#63708a] transition-colors hover:border-[#A07C3B]/35 hover:text-[#A07C3B]"
                          >
                            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/20">
                          {priorityLabel[queue.defaultPriority]}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          {formatCount(queueSubjects)} assuntos
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {queueModalOpen ? (
            <div
              className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[#101820]/45 p-4 backdrop-blur-sm sm:items-center"
              onClick={() => setQueueModalOpen(false)}
            >
            <form
              onSubmit={saveQueue}
              onClick={(event) => event.stopPropagation()}
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#dbe3ef] bg-white p-4 shadow-2xl [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]"
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
                    <Workflow className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h4 className="text-sm font-semibold text-[#101820]">
                      {editingQueueId ? "Editar fila" : "Nova fila"}
                    </h4>
                    <p className="text-xs text-[#63708a]">caredesk_queues</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setQueueModalOpen(false)}
                  aria-label="Fechar"
                  className="grid h-8 w-8 place-items-center rounded-lg border border-[#dbe3ef] text-[#63708a] transition-colors hover:border-[#A07C3B]/35 hover:text-[#101820]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>

              <div className="space-y-3">
                <SetupField label="Nome da fila">
                  <input
                    value={queueForm.name}
                    onChange={(event) =>
                      updateQueueForm("name", event.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    placeholder="Atendimento"
                  />
                </SetupField>
                <div className="grid grid-cols-[minmax(0,1fr)_72px] gap-2">
                  <SetupField label="Slug">
                    <input
                      value={queueForm.slug}
                      onChange={(event) =>
                        updateQueueForm(
                          "slug",
                          slugifyIrisQueue(event.target.value),
                        )
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                      placeholder="atendimento"
                    />
                  </SetupField>
                  <SetupField label="Cor">
                    <input
                      type="color"
                      value={queueForm.color}
                      onChange={(event) =>
                        updateQueueForm("color", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white p-1 outline-none"
                    />
                  </SetupField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SetupField label="Prioridade">
                    <select
                      value={queueForm.defaultPriority}
                      onChange={(event) =>
                        updateQueueForm("defaultPriority", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    >
                      {priorityOptions.map((priority) => (
                        <option key={priority} value={priority}>
                          {priorityLabel[priority]}
                        </option>
                      ))}
                    </select>
                  </SetupField>
                  <SetupField label="Status">
                    <select
                      value={queueForm.status}
                      onChange={(event) =>
                        updateQueueForm("status", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    >
                      {setupStatusOptions.map((status) => (
                        <option key={status} value={status}>
                          {setupStatusLabel[status]}
                        </option>
                      ))}
                    </select>
                  </SetupField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SetupField label="1a resposta">
                    <input
                      type="number"
                      min="1"
                      value={queueForm.slaFirstResponseMinutes}
                      onChange={(event) =>
                        updateQueueForm(
                          "slaFirstResponseMinutes",
                          event.target.value,
                        )
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                  <SetupField label="Resolucao">
                    <input
                      type="number"
                      min="1"
                      value={queueForm.slaResolutionMinutes}
                      onChange={(event) =>
                        updateQueueForm(
                          "slaResolutionMinutes",
                          event.target.value,
                        )
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <SetupField label="Roteamento">
                    <input
                      value={queueForm.routingStrategy}
                      onChange={(event) =>
                        updateQueueForm("routingStrategy", event.target.value)
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                  <SetupField label="Distribuicao">
                    <input
                      value={queueForm.assignmentStrategy}
                      onChange={(event) =>
                        updateQueueForm(
                          "assignmentStrategy",
                          event.target.value,
                        )
                      }
                      className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                </div>
              </div>

              {queueFeedback ? (
                <p className="mt-3 rounded-lg border border-[#dbe3ef] bg-[#fbfcfe] px-3 py-2 text-xs font-semibold text-[#63708a]">
                  {queueFeedback}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={savingQueue}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#101820] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                <Save className="h-4 w-4" aria-hidden="true" />
                {savingQueue ? "Salvando..." : "Salvar fila"}
              </button>
            </form>
            </div>
            ) : null}
          </div>

          <div className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-[#fbfcfe] p-3 xl:max-h-[calc(100vh-300px)] xl:overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#8a96aa]">
                  Assuntos
                </p>
                <h4 className="mt-1 text-sm font-semibold text-[#101820]">
                  {selectedQueue?.name ?? "Todas as filas"}
                </h4>
              </div>
              <div className="flex items-center gap-2">
                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                  {formatCount(visibleProfiles.length)} visiveis
                </span>
                <button
                  type="button"
                  onClick={startNewProfile}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-[#dbe3ef] bg-white text-[#A07C3B] transition-colors hover:border-[#A07C3B]/35"
                  aria-label="Novo assunto"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="mt-3">
              <label className="relative block min-w-0">
                <Search
                  className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A07C3B]"
                  aria-hidden="true"
                />
                <input
                  value={subjectSearch}
                  onChange={(event) => setSubjectSearch(event.target.value)}
                  placeholder="Buscar assunto"
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white pl-9 pr-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </label>
            </div>

            <div className="mt-3 max-h-[calc(100vh-430px)] overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              <div className="space-y-2">
                {visibleProfiles.length > 0 ? (
                  visibleProfiles.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => startEditProfile(profile)}
                      className={[
                        "w-full rounded-xl border p-3 text-left transition-colors",
                        editingProfileId === profile.id
                          ? "border-[#A07C3B]/45 bg-[#fbf6ec]"
                          : "border-[#e4eaf3] bg-white hover:border-[#A07C3B]/30",
                      ].join(" ")}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[#101820]">
                            {profile.name}
                          </p>
                          <p className="mt-1 truncate text-xs font-medium text-[#63708a]">
                            {profile.queueLabel} | {profile.category} |{" "}
                            {profile.slug}
                          </p>
                        </div>
                        <span className="shrink-0 rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          {setupStatusLabel[profile.status] ?? profile.status}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/20">
                          {priorityLabel[profile.priority]}
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          TPR {profile.slaFirstResponseMinutes} min
                        </span>
                        <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                          TMA {formatSlaMinutes(profile.slaResolutionMinutes)}
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  <EmptyState
                    icon={Route}
                    title="Nenhum assunto configurado"
                    description="Cadastre assuntos para padronizar triagem, prioridade, SLA e metricas da Iris."
                  />
                )}
              </div>
            </div>
          </div>

          {profileModalOpen ? (
          <div
            className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-[#101820]/45 p-4 backdrop-blur-sm sm:items-center"
            onClick={() => setProfileModalOpen(false)}
          >
          <form
            onSubmit={saveProfile}
            onClick={(event) => event.stopPropagation()}
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[#dbe3ef] bg-white p-4 shadow-2xl [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#fbf6ec] text-[#A07C3B]">
                  <Settings2 className="h-4 w-4" aria-hidden="true" />
                </span>
                <div>
                  <h4 className="text-sm font-semibold text-[#101820]">
                    {editingProfileId ? "Editar assunto" : "Novo assunto"}
                  </h4>
                  <p className="text-xs text-[#63708a]">
                    caredesk_ticket_profiles
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setProfileModalOpen(false)}
                aria-label="Fechar"
                className="grid h-8 w-8 place-items-center rounded-lg border border-[#dbe3ef] text-[#63708a] transition-colors hover:border-[#A07C3B]/35 hover:text-[#101820]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="space-y-3">
              <SetupField label="Fila">
                <select
                  value={profileForm.queueId}
                  onChange={(event) =>
                    updateProfileForm("queueId", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                >
                  <option value="">Selecione</option>
                  {data.queues.map((queue) => (
                    <option key={queue.id} value={queue.id}>
                      {queue.name}
                    </option>
                  ))}
                </select>
              </SetupField>

              <SetupField label="Nome do assunto">
                <input
                  value={profileForm.name}
                  onChange={(event) =>
                    updateProfileForm("name", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  placeholder="Ex.: Segunda via de boleto"
                />
              </SetupField>

              <div className="grid grid-cols-2 gap-2">
                <SetupField label="Slug">
                  <input
                    value={profileForm.slug}
                    onChange={(event) =>
                      updateProfileForm(
                        "slug",
                        slugifyIrisProfile(event.target.value),
                      )
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    placeholder="segunda-via-boleto"
                  />
                </SetupField>
                <SetupField label="Categoria">
                  <input
                    value={profileForm.category}
                    onChange={(event) =>
                      updateProfileForm("category", event.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    placeholder="Financeiro"
                  />
                </SetupField>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SetupField label="Prioridade">
                  <select
                    value={profileForm.priority}
                    onChange={(event) =>
                      updateProfileForm("priority", event.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  >
                    {priorityOptions.map((priority) => (
                      <option key={priority} value={priority}>
                        {priorityLabel[priority]}
                      </option>
                    ))}
                  </select>
                </SetupField>
                <SetupField label="Status">
                  <select
                    value={profileForm.status}
                    onChange={(event) =>
                      updateProfileForm("status", event.target.value)
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  >
                    {setupStatusOptions.map((status) => (
                      <option key={status} value={status}>
                        {setupStatusLabel[status]}
                      </option>
                    ))}
                  </select>
                </SetupField>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <SetupField label="TPR">
                  <input
                    type="number"
                    min="1"
                    value={profileForm.slaFirstResponseMinutes}
                    onChange={(event) =>
                      updateProfileForm(
                        "slaFirstResponseMinutes",
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  />
                </SetupField>
                <SetupField label="TMA alvo">
                  <input
                    type="number"
                    min="1"
                    value={profileForm.slaResolutionMinutes}
                    onChange={(event) =>
                      updateProfileForm(
                        "slaResolutionMinutes",
                        event.target.value,
                      )
                    }
                    className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  />
                </SetupField>
              </div>

              <SetupField label="Campos obrigatorios">
                <input
                  value={profileForm.requiredFields}
                  onChange={(event) =>
                    updateProfileForm("requiredFields", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                  placeholder="contact_id, queue_id"
                />
              </SetupField>

              <SetupField label="Descricao">
                <textarea
                  value={profileForm.description}
                  onChange={(event) =>
                    updateProfileForm("description", event.target.value)
                  }
                  className="min-h-20 w-full resize-none rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-sm font-medium text-[#34415a] outline-none"
                  placeholder="Quando usar este assunto no atendimento."
                />
              </SetupField>
            </div>

            {profileFeedback ? (
              <p className="mt-3 rounded-lg border border-[#dbe3ef] bg-[#fbfcfe] px-3 py-2 text-xs font-semibold text-[#63708a]">
                {profileFeedback}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={savingProfile}
              className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {savingProfile ? "Salvando..." : "Salvar assunto"}
            </button>
          </form>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function IrisSetupTabs({
  active,
  onChange,
}: {
  active: "profiles" | "templates";
  onChange: (tab: "profiles" | "templates") => void;
}) {
  const tabs = [
    { id: "profiles" as const, icon: Route, label: "Filas e assuntos" },
    { id: "templates" as const, icon: MessageSquareText, label: "Templates" },
  ];

  return (
    <div className="inline-flex h-10 rounded-xl border border-[#dbe3ef] bg-[#fbfcfe] p-1">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.id;

        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={[
              "inline-flex items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
              selected
                ? "bg-[#101820] text-white shadow-sm"
                : "text-[#63708a] hover:bg-white hover:text-[#101820]",
            ].join(" ")}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

function IrisTemplateSetupPanel({
  onTemplatesSynced,
  profiles,
  queues,
  templates,
}: {
  onTemplatesSynced: () => void;
  profiles: IrisTicketProfileConfig[];
  queues: IrisQueueConfig[];
  templates: IrisTemplate[];
}) {
  const [templateForm, setTemplateForm] = useState(() =>
    createIrisTemplateForm(),
  );
  const [checkingTemplate, setCheckingTemplate] = useState(false);
  const [syncingMetaTemplates, setSyncingMetaTemplates] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false);
  const [uploadingTemplateMedia, setUploadingTemplateMedia] = useState(false);
  const [autoRefreshStatus, setAutoRefreshStatus] = useState(true);
  const [lastTemplateRefreshAt, setLastTemplateRefreshAt] = useState("");
  const [metaStatus, setMetaStatus] = useState<string | null>(null);
  const [queueFilter, setQueueFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [templateSearch, setTemplateSearch] = useState("");
  const [templateFeedback, setTemplateFeedback] = useState<
    IrisTemplateFeedback | string
  >("");
  const [removingTemplateId, setRemovingTemplateId] = useState<string | null>(
    null,
  );
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(
    null,
  );
  const [templatePhoneNumbers, setTemplatePhoneNumbers] = useState<
    IrisMetaPhoneNumberOption[]
  >([]);
  const templateMediaInputRef = useRef<HTMLInputElement | null>(null);
  const templateSyncNotifiedRef = useRef(new Set<string>());
  const localTemplate = useMemo(
    () => findIrisTemplateByMetaName(templates, templateForm.name),
    [templateForm.name, templates],
  );
  const selectedLibraryTemplate = useMemo(() => {
    if (selectedTemplateId) {
      return (
        templates.find((template) => template.id === selectedTemplateId) ?? null
      );
    }

    return localTemplate ?? null;
  }, [localTemplate, selectedTemplateId, templates]);
  const displayedStatus =
    metaStatus ?? readTemplateMetaStatus(selectedLibraryTemplate) ?? null;
  const buttons = parseTemplateButtons(templateForm.buttonsText);
  const preview = renderMetaTemplatePreview(
    templateForm.bodyText,
    templateForm.variables,
  );
  const subjectProfileOptions = useMemo(
    () => [...profiles].sort(sortIrisProfiles),
    [profiles],
  );
  const selectedSubjectProfileId = useMemo(() => {
    const exactMatch = subjectProfileOptions.find(
      (profile) =>
        profile.name === templateForm.subjectLabel &&
        profile.queueLabel === templateForm.queueLabel,
    );
    const subjectMatch = subjectProfileOptions.find(
      (profile) => profile.name === templateForm.subjectLabel,
    );

    return (
      exactMatch?.id ??
      subjectMatch?.id ??
      (templateForm.subjectLabel ? "__current" : "")
    );
  }, [
    subjectProfileOptions,
    templateForm.queueLabel,
    templateForm.subjectLabel,
  ]);
  const templateSubjectMissing =
    !templateForm.subjectLabel.trim() || !templateForm.queueLabel.trim();
  const templatePhoneMissing = !templateForm.phoneNumberId.trim();
  const selectedTemplatePhoneNumber = findMetaPhoneNumberOption(
    templatePhoneNumbers,
    templateForm.phoneNumberId,
  );
  const templatePhoneDisplayMissing = Boolean(
    templateForm.phoneNumberId.trim() &&
    !selectedTemplatePhoneNumber?.displayPhoneNumber,
  );
  const selectedHeaderOption =
    IRIS_TEMPLATE_HEADER_OPTIONS.find(
      (option) => option.id === templateForm.headerFormat,
    ) ?? IRIS_TEMPLATE_HEADER_OPTIONS[0];
  const templateMediaMissing =
    templateForm.headerFormat !== "NONE" && !templateForm.headerHandle.trim();
  const queueOptions = useMemo(
    () =>
      unique(
        [
          ...queues.map((queue) => queue.name),
          ...templates.map(readTemplateQueueLabel),
          templateForm.queueLabel,
        ].filter(Boolean),
      ).slice(0, 12),
    [queues, templateForm.queueLabel, templates],
  );
  const templateStats = useMemo(
    () => ({
      approved: templates.filter(
        (template) => readTemplateStatusGroup(template) === "APPROVED",
      ).length,
      pending: templates.filter(
        (template) => readTemplateStatusGroup(template) === "PENDING",
      ).length,
      rejected: templates.filter(
        (template) => readTemplateStatusGroup(template) === "REJECTED",
      ).length,
      total: templates.length,
    }),
    [templates],
  );
  const filteredTemplates = useMemo(() => {
    const search = templateSearch.trim().toLowerCase();

    return templates
      .filter((template) => {
        const queueLabel = readTemplateQueueLabel(template);
        const subjectLabel = readTemplateSubjectLabel(template);
        const statusGroup = readTemplateStatusGroup(template);
        const searchable = [
          template.name,
          readTemplateMetaName(template),
          queueLabel,
          subjectLabel,
          template.body,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return (
          (queueFilter === "all" || queueLabel === queueFilter) &&
          (statusFilter === "all" || statusGroup === statusFilter) &&
          (!search || searchable.includes(search))
        );
      })
      .sort(sortIrisTemplatesForSetup);
  }, [queueFilter, statusFilter, templateSearch, templates]);

  useEffect(() => {
    if (
      selectedTemplateId &&
      !templates.some((template) => template.id === selectedTemplateId)
    ) {
      setSelectedTemplateId(null);
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    setMetaStatus(readTemplateMetaStatus(selectedLibraryTemplate));
  }, [selectedLibraryTemplate]);

  useEffect(() => {
    if (!autoRefreshStatus || !templateForm.name.trim()) {
      return;
    }

    const timer = window.setInterval(() => {
      void checkTemplateStatus({ silent: true });
    }, IRIS_TEMPLATE_AUTO_REFRESH_MS);

    return () => window.clearInterval(timer);
  }, [
    autoRefreshStatus,
    templateForm.language,
    templateForm.name,
    templateForm.phoneNumberId,
  ]);

  useEffect(() => {
    void checkTemplateStatus({ silent: true });
  }, []);

  function updateTemplateForm(field: string, value: string) {
    setTemplateFeedback("");
    setTemplateForm((current) => ({
      ...current,
      [field]: value,
    }));
  }

  function startNewTemplate() {
    setSelectedTemplateId(null);
    setMetaStatus(null);
    setLastTemplateRefreshAt("");
    setTemplateFeedback("");
    setTemplateEditorOpen(true);
    setTemplateForm({
      ...createIrisTemplateDraft(),
      phoneNumberId:
        selectedTemplatePhoneNumber?.id ??
        templatePhoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ??
        templatePhoneNumbers[0]?.id ??
        "",
    });
  }

  function applyTemplateLibraryPreset(
    preset: (typeof IRIS_META_TEMPLATE_LIBRARY_PRESETS)[number],
  ) {
    setSelectedTemplateId(null);
    setMetaStatus(null);
    setLastTemplateRefreshAt("");
    setTemplateFeedback("");
    setTemplateForm((current) => {
      const suffix = new Date().toISOString().replace(/\D/g, "").slice(8, 14);
      const name = `${preset.id}_${suffix}`
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "_");
      const variables = buildTemplateVariablesFromPreset(preset.variableKeys);
      const phoneNumberId =
        current.phoneNumberId ||
        selectedTemplatePhoneNumber?.id ||
        templatePhoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ||
        templatePhoneNumbers[0]?.id ||
        "";

      return {
        ...current,
        bodyText: preset.bodyText,
        buttonsText: preset.buttonsText,
        category: preset.category,
        displayName: preset.title,
        headerFileName: "",
        headerFormat: "NONE",
        headerHandle: "",
        headerMimeType: "",
        headerSendLink: "",
        name,
        phoneNumberId,
        variables,
      };
    });
    setTemplateFeedback(
      createIrisTemplateFeedback({
        action:
          "Revise assunto, fila e telefone de envio antes de consultar ou enviar para a Meta.",
        message: `${preset.title} aplicado no formulario.`,
        title: "Modelo carregado",
        tone: "success",
      }),
    );
  }

  function selectTemplateSubject(profileId: string) {
    if (profileId === "__current") {
      return;
    }

    const profile = subjectProfileOptions.find(
      (option) => option.id === profileId,
    );

    setTemplateFeedback("");
    setTemplateForm((current) => ({
      ...current,
      queueLabel: profile?.queueLabel ?? "",
      subjectLabel: profile?.name ?? "",
    }));
  }

  function loadTemplateIntoForm(template: IrisTemplate) {
    setSelectedTemplateId(template.id);
    setTemplateEditorOpen(true);
    setMetaStatus(readTemplateMetaStatus(template));
    setTemplateFeedback("");
    setTemplateForm((current) => {
      const loaded = irisTemplateToForm(template);

      return {
        ...loaded,
        phoneNumberId:
          loaded.phoneNumberId ||
          current.phoneNumberId ||
          templatePhoneNumbers.find((phoneNumber) => phoneNumber.isDefault)
            ?.id ||
          templatePhoneNumbers[0]?.id ||
          "",
      };
    });
  }

  function addTemplateVariable(
    variable: (typeof IRIS_META_TEMPLATE_VARIABLES)[number],
  ) {
    setTemplateFeedback("");
    setTemplateForm((current) => {
      const variables = mergeTemplateVariable(current.variables, variable);
      const bodyText = current.bodyText.includes(variable.placeholder)
        ? current.bodyText
        : `${current.bodyText.trim()} ${variable.placeholder}`.trim();

      return {
        ...current,
        bodyText,
        variables,
      };
    });
  }

  function updateTemplateHeaderFormat(format: string) {
    setTemplateFeedback("");
    setTemplateForm((current) => ({
      ...current,
      headerFileName: format === "NONE" ? "" : current.headerFileName,
      headerFormat: format,
      headerHandle: format === "NONE" ? "" : current.headerHandle,
      headerMimeType: format === "NONE" ? "" : current.headerMimeType,
      headerSendLink: format === "NONE" ? "" : current.headerSendLink,
    }));
  }

  function clearTemplateHeaderMedia() {
    setTemplateFeedback("");
    setTemplateForm((current) => ({
      ...current,
      headerFileName: "",
      headerHandle: "",
      headerMimeType: "",
    }));
    if (templateMediaInputRef.current) {
      templateMediaInputRef.current.value = "";
    }
  }

  async function handleTemplateMediaFileChange(
    event: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = event.target.files?.[0];

    if (!file || templateForm.headerFormat === "NONE") {
      return;
    }

    setUploadingTemplateMedia(true);
    setTemplateFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const formData = new FormData();
      formData.append("format", templateForm.headerFormat);
      formData.append("file", file);

      const response = await fetch("/api/iris/meta/templates/media", {
        body: formData,
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as IrisMetaTemplateMediaUploadResponse | null;

      if (!response.ok) {
        setTemplateFeedback(
          createIrisTemplateFeedbackFromPayload(
            payload,
            "Nao foi possivel enviar a midia para a Meta.",
          ),
        );
        return;
      }

      setTemplateForm((current) => ({
        ...current,
        headerFileName: payload?.media?.fileName ?? file.name,
        headerFormat: payload?.media?.format ?? current.headerFormat,
        headerHandle: payload?.media?.handle ?? "",
        headerMimeType: payload?.media?.mimeType ?? file.type,
      }));
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action: "Agora envie o template para aprovacao da Meta.",
          message: "Midia de exemplo enviada para a Meta.",
          title: "Amostra recebida",
          tone: "success",
        }),
      );
    } catch (error) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel enviar a midia para a Meta.",
          title: "Falha no upload da midia",
          tone: "error",
        }),
      );
    } finally {
      setUploadingTemplateMedia(false);
      if (templateMediaInputRef.current) {
        templateMediaInputRef.current.value = "";
      }
    }
  }

  async function checkTemplateStatus(options?: { silent?: boolean }) {
    const silent = Boolean(options?.silent);

    if (!silent) {
      setCheckingTemplate(true);
      setTemplateFeedback("");
    }

    try {
      const accessToken = await getIrisAccessToken();
      const params = new URLSearchParams({
        bodyText: templateForm.bodyText,
        displayName: templateForm.displayName,
        language: templateForm.language,
        name: templateForm.name,
        queueLabel: templateForm.queueLabel,
        subjectLabel: templateForm.subjectLabel,
      });

      if (buttons.length) {
        params.set("buttons", buttons.join(","));
      }

      if (templateForm.phoneNumberId.trim()) {
        params.set("phoneNumberId", templateForm.phoneNumberId.trim());
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

      if (!response.ok) {
        if (!silent) {
          setTemplateFeedback(
            createIrisTemplateFeedbackFromPayload(
              payload,
              "Nao foi possivel consultar o template na Meta.",
            ),
          );
        }
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
        onTemplatesSynced();
      }

      const template = payload?.templates?.[0];
      const phoneNumbers = Array.isArray(payload?.phoneNumbers)
        ? payload.phoneNumbers
        : [];
      const selectedPhoneNumberId =
        payload?.selectedPhoneNumberId ??
        phoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ??
        phoneNumbers[0]?.id ??
        "";
      if (phoneNumbers.length) {
        setTemplatePhoneNumbers(phoneNumbers);
      }
      if (!templateForm.phoneNumberId.trim() && selectedPhoneNumberId) {
        setTemplateForm((current) =>
          current.phoneNumberId
            ? current
            : {
                ...current,
                phoneNumberId: selectedPhoneNumberId,
              },
        );
      }
      const status = template?.status ?? "NOT_FOUND";
      setMetaStatus(status);
      setLastTemplateRefreshAt(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      if (!silent) {
        if (payload?.error && !template) {
          setTemplateFeedback(
            createIrisTemplateFeedbackFromPayload(
              payload,
              "Nao foi possivel consultar o template na Meta.",
            ),
          );
          return;
        }

        const phoneMismatch =
          payload?.phoneNumberLink?.checkStatus === "checked" &&
          payload.phoneNumberLink.linked === false;
        setTemplateFeedback(
          phoneMismatch
            ? createIrisTemplateFeedback({
                action:
                  "Crie um novo template para o telefone selecionado ou selecione o telefone correto antes de consultar.",
                cause:
                  "Existe template com esse nome em outra WABA, mas ele nao pertence ao telefone de envio selecionado.",
                message:
                  "O template encontrado na Meta nao pertence ao telefone escolhido na Iris.",
                title: "Telefone divergente",
                tone: "error",
              })
            : createIrisTemplateFeedback({
                action: phoneNumberLinkFeedback(payload?.phoneNumberLink),
                cause: payload?.ignoredTemplateCount
                  ? "Existe template com esse nome em outra WABA, mas ele nao pertence ao telefone de envio selecionado."
                  : undefined,
                message: template
                  ? `Status Meta: ${templateStatusLabel(status)}.`
                  : "Template ainda nao encontrado na Meta para este nome e idioma.",
                title: template
                  ? "Consulta concluida"
                  : "Template nao localizado",
                tone: template ? "success" : "warning",
              }),
        );
      }
    } catch (error) {
      if (!silent) {
        setTemplateFeedback(
          createIrisTemplateFeedback({
            message:
              error instanceof Error
                ? error.message
                : "Nao foi possivel consultar o template na Meta.",
            title: "Falha ao consultar a Meta",
            tone: "error",
          }),
        );
      }
    } finally {
      if (!silent) {
        setCheckingTemplate(false);
      }
    }
  }

  async function syncApprovedMetaTemplates() {
    if (templateSubjectMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Escolha um assunto cadastrado para a Iris vincular fila e contexto antes de importar templates da Meta.",
          message: "Sincronizacao bloqueada por falta de assunto.",
          title: "Assunto obrigatorio",
          tone: "warning",
        }),
      );
      return;
    }

    if (templatePhoneMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Escolha o telefone de envio. A sincronizacao usa a WABA vinculada a esse telefone.",
          message: "Sincronizacao bloqueada por falta de telefone.",
          title: "Telefone obrigatorio",
          tone: "warning",
        }),
      );
      return;
    }

    setSyncingMetaTemplates(true);
    setTemplateFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const params = new URLSearchParams({
        language: templateForm.language,
        phoneNumberId: templateForm.phoneNumberId.trim(),
        queueLabel: templateForm.queueLabel,
        subjectLabel: templateForm.subjectLabel,
        syncApproved: "true",
      });

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

      if (!response.ok || payload?.error) {
        setTemplateFeedback(
          createIrisTemplateFeedbackFromPayload(
            payload,
            "Nao foi possivel sincronizar templates aprovados da Meta.",
          ),
        );
        return;
      }

      const phoneNumbers = Array.isArray(payload?.phoneNumbers)
        ? payload.phoneNumbers
        : [];
      if (phoneNumbers.length) {
        setTemplatePhoneNumbers(phoneNumbers);
      }

      const selectedPhoneNumberId =
        payload?.selectedPhoneNumberId ??
        phoneNumbers.find((phoneNumber) => phoneNumber.isDefault)?.id ??
        phoneNumbers[0]?.id ??
        "";
      if (!templateForm.phoneNumberId.trim() && selectedPhoneNumberId) {
        setTemplateForm((current) =>
          current.phoneNumberId
            ? current
            : {
                ...current,
                phoneNumberId: selectedPhoneNumberId,
              },
        );
      }

      const summary = payload?.localTemplateSyncSummary;
      const total = summary?.total ?? 0;
      const imported = summary?.imported ?? 0;
      const updated = summary?.updated ?? 0;
      const matched = summary?.matched ?? 0;
      const failed = summary?.failed ?? 0;

      setLastTemplateRefreshAt(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );

      if (total > 0 && failed === 0) {
        onTemplatesSynced();
        setTemplateFeedback(
          createIrisTemplateFeedback({
            action:
              "Abra o modal Novo atendimento novamente ou escolha o template na biblioteca atualizada.",
            cause:
              matched > 0
                ? "A Meta retornou templates ativos e a Iris reativou/atualizou o cache local."
                : undefined,
            message: `${total} template(s) aprovado(s) sincronizado(s): ${imported} importado(s), ${updated} atualizado(s).`,
            title: "Templates sincronizados",
            tone: "success",
          }),
        );
        return;
      }

      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Confirme no Meta Manager se o template esta ativo para este telefone, idioma e WABA. Se estiver, consulte pelo nome Meta exato.",
          message:
            "Nenhum template aprovado foi retornado pela Meta para este telefone e idioma.",
          title: "Nada para sincronizar",
          tone: "warning",
        }),
      );
    } catch (error) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel sincronizar templates aprovados da Meta.",
          title: "Falha ao sincronizar Meta",
          tone: "error",
        }),
      );
    } finally {
      setSyncingMetaTemplates(false);
    }
  }

  async function createTemplate() {
    if (templateSubjectMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Selecione um assunto cadastrado na lista. A fila sera vinculada automaticamente pelo cadastro do assunto.",
          message: "Template sem assunto vinculado.",
          title: "Assunto obrigatorio",
          tone: "warning",
        }),
      );
      return;
    }

    if (templatePhoneMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Escolha o telefone que vai enviar esse template. A Iris criara e consultara a WABA vinculada a esse telefone.",
          message: "Template sem telefone de envio vinculado.",
          title: "Telefone de envio obrigatorio",
          tone: "warning",
        }),
      );
      return;
    }

    if (templateMediaMissing) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Clique em Enviar exemplo na midia do header antes de enviar o template para aprovacao.",
          message:
            "Template com midia precisa de uma amostra aprovada pela Meta.",
          title: "Midia de exemplo pendente",
          tone: "warning",
        }),
      );
      return;
    }

    setCreatingTemplate(true);
    setTemplateFeedback(
      createIrisTemplateFeedback({
        action:
          "Aguarde o retorno da Meta. Se houver bloqueio, a Iris vai mostrar o motivo neste painel.",
        message: "Enviando o template para aprovacao da Meta.",
        title: "Envio em andamento",
        tone: "neutral",
      }),
    );

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/templates", {
        body: JSON.stringify({
          bodyText: templateForm.bodyText,
          buttons,
          category: templateForm.category,
          displayName: templateForm.displayName,
          headerFileName: templateForm.headerFileName,
          headerFormat: templateForm.headerFormat,
          headerHandle: templateForm.headerHandle,
          headerMimeType: templateForm.headerMimeType,
          headerSendLink: templateForm.headerSendLink,
          language: templateForm.language,
          name: templateForm.name,
          phoneNumberId: templateForm.phoneNumberId,
          queueLabel: templateForm.queueLabel,
          subjectLabel: templateForm.subjectLabel,
          variables: templateForm.variables,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as IrisMetaTemplatesResponse | null;

      if (!response.ok) {
        setTemplateFeedback(
          createIrisTemplateFeedbackFromPayload(
            payload,
            "Nao foi possivel criar o template real na Meta.",
          ),
        );
        return;
      }

      const status = payload?.template?.status ?? null;
      if (Array.isArray(payload?.phoneNumbers)) {
        setTemplatePhoneNumbers(payload.phoneNumbers);
      }
      if (payload?.selectedPhoneNumberId) {
        updateTemplateForm("phoneNumberId", payload.selectedPhoneNumberId);
      }
      setMetaStatus(status);
      setLastTemplateRefreshAt(
        new Date().toLocaleTimeString("pt-BR", {
          hour: "2-digit",
          minute: "2-digit",
        }),
      );
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            status === "PENDING"
              ? "Aguarde a aprovacao ou mantenha a atualizacao automatica ligada para acompanhar."
              : undefined,
          message: payload?.created
            ? `Template enviado para a Meta como ${templateStatusLabel(status)}.`
            : `Template ja existia na Meta como ${templateStatusLabel(status)}.`,
          title: payload?.created ? "Template enviado" : "Template ja existe",
          tone: status === "REJECTED" ? "warning" : "success",
        }),
      );
    } catch (error) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel criar o template real na Meta.",
          title: "Falha ao enviar para a Meta",
          tone: "error",
        }),
      );
    } finally {
      setCreatingTemplate(false);
    }
  }

  async function removeTemplateFromLibrary(
    templateToRemove?: IrisTemplate | null,
  ) {
    const targetTemplate =
      templateToRemove ?? selectedLibraryTemplate ?? localTemplate;

    if (!targetTemplate) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          action: "Selecione um template da biblioteca antes de excluir.",
          message: "Nenhum template selecionado para exclusao.",
          title: "Selecao obrigatoria",
          tone: "warning",
        }),
      );
      return;
    }

    const confirmed = window.confirm(
      `Excluir o template ${targetTemplate.name} da biblioteca Iris?`,
    );

    if (!confirmed) {
      return;
    }

    setRemovingTemplateId(targetTemplate.id);
    setTemplateFeedback("");

    try {
      const accessToken = await getIrisAccessToken();
      const response = await fetch("/api/iris/meta/templates", {
        body: JSON.stringify({
          action: "archive_local",
          removeReason: "Removido manualmente no Setup da Iris.",
          templateId: targetTemplate.id,
        }),
        cache: "no-store",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        method: "PATCH",
      });
      const payload = (await response
        .json()
        .catch(() => null)) as IrisTemplateArchiveResponse | null;

      if (!response.ok) {
        const linkedProtocol =
          typeof payload?.linkedTicket?.protocol === "string"
            ? payload.linkedTicket.protocol
            : null;
        const message = linkedProtocol
          ? `${payload?.error ?? "Nao foi possivel remover o template."} Protocolo: ${linkedProtocol}.`
          : (payload?.error ?? "Nao foi possivel remover o template.");

        setTemplateFeedback(
          createIrisTemplateFeedback({
            action:
              response.status === 409
                ? "Encerre o atendimento vinculado e tente novamente."
                : "Tente novamente em instantes.",
            message,
            title:
              response.status === 409
                ? "Template vinculado a ticket aberto"
                : "Falha ao remover template",
            tone: response.status === 409 ? "warning" : "error",
          }),
        );
        return;
      }

      onTemplatesSynced();

      if (selectedLibraryTemplate?.id === targetTemplate.id) {
        setSelectedTemplateId(null);
        startNewTemplate();
      }

      setTemplateFeedback(
        createIrisTemplateFeedback({
          action:
            "Esta acao arquiva apenas na Iris. O template permanece na Meta ate remocao oficial la.",
          message: payload?.alreadyArchived
            ? "Template ja estava arquivado na biblioteca Iris."
            : "Template removido da biblioteca Iris.",
          title: "Biblioteca atualizada",
          tone: "success",
        }),
      );
    } catch (error) {
      setTemplateFeedback(
        createIrisTemplateFeedback({
          message:
            error instanceof Error
              ? error.message
              : "Nao foi possivel remover o template da biblioteca.",
          title: "Falha ao remover template",
          tone: "error",
        }),
      );
    } finally {
      setRemovingTemplateId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className={`grid gap-4 ${templateEditorOpen ? "xl:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)]" : ""}`}>
        <section className="min-w-0 rounded-2xl border border-[#dbe3ef] bg-[#fbfcfe] p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h4 className="text-sm font-semibold text-[#101820]">
                Biblioteca de templates
              </h4>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Tooltip
                content={
                  !selectedLibraryTemplate
                    ? "Selecione um template da lista para excluir"
                    : removingTemplateId
                      ? "Excluindo template..."
                      : "Excluir template da biblioteca Iris"
                }
                placement="bottom"
              >
                <button
                  type="button"
                  onClick={() => void removeTemplateFromLibrary()}
                  disabled={
                    !selectedLibraryTemplate || Boolean(removingTemplateId)
                  }
                  aria-label="Excluir template da biblioteca Iris"
                  className="inline-flex size-9 items-center justify-center rounded-lg border border-rose-200 bg-rose-50 text-rose-700 transition-colors hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </Tooltip>
              <Tooltip content="Novo template" placement="bottom">
                <button
                  type="button"
                  onClick={startNewTemplate}
                  aria-label="Novo template"
                  className="inline-flex size-9 items-center justify-center rounded-lg bg-[#101820] text-white transition-colors hover:bg-[#1f2937]"
                >
                  <Plus className="h-4 w-4" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>
          </div>

          <div className="mt-3 grid gap-2 lg:grid-cols-[minmax(0,1fr)_190px]">
            <label className="relative block min-w-0">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#A07C3B]"
                aria-hidden="true"
              />
              <input
                value={templateSearch}
                onChange={(event) => setTemplateSearch(event.target.value)}
                placeholder="Buscar template"
                className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white pl-9 pr-3 text-sm font-semibold text-[#34415a] outline-none"
              />
            </label>
            <select
              value={queueFilter}
              onChange={(event) => setQueueFilter(event.target.value)}
              className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
            >
              <option value="all">Todas as filas</option>
              {queueOptions.map((queue) => (
                <option key={queue} value={queue}>
                  {queue}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {IRIS_TEMPLATE_STATUS_FILTERS.map((filter) => {
              const selected = statusFilter === filter.id;
              const count =
                filter.id === "all"
                  ? templates.length
                  : templates.filter(
                      (template) =>
                        readTemplateStatusGroup(template) === filter.id,
                    ).length;

              return (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setStatusFilter(filter.id)}
                  className={[
                    "inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ring-1 transition-colors",
                    selected
                      ? "bg-[#101820] text-white ring-[#101820]"
                      : "bg-white text-[#63708a] ring-[#dbe3ef] hover:text-[#101820]",
                  ].join(" ")}
                >
                  {filter.label}
                  <span
                    className={[
                      "inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10px] font-bold tabular-nums",
                      selected
                        ? "bg-white/20 text-white"
                        : "bg-[#eef2f8] text-[#34415a]",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          <IrisTemplateFeedbackBox feedback={templateFeedback} />

          <div className="mt-3 max-h-[calc(100vh-360px)] space-y-2 overflow-y-auto pr-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            {filteredTemplates.length ? (
              filteredTemplates.map((template) => {
                const status = readTemplateMetaStatus(template);
                const headerFormat = readTemplateHeaderFormat(template);
                const phoneLabel = readTemplatePhoneLabel(template);
                const selected = selectedLibraryTemplate?.id === template.id;

                return (
                  <button
                    key={template.id}
                    type="button"
                    onClick={() => loadTemplateIntoForm(template)}
                    className={[
                      "w-full rounded-xl border bg-white p-3 text-left transition-colors",
                      selected
                        ? "border-[#A07C3B] shadow-sm"
                        : "border-[#e4eaf3] hover:border-[#A07C3B]/40",
                    ].join(" ")}
                  >
                    <div className="flex min-w-0 items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <p className="max-w-full truncate text-sm font-semibold text-[#101820]">
                            {template.name}
                          </p>
                          <span className="shrink-0 rounded-full bg-[#f4f6fa] px-2 py-0.5 text-[10px] font-semibold text-[#63708a]">
                            {readTemplateQueueLabel(template)}
                          </span>
                          {headerFormat ? (
                            <span className="shrink-0 rounded-full bg-[#eef6ff] px-2 py-0.5 text-[10px] font-semibold text-[#1769aa]">
                              {templateHeaderFormatLabel(headerFormat)}
                            </span>
                          ) : null}
                          {phoneLabel ? (
                            <span className="max-w-[220px] shrink-0 truncate rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                              {phoneLabel}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs font-semibold text-[#63708a]">
                          {readTemplateSubjectLabel(template)}
                        </p>
                      </div>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ${templateStatusTone(status)}`}
                      >
                        {templateStatusLabel(status)}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-xs text-[#63708a]">
                      {template.body ??
                        readTemplateMetaName(template) ??
                        template.slug}
                    </p>
                  </button>
                );
              })
            ) : (
              <div className="rounded-xl border border-dashed border-[#dbe3ef] bg-white px-4 py-10 text-center">
                <p className="text-sm font-semibold text-[#101820]">
                  Nenhum template neste filtro.
                </p>
                <p className="mt-1 text-xs text-[#63708a]">
                  Ajuste fila, status ou busca para visualizar outros registros.
                </p>
              </div>
            )}
          </div>
        </section>

        {templateEditorOpen ? (
        <aside className="min-w-0 space-y-3">
          <div className="rounded-2xl border border-[#dbe3ef] bg-white p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTemplateEditorOpen(false)}
                  aria-label="Fechar editor"
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-[#dbe3ef] text-[#63708a] transition-colors hover:border-[#A07C3B]/35 hover:text-[#101820]"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                    Criacao
                  </p>
                  <h4 className="mt-1 text-sm font-semibold text-[#101820]">
                    {selectedTemplateId ? "Editar template" : "Novo template"}
                  </h4>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${templateStatusTone(displayedStatus)}`}
                >
                  {templateStatusLabel(displayedStatus)}
                </span>
                <button
                  type="button"
                  onClick={() => checkTemplateStatus()}
                  disabled={checkingTemplate}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#dbe3ef] bg-white px-3 text-xs font-semibold text-[#34415a] transition-colors hover:border-[#A07C3B]/30 disabled:cursor-not-allowed disabled:bg-slate-100"
                >
                  <Search className="h-4 w-4" aria-hidden="true" />
                  {checkingTemplate ? "Consultando" : "Consultar"}
                </button>
                <button
                  type="button"
                  onClick={syncApprovedMetaTemplates}
                  disabled={syncingMetaTemplates}
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg border border-[#A07C3B]/25 bg-[#fff8ec] px-3 text-xs font-semibold text-[#7A5E2C] transition-colors hover:border-[#A07C3B]/45 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                >
                  <RefreshCw
                    className={`h-4 w-4 ${syncingMetaTemplates ? "animate-spin" : ""}`}
                    aria-hidden="true"
                  />
                  {syncingMetaTemplates ? "Sincronizando" : "Sincronizar Meta"}
                </button>
                <button
                  type="button"
                  onClick={createTemplate}
                  disabled={
                    creatingTemplate ||
                    templateSubjectMissing ||
                    templatePhoneMissing ||
                    templateMediaMissing ||
                    uploadingTemplateMedia
                  }
                  className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#A07C3B] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <Send className="h-4 w-4" aria-hidden="true" />
                  {creatingTemplate ? "Enviando" : "Enviar para Meta"}
                </button>
              </div>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
              <SetupField label="Assunto">
                <select
                  value={selectedSubjectProfileId}
                  onChange={(event) =>
                    selectTemplateSubject(event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                >
                  <option value="">Escolha um assunto</option>
                  {selectedSubjectProfileId === "__current" ? (
                    <option value="__current">
                      {templateForm.subjectLabel} |{" "}
                      {templateForm.queueLabel || "Fila nao localizada"}
                    </option>
                  ) : null}
                  {subjectProfileOptions.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name} | {profile.queueLabel}
                    </option>
                  ))}
                </select>
              </SetupField>
              <SetupField label="Fila vinculada">
                <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-[#dbe3ef] bg-[#fbfcfe] px-3 text-sm font-semibold text-[#34415a]">
                  <Route
                    className="h-4 w-4 shrink-0 text-[#A07C3B]"
                    aria-hidden="true"
                  />
                  <span className="truncate">
                    {templateForm.queueLabel || "Definida pelo assunto"}
                  </span>
                </div>
              </SetupField>
            </div>

            <div className="mt-3">
              <SetupField label="Telefone de envio">
                <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_minmax(180px,0.45fr)]">
                  <div className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-[#dbe3ef] bg-white px-3">
                    <Smartphone
                      className="h-4 w-4 shrink-0 text-[#A07C3B]"
                      aria-hidden="true"
                    />
                    <select
                      value={templateForm.phoneNumberId}
                      onChange={(event) => {
                        setMetaStatus(null);
                        setLastTemplateRefreshAt("");
                        updateTemplateForm("phoneNumberId", event.target.value);
                      }}
                      className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-[#34415a] outline-none"
                    >
                      <option value="">Selecione o telefone</option>
                      {templatePhoneNumbers.map((phoneNumber) => (
                        <option key={phoneNumber.id} value={phoneNumber.id}>
                          {formatMetaPhoneNumberOption(phoneNumber)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex h-10 min-w-0 items-center rounded-lg border border-[#dbe3ef] bg-[#fbfcfe] px-3 text-xs font-semibold text-[#63708a]">
                    <span className="truncate">
                      {selectedTemplatePhoneNumber?.displayPhoneNumber
                        ? selectedTemplatePhoneNumber.isDefault
                          ? "Telefone padrao da Iris"
                          : "Telefone selecionado"
                        : "Define a WABA do template"}
                    </span>
                  </div>
                </div>
                <p className="mt-1 truncate text-xs font-medium text-[#63708a]">
                  {selectedTemplatePhoneNumber?.displayPhoneNumber
                    ? `${formatMetaPhoneNumberOption(selectedTemplatePhoneNumber)} sera usado para consultar, criar e enviar este template.`
                    : templateForm.phoneNumberId
                      ? "A Meta nao retornou o numero exibivel. A Iris usara o ID do telefone selecionado e validara a WABA no servidor."
                      : "A Meta aprova templates por WABA; a Iris resolve a WABA a partir do telefone escolhido."}
                </p>
              </SetupField>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SetupField label="Nome interno">
                <input
                  value={templateForm.displayName}
                  onChange={(event) =>
                    updateTemplateForm("displayName", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </SetupField>
              <SetupField label="Nome Meta">
                <input
                  value={templateForm.name}
                  onChange={(event) =>
                    updateTemplateForm(
                      "name",
                      event.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9_]/g, "_"),
                    )
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </SetupField>
            </div>

            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_130px]">
              <SetupField label="Categoria Meta">
                <select
                  value={templateForm.category}
                  onChange={(event) =>
                    updateTemplateForm("category", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                >
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </SetupField>
              <SetupField label="Idioma">
                <input
                  value={templateForm.language}
                  onChange={(event) =>
                    updateTemplateForm("language", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </SetupField>
            </div>

            <div className="mt-3 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h5 className="text-sm font-semibold text-[#101820]">
                    Midia do header
                  </h5>
                  <p className="mt-1 text-xs font-medium text-[#63708a]">
                    Use imagem ou video quando a primeira mensagem precisar de
                    contexto visual aprovado pela Meta.
                  </p>
                </div>
                {templateForm.headerHandle ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-700 ring-1 ring-emerald-100">
                    Exemplo enviado
                  </span>
                ) : null}
              </div>

              <div className="mt-3 grid gap-2 sm:grid-cols-4">
                {IRIS_TEMPLATE_HEADER_OPTIONS.map((option) => {
                  const selected = templateForm.headerFormat === option.id;
                  const HeaderIcon =
                    option.id === "IMAGE"
                      ? ImageIcon
                      : option.id === "VIDEO"
                        ? Video
                        : option.id === "DOCUMENT"
                          ? FileText
                          : MessageSquareText;

                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => updateTemplateHeaderFormat(option.id)}
                      className={[
                        "min-w-0 rounded-lg border px-3 py-2 text-left transition-colors",
                        selected
                          ? "border-[#A07C3B] bg-[#fff8ec] text-[#101820]"
                          : "border-[#dbe3ef] bg-white text-[#63708a] hover:border-[#A07C3B]/40 hover:text-[#101820]",
                      ].join(" ")}
                    >
                      <div className="flex items-center gap-2">
                        <HeaderIcon
                          className="h-4 w-4 shrink-0"
                          aria-hidden="true"
                        />
                        <span className="truncate text-xs font-semibold">
                          {option.label}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-[11px] font-medium">
                        {option.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              {templateForm.headerFormat !== "NONE" ? (
                <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                  <div className="rounded-lg border border-[#dbe3ef] bg-white p-3">
                    <input
                      ref={templateMediaInputRef}
                      type="file"
                      accept={selectedHeaderOption.accept}
                      onChange={handleTemplateMediaFileChange}
                      className="hidden"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-[#101820]">
                          {templateForm.headerFileName ||
                            "Exemplo para aprovacao"}
                        </p>
                        <p className="mt-1 text-[11px] font-medium text-[#63708a]">
                          A Meta usa este arquivo como amostra do template.
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {templateForm.headerHandle ? (
                          <button
                            type="button"
                            onClick={clearTemplateHeaderMedia}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[#dbe3ef] bg-white text-[#63708a] hover:border-rose-200 hover:text-rose-600"
                            aria-label="Remover midia"
                          >
                            <X className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => templateMediaInputRef.current?.click()}
                          disabled={uploadingTemplateMedia}
                          className="inline-flex h-8 items-center justify-center gap-2 rounded-lg bg-[#101820] px-3 text-xs font-semibold text-white transition-colors hover:bg-[#1f2937] disabled:cursor-not-allowed disabled:bg-slate-300"
                        >
                          <Upload className="h-4 w-4" aria-hidden="true" />
                          {uploadingTemplateMedia
                            ? "Enviando"
                            : "Enviar exemplo"}
                        </button>
                      </div>
                    </div>
                  </div>

                  <SetupField label="URL publica para envio">
                    <input
                      value={templateForm.headerSendLink}
                      onChange={(event) =>
                        updateTemplateForm("headerSendLink", event.target.value)
                      }
                      placeholder="https://..."
                      className="h-12 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                    />
                  </SetupField>
                </div>
              ) : null}
            </div>

            <div className="mt-3">
              <SetupField label="Botoes quick reply">
                <input
                  value={templateForm.buttonsText}
                  onChange={(event) =>
                    updateTemplateForm("buttonsText", event.target.value)
                  }
                  className="h-10 w-full rounded-lg border border-[#dbe3ef] bg-white px-3 text-sm font-semibold text-[#34415a] outline-none"
                />
              </SetupField>
            </div>

            <div className="mt-3">
              <SetupField label="Mensagem">
                <textarea
                  value={templateForm.bodyText}
                  onChange={(event) =>
                    updateTemplateForm("bodyText", event.target.value)
                  }
                  className="min-h-28 w-full resize-none rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-sm font-medium leading-6 text-[#34415a] outline-none"
                />
              </SetupField>
            </div>

            <div className="mt-3 rounded-xl border border-[#e4eaf3] bg-[#fbfcfe] p-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <h5 className="text-sm font-semibold text-[#101820]">
                  Variaveis
                </h5>
                <span className="rounded-full bg-white px-2 py-1 text-[11px] font-semibold text-[#63708a] ring-1 ring-[#dbe3ef]">
                  Meta {`{{1}}`}, {`{{2}}`}
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {IRIS_META_TEMPLATE_VARIABLES.map((variable) => (
                  <button
                    key={variable.key}
                    type="button"
                    onClick={() => addTemplateVariable(variable)}
                    title={`${variable.label} · ${variable.readiness}`}
                    className="flex min-w-0 items-center justify-between gap-2 rounded-lg border border-[#dbe3ef] bg-white px-2.5 py-1.5 text-left transition-colors hover:border-[#A07C3B]/35 hover:bg-[#fbf6ec]"
                  >
                    <span className="min-w-0 truncate text-xs font-semibold text-[#101820]">
                      {variable.label}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <span className="font-mono text-[11px] text-[#A07C3B]">
                        {variable.placeholder}
                      </span>
                      <span className="rounded-full bg-[#f4f6fa] px-1.5 py-0.5 text-[10px] font-semibold text-[#63708a]">
                        {variable.readiness}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#e7dfd3] bg-[#f8f4ec] p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                Preview
              </p>
              <span className="truncate text-xs font-semibold text-[#63708a]">
                {templateForm.queueLabel} / {templateForm.subjectLabel}
              </span>
            </div>
            {templateForm.headerFormat !== "NONE" ? (
              <div className="mt-3 flex min-h-24 items-center justify-center rounded-xl border border-dashed border-[#d8c7a7] bg-white px-4 py-3 text-center">
                <div>
                  <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-[#fbf6ec] text-[#A07C3B]">
                    {templateForm.headerFormat === "IMAGE" ? (
                      <ImageIcon className="h-5 w-5" aria-hidden="true" />
                    ) : templateForm.headerFormat === "VIDEO" ? (
                      <Video className="h-5 w-5" aria-hidden="true" />
                    ) : (
                      <FileText className="h-5 w-5" aria-hidden="true" />
                    )}
                  </div>
                  <p className="text-xs font-semibold text-[#101820]">
                    Header {selectedHeaderOption.label}
                  </p>
                  <p className="mt-1 max-w-xs truncate text-[11px] font-medium text-[#63708a]">
                    {templateForm.headerFileName || "Midia de exemplo pendente"}
                  </p>
                </div>
              </div>
            ) : null}
            <p className="mt-2 break-words text-sm font-medium leading-6 text-[#101820]">
              {preview}
            </p>
            {buttons.length ? (
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {buttons.map((button) => (
                  <span
                    key={button}
                    className="inline-flex h-9 min-w-0 items-center justify-center rounded-lg border border-emerald-100 bg-white px-2 text-sm font-semibold text-emerald-700"
                  >
                    <span className="truncate">{button}</span>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="rounded-2xl border border-[#dbe3ef] bg-[#fbfcfe] p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
                  Status Meta
                </p>
                <h4 className="mt-1 truncate text-sm font-semibold text-[#101820]">
                  {templateForm.displayName}
                </h4>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${templateStatusTone(displayedStatus)}`}
              >
                {templateStatusLabel(displayedStatus)}
              </span>
            </div>

            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-xs font-semibold text-[#63708a]">
              <span>Atualizar aprovacao automaticamente</span>
              <input
                type="checkbox"
                checked={autoRefreshStatus}
                onChange={(event) => setAutoRefreshStatus(event.target.checked)}
                className="h-4 w-4 accent-[#A07C3B]"
              />
            </label>

            {lastTemplateRefreshAt ? (
              <p className="mt-2 text-xs font-medium text-[#63708a]">
                Ultima consulta: {lastTemplateRefreshAt}
              </p>
            ) : null}
            {selectedTemplatePhoneNumber ? (
              <p className="mt-1 truncate text-xs font-semibold text-[#34415a]">
                Telefone:{" "}
                {formatMetaPhoneNumberOption(selectedTemplatePhoneNumber)}
              </p>
            ) : null}

            <IrisTemplateFeedbackBox feedback={templateFeedback} />

            <div className="mt-3 grid gap-2">
              {templateSubjectMissing ? (
                <p className="rounded-lg border border-[#f2dfbf] bg-[#fffbeb] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
                  Escolha o assunto antes de enviar. A fila sera preenchida pelo
                  cadastro do assunto.
                </p>
              ) : null}
              {templatePhoneMissing ? (
                <p className="rounded-lg border border-[#f2dfbf] bg-[#fffbeb] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
                  Escolha o telefone de envio. A Iris cria e consulta o template
                  na WABA desse telefone.
                </p>
              ) : null}
              {templatePhoneDisplayMissing ? (
                <p className="rounded-lg border border-[#f2dfbf] bg-[#fffbeb] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
                  A Meta nao retornou o numero exibivel do telefone selecionado.
                  A criacao segue pelo ID do telefone e pela WABA validada no
                  servidor.
                </p>
              ) : null}
              {templateMediaMissing ? (
                <p className="rounded-lg border border-[#f2dfbf] bg-[#fffbeb] px-3 py-2 text-xs font-semibold text-[#7A5E2C]">
                  Template com midia precisa de uma amostra enviada para
                  aprovacao da Meta.
                </p>
              ) : null}
              {templateForm.headerFormat !== "NONE" &&
              templateForm.headerHandle &&
              !templateForm.headerSendLink.trim() ? (
                <p className="rounded-lg border border-[#dbe3ef] bg-white px-3 py-2 text-xs font-semibold text-[#63708a]">
                  Cadastre uma URL publica para a Iris enviar esta midia no
                  atendimento ativo.
                </p>
              ) : null}
            </div>
          </div>
        </aside>
        ) : null}
      </div>
    </div>
  );
}


function IrisTemplateMetricCard({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: typeof MessageSquareText;
  label: string;
  tone?: IrisTone;
  value: string;
}) {
  return (
    <div className="rounded-2xl border border-[#dbe3ef] bg-white p-3">
      <div className="flex items-center justify-between gap-3">
        <span
          className={`grid h-9 w-9 place-items-center rounded-xl ${toneBg(tone)}`}
        >
          <Icon className={`h-4 w-4 ${toneText(tone)}`} aria-hidden="true" />
        </span>
        <span className="text-lg font-semibold text-[#101820]">{value}</span>
      </div>
      <p className="mt-3 truncate text-xs font-semibold uppercase tracking-normal text-[#8a96aa]">
        {label}
      </p>
    </div>
  );
}
