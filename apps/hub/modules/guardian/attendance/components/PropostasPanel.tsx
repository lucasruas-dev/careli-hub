"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CalendarPlus,
  Check,
  Edit3,
  Handshake,
  Loader2,
  MessageSquare,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import { ProposalChat } from "@/modules/guardian/attendance/components/ProposalChat";
import { hasProposalUpdate } from "@/lib/guardian/proposal-seen";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  GuardianApprovalStatus,
  GuardianCompromissoDetail,
  GuardianCompromissoKind,
} from "@/lib/guardian/compromissos";
import type { QueueClient } from "@/modules/guardian/attendance/types";

type OverdueInstallment = NonNullable<QueueClient["c2xInstallments"]>[number];
type AdjustmentMode = "percent" | "value";
type Adjustment = { mode: AdjustmentMode; value: string };
type PaymentMode = "a_vista" | "parcelado";
type EditParcela = { amount: string; dueDate: string; entry?: boolean; label: string };

export function PropostasPanel({
  client,
  initialEditProposalId,
}: {
  client: QueueClient;
  initialEditProposalId?: string | null;
}) {
  const clientC2xId = useMemo(() => parseClientC2xId(client.id), [client.id]);
  const overdue = useMemo(
    () =>
      (client.c2xInstallments ?? []).filter(
        (installment) => installment.status === "Vencida",
      ),
    [client.c2xInstallments],
  );

  const [items, setItems] = useState<GuardianCompromissoDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<GuardianCompromissoKind | null>(null);
  const [editing, setEditing] = useState<GuardianCompromissoDetail | null>(null);

  const load = useCallback(async () => {
    if (!clientC2xId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await accessToken();
      const response = await fetch(
        `/api/guardian/compromissos?clientId=${clientC2xId}`,
        {
          cache: "no-store",
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        },
      );
      const payload = (await response.json().catch(() => null)) as {
        data?: GuardianCompromissoDetail[];
      } | null;

      if (!response.ok) {
        throw new Error("Falha ao carregar as propostas.");
      }

      setItems(payload?.data ?? []);
    } catch {
      setError("Não foi possível carregar as propostas agora.");
    } finally {
      setLoading(false);
    }
  }, [clientC2xId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Deep-link "Editar" da Central (?editProposal=<id>): abre o modal de edicao
  // daquela proposta assim que a lista carrega (uma vez).
  const autoEditDoneRef = useRef(false);
  useEffect(() => {
    if (
      autoEditDoneRef.current ||
      !initialEditProposalId ||
      loading ||
      items.length === 0
    ) {
      return;
    }
    const target = items.find((item) => item.id === initialEditProposalId);
    if (target) {
      autoEditDoneRef.current = true;
      setEditing(target);
    }
  }, [initialEditProposalId, loading, items]);

  return (
    <DetailSection title="Propostas" icon={Handshake} accent>
      <div className="mb-4 flex flex-wrap items-center justify-end gap-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setForm("promessa")}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/5 px-3 text-sm font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10"
          >
            <CalendarPlus className="size-4" aria-hidden="true" />
            Nova promessa
          </button>
          <button
            type="button"
            onClick={() => setForm("acordo")}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#A07C3B] px-3 text-sm font-semibold text-white transition-colors hover:bg-[#8E6F35]"
          >
            <Handshake className="size-4" aria-hidden="true" />
            Novo acordo
          </button>
        </div>
      </div>

      {error ? (
        <p className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-6 text-sm text-slate-500">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carregando propostas...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-200/80 bg-slate-50/60 px-4 py-8 text-center text-sm text-slate-500">
          Nenhuma proposta registrada. Crie uma promessa ou um acordo.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <CompromissoCard
              key={item.id}
              item={item}
              onEdit={() => setEditing(item)}
              onDeleted={() => {
                void load();
                window.dispatchEvent(new CustomEvent("guardian:motor-changed"));
              }}
            />
          ))}
        </div>
      )}

      {form || editing ? (
        <ProposalModal
          kind={editing ? editing.kind : (form as GuardianCompromissoKind)}
          existing={editing ?? undefined}
          client={client}
          clientC2xId={clientC2xId}
          overdue={overdue}
          onClose={() => {
            setForm(null);
            setEditing(null);
          }}
          onCreated={() => {
            setForm(null);
            setEditing(null);
            void load();
            // Avisa a tela (Visao geral / Timeline) para re-buscar os eventos do
            // cliente: o motor ja gravou a nota na timeline (caredesk_ticket_events).
            window.dispatchEvent(new CustomEvent("guardian:motor-changed"));
          }}
        />
      ) : null}
    </DetailSection>
  );
}

function CompromissoCard({
  item,
  onEdit,
  onDeleted,
}: {
  item: GuardianCompromissoDetail;
  onEdit: () => void;
  onDeleted: () => void;
}) {
  const isAcordo = item.kind === "acordo";
  const approval = approvalFromStatus(item.approvalStatus, item.metadata);
  const editable = approval === "pendente" || approval === "elaboracao";
  const [chatOpen, setChatOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    const reason = window.prompt(
      `Motivo da exclusão da proposta ${item.protocol} (obrigatório):`,
    );
    if (!reason || !reason.trim()) {
      return;
    }
    setDeleting(true);
    try {
      const token = await accessToken();
      const response = await fetch(`/api/guardian/compromissos/${item.id}`, {
        body: JSON.stringify({ reason: reason.trim() }),
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        method: "DELETE",
      });
      if (response.ok) {
        onDeleted();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="rounded-xl border border-slate-200/70 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
            isAcordo
              ? "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15"
              : "bg-slate-50 text-slate-700 ring-slate-200"
          }`}
        >
          {isAcordo ? "Acordo" : "Promessa"}
        </span>
        <span className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] ring-1 ring-inset ring-[#A07C3B]/15">
          {item.protocol}
        </span>
        <ApprovalBadge approval={approval} />
        <span className="ml-auto text-sm font-semibold text-slate-950">
          {formatMoney(item.totalAmount)}
        </span>
        <Tooltip
          content={
            hasProposalUpdate(item) ? "Novidade na conversa" : "Conversa com o gestor"
          }
          placement="top"
        >
          <button
            type="button"
            onClick={() => setChatOpen((open) => !open)}
            aria-label="Conversa com o gestor"
            aria-pressed={chatOpen}
            className={`relative flex size-7 items-center justify-center rounded-md transition-colors ${
              chatOpen
                ? "bg-[#A07C3B]/10 text-[#7A5E2C]"
                : "text-slate-400 hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
            }`}
          >
            <MessageSquare className="size-3.5" aria-hidden="true" />
            {!chatOpen && hasProposalUpdate(item) ? (
              <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-[#A07C3B] ring-2 ring-white" />
            ) : null}
          </button>
        </Tooltip>
        {editable ? (
          <Tooltip content="Editar proposta" placement="top">
            <button
              type="button"
              onClick={onEdit}
              aria-label="Editar proposta"
              className="flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C]"
            >
              <Edit3 className="size-3.5" aria-hidden="true" />
            </button>
          </Tooltip>
        ) : null}
        <Tooltip content="Excluir proposta" placement="top">
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={deleting}
            aria-label="Excluir proposta"
            className="flex size-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        {item.installmentsCount} parcela(s) ·{" "}
        {isAcordo
          ? `1a em ${formatBrDate(item.firstDueDate)}`
          : `prometido para ${formatBrDate(item.promisedDate)}`}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.parcelas.map((parcela) => (
          <span
            key={parcela.id}
            className="rounded-md border border-slate-200/70 bg-slate-50/70 px-2 py-1 text-[11px] text-slate-600"
          >
            {parcela.sequence}/{item.installmentsCount} ·{" "}
            {formatBrDate(parcela.dueDate)} · {formatMoney(parcela.amount)}
            {parcela.status === "paga" ? (
              <Check className="ml-1 inline size-3 text-emerald-600" aria-hidden="true" />
            ) : null}
          </span>
        ))}
      </div>

      {chatOpen ? (
        <div className="mt-3">
          <ProposalChat
            compromissoId={item.id}
            heading="Conversa com o gestor"
            placeholder="Escreva para o gestor..."
          />
        </div>
      ) : null}
    </article>
  );
}

function ApprovalBadge({
  approval,
}: {
  approval: "pendente" | "aprovado" | "reprovado" | "elaboracao";
}) {
  const styles: Record<typeof approval, string> = {
    aprovado: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    elaboracao: "bg-slate-100 text-slate-600 ring-slate-200",
    pendente: "bg-blue-50 text-blue-700 ring-blue-100",
    reprovado: "bg-rose-50 text-rose-700 ring-rose-100",
  };
  const labels: Record<typeof approval, string> = {
    aprovado: "Aprovada",
    elaboracao: "Em elaboração",
    pendente: "Pendente",
    reprovado: "Reprovada",
  };

  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${styles[approval]}`}
    >
      {labels[approval]}
    </span>
  );
}

export function ProposalModal({
  kind,
  existing,
  client,
  clientC2xId,
  overdue,
  onClose,
  onCreated,
}: {
  kind: GuardianCompromissoKind;
  existing?: GuardianCompromissoDetail;
  client: QueueClient;
  clientC2xId: number | null;
  overdue: OverdueInstallment[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const meta = existing?.metadata ?? {};
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(metaStringArray(meta, "c2x_parcelas")),
  );
  const [promisedDate, setPromisedDate] = useState(
    existing?.promisedDate ?? todayInput(),
  );
  const [notes, setNotes] = useState(existing?.notes ?? "");
  const [discount, setDiscount] = useState<Adjustment>(() =>
    metaAdjustment(meta, "discount"),
  );
  const [interest, setInterest] = useState<Adjustment>(() =>
    metaAdjustment(meta, "interest"),
  );
  const [fine, setFine] = useState<Adjustment>(() => metaAdjustment(meta, "fine"));
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(() =>
    meta.payment_mode === "a_vista" ? "a_vista" : "parcelado",
  );
  const [entryAmount, setEntryAmount] = useState(() => metaEntryAmount(meta));
  const [entryDate, setEntryDate] = useState(
    () => metaEntryDate(meta) ?? todayInput(),
  );
  const [installmentsCount, setInstallmentsCount] = useState(() =>
    existing && existing.kind === "acordo"
      ? Math.max(
          1,
          existing.parcelas.filter((parcela) => !isEntryParcela(parcela))
            .length || 1,
        )
      : 3,
  );
  const [aVistaDate, setAVistaDate] = useState(() =>
    existing && meta.payment_mode === "a_vista"
      ? existing.parcelas[0]?.dueDate ?? todayInput()
      : todayInput(),
  );
  const [editParcelas, setEditParcelas] = useState<EditParcela[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const isAcordo = kind === "acordo";
  const unitsLabel =
    client.carteira.unidades
      .map((unit) => unit.matricula)
      .filter(Boolean)
      .join(", ") || "-";
  const selectedInstallments = overdue.filter((item) => selected.has(item.id));
  const original = round2(
    selectedInstallments.reduce((sum, item) => sum + item.valueNumber, 0),
  );
  const discountValue = applyAdjustment(original, discount);
  const interestValue = applyAdjustment(original, interest);
  const fineValue = applyAdjustment(original, fine);
  const agreement = round2(original - discountValue + interestValue + fineValue);
  const entry = Math.max(0, Math.min(parseMoneyInput(entryAmount), agreement));
  const editSum = round2(
    editParcelas.reduce(
      (total, parcela) => total + parseMoneyInput(parcela.amount),
      0,
    ),
  );
  const sumMatches = !isAcordo || Math.abs(editSum - agreement) < 0.005;

  // Gera as parcelas do acordo: entrada + N iguais, com a ULTIMA absorvendo a
  // diferenca de centavos do arredondamento (soma sempre bate com o acordo).
  // Editavel depois pelo operador.
  useEffect(() => {
    if (!isAcordo) {
      return;
    }
    if (paymentMode === "a_vista") {
      setEditParcelas([
        { amount: toAmountInput(agreement), dueDate: aVistaDate, label: "À vista" },
      ]);
      return;
    }
    const next: EditParcela[] = [];
    if (entry > 0) {
      next.push({
        amount: toAmountInput(entry),
        dueDate: entryDate,
        entry: true,
        label: "Entrada",
      });
    }
    const installmentsTotal = round2(agreement - entry);
    const base =
      installmentsCount > 0 ? round2(installmentsTotal / installmentsCount) : 0;
    for (let index = 0; index < installmentsCount; index += 1) {
      next.push({
        amount: toAmountInput(base),
        dueDate: addMonthsInput(entryDate, index + 1),
        label: `${index + 1}/${installmentsCount}`,
      });
    }
    const lastIndex = next.length - 1;
    const last = next[lastIndex];
    const diff = round2(installmentsTotal - base * installmentsCount);
    if (installmentsCount > 0 && diff !== 0 && last) {
      next[lastIndex] = {
        ...last,
        amount: toAmountInput(round2(base + diff)),
      };
    }
    setEditParcelas(next);
  }, [isAcordo, paymentMode, agreement, entry, entryDate, installmentsCount, aVistaDate]);

  function updateParcela(index: number, patch: Partial<EditParcela>) {
    setEditParcelas((current) =>
      current.map((parcela, idx) =>
        idx === index ? { ...parcela, ...patch } : parcela,
      ),
    );
  }

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      // Promessa e acordo permitem MÚLTIPLAS parcelas (o operador junta as que quer
      // cobrar na mesma mensagem/template). Antes a promessa travava em uma só.
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const allSelected =
    overdue.length > 0 && overdue.every((item) => selected.has(item.id));

  function toggleAll() {
    setSelected(() =>
      allSelected ? new Set<string>() : new Set(overdue.map((item) => item.id)),
    );
  }

  async function submit() {
    if (!clientC2xId) {
      setFormError("Cliente do C2X não identificado.");
      return;
    }
    if (selectedInstallments.length === 0) {
      setFormError("Selecione ao menos uma parcela.");
      return;
    }

    setSubmitting(true);
    setFormError(null);

    const c2xParcelas = selectedInstallments.map((item) => item.id);
    const sharedMetadata = {
      approval_status: "pendente",
      c2x_parcelas: c2xParcelas,
      client_name: client.nome,
      // Denormaliza o contrato/empreendimento: a Central do gestor mostra o bloco
      // Contrato e quebra os KPIs por empreendimento sem depender de join no C2X.
      empreendimento: client.carteira.empreendimento,
      contract: {
        atrasoDias: client.atrasoDias,
        contractDocumentId:
          client.carteira.unidades.find(
            (unit) => unit.signedContractDocumentId,
          )?.signedContractDocumentId ?? null,
        empreendimento: client.carteira.empreendimento,
        matriculas: client.carteira.unidades
          .map((unit) => unit.matricula)
          .filter(Boolean),
        parcelasVencidas: client.parcelas.vencidas,
        saldoDevedor: client.saldoDevedor,
        scoreRisco: client.scoreRisco,
      },
    };

    const body = isAcordo
      ? {
          channel: "manual",
          client: { id: client.id, name: client.nome },
          clientC2xId,
          firstDueDate:
            editParcelas[0]?.dueDate ??
            (paymentMode === "parcelado" ? entryDate : aVistaDate),
          kind,
          metadata: {
            ...sharedMetadata,
            agreement_amount: agreement,
            discount: { ...discount, computed: discountValue },
            entry: { amount: entry, dueDate: entryDate },
            fine: { ...fine, computed: fineValue },
            interest: { ...interest, computed: interestValue },
            original_amount: original,
            payment_mode: paymentMode,
          },
          notes,
          parcelas: editParcelas.map((parcela, index) => ({
            amount: parseMoneyInput(parcela.amount),
            dueDate: parcela.dueDate,
            metadata: parcela.entry ? { entry: true } : undefined,
            sequence: index + 1,
          })),
        }
      : {
          channel: "manual",
          client: { id: client.id, name: client.nome },
          clientC2xId,
          kind,
          metadata: sharedMetadata,
          notes,
          parcelas: [
            {
              amount: original,
              dueDate: promisedDate,
              paymentC2xId:
                selectedInstallments.length === 1
                  ? Number(selectedInstallments[0]?.id)
                  : null,
              sequence: 1,
            },
          ],
          promisedDate,
        };

    try {
      const token = await accessToken();
      const response = await fetch(
        existing
          ? `/api/guardian/compromissos/${existing.id}`
          : "/api/guardian/compromissos",
        {
          body: JSON.stringify(body),
          headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          method: existing ? "PUT" : "POST",
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        throw new Error(payload?.error ?? "Falha ao registrar a proposta.");
      }

      onCreated();
    } catch (submitError) {
      setFormError(
        submitError instanceof Error
          ? submitError.message
          : "Falha ao registrar a proposta.",
      );
    } finally {
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
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            {isAcordo ? (
              <Handshake className="size-4 text-[#A07C3B]" aria-hidden="true" />
            ) : (
              <CalendarPlus className="size-4 text-[#A07C3B]" aria-hidden="true" />
            )}
            <h2 className="text-base font-semibold text-slate-950">
              {existing
                ? isAcordo
                  ? "Editar acordo"
                  : "Editar promessa"
                : isAcordo
                  ? "Novo acordo"
                  : "Nova promessa"}
            </h2>
            <span className="text-xs text-slate-500">{client.nome}</span>
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

        <div className="border-b border-slate-100 px-5 py-1.5 text-[11px] text-slate-500">
          Unidade(s): <span className="font-medium text-slate-700">{unitsLabel}</span>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-slate-500">
                {isAcordo ? "1 · Parcelas em negociação" : "Parcelas em negociação"}
              </p>
              {overdue.length > 1 ? (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] font-semibold text-[#A07C3B] transition-colors hover:text-[#7A5E2C]"
                >
                  {allSelected ? "Limpar seleção" : "Incluir todas"}
                </button>
              ) : null}
            </div>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200/70 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {overdue.length === 0 ? (
                <p className="px-3 py-4 text-xs text-slate-400">
                  Sem parcelas vencidas para negociar.
                </p>
              ) : (
                overdue.map((item) => {
                  const checked = selected.has(item.id);
                  return (
                    <button
                      type="button"
                      key={item.id}
                      onClick={() => toggle(item.id)}
                      className="flex w-full items-center gap-2 border-b border-slate-100 px-3 py-2 text-left text-xs last:border-b-0 hover:bg-slate-50"
                    >
                      <span
                        className={`flex size-4 items-center justify-center rounded ${
                          checked
                            ? "bg-[#A07C3B] text-white"
                            : "border border-slate-300"
                        }`}
                      >
                        {checked ? <Check className="size-3" aria-hidden="true" /> : null}
                      </span>
                      <span className="flex-1 truncate text-slate-700">
                        <span className="font-semibold text-slate-900">
                          {item.number}
                        </span>{" "}
                        · {item.reference}
                      </span>
                      <span className="font-semibold text-slate-950">{item.value}</span>
                    </button>
                  );
                })
              )}
            </div>
            {isAcordo ? (
              <p className="mt-1 text-[11px] text-slate-400">
                Pode juntar parcelas de qualquer unidade (cobrança é por cliente).
              </p>
            ) : null}
          </section>

          {isAcordo ? (
            <>
              <section>
                <p className="mb-2 text-xs font-semibold text-slate-500">2 · Ajustes</p>
                <div className="grid grid-cols-3 gap-2">
                  <AdjustmentField label="Desconto" tone="danger" adjustment={discount} onChange={setDiscount} computed={-discountValue} />
                  <AdjustmentField label="Juros" tone="success" adjustment={interest} onChange={setInterest} computed={interestValue} />
                  <AdjustmentField label="Multa" tone="success" adjustment={fine} onChange={setFine} computed={fineValue} />
                </div>
                <div className="mt-3 flex gap-2">
                  <Summary label="Valor original" value={formatMoney(original)} />
                  <Summary label="Valor do acordo" value={formatMoney(agreement)} accent />
                </div>
              </section>

              <section>
                <p className="mb-2 text-xs font-semibold text-slate-500">
                  3 · Forma de pagamento
                </p>
                <div className="mb-3 inline-flex gap-1 rounded-lg bg-slate-100/80 p-1">
                  {(["a_vista", "parcelado"] as PaymentMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPaymentMode(mode)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                        paymentMode === mode
                          ? "bg-[#A07C3B] text-white"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {mode === "a_vista" ? "À vista" : "Parcelado"}
                    </button>
                  ))}
                </div>

                {paymentMode === "a_vista" ? (
                  <Field label="Data do pagamento">
                    <input
                      type="date"
                      value={aVistaDate}
                      onChange={(event) => setAVistaDate(event.target.value)}
                      className={inputClass}
                    />
                  </Field>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
                      <Field label="Entrada (R$)">
                        <input
                          inputMode="decimal"
                          value={entryAmount}
                          onChange={(event) => setEntryAmount(event.target.value)}
                          placeholder="0,00"
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Vencimento entrada">
                        <input
                          type="date"
                          value={entryDate}
                          onChange={(event) => setEntryDate(event.target.value)}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Nº de parcelas">
                        <input
                          type="number"
                          min={1}
                          max={36}
                          value={installmentsCount}
                          onChange={(event) =>
                            setInstallmentsCount(
                              Math.max(1, Math.min(36, Number(event.target.value) || 1)),
                            )
                          }
                          className={inputClass}
                        />
                      </Field>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-slate-200/70">
                      <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 text-[11px] text-slate-500">
                        <span className="w-12">Parcela</span>
                        <span className="flex-1">Valor (R$)</span>
                        <span className="w-32">Vencimento</span>
                      </div>
                      {editParcelas.map((parcela, index) => (
                        <div
                          key={`${parcela.label}-${index}`}
                          className="flex items-center gap-2 border-t border-slate-100 px-3 py-1.5"
                        >
                          <span className="w-12 text-[11px] font-medium text-slate-600">
                            {parcela.label}
                          </span>
                          <input
                            inputMode="decimal"
                            value={parcela.amount}
                            onChange={(event) =>
                              updateParcela(index, { amount: event.target.value })
                            }
                            className="h-7 min-w-0 flex-1 rounded-md border border-slate-200/70 bg-white px-2 text-xs font-semibold text-slate-950 outline-none focus:border-[#A07C3B]/40"
                          />
                          <input
                            type="date"
                            value={parcela.dueDate}
                            onChange={(event) =>
                              updateParcela(index, { dueDate: event.target.value })
                            }
                            className="h-7 w-32 rounded-md border border-slate-200/70 bg-white px-1.5 text-xs text-slate-700 outline-none focus:border-[#A07C3B]/40"
                          />
                        </div>
                      ))}
                      <div
                        className={`flex items-center justify-between border-t px-3 py-2 text-xs font-semibold ${
                          sumMatches
                            ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                            : "border-rose-200 bg-rose-50 text-rose-700"
                        }`}
                      >
                        <span>Total</span>
                        <span>{formatMoney(editSum)}</span>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </>
          ) : (
            <Field label="Nova data de pagamento (prometida)">
              <input
                type="date"
                value={promisedDate}
                onChange={(event) => setPromisedDate(event.target.value)}
                className={inputClass}
              />
            </Field>
          )}

          <Field label="Observação">
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Contexto da negociação..."
              className="min-h-16 w-full resize-none rounded-lg border border-slate-200/70 bg-white px-3 py-2 text-sm text-slate-700 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </Field>

          {formError ? (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
              {formError}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-slate-200/70 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <Tooltip content="Enviar para aprovação" placement="left">
            <button
              type="button"
              disabled={
                submitting || selectedInstallments.length === 0 || !sumMatches
              }
              onClick={() => void submit()}
              aria-label="Enviar para aprovação"
              className="flex size-9 items-center justify-center rounded-lg bg-[#A07C3B] text-white transition-colors hover:bg-[#8E6F35] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
            </button>
          </Tooltip>
        </footer>
      </div>
    </div>
  );
}

function AdjustmentField({
  label,
  tone,
  adjustment,
  onChange,
  computed,
}: {
  label: string;
  tone: "danger" | "success";
  adjustment: Adjustment;
  onChange: (next: Adjustment) => void;
  computed: number;
}) {
  return (
    <div className="rounded-lg bg-slate-50/70 px-2.5 py-2">
      <p className="text-[11px] text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-1">
        <input
          inputMode="decimal"
          value={adjustment.value}
          onChange={(event) => onChange({ ...adjustment, value: event.target.value })}
          placeholder="0"
          className="h-7 w-full min-w-0 rounded-md border border-slate-200/70 bg-white px-1.5 text-sm font-semibold text-slate-950 outline-none focus:border-[#A07C3B]/40"
        />
        <button
          type="button"
          onClick={() =>
            onChange({
              ...adjustment,
              mode: adjustment.mode === "percent" ? "value" : "percent",
            })
          }
          className="h-7 shrink-0 rounded-md border border-slate-200/70 bg-white px-1.5 text-[11px] font-semibold text-[#7A5E2C]"
        >
          {adjustment.mode === "percent" ? "%" : "R$"}
        </button>
      </div>
      <p
        className={`mt-1 text-[11px] ${
          tone === "danger" ? "text-rose-600" : "text-emerald-600"
        }`}
      >
        {computed < 0 ? "−" : "+"} {formatMoney(Math.abs(computed))}
      </p>
    </div>
  );
}

function Summary({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex-1 rounded-lg px-3 py-2 ${
        accent
          ? "border border-[#A07C3B]/30 bg-[#A07C3B]/8"
          : "bg-slate-50/70"
      }`}
    >
      <p className={`text-[11px] ${accent ? "text-[#7A5E2C]" : "text-slate-500"}`}>
        {label}
      </p>
      <p
        className={`mt-0.5 text-sm font-semibold ${
          accent ? "text-[#412402]" : "text-slate-950"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded-lg border border-slate-200/70 bg-white px-2.5 text-sm font-medium text-slate-950 outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";

// --- helpers ---

function applyAdjustment(base: number, adjustment: Adjustment) {
  const value = parseMoneyInput(adjustment.value);
  if (adjustment.mode === "percent") {
    return round2((base * value) / 100);
  }
  return round2(value);
}

// Le o estado de aprovacao da COLUNA real (Fase 2). Cai pro metadata (Fase 1)
// so se o registro for antigo e a coluna vier indefinida. Normaliza
// 'em_elaboracao' -> 'elaboracao' (rotulo da UI).
function approvalFromStatus(
  status: GuardianApprovalStatus | undefined,
  metadata: Record<string, unknown>,
): "pendente" | "aprovado" | "reprovado" | "elaboracao" {
  const value = status ?? (metadata.approval_status as string | undefined);
  if (value === "aprovado" || value === "reprovado") {
    return value;
  }
  if (value === "em_elaboracao" || value === "elaboracao") {
    return "elaboracao";
  }
  return "pendente";
}

function metaStringArray(meta: Record<string, unknown>, key: string): string[] {
  const value = meta[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function metaAdjustment(meta: Record<string, unknown>, key: string): Adjustment {
  const value = meta[key];
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const mode: AdjustmentMode = record.mode === "value" ? "value" : "percent";
    const raw = record.value;
    return {
      mode,
      value:
        typeof raw === "string" || typeof raw === "number" ? String(raw) : "",
    };
  }
  return { mode: "percent", value: "" };
}

function metaEntryAmount(meta: Record<string, unknown>): string {
  const entry = meta.entry;
  if (entry && typeof entry === "object") {
    const amount = Number((entry as Record<string, unknown>).amount);
    if (Number.isFinite(amount) && amount > 0) {
      return toAmountInput(amount);
    }
  }
  return "";
}

function metaEntryDate(meta: Record<string, unknown>): string | null {
  const entry = meta.entry;
  if (entry && typeof entry === "object") {
    const dueDate = (entry as Record<string, unknown>).dueDate;
    return typeof dueDate === "string" ? dueDate : null;
  }
  return null;
}

function isEntryParcela(parcela: {
  metadata: Record<string, unknown>;
}): boolean {
  return parcela.metadata.entry === true;
}

async function accessToken() {
  const supabase = getHubSupabaseClient();
  const session = await supabase?.auth.getSession();
  return session?.data.session?.access_token ?? "";
}

function parseClientC2xId(value: string): number | null {
  const match = value.match(/(\d+)/g);
  if (!match) {
    return null;
  }
  const parsed = Number(match[match.length - 1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseMoneyInput(value: string) {
  const normalized = value.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

// Valor para o input em formato BR (virgula decimal): 333.34 -> "333,34".
// O parseMoneyInput le de volta corretamente (ponto = milhar, virgula = decimal).
function toAmountInput(value: number) {
  return value.toFixed(2).replace(".", ",");
}

function formatMoney(value: number) {
  return value.toLocaleString("pt-BR", { currency: "BRL", style: "currency" });
}

function todayInput() {
  return new Date().toISOString().slice(0, 10);
}

function addMonthsInput(value: string, months: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString().slice(0, 10);
}

function formatBrDate(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value ?? "-";
  }
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}
