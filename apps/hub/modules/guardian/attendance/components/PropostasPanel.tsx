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
  FileText,
  Handshake,
  Loader2,
  MessageSquare,
  RefreshCw,
  Scale,
  Send,
  Trash2,
  X,
  XCircle,
} from "lucide-react";
import { Tooltip } from "@repo/uix";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import { DossieJuridicoModal } from "@/modules/guardian/attendance/components/DossieJuridicoModal";
import { ProposalChat } from "@/modules/guardian/attendance/components/ProposalChat";
import {
  contratoDaSelecao,
  unidadesEmAtraso,
  unidadeDoAcordo,
} from "@/lib/guardian/acordo-por-unidade";
import { hasProposalUpdate } from "@/lib/guardian/proposal-seen";
import {
  motivoParaNaoEmitirOTermo,
  situacaoDaAprovacao,
} from "@/lib/hades/dossie/termo-de-acordo-gate";
import { motivoParaNaoEnviarParaAssinatura } from "@/lib/hades/acordo/envio-gate";
import { TERMO_DE_ACORDO_LIBERADO } from "@/lib/apolo/termos-liberados";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import type {
  GuardianCompromissoDetail,
  GuardianCompromissoKind,
} from "@/lib/guardian/compromissos";
import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
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
  const [dossie, setDossie] = useState(false);

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
          {/* Encaminhar ao jurídico é o fim da linha da negociação: fica junto das outras ações,
              mas antes delas, porque a leitura natural é promessa → acordo → jurídico. */}
          <button
            type="button"
            onClick={() => setDossie(true)}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line/70 bg-surface px-3 text-sm font-semibold text-ink transition-colors hover:bg-subtle"
          >
            <Scale className="size-4" aria-hidden="true" />
            Dossie juridico
          </button>
          <button
            type="button"
            onClick={() => setForm("promessa")}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/5 px-3 text-sm font-semibold text-[#7A5E2C] dark:text-[#d9b877] transition-colors hover:bg-[#A07C3B]/10"
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
        <p className="mb-3 rounded-lg border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/12 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
          {error}
        </p>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 px-1 py-6 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carregando propostas...
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line/80 bg-subtle/60 px-4 py-8 text-center text-sm text-ink-muted">
          Nenhuma proposta registrada. Crie uma promessa ou um acordo.
        </div>
      ) : (
        <div className="grid gap-3">
          {items.map((item) => (
            <CompromissoCard
              key={item.id}
              item={item}
              parcelasDoCliente={client.c2xInstallments ?? []}
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

      {dossie ? (
        <DossieJuridicoModal client={client} onClose={() => setDossie(false)} />
      ) : null}
    </DetailSection>
  );
}

function CompromissoCard({
  item,
  onEdit,
  onDeleted,
  parcelasDoCliente,
}: {
  item: GuardianCompromissoDetail;
  onEdit: () => void;
  onDeleted: () => void;
  /** Todas as parcelas do C2X deste cliente: é delas que sai o código da unidade. */
  parcelasDoCliente: readonly OverdueInstallment[];
}) {
  const isAcordo = item.kind === "acordo";
  // ⚠️ DE QUAL UNIDADE É ESTE ACORDO — TI-000149 (Cinthia, 17/09/2026). O card mostrava valor,
  // parcelas e datas, e nenhuma palavra sobre o lote: em cliente com mais de uma unidade, dois
  // acordos ficavam indistinguíveis na tela.
  const unidade = unidadeDoAcordo(item.acquisitionRequestC2xId, parcelasDoCliente);
  // ⚠️ O SELO E O BOTÃO DO TERMO LEEM A MESMA RÉGUA (`situacaoDaAprovacao`). Com duas, o card
  // poderia mostrar "Aprovada" e, logo abaixo, o botão apagado dizendo que aguarda aprovação.
  const approval = situacaoDaAprovacao(item.approvalStatus, item.metadata);
  const editable = approval === "pendente" || approval === "elaboracao";
  const [chatOpen, setChatOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    // ⚠️ O AVISO NOMEIA A ASSINATURA, e não é redundância com a recusa do servidor. A rota RECUSA
    // apagar um acordo com termo vivo na Clicksign (409), mas quem lê a frase depois já clicou e já
    // digitou o motivo; dizer antes é o que evita a viagem. Os dois existem: o aviso é cortesia, a
    // recusa é a trava.
    const reason = window.prompt(
      `Motivo da exclusão da proposta ${item.protocol} (obrigatório).`
        + (isAcordo
          ? "\n\nSe este acordo já tiver termo em assinatura na Clicksign, cancele o envelope no card antes: a exclusão é recusada enquanto ele estiver vivo."
          : ""),
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
        return;
      }
      // ⚠️ A RECUSA VIRA FRASE. Até 20/09/2026 um DELETE recusado não dizia nada na tela: o botão
      // voltava ao normal e o card continuava lá, o que se lê como "não funcionou". Agora a rota
      // recusa de verdade (termo em assinatura), e a frase dela é a única coisa que explica.
      const corpo = (await response.json().catch(() => null)) as null | { error?: string };
      window.alert(corpo?.error ?? "Não foi possível excluir esta proposta agora.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <article className="rounded-xl border border-line/70 bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset ${
            isAcordo
              ? "bg-[#A07C3B]/8 text-[#7A5E2C] dark:text-[#d9b877] ring-[#A07C3B]/15"
              : "bg-subtle text-ink ring-line"
          }`}
        >
          {isAcordo ? "Acordo" : "Promessa"}
        </span>
        <span className="rounded-full bg-[#A07C3B]/5 px-2 py-0.5 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b877] ring-1 ring-inset ring-[#A07C3B]/15">
          {item.protocol}
        </span>
        <ApprovalBadge approval={approval} />
        <span className="ml-auto text-sm font-semibold text-ink">
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
                ? "bg-[#A07C3B]/10 text-[#7A5E2C] dark:text-[#d9b877]"
                : "text-ink-muted hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] dark:text-[#d9b877]"
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
              className="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-[#A07C3B]/5 hover:text-[#7A5E2C] dark:text-[#d9b877]"
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
            className="flex size-7 items-center justify-center rounded-md text-ink-muted transition-colors hover:bg-rose-50 dark:bg-rose-500/12 hover:text-rose-600 disabled:opacity-50"
          >
            {deleting ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 className="size-3.5" aria-hidden="true" />
            )}
          </button>
        </Tooltip>
      </div>

      <p className="mt-2 text-xs text-ink-muted">
        {item.installmentsCount} parcela(s) ·{" "}
        {isAcordo
          ? `1a em ${formatBrDate(item.firstDueDate)}`
          : `prometido para ${formatBrDate(item.promisedDate)}`}
      </p>

      {/* ⚠️ QUANDO NÃO DÁ PARA SABER, A TELA DIZ ISSO. Acordo anterior a 11/09/2026 nasceu sem
          contrato gravado; escrever ali a unidade "mais provável" seria repetir o erro da tela
          de aprovação, que mostrava a primeira unidade da carteira como se fosse a do acordo. */}
      <p className="mt-1 text-xs text-ink-muted">
        {unidade ? (
          <>
            Unidade <span className="font-medium text-ink-soft">{unidade.rotulo}</span>
          </>
        ) : item.acquisitionRequestC2xId ? (
          "Unidade não encontrada nas parcelas deste cliente"
        ) : (
          "Unidade não registrada (acordo anterior à escolha por unidade)"
        )}
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {item.parcelas.map((parcela) => (
          <span
            key={parcela.id}
            className="rounded-md border border-line/70 bg-subtle/70 px-2 py-1 text-[11px] text-ink-soft"
          >
            {parcela.sequence}/{item.installmentsCount} ·{" "}
            {formatBrDate(parcela.dueDate)} · {formatMoney(parcela.amount)}
            {parcela.status === "paga" ? (
              <Check className="ml-1 inline size-3 text-emerald-600" aria-hidden="true" />
            ) : null}
          </span>
        ))}
      </div>

      {/* Promessa não tem termo: o botão só existe no acordo. */}
      {/* A chave vem antes: sem liberação (lib/apolo/termos-liberados.ts), o botão não existe. */}
      {isAcordo && TERMO_DE_ACORDO_LIBERADO ? <TermoDeAcordoAcao item={item} /> : null}

      {/* ⚠️ A MESMA CHAVE DO TERMO, E NÃO UMA NOVA. Mandar para assinatura é o passo seguinte de
          emitir o termo: se o papel ainda não pode aparecer na tela (decisão do Lucas em
          16/09/2026, *"Portal + planos, termos escondidos"*), mandá-lo para a Clicksign muito
          menos. Uma segunda chave criaria o estado impossível de "não pode baixar, mas pode
          assinar". */}
      {isAcordo && TERMO_DE_ACORDO_LIBERADO ? <AssinaturaDoAcordo item={item} /> : null}

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

/**
 * O TERMO DE ACORDO no card: presente em todo acordo, aceso só quando o acordo pode ter termo.
 *
 * ⚠️ BOTÃO APAGADO SEM MENSAGEM É DEFEITO — o dono do produto cobrou duas vezes (15/09/2026). Quando
 * o gate diz não, a frase fica ESCRITA ao lado do botão, e não num tooltip: tooltip só existe para
 * quem passa o mouse, e some no toque. Medido em 20/09/2026 no Supabase de produção: dos 40 acordos
 * vivos, 18 estão aprovados e 22 reprovados (zero pendentes), então o botão acende em 18 deles e a
 * frase do reprovado é a que os outros 22 leem. Em 16/09/2026 eram 18 acordos e ZERO aprovados.
 *
 * ⚠️ A RECUSA DO SERVIDOR TAMBÉM VIRA FRASE NA TELA. O card pode estar velho (o gestor reprovou
 * depois que a lista carregou) e o C2X pode não confirmar mais o débito (parcela paga depois do
 * acordo); nos dois casos a rota responde `{ error }` com a frase, e é ela que aparece aqui.
 *
 * O download segue o molde da casa (`extrato-cliente-panel.tsx`): a rota exige Bearer, então não dá
 * para apontar um `<a href>` para ela; busca-se o blob e a revogação da URL ESPERA 60s — revogar na
 * mesma linha do clique mata o download calado em alguns navegadores.
 */
function TermoDeAcordoAcao({ item }: { item: GuardianCompromissoDetail }) {
  const motivo = motivoParaNaoEmitirOTermo(item);
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const idDaFrase = `termo-de-acordo-motivo-${item.id}`;

  async function baixarTermo() {
    setGerando(true);
    setErro(null);

    try {
      let token: string | null;
      try {
        token = await getApoloAccessToken();
      } catch {
        setErro("Sua sessão expirou. Entre de novo para emitir o termo.");
        return;
      }

      const response = await fetch("/api/guardian/termo-de-acordo", {
        body: JSON.stringify({ compromissoId: item.id }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErro(payload?.error ?? "Não foi possível gerar o termo de acordo agora.");
        return;
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = nomeDoArquivoBaixado(response, item.protocol);
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setErro("Não foi possível gerar o termo de acordo agora.");
    } finally {
      setGerando(false);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/60 pt-3">
      <button
        type="button"
        onClick={() => void baixarTermo()}
        disabled={Boolean(motivo) || gerando}
        aria-describedby={motivo ? idDaFrase : undefined}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/5 px-2.5 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#A07C3B]/5 dark:text-[#d9b877]"
      >
        {gerando ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <FileText className="size-3.5" aria-hidden="true" />
        )}
        Termo de acordo
      </button>
      {motivo ? (
        <p id={idDaFrase} className="min-w-0 flex-1 text-[11px] font-medium text-ink-muted">
          {motivo}
        </p>
      ) : null}
      {erro ? (
        <p
          role="alert"
          className="basis-full rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/12 dark:text-rose-300"
        >
          {erro}
        </p>
      ) : null}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────────────────────
// O TERMO DE ACORDO NA CLICKSIGN — mandar, acompanhar e consertar, no card onde o acordo vive.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// ⚠️ TELA APROVEITADA, E NÃO TELA NOVA. Lucas, 20/09/2026: *"nesse caso vamos ter que criar alguma
// tela ou aproveitar alguma que temos hoje para monitorar essas assinaturas"*. A escolha é este
// card, e ela é medida: é a ÚNICA tela que conhece `guardian_compromissos` (as três telas de
// assinatura do Apolo casam por proposta ou por unidade, e acordo não tem proposta), é onde a
// aprovação acontece, pela mesma pessoa que vai assinar, e é a tela viva — em 7 dias,
// `/hades/cobranca` teve 420 acessos contra ZERO das três telas de assinatura do Apolo.
//
// ⚠️ E A CONTAGEM NÃO É NOVA: ELA É A MESMA DO CARD DA TÊMIS. O "2 de 3 assinaram", quem assinou e o
// convite devolvido saem de `diarioDoCompromisso`, casca do mesmo miolo de `diarioDaProposta`
// ([[reference_painel_assinatura_duas_telas]]: duas contagens do mesmo fato divergem na primeira
// mudança). O que esta tela faz é DESENHAR; quem conta é a lib.
//
// ⚠️ SÓ CARREGA O QUE PODE ANDAR. A consulta do GET lê a venda no Panteon e o quadro do
// empreendimento — não é barata, e a casa já teve fatura alta por leitura repetida. Por isso ela só
// sai para acordo que PASSA no gate do Lucas: medido em 20/09/2026, 22 dos 40 acordos estão
// reprovados, e para eles a resposta seria sempre a mesma frase que o card já sabe escrever sozinho.

type SignatarioDoAcordo = {
  email: string;
  nome: string;
  ordem: number;
  papel: string;
};

type EnvelopeNaTela = {
  criadoEm: string;
  enviadoEm: null | string;
  enviadoPorNome: null | string;
  envelopeId: null | string;
  estado: string;
  falha: null | string;
};

type QuemAssinouNaTela = {
  assinouEm: null | string;
  chave: string;
  convite: string;
  conviteDetalhe: null | string;
  email: string;
  nome: string;
  papel: null | string;
};

type AssinaturaDoCard = {
  assinaram: number;
  envelope: { envelopeId: null | string; signatarios: QuemAssinouNaTela[] };
  total: number;
};

type RespostaDaAssinatura = {
  assinatura: AssinaturaDoCard | null;
  envelope: EnvelopeNaTela | null;
  impedimento: null | string;
  signatarios: SignatarioDoAcordo[];
};

/** Os rótulos da casa para o estado do envelope. O valor cru quando ele não é dos nossos. */
const ESTADO_ESCRITO: Record<string, string> = {
  aguardando: "Aguardando assinatura",
  assinado: "Assinado",
  cancelado: "Cancelado",
  desconhecido: "Situação desconhecida",
  expirado: "Prazo vencido",
  parcial: "Parcialmente assinado",
  rascunho: "Enviando",
  recusado: "Recusado",
};

/** Quem é a pessoa no acordo, em uma palavra. */
const PAPEL_ESCRITO: Record<string, string> = {
  careli: "Careli",
  comprador: "Comprador",
  vendedora: "Incorporador",
};

function AssinaturaDoAcordo({ item }: { item: GuardianCompromissoDetail }) {
  // ⚠️ O GATE RODA NA TELA ANTES DE QUALQUER REQUISIÇÃO, e é a MESMA função que a rota chama. Sem
  // isso, abrir a ficha de um cliente com cinco acordos reprovados dispararia cinco leituras da
  // venda no Panteon para receber cinco vezes a frase "este acordo foi reprovado pelo gestor".
  const motivoDoGate = motivoParaNaoEnviarParaAssinatura(item);

  const [dados, setDados] = useState<RespostaDaAssinatura | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [trabalhando, setTrabalhando] = useState<null | string>(null);
  const [erro, setErro] = useState<null | string>(null);

  /**
   * ⚠️ O GATE BARRA O BOTÃO, E NÃO A LEITURA. Até 20/09/2026 esta função desistia quando o acordo
   * não podia ser enviado, e o preço era o caso exato para o qual o cancelamento foi feito: um
   * acordo APROVADO que foi para a Clicksign e depois perde a aprovação (editar um acordo aprovado
   * o devolve para `pendente`) sumia da tela com o envelope vivo dentro, sem estado, sem id e sem o
   * botão de cancelar. O termo continuava cobrando assinatura do cliente e ninguém aqui o alcançava.
   *
   * ⚠️ E A LEITURA BARRADA É BARATA, medida: `prepararEnvioDoAcordo` lê os envelopes (um select em
   * `temis_envelopes`) e SAI no gate, antes de tocar a venda do Panteon e o quadro do
   * empreendimento, que são a parte cara. O diário só roda quando existe envelope. Ou seja, para os
   * 22 acordos reprovados de hoje o custo é um select que devolve zero linhas.
   *
   * ⚠️ E ELA NÃO ZERA O ERRO. `agir` grava a recusa do servidor e chama `carregar` no `finally`, sem
   * `await` entre os dois: um `setErro(null)` aqui caía no MESMO lote de render e a frase nunca era
   * desenhada. Quem pagava era a recusa que o GET não sabe recalcular, como o papel recusado porque
   * o débito mudou no C2X: o operador clicava, nada aparecia, e o botão continuava aceso. Quem limpa
   * o erro é quem COMEÇA uma ação nova, e `agir` já faz isso.
   */
  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch(
        `/api/guardian/termo-de-acordo/assinatura?acordo=${encodeURIComponent(item.id)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${token}` } },
      );
      const corpo = (await resposta.json().catch(() => null)) as {
        data?: RespostaDaAssinatura;
        error?: string;
      } | null;
      if (!resposta.ok) {
        setErro(corpo?.error ?? "Não foi possível ler a assinatura deste acordo agora.");
        return;
      }
      setDados(corpo?.data ?? null);
    } catch {
      setErro("Não foi possível ler a assinatura deste acordo agora.");
    } finally {
      setCarregando(false);
    }
    // ⚠️ `motivoDoGate` SAIU DAS DEPENDÊNCIAS junto com o `return` que ele comandava: a leitura não
    // depende mais dele, e deixá-lo aqui faria a consulta sair de novo a cada mudança de aprovação.
  }, [item.id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * As três ações que mexem na Clicksign.
   *
   * ⚠️ O BOTÃO NÃO VOLTA QUANDO SOBROU ENVELOPE NA CONTA. `envelopeAtivo` vem como CAMPO, e não como
   * palavra dentro da frase: quando a Clicksign falha no passo `notificar`, o envelope ficou ATIVO,
   * pago e permanente — e a recarga logo abaixo é o que mostra a linha dele na tela, para ninguém
   * clicar de novo achando que nada aconteceu.
   */
  async function agir(
    acao: "cancelar" | "enviar" | "reenviar",
    extra?: { signerId: string },
  ): Promise<void> {
    setTrabalhando(acao);
    setErro(null);
    try {
      const token = await getApoloAccessToken();
      const resposta = await fetch("/api/guardian/termo-de-acordo/assinatura", {
        body: JSON.stringify({ acordo: item.id, ...(extra ?? {}) }),
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        method: acao === "enviar" ? "POST" : acao === "cancelar" ? "DELETE" : "PATCH",
      });
      const corpo = (await resposta.json().catch(() => null)) as {
        data?: { aviso?: string };
        envelopeAtivo?: boolean;
        error?: string;
      } | null;
      if (!resposta.ok) {
        setErro(corpo?.error ?? "Não foi possível falar com a Clicksign agora.");
        return;
      }
      // ⚠️ 200 NÃO QUER DIZER "SEM PROBLEMA". Existe um desfecho em que o envelope foi criado,
      // ativado e notificado e o Panteon NÃO conseguiu registrar isso: o envio aconteceu (por isso
      // não é erro), e o envelope está vivo na conta, pago, com o convite já na caixa do cliente. O
      // aviso traz o id dele. Engolir este 200 faria a tela recarregar, não mostrar envelope nenhum,
      // e o operador clicar de novo.
      if (corpo?.data?.aviso) setErro(corpo.data.aviso);
    } catch {
      setErro("Não foi possível falar com a Clicksign agora.");
    } finally {
      setTrabalhando(null);
      await carregar();
    }
  }

  const envelope = dados?.envelope ?? null;
  const impedimento = dados?.impedimento ?? null;
  const assinatura = dados?.assinatura ?? null;
  // ⚠️ O GATE DO LUCAS APAGA O BOTÃO DE ENVIAR, E SÓ ELE. Ver `carregar`: o bloco continua na tela
  // para mostrar o envelope que já existe e oferecer o cancelamento, que é justamente o gesto de
  // quem perdeu a aprovação DEPOIS de mandar. O que some é o convite a mandar de novo.
  const podeEnviar = Boolean(dados) && !impedimento && !motivoDoGate && !carregando;
  // Acordo barrado pelo gate e SEM envelope não desenha bloco nenhum: a frase já está escrita ao
  // lado do botão do termo, logo acima, e repeti-la seria dizer a mesma coisa duas vezes no card.
  const semNadaAMostrar = Boolean(motivoDoGate) && !envelope && !erro;
  // A frase que explica o botão ausente: a do gate vence, porque é a que não muda com a recarga.
  const porQueNaoEnvia = motivoDoGate ?? impedimento;
  // ⚠️ SÓ O ENVELOPE VIVO OFERECE CANCELAR. Cancelado, recusado e vencido já estão mortos lá, e o
  // assinado não se desfaz — oferecer o botão neles seria oferecer um gesto que a Clicksign recusa.
  const podeCancelar = Boolean(
    envelope?.envelopeId && ["aguardando", "parcial", "rascunho"].includes(envelope.estado),
  );

  if (semNadaAMostrar) return null;

  return (
    <div className="mt-2 grid gap-2 border-t border-line/60 pt-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* ⚠️ O BOTÃO DE ENVIAR SOME QUANDO O GATE BARRA, e o de cancelar (abaixo) NÃO: mandar é o
            que a régua do Lucas proíbe, cancelar é o conserto de quem já mandou. */}
        {motivoDoGate ? null : (
        <button
          type="button"
          onClick={() => void agir("enviar")}
          disabled={!podeEnviar || trabalhando !== null}
          aria-describedby={impedimento ? `assinatura-motivo-${item.id}` : undefined}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#A07C3B]/25 bg-[#A07C3B]/5 px-2.5 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/10 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-[#A07C3B]/5 dark:text-[#d9b877]"
        >
          {trabalhando === "enviar" || carregando ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Send className="size-3.5" aria-hidden="true" />
          )}
          Enviar para assinatura
        </button>
        )}

        {podeCancelar ? (
          <Tooltip content="Cancela o envelope na Clicksign. Ele não se apaga, só fecha, e é isso que libera o reenvio." placement="top">
            <button
              type="button"
              onClick={() => void agir("cancelar")}
              disabled={trabalhando !== null}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-semibold text-ink-soft transition-colors hover:bg-subtle disabled:cursor-not-allowed disabled:opacity-50"
            >
              {trabalhando === "cancelar" ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <XCircle className="size-3.5" aria-hidden="true" />
              )}
              Cancelar envelope
            </button>
          </Tooltip>
        ) : null}

        {porQueNaoEnvia ? (
          <p
            id={`assinatura-motivo-${item.id}`}
            className="min-w-0 flex-1 text-[11px] font-medium text-ink-muted"
          >
            {porQueNaoEnvia}
          </p>
        ) : null}
      </div>

      {/* ⚠️ QUEM VAI ASSINAR APARECE ANTES DE ALGUÉM CLICAR. A conta da Clicksign é de produção, o
          envelope custa e o ativado não se apaga: descobrir que o e-mail do incorporador está errado
          DEPOIS de mandar é caro e não se desfaz. */}
      {!envelope && dados && dados.signatarios.length > 0 ? (
        <ul className="m-0 grid list-none gap-0.5 p-0">
          {dados.signatarios.map((s) => (
            <li
              className="flex items-baseline gap-2 text-[11px] text-ink-soft"
              key={`${s.papel}-${s.email}`}
            >
              <span className="tabular-nums text-ink-muted">{s.ordem}.</span>
              <span className="font-semibold text-ink">{s.nome}</span>
              <span className="text-ink-muted">{PAPEL_ESCRITO[s.papel] ?? s.papel}</span>
              <span className="min-w-0 flex-1 truncate text-ink-muted">{s.email}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {envelope ? (
        <section className="rounded-lg border border-line bg-subtle/40 px-3 py-2">
          <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <p className="m-0 text-xs font-semibold text-ink">
              {assinatura ? (
                <span className="tabular-nums">
                  {assinatura.assinaram} de {assinatura.total} assinaram
                </span>
              ) : (
                (ESTADO_ESCRITO[envelope.estado] ?? envelope.estado)
              )}
            </p>
            <span className="shrink-0 text-[11px] text-ink-muted">
              {ESTADO_ESCRITO[envelope.estado] ?? envelope.estado}
              {/* ⚠️ "DESDE QUANDO" É A PERGUNTA DA COBRANÇA. Um termo parado há dois dias é normal;
                  parado há três semanas é o que faz alguém ligar para o cliente. */}
              {envelope.enviadoEm
                ? ` · enviado em ${formatBrDateTime(envelope.enviadoEm)}`
                : ` · começou em ${formatBrDateTime(envelope.criadoEm)}`}
            </span>
          </header>

          {assinatura ? (
            <ul className="m-0 mt-1.5 grid list-none gap-0.5 p-0">
              {assinatura.envelope.signatarios.map((s) => (
                <li className="flex items-baseline gap-2 text-[11px]" key={s.chave}>
                  {s.assinouEm ? (
                    <Check className="size-3 shrink-0 text-emerald-600" aria-hidden="true" />
                  ) : (
                    <span className="size-3 shrink-0" aria-hidden="true" />
                  )}
                  <span className="font-semibold text-ink">{s.nome}</span>
                  <span className="text-ink-muted">
                    {s.papel ? (PAPEL_ESCRITO[s.papel] ?? s.papel) : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink-muted">
                    {/* ⚠️ "SEM NOTÍCIA" NÃO É "ENTREGUE": a Clicksign só avisa quando algo dá
                        errado, então silêncio quer dizer "nenhum erro chegou". Escrever "entregue"
                        aqui faria o operador parar de procurar. */}
                    {s.assinouEm
                      ? `assinou em ${formatBrDateTime(s.assinouEm)}`
                      : s.convite === "nao_entregue"
                        ? `convite devolvido${s.conviteDetalhe ? `: ${s.conviteDetalhe}` : ""}`
                        : s.email}
                  </span>
                  {!s.assinouEm && assinatura.envelope.envelopeId ? (
                    <Tooltip content="Reenvia o convite desta pessoa. Nada é criado nem removido no envelope." placement="top">
                      <button
                        type="button"
                        onClick={() => void agir("reenviar", { signerId: s.chave })}
                        disabled={trabalhando !== null}
                        className="inline-flex size-6 shrink-0 items-center justify-center rounded-md border border-line text-ink-soft transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-50"
                        aria-label={`Reenviar o convite de ${s.nome}`}
                      >
                        <RefreshCw className="size-3" aria-hidden="true" />
                      </button>
                    </Tooltip>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}

          {/* ⚠️ A FALHA GRAVADA FICA VISÍVEL. Ela é o que diz que sobrou envelope na conta — e
              esconder isso é o que faz alguém clicar de novo e criar o segundo. */}
          {envelope.falha ? (
            <p className="m-0 mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
              {envelope.falha}
            </p>
          ) : null}
        </section>
      ) : null}

      {erro ? (
        <p
          role="alert"
          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 dark:border-rose-500/25 dark:bg-rose-500/12 dark:text-rose-300"
        >
          {erro}
        </p>
      ) : null}
    </div>
  );
}

/** "20/09/2026 11:04" — a hora em Brasília, que é a hora da operação. */
function formatBrDateTime(iso: string): string {
  const quando = new Date(iso);
  if (Number.isNaN(quando.getTime())) return iso;
  return quando.toLocaleString("pt-BR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
    year: "numeric",
  });
}

/** O nome que a rota sugeriu no `Content-Disposition`; sem ele, o protocolo do acordo. */
function nomeDoArquivoBaixado(response: Response, protocolo: string): string {
  const header = response.headers.get("content-disposition") ?? "";
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1]);
    } catch {
      // cai no nome simples
    }
  }
  const simples = /filename="([^"]+)"/i.exec(header);
  return simples?.[1] ?? `Termo de Acordo - ${protocolo}.pdf`;
}

function ApprovalBadge({
  approval,
}: {
  approval: "pendente" | "aprovado" | "reprovado" | "elaboracao";
}) {
  const styles: Record<typeof approval, string> = {
    aprovado: "bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-100 dark:ring-emerald-500/25",
    elaboracao: "bg-subtle text-ink-soft ring-line",
    pendente: "bg-blue-50 text-blue-700 ring-blue-100",
    reprovado: "bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300 ring-rose-100 dark:ring-rose-500/25",
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

  // ⚠️ O ACORDO É DE UMA UNIDADE. Até 11/09/2026 esta tela dizia o contrário por escrito ("pode
  // juntar parcelas de qualquer unidade"), e os dois únicos acordos de produção nasceram
  // misturando dois contratos cada — sem como ratear a entrada entre eles depois.
  const unidades = useMemo(() => unidadesEmAtraso(overdue), [overdue]);
  const [contratoEscolhido, setContratoEscolhido] = useState<null | string>(() => {
    const doAcordo = existing?.acquisitionRequestC2xId;
    if (doAcordo) return String(doAcordo);
    // Com uma unidade só não há escolha a fazer: já entra selecionada.
    return unidades.length === 1 ? (unidades[0]?.acquisitionRequestId ?? null) : null;
  });

  // A lista de parcelas segue a unidade escolhida. Com nenhuma escolhida (cliente multi-unidade
  // recém-aberto), a lista fica vazia e a tela pede a escolha — melhor que oferecer tudo junto.
  const overdueDaUnidade = useMemo(
    () =>
      contratoEscolhido === null
        ? []
        : overdue.filter(
            (item) => String(item.acquisitionRequestId) === contratoEscolhido,
          ),
    [contratoEscolhido, overdue],
  );

  // Trocar de unidade limpa a seleção: manter parcela da unidade anterior marcada é justamente
  // como o acordo misturado nasce.
  useEffect(() => {
    setSelected((atual) => {
      if (atual.size === 0) return atual;
      const permitidas = new Set(overdueDaUnidade.map((item) => item.id));
      const filtrada = new Set([...atual].filter((id) => permitidas.has(id)));

      return filtrada.size === atual.size ? atual : filtrada;
    });
  }, [overdueDaUnidade]);
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
  const selectedInstallments = overdueDaUnidade.filter((item) => selected.has(item.id));
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
    overdueDaUnidade.length > 0 && overdueDaUnidade.every((item) => selected.has(item.id));

  function toggleAll() {
    setSelected(() =>
      allSelected ? new Set<string>() : new Set(overdueDaUnidade.map((item) => item.id)),
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
    // ⚠️ A UNIDADE DESTE ACORDO, GRAVADA NA HORA. A Central do gestor não tem as parcelas do
    // C2X para casar depois, e por isso mostrava a PRIMEIRA matrícula da carteira do cliente
    // como se fosse a do acordo — em cliente com mais de uma unidade, dois acordos diferentes
    // apareciam com o mesmo lote (TI-000149). Guardar aqui é o único jeito de a tela de lá
    // dizer a verdade sem consultar o legado.
    const unidadeDesteAcordo = unidadeDoAcordo(
      contratoDaSelecao(selectedInstallments),
      selectedInstallments,
    );
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
        // A unidade DO ACORDO, que não se confunde com a lista acima (a carteira inteira).
        unidadeDoAcordo: unidadeDesteAcordo?.rotulo ?? null,
        unidadeDoAcordoCodigo: unidadeDesteAcordo?.unitCode ?? null,
        parcelasVencidas: client.parcelas.vencidas,
        saldoDevedor: client.saldoDevedor,
        scoreRisco: client.scoreRisco,
      },
    };

    // ⚠️ A UNIDADE VAI NO CORPO, e é o que preenche `acquisition_request_c2x_id`. A coluna
    // existe desde a migration 0036 e estava NULA em 7 de 7 compromissos: sem ela, nada no
    // registro diz de qual unidade é o acordo, e o termo de formalização fica sem objeto.
    // `contratoDaSelecao` recusa seleção que mistura contratos — cinto e suspensório com o
    // filtro da tela, porque o modal pode ser reaberto sobre um acordo antigo já misturado.
    const contratoDoAcordo = contratoDaSelecao(selectedInstallments);

    const body = isAcordo
      ? {
          acquisitionRequestC2xId: contratoDoAcordo,
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
          acquisitionRequestC2xId: contratoDoAcordo,
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
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
      />
      <div className="relative z-10 flex max-h-[88vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line/70 bg-surface shadow-[0_24px_80px_rgba(15,23,42,0.22)]">
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-2">
            {isAcordo ? (
              <Handshake className="size-4 text-[#A07C3B]" aria-hidden="true" />
            ) : (
              <CalendarPlus className="size-4 text-[#A07C3B]" aria-hidden="true" />
            )}
            <h2 className="text-base font-semibold text-ink">
              {existing
                ? isAcordo
                  ? "Editar acordo"
                  : "Editar promessa"
                : isAcordo
                  ? "Novo acordo"
                  : "Nova promessa"}
            </h2>
            <span className="text-xs text-ink-muted">{client.nome}</span>
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

        <div className="border-b border-line px-5 py-1.5 text-[11px] text-ink-muted">
          Unidade(s): <span className="font-medium text-ink">{unitsLabel}</span>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {/* ⚠️ A ESCOLHA DA UNIDADE VEM ANTES DAS PARCELAS, e só aparece quando há mais de uma:
              com uma só não há decisão a tomar, e um seletor de um item é ruído. Cliente
              multi-unidade abre SEM unidade escolhida de propósito — oferecer tudo junto é como
              nasceram os dois acordos misturados de produção. */}
          {unidades.length > 1 ? (
            <section>
              <p className="mb-2 text-xs font-semibold text-ink-muted">
                {isAcordo ? "1 · Unidade" : "Unidade"}
              </p>
              <div className="grid gap-1.5">
                {unidades.map((unidade) => {
                  const escolhida =
                    contratoEscolhido === unidade.acquisitionRequestId;

                  return (
                    <button
                      key={unidade.acquisitionRequestId}
                      type="button"
                      onClick={() =>
                        setContratoEscolhido(unidade.acquisitionRequestId)
                      }
                      className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                        escolhida
                          ? "border-[#A07C3B] bg-[#A07C3B]/8"
                          : "border-line/70 hover:bg-subtle"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">
                        <span className="font-semibold text-ink">
                          {unidade.rotulo}
                        </span>
                        {unidade.unitLabel && unidade.unitLabel !== unidade.rotulo ? (
                          <span className="text-ink-muted"> · {unidade.unitLabel}</span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-ink-muted">
                        {unidade.parcelas}{" "}
                        {unidade.parcelas === 1 ? "parcela" : "parcelas"} ·{" "}
                        <span className="font-semibold text-ink">
                          {formatMoney(unidade.total)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {contratoEscolhido === null ? (
                <p className="mt-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                  Escolha a unidade para ver as parcelas. O acordo vale para uma
                  unidade por vez.
                </p>
              ) : null}
            </section>
          ) : null}

          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-ink-muted">
                {isAcordo
                  ? `${unidades.length > 1 ? "2" : "1"} · Parcelas em negociação`
                  : "Parcelas em negociação"}
              </p>
              {overdueDaUnidade.length > 1 ? (
                <button
                  type="button"
                  onClick={toggleAll}
                  className="text-[11px] font-semibold text-[#A07C3B] transition-colors hover:text-[#7A5E2C] dark:text-[#d9b877]"
                >
                  {allSelected ? "Limpar seleção" : "Incluir todas"}
                </button>
              ) : null}
            </div>
            <div className="max-h-52 overflow-y-auto rounded-lg border border-line/70 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
              {overdueDaUnidade.length === 0 ? (
                <p className="px-3 py-4 text-xs text-ink-muted">
                  Sem parcelas vencidas para negociar.
                </p>
              ) : (
                overdueDaUnidade.map((item) => {
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
                        {checked ? <Check className="size-3" aria-hidden="true" /> : null}
                      </span>
                      <span className="flex-1 truncate text-ink">
                        <span className="font-semibold text-ink">
                          {item.number}
                        </span>{" "}
                        · {item.reference}
                      </span>
                      <span className="font-semibold text-ink">{item.value}</span>
                    </button>
                  );
                })
              )}
            </div>
            {/* ⚠️ ESTA FRASE DIZIA O OPOSTO ATÉ 11/09/2026 ("pode juntar parcelas de qualquer
                unidade, cobrança é por cliente"), e era a regra da casa. O Lucas a reverteu: um
                acordo que mistura unidades não permite dizer quanto da entrada é de cada uma, e
                deixa o termo de formalização sem objeto. */}
            {isAcordo ? (
              <p className="mt-1 text-[11px] text-ink-muted">
                O acordo vale para uma unidade por vez.
              </p>
            ) : null}
          </section>

          {isAcordo ? (
            <>
              <section>
                <p className="mb-2 text-xs font-semibold text-ink-muted">2 · Ajustes</p>
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
                <p className="mb-2 text-xs font-semibold text-ink-muted">
                  3 · Forma de pagamento
                </p>
                <div className="mb-3 inline-flex gap-1 rounded-lg bg-subtle/80 p-1">
                  {(["a_vista", "parcelado"] as PaymentMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setPaymentMode(mode)}
                      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                        paymentMode === mode
                          ? "bg-[#A07C3B] text-white"
                          : "text-ink-soft hover:text-ink"
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
                    <div className="overflow-hidden rounded-lg border border-line/70">
                      <div className="flex items-center gap-2 bg-subtle px-3 py-1.5 text-[11px] text-ink-muted">
                        <span className="w-12">Parcela</span>
                        <span className="flex-1">Valor (R$)</span>
                        <span className="w-32">Vencimento</span>
                      </div>
                      {editParcelas.map((parcela, index) => (
                        <div
                          key={`${parcela.label}-${index}`}
                          className="flex items-center gap-2 border-t border-line px-3 py-1.5"
                        >
                          <span className="w-12 text-[11px] font-medium text-ink-soft">
                            {parcela.label}
                          </span>
                          <input
                            inputMode="decimal"
                            value={parcela.amount}
                            onChange={(event) =>
                              updateParcela(index, { amount: event.target.value })
                            }
                            className="h-7 min-w-0 flex-1 rounded-md border border-line/70 bg-surface px-2 text-xs font-semibold text-ink outline-none focus:border-[#A07C3B]/40"
                          />
                          <input
                            type="date"
                            value={parcela.dueDate}
                            onChange={(event) =>
                              updateParcela(index, { dueDate: event.target.value })
                            }
                            className="h-7 w-32 rounded-md border border-line/70 bg-surface px-1.5 text-xs text-ink outline-none focus:border-[#A07C3B]/40"
                          />
                        </div>
                      ))}
                      <div
                        className={`flex items-center justify-between border-t px-3 py-2 text-xs font-semibold ${
                          sumMatches
                            ? "border-emerald-100 dark:border-emerald-500/25 bg-emerald-50 dark:bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"
                            : "border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/12 text-rose-700 dark:text-rose-300"
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
              className="min-h-16 w-full resize-none rounded-lg border border-line/70 bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10"
            />
          </Field>

          {formError ? (
            <p className="rounded-lg border border-rose-200 dark:border-rose-500/25 bg-rose-50 dark:bg-rose-500/12 px-3 py-2 text-xs font-semibold text-rose-700 dark:text-rose-300">
              {formError}
            </p>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-lg border border-line/70 bg-surface px-4 text-sm font-medium text-ink hover:bg-subtle"
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
    <div className="rounded-lg bg-subtle/70 px-2.5 py-2">
      <p className="text-[11px] text-ink-muted">{label}</p>
      <div className="mt-1 flex items-center gap-1">
        <input
          inputMode="decimal"
          value={adjustment.value}
          onChange={(event) => onChange({ ...adjustment, value: event.target.value })}
          placeholder="0"
          className="h-7 w-full min-w-0 rounded-md border border-line/70 bg-surface px-1.5 text-sm font-semibold text-ink outline-none focus:border-[#A07C3B]/40"
        />
        <button
          type="button"
          onClick={() =>
            onChange({
              ...adjustment,
              mode: adjustment.mode === "percent" ? "value" : "percent",
            })
          }
          className="h-7 shrink-0 rounded-md border border-line/70 bg-surface px-1.5 text-[11px] font-semibold text-[#7A5E2C] dark:text-[#d9b877]"
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
          : "bg-subtle/70"
      }`}
    >
      <p className={`text-[11px] ${accent ? "text-[#7A5E2C] dark:text-[#d9b877]" : "text-ink-muted"}`}>
        {label}
      </p>
      <p
        className={`mt-0.5 text-sm font-semibold ${
          accent ? "text-[#412402]" : "text-ink"
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
      <span className="mb-1 block text-xs font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  "h-9 w-full rounded-lg border border-line/70 bg-surface px-2.5 text-sm font-medium text-ink outline-none focus:border-[#A07C3B]/40 focus:ring-2 focus:ring-[#A07C3B]/10";

// --- helpers ---

function applyAdjustment(base: number, adjustment: Adjustment) {
  const value = parseMoneyInput(adjustment.value);
  if (adjustment.mode === "percent") {
    return round2((base * value) / 100);
  }
  return round2(value);
}

// ⚠️ A LEITURA DO ESTADO DE APROVAÇÃO (coluna real da fase 2, metadata da fase 1 só quando a
// coluna vem indefinida, 'em_elaboracao' -> 'elaboracao') MUDOU-SE para `situacaoDaAprovacao` em
// `lib/hades/dossie/termo-de-acordo-gate.ts`, sem mudar uma linha da regra: o selo do card e o
// botão do termo precisam ler a MESMA régua.

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
