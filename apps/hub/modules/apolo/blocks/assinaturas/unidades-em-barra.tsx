"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { UnidadeComAssinatura } from "@/lib/apolo/unidades-assinatura";

// AS UNIDADES COM O COMPRADOR ASSINADO — em barras, no painel interno.
//
// Pedido do Lucas (25/08/2026): *"o pessoal está reclamando muito sobre a disposição das
// assinaturas, está difícil de entender. Vamos deixar igual temos no perfil dos incorporadores,
// aquele mesmo esquema de barras, ao clicar abrir as assinaturas e os indicadores"* — e, sobre
// replicar aqui: *"pode seguir o mesmo padrão que fizemos no perfil do incorporador"*.
//
// ⚠️ MESMO DESENHO, OUTRA PALETA. O gêmeo público (modules/publico/painel/unidades-com-barra.tsx)
// pinta com as cores fixas da tela do coordenador, que roda fora do hub. Aqui as classes são as do
// chrome (`bg-surface`, `text-ink`), que seguem o tema claro/escuro do hub — trocar uma pela outra
// deixa texto de um tema no fundo do outro.
//
// ⚠️ O CÁLCULO NÃO VIVE AQUI. Os dois painéis leem de lib/apolo/unidades-assinatura.ts, que tem os
// testes: eles mostram a MESMA lista para as MESMAS pessoas, e divergirem seria um bug invisível.

const num = (n: number) => n.toLocaleString("pt-BR");
const dataCurta = (iso: null | string) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/").slice(0, 5) : "—";

export function UnidadesEmBarra({ unidades }: { unidades: UnidadeComAssinatura[] }) {
  const [abertas, setAbertas] = useState<Set<string>>(new Set());

  const alternar = (un: string) =>
    setAbertas((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(un)) proximo.delete(un);
      else proximo.add(un);
      return proximo;
    });

  if (unidades.length === 0) {
    return (
      <p className="rounded-xl border border-dashed border-black/[0.12] p-8 text-center text-sm text-ink-soft dark:border-white/[0.12]">
        Nenhuma unidade com o comprador assinado neste recorte.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {unidades.map((unidade) => {
        const aberta = abertas.has(unidade.un);
        const percentual =
          unidade.total > 0 ? Math.round((100 * unidade.assinadas) / unidade.total) : 0;
        const completa = unidade.degrau === null;

        return (
          <div
            className="overflow-hidden rounded-xl border border-black/[0.08] bg-surface dark:border-white/[0.08]"
            key={unidade.un}
          >
            <button
              aria-expanded={aberta}
              className="block w-full px-3.5 py-3 text-left transition-colors hover:bg-subtle"
              onClick={() => alternar(unidade.un)}
              type="button"
            >
              <div className="grid grid-cols-[minmax(0,1fr)_minmax(130px,240px)_auto] items-center gap-3">
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-sm font-bold text-ink">
                    {aberta ? (
                      <ChevronDown aria-hidden="true" className="shrink-0 text-ink-soft" size={14} />
                    ) : (
                      <ChevronRight
                        aria-hidden="true"
                        className="shrink-0 text-ink-soft"
                        size={14}
                      />
                    )}
                    {unidade.un}
                  </span>
                  {/* O comprador trunca; quem procura unidade acha pela unidade. */}
                  <span className="ml-5 block truncate text-xs text-ink-soft">{unidade.nomes}</span>
                </span>

                <span>
                  <span className="mb-1 block text-[11.5px] text-ink-soft">
                    {num(unidade.assinadas)} de {num(unidade.total)} assinaturas
                  </span>
                  <span
                    aria-hidden="true"
                    className="block h-2 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.1]"
                  >
                    <i
                      className={`block h-full ${completa ? "bg-emerald-600 dark:bg-emerald-400" : "bg-ink"}`}
                      style={{ width: `${percentual}%` }}
                    />
                  </span>
                </span>

                <span className="min-w-[86px] text-right">
                  <span
                    className={`block text-[15px] font-bold tabular-nums ${completa ? "text-emerald-600 dark:text-emerald-400" : "text-ink"}`}
                  >
                    {percentual}%
                  </span>
                  <span className="block text-[11px] text-ink-soft">
                    {completa ? "completo" : `degrau ${unidade.degrau}`}
                  </span>
                </span>
              </div>

              {/* ⚠️ A LINHA QUE A TABELA NÃO DAVA: quem está com a bola AGORA, por extenso. Era a
                  coluna "Agora espera", espremida com três, quatro nomes cortados no meio. */}
              {!completa && unidade.esperando.length > 0 ? (
                <p className="m-0 ml-5 mt-2 text-xs text-ink-soft">
                  <span className="opacity-70">Agora espera:</span> {unidade.esperando.join(", ")}
                </p>
              ) : null}
            </button>

            {aberta ? (
              <div className="border-t border-black/[0.07] px-3.5 pb-3.5 pt-3 dark:border-white/[0.07]">
                <div className="mb-3 grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(112px,1fr))]">
                  <Indicador rotulo="Enviado em" valor={dataCurta(unidade.envio)} />
                  <Indicador rotulo="Comprador assinou" valor={dataCurta(unidade.ultima)} />
                  <Indicador
                    rotulo="Dias até assinar"
                    valor={unidade.dias === null ? "—" : num(unidade.dias)}
                  />
                  <Indicador
                    rotulo="Faltam assinar"
                    valor={num(Math.max(unidade.total - unidade.assinadas, 0))}
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.06em] text-ink-soft">
                        <th className="border-b border-black/[0.07] px-2 py-1.5 text-left font-semibold dark:border-white/[0.07]">
                          Degrau
                        </th>
                        <th className="border-b border-black/[0.07] px-2 py-1.5 text-left font-semibold dark:border-white/[0.07]">
                          Assinante
                        </th>
                        <th className="border-b border-black/[0.07] px-2 py-1.5 text-left font-semibold dark:border-white/[0.07]">
                          Perfil
                        </th>
                        <th className="border-b border-black/[0.07] px-2 py-1.5 text-left font-semibold dark:border-white/[0.07]">
                          Situação
                        </th>
                        <th className="border-b border-black/[0.07] px-2 py-1.5 text-right font-semibold dark:border-white/[0.07]">
                          Assinou em
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {unidade.assinantes.map((assinante, indice) => (
                        <tr key={`${assinante.contrato}-${assinante.email}-${indice}`}>
                          <td className="w-14 border-b border-black/[0.05] px-2 py-1.5 align-top text-ink-soft dark:border-white/[0.05]">
                            {assinante.degrau || "—"}
                          </td>
                          <td className="border-b border-black/[0.05] px-2 py-1.5 align-top text-ink dark:border-white/[0.05]">
                            {assinante.usuario}
                            <span className="block text-[11px] text-ink-soft">
                              {assinante.email}
                            </span>
                          </td>
                          <td className="border-b border-black/[0.05] px-2 py-1.5 align-top text-ink-soft dark:border-white/[0.05]">
                            {assinante.perfil}
                          </td>
                          <td className="border-b border-black/[0.05] px-2 py-1.5 align-top dark:border-white/[0.05]">
                            <SeloDaSituacao situacao={assinante.situacao} />
                          </td>
                          <td className="border-b border-black/[0.05] px-2 py-1.5 text-right align-top tabular-nums text-ink-soft dark:border-white/[0.05]">
                            {dataCurta(assinante.assinadoEm)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function SeloDaSituacao({ situacao }: { situacao: "aguardando" | "assinado" | "vez" }) {
  const estilo =
    situacao === "assinado"
      ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : situacao === "vez"
        ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : "bg-black/[0.06] text-ink-soft dark:bg-white/[0.08]";

  const rotulo =
    situacao === "assinado" ? "Assinou" : situacao === "vez" ? "É a vez" : "Aguardando";

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${estilo}`}>
      {rotulo}
    </span>
  );
}

function Indicador({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.06em] text-ink-soft">
        {rotulo}
      </p>
      <p className="m-0 mt-0.5 text-sm font-bold tabular-nums text-ink">{valor}</p>
    </div>
  );
}
