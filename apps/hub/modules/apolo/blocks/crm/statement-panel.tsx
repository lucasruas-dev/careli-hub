"use client";

import {
  ChevronDown,
  ChevronsUpDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  ReceiptText,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Tooltip } from "@repo/uix";
import type { ApoloStatementData, ApoloStatementRow } from "@/lib/apolo/extrato";
import type { ApoloEntity } from "@/lib/apolo/types";

import { entityC2xId } from "../../data/apolo-derive";
import { getApoloAccessToken } from "../../data/apolo-operations";
import { EmptyPanel } from "../shared/apolo-ui";

// Extrato por participante (aba Financeiro de imobiliária/incorporador/corretor). Espelha o
// relatório do C2X: o split dos pagamentos PAGOS onde a entidade é participante. Filtros por
// período e empreendimento. Ver [[project-apolo-acessos-externos]].

function brl(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    currency: "BRL",
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
    style: "currency",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
}

// Período default = ANO corrente. A comissão da imobiliária/corretor cai no ato/sinal (início
// da venda), esporádica — um default de mês deixaria a tela vazia quase sempre. O incorporador
// (mensal) tem todo mês, então o ano cobre bem os dois. O usuário ajusta De/Até se quiser.
function defaultRange() {
  const year = new Date().getFullYear();
  return { end: `${year}-12-31`, start: `${year}-01-01` };
}

export function StatementPanel({ entity }: { entity: ApoloEntity }) {
  const c2xId = entityC2xId(entity);
  const initialRange = useMemo(defaultRange, []);
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [enterprise, setEnterprise] = useState("");
  const [data, setData] = useState<ApoloStatementData | null>(null);
  const [enterpriseOptions, setEnterpriseOptions] = useState<
    { code: string; name: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Filtros e ordenação client-side (sobre as linhas já carregadas — instantâneo).
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ dir: "asc" | "desc"; key: SortKey }>({
    dir: "desc",
    key: "paymentDate",
  });

  useEffect(() => {
    if (c2xId == null) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);
    setTypeFilter("");
    setSearch("");

    (async () => {
      try {
        const token = await getApoloAccessToken();
        const query = new URLSearchParams({ c2xId: String(c2xId), end, start });
        if (enterprise) {
          query.set("enterprise", enterprise);
        }

        const response = await fetch(`/api/apolo/extrato?${query.toString()}`, {
          cache: "no-store",
          headers: { Authorization: `Bearer ${token}` },
        });
        const payload = (await response.json().catch(() => null)) as
          | { data?: ApoloStatementData; error?: string }
          | null;

        if (!active) {
          return;
        }

        if (!response.ok || !payload?.data) {
          setError(payload?.error ?? "Não foi possível carregar o extrato.");
          setData(null);
          return;
        }

        setData(payload.data);
        // Preserva a lista de empreendimentos do recorte sem filtro (não some ao filtrar).
        if (!enterprise) {
          setEnterpriseOptions(payload.data.enterprises);
        }
      } catch {
        if (active) {
          setError("Não foi possível carregar o extrato.");
          setData(null);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [c2xId, start, end, enterprise]);

  const rows = data?.rows ?? [];

  const typeOptions = useMemo(
    () => uniqueSorted(rows.map((row) => row.parcelType)),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const term = normalizeSearch(search);
    const filtered = rows.filter((row) => {
      if (typeFilter && row.parcelType !== typeFilter) {
        return false;
      }
      if (term) {
        const haystack = normalizeSearch(
          `${row.clientName ?? ""} ${row.unitCode} ${row.enterpriseName ?? row.enterpriseCode} ${row.role} ${row.competence ?? ""}`,
        );
        if (!haystack.includes(term)) {
          return false;
        }
      }
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => dir * compareRows(a, b, sort.key));
  }, [rows, typeFilter, search, sort]);

  const total = visibleRows.reduce((sum, row) => sum + row.value, 0);

  if (c2xId == null) {
    return <EmptyPanel text="Cadastro sem vinculo com o C2X para montar o extrato." />;
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-4">
      <header className="flex shrink-0 flex-col gap-4 rounded-xl border border-line bg-surface p-4">
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Recebido" value={brl(total)} />
          <Kpi label="Lançamentos" value={String(visibleRows.length)} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Buscar">
            <div className="relative sm:w-64">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted"
                aria-hidden="true"
              />
              <input
                className="h-9 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Cliente, unidade, empreendimento…"
                type="search"
                value={search}
              />
            </div>
          </Field>
          <Field label="De">
            <input
              className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              max={end}
              onChange={(event) => setStart(event.target.value)}
              type="date"
              value={start}
            />
          </Field>
          <Field label="Até">
            <input
              className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              min={start}
              onChange={(event) => setEnd(event.target.value)}
              type="date"
              value={end}
            />
          </Field>
          <Field label="Empreendimento">
            <select
              className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onChange={(event) => setEnterprise(event.target.value)}
              value={enterprise}
            >
              <option value="">Todos</option>
              {enterpriseOptions.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name ?? item.code}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Tipo">
            <select
              className="h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-[#A07C3B]"
              onChange={(event) => setTypeFilter(event.target.value)}
              value={typeFilter}
            >
              <option value="">Todos</option>
              {typeOptions.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </header>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-line bg-surface p-10 text-sm font-medium text-ink-muted">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Carregando extrato…
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm font-medium text-rose-600 dark:text-rose-300">
          <TriangleAlert className="size-4" aria-hidden="true" />
          {error}
        </div>
      ) : !data || data.rows.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-6 text-sm font-medium text-ink-muted">
          <ReceiptText className="size-4" aria-hidden="true" />
          Nenhum recebimento no período.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[68rem] border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="border-b border-line bg-surface text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <SortableTh label="Pagamento" onSort={setSort} sort={sort} sortKey="paymentDate" />
                <SortableTh label="Empreendimento" onSort={setSort} sort={sort} sortKey="enterprise" />
                <SortableTh label="Unidade" onSort={setSort} sort={sort} sortKey="unit" />
                <SortableTh label="Cliente" onSort={setSort} sort={sort} sortKey="client" />
                <SortableTh label="Tipo" onSort={setSort} sort={sort} sortKey="type" />
                <SortableTh label="Parcela" onSort={setSort} sort={sort} sortKey="parcela" />
                <SortableTh label="Competência" onSort={setSort} sort={sort} sortKey="competence" />
                <SortableTh label="Papel" onSort={setSort} sort={sort} sortKey="role" />
                <SortableTh align="right" label="Valor" onSort={setSort} sort={sort} sortKey="value" />
                <th className="bg-surface px-4 py-3 text-center font-semibold">Comprovante</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-center text-sm font-medium text-ink-muted" colSpan={10}>
                    Nada encontrado nos filtros.
                  </td>
                </tr>
              ) : null}
              {visibleRows.map((row) => (
                <tr className="border-b border-line/60 last:border-0" key={row.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">{formatDate(row.paymentDate)}</td>
                  <td className="px-4 py-3 text-ink">{row.enterpriseName ?? row.enterpriseCode}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className="font-semibold text-ink">{row.unitCode}</span>
                    {row.unitBlock || row.unitLot ? (
                      <span className="ml-2 text-xs text-ink-muted">
                        Q{row.unitBlock ?? "-"}·L{row.unitLot ?? "-"}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{row.clientName ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{row.parcelType}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{row.parcela}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{row.competence ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{row.role}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">{brl(row.value)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-center">
                    {row.asaasId ? (
                      <AsaasCell id={row.asaasId} url={row.asaasUrl} />
                    ) : (
                      <span className="text-ink-muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type SortKey =
  | "client"
  | "competence"
  | "enterprise"
  | "parcela"
  | "paymentDate"
  | "role"
  | "type"
  | "unit"
  | "value";

type SortState = { dir: "asc" | "desc"; key: SortKey };

function SortableTh({
  align = "left",
  label,
  onSort,
  sort,
  sortKey,
}: {
  align?: "left" | "right";
  label: string;
  onSort: (value: SortState) => void;
  sort: SortState;
  sortKey: SortKey;
}) {
  const active = sort.key === sortKey;
  const Icon = !active ? ChevronsUpDown : sort.dir === "asc" ? ChevronUp : ChevronDown;

  return (
    <th className={`bg-surface px-4 py-3 font-semibold ${align === "right" ? "text-right" : ""}`}>
      <button
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-ink ${
          align === "right" ? "flex-row-reverse" : ""
        } ${active ? "text-ink" : ""}`}
        onClick={() =>
          onSort(
            active
              ? { dir: sort.dir === "asc" ? "desc" : "asc", key: sortKey }
              : { dir: "asc", key: sortKey },
          )
        }
        type="button"
      >
        {label}
        <Icon className={`size-3.5 ${active ? "text-[#A07C3B]" : "text-ink-muted/50"}`} aria-hidden="true" />
      </button>
    </th>
  );
}

function compareRows(a: ApoloStatementRow, b: ApoloStatementRow, key: SortKey): number {
  if (key === "value") {
    return a.value - b.value;
  }
  if (key === "competence") {
    return competenceKey(a.competence) - competenceKey(b.competence);
  }
  if (key === "paymentDate") {
    return a.paymentDate.localeCompare(b.paymentDate);
  }
  return rowText(a, key).localeCompare(rowText(b, key), "pt-BR", { numeric: true });
}

function rowText(row: ApoloStatementRow, key: SortKey): string {
  switch (key) {
    case "client":
      return row.clientName ?? "";
    case "enterprise":
      return row.enterpriseName ?? row.enterpriseCode;
    case "parcela":
      return row.parcela;
    case "role":
      return row.role;
    case "type":
      return row.parcelType;
    case "unit":
      return row.unitCode;
    default:
      return "";
  }
}

// "MM/YYYY" -> AAAAMM (número comparável). Vazio = 0.
function competenceKey(value: string | null): number {
  const match = value ? /^(\d{2})\/(\d{4})$/.exec(value) : null;
  return match ? Number(match[2]) * 100 + Number(match[1]) : 0;
}

function normalizeSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
}

function uniqueSorted(values: string[], mode?: "competence"): string[] {
  const unique = Array.from(new Set(values.filter(Boolean)));
  if (mode === "competence") {
    return unique.sort((a, b) => competenceKey(b) - competenceKey(a));
  }
  return unique.sort((a, b) => a.localeCompare(b, "pt-BR", { numeric: true }));
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </p>
      <p className="m-0 mt-1 text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

// Célula do comprovante: um ícone que abre a cobrança/comprovante no Asaas. O código pay_…
// fica no tooltip (não polui a tabela). Ver [[project-apolo-empreendimento-tela]].
function AsaasCell({ id, url }: { id: string; url: string | null }) {
  if (!url) {
    return <span className="text-ink-muted">-</span>;
  }

  return (
    <Tooltip content={`Comprovante no Asaas (${id})`}>
      <a
        aria-label="Abrir comprovante no Asaas"
        className="inline-flex size-8 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7a5e2c] transition-colors hover:bg-[#A07C3B]/10 dark:text-[#d9b877]"
        href={url}
        rel="noreferrer"
        target="_blank"
      >
        <ExternalLink className="size-4" aria-hidden="true" />
      </a>
    </Tooltip>
  );
}
