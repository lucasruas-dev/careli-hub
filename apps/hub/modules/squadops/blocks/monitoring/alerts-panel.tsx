"use client";

import type {
  OperationsAlert,
  OperationsAlertFeedbackStatus,
  OperationsAlertProtocolSummary,
  OpsWatcherDecision,
} from "@/lib/operations/monitoring";
import {
  EmptyState,
  PanelTitle,
} from "@/modules/squadops/blocks/shared/operations-ui";
import { Badge, Surface, Tooltip, type BadgeVariant } from "@repo/uix";
import {
  Activity,
  BellRing,
  ChevronRight,
  ClipboardCheck,
  EyeOff,
  Loader2,
  MessageSquareText,
  WandSparkles,
  X,
} from "lucide-react";

type RiskVariantResolver = (
  risk: OperationsAlert["level"] | OpsWatcherDecision["risk"],
) => BadgeVariant;

type AlertFeedbackStatusLabelResolver = (
  status: OperationsAlertFeedbackStatus,
) => string;

type AlertFeedbackStatusVariantResolver = (
  status: OperationsAlertFeedbackStatus,
) => BadgeVariant;

type OperationsAlertCenterProps = {
  alertCount: number;
  getRiskVariant: RiskVariantResolver;
  highestAlert: OperationsAlert | null;
  latestNotification: OpsWatcherDecision | null;
  onOpen: () => void;
};

type OperationsAlertsDialogProps = {
  acknowledgingProtocol: string | null;
  alertProtocols: OperationsAlertProtocolSummary[];
  alerts: OperationsAlert[];
  copiedCommandId: string | null;
  formatDateTime: (value: string) => string;
  getFeedbackStatusLabel: AlertFeedbackStatusLabelResolver;
  getFeedbackStatusVariant: AlertFeedbackStatusVariantResolver;
  getRiskVariant: RiskVariantResolver;
  ignoringProtocol: string | null;
  notifications: OpsWatcherDecision[];
  onAcknowledgeProtocol: (protocolCode?: string) => void;
  onClose: () => void;
  onCopyCommand: (command: string, id: string) => void;
  onIgnoreProtocol: (protocolCode?: string) => void;
  onOpenAlert: (alert: OperationsAlert) => void;
  onOpenAlertProtocol: (protocol: OperationsAlertProtocolSummary) => void;
  onOpenAlertProtocolByCode: (protocolCode?: string) => void;
  watcher: OpsWatcherDecision | null;
};

type OperationsAlertsPanelProps = {
  acknowledgingProtocol: string | null;
  alerts: OperationsAlert[];
  copiedCommandId: string | null;
  formatDateTime: (value: string) => string;
  getFeedbackStatusLabel: AlertFeedbackStatusLabelResolver;
  getRiskVariant: RiskVariantResolver;
  ignoringProtocol: string | null;
  onAcknowledgeProtocol: (protocolCode?: string) => void;
  onCopyCommand: (command: string, id: string) => void;
  onIgnoreProtocol: (protocolCode?: string) => void;
  onOpenProtocol: (alert: OperationsAlert) => void;
};

type OpsWatcherPanelProps = {
  acknowledgingProtocol: string | null;
  copiedCommandId: string | null;
  formatDateTime: (value: string) => string;
  getRiskVariant: RiskVariantResolver;
  ignoringProtocol: string | null;
  notifications: OpsWatcherDecision[];
  onAcknowledgeProtocol: (protocolCode?: string) => void;
  onCopyCommand: (command: string, id: string) => void;
  onIgnoreProtocol: (protocolCode?: string) => void;
  onOpenProtocol: (protocolCode?: string) => void;
  watcher: OpsWatcherDecision | null;
};

type AlertProtocolsHistoryPanelProps = {
  copiedCommandId: string | null;
  formatDateTime: (value: string) => string;
  getFeedbackStatusLabel: AlertFeedbackStatusLabelResolver;
  getFeedbackStatusVariant: AlertFeedbackStatusVariantResolver;
  getRiskVariant: RiskVariantResolver;
  onCopyCommand: (command: string, id: string) => void;
  onOpenProtocol: (protocol: OperationsAlertProtocolSummary) => void;
  protocols: OperationsAlertProtocolSummary[];
};

export function OperationsAlertCenter({
  alertCount,
  getRiskVariant,
  highestAlert,
  latestNotification,
  onOpen,
}: OperationsAlertCenterProps) {
  const hasAlert = alertCount > 0 || Boolean(latestNotification?.notifyLucas);
  const title =
    highestAlert?.title ??
    latestNotification?.message ??
    "Sem alerta operacional ativo";
  const risk = highestAlert?.level ?? latestNotification?.risk ?? "baixo";

  return (
    <button
      className={`mt-4 flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-left transition-colors ${
        hasAlert
          ? "border-amber-200 bg-amber-50 hover:bg-amber-100/70"
          : "border-slate-200/70 bg-slate-50/70 hover:bg-slate-100/70"
      }`}
      onClick={onOpen}
      type="button"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-lg ring-1 ${
            hasAlert
              ? "bg-white text-amber-700 ring-amber-200"
              : "bg-white text-slate-500 ring-slate-200"
          }`}
        >
          <BellRing className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase text-slate-500">
            Alertas operacionais
          </p>
          <p className="m-0 mt-1 line-clamp-2 text-sm font-semibold text-slate-950">
            {title}
          </p>
          <p className="m-0 mt-1 text-xs text-slate-500">
            {hasAlert
              ? "Abrir popup para confirmar leitura, ignorar, registrar devolutiva ou gerar prompt."
              : "Abrir popup para consultar historico e protocolos de alertas."}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Badge variant={getRiskVariant(risk)}>{risk}</Badge>
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
          {alertCount} ativo(s)
        </span>
        <ChevronRight className="size-4 text-[#A07C3B]" />
      </div>
    </button>
  );
}

export function OperationsAlertsDialog({
  acknowledgingProtocol,
  alertProtocols,
  alerts,
  copiedCommandId,
  formatDateTime,
  getFeedbackStatusLabel,
  getFeedbackStatusVariant,
  getRiskVariant,
  ignoringProtocol,
  notifications,
  onAcknowledgeProtocol,
  onClose,
  onCopyCommand,
  onIgnoreProtocol,
  onOpenAlert,
  onOpenAlertProtocol,
  onOpenAlertProtocolByCode,
  watcher,
}: OperationsAlertsDialogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-950/35 px-4 py-6 backdrop-blur-[2px]">
      <div className="flex max-h-[calc(100vh-3rem)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-2xl">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <PanelTitle
            eyebrow={`${alerts.length} ativo(s) / ${alertProtocols.length} protocolo(s)`}
            icon={<BellRing size={18} />}
            title="Central de alertas"
          />
          <button
            aria-label="Fechar alertas"
            className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-950"
            onClick={onClose}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.38fr)]">
            <OperationsAlertsPanel
              acknowledgingProtocol={acknowledgingProtocol}
              alerts={alerts}
              copiedCommandId={copiedCommandId}
              formatDateTime={formatDateTime}
              getFeedbackStatusLabel={getFeedbackStatusLabel}
              getRiskVariant={getRiskVariant}
              ignoringProtocol={ignoringProtocol}
              onAcknowledgeProtocol={onAcknowledgeProtocol}
              onCopyCommand={onCopyCommand}
              onIgnoreProtocol={onIgnoreProtocol}
              onOpenProtocol={onOpenAlert}
            />
            <OpsWatcherPanel
              acknowledgingProtocol={acknowledgingProtocol}
              copiedCommandId={copiedCommandId}
              formatDateTime={formatDateTime}
              getRiskVariant={getRiskVariant}
              ignoringProtocol={ignoringProtocol}
              notifications={notifications}
              onAcknowledgeProtocol={onAcknowledgeProtocol}
              onCopyCommand={onCopyCommand}
              onIgnoreProtocol={onIgnoreProtocol}
              onOpenProtocol={onOpenAlertProtocolByCode}
              watcher={watcher}
            />
          </div>
          <div className="mt-5">
            <AlertProtocolsHistoryPanel
              copiedCommandId={copiedCommandId}
              formatDateTime={formatDateTime}
              getFeedbackStatusLabel={getFeedbackStatusLabel}
              getFeedbackStatusVariant={getFeedbackStatusVariant}
              getRiskVariant={getRiskVariant}
              onCopyCommand={onCopyCommand}
              onOpenProtocol={onOpenAlertProtocol}
              protocols={alertProtocols}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function OperationsAlertsPanel({
  acknowledgingProtocol,
  alerts,
  copiedCommandId,
  formatDateTime,
  getFeedbackStatusLabel,
  getRiskVariant,
  ignoringProtocol,
  onAcknowledgeProtocol,
  onCopyCommand,
  onIgnoreProtocol,
  onOpenProtocol,
}: OperationsAlertsPanelProps) {
  return (
    <Surface
      bordered
      className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <PanelTitle
        eyebrow={`${alerts.length} alertas`}
        icon={<BellRing size={18} />}
        title="Alertas operacionais"
      />
      <div className="mt-4 grid max-h-[54vh] gap-3 overflow-y-auto pr-1">
        {alerts.length > 0 ? (
          alerts.map((alert) => (
            <article
              className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              key={alert.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold text-slate-950">
                    {alert.title}
                  </p>
                  <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                    {alert.module} / {alert.origin}
                  </p>
                  <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                    Registro: {formatDateTime(alert.generatedAt)}
                    {alert.lastSeenAt && alert.lastSeenAt !== alert.generatedAt
                      ? ` / ultima: ${formatDateTime(alert.lastSeenAt)}`
                      : ""}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded-full bg-[#A07C3B]/10 px-2 py-1 text-[0.68rem] font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                      {alert.protocol}
                    </span>
                    <span className="rounded-full bg-slate-50 px-2 py-1 text-[0.68rem] font-semibold text-slate-500 ring-1 ring-slate-200/70">
                      {getFeedbackStatusLabel(
                        alert.technicalFeedbackStatus ?? "pendente",
                      )}
                    </span>
                    {alert.occurrenceCount ? (
                      <span className="rounded-full bg-slate-50 px-2 py-1 text-[0.68rem] font-semibold text-slate-500 ring-1 ring-slate-200/70">
                        {alert.occurrenceCount}x
                      </span>
                    ) : null}
                    <span className="rounded-full bg-slate-50 px-2 py-1 text-[0.68rem] font-semibold text-slate-500 ring-1 ring-slate-200/70">
                      Analise: {alert.analysis.label}
                    </span>
                  </div>
                </div>
                <Badge variant={getRiskVariant(alert.level)}>{alert.level}</Badge>
              </div>
              <p className="m-0 mt-3 text-xs leading-5 text-slate-600">
                {alert.impact}
              </p>
              <p className="m-0 mt-2 rounded-lg bg-slate-50/80 p-3 text-xs leading-5 text-slate-600 ring-1 ring-slate-200/70">
                {alert.recommendation}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  Agente: {alert.recommendedAgent}
                </span>
                <div className="flex items-center gap-2">
                  <Tooltip content="Confirmar leitura" placement="top">
                    <button
                      aria-label={`Confirmar leitura do protocolo ${alert.protocol}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={acknowledgingProtocol === alert.protocol}
                      onClick={() => onAcknowledgeProtocol(alert.protocol)}
                      type="button"
                    >
                      {acknowledgingProtocol === alert.protocol ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <ClipboardCheck className="size-4" />
                      )}
                    </button>
                  </Tooltip>
                  <Tooltip
                    content="Registrar devolutiva tecnica"
                    placement="top"
                  >
                    <button
                      aria-label={`Registrar devolutiva tecnica do protocolo ${alert.protocol}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                      onClick={() => onOpenProtocol(alert)}
                      type="button"
                    >
                      <MessageSquareText className="size-4" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Ignorar alerta" placement="top">
                    <button
                      aria-label={`Ignorar protocolo ${alert.protocol}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                      disabled={ignoringProtocol === alert.protocol}
                      onClick={() => onIgnoreProtocol(alert.protocol)}
                      type="button"
                    >
                      {ignoringProtocol === alert.protocol ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <EyeOff className="size-4" />
                      )}
                    </button>
                  </Tooltip>
                  <Tooltip content="Criar prompt para agente" placement="top">
                    <button
                      aria-label={`Criar prompt para ${alert.recommendedAgent}`}
                      className={`inline-flex size-8 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-white text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/5 ${
                        copiedCommandId === alert.id ? "bg-[#A07C3B]/10" : ""
                      }`}
                      onClick={() => onCopyCommand(alert.command, alert.id)}
                      type="button"
                    >
                      <WandSparkles className="size-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </article>
          ))
        ) : (
          <EmptyState message="Sem alerta operacional ativo." />
        )}
      </div>
    </Surface>
  );
}

function OpsWatcherPanel({
  acknowledgingProtocol,
  copiedCommandId,
  formatDateTime,
  getRiskVariant,
  ignoringProtocol,
  notifications,
  onAcknowledgeProtocol,
  onCopyCommand,
  onIgnoreProtocol,
  onOpenProtocol,
  watcher,
}: OpsWatcherPanelProps) {
  return (
    <Surface
      bordered
      className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <PanelTitle
        eyebrow={watcher ? watcher.status : "aguardando"}
        icon={<Activity size={18} />}
        title="Ops Watcher"
      />
      {watcher ? (
        <div className="mt-4 rounded-xl border border-slate-200/70 bg-slate-50/70 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="m-0 text-sm font-semibold leading-6 text-slate-950">
              {watcher.message}
            </p>
            <Badge variant={getRiskVariant(watcher.risk)}>{watcher.risk}</Badge>
          </div>
          <p className="m-0 mt-3 text-xs leading-5 text-slate-600">
            Motivo: {watcher.reason}
          </p>
          <p className="m-0 mt-2 text-xs font-semibold text-slate-500">
            Agente recomendado: {watcher.agent}
          </p>
          {watcher.protocol ? (
            <span className="mt-3 inline-flex rounded-full bg-[#A07C3B]/10 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
              {watcher.protocol}
            </span>
          ) : null}
          <div className="mt-4 flex items-center gap-2">
            {watcher.protocol ? (
              <>
                <Tooltip content="Confirmar leitura" placement="top">
                  <button
                    aria-label={`Confirmar leitura do protocolo ${watcher.protocol}`}
                    className="inline-flex size-9 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={acknowledgingProtocol === watcher.protocol}
                    onClick={() => onAcknowledgeProtocol(watcher.protocol)}
                    type="button"
                  >
                    {acknowledgingProtocol === watcher.protocol ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <ClipboardCheck className="size-4" />
                    )}
                  </button>
                </Tooltip>
                <Tooltip content="Registrar devolutiva tecnica" placement="top">
                  <button
                    aria-label={`Registrar devolutiva tecnica do protocolo ${watcher.protocol}`}
                    className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                    onClick={() => onOpenProtocol(watcher.protocol)}
                    type="button"
                  >
                    <MessageSquareText className="size-4" />
                  </button>
                </Tooltip>
                <Tooltip content="Ignorar alerta" placement="top">
                  <button
                    aria-label={`Ignorar protocolo ${watcher.protocol}`}
                    className="inline-flex size-9 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                    disabled={ignoringProtocol === watcher.protocol}
                    onClick={() => onIgnoreProtocol(watcher.protocol)}
                    type="button"
                  >
                    {ignoringProtocol === watcher.protocol ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <EyeOff className="size-4" />
                    )}
                  </button>
                </Tooltip>
              </>
            ) : null}
            <Tooltip content="Criar prompt para agente" placement="top">
              <button
                aria-label={`Criar prompt para ${watcher.agent}`}
                className={`inline-flex size-9 items-center justify-center rounded-lg bg-[#101820] text-white transition-colors hover:bg-[#1b2533] ${
                  copiedCommandId === watcher.dedupeKey
                    ? "ring-2 ring-[#A07C3B]/30"
                    : ""
                }`}
                onClick={() => onCopyCommand(watcher.command, watcher.dedupeKey)}
                type="button"
              >
                <WandSparkles className="size-4" />
              </button>
            </Tooltip>
          </div>
        </div>
      ) : (
        <EmptyState message="Clique em Analisar agora para rodar o watcher." />
      )}

      <div className="mt-5">
        <p className="m-0 text-xs font-semibold uppercase text-slate-400">
          Historico de notificacoes
        </p>
        <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
          {notifications.length > 0 ? (
            notifications.map((notification) => (
              <div
                className="rounded-xl border border-slate-200/70 bg-white p-3 text-xs leading-5 text-slate-600"
                key={`${notification.dedupeKey}-${notification.generatedAt}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-slate-950">
                    {formatDateTime(notification.generatedAt)}
                  </span>
                  <div className="flex items-center gap-2">
                    {notification.protocol ? (
                      <>
                        <Tooltip content="Confirmar leitura" placement="top">
                          <button
                            aria-label={`Confirmar leitura do protocolo ${notification.protocol}`}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-emerald-200 bg-white text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              acknowledgingProtocol === notification.protocol
                            }
                            onClick={() =>
                              onAcknowledgeProtocol(notification.protocol)
                            }
                            type="button"
                          >
                            {acknowledgingProtocol === notification.protocol ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <ClipboardCheck className="size-4" />
                            )}
                          </button>
                        </Tooltip>
                        <Tooltip
                          content="Registrar devolutiva tecnica"
                          placement="top"
                        >
                          <button
                            aria-label={`Registrar devolutiva tecnica do protocolo ${notification.protocol}`}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                            onClick={() =>
                              onOpenProtocol(notification.protocol)
                            }
                            type="button"
                          >
                            <MessageSquareText className="size-4" />
                          </button>
                        </Tooltip>
                        <Tooltip content="Ignorar alerta" placement="top">
                          <button
                            aria-label={`Ignorar protocolo ${notification.protocol}`}
                            className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
                            disabled={
                              ignoringProtocol === notification.protocol
                            }
                            onClick={() =>
                              onIgnoreProtocol(notification.protocol)
                            }
                            type="button"
                          >
                            {ignoringProtocol === notification.protocol ? (
                              <Loader2 className="size-4 animate-spin" />
                            ) : (
                              <EyeOff className="size-4" />
                            )}
                          </button>
                        </Tooltip>
                      </>
                    ) : null}
                    <Badge variant={getRiskVariant(notification.risk)}>
                      {notification.risk}
                    </Badge>
                    <Tooltip content="Criar prompt para agente" placement="top">
                      <button
                        aria-label={`Criar prompt para ${notification.agent}`}
                        className={`inline-flex size-8 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-white text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/5 ${
                          copiedCommandId === notification.dedupeKey
                            ? "bg-[#A07C3B]/10"
                            : ""
                        }`}
                        onClick={() =>
                          onCopyCommand(
                            notification.command,
                            notification.dedupeKey,
                          )
                        }
                        type="button"
                      >
                        <WandSparkles className="size-4" />
                      </button>
                    </Tooltip>
                  </div>
                </div>
                {notification.protocol ? (
                  <p className="m-0 mt-1 text-[0.68rem] font-semibold text-[#7A5E2C]">
                    {notification.protocol}
                  </p>
                ) : null}
                <p className="m-0 mt-2 line-clamp-3">{notification.message}</p>
              </div>
            ))
          ) : (
            <p className="m-0 rounded-xl bg-slate-50/70 p-3 text-xs text-slate-500 ring-1 ring-slate-200/70">
              Sem notificacao enviada nesta sessao.
            </p>
          )}
        </div>
      </div>
    </Surface>
  );
}

function AlertProtocolsHistoryPanel({
  copiedCommandId,
  formatDateTime,
  getFeedbackStatusLabel,
  getFeedbackStatusVariant,
  getRiskVariant,
  onCopyCommand,
  onOpenProtocol,
  protocols,
}: AlertProtocolsHistoryPanelProps) {
  return (
    <Surface
      bordered
      className="min-w-0 overflow-hidden border-slate-200/70 bg-white p-0 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
    >
      <div className="border-b border-slate-100 p-5">
        <PanelTitle
          eyebrow={`${protocols.length} protocolos`}
          icon={<MessageSquareText size={18} />}
          title="Protocolos de alertas e devolutivas"
        />
      </div>
      <div className="grid max-h-[46vh] gap-3 overflow-y-auto p-4 pr-3">
        {protocols.length > 0 ? (
          protocols.map((protocol) => (
            <article
              className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]"
              key={protocol.id}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-[#A07C3B]/10 px-2.5 py-1 text-xs font-semibold text-[#7A5E2C] ring-1 ring-[#A07C3B]/15">
                      {protocol.protocol}
                    </span>
                    <Badge
                      variant={getFeedbackStatusVariant(
                        protocol.technicalFeedbackStatus,
                      )}
                    >
                      {getFeedbackStatusLabel(protocol.technicalFeedbackStatus)}
                    </Badge>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200/70">
                      {protocol.occurrenceCount} ocorrencias
                    </span>
                    <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200/70">
                      Analise: {protocol.analysis.label}
                    </span>
                  </div>
                  <p className="m-0 mt-3 text-sm font-semibold text-slate-950">
                    {protocol.title}
                  </p>
                  <p className="m-0 mt-1 text-xs font-semibold text-slate-500">
                    {protocol.module} / {protocol.origin} / ultimo:{" "}
                    {formatDateTime(protocol.lastSeenAt)}
                  </p>
                </div>
                <Badge variant={getRiskVariant(protocol.level)}>
                  {protocol.level}
                </Badge>
              </div>
              <p className="m-0 mt-3 line-clamp-2 text-xs leading-5 text-slate-600">
                {protocol.technicalFeedback
                  ? protocol.technicalFeedback
                  : "Aguardando devolutiva tecnica do dev responsavel."}
              </p>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-slate-500">
                  Agente: {protocol.recommendedAgent}
                </span>
                <div className="flex items-center gap-2">
                  <Tooltip
                    content="Registrar devolutiva tecnica"
                    placement="top"
                  >
                    <button
                      aria-label={`Registrar devolutiva tecnica do protocolo ${protocol.protocol}`}
                      className="inline-flex size-8 items-center justify-center rounded-lg border border-slate-200/70 bg-white text-slate-600 transition-colors hover:border-[#A07C3B]/25 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
                      onClick={() => onOpenProtocol(protocol)}
                      type="button"
                    >
                      <MessageSquareText className="size-4" />
                    </button>
                  </Tooltip>
                  <Tooltip content="Criar prompt para agente" placement="top">
                    <button
                      aria-label={`Criar prompt para ${protocol.recommendedAgent}`}
                      className={`inline-flex size-8 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-white text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/5 ${
                        copiedCommandId === protocol.protocol
                          ? "bg-[#A07C3B]/10"
                          : ""
                      }`}
                      onClick={() =>
                        onCopyCommand(protocol.command, protocol.protocol)
                      }
                      type="button"
                    >
                      <WandSparkles className="size-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            </article>
          ))
        ) : (
          <EmptyState message="Nenhum protocolo de alerta persistido ainda." />
        )}
      </div>
    </Surface>
  );
}
