"use client";

import { CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";

import type { GrupoDeAssinatura, UnidadeComAssinatura } from "@/lib/apolo/unidades-assinatura";

// OS CONTRATOS POR UNIDADE — uma barra por perfil, no painel interno.
//
// Pedido do Lucas (25/08/2026): *"vamos deixar igual temos no perfil dos incorporadores, aquele
// mesmo esquema de barras, ao clicar abrir as assinaturas e os indicadores"* e, sobre replicar
// aqui: *"pode seguir o mesmo padrão que fizemos no perfil do incorporador"*.
//
// ⚠️ A RÉGUA POR PERFIL, NÃO UMA BARRA DE PROGRESSO. Foi o erro do primeiro porte: uma barra única
// responde "quanto falta", mas a pergunta que faz alguém agir é "QUEM está segurando". Cada perfil
// do contrato tem a sua barra, e a do perfil parado ganha o anel.
//
// ⚠️ SÓ OS PERFIS DAQUELE CONTRATO desenham barra. Perfil que não assina ali não vira barra vazia,
// porque barra vazia diz "falta alguém" de quem nunca foi chamado.
//
// ⚠️ MESMO DESENHO, OUTRA PALETA. O gêmeo público (modules/publico/painel/unidades-com-barra.tsx)
// pinta com cores fixas, porque roda fora do hub. Aqui as classes são as do chrome, que seguem o
// tema claro/escuro — trocar uma pela outra deixa texto de um tema no fundo do outro.

const num = (n: number) => n.toLocaleString("pt-BR");
const dataCurta = (iso: null | string) =>
  iso ? iso.slice(0, 10).split("-").reverse().join("/").slice(0, 5) : "—";

/** "há 17 dias" a partir de uma data ISO curta. */
function rotuloDeEspera(iso: null | string): string {
  if (!iso) return "sem data de envio";
  const dias = Math.round(
    (Date.now() - new Date(`${iso.slice(0, 10)}T12:00:00`).getTime()) / 86_400_000,
  );
  if (dias <= 0) return "hoje";
  if (dias === 1) return "há 1 dia";
  return `há ${num(dias)} dias`;
}

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
        Nenhum contrato neste recorte.
      </p>
    );
  }

  return (
    <div className="grid gap-2">
      {unidades.map((unidade) => {
        const aberta = abertas.has(unidade.un);
        const percentual =
          unidade.total > 0 ? Math.round((100 * unidade.assinadas) / unidade.total) : 0;

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
              <div className="grid grid-cols-[minmax(140px,1.1fr)_minmax(0,2fr)_minmax(112px,auto)] items-center gap-3.5">
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
                  <span className="ml-5 block truncate text-[11.5px] text-ink-soft">
                    {unidade.nomes || "comprador não registrado no envio"}
                  </span>
                </span>

                {unidade.grupos.length === 0 ? (
                  <span className="text-xs text-ink-soft">
                    Nenhum assinante ficou registrado neste envio.
                  </span>
                ) : (
                  <span
                    className="grid gap-2.5"
                    style={{
                      gridTemplateColumns: `repeat(${unidade.grupos.length}, minmax(0, 1fr))`,
                    }}
                  >
                    {unidade.grupos.map((grupo) => (
                      <BarraDoPerfil grupo={grupo} key={grupo.perfil} />
                    ))}
                  </span>
                )}

                <span className="min-w-0 text-right">
                  <span className="block text-[13px] font-bold tabular-nums text-ink">
                    {num(unidade.assinadas)} de {num(unidade.total)}
                    <span className="font-medium text-ink-soft"> · {percentual}%</span>
                  </span>
                  {/* ⚠️ QUEM SEGURA E HÁ QUANTO TEMPO: a informação que a coluna "Agora espera"
                      tentava dar espremida entre nomes cortados. */}
                  {unidade.concluida ? (
                    <span className="mt-0.5 inline-flex items-center gap-1 text-[11.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                      <CheckCircle2 aria-hidden="true" size={13} />
                      contrato completo
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[11.5px] text-ink-soft">
                      com <b className="font-semibold">{unidade.perfisNaVez.join(", ") || "—"}</b> ·{" "}
                      {rotuloDeEspera(unidade.envio)}
                    </span>
                  )}
                </span>
              </div>
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

/**
 * A barra de UM perfil dentro do contrato.
 *
 * ⚠️ O ANEL SÓ NO PERFIL DA VEZ. É ele que faz a linha ler "falta o Backoffice" de relance, sem
 * ninguém comparar frações. Os perfis que ainda nem foram chamados ficam esmaecidos: eles não devem
 * nada agora, e destacá-los espalharia a culpa por quem não tem culpa.
 */
function BarraDoPerfil({ grupo }: { grupo: GrupoDeAssinatura }) {
  const completo = grupo.assinadas >= grupo.total;
  const percentual = grupo.total > 0 ? (100 * grupo.assinadas) / grupo.total : 0;
  const tinta = completo ? "bg-emerald-600 dark:bg-emerald-400" : grupo.naVez ? "bg-ink" : "bg-ink-soft";

  return (
    <span
      className={`block min-w-0 ${completo || grupo.naVez ? "opacity-100" : "opacity-55"}`}
      title={`${grupo.perfil}: ${grupo.assinadas} de ${grupo.total}`}
    >
      <span
        className={`mb-1 block truncate text-[10.5px] ${
          grupo.naVez && !completo ? "font-bold text-ink" : "font-medium text-ink-soft"
        }`}
      >
        {grupo.perfil}
      </span>
      <span
        aria-hidden="true"
        className={`block h-1.5 overflow-hidden rounded-full bg-black/[0.07] dark:bg-white/[0.1] ${
          grupo.naVez && !completo ? "ring-[1.5px] ring-ink" : ""
        }`}
      >
        <i className={`block h-full ${tinta}`} style={{ width: `${percentual}%` }} />
      </span>
      <span className="mt-0.5 block text-[10.5px] tabular-nums text-ink-soft">
        {num(grupo.assinadas)} de {num(grupo.total)}
      </span>
    </span>
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
