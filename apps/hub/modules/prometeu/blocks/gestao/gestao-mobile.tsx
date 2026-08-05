"use client";

import {
  AlertTriangle,
  BarChart3,
  ChevronLeft,
  ClipboardList,
  LayoutGrid,
  Loader2,
  ScanLine,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ehIdDeCredencial } from "@/lib/prometeu/credencial";
import { calcularKpisDoEvento } from "@/lib/prometeu/kpis";
import type {
  PrometeuCredenciado,
  PrometeuEtapa,
  PrometeuEvento,
  PrometeuPassoJornada,
} from "@/lib/prometeu/types";
import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";

import { fetchEventos, fetchFila, fetchJornada } from "../../data/prometeu-operations";
import { usarLeitorQr } from "../checkin/usar-leitor-qr";

// GESTÃO no celular (perfil gestor). O cockpit da Central é feito pra tela grande e não é
// responsivo; esta é a tela pensada pra MÃO do coordenador: Bipar em destaque (abre a jornada),
// indicadores + fluxo + tempos no Painel, o Analítico (quem está no evento, filtrável) e as
// Reservas seguradas. O dash completo continua no PC. Ver [[project_prometeu_perfil_gestao]].

const LIMITE_RESERVA_MS = 30 * 60 * 1000;

// As etapas que contam como "em atendimento" (salão + secretaria) para o tempo médio.
const ETAPAS_ATENDIMENTO: PrometeuEtapa[] = [
  "negociacao",
  "reserva",
  "secretaria",
  "proposta",
  "pagamento",
];

// O circuito do dia em 3 fases. Cada sub conta os credenciados nas suas etapas ("Finalizado" conta
// os concluídos do dia; as demais, quem está lá agora). O tempo é da FASE (permanência média atual).
const FASES: {
  nome: string;
  subs: { cor: string; etapas: PrometeuEtapa[]; label: string }[];
  tempoEtapas: PrometeuEtapa[];
}[] = [
  {
    nome: "Recepção · Check-in",
    subs: [{ cor: "#9aa5b4", etapas: ["recepcao"], label: "Aguardando" }],
    tempoEtapas: ["recepcao"],
  },
  {
    nome: "Salão de vendas",
    subs: [
      { cor: "#e8a13b", etapas: ["negociacao"], label: "Negociação" },
      { cor: "#5b9dff", etapas: ["reserva"], label: "Reserva" },
    ],
    tempoEtapas: ["negociacao", "reserva"],
  },
  {
    nome: "Secretaria",
    subs: [
      { cor: "#9aa5b4", etapas: ["secretaria"], label: "Aguardando" },
      { cor: "#e8a13b", etapas: ["proposta", "pagamento"], label: "Propostas" },
      { cor: "#3ecf8e", etapas: ["concluido"], label: "Finalizado" },
    ],
    tempoEtapas: ["secretaria", "proposta", "pagamento"],
  },
];

// Chips de etapa do Analítico (a ordem do circuito).
const ETAPAS_FILTRO: { cor: string; etapa: PrometeuEtapa; label: string }[] = [
  { cor: "#9aa5b4", etapa: "recepcao", label: "Recepção" },
  { cor: "#e8a13b", etapa: "negociacao", label: "Negociação" },
  { cor: "#5b9dff", etapa: "reserva", label: "Reserva" },
  { cor: "#9b8cff", etapa: "secretaria", label: "Secretaria" },
  { cor: "#e8a13b", etapa: "proposta", label: "Proposta" },
  { cor: "#3ecf8e", etapa: "concluido", label: "Finalizado" },
  { cor: "#ff6b6b", etapa: "cancelado", label: "Cancelado" },
];

const COR_ETAPA: Partial<Record<PrometeuEtapa, string>> = {
  cancelado: "#ff6b6b",
  concluido: "#3ecf8e",
  negociacao: "#e8a13b",
  pagamento: "#e8a13b",
  proposta: "#e8a13b",
  recepcao: "#9aa5b4",
  reserva: "#5b9dff",
  secretaria: "#9b8cff",
};

const LABEL_ETAPA: Partial<Record<PrometeuEtapa, string>> = {
  cancelado: "Cancelado",
  concluido: "Finalizado",
  negociacao: "Negociação",
  pagamento: "Pagamento",
  proposta: "Proposta",
  recepcao: "Recepção",
  reserva: "Reserva",
  secretaria: "Secretaria",
};

function iniciais(nome: string): string {
  const partes = nome.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[partes.length - 1]?.[0] ?? "")).toUpperCase();
}

// "há quanto tempo", curto: 8m, 1h12.
function tempoDesde(desde: string | null, agora: number): string {
  if (!desde) return "—";
  const ms = agora - new Date(desde).getTime();
  if (Number.isNaN(ms) || ms < 0) return "—";
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

function formatMin(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}

// Tempo médio de PERMANÊNCIA ATUAL (agora - etapaDesde) de quem está nas etapas dadas — mostra onde
// a fila trava AO VIVO. Ignora concluído/cancelado (lá etapaDesde é a hora do desfecho, não da espera).
function tempoMedioMin(
  credenciados: PrometeuCredenciado[],
  etapas: PrometeuEtapa[],
  agora: number,
): number | null {
  const grupo = credenciados.filter(
    (c) =>
      etapas.includes(c.etapa) &&
      c.etapa !== "concluido" &&
      c.etapa !== "cancelado" &&
      c.etapaDesde,
  );
  if (grupo.length === 0) return null;
  const soma = grupo.reduce(
    (s, c) => s + Math.max(0, agora - new Date(c.etapaDesde).getTime()),
    0,
  );
  return Math.round(soma / grupo.length / 60000);
}

function horaCurta(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function GestaoMobile({ onTrocarModo }: { onTrocarModo?: () => void } = {}) {
  const [eventoId, setEventoId] = useState("");
  const [evento, setEvento] = useState<PrometeuEvento | null>(null);
  const [credenciados, setCredenciados] = useState<PrometeuCredenciado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  const [aba, setAba] = useState<"analitico" | "painel" | "reservas">("painel");
  const [bipando, setBipando] = useState(false);
  const [avisoBip, setAvisoBip] = useState<string | null>(null);
  const [jornadaDe, setJornadaDe] = useState<PrometeuCredenciado | null>(null);

  // Filtros das reservas.
  const [filtroImob, setFiltroImob] = useState("");
  const [filtroCorretor, setFiltroCorretor] = useState("");
  const [soAlerta, setSoAlerta] = useState(false);

  // Filtros do analítico.
  const [buscaAna, setBuscaAna] = useState("");
  const [filtroEtapa, setFiltroEtapa] = useState<PrometeuEtapa | "">("");
  const [imobAna, setImobAna] = useState("");
  const [corretorAna, setCorretorAna] = useState("");

  useEffect(() => {
    void (async () => {
      const { data } = await fetchEventos();
      const lista = data ?? [];
      const ativo = eventoDoDia(lista);
      if (ativo) {
        setEventoId(ativo.id);
        setEvento(ativo);
      } else {
        setCarregando(false);
      }
    })();
  }, []);

  const carregar = useCallback(
    async (silencioso = false) => {
      if (!eventoId) return;
      if (!silencioso) setCarregando(true);
      const { data, error } = await fetchFila(eventoId);
      if (error && !silencioso) setErro(error);
      // ⚠️ SEM PAYLOAD, NÃO MEXE. `data?.credenciados ?? []` zerava a tela inteira a cada blip de
      // rede do polling — no salão, com Wi-Fi disputado, o gestor veria o evento "esvaziar" e
      // voltar sozinho. Falha de rede não é "não há ninguém": mantemos o último estado bom.
      if (data?.credenciados) setCredenciados(data.credenciados);
      setCarregando(false);
    },
    [eventoId],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Atualiza sozinho (mesma cadência do resto do módulo, só com a aba na frente — a conta de
  // polling do Hermes já nos mordeu). O relógio de 30s mantém os tempos vivos.
  useEffect(() => {
    if (!eventoId) return;
    const fila = window.setInterval(() => {
      if (document.visibilityState === "visible") void carregar(true);
    }, 10_000);
    const relogio = window.setInterval(() => setAgora(Date.now()), 30_000);
    return () => {
      window.clearInterval(fila);
      window.clearInterval(relogio);
    };
  }, [carregar, eventoId]);

  const kpis = useMemo(() => calcularKpisDoEvento(credenciados), [credenciados]);

  // PRESENTES = quem JÁ FEZ CHECK-IN (entrou no evento). O Fluxo, os tempos e o Analítico operam
  // sobre estes — NUNCA sobre `credenciados` cru, que traz centenas de pré-cadastros ainda com
  // etapa 'recepcao' e sem check-in: contá-los inflaria a "Aguardando" da Recepção e o tempo dela
  // somaria a hora do CADASTRO (de dias atrás), não a da chegada.
  const presentes = useMemo(
    () => credenciados.filter((c) => c.entrouEm !== null),
    [credenciados],
  );

  const tempoEvento = kpis.tempoMedio != null ? Math.round(kpis.tempoMedio / 60000) : null;
  const tempoAtendimento = useMemo(
    () => tempoMedioMin(presentes, ETAPAS_ATENDIMENTO, agora),
    [presentes, agora],
  );

  const reservas = useMemo(
    () => credenciados.filter((c) => c.etapa === "reserva" && !c.noShow),
    [credenciados],
  );

  const imobiliarias = useMemo(() => {
    const set = new Set(reservas.map((c) => c.imobiliaria?.trim()).filter(Boolean) as string[]);
    if (filtroImob) set.add(filtroImob);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [reservas, filtroImob]);
  const corretores = useMemo(() => {
    const set = new Set(reservas.map((c) => c.corretor?.trim()).filter(Boolean) as string[]);
    if (filtroCorretor) set.add(filtroCorretor);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [reservas, filtroCorretor]);

  const paradoMs = useCallback(
    (c: PrometeuCredenciado) => agora - new Date(c.etapaDesde).getTime(),
    [agora],
  );

  const reservasFiltradas = useMemo(() => {
    return reservas
      .filter((c) => {
        if (filtroImob && (c.imobiliaria?.trim() ?? "") !== filtroImob) return false;
        if (filtroCorretor && (c.corretor?.trim() ?? "") !== filtroCorretor) return false;
        if (soAlerta && paradoMs(c) < LIMITE_RESERVA_MS) return false;
        return true;
      })
      .sort((a, b) => (a.etapaDesde ?? "").localeCompare(b.etapaDesde ?? ""));
  }, [reservas, filtroImob, filtroCorretor, soAlerta, paradoMs]);

  const emAlerta = reservas.filter((c) => paradoMs(c) >= LIMITE_RESERVA_MS).length;

  // Opções e lista do Analítico (sempre inclui o valor filtrado, senão sumiria no polling).
  const imobAnaOpts = useMemo(() => {
    const set = new Set(presentes.map((c) => c.imobiliaria?.trim()).filter(Boolean) as string[]);
    if (imobAna) set.add(imobAna);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [presentes, imobAna]);
  const corretorAnaOpts = useMemo(() => {
    const set = new Set(presentes.map((c) => c.corretor?.trim()).filter(Boolean) as string[]);
    if (corretorAna) set.add(corretorAna);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [presentes, corretorAna]);

  const listaAna = useMemo(() => {
    const termo = buscaAna.trim().toLowerCase();
    return presentes
      .filter((c) => {
        if (filtroEtapa && c.etapa !== filtroEtapa) return false;
        if (imobAna && (c.imobiliaria?.trim() ?? "") !== imobAna) return false;
        if (corretorAna && (c.corretor?.trim() ?? "") !== corretorAna) return false;
        if (
          termo &&
          ![c.nome, c.imobiliaria, c.corretor]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(termo))
        )
          return false;
        return true;
      })
      .sort((a, b) => (b.etapaDesde ?? "").localeCompare(a.etapaDesde ?? ""));
  }, [presentes, buscaAna, filtroEtapa, imobAna, corretorAna]);

  const aoLerCredencial = useCallback(
    (valor: string) => {
      if (!ehIdDeCredencial(valor)) return;
      const pessoa = credenciados.find((c) => c.id === valor.trim());
      if (!pessoa) {
        setAvisoBip("Essa credencial não é deste lançamento.");
        return;
      }
      setAvisoBip(null);
      setBipando(false);
      setJornadaDe(pessoa);
    },
    [credenciados],
  );

  const { canvasRef, estado: estadoBip, videoRef } = usarLeitorQr({
    ativo: bipando,
    aoLer: aoLerCredencial,
  });

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0b1017] text-white">
      {/* Cabeçalho */}
      <div className="px-5 pb-3 pt-5">
        <div className="mb-2 flex items-center justify-between">
          {onTrocarModo ? (
            <button
              className="flex items-center gap-1 rounded-full border border-white/10 px-2.5 py-1 text-[12px] font-bold text-white/60"
              onClick={onTrocarModo}
              type="button"
            >
              <ChevronLeft className="size-3.5" /> Voltar
            </button>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-emerald-400">
            <span className="size-2 rounded-full bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,.18)]" />
            Ao vivo
          </span>
        </div>
        <p className="m-0 text-[11px] font-extrabold uppercase tracking-[0.16em] text-[#c9a15f]">
          Gestão
        </p>
        <h1 className="m-0 mt-0.5 truncate text-xl font-black leading-tight">
          {evento?.config.enterpriseNome || evento?.nome || "Lançamento"}
        </h1>
      </div>

      {erro ? (
        <p className="mx-5 mb-2 flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 px-3 py-2 text-xs text-amber-200">
          <AlertTriangle className="size-4 shrink-0" /> {erro}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
        {aba === "painel" ? (
          <>
            <button
              className="flex w-full items-center gap-3 rounded-2xl bg-[#c9a15f] px-4 py-4 text-left text-[#1a1206] active:scale-[0.99]"
              onClick={() => {
                setAvisoBip(null);
                setBipando(true);
              }}
              type="button"
            >
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-black/15">
                <ScanLine className="size-5" />
              </span>
              <span>
                <span className="block text-base font-black">Bipar credencial</span>
                <span className="block text-xs font-semibold opacity-75">
                  Abre a jornada do cliente
                </span>
              </span>
            </button>

            <div className="mt-4 grid grid-cols-2 gap-2.5">
              <Kpi valor={kpis.presentes} rotulo="Presentes agora" />
              <Kpi valor={kpis.emAtendimento} rotulo="Em atendimento" cor="text-[#c9a15f]" />
              <Kpi valor={kpis.concluidos} rotulo="Vendas fechadas" cor="text-emerald-400" />
              <Kpi
                valor={kpis.conversao === null ? "—" : `${kpis.conversao}%`}
                rotulo="Conversão"
              />
            </div>

            <SecLabel>Tempos do evento</SecLabel>
            <div className="grid grid-cols-2 gap-2.5">
              <TempoCard valor={formatMin(tempoEvento)} rotulo="Tempo médio no evento (entrada → venda)" />
              <TempoCard valor={formatMin(tempoAtendimento)} rotulo="Tempo médio de atendimento" />
            </div>

            <SecLabel>Fluxo do evento</SecLabel>
            <Fluxo agora={agora} credenciados={presentes} />

            <button
              className="mt-5 flex w-full items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3.5 text-left active:scale-[0.99]"
              onClick={() => setAba("reservas")}
              type="button"
            >
              <span className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/5 text-white/80">
                  <ClipboardList className="size-5" />
                </span>
                <span className="text-base font-bold">Reservas seguradas</span>
              </span>
              {emAlerta > 0 ? (
                <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-extrabold text-red-400">
                  {emAlerta} em alerta
                </span>
              ) : (
                <span className="text-sm font-bold text-white/50">{reservas.length}</span>
              )}
            </button>
          </>
        ) : aba === "analitico" ? (
          <Analitico
            agora={agora}
            busca={buscaAna}
            corretor={corretorAna}
            corretores={corretorAnaOpts}
            etapa={filtroEtapa}
            imob={imobAna}
            imobiliarias={imobAnaOpts}
            lista={listaAna}
            onAbrir={(c) => setJornadaDe(c)}
            onBusca={setBuscaAna}
            onCorretor={setCorretorAna}
            onEtapa={setFiltroEtapa}
            onImob={setImobAna}
            totalPresentes={presentes.length}
          />
        ) : (
          <Reservas
            agora={agora}
            corretores={corretores}
            emAlerta={emAlerta}
            filtroCorretor={filtroCorretor}
            filtroImob={filtroImob}
            imobiliarias={imobiliarias}
            lista={reservasFiltradas}
            onAbrir={(c) => setJornadaDe(c)}
            onCorretor={setFiltroCorretor}
            onImob={setFiltroImob}
            onSoAlerta={() => setSoAlerta((v) => !v)}
            soAlerta={soAlerta}
            total={reservas.length}
          />
        )}

        {carregando ? (
          <div className="mt-6 flex items-center justify-center gap-2 text-sm text-white/50">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </div>
        ) : null}
      </div>

      {/* Barra inferior */}
      <div className="flex shrink-0 border-t border-white/10 bg-[#0f1620]">
        <TabBar ativo={aba === "painel"} icone={LayoutGrid} onClick={() => setAba("painel")} rotulo="Painel" />
        <TabBar
          ativo={aba === "analitico"}
          icone={BarChart3}
          onClick={() => setAba("analitico")}
          rotulo="Analítico"
        />
        <TabBar
          ativo={aba === "reservas"}
          badge={emAlerta > 0 ? emAlerta : undefined}
          icone={ClipboardList}
          onClick={() => setAba("reservas")}
          rotulo="Reservas"
        />
      </div>

      {/* Overlay do bip */}
      {bipando ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-5"
          onClick={() => setBipando(false)}
          role="presentation"
        >
          <div
            className="w-full max-w-sm overflow-hidden rounded-3xl border border-white/10 bg-[#141c27]"
            onClick={(e) => e.stopPropagation()}
            role="presentation"
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <span className="flex items-center gap-2 text-sm font-extrabold">
                <ScanLine className="size-4 text-[#c9a15f]" /> Bipar credencial
              </span>
              <button
                aria-label="Fechar"
                className="grid size-8 place-items-center rounded-lg border border-white/10 text-white/60"
                onClick={() => setBipando(false)}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="relative aspect-square bg-black">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- câmera, sem áudio */}
              <video className="size-full object-cover" muted playsInline ref={videoRef} />
              <canvas hidden ref={canvasRef} />
              <div className="pointer-events-none absolute left-1/2 top-1/2 aspect-square w-3/5 -translate-x-1/2 -translate-y-1/2 rounded-2xl border-[3px] border-white/90" />
            </div>
            <p className="px-4 py-3 text-center text-xs text-white/60">
              {estadoBip === "lendo"
                ? "Aponte para o QR da credencial."
                : estadoBip === "pedindo-camera"
                  ? "Liberando a câmera…"
                  : estadoBip === "sem-permissao"
                    ? "Permissão de câmera negada."
                    : estadoBip === "sem-camera"
                      ? "Câmera indisponível."
                      : "Iniciando…"}
            </p>
            {avisoBip ? (
              <p className="mx-4 mb-4 rounded-lg bg-red-500/15 px-3 py-2 text-center text-xs font-bold text-red-300">
                {avisoBip}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}

      {/* Jornada (drawer) */}
      {jornadaDe ? (
        <JornadaDrawer agora={agora} pessoa={jornadaDe} onFechar={() => setJornadaDe(null)} />
      ) : null}
    </div>
  );
}

function Kpi(props: { cor?: string; rotulo: string; valor: number | string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-[#141c27] p-3.5">
      <div className={`text-2xl font-black leading-none tabular-nums ${props.cor ?? ""}`}>
        {props.valor}
      </div>
      <div className="mt-1.5 text-[11px] font-semibold text-white/55">{props.rotulo}</div>
    </div>
  );
}

function SecLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="m-0 mb-2.5 mt-5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white/35">
      {children}
    </p>
  );
}

function TempoCard(props: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-[#c9a15f]/28 bg-gradient-to-b from-[#c9a15f]/12 to-transparent p-3">
      <div className="text-xl font-black tabular-nums text-[#f0e2c6]">{props.valor}</div>
      <div className="mt-1.5 text-[11px] leading-tight text-white/55">{props.rotulo}</div>
    </div>
  );
}

// FLUXO por fase: cada fase é um nó do circuito com as sub-etapas (contagem) e o tempo médio atual.
function Fluxo({ agora, credenciados }: { agora: number; credenciados: PrometeuCredenciado[] }) {
  const conta = (etapas: PrometeuEtapa[]) => credenciados.filter((c) => etapas.includes(c.etapa)).length;
  return (
    <div>
      {FASES.map((fase, i) => {
        const t = tempoMedioMin(credenciados, fase.tempoEtapas, agora);
        return (
          <div className="relative pb-3.5 pl-7" key={fase.nome}>
            {i < FASES.length - 1 ? (
              <span className="absolute left-2 top-5 bottom-[-4px] w-0.5 bg-white/10" />
            ) : null}
            <span className="absolute left-0 top-0.5 grid size-[18px] place-items-center rounded-full border-2 border-[#c9a15f] bg-[#0b1017]">
              <span className="size-[7px] rounded-full bg-[#c9a15f]" />
            </span>
            <div className="flex items-center justify-between">
              <span className="text-[13.5px] font-extrabold">{fase.nome}</span>
              <span className="text-[11.5px] font-bold tabular-nums text-[#c9a15f]">
                {t === null ? "—" : `⏱ ${formatMin(t)}`}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {fase.subs.map((sub) => (
                <span
                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-[#0f1620] px-2.5 py-1.5 text-xs text-white/60"
                  key={sub.label}
                >
                  <span className="size-[7px] rounded-full" style={{ background: sub.cor }} />
                  {sub.label} <b className="font-extrabold tabular-nums text-white">{conta(sub.etapas)}</b>
                </span>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TabBar(props: {
  ativo: boolean;
  badge?: number;
  icone: typeof LayoutGrid;
  onClick: () => void;
  rotulo: string;
}) {
  const Icone = props.icone;
  return (
    <button
      className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-bold ${
        props.ativo ? "text-[#c9a15f]" : "text-white/40"
      }`}
      onClick={props.onClick}
      type="button"
    >
      <Icone className="size-5" />
      {props.rotulo}
      {props.badge ? (
        <span className="absolute right-[18%] top-1.5 rounded-full bg-red-500 px-1.5 text-[10px] font-extrabold text-white">
          {props.badge}
        </span>
      ) : null}
    </button>
  );
}

// ANALÍTICO: todos que já entraram no evento (inclui finalizados e cancelados, filtráveis pelos
// chips), buscável e filtrável por etapa + imobiliária + corretor. O KPI "Presentes agora" do
// Painel é outra conta (só os ativos); aqui o rótulo é neutro ("no evento") pra não confundir.
function Analitico(props: {
  agora: number;
  busca: string;
  corretor: string;
  corretores: string[];
  etapa: PrometeuEtapa | "";
  imob: string;
  imobiliarias: string[];
  lista: PrometeuCredenciado[];
  onAbrir: (c: PrometeuCredenciado) => void;
  onBusca: (v: string) => void;
  onCorretor: (v: string) => void;
  onEtapa: (v: PrometeuEtapa | "") => void;
  onImob: (v: string) => void;
  totalPresentes: number;
}) {
  const selCls =
    "min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white";
  const rotuloEtapa = props.etapa ? LABEL_ETAPA[props.etapa] ?? props.etapa : null;
  return (
    <div className="pt-1">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#141c27] px-3 py-2.5">
        <Search className="size-4 shrink-0 text-white/35" />
        <input
          className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/35"
          onChange={(e) => props.onBusca(e.target.value)}
          placeholder="Buscar cliente, corretor…"
          value={props.busca}
        />
      </div>

      <div className="-mx-5 mt-2.5 flex gap-1.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
        <ChipEtapa ativo={props.etapa === ""} label="Todas" onClick={() => props.onEtapa("")} />
        {ETAPAS_FILTRO.map((e) => (
          <ChipEtapa
            ativo={props.etapa === e.etapa}
            cor={e.cor}
            key={e.etapa}
            label={e.label}
            onClick={() => props.onEtapa(e.etapa)}
          />
        ))}
      </div>

      <div className="mt-2 flex gap-2">
        <select className={selCls} onChange={(e) => props.onImob(e.target.value)} value={props.imob}>
          <option value="">Todas imobiliárias</option>
          {props.imobiliarias.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select
          className={selCls}
          onChange={(e) => props.onCorretor(e.target.value)}
          value={props.corretor}
        >
          <option value="">Todos corretores</option>
          {props.corretores.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <p className="m-0 mb-2 mt-3 px-0.5 text-[11.5px] font-bold text-white/55">
        <b className="text-[#c9a15f]">{props.lista.length}</b>
        {rotuloEtapa ? ` em ${rotuloEtapa}` : " no evento"}
        {props.imob ? ` · ${props.imob}` : ""}
      </p>

      {props.lista.length === 0 ? (
        <p className="mt-8 text-center text-sm text-white/45">
          {props.totalPresentes === 0
            ? "Ninguém fez check-in ainda."
            : "Ninguém com esse filtro."}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {props.lista.map((c) => {
            const cor = COR_ETAPA[c.etapa] ?? "#9aa5b4";
            return (
              <button
                className="flex items-center gap-3 rounded-2xl border border-white/10 bg-[#0f1620] p-2.5 text-left active:scale-[0.99]"
                key={c.id}
                onClick={() => props.onAbrir(c)}
                type="button"
              >
                <span
                  className="grid size-9 shrink-0 place-items-center rounded-lg text-xs font-extrabold"
                  style={{ background: `${cor}22`, color: cor }}
                >
                  {iniciais(c.nome)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] font-extrabold">{c.nome}</span>
                  <span className="block truncate text-[11.5px] text-white/50">
                    {(c.imobiliaria?.trim() || "—") + " · " + (c.corretor?.trim() || "—")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className="inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold"
                    style={{ background: `${cor}22`, color: cor }}
                  >
                    {LABEL_ETAPA[c.etapa] ?? c.etapa}
                  </span>
                  <span className="mt-1 block text-[11px] tabular-nums text-white/40">
                    {tempoDesde(c.etapaDesde, props.agora)}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChipEtapa(props: { ativo: boolean; cor?: string; label: string; onClick: () => void }) {
  return (
    <button
      className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-bold ${
        props.ativo
          ? "border-[#c9a15f] bg-[#c9a15f] text-[#1a1206]"
          : "border-white/10 bg-[#0f1620] text-white/60"
      }`}
      onClick={props.onClick}
      type="button"
    >
      {!props.ativo && props.cor ? (
        <span className="size-[7px] rounded-full" style={{ background: props.cor }} />
      ) : null}
      {props.label}
    </button>
  );
}

function Reservas(props: {
  agora: number;
  corretores: string[];
  emAlerta: number;
  filtroCorretor: string;
  filtroImob: string;
  imobiliarias: string[];
  lista: PrometeuCredenciado[];
  onAbrir: (c: PrometeuCredenciado) => void;
  onCorretor: (v: string) => void;
  onImob: (v: string) => void;
  onSoAlerta: () => void;
  soAlerta: boolean;
  total: number;
}) {
  const selCls =
    "min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white";
  return (
    <div className="pt-1">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="m-0 text-base font-black">Reservas seguradas</h2>
        {props.emAlerta > 0 ? (
          <span className="rounded-full bg-red-500/15 px-2.5 py-1 text-xs font-extrabold text-red-400">
            {props.emAlerta} em alerta
          </span>
        ) : null}
      </div>

      <div className="mb-2 flex gap-2">
        <select className={selCls} onChange={(e) => props.onImob(e.target.value)} value={props.filtroImob}>
          <option value="">Todas imobiliárias</option>
          {props.imobiliarias.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select
          className={selCls}
          onChange={(e) => props.onCorretor(e.target.value)}
          value={props.filtroCorretor}
        >
          <option value="">Todos corretores</option>
          {props.corretores.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <button
        className={`mb-4 rounded-full border px-3 py-1.5 text-xs font-bold ${
          props.soAlerta
            ? "border-red-500 bg-red-500 text-white"
            : "border-white/10 bg-white/5 text-white/60"
        }`}
        onClick={props.onSoAlerta}
        type="button"
      >
        Só em alerta (+30 min)
      </button>

      {props.lista.length === 0 ? (
        <p className="mt-8 text-center text-sm text-white/45">
          {props.total === 0
            ? "Nenhuma reserva parada agora."
            : "Nenhuma reserva parada com esse filtro."}
        </p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {props.lista.map((c) => {
            const alerta = props.agora - new Date(c.etapaDesde).getTime() >= LIMITE_RESERVA_MS;
            return (
              <button
                className={`flex items-center gap-3 rounded-2xl border p-3 text-left active:scale-[0.99] ${
                  alerta
                    ? "border-red-500/40 bg-gradient-to-b from-red-500/12 to-transparent"
                    : "border-white/10 bg-[#0f1620]"
                }`}
                key={c.id}
                onClick={() => props.onAbrir(c)}
                type="button"
              >
                <span
                  className={`grid size-10 shrink-0 place-items-center rounded-xl text-xs font-extrabold ${
                    alerta ? "bg-red-500/15 text-red-400" : "bg-[#c9a15f]/15 text-[#c9a15f]"
                  }`}
                >
                  {iniciais(c.nome)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-extrabold">{c.nome}</span>
                  <span className="block truncate text-xs text-white/55">
                    {(c.corretor?.trim() || "—") + " · " + (c.imobiliaria?.trim() || "—")}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span
                    className={`block text-sm font-black tabular-nums ${alerta ? "text-red-400" : ""}`}
                  >
                    {tempoDesde(c.etapaDesde, props.agora)}
                  </span>
                  {alerta ? (
                    <span className="mt-0.5 inline-block rounded-full bg-red-500/15 px-2 text-[10px] font-extrabold text-red-400">
                      +30 min
                    </span>
                  ) : (
                    <span className="text-[10px] text-white/45">na reserva</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function JornadaDrawer(props: {
  agora: number;
  onFechar: () => void;
  pessoa: PrometeuCredenciado;
}) {
  const [passos, setPassos] = useState<PrometeuPassoJornada[] | null>(null);

  useEffect(() => {
    let vivo = true;
    setPassos(null);
    void fetchJornada(props.pessoa.id).then(({ data }) => {
      if (vivo) setPassos(data?.passos ?? []);
    });
    return () => {
      vivo = false;
    };
  }, [props.pessoa.id]);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/60"
      onClick={props.onFechar}
      role="presentation"
    >
      <div
        className="max-h-[85%] overflow-y-auto rounded-t-3xl border-t border-white/10 bg-[#141c27] pb-6"
        onClick={(e) => e.stopPropagation()}
        role="presentation"
      >
        <div className="sticky top-0 flex items-start justify-between gap-3 border-b border-white/10 bg-[#141c27] px-5 py-4">
          <div className="min-w-0">
            <p className="m-0 text-[11px] font-extrabold uppercase tracking-wider text-[#c9a15f]">
              Jornada
            </p>
            <h2 className="m-0 mt-0.5 truncate text-lg font-black">{props.pessoa.nome}</h2>
            <p className="m-0 mt-0.5 truncate text-xs text-white/55">
              {(props.pessoa.corretor?.trim() || "—") +
                " · " +
                (props.pessoa.imobiliaria?.trim() || "—")}
            </p>
          </div>
          <button
            aria-label="Fechar"
            className="grid size-9 shrink-0 place-items-center rounded-xl border border-white/10 text-white/60"
            onClick={props.onFechar}
            type="button"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          {passos === null ? (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-white/50">
              <Loader2 className="size-4 animate-spin" /> Carregando…
            </div>
          ) : passos.length === 0 ? (
            <p className="py-8 text-center text-sm text-white/45">
              Sem passos registrados ainda.
            </p>
          ) : (
            <ol className="m-0 list-none p-0">
              {passos.map((passo, i) => (
                <li className="relative flex gap-3 pb-5 last:pb-0" key={`${passo.titulo}-${i}`}>
                  <span className="flex flex-col items-center">
                    <span
                      className={`mt-1 size-3 shrink-0 rounded-full ${
                        passo.cancelado ? "bg-red-500" : "bg-[#c9a15f]"
                      }`}
                    />
                    {i < passos.length - 1 ? (
                      <span className="w-px flex-1 bg-white/12" />
                    ) : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-bold">{passo.titulo}</span>
                      <span className="shrink-0 text-xs tabular-nums text-white/50">
                        {horaCurta(passo.quando)}
                      </span>
                    </span>
                    {passo.detalhe ? (
                      <span className="mt-0.5 block text-xs text-white/55">{passo.detalhe}</span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
