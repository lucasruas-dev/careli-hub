"use client";

import { Layers } from "lucide-react";

import type { ApoloEnterpriseRow } from "@/lib/apolo/empreendimentos";

// AS ETAPAS DO PRODUTO CONSOLIDADO — e quantas unidades cada uma tem.
//
// Lucas (07/09/2026), na ficha do Lagoa Bonita: *"acho que pode até vir aqui uma aba filhos"*,
// *"trazer os filhos com suas respectivas unidades"*.
//
// ⚠️ A FICHA CONSOLIDADA ESCONDE DE ONDE VEM O NÚMERO. O topo do Lagoa Bonita diz 412 unidades, e
// esse 412 é a soma de LBF, LBP e LBR — três empreendimentos no C2X que a tela junta numa linha só.
// Quem olha a ficha não tem como saber que são três, nem quanto cada um pesa; e é justamente por
// etapa que o estoque acaba e a venda muda de comportamento.
//
// ⚠️ ESTA ABA SÓ EXISTE NO PRODUTO AGRUPADO. Um empreendimento simples não tem etapa nenhuma, e uma
// aba vazia dizendo "nenhum filho" seria uma pergunta que a tela faz e responde sozinha.
//
// ⚠️ E ELA NÃO É A CATEGORIA. A etapa é como o LEGADO dividia um empreendimento — criar três
// produtos para separar o que é um só. A categoria (Condomínio, Loteamento) é o recorte nosso, e
// atravessa as etapas: *"o Condomínio e o Loteamento não interfere nos filhos, é tudo junto"*.

const inteiro = (n: number) => n.toLocaleString("pt-BR");

const dinheiro = (n: number) =>
  n.toLocaleString("pt-BR", { currency: "BRL", maximumFractionDigits: 0, style: "currency" });

export function FilhosTab({ row }: { row: ApoloEnterpriseRow }) {
  const etapas = row.stages;

  if (etapas.length === 0) {
    return (
      <p className="m-0 p-5 text-sm text-ink-muted">
        {row.name} não tem etapas: é um empreendimento único no C2X.
      </p>
    );
  }

  const total = etapas.reduce((soma, e) => soma + e.scenario.total.units, 0);

  return (
    <div className="grid gap-4 p-5">
      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="flex items-start gap-3 border-b border-line bg-subtle/40 px-4 py-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-inverse text-brand-ink">
            <Layers aria-hidden="true" className="size-4" />
          </span>
          <div className="min-w-0">
            <h4 className="m-0 text-sm font-semibold text-ink">
              As {etapas.length} etapas de {row.name}
            </h4>
            <p className="m-0 mt-0.5 text-xs text-ink-muted">
              {inteiro(total)} unidades no total. Cada etapa é um empreendimento no C2X — é assim
              que o legado dividia um produto. As categorias, quando existem, atravessam as três.
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-subtle/30 text-left text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                <th className="px-4 py-2.5">Etapa</th>
                <th className="px-3 py-2.5 text-right">Unidades</th>
                <th className="px-3 py-2.5 text-right">Disponível</th>
                <th className="px-3 py-2.5 text-right">Vendido</th>
                <th className="px-3 py-2.5 text-right">Bloqueado</th>
                <th className="px-4 py-2.5 text-right">VGV</th>
              </tr>
            </thead>
            <tbody>
              {etapas.map((etapa) => (
                <tr className="border-b border-line/70 last:border-b-0" key={etapa.id}>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-xs text-ink-muted">{etapa.code}</span>
                    <span className="ml-2 text-sm font-semibold text-ink">{etapa.name}</span>
                    {etapa.city ? (
                      <span className="ml-2 text-xs text-ink-muted">{etapa.city}</span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {inteiro(etapa.scenario.total.units)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-400">
                    {inteiro(etapa.scenario.disponivel.units)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-sky-700 dark:text-sky-400">
                    {inteiro(etapa.scenario.vendido.units)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-rose-700 dark:text-rose-400">
                    {inteiro(etapa.scenario.bloqueado.units)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {dinheiro(etapa.scenario.total.value)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-line bg-subtle/30 text-sm font-semibold">
                <td className="px-4 py-2.5">Total</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{inteiro(total)}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {inteiro(row.scenario.disponivel.units)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {inteiro(row.scenario.vendido.units)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">
                  {inteiro(row.scenario.bloqueado.units)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {dinheiro(row.scenario.total.value)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}
