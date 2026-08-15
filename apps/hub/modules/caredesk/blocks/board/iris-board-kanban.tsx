"use client";

import { useMemo, useState } from "react";
import {
  Bot,
  Inbox,
  LayoutGrid,
  List,
  MessageCircle,
  Plus,
  Search,
  Timer,
} from "lucide-react";
import { Tooltip } from "@repo/uix";

import type { IrisBoardMetrics } from "./iris-board-view";
import {
  BoardProfileChip,
  EmailChannelChip,
  emailBoxLabel,
  isEmailBoardTicket,
  type IrisBoardTicket,
  type IrisTicketQueueHelpers,
  type IrisTicketQueueRenderers,
  IrisTicketRow,
  operatorInitials,
  queueChipClasses,
  readBoardTicketCrm,
} from "./iris-ticket-queue";
import { EmptyState, FilterSelect } from "../shared/iris-ui";
import { IrisCentralTabs } from "../shell/iris-central-selector";
import type { IrisCentralSelecionada } from "../../lib/centrais";
import { usePersistedState } from "@/hooks/use-persisted-state";

const SORT_OPTIONS = [
  "Mais recentes",
  "Mais antigos",
  "SLA vencido",
  "Prioridade",
  "Nome (A-Z)",
] as const;

type SortMode = (typeof SORT_OPTIONS)[number];

const PRIORITY_WEIGHT: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

const cacaOwnerLabel = "Cacá";

type GroupMode = "status" | "fila" | "canal" | "operador";

// Abas do Board por NATUREZA do canal. Grupo não é atendimento (não abre nem fecha), e-mail tem
// ritmo próprio: separados, cada um mostra números que fazem sentido pra ele. "Ações" é a campanha
// de contato em massa (não tem ticket na fila — a resposta cai direto na ação), então esta aba
// mostra a tela da campanha em vez do kanban. Ver [[project_apolo_acao_contato]].
type AbaDoBoard = "atendimento" | "email" | "grupos" | "acoes";

// "Atendimento" virou "Conversas" (Lucas, 15/08): com a central logo acima chamando-se
// Atendimento, a aba de mesmo nome fazia a pessoa ler duas vezes a mesma palavra em dois
// níveis diferentes. "Conversas" diz o que a aba tem, e serve para as duas centrais.
const ABAS_DO_BOARD: { chave: AbaDoBoard; rotulo: string }[] = [
  { chave: "atendimento", rotulo: "Conversas" },
  { chave: "email", rotulo: "E-mail" },
  { chave: "grupos", rotulo: "Grupos" },
  { chave: "acoes", rotulo: "Ações" },
];

// Quais abas cada central mostra. Não é cosmético: aba vazia num lugar onde aquele conteúdo
// nunca aparece faz a pessoa procurar o que não existe.
// - Grupos vive só no Relacionamento (a fila "Grupo" é de lá desde a 0087).
// - Ações fica nas duas: campanha de contato em massa é transversal, e hoje as 333 estão no
//   Atendimento só porque foi para lá que dispararam.
// Em "Todas" aparecem todas, que é o ponto daquela visão.
function abasDaCentral(central: IrisCentralSelecionada): AbaDoBoard[] {
  if (central === "atendimento") {
    return ["atendimento", "email", "acoes"];
  }

  if (central === "relacionamento") {
    return ["atendimento", "email", "grupos", "acoes"];
  }

  return ["atendimento", "email", "grupos", "acoes"];
}

const groupModes: { key: GroupMode; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "fila", label: "Fila" },
  { key: "canal", label: "Canal" },
  { key: "operador", label: "Operador" },
];

type BoardColumn = {
  accent: string;
  key: string;
  label: string;
  tickets: IrisBoardTicket[];
};

// Colunas fixas do fluxo (modo status). O card "anda" sozinho conforme o status real.
const STATUS_FLOW: { accent: string; key: string; label: string }[] = [
  { accent: "#DC2626", key: "erro", label: "Erro de envio" },
  { accent: "#A07C3B", key: "caca", label: "Com a Cacá" },
  { accent: "#B45309", key: "pendente", label: "Pendente" },
  { accent: "#0F6E56", key: "aguardando", label: "Aguardando cliente" },
  { accent: "#64748B", key: "resolvido", label: "Resolvido hoje" },
];

export function IrisBoardKanban({
  central,
  centraisDisponiveis,
  helpers,
  metrics,
  naoLidasPorCentral,
  onOpenAttendance,
  onSelectCentral,
  onSelectTicket,
  onStartAttendance,
  renderers,
  tickets,
}: {
  central: IrisCentralSelecionada;
  centraisDisponiveis: IrisCentralSelecionada[];
  helpers: IrisTicketQueueHelpers;
  metrics: IrisBoardMetrics;
  naoLidasPorCentral: Partial<Record<IrisCentralSelecionada, number>>;
  onOpenAttendance: (ticketId: string) => void;
  onSelectCentral: (central: IrisCentralSelecionada) => void;
  onSelectTicket: (ticketId: string) => void;
  onStartAttendance: (queueLabel?: string) => void;
  renderers: IrisTicketQueueRenderers;
  tickets: IrisBoardTicket[];
}) {
  // Persistidos: a organização/ordenação/visão do board "continua de onde estava"
  // ao abrir um card e voltar, ou ao trocar de módulo e retornar. Ver [[use-persisted-state]].
  const [groupMode, setGroupMode] = usePersistedState<GroupMode>(
    "iris.board.groupMode",
    "status",
  );
  const [sortMode, setSortMode] = usePersistedState<SortMode>(
    "iris.board.sortMode",
    "Mais recentes",
  );
  const [search, setSearch] = usePersistedState("iris.board.search", "");
  const [viewMode, setViewMode] = usePersistedState<"kanban" | "lista">(
    "iris.board.viewMode",
    "kanban",
  );
  const [abaAtiva, setAbaAtiva] = usePersistedState<AbaDoBoard>(
    "iris.board.aba",
    "atendimento",
  );
  // FILTROS COMBINÁVEIS. Antes o Board só tinha AGRUPAMENTO (Status/Fila/Canal/Operador), que
  // muda as colunas mas não esconde nada — a barra parecia filtro e não filtrava. Agora dá pra
  // somar critérios ("Cinthia" E "Pendente" E "WhatsApp") e, dentro da mesma dimensão, marcar
  // mais de um valor (Cinthia OU Eliandiene). Pedido do Lucas em 26/07.
  const [filtros, setFiltros] = usePersistedState<Record<GroupMode, string[]>>(
    "iris.board.filtros",
    { canal: [], fila: [], operador: [], status: [] },
  );
  const [seletorAberto, setSeletorAberto] = useState<GroupMode | null>(null);

  // As abas desta central, e qual está realmente ativa.
  // ⚠️ `abaAtiva` é PERSISTIDA, então ela sobrevive à troca de central: quem estava em "Grupos"
  // no Relacionamento e pula para o Atendimento (que não tem Grupos) veria a tela vazia com
  // uma aba selecionada que não está na barra. `abaEfetiva` cai na primeira aba válida nesse
  // caso, sem apagar a preferência de quem volta para a outra central.
  const abasVisiveis = useMemo(() => {
    const permitidas = new Set(abasDaCentral(central));

    return ABAS_DO_BOARD.filter((aba) => permitidas.has(aba.chave));
  }, [central]);
  const abaEfetiva: AbaDoBoard =
    abasVisiveis.find((aba) => aba.chave === abaAtiva)?.chave ??
    abasVisiveis[0]?.chave ??
    "atendimento";

  // ABAS DO BOARD (Atendimento · E-mail · Grupos). Decisão do Lucas em 26/07.
  //
  // Os grupos de WhatsApp NÃO são atendimento: são salas de trabalho interno ("Vale do Ouro
  // Back Office", "Diretoria Gurgel", "Careli Time"), não abrem, não fecham e não têm dono.
  // Misturados na mesma tela eles inflavam o indicador em 40%: o Board dizia 137 abertos
  // enquanto o banco tinha 98 atendimentos — a diferença eram exatamente os 39 grupos.
  //
  // A separação é de APRESENTAÇÃO (filtro antes dos indicadores e das colunas), não mexe na
  // origem dos dados. Cada aba recalcula os próprios números, então "Abertos" volta a dizer a
  // verdade sobre atendimento.
  const ticketsDaAba = useMemo(
    () =>
      tickets.filter((ticket) => {
        // Atendimento de ação (contato em massa) só aparece na aba "Ações" — sai da fila geral.
        if (ticket.isAcao) {
          return abaEfetiva === "acoes";
        }

        if (ticket.isGroup) {
          return abaEfetiva === "grupos";
        }

        if (isEmailBoardTicket(ticket)) {
          return abaEfetiva === "email";
        }

        return abaEfetiva === "atendimento";
      }),
    [abaEfetiva, tickets],
  );

  // Não lidas por aba, para a pessoa ver movimento sem precisar entrar.
  const naoLidasPorAba = useMemo(() => {
    const contagem = { acoes: 0, atendimento: 0, email: 0, grupos: 0 };

    for (const ticket of tickets) {
      if (!ticket.unread) {
        continue;
      }

      if (ticket.isAcao) {
        contagem.acoes += 1;
      } else if (ticket.isGroup) {
        contagem.grupos += 1;
      } else if (isEmailBoardTicket(ticket)) {
        contagem.email += 1;
      } else {
        contagem.atendimento += 1;
      }
    }

    return contagem;
  }, [tickets]);

  const indicators = useMemo<
    { label: string; title?: string; tone?: "danger" | "gold"; value: string }[]
  >(
    () => [
      {
        label: "Abertos",
        value: `${ticketsDaAba.filter((ticket) => !helpers.isClosedTicket(ticket)).length}`,
      },
      {
        label: "SLA crítico",
        tone: "danger",
        value: `${ticketsDaAba.filter(helpers.isSlaCritical).length}`,
      },
      {
        label: "1ª resposta",
        title: "Tempo até a PRIMEIRA resposta (TPR)",
        value: metrics.firstResponseLabel,
      },
      {
        label: "TDR",
        title:
          "Tempo de resposta: média de toda vez que o cliente escreve até a gente responder",
        value: metrics.responseTimeLabel,
      },
      {
        label: "Tempo médio",
        title: "Tempo médio de atendimento (TMA): da abertura ao encerramento",
        value: metrics.averageHandlingTimeLabel,
      },
      {
        label: "Sem resposta",
        tone: "gold",
        value: `${ticketsDaAba.filter(helpers.isWaitingForIris).length}`,
      },
      {
        label: "Resolvido hoje",
        value: `${ticketsDaAba.filter(helpers.isClosedToday).length}`,
      },
    ],
    [helpers, metrics, ticketsDaAba],
  );

  // Valores existentes em cada dimensão, para o seletor só oferecer o que a aba realmente tem
  // (não adianta oferecer "Gurgel" se não há nenhum card do Gurgel aqui).
  const valoresPorDimensao = useMemo(() => {
    const mapa: Record<GroupMode, string[]> = {
      canal: [],
      fila: [],
      operador: [],
      status: [],
    };

    for (const dimensao of ["status", "fila", "canal", "operador"] as const) {
      const vistos = new Set<string>();

      for (const ticket of ticketsDaAba) {
        vistos.add(valorDaDimensao(dimensao, ticket, helpers));
      }

      mapa[dimensao] = Array.from(vistos).sort((a, b) => a.localeCompare(b));
    }

    return mapa;
  }, [helpers, ticketsDaAba]);

  // Dentro da mesma dimensão os valores somam (OU); entre dimensões, restringem (E).
  const ticketsFiltrados = useMemo(
    () =>
      ticketsDaAba.filter((ticket) =>
        (["status", "fila", "canal", "operador"] as const).every((dimensao) => {
          const escolhidos = filtros[dimensao];

          return (
            escolhidos.length === 0 ||
            escolhidos.includes(valorDaDimensao(dimensao, ticket, helpers))
          );
        }),
      ),
    [filtros, helpers, ticketsDaAba],
  );

  const totalDeFiltros = (
    ["status", "fila", "canal", "operador"] as const
  ).reduce((soma, dimensao) => soma + filtros[dimensao].length, 0);

  function alternarFiltro(dimensao: GroupMode, valor: string) {
    setFiltros((atual) => {
      const escolhidos = atual[dimensao];

      return {
        ...atual,
        [dimensao]: escolhidos.includes(valor)
          ? escolhidos.filter((item) => item !== valor)
          : [...escolhidos, valor],
      };
    });
  }

  const visibleTickets = useMemo(
    () => sortTickets(filterTickets(ticketsFiltrados, search, helpers), sortMode, helpers),
    [helpers, search, sortMode, ticketsFiltrados],
  );

  const columns = useMemo(
    () => buildColumns(groupMode, visibleTickets, helpers),
    [groupMode, helpers, visibleTickets],
  );

  return (
    <section className="flex h-full min-h-0 flex-col gap-3">
      {/* Nível 1: a central. Só aparece para quem tem acesso às duas. */}
      <IrisCentralTabs
        central={central}
        disponiveis={centraisDisponiveis}
        naoLidasPorCentral={naoLidasPorCentral}
        onSelect={onSelectCentral}
      />

      {/* Nível 2: o canal, dentro da central escolhida. */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line/70">
        {abasVisiveis.map((aba) => {
          const naoLidas = naoLidasPorAba[aba.chave];
          const ativa = abaEfetiva === aba.chave;

          return (
            <button
              key={aba.chave}
              type="button"
              onClick={() => setAbaAtiva(aba.chave)}
              aria-pressed={ativa}
              className={[
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold transition-colors",
                ativa
                  ? "border-[#A07C3B] text-[#7A5E2C]"
                  : "border-transparent text-ink-muted hover:text-ink",
              ].join(" ")}
            >
              {aba.rotulo}
              {naoLidas > 0 ? (
                <span
                  title={`${naoLidas} sem ler`}
                  className={[
                    "inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
                    ativa
                      ? "bg-[#A07C3B] text-white"
                      : "bg-[#A07C3B]/15 text-[#7A5E2C]",
                  ].join(" ")}
                >
                  {naoLidas}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-7">
        {indicators.map((indicator) => (
          <div
            key={indicator.label}
            title={indicator.title}
            className={`rounded-xl border bg-surface p-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
              indicator.tone === "danger"
                ? "border-rose-100"
                : "border-line/70"
            }`}
          >
            <p
              className={`truncate text-[10px] font-semibold uppercase tracking-normal ${
                indicator.tone === "danger"
                  ? "text-rose-600"
                  : indicator.tone === "gold"
                    ? "text-[#7A5E2C]"
                    : "text-ink-muted"
              }`}
            >
              {indicator.label}
            </p>
            <p
              className={`mt-1 truncate text-xl font-semibold leading-none ${
                indicator.tone === "danger" ? "text-rose-600" : "text-ink"
              }`}
            >
              {indicator.value}
            </p>
          </div>
        ))}
      </div>

      {/* BARRA DE FILTROS: chips que somam. O contador "mostrando X de Y" evita o erro clássico
          do filtro esquecido ligado — sem ele a pessoa acha que a fila esvaziou. */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-xs">
        <span className="font-semibold text-ink-muted">Filtros:</span>
        {(["operador", "status", "canal", "fila"] as const).map((dimensao) => (
          <div key={dimensao} className="relative">
            <button
              type="button"
              onClick={() =>
                setSeletorAberto((atual) =>
                  atual === dimensao ? null : dimensao,
                )
              }
              className={[
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 font-semibold transition-colors",
                filtros[dimensao].length > 0
                  ? "border-[#A07C3B]/40 bg-[#A07C3B]/10 text-[#7A5E2C]"
                  : "border-line/70 bg-surface text-ink-muted hover:border-[#A07C3B]/25",
              ].join(" ")}
            >
              {groupModes.find((modo) => modo.key === dimensao)?.label}
              {filtros[dimensao].length > 0 ? (
                <span className="tabular-nums">
                  {filtros[dimensao].length}
                </span>
              ) : (
                <Plus className="size-3" aria-hidden="true" />
              )}
            </button>
            {seletorAberto === dimensao ? (
              <div className="absolute left-0 top-8 z-30 max-h-64 w-56 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
                {valoresPorDimensao[dimensao].length === 0 ? (
                  <p className="p-2 text-ink-muted">Nada por aqui</p>
                ) : (
                  valoresPorDimensao[dimensao].map((valor) => (
                    <button
                      key={valor}
                      type="button"
                      onClick={() => alternarFiltro(dimensao, valor)}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-subtle"
                    >
                      <span
                        className={[
                          "flex size-3.5 shrink-0 items-center justify-center rounded border",
                          filtros[dimensao].includes(valor)
                            ? "border-[#A07C3B] bg-[#A07C3B] text-white"
                            : "border-line",
                        ].join(" ")}
                      >
                        {filtros[dimensao].includes(valor) ? "✓" : ""}
                      </span>
                      <span className="truncate text-ink">{valor}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
          </div>
        ))}

        {totalDeFiltros > 0 ? (
          <>
            <span className="tabular-nums text-ink-muted">
              mostrando {ticketsFiltrados.length} de {ticketsDaAba.length}
            </span>
            <button
              type="button"
              onClick={() =>
                setFiltros({ canal: [], fila: [], operador: [], status: [] })
              }
              className="font-semibold text-[#7A5E2C] underline-offset-2 hover:underline"
            >
              Limpar
            </button>
          </>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-line/70 bg-surface px-3">
          <Search className="size-4 shrink-0 text-[#A07C3B]" aria-hidden="true" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar cliente, protocolo, assunto..."
            className="min-w-0 flex-1 bg-transparent text-sm font-medium text-ink outline-none placeholder:text-ink-muted"
          />
        </label>
        <div className="w-[168px] shrink-0">
          <FilterSelect
            label="Ordenar"
            value={sortMode}
            options={[...SORT_OPTIONS]}
            onChange={(value) => setSortMode(value as SortMode)}
          />
        </div>
        <div className="inline-flex shrink-0 rounded-lg border border-line/70 bg-subtle/70 p-0.5">
          <button
            type="button"
            onClick={() => setViewMode("kanban")}
            aria-label="Visão kanban"
            title="Kanban"
            className={[
              "flex size-7 items-center justify-center rounded-md transition-colors",
              viewMode === "kanban"
                ? "bg-[#101820] text-white shadow-sm dark:bg-white/[0.14] dark:text-ink dark:shadow-none"
                : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            <LayoutGrid className="size-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode("lista")}
            aria-label="Visão lista"
            title="Lista"
            className={[
              "flex size-7 items-center justify-center rounded-md transition-colors",
              viewMode === "lista"
                ? "bg-[#101820] text-white shadow-sm dark:bg-white/[0.14] dark:text-ink dark:shadow-none"
                : "text-ink-muted hover:text-ink",
            ].join(" ")}
          >
            <List className="size-4" aria-hidden="true" />
          </button>
        </div>
        {viewMode === "kanban" ? (
          <div className="inline-flex shrink-0 rounded-lg border border-line/70 bg-subtle/70 p-0.5">
            {groupModes.map((mode) => {
              const active = mode.key === groupMode;

              return (
                <button
                  key={mode.key}
                  type="button"
                  onClick={() => setGroupMode(mode.key)}
                  className={[
                    "rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors",
                    active
                      ? "bg-[#101820] text-white shadow-sm dark:bg-white/[0.14] dark:text-ink dark:shadow-none"
                      : "text-ink-muted hover:text-ink",
                  ].join(" ")}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
        ) : null}
        <Tooltip content="Novo atendimento" placement="left">
          <button
            type="button"
            aria-label="Novo atendimento"
            onClick={() => onStartAttendance()}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#101820] text-white shadow-sm transition-colors hover:bg-[#1f2c3a] dark:bg-white/[0.12] dark:text-ink dark:shadow-none dark:hover:bg-white/[0.18]"
          >
            <Plus className="size-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      {viewMode === "kanban" ? (
        <div className="flex min-h-0 flex-1 gap-3 overflow-x-auto pb-1 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
          {columns.map((column) => (
            <BoardColumnView
              key={column.key}
              agrupadoPor={groupMode}
              column={column}
              helpers={helpers}
              onOpenAttendance={onOpenAttendance}
              onSelectTicket={onSelectTicket}
              renderers={renderers}
            />
          ))}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line/70 bg-surface">
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
            {visibleTickets.length > 0 ? (
              visibleTickets.map((ticket) => (
                <IrisTicketRow
                  key={ticket.id}
                  helpers={helpers}
                  onOpenAttendance={onOpenAttendance}
                  onSelectTicket={onSelectTicket}
                  renderers={renderers}
                  ticket={ticket}
                />
              ))
            ) : (
              <EmptyState
                icon={Inbox}
                title="Nenhum atendimento"
                description="Quando um ticket entrar na fila, ele aparece aqui."
              />
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function BoardColumnView({
  agrupadoPor,
  column,
  helpers,
  onOpenAttendance,
  onSelectTicket,
  renderers,
}: {
  agrupadoPor: GroupMode;
  column: BoardColumn;
  helpers: IrisTicketQueueHelpers;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  renderers: IrisTicketQueueRenderers;
}) {
  return (
    <div className="flex w-[264px] shrink-0 flex-col rounded-xl border border-line/70 bg-subtle/50">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="flex min-w-0 items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: column.accent }}
            aria-hidden="true"
          />
          <span className="truncate text-xs font-semibold uppercase tracking-normal text-ink-muted">
            {column.label}
          </span>
        </span>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[11px] font-bold text-ink-muted ring-1 ring-slate-200 dark:ring-white/10">
          {column.tickets.length}
        </span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2 [scrollbar-color:#CBD5E1_transparent] [scrollbar-width:thin]">
        {column.tickets.length > 0 ? (
          column.tickets.map((ticket) => (
            <BoardCard
              key={ticket.id}
              agrupadoPor={agrupadoPor}
              helpers={helpers}
              onOpenAttendance={onOpenAttendance}
              onSelectTicket={onSelectTicket}
              renderers={renderers}
              ticket={ticket}
            />
          ))
        ) : (
          <p className="px-1 py-6 text-center text-[11px] text-ink-muted">
            Nada por aqui
          </p>
        )}
      </div>
    </div>
  );
}

// Cor da borda do card = a FILA (pra diferenciar a fila dentro de qualquer coluna).
function queueAccentColor(queueLabel: string): string {
  const key = queueLabel.trim().toLowerCase();

  if (key.includes("cobran")) {
    return "#A07C3B";
  }
  if (key.includes("gurgel")) {
    return "#7C3AED";
  }
  if (key.includes("jurid") || key.includes("juríd")) {
    return "#DC2626";
  }
  if (key.includes("atend")) {
    return "#2563EB";
  }

  return "#94A3B8";
}

function BoardCard({
  agrupadoPor,
  helpers,
  onOpenAttendance,
  onSelectTicket,
  ticket,
}: {
  agrupadoPor: GroupMode;
  helpers: IrisTicketQueueHelpers;
  onOpenAttendance: (ticketId: string) => void;
  onSelectTicket: (ticketId: string) => void;
  renderers: IrisTicketQueueRenderers;
  ticket: IrisBoardTicket;
}) {
  const slaCritical = helpers.isSlaCritical(ticket);
  const assigneeName = (ticket.assignedToLabel ?? "").trim();
  const handledByCaca = assigneeName === "" || assigneeName === cacaOwnerLabel;
  const isEmail = isEmailBoardTicket(ticket);
  const subject = (ticket.subject ?? "").trim();
  const crm = readBoardTicketCrm(ticket.crm360Registration);
  const lastMessageAt = helpers.formatDateTime(
    ticket.lastMessageAt ?? ticket.openedAt,
  );
  // "esperando 2h14" quando a bola é nossa; "Aguardando cliente" quando é dele; "Encerrado"
  // no fechado. Só põe o ícone de relógio quando há tempo correndo contra nós.
  const esperaLabel = helpers.slaLabel(ticket);
  const mostraCronometro = esperaLabel.startsWith("esperando");
  const statusDoCard = STATUS_FLOW.find(
    (etapa) => etapa.key === statusColumnKey(ticket, helpers),
  );

  const open = () => {
    onSelectTicket(ticket.id);
    onOpenAttendance(ticket.id);
  };

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={open}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          open();
        }
      }}
      style={{ borderLeftColor: queueAccentColor(ticket.queueLabel) }}
      className="cursor-pointer rounded-lg border border-line/70 border-l-[3px] bg-surface px-2.5 py-2 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition-colors hover:bg-subtle/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]/30"
    >
      <div className="mb-1 flex flex-wrap items-center gap-1.5">
        {isEmail ? (
          <EmailChannelChip boxLabel={emailBoxLabel(ticket.channelLabel)} size="xs" />
        ) : (
          <>
            <MessageCircle
              className="size-3.5 shrink-0 text-emerald-500"
              aria-hidden="true"
            />
            <span
              className={`rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${queueChipClasses(
                ticket.queueLabel,
              )}`}
            >
              {ticket.queueLabel}
            </span>
          </>
        )}
        <BoardProfileChip crm={crm} />
        {/* O CARD MOSTRA O QUE A COLUNA NÃO DIZ (pedido do Lucas): agrupado por operador, a
            coluna diz de quem é, mas não em que pé está. Aí a etiqueta de status vem pro card.
            Quando o agrupamento JÁ É por status, a coluna diz e a etiqueta some — repetir a
            mesma informação em dois lugares é o ruído que estamos tirando da tela. Mesma
            classificação e mesma cor do cabeçalho da coluna, pro operador reconhecer de olho. */}
        {agrupadoPor !== "status" ? <BoardStatusChip status={statusDoCard} /> : null}
        {(ticket.unreadCount ?? 0) > 0 ? (
          <span
            className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 px-1 text-[9px] font-bold tabular-nums text-white"
            aria-label={`${ticket.unreadCount} mensagens nao lidas`}
            title={`${ticket.unreadCount} nao lida(s)`}
          >
            {(ticket.unreadCount ?? 0) > 9 ? "9+" : ticket.unreadCount}
          </span>
        ) : null}
      </div>

      {ticket.protocol ? (
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[#A07C3B] tabular-nums">
          {ticket.protocol}
        </p>
      ) : null}
      <p className="truncate text-sm font-semibold text-ink">
        {helpers.ticketContactLabel(ticket)}
      </p>
      {subject ? (
        <p className="mt-0.5 truncate text-xs text-ink-muted">{subject}</p>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2">
        {/* CRONÔMETRO no card: o operador escolhe o próximo olhando para o quadro, então o
            tempo de espera precisa estar AQUI, não só dentro da conversa (pedido do Lucas).
            `esperaLabel` já vem de helpers.slaLabel, que hoje devolve "esperando 2h14" quando
            a bola é nossa e "Aguardando cliente" quando é dele. */}
        <span
          className={`inline-flex min-w-0 items-center gap-1 truncate text-[11px] tabular-nums ${
            slaCritical ? "font-semibold text-rose-500" : "text-ink-muted"
          }`}
          title={`Última mensagem: ${lastMessageAt}`}
        >
          {mostraCronometro ? (
            <Timer className="size-3 shrink-0" aria-hidden="true" />
          ) : null}
          <span className="truncate">{esperaLabel || lastMessageAt}</span>
        </span>
        <span
          className="shrink-0"
          title={handledByCaca ? "Cacá" : assigneeName}
        >
          {handledByCaca ? (
            <span className="flex size-5 items-center justify-center rounded-full bg-[#A07C3B]/10 text-[#7A5E2C]">
              <Bot className="size-3" aria-hidden="true" />
            </span>
          ) : ticket.assignedToAvatarUrl ? (
            // avatar externo (URL assinada do WhatsApp) — next/image nao se aplica
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={ticket.assignedToAvatarUrl}
              alt={assigneeName}
              className="size-5 rounded-full object-cover"
            />
          ) : (
            <span className="flex size-5 items-center justify-center rounded-full border border-line bg-subtle text-[8px] font-bold text-ink-soft">
              {operatorInitials(assigneeName)}
            </span>
          )}
        </span>
      </div>
    </article>
  );
}

// Etiqueta de status do card. Ponto colorido + texto neutro, igual ao cabeçalho da coluna: a
// cor identifica, o texto confirma. Preferi o ponto a pintar o chip inteiro porque cinco chips
// coloridos no mesmo card voltariam a ser o "tudo vermelho" que acabamos de tirar da tela — e
// porque o ponto já está provado nos dois temas, claro e escuro.
function BoardStatusChip({
  status,
}: {
  status: { accent: string; label: string } | undefined;
}) {
  if (!status) {
    return null;
  }

  return (
    <span
      className="inline-flex min-w-0 shrink items-center gap-1 rounded-full border border-line/70 bg-subtle px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-ink-soft"
      title={`Status: ${status.label}`}
    >
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: status.accent }}
        aria-hidden="true"
      />
      <span className="truncate">{status.label}</span>
    </span>
  );
}

// Em que coluna do fluxo o ticket cai (modo status) — derivado do status real,
// sem nada manual: o card anda sozinho conforme a conversa muda.
function statusColumnKey(
  ticket: IrisBoardTicket,
  helpers: IrisTicketQueueHelpers,
): string {
  if (helpers.isClosedToday(ticket)) {
    return "resolvido";
  }
  if (ticket.hasDeliveryError) {
    return "erro";
  }
  if (helpers.isCacaOwned(ticket)) {
    return "caca";
  }
  if (helpers.effectiveIrisStatus(ticket) === "waiting_customer") {
    return "aguardando";
  }

  return "pendente";
}

// O VALOR de um ticket em cada dimensão. Serve pro agrupamento (colunas) E pros filtros, pra
// os dois nunca discordarem: se a coluna diz "Cinthia", o filtro "Operador: Cinthia" tem que
// pegar exatamente os mesmos cards.
export function valorDaDimensao(
  dimensao: GroupMode,
  ticket: IrisBoardTicket,
  helpers: IrisTicketQueueHelpers,
): string {
  if (dimensao === "status") {
    const chave = statusColumnKey(ticket, helpers);

    return (
      STATUS_FLOW.find((fluxo) => fluxo.key === chave)?.label ?? "Pendente"
    );
  }

  if (dimensao === "fila") {
    if (isEmailBoardTicket(ticket)) {
      return emailBoxLabel(ticket.channelLabel);
    }

    return ticket.queueLabel || "Sem fila";
  }

  if (dimensao === "canal") {
    return helpers.formatIrisChannelLabel(ticket.channelLabel) || "Canal";
  }

  return (ticket.assignedToLabel ?? "").trim() || cacaOwnerLabel;
}

function buildColumns(
  mode: GroupMode,
  tickets: IrisBoardTicket[],
  helpers: IrisTicketQueueHelpers,
): BoardColumn[] {
  if (mode === "status") {
    return STATUS_FLOW.map((flow) => ({
      ...flow,
      tickets: tickets.filter(
        (ticket) => statusColumnKey(ticket, helpers) === flow.key,
      ),
    }));
  }

  const keyOf = (ticket: IrisBoardTicket): string => {
    if (mode === "fila") {
      // Cada caixa de e-mail é uma fila própria (Contato, Cobrança...), não a queue
      // genérica "Atendimento" do banco. Regra do Lucas.
      if (isEmailBoardTicket(ticket)) {
        return emailBoxLabel(ticket.channelLabel);
      }
      return ticket.queueLabel || "Sem fila";
    }
    if (mode === "canal") {
      return helpers.formatIrisChannelLabel(ticket.channelLabel) || "Canal";
    }
    const name = (ticket.assignedToLabel ?? "").trim();

    return name === "" ? cacaOwnerLabel : name;
  };

  const order: string[] = [];
  const grouped = new Map<string, IrisBoardTicket[]>();

  for (const ticket of tickets) {
    const key = keyOf(ticket);

    if (!grouped.has(key)) {
      grouped.set(key, []);
      order.push(key);
    }

    grouped.get(key)?.push(ticket);
  }

  return order.map((key) => ({
    accent: "#94A3B8",
    key,
    label: key,
    tickets: grouped.get(key) ?? [],
  }));
}

// Busca única: cliente, protocolo, assunto, fila, prévia, operador, perfil.
function filterTickets(
  tickets: IrisBoardTicket[],
  search: string,
  helpers: IrisTicketQueueHelpers,
): IrisBoardTicket[] {
  const query = search.trim().toLowerCase();

  if (!query) {
    return tickets;
  }

  return tickets.filter((ticket) =>
    [
      helpers.ticketContactLabel(ticket),
      ticket.protocol,
      ticket.subject ?? "",
      ticket.queueLabel,
      ticket.lastMessagePreview,
      ticket.assignedToLabel,
      ticket.profileLabel ?? "",
    ]
      .join(" ")
      .toLowerCase()
      .includes(query),
  );
}

function ticketTime(ticket: IrisBoardTicket): number {
  const value = ticket.lastMessageAt ?? ticket.openedAt;
  const time = value ? new Date(value).getTime() : 0;

  return Number.isNaN(time) ? 0 : time;
}

function sortTickets(
  tickets: IrisBoardTicket[],
  sortMode: SortMode,
  helpers: IrisTicketQueueHelpers,
): IrisBoardTicket[] {
  const list = [...tickets];

  switch (sortMode) {
    case "Mais antigos":
      return list.sort((first, second) => ticketTime(first) - ticketTime(second));
    case "SLA vencido":
      return list.sort((first, second) => {
        const firstCritical = helpers.isSlaCritical(first) ? 0 : 1;
        const secondCritical = helpers.isSlaCritical(second) ? 0 : 1;

        return (
          firstCritical - secondCritical || ticketTime(first) - ticketTime(second)
        );
      });
    case "Prioridade":
      return list.sort(
        (first, second) =>
          (PRIORITY_WEIGHT[first.priority] ?? 9) -
            (PRIORITY_WEIGHT[second.priority] ?? 9) ||
          ticketTime(second) - ticketTime(first),
      );
    case "Nome (A-Z)":
      return list.sort((first, second) =>
        helpers
          .ticketContactLabel(first)
          .localeCompare(helpers.ticketContactLabel(second)),
      );
    case "Mais recentes":
    default:
      return list.sort((first, second) => ticketTime(second) - ticketTime(first));
  }
}
