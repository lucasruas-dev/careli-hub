"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  Check,
  Headset,
  Info,
  Loader2,
  MessageCircle,
  Search,
  Send,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import type { QueueClient } from "@/modules/guardian/attendance/types";

// Form de abertura de atendimento de COBRANCA (UI propria do Hades; Iris e o
// motor). Usa o endpoint real /api/iris/tickets, amarrado na fila "cobranca".
// O assunto vem dos perfis da fila de cobranca e o template vem dos templates
// APROVADOS no Meta (via Iris). Cria o ticket AT (Iris) com o contexto de
// cobranca no metadata (parcelas + unidade + cliente C2X).
//
// Motivo do form: a Meta so deixa abrir conversa ativa se o cliente aceitou
// falar com a gente. Por isso, com a janela de 24h fechada, mandamos um template
// aprovado; se ele responder, a janela abre e conversamos normalmente. Com a
// janela aberta, nao precisa de template.

type IrisQueue = { id: string; name: string; slug: string };
type IrisProfile = {
  category?: string | null;
  id: string;
  name: string;
  queue_id?: string | null;
  slug: string;
};
type IrisTemplate = {
  body?: string | null;
  category?: string | null;
  id: string;
  language?: string | null;
  name: string;
  slug?: string | null;
  templateName?: string | null;
};
type IrisConfig = {
  profiles: IrisProfile[];
  queues: IrisQueue[];
  templates: IrisTemplate[];
};

type OverdueInstallment = NonNullable<QueueClient["c2xInstallments"]>[number];

export function HadesAttendanceModal({
  client,
  onClose,
  onCreated,
}: {
  client: QueueClient | null;
  // Quando aberto da Fila de atendimento (sem cliente), busca-se na fila de cobranca.
  queueClients?: QueueClient[];
  onClose: () => void;
  onCreated: (ticketId: string | null) => void;
}) {
  const [config, setConfig] = useState<IrisConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [profileId, setProfileId] = useState<string>("");
  const [templateId, setTemplateId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // O cliente pode chegar sem parcelas (a fila e lazy). Aqui garantimos o carregamento.
  const [detail, setDetail] = useState<QueueClient | null>(client);
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    setDetail(client);
  }, [client]);

  // Auto-carrega as parcelas do cliente quando ainda nao vieram da fila.
  useEffect(() => {
    if (!client) return;
    const needsInstallments =
      client.c2xInstallmentsLoaded === false ||
      !Array.isArray(client.c2xInstallments);
    if (!needsInstallments) return;

    let cancelled = false;
    void (async () => {
      setLoadingDetail(true);
      try {
        const token = await accessToken();
        const response = await fetch(
          `/api/hades/attendance/client/${encodeURIComponent(client.id)}`,
          {
            cache: "no-store",
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          },
        );
        const payload = (await response.json().catch(() => null)) as {
          client?: QueueClient;
        } | null;
        if (cancelled || !response.ok || !payload?.client) return;
        setDetail((current) =>
          current ? { ...current, ...payload.client } : payload.client ?? null,
        );
      } catch {
        // mantem o cliente sem parcelas; o form avisa "sem parcelas carregadas".
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client]);

  const overdue = useMemo<OverdueInstallment[]>(
    () =>
      (detail?.c2xInstallments ?? []).filter(
        (installment) => installment.status === "Vencida",
      ),
    [detail?.c2xInstallments],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingConfig(true);
      try {
        const token = await accessToken();
        const response = await fetch("/api/iris/tickets", {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        const payload = (await response.json().catch(() => null)) as {
          profiles?: IrisProfile[];
          queues?: IrisQueue[];
          templates?: IrisTemplate[];
        } | null;
        if (cancelled || !response.ok || !payload) {
          throw new Error("config");
        }
        const cobrancaQueue = (payload.queues ?? []).find(
          (queue) => queue.slug === "cobranca",
        );
        const profiles = (payload.profiles ?? []).filter(
          (profile) => profile.queue_id === cobrancaQueue?.id,
        );
        const templates = payload.templates ?? [];
        setConfig({
          profiles: profiles.length ? profiles : payload.profiles ?? [],
          queues: payload.queues ?? [],
          templates,
        });
        setProfileId(
          (profiles.find((p) => p.slug === "primeiro-contato") ?? profiles[0])
            ?.id ?? "",
        );
        setTemplateId(
          (templates.find((t) => t.slug === "cobranca-geral") ?? templates[0])
            ?.id ?? "",
        );
      } catch {
        if (!cancelled) {
          setError("Não foi possível carregar a configuração do atendimento.");
        }
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const cobrancaQueue = config?.queues.find((queue) => queue.slug === "cobranca");
  const template = config?.templates.find((item) => item.id === templateId);
  const selectedProfile = config?.profiles.find((p) => p.id === profileId);
  const selectedInstallments = overdue.filter((item) => selected.has(item.id));
  const selectedTotal = selectedInstallments.reduce(
    (sum, item) => sum + item.valueNumber,
    0,
  );

  // Unidade(s) do atendimento: a cobranca e por cliente, mas as parcelas carregam
  // o codigo da unidade. Mostra as selecionadas; sem selecao, as das vencidas.
  const unitCodes = useMemo(() => {
    const source = selectedInstallments.length ? selectedInstallments : overdue;
    return Array.from(
      new Set(
        source
          .map((item) => item.unitCode)
          .filter((code): code is string => Boolean(code)),
      ),
    );
  }, [overdue, selectedInstallments]);

  const installmentLabels = selectedInstallments.map(
    (item) =>
      `${item.unitCode ? `${item.unitCode} · ` : ""}${item.number} · ${item.reference}`,
  );
  const allSelected =
    overdue.length > 0 && overdue.every((item) => selected.has(item.id));

  // Pre-visualizacao do que a Meta envia: {{1}} nome, {{2}} resumo das parcelas
  // (mesmo corte do backend: 3 + "+N parcela(s)"), {{3}} protocolo (gerado na
  // abertura). So importa com a janela de 24h fechada.
  const firstName = detail
    ? detail.nome.trim().split(/\s+/)[0] ?? detail.nome
    : "{{1}}";
  const previewText = template?.body
    ? renderTemplatePreview(template.body, [
        firstName,
        formatInstallmentSummary(installmentLabels),
        "(gerado na abertura)",
      ])
    : null;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((current) => {
      const everySelected =
        overdue.length > 0 && overdue.every((item) => current.has(item.id));
      return everySelected
        ? new Set<string>()
        : new Set(overdue.map((item) => item.id));
    });
  }

  async function submit() {
    if (!detail) return;
    setSubmitting(true);
    setError(null);

    const phone = detail.dados360?.telefone?.trim() || "";
    const payload = {
      apoloEntityId: detail.id,
      contactName: detail.nome,
      firstName,
      metadata: {
        relatedInstallments: installmentLabels,
        cobranca: {
          clientId: detail.id,
          empreendimento: detail.carteira.empreendimento,
          unidades: unitCodes,
          parcelas: selectedInstallments.map((item) => ({
            id: item.id,
            number: item.number,
            reference: item.reference,
            unitCode: item.unitCode ?? null,
            value: item.value,
          })),
        },
      },
      phone,
      profileId: selectedProfile?.id,
      queueId: cobrancaQueue?.id,
      sourceEntityId: detail.id,
      sourceEntityType: "guardian-client",
      sourceModule: "guardian",
      subject: selectedProfile?.name ?? "Cobrança",
      templateId: template?.id,
      templateLanguage: template?.language ?? "pt_BR",
      templateName: template?.templateName ?? template?.name,
    };

    async function attempt(sendTemplate: boolean) {
      const token = await accessToken();
      const response = await fetch("/api/iris/tickets", {
        body: JSON.stringify({ ...payload, sendTemplate }),
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
        ticket?: { id?: string };
      } | null;
      return { body, response };
    }

    // Registra automaticamente na timeline do cliente (Hades) a abertura do
    // atendimento — a timeline funciona de forma automatica (eventos do motor)
    // E manual (operador). Nao bloqueia a criacao se falhar.
    async function logAttendanceTimeline(windowOpen: boolean) {
      if (!detail) return;
      try {
        const token = await accessToken();
        await fetch("/api/hades/attendance/manual-events", {
          body: JSON.stringify({
            client: {
              c2xAcquisitionRequestId: detail.c2xAcquisitionRequestId,
              id: detail.id,
              name: detail.nome,
            },
            event: {
              description: `Assunto: ${selectedProfile?.name ?? "Cobrança"}${
                unitCodes.length ? ` · Unidade ${unitCodes.join(", ")}` : ""
              }${windowOpen ? "" : " · template enviado (aguardando aceite)"}`,
              occurredAt: new Date().toISOString(),
              status: "Registrado",
              title: "Atendimento de cobrança iniciado",
              type: "Atendimento",
            },
            kind: "timeline",
          }),
          cache: "no-store",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method: "POST",
        });
      } catch {
        // timeline e best-effort; nao impede o atendimento.
      }
    }

    try {
      if (!phone) {
        throw new Error("Cliente sem telefone para WhatsApp.");
      }
      // 1) tenta dentro da janela de 24h (sem template ativo).
      const windowAttempt = await attempt(false);
      if (windowAttempt.response.ok) {
        await logAttendanceTimeline(true);
        onCreated(windowAttempt.body?.ticket?.id ?? null);
        return;
      }
      const windowError =
        windowAttempt.body?.error ?? "Não foi possível abrir o atendimento.";
      const needsTemplate =
        windowAttempt.response.status === 409 &&
        windowError.toLowerCase().includes("janela de 24h");
      if (!needsTemplate) {
        throw new Error(windowError);
      }
      // 2) janela fechada -> contato ativo com o template aprovado.
      const templateAttempt = await attempt(true);
      if (!templateAttempt.response.ok) {
        throw new Error(
          templateAttempt.body?.error ?? "Não foi possível abrir o atendimento.",
        );
      }
      await logAttendanceTimeline(false);
      onCreated(templateAttempt.body?.ticket?.id ?? null);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Não foi possível abrir o atendimento.",
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
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-[#A07C3B] text-white">
              <Headset className="size-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-base font-semibold text-ink">
                Abrir atendimento de cobrança
              </h2>
              <p className="text-[11px] text-ink-muted">
                cria o protocolo AT (Iris) + CB (Hades)
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted hover:bg-subtle"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto p-5">
          {detail ? (
            <div className="flex items-center gap-3 rounded-xl bg-subtle/80 px-3 py-2.5">
              <div className="flex size-9 items-center justify-center rounded-full bg-[#A07C3B]/12 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b877]">
                {initials(detail.nome)}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">
                  {detail.nome}
                </p>
                <p className="truncate text-[11px] text-ink-muted">
                  {detail.carteira.empreendimento}
                  {detail.dados360?.telefone
                    ? ` · ${detail.dados360.telefone}`
                    : ""}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">
                  {detail.saldoDevedor}
                </p>
                <p className="text-[10px] text-ink-muted">
                  {detail.parcelas.vencidas} vencidas
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-line/80 bg-subtle/60 px-3 py-2.5 text-xs text-ink-muted">
              <Search className="size-4" aria-hidden="true" />
              Busca de cliente da fila de cobrança — entra na fila de atendimento.
            </div>
          )}

          {/* Codigo de unidade — qual unidade e esse atendimento. */}
          {detail ? (
            <div className="flex items-center gap-2 rounded-lg border border-line/70 px-3 py-2 text-xs">
              <Building2 className="size-4 shrink-0 text-[#A07C3B]" aria-hidden="true" />
              <span className="font-semibold text-ink-muted">
                Código de unidade
              </span>
              <span className="ml-auto truncate text-right font-semibold text-ink">
                {unitCodes.length
                  ? unitCodes.join(" · ")
                  : loadingDetail
                    ? "Carregando…"
                    : "—"}
              </span>
            </div>
          ) : null}

          {detail ? (
            <div>
              <div className="mb-1.5 flex items-end justify-between gap-2">
                <p className="text-[11px] font-semibold text-ink-muted">
                  Parcelas relacionadas{" "}
                  <span className="font-normal text-ink-muted">
                    (cobrança é por cliente — pode juntar de várias unidades)
                  </span>
                </p>
                {overdue.length > 0 ? (
                  <button
                    type="button"
                    onClick={toggleAll}
                    className="shrink-0 whitespace-nowrap rounded-md border border-[#A07C3B]/25 bg-[#A07C3B]/6 px-2 py-1 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b877] transition-colors hover:bg-[#A07C3B]/12"
                  >
                    {allSelected ? "Limpar" : "Selecionar todas"}
                  </button>
                ) : null}
              </div>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-line/70 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
                {loadingDetail && overdue.length === 0 ? (
                  <p className="flex items-center gap-2 px-3 py-4 text-xs text-ink-muted">
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Carregando parcelas do cliente…
                  </p>
                ) : overdue.length === 0 ? (
                  <p className="px-3 py-4 text-xs text-ink-muted">
                    Sem parcelas vencidas carregadas para este cliente.
                  </p>
                ) : (
                  overdue.map((item) => {
                    const checked = selected.has(item.id);
                    return (
                      <button
                        type="button"
                        key={item.id}
                        onClick={() => toggle(item.id)}
                        className="flex w-full items-center gap-2 border-b border-line px-3 py-2 text-left text-xs last:border-b-0 hover:bg-subtle"
                      >
                        <span
                          className={`flex size-4 items-center justify-center rounded ${
                            checked
                              ? "bg-[#A07C3B] text-white"
                              : "border border-line"
                          }`}
                        >
                          {checked ? (
                            <Check className="size-3" aria-hidden="true" />
                          ) : null}
                        </span>
                        <span className="flex-1 truncate text-ink">
                          {item.unitCode ? (
                            <span className="text-[#7A5E2C] dark:text-[#d9b877]">
                              {item.unitCode}
                              {" · "}
                            </span>
                          ) : null}
                          <span className="font-semibold text-ink">
                            {item.number}
                          </span>{" "}
                          · {item.reference}
                        </span>
                        <span className="font-semibold text-ink">
                          {item.value}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              <div className="mt-1 flex justify-between text-[11px]">
                <span className="text-ink-muted">
                  {selectedInstallments.length} de {overdue.length} selecionadas
                </span>
                <span className="font-semibold text-ink">
                  {formatMoney(selectedTotal)}
                </span>
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-muted">
                Assunto
              </span>
              <select
                value={profileId}
                onChange={(event) => setProfileId(event.target.value)}
                className="h-9 w-full rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none focus:border-[#A07C3B]/40"
              >
                {(config?.profiles ?? []).map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profileLabel(profile)}
                  </option>
                ))}
              </select>
            </label>
            <div>
              <span className="mb-1 block text-[11px] font-semibold text-ink-muted">
                Canal
              </span>
              <div className="flex h-9 items-center gap-1.5 rounded-lg border border-line/70 px-2.5 text-sm text-ink">
                <MessageCircle className="size-4 text-emerald-600" aria-hidden="true" />
                WhatsApp · Cobrança
              </div>
            </div>
          </div>

          {/* Template aprovado no Meta (via Iris) — canal cobranca. */}
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-muted">
              Template aprovado (Meta)
            </span>
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              disabled={!config?.templates.length}
              className="h-9 w-full rounded-lg border border-line/70 bg-surface px-2 text-sm text-ink outline-none focus:border-[#A07C3B]/40 disabled:bg-subtle disabled:text-ink-muted"
            >
              {config?.templates.length ? (
                config.templates.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))
              ) : (
                <option value="">Nenhum template aprovado</option>
              )}
            </select>
          </label>

          {template ? (
            <div>
              <p className="mb-1 text-[11px] font-semibold text-ink-muted">
                Pré-visualização da mensagem{" "}
                <span className="font-normal text-ink-muted">
                  (enviada só com a janela de 24h fechada)
                </span>
              </p>
              <div className="rounded-lg border border-line/70 bg-subtle/70 px-3 py-2 text-xs leading-relaxed text-ink whitespace-pre-line">
                {previewText ?? "Template de cobrança aprovado."}
              </div>
              {installmentLabels.length > 3 ? (
                <p className="mt-1 text-[10px] text-ink-muted">
                  {installmentLabels.length} parcelas — a mensagem resume as 3
                  primeiras + “+{installmentLabels.length - 3} parcela(s)” para
                  não estourar o template.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-lg border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/12 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3.5">
          <span className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <Info className="size-3.5" aria-hidden="true" />
            Cria AT + CB e abre a conversa
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-9 items-center rounded-lg border border-line/70 bg-surface px-4 text-sm font-medium text-ink hover:bg-subtle"
            >
              Cancelar
            </button>
            <Tooltip content="Abrir atendimento" placement="left">
              <button
                type="button"
                disabled={
                  submitting || loadingConfig || !detail || !cobrancaQueue
                }
                onClick={() => void submit()}
                aria-label="Abrir atendimento"
                className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting || loadingConfig ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Send className="size-4" aria-hidden="true" />
                )}
              </button>
            </Tooltip>
          </div>
        </footer>
      </div>
    </div>
  );
}

function profileLabel(profile: IrisProfile) {
  const slug = (profile.slug ?? "").toLowerCase();
  const name = (profile.name ?? "").toLowerCase();
  if (slug === "primeiro-contato" || name === "primeiro contato") {
    return "Contato";
  }
  return profile.name;
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

// Espelha formatTemplateInstallmentSummary do backend (app/api/iris/tickets):
// 3 parcelas visiveis + "+N parcela(s)" pra mensagem nao estourar o template.
function formatInstallmentSummary(labels: string[]) {
  if (!labels.length) return "Sem parcela informada";
  const preview = labels.slice(0, 3).join(" | ");
  const suffix = labels.length > 3 ? ` +${labels.length - 3} parcela(s)` : "";
  return `${preview}${suffix}`;
}

function renderTemplatePreview(body: string, params: string[]) {
  return body.replace(/{{\s*(\d+)\s*}}/g, (placeholder, rawIndex) => {
    const index = Number.parseInt(rawIndex, 10);
    if (Number.isNaN(index) || index <= 0) return placeholder;
    return params[index - 1] ?? placeholder;
  });
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}
