"use client";

import { Check, Copy, ExternalLink, Loader2, ReceiptText, TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Tooltip } from "@repo/uix";
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
          <table className="w-full min-w-[56rem] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-3 font-semibold">Pagamento</th>
                <th className="px-4 py-3 font-semibold">Empreendimento</th>
                <th className="px-4 py-3 font-semibold">Unidade</th>
                <th className="px-4 py-3 font-semibold">Cliente</th>
                <th className="px-4 py-3 font-semibold">Parcela</th>
                <th className="px-4 py-3 font-semibold">Papel</th>
                <th className="px-4 py-3 text-right font-semibold">Recebido</th>
                <th className="px-4 py-3 text-right font-semibold">Líquido</th>
                <th className="px-4 py-3 font-semibold">Cobrança (Asaas)</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
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
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{row.parcela}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-ink-soft">{row.role}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">{brl(row.grossValue)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-ink">{brl(row.netValue)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {row.asaasId ? (
                      <AsaasCell
                        id={row.asaasId}
                        receiptUrl={row.asaasInvoiceUrl}
                        url={row.asaasUrl}
                      />
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

// Célula do rastreio no Asaas: o ID da cobrança (pay_…) visível pra copiar e buscar no painel
// do Asaas, + copiar, comprovante (PDF) e link pra abrir a cobrança.
function AsaasCell({
  id,
  receiptUrl,
  url,
}: {
  id: string;
  receiptUrl: string | null;
  url: string | null;
}) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(id).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="flex items-center gap-1.5">
      <code className="rounded bg-subtle px-2 py-1 text-xs text-ink-soft">{id}</code>
      <Tooltip content={copied ? "Copiado!" : "Copiar código"}>
        <button
          aria-label="Copiar código do Asaas"
          className="inline-flex size-7 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-[#A07C3B]/40 hover:text-[#7a5e2c] dark:hover:text-[#d9b877]"
          onClick={copy}
          type="button"
        >
          {copied ? (
            <Check className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
          ) : (
            <Copy className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </Tooltip>
      {receiptUrl ? (
        <Tooltip content="Comprovante (PDF)">
          <a
            aria-label="Comprovante de pagamento"
            className="inline-flex size-7 items-center justify-center rounded-lg border border-line text-ink-muted transition-colors hover:border-[#A07C3B]/40 hover:text-[#7a5e2c] dark:hover:text-[#d9b877]"
            href={receiptUrl}
            rel="noreferrer"
            target="_blank"
          >
            <ReceiptText className="size-3.5" aria-hidden="true" />
          </a>
        </Tooltip>
      ) : null}
      {url ? (
        <Tooltip content="Abrir cobrança no Asaas">
          <a
            aria-label="Abrir cobrança no Asaas"
            className="inline-flex size-7 items-center justify-center rounded-lg border border-[#A07C3B]/20 bg-[#A07C3B]/5 text-[#7a5e2c] transition-colors hover:bg-[#A07C3B]/10 dark:text-[#d9b877]"
            href={url}
            rel="noreferrer"
            target="_blank"
          >
            <ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
        </Tooltip>
      ) : null}
    </div>
  );
}
