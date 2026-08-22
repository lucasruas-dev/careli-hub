"use client";

import { Laptop, Loader2, Maximize, Minimize, Monitor, Plus, RefreshCw, ScanLine, Tv, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { usePersistedState } from "@/hooks/use-persisted-state";
import { ehIdDeCredencial } from "@/lib/prometeu/credencial";
import { calcularKpisDoEvento } from "@/lib/prometeu/kpis";

import { usarLeitorQr } from "../checkin/usar-leitor-qr";

import {
  PROMETEU_ETAPAS,
  type PrometeuAtividade,
  type PrometeuChamada,
  type PrometeuCredenciado,
  type PrometeuEtapa,
  type PrometeuEvento,
  type PrometeuIndicadorDaMesa,
  type PrometeuMesa,
  type PrometeuOperadorResumo,
  type PrometeuPassoJornada,
} from "@/lib/prometeu/types";

import {
  criarEventoRemoto,
  fetchEventos,
  fetchFila,
  excluirCredenciadoRemoto,
  fetchJornada,
  fetchOperadores,
  fetchReservas,
  moverCredenciado,
  type ReservaC2x,
  type UnidadeDoC2x,
} from "../../data/prometeu-operations";
import { COCKPIT_CSS } from "./cockpit-estilo";

// Central do Prometeu — a tela de comando do dia do lançamento.
//
// ESTE ARQUIVO É O MOCKUP APROVADO (public/prometeu/cockpit.html) COM OS MOTORES LIGADOS: o
// markup e as classes são os do mockup, o CSS é o do mockup (cockpit-estilo.ts, gerado dele), e
// a única diferença é a origem do dado — no mockup era array inventado, aqui vem das tabelas
// prometeu_*. Ao mexer, mexa como se estivesse mexendo no HTML: mesma classe, mesma estrutura.
//
// Onde o mockup mostrava dado que ainda não tem fonte (valor em R$ das unidades, que virá do
// C2X), a tela mostra travessão em vez de número inventado.

type Aba = "painel" | "mapa" | "analitico" | "reservas";
type SubAba = "lista" | "kanban";
type VerPor = "cliente" | "imobiliaria" | "unidade";

// O modal do mockup servia dois conteúdos: a lista de quem está num estágio (com o toggle
// Lista / Por imobiliária) e a jornada de UMA pessoa (sem toggle). Mantido igual.
//
// Guarda as ETAPAS, não a lista de pessoas: a lista é derivada no render, então o modal aberto
// acompanha o polling de 10s. Guardando as pessoas, o coordenador ficaria olhando uma foto do
// instante do clique — e a fila anda justamente enquanto ele está com o modal aberto.
type ConteudoDoModal =
  | { estagio: string; etapas: PrometeuEtapa[]; tipo: "pessoas"; titulo: string }
  | { pessoa: PrometeuCredenciado; tipo: "jornada" };

const LIMITE_GARGALO_MIN = 20;

// Ajustes do mockup para ele viver DENTRO do hub: lá era uma página inteira, aqui é um bloco de
// módulo com o próprio scroll. Fica separado do CSS gerado para nunca se perder num regenerar.
const AJUSTES_NO_HUB = `
/* No mockup era página inteira (min-height:100vh); aqui é um bloco de módulo que tem que caber
   na altura do main e rolar por dentro. Com height:auto o conteúdo cresceria e o corte
   aconteceria no pai, sem barra de rolagem — esta é a mesma medida que a Central usava antes. */
.pcx{height:100%;min-height:0}
.pcx select.ev-select{font:inherit;font-size:14px;font-weight:700;color:var(--text);background:transparent;border:0;padding:0;cursor:pointer;max-width:230px}
.pcx .h-right .rebtn{width:34px;height:34px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center}
.pcx .h-right .rebtn:hover{color:var(--brand);border-color:var(--brand)}
.pcx .cell.vazio{cursor:default}
.pcx .cell.vazio:hover{border-color:var(--line);box-shadow:none}
.pcx .empty{padding:18px 0;text-align:center;color:var(--muted);font-size:12px}
.pcx .erro{background:var(--danger-soft);color:var(--danger);border-radius:10px;padding:10px 14px;font-size:13px;font-weight:600;margin-bottom:14px}
`;

function duracaoMs(ms: number): string {
  const minutos = Math.max(0, Math.floor(ms / 60000));
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

function duracao(desde: string, agora: number): string {
  return duracaoMs(agora - new Date(desde).getTime());
}

function haQuantoTempo(iso: string, agora: number): string {
  const minutos = Math.floor((agora - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return "agora";
  if (minutos < 60) return `${minutos} min`;
  return `${Math.floor(minutos / 60)}h`;
}

function hora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function iniciais(nome: string): string {
  return nome
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((parte) => parte[0]?.toUpperCase() ?? "")
    .join("");
}

function corDaEtapa(etapa: PrometeuEtapa): string {
  return PROMETEU_ETAPAS.find((e) => e.id === etapa)?.cor ?? "#64748b";
}

function labelDaEtapa(etapa: PrometeuEtapa): string {
  return PROMETEU_ETAPAS.find((e) => e.id === etapa)?.label ?? etapa;
}

export function CentralView() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState("");
  const [credenciadosCrus, setCredenciados] = useState<PrometeuCredenciado[]>([]);

  // AS UNIDADES DE CADA PESSOA VÊM DO C2X, coladas aqui na leitura.
  //
  // ⚠️ `prometeu_unidades` nunca foi escrita — 0 linhas em produção. Como TODA a Central lê
  // `credenciado.unidades`, o efeito era o mesmo em cinco lugares ao mesmo tempo: a coluna
  // "Unidades" da lista com tracinho, o "UN" de cada mesa em 0, o funil de unidades zerado e o
  // card de vendas contando pessoas em vez de lotes — enquanto o C2X tinha 32 pedidos abertos.
  // Colando aqui, num ponto só, todos os cinco passam a mostrar o número certo.
  const reservasC2x = useReservasDoC2x();
  const credenciados = useMemo(() => {
    const mapa = reservasC2x.unidadesPorCpf;
    if (!mapa || Object.keys(mapa).length === 0) return credenciadosCrus;
    return credenciadosCrus.map((c) => {
      const doC2x = mapa[String(c.documento ?? "").replace(/\D/g, "")];
      if (!doC2x?.length) return c;
      return {
        ...c,
        unidades: doC2x.map((u) => ({
          codigo: u.unidade,
          id: `c2x:${c.id}:${u.unidade}`,
          lote: u.lote,
          quadra: u.quadra,
          // A etapa do C2X vira a situação que os chips já sabem colorir.
          situacao: u.vendida ? "vendida" : "reservada",
        })),
      };
    });
  }, [credenciadosCrus, reservasC2x.unidadesPorCpf]);

  // Índice por id, para somar as unidades de quem passou por cada mesa sem varrer a lista toda
  // a cada card.
  const porId = useMemo(
    () => new Map(credenciados.map((c) => [c.id, c])),
    [credenciados],
  );
  const [mesas, setMesas] = useState<PrometeuMesa[]>([]);
  const [resumoDeMesas, setResumoDeMesas] = useState<
    Record<string, PrometeuIndicadorDaMesa>
  >({});
  const [chamadas, setChamadas] = useState<PrometeuChamada[]>([]);
  const [atividade, setAtividade] = useState<PrometeuAtividade[]>([]);
  const [operadores, setOperadores] = useState<PrometeuOperadorResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [aba, setAba] = useState<Aba>("painel");
  const [subAba, setSubAba] = useState<SubAba>("lista");
  const [verPor, setVerPor] = useState<VerPor>("cliente");
  const [busca, setBusca] = useState("");
  const [modal, setModal] = useState<ConteudoDoModal | null>(null);
  const [agora, setAgora] = useState(() => Date.now());
  const [relogio, setRelogio] = useState("");

  // BIP DO GESTOR: ler a credencial abre a JORNADA do cliente. Não toca em etapa nem em banco —
  // é só consulta. `bipando` liga a câmera; `avisoBip` é o aviso quando a credencial lida não é
  // deste lançamento.
  const [bipando, setBipando] = useState(false);
  const [avisoBip, setAvisoBip] = useState<string | null>(null);

  // A Central roda em telas muito diferentes no dia: notebook do coordenador, monitor da sala e
  // TV grande. A escala fica no localStorage porque a TV é calibrada UMA vez e tem que continuar
  // assim depois de recarregar.
  const raizRef = useRef<HTMLDivElement>(null);
  const [escala, setEscala] = usePersistedState<number>("prometeu:central:escala", 1, {
    backend: "local",
  });
  const [emTelaCheia, setEmTelaCheia] = useState(false);

  useEffect(() => {
    const aoTrocar = () => setEmTelaCheia(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", aoTrocar);
    return () => document.removeEventListener("fullscreenchange", aoTrocar);
  }, []);

  const alternarTelaCheia = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void raizRef.current?.requestFullscreen().catch(() => {});
  }, []);

  // O QR da credencial carrega o id CRU; a Central já tem todos os credenciados em memória, então
  // acha localmente e abre o MESMO modal de jornada dos cards — sem rota nova, sem efeito no banco.
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
      setModal({ pessoa, tipo: "jornada" });
    },
    [credenciados],
  );

  const {
    canvasRef: bipCanvasRef,
    estado: estadoBip,
    videoRef: bipVideoRef,
  } = usarLeitorQr({ ativo: bipando, aoLer: aoLerCredencial });

  // Mesma conta do mockup: scale = 0.0175 * polegadas + 0.72 (calibrado 16"→1, 32"→1.28).
  const perguntarPolegadas = useCallback(() => {
    const atual = Math.round((escala - 0.72) / 0.0175);
    const resposta = window.prompt(
      "Tamanho da TV (polegadas)?",
      String(atual >= 40 ? atual : 55),
    );
    if (resposta === null) return;
    const polegadas = Number.parseFloat(resposta.replace(",", "."));
    if (!Number.isFinite(polegadas) || polegadas <= 0) return;
    setEscala(Math.round((0.0175 * polegadas + 0.72) * 100) / 100);
  }, [escala, setEscala]);

  // O relógio do mockup bate de segundo em segundo; os cronômetros das listas, de 30 em 30 (não
  // adianta redesenhar 400 linhas por segundo para mudar "12 min").
  useEffect(() => {
    const escrever = () => {
      const n = new Date();
      setRelogio(
        [n.getHours(), n.getMinutes(), n.getSeconds()]
          .map((x) => String(x).padStart(2, "0"))
          .join(":"),
      );
    };
    escrever();
    const id = window.setInterval(escrever, 1000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 30000);
    return () => window.clearInterval(id);
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
    // A Central pede os indicadores de todas as mesas (Mapa do salão).
    const { data, error } = await fetchFila(id, undefined, { resumoMesas: true });
    if (error) {
      setErro(error);
      setCarregando(false);
      return;
    }
    setCredenciados(data?.credenciados ?? []);
    setMesas(data?.mesas ?? []);
    setChamadas(data?.chamadas ?? []);
    setAtividade(data?.atividade ?? []);
    setResumoDeMesas(data?.resumoDeMesas ?? {});
    setErro(null);
    setCarregando(false);
  }, []);

  useEffect(() => {
    void carregarEventos();
  }, [carregarEventos]);

  useEffect(() => {
    if (!eventoId) return;
    void carregarFila(eventoId);
    void fetchOperadores(eventoId).then(({ data }) => setOperadores(data ?? []));
  }, [carregarFila, eventoId]);

  // Polling de 10s: é a Central do dia do evento, tem que respirar junto com o salão. Pausa em
  // segundo plano — a fatura do Hermes ensinou que polling em aba escondida é dinheiro jogado
  // fora.
  useEffect(() => {
    if (!eventoId) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") void carregarFila(eventoId);
    }, 10000);
    return () => window.clearInterval(id);
  }, [carregarFila, eventoId]);


  // ⚠️ Conta SÓ quem já fez check-in. Sem isto, "recepcao" — que é o estado padrão de quem está
  // apenas habilitado — mostraria os 500 cadastrados como "aguardando na espera" com o salão
  // vazio.
  const presentesTodos = useMemo(
    () => credenciados.filter((c) => c.entrouEm !== null),
    [credenciados],
  );

  const daEtapa = useCallback(
    (...etapas: PrometeuEtapa[]) => presentesTodos.filter((c) => etapas.includes(c.etapa)),
    [presentesTodos],
  );

  const porEtapa = useCallback(
    (etapa: PrometeuEtapa) => daEtapa(etapa).length,
    [daEtapa],
  );

  // KPIs: função pura compartilhada com a Gestão (mobile), pra os números não divergirem.
  const kpis = useMemo(() => calcularKpisDoEvento(credenciados), [credenciados]);

  // ⚠️ Enquanto a primeira leitura não volta, `clientes` é null — e null NÃO é zero. Mostrar 0
  // aqui diria ao coordenador que ninguém está com unidade na mão, que é o oposto do que a aba
  // vai exibir um instante depois.
  const comReserva = reservasC2x.clientes?.length ?? null;

  // VENDA FECHADA = unidade com contrato em diante, contada no C2X. Duas leituras, porque o Lucas
  // pediu as duas: quantos LOTES sairam e quantas PESSOAS compraram.
  //
  // ⚠️ null enquanto o C2X não respondeu — o card cai no número antigo (pessoas concluídas) em
  // vez de piscar 0 no meio do evento.
  const { clientesQueCompraram, unidadesVendidas } = useMemo(() => {
    const mapa = reservasC2x.unidadesPorCpf;
    if (!mapa || Object.keys(mapa).length === 0) {
      return { clientesQueCompraram: 0, unidadesVendidas: null as null | number };
    }
    let unidades = 0;
    let clientes = 0;
    for (const lista of Object.values(mapa)) {
      const vendidas = lista.filter((u) => u.vendida).length;
      if (vendidas > 0) {
        unidades += vendidas;
        clientes += 1;
      }
    }
    return { clientesQueCompraram: clientes, unidadesVendidas: unidades };
  }, [reservasC2x.unidadesPorCpf]);

  // Média de tempo parado de um grupo de etapas, em minutos.
  const mediaMinutos = useCallback(
    (...etapas: PrometeuEtapa[]) => {
      const grupo = daEtapa(...etapas);
      if (grupo.length === 0) return null;
      const soma = grupo.reduce(
        (total, c) => total + (agora - new Date(c.etapaDesde).getTime()),
        0,
      );
      return Math.round(soma / grupo.length / 60000);
    },
    [agora, daEtapa],
  );

  const esperaRecepcao = mediaMinutos("recepcao");
  const esperaSecretaria = mediaMinutos("secretaria");
  const atendimentoMedio = mediaMinutos("proposta", "pagamento");

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
      setEventos([data]);
      setEventoId(data.id);
    }
  }, []);

  const abrir = useCallback(
    (estagio: string, titulo: string, ...etapas: PrometeuEtapa[]) =>
      () =>
        setModal({ estagio, etapas, tipo: "pessoas", titulo }),
    [daEtapa],
  );

  const evento = eventos.find((e) => e.id === eventoId);
  const mesasSecretaria = mesas.filter((m) => m.zona === "secretaria");
  // Postos de credenciamento = quem OPERA a recepção. O gestor é gravado com uma zona (coluna
  // obrigatória) mas não fica num posto — sem este filtro ele apareceria como mais um ponto de
  // check-in por QR, que ninguém está atendendo.
  const operadoresRecepcao = operadores.filter(
    (o) => o.zona === "recepcao" && o.ativo && o.perfil !== "gestor",
  );

  if (carregando) {
    return (
      <div className="grid h-full place-items-center text-ink-muted">
        <Loader2 className="animate-spin" size={22} />
      </div>
    );
  }

  if (eventos.length === 0) {
    return (
      <div className="grid h-full place-items-center">
        <div className="text-center">
          <p className="mb-3 text-sm text-ink-muted">Nenhum lançamento cadastrado ainda.</p>
          <button
            className="inline-flex items-center gap-2 rounded-lg bg-[#A07C3B] px-4 py-2 text-sm font-semibold text-white"
            onClick={() => void criarPrimeiroEvento()}
            type="button"
          >
            <Plus size={15} /> Criar o primeiro
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={raizRef}
      className="pcx h-full min-h-0 overflow-y-auto"
      // `zoom` (e não transform) porque ele reflui o layout: na TV tudo cresce junto, sem cortar
      // conteúdo nem criar barra horizontal. É o mesmo applyZoom() do mockup.
      style={escala === 1 ? undefined : { zoom: escala }}
    >
      <style dangerouslySetInnerHTML={{ __html: COCKPIT_CSS + AJUSTES_NO_HUB }} />

      <header>
        <div className="mod-icon">
          <svg
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
          >
            <line x1="10" x2="21" y1="6" y2="6" />
            <line x1="10" x2="21" y1="12" y2="12" />
            <line x1="10" x2="21" y1="18" y2="18" />
            <path d="M4 6h1v4" />
            <path d="M4 10h2" />
            <path d="M6 18H4c0-1 2-2 2-3s-1-1.5-2-1" />
          </svg>
        </div>
        <div className="brand">
          <h1>Prometeu</h1>
          <div className="sub">Gestão de Fila</div>
        </div>
        <div className="h-event">
          <div className="ev">
            <select
              className="ev-select"
              onChange={(e) => setEventoId(e.target.value)}
              value={eventoId}
            >
              {eventos.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.config.enterpriseNome || e.nome}
                </option>
              ))}
            </select>
          </div>
          <div className="evsub">
            {evento?.config.construtora ||
              (evento?.enterpriseCode ? `Código ${evento.enterpriseCode}` : "Lançamento")}
          </div>
        </div>

        <div className="switch">
          {(
            [
              ["painel", "Painel"],
              ["mapa", "Mapa do salão"],
              ["analitico", "Analítico"],
              ["reservas", "Reservas"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              className={aba === id ? "on" : ""}
              onClick={() => setAba(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="themetog scaletog">
          <button
            className={escala === 1 ? "on" : ""}
            onClick={() => setEscala(1)}
            title="Notebook · ~16 pol."
            type="button"
          >
            <Laptop size={17} />
          </button>
          <button
            className={escala === 1.28 ? "on" : ""}
            onClick={() => setEscala(1.28)}
            title="Monitor · ~32 pol."
            type="button"
          >
            <Monitor size={17} />
          </button>
          <button
            className={escala !== 1 && escala !== 1.28 ? "on" : ""}
            onClick={perguntarPolegadas}
            title="TV · informe as polegadas"
            type="button"
          >
            <Tv size={17} />
          </button>
          <button onClick={alternarTelaCheia} title="Tela cheia" type="button">
            {emTelaCheia ? <Minimize size={17} /> : <Maximize size={17} />}
          </button>
        </div>

        <div className="h-right">
          <div className="live">
            <span className="dot" />
            AO VIVO
          </div>
          <div className="clock">{relogio}</div>
          <button
            className="rebtn"
            onClick={() => {
              setAvisoBip(null);
              setBipando(true);
            }}
            title="Bipar credencial — abre a jornada do cliente"
            type="button"
          >
            <ScanLine size={15} />
          </button>
          <button
            className="rebtn"
            onClick={() => void carregarFila(eventoId)}
            title="Atualizar agora"
            type="button"
          >
            <RefreshCw size={15} />
          </button>
        </div>
      </header>

      {erro ? <div className="erro">{erro}</div> : null}

      <div className="kpis">
        <div className="kpi">
          <div className="kv tabnum">{kpis.presentes}</div>
          <div className="kl">Presentes agora</div>
          <div className="kd">de {kpis.total} credenciados</div>
        </div>
        <div className="kpi">
          <div className="kv brand tabnum">{kpis.emAtendimento}</div>
          <div className="kl">Em atendimento</div>
          <div className="kd">salão + secretaria</div>
        </div>
        {/* DUAS LEITURAS NO MESMO CARD (pedido do Lucas, 22/08): o número grande são as
            UNIDADES vendidas, porque é o que a incorporadora conta no fim do dia, e logo abaixo
            quantos CLIENTES fecharam. Antes só existia a contagem de pessoas, e quem levava dois
            lotes contava como uma venda. */}
        <div className="kpi">
          <div className="kv ok tabnum">{unidadesVendidas ?? kpis.concluidos}</div>
          <div className="kl">Vendas fechadas</div>
          <div className="kd">
            {unidadesVendidas === null
              ? "fluxo concluído"
              : `${unidadesVendidas === 1 ? "unidade" : "unidades"} · ${clientesQueCompraram} cliente${clientesQueCompraram === 1 ? "" : "s"}`}
          </div>
        </div>
        <div className="kpi">
          <div className="kv">
            {kpis.tempoMedio === null ? "—" : duracaoMs(kpis.tempoMedio)}
          </div>
          <div className="kl">Tempo médio total</div>
          <div className="kd">entrada até conclusão</div>
        </div>
        <div className="kpi">
          <div className="kv">{kpis.conversao === null ? "—" : `${kpis.conversao}%`}</div>
          <div className="kl">Conversão</div>
          <div className="kd">de quem passou pelo evento</div>
        </div>
      </div>

      {/* ================= PAINEL ================= */}
      <div className={`view${aba === "painel" ? " on" : ""}`}>
        <div className="grid">
          <div>
            <div className="maptitle">
              <h2>Mapa da jornada</h2>
              <div className="legend">
                <span>
                  <i className="lg-i lg-qr">◉</i> presença via QR
                </span>
                <span>
                  <i className="lg-i lg-data">◈</i> estágio via sistema
                </span>
              </div>
            </div>

            <div className="zone">
              <div className="zone-head">
                <span className="zone-name">Recepção &amp; Espera</span>
                <span className="zone-badge">◉ QR na entrada</span>
                <span className="zone-total">
                  na zona <b>{porEtapa("recepcao")}</b>
                </span>
              </div>
              <div className="cells">
                <Celula
                  detalhe="check-in confirmado"
                  fonte="qr"
                  label="Credenciados no evento"
                  onAbrir={() =>
                    setModal({
                      estagio: "Recepção & Espera",
                      // As 8 etapas cobrem todo mundo que fez check-in: mesmo conjunto de
                      // `presentesTodos`, só que derivado a cada leitura.
                      etapas: PROMETEU_ETAPAS.map((e) => e.id),
                      tipo: "pessoas",
                      titulo: "Credenciados no evento",
                    })
                  }
                  valor={presentesTodos.length}
                />
                <Celula
                  detalhe={
                    esperaRecepcao === null
                      ? "ninguém aguardando"
                      : `⏱ espera média ${esperaRecepcao} min`
                  }
                  fonte="qr"
                  gargalo={esperaRecepcao !== null && esperaRecepcao > LIMITE_GARGALO_MIN}
                  label="Aguardando na espera"
                  onAbrir={abrir("Recepção & Espera", "Aguardando na espera", "recepcao")}
                  valor={porEtapa("recepcao")}
                />
              </div>
            </div>

            <div className="zone">
              <div className="zone-head">
                <span className="zone-name">Salão de Vendas</span>
                <span className="zone-badge">◉ bip ao entrar</span>
                <span className="zone-total">
                  na zona <b>{porEtapa("negociacao") + porEtapa("reserva")}</b>
                </span>
              </div>
              <div className="cells">
                <Celula
                  detalhe="mesa de negociação"
                  fonte="qr"
                  label="Com o corretor"
                  onAbrir={abrir("Salão de Vendas", "Com o corretor", "negociacao")}
                  valor={porEtapa("negociacao")}
                />
                {/* ⚠️ ESTE CARD CONTA AS RESERVAS DO C2X, e não a etapa `reserva` da fila. Ele
                    mostrava 0 enquanto a aba Reservas listava 14: quem pega unidade costuma
                    continuar em `recepcao`, e teve gente que reservou pelo corretor sem sequer
                    aparecer no salão. Contar a etapa media a fila física; o que o coordenador
                    precisa saber é quantas unidades estão presas. Clicar leva à aba, que é onde
                    estão o lote, o corretor e o tempo. */}
                <Celula
                  detalhe="unidades presas no C2X"
                  fonte="dado"
                  label="Com reserva"
                  onAbrir={() => setAba("reservas")}
                  valor={comReserva ?? porEtapa("reserva")}
                />
              </div>
            </div>

            <div className="zone">
              <div className="zone-head">
                <span className="zone-name">Secretaria</span>
                <span className="zone-badge">◉ bip + chamada por mesa</span>
                <span className="zone-total">
                  na zona{" "}
                  <b>
                    {porEtapa("secretaria") + porEtapa("proposta") + porEtapa("pagamento")}
                  </b>
                </span>
              </div>
              <div className="subline">
                <div className="subline-lab">Validação e proposta</div>
                <div className="cells">
                  <Celula
                    detalhe={
                      esperaSecretaria === null
                        ? "ninguém aguardando"
                        : `⏱ espera média ${esperaSecretaria} min`
                    }
                    fonte="qr"
                    label="Recepção"
                    onAbrir={abrir("Secretaria", "Aguardando chamada", "secretaria")}
                    valor={porEtapa("secretaria")}
                  />
                  <Celula
                    detalhe="validação e registro"
                    fonte="dado"
                    label="Proposta / contrato"
                    onAbrir={abrir("Secretaria", "Proposta / contrato", "proposta")}
                    valor={porEtapa("proposta")}
                  />
                </div>
              </div>
              <div className="subline">
                <div className="subline-lab">Financeiro</div>
                <div className="cells">
                  <Celula
                    detalhe="recebendo na mesma mesa"
                    fonte="dado"
                    label="ATO e pagamento"
                    onAbrir={abrir("Secretaria", "ATO e pagamento", "pagamento")}
                    valor={porEtapa("pagamento")}
                  />
                  <Celula
                    concluido
                    detalhe="fluxo concluído"
                    fonte="dado"
                    label="Venda concluída ✓"
                    onAbrir={abrir("Secretaria", "Venda concluída", "concluido")}
                    valor={porEtapa("concluido")}
                  />
                </div>
              </div>
            </div>

            <div className="zone">
              <div className="zone-head">
                <span className="zone-name" style={{ color: "var(--danger)" }}>
                  Cancelados
                </span>
                <span
                  className="zone-badge"
                  style={{ background: "var(--danger-soft)", color: "var(--danger)" }}
                >
                  desistências
                </span>
                <span className="zone-total">
                  no evento <b>{porEtapa("cancelado")}</b>
                </span>
              </div>
              <div className="cells">
                <Celula
                  detalhe="desistiu antes de fechar"
                  fonte="dado"
                  label="Cancelados no evento"
                  onAbrir={abrir("Cancelados", "Cancelados no evento", "cancelado")}
                  perigo
                  valor={porEtapa("cancelado")}
                />
              </div>
            </div>
          </div>

          <div className="side">
            <div className="card">
              <h3>Funil de unidades</h3>
              <Funil unidadesPorCpf={reservasC2x.unidadesPorCpf} />
            </div>

            <div className="card">
              <h3>Últimas chamadas</h3>
              {chamadas.length === 0 ? (
                <div className="empty">Nenhuma chamada ainda.</div>
              ) : (
                chamadas.map((chamada) => (
                  <div key={chamada.id} className="call">
                    <div className="cavatar">{iniciais(chamada.nome)}</div>
                    <div className="cinfo">
                      <div className="cname">{chamada.nome}</div>
                      <div className="cdest">
                        {chamada.zona ?? "Salão"}
                        {chamada.mesa ? ` · Mesa ${chamada.mesa}` : ""}
                      </div>
                    </div>
                    <div className="cwhen">{haQuantoTempo(chamada.chamadoEm, agora)}</div>
                  </div>
                ))
              )}
            </div>

            <div className="card">
              <h3>Atividade ao vivo</h3>
              <div className="feed">
                {atividade.length === 0 ? (
                  <div className="empty">Sem movimentação ainda.</div>
                ) : (
                  atividade.map((item) => (
                    <div key={item.id} className="fitem">
                      <span className={`fic ${item.deEtapa === null ? "qr" : "data"}`}>
                        {item.deEtapa === null ? "◉" : "◈"}
                      </span>
                      <span>
                        <b>{item.nome}</b>{" "}
                        {item.deEtapa === null
                          ? "fez check-in"
                          : `entrou em ${labelDaEtapa(item.paraEtapa).toLowerCase()}`}
                      </span>
                      <span className="ft">{haQuantoTempo(item.em, agora)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ================= MAPA DO SALÃO ================= */}
      <div className={`view${aba === "mapa" ? " on" : ""}`}>
        <div id="hall">
          <div className="room">
            <div className="room-head">
              <span className="room-name">🚪 Entrada · Recepção</span>
              <span className="room-count">
                <b className="tabnum">{presentesTodos.length}</b>
                <span>credenciados</span>
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11.5, marginBottom: 14 }}>
              Credenciamento por QR
            </div>
            <div className="atds">
              {operadoresRecepcao.length === 0 ? (
                <div className="empty">Nenhum operador de recepção no Setup.</div>
              ) : (
                operadoresRecepcao.map((operador) => (
                  <div key={operador.id} className="atd livre">
                    <div className="atd-top">
                      <span className="atd-num">{operador.username.slice(0, 4)}</span>
                      <span className="atd-st">no posto</span>
                    </div>
                    <div className="atd-who">
                      <span className="atd-av">{iniciais(operador.nome)}</span>
                      <span className="atd-nome">{operador.nome}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div
            className={`room${esperaRecepcao !== null && esperaRecepcao > LIMITE_GARGALO_MIN ? " hot" : ""}`}
          >
            <div className="room-head">
              <span className="room-name">🪑 Área de espera</span>
              <span className="room-count">
                <b className="tabnum">{porEtapa("recepcao")}</b>
                <span>aguardando</span>
              </span>
            </div>
            {esperaRecepcao !== null && esperaRecepcao > LIMITE_GARGALO_MIN ? (
              <div
                style={{
                  color: "var(--danger)",
                  fontSize: 11,
                  fontWeight: 700,
                  marginBottom: 9,
                }}
              >
                Fila mais cheia · espera média {esperaRecepcao} min
              </div>
            ) : (
              <div style={{ color: "var(--muted)", fontSize: 11.5, marginBottom: 9 }}>
                {esperaRecepcao === null
                  ? "Ninguém aguardando"
                  : `Espera média ${esperaRecepcao} min`}
              </div>
            )}
            <Pontos classe="wait" quantidade={porEtapa("recepcao")} />
          </div>

          <div className="room">
            <div className="room-head">
              <span className="room-name">🏛️ Salão de vendas</span>
              <span className="room-count">
                <b className="tabnum">{porEtapa("negociacao") + porEtapa("reserva")}</b>
                <span>na área</span>
              </span>
            </div>
            <div className="espelho">
              ESPELHO DE VENDAS
              <div className="es-sub">masterplan ao vivo · unidades disponíveis</div>
            </div>
            <div className="salao-grupo">
              <div className="grupo-lab">
                <span className="gl-dot" style={{ background: "#e8792b" }} />
                Com corretor <b className="tabnum">{porEtapa("negociacao")}</b>
              </div>
              <Pontos classe="laranja" quantidade={porEtapa("negociacao")} />
            </div>
            <div className="salao-grupo" style={{ flex: 1 }}>
              <div className="grupo-lab">
                <span className="gl-dot" style={{ background: "var(--info)" }} />
                Com reserva ativa <b className="tabnum">{porEtapa("reserva")}</b>
              </div>
              <Pontos classe="info" quantidade={porEtapa("reserva")} />
            </div>
          </div>

          <div
            className="room cancel"
            onClick={abrir("Cancelados", "Cancelamentos no evento", "cancelado")}
            role="presentation"
          >
            <div className="room-head">
              <span className="room-name">✕ Cancelados</span>
              <span className="room-count">
                <b className="tabnum">{porEtapa("cancelado")}</b>
                <span>no evento</span>
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11.5, marginBottom: 12 }}>
              Desistências antes do pagamento
            </div>
            {/* O mockup quebrava por ONDE cancelou. O banco não guarda a etapa de origem do
                cancelamento, mas guarda a reserva: quem já tinha unidade desistiu depois de
                reservar, quem não tinha desistiu antes. É a mesma leitura, com dado que existe. */}
            <div className="cancel-bk">
              <div>
                <b className="tabnum">
                  {daEtapa("cancelado").filter((c) => c.unidades.length > 0).length}
                </b>{" "}
                depois de reservar
              </div>
              <div>
                <b className="tabnum">
                  {daEtapa("cancelado").filter((c) => c.unidades.length === 0).length}
                </b>{" "}
                sem reserva
              </div>
            </div>
            <Pontos classe="cancel" quantidade={porEtapa("cancelado")} />
          </div>

          <div className="room exit">
            <div className="room-head">
              <span className="room-name">✓ Concluído</span>
              <span className="room-count">
                <b className="tabnum">{porEtapa("concluido")}</b>
                <span>vendas</span>
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11.5, marginBottom: 10 }}>
              Contrato e boletos a caminho
            </div>
            <Pontos classe="ok" quantidade={porEtapa("concluido")} />
          </div>

          <div className="room" style={{ gridColumn: "1 / -1" }}>
            <div className="room-head">
              <span className="room-name">📋 Secretaria</span>
              <span className="room-count">
                <b className="tabnum">
                  {porEtapa("secretaria") + porEtapa("proposta") + porEtapa("pagamento")}
                </b>
                <span>na área</span>
              </span>
            </div>
            <div style={{ color: "var(--muted)", fontSize: 11.5, marginBottom: 14 }}>
              Validação, proposta, contrato, ATO e pagamento, tudo na mesma mesa
            </div>
            <div className="sec-stats">
              <div className="ss">
                <b className="tabnum">{porEtapa("secretaria")}</b>
                <span>aguardando chamada</span>
              </div>
              <div className="ss">
                <b className="tabnum">
                  {esperaSecretaria === null ? "—" : `${esperaSecretaria} min`}
                </b>
                <span>espera média</span>
              </div>
              <div className="ss">
                <b className="tabnum">
                  {atendimentoMedio === null ? "—" : `${atendimentoMedio} min`}
                </b>
                <span>atendimento médio</span>
              </div>
            </div>

            {mesasSecretaria.length === 0 ? (
              <div className="empty">
                Nenhuma mesa cadastrada. Defina o número de mesas no Setup e salve.
              </div>
            ) : (
              <div className="atds">
                {mesasSecretaria.map((mesa) => {
                  const estado =
                    mesa.estado === "atendimento"
                      ? "atende"
                      : mesa.estado === "ocupada"
                        ? "busy"
                        : "livre";
                  const sentado = mesa.credenciadoId
                    ? credenciados.find((c) => c.id === mesa.credenciadoId)
                    : undefined;
                  // Quem está atendendo na mesa: prioriza quem sentou AGORA (gravado na mesa pela
                  // tela do Atendente); se não houver, cai no operador cadastrado para esta mesa.
                  const nomeAtendente =
                    mesa.atendenteNome ??
                    operadores.find((o) => o.mesaId === mesa.id)?.nome ??
                    null;
                  const indic = resumoDeMesas[mesa.id];
                  // UNIDADES DA MESA somadas pelo C2X. ⚠️ `indic.unidades` vem de
                  // `prometeu_unidades`, que nunca foi escrita, e por isso o "UN" ficava 0 o dia
                  // inteiro. Aqui soma-se o que cada pessoa atendida nesta mesa tem de fato na
                  // mão — inclusive quem levou mais de um lote.
                  const unidadesDaMesa = (indic?.credenciadoIds ?? []).reduce(
                    (soma, id) => soma + (porId.get(id)?.unidades.length ?? 0),
                    0,
                  );
                  return (
                    <div
                      key={mesa.id}
                      className={`atd ${estado}${sentado ? " click" : ""}`}
                      onClick={
                        sentado
                          ? () => setModal({ pessoa: sentado, tipo: "jornada" })
                          : undefined
                      }
                      role="presentation"
                    >
                      <div className="atd-top">
                        <span className="atd-num">{mesa.numero}</span>
                        <span className="atd-st">
                          {estado === "atende"
                            ? "atendendo"
                            : estado === "busy"
                              ? "ocupada"
                              : "livre"}
                        </span>
                      </div>
                      <div className="atd-who">
                        <span className="atd-av">
                          {nomeAtendente ? iniciais(nomeAtendente) : "—"}
                        </span>
                        <span className="atd-nome">
                          {nomeAtendente ?? "sem atendente"}
                        </span>
                      </div>
                      {/* Quem está na mesa agora (abre a jornada dele no clique). O NOME COMPLETO
                          do cliente — o operador precisa saber quem está sendo atendido, não só as
                          iniciais. Tempo na etapa ao lado. */}
                      {sentado ? (
                        <div className="atd-cliente" title={sentado.nome}>
                          <span className="atd-cliente-nome">{sentado.nome}</span>
                          <span className="atd-cliente-tempo">
                            {duracao(sentado.etapaDesde, agora)}
                          </span>
                        </div>
                      ) : null}
                      {/* Os indicadores do ATENDENTE, para a gestão: atendimentos fechados,
                          unidades vendidas neles, tempo médio e tempo total na cadeira. */}
                      <div className="atd-metrics">
                        <span className="mt">
                          <b>{indic?.atendimentos ?? 0}</b> AT
                        </span>
                        <span className="mt">
                          <b>{unidadesDaMesa || (indic?.unidades ?? 0)}</b> UN
                        </span>
                        <span className="mt">
                          <b>{indic?.tempoMedioMs != null ? duracaoMs(indic.tempoMedioMs) : "—"}</b>{" "}
                          méd
                        </span>
                        <span className="mt">
                          <b>{indic && indic.tempoTotalMs > 0 ? duracaoMs(indic.tempoTotalMs) : "—"}</b>{" "}
                          total
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* ================= ANALÍTICO ================= */}
      <div className={`view${aba === "analitico" ? " on" : ""}`}>
        <Analitico
          agora={agora}
          busca={busca}
          onAbrirJornada={(pessoa) => setModal({ pessoa, tipo: "jornada" })}
          onBusca={setBusca}
          onMover={mover}
          onSubAba={setSubAba}
          onVerPor={setVerPor}
          presentes={presentesTodos}
          subAba={subAba}
          verPor={verPor}
        />
      </div>

      {/* ================= RESERVAS SEGURADAS ================= */}
      <div className={`view${aba === "reservas" ? " on" : ""}`}>
        <Reservas
          agora={agora}
          credenciados={presentesTodos}
          doC2x={reservasC2x.clientes}
          erroC2x={reservasC2x.erro}
          onAbrirJornada={(pessoa) => setModal({ pessoa, tipo: "jornada" })}
        />
      </div>

      <ModalDeClientes
        agora={agora}
        conteudo={modal}
        onFechar={() => setModal(null)}
        onSaiuDoEvento={async (pessoa) => {
          const { error } = await excluirCredenciadoRemoto({
            credenciadoId: pessoa.id,
            motivo: "Saiu do evento (marcado na Central)",
          });
          if (error) return error;
          // Recarrega para a pessoa sumir da fila e dos números na hora.
          if (eventoId) void carregarFila(eventoId);
        }}
        // Derivada A CADA RENDER: é isto que faz a lista aberta andar junto com o polling.
        pessoas={modal?.tipo === "pessoas" ? daEtapa(...modal.etapas) : []}
      />

      {/* BIP DO GESTOR: câmera para ler a credencial e abrir a jornada. O `aoLer` acha o cliente
          na lista já carregada e chama setModal — o overlay some sozinho ao abrir a jornada. */}
      {bipando ? (
        <div className="bipscan-ov" onClick={() => setBipando(false)} role="presentation">
          <div className="bipscan-card" onClick={(e) => e.stopPropagation()} role="presentation">
            <div className="bipscan-head">
              <span>
                <ScanLine size={16} /> Bipar credencial
              </span>
              <button aria-label="Fechar" onClick={() => setBipando(false)} type="button">
                <X size={18} />
              </button>
            </div>
            <div className="bipscan-cam">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption -- vídeo da câmera, sem áudio */}
              <video className="bipscan-video" muted playsInline ref={bipVideoRef} />
              <canvas hidden ref={bipCanvasRef} />
              <div className="bipscan-mira" />
            </div>
            <div className="bipscan-info">
              {estadoBip === "lendo"
                ? "Aponte para o QR da credencial do cliente."
                : estadoBip === "pedindo-camera"
                  ? "Liberando a câmera…"
                  : estadoBip === "sem-permissao"
                    ? "Permissão de câmera negada. Libere no navegador e tente de novo."
                    : estadoBip === "sem-camera"
                      ? "Câmera indisponível neste dispositivo."
                      : "Iniciando…"}
            </div>
            {avisoBip ? <div className="bipscan-aviso">{avisoBip}</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ───────────────────────────────────────────────────── PEÇAS DO PAINEL

function Celula(props: {
  concluido?: boolean;
  detalhe: string;
  fonte: "qr" | "dado";
  gargalo?: boolean;
  label: string;
  onAbrir: () => void;
  perigo?: boolean;
  valor: number;
}) {
  // Card vazio não abre nada: um modal "nenhum cliente aqui" só custa um clique ao coordenador
  // no meio do evento.
  const clicavel = props.valor > 0;

  return (
    <div
      className={`cell${props.gargalo ? " gargalo" : ""}${props.concluido ? " done" : ""}${clicavel ? "" : " vazio"}`}
      onClick={clicavel ? props.onAbrir : undefined}
      onKeyDown={
        clicavel
          ? (evento) => {
              if (evento.key === "Enter" || evento.key === " ") {
                evento.preventDefault();
                props.onAbrir();
              }
            }
          : undefined
      }
      role={clicavel ? "button" : undefined}
      tabIndex={clicavel ? 0 : undefined}
    >
      {props.gargalo ? <div className="tag-gargalo">GARGALO</div> : null}
      <div className="ctop">
        <span
          className="cn tabnum"
          style={props.perigo ? { color: "var(--danger)" } : undefined}
        >
          {props.valor}
        </span>
        <span className={`csrc ${props.fonte}`}>{props.fonte === "qr" ? "◉" : "◈"}</span>
      </div>
      <div className="clabel">{props.label}</div>
      <div className="ctime">{props.detalhe}</div>
    </div>
  );
}

// Cada ponto é uma pessoa na sala — a leitura de ocupação que o mockup tinha. O mockup sorteava
// quais pulsavam; aqui pulsam os 15% do começo, para a animação não trocar a cada refresh de 10s.
function Pontos(props: { classe: string; quantidade: number }) {
  const teto = Math.min(props.quantidade, 60);
  return (
    <div className="dots">
      {Array.from({ length: teto }, (_, i) => (
        <div
          key={i}
          className={`dot-p ${props.classe}${i % 7 === 0 ? " pulse" : ""}`}
        />
      ))}
      {props.quantidade > teto ? (
        <span style={{ color: "var(--muted)", fontSize: 11 }}>
          +{props.quantidade - teto}
        </span>
      ) : null}
    </div>
  );
}

// O funil do mockup mostrava valor em R$ por faixa. Esse dado vem do C2X (valor da unidade), que
// ainda não está ligado ao Prometeu — então a barra mostra a CONTAGEM real e o valor fica como
// travessão, em vez de número inventado.
// FUNIL DE UNIDADES — e agora conta UNIDADES mesmo.
//
// ⚠️ Contava PESSOAS nas quatro linhas: "Finalizadas 11" eram 11 clientes concluídos, não 11
// lotes. Quem compra dois lotes aparecia uma vez, e o número do funil não fechava com o do C2X.
// Como o mesmo card serve para ler o dia, a diferença importa (Lucas, 22/08: "vão ter clientes
// que vão comprar mais de uma unidade").
//
// As etapas saem do C2X, que é quem sabe: o Prometeu tem a etapa da PESSOA no salão, e ela não
// diz em que pé está cada unidade — uma pessoa "concluída" pode ter um lote em contrato e outro
// ainda reservado. Ao lado de cada linha vai também a contagem de CLIENTES, porque o Lucas quer
// as duas leituras ("é legal sim trazer essas duas visões diferentes").
function Funil(props: { unidadesPorCpf: Record<string, UnidadeDoC2x[]> }) {
  const linhas = useMemo(() => {
    const todas = Object.entries(props.unidadesPorCpf);
    const conta = (filtro: (u: UnidadeDoC2x) => boolean) => {
      let unidades = 0;
      let clientes = 0;
      for (const [, lista] of todas) {
        const quantas = lista.filter(filtro).length;
        if (quantas > 0) {
          unidades += quantas;
          clientes += 1;
        }
      }
      return { clientes, unidades };
    };
    return [
      { label: "Reservas", ok: false, ...conta((u) => u.etapa === "Reservado") },
      { label: "Propostas", ok: false, ...conta((u) => u.etapa === "Proposta realizada") },
      { label: "Em contrato", ok: false, ...conta((u) => u.etapa === "Contrato gerado") },
      {
        label: "Finalizadas",
        ok: true,
        ...conta((u) => u.etapa === "Faturado" || u.etapa === "Em assinatura" || u.etapa === "Finalizado"),
      },
    ];
  }, [props.unidadesPorCpf]);

  const topo = Math.max(...linhas.map((l) => l.unidades), 1);

  return (
    <div className="funil">
      {linhas.map((linha) => (
        <div key={linha.label} className="frow">
          <div className={`fbar${linha.ok ? " ok" : ""}`}>
            <div
              className="fill"
              style={{ width: `${Math.max(6, (linha.unidades / topo) * 100)}%` }}
            />
            <span className="flabel">{linha.label}</span>
            <span className="fval">{linha.unidades}</span>
          </div>
          {/* A segunda leitura: quantas PESSOAS estão por trás daquelas unidades. */}
          <span className="fmoney" title={`${linha.clientes} cliente(s) com unidade nesta etapa`}>
            {linha.clientes} cli
          </span>
        </div>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────────────── ANALÍTICO

function Analitico(props: {
  agora: number;
  busca: string;
  onAbrirJornada: (pessoa: PrometeuCredenciado) => void;
  onBusca: (valor: string) => void;
  onMover: (c: PrometeuCredenciado, etapa: PrometeuEtapa) => void;
  onSubAba: (valor: SubAba) => void;
  onVerPor: (valor: VerPor) => void;
  presentes: PrometeuCredenciado[];
  subAba: SubAba;
  verPor: VerPor;
}) {
  // O ANALÍTICO REFLETE A FILA, não o cadastro (pedido do Lucas, 27/07). Quem ainda não bipou
  // não está no evento: aparece quando chegar. Por isso a base é `presentes`.
  const filtrados = useMemo(() => {
    const termo = props.busca.trim().toLowerCase();
    if (!termo) return props.presentes;
    return props.presentes.filter((c) =>
      [c.nome, c.imobiliaria, c.corretor, c.documento, ...c.unidades.map((u) => u.codigo)]
        .filter(Boolean)
        .some((campo) => String(campo).toLowerCase().includes(termo)),
    );
  }, [props.busca, props.presentes]);

  const contagem =
    props.verPor === "unidade" && props.subAba === "lista"
      ? `${filtrados.reduce((soma, c) => soma + c.unidades.length, 0)} unidades`
      : `${filtrados.length} de ${props.presentes.length} clientes`;

  return (
    <div>
      <div className="ana-bar">
        <div className="ana-subtabs">
          {(
            [
              ["lista", "Lista"],
              ["kanban", "Kanban"],
            ] as const
          ).map(([id, rotulo]) => (
            <button
              key={id}
              className={props.subAba === id ? "on" : ""}
              onClick={() => props.onSubAba(id)}
              type="button"
            >
              {rotulo}
            </button>
          ))}
        </div>

        <input
          className="lista-search"
          onChange={(e) => props.onBusca(e.target.value)}
          placeholder="Buscar por cliente, imobiliária ou unidade..."
          value={props.busca}
        />

        {props.subAba === "lista" ? (
          <div className="ana-verpor">
            <span>Ver por</span>
            {(
              [
                ["cliente", "Cliente"],
                ["imobiliaria", "Imobiliária"],
                ["unidade", "Unidade"],
              ] as const
            ).map(([id, rotulo]) => (
              <button
                key={id}
                className={props.verPor === id ? "on" : ""}
                onClick={() => props.onVerPor(id)}
                type="button"
              >
                {rotulo}
              </button>
            ))}
          </div>
        ) : null}

        <div className="lista-count">{contagem}</div>
      </div>

      {filtrados.length === 0 ? (
        <div className="lista-empty">
          {props.presentes.length === 0
            ? "Ninguém fez check-in ainda."
            : "Nada encontrado."}
        </div>
      ) : props.subAba === "kanban" ? (
        // Os dois ids do mockup NÃO são decorativos: é neles que mora
        // `max-height:calc(100vh - 300px);overflow-y:auto`, ou seja, a área de rolagem própria do
        // Analítico. Sem eles a barra de busca e as sub-abas rolam junto com as 400 linhas, e o
        // cabeçalho fixo da tabela fica sem o container para o qual foi escrito.
        <div id="ana-kanban">
          <Kanban
            agora={props.agora}
            credenciados={filtrados}
            onAbrirJornada={props.onAbrirJornada}
            onMover={props.onMover}
          />
        </div>
      ) : (
        <div id="ana-lista">
          {props.verPor === "cliente" ? (
        <div className="ltable-wrap">
          <table className="ltable">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Imobiliária</th>
                <th>Unidades</th>
                <th>Etapa atual</th>
                <th>Tempo no evento</th>
                <th>Tempo no estágio</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((c) => (
                <tr
                  key={c.id}
                  onClick={() => props.onAbrirJornada(c)}
                  style={{ cursor: "pointer" }}
                >
                  <td>
                    <NomeNaTabela pessoa={c} />
                  </td>
                  <td>{c.imobiliaria ?? "—"}</td>
                  <td>
                    <div className="unid-wrap">
                      {c.unidades.length === 0
                        ? "—"
                        : c.unidades.map((u) => (
                            <span key={u.id} className="unid-chip">
                              {u.codigo}
                            </span>
                          ))}
                    </div>
                  </td>
                  <td>
                    <ChipDaEtapa etapa={c.etapa} />
                  </td>
                  <td className="lt-tempo">
                    {c.entrouEm ? duracao(c.entrouEm, props.agora) : "—"}
                  </td>
                  <td className="lt-tempo">{duracao(c.etapaDesde, props.agora)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          ) : props.verPor === "unidade" ? (
        <div className="ltable-wrap">
          <table className="ltable">
            <thead>
              <tr>
                <th>Unidade</th>
                <th>Cliente</th>
                <th>Imobiliária</th>
                <th>Situação</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.flatMap((c) =>
                c.unidades.map((u) => (
                  <tr
                    key={`${c.id}-${u.id}`}
                    onClick={() => props.onAbrirJornada(c)}
                    style={{ cursor: "pointer" }}
                  >
                    <td>
                      <span className="unid-chip lg">{u.codigo}</span>
                    </td>
                    <td>
                      <NomeNaTabela pessoa={c} />
                    </td>
                    <td>{c.imobiliaria ?? "—"}</td>
                    <td>
                      <ChipDaEtapa etapa={c.etapa} />
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
          ) : (
            <PorImobiliaria
              agora={props.agora}
              credenciados={filtrados}
              onAbrirJornada={props.onAbrirJornada}
            />
          )}
        </div>
      )}
    </div>
  );
}

function NomeNaTabela(props: { pessoa: PrometeuCredenciado; pequeno?: boolean }) {
  const cor = corDaEtapa(props.pessoa.etapa);
  return (
    <div className="lt-nome">
      <div
        className={`lt-av${props.pequeno ? " sm" : ""}`}
        style={{ background: `${cor}22`, color: cor }}
      >
        {iniciais(props.pessoa.nome)}
      </div>
      <span className="lt-nm">{props.pessoa.nome}</span>
    </div>
  );
}

function ChipDaEtapa(props: { etapa: PrometeuEtapa }) {
  return (
    <span className="et-chip">
      <span className="et-dot" style={{ background: corDaEtapa(props.etapa) }} />
      {labelDaEtapa(props.etapa)}
    </span>
  );
}

// RESERVAS SEGURADAS (controle do coordenador, pedido do Lucas 29/07). Má-prática: o corretor
// reserva a unidade e não devolve quando o cliente desiste, "guardando" para si. O fluxo certo é
// reservar e seguir para a secretaria (proposta); quem fica PARADO na etapa `reserva` está segurando
// unidade. A tela lista essas reservas com corretor + imobiliária + tempo, para o coordenador
// cobrar. Alerta em 30 min (decisão do Lucas). Base = ETAPA `reserva` (a tabela prometeu_unidades
// não é escrita hoje, então a unidade anexada não serve de critério).
const LIMITE_RESERVA_MS = 30 * 60 * 1000;

// AS RESERVAS VÊM DO C2X, não daqui (Lucas, 01/08: "esses dados vem tudo do C2X, nada é feito no
// hub"). Lê os pedidos de aquisição ABERTOS na etapa Reservado, que é onde o corretor de fato
// registra, já cruzados por CPF com a fila (a rota resolve imobiliária, corretor e etapa).
//
// ⚠️ O FETCH MORA AQUI EM CIMA, e não dentro da aba, porque o PAINEL também precisa do número: o
// card "Com reserva" contava `etapa === "reserva"` do Prometeu e mostrava 0 enquanto a aba listava
// 14 — quem reserva costuma estar em `recepcao`, e há quem reserve sem nem aparecer no salão.
// Uma fonte só para os dois lugares é o que faz o card bater com a tela.
function useReservasDoC2x() {
  const [clientes, setClientes] = useState<null | ReservaC2x[]>(null);
  const [unidadesPorCpf, setUnidadesPorCpf] = useState<Record<string, UnidadeDoC2x[]>>({});
  const [erro, setErro] = useState<null | string>(null);

  useEffect(() => {
    let vivo = true;
    const buscar = async () => {
      const { data, error } = await fetchReservas();
      if (!vivo) return;
      // ⚠️ Sem payload NÃO apaga a tela: um blip de rede zerando a lista faria o coordenador achar
      // que as reservas foram resolvidas. Erro vira aviso; a lista antiga fica.
      if (data?.clientes) {
        setClientes(data.clientes);
        setUnidadesPorCpf(data.unidadesPorCpf ?? {});
        setErro(null);
      } else if (error) {
        setErro(error);
      }
    };
    void buscar();
    const t = window.setInterval(() => void buscar(), 20_000);
    return () => {
      vivo = false;
      window.clearInterval(t);
    };
  }, []);

  return { clientes, erro, unidadesPorCpf };
}

function Reservas(props: {
  agora: number;
  credenciados: PrometeuCredenciado[];
  doC2x: null | ReservaC2x[];
  erroC2x: null | string;
  onAbrirJornada: (pessoa: PrometeuCredenciado) => void;
}) {
  const [busca, setBusca] = useState("");
  const [imob, setImob] = useState("");
  const [corretor, setCorretor] = useState("");
  const [soAlerta, setSoAlerta] = useState(false);
  const { doC2x, erroC2x } = props;

  // Adapta o cliente do C2X ao formato que a tabela já sabe desenhar. `etapaDesde` passa a ser a
  // hora da reserva MAIS ANTIGA da pessoa — é ela que o alerta de 30 min cobra.
  const reservas = useMemo(() => {
    const noEvento = new Map(props.credenciados.map((c) => [c.id, c]));
    return (doC2x ?? []).map((r) => {
      const pessoa = r.credenciadoId ? noEvento.get(r.credenciadoId) : undefined;
      return {
        ...(pessoa ?? ({} as PrometeuCredenciado)),
        corretor: r.corretor ?? pessoa?.corretor ?? null,
        etapaDesde: r.desde,
        id: r.credenciadoId ?? `c2x:${r.cpf}`,
        imobiliaria: r.imobiliaria ?? pessoa?.imobiliaria ?? null,
        nome: r.cliente,
        // As unidades vêm do C2X, no formato que a tabela de chips espera.
        unidades: r.unidades.map((codigo: string) => ({
          codigo,
          id: `${r.cpf}:${codigo}`,
          lote: codigo.slice(-2),
          quadra: codigo.slice(-4, -2),
          situacao: "reservada",
        })),
      } as PrometeuCredenciado;
    });
  }, [doC2x, props.credenciados]);

  // As opções saem das reservas paradas AGORA, mas SEMPRE incluem o valor filtrado — senão, quando
  // a imobiliária/corretor filtrado resolve a última reserva (o desfecho desejado), a opção sumiria
  // no polling e o select ficaria com um valor órfão, travando a tela numa lista vazia.
  const imobiliarias = useMemo(() => {
    const set = new Set(reservas.map((c) => c.imobiliaria?.trim()).filter(Boolean) as string[]);
    if (imob) set.add(imob);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [reservas, imob]);
  const corretores = useMemo(() => {
    const set = new Set(reservas.map((c) => c.corretor?.trim()).filter(Boolean) as string[]);
    if (corretor) set.add(corretor);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [reservas, corretor]);

  const paradoMs = useCallback(
    (c: PrometeuCredenciado) => props.agora - new Date(c.etapaDesde).getTime(),
    [props.agora],
  );

  const filtradas = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return reservas
      .filter((c) => {
        if (imob && (c.imobiliaria?.trim() ?? "") !== imob) return false;
        if (corretor && (c.corretor?.trim() ?? "") !== corretor) return false;
        if (soAlerta && paradoMs(c) < LIMITE_RESERVA_MS) return false;
        if (
          termo &&
          ![c.nome, c.imobiliaria, c.corretor]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(termo))
        ) {
          return false;
        }
        return true;
      })
      // Quem está PARADO há mais tempo primeiro: é quem o coordenador tem que cobrar antes.
      .sort((a, b) => (a.etapaDesde ?? "").localeCompare(b.etapaDesde ?? ""));
  }, [reservas, busca, imob, corretor, soAlerta, paradoMs]);

  const emAlerta = filtradas.filter((c) => paradoMs(c) >= LIMITE_RESERVA_MS).length;

  return (
    <div>
      <div className="ana-bar">
        <input
          className="lista-search"
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por cliente, corretor ou imobiliária..."
          value={busca}
        />
        <select className="reserva-sel" onChange={(e) => setImob(e.target.value)} value={imob}>
          <option value="">Todas as imobiliárias</option>
          {imobiliarias.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select
          className="reserva-sel"
          onChange={(e) => setCorretor(e.target.value)}
          value={corretor}
        >
          <option value="">Todos os corretores</option>
          {corretores.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <button
          className={`fchip${soAlerta ? " on" : ""}`}
          onClick={() => setSoAlerta((v) => !v)}
          type="button"
        >
          Só em alerta (+30 min)
        </button>
        <div className="lista-count">
          {filtradas.length} reserva{filtradas.length === 1 ? "" : "s"}
          {emAlerta > 0 ? ` · ${emAlerta} em alerta` : ""}
        </div>
      </div>

      {/* O C2X fora do ar no meio do evento tem que APARECER: a lista continua na tela (não se
          apaga de propósito), e sem este aviso ela passaria por atual enquanto envelhece calada. */}
      {erroC2x ? (
        <div className="lista-empty" role="status">
          Não consegui atualizar as reservas no C2X ({erroC2x}). A lista abaixo é a última leitura
          que deu certo.
        </div>
      ) : null}

      {filtradas.length === 0 ? (
        <div className="lista-empty">
          {reservas.length === 0
            ? "Nenhuma reserva parada agora."
            : "Nenhuma reserva parada com esse filtro."}
        </div>
      ) : (
        <div id="reserva-lista">
          <div className="ltable-wrap">
            <table className="ltable">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Corretor</th>
                  <th>Imobiliária</th>
                  {/* A UNIDADE é o que o coordenador precisa saber para cobrar: sem ela a linha
                      diz que existe uma reserva parada, mas não QUAL lote está preso. */}
                  <th>Unidades</th>
                  <th>Tempo na reserva</th>
                </tr>
              </thead>
              <tbody>
                {filtradas.map((c) => {
                  const alerta = paradoMs(c) >= LIMITE_RESERVA_MS;
                  return (
                    <tr
                      key={c.id}
                      onClick={() => props.onAbrirJornada(c)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <NomeNaTabela pessoa={c} />
                      </td>
                      <td>{c.corretor?.trim() || "—"}</td>
                      <td>{c.imobiliaria?.trim() || "—"}</td>
                      <td>
                        <div className="unid-wrap">
                          {c.unidades.length === 0
                            ? "—"
                            : c.unidades.map((u) => (
                                <span className="unid-chip" key={u.id}>
                                  {u.codigo}
                                </span>
                              ))}
                        </div>
                      </td>
                      <td className={`lt-tempo${alerta ? " lt-alerta" : ""}`}>
                        {duracao(c.etapaDesde, props.agora)}
                        {alerta ? <span className="reserva-flag">+30 min</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function PorImobiliaria(props: {
  agora: number;
  credenciados: PrometeuCredenciado[];
  onAbrirJornada: (pessoa: PrometeuCredenciado) => void;
}) {
  const grupos = useMemo(() => {
    const mapa = new Map<string, PrometeuCredenciado[]>();
    for (const pessoa of props.credenciados) {
      const chave = pessoa.imobiliaria?.trim() || "Sem imobiliária";
      const atual = mapa.get(chave);
      if (atual) atual.push(pessoa);
      else mapa.set(chave, [pessoa]);
    }
    return [...mapa.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [props.credenciados]);

  return (
    <>
      {grupos.map(([imobiliaria, pessoas]) => {
        const unidades = pessoas.reduce((soma, c) => soma + c.unidades.length, 0);
        return (
          <div key={imobiliaria} className="imob-group">
            <div className="imob-head">
              <span className="imob-nm">{imobiliaria}</span>
              <span className="imob-meta">
                {pessoas.length} clientes · {unidades} unidades
              </span>
            </div>
            <div className="ltable-wrap">
              <table className="ltable">
                <tbody>
                  {pessoas.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => props.onAbrirJornada(c)}
                      style={{ cursor: "pointer" }}
                    >
                      <td>
                        <NomeNaTabela pessoa={c} />
                      </td>
                      <td>
                        <div className="unid-wrap">
                          {c.unidades.map((u) => (
                            <span key={u.id} className="unid-chip">
                              {u.codigo}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <ChipDaEtapa etapa={c.etapa} />
                      </td>
                      <td className="lt-tempo">
                        {c.entrouEm ? duracao(c.entrouEm, props.agora) : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </>
  );
}

function Kanban(props: {
  agora: number;
  credenciados: PrometeuCredenciado[];
  onAbrirJornada: (pessoa: PrometeuCredenciado) => void;
  onMover: (c: PrometeuCredenciado, etapa: PrometeuEtapa) => void;
}) {
  const [arrastando, setArrastando] = useState<string | null>(null);

  return (
    <div className="kanban">
      {PROMETEU_ETAPAS.map((etapa) => {
        const doColuna = props.credenciados.filter((c) => c.etapa === etapa.id);
        return (
          <div
            key={etapa.id}
            className="kcol"
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              const pessoa = props.credenciados.find((c) => c.id === arrastando);
              if (pessoa && pessoa.etapa !== etapa.id) props.onMover(pessoa, etapa.id);
              setArrastando(null);
            }}
          >
            <div className="kcol-head">
              <span className="et-dot" style={{ background: etapa.cor }} />
              <span className="kcol-nm">{etapa.label}</span>
              <span className="kcol-n">{doColuna.length}</span>
            </div>
            <div className="kcol-body">
              {doColuna.map((c) => (
                <div
                  key={c.id}
                  className="kcard"
                  draggable
                  onClick={() => props.onAbrirJornada(c)}
                  onDragEnd={() => setArrastando(null)}
                  onDragStart={() => setArrastando(c.id)}
                  role="presentation"
                >
                  <div className="kcard-top">
                    <div
                      className="lt-av sm"
                      style={{ background: `${etapa.cor}22`, color: etapa.cor }}
                    >
                      {iniciais(c.nome)}
                    </div>
                    <span className="kcard-nm">{c.nome}</span>
                  </div>
                  <div className="kcard-imob">{c.imobiliaria ?? "—"}</div>
                  <div className="kcard-foot">
                    {c.unidades.length > 0 ? (
                      <span className="unid-chip">
                        {c.unidades[0]?.codigo}
                        {c.unidades.length > 1 ? ` +${c.unidades.length - 1}` : ""}
                      </span>
                    ) : (
                      <span className="kcard-tempo">sem unidade</span>
                    )}
                    <span className="kcard-tempo">
                      ⏱ {duracao(c.etapaDesde, props.agora)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────── MODAL DE CLIENTES

function ModalDeClientes(props: {
  agora: number;
  conteudo: ConteudoDoModal | null;
  onFechar: () => void;
  onSaiuDoEvento: (pessoa: PrometeuCredenciado) => Promise<string | void>;
  pessoas: PrometeuCredenciado[];
}) {
  const [modo, setModo] = useState<"lista" | "grupo">("lista");
  const [saindo, setSaindo] = useState(false);
  const [erroSaida, setErroSaida] = useState<null | string>(null);
  const { onFechar } = props;

  // Depende de `onFechar`, não de `props`: o objeto de props é novo a cada render do pai (que
  // roda a cada 10s do polling), e o efeito ficaria removendo e recolocando o listener sem parar.
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") onFechar();
    };
    document.addEventListener("keydown", aoTeclar);
    return () => document.removeEventListener("keydown", aoTeclar);
  }, [onFechar]);

  // Toda abertura começa na Lista, como no mockup (openModal chamava setMode("lista")).
  useEffect(() => {
    if (props.conteudo) setModo("lista");
  }, [props.conteudo]);

  const pessoas = props.pessoas;

  // Mais tempo parado primeiro: o topo da lista é quem o coordenador tem que resolver agora.
  const ordenados = useMemo(
    () =>
      [...pessoas].sort(
        (a, b) => new Date(a.etapaDesde).getTime() - new Date(b.etapaDesde).getTime(),
      ),
    [pessoas],
  );

  const grupos = useMemo(() => {
    const mapa = new Map<string, PrometeuCredenciado[]>();
    for (const pessoa of ordenados) {
      const chave = pessoa.imobiliaria?.trim() || "Sem imobiliária";
      const atual = mapa.get(chave);
      if (atual) atual.push(pessoa);
      else mapa.set(chave, [pessoa]);
    }
    return [...mapa.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [ordenados]);

  const conteudo = props.conteudo;
  const jornada = conteudo?.tipo === "jornada" ? conteudo.pessoa : null;
  const cabecalho =
    conteudo?.tipo === "pessoas"
      ? { estagio: conteudo.estagio, titulo: conteudo.titulo }
      : { estagio: "", titulo: "" };

  return (
    <div
      className={`modal-ov${conteudo ? " open" : ""}`}
      onClick={(evento) => {
        if (evento.target === evento.currentTarget) props.onFechar();
      }}
      role="presentation"
    >
      <div className="modal">
        <div className="modal-head">
          <div>
            <div className="modal-stage">
              {jornada ? "Jornada do cliente" : cabecalho.estagio}
            </div>
            <div className="modal-title">{jornada ? jornada.nome : cabecalho.titulo}</div>
            <div className="modal-count">
              {jornada
                ? `${jornada.imobiliaria ?? "sem imobiliária"} · ${jornada.unidades.length} ${jornada.unidades.length === 1 ? "unidade" : "unidades"}`
                : `${pessoas.length} ${pessoas.length === 1 ? "cliente" : "clientes"}`}
            </div>
          </div>

          {/* O toggle só existe na lista de um estágio; na jornada o mockup escondia. */}
          {jornada ? null : (
            <div className="modal-toggle">
              {(
                [
                  ["lista", "Lista"],
                  ["grupo", "Por imobiliária"],
                ] as const
              ).map(([id, rotulo]) => (
                <button
                  key={id}
                  className={modo === id ? "on" : ""}
                  onClick={() => setModo(id)}
                  type="button"
                >
                  {rotulo}
                </button>
              ))}
            </div>
          )}

          <button
            className="modal-close"
            onClick={props.onFechar}
            style={jornada ? { marginLeft: "auto" } : undefined}
            type="button"
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {jornada ? (
            <Jornada agora={props.agora} pessoa={jornada} />
          ) : ordenados.length === 0 ? (
            <div className="note" style={{ margin: "20px 0" }}>
              Nenhum cliente neste estágio.
            </div>
          ) : modo === "lista" ? (
            ordenados.map((pessoa) => (
              <LinhaDoModal
                key={pessoa.id}
                agora={props.agora}
                abaixo={pessoa.imobiliaria ?? "sem imobiliária"}
                pessoa={pessoa}
              />
            ))
          ) : (
            grupos.map(([imobiliaria, doGrupo]) => (
              <div key={imobiliaria}>
                <div className="ghead">
                  <span className="gnm">{imobiliaria}</span>
                  <span className="gct">{doGrupo.length}</span>
                </div>
                {doGrupo.map((pessoa) => (
                  <LinhaDoModal
                    key={pessoa.id}
                    agora={props.agora}
                    abaixo={`há ${duracao(pessoa.etapaDesde, props.agora)}`}
                    pessoa={pessoa}
                    semTempo
                  />
                ))}
              </div>
            ))
          )}
        </div>

        {/* SAIU DO EVENTO — a partir de QUALQUER lista, inclusive o Analítico.
            ⚠️ Antes isto só existia na tela do atendente, o que exigia que a pessoa tivesse
            chegado a sentar na secretaria (Lucas, 22/08: "esse saiu eu só consigo fazer se a
            pessoa chegou a dar check-in dentro da secretária"). Só que quem vai embora no meio
            costuma ir ANTES disso — a Ana Maria reservou, devolveu e saiu ainda na negociação —
            e continuava ocupando a fila e os números do painel. */}
        {jornada ? (
          <div className="modal-foot">
            {erroSaida ? <span className="note">{erroSaida}</span> : null}
            <button
              className="btn-sec"
              disabled={saindo}
              onClick={async () => {
                setSaindo(true);
                setErroSaida(null);
                const erro = await props.onSaiuDoEvento(jornada);
                setSaindo(false);
                if (erro) setErroSaida(erro);
                else onFechar();
              }}
              type="button"
            >
              {saindo ? "Registrando..." : "Saiu do evento"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function LinhaDoModal(props: {
  abaixo: string;
  agora: number;
  pessoa: PrometeuCredenciado;
  semTempo?: boolean;
}) {
  return (
    <div className="crow">
      <div className="cav">{iniciais(props.pessoa.nome)}</div>
      <div className="cinf">
        <div className="cnm">{props.pessoa.nome}</div>
        <div className="cim">{props.abaixo}</div>
      </div>
      {props.semTempo ? null : (
        <div className="cwait">há {duracao(props.pessoa.etapaDesde, props.agora)}</div>
      )}
    </div>
  );
}

// A JORNADA do cliente no circuito do evento (decisão do Lucas): Check-in → Negociação → Reserva
// (com as unidades) → Secretária (check-in e atendimento) → Proposta → Finalizado, mais os no-shows.
// Reconstituída no servidor a partir das MOVIMENTAÇÕES de etapa (não só da etapa atual) — por isso
// é buscada ao abrir o modal. "Etiqueta impressa" saiu de propósito: é um detalhe operacional, não
// um passo da jornada de venda.
function Jornada(props: { agora: number; pessoa: PrometeuCredenciado }) {
  const [passos, setPassos] = useState<PrometeuPassoJornada[] | null>(null);

  useEffect(() => {
    let vivo = true;
    void fetchJornada(props.pessoa.id).then(({ data }) => {
      if (vivo) setPassos(data?.passos ?? []);
    });
    return () => {
      vivo = false;
    };
  }, [props.pessoa.id]);

  if (passos === null || passos.length === 0) {
    return (
      <div className="tl">
        <div className="tl-item cur">
          <div className="tl-dot" />
          <div className="tl-body">
            <div className="tl-txt">
              {passos === null ? "Carregando a jornada..." : "Ainda sem passos registrados."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const ultimo = passos.length - 1;

  return (
    <div className="tl">
      {passos.map((passo, i) => {
        const atual = i === ultimo && !passo.cancelado;
        const classe = [
          i < ultimo ? "done" : "",
          atual ? "cur" : "",
          passo.cancelado ? "cancel" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <div key={`${passo.titulo}-${i}`} className={`tl-item ${classe}`}>
            <div className="tl-dot" />
            <div className="tl-body">
              <div className="tl-txt">{passo.titulo}</div>
              {passo.detalhe ? <div className="tl-when">{passo.detalhe}</div> : null}
              <div className="tl-when">
                {passo.quando
                  ? `${hora(passo.quando)}${atual ? ` · há ${duracao(passo.quando, props.agora)}` : ""}`
                  : "—"}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
