"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  BadgeDollarSign,
  Ban,
  ChevronRight,
  ContactRound,
  ExternalLink,
  FileText,
  Handshake,
  ImagePlus,
  LandPlot,
  Layers,
  Loader2,
  MapPinned,
  Network,
  Search,
  Tag,
  TrendingUp,
  WalletCards,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Só TIPOS daqui: `empreendimentos.ts` é server-side (mysql2). Importar um valor arrastaria
// o driver do MySQL pro bundle do browser.
import type {
  ApoloEnterpriseBucket,
  ApoloEnterpriseCadastro,
  ApoloEnterprisePlayer,
  ApoloEnterpriseRow,
  ApoloEnterpriseScenario,
  ApoloEnterpriseTab,
  ApoloEnterpriseUnit,
  ApoloEnterprisesData,
  ApoloUnitMovement,
  ApoloUnitParty,
} from "@/lib/apolo/empreendimentos";
import type {
  ApoloCarteiraData,
  ApoloCarteiraUnit,
  ApoloInstallmentStatus,
  ApoloUnitInstallment,
} from "@/lib/apolo/carteira";
import type {
  ApoloCobrancaMoney,
  ApoloCobrancaStage,
  ApoloEnterpriseCobranca,
  ApoloUnitCobranca,
} from "@/lib/apolo/cobranca";
import type { GuardianCompromissoDetail } from "@/lib/guardian/compromissos";
import type {
  ApoloEnterpriseVendas,
  ApoloVendaMovement,
  ApoloVendaProposta,
  ApoloVendaStage,
  ApoloVendaTerminal,
  ApoloVendaTerminalItem,
  ApoloVendaUnit,
} from "@/lib/apolo/vendas";
import { toTitleCase } from "@/lib/format/name-case";

import { getApoloAccessToken } from "../../data/apolo-operations";
import { fileToBase64 } from "../../lib/document-capture";

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

// Ordem definida pelo Lucas.
const detailTabs = [
  { icon: Layers, id: "resumo", label: "Resumo" },
  { icon: ContactRound, id: "cadastro", label: "Cadastro" },
  { icon: MapPinned, id: "unidades", label: "Unidades" },
  { icon: TrendingUp, id: "vendas", label: "Vendas" },
  // "Carteira" com o ícone de carteira do Hades (WalletCards).
  { icon: WalletCards, id: "carteira", label: "Carteira" },
  { icon: Network, id: "relacionamentos", label: "Relacionamentos" },
] as const;

// A aba é controlada pelo ApoloPage (o tipo canônico mora no lib).
type DetailTab = ApoloEnterpriseTab;

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
  detail,
  error,
  loading,
  onDetailChange,
  onOpenEntity,
  onTabChange,
  tab,
}: {
  data: ApoloEnterprisesData | null;
  // Ficha aberta (botão "Ver mais"). Vive no ApoloPage pra sobreviver à ida ao CRM — assim o
  // "voltar" traz o usuário de volta pro empreendimento (e pra ABA) onde ele estava.
  detail: ApoloEnterpriseRow | null;
  error: string | null;
  loading: boolean;
  onDetailChange: (row: ApoloEnterpriseRow | null) => void;
  // Abre o cadastro daquela entidade no CRM 360.
  onOpenEntity: (name: string, entityId: string) => void;
  onTabChange: (tab: DetailTab) => void;
  tab: DetailTab;
}) {
  // `selected` = linha marcada, que FILTRA os cards.
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
        onBack={() => onDetailChange(null)}
        onOpenEntity={onOpenEntity}
        onTabChange={onTabChange}
        row={detail}
        tab={tab}
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
            {toTitleCase(selected.name)}
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
                  onOpen={onDetailChange}
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
      {/* 1 clique = seleciona (filtra os cards); 2 cliques = abre a ficha. */}
      <tr
        className={`cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-[#A07C3B]/8 ${
          selectedId === row.id
            ? "bg-[#A07C3B]/12 shadow-[inset_3px_0_0_#A07C3B]"
            : ""
        }`}
        onClick={() => select(row)}
        onDoubleClick={() => onOpen(row)}
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
                {toTitleCase(row.name)}
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
              onDoubleClick={() => onOpen(stage)}
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
  onTabChange,
  row,
  tab,
}: {
  onBack: () => void;
  onOpenEntity: (name: string, entityId: string) => void;
  onTabChange: (tab: DetailTab) => void;
  row: ApoloEnterpriseRow;
  tab: DetailTab;
}) {
  const setTab = onTabChange;

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
            {toTitleCase(row.name)}
          </h2>
          <p className="m-0 truncate text-xs text-ink-muted">
            {[row.code, locationLabel(row), toTitleCase(row.incorporador)]
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

      <nav className="flex shrink-0 flex-wrap gap-1.5 rounded-xl border border-line bg-subtle/70 p-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {detailTabs.map((item) => {
          const active = tab === item.id;

          return (
            <button
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors ${
                active
                  ? "bg-[#A07C3B] text-white shadow-sm dark:bg-[#A07C3B] dark:text-white"
                  : "text-ink-soft hover:bg-surface hover:text-ink"
              }`}
              key={item.id}
              onClick={() => setTab(item.id)}
              type="button"
            >
              <item.icon aria-hidden="true" className="size-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      {/* Em Unidades quem rola é a PRÓPRIA tabela (pra o cabeçalho sticky grudar). Se este
          <section> rolasse, o thead ficaria preso a um container que nunca rola. */}
      <section
        className={
          tab === "unidades"
            ? "flex min-h-0 flex-1 flex-col overflow-hidden"
            : "min-h-0 flex-1 overflow-auto"
        }
      >
        {tab === "cadastro" ? <CadastroTab row={row} /> : null}
        {tab === "relacionamentos" ? (
          <RelacionamentosTab onOpenEntity={onOpenEntity} row={row} />
        ) : null}
        {tab === "resumo" ? <ResumoTab row={row} /> : null}
        {tab === "unidades" ? (
          <UnidadesTab onOpenEntity={onOpenEntity} row={row} />
        ) : null}
        {tab === "carteira" ? (
          <CarteiraTab onOpenEntity={onOpenEntity} row={row} />
        ) : null}
        {tab === "vendas" ? (
          <VendasTab onOpenEntity={onOpenEntity} row={row} />
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

  // A logo fica FORA do early-return do cadastro: o C2X às vezes cai/demora, e mesmo assim o
  // operador precisa conseguir subir a imagem.
  return (
    <div className="grid gap-3">
      <CredenciamentoCard code={row.code} enterpriseId={row.id} name={row.name} />

      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-5 text-sm font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
          {error}
        </div>
      ) : !cadastros ? (
        <div className="h-64 animate-pulse rounded-xl border border-line bg-subtle" />
      ) : (
        cadastros.map((cadastro) => (
          <CadastroCard cadastro={cadastro} key={cadastro.code} />
        ))
      )}
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

// --- Logos dos empreendimentos (subidas pelo operador; ficam no bucket do Apolo) ---

async function fetchEnterpriseLogos(): Promise<Record<string, string>> {
  try {
    const accessToken = await getApoloAccessToken();
    const response = await fetch("/api/apolo/empreendimentos/logo", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await response.json()) as { data?: { logos?: Record<string, string> } };
    return payload.data?.logos ?? {};
  } catch {
    return {};
  }
}

// Settings do empreendimento (hoje só o flag de credenciamento ativo).
async function fetchEnterpriseAtivo(enterpriseId: string): Promise<boolean> {
  try {
    const accessToken = await getApoloAccessToken();
    const response = await fetch("/api/apolo/empreendimentos/settings", {
      cache: "no-store",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const payload = (await response.json()) as {
      data?: { settings?: Record<string, { credenciamentoAtivo?: boolean }> };
    };
    return Boolean(payload.data?.settings?.[enterpriseId]?.credenciamentoAtivo);
  } catch {
    return false;
  }
}

async function postEnterpriseAtivo(
  enterpriseId: string,
  ativo: boolean,
  code: string,
): Promise<{ error?: string; ok: boolean }> {
  try {
    const accessToken = await getApoloAccessToken();
    const response = await fetch("/api/apolo/empreendimentos/settings", {
      body: JSON.stringify({ ativo, code, enterpriseId }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) return { error: payload.error ?? "Falha ao salvar.", ok: false };
    return { ok: true };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao salvar.", ok: false };
  }
}

async function uploadEnterpriseLogo(
  enterpriseId: string,
  file: File,
): Promise<{ error?: string; ok: boolean; url?: string }> {
  try {
    const fileBase64 = await fileToBase64(file);
    const accessToken = await getApoloAccessToken();
    const response = await fetch("/api/apolo/empreendimentos/logo", {
      body: JSON.stringify({ contentType: file.type || "image/png", enterpriseId, fileBase64 }),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json()) as { data?: { url?: string }; error?: string };
    if (!response.ok) return { error: payload.error ?? "Falha ao enviar a logo.", ok: false };
    return { ok: true, url: payload.data?.url };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Falha ao enviar a logo.", ok: false };
  }
}

// Credenciamento de imobiliárias, DENTRO do cadastro do empreendimento (decisão do Lucas
// 18/jul). Duas coisas moram aqui, porque as duas alimentam o portal enviado às imobiliárias:
//  1) o flag "na ativa" (recebendo CAD/credenciamento) — o portal só oferece os ATIVOS;
//  2) a logo — o C2X guarda em ActiveStorage (difícil de extrair read-only), então o operador
//     sobe aqui. Uma logo por empreendimento (upsert).
function CredenciamentoCard({
  code,
  enterpriseId,
  name,
}: {
  code: string;
  enterpriseId: string;
  name: string;
}) {
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [ativo, setAtivo] = useState(false);
  const [salvandoAtivo, setSalvandoAtivo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let alive = true;
    void fetchEnterpriseLogos().then((map) => {
      if (alive) setLogoUrl(map[enterpriseId] ?? null);
    });
    void fetchEnterpriseAtivo(enterpriseId).then((value) => {
      if (alive) setAtivo(value);
    });
    return () => {
      alive = false;
    };
  }, [enterpriseId]);

  async function alternarAtivo() {
    const proximo = !ativo;
    setErro(null);
    setSalvandoAtivo(true);
    setAtivo(proximo); // otimista
    const result = await postEnterpriseAtivo(enterpriseId, proximo, code);
    setSalvandoAtivo(false);
    if (!result.ok) {
      setAtivo(!proximo); // desfaz
      setErro(result.error ?? "Falha ao salvar.");
    }
  }

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setErro(null);
    setBusy(true);
    const result = await uploadEnterpriseLogo(enterpriseId, file);
    setBusy(false);
    if (result.ok && result.url) {
      setLogoUrl(result.url);
      return;
    }
    setErro(result.error ?? "Falha ao enviar a logo.");
  }

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Credenciamento de imobiliárias
      </p>

      {/* Flag "na ativa": define se o empreendimento aparece no portal das imobiliárias. */}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-subtle/50 px-3 py-2.5">
        <div className="min-w-0">
          <p className="m-0 text-sm font-medium text-ink">
            Recebendo credenciamento
            <span
              className={`ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                ativo
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
                  : "bg-subtle text-ink-muted"
              }`}
            >
              {ativo ? "Na ativa" : "Encerrado"}
            </span>
          </p>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            Ligado, este empreendimento aparece no portal para as imobiliárias solicitarem
            habilitação e recebe novas CADs.
          </p>
        </div>
        <button
          aria-checked={ativo}
          aria-label="Recebendo credenciamento"
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-60 ${
            ativo ? "bg-inverse" : "bg-line-strong"
          }`}
          disabled={salvandoAtivo}
          onClick={() => void alternarAtivo()}
          role="switch"
          type="button"
        >
          <span
            className={`inline-block size-4 rounded-full bg-white shadow transition-transform ${
              ativo ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <p className="m-0 mt-4 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        Logo do empreendimento
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-4">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-line-strong bg-subtle">
          {busy ? (
            <Loader2 aria-hidden="true" className="size-5 animate-spin text-ink-muted" />
          ) : logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt={`Logo ${name}`} className="size-full object-contain p-2" src={logoUrl} />
          ) : (
            <ImagePlus aria-hidden="true" className="size-6 text-ink-muted" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="m-0 text-sm font-medium text-ink">
            {logoUrl ? "Logo enviada" : "Nenhuma logo enviada"}
          </p>
          <p className="m-0 mt-0.5 text-xs text-ink-muted">
            PNG, JPG, WEBP ou SVG, até 3MB. Usada no portal de credenciamento das imobiliárias.
          </p>
          <button
            className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-lg bg-inverse px-4 text-sm font-semibold text-brand-ink transition-colors hover:bg-inverse/90 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={busy}
            onClick={() => inputRef.current?.click()}
            type="button"
          >
            <ImagePlus aria-hidden="true" className="size-3.5" />
            {logoUrl ? "Trocar logo" : "Enviar logo"}
          </button>
          {erro ? (
            <p className="m-0 mt-2 text-xs font-medium text-rose-600 dark:text-rose-300">{erro}</p>
          ) : null}
        </div>
      </div>

      <input
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        className="hidden"
        onChange={(event) => {
          void handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />
    </div>
  );
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

function UnidadesTab({
  onOpenEntity,
  row,
}: {
  onOpenEntity: (name: string, entityId: string) => void;
  row: ApoloEnterpriseRow;
}) {
  const [units, setUnits] = useState<ApoloEnterpriseUnit[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<UnitFilter>("todos");
  const [sort, setSort] = useState<UnitSort>({
    column: "codigo",
    direction: "asc",
  });

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

  const visible = sortUnits(filterUnits(units, search, statusFilter), sort);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {/* Filtro + busca */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-[240px] flex-1 items-center gap-2 rounded-lg border border-line bg-surface px-3">
          <Search aria-hidden="true" className="size-4 text-ink-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar código, quadra/lote, matrícula, cliente..."
            value={search}
          />
        </label>
        <select
          className="h-9 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink outline-none"
          onChange={(event) => setStatusFilter(event.target.value as UnitFilter)}
          value={statusFilter}
        >
          <option value="todos">Todos os status</option>
          <option value="disponivel">Disponível</option>
          <option value="reservado">Reservado</option>
          <option value="negociacao">Em negociação</option>
          <option value="vendido">Vendido</option>
          <option value="bloqueado">Bloqueado</option>
        </select>
        <span className="text-xs font-medium text-ink-muted">
          {visible.length} de {units.length}
        </span>
      </div>

      {/* Cabeçalho TRAVADO: só os dados rolam. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-line bg-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <SortableHead
                  column="codigo"
                  label="Unidade"
                  onSort={setSort}
                  sort={sort}
                />
                <SortableHead
                  column="quadra"
                  label="Quadra / Lote"
                  onSort={setSort}
                  sort={sort}
                />
                <SortableHead
                  column="matricula"
                  label="Matrícula"
                  onSort={setSort}
                  sort={sort}
                />
                <SortableHead
                  align="right"
                  column="valor"
                  label="Valor de tabela"
                  onSort={setSort}
                  sort={sort}
                />
                <SortableHead
                  column="status"
                  label="Status da venda"
                  onSort={setSort}
                  sort={sort}
                />
                <th className="px-4 py-2.5">Última movimentação</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((unit) => (
                <tr
                  className="border-b border-line/70 last:border-b-0 hover:bg-subtle/50"
                  key={unit.id}
                >
                  {/* Código em destaque; o tipo vira o subtítulo. */}
                  <td className="px-4 py-2">
                    <p className="m-0 text-sm font-semibold tabular-nums text-ink">
                      {unit.code}
                    </p>
                    <p className="m-0 text-xs text-ink-muted">
                      {toTitleCase(unit.kind) || "Unidade"}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    <p className="m-0 text-sm font-semibold tabular-nums text-ink">
                      {[unit.block, unit.lot].filter(Boolean).join(" / ") || "-"}
                    </p>
                    <p className="m-0 text-xs tabular-nums text-ink-muted">
                      {unit.area
                        ? `${unit.area.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`
                        : "-"}
                    </p>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-soft">
                    {unit.registration ?? "-"}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-ink">
                    {formatCurrency(unit.price)}
                  </td>
                  <td className="px-3 py-2">
                    <UnitStatusPill unit={unit} />
                  </td>
                  <td className="px-4 py-2">
                    <UnitMovement
                      movement={unit.movement}
                      onOpenEntity={onOpenEntity}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visible.length === 0 ? (
          <p className="m-0 p-6 text-center text-sm font-medium text-ink-muted">
            Nenhuma unidade encontrada.
          </p>
        ) : null}
      </div>
    </div>
  );
}

type UnitFilter = "todos" | ApoloEnterpriseBucket;
type UnitSortColumn =
  | "codigo"
  | "matricula"
  | "quadra"
  | "status"
  | "valor";
type UnitSort = { column: UnitSortColumn; direction: "asc" | "desc" };

function SortableHead({
  align = "left",
  column,
  label,
  onSort,
  sort,
}: {
  align?: "left" | "right";
  column: UnitSortColumn;
  label: string;
  onSort: (sort: UnitSort) => void;
  sort: UnitSort;
}) {
  const active = sort.column === column;

  return (
    <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""}`}>
      <button
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink ${
          active ? "text-ink" : ""
        }`}
        onClick={() =>
          onSort({
            column,
            direction:
              active && sort.direction === "asc" ? "desc" : "asc",
          })
        }
        type="button"
      >
        {label}
        <ArrowUpDown
          aria-hidden="true"
          className={`size-3 ${active ? "text-[#A07C3B]" : "opacity-40"}`}
        />
      </button>
    </th>
  );
}

function filterUnits(
  units: ApoloEnterpriseUnit[],
  search: string,
  status: UnitFilter,
): ApoloEnterpriseUnit[] {
  const query = search.trim().toLowerCase();

  return units.filter((unit) => {
    if (status !== "todos" && unit.bucket !== status) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      unit.code,
      unit.block,
      unit.lot,
      unit.registration,
      unit.movement?.client?.name,
      unit.movement?.client?.code,
      unit.movement?.imobiliaria?.name,
      unit.movement?.imobiliaria?.code,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function sortUnits(
  units: ApoloEnterpriseUnit[],
  sort: UnitSort,
): ApoloEnterpriseUnit[] {
  const factor = sort.direction === "asc" ? 1 : -1;

  return [...units].sort((left, right) => {
    if (sort.column === "valor") {
      return (left.price - right.price) * factor;
    }

    const value = (unit: ApoloEnterpriseUnit) =>
      sort.column === "codigo"
        ? unit.code
        : sort.column === "matricula"
          ? (unit.registration ?? "")
          : sort.column === "status"
            ? unit.status
            : `${unit.block ?? ""}/${unit.lot ?? ""}`;

    return (
      value(left).localeCompare(value(right), "pt-BR", { numeric: true }) * factor
    );
  });
}

// A última movimentação amarra COMPRADOR + IMOBILIÁRIA àquela unidade. Ambos são clicáveis:
// levam à ficha da entidade no CRM (por identidade, não por nome).
function UnitMovement({
  movement,
  onOpenEntity,
}: {
  movement: ApoloUnitMovement | null;
  onOpenEntity: (name: string, entityId: string) => void;
}) {
  if (!movement?.client && !movement?.imobiliaria) {
    return <span className="text-xs text-ink-muted">Sem movimentação</span>;
  }

  return (
    <div className="min-w-0">
      {movement.client ? (
        <PartyLink onOpenEntity={onOpenEntity} party={movement.client} strong />
      ) : null}
      {movement.imobiliaria ? (
        <PartyLink onOpenEntity={onOpenEntity} party={movement.imobiliaria} />
      ) : null}
    </div>
  );
}

function PartyLink({
  onOpenEntity,
  party,
  strong = false,
}: {
  onOpenEntity: (name: string, entityId: string) => void;
  party: ApoloUnitParty;
  strong?: boolean;
}) {
  return (
    <button
      className={`block max-w-[280px] truncate text-left text-xs transition-colors hover:underline ${
        strong ? "text-ink" : "text-ink-muted hover:text-ink"
      }`}
      onClick={() => onOpenEntity(party.name, party.entityId)}
      title="Abrir cadastro no CRM"
      type="button"
    >
      {/* O peso vai num span: o reset global `button { font: inherit }` (não-camada)
          anula font-bold aplicado direto no <button>. */}
      <span className={strong ? "font-bold" : undefined}>
        {party.code ? `${party.code} · ` : ""}
        {toTitleCase(party.name)}
      </span>
    </button>
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

// Carteira financeira do empreendimento: espelha o cenário do Hades (cards) + a visão NOVA por
// UNIDADE (o Hades é por comprador). Ver [[project-apolo-crm-grafo]].
// --- Vendas: funil por estágio + tabela por unidade ---

const VENDA_STAGE_ORDER: ApoloVendaStage[] = [
  "disponivel",
  "reservado",
  "proposta",
  "contrato",
  "assinatura",
  "faturado",
];

const VENDA_STAGE_LABELS: Record<ApoloVendaStage, string> = {
  assinatura: "Em assinatura",
  contrato: "Contrato gerado",
  disponivel: "Disponível",
  faturado: "Faturado",
  proposta: "Proposta emitida",
  reservado: "Reservado",
};

const VENDA_TERMINAL_LABELS: Record<ApoloVendaTerminal, string> = {
  cancelado: "Cancelado",
  distrato: "Distrato",
};

const VENDA_STAGE_PILL: Record<ApoloVendaStage, string> = {
  assinatura:
    "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/12 dark:text-blue-300",
  contrato:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/12 dark:text-violet-300",
  disponivel: "border-line bg-subtle text-ink-soft",
  faturado:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300",
  proposta:
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-300",
  reservado:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300",
};

function VendasTab({
  onOpenEntity,
  row,
}: {
  onOpenEntity: (name: string, entityId: string) => void;
  row: ApoloEnterpriseRow;
}) {
  const [data, setData] = useState<ApoloEnterpriseVendas | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [detailUnit, setDetailUnit] = useState<ApoloVendaUnit | null>(null);
  const [terminalModal, setTerminalModal] = useState<ApoloVendaTerminal | null>(
    null,
  );

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setError(null);

        const accessToken = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/empreendimentos/vendas?codes=${encodeURIComponent(row.codes.join(","))}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json()) as {
          data?: ApoloEnterpriseVendas;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Nao foi possivel carregar as vendas.");
        }

        if (active) {
          setData(payload.data);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Falha ao carregar as vendas.",
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

  if (!data) {
    return <div className="h-72 animate-pulse rounded-xl border border-line bg-subtle" />;
  }

  const totalVgv = data.funnel.reduce((sum, bucket) => sum + bucket.vgv, 0);
  const disponivel = data.funnel.find((bucket) => bucket.stage === "disponivel");
  const query = search.trim().toLowerCase();
  const matches = (unit: ApoloVendaUnit) =>
    !query ||
    [unit.code, unit.client?.name, unit.imobiliaria?.name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  const movements = query
    ? data.movements.filter((movement) =>
        [movement.code, movement.client, movement.imobiliaria]
          .filter(Boolean)
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
    : data.movements;

  return (
    <div className="grid gap-3">
      {/* Topo: total + busca. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-sm font-semibold text-ink">
          Pipeline de vendas
          <span className="ml-1.5 text-xs font-medium text-ink-muted">
            {data.totalUnits} unidades · VGV {formatCurrency(totalVgv)}
          </span>
        </p>
        <label className="flex h-9 min-w-[220px] items-center gap-2 rounded-lg border border-line bg-subtle px-3">
          <Search aria-hidden="true" className="size-4 text-ink-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Unidade, cliente, imobiliária..."
            value={search}
          />
        </label>
      </div>

      {/* Board (colunas por estágio, sem Disponível) + movimentação ao lado. */}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0">
          <div className="overflow-x-auto pb-1">
            <div className="flex gap-2">
              {VENDA_STAGE_ORDER.filter((stage) => stage !== "disponivel").map(
                (stage) => (
                  <KanbanColumn
                    key={stage}
                    onOpenUnit={setDetailUnit}
                    stage={stage}
                    units={data.units.filter(
                      (unit) => unit.stage === stage && matches(unit),
                    )}
                  />
                ),
              )}
            </div>
          </div>
          {/* Estoque + terminais (por proposta), cluster à parte. */}
          <div className="mt-2 flex flex-wrap gap-2">
            {disponivel && disponivel.units > 0 ? (
              <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-1.5">
                <span className="text-xs font-semibold text-ink-soft">Disponível</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {disponivel.units}
                </span>
              </div>
            ) : null}
            {data.terminals.map((terminal) => (
              <button
                className="inline-flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50/60 px-3 py-1.5 transition-colors hover:bg-rose-100/70 disabled:cursor-default disabled:opacity-60 dark:border-rose-500/30 dark:bg-rose-500/10 dark:hover:bg-rose-500/20"
                disabled={terminal.proposals === 0}
                key={terminal.terminal}
                onClick={() => setTerminalModal(terminal.terminal)}
                title="Ver as propostas"
                type="button"
              >
                <span className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                  {VENDA_TERMINAL_LABELS[terminal.terminal]}
                </span>
                <span className="text-sm font-semibold tabular-nums text-rose-700 dark:text-rose-300">
                  {terminal.proposals}
                </span>
                <span className="text-[11px] text-ink-muted">propostas</span>
              </button>
            ))}
            {data.bloqueadas.units > 0 ? (
              <div className="inline-flex items-center gap-2 rounded-lg border border-line bg-subtle px-3 py-1.5">
                <Ban aria-hidden="true" className="size-3.5 text-ink-muted" />
                <span className="text-xs font-semibold text-ink-soft">Bloqueadas</span>
                <span className="text-sm font-semibold tabular-nums text-ink">
                  {data.bloqueadas.units}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* Movimentação recente (o "o que mudou"), respeitando a busca. */}
        <div className="min-w-0">
          <VendasMovimentacao movements={movements} />
        </div>
      </div>

      {detailUnit ? (
        <VendaPropostaModal
          onClose={() => setDetailUnit(null)}
          onOpenEntity={onOpenEntity}
          unit={detailUnit}
        />
      ) : null}
      {terminalModal ? (
        <VendaTerminaisModal
          items={data.terminalItems.filter(
            (item) => item.terminal === terminalModal,
          )}
          onClose={() => setTerminalModal(null)}
          terminal={terminalModal}
        />
      ) : null}
    </div>
  );
}

// Lista das propostas canceladas/distratadas (o "apontar" das perdas).
function VendaTerminaisModal({
  items,
  onClose,
  terminal,
}: {
  items: ApoloVendaTerminalItem[];
  onClose: () => void;
  terminal: ApoloVendaTerminal;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const totalVgv = items.reduce((sum, item) => sum + item.vgv, 0);

  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/40 p-4">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
              <Ban aria-hidden="true" className="size-4 text-rose-500" />
              {VENDA_TERMINAL_LABELS[terminal]}
              <span className="text-xs font-medium text-ink-muted">
                {items.length} · {formatCurrency(totalVgv)}
              </span>
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          {items.length === 0 ? (
            <p className="m-0 p-6 text-center text-sm font-medium text-ink-muted">
              Nenhuma proposta.
            </p>
          ) : (
            <div className="divide-y divide-line/70">
              {items.map((item) => (
                <div className="flex items-start gap-3 px-5 py-3" key={item.id}>
                  <span className="mt-0.5 w-16 shrink-0 text-[11px] tabular-nums text-ink-muted">
                    {formatShortDate(item.at ?? "")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold tabular-nums text-ink">
                        {item.code}
                      </span>
                      <span className="text-[11px] font-medium tabular-nums text-ink-soft">
                        {formatCurrency(item.vgv)}
                      </span>
                    </div>
                    <p className="m-0 mt-0.5 truncate text-[11px] text-ink-muted">
                      {[
                        item.client ? toTitleCase(item.client) : null,
                        item.imobiliaria ? toTitleCase(item.imobiliaria) : null,
                      ]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                    {item.reason ? (
                      <p className="m-0 mt-1 rounded-md border border-line bg-subtle/50 px-2 py-1 text-[11px] text-ink-soft">
                        {item.reason}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Coluna do board = um estágio; conta e VGV saem das unidades visíveis (respeita a busca).
function KanbanColumn({
  onOpenUnit,
  stage,
  units,
}: {
  onOpenUnit: (unit: ApoloVendaUnit) => void;
  stage: ApoloVendaStage;
  units: ApoloVendaUnit[];
}) {
  const vgv = units.reduce((sum, unit) => sum + unit.vgv, 0);

  return (
    <div className="flex w-56 shrink-0 flex-col rounded-xl border border-line bg-subtle/40">
      <div className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span
          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${VENDA_STAGE_PILL[stage]}`}
        >
          {VENDA_STAGE_LABELS[stage]}
        </span>
        <span className="text-xs font-semibold tabular-nums text-ink">
          {units.length}
        </span>
      </div>
      <p className="m-0 px-3 pt-1.5 text-[11px] tabular-nums text-ink-muted">
        VGV {formatCurrency(vgv)}
      </p>
      <div className="flex max-h-[52vh] flex-col gap-1.5 overflow-auto p-2">
        {units.length === 0 ? (
          <p className="m-0 py-6 text-center text-[11px] text-ink-muted">Vazio</p>
        ) : (
          units.map((unit) => (
            <VendaCard key={unit.id} onOpenUnit={onOpenUnit} unit={unit} />
          ))
        )}
      </div>
    </div>
  );
}

// Card clicável: abre a proposta (plano comercial + parcelamento + movimentação).
function VendaCard({
  onOpenUnit,
  unit,
}: {
  onOpenUnit: (unit: ApoloVendaUnit) => void;
  unit: ApoloVendaUnit;
}) {
  // Faturado é venda concluída: mostra a DATA do faturamento (o stageSince), não um
  // contador "há X dias" que cresceria pra sempre. Estágios ativos mostram o tempo parado.
  const footer =
    unit.stage === "faturado"
      ? unit.stageSince
        ? `faturado em ${formatDate(unit.stageSince)}`
        : null
      : formatTimeInStage(unit.stageSince);

  return (
    <button
      className="w-full rounded-lg border border-line bg-surface p-2.5 text-left transition-colors hover:border-[#A07C3B]/45 hover:bg-[#A07C3B]/5"
      onClick={() => onOpenUnit(unit)}
      title="Ver a proposta desta unidade"
      type="button"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold tabular-nums text-ink">{unit.code}</span>
        <span className="text-[11px] font-medium tabular-nums text-ink-soft">
          {formatCurrency(unit.vgv)}
        </span>
      </div>
      {unit.client ? (
        <p className="m-0 mt-1 truncate text-[11px] font-semibold text-ink">
          {toTitleCase(unit.client.name)}
        </p>
      ) : null}
      {unit.imobiliaria ? (
        <p className="m-0 truncate text-[11px] text-ink-muted">
          {toTitleCase(unit.imobiliaria.name)}
        </p>
      ) : null}
      {footer ? (
        <p className="m-0 mt-0.5 text-[10px] text-ink-muted">{footer}</p>
      ) : null}
    </button>
  );
}

// Modal da proposta: plano comercial + parcelamento + movimentação da unidade ("tudo").
function VendaPropostaModal({
  onClose,
  onOpenEntity,
  unit,
}: {
  onClose: () => void;
  onOpenEntity: (name: string, entityId: string) => void;
  unit: ApoloVendaUnit;
}) {
  const [proposta, setProposta] = useState<ApoloVendaProposta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setError(null);
        setLoaded(false);

        const accessToken = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/empreendimentos/vendas/proposta?unitId=${encodeURIComponent(unit.id)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json()) as {
          data?: ApoloVendaProposta | null;
          error?: string;
        };

        if (!response.ok) {
          throw new Error(payload.error ?? "Nao foi possivel carregar a proposta.");
        }

        if (active) {
          setProposta(payload.data ?? null);
          setLoaded(true);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Falha ao carregar a proposta.",
          );
          setLoaded(true);
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [unit.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pct = (value: number | null) =>
    value == null
      ? "-"
      : `${value.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;

  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/40 p-4">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex max-h-[86vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="m-0 flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
              <TrendingUp aria-hidden="true" className="size-4 text-[#A07C3B]" />
              Proposta {proposta?.plan.code ? `· ${proposta.plan.code}` : ""} · {unit.code}
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${VENDA_STAGE_PILL[unit.stage]}`}
              >
                {VENDA_STAGE_LABELS[unit.stage]}
              </span>
            </p>
            {unit.client ? (
              <button
                className="mt-0.5 block max-w-full truncate text-left text-xs font-semibold text-[#7A5E2C] hover:underline dark:text-[#d9b877]"
                onClick={() => onOpenEntity(unit.client!.name, unit.client!.entityId)}
                type="button"
              >
                {toTitleCase(unit.client.name)}
                {unit.imobiliaria ? ` · ${toTitleCase(unit.imobiliaria.name)}` : ""}
              </button>
            ) : null}
          </div>
          <button
            aria-label="Fechar"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error ? (
            <p className="m-0 p-6 text-center text-sm font-semibold text-rose-600 dark:text-rose-400">
              {error}
            </p>
          ) : !loaded ? (
            <div className="h-48 animate-pulse rounded-xl border border-line bg-subtle" />
          ) : !proposta ? (
            <p className="m-0 p-6 text-center text-sm font-medium text-ink-muted">
              Esta unidade não tem proposta registrada.
            </p>
          ) : (
            <div className="grid gap-4">
              {/* Plano comercial. */}
              <section>
                <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Plano comercial
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <MiniFact
                    label="Plano"
                    value={
                      proposta.plan.planName ??
                      (proposta.plan.isCustom ? "Personalizado" : "-")
                    }
                  />
                  <MiniFact label="VGV" value={formatCurrency(proposta.plan.vgv)} />
                  <MiniFact label="Entrada" value={pct(proposta.plan.entrada)} />
                  <MiniFact
                    label="Parcelas"
                    value={proposta.plan.parcels != null ? String(proposta.plan.parcels) : "-"}
                  />
                  <MiniFact label="Juros" value={pct(proposta.plan.interestRate)} />
                  <MiniFact label="Correção" value={pct(proposta.plan.correctionRate)} />
                  <MiniFact
                    label="Sinal"
                    value={
                      proposta.plan.signalParcels
                        ? `${proposta.plan.signalParcels}x · ${formatDate(proposta.plan.firstSignalAt)}`
                        : "-"
                    }
                  />
                  <MiniFact label="Ato" value={formatDate(proposta.plan.atoAt)} />
                  <MiniFact label="Assinatura" value={formatDate(proposta.plan.signAt)} />
                  <MiniFact label="Faturamento" value={formatDate(proposta.plan.billingAt)} />
                  <MiniFact label="Corretor" value={proposta.plan.corretor ? toTitleCase(proposta.plan.corretor) : "-"} />
                </div>
                {proposta.plan.observacao ? (
                  <p className="m-0 mt-2 rounded-lg border border-line bg-subtle/50 px-3 py-2 text-xs text-ink-soft">
                    {proposta.plan.observacao}
                  </p>
                ) : null}
              </section>

              {/* Parcelamento. */}
              <section>
                <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Parcelamento
                  <span className="ml-1.5 font-medium normal-case text-ink-muted">
                    ({proposta.parcelamento.length})
                  </span>
                </p>
                {proposta.parcelamento.length === 0 ? (
                  <p className="m-0 rounded-lg border border-line bg-subtle/50 px-3 py-2 text-xs text-ink-muted">
                    Sem parcelas registradas.
                  </p>
                ) : (
                  <div className="max-h-52 overflow-auto rounded-lg border border-line">
                    {proposta.parcelamento.map((installment) => (
                      <div
                        className="flex items-center justify-between gap-2 border-b border-line/70 px-3 py-1.5 text-xs last:border-b-0"
                        key={installment.id}
                      >
                        <span className="w-20 shrink-0 tabular-nums text-ink-soft">
                          {installment.number}
                        </span>
                        <span className="flex-1 tabular-nums text-ink-muted">
                          {installment.type ?? "-"}
                        </span>
                        <span className="tabular-nums text-ink-soft">
                          {formatDate(installment.dueDate)}
                        </span>
                        <span className="w-24 shrink-0 text-right font-medium tabular-nums text-ink">
                          {formatCurrency(installment.amount)}
                        </span>
                        <InstallmentStatusPill installment={installment} />
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Movimentação da unidade. */}
              <section>
                <p className="m-0 mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  Movimentação da unidade
                </p>
                {proposta.movimentacao.length === 0 ? (
                  <p className="m-0 rounded-lg border border-line bg-subtle/50 px-3 py-2 text-xs text-ink-muted">
                    Sem movimentação registrada.
                  </p>
                ) : (
                  <div className="grid gap-1">
                    {proposta.movimentacao.map((movement, index) => (
                      <div
                        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs"
                        key={`${movement.at}-${index}`}
                      >
                        <span className="w-16 shrink-0 tabular-nums text-ink-muted">
                          {formatShortDate(movement.at)}
                        </span>
                        <span className="text-ink-muted">{movement.fromStage ?? "Novo"}</span>
                        <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
                        <span className="font-semibold text-ink">{movement.toStage}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Rótulos C2X de estágios terminais (cancelamento/distrato), para destacar no feed.
const TERMINAL_STAGE_LABELS = new Set([
  "Cancelado",
  "Reprovado análise",
  "Em distrato",
  "Distratado",
]);

function isTerminalStageLabel(label: string | null): boolean {
  return label != null && TERMINAL_STAGE_LABELS.has(label);
}

// "há X dias/meses" desde que a unidade entrou no estágio atual.
function formatTimeInStage(iso: string | null): string | null {
  if (!iso) {
    return null;
  }
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) {
    return null;
  }

  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) {
    return "há poucas horas";
  }
  if (days === 1) {
    return "há 1 dia";
  }
  if (days < 30) {
    return `há ${days} dias`;
  }
  const months = Math.floor(days / 30);
  if (months < 12) {
    return months === 1 ? "há 1 mês" : `há ${months} meses`;
  }
  const years = Math.floor(days / 365);
  return years === 1 ? "há 1 ano" : `há ${years} anos`;
}

// Feed cronológico das transições de estágio (o "o que mudou").
function VendasMovimentacao({ movements }: { movements: ApoloVendaMovement[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <TrendingUp aria-hidden="true" className="size-4 text-[#A07C3B]" />
        <p className="m-0 text-sm font-semibold text-ink">Movimentação recente</p>
      </div>
      {movements.length === 0 ? (
        <p className="m-0 p-6 text-center text-sm font-medium text-ink-muted">
          Nenhuma movimentação.
        </p>
      ) : (
      <div className="max-h-[64vh] divide-y divide-line/70 overflow-auto">
        {movements.map((movement, index) => (
          <div
            className="flex items-start gap-3 px-4 py-3"
            key={`${movement.code}-${movement.at}-${index}`}
          >
            <span className="mt-0.5 w-16 shrink-0 text-[11px] tabular-nums text-ink-muted">
              {formatShortDate(movement.at)}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold tabular-nums text-ink">
                  {movement.code}
                </span>
                <span className="text-[11px] font-medium tabular-nums text-ink-soft">
                  {formatCurrency(movement.vgv)}
                </span>
              </div>
              <p className="m-0 mt-0.5 flex items-center gap-1.5 text-xs">
                <span className="text-ink-muted">
                  {movement.fromStage ?? "Novo"}
                </span>
                <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-ink-muted" />
                <span
                  className={`font-semibold ${
                    isTerminalStageLabel(movement.toStage)
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-ink"
                  }`}
                >
                  {movement.toStage}
                </span>
              </p>
              {movement.client || movement.imobiliaria ? (
                <p className="m-0 mt-0.5 truncate text-[11px] text-ink-muted">
                  {[
                    movement.client ? toTitleCase(movement.client) : null,
                    movement.imobiliaria ? toTitleCase(movement.imobiliaria) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>
      )}
    </section>
  );
}

function CarteiraTab({
  onOpenEntity,
  row,
}: {
  onOpenEntity: (name: string, entityId: string) => void;
  row: ApoloEnterpriseRow;
}) {
  const [data, setData] = useState<ApoloCarteiraData | null>(null);
  const [cobranca, setCobranca] = useState<ApoloEnterpriseCobranca | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [detailUnit, setDetailUnit] = useState<ApoloCarteiraUnit | null>(null);
  const [cobrancaUnit, setCobrancaUnit] = useState<ApoloCarteiraUnit | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<CarteiraFilter>("todos");
  const [sort, setSort] = useState<CarteiraSort>({
    column: "vencido",
    direction: "desc",
  });
  const [openingContractId, setOpeningContractId] = useState<string | null>(null);
  const [contractError, setContractError] = useState<string | null>(null);

  // Abre o contrato assinado pedindo um PDF fresco pela API do D4Sign (o link do C2X
  // expira). A rota exige token Bearer, então buscamos como blob e abrimos numa aba.
  async function openContract(unit: ApoloCarteiraUnit) {
    const documentId = unit.contractDocumentId;

    if (!documentId || openingContractId) {
      return;
    }

    const previewWindow = window.open("about:blank", "_blank");
    writeContractLoading(previewWindow, unit.code);

    try {
      setOpeningContractId(unit.id);
      setContractError(null);

      const accessToken = await getApoloAccessToken();
      const response = await fetch(
        `/api/apolo/empreendimentos/contrato/${encodeURIComponent(documentId)}`,
        { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;

        throw new Error(payload?.error ?? "Nao foi possivel abrir o contrato.");
      }

      const objectUrl = window.URL.createObjectURL(await response.blob());

      if (previewWindow) {
        previewWindow.location.href = objectUrl;
      } else {
        window.open(objectUrl, "_blank");
      }

      window.setTimeout(() => window.URL.revokeObjectURL(objectUrl), 60_000);
    } catch (openError) {
      previewWindow?.close();
      setContractError(
        openError instanceof Error
          ? openError.message
          : "Falha ao abrir o contrato.",
      );
    } finally {
      setOpeningContractId(null);
    }
  }

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setError(null);

        const accessToken = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/empreendimentos/carteira?codes=${encodeURIComponent(row.codes.join(","))}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json()) as {
          data?: ApoloCarteiraData;
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Nao foi possivel carregar a carteira.");
        }

        if (active) {
          setData(payload.data);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Falha ao carregar a carteira.",
          );
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [row.codes]);

  // Cobrança (promessa/acordo) — fetch à parte, tolerante: se falhar, a carteira
  // segue sem os selos/funil. Ver [[project-apolo-crm-grafo]].
  useEffect(() => {
    let active = true;

    async function loadCobranca() {
      try {
        const accessToken = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/empreendimentos/cobranca?codes=${encodeURIComponent(row.codes.join(","))}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json()) as {
          data?: ApoloEnterpriseCobranca;
        };

        if (active && response.ok && payload.data) {
          setCobranca(payload.data);
        }
      } catch {
        // silencioso: cobrança é enriquecimento, não bloqueia a carteira.
      }
    }

    void loadCobranca();

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

  if (!data) {
    return <div className="h-72 animate-pulse rounded-xl border border-line bg-subtle" />;
  }

  const { summary } = data;

  if (!summary.contracts && !summary.totalPortfolio) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center text-sm font-medium text-ink-muted">
        Este empreendimento não tem carteira ativa de pagamentos no C2X.
      </div>
    );
  }

  const paidShare = summary.totalPortfolio
    ? (summary.paidAmount / summary.totalPortfolio) * 100
    : 0;
  const units = sortCarteiraUnits(
    filterCarteiraUnits(data.units, search, statusFilter),
    sort,
    cobranca?.byUnitId,
  );

  return (
    <div className="grid gap-3">
      {/* Cenário da carteira (idêntico ao Hades). */}
      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <CarteiraCard
          hint={`${summary.contracts} contrato(s)`}
          label="Carteira total"
          tone="text-ink"
          value={formatCurrency(summary.totalPortfolio)}
        />
        <CarteiraCard
          hint={`${paidShare.toFixed(1)}% da carteira`}
          label="Recebido"
          tone="text-blue-600 dark:text-blue-400"
          value={formatCurrency(summary.paidAmount)}
        />
        <CarteiraCard
          hint="parcelas em dia"
          label="A receber"
          tone="text-emerald-600 dark:text-emerald-400"
          value={formatCurrency(summary.toReceiveAmount)}
        />
        <CarteiraCard
          hint={`${summary.overdueInstallments} parcela(s) · ${summary.overdueClients} cliente(s)`}
          label="Vencido"
          tone="text-rose-600 dark:text-rose-400"
          value={formatCurrency(summary.overdueAmount)}
        />
        <CarteiraCard
          hint={`${summary.criticalContracts} contrato(s) crítico(s)`}
          label="Inadimplência"
          tone="text-rose-600 dark:text-rose-400"
          value={`${(summary.delinquencyRate * 100).toFixed(1)}%`}
        />
        <CarteiraCard
          hint="pago no mês"
          label="Recuperação"
          tone="text-[#7A5E2C] dark:text-[#d9b877]"
          value={formatCurrency(summary.recoveryAmount)}
        />
        <CarteiraCard
          hint="com contrato ativo"
          label="Clientes"
          tone="text-ink"
          value={String(summary.clients)}
        />
        <CarteiraCard
          hint="com parcela vencida"
          label="Inadimplentes"
          tone="text-rose-600 dark:text-rose-400"
          value={String(summary.overdueClients)}
        />
      </section>

      {/* Funil de recuperação (leitura do motor da Cobrança). Só aparece quando há
          movimento de cobrança no empreendimento. */}
      <CobrancaFunnel cobranca={cobranca} />

      {/* Visão por UNIDADE (a diferença pro Hades). */}
      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <p className="m-0 text-sm font-semibold text-ink">
            Carteira por unidade
            <span className="ml-1.5 text-xs font-medium text-ink-muted">
              ({units.length})
            </span>
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-[220px] items-center gap-2 rounded-lg border border-line bg-subtle px-3">
              <Search aria-hidden="true" className="size-4 text-ink-muted" />
              <input
                className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-ink-muted"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Unidade, comprador, imobiliária..."
                value={search}
              />
            </label>
            <select
              className="h-9 rounded-lg border border-line bg-subtle px-3 text-sm font-medium text-ink outline-none"
              onChange={(event) =>
                setStatusFilter(event.target.value as CarteiraFilter)
              }
              value={statusFilter}
            >
              <option value="todos">Todas</option>
              <option value="inadimplente">Inadimplentes</option>
              <option value="em_dia">Em dia</option>
            </select>
          </div>
        </div>
        {contractError ? (
          <p className="m-0 border-b border-rose-200 bg-rose-50 px-4 py-2 text-xs font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
            {contractError}
          </p>
        ) : null}
        <div className="max-h-[58vh] overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-line bg-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <CarteiraHead column="codigo" label="Unidade" onSort={setSort} sort={sort} />
                <th className="px-3 py-2.5">Comprador / Imobiliária</th>
                <CarteiraHead column="faturado" label="Faturado" onSort={setSort} sort={sort} />
                <CarteiraHead align="right" column="vgv" label="VGV" onSort={setSort} sort={sort} />
                <th className="px-3 py-2.5 text-right">Pago</th>
                <th className="px-3 py-2.5 text-right">A receber</th>
                <CarteiraHead align="right" column="vencido" label="Vencido" onSort={setSort} sort={sort} />
                <CarteiraHead column="situacao" label="Situação" onSort={setSort} sort={sort} />
                <CarteiraHead column="cobranca" label="Cobrança" onSort={setSort} sort={sort} />
                <th className="px-4 py-2.5 text-center">Contrato</th>
              </tr>
            </thead>
            <tbody>
              {units.map((unit) => (
                <tr
                  className="cursor-pointer border-b border-line/70 transition-colors last:border-b-0 hover:bg-[#A07C3B]/8"
                  key={unit.id}
                  onClick={() => setDetailUnit(unit)}
                  title="Ver carteira detalhada (parcelas e boletos)"
                >
                  <td className="px-4 py-2">
                    <p className="m-0 text-sm font-semibold tabular-nums text-ink">
                      {unit.code}
                    </p>
                    <p className="m-0 text-xs tabular-nums text-ink-muted">
                      {[unit.block, unit.lot].filter(Boolean).join(" / ")}
                    </p>
                  </td>
                  <td className="px-3 py-2">
                    {unit.client ? (
                      <button
                        className="block max-w-[240px] truncate text-left text-xs font-semibold text-[#7A5E2C] transition-colors hover:underline dark:text-[#d9b877]"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenEntity(unit.client!.name, unit.client!.entityId);
                        }}
                        type="button"
                      >
                        {toTitleCase(unit.client.name)}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted">-</span>
                    )}
                    {unit.imobiliaria ? (
                      <button
                        className="block max-w-[240px] truncate text-left text-xs text-ink-muted transition-colors hover:text-ink hover:underline"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenEntity(
                            unit.imobiliaria!.name,
                            unit.imobiliaria!.entityId,
                          );
                        }}
                        type="button"
                      >
                        {toTitleCase(unit.imobiliaria.name)}
                      </button>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-ink-soft">
                    {formatDate(unit.faturadoAt)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">
                    {formatCurrency(unit.totalContract)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-blue-600 dark:text-blue-400">
                    {formatCurrency(unit.paidAmount)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatCurrency(unit.toReceiveAmount)}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums text-rose-600 dark:text-rose-400">
                    {unit.overdueAmount ? formatCurrency(unit.overdueAmount) : "-"}
                  </td>
                  <td className="px-4 py-2">
                    <UnitFinancialStatus unit={unit} />
                  </td>
                  <td className="px-3 py-2">
                    {cobranca?.byUnitId[unit.id] ? (
                      <button
                        className="rounded-full transition-opacity hover:opacity-80"
                        onClick={(event) => {
                          event.stopPropagation();
                          setCobrancaUnit(unit);
                        }}
                        title="Ver negociação"
                        type="button"
                      >
                        <UnitCobrancaBadge cobranca={cobranca.byUnitId[unit.id]} />
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted">-</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-center">
                    {unit.contractDocumentId ? (
                      <button
                        className="inline-flex size-7 items-center justify-center rounded-lg border border-line bg-subtle text-ink-muted transition-colors hover:border-[#A07C3B]/40 hover:text-[#7A5E2C] disabled:opacity-60 dark:hover:text-[#d9b877]"
                        disabled={openingContractId === unit.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          void openContract(unit);
                        }}
                        title="Abrir contrato assinado"
                        type="button"
                      >
                        {openingContractId === unit.id ? (
                          <Loader2
                            aria-hidden="true"
                            className="size-3.5 animate-spin"
                          />
                        ) : (
                          <FileText aria-hidden="true" className="size-3.5" />
                        )}
                      </button>
                    ) : (
                      <span className="text-xs text-ink-muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {units.length === 0 ? (
          <p className="m-0 p-6 text-center text-sm font-medium text-ink-muted">
            Nenhuma unidade nesse filtro.
          </p>
        ) : null}
      </section>

      {detailUnit ? (
        <UnitCarteiraModal
          onClose={() => setDetailUnit(null)}
          onOpenEntity={onOpenEntity}
          unit={detailUnit}
        />
      ) : null}
      {cobrancaUnit ? (
        <CobrancaModal
          onClose={() => setCobrancaUnit(null)}
          unit={cobrancaUnit}
        />
      ) : null}
    </div>
  );
}

// Carteira detalhada da unidade: as parcelas/boletos, no estilo do Hades.
// Escreve uma tela de "carregando" na aba nova enquanto o PDF do contrato baixa
// (a busca leva ~1-2s), pra evitar a aba branca do about:blank.
function writeContractLoading(target: Window | null, unitCode: string) {
  if (!target) {
    return;
  }

  const safeCode = unitCode.replace(/[<>&"]/g, "");

  target.document.write(
    `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8" />` +
      `<meta name="viewport" content="width=device-width, initial-scale=1" />` +
      `<title>Carregando contrato…</title><style>` +
      `:root{color-scheme:light dark}` +
      `body{margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;` +
      `font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0b0c;color:#e7e2d6}` +
      `@media(prefers-color-scheme:light){body{background:#f6f5f2;color:#3a352b}}` +
      `.spin{width:38px;height:38px;border-radius:50%;border:3px solid rgba(160,124,59,.25);` +
      `border-top-color:#a07c3b;animation:r .8s linear infinite}` +
      `.t{font-size:14px;font-weight:600;letter-spacing:.2px}` +
      `.s{font-size:12px;opacity:.6}` +
      `@keyframes r{to{transform:rotate(360deg)}}` +
      `</style></head><body><div class="spin"></div>` +
      `<div class="t">Carregando contrato</div>` +
      `<div class="s">${safeCode}</div></body></html>`,
  );
  target.document.close();
}

type InstallmentFilter = "todas" | "liquidada" | "vencida" | "a_vencer";
type InstallmentSortColumn =
  | "competencia"
  | "pagamento"
  | "status"
  | "valor"
  | "vencimento";
type InstallmentSort = {
  column: InstallmentSortColumn;
  direction: "asc" | "desc";
};

function InstallmentHead({
  align = "left",
  column,
  label,
  onSort,
  sort,
}: {
  align?: "left" | "right";
  column: InstallmentSortColumn;
  label: string;
  onSort: (sort: InstallmentSort) => void;
  sort: InstallmentSort;
}) {
  const active = sort.column === column;

  return (
    <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""}`}>
      <button
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink ${
          active ? "text-ink" : ""
        }`}
        onClick={() =>
          onSort({
            column,
            direction: active && sort.direction === "asc" ? "desc" : "asc",
          })
        }
        type="button"
      >
        {label}
        <ArrowUpDown
          aria-hidden="true"
          className={`size-3 ${active ? "text-[#A07C3B]" : "opacity-40"}`}
        />
      </button>
    </th>
  );
}

function filterInstallments(
  items: ApoloUnitInstallment[],
  filter: InstallmentFilter,
): ApoloUnitInstallment[] {
  if (filter === "todas") {
    return items;
  }

  return items.filter((item) => item.status === filter);
}

function sortInstallments(
  items: ApoloUnitInstallment[],
  sort: InstallmentSort,
): ApoloUnitInstallment[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  const time = (value: string | null) => (value ? new Date(value).getTime() : 0);
  const statusRank: Record<ApoloInstallmentStatus, number> = {
    a_vencer: 2,
    liquidada: 1,
    vencida: 3,
  };

  return [...items].sort((left, right) => {
    if (sort.column === "valor") {
      return (left.amount - right.amount) * factor;
    }
    if (sort.column === "competencia") {
      return (time(left.competence) - time(right.competence)) * factor;
    }
    if (sort.column === "pagamento") {
      return (time(left.paidAt) - time(right.paidAt)) * factor;
    }
    if (sort.column === "status") {
      return (statusRank[left.status] - statusRank[right.status]) * factor;
    }

    return (time(left.dueDate) - time(right.dueDate)) * factor;
  });
}

function UnitCarteiraModal({
  onClose,
  onOpenEntity,
  unit,
}: {
  onClose: () => void;
  onOpenEntity: (name: string, entityId: string) => void;
  unit: ApoloCarteiraUnit;
}) {
  const [installments, setInstallments] = useState<
    ApoloUnitInstallment[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<InstallmentFilter>("todas");
  const [sort, setSort] = useState<InstallmentSort>({
    column: "vencimento",
    direction: "asc",
  });

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setError(null);

        const accessToken = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/empreendimentos/parcelas?unitId=${encodeURIComponent(unit.id)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json()) as {
          data?: { installments: ApoloUnitInstallment[] };
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Nao foi possivel carregar as parcelas.");
        }

        if (active) {
          setInstallments(payload.data.installments);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Falha ao carregar as parcelas.",
          );
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [unit.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = installments
    ? sortInstallments(filterInstallments(installments, statusFilter), sort)
    : [];

  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/40 p-4">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
              <WalletCards aria-hidden="true" className="size-4 text-[#A07C3B]" />
              Carteira · {unit.code}
            </p>
            {unit.client ? (
              <button
                className="mt-0.5 block max-w-full truncate text-left text-xs font-medium text-[#7A5E2C] hover:underline dark:text-[#d9b877]"
                onClick={() => onOpenEntity(unit.client!.name, unit.client!.entityId)}
                type="button"
              >
                {toTitleCase(unit.client.name)}
                {unit.imobiliaria
                  ? ` · ${toTitleCase(unit.imobiliaria.name)}`
                  : ""}
              </button>
            ) : null}
          </div>
          <button
            aria-label="Fechar"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="grid grid-cols-3 gap-2 border-b border-line px-5 py-3">
          <MiniFact label="VGV" value={formatCurrency(unit.totalContract)} />
          <MiniFact
            label="Pago"
            tone="text-blue-600 dark:text-blue-400"
            value={formatCurrency(unit.paidAmount)}
          />
          <MiniFact
            label="Vencido"
            tone="text-rose-600 dark:text-rose-400"
            value={formatCurrency(unit.overdueAmount)}
          />
        </div>

        {installments && installments.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-2.5">
            <p className="m-0 text-xs font-medium text-ink-muted">
              {rows.length}
              {rows.length !== installments.length
                ? ` de ${installments.length}`
                : ""}{" "}
              parcelas
            </p>
            <select
              className="h-8 rounded-lg border border-line bg-subtle px-2.5 text-xs font-medium text-ink outline-none"
              onChange={(event) =>
                setStatusFilter(event.target.value as InstallmentFilter)
              }
              value={statusFilter}
            >
              <option value="todas">Todas</option>
              <option value="liquidada">Liquidadas</option>
              <option value="vencida">Vencidas</option>
              <option value="a_vencer">A vencer</option>
            </select>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-auto">
          {error ? (
            <p className="m-0 p-6 text-center text-sm font-semibold text-rose-600 dark:text-rose-400">
              {error}
            </p>
          ) : !installments ? (
            <div className="m-4 h-40 animate-pulse rounded-xl border border-line bg-subtle" />
          ) : installments.length === 0 ? (
            <p className="m-0 p-6 text-center text-sm font-medium text-ink-muted">
              Sem parcelas registradas.
            </p>
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="border-b border-line bg-subtle text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                  <th className="px-5 py-2.5">Parcela</th>
                  <InstallmentHead column="competencia" label="Competência" onSort={setSort} sort={sort} />
                  <InstallmentHead column="vencimento" label="Vencimento" onSort={setSort} sort={sort} />
                  <InstallmentHead column="pagamento" label="Pagamento" onSort={setSort} sort={sort} />
                  <InstallmentHead align="right" column="valor" label="Valor" onSort={setSort} sort={sort} />
                  <InstallmentHead column="status" label="Status" onSort={setSort} sort={sort} />
                  <th className="px-5 py-2.5 text-right">Boleto</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((installment) => (
                  <tr
                    className="border-b border-line/70 last:border-b-0"
                    key={installment.id}
                  >
                    <td className="px-5 py-2">
                      <p className="m-0 text-sm font-semibold tabular-nums text-ink">
                        {installment.number}
                      </p>
                      <p className="m-0 text-xs text-ink-muted">
                        {installment.type ?? "-"}
                      </p>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-soft">
                      {formatMonth(installment.competence)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-soft">
                      {formatDate(installment.dueDate)}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-ink-soft">
                      {installment.paidAt ? (
                        formatDate(installment.paidAt)
                      ) : (
                        <span className="text-ink-muted">-</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-ink">
                      {formatCurrency(installment.amount)}
                    </td>
                    <td className="px-3 py-2">
                      <InstallmentStatusPill installment={installment} />
                    </td>
                    <td className="px-5 py-2 text-right">
                      {installment.paymentUrl || installment.invoiceUrl ? (
                        <a
                          className="inline-flex items-center gap-1 rounded-lg border border-line bg-subtle px-2.5 py-1 text-[11px] font-semibold text-ink-soft transition-colors hover:border-[#A07C3B]/40 hover:text-[#7A5E2C] dark:hover:text-[#d9b877]"
                          href={
                            (installment.paymentUrl ?? installment.invoiceUrl)!
                          }
                          rel="noreferrer"
                          target="_blank"
                        >
                          <ExternalLink aria-hidden="true" className="size-3" />
                          Abrir
                        </a>
                      ) : (
                        <span className="text-xs text-ink-muted">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function InstallmentStatusPill({
  installment,
}: {
  installment: ApoloUnitInstallment;
}) {
  if (installment.status === "liquidada") {
    return (
      <span className="inline-flex rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700 dark:border-blue-500/30 dark:bg-blue-500/12 dark:text-blue-300">
        Liquidada
      </span>
    );
  }

  if (installment.status === "vencida") {
    return (
      <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300">
        Vencida{installment.overdueDays ? ` · ${installment.overdueDays}d` : ""}
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300">
      A vencer
    </span>
  );
}

function MiniFact({
  label,
  tone = "text-ink",
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-subtle px-3 py-2">
      <p className="m-0 text-[11px] font-medium text-ink-muted">{label}</p>
      <p className={`m-0 text-sm font-semibold tabular-nums ${tone}`}>{value}</p>
    </div>
  );
}

function formatMonth(value: string | null): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleDateString("pt-BR", {
        month: "2-digit",
        timeZone: "UTC",
        year: "numeric",
      });
}

type CarteiraFilter = "todos" | "inadimplente" | "em_dia";
type CarteiraSortColumn =
  | "cobranca"
  | "codigo"
  | "faturado"
  | "situacao"
  | "vencido"
  | "vgv";
type CarteiraSort = { column: CarteiraSortColumn; direction: "asc" | "desc" };

// Peso de cada etapa de cobrança pra ordenação (quebrado no topo em desc; sem
// cobrança sempre por último).
const COBRANCA_STAGE_RANK: Record<ApoloCobrancaStage, number> = {
  acordo: 2,
  negociacao: 3,
  promessa: 1,
  quebrado: 4,
};

function CarteiraHead({
  align = "left",
  column,
  label,
  onSort,
  sort,
}: {
  align?: "left" | "right";
  column: CarteiraSortColumn;
  label: string;
  onSort: (sort: CarteiraSort) => void;
  sort: CarteiraSort;
}) {
  const active = sort.column === column;

  return (
    <th className={`px-3 py-2.5 ${align === "right" ? "text-right" : ""}`}>
      <button
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink ${
          active ? "text-ink" : ""
        }`}
        onClick={() =>
          onSort({
            column,
            direction: active && sort.direction === "asc" ? "desc" : "asc",
          })
        }
        type="button"
      >
        {label}
        <ArrowUpDown
          aria-hidden="true"
          className={`size-3 ${active ? "text-[#A07C3B]" : "opacity-40"}`}
        />
      </button>
    </th>
  );
}

function filterCarteiraUnits(
  units: ApoloCarteiraUnit[],
  search: string,
  status: CarteiraFilter,
): ApoloCarteiraUnit[] {
  const query = search.trim().toLowerCase();

  return units.filter((unit) => {
    if (status === "inadimplente" && unit.overdueInstallments === 0) {
      return false;
    }

    if (status === "em_dia" && unit.overdueInstallments > 0) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      unit.code,
      unit.block,
      unit.lot,
      unit.client?.name,
      unit.imobiliaria?.name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

function sortCarteiraUnits(
  units: ApoloCarteiraUnit[],
  sort: CarteiraSort,
  cobrancaByUnit: Record<string, ApoloUnitCobranca> = {},
): ApoloCarteiraUnit[] {
  const factor = sort.direction === "asc" ? 1 : -1;

  return [...units].sort((left, right) => {
    if (sort.column === "vgv") {
      return (left.totalContract - right.totalContract) * factor;
    }
    if (sort.column === "vencido") {
      return (left.overdueAmount - right.overdueAmount) * factor;
    }
    if (sort.column === "situacao") {
      return (left.overdueInstallments - right.overdueInstallments) * factor;
    }
    if (sort.column === "cobranca") {
      const leftStage = cobrancaByUnit[left.id]?.stage;
      const rightStage = cobrancaByUnit[right.id]?.stage;
      const leftRank = leftStage ? COBRANCA_STAGE_RANK[leftStage] : 0;
      const rightRank = rightStage ? COBRANCA_STAGE_RANK[rightStage] : 0;
      return (leftRank - rightRank) * factor;
    }
    if (sort.column === "faturado") {
      return (
        (new Date(left.faturadoAt ?? 0).getTime() -
          new Date(right.faturadoAt ?? 0).getTime()) *
        factor
      );
    }

    return left.code.localeCompare(right.code, "pt-BR", { numeric: true }) * factor;
  });
}

// Selo de cobrança por unidade: promessa/acordo/negociação/quebra do motor do Hades.
function UnitCobrancaBadge({ cobranca }: { cobranca?: ApoloUnitCobranca }) {
  if (!cobranca) {
    return <span className="text-xs text-ink-muted">-</span>;
  }

  const config: Record<ApoloCobrancaStage, { label: string; tone: string }> = {
    acordo: {
      label: "Acordo",
      tone: "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-500/30 dark:bg-violet-500/12 dark:text-violet-300",
    },
    negociacao: {
      label: "Em negociação",
      tone: "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-300",
    },
    promessa: {
      label: "Promessa",
      tone: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300",
    },
    quebrado: {
      label: "Quebrada",
      tone: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300",
    },
  };
  const cfg = config[cobranca.stage];
  const date = cobranca.promisedDate ? formatShortDate(cobranca.promisedDate) : null;

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cfg.tone}`}
      title={cobranca.protocol ?? undefined}
    >
      {cfg.label}
      {date ? ` · ${date}` : ""}
    </span>
  );
}

// Funil de recuperação do empreendimento (leitura do motor da Cobrança).
function CobrancaFunnel({
  cobranca,
}: {
  cobranca: ApoloEnterpriseCobranca | null;
}) {
  if (!cobranca) {
    return null;
  }

  const f = cobranca.funnel;
  const hasAny =
    f.emNegociacao.count > 0 ||
    f.promessasAtivas.count > 0 ||
    f.acordosAtivos.count > 0 ||
    f.quebradas30d.count > 0 ||
    f.recuperado30d.value > 0;

  if (!hasAny) {
    return null;
  }

  return (
    <section className="rounded-xl border border-line bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <Handshake aria-hidden="true" className="size-4 text-[#A07C3B]" />
        <p className="m-0 text-sm font-semibold text-ink">Cobrança &amp; recuperação</p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <FunnelCard
          hint="promessas pendentes"
          label="Em negociação"
          money={f.emNegociacao}
          tone="text-sky-600 dark:text-sky-400"
        />
        <FunnelCard
          hint="aprovadas"
          label="Promessas ativas"
          money={f.promessasAtivas}
          tone="text-amber-600 dark:text-amber-400"
        />
        <FunnelCard
          hint="aprovados"
          label="Acordos ativos"
          money={f.acordosAtivos}
          tone="text-violet-600 dark:text-violet-400"
        />
        <FunnelCard
          hint="últimos 30 dias"
          label="Quebradas 30d"
          money={f.quebradas30d}
          tone="text-rose-600 dark:text-rose-400"
        />
        <FunnelCard
          hint="parcelas pagas"
          label="Recuperado 30d"
          money={f.recuperado30d}
          tone="text-emerald-600 dark:text-emerald-400"
        />
      </div>
    </section>
  );
}

function FunnelCard({
  hint,
  label,
  money,
  tone,
}: {
  hint: string;
  label: string;
  money: ApoloCobrancaMoney;
  tone: string;
}) {
  return (
    <div className="rounded-lg border border-line bg-subtle/60 p-3">
      <p className="m-0 text-xs font-medium text-ink-muted">{label}</p>
      <p className={`m-0 mt-0.5 text-base font-semibold tabular-nums ${tone}`}>
        {formatCurrency(money.value)}
      </p>
      <p className="m-0 text-[11px] text-ink-muted">
        {money.count} · {hint}
      </p>
    </div>
  );
}

function formatShortDate(value: string): string {
  const date = new Date(value.length <= 10 ? `${value}T00:00:00Z` : value);

  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        timeZone: "UTC",
      });
}

// Modal de negociação (read-only) da unidade: mostra o(s) compromisso(s) do motor
// da Cobrança. Ações (aprovar/comentar/editar) ficam no Hades. Ver [[project-apolo-crm-grafo]].
function CobrancaModal({
  onClose,
  unit,
}: {
  onClose: () => void;
  unit: ApoloCarteiraUnit;
}) {
  const [compromissos, setCompromissos] = useState<
    GuardianCompromissoDetail[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        setError(null);

        const accessToken = await getApoloAccessToken();
        const response = await fetch(
          `/api/apolo/empreendimentos/cobranca/unidade?unitId=${encodeURIComponent(unit.id)}`,
          { cache: "no-store", headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json()) as {
          data?: { compromissos: GuardianCompromissoDetail[] };
          error?: string;
        };

        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Nao foi possivel carregar a negociação.");
        }

        if (active) {
          setCompromissos(payload.data.compromissos);
        }
      } catch (loadError) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Falha ao carregar a negociação.",
          );
        }
      }
    }

    void load();

    return () => {
      active = false;
    };
  }, [unit.id]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[var(--uix-z-modal)] grid place-items-center bg-black/40 p-4">
      <button
        aria-label="Fechar"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
        type="button"
      />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3.5">
          <div className="min-w-0">
            <p className="m-0 flex items-center gap-2 text-sm font-semibold text-ink">
              <Handshake aria-hidden="true" className="size-4 text-[#A07C3B]" />
              Negociação · {unit.code}
            </p>
            {unit.client ? (
              <p className="m-0 mt-0.5 max-w-full truncate text-xs font-medium text-ink-muted">
                {toTitleCase(unit.client.name)}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Fechar"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-subtle hover:text-ink"
            onClick={onClose}
            type="button"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {error ? (
            <p className="m-0 p-6 text-center text-sm font-semibold text-rose-600 dark:text-rose-400">
              {error}
            </p>
          ) : !compromissos ? (
            <div className="h-40 animate-pulse rounded-xl border border-line bg-subtle" />
          ) : compromissos.length === 0 ? (
            <p className="m-0 p-6 text-center text-sm font-medium text-ink-muted">
              Nenhuma negociação registrada para esta unidade.
            </p>
          ) : (
            <div className="grid gap-3">
              {compromissos.map((compromisso) => (
                <CompromissoCard compromisso={compromisso} key={compromisso.id} />
              ))}
            </div>
          )}
        </div>

        <footer className="border-t border-line px-5 py-3">
          <p className="m-0 text-[11px] text-ink-muted">
            Somente leitura. Use "Abrir no Hades" na proposta para aprovar,
            comentar ou editar.
          </p>
        </footer>
      </div>
    </div>
  );
}

function CompromissoCard({
  compromisso,
}: {
  compromisso: GuardianCompromissoDetail;
}) {
  const isAcordo = compromisso.kind === "acordo";

  return (
    <div className="rounded-xl border border-line bg-subtle/40 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-ink">
            {isAcordo ? "Acordo" : "Promessa de pagamento"}
          </span>
          <span className="text-xs font-medium text-ink-muted">
            {compromisso.protocol}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <CompromissoPill kind="status" value={compromisso.status} />
          <CompromissoPill kind="approval" value={compromisso.approvalStatus} />
        </div>
      </div>

      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <MiniFact
          label={isAcordo ? "1º vencimento" : "Data prometida"}
          value={formatDate(
            isAcordo ? compromisso.firstDueDate : compromisso.promisedDate,
          )}
        />
        <MiniFact label="Valor" value={formatCurrency(compromisso.totalAmount)} />
        <MiniFact label="Parcelas" value={String(compromisso.installmentsCount)} />
      </div>

      {compromisso.notes ? (
        <p className="m-0 mt-2 text-xs text-ink-soft">{compromisso.notes}</p>
      ) : null}

      {compromisso.parcelas.length > 0 ? (
        <div className="mt-3">
          <p className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Parcelas
          </p>
          <div className="grid gap-1">
            {compromisso.parcelas.map((parcela) => (
              <div
                className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs"
                key={parcela.id}
              >
                <span className="tabular-nums text-ink-soft">
                  {parcela.sequence}. {formatDate(parcela.dueDate)}
                </span>
                <span className="tabular-nums font-medium text-ink">
                  {formatCurrency(parcela.amount)}
                </span>
                <CompromissoPill kind="parcela" value={parcela.status} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {compromisso.lembretes.length > 0 ? (
        <div className="mt-3">
          <p className="m-0 mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
            Régua de lembretes
          </p>
          <div className="flex flex-wrap gap-1.5">
            {compromisso.lembretes.map((lembrete) => (
              <span
                className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-soft"
                key={lembrete.id}
                title={`${lembrete.status} · ${formatDate(lembrete.scheduledFor)}`}
              >
                {lembrete.kind}
                <span
                  className={
                    lembrete.status === "enviado"
                      ? "text-emerald-500"
                      : lembrete.status === "falhou"
                        ? "text-rose-500"
                        : "text-ink-muted"
                  }
                >
                  ●
                </span>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {/* Deep-link direto NESTA proposta: seleciona o cliente, abre a aba Propostas
          e foca o compromisso (editProposal). */}
      <div className="mt-3 flex justify-end border-t border-line/70 pt-2.5">
        <a
          className="inline-flex items-center gap-1 text-xs font-semibold text-[#7a5e2c] transition-colors hover:underline dark:text-[#d9b877]"
          href={`/guardian/cobranca?clientId=${compromisso.clientC2xId}&tab=propostas&editProposal=${compromisso.id}`}
          rel="noreferrer"
          target="_blank"
        >
          Abrir no Hades
          <ExternalLink aria-hidden="true" className="size-3" />
        </a>
      </div>
    </div>
  );
}

function CompromissoPill({
  kind,
  value,
}: {
  kind: "approval" | "parcela" | "status";
  value: string;
}) {
  const labels: Record<string, string> = {
    a_vencer: "A vencer",
    ativo: "Ativo",
    aprovado: "Aprovado",
    cancelado: "Cancelado",
    cumprido: "Cumprido",
    em_elaboracao: "Rascunho",
    emitida: "Emitida",
    enviada: "Enviada",
    paga: "Paga",
    pendente: "Pendente",
    quebrado: "Quebrado",
    reprovado: "Reprovado",
    vencida: "Vencida",
  };
  const green =
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300";
  const rose =
    "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300";
  const amber =
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/12 dark:text-amber-300";
  const sky =
    "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-500/30 dark:bg-sky-500/12 dark:text-sky-300";
  const gray =
    "border-line bg-subtle text-ink-soft";
  const toneByValue: Record<string, string> = {
    aprovado: green,
    ativo: sky,
    cancelado: gray,
    cumprido: green,
    em_elaboracao: gray,
    paga: green,
    pendente: amber,
    quebrado: rose,
    reprovado: rose,
    vencida: rose,
  };
  const tone = toneByValue[value] ?? (kind === "parcela" ? amber : gray);

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold ${tone}`}
    >
      {labels[value] ?? value}
    </span>
  );
}

function UnitFinancialStatus({ unit }: { unit: ApoloCarteiraUnit }) {
  if (unit.overdueInstallments > 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/12 dark:text-rose-300">
        {unit.overdueInstallments} vencida(s) · {unit.maxOverdueDays}d
      </span>
    );
  }

  return (
    <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-500/12 dark:text-emerald-300">
      Em dia
    </span>
  );
}

function CarteiraCard({
  hint,
  label,
  tone,
  value,
}: {
  hint: string;
  label: string;
  tone: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3.5">
      <p className="m-0 text-xs font-medium text-ink-muted">{label}</p>
      <p className={`m-0 mt-1 text-lg font-semibold tabular-nums ${tone}`}>
        {value}
      </p>
      <p className="m-0 text-[11px] text-ink-muted">{hint}</p>
    </div>
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
