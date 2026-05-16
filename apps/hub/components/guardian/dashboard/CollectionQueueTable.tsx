/* eslint-disable */
// @ts-nocheck
export type DashboardQueueItem = {
  cliente: string;
  empreendimento: string;
  unidadeLote: string;
  atraso: string;
  saldo: string;
  risco: string;
  responsavel: string;
  status: string;
};

const riskStyles: Record<string, string> = {
  Crítica: "bg-rose-50 text-rose-700 ring-rose-100",
  Alta: "bg-[#A07C3B]/8 text-[#7A5E2C] ring-[#A07C3B]/15",
  Média: "bg-slate-50 text-slate-700 ring-slate-200",
  Baixa: "bg-slate-50 text-slate-500 ring-slate-200",
};

export function CollectionQueueTable({ items }: { items: DashboardQueueItem[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex flex-col gap-3 border-b border-slate-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Fila prioritária</h2>
          <p className="mt-1 text-sm text-slate-500">Clientes e lotes priorizados por risco, atraso e saldo.</p>
        </div>
        <button
          type="button"
          className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:border-[#A07C3B]/30 hover:bg-[#A07C3B]/5 hover:text-slate-950"
        >
          Ver fila completa
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50/70 text-xs uppercase tracking-normal text-slate-500">
            <tr>
              <th className="px-5 py-3 font-medium">Cliente</th>
              <th className="px-5 py-3 font-medium">Empreendimento</th>
              <th className="px-5 py-3 font-medium">Unidade/Lote</th>
              <th className="px-5 py-3 font-medium">Atraso</th>
              <th className="px-5 py-3 font-medium">Saldo</th>
              <th className="px-5 py-3 font-medium">Risco</th>
              <th className="px-5 py-3 font-medium">Responsável</th>
              <th className="px-5 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {items.map((item) => (
              <tr key={`${item.cliente}-${item.unidadeLote}`} className="transition-colors hover:bg-slate-50/60">
                <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-950">{item.cliente}</td>
                <td className="whitespace-nowrap px-5 py-4 text-slate-600">{item.empreendimento}</td>
                <td className="whitespace-nowrap px-5 py-4 text-slate-600">{item.unidadeLote}</td>
                <td className="whitespace-nowrap px-5 py-4 text-slate-600">{item.atraso}</td>
                <td className="whitespace-nowrap px-5 py-4 font-medium text-slate-900">{item.saldo}</td>
                <td className="whitespace-nowrap px-5 py-4">
                  <span
                    className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                      riskStyles[item.risco]
                    }`}
                  >
                    {item.risco}
                  </span>
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-slate-600">{item.responsavel}</td>
                <td className="whitespace-nowrap px-5 py-4 text-slate-600">{item.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}




