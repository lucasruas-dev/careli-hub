/* eslint-disable */
// @ts-nocheck
"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Edit3, GitBranch, Sparkles, X } from "lucide-react";
import { Tooltip } from "@repo/uix";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import { workflowStageDots, workflowStageStyles } from "@/modules/guardian/attendance/workflow";
import { useAuth } from "@/providers/auth-provider";
import type { QueueClient, WorkflowStage } from "@/modules/guardian/attendance/types";

type WorkflowChange = QueueClient["workflow"]["history"][number] & {
  origin?: "manual" | "auto";
};

type OperationalWorkflowCardProps = {
  client: QueueClient;
  // stacked: forca coluna unica (Etapa -> Proxima acao -> Historico empilhados)
  // para caber numa coluna estreita da faixa de topo da Visao geral.
  stacked?: boolean;
  // Seam de persistencia: gravar a mudanca de etapa (evento de log com origem
  // manual/auto). Quando ausente, a edicao e otimista (so na tela).
  onChangeStage?: (input: {
    from: WorkflowStage;
    to: WorkflowStage;
    reason: string;
    operator: string;
  }) => void | Promise<void>;
  // Etapa derivada do motor da cobranca (Auto - Hades). Quando difere da atual e
  // o operador nao mudou a mao, o card avanca sozinho e carimba no historico.
  autoStage?: WorkflowStage;
  autoNextAction?: string;
};

// Etapas que o operador pode escolher no popup. Mudar workflow NAO e um clique:
// abre o popup, exige motivo, e cai no log com carimbo Manual.
const WORKFLOW_STAGE_OPTIONS: WorkflowStage[] = [
  "A acionar",
  "Contato",
  "Negociação",
  "Promessa de pagamento",
  "Acordo",
  "Quebra",
  "Jurídico",
];

export function OperationalWorkflowCard({
  client,
  stacked = false,
  onChangeStage,
  autoStage,
  autoNextAction,
}: OperationalWorkflowCardProps) {
  const { hubUser } = useAuth();
  const operator = operatorName(hubUser?.name, client.responsavel);
  const [stage, setStage] = useState<WorkflowStage>(client.workflow.stage);
  const [updatedAt, setUpdatedAt] = useState(client.workflow.updatedAt);
  const [history, setHistory] = useState<WorkflowChange[]>(
    client.workflow.history,
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const nextAction = autoNextAction ?? client.workflow.nextAction;
  // O override manual (popup) vence o auto na sessao: depois que o operador
  // muda a mao, o motor para de sobrescrever.
  const manuallyChanged = useRef(false);

  // Auto - Hades: aplica a etapa derivada do motor quando ela difere da atual
  // (e o operador ainda nao mexeu na mao). Carimba no historico como Auto.
  useEffect(() => {
    if (!autoStage || manuallyChanged.current || autoStage === stage) {
      return;
    }
    setHistory((current) => [
      {
        changedAt: nowForDisplay(),
        from: stage,
        id: `${client.id}-wf-auto-${Date.now()}`,
        operator: "Hades",
        origin: "auto",
        reason: autoNextAction ?? "Atualizacao automatica pelo motor da cobranca.",
        to: autoStage,
      },
      ...current,
    ]);
    setStage(autoStage);
    setUpdatedAt(nowForDisplay());
  }, [autoStage]);

  function applyStageChange(nextStage: WorkflowStage, reason: string) {
    manuallyChanged.current = true;
    const change: WorkflowChange = {
      id: `${client.id}-wf-${Date.now()}`,
      from: stage,
      to: nextStage,
      changedAt: nowForDisplay(),
      operator,
      origin: "manual",
      reason,
    };

    setHistory((current) => [change, ...current]);
    setStage(nextStage);
    setUpdatedAt(nowForDisplay());
    setEditorOpen(false);

    void onChangeStage?.({
      from: change.from,
      operator,
      reason,
      to: nextStage,
    });
  }

  return (
    <DetailSection title="Workflow operacional" icon={GitBranch} accent>
      {!stacked ? (
        <div className="mb-3 flex items-center justify-end">
          <Tooltip content="Atualizar etapa" placement="top">
            <button
              type="button"
              onClick={() => setEditorOpen(true)}
              className="inline-flex h-8 items-center gap-2 rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 px-3 text-xs font-semibold text-[#7A5E2C] dark:text-[#d9b877] transition-colors hover:bg-[#A07C3B]/10"
            >
              <Edit3 className="size-3.5" aria-hidden="true" />
              Editar
            </button>
          </Tooltip>
        </div>
      ) : null}

      {stacked ? (
        <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-ink-muted">
                Etapa atual
              </span>
              <span className={`size-2.5 rounded-full ${workflowStageDots[stage]}`} />
              <span
                className={`inline-flex h-7 items-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${
                  workflowStageStyles[stage]
                }`}
              >
                {stage}
              </span>
              <Tooltip content="Atualizar etapa" placement="top">
                <button
                  type="button"
                  onClick={() => setEditorOpen(true)}
                  aria-label="Atualizar etapa do workflow"
                  className="flex size-6 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] dark:text-[#d9b877]"
                >
                  <Edit3 className="size-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            </div>

            <div>
              <p className="text-xs font-semibold tracking-normal text-ink-muted">
                Próxima ação
              </p>
              <p className="mt-1 text-sm leading-6 text-ink">
                {nextAction}
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold tracking-normal text-ink-muted">
              Histórico de alteração
            </p>
            <div className="space-y-2.5">
              {history.slice(0, 4).map((change) => (
                <div
                  key={change.id}
                  className="border-l-2 border-[#A07C3B]/30 pl-2.5"
                >
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-semibold text-ink">
                      {change.from} → {change.to}
                    </span>
                    {renderOriginTag(change)}
                  </div>
                  {change.reason ? (
                    <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-ink-muted">
                      {change.reason}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-[11px] font-medium text-ink-muted">
                    {change.changedAt} · {originOperatorLabel(change)}
                  </p>
                </div>
              ))}
              {history.length === 0 ? (
                <p className="text-xs text-ink-muted">
                  Sem alterações registradas.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
          <div className="rounded-xl border border-line/70 bg-subtle/60 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-semibold tracking-normal text-ink-muted">
                  Etapa atual
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`size-2.5 rounded-full ${workflowStageDots[stage]}`} />
                  <Tooltip content={`Etapa atual: ${stage}`} placement="top">
                    <span
                      className={`inline-flex h-7 items-center justify-center rounded-full px-2.5 text-xs font-semibold ring-1 ring-inset ${
                        workflowStageStyles[stage]
                      }`}
                    >
                      {stage}
                    </span>
                  </Tooltip>
                  <span className="text-xs text-ink-muted">{updatedAt}</span>
                </div>
              </div>

              <div className="rounded-lg border border-[#A07C3B]/15 bg-surface px-3 py-2 text-[#7A5E2C] dark:text-[#d9b877]">
                <p className="text-xs font-semibold">Op.</p>
                <p className="mt-1 text-sm font-semibold">{client.workflow.owner}</p>
              </div>
            </div>

            <div className="mt-4 flex items-start gap-3 rounded-xl border border-line/70 bg-surface p-3">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#A07C3B]/5 text-[#A07C3B] ring-1 ring-[#A07C3B]/15">
                <Sparkles className="size-4" aria-hidden="true" />
              </div>
              <div>
                <p className="text-xs font-semibold tracking-normal text-ink-muted">
                  Próxima ação
                </p>
                <p className="mt-1 text-sm leading-6 text-ink">{nextAction}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-line/70 bg-surface p-4">
            <p className="text-xs font-semibold tracking-normal text-ink-muted">
              Histórico de alteração
            </p>
            <div className="mt-3 space-y-3">
              {history.slice(0, 4).map((change) => (
                <div key={change.id} className="grid grid-cols-[12px_minmax(0,1fr)] gap-3">
                  <div className="pt-1.5">
                    <span className={`block size-2 rounded-full ${workflowStageDots[change.to]}`} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-xs">
                      <span className="font-semibold text-ink">{change.to}</span>
                      <span className="text-ink-muted">de {change.from}</span>
                      {renderOriginTag(change)}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-ink-muted">
                      {change.reason}
                    </p>
                    <p className="mt-1 text-[11px] font-medium text-ink-muted">
                      {change.changedAt} · {originOperatorLabel(change)}
                    </p>
                  </div>
                </div>
              ))}
              {history.length === 0 ? (
                <p className="text-xs text-ink-muted">Sem alterações registradas.</p>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {editorOpen ? (
        <WorkflowStageEditor
          client={client}
          currentStage={stage}
          onClose={() => setEditorOpen(false)}
          onConfirm={applyStageChange}
        />
      ) : null}
    </DetailSection>
  );
}

function WorkflowStageEditor({
  client,
  currentStage,
  onClose,
  onConfirm,
}: {
  client: QueueClient;
  currentStage: WorkflowStage;
  onClose: () => void;
  onConfirm: (nextStage: WorkflowStage, reason: string) => void;
}) {
  const [nextStage, setNextStage] = useState<WorkflowStage>(currentStage);
  const [reason, setReason] = useState("");
  const stageChanged = nextStage !== currentStage;
  const reasonFilled = reason.trim().length > 0;
  const canConfirm = stageChanged && reasonFilled;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label="Fechar edição de etapa"
        onClick={onClose}
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-line/70 bg-surface p-5 shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold tracking-normal text-[#A07C3B]">
              Workflow operacional
            </p>
            <h2 className="mt-1 text-base font-semibold text-ink">
              Atualizar etapa do workflow
            </h2>
            <p className="mt-1 text-xs text-ink-muted">{client.nome}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="flex size-8 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 flex items-end gap-3">
          <div className="flex-1">
            <p className="text-xs font-medium text-ink-muted">Etapa atual</p>
            <div className="mt-1 rounded-lg bg-subtle/80 px-3 py-2 text-sm font-semibold text-ink">
              {currentStage}
            </div>
          </div>
          <ArrowRight className="mb-2 size-4 text-ink-muted" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-xs font-medium text-ink-muted">Nova etapa</p>
            <select
              value={nextStage}
              onChange={(event) => setNextStage(event.target.value as WorkflowStage)}
              className="mt-1 h-9 w-full rounded-lg border border-line/70 bg-surface px-2 text-sm font-semibold text-ink outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            >
              {WORKFLOW_STAGE_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-4">
          <p className="text-xs font-medium text-ink-muted">
            Motivo da mudança <span className="text-rose-600">obrigatório</span>
          </p>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ex.: sem retorno após 5 tentativas; encaminhar para jurídico."
            className="mt-1 min-h-20 w-full resize-none rounded-lg border border-line/70 bg-surface px-3 py-2 text-sm leading-6 text-ink outline-none transition-colors focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
          />
        </div>

        <div className="mt-3 flex items-center gap-2 text-[11px] text-ink-muted">
          <GitBranch className="size-3.5 text-[#A07C3B]" aria-hidden="true" />
          Fica registrado no histórico e nos últimos eventos como alteração manual.
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-line/70 bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-subtle"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={() => onConfirm(nextStage, reason.trim())}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#A07C3B] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Salvar alteração
          </button>
        </div>
      </div>
    </div>
  );
}

function renderOriginTag(change: WorkflowChange) {
  const origin = changeOrigin(change);

  if (origin === "manual") {
    return (
      <span className="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 ring-1 ring-inset ring-blue-100">
        Manual
      </span>
    );
  }

  return (
    <span className="rounded-full bg-[#A07C3B]/8 px-1.5 py-0.5 text-[10px] font-semibold text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-inset ring-[#A07C3B]/15">
      Auto · Hades
    </span>
  );
}

function originOperatorLabel(change: WorkflowChange) {
  if (changeOrigin(change) === "auto") {
    return "Hades";
  }

  return change.operator && change.operator !== "-" ? change.operator : "Operador";
}

// Origem explicita quando existe; senao infere: entrada sem operador real veio
// do sistema (importacao/regra) = auto; com operador = manual.
function changeOrigin(change: WorkflowChange): "manual" | "auto" {
  if (change.origin) {
    return change.origin;
  }

  return change.operator && change.operator !== "-" ? "manual" : "auto";
}

function operatorName(loginName: string | null | undefined, fallback: string) {
  const candidate = [loginName, fallback].find(
    (value) => value && value.trim() && value.trim() !== "-",
  );

  return candidate?.trim() ?? "Operador";
}

function nowForDisplay() {
  return new Date().toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}
