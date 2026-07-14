"use client";

import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BadgeDollarSign,
  Ban,
  ChevronRight,
  CircleDollarSign,
  ContactRound,
  Handshake,
  LandPlot,
  Layers,
  MapPinned,
  Network,
  Tag,
  TrendingUp,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Só TIPOS daqui: `empreendimentos.ts` é server-side (mysql2). Importar um valor arrastaria
// o driver do MySQL pro bundle do browser.
import type {
  ApoloEnterpriseCadastro,
  ApoloEnterprisePlayer,
  ApoloEnterpriseRow,
  ApoloEnterpriseScenario,
  ApoloEnterpriseUnit,
  ApoloEnterprisesData,
} from "@/lib/apolo/empreendimentos";
import { toTitleCase } from "@/lib/format/name-case";

import { getApoloAccessToken } from "../../data/apolo-operations";

// O papel do player NESTE empreendimento (os demais papéis dele vivem na ficha da entidade).
const playerRoleLabels: Record<ApoloEnterprisePlayer["relation"], string> = {
  captador: "Captador",
  coordenador_c2x: "Coordenador (C2X)",
  coordenador_vendas: "Coordenador de Vendas",
  incorporador: "Incorporador",
};

// Tela de Empreendimentos. Lista o cenário comercial (linha = produto consolidado pela regra
// ENTERPRISE_GROUPS; o chevron abre as etapas) e, ao CLICAR na linha, abre a ficha do
// empreendimento com abas — mesma pegada do CRM 360. Ver [[project-apolo-crm-grafo]].

type BucketKey = keyof ApoloEnterpriseScenario;

// Cores por balde (definidas pelo Lucas): vendido = azul forte, negociação = roxo.
const bucketText: Record<BucketKey, string> = {
  bloqueado: "text-rose-600 dark:text-rose-400",
  disponivel: "text-emerald-600 dark:text-emerald-400",
  negociacao: "text-violet-600 dark:text-violet-400",
  reservado: "text-amber-600 dark:text-amber-400",
  total: "text-ink",
  vendido: "text-blue-600 dark:text-blue-400",
};

const buckets: Array<{
  icon: LucideIcon;
  key: BucketKey;
  label: string;
}> = [
  { icon: Layers, key: "total", label: "Total" },
  // Disponível = lotes/unidades à venda.
  { icon: LandPlot, key: "disponivel", label: "Disponível" },
  { icon: Tag, key: "reservado", label: "Reservado" },
  { icon: Handshake, key: "negociacao", label: "Em negociação" },
  // Vendido = a venda fechada.
  { icon: BadgeDollarSign, key: "vendido", label: "Vendido" },
  { icon: Ban, key: "bloqueado", label: "Bloqueado" },
];

const detailTabs = [
  { icon: ContactRound, id: "cadastro", label: "Cadastro" },
  { icon: Layers, id: "resumo", label: "Resumo" },
  { icon: MapPinned, id: "unidades", label: "Unidades" },
  { icon: TrendingUp, id: "vendas", label: "Vendas" },
  { icon: CircleDollarSign, id: "financeiro", label: "Financeiro" },
  { icon: Network, id: "relacionamentos", label: "Relacionamentos" },
] as const;

type DetailTab = (typeof detailTabs)[number]["id"];

// O `coordenador_id` do C2X está com dado ERRADO (o MESMO player nos 24 empreendimentos), então
// a tela não o exibe — ele só viaja no payload, pro Lucas corrigir no C2X depois.
const hiddenPlayerRelations = new Set<ApoloEnterprisePlayer["relation"]>([
  "coordenador_c2x",
]);

function visiblePlayers(cadastro: ApoloEnterpriseCadastro): ApoloEnterprisePlayer[] {
  return cadastro.players.filter(
    (player) => !hiddenPlayerRelations.has(player.relation),
  );
}

export function EmpreendimentosScreen({
  data,
  error,
  loading,
  onOpenEntity,
}: {
  data: ApoloEnterprisesData | null;
  error: string | null;
  loading: boolean;
  // Abre o cadastro daquela entidade no CRM 360.
  onOpenEntity: (name: string, entityId: string) => void;
}) {
  // `detail` = ficha aberta (botão Ver mais). `selected` = linha marcada, que FILTRA os cards.
  const [detail, setDetail] = useState<ApoloEnterpriseRow | null>(null);
  const [selected, setSelected] = useState<ApoloEnterpriseRow | null>(null);

  if (loading && !data) {
    return <SkeletonScreen />;
  }

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        {error}
      </div>
    );
  }

  if (!data?.rows.length) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm font-medium text-ink-muted">
        Nenhum empreendimento encontrado.
      </div>
    );
  }

  if (detail) {
    return (
      <EnterpriseDetail
        onBack={() => setDetail(null)}
        onOpenEntity={onOpenEntity}
        row={detail}
      />
    );
  }

  const scenario = selected?.scenario ?? data.totals;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <section className="grid shrink-0 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {buckets.map((bucket) => (
          <KpiCard
            icon={bucket.icon}
            key={bucket.key}
            label={bucket.label}
            tally={scenario[bucket.key]}
            tone={bucketText[bucket.key]}
          />
        ))}
      </section>

      {/* Deixa explícito a que empreendimento os cards se referem. */}
      <div className="flex shrink-0 items-center gap-2">
        {selected ? (
          <button
            className="inline-flex items-center gap-1.5 rounded-full border border-[#A07C3B]/30 bg-[#A07C3B]/10 px-3 py-1 text-xs font-semibold text-[#7A5E2C] transition-colors hover:bg-[#A07C3B]/16 dark:text-[#d9b877]"
            onClick={() => setSelected(null)}
            type="button"
          >
            {selected.name}
            <X aria-hidden="true" className="size-3.5" />
          </button>
        ) : (
          <span className="text-xs font-medium text-ink-muted">
            Todos os empreendimentos · clique numa linha para filtrar os cards
          </span>
        )}
      </div>

      <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[900px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-line bg-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5 font-semibold">Empreendimento</th>
                <th className="px-3 py-2.5 text-right font-semibold">Unidades</th>
                <th className="px-3 py-2.5 text-right font-semibold">Disponível</th>
                <th className="px-3 py-2.5 text-right font-semibold">Reservado</th>
                <th className="px-3 py-2.5 text-right font-semibold">Negociação</th>
                <th className="px-3 py-2.5 text-right font-semibold">Vendido</th>
                <th className="px-3 py-2.5 text-right font-semibold">Bloqueado</th>
                <th className="px-3 py-2.5 text-right font-semibold">VGV</th>
                <th className="px-4 py-2.5 font-semibold" />
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <EnterpriseRows
                  key={row.id}
                  onOpen={setDetail}
                  onSelect={setSelected}
                  row={row}
                  selectedId={selected?.id ?? null}
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EnterpriseRows({
  onOpen,
  onSelect,
  row,
  selectedId,
}: {
  onOpen: (row: ApoloEnterpriseRow) => void;
  onSelect: (row: ApoloEnterpriseRow | null) => void;
  row: ApoloEnterpriseRow;
  selectedId: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasStages = row.stages.length > 0;

  // Clique marca/desmarca a linha (e os cards acima passam a mostrar esse empreendimento).
  const select = (target: ApoloEnterpriseRow) =>
    onSelect(selectedId === target.id ? null : target);

  return (
    <>
      <tr
        className={`cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-[#A07C3B]/8 ${
          selectedId === row.id
            ? "bg-[#A07C3B]/12 shadow-[inset_3px_0_0_#A07C3B]"
            : ""
        }`}
        onClick={() => select(row)}
      >
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            {hasStages ? (
              <button
                aria-label={expanded ? "Recolher etapas" : "Expandir etapas"}
                className="flex size-5 shrink-0 items-center justify-center rounded-md border border-line bg-subtle text-ink-muted transition-colors hover:border-[#A07C3B]/40 hover:text-[#7A5E2C]"
                onClick={(event) => {
                  event.stopPropagation();
                  setExpanded((value) => !value);
                }}
                type="button"
              >
                <ChevronRight
                  aria-hidden="true"
                  className={`size-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
                />
              </button>
            ) : (
              <span className="size-5 shrink-0" />
            )}
            <div className="min-w-0">
              <p className="m-0 truncate text-sm font-semibold text-ink">
                {row.name}
                {hasStages ? (
                  <span className="ml-1.5 text-[11px] font-medium text-ink-muted">
                    ({row.stages.length} etapas)
                  </span>
                ) : null}
              </p>
              <p className="m-0 truncate text-xs text-ink-muted">
                {[row.code, locationLabel(row)].filter(Boolean).join(" · ")}
              </p>
            </div>
          </div>
        </td>
        <ScenarioCells scenario={row.scenario} strong />
        <td className="px-4 py-2.5 text-right">
          <VerMaisButton onClick={() => onOpen(row)} />
        </td>
      </tr>

      {expanded
        ? row.stages.map((stage) => (
            <tr
              className={`cursor-pointer border-b border-line/70 bg-subtle/40 transition-colors last:border-b-0 hover:bg-[#A07C3B]/8 ${
                selectedId === stage.id
                  ? "bg-[#A07C3B]/12 shadow-[inset_3px_0_0_#A07C3B]"
                  : ""
              }`}
              key={stage.id}
              onClick={() => select(stage)}
            >
              <td className="px-4 py-2 pl-11">
                <p className="m-0 text-sm font-semibold tracking-wide text-ink-soft">
                  {stage.code}
                </p>
              </td>
              <ScenarioCells scenario={stage.scenario} />
              <td className="px-4 py-2 text-right">
                <VerMaisButton onClick={() => onOpen(stage)} />
              </td>
            </tr>
          ))
        : null}
    </>
  );
}

function VerMaisButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="inline-flex items-center rounded-lg border border-line bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/10 hover:text-[#7A5E2C] dark:hover:text-[#d9b877]"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      type="button"
    >
      Ver mais
    </button>
  );
}

// --- Ficha do empreendimento (abas) ---

function EnterpriseDetail({
  onBack,
  onOpenEntity,
  row,
}: {
  onBack: () => void;
  onOpenEntity: (name: string, entityId: string) => void;
  row: ApoloEnterpriseRow;
}) {
  const [tab, setTab] = useState<DetailTab>("cadastro");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <header className="flex shrink-0 items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2.5">
        <button
          aria-label="Voltar para a lista"
          className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-line bg-subtle text-ink-muted transition-colors hover:border-[#A07C3B]/30 hover:text-[#7A5E2C]"
          onClick={onBack}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="m-0 truncate text-base font-semibold text-ink">
            {row.name}
          </h2>
          <p className="m-0 truncate text-xs text-ink-muted">
            {[row.code, locationLabel(row), row.incorporador]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>

      {/* KPIs do empreendimento selecionado (os cards "filtram" pelo que foi aberto). */}
      <section className="grid shrink-0 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {buckets.map((bucket) => (
          <KpiCard
            icon={bucket.icon}
            key={bucket.key}
            label={bucket.label}
            tally={row.scenario[bucket.key]}
            tone={bucketText[bucket.key]}
          />
        ))}
      </section>

      <nav className="flex shrink-0 flex-wrap gap-1 rounded-xl border border-line bg-surface p-1">
        {detailTabs.map((item) => {
          const active = tab === item.id;

          return (
            <button
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                active
                  ? "bg-[#A07C3B]/12 text-[#7A5E2C] ring-1 ring-[#A07C3B]/25 dark:text-[#d9b877]"
                  : "text-ink-muted hover:bg-subtle hover:text-ink"
              }`}
              key={item.id}
              onClick={() => setTab(item.id)}
              type="button"
            >
              <item.icon aria-hidden="true" className="size-3.5" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <section className="min-h-0 flex-1 overflow-auto">
        {tab === "cadastro" ? <CadastroTab row={row} /> : null}
        {tab === "relacionamentos" ? (
          <RelacionamentosTab onOpenEntity={onOpenEntity} row={row} />
        ) : null}
        {tab === "resumo" ? <ResumoTab row={row} /> : null}
        {tab === "unidades" ? <UnidadesTab row={row} /> : null}
        {tab === "vendas" || tab === "financeiro" ? (
          <PendingTab label={detailTabs.find((item) => item.id === tab)?.label ?? ""} />
        ) : null}
      </section>
    </div>
  );
}

function CadastroTab({ row }: { row: ApoloEnterpriseRow }) {
  const [cadastros, setCadastros] = useState<ApoloEnterpriseCadastro[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void loadCadastros(row.codes).then((result) => {
      if (!active) {
        return;
      }

      if (result.ok) {
        setCadastros(result.cadastros);
      } else {
        setError(result.error);
      }
    });

    return () => {
      active = false;
    };
  }, [row.codes]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        {error}
      </div>
    );
  }

  if (!cadastros) {
    return <div className="h-64 animate-pulse rounded-xl border border-line bg-subtle" />;
  }

  return (
    <div className="grid gap-3">
      {cadastros.map((cadastro) => (
        <CadastroCard cadastro={cadastro} key={cadastro.code} />
      ))}
    </div>
  );
}

// Cadastro = os CAMPOS, espelhando a aba "Dados gerais" do C2X (regra do Lucas).
function CadastroCard({ cadastro }: { cadastro: ApoloEnterpriseCadastro }) {
  const playerField = (relation: ApoloEnterprisePlayer["relation"]) => {
    const found = cadastro.players.find(
      (player) => player.relation === relation,
    );

    return found ? toTitleCase(found.name) : "-";
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Dados gerais · {cadastro.code}
      </p>

      <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Incorporador" value={playerField("incorporador")} />
        <Field
          label="Coordenador de Vendas"
          value={playerField("coordenador_vendas")}
        />
        <Field label="Captador" value={playerField("captador")} />
        <Field label="Nome" value={toTitleCase(cadastro.name)} />
        <Field
          label="Nome de divulgação"
          value={toTitleCase(cadastro.divulgationName) || "-"}
        />
        <Field label="Sigla" value={cadastro.code} />
        <Field
          label="Localização"
          value={
            [toTitleCase(cadastro.city), cadastro.state]
              .filter(Boolean)
              .join("/") || "-"
          }
        />
        <Field
          label="Previsão de entrega"
          value={formatDate(cadastro.expectedDelivery)}
        />
        <Field
          label="Tipo de empreendimento"
          value={toTitleCase(cadastro.kind) || "-"}
        />
        <Field
          label="Tipo de financiamento/tabela"
          value={cadastro.tableKind ?? "-"}
        />
      </dl>
    </div>
  );
}

// Campo de leitura no estilo formulário (é o que o Lucas pediu: "no cadastro quero os campos").
function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="m-0 text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="m-0 mt-1 truncate rounded-lg border border-line bg-subtle px-3 py-2 text-sm font-semibold text-ink">
        {value}
      </dd>
    </div>
  );
}

// Relacionamentos: os dois grupos da regra do Lucas — TRABALHO (entre entidades) e CONTATO
// (leve: nome/telefone/e-mail). Aqui moram os PAPÉIS ACUMULÁVEIS (perfil do C2X + a função no
// empreendimento). Ex.: Luna = [Imobiliária] + [Gerente].
function RelacionamentosTab({
  onOpenEntity,
  row,
}: {
  onOpenEntity: (name: string, entityId: string) => void;
  row: ApoloEnterpriseRow;
}) {
  const [cadastros, setCadastros] = useState<ApoloEnterpriseCadastro[] | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    void loadCadastros(row.codes)
      .then((result) => {
        if (!active) {
          return;
        }

        if (result.ok) {
          setCadastros(result.cadastros);
        } else {
          setError(result.error);
        }
      });

    return () => {
      active = false;
    };
  }, [row.codes]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        {error}
      </div>
    );
  }

  if (!cadastros) {
    return <div className="h-64 animate-pulse rounded-xl border border-line bg-subtle" />;
  }

  return (
    <div className="grid gap-3">
      {cadastros.map((cadastro) => (
        <div
          className="rounded-xl border border-line bg-surface p-4"
          key={cadastro.code}
        >
          <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            {cadastro.code}
          </p>

          <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <div>
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#7A5E2C] dark:text-[#d9b877]">
                Trabalho
              </p>
              <div className="mt-2 grid gap-2">
                {visiblePlayers(cadastro).length ? (
                  visiblePlayers(cadastro).map((player) => (
                    <PlayerCard
                      key={player.relation}
                      onOpenEntity={onOpenEntity}
                      player={player}
                    />
                  ))
                ) : (
                  <p className="m-0 text-sm font-medium text-ink-muted">
                    Nenhum vínculo de trabalho.
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.1em] text-[#8a4526] dark:text-[#d59f7f]">
                Contato
              </p>
              <div className="mt-2">
                {cadastro.focalName || cadastro.focalPhone || cadastro.focalEmail ? (
                  <div className="rounded-lg border border-line bg-subtle px-3 py-2">
                    <p className="m-0 truncate text-sm font-semibold text-ink">
                      {toTitleCase(cadastro.focalName) || "-"}
                    </p>
                    <p className="m-0 mt-0.5 text-xs text-ink-muted">
                      {cadastro.focalPhone ?? "-"}
                    </p>
                    <p className="m-0 truncate text-xs text-ink-muted">
                      {cadastro.focalEmail ?? "-"}
                    </p>
                  </div>
                ) : (
                  <p className="m-0 text-sm font-medium text-ink-muted">
                    Sem contato informado.
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// Card de player: mesmo formato do Contato (nome / telefone / e-mail) + SÓ o papel dele neste
// empreendimento. Os demais papéis da entidade vivem na ficha dela — por isso o card leva pro
// cadastro dela no CRM.
function PlayerCard({
  onOpenEntity,
  player,
}: {
  onOpenEntity: (name: string, entityId: string) => void;
  player: ApoloEnterprisePlayer;
}) {
  return (
    <button
      className="w-full rounded-lg border border-line bg-subtle px-3 py-2 text-left transition-colors hover:border-[#A07C3B]/40 hover:bg-[#A07C3B]/8"
      onClick={() => onOpenEntity(player.name, player.entityId)}
      title="Abrir cadastro da entidade no CRM"
      type="button"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="m-0 min-w-0 truncate text-sm font-semibold text-ink">
          {toTitleCase(player.name)}
        </p>
        <span className="shrink-0 rounded-full border border-[#A07C3B]/25 bg-[#A07C3B]/10 px-2 py-0.5 text-[10px] font-semibold text-[#7A5E2C] dark:text-[#d9b877]">
          {playerRoleLabels[player.relation]}
        </span>
      </div>
      {player.document ? (
        <p className="m-0 mt-0.5 text-xs font-medium text-ink-soft">
          {player.document}
        </p>
      ) : null}
      <p className="m-0 text-xs text-ink-muted">{player.phone ?? "-"}</p>
      <p className="m-0 truncate text-xs text-ink-muted">{player.email ?? "-"}</p>
      {player.address ? (
        <p className="m-0 truncate text-xs text-ink-muted">
          {toTitleCase(player.address)}
        </p>
      ) : null}
    </button>
  );
}

// Fetch compartilhado (Cadastro e Relacionamentos leem a mesma ficha do C2X).
async function loadCadastros(
  codes: string[],
): Promise<
  { cadastros: ApoloEnterpriseCadastro[]; ok: true } | { error: string; ok: false }
> {
  try {
    const accessToken = await getApoloAccessToken();
    const response = await fetch(
      `/api/apolo/empreendimentos/cadastro?codes=${encodeURIComponent(codes.join(","))}`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const payload = (await response.json()) as {
      data?: { cadastros: ApoloEnterpriseCadastro[] };
      error?: string;
    };

    if (!response.ok || !payload.data) {
      throw new Error(payload.error ?? "Nao foi possivel carregar o cadastro.");
    }

    return { cadastros: payload.data.cadastros, ok: true };
  } catch (error) {
    return {
      error:
        error instanceof Error ? error.message : "Falha ao carregar o cadastro.",
      ok: false,
    };
  }
}

function ResumoTab({ row }: { row: ApoloEnterpriseRow }) {
  const sold = row.scenario.vendido;
  const total = row.scenario.total;
  const soldShare = total.units ? (sold.units / total.units) * 100 : 0;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Comercial
        </p>
        <p className="m-0 mt-2 text-2xl font-semibold tabular-nums text-ink">
          {soldShare.toFixed(1)}%
          <span className="ml-2 text-sm font-medium text-ink-muted">vendido</span>
        </p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-subtle">
          <div
            className="h-full rounded-full bg-blue-600 dark:bg-blue-500"
            style={{ width: `${Math.min(soldShare, 100)}%` }}
          />
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <Fact label="VGV total" value={formatCurrency(total.value)} />
          <Fact label="Vendido" value={formatCurrency(sold.value)} />
          <Fact
            label="Disponível"
            value={formatCurrency(row.scenario.disponivel.value)}
          />
          <Fact
            label="Em negociação"
            value={formatCurrency(row.scenario.negociacao.value)}
          />
        </dl>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
          Empreendimento
        </p>
        <dl className="mt-2 grid gap-2 text-sm">
          <Fact label="Código" value={row.code} />
          <Fact label="Localização" value={locationLabel(row) || "-"} />
          <Fact label="Incorporador" value={row.incorporador ?? "Não informado"} />
          <Fact
            label="Etapas"
            value={row.stages.length ? String(row.stages.length) : "1"}
          />
        </dl>
      </div>
    </div>
  );
}

function UnidadesTab({ row }: { row: ApoloEnterpriseRow }) {
  const [units, setUnits] = useState<ApoloEnterpriseUnit[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setError(null);

        const accessToken = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/empreendimentos/unidades?codes=${encodeURIComponent(row.codes.join(","))}`,
          {
            cache: "no-store",
            headers: { Authorization: `Bearer ${accessToken}` },
          },
        );
        const payload = (await response.json()) as {
          data?: { units: ApoloEnterpriseUnit[] };
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Nao foi possivel carregar as unidades.");
        }

        if (active) {
          setUnits(payload.data.units);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Falha ao carregar as unidades.",
          );
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [row.codes]);

  if (error) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
        {error}
      </div>
    );
  }

  if (!units) {
    return <div className="h-64 animate-pulse rounded-xl border border-line bg-subtle" />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-line bg-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <th className="px-4 py-2.5">Unidade</th>
              <th className="px-3 py-2.5">Etapa</th>
              <th className="px-3 py-2.5 text-right">Área</th>
              <th className="px-3 py-2.5 text-right">Preço</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <tr
                className="border-b border-line/70 last:border-b-0 hover:bg-subtle/50"
                key={unit.id}
              >
                <td className="px-4 py-2 font-medium text-ink">
                  {unitLabel(unit)}
                </td>
                <td className="px-3 py-2 text-ink-muted">{unit.enterpriseCode}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink-soft">
                  {unit.area ? `${unit.area.toLocaleString("pt-BR")} m²` : "-"}
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium text-ink">
                  {formatCurrency(unit.price)}
                </td>
                <td className="px-4 py-2">
                  <UnitStatusPill unit={unit} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {units.length === 0 ? (
        <p className="m-0 p-6 text-center text-sm font-medium text-ink-muted">
          Nenhuma unidade cadastrada.
        </p>
      ) : null}
    </div>
  );
}

function UnitStatusPill({ unit }: { unit: ApoloEnterpriseUnit }) {
  const tone = {
    bloqueado:
      "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300",
    disponivel:
      "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300",
    negociacao:
      "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/12 dark:text-violet-300",
    reservado:
      "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300",
    vendido:
      "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/12 dark:text-blue-300",
  }[unit.bucket];

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}
    >
      {unit.status}
    </span>
  );
}

function PendingTab({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-surface p-8 text-center">
      <p className="m-0 text-sm font-semibold text-ink">{label}</p>
      <p className="m-0 mt-1 text-sm font-medium text-ink-muted">
        Próximo passo. Vendas e Financeiro saem de acquisition_requests e payments;
        Relacionamentos é onde o corretor vai nascer.
      </p>
    </div>
  );
}

// --- compartilhados ---

function ScenarioCells({
  scenario,
  strong = false,
}: {
  scenario: ApoloEnterpriseScenario;
  strong?: boolean;
}) {
  const weight = strong ? "font-semibold text-ink" : "font-medium text-ink-soft";

  return (
    <>
      <td className={`px-3 py-2.5 text-right tabular-nums ${weight}`}>
        {scenario.total.units}
      </td>
      <td
        className={`px-3 py-2.5 text-right font-medium tabular-nums ${bucketText.disponivel}`}
      >
        {scenario.disponivel.units}
      </td>
      <td
        className={`px-3 py-2.5 text-right font-medium tabular-nums ${bucketText.reservado}`}
      >
        {scenario.reservado.units}
      </td>
      <td
        className={`px-3 py-2.5 text-right font-medium tabular-nums ${bucketText.negociacao}`}
      >
        {scenario.negociacao.units}
      </td>
      <td
        className={`px-3 py-2.5 text-right font-bold tabular-nums ${bucketText.vendido}`}
      >
        {scenario.vendido.units}
      </td>
      <td
        className={`px-3 py-2.5 text-right font-medium tabular-nums ${bucketText.bloqueado}`}
      >
        {scenario.bloqueado.units}
      </td>
      <td className={`px-3 py-2.5 text-right tabular-nums ${weight}`}>
        {formatCurrency(scenario.total.value)}
      </td>
    </>
  );
}

function KpiCard({
  icon: Icon,
  label,
  tally,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  tally: { units: number; value: number };
  tone: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <div className="flex items-start justify-between gap-2">
        <span
          className={`flex size-8 items-center justify-center rounded-lg border border-line bg-subtle ${tone}`}
        >
          <Icon aria-hidden="true" className="size-4" />
        </span>
        <span className="rounded-full border border-line bg-subtle px-2 py-0.5 text-[10px] font-semibold tabular-nums text-ink-muted">
          {tally.units} unid.
        </span>
      </div>
      <p className="m-0 mt-2.5 truncate text-lg font-semibold tabular-nums text-ink">
        {formatCurrency(tally.value)}
      </p>
      <p className="m-0 text-xs font-medium text-ink-muted">{label}</p>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="m-0 text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="m-0 mt-0.5 text-sm font-semibold text-ink">{value}</dd>
    </div>
  );
}

function SkeletonScreen() {
  return (
    <div className="grid gap-3">
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, index) => (
          <div
            className="h-[92px] animate-pulse rounded-xl border border-line bg-subtle"
            key={index}
          />
        ))}
      </div>
      <div className="h-80 animate-pulse rounded-xl border border-line bg-subtle" />
    </div>
  );
}

function unitLabel(unit: ApoloEnterpriseUnit): string {
  const parts = [
    unit.block ? `Q${unit.block}` : null,
    unit.lot ? `L${unit.lot}` : null,
  ].filter(Boolean);

  return parts.length ? parts.join(" · ") : (unit.name ?? `Unidade ${unit.id}`);
}

function locationLabel(row: ApoloEnterpriseRow): string {
  return [row.city, row.state].filter(Boolean).join("/");
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(value);
}

function formatDate(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}
