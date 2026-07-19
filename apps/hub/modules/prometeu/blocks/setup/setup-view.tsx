"use client";

import {
  AlertTriangle,
  CalendarClock,
  Check,
  Loader2,
  Moon,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PrometeuEvento,
  PrometeuEventoConfig,
  PrometeuJanela,
} from "@/lib/prometeu/types";

import {
  ativarEventoRemoto,
  criarEventoRemoto,
  encerrarDiaRemoto,
  fetchEmpreendimentos,
  fetchEventos,
  fetchJanelas,
  iniciarEventoRealRemoto,
  salvarEventoRemoto,
  salvarJanelaRemoto,
  type PrometeuEmpreendimento,
} from "../../data/prometeu-operations";

// Setup do Prometeu: onde o lançamento é configurado e ATIVADO.
//
// A data do evento é informativa (decisão do Lucas 19/jul) — quem manda é o status:
//   rascunho → ativo (libera preparação: CAD, etiqueta, PIX, fila e os testes)
//            → em andamento (o dia real; o reset dos testes já rodou)

const METAS_PADRAO: NonNullable<PrometeuEventoConfig["metas"]> = {
  atendimento: { alerta: 40, meta: 20 },
  filaRecepcao: { alerta: 20, meta: 10 },
  filaSecretaria: { alerta: 25, meta: 12 },
  negociacao: { alerta: 30, meta: 15 },
  tempoMedioAtendimento: 20,
  tempoTotalEvento: 45,
};

const LINHAS_META = [
  { cor: "#64748b", chave: "filaRecepcao", label: "Fila da recepção", sub: "espera até ser chamado pro salão" },
  { cor: "#ec7f2e", chave: "negociacao", label: "Negociação (salão)", sub: "tempo com o corretor no salão" },
  { cor: "#8b5cf6", chave: "filaSecretaria", label: "Fila da secretaria", sub: "espera até o atendente chamar" },
  { cor: "#22a95b", chave: "atendimento", label: "Atendimento", sub: "na mesa da secretaria" },
] as const;

const ROTULO_STATUS: Record<string, { cor: string; label: string }> = {
  ativo: { cor: "#22a95b", label: "Ativo · em preparação" },
  em_andamento: { cor: "#e0a52e", label: "Evento em andamento" },
  encerrado: { cor: "#64748b", label: "Encerrado" },
  rascunho: { cor: "#64748b", label: "Rascunho" },
};

export function SetupView() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState("");
  const [empreendimentos, setEmpreendimentos] = useState<PrometeuEmpreendimento[]>([]);
  const [janelas, setJanelas] = useState<PrometeuJanela[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmandoReset, setConfirmandoReset] = useState(false);
  const [confirmandoEncerrar, setConfirmandoEncerrar] = useState(false);

  // Formulário
  const [nome, setNome] = useState("");
  const [enterpriseId, setEnterpriseId] = useState("");
  const [construtora, setConstrutora] = useState("");
  const [local, setLocal] = useState("");
  const [dataEvento, setDataEvento] = useState("");
  const [mesas, setMesas] = useState(10);
  const [whatsapp, setWhatsapp] = useState(true);
  const [metas, setMetas] = useState(METAS_PADRAO);

  const evento = useMemo(
    () => eventos.find((e) => e.id === eventoId) ?? null,
    [eventoId, eventos],
  );

  const preencher = useCallback((alvo: PrometeuEvento) => {
    setNome(alvo.nome);
    setEnterpriseId(alvo.enterpriseId ?? "");
    setDataEvento(alvo.dataEvento ? alvo.dataEvento.slice(0, 10) : "");
    setConstrutora(alvo.config.construtora ?? "");
    setLocal(alvo.config.local ?? "");
    setMesas(alvo.config.mesasSecretaria ?? 10);
    setWhatsapp(alvo.config.senhaPorWhatsapp ?? true);
    setMetas({ ...METAS_PADRAO, ...(alvo.config.metas ?? {}) });
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    const [resEventos, resEmpreendimentos] = await Promise.all([
      fetchEventos(),
      fetchEmpreendimentos(),
    ]);

    if (resEventos.error) setErro(resEventos.error);
    const lista = resEventos.data ?? [];
    setEventos(lista);
    setEmpreendimentos(resEmpreendimentos.data ?? []);

    const alvo = lista[0];
    if (alvo) {
      setEventoId(alvo.id);
      preencher(alvo);
      const res = await fetchJanelas(alvo.id);
      setJanelas(res.data ?? []);
    }
    setCarregando(false);
  }, [preencher]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const trocarEvento = useCallback(
    async (id: string) => {
      setEventoId(id);
      const alvo = eventos.find((e) => e.id === id);
      if (alvo) preencher(alvo);
      const res = await fetchJanelas(id);
      setJanelas(res.data ?? []);
    },
    [eventos, preencher],
  );

  const salvar = useCallback(async () => {
    if (!eventoId) return;
    setSalvando(true);
    setErro(null);

    const escolhido = empreendimentos.find((e) => e.id === enterpriseId);
    const { data, error } = await salvarEventoRemoto({
      config: {
        construtora,
        local,
        mesasSecretaria: mesas,
        metas,
        senhaPorWhatsapp: whatsapp,
      },
      dataEvento: dataEvento || null,
      enterpriseCode: escolhido?.code ?? null,
      enterpriseId: enterpriseId || null,
      eventoId,
      nome,
    });

    setSalvando(false);
    if (error) {
      setErro(error);
      return;
    }
    if (data) {
      setEventos((atual) => atual.map((e) => (e.id === data.id ? data : e)));
      setAviso(`Configuração salva · ${mesas} mesas da secretaria criadas.`);
      window.setTimeout(() => setAviso(null), 4000);
    }
  }, [
    construtora,
    dataEvento,
    empreendimentos,
    enterpriseId,
    eventoId,
    local,
    mesas,
    metas,
    nome,
    whatsapp,
  ]);

  const ativar = useCallback(async () => {
    if (!eventoId) return;
    const { error } = await ativarEventoRemoto(eventoId);
    if (error) {
      setErro(error);
      return;
    }
    setEventos((atual) =>
      atual.map((e) => (e.id === eventoId ? { ...e, status: "ativo" } : e)),
    );
    setAviso("Lançamento ativo. Já pode subir CAD, imprimir etiqueta e montar a fila.");
  }, [eventoId]);

  const iniciarReal = useCallback(async () => {
    if (!eventoId) return;
    const { data, error } = await iniciarEventoRealRemoto({ eventoId });
    setConfirmandoReset(false);
    if (error) {
      setErro(error);
      return;
    }
    setEventos((atual) =>
      atual.map((e) => (e.id === eventoId ? { ...e, status: "em_andamento" } : e)),
    );
    setAviso(
      `Evento real iniciado. ${data?.resetados ?? 0} credenciados voltaram pro começo, com a fila preservada.`,
    );
  }, [eventoId]);

  const encerrarODia = useCallback(
    async (encerrarEvento: boolean) => {
      if (!eventoId) return;
      const { data, error } = await encerrarDiaRemoto({ encerrarEvento, eventoId });
      setConfirmandoEncerrar(false);
      if (error) {
        setErro(error);
        return;
      }
      if (encerrarEvento) {
        setEventos((atual) =>
          atual.map((e) => (e.id === eventoId ? { ...e, status: "encerrado" } : e)),
        );
      }
      setAviso(
        `Dia encerrado · ${data?.concluidos ?? 0} concluíram o fluxo e ficam no histórico; ${data?.arquivados ?? 0} não finalizaram e saíram da operação.`,
      );
    },
    [eventoId],
  );

  const criar = useCallback(async () => {
    const { data, error } = await criarEventoRemoto({ nome: "Novo lançamento" });
    if (error) {
      setErro(error);
      return;
    }
    if (data) {
      setEventos((atual) => [data, ...atual]);
      setEventoId(data.id);
      preencher(data);
      setJanelas([]);
    }
  }, [preencher]);

  if (carregando) {
    return (
      <div className="grid h-full place-items-center bg-canvas">
        <Loader2 className="animate-spin text-ink-muted" size={22} />
      </div>
    );
  }

  if (!evento) {
    return (
      <div className="grid h-full place-items-center bg-canvas p-8">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-ink">Nenhum lançamento ainda</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Crie o lançamento para configurar o evento, as janelas de credenciamento e as mesas.
          </p>
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8d6c33]"
            onClick={() => void criar()}
            type="button"
          >
            <Plus size={16} /> Criar lançamento
          </button>
          {erro ? <p className="mt-4 text-sm text-red-600">{erro}</p> : null}
        </div>
      </div>
    );
  }

  const status = ROTULO_STATUS[evento.status] ?? ROTULO_STATUS.rascunho!;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-black/[0.07] bg-canvas/95 px-5 py-3 backdrop-blur dark:border-white/[0.08]">
        <select
          className="rounded-lg border border-black/10 bg-surface px-3 py-1.5 text-sm font-semibold text-ink dark:border-white/10"
          onChange={(e) => void trocarEvento(e.target.value)}
          value={eventoId}
        >
          {eventos.map((item) => (
            <option key={item.id} value={item.id}>
              {item.nome}
            </option>
          ))}
        </select>

        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold"
          style={{ background: `${status.cor}1a`, color: status.cor }}
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: status.cor }} />
          {status.label}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-1.5 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
            disabled={salvando}
            onClick={() => void salvar()}
            type="button"
          >
            {salvando ? <Loader2 className="animate-spin" size={15} /> : <Save size={15} />}
            Salvar
          </button>

          {evento.status === "rascunho" ? (
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-[#22a95b] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#1c8f4c]"
              onClick={() => void ativar()}
              type="button"
            >
              <Check size={15} /> Ativar lançamento
            </button>
          ) : null}

          {evento.status === "ativo" ? (
            <button
              className="inline-flex items-center gap-2 rounded-lg bg-[#101820] px-3.5 py-1.5 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733]"
              onClick={() => setConfirmandoReset(true)}
              type="button"
            >
              <Play size={15} /> Iniciar evento real
            </button>
          ) : null}

          {/* Com o evento rodando, o reset some da tela: não há mais como zerar. Sobra fechar
              o dia, que preserva quem concluiu. */}
          {evento.status === "em_andamento" ? (
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
              onClick={() => setConfirmandoEncerrar(true)}
              type="button"
            >
              <Moon size={15} /> Encerrar o dia
            </button>
          ) : null}
        </div>
      </header>

      {aviso ? (
        <p className="mx-5 mt-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300">
          {aviso}
        </p>
      ) : null}
      {erro ? (
        <p className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      <div className="space-y-4 p-5">
        <Card
          hint="A data é informativa: quem libera a operação é o botão de ativar"
          titulo="Configuração do lançamento"
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Campo label="Nome do lançamento">
              <input
                className={inputClasse}
                onChange={(e) => setNome(e.target.value)}
                value={nome}
              />
            </Campo>

            <Campo label="Empreendimento">
              <select
                className={inputClasse}
                onChange={(e) => setEnterpriseId(e.target.value)}
                value={enterpriseId}
              >
                <option value="">Selecione</option>
                {empreendimentos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.code ? ` · ${item.code}` : ""}
                  </option>
                ))}
              </select>
              {empreendimentos.length === 0 ? (
                <p className="mt-1 text-xs text-ink-muted">
                  Nenhum empreendimento com credenciamento ativo no Apolo.
                </p>
              ) : null}
            </Campo>

            <Campo label="Construtora">
              <input
                className={inputClasse}
                onChange={(e) => setConstrutora(e.target.value)}
                value={construtora}
              />
            </Campo>

            <Campo label="Data do lançamento">
              <input
                className={inputClasse}
                onChange={(e) => setDataEvento(e.target.value)}
                type="date"
                value={dataEvento}
              />
            </Campo>

            <Campo label="Local do evento">
              <input
                className={inputClasse}
                onChange={(e) => setLocal(e.target.value)}
                value={local}
              />
            </Campo>

            <Campo label="Mesas da secretaria">
              <input
                className={inputClasse}
                max={28}
                min={1}
                onChange={(e) => setMesas(Math.max(1, Number(e.target.value) || 1))}
                type="number"
                value={mesas}
              />
              <p className="mt-1 text-xs text-ink-muted">
                Criadas ao salvar, numeradas de 01 a {String(mesas).padStart(2, "0")}.
              </p>
            </Campo>

            <Campo label="Senha da fila">
              <button
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  whatsapp
                    ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                    : "border-black/10 text-ink-soft dark:border-white/10"
                }`}
                onClick={() => setWhatsapp((v) => !v)}
                type="button"
              >
                <span
                  className={`h-4 w-7 rounded-full p-0.5 transition-colors ${whatsapp ? "bg-emerald-500" : "bg-black/20 dark:bg-white/20"}`}
                >
                  <span
                    className={`block h-3 w-3 rounded-full bg-white transition-transform ${whatsapp ? "translate-x-3" : ""}`}
                  />
                </span>
                Enviar pelo WhatsApp
              </button>
            </Campo>
          </div>
        </Card>

        <JanelasCard
          eventoId={eventoId}
          janelas={janelas}
          onMudou={async () => {
            const res = await fetchJanelas(eventoId);
            setJanelas(res.data ?? []);
          }}
          onErro={setErro}
        />

        <Card
          hint="Referência dos indicadores · colorem gargalos na Central e no tablet do atendente"
          titulo="Metas de tempo"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo label="Tempo total no evento (meta)">
              <div className="flex items-center gap-2">
                <input
                  className={`${inputClasse} w-24`}
                  min={1}
                  onChange={(e) =>
                    setMetas((m) => ({ ...m, tempoTotalEvento: Number(e.target.value) || 0 }))
                  }
                  type="number"
                  value={metas.tempoTotalEvento ?? 45}
                />
                <span className="text-xs text-ink-muted">min · credenciamento → concluído</span>
              </div>
            </Campo>
            <Campo label="Tempo médio de atendimento (meta)">
              <div className="flex items-center gap-2">
                <input
                  className={`${inputClasse} w-24`}
                  min={1}
                  onChange={(e) =>
                    setMetas((m) => ({
                      ...m,
                      tempoMedioAtendimento: Number(e.target.value) || 0,
                    }))
                  }
                  type="number"
                  value={metas.tempoMedioAtendimento ?? 20}
                />
                <span className="text-xs text-ink-muted">min · na mesa da secretaria</span>
              </div>
            </Campo>
          </div>

          <div className="mt-4 space-y-2">
            {LINHAS_META.map((linha) => {
              const atual = metas[linha.chave] ?? { alerta: 0, meta: 0 };
              return (
                <div
                  key={linha.chave}
                  className="flex flex-wrap items-center gap-3 rounded-lg border border-black/[0.06] px-3 py-2 dark:border-white/[0.07]"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: linha.cor }}
                  />
                  <div className="min-w-[180px] flex-1">
                    <p className="text-sm font-semibold text-ink">{linha.label}</p>
                    <p className="text-xs text-ink-muted">{linha.sub}</p>
                  </div>
                  <MetaInput
                    label="Meta"
                    onChange={(v) =>
                      setMetas((m) => ({ ...m, [linha.chave]: { ...atual, meta: v } }))
                    }
                    valor={atual.meta}
                  />
                  <MetaInput
                    alerta
                    label="Alerta"
                    onChange={(v) =>
                      setMetas((m) => ({ ...m, [linha.chave]: { ...atual, alerta: v } }))
                    }
                    valor={atual.alerta}
                  />
                </div>
              );
            })}
          </div>
        </Card>

        <p className="px-1 pb-2 text-xs text-ink-muted">
          A equipe do lançamento (coordenação, recepção, salão, secretaria e mesas) ainda não
          está aqui: depende dos usuários do hub e dos contatos da construtora no Apolo.
        </p>
      </div>

      {confirmandoReset ? (
        <ModalReset
          onCancelar={() => setConfirmandoReset(false)}
          onConfirmar={() => void iniciarReal()}
        />
      ) : null}

      {confirmandoEncerrar ? (
        <ModalEncerrarDia
          onCancelar={() => setConfirmandoEncerrar(false)}
          onConfirmar={(encerrarEvento) => void encerrarODia(encerrarEvento)}
        />
      ) : null}
    </div>
  );
}

const inputClasse =
  "w-full rounded-lg border border-black/10 bg-surface px-3 py-2 text-sm text-ink dark:border-white/10";

function Card(props: { children: React.ReactNode; hint?: string; titulo: string }) {
  return (
    <section className="rounded-xl border border-black/[0.07] bg-surface p-4 dark:border-white/[0.08]">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2 border-b border-black/[0.06] pb-3 dark:border-white/[0.07]">
        <h2 className="text-[0.8rem] font-semibold uppercase tracking-wide text-ink-soft">
          {props.titulo}
        </h2>
        {props.hint ? <span className="text-xs text-ink-muted">{props.hint}</span> : null}
      </header>
      {props.children}
    </section>
  );
}

function Campo(props: { children: React.ReactNode; label: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-wide text-ink-muted">
        {props.label}
      </span>
      {props.children}
    </label>
  );
}

function MetaInput(props: {
  alerta?: boolean;
  label: string;
  onChange: (valor: number) => void;
  valor: number;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-ink-muted">
        {props.label}
      </span>
      <input
        className={`w-16 rounded-md border px-2 py-1 text-sm text-ink ${
          props.alerta
            ? "border-red-300 bg-red-50/50 dark:border-red-900/50 dark:bg-red-950/20"
            : "border-black/10 bg-canvas dark:border-white/10"
        }`}
        min={1}
        onChange={(e) => props.onChange(Number(e.target.value) || 0)}
        type="number"
        value={props.valor}
      />
      <span className="text-[0.65rem] text-ink-muted">min</span>
    </span>
  );
}

// As janelas decidem o regime da fila no dia: bipado dentro dela segue a ordem do PIX;
// bipado depois, ordem de chegada. Uma linha por dia de credenciamento.
function JanelasCard(props: {
  eventoId: string;
  janelas: PrometeuJanela[];
  onErro: (erro: string) => void;
  onMudou: () => Promise<void>;
}) {
  const [data, setData] = useState("");
  const [inicio, setInicio] = useState("08:00");
  const [fim, setFim] = useState("09:00");
  const [salvando, setSalvando] = useState(false);

  const adicionar = async () => {
    if (!data) {
      props.onErro("Escolha a data da janela de credenciamento.");
      return;
    }
    setSalvando(true);
    const { error } = await salvarJanelaRemoto({
      data,
      eventoId: props.eventoId,
      horaFim: fim,
      horaInicio: inicio,
    });
    setSalvando(false);
    if (error) {
      props.onErro(error);
      return;
    }
    setData("");
    await props.onMudou();
  };

  return (
    <Card
      hint="Quem é bipado dentro da janela entra pela ordem do PIX; depois dela, por ordem de chegada"
      titulo="Janelas de credenciamento"
    >
      {props.janelas.length > 0 ? (
        <ul className="mb-4 space-y-2">
          {props.janelas.map((janela) => (
            <li
              key={janela.id}
              className="flex items-center gap-3 rounded-lg border border-black/[0.06] px-3 py-2 dark:border-white/[0.07]"
            >
              <CalendarClock className="text-ink-muted" size={16} />
              <span className="text-sm font-semibold text-ink">
                {new Date(`${janela.data}T12:00:00`).toLocaleDateString("pt-BR", {
                  day: "2-digit",
                  month: "long",
                  weekday: "long",
                })}
              </span>
              <span className="ml-auto rounded-full bg-black/[0.06] px-2.5 py-0.5 text-sm font-semibold text-ink-soft dark:bg-white/[0.08]">
                {janela.horaInicio.slice(0, 5)} às {janela.horaFim.slice(0, 5)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Sem janela cadastrada. Sem ela, todo mundo que bipar entra por ordem de chegada e a
          ordem do PIX não vale no dia.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <Campo label="Dia">
          <input
            className={inputClasse}
            onChange={(e) => setData(e.target.value)}
            type="date"
            value={data}
          />
        </Campo>
        <Campo label="Início">
          <input
            className={inputClasse}
            onChange={(e) => setInicio(e.target.value)}
            type="time"
            value={inicio}
          />
        </Campo>
        <Campo label="Fim">
          <input
            className={inputClasse}
            onChange={(e) => setFim(e.target.value)}
            type="time"
            value={fim}
          />
        </Campo>
        <button
          className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
          disabled={salvando}
          onClick={() => void adicionar()}
          type="button"
        >
          {salvando ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
          Adicionar janela
        </button>
      </div>
    </Card>
  );
}

// Fim de um dia do evento. Quem concluiu vira dado de performance; quem parou no meio sai da
// operação (mas continua no histórico — arquivar, não apagar).
function ModalEncerrarDia(props: {
  onCancelar: () => void;
  onConfirmar: (encerrarEvento: boolean) => void;
}) {
  const [ultimoDia, setUltimoDia] = useState(false);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-black/10 bg-surface p-5 dark:border-white/10">
        <h3 className="text-base font-semibold text-ink">Encerrar o dia</h3>
        <p className="mt-1 text-sm text-ink-soft">
          Fecha a operação do dia. Quem <strong className="text-ink">concluiu</strong> o fluxo
          permanece, e vira o dado de performance do time. Quem ficou no meio do caminho sai da
          fila e das telas.
        </p>

        <p className="mt-3 rounded-lg bg-black/[0.04] px-3 py-2 text-sm text-ink-soft dark:bg-white/[0.06]">
          Ninguém é apagado: quem não finalizou fica arquivado, com a etapa em que parou. É o
          que responde depois quantas pessoas o time perdeu, e onde.
        </p>

        <label className="mt-4 flex items-start gap-2.5 rounded-lg border border-black/[0.07] p-3 dark:border-white/[0.08]">
          <input
            checked={ultimoDia}
            className="mt-0.5"
            onChange={(e) => setUltimoDia(e.target.checked)}
            type="checkbox"
          />
          <span className="text-sm text-ink-soft">
            <strong className="text-ink">Este é o último dia do evento.</strong> Marque só no
            fechamento final. Sem isso o evento continua em andamento e recebe a próxima leva
            amanhã.
          </span>
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-lg border border-black/10 px-3.5 py-2 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
            onClick={props.onCancelar}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#101820] px-3.5 py-2 text-sm font-semibold text-[#cba25a] hover:bg-[#1c2733]"
            onClick={() => props.onConfirmar(ultimoDia)}
            type="button"
          >
            <Moon size={15} />
            {ultimoDia ? "Encerrar o evento" : "Encerrar o dia"}
          </button>
        </div>
      </div>
    </div>
  );
}

// O reset é irreversível: a confirmação lista exatamente o que sai e o que fica.
function ModalReset(props: { onCancelar: () => void; onConfirmar: () => void }) {
  const [texto, setTexto] = useState("");
  const liberado = texto.trim().toUpperCase() === "INICIAR";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-xl border border-black/10 bg-surface p-5 dark:border-white/10">
        <div className="flex items-start gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
            <AlertTriangle size={18} />
          </span>
          <div>
            <h3 className="text-base font-semibold text-ink">Iniciar o evento real</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Isto apaga tudo que veio dos testes. Não tem volta.
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
              Fica
            </p>
            <ul className="space-y-1 text-sm text-ink-soft">
              <li>Credenciados habilitados</li>
              <li>A fila (ordem do PIX)</li>
              <li>Etiquetas impressas</li>
            </ul>
          </div>
          <div className="rounded-lg border border-red-500/30 bg-red-50/60 p-3 dark:bg-red-950/20">
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-red-700 dark:text-red-400">
              Some
            </p>
            <ul className="space-y-1 text-sm text-ink-soft">
              <li>Chamadas e histórico</li>
              <li>Quadra/lote reservados</li>
              <li>Mesas ocupadas e check-ins</li>
            </ul>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1.5 block text-xs text-ink-soft">
            Digite <strong className="text-ink">INICIAR</strong> para confirmar:
          </span>
          <input
            autoFocus
            className={inputClasse}
            onChange={(e) => setTexto(e.target.value)}
            value={texto}
          />
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button
            className="rounded-lg border border-black/10 px-3.5 py-2 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
            onClick={props.onCancelar}
            type="button"
          >
            Cancelar
          </button>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3.5 py-2 text-sm font-semibold text-white transition-opacity hover:bg-red-700 disabled:opacity-40"
            disabled={!liberado}
            onClick={props.onConfirmar}
            type="button"
          >
            <Trash2 size={15} /> Resetar e iniciar
          </button>
        </div>
      </div>
    </div>
  );
}
