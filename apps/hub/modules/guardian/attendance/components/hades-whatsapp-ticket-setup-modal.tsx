"use client";

import { useEffect, useMemo, useState } from "react";
import { MessageCircle } from "lucide-react";
import { HadesWhatsAppReadonlyField } from "@/modules/guardian/attendance/components/hades-whatsapp-fields";
import {
  buildInstallmentOptions,
  resolveRelatedInstallmentLabels,
} from "@/modules/guardian/attendance/iris-ticket-installments";
import {
  createsIrisSla,
  findDefaultProfileId,
  findPreferredQueueId,
  formatSlaMinutes,
  mapIrisPriority,
  requiresIrisInstallment,
  requiresIrisUnit,
  type IrisTicketChannelOption,
  type IrisTicketProfileOption,
  type IrisTicketQueueOption,
  type IrisTicketTemplateOption,
} from "@/modules/guardian/attendance/iris-ticket-options";
import {
  buildTicketTemplateMessagePreview,
  formatInstallmentSummaryForTemplatePreview,
  resolveTicketTemplateProtocolPreview,
} from "@/modules/guardian/attendance/iris-ticket-template-preview";
import { firstName } from "@/modules/guardian/attendance/hades-whatsapp-thread";
import type { QueueClient } from "@/modules/guardian/attendance/types";

const EMPTY_FIELD = "-";

export function HadesWhatsAppTicketSetupModal({
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
  const previewInstallmentLabels = useMemo(
    () => resolveRelatedInstallmentLabels(client, selectedUnitIds, relatedInstallments),
    [client, selectedUnitIds, relatedInstallments],
  );
  const previewProtocolReference = useMemo(
    () => resolveTicketTemplateProtocolPreview(linkedAttendanceProtocol),
    [linkedAttendanceProtocol],
  );
  const templateMessagePreview = useMemo(() => {
    return buildTicketTemplateMessagePreview({
      body: selectedTemplate?.body ?? null,
      firstName: firstName(client.nome),
      installmentsSummary: formatInstallmentSummaryForTemplatePreview(
        previewInstallmentLabels,
      ),
      protocolReference: previewProtocolReference,
    });
  }, [
    client.nome,
    previewInstallmentLabels,
    previewProtocolReference,
    selectedTemplate?.body,
  ]);
  const templateApproved = Boolean(selectedTemplate?.id && selectedTemplate.metaStatus === "APPROVED");
  const missingProfile = !profileId;
  const missingChannel = !channelId;
  const missingQueue = !queueId;
  const missingTemplate = !templateId;
  const missingUnit = requiresIrisUnit(selectedProfile) && selectedUnitIds.length === 0;
  const missingInstallment =
    requiresIrisInstallment(selectedProfile) && relatedInstallments.length === 0;
  const missingPriority = !selectedProfile?.priority;
  const missingSla = createsIrisSla(selectedProfile) && (selectedProfile?.slaFirstResponseMinutes ?? 0) <= 0;
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
          <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">
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
              <HadesWhatsAppReadonlyField label="Cliente" value={client.nome} />
              <HadesWhatsAppReadonlyField label="Telefone" value={client.dados360.telefone} />
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
              <HadesWhatsAppReadonlyField label="Operador Iris" value={operatorLabel} />
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
                <span className="text-xs font-semibold text-[#7A5E2C]">Assunto</span>
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
              <p className="mt-1 text-[11px] font-medium text-slate-400">
                Variaveis sugeridas: {"{{1}}"} nome, {"{{2}}"} parcela(s), {"{{3}}"} protocolo.
              </p>
            </label>
            <div className="rounded-xl border border-[#A07C3B]/20 bg-[#A07C3B]/5 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-[#7A5E2C]">Preview da mensagem</p>
                <span className="text-[11px] font-medium text-slate-500">WhatsApp</span>
              </div>
              <p className="mt-2 whitespace-pre-wrap rounded-lg border border-[#A07C3B]/20 bg-white px-3 py-2 text-sm leading-6 text-slate-700">
                {templateMessagePreview}
              </p>
              <p className="mt-2 text-[11px] font-medium text-slate-500">
                Protocolo de referencia: {previewProtocolReference}.
              </p>
            </div>

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
              <HadesWhatsAppReadonlyField label="Unidade relacionada" value="Opcional para este assunto" />
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
                      {client.c2xInstallmentsLoaded === false
                        ? "Aguardando parcelas reais do C2X para a unidade selecionada."
                        : "Nenhuma parcela vencida encontrada para a unidade selecionada."}
                    </p>
                )}
              </div>
            ) : (
              <HadesWhatsAppReadonlyField label="Parcelas relacionadas" value="Nao obrigatorio para este assunto" />
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
            <p className="text-xs font-semibold uppercase tracking-normal text-[#A07C3B]">Iris</p>
            <div className="mt-3 grid gap-2">
              <HadesWhatsAppReadonlyField label="Canal" value={selectedChannel?.name ?? EMPTY_FIELD} />
              <HadesWhatsAppReadonlyField label="Fila" value={selectedQueue?.name ?? EMPTY_FIELD} />
              <HadesWhatsAppReadonlyField label="Template" value={selectedTemplate?.name ?? EMPTY_FIELD} />
              <HadesWhatsAppReadonlyField label="Protocolo Iris" value={linkedAttendanceProtocol ?? "AT gerado na abertura"} />
              <HadesWhatsAppReadonlyField
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
                <HadesWhatsAppReadonlyField label="Categoria" value={selectedProfile?.category ?? EMPTY_FIELD} />
                <HadesWhatsAppReadonlyField label="Prioridade" value={selectedProfile ? mapIrisPriority(selectedProfile.priority) : EMPTY_FIELD} />
                <HadesWhatsAppReadonlyField label="Primeira resposta" value={selectedProfile ? formatSlaMinutes(selectedProfile.slaFirstResponseMinutes) : EMPTY_FIELD} />
                <HadesWhatsAppReadonlyField label="Resolucao" value={selectedProfile ? formatSlaMinutes(selectedProfile.slaResolutionMinutes) : EMPTY_FIELD} />
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
                              ? "Selecione um assunto."
                              : missingUnit
                                ? "Selecione uma ou mais unidades para este assunto."
                                : missingInstallment
                                  ? "Selecione ao menos uma parcela vencida relacionada."
                                  : missingPriority
                                    ? "Defina a prioridade do assunto."
                                    : "Defina o SLA do assunto."}
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
