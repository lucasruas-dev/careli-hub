"use client";

import { Loader2, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  PROMETEU_ETAPAS,
  type PrometeuAtividade,
  type PrometeuChamada,
  type PrometeuCredenciado,
  type PrometeuEtapa,
  type PrometeuEvento,
  type PrometeuMesa,
} from "@/lib/prometeu/types";

import {
  criarEventoRemoto,
  fetchEventos,
  fetchFila,
  moverCredenciado,
} from "../../data/prometeu-operations";

// Central do Prometeu — a tela de comando ao vivo do dia do lançamento.
//
// A estrutura é a do mockup APROVADO pelo Lucas (public/prometeu/cockpit.html): KPIs no topo e
// três abas — Painel · Mapa do salão · Analítico (com Lista/Kanban DENTRO do Analítico, não
// como tela de abertura). A diferença é que aqui os números vêm das tabelas prometeu_*.
//
// Onde o mockup mostrava dado que ainda não temos fonte (valor em R$ das unidades, que virá do
// C2X), a tela mostra travessão em vez de número inventado.

type Aba = "painel" | "mapa" | "analitico";
type SubAba = "lista" | "kanban";
type VerPor = "cliente" | "imobiliaria" | "unidade";

// ◉ = presença confirmada por bipagem do QR · ◈ = estágio que vem do dado (C2X/sistema)
const FONTE_QR = "◉";
const FONTE_DADO = "◈";

const ETAPAS_EM_ATENDIMENTO: PrometeuEtapa[] = [
  "negociacao",
  "reserva",
  "secretaria",
  "proposta",
  "pagamento",
];

function duracao(desde: string, agora: number): string {
  const minutos = Math.max(0, Math.floor((agora - new Date(desde).getTime()) / 60000));
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

function horaCurta(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function haQuantoTempo(iso: string, agora: number): string {
  const minutos = Math.floor((agora - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)}h`;
}

function iniciais(nome: string): string {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}

export function CentralView() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState("");
  const [credenciados, setCredenciados] = useState<PrometeuCredenciado[]>([]);
  const [filaRecepcao, setFilaRecepcao] = useState<PrometeuCredenciado[]>([]);
  const [mesas, setMesas] = useState<PrometeuMesa[]>([]);
  const [chamadas, setChamadas] = useState<PrometeuChamada[]>([]);
  const [atividade, setAtividade] = useState<PrometeuAtividade[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [aba, setAba] = useState<Aba>("painel");
  const [subAba, setSubAba] = useState<SubAba>("lista");
  const [verPor, setVerPor] = useState<VerPor>("cliente");
  const [busca, setBusca] = useState("");
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
    } else {
      setErro(null);
      setCredenciados(data?.credenciados ?? []);
      setFilaRecepcao(data?.filaRecepcao ?? []);
      setMesas(data?.mesas ?? []);
      setChamadas(data?.chamadas ?? []);
      setAtividade(data?.atividade ?? []);
    }
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregarEventos();
  }, [carregarEventos]);

  useEffect(() => {
    void carregarFila(eventoId);
  }, [carregarFila, eventoId]);

  const porEtapa = useCallback(
    (etapa: PrometeuEtapa) => credenciados.filter((c) => c.etapa === etapa).length,
    [credenciados],
  );

  const kpis = useMemo(() => {
    const presentes = credenciados.filter((c) => c.entrouEm !== null);
    const emAtendimento = credenciados.filter((c) =>
      ETAPAS_EM_ATENDIMENTO.includes(c.etapa),
    ).length;
    const concluidos = credenciados.filter((c) => c.etapa === "concluido");

    // Tempo médio: só de quem chegou ao fim, medido da entrada até agora (o carimbo de
    // conclusão ainda não existe como coluna — por isso é aproximação e está rotulado assim).
    const tempos = concluidos
      .filter((c) => c.entrouEm)
      .map((c) => agora - new Date(c.entrouEm!).getTime());
    const medio = tempos.length
      ? tempos.reduce((soma, t) => soma + t, 0) / tempos.length
      : null;

    const base = presentes.length;
    return {
      concluidos: concluidos.length,
      conversao: base > 0 ? Math.round((concluidos.length / base) * 100) : null,
      emAtendimento,
      presentes: presentes.length,
      tempoMedio: medio,
      total: credenciados.length,
    };
  }, [agora, credenciados]);

  const mover = useCallback(
    async (credenciado: PrometeuCredenciado, etapa: PrometeuEtapa) => {
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
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="sticky top-0 z-10 border-b border-black/[0.07] bg-canvas/95 px-5 py-3 backdrop-blur dark:border-white/[0.08]">
        <div className="flex flex-wrap items-center gap-3">
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

          {/* As três abas do mockup, na mesma ordem. */}
          <nav className="flex items-center gap-1 rounded-lg bg-black/[0.05] p-1 dark:bg-white/[0.07]">
            {(
              [
                ["painel", "Painel"],
                ["mapa", "Mapa do salão"],
                ["analitico", "Analítico"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                className={`rounded-md px-4 py-1.5 text-[0.82rem] font-bold transition-colors ${
                  aba === id
                    ? "bg-surface text-[#A07C3B] shadow-sm"
                    : "text-ink-muted hover:text-ink"
                }`}
                onClick={() => setAba(id)}
                type="button"
              >
                {label}
              </button>
            ))}
          </nav>

          <button
            className="ml-auto grid h-8 w-8 place-items-center rounded-lg border border-black/10 text-ink-soft hover:text-ink dark:border-white/10"
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
        </div>
      </header>

      {erro ? (
        <p className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      {/* KPIs ficam acima das abas e valem para todas — igual ao mockup. */}
      <div className="grid gap-3 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          detalhe={`de ${kpis.total} credenciados`}
          label="Presentes agora"
          valor={String(kpis.presentes)}
        />
        <Kpi
          cor="#A07C3B"
          detalhe="salão + secretaria"
          label="Em atendimento"
          valor={String(kpis.emAtendimento)}
        />
        <Kpi
          cor="#22a95b"
          detalhe="fluxo concluído"
          label="Vendas fechadas"
          valor={String(kpis.concluidos)}
        />
        <Kpi
          detalhe="entrada até conclusão"
          label="Tempo médio total"
          valor={
            kpis.tempoMedio === null
              ? "—"
              : duracao(new Date(agora - kpis.tempoMedio).toISOString(), agora)
          }
        />
        <Kpi
          detalhe="presentes que fecharam"
          label="Conversão"
          valor={kpis.conversao === null ? "—" : `${kpis.conversao}%`}
        />
      </div>

      <div className="px-5 pb-6">
        {aba === "painel" ? (
          <Painel
            agora={agora}
            atividade={atividade}
            chamadas={chamadas}
            credenciados={credenciados}
            filaRecepcao={filaRecepcao}
            porEtapa={porEtapa}
          />
        ) : aba === "mapa" ? (
          <MapaDoSalao
            agora={agora}
            credenciados={credenciados}
            mesas={mesas}
            porEtapa={porEtapa}
          />
        ) : (
          <Analitico
            agora={agora}
            busca={busca}
            credenciados={credenciados}
            onBusca={setBusca}
            onMover={mover}
            onSubAba={setSubAba}
            onVerPor={setVerPor}
            subAba={subAba}
            verPor={verPor}
          />
        )}
      </div>
    </div>
  );
}

function Kpi(props: { cor?: string; detalhe: string; label: string; valor: string }) {
  return (
    <div className="rounded-xl border border-black/[0.07] bg-surface px-4 py-3 dark:border-white/[0.08]">
      <div
        className="text-2xl font-bold leading-none tabular-nums text-ink"
        style={props.cor ? { color: props.cor } : undefined}
      >
        {props.valor}
      </div>
      <div className="mt-1.5 text-[0.78rem] font-semibold text-ink">{props.label}</div>
      <div className="text-[0.7rem] text-ink-muted">{props.detalhe}</div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── PAINEL

function Painel(props: {
  agora: number;
  atividade: PrometeuAtividade[];
  chamadas: PrometeuChamada[];
  credenciados: PrometeuCredenciado[];
  filaRecepcao: PrometeuCredenciado[];
  porEtapa: (etapa: PrometeuEtapa) => number;
}) {
  const { agora, porEtapa } = props;

  const presentes = props.credenciados.filter((c) => c.entrouEm !== null).length;

  // Espera média de quem está parado na recepção: alimenta o aviso de gargalo.
  const esperaRecepcao = useMemo(() => {
    const naRecepcao = props.credenciados.filter(
      (c) => c.etapa === "recepcao" && c.entrouEm,
    );
    if (naRecepcao.length === 0) return null;
    const soma = naRecepcao.reduce(
      (total, c) => total + (agora - new Date(c.etapaDesde).getTime()),
      0,
    );
    return Math.round(soma / naRecepcao.length / 60000);
  }, [agora, props.credenciados]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-ink">Mapa da jornada</h2>
          <div className="flex items-center gap-3 text-[0.7rem] text-ink-muted">
            <span>
              <i className="not-italic text-[#A07C3B]">{FONTE_QR}</i> presença via QR
            </span>
            <span>
              <i className="not-italic text-[#2563eb]">{FONTE_DADO}</i> estágio via sistema
            </span>
          </div>
        </div>

        <Zona
          badge={`${FONTE_QR} QR na entrada`}
          nome="Recepção & Espera"
          total={porEtapa("recepcao")}
        >
          <Celula
            detalhe="check-in confirmado"
            fonte="qr"
            label="Credenciados no evento"
            valor={presentes}
          />
          <Celula
            detalhe={
              esperaRecepcao === null
                ? "ninguém aguardando"
                : `espera média ${esperaRecepcao} min`
            }
            fonte="qr"
            gargalo={esperaRecepcao !== null && esperaRecepcao > 20}
            label="Aguardando na espera"
            valor={porEtapa("recepcao")}
          />
        </Zona>

        <Zona
          badge={`${FONTE_QR} bip ao entrar`}
          nome="Salão de Vendas"
          total={porEtapa("negociacao") + porEtapa("reserva")}
        >
          <Celula
            detalhe="mesa de negociação"
            fonte="qr"
            label="Com o corretor"
            valor={porEtapa("negociacao")}
          />
          <Celula
            detalhe="fila física do espelho"
            fonte="dado"
            label="Com reserva"
            valor={porEtapa("reserva")}
          />
        </Zona>

        <Zona
          badge={`${FONTE_QR} bip + chamada por mesa`}
          nome="Secretaria"
          total={porEtapa("secretaria") + porEtapa("proposta") + porEtapa("pagamento")}
        >
          <SubLinha label="Validação e proposta">
            <Celula
              detalhe="aguardando chamada"
              fonte="qr"
              label="Recepção"
              valor={porEtapa("secretaria")}
            />
            <Celula
              detalhe="validação e registro"
              fonte="dado"
              label="Proposta / contrato"
              valor={porEtapa("proposta")}
            />
          </SubLinha>
          <SubLinha label="Financeiro">
            <Celula
              detalhe="recebendo na mesma mesa"
              fonte="dado"
              label="ATO e pagamento"
              valor={porEtapa("pagamento")}
            />
            <Celula
              concluido
              detalhe="fluxo concluído"
              fonte="dado"
              label="Venda concluída ✓"
              valor={porEtapa("concluido")}
            />
          </SubLinha>
        </Zona>

        <Zona
          badge="desistências"
          nome="Cancelados"
          perigo
          total={porEtapa("cancelado")}
        >
          <Celula
            detalhe="desistiu antes de fechar"
            fonte="dado"
            label="Cancelados no evento"
            perigo
            valor={porEtapa("cancelado")}
          />
        </Zona>
      </div>

      <aside className="space-y-4">
        <Card titulo="Fila da recepção">
          {props.filaRecepcao.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-muted">
              Ninguém credenciado ainda.
            </p>
          ) : (
            <ol className="space-y-1.5">
              {props.filaRecepcao.slice(0, 8).map((pessoa, indice) => (
                <li key={pessoa.id} className="flex items-center gap-2">
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#101820] text-[0.68rem] font-bold text-[#cba25a]">
                    {indice + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
                    {pessoa.nome}
                  </span>
                  <span
                    className={`shrink-0 text-[0.65rem] ${pessoa.credenciadoNaJanela ? "text-emerald-600 dark:text-emerald-400" : "text-ink-muted"}`}
                    title={
                      pessoa.credenciadoNaJanela
                        ? "Bipado dentro da janela: ordem do PIX"
                        : "Bipado fora da janela: ordem de chegada"
                    }
                  >
                    {pessoa.credenciadoNaJanela ? "PIX" : "chegada"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card titulo="Funil de unidades">
          <Funil credenciados={props.credenciados} porEtapa={porEtapa} />
        </Card>

        <Card titulo="Últimas chamadas">
          {props.chamadas.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-muted">
              Nenhuma chamada ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {props.chamadas.map((chamada) => (
                <div key={chamada.id} className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-black/[0.06] text-[0.62rem] font-bold text-ink-soft dark:bg-white/[0.08]">
                    {iniciais(chamada.nome)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-semibold text-ink">
                      {chamada.nome}
                    </div>
                    <div className="truncate text-[0.65rem] text-ink-muted">
                      {chamada.zona ?? "Salão"}
                      {chamada.mesa ? ` · Mesa ${chamada.mesa}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-[0.65rem] text-ink-muted">
                    {haQuantoTempo(chamada.chamadoEm, agora)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card titulo="Atividade ao vivo">
          {props.atividade.length === 0 ? (
            <p className="py-4 text-center text-xs text-ink-muted">
              Sem movimentação ainda.
            </p>
          ) : (
            <div className="space-y-2">
              {props.atividade.map((item) => {
                const etapa = PROMETEU_ETAPAS.find((e) => e.id === item.paraEtapa);
                return (
                  <div key={item.id} className="flex items-start gap-2 text-xs">
                    <span
                      className="mt-0.5 shrink-0 not-italic"
                      style={{ color: etapa?.cor }}
                    >
                      {item.deEtapa === null ? FONTE_QR : FONTE_DADO}
                    </span>
                    <span className="min-w-0 flex-1 text-ink-soft">
                      <b className="font-semibold text-ink">{item.nome}</b>{" "}
                      {item.deEtapa === null
                        ? "fez check-in"
                        : `entrou em ${etapa?.label.toLowerCase()}`}
                    </span>
                    <span className="shrink-0 text-[0.65rem] text-ink-muted">
                      {haQuantoTempo(item.em, agora)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </aside>
    </div>
  );
}

function Zona(props: {
  badge: string;
  children: React.ReactNode;
  nome: string;
  perigo?: boolean;
  total: number;
}) {
  return (
    <section className="mb-3 rounded-xl border border-black/[0.07] bg-surface p-3.5 dark:border-white/[0.08]">
      <header className="mb-3 flex flex-wrap items-center gap-2.5">
        <span
          className="text-sm font-bold"
          style={props.perigo ? { color: "#e0554a" } : undefined}
        >
          {props.nome}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[0.65rem] font-semibold ${
            props.perigo
              ? "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300"
              : "bg-black/[0.05] text-ink-muted dark:bg-white/[0.07]"
          }`}
        >
          {props.badge}
        </span>
        <span className="ml-auto text-[0.7rem] text-ink-muted">
          na zona <b className="tabular-nums text-ink">{props.total}</b>
        </span>
      </header>
      <div className="space-y-2">{props.children}</div>
    </section>
  );
}

function SubLinha(props: { children: React.ReactNode; label: string }) {
  return (
    <div className="rounded-lg bg-black/[0.02] p-2 dark:bg-white/[0.03]">
      <div className="mb-1.5 text-[0.65rem] font-semibold uppercase tracking-wide text-ink-muted">
        {props.label}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">{props.children}</div>
    </div>
  );
}

function Celula(props: {
  concluido?: boolean;
  detalhe: string;
  fonte: "qr" | "dado";
  gargalo?: boolean;
  label: string;
  perigo?: boolean;
  valor: number;
}) {
  return (
    <div
      className={`relative rounded-lg border p-2.5 ${
        props.gargalo
          ? "border-red-400/50 bg-red-50/60 dark:bg-red-950/20"
          : props.concluido
            ? "border-emerald-400/40 bg-emerald-50/50 dark:bg-emerald-950/20"
            : "border-black/[0.06] bg-canvas dark:border-white/[0.07]"
      }`}
    >
      {props.gargalo ? (
        <span className="absolute -top-2 left-2 rounded bg-red-600 px-1.5 py-0.5 text-[0.58rem] font-bold text-white">
          GARGALO
        </span>
      ) : null}
      <div className="flex items-center justify-between">
        <span
          className="text-xl font-bold tabular-nums text-ink"
          style={props.perigo ? { color: "#e0554a" } : undefined}
        >
          {props.valor}
        </span>
        <span
          className="not-italic"
          style={{ color: props.fonte === "qr" ? "#A07C3B" : "#2563eb" }}
        >
          {props.fonte === "qr" ? FONTE_QR : FONTE_DADO}
        </span>
      </div>
      <div className="mt-0.5 text-[0.72rem] font-semibold text-ink">{props.label}</div>
      <div className="text-[0.65rem] text-ink-muted">{props.detalhe}</div>
    </div>
  );
}

function Card(props: { children: React.ReactNode; titulo: string }) {
  return (
    <section className="rounded-xl border border-black/[0.07] bg-surface p-3.5 dark:border-white/[0.08]">
      <h3 className="mb-3 text-[0.78rem] font-bold text-ink">{props.titulo}</h3>
      {props.children}
    </section>
  );
}

// O funil do mockup mostrava valor em R$ por faixa. Esse dado vem do C2X (valor da unidade),
// que ainda não está ligado ao Prometeu — então a barra mostra a CONTAGEM real e o valor fica
// como travessão, em vez de número inventado.
function Funil(props: {
  credenciados: PrometeuCredenciado[];
  porEtapa: (etapa: PrometeuEtapa) => number;
}) {
  const reservas = props.credenciados.filter((c) => c.unidades.length > 0).length;
  const linhas = [
    { label: "Reservas", valor: reservas },
    { label: "Propostas", valor: props.porEtapa("proposta") },
    { label: "Pagamento", valor: props.porEtapa("pagamento") },
    { label: "Finalizadas", ok: true, valor: props.porEtapa("concluido") },
  ];
  const topo = Math.max(...linhas.map((l) => l.valor), 1);

  return (
    <div className="space-y-2">
      {linhas.map((linha) => (
        <div key={linha.label} className="flex items-center gap-2">
          <div className="relative h-7 flex-1 overflow-hidden rounded-md bg-black/[0.05] dark:bg-white/[0.07]">
            <div
              className="absolute inset-y-0 left-0 rounded-md"
              style={{
                background: linha.ok ? "#22a95b33" : "#A07C3B33",
                width: `${Math.max(6, (linha.valor / topo) * 100)}%`,
              }}
            />
            <div className="relative flex h-full items-center justify-between px-2">
              <span className="text-[0.7rem] font-semibold text-ink">{linha.label}</span>
              <span className="text-[0.7rem] font-bold tabular-nums text-ink">
                {linha.valor}
              </span>
            </div>
          </div>
          <span
            className="w-16 shrink-0 text-right text-[0.65rem] text-ink-muted"
            title="Valor em R$ virá do C2X quando as unidades forem ligadas ao evento"
          >
            —
          </span>
        </div>
      ))}
    </div>
  );
}

// ──────────────────────────────────────────────────── MAPA DO SALÃO

function MapaDoSalao(props: {
  agora: number;
  credenciados: PrometeuCredenciado[];
  mesas: PrometeuMesa[];
  porEtapa: (etapa: PrometeuEtapa) => number;
}) {
  const { porEtapa } = props;
  const presentes = props.credenciados.filter((c) => c.entrouEm !== null).length;
  const mesasSecretaria = props.mesas.filter((m) => m.zona === "secretaria");

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Sala contagem={presentes} rotulo="credenciados" titulo="🚪 Entrada · Recepção">
          <p className="text-[0.7rem] text-ink-muted">Credenciamento por QR</p>
        </Sala>

        <Sala
          contagem={porEtapa("recepcao")}
          quente={porEtapa("recepcao") > 0}
          rotulo="aguardando"
          titulo="🪑 Área de espera"
        >
          <Pontos cor="#9aa5b4" quantidade={porEtapa("recepcao")} />
        </Sala>

        <Sala
          contagem={porEtapa("negociacao") + porEtapa("reserva")}
          rotulo="na área"
          titulo="🏛️ Salão de vendas"
        >
          <div className="mb-2 rounded-md bg-black/[0.04] py-2 text-center dark:bg-white/[0.06]">
            <div className="text-[0.62rem] font-bold tracking-wide text-ink-soft">
              ESPELHO DE VENDAS
            </div>
            <div className="text-[0.58rem] text-ink-muted">masterplan ao vivo</div>
          </div>
          <div className="mb-1 flex items-center gap-1.5 text-[0.65rem] text-ink-soft">
            <span className="h-2 w-2 rounded-full bg-[#e8792b]" />
            Com corretor <b className="tabular-nums">{porEtapa("negociacao")}</b>
          </div>
          <Pontos cor="#e8792b" quantidade={porEtapa("negociacao")} />
          <div className="mb-1 mt-2 flex items-center gap-1.5 text-[0.65rem] text-ink-soft">
            <span className="h-2 w-2 rounded-full bg-[#2563eb]" />
            Com reserva ativa <b className="tabular-nums">{porEtapa("reserva")}</b>
          </div>
          <Pontos cor="#2563eb" quantidade={porEtapa("reserva")} />
        </Sala>

        <Sala
          contagem={porEtapa("concluido")}
          rotulo="vendas"
          sucesso
          titulo="✓ Concluído"
        >
          <p className="mb-2 text-[0.7rem] text-ink-muted">Contrato e boletos a caminho</p>
          <Pontos cor="#22a95b" quantidade={porEtapa("concluido")} />
        </Sala>
      </div>

      {/* Secretaria ocupa a linha inteira, como no mockup. */}
      <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
        <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-bold text-ink">📋 Secretaria</span>
          <span className="text-[0.7rem] text-ink-muted">
            <b className="tabular-nums text-ink">
              {porEtapa("secretaria") + porEtapa("proposta") + porEtapa("pagamento")}
            </b>{" "}
            na área
          </span>
        </header>
        <p className="mb-3 text-[0.7rem] text-ink-muted">
          Validação, proposta, contrato, ATO e pagamento, tudo na mesma mesa
        </p>

        {mesasSecretaria.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            Nenhuma mesa cadastrada. Defina o número de mesas no Setup e salve.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {mesasSecretaria.map((mesa) => (
              <div
                key={mesa.id}
                className={`grid h-14 w-14 place-items-center rounded-lg border text-center ${
                  mesa.estado === "atendimento"
                    ? "border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/30"
                    : mesa.estado === "ocupada"
                      ? "border-amber-500/50 bg-amber-50 dark:bg-amber-950/30"
                      : "border-black/10 bg-canvas dark:border-white/10"
                }`}
                title={`Mesa ${mesa.numero} · ${mesa.estado}`}
              >
                <span className="text-[0.6rem] text-ink-muted">Mesa</span>
                <span className="text-sm font-bold tabular-nums text-ink">
                  {mesa.numero}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded-lg border border-black/[0.06] px-3 py-2 text-[0.65rem] text-ink-muted dark:border-white/[0.07]">
        <Legenda cor="#9aa5b4" texto="aguardando" />
        <Legenda cor="#e8792b" texto="com corretor" />
        <Legenda cor="#2563eb" texto="reserva ativa" />
        <Legenda cor="#e0554a" texto="cancelado" />
        <Legenda cor="#22a95b" texto="concluído" />
        <span className="text-ink-muted/50">|</span>
        <span className="font-bold text-ink-soft">mesa</span>
        <Legenda cor="#22a95b" texto="atendendo" />
        <Legenda cor="#e0a52e" texto="ocupada" />
        <Legenda cor="#9aa5b4" texto="livre" />
      </div>
    </div>
  );
}

function Sala(props: {
  children: React.ReactNode;
  contagem: number;
  quente?: boolean;
  rotulo: string;
  sucesso?: boolean;
  titulo: string;
}) {
  return (
    <section
      className={`flex flex-col rounded-xl border bg-surface p-3.5 ${
        props.quente
          ? "border-red-400/40"
          : props.sucesso
            ? "border-emerald-400/40"
            : "border-black/[0.07] dark:border-white/[0.08]"
      }`}
    >
      <header className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[0.8rem] font-bold text-ink">{props.titulo}</span>
        <span className="shrink-0 text-[0.65rem] text-ink-muted">
          <b className="tabular-nums text-ink">{props.contagem}</b> {props.rotulo}
        </span>
      </header>
      {props.children}
    </section>
  );
}

// Cada ponto é uma pessoa na sala — a leitura de ocupação que o mockup tinha.
function Pontos(props: { cor: string; quantidade: number }) {
  const teto = Math.min(props.quantidade, 40);
  return (
    <div className="flex flex-wrap gap-1">
      {Array.from({ length: teto }, (_, i) => (
        <span
          key={i}
          className="h-2 w-2 rounded-full"
          style={{ background: props.cor }}
        />
      ))}
      {props.quantidade > teto ? (
        <span className="text-[0.6rem] text-ink-muted">+{props.quantidade - teto}</span>
      ) : null}
    </div>
  );
}

function Legenda(props: { cor: string; texto: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <i className="h-2 w-2 rounded-full" style={{ background: props.cor }} />
      {props.texto}
    </span>
  );
}

// ────────────────────────────────────────────────────── ANALÍTICO

function Analitico(props: {
  agora: number;
  busca: string;
  credenciados: PrometeuCredenciado[];
  onBusca: (valor: string) => void;
  onMover: (c: PrometeuCredenciado, etapa: PrometeuEtapa) => void;
  onSubAba: (valor: SubAba) => void;
  onVerPor: (valor: VerPor) => void;
  subAba: SubAba;
  verPor: VerPor;
}) {
  const filtrados = useMemo(() => {
    const termo = props.busca.trim().toLowerCase();
    if (!termo) return props.credenciados;
    return props.credenciados.filter((c) =>
      [c.nome, c.imobiliaria, c.corretor, c.documento, ...c.unidades.map((u) => u.codigo)]
        .filter(Boolean)
        .some((campo) => String(campo).toLowerCase().includes(termo)),
    );
  }, [props.busca, props.credenciados]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {/* Lista e Kanban são SUB-abas do Analítico — como no mockup aprovado. */}
        <div className="flex items-center gap-1 rounded-lg bg-black/[0.05] p-1 dark:bg-white/[0.07]">
          {(
            [
              ["lista", "Lista"],
              ["kanban", "Kanban"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`rounded-md px-4 py-1 text-[0.78rem] font-bold transition-colors ${
                props.subAba === id
                  ? "bg-surface text-[#A07C3B] shadow-sm"
                  : "text-ink-muted hover:text-ink"
              }`}
              onClick={() => props.onSubAba(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <input
          className="min-w-[220px] flex-1 rounded-lg border border-black/10 bg-surface px-3 py-1.5 text-sm text-ink dark:border-white/10"
          onChange={(e) => props.onBusca(e.target.value)}
          placeholder="Buscar por cliente, imobiliária ou unidade..."
          value={props.busca}
        />

        <div className="flex items-center gap-1.5 text-[0.7rem] text-ink-muted">
          <span>Ver por</span>
          {(
            [
              ["cliente", "Cliente"],
              ["imobiliaria", "Imobiliária"],
              ["unidade", "Unidade"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={`rounded-md px-2 py-1 font-semibold transition-colors ${
                props.verPor === id
                  ? "bg-black/[0.07] text-ink dark:bg-white/[0.1]"
                  : "hover:text-ink"
              }`}
              onClick={() => props.onVerPor(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <span className="text-[0.7rem] text-ink-muted">
          {filtrados.length} {filtrados.length === 1 ? "registro" : "registros"}
        </span>
      </div>

      {props.subAba === "lista" ? (
        <Lista agora={props.agora} credenciados={filtrados} verPor={props.verPor} />
      ) : (
        <Kanban agora={props.agora} credenciados={filtrados} onMover={props.onMover} />
      )}
    </div>
  );
}

function Lista(props: {
  agora: number;
  credenciados: PrometeuCredenciado[];
  verPor: VerPor;
}) {
  // "Ver por" agrupa a mesma base por outro eixo, como no mockup.
  if (props.verPor !== "cliente") {
    const chave = (c: PrometeuCredenciado): string[] =>
      props.verPor === "imobiliaria"
        ? [c.imobiliaria ?? "Sem imobiliária"]
        : c.unidades.length > 0
          ? c.unidades.map((u) => u.codigo)
          : ["Sem unidade"];

    const grupos = new Map<string, PrometeuCredenciado[]>();
    for (const credenciado of props.credenciados) {
      for (const nome of chave(credenciado)) {
        grupos.set(nome, [...(grupos.get(nome) ?? []), credenciado]);
      }
    }

    return (
      <div className="space-y-2">
        {[...grupos.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(([nome, membros]) => (
            <section
              key={nome}
              className="rounded-xl border border-black/[0.07] bg-surface p-3 dark:border-white/[0.08]"
            >
              <header className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold text-ink">{nome}</span>
                <span className="rounded-full bg-black/[0.06] px-2 py-0.5 text-[0.68rem] font-semibold text-ink-soft dark:bg-white/[0.08]">
                  {membros.length}
                </span>
              </header>
              <div className="flex flex-wrap gap-1.5">
                {membros.map((membro) => {
                  const etapa = PROMETEU_ETAPAS.find((e) => e.id === membro.etapa);
                  return (
                    <span
                      key={membro.id}
                      className="rounded-md px-2 py-0.5 text-[0.7rem] font-medium"
                      style={{ background: `${etapa?.cor}1a`, color: etapa?.cor }}
                    >
                      {membro.nome}
                    </span>
                  );
                })}
              </div>
            </section>
          ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-black/[0.07] dark:border-white/[0.08]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-surface text-left text-[0.68rem] uppercase tracking-wide text-ink-muted">
            <th className="px-3 py-2 font-semibold">#</th>
            <th className="px-3 py-2 font-semibold">Cliente</th>
            <th className="px-3 py-2 font-semibold">Imobiliária</th>
            <th className="px-3 py-2 font-semibold">Unidades</th>
            <th className="px-3 py-2 font-semibold">Etapa</th>
            <th className="px-3 py-2 font-semibold">No evento</th>
            <th className="px-3 py-2 font-semibold">No estágio</th>
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
                <td className="px-3 py-2 font-semibold tabular-nums text-ink-soft">
                  {credenciado.posicao ?? "—"}
                </td>
                <td className="px-3 py-2 font-medium text-ink">{credenciado.nome}</td>
                <td className="px-3 py-2 text-ink-soft">
                  {credenciado.imobiliaria ?? "—"}
                </td>
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
                  {credenciado.entrouEm ? duracao(credenciado.entrouEm, props.agora) : "—"}
                </td>
                <td className="px-3 py-2 text-ink-soft">
                  {duracao(credenciado.etapaDesde, props.agora)}
                </td>
              </tr>
            );
          })}
          {props.credenciados.length === 0 ? (
            <tr>
              <td className="px-3 py-10 text-center text-sm text-ink-muted" colSpan={7}>
                Ninguém no evento ainda.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function Kanban(props: {
  agora: number;
  credenciados: PrometeuCredenciado[];
  onMover: (c: PrometeuCredenciado, etapa: PrometeuEtapa) => void;
}) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {PROMETEU_ETAPAS.map((etapa) => {
        const doGrupo = props.credenciados.filter((c) => c.etapa === etapa.id);
        return (
          <section
            key={etapa.id}
            className="flex w-[270px] shrink-0 flex-col rounded-xl border border-black/[0.07] bg-surface dark:border-white/[0.08]"
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

            <div className="min-h-0 flex-1 space-y-2 p-2">
              {doGrupo.map((credenciado) => (
                <article
                  key={credenciado.id}
                  className="rounded-lg border border-black/[0.07] bg-canvas p-2.5 dark:border-white/[0.08]"
                >
                  <div className="flex items-start gap-2">
                    {credenciado.posicao ? (
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-[#101820] text-[0.68rem] font-bold text-[#cba25a]">
                        {credenciado.posicao}
                      </span>
                    ) : null}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">
                        {credenciado.nome}
                      </p>
                      {credenciado.imobiliaria ? (
                        <p className="truncate text-xs text-ink-soft">
                          {credenciado.imobiliaria}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  {credenciado.unidades.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {credenciado.unidades.map((unidade) => (
                        <span
                          key={unidade.id}
                          className="rounded bg-black/[0.06] px-1.5 py-0.5 text-[0.66rem] font-medium text-ink-soft dark:bg-white/[0.08]"
                        >
                          {unidade.codigo}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-2 flex items-center justify-between gap-2 text-[0.66rem] text-ink-muted">
                    <span title="Tempo neste estágio">
                      {duracao(credenciado.etapaDesde, props.agora)}
                    </span>
                    <span title="Chegou ao evento">{horaCurta(credenciado.entrouEm)}</span>
                  </div>

                  <select
                    className="mt-2 w-full rounded-md border border-black/10 bg-surface px-2 py-1 text-xs text-ink dark:border-white/10"
                    onChange={(e) =>
                      props.onMover(credenciado, e.target.value as PrometeuEtapa)
                    }
                    value={credenciado.etapa}
                  >
                    {PROMETEU_ETAPAS.map((opcao) => (
                      <option key={opcao.id} value={opcao.id}>
                        {opcao.label}
                      </option>
                    ))}
                  </select>
                </article>
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
