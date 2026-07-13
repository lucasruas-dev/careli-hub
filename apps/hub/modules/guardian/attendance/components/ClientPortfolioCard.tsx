/* eslint-disable */
// @ts-nocheck
import { MapPinned } from "lucide-react";
import { DetailSection } from "@/modules/guardian/attendance/components/DetailSection";
import type { QueueClient } from "@/modules/guardian/attendance/types";

type ClientPortfolioCardProps = {
  client: QueueClient;
  selectedUnitId: string;
  onSelectUnit: (unitId: string) => void;
};

export function ClientPortfolioCard({
  client,
  selectedUnitId,
  onSelectUnit,
}: ClientPortfolioCardProps) {
  return (
    <DetailSection title="Carteira do cliente" icon={MapPinned}>
      <div className="grid gap-3 sm:grid-cols-2">
        <InfoBlock label="Unidades/lotes" value={`${client.carteira.unidades.length}`} />
        <InfoBlock label="Imobiliária/corretor" value={client.carteira.imobiliariaCorretor} />
      </div>

      <div className="mt-4 space-y-3">
        {client.carteira.unidades.map((unit) => (
          <button
            type="button"
            key={unit.id}
            onClick={() => onSelectUnit(unit.id)}
            className={`w-full rounded-xl border p-4 text-left transition-colors ${
              selectedUnitId === unit.id
                ? "border-[#A07C3B]/30 bg-[#A07C3B]/5"
                : "border-line/70 bg-subtle/60 hover:border-[#A07C3B]/20 hover:bg-[#A07C3B]/5"
            }`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">{unit.empreendimento}</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Quadra {unit.quadra} · Lote {formatLote(unit.lote)} · {unit.area}
                </p>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <CompactInfo label="Cod. unidade" value={unit.matricula} />
              <CompactInfo label="Valor de tabela" value={unit.valorTabela} />
              <div className="min-w-0 rounded-lg bg-surface px-3 py-2 ring-1 ring-line/70">
                <p className="text-xs font-medium text-ink-muted">Status</p>
                <span className="mt-1 inline-flex rounded-full border border-[#A07C3B]/15 bg-[#A07C3B]/5 px-2.5 py-1 text-xs font-medium text-[#7A5E2C] dark:text-[#d9b877]">
                  {unit.statusVenda}
                </span>
              </div>
            </div>
          </button>
        ))}
      </div>
    </DetailSection>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line/70 bg-subtle/60 px-3 py-2.5">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function CompactInfo({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-surface px-3 py-2 ring-1 ring-line/70">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function formatLote(lote: string) {
  return lote.replace(/^L/i, "");
}




