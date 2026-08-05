"use client";

import {
  BellRing,
  Check,
  CheckCircle2,
  Clock3,
  DoorOpen,
  FileText,
  Hourglass,
  Store,
  UserRoundSearch,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type {
  AcompanhamentoDaFila,
  EstadoDoCliente,
} from "@/lib/prometeu/fila-do-cliente";
import { EVENTO_CHAMADO, topicoDaFila } from "@/lib/prometeu/fila-topic";
import { PROMETEU_ZONAS, type PrometeuZona } from "@/lib/prometeu/types";
import { getHubSupabaseClient } from "@/lib/supabase/client";

// A PAGINA DO CLIENTE — a unica tela do Prometeu que nao e' operada por ninguem do time.
//
// Quem usa: a pessoa credenciada, em pe' no salao, com o celular na mao. Numero GIGANTE, uma
// informacao por vez, zero menu. Se ela precisar interpretar a tela, a tela falhou.
//
// PRIVACIDADE: o componente so' conhece o `AcompanhamentoDaFila`, que ja' vem podado pelo
// servidor. Nao ha nada aqui para vazar por engano.

// 15s. A aba fica aberta por HORAS no celular: cada segundo a menos vira invocacao paga vezes
// centenas de aparelhos (foi assim que o Hermes gerou fatura). O `visibilitychange` e' o que mais
// economiza — celular no bolso nao consulta. NAO reduzir.
const INTERVALO_MS = 15_000;

// ── AVISOS (Fase 1): quando o cliente é chamado, o celular tem que gritar — som + vibração +
// notificação do sistema. Isso vale com a aba ABERTA (em primeiro plano ou em outra aba do mesmo
// navegador ativo). Tela bloqueada / app fechado é a Fase 2 (Web Push, pós-lançamento).
// Ver [[project_prometeu_tela_cliente]].
const CHAVE_AVISOS = "prometeu:avisos-ativos";

// Lê o eventoId (`e`) e o credenciadoId (`c`) de dentro do próprio token, sem chamar o servidor.
// O token (JWT HS256) já carrega os dois no payload — não há exposição nova de dado. Serve para
// (1) assinar o canal Realtime do evento e (2) saber se um broadcast de "chamado" é pra mim.
function lerTokenDaFila(token: string): {
  credenciadoId: string | null;
  eventoId: string | null;
} {
  try {
    const parte = token.split(".")[1];
    if (!parte) return { credenciadoId: null, eventoId: null };
    let base64 = parte.replace(/-/g, "+").replace(/_/g, "/");
    base64 += "=".repeat((4 - (base64.length % 4)) % 4);
    const payload = JSON.parse(atob(base64)) as { c?: unknown; e?: unknown };

    return {
      credenciadoId: typeof payload.c === "string" ? payload.c : null,
      eventoId: typeof payload.e === "string" ? payload.e : null,
    };
  } catch {
    return { credenciadoId: null, eventoId: null };
  }
}

function suportaAvisos(): boolean {
  if (typeof window === "undefined") return false;

  return "Notification" in window || "vibrate" in navigator;
}

// Notificação do sistema (aparece mesmo com a aba em segundo plano). Android Chrome EXIGE o Service
// Worker (`new Notification()` lança lá); tenta o SW e cai pro construtor no desktop. Best-effort.
async function mostrarNotificacao(titulo: string, corpo: string): Promise<void> {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const opcoes = {
    body: corpo,
    icon: "/prometeu/c2x-logo.png",
    requireInteraction: true,
    tag: "prometeu-chamado",
    vibrate: [200, 100, 200, 100, 400],
  } as NotificationOptions;

  try {
    if ("serviceWorker" in navigator) {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) {
        await reg.showNotification(titulo, opcoes);
        return;
      }
    }
  } catch {
    // cai pro construtor
  }

  try {
    new Notification(titulo, opcoes);
  } catch {
    // sem notificação — som e vibração cobrem
  }
}

function zonaLabel(zona: PrometeuZona | null): string {
  return PROMETEU_ZONAS.find((z) => z.id === zona)?.label ?? "";
}

function fraseDoDestino(zona: PrometeuZona | null, mesa: string | null): string {
  if (zona === "salao") return "Dirija-se ao salão de vendas";
  if (zona === "secretaria") {
    return mesa ? `Dirija-se à secretaria · mesa ${mesa}` : "Dirija-se à secretaria";
  }
  if (zona === "recepcao") return "Dirija-se à recepção";

  return "Procure a organização do evento";
}

function ondeEsta(zona: PrometeuZona | null, mesa: string | null): string {
  if (zona === "secretaria" && mesa) return `Secretaria · mesa ${mesa}`;
  const label = zonaLabel(zona);

  return label ? label : "Com a nossa equipe";
}

function horaCurta(iso: string | null): string {
  if (!iso) return "";
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return "";

  // Fuso do evento fixo: o servidor responde em UTC e o celular do cliente pode estar em
  // qualquer lugar; a hora que vale e' a do salao.
  return dt.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

const TITULO: Record<EstadoDoCliente, string> = {
  aguardando_entrada: "Ainda não registramos sua entrada",
  chamado: "É a sua vez!",
  concluido: "Atendimento concluído",
  em_atendimento: "Em atendimento",
  encerrado: "Acompanhamento encerrado",
  na_fila: "Sua posição na fila",
  nao_localizado: "Não conseguimos localizar você",
};

// ── MINI-FLUXO: o circuito do dia em 3 passos. Onde o cliente esta acende; o que ja' passou fica
// dourado com check; o que falta fica apagado. Deriva do estado + zona (fila ou destino).
const PASSOS = [
  { icone: DoorOpen, id: "recepcao" as const, label: "Recepção" },
  { icone: Store, id: "salao" as const, label: "Salão" },
  { icone: FileText, id: "secretaria" as const, label: "Secretaria" },
];

// Indice do passo atual (0..2), ou 3 quando concluiu (tudo feito), ou null quando a zona e'
// indeterminada — aí quem decide e' o fallback do call-site (na_fila -> 0, em_atendimento -> 1).
// Retornar 0 aqui acenderia "Recepcao" para quem esta de fato no fim do funil (ex.: pagamento na
// secretaria sem mesa apontada), engolindo o fallback.
function passoAtual(dados: AcompanhamentoDaFila): number | null {
  if (dados.estado === "concluido") return 3;
  if (dados.estado === "aguardando_entrada") return null;
  const zona = dados.destinoZona ?? dados.filaZona;
  const i = PASSOS.findIndex((p) => p.id === zona);
  return i >= 0 ? i : null;
}

function MiniFluxo({ atual }: { atual: number }) {
  return (
    <div className="mt-8">
      <p className="m-0 mb-3 text-center text-[10px] font-black uppercase tracking-[0.18em] text-white/30">
        Seu caminho no evento
      </p>
      <div className="flex items-start justify-between">
        {PASSOS.map((passo, i) => {
          const Icone = passo.icone;
          const feito = i < atual;
          const agora = i === atual;
          return (
            <div className="flex flex-1 flex-col items-center gap-2" key={passo.id}>
              <div className="flex w-full items-center">
                <span className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : feito || agora ? "bg-[#cba25a]" : "bg-white/10"}`} />
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-full border-2 transition ${
                    agora
                      ? "border-[#cba25a] bg-[#cba25a] text-[#1a1206] shadow-[0_0_0_6px_rgba(203,162,90,.16)]"
                      : feito
                        ? "border-[#cba25a] bg-[#cba25a]/15 text-[#cba25a]"
                        : "border-white/12 bg-[#0e1620] text-white/30"
                  }`}
                >
                  {feito ? <Check className="size-4" /> : <Icone className="size-[17px]" />}
                </span>
                <span className={`h-0.5 flex-1 ${i === PASSOS.length - 1 ? "opacity-0" : i < atual ? "bg-[#cba25a]" : "bg-white/10"}`} />
              </div>
              <span className={`text-[11px] font-bold ${agora ? "text-white" : feito ? "text-[#cba25a]" : "text-white/35"}`}>
                {passo.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function AcompanharFila({
  erroInicial,
  inicial,
  token,
}: {
  erroInicial: string | null;
  inicial: AcompanhamentoDaFila | null;
  token: string;
}) {
  const [dados, setDados] = useState<AcompanhamentoDaFila | null>(inicial);
  const [erro, setErro] = useState<string | null>(erroInicial);
  const [offline, setOffline] = useState(false);
  const buscando = useRef(false);

  const { credenciadoId: meuId, eventoId } = useMemo(
    () => lerTokenDaFila(token),
    [token],
  );
  const [avisosAtivos, setAvisosAtivos] = useState(false);
  const [podeAtivar, setPodeAtivar] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const estadoAnterior = useRef<EstadoDoCliente | null>(inicial?.estado ?? null);

  const buscar = useCallback(async () => {
    if (!token || buscando.current) return;
    buscando.current = true;

    try {
      const resposta = await fetch(
        `/api/publico/prometeu/fila?t=${encodeURIComponent(token)}`,
        { cache: "no-store" },
      );
      const corpo = (await resposta.json().catch(() => ({}))) as {
        data?: AcompanhamentoDaFila;
        error?: string;
      };

      if (resposta.ok && corpo.data) {
        setDados(corpo.data);
        setErro(null);
        setOffline(false);
        return;
      }

      if (resposta.status === 400 || resposta.status === 404) {
        setErro(corpo.error ?? "Não conseguimos abrir este acompanhamento.");
        return;
      }

      setOffline(true);
    } catch {
      setOffline(true);
    } finally {
      buscando.current = false;
    }
  }, [token]);

  // "Desbloqueia" o áudio: a política de autoplay só deixa tocar depois de um play() disparado por
  // gesto do usuário. Tocamos mudo e pausamos na hora; depois disso o play() do alerta funciona.
  const desbloquearAudio = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      audio.muted = true;
      await audio.play();
      audio.pause();
      audio.currentTime = 0;
      audio.muted = false;
    } catch {
      // segue mesmo sem áudio
    }
  }, []);

  // Liga os avisos NO GESTO do cliente: pede permissão de notificação e desbloqueia o áudio. Um
  // tique curto confirma. Fica guardado na sessão.
  const ativarAvisos = useCallback(async () => {
    await desbloquearAudio();
    try {
      navigator.vibrate?.(60);
    } catch {
      // sem vibração
    }
    try {
      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }
    } catch {
      // sem permissão
    }
    setAvisosAtivos(true);
    try {
      sessionStorage.setItem(CHAVE_AVISOS, "1");
    } catch {
      // sessionStorage indisponível — tudo bem
    }
  }, [desbloquearAudio]);

  // O grito: som + vibração longa + notificação do sistema. Best-effort em cada canal.
  const dispararAlerta = useCallback((destino: string) => {
    const audio = audioRef.current;
    if (audio) {
      try {
        audio.currentTime = 0;
        void audio.play();
      } catch {
        // autoplay bloqueado — notificação/vibração cobrem
      }
    }
    try {
      navigator.vibrate?.([300, 120, 300, 120, 500]);
    } catch {
      // sem vibração
    }
    void mostrarNotificacao("É a sua vez!", destino);
  }, []);

  // Descobre o suporte a avisos e recupera a preferência salva (uma vez, no mount).
  useEffect(() => {
    if (!suportaAvisos()) return;
    setPodeAtivar(true);
    let restaurado = false;
    try {
      restaurado = sessionStorage.getItem(CHAVE_AVISOS) === "1";
    } catch {
      // ignora
    }
    if (!restaurado) return;
    setAvisosAtivos(true);
    // Num documento recém-carregado (reload/reabrir o link) o áudio NÃO está desbloqueado — não
    // houve gesto. A preferência voltou do storage, mas o alarme tocaria mudo. Re-arma o áudio no
    // PRIMEIRO toque do cliente em qualquer lugar da tela.
    const rearmar = () => void desbloquearAudio();
    document.addEventListener("pointerdown", rearmar, { once: true });

    return () => document.removeEventListener("pointerdown", rearmar);
  }, [desbloquearAudio]);

  // O ALERTA nasce da TRANSIÇÃO de estado para "chamado" — não do broadcast. Assim ele dispara mesmo
  // que o Realtime falhe (o poll de 15s pega a transição). O broadcast só ADIANTA o `buscar()`.
  useEffect(() => {
    const atual = dados?.estado ?? null;
    const anterior = estadoAnterior.current;
    estadoAnterior.current = atual;
    if (atual === "chamado" && anterior !== "chamado" && anterior !== null && avisosAtivos) {
      dispararAlerta(fraseDoDestino(dados?.destinoZona ?? null, dados?.destinoMesa ?? null));
    }
  }, [dados?.estado, dados?.destinoZona, dados?.destinoMesa, avisosAtivos, dispararAlerta]);

  // Realtime: assina o canal do evento; quando ALGUÉM é chamado, o servidor faz broadcast com o id
  // do chamado. Se for pra mim (ou vier sem alvo), faço um `buscar()` na hora — o alerta sai da
  // transição de estado acima. Rejoin com backoff, no padrão do IrisPage.
  useEffect(() => {
    if (!eventoId) return;
    const supabase = getHubSupabaseClient();
    if (!supabase) return;

    let canal: ReturnType<typeof supabase.channel> | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tentativa = 0;
    let vivo = true;

    const reconectar = () => {
      if (!vivo || timer) return;
      try {
        if (canal) supabase.removeChannel(canal);
      } catch {
        // ignora
      }
      canal = null;
      const espera = Math.min(30_000, 2_000 * 2 ** tentativa);
      tentativa += 1;
      timer = setTimeout(() => {
        timer = null;
        assinar();
      }, espera);
    };

    const assinar = () => {
      if (!vivo) return;
      canal = supabase
        .channel(topicoDaFila(eventoId), { config: { broadcast: { self: false } } })
        .on("broadcast", { event: EVENTO_CHAMADO }, (msg) => {
          const alvo = (msg?.payload as { c?: unknown } | undefined)?.c;
          if (!alvo || alvo === meuId) {
            // Fui EU o chamado: refresh imediato, pro alerta ("é a sua vez") sair na hora.
            void buscar();
          } else {
            // Outra pessoa foi chamada => a fila andou. Atualizo a MINHA posição em tempo real,
            // mas com um respiro aleatório (até ~1,2s) pra centenas de celulares não baterem no
            // servidor no mesmo instante. O snapshot de 4s do server + esse jitter seguram o custo
            // (a regra do Hermes é preferir realtime a polling, não empilhar picos). `vivo` evita
            // o refresh se a tela já desmontou durante a espera.
            const jitter = Math.floor(Math.random() * 1200);
            setTimeout(() => {
              if (vivo) void buscar();
            }, jitter);
          }
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            tentativa = 0;
            return;
          }
          if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            reconectar();
          }
        });
    };

    assinar();

    return () => {
      vivo = false;
      if (timer) clearTimeout(timer);
      try {
        if (canal) supabase.removeChannel(canal);
      } catch {
        // ignora
      }
    };
  }, [eventoId, meuId, buscar]);

  useEffect(() => {
    if (!token) return;

    let relogio: ReturnType<typeof setInterval> | null = null;
    const parar = () => {
      if (relogio) clearInterval(relogio);
      relogio = null;
    };
    const comecar = () => {
      parar();
      relogio = setInterval(() => void buscar(), INTERVALO_MS);
    };
    const aoTrocarVisibilidade = () => {
      if (document.visibilityState === "visible") {
        void buscar();
        comecar();
      } else {
        parar();
      }
    };

    if (document.visibilityState === "visible") comecar();
    document.addEventListener("visibilitychange", aoTrocarVisibilidade);

    return () => {
      parar();
      document.removeEventListener("visibilitychange", aoTrocarVisibilidade);
    };
  }, [buscar, token]);

  return (
    // `publico-shell`: neutraliza o `html { min-width: 1024px }` do hub (desktop) via a regra
    // `html:has(.publico-shell)` do globals.css. Sem ela, a página renderiza a 1024px no celular e
    // o conteúdo "escapa" pra direita, cortado (o mesmo bug das telas /publico/cad).
    <main className="publico-shell flex min-h-dvh flex-col bg-[#0b1017] text-white [background:radial-gradient(900px_440px_at_50%_-10%,#16283a_0%,transparent_60%),#0b1017]">
      <header className="flex items-center justify-between gap-3 px-5 pb-3 pt-6">
        {/* eslint-disable-next-line @next/next/no-img-element -- logo estatica, sem otimizacao */}
        <img alt="C2X" className="h-6 w-auto opacity-95" src="/c2x-logo-branca.png" />
        <span className="truncate text-xs font-semibold text-white/45">
          {dados?.lancamento || "Lançamento"}
        </span>
      </header>

      {erro || !dados ? (
        <Aviso texto={erro ?? "Não conseguimos abrir este acompanhamento."} />
      ) : (
        <>
          <BarraAvisos
            ativos={avisosAtivos}
            estado={dados.estado}
            onAtivar={() => void ativarAvisos()}
            podeAtivar={podeAtivar}
          />

          <section className="flex flex-1 flex-col px-5 pt-2">
            <Corpo dados={dados} />
          </section>

          <footer className="px-5 py-4">
            <p className="m-0 flex items-center justify-center gap-2 text-[11px] text-white/35">
              <span className={`size-2 rounded-full ${offline ? "bg-amber-400" : "bg-emerald-400"}`} />
              {offline
                ? "Sem conexão. Tentando novamente…"
                : `Atualiza sozinho · ${horaCurta(dados.atualizadoEm)}`}
            </p>
          </footer>
        </>
      )}

      {/* eslint-disable-next-line jsx-a11y/media-has-caption -- alarme, sem faixa de legenda */}
      <audio preload="auto" ref={audioRef} src="/prometeu/alerta.mp3" />
    </main>
  );
}

// Barra de avisos: só faz sentido enquanto o cliente AINDA VAI ser chamado. Antes de ativar, um
// botão convida; depois de ativar, um selo discreto confirma. Sem poluir a tela quando não cabe.
const ESTADOS_QUE_ESPERAM: EstadoDoCliente[] = [
  "aguardando_entrada",
  "na_fila",
  "em_atendimento",
];

function BarraAvisos({
  ativos,
  estado,
  onAtivar,
  podeAtivar,
}: {
  ativos: boolean;
  estado: EstadoDoCliente;
  onAtivar: () => void;
  podeAtivar: boolean;
}) {
  if (!podeAtivar || !ESTADOS_QUE_ESPERAM.includes(estado)) return null;

  if (ativos) {
    return (
      <p className="m-0 flex items-center justify-center gap-1.5 px-5 pt-1 text-[11px] font-semibold text-emerald-300/80">
        <Check className="size-3.5" />
        Avisos ligados. Vamos te chamar aqui.
      </p>
    );
  }

  return (
    <button
      className="mx-5 mt-1 flex items-center justify-center gap-2 rounded-2xl border border-[#cba25a]/40 bg-[#cba25a]/10 px-4 py-3 text-[13px] font-bold text-[#e7d9bd] transition active:scale-[.98]"
      onClick={onAtivar}
      type="button"
    >
      <BellRing className="size-4 text-[#cba25a]" />
      Tocar um alarme quando for a minha vez
    </button>
  );
}

function Aviso({ texto }: { texto: string }) {
  return (
    <section className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
      <Hourglass aria-hidden="true" className="size-12 text-white/25" />
      <p className="m-0 text-lg font-bold leading-snug text-white/80">{texto}</p>
    </section>
  );
}

function Corpo({ dados }: { dados: AcompanhamentoDaFila }) {
  const nome = dados.nome.trim().split(/\s+/)[0] ?? dados.nome;

  // O CHAMADO OCUPA A TELA: verde, pulsando, visto de longe.
  if (dados.estado === "chamado") {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <span className="grid size-28 place-items-center rounded-full border-2 border-emerald-400 bg-emerald-500/15 shadow-[0_0_60px_rgba(16,185,129,.3)] animate-pulse">
          <BellRing aria-hidden="true" className="size-12 text-emerald-300" />
        </span>
        <p className="m-0 mt-6 font-black leading-none text-emerald-300 [font-size:clamp(34px,11vw,52px)]">
          {TITULO.chamado}
        </p>
        <p className="m-0 mt-4 text-xl font-bold leading-snug">
          {fraseDoDestino(dados.destinoZona, dados.destinoMesa)}
        </p>
      </div>
    );
  }

  if (dados.estado === "na_fila") {
    const pnf = dados.pessoasNaFrente;
    const eta = dados.etaMinutos;
    // Proporcao do anel: quanto mais gente na frente, menos preenchido. Teto visual em 10.
    const cheio = pnf === null ? 0.15 : Math.max(0.06, 1 - Math.min(pnf, 10) / 11);
    const circ = 2 * Math.PI * 86;
    return (
      <div className="flex flex-1 flex-col">
        <div className="pt-2 text-center">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40">
            Bem-vindo
          </p>
          <p className="m-0 mt-0.5 text-balance text-[26px] font-black leading-tight">{nome}</p>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center text-center">
          <p className="m-0 text-[11px] font-black uppercase tracking-[0.16em] text-[#cba25a]">
            Sua posição na fila
          </p>
          <div className="relative my-3 grid size-[196px] place-items-center">
            <svg className="absolute inset-0 -rotate-90" viewBox="0 0 196 196">
              <circle cx="98" cy="98" fill="none" r="86" stroke="rgba(255,255,255,.07)" strokeWidth="6" />
              <circle
                cx="98"
                cy="98"
                fill="none"
                r="86"
                stroke="url(#anel)"
                strokeDasharray={circ}
                strokeDashoffset={circ * (1 - cheio)}
                strokeLinecap="round"
                strokeWidth="6"
              />
              <defs>
                <linearGradient id="anel" x1="0" x2="1" y1="0" y2="1">
                  <stop offset="0" stopColor="#a07c3b" />
                  <stop offset="1" stopColor="#cba25a" />
                </linearGradient>
              </defs>
            </svg>
            <div>
              <div className="flex items-start justify-center">
                <span className="bg-gradient-to-b from-white to-[#c9b892] bg-clip-text font-black leading-none tabular-nums text-transparent [font-size:76px]">
                  {dados.posicao ?? "—"}
                </span>
                {dados.posicao != null ? (
                  <span className="mt-2 text-[30px] font-black leading-none text-[#c9b892]">º</span>
                ) : null}
              </div>
              <div className="-mt-1 text-lg font-extrabold text-[#cba25a]">da fila</div>
            </div>
          </div>

          {eta ? (
            <div className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-[#cba25a]/28 bg-[#cba25a]/12 px-4 py-2.5">
              <Clock3 aria-hidden="true" className="size-4 text-[#cba25a]" />
              <span className="text-[13px] text-[#e7d9bd]">
                Perspectiva: <b className="font-extrabold text-white">{eta.de} a {eta.ate} min</b>
              </span>
            </div>
          ) : null}
        </div>

        <MiniFluxo atual={passoAtual(dados) ?? 0} />
      </div>
    );
  }

  if (dados.estado === "em_atendimento") {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col justify-center">
          <Cartao
            cor="emerald"
            icone={<CheckCircle2 aria-hidden="true" className="size-12 text-emerald-300" />}
            subtitulo={ondeEsta(dados.destinoZona, dados.destinoMesa)}
            titulo={TITULO.em_atendimento}
          />
        </div>
        <MiniFluxo atual={passoAtual(dados) ?? 1} />
      </div>
    );
  }

  if (dados.estado === "concluido") {
    return (
      <div className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col justify-center">
          <Cartao
            cor="emerald"
            icone={<CheckCircle2 aria-hidden="true" className="size-12 text-emerald-300" />}
            subtitulo="Obrigado por participar do nosso lançamento."
            titulo={TITULO.concluido}
          />
        </div>
        <MiniFluxo atual={3} />
      </div>
    );
  }

  if (dados.estado === "nao_localizado") {
    return (
      <div className="flex flex-1 flex-col justify-center">
        <Cartao
          cor="amber"
          icone={<UserRoundSearch aria-hidden="true" className="size-12 text-amber-300" />}
          subtitulo="Você foi chamado e não te encontramos. Procure a organização para voltar à fila."
          titulo={TITULO.nao_localizado}
        />
      </div>
    );
  }

  if (dados.estado === "aguardando_entrada") {
    return (
      <div className="flex flex-1 flex-col justify-center">
        <Cartao
          cor="neutro"
          icone={<Hourglass aria-hidden="true" className="size-12 text-white/40" />}
          subtitulo="Sua posição aparece aqui assim que a recepção fizer o seu check-in."
          titulo={TITULO.aguardando_entrada}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col justify-center">
      <Cartao
        cor="neutro"
        icone={<Hourglass aria-hidden="true" className="size-12 text-white/40" />}
        subtitulo="Procure a organização do evento."
        titulo={TITULO.encerrado}
      />
    </div>
  );
}

const CORES = {
  amber: "border-amber-400/60 bg-amber-500/10",
  emerald: "border-emerald-400/60 bg-emerald-500/10",
  neutro: "border-white/15 bg-white/[0.04]",
} as const;

function Cartao({
  cor,
  icone,
  subtitulo,
  titulo,
}: {
  cor: keyof typeof CORES;
  icone: ReactNode;
  subtitulo: string;
  titulo: string;
}) {
  return (
    <div className={`rounded-3xl border-2 px-5 py-10 text-center ${CORES[cor]}`}>
      <div className="mx-auto w-fit">{icone}</div>
      <p className="m-0 mt-4 font-black leading-none [font-size:clamp(26px,8vw,38px)]">
        {titulo}
      </p>
      <p className="m-0 mt-4 text-base font-semibold leading-snug text-white/70">
        {subtitulo}
      </p>
    </div>
  );
}
