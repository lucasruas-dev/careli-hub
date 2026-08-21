"use client";

import {
  AlertTriangle,
  Check,
  Clock,
  Loader2,
  Moon,
  Archive,
  ArchiveRestore,
  Play,
  Plus,
  QrCode,
  Save,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  PrometeuEvento,
  PrometeuEventoConfig,
} from "@/lib/prometeu/types";

import {
  arquivarEventoRemoto,
  ativarEventoRemoto,
  criarEventoRemoto,
  encerrarDiaRemoto,
  criarTemplateBoasVindasRemoto,
  criarTemplateChamadoRemoto,
  fetchEmpreendimentos,
  fetchEventos,
  iniciarEventoRealRemoto,
  salvarEventoRemoto,
  type PrometeuEmpreendimento,
} from "../../data/prometeu-operations";
import { EquipeConteudo } from "./equipe-conteudo";
import { MaestroConteudo } from "./maestro-conteudo";

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

// As frentes do cockpit: o que se configura, quem opera e o palco (fundo dos telões). O header
// (evento + ciclo de vida) fica fora das abas, sempre visível.
type Aba = "config" | "equipe" | "teloes";

export function SetupView() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState("");
  const [empreendimentos, setEmpreendimentos] = useState<PrometeuEmpreendimento[]>([]);
  // NOVO LANCAMENTO. `null` = modal fechado. Ele existe porque criar um lancamento sem
  // EMPREENDIMENTO produz dado errado em silencio: a reserva de unidade sai com a sigla de outro
  // loteamento (era `?? "VLO"` em prometeu/data.ts) e a fila do Apolo nao tem como se amarrar.
  const [novo, setNovo] = useState<
    null | { data: string; enterpriseId: string; nome: string }
  >(null);
  const [criandoAgora, setCriandoAgora] = useState(false);
  const [arquivando, setArquivando] = useState(false);
  const [aba, setAba] = useState<Aba>("config");
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
  const [avisarChamado, setAvisarChamado] = useState(true);
  const [criandoTemplate, setCriandoTemplate] = useState(false);
  const [avisoTemplate, setAvisoTemplate] = useState<string | null>(null);
  const [criandoTemplateChamado, setCriandoTemplateChamado] = useState(false);
  const [avisoTemplateChamado, setAvisoTemplateChamado] = useState<string | null>(null);
  const [checkinHabilitado, setCheckinHabilitado] = useState(true);
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
    // Ausente = ligado (default): o aviso de chamado passa a valer para eventos já criados.
    setAvisarChamado(alvo.config.avisarChamadoPorWhatsapp ?? true);
    // Ausente = ligado (default histórico: prioridade pela ordem do PIX).
    setCheckinHabilitado(alvo.config.checkinHabilitado ?? true);
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
    }
    setCarregando(false);
  }, [preencher]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const trocarEvento = useCallback(
    (id: string) => {
      setEventoId(id);
      const alvo = eventos.find((e) => e.id === id);
      if (alvo) preencher(alvo);
    },
    [eventos, preencher],
  );

  // Ao escolher o empreendimento, herda o incorporador (C2X) como construtora — mas SÓ quando o
  // campo está vazio, pra não pisar no que o operador já digitou.
  const trocarEmpreendimento = useCallback(
    (id: string) => {
      setEnterpriseId(id);
      const incorporador = empreendimentos.find((e) => e.id === id)?.incorporador?.trim();
      if (incorporador) {
        setConstrutora((atual) => (atual.trim() ? atual : incorporador));
      }
    },
    [empreendimentos],
  );

  const salvar = useCallback(async () => {
    if (!eventoId) return;
    setSalvando(true);
    setErro(null);

    const escolhido = empreendimentos.find((e) => e.id === enterpriseId);
    const { data, error } = await salvarEventoRemoto({
      config: {
        checkinHabilitado,
        construtora,
        // Nome por extenso junto do id/code: e' o que as outras telas mostram para o time saber
        // de qual lancamento e' a fila. So o Setup tem essa lista em maos.
        enterpriseNome: escolhido?.name ?? undefined,
        local,
        avisarChamadoPorWhatsapp: avisarChamado,
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
    avisarChamado,
    checkinHabilitado,
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

  const criarTemplate = useCallback(async () => {
    setCriandoTemplate(true);
    setAvisoTemplate(null);
    const { data, error } = await criarTemplateBoasVindasRemoto();
    setCriandoTemplate(false);
    setAvisoTemplate(
      error
        ? `Falha ao criar: ${error}`
        : data?.status === "ja_existe"
          ? "Template já existe na Meta."
          : "Template enviado à Meta. Aguardando aprovação (pode levar horas).",
    );
  }, []);

  const criarTemplateChamado = useCallback(async () => {
    setCriandoTemplateChamado(true);
    setAvisoTemplateChamado(null);
    const { data, error } = await criarTemplateChamadoRemoto();
    setCriandoTemplateChamado(false);
    setAvisoTemplateChamado(
      error
        ? `Falha ao criar: ${error}`
        : data?.status === "ja_existe"
          ? "Template já existe na Meta."
          : "Template enviado à Meta. Aguardando aprovação (pode levar horas).",
    );
  }, []);

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

  // CRIAR O LANCAMENTO. Nasce em `rascunho`, e isso e proposital: `eventoOperavel` so enxerga
  // `ativo` e `em_andamento`, entao um rascunho nao rouba a operacao de ninguem enquanto esta
  // sendo montado. Quem poe no ar e o botao "Ativar lancamento", que ja existe.
  const criar = useCallback(async () => {
    if (!novo) return;

    const nome = novo.nome.trim();
    if (!nome) {
      setErro("Dê um nome ao lançamento.");
      return;
    }

    // ⚠️ EMPREENDIMENTO E OBRIGATORIO. Sem ele a reserva de unidade nasce com a sigla errada e a
    // fila do lancamento nao consegue recusar CAD de outro loteamento — os dois problemas
    // acontecem calados, e so aparecem depois, na proposta e na etiqueta.
    const escolhido = empreendimentos.find((e) => e.id === novo.enterpriseId);
    if (!escolhido) {
      setErro("Escolha o empreendimento do lançamento.");
      return;
    }

    setCriandoAgora(true);
    setErro(null);

    const { data, error } = await criarEventoRemoto({
      dataEvento: novo.data ? new Date(`${novo.data}T12:00:00`).toISOString() : null,
      enterpriseCode: escolhido.code ?? null,
      enterpriseId: escolhido.id,
      nome,
    });

    setCriandoAgora(false);

    if (error) {
      setErro(error);
      return;
    }
    if (data) {
      setEventos((atual) => [data, ...atual]);
      setEventoId(data.id);
      preencher(data);
      setNovo(null);
      setAviso(`Lançamento "${data.nome}" criado como rascunho. Configure e depois clique em Ativar.`);
    }
  }, [empreendimentos, novo, preencher]);

  // ARQUIVAR / DESARQUIVAR — tira o lancamento de circulacao. NAO apaga nada: os credenciados,
  // as movimentacoes e as chamadas continuam no banco, e o desarquivar devolve tudo.
  const arquivar = useCallback(
    async (voltar: boolean) => {
      if (!eventoId) return;
      setArquivando(true);
      setErro(null);

      const { error } = await arquivarEventoRemoto({ arquivar: !voltar, eventoId });

      setArquivando(false);

      if (error) {
        setErro(error);
        return;
      }

      setAviso(
        voltar
          ? "Lançamento devolvido às telas."
          : "Lançamento arquivado. O histórico continua guardado, e os logins da equipe foram desativados.",
      );
      await carregar();
    },
    [carregar, eventoId],
  );

  if (carregando) {
    return (
      <div className="grid h-full place-items-center bg-canvas">
        <Loader2 className="animate-spin text-ink-muted" size={22} />
      </div>
    );
  }

  // ⚠️ ESTA TELA DEIXOU DE SER O ÚNICO CAMINHO PARA CRIAR. O botão agora vive no header, fixo:
  // aqui ele só repete a oferta para quem chega e não tem nada. Com um lançamento no banco esta
  // tela nunca aparece — e era por isso que o botão de criar era inalcançável.
  if (!evento) {
    return (
      <div className="grid h-full place-items-center bg-canvas p-8">
        <div className="max-w-md text-center">
          <h2 className="text-lg font-semibold text-ink">Nenhum lançamento ainda</h2>
          <p className="mt-2 text-sm text-ink-soft">
            Crie o lançamento para configurar o evento, o check-in e as mesas.
          </p>
          <button
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-4 py-2 text-sm font-semibold text-white hover:bg-[#8d6c33]"
            onClick={() => setNovo({ data: "", enterpriseId: "", nome: "" })}
            type="button"
          >
            <Plus size={16} /> Criar lançamento
          </button>

          {novo ? (
            <ModalNovoLancamento
              criando={criandoAgora}
              empreendimentos={empreendimentos}
              erro={erro}
              onCancelar={() => {
                setNovo(null);
                setErro(null);
              }}
              onConfirmar={() => void criar()}
              onMudar={(patch) => setNovo((atual) => (atual ? { ...atual, ...patch } : atual))}
              valor={novo}
            />
          ) : null}
          {erro ? <p className="mt-4 text-sm text-red-600">{erro}</p> : null}
        </div>
      </div>
    );
  }

  const status = ROTULO_STATUS[evento.status] ?? ROTULO_STATUS.rascunho!;

  return (
    <div className="h-full min-h-0 overflow-y-auto bg-canvas">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-black/[0.07] bg-canvas/95 px-5 py-3 backdrop-blur dark:border-white/[0.08]">
        {/* ⚠️ FIXO NO HEADER, e nao dentro do estado vazio.
            Criar lancamento SEMPRE existiu no servidor, mas o unico botao vivia no early-return de
            "Nenhum lancamento ainda" — que so aparece com ZERO eventos. Com um lancamento no banco
            (e havia um, o Vale do Ouro), o botao nunca renderizava, e a queixa do Lucas em 21/08
            foi exatamente essa: "o que eu nao vi hoje e um botao para criar os novos lancamentos". */}
        <button
          className="inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#8d6c33]"
          onClick={() => setNovo({ data: "", enterpriseId: "", nome: "" })}
          title="Criar um lançamento novo"
          type="button"
        >
          <Plus size={15} /> Novo lançamento
        </button>

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

          {/* ARQUIVAR — só depois de encerrado. Regra do Lucas (21/08): *"os lançamentos que foram
              finalizados, pode arquivar tudo, gestão, fila tudo"*. Arquivar NÃO apaga: some das
              telas e o histórico fica. `Desarquivar` é o que torna o clique barato — mas ele só
              aparece se você estiver vendo um arquivado, e a lista esconde arquivados por padrão. */}
          {evento.status === "encerrado" && !evento.arquivadoEm ? (
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
              disabled={arquivando}
              onClick={() => void arquivar(false)}
              title="Tira o lançamento das telas. Nada é apagado."
              type="button"
            >
              {arquivando ? <Loader2 className="animate-spin" size={15} /> : <Archive size={15} />}
              Arquivar
            </button>
          ) : null}

          {evento.arquivadoEm ? (
            <button
              className="inline-flex items-center gap-2 rounded-lg border border-black/10 px-3.5 py-1.5 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
              disabled={arquivando}
              onClick={() => void arquivar(true)}
              type="button"
            >
              {arquivando ? (
                <Loader2 className="animate-spin" size={15} />
              ) : (
                <ArchiveRestore size={15} />
              )}
              Desarquivar
            </button>
          ) : null}
        </div>
      </header>

      {/* Abas do Setup (o header acima fica fora delas). Mesmo estilo de pílula da Central. */}
      <div className="px-5 pt-4">
        <nav className="inline-flex items-center gap-1 rounded-lg bg-black/[0.05] p-1 dark:bg-white/[0.07]">
          {(
            [
              ["config", "Configurações"],
              ["equipe", "Equipe"],
              ["teloes", "Telões"],
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
      </div>

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
        {aba === "config" ? (
          <>
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
                onChange={(e) => trocarEmpreendimento(e.target.value)}
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
              <button
                className="mt-2 block rounded-lg border border-black/10 px-3 py-2 text-xs font-medium text-ink-soft transition-colors hover:border-[#c9a15f] hover:text-[#c9a15f] disabled:opacity-50 dark:border-white/10"
                disabled={criandoTemplate}
                onClick={criarTemplate}
                type="button"
              >
                {criandoTemplate ? "Enviando à Meta…" : "Criar template de boas-vindas"}
              </button>
              {avisoTemplate ? (
                <p className="mt-1 text-xs text-ink-muted">{avisoTemplate}</p>
              ) : null}

              <div className="mt-4 border-t border-black/10 pt-3 dark:border-white/10">
                <button
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    avisarChamado
                      ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                      : "border-black/10 text-ink-soft dark:border-white/10"
                  }`}
                  onClick={() => setAvisarChamado((v) => !v)}
                  type="button"
                >
                  <span
                    className={`h-4 w-7 rounded-full p-0.5 transition-colors ${avisarChamado ? "bg-emerald-500" : "bg-black/20 dark:bg-white/20"}`}
                  >
                    <span
                      className={`block h-3 w-3 rounded-full bg-white transition-transform ${avisarChamado ? "translate-x-3" : ""}`}
                    />
                  </span>
                  Avisar por WhatsApp ao chamar
                </button>
                <p className="mt-1 text-xs text-ink-muted">
                  Reforço do alerta da tela: manda um WhatsApp na hora que o cliente é chamado.
                </p>
                <button
                  className="mt-2 block rounded-lg border border-black/10 px-3 py-2 text-xs font-medium text-ink-soft transition-colors hover:border-[#c9a15f] hover:text-[#c9a15f] disabled:opacity-50 dark:border-white/10"
                  disabled={criandoTemplateChamado}
                  onClick={criarTemplateChamado}
                  type="button"
                >
                  {criandoTemplateChamado ? "Enviando à Meta…" : "Criar template de chamado"}
                </button>
                {avisoTemplateChamado ? (
                  <p className="mt-1 text-xs text-ink-muted">{avisoTemplateChamado}</p>
                ) : null}
              </div>
            </Campo>
          </div>
        </Card>

        <CheckinCard habilitado={checkinHabilitado} onChange={setCheckinHabilitado} />

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
          </>
        ) : null}

        {aba === "teloes" ? (
          <Card
            hint="Muda o fundo de todas as TVs juntas; as chamadas de cada telão seguem independentes"
            titulo="Maestro dos telões"
          >
            <MaestroConteudo />
          </Card>
        ) : null}

        {aba === "equipe" ? (
          <Card
            hint="Cada pessoa opera o posto atribuído; a tela de operação abre já no lugar dela"
            titulo="Equipe do lançamento"
          >
            <EquipeConteudo eventoId={eventoId} onErro={setErro} />
          </Card>
        ) : null}
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

      {novo ? (
        <ModalNovoLancamento
          criando={criandoAgora}
          empreendimentos={empreendimentos}
          erro={erro}
          onCancelar={() => {
            setNovo(null);
            setErro(null);
          }}
          onConfirmar={() => void criar()}
          onMudar={(patch) => setNovo((atual) => (atual ? { ...atual, ...patch } : atual))}
          valor={novo}
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

// Regime da fila no dia, resolvido por um interruptor só (mesmo toggle do "Senha da fila").
// Ligado: prioridade pela ordem do PIX. Desligado: ordem de chegada (check-in físico).
// As janelas por data/hora saíram da tela — as rotas/tabela seguem intactas, só não são usadas aqui.
function CheckinCard(props: { habilitado: boolean; onChange: (valor: boolean) => void }) {
  return (
    <Card
      hint="Define quem tem prioridade quando o cliente chega na recepção"
      titulo="Check-in"
    >
      <div className="flex flex-wrap items-center gap-4">
        <button
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
            props.habilitado
              ? "border-emerald-500/40 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
              : "border-black/10 text-ink-soft dark:border-white/10"
          }`}
          onClick={() => props.onChange(!props.habilitado)}
          type="button"
        >
          <span
            className={`h-4 w-7 rounded-full p-0.5 transition-colors ${props.habilitado ? "bg-emerald-500" : "bg-black/20 dark:bg-white/20"}`}
          >
            <span
              className={`block h-3 w-3 rounded-full bg-white transition-transform ${props.habilitado ? "translate-x-3" : ""}`}
            />
          </span>
          {props.habilitado ? "Check-in ativo" : "Check-in desligado"}
        </button>

        <p className="flex items-center gap-2 text-sm text-ink-soft">
          {props.habilitado ? (
            <QrCode className="shrink-0 text-emerald-600 dark:text-emerald-400" size={16} />
          ) : (
            <Clock className="shrink-0 text-ink-muted" size={16} />
          )}
          {props.habilitado
            ? "Quem pagou o PIX tem prioridade na fila."
            : "A fila ordena pela hora de chegada (check-in físico)."}
        </p>
      </div>
    </Card>
  );
}

// Fim de um dia do evento. Quem concluiu vira dado de performance; quem parou no meio sai da
// operação (mas continua no histórico — arquivar, não apagar).

// O MODAL DE CRIAR LANCAMENTO, como componente proprio porque e usado em DOIS pontos: no header
// (o caminho normal) e no estado vazio "Nenhum lancamento ainda", que retorna antes do resto da
// tela — inline, ele so existiria em um dos dois.
function ModalNovoLancamento(props: {
  criando: boolean;
  empreendimentos: PrometeuEmpreendimento[];
  erro: null | string;
  onCancelar: () => void;
  onConfirmar: () => void;
  onMudar: (patch: Partial<{ data: string; enterpriseId: string; nome: string }>) => void;
  valor: { data: string; enterpriseId: string; nome: string };
}) {
  return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-xl border border-black/10 bg-surface p-5 dark:border-white/10">
            <h3 className="text-base font-semibold text-ink">Novo lançamento</h3>
            <p className="mt-1 text-sm text-ink-soft">
              Ele nasce como <strong className="text-ink">rascunho</strong>: dá para montar mesas,
              equipe e check-in sem afetar nada. Só o botão Ativar põe a fila no ar.
            </p>

            <label className="mt-4 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Nome do lançamento
              </span>
              <input
                autoFocus
                className="mt-1 w-full rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink dark:border-white/10"
                onChange={(e) => props.onMudar({ nome: e.target.value })}
                placeholder="Ex.: Residencial Villa Paris"
                value={props.valor.nome}
              />
            </label>

            {/* ⚠️ OBRIGATÓRIO. Sem empreendimento a reserva de unidade sai com a sigla de outro
                loteamento e a fila não consegue recusar CAD que não é dela — os dois calados. */}
            <label className="mt-3 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Empreendimento
              </span>
              <select
                className="mt-1 w-full rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink dark:border-white/10"
                onChange={(e) =>
                  props.onMudar({ enterpriseId: e.target.value })
                }
                value={props.valor.enterpriseId}
              >
                <option value="">Escolha o empreendimento…</option>
                {props.empreendimentos.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.code ? ` · ${item.code}` : ""}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-ink-muted">
                Define a sigla das unidades reservadas e de quais CADs a fila aceita.
              </span>
            </label>

            <label className="mt-3 block">
              <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Data do lançamento
              </span>
              <input
                className="mt-1 w-full rounded-lg border border-black/10 bg-canvas px-3 py-2 text-sm text-ink dark:border-white/10"
                onChange={(e) => props.onMudar({ data: e.target.value })}
                type="date"
                value={props.valor.data}
              />
            </label>

            {props.erro ? <p className="mt-3 text-sm text-red-600">{props.erro}</p> : null}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-lg border border-black/10 px-3.5 py-2 text-sm font-semibold text-ink hover:bg-black/[0.04] dark:border-white/10 dark:hover:bg-white/[0.06]"
                onClick={props.onCancelar}
                type="button"
              >
                Cancelar
              </button>
              <button
                className="inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-3.5 py-2 text-sm font-semibold text-white hover:bg-[#8d6c33] disabled:opacity-60"
                disabled={props.criando || !props.valor.nome.trim() || !props.valor.enterpriseId}
                onClick={props.onConfirmar}
                type="button"
              >
                {props.criando ? <Loader2 className="animate-spin" size={15} /> : <Plus size={15} />}
                Criar lançamento
              </button>
            </div>
          </div>
        </div>
  );
}

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
