"use client";

import { Loader2, ReceiptText, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { ApoloStatementData } from "@/lib/apolo/extrato";
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

function monthRange() {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const iso = (date: Date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return { end: iso(last), start: iso(first) };
}

export function StatementPanel({ entity }: { entity: ApoloEntity }) {
  const c2xId = entityC2xId(entity);
  const initialRange = useMemo(monthRange, []);
  const [start, setStart] = useState(initialRange.start);
  const [end, setEnd] = useState(initialRange.end);
  const [enterprise, setEnterprise] = useState("");
  const [data, setData] = useState<ApoloStatementData | null>(null);
  const [enterpriseOptions, setEnterpriseOptions] = useState<
    { code: string; name: string | null }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (c2xId == null) {
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

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

  if (c2xId == null) {
    return <EmptyPanel text="Cadastro sem vinculo com o C2X para montar o extrato." />;
  }

  const summary = data?.summary;

  return (
    <section className="grid gap-4">
      <header className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Kpi label="Recebido (bruto)" value={brl(summary?.gross ?? 0)} />
          <Kpi label="Líquido" value={brl(summary?.net ?? 0)} />
          <Kpi label="Lançamentos" value={String(summary?.count ?? 0)} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
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
        <div className="overflow-x-auto rounded-xl border border-line bg-surface">
          <table className="w-full min-w-[46rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 font-semibold">Pagamento</th>
                <th className="px-4 py-3 font-semibold">Empreendimento</th>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Parcela</th>
                <th className="px-4 py-3 font-semibold">Papel</th>
                <th className="px-4 py-3 text-right font-semibold">Recebido</th>
                <th className="px-4 py-3 text-right font-semibold">Líquido</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr className="border-b border-line/60 last:border-0" key={row.id}>
                  <td className="whitespace-nowrap px-4 py-3 text-ink">{formatDate(row.paymentDate)}</td>
                  <td className="px-4 py-3 text-ink">{row.enterpriseName ?? row.enterpriseCode}</td>
                  <td className="px-4 py-3 text-ink-soft">{row.clientName ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{row.parcela}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{row.role}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">{brl(row.grossValue)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">{brl(row.netValue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
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
