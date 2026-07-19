"use client";

import {
  Clock,
  DoorOpen,
  LayoutGrid,
  List,
  Loader2,
  Plus,
  RefreshCw,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  ETAPAS_ATIVAS,
  PROMETEU_ETAPAS,
  type PrometeuCredenciado,
  type PrometeuEtapa,
  type PrometeuEvento,
} from "@/lib/prometeu/types";

import {
  criarEventoRemoto,
  fetchEventos,
  fetchFila,
  moverCredenciado,
} from "../../data/prometeu-operations";

// Central do Prometeu: a visao de comando do dia do lancamento. Le prometeu_* de verdade
// (o mockup em /public/prometeu/cockpit.html foi o desenho aprovado; aqui ele vira dado real).

// "1h 23m" / "12m". O cronometro do dia precisa ser lido de relance.
function duracao(desde: string, agora: number): string {
  const minutos = Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 60000));
  if (minutos < 60) return `${minutos}m`;
  return `${Math.floor(minutos / 60)}h ${String(minutos % 60).padStart(2, "0")}m`;
}

function horaCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function CentralView() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState<string>("");
  const [credenciados, setCredenciados] = useState<PrometeuCredenciado[]>([]);
  // Ordem calculada no servidor pelas duas regras da janela — NÃO reordenar aqui.
  const [filaRecepcao, setFilaRecepcao] = useState<PrometeuCredenciado[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [visao, setVisao] = useState<"kanban" | "lista" | "recepcao">("kanban");
  const [busca, setBusca] = useState("");
  // Os cronometros precisam andar sozinhos: um tick por minuto redesenha os tempos.
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const carregarEventos = useCallback(async () => {
    const { data, error } = await fetchEventos();
    if (error) {
      setErro(error);
      setCarregando(false);
      return;
    }
    const lista = data ?? [];
    setEventos(lista);
    setEventoId((atual) => atual || lista[0]?.id || "");
    if (lista.length === 0) setCarregando(false);
  }, []);

  const carregarFila = useCallback(async (id: string) => {
    if (!id) return;
    setCarregando(true);
    const { data, error } = await fetchFila(id);
    if (error) {
      setErro(error);
      setCredenciados([]);
      setFilaRecepcao([]);
    } else {
      setErro(null);
      setCredenciados(data?.credenciados ?? []);
      setFilaRecepcao(data?.filaRecepcao ?? []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregarEventos();
  }, [carregarEventos]);

  useEffect(() => {
    void carregarFila(eventoId);
  }, [carregarFila, eventoId]);

  const filtrados = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return credenciados;
    return credenciados.filter((c) =>
      [c.nome, c.imobiliaria, c.corretor, c.documento]
        .filter(Boolean)
        .some((campo) => campo!.toLowerCase().includes(termo)),
    );
  }, [busca, credenciados]);

  const kpis = useMemo(() => {
    const ativos = credenciados.filter((c) => ETAPAS_ATIVAS.includes(c.etapa)).length;
    const concluidos = credenciados.filter((c) => c.etapa === "concluido").length;
    const aguardandoPix = credenciados.filter((c) => !c.pagoEm).length;
    return { ativos, aguardandoPix, concluidos, total: credenciados.length };
  }, [credenciados]);

  const mover = useCallback(
    async (credenciado: PrometeuCredenciado, etapa: PrometeuEtapa) => {
      // Otimista: o operador nao pode esperar round-trip no meio do evento.
      setCredenciados((atual) =>
        atual.map((c) =>
          c.id === credenciado.id
            ? { ...c, etapa, etapaDesde: new Date().toISOString() }
            : c,
        ),
      );
      const { error } = await moverCredenciado({ credenciadoId: credenciado.id, etapa });
      if (error) {
        setErro(error);
        void carregarFila(eventoId);
      }
    },
    [carregarFila, eventoId],
  );

  const criarPrimeiroEvento = useCallback(async () => {
    const { data, error } = await criarEventoRemoto({ nome: "Lançamento" });
    if (error) {
      setErro(error);
      return;
    }
    if (data) {
      setEventos((atual) => [data, ...atual]);
      setEventoId(data.id);
    }
  }, []);

  if (!carregando && eventos.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-canvas p-8">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-ink">Nenhum lançamento cadastrado</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Crie o evento para começar a montar a fila. A ordem de atendimento sai da hora do
            pagamento do PIX de pré-venda.
          </p>
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8d6c33]"
            onClick={() => void criarPrimeiroEvento()}
            type="button"
          >
            <Plus size={16} /> Criar lançamento
          </button>
          {erro ? <p className="mt-4 text-sm text-red-600">{erro}</p> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas">
      <header className="flex flex-wrap items-center gap-3 border-b border-black/[0.07] px-5 py-3 dark:border-white/[0.08]">
        <select
          className="rounded-lg border border-black/10 bg-surface px-3 py-1.5 text-sm font-semibold text-ink dark:border-white/10"
          onChange={(e) => setEventoId(e.target.value)}
          value={eventoId}
        >
          {eventos.map((evento) => (
            <option key={evento.id} value={evento.id}>
              {evento.nome}
              {evento.enterpriseCode ? ` · ${evento.enterpriseCode}` : ""}
            </option>
          ))}
        </select>

        <input
          className="min-w-[200px] flex-1 rounded-lg border border-black/10 bg-surface px-3 py-1.5 text-sm text-ink dark:border-white/10"
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome, imobiliária, corretor ou CPF"
          value={busca}
        />

        <div className="flex items-center gap-1 rounded-lg border border-black/10 p-0.5 dark:border-white/10">
          <button
            className={`grid h-7 w-7 place-items-center rounded-md ${visao === "kanban" ? "bg-black/[0.07] text-ink dark:bg-white/[0.1]" : "text-ink-muted"}`}
            onClick={() => setVisao("kanban")}
            title="Kanban"
            type="button"
          >
            <LayoutGrid size={15} />
          </button>
          <button
            className={`grid h-7 w-7 place-items-center rounded-md ${visao === "lista" ? "bg-black/[0.07] text-ink dark:bg-white/[0.1]" : "text-ink-muted"}`}
            onClick={() => setVisao("lista")}
            title="Lista"
            type="button"
          >
            <List size={15} />
          </button>
          <button
            className={`flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-semibold ${visao === "recepcao" ? "bg-black/[0.07] text-ink dark:bg-white/[0.1]" : "text-ink-muted"}`}
            onClick={() => setVisao("recepcao")}
            title="Fila da recepção: quem já chegou, na ordem de chamada"
            type="button"
          >
            <DoorOpen size={15} />
            Recepção
            {filaRecepcao.length > 0 ? (
              <span className="rounded-full bg-[#A07C3B] px-1.5 text-[0.65rem] text-white">
                {filaRecepcao.length}
              </span>
            ) : null}
          </button>
        </div>

        <button
          className="grid h-8 w-8 place-items-center rounded-lg border border-black/10 text-ink-soft hover:text-ink dark:border-white/10"
          onClick={() => void carregarFila(eventoId)}
          title="Atualizar"
          type="button"
        >
          {carregando ? (
            <Loader2 className="animate-spin" size={15} />
          ) : (
            <RefreshCw size={15} />
          )}
        </button>
      </header>

      <div className="flex flex-wrap gap-3 px-5 py-3">
        <Kpi icone={<Users size={15} />} label="No evento" valor={kpis.total} />
        <Kpi icone={<Clock size={15} />} label="Em atendimento" valor={kpis.ativos} />
        <Kpi label="Concluídos" valor={kpis.concluidos} />
        <Kpi label="Aguardando PIX" valor={kpis.aguardandoPix} />
      </div>

      {erro ? (
        <p className="mx-5 mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        {visao === "kanban" ? (
          <Kanban agora={agora} credenciados={filtrados} onMover={mover} />
        ) : visao === "lista" ? (
          <Lista agora={agora} credenciados={filtrados} />
        ) : (
          <FilaRecepcao agora={agora} fila={filaRecepcao} />
        )}
      </div>
    </div>
  );
}

function Kpi(props: { icone?: React.ReactNode; label: string; valor: number }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-black/[0.07] bg-surface px-3.5 py-2 dark:border-white/[0.08]">
      {props.icone ? <span className="text-ink-muted">{props.icone}</span> : null}
      <div>
        <div className="text-lg font-semibold leading-none text-ink">{props.valor}</div>
        <div className="mt-0.5 text-[0.7rem] uppercase tracking-wide text-ink-muted">
          {props.label}
        </div>
      </div>
    </div>
  );
}

function Kanban(props: {
  agora: number;
  credenciados: PrometeuCredenciado[];
  onMover: (c: PrometeuCredenciado, etapa: PrometeuEtapa) => void;
}) {
  return (
    <div className="flex h-full gap-3 overflow-x-auto pb-2">
      {PROMETEU_ETAPAS.map((etapa) => {
        const doGrupo = props.credenciados.filter((c) => c.etapa === etapa.id);
        return (
          <section
            key={etapa.id}
            className="flex w-[286px] shrink-0 flex-col rounded-xl border border-black/[0.07] bg-surface dark:border-white/[0.08]"
          >
            <header className="flex items-center gap-2 border-b border-black/[0.06] px-3 py-2.5 dark:border-white/[0.07]">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ background: etapa.cor }}
              />
              <span className="flex-1 text-sm font-semibold text-ink">{etapa.label}</span>
              <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-xs font-semibold text-ink-soft dark:bg-white/[0.08]">
                {doGrupo.length}
              </span>
            </header>

            <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
              {doGrupo.map((credenciado) => (
                <Card
                  key={credenciado.id}
                  agora={props.agora}
                  credenciado={credenciado}
                  onMover={props.onMover}
                />
              ))}
              {doGrupo.length === 0 ? (
                <p className="px-1 py-6 text-center text-xs text-ink-muted">Vazio</p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Card(props: {
  agora: number;
  credenciado: PrometeuCredenciado;
  onMover: (c: PrometeuCredenciado, etapa: PrometeuEtapa) => void;
}) {
  const { agora, credenciado } = props;

  return (
    <article className="rounded-lg border border-black/[0.07] bg-canvas p-2.5 dark:border-white/[0.08]">
      <div className="flex items-start gap-2">
        {credenciado.posicao ? (
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#101820] text-[0.7rem] font-bold text-[#cba25a]">
            {credenciado.posicao}
          </span>
        ) : null}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{credenciado.nome}</p>
          {credenciado.imobiliaria ? (
            <p className="truncate text-xs text-ink-soft">{credenciado.imobiliaria}</p>
          ) : null}
        </div>
      </div>

      {credenciado.unidades.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {credenciado.unidades.map((unidade) => (
            <span
              key={unidade.id}
              className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[0.68rem] font-medium text-ink-soft dark:bg-white/[0.08]"
            >
              {unidade.codigo}
            </span>
          ))}
        </div>
      ) : null}

      <div className="mt-2 flex items-center justify-between gap-2 text-[0.68rem] text-ink-muted">
        <span title="Tempo neste estágio">
          <Clock className="mr-1 inline" size={11} />
          {duracao(credenciado.etapaDesde, agora)}
        </span>
        <span title="No evento desde">{horaCurta(credenciado.entrouEm)}</span>
      </div>

      <select
        className="mt-2 w-full rounded-md border border-black/10 bg-surface px-2 py-1 text-xs text-ink dark:border-white/10"
        onChange={(e) => props.onMover(credenciado, e.target.value as PrometeuEtapa)}
        value={credenciado.etapa}
      >
        {PROMETEU_ETAPAS.map((etapa) => (
          <option key={etapa.id} value={etapa.id}>
            {etapa.label}
          </option>
        ))}
      </select>
    </article>
  );
}

// A ordem de CHAMADA no dia. Vem pronta do servidor (as duas regras da janela) e é renderizada
// na ordem recebida — reordenar aqui inverteria a fila de gente real esperando em pé.
function FilaRecepcao(props: { agora: number; fila: PrometeuCredenciado[] }) {
  if (props.fila.length === 0) {
    return (
      <div className="grid place-items-center py-16 text-center">
        <div className="max-w-sm">
          <DoorOpen className="mx-auto mb-3 text-ink-muted" size={28} />
          <p className="text-sm font-semibold text-ink">Ninguém credenciado ainda</p>
          <p className="mt-1 text-sm text-ink-soft">
            Conforme as pessoas forem bipadas na recepção, elas aparecem aqui na ordem de
            chamada.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {props.fila.map((credenciado, indice) => {
        const naJanela = credenciado.credenciadoNaJanela === true;
        return (
          <article
            key={credenciado.id}
            className="flex items-center gap-3 rounded-lg border border-black/[0.07] bg-surface px-3 py-2.5 dark:border-white/[0.08]"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-[#101820] text-sm font-bold text-[#cba25a]">
              {indice + 1}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{credenciado.nome}</p>
              <p className="truncate text-xs text-ink-soft">
                {credenciado.imobiliaria ?? "Sem imobiliária"}
                {credenciado.corretor ? ` · ${credenciado.corretor}` : ""}
              </p>
            </div>

            {/* Por que esta pessoa está nesta posição: a recepção precisa saber explicar. */}
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold ${
                naJanela
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                  : "bg-black/[0.06] text-ink-soft dark:bg-white/[0.08]"
              }`}
              title={
                naJanela
                  ? "Credenciado dentro da janela: entra pela ordem do PIX"
                  : "Credenciado após a janela: entra por ordem de chegada"
              }
            >
              {naJanela
                ? credenciado.pagoEm
                  ? `PIX · ${credenciado.posicao}º do evento`
                  : "Sem PIX"
                : "Fora da janela"}
            </span>

            <span className="shrink-0 text-xs text-ink-muted">
              {horaCurta(credenciado.entrouEm)}
            </span>
          </article>
        );
      })}
    </div>
  );
}

function Lista(props: { agora: number; credenciados: PrometeuCredenciado[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.07] dark:border-white/[0.08]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface text-left text-[0.7rem] uppercase tracking-wide text-ink-muted">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Cliente</th>
            <th className="px-3 py-2 font-semibold">Imobiliária</th>
            <th className="px-3 py-2 font-semibold">Unidades</th>
            <th className="px-3 py-2 font-semibold">Etapa</th>
            <th className="px-3 py-2 font-semibold">No estágio</th>
            <th className="px-3 py-2 font-semibold">PIX</th>
          </tr>
        </thead>
        <tbody>
          {props.credenciados.map((credenciado) => {
            const etapa = PROMETEU_ETAPAS.find((e) => e.id === credenciado.etapa);
            return (
              <tr
                key={credenciado.id}
                className="border-t border-black/[0.06] dark:border-white/[0.07]"
              >
                <td className="px-3 py-2 font-semibold text-ink-soft">
                  {credenciado.posicao ?? "—"}
                </td>
                <td className="px-3 py-2 font-medium text-ink">{credenciado.nome}</td>
                <td className="px-3 py-2 text-ink-soft">{credenciado.imobiliaria ?? "—"}</td>
                <td className="px-3 py-2 text-ink-soft">
                  {credenciado.unidades.map((u) => u.codigo).join(", ") || "—"}
                </td>
                <td className="px-3 py-2">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
                    style={{ background: `${etapa?.cor}1a`, color: etapa?.cor }}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: etapa?.cor }}
                    />
                    {etapa?.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-ink-soft">
                  {duracao(credenciado.etapaDesde, props.agora)}
                </td>
                <td className="px-3 py-2 text-ink-soft">{horaCurta(credenciado.pagoEm)}</td>
              </tr>
            );
          })}
          {props.credenciados.length === 0 ? (
            <tr>
              <td className="px-3 py-10 text-center text-sm text-ink-muted" colSpan={7}>
                Ninguém na fila ainda.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
