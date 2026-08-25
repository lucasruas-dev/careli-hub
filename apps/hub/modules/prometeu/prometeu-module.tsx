"use client";

import {
  Activity,
  BarChart3,
  ChevronRight,
  Flame,
  LandPlot,
  ListOrdered,
  PanelLeftClose,
  PanelLeftOpen,
  Printer,
  Settings,
  TabletSmartphone,
  Tag,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";
import { rotuloDoLancamento } from "@/lib/prometeu/lancamento";
import type { PrometeuEvento } from "@/lib/prometeu/types";
import { useHubTheme } from "@/providers/theme-provider";

import { fetchEventos } from "./data/prometeu-operations";
import { LancamentoProvider } from "./lancamento-contexto";
import { CentralView } from "./blocks/central/central-view";
import { AtendenteView } from "./blocks/atendente/atendente-view";
import { EtiquetaView } from "./blocks/etiqueta/etiqueta-view";
import { FilaView } from "./blocks/fila/fila-view";
import { PostoPaView } from "./blocks/pa/posto-pa-view";
import { ReservaView } from "./blocks/reserva/reserva-view";
import { RelatoriosView } from "./blocks/relatorios/relatorios-view";
import { SelecaoDeLancamento } from "./blocks/selecao/selecao-lancamento";
import { SetupView } from "./blocks/setup/setup-view";

// Prometeu no hub: rail escuro de telas a esquerda + conteudo a direita, AGRUPADO POR
// LANÇAMENTO (Lucas, 24/08): o lançamento ativo aparece no topo do rail e as telas se
// organizam em grupos — Fila (Fila do lançamento, Etiquetas), Atendimento (Secretária,
// Reserva, Impressão da PA) e o geral (Monitoramento, Setup). O Telão saiu do rail: mora no
// Setup, que é onde o link público nasce.
//
// ⚠️ LOCUTOR DESATIVADO (21/08) — dependia de TTS local que nunca existiu em produção.

type PrometeuScreen = {
  // Tela React de verdade. Quando presente, ganha do `file`.
  component?: () => React.JSX.Element;
  file: string;
  icon: LucideIcon;
  id: string;
  label: string;
};

type PrometeuGrupo = {
  telas: readonly PrometeuScreen[];
  titulo: null | string;
};

const GRUPOS: readonly PrometeuGrupo[] = [
  {
    telas: [
      {
        // Fila do EVENTO (antes do check-in): ordem do PIX + ajuste manual do organizador.
        component: FilaView,
        file: "cockpit.html",
        icon: ListOrdered,
        id: "fila",
        label: "Fila do lançamento",
      },
      {
        component: EtiquetaView,
        file: "etiqueta.html",
        icon: Tag,
        id: "etiqueta",
        label: "Etiquetas",
      },
    ],
    titulo: "Fila",
  },
  {
    telas: [
      {
        // A mesa da secretaria: chama da fila, recebe, LANÇA A PROPOSTA e conclui.
        component: AtendenteView,
        file: "atendente.html",
        icon: TabletSmartphone,
        id: "atendente",
        label: "Secretária",
      },
      {
        // A posição de reserva (monitor touch): bipa etiqueta → quadras → lotes → cupom.
        component: ReservaView,
        file: "cockpit.html",
        icon: LandPlot,
        id: "reserva",
        label: "Reserva",
      },
      {
        // O posto que bipa o cupom e imprime as folhas de PA (uma por unidade).
        component: PostoPaView,
        file: "cockpit.html",
        icon: Printer,
        id: "pa",
        label: "Impressão da PA",
      },
    ],
    titulo: "Atendimento",
  },
  {
    telas: [
      {
        component: CentralView,
        file: "cockpit.html",
        icon: Activity,
        id: "central",
        label: "Monitoramento",
      },
      {
        // Os dois relatórios do lançamento (comercial e performance) com link público.
        component: RelatoriosView,
        file: "cockpit.html",
        icon: BarChart3,
        id: "relatorios",
        label: "Relatórios",
      },
    ],
    titulo: "Inteligência de dados",
  },
  {
    telas: [
      {
        component: SetupView,
        file: "setup.html",
        icon: Settings,
        id: "setup",
        label: "Setup",
      },
    ],
    titulo: null,
  },
];

const ALL_SCREENS: readonly PrometeuScreen[] = GRUPOS.flatMap((g) => g.telas);

// A escolha sobrevive à navegação da aba (F5 volta aqui e reencontra o lançamento), mas cada
// aba tem a sua — é o que permite dois lançamentos SIMULTÂNEOS, um por posto/aba.
const CHAVE_SELECAO = "prometeu:lancamento";

export function PrometeuModule() {
  const [activeId, setActiveId] = useState<string>("central");
  // Menu recolhido: encolhe a lateral para só os ícones, dando mais tela para o atendimento.
  const [menuRecolhido, setMenuRecolhido] = useState(false);
  // O LANÇAMENTO SELECIONADO na tela inicial: todas as telas abaixo obedecem a ele.
  const [lancamento, setLancamento] = useState<null | PrometeuEvento>(null);
  const [restaurando, setRestaurando] = useState(true);
  const { mode } = useHubTheme();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const active =
    ALL_SCREENS.find((screen) => screen.id === activeId) ?? ALL_SCREENS[0];

  // Restaura a seleção da aba (sessionStorage) validando contra a lista atual — lançamento
  // arquivado no meio do caminho não volta selecionado.
  useEffect(() => {
    let vivo = true;
    const salvo = window.sessionStorage.getItem(CHAVE_SELECAO);
    if (!salvo) {
      setRestaurando(false);
      return;
    }
    void fetchEventos().then((r) => {
      if (!vivo) return;
      const achado = (r.data ?? []).find((e) => e.id === salvo && !e.arquivadoEm);
      setLancamento(achado ?? null);
      setRestaurando(false);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const escolherLancamento = useCallback((evento: null | PrometeuEvento) => {
    setLancamento(evento);
    if (evento) window.sessionStorage.setItem(CHAVE_SELECAO, evento.id);
    else window.sessionStorage.removeItem(CHAVE_SELECAO);
  }, []);

  // Entrar no Setup SEM lançamento (o caminho "Novo lançamento" da seleção).
  const [setupLivre, setSetupLivre] = useState(false);

  // O mock (iframe) e mesma-origem: sincronizamos o tema dele com o do hub. Usa o
  // setTheme() do proprio mock (atualiza tambem os botoes do toggle); se a tela nao
  // tiver toggle, cai no fallback de body.classList.
  const applyIframeTheme = useCallback(() => {
    try {
      const win = iframeRef.current?.contentWindow as
        | (Window & { setTheme?: (t: string) => void })
        | null;
      if (win?.setTheme) {
        win.setTheme(mode === "dark" ? "dark" : "light");
        return;
      }
      const body = iframeRef.current?.contentDocument?.body;
      if (body) {
        body.classList.toggle("dark", mode === "dark");
      }
    } catch {
      // cross-origin ou iframe ainda nao pronto: ignora
    }
  }, [mode]);

  useEffect(() => {
    applyIframeTheme();
  }, [applyIframeTheme, activeId]);

  if (!active) {
    return null;
  }

  if (restaurando) {
    return <div className="h-full min-h-0 bg-canvas" />;
  }

  // A TELA INICIAL: sem lançamento escolhido, o módulo é a seleção — exceto no caminho
  // "Novo lançamento", que entra direto no Setup para criar (setupLivre).
  if (!lancamento && !setupLivre) {
    return (
      <SelecaoDeLancamento
        aoEscolher={(evento) => escolherLancamento(evento)}
        aoIrParaSetup={() => {
          setSetupLivre(true);
          setActiveId("setup");
        }}
      />
    );
  }

  return (
    <LancamentoProvider value={lancamento}>
    <div className="flex h-full min-h-0">
      <aside
        className={`panteon-module-sidebar panteon-module-sidebar--themed flex h-full min-h-0 shrink-0 flex-col px-3 py-4 text-ink transition-[width] duration-200 ${
          menuRecolhido ? "w-[64px]" : "w-[232px]"
        }`}
      >
        <div className="panteon-module-sidebar__top -mx-3 mb-2 flex items-center gap-2.5 px-3">
          {menuRecolhido ? null : (
            <>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[#A07C3B]/55 bg-[#101820] text-[#cba25a]">
                <ListOrdered aria-hidden="true" size={18} />
              </span>
              <span className="text-[0.95rem] font-semibold tracking-[0.01em] text-ink">
                Prometeu
              </span>
            </>
          )}
          {/* Recolher/expandir a lateral para ganhar tela no atendimento. */}
          <button
            className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ink-muted transition-colors hover:bg-black/[0.05] hover:text-ink dark:hover:bg-white/[0.06] ${
              menuRecolhido ? "mx-auto" : "ml-auto"
            }`}
            onClick={() => setMenuRecolhido((v) => !v)}
            title={menuRecolhido ? "Expandir menu" : "Recolher menu"}
            type="button"
          >
            {menuRecolhido ? (
              <PanelLeftOpen aria-hidden="true" size={17} />
            ) : (
              <PanelLeftClose aria-hidden="true" size={17} />
            )}
          </button>
        </div>

        {/* O lançamento em foco: o contexto de TODAS as telas abaixo. Clicar TROCA — volta à
            tela inicial de seleção (dois lançamentos simultâneos = cada posto no seu). */}
        {menuRecolhido ? null : (
          <button
            className="mb-1 flex w-full items-center gap-2 rounded-[9px] border border-line/60 px-3 py-2 text-left transition hover:border-[#A07C3B]/60"
            onClick={() => {
              escolherLancamento(null);
              setSetupLivre(false);
            }}
            title="Trocar de lançamento"
            type="button"
          >
            <Flame aria-hidden="true" className="shrink-0 text-[#cba25a]" size={15} />
            <span className="min-w-0 flex-1 truncate text-xs font-semibold text-ink">
              {lancamento ? rotuloDoLancamento(lancamento) : "Escolher lançamento"}
            </span>
            <ChevronRight aria-hidden="true" className="shrink-0 text-ink-muted" size={13} />
          </button>
        )}

        <nav className="mt-1 flex-1 space-y-0.5 overflow-y-auto">
          {GRUPOS.map((grupo, indice) => (
            <div key={grupo.titulo ?? `grupo-${indice}`}>
              {menuRecolhido || !grupo.titulo ? (
                grupo.titulo ? null : (
                  <div className="mx-1 my-2 border-t border-line/50" />
                )
              ) : (
                <div className="px-3 pb-1 pt-3 text-[10px] font-bold uppercase tracking-[0.12em] text-ink-muted">
                  {grupo.titulo}
                </div>
              )}
              {grupo.telas.map((screen) => {
                const Icon = screen.icon;
                const isActive = screen.id === active.id;
                return (
                  <button
                    key={screen.id}
                    className={`group relative flex w-full items-center gap-3 rounded-[9px] px-3 py-2 text-left transition-colors ${
                      menuRecolhido ? "justify-center" : ""
                    } ${
                      isActive
                        ? "bg-black/[0.07] text-ink dark:bg-white/[0.08]"
                        : "text-ink-soft hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/[0.05]"
                    }`}
                    onClick={() => setActiveId(screen.id)}
                    // Recolhido, o nome vira tooltip para o operador ainda reconhecer o posto.
                    title={menuRecolhido ? screen.label : undefined}
                    type="button"
                  >
                    {isActive ? (
                      <span className="absolute left-0 top-2 h-7 w-0.5 rounded-full bg-[#A07C3B]" />
                    ) : null}
                    <span
                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${
                        isActive
                          ? "panteon-module-sidebar__active-icon"
                          : "text-ink-muted"
                      }`}
                    >
                      <Icon aria-hidden="true" size={17} />
                    </span>
                    {menuRecolhido ? null : (
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {screen.label}
                      </span>
                    )}
                    {menuRecolhido ? null : isActive ? (
                      <ChevronRight
                        aria-hidden="true"
                        className="text-ink-muted"
                        size={15}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <main className="min-w-0 flex-1 bg-canvas">
        {active.component ? (
          // A chave REMONTA a tela quando o lançamento muda: troca no chip/seleção (ou o Setup
          // ativando outro evento) recarrega tudo na hora — sem F5 (Lucas, 24/08).
          <active.component key={lancamento?.id ?? "sem-lancamento"} />
        ) : (
          <iframe
            key={active.id}
            ref={iframeRef}
            onLoad={applyIframeTheme}
            className="block h-full w-full border-0"
            src={`/prometeu/${active.file}`}
            title={`Prometeu · ${active.label}`}
          />
        )}
      </main>
    </div>
    </LancamentoProvider>
  );
}
