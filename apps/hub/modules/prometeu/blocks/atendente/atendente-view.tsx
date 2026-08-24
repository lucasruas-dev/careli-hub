"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  chamarCredenciadoRemoto,
  excluirCredenciadoRemoto,
  fetchEventos,
  fetchFila,
  fetchJornada,
  fetchOperadorEu,
  liberarMesaRemoto,
  linkDaFilaRemoto,
  atenderRemoto,
  marcarNoShowRemoto,
  sairDaMesaRemoto,
  sentarNaMesaRemoto,
  urlDaPaRemoto,
} from "../../data/prometeu-operations";
import { useLancamentoSelecionado } from "../../lancamento-contexto";
import { useAuth } from "@/providers/auth-provider";
import {
  telefoneParaWhatsapp,
  urlDoConviteNoWhatsapp,
} from "@/lib/prometeu/convite-da-fila";
import { nomeDoLancamento } from "@/lib/prometeu/lancamento";
import { PROMETEU_PAPEIS, PROMETEU_ZONAS } from "@/lib/prometeu/types";
import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";
import type {
  PrometeuChamada,
  PrometeuCredenciado,
  PrometeuEtapa,
  PrometeuEvento,
  PrometeuMesa,
  PrometeuOperadorEu,
  PrometeuPassoJornada,
  PrometeuResumoDaMesa,
} from "@/lib/prometeu/types";
import { ATENDENTE_CSS } from "./atendente-estilo";
import { BipDoCupomDaSecretaria } from "./bip-cupom";

// A MESA DE ATENDIMENTO DA SECRETARIA — o posto onde a venda se fecha.
//
// ESTE ARQUIVO É O MOCKUP APROVADO (public/prometeu/atendente.html) COM OS MOTORES LIGADOS: o
// markup, as classes e o CSS (atendente-estilo.ts, gerado do próprio arquivo) são os do mockup.
// A única diferença é a origem do dado. Ao mexer, mexa como se estivesse no HTML: mesma classe,
// mesma estrutura. As classes de ESTADO que o mockup punha no <body> (`em-atendimento`,
// `can-atender`, `pip-out`, `data-posto`) vivem no wrapper `.pat`.
//
// Quem usa: o atendente sentado numa das 18 mesas, de notebook. Ele CHAMA da fila da secretaria,
// recebe a pessoa na mesa dele, abre a PA e conclui.
type OperadorLogado = NonNullable<PrometeuOperadorEu>;

function papelLabel(perfil: OperadorLogado["perfil"]): string {
  return PROMETEU_PAPEIS.find((p) => p.id === perfil)?.label ?? perfil;
}

function zonaLabel(zona: OperadorLogado["zona"]): string {
  return PROMETEU_ZONAS.find((z) => z.id === zona)?.label ?? zona;
}

// Sem seletor de perfil (correção do Lucas, 27/07): esta tela é exclusiva do atendimento. O que
// ele escolhe ao entrar é a MESA em que vai sentar — e ela fica guardada, porque ninguém troca de
// mesa no meio do dia.
const CHAVE_DA_MESA = "prometeu:mesa-do-atendente";

// QUANDO O ATENDIMENTO COMEÇOU, guardado no navegador. Desde o resumo da mesa quem manda é o
// `atendido_em` do servidor; esta marca ficou como rede de proteção para o intervalo entre o
// clique em "Compareceu" e a resposta do servidor, e para quando a leitura da fila falha.
const CHAVE_DO_INICIO = "prometeu:inicio-do-atendimento";

// OS 4 DESTINOS do modal "Direcionar cliente" (mockup `DIR_DESTINOS`), na mesma ordem e com os
// mesmos rótulos. "Financeiro" é o nome que o Lucas aprovou na tela; a etapa equivalente no
// Prometeu chama-se `pagamento` — o rótulo do mockup manda, o id é problema nosso.
const DESTINOS_DO_DIRECIONAMENTO: readonly { etapa: PrometeuEtapa; rotulo: string }[] = [
  { etapa: "negociacao", rotulo: "Negociação (salão)" },
  { etapa: "reserva", rotulo: "Reserva" },
  { etapa: "recepcao", rotulo: "Recepção" },
  { etapa: "pagamento", rotulo: "Financeiro" },
];

// A partir daqui a espera fica VERMELHA na fila (mockup `.fwait.old`).
const ESPERA_CRITICA_MIN = 45;

// Ajustes do mockup para ele viver DENTRO do hub: lá era uma página inteira (100vh), aqui é um
// bloco de módulo. Fica separado do CSS gerado para não se perder num regenerar.
const AJUSTES_NO_HUB = `
.pat{height:100%;min-height:0}
.pat .erro{background:var(--danger-soft);color:var(--danger);border-radius:10px;padding:9px 14px;font-size:13px;font-weight:700;margin-bottom:10px;flex-shrink:0}
.pat .hbtn{width:38px;height:38px;border-radius:9px;border:1px solid var(--line);background:var(--panel);color:var(--muted);cursor:pointer;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.pat .hbtn:hover{color:var(--text);border-color:var(--line-strong)}
.pat .hbtn.sair{width:auto;gap:7px;padding:0 14px;font:inherit;font-size:13px;font-weight:700}
.pat .escolha{max-width:780px;margin:0 auto;padding:36px 8px}
.pat .escolha h1{font-size:26px;font-weight:900;margin-top:4px}
.pat .escolha .sub{font-size:14px;color:var(--muted);margin-top:6px}
.pat .escolha .lb{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--brand)}
.pat .mesas-escolha{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-top:22px}
.pat .mesa-op{border:1px solid var(--line);background:var(--panel);border-radius:16px;padding:18px 10px;text-align:center;cursor:pointer;font:inherit}
.pat .mesa-op:hover:not(:disabled){border-color:var(--brand)}
.pat .mesa-op:disabled{opacity:.55;cursor:not-allowed;background:var(--subtle)}
.pat .mesa-op .mlb{display:block;font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.pat .mesa-op .mnu{display:block;font-size:26px;font-weight:900;color:var(--text);line-height:1.1}
.pat .mesa-op .mwho{display:block;font-size:11.5px;color:var(--muted);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pat .pa-view{position:fixed;inset:0;z-index:130;background:rgba(0,0,0,.9);display:flex;flex-direction:column}
.pat .pa-view .pv-top{display:flex;align-items:center;justify-content:space-between;padding:12px 20px;color:#fff;font-size:14px;font-weight:700}
.pat .pa-view img{flex:1;min-height:0;object-fit:contain;padding:12px}
.pat .pill{display:inline-flex;align-items:center;gap:6px;border-radius:20px;padding:4px 12px;font-size:12px;font-weight:800}
.pat .pill.ok{background:var(--ok-soft);color:var(--ok)}
.pat .pill.warn{background:var(--warn-soft);color:var(--warn)}
.pat .pill.brand{background:var(--brand-soft);color:var(--brand);border:1px solid var(--brand);cursor:pointer;font:inherit}
.pat .pip-head.em-pausa{background:var(--warn)}
.pat .mm-info{min-width:0}
`;

const ICONE_WPP = (
  <svg fill="currentColor" height="17" viewBox="0 0 24 24" width="17">
    <path d="M17.5 14.4c-.3-.2-1.8-.9-2-1s-.5-.1-.7.1-.8 1-1 1.2-.4.2-.7 0a8 8 0 0 1-2.4-1.5 9 9 0 0 1-1.6-2c-.2-.3 0-.5.1-.6l.5-.6.3-.5v-.5l-1-2.3c-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.2.2 2.2 3.4 5.4 4.7.7.3 1.3.5 1.8.6.7.2 1.4.2 1.9.1.6-.1 1.8-.7 2-1.5.3-.7.3-1.3.2-1.4l-.6-.3ZM12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2Z" />
  </svg>
);

// A marca do início do atendimento como ela vive no navegador.
type MarcaDoAtendimento = { credenciadoId: string; em: number };

function lerMarcaDoAtendimento(): MarcaDoAtendimento | null {
  try {
    const cru = window.localStorage.getItem(CHAVE_DO_INICIO);
    if (!cru) return null;

    const marca = JSON.parse(cru) as Partial<MarcaDoAtendimento>;
    return typeof marca.credenciadoId === "string" && typeof marca.em === "number"
      ? { credenciadoId: marca.credenciadoId, em: marca.em }
      : null;
  } catch {
    // Marca corrompida (edição manual, versão antiga): vale mais recomeçar do que quebrar a tela.
    return null;
  }
}

// Iniciais para o avatar — no máximo duas letras, como no mockup.
function iniciais(nome: string): string {
  return nome
    .trim()
    .split(/\s+/)
    .map((parte) => parte.charAt(0))
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function useRelogio(intervaloMs = 1000) {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setAgora(Date.now()), intervaloMs);
    return () => window.clearInterval(timer);
  }, [intervaloMs]);

  return agora;
}

// Minutos de espera crus. Separado do texto porque a fila usa o NÚMERO para decidir a cor
// (vermelho a partir de 45 min) e o TEXTO para mostrar o tempo.
function minutosDesde(iso: string | null | undefined, agora: number): number | null {
  if (!iso) return null;

  const inicio = new Date(iso).getTime();
  if (Number.isNaN(inicio)) return null;

  return Math.max(0, Math.floor((agora - inicio) / 60000));
}

function esperaDesde(iso: string | null | undefined, agora: number): string {
  const minutos = minutosDesde(iso, agora);
  if (minutos === null) return "";

  return minutos < 60
    ? `${minutos} min`
    : `${Math.floor(minutos / 60)}h${String(minutos % 60).padStart(2, "0")}`;
}

// "Tempo médio" no formato `m:ss` do mockup (`#kpi-tmed`). Sem nenhum atendimento encerrado no dia
// não há média: travessão, e não "0:00" — zero minutos de atendimento seria mentira.
function tempoMedio(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return "—";

  const segundos = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(segundos / 60)}:${String(segundos % 60).padStart(2, "0")}`;
}

// Cronômetro do atendimento no formato "00:00" do mockup (`.pip-head .cr`). Pausado, o número
// CONGELA e o tempo parado sai da conta.
function cronometroDoAtendimento(
  inicio: number | null,
  agora: number,
  pausaAcumuladaMs: number,
  pausadoEm: number | null,
): string {
  if (inicio === null) return "--:--";

  const fim = pausadoEm ?? agora;
  const segundos = Math.max(0, Math.floor((fim - inicio - pausaAcumuladaMs) / 1000));

  return `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(
    segundos % 60,
  ).padStart(2, "0")}`;
}

// "Secretaria · Mesa 03" das Últimas chamadas.
function destinoDaChamada(zona: string | null, mesa: string | null): string {
  const lugar = PROMETEU_ZONAS.find((z) => z.id === zona)?.label ?? zona;
  const partes = [lugar, mesa ? `Mesa ${mesa}` : null].filter(Boolean);

  return partes.length > 0 ? partes.join(" · ") : "—";
}

// EM QUE PÉ FICOU a chamada (mockup `.ust.ok` / `.ust.aus` / `.ust.dir`). A tabela de chamadas
// registra só QUEM foi chamado e PARA ONDE; o desfecho mora na pessoa. Sem pessoa identificada o
// status vira travessão — inventar um desfecho num log de chamadas é pior que não ter nenhum.
function statusDaChamada(
  pessoa: PrometeuCredenciado | null,
  emAtendimento: Set<string>,
): { classe: string; rotulo: string } {
  if (!pessoa) return { classe: "", rotulo: "—" };
  if (pessoa.noShow) return { classe: "aus", rotulo: "não veio" };
  if (emAtendimento.has(pessoa.id)) return { classe: "ok", rotulo: "em atendimento" };

  switch (pessoa.etapa) {
    case "cancelado":
      return { classe: "aus", rotulo: "cancelado" };
    case "concluido":
      return { classe: "ok", rotulo: "finalizado" };
    case "negociacao":
      return { classe: "ok", rotulo: "em negociação" };
    case "recepcao":
      return { classe: "ok", rotulo: "credenciado" };
    case "secretaria":
      return { classe: "ok", rotulo: "em espera" };
    // Reserva, proposta e pagamento: saiu da mesa e seguiu para outra etapa. É o que o mockup
    // chama de "direcionado" (azul).
    default:
      return { classe: "dir", rotulo: "direcionado" };
  }
}

// A JANELA FLUTUANTE precisa do SEU PRÓPRIO root React. Com `createPortal` os nós iam para lá,
// mas o React continuava escutando os eventos no root da aba principal — e clique numa `window`
// separada não chega lá: era por isso que "Finalizar" (e Pausar, e Direcionar) não faziam nada.
// Um root montado no `document` da janelinha põe os listeners onde os cliques acontecem.
function PipHost({ children, janela }: { children: ReactNode; janela: Window }) {
  const rootRef = useRef<Root | null>(null);

  useEffect(() => {
    const root = createRoot(janela.document.body);
    rootRef.current = root;
    return () => {
      // A janela pode já ter sido fechada quando isto roda (o usuário fechou no X): desmontar um
      // root sobre um document destruído lança, e esse erro não interessa a ninguém.
      try {
        root.unmount();
      } catch {
        // janela já fechada
      }
      rootRef.current = null;
    };
  }, [janela]);

  // Sem array de deps de propósito: re-renderiza a janelinha a cada render do pai (o cronômetro
  // vira de segundo), mantendo o card e os botões vivos com as closures mais recentes.
  useEffect(() => {
    rootRef.current?.render(
      <div className="pat pip-solo em-atendimento" data-posto="secretaria">
        {children}
      </div>,
    );
  });

  return null;
}

export function AtendenteView() {
  const [eventos, setEventos] = useState<PrometeuEvento[]>([]);
  const [eventoId, setEventoId] = useState("");
  // O LANCAMENTO SELECIONADO na tela inicial MANDA (bug 24/08: Vale do Ouro selecionado,
  // tela mostrando Villa Paris — o eventoDoDia ignora a escolha). Ref para o efeito de carga
  // inicial; o efeito abaixo troca o evento quando a selecao muda.
  const selecionado = useLancamentoSelecionado();
  const selecionadoRef = useRef(selecionado);
  selecionadoRef.current = selecionado;
  useEffect(() => {
    if (selecionado) setEventoId(selecionado.id);
  }, [selecionado]);

  const [fila, setFila] = useState<PrometeuCredenciado[]>([]);
  // Chamados que não apareceram. É a segunda aba da fila: chamar de novo traz a pessoa de volta
  // ao fluxo sem ninguém precisar recadastrar nada.
  const [noShow, setNoShow] = useState<PrometeuCredenciado[]>([]);
  const [chamadas, setChamadas] = useState<PrometeuChamada[]>([]);
  const [abaDaFila, setAbaDaFila] = useState<"fila" | "retorno">("fila");
  // QUEM ESTÁ NA MESA (o operador do evento, não o cliente). No dia são 18 mesas iguais e o
  // atendente precisa reconhecer que a tela é dele antes de chamar alguém.
  const [operador, setOperador] = useState<OperadorLogado | null>(null);
  // O NO-SHOW DEFINITIVO ARMADO: id de quem está a um clique de sair do evento.
  const [exclusaoArmada, setExclusaoArmada] = useState<string | null>(null);
  const [mesas, setMesas] = useState<PrometeuMesa[]>([]);
  const [credenciados, setCredenciados] = useState<PrometeuCredenciado[]>([]);
  const [emTransito, setEmTransito] = useState<
    { chamadoEm: string; credenciadoId: string }[]
  >([]);
  const [resumo, setResumo] = useState<PrometeuResumoDaMesa | null>(null);
  const [mesaId, setMesaId] = useState<string | null>(null);
  const [lendoMesa, setLendoMesa] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Poll falhando em sequência (sessão expirada, rede) — acende a faixa "desconectado".
  const falhasDePoll = useRef(0);
  const [desconectado, setDesconectado] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [rechamado, setRechamado] = useState(false);
  // A PAUSA NÃO EXISTE NO BANCO: é estado desta tela, como no mockup. Vale para o atendente
  // enxergar que parou; o F5 zera a pausa e o cronômetro volta a contar cheio.
  const [inicioDoAtendimento, setInicioDoAtendimento] = useState<number | null>(null);
  const [pausadoEm, setPausadoEm] = useState<number | null>(null);
  const [pausaAcumuladaMs, setPausaAcumuladaMs] = useState(0);
  const [direcionando, setDirecionando] = useState(false);
  const [destinoEscolhido, setDestinoEscolhido] = useState<PrometeuEtapa | null>(null);
  const [motivoDoDirecionamento, setMotivoDoDirecionamento] = useState("");
  // A PA aberta DENTRO da tela, não em outra aba.
  const [paAberta, setPaAberta] = useState<{ nome: string; url: string } | null>(null);
  // A FICHA do cliente (mockup `#cli-modal`): dados, unidades e jornada, ao clicar no nome.
  const [ficha, setFicha] = useState<PrometeuCredenciado | null>(null);
  // A jornada reconstituída da pessoa da ficha (a mesma da Central): buscada ao abrir a ficha.
  const [passosDaFicha, setPassosDaFicha] = useState<PrometeuPassoJornada[] | null>(null);
  // O aviso do rodapé (mockup `#toast`).
  const [toast, setToast] = useState<string | null>(null);
  // A JANELA FLUTUANTE do atendimento (mockup `poparPiP`): o card sai da aba e vira uma janelinha
  // por cima de tudo, para o atendente usar o C2X na tela inteira sem perder o cronômetro.
  const [janelaPip, setJanelaPip] = useState<Window | null>(null);
  const agora = useRelogio();
  const toastTimer = useRef<number | null>(null);
  const { hubUser } = useAuth();
  // Quem aparece na mesa no Mapa do salão: o operador do evento se houver, senão o usuário do hub
  // (o admin testando). Nunca vazio — sem nome, o mapa continuaria dizendo "sem atendente".
  const nomeDoAtendente = operador?.nome ?? hubUser?.name ?? "Atendente";

  const avisar = useCallback((texto: string) => {
    setToast(texto);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3400);
  }, []);

  useEffect(() => {
    const guardada = window.localStorage.getItem(CHAVE_DA_MESA);
    if (guardada) setMesaId(guardada);
    setLendoMesa(false);
  }, []);

  // A MESA DO CADASTRO MANDA. Quando o operador foi criado no Setup como atendente, ele JÁ tem uma
  // mesa fixada — é essa que ele vai ocupar no dia. Sem isto a tela pedia pra escolher, e a escolha
  // não protegia nada: ela marca "em uso" pela presença de um CLIENTE, não de um colega, então dois
  // atendentes podiam pegar a mesma mesa e brigar pela fila. Ir direto também poupa um passo na
  // hora de abrir o posto.
  useEffect(() => {
    if (!operador?.mesaId) return;
    setMesaId(operador.mesaId);
    try {
      window.localStorage.setItem(CHAVE_DA_MESA, operador.mesaId);
    } catch {
      /* navegador sem storage: a mesa vale para esta sessão */
    }
    void sentarNaMesaRemoto({ mesaId: operador.mesaId, nome: operador.nome });
  }, [operador]);

  // A jornada da FICHA vem do servidor (mesma reconstituição da Central), buscada ao abrir.
  useEffect(() => {
    if (!ficha) {
      setPassosDaFicha(null);
      return;
    }
    let vivo = true;
    setPassosDaFicha(null);
    void fetchJornada(ficha.id).then(({ data }) => {
      if (vivo) setPassosDaFicha(data?.passos ?? []);
    });
    return () => {
      vivo = false;
    };
  }, [ficha]);

  // "Quem sou eu" do cookie de sessão do operador. Uma vez no mount: a sessão não muda no meio do
  // dia, e a tela já paga um polling de 10s da fila.
  useEffect(() => {
    void (async () => {
      const { data } = await fetchOperadorEu();
      setOperador(data ?? null);
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const { data } = await fetchEventos();
      const lista = data ?? [];
      setEventos(lista);
      const ativo = selecionadoRef.current ?? eventoDoDia(lista);
      if (ativo) setEventoId(ativo.id);
      else setCarregando(false);
    })();
  }, []);

  const carregar = useCallback(
    async (silencioso = false) => {
      if (!eventoId) return;
      if (!silencioso) setCarregando(true);

      // A MESA VAI JUNTO no pedido: é ela que faz o servidor devolver o resumo do dia desta mesa.
      const { data, error } = await fetchFila(eventoId, mesaId ?? undefined);

      // SEM PAYLOAD, MANTÉM O QUE ESTÁ NA TELA. Aplicar listas vazias aqui era o caminho para o
      // pior defeito possível no dia: um blip de rede num poll de 10s zerava `mesas`, a mesa do
      // atendente virava null e a tela do atendimento em curso era substituída pela pergunta
      // "Em qual mesa você vai atender?" — dizendo, ainda por cima, que não há mesa no Setup.
      // Como o poll é silencioso, nem erro aparecia. Mesmo guard que a Central já fazia.
      if (!data) {
        if (!silencioso) setErro(error ?? "Não consegui ler a fila.");
        // MAS O SILÊNCIO TEM LIMITE: 3 polls seguidos falhando (sessão expirada, rede fora) e a
        // tela avisaria NADA — congelada com dados velhos, idêntica a uma fila parada. O
        // contador acende a faixa "desconectado" para o atendente chamar o suporte.
        falhasDePoll.current += 1;
        if (falhasDePoll.current >= 3) setDesconectado(true);
        setCarregando(false);
        return;
      }
      falhasDePoll.current = 0;
      setDesconectado(false);

      setResumo(data.resumoDaMesa ?? null);
      setFila(data.filaSecretaria ?? []);
      // No-show é POR FILA: esta tela é a da secretaria, então só o no-show de quem estava na
      // secretaria (a etapa não muda no no-show). Sem o filtro, o "não veio" marcado no salão ou
      // na recepção vazava para cá — cada posto tem que ver só o seu.
      setNoShow((data.noShow ?? []).filter((c) => c.etapa === "secretaria"));
      setChamadas(data.chamadas ?? []);
      setMesas(data.mesas ?? []);
      setCredenciados(data.credenciados ?? []);
      // A COMPLETA, não a filtrada: `emTransito` só traz chamada SEM mesa (é a lista do painel do
      // salão), e a chamada desta mesa SEMPRE tem mesa — com a filtrada o overlay
      // Compareceu/Não veio/Rechamar nunca abre e a mesa trava na primeira chamada (01/08).
      setEmTransito(data.emTransitoTodos ?? data.emTransito ?? []);
      setErro(null);
      setCarregando(false);
    },
    [eventoId, mesaId],
  );

  useEffect(() => {
    void carregar();
  }, [carregar]);

  // Mesmo relógio de 10s do app do organizador: outro atendente pode chamar alguém da mesma fila,
  // e chamar quem já foi chamado é o erro que trava o dia.
  useEffect(() => {
    if (!eventoId) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void carregar(true);
    }, 10_000);

    // AO VOLTAR PARA A ABA, RECARREGA NA HORA. O atendente vive na aba do C2X: quando volta, a
    // tela pode estar com dados de MINUTOS atrás (o poll não roda em aba oculta), e Finalizar
    // sobre estado velho era um dos caminhos para concluir a pessoa errada.
    const aoVoltar = () => {
      if (document.visibilityState === "visible") void carregar(true);
    };
    document.addEventListener("visibilitychange", aoVoltar);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [carregar, eventoId]);

  const evento = useMemo(
    () => eventos.find((e) => e.id === eventoId) ?? null,
    [eventos, eventoId],
  );
  const mesa = useMemo(
    () => mesas.find((m) => m.id === mesaId) ?? null,
    [mesaId, mesas],
  );

  // Quem está NA MINHA MESA agora. Vem do banco, não de estado local: se o atendente recarregar a
  // página no meio do atendimento, a pessoa continua lá.
  const cliente = useMemo(() => {
    if (!mesa?.credenciadoId) return null;
    return credenciados.find((c) => c.id === mesa.credenciadoId) ?? null;
  }, [credenciados, mesa]);

  // O ATENDIMENTO EM CURSO NESTA MESA. É o que liga a tela inteira do atendimento: enquanto ele
  // existe, a fila e os indicadores saem da frente (mockup `body.em-atendimento`).
  const credenciadoEmAtendimento =
    mesa?.estado === "atendimento" ? (mesa.credenciadoId ?? null) : null;

  // O COMEÇO DO ATENDIMENTO, DIRETO DO SERVIDOR. `atendido_em` é carimbado no banco no instante em
  // que o cliente senta: é o número exato, e vale igual em qualquer máquina.
  const inicioDoServidor = useMemo(() => {
    if (!credenciadoEmAtendimento || !resumo?.emAtendimentoDesde) return null;

    const em = new Date(resumo.emAtendimentoDesde).getTime();
    return Number.isNaN(em) ? null : em;
  }, [credenciadoEmAtendimento, resumo]);

  // ÚLTIMO RECURSO do cronômetro: a hora da última CHAMADA daquela pessoa PARA ESTA MESA.
  const inicioPelaChamada = useMemo(() => {
    if (!credenciadoEmAtendimento || !cliente || !mesa) return null;

    const alvo = cliente.nome.trim().toLocaleLowerCase("pt-BR");
    // A lista vem do servidor em ordem decrescente: a primeira que casar é a mais recente.
    const chamada = chamadas.find(
      (c) => c.mesa === mesa.numero && c.nome.trim().toLocaleLowerCase("pt-BR") === alvo,
    );
    if (!chamada) return null;

    const em = new Date(chamada.chamadoEm).getTime();
    return Number.isNaN(em) ? null : em;
  }, [chamadas, cliente, credenciadoEmAtendimento, mesa]);

  const estadoDaMesa = mesa?.estado ?? null;

  useEffect(() => {
    if (!credenciadoEmAtendimento) {
      // A mesa só é dada como vazia depois que os dados chegaram. No F5 a primeira renderização
      // ainda não sabe o estado da mesa, e apagar a marca aí jogaria fora o começo de um
      // atendimento que continua de pé.
      if (estadoDaMesa === null) return;

      window.localStorage.removeItem(CHAVE_DO_INICIO);
      setInicioDoAtendimento(null);
      setPausadoEm(null);
      setPausaAcumuladaMs(0);
      setDirecionando(false);
      setDestinoEscolhido(null);
      setMotivoDoDirecionamento("");
      return;
    }

    const marca = lerMarcaDoAtendimento();
    const daMarca = marca?.credenciadoId === credenciadoEmAtendimento ? marca.em : null;

    // ORDEM DE CONFIANÇA: o carimbo do servidor manda; sem ele vale o clique em "Compareceu" dado
    // nesta máquina; depois a hora da chamada; e, em último caso, agora.
    const em = inicioDoServidor ?? daMarca ?? inicioPelaChamada ?? Date.now();
    window.localStorage.setItem(
      CHAVE_DO_INICIO,
      JSON.stringify({ credenciadoId: credenciadoEmAtendimento, em }),
    );
    setInicioDoAtendimento(em);
  }, [credenciadoEmAtendimento, estadoDaMesa, inicioDoServidor, inicioPelaChamada]);

  // Quem está sentado em ALGUMA mesa agora (não só na minha): separa, nas Últimas chamadas, quem
  // já está sendo atendido de quem só foi chamado.
  const emAtendimento = useMemo(
    () =>
      new Set(
        mesas.flatMap((m) =>
          m.estado === "atendimento" && m.credenciadoId ? [m.credenciadoId] : [],
        ),
      ),
    [mesas],
  );

  // A CHAMADA NÃO GUARDA O ID de quem foi chamado: o único elo disponível hoje é o nome COMPLETO.
  // Homônimo no mesmo evento anula o vínculo e o status vira travessão — rótulo errado num log é
  // pior que rótulo nenhum, e vínculo por nome já custou caro na Iris.
  const pessoaPorNome = useMemo(() => {
    const mapa = new Map<string, PrometeuCredenciado | null>();

    for (const pessoa of credenciados) {
      const chave = pessoa.nome.trim().toLocaleLowerCase("pt-BR");
      mapa.set(chave, mapa.has(chave) ? null : pessoa);
    }

    return mapa;
  }, [credenciados]);

  const listaDaAba = abaDaFila === "fila" ? fila : noShow;

  // OS 4 INDICADORES do mockup (faixa `.kpis`). "Em espera" e "Maior espera" saem da própria fila;
  // "Atendimentos hoje" e "Tempo médio" vêm do resumo da mesa.
  const maiorEspera = useMemo(() => {
    if (fila.length === 0) return "—";

    const maisAntigo = fila.reduce((pior, atual) =>
      (atual.etapaDesde ?? "") < (pior.etapaDesde ?? "") ? atual : pior,
    );

    return esperaDesde(maisAntigo.etapaDesde, agora) || "—";
  }, [agora, fila]);

  // Quem EU chamei e ainda não sentou. Enquanto isso a mesa fica reservada para ele.
  const meuChamado = useMemo(() => {
    if (!mesa?.credenciadoId || mesa.estado !== "ocupada") return null;
    const transito = emTransito.find((t) => t.credenciadoId === mesa.credenciadoId);
    if (!transito) return null;
    const pessoa = credenciados.find((c) => c.id === mesa.credenciadoId);
    return pessoa ? { chamadoEm: transito.chamadoEm, pessoa } : null;
  }, [credenciados, emTransito, mesa]);

  // O CARD "MINHA MESA" (mockup `.minha-mesa-card`): os três estados que o atendente distingue sem
  // ler nada — livre, âmbar (chamou e a pessoa ainda não sentou) e verde (atendimento em curso).
  const minhaMesa = useMemo(() => {
    if (mesa?.estado === "atendimento") {
      return {
        classe: "atendimento",
        rotulo: "Em atendimento",
        sub: cliente?.nome ?? "—",
      };
    }

    if (mesa?.estado === "ocupada") {
      return {
        classe: "ocupada",
        rotulo: "Aguardando cliente",
        sub: cliente?.nome ?? "chamada enviada",
      };
    }

    return { classe: "livre", rotulo: "Disponível", sub: "pronta para o próximo" };
  }, [cliente, mesa]);

  async function chamarProximo(alvo?: PrometeuCredenciado) {
    const escolhido = alvo ?? fila[0];
    if (!escolhido || !mesa) return;

    setErro(null);
    const { error } = await chamarCredenciadoRemoto({
      credenciadoId: escolhido.id,
      eventoId,
      mesaId: mesa.id,
    });

    if (error) {
      setErro(error);
      return;
    }

    avisar(`🔊 Chamando ${escolhido.nome}`);
    await carregar(true);
  }

  async function confirmarChegada() {
    if (!mesa?.credenciadoId) return;

    const { error } = await atenderRemoto({
      credenciadoId: mesa.credenciadoId,
      mesaId: mesa.id,
    });

    if (error) {
      setErro(error);
      return;
    }

    // O RELÓGIO DO ATENDIMENTO COMEÇA NESTE CLIQUE — é ele que carimba `atendido_em` no banco.
    const em = Date.now();
    window.localStorage.setItem(
      CHAVE_DO_INICIO,
      JSON.stringify({ credenciadoId: mesa.credenciadoId, em }),
    );
    setInicioDoAtendimento(em);
    setPausadoEm(null);
    setPausaAcumuladaMs(0);

    await carregar(true);
  }

  // "NÃO VEIO" É RECUPERÁVEL (decisão D2 do Lucas): a pessoa sai da fila normal e cai na aba
  // Aguardando retorno, porque na prática ela estava no banheiro e volta em cinco minutos. Quem
  // tira de vez é o "No-show" da aba de retorno.
  async function naoVeio() {
    if (!mesa?.credenciadoId) return;

    setErro(null);
    // A zona diz DE ONDE veio o "não veio": sem ela, o no-show da mesa caía no fallback por
    // etapa e a recuperação ficava ambígua entre os postos.
    const { error } = await marcarNoShowRemoto({
      credenciadoId: mesa.credenciadoId,
      zona: "secretaria",
    });

    // A MESA SÓ SAI DEPOIS DA MARCA GRAVADA. Liberar antes de confirmar deixava a pessoa voltando
    // para a fila NORMAL em vez do "Aguardando retorno", sem ninguém saber que falhou.
    if (error) {
      setErro(error);
      return;
    }

    // Passa o credenciadoId (o endpoint exige), mas SEM etapa: o no-show não muda a etapa, só
    // solta a mesa. Checo o erro para a mesa não ficar presa em silêncio.
    const { error: erroLiberar } = await liberarMesaRemoto({
      credenciadoId: mesa.credenciadoId,
      mesaId: mesa.id,
    });
    if (erroLiberar) {
      setErro(erroLiberar);
      return;
    }

    await carregar(true);
  }

  // NO-SHOW DEFINITIVO: tira da operação de vez. Carimba `encerrado_em` no servidor, e é esse
  // carimbo que faz a pessoa sumir das filas E da aba de retorno de uma vez só.
  async function excluirDoEvento(alvo: PrometeuCredenciado) {
    setErro(null);
    setExclusaoArmada(null);

    const { error } = await excluirCredenciadoRemoto({ credenciadoId: alvo.id });

    if (error) {
      setErro(error);
      return;
    }

    avisar(`${alvo.nome} saiu da operação`);
    await carregar(true);
  }

  // FINALIZAR: o cliente fechou aqui. Conclui a pessoa E devolve a mesa para a fila NUM ÚNICO ato.
  // Antes eram dois requests (mover + liberar) e o liberar ia SEM credenciadoId — o endpoint
  // recusava com 400 e a mesa ficava presa, com o cliente já concluído (bug que o Lucas viu). O
  // `liberar` já sabe avançar a etapa junto (moverPara), então um request só resolve — e o erro é
  // checado: se não gravou, a mesa NÃO é dada como livre na tela.
  async function finalizarAtendimento() {
    if (!mesa?.credenciadoId) return;

    setErro(null);
    const { error } = await liberarMesaRemoto({
      credenciadoId: mesa.credenciadoId,
      etapa: "concluido",
      mesaId: mesa.id,
    });

    if (error) {
      setErro(error);
      return;
    }

    fecharPip();
    await carregar(true);
  }

  // PAUSAR / RETOMAR. O tempo parado é somado à parte e descontado do cronômetro.
  function alternarPausa() {
    if (pausadoEm === null) {
      setPausadoEm(Date.now());
      return;
    }

    setPausaAcumuladaMs(pausaAcumuladaMs + (Date.now() - pausadoEm));
    setPausadoEm(null);
  }

  function abrirDirecionamento() {
    setDestinoEscolhido(null);
    setMotivoDoDirecionamento("");
    setDirecionando(true);
  }

  // DIRECIONAR: devolve o cliente para uma etapa anterior com o motivo registrado. Igual ao
  // finalizar: um request só (libera a mesa E move a etapa) e checando o erro — senão a mesa
  // ficava presa depois de direcionar.
  async function confirmarDirecionamento() {
    if (!mesa?.credenciadoId || !destinoEscolhido) return;

    const motivo = motivoDoDirecionamento.trim();
    setErro(null);

    const { error } = await liberarMesaRemoto({
      credenciadoId: mesa.credenciadoId,
      etapa: destinoEscolhido,
      mesaId: mesa.id,
      ...(motivo ? { motivo } : {}),
    });

    if (error) {
      setErro(error);
      return;
    }

    setDirecionando(false);
    fecharPip();
    await carregar(true);
  }

  // Rechamar NÃO reinicia o cronômetro: o tempo conta desde a primeira chamada.
  async function rechamar() {
    if (!mesa?.credenciadoId) return;

    const { error } = await chamarCredenciadoRemoto({
      credenciadoId: mesa.credenciadoId,
      eventoId,
      mesaId: mesa.id,
    });

    // O botão só pinta "Chamado!" se a chamada saiu de verdade — senão ele mente para o atendente,
    // que fica esperando alguém que nunca foi chamado.
    if (error) {
      setErro(error);
      return;
    }

    setRechamado(true);
    window.setTimeout(() => setRechamado(false), 2000);
  }

  async function abrirPa(path: string, nome: string) {
    const { data } = await urlDaPaRemoto(path);
    if (data?.url) setPaAberta({ nome, url: data.url });
  }

  // O BOTÃO DE WHATSAPP DA FILA (decisão D1 do Lucas): REENVIA o link que a pessoa deveria ter
  // recebido no check-in para acompanhar a própria posição no celular. Não é mensagem nova nem
  // disparo de template: abre o WhatsApp com o texto pronto, e quem aperta enviar é o operador.
  //
  // O link é pedido AO SERVIDOR a cada clique porque a assinatura mora lá (SESSAO_CAD_SECRET); a
  // montagem do número e do texto vive em `convite-da-fila.ts`, a mesma que o app do organizador
  // usa. Duas cópias do texto viram dois textos diferentes na primeira correção.
  async function reenviarLinkDaFila(alvo: PrometeuCredenciado) {
    // A ABA ABRE JÁ NO CLIQUE, ainda dentro do gesto do usuário. Abrir depois do `await` o
    // navegador trata como pop-up e BLOQUEIA em silêncio: o atendente clica e nada acontece.
    const janela = window.open("", "_blank");

    const { data, error } = await linkDaFilaRemoto({
      credenciadoId: alvo.id,
      eventoId,
    });

    if (error || !data?.link) {
      janela?.close();
      setErro(error ?? "Não consegui montar o link da fila.");
      return;
    }

    const url = urlDoConviteNoWhatsapp({
      lancamento: nomeDoLancamento(evento),
      link: data.link,
      nome: alvo.nome,
      telefone: alvo.telefone,
    });

    if (janela) {
      // `opener` cortado à mão: `window.open` com "noopener" devolveria null e a aba já aberta
      // ficaria perdida em branco.
      janela.opener = null;
      janela.location.replace(url);
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    // Avisa quando o número NÃO veio na ficha: o WhatsApp vai abrir no seletor de contatos, e sem
    // esse aviso o atendente acha que travou.
    avisar(
      telefoneParaWhatsapp(alvo.telefone)
        ? `Link da fila de ${alvo.nome} pronto no WhatsApp`
        : `${alvo.nome} está sem telefone na ficha: escolha o contato no WhatsApp`,
    );
  }

  // ── JANELA FLUTUANTE (mockup `poparPiP`) ──────────────────────────────────
  // A tela do atendimento sai da aba e vira uma janelinha sempre por cima, para o atendente abrir
  // o C2X em tela cheia sem perder o cronômetro nem os botões. Fechar a janela NÃO finaliza o
  // atendimento: o card volta para a aba, como no mockup.
  const fecharPip = useCallback(() => {
    setJanelaPip((atual) => {
      atual?.close();
      return null;
    });
  }, []);

  async function abrirPip() {
    const api = (
      window as unknown as {
        documentPictureInPicture?: {
          requestWindow: (opcoes: { height: number; width: number }) => Promise<Window>;
        };
      }
    ).documentPictureInPicture;

    // Navegador sem suporte (Firefox, Safari antigo): o card fica inline na aba, que é o
    // comportamento normal. Melhor isso do que um botão que não faz nada em silêncio.
    if (!api) {
      avisar("Este navegador não abre a janela flutuante. Use o Chrome ou o Edge.");
      return;
    }

    // `requestWindow` REJEITA quando o navegador não considera o clique um gesto válido ou quando
    // já existe uma janela aberta. Sem o try o erro vira rejeição não tratada e o botão parece
    // quebrado; com ele o atendente pelo menos sabe que continua na aba.
    let janela: Window;
    try {
      janela = await api.requestWindow({ height: 360, width: 420 });
    } catch {
      avisar("Não consegui abrir a janela flutuante. O atendimento segue aqui na aba.");
      return;
    }

    // A janela nasce sem CSS nenhum: leva o estilo do mockup junto, senão o card vira texto cru.
    // As duas últimas regras existem SÓ aqui: a janela não tem o preflight do Tailwind, e o reset
    // do mockup ficou escopado em `.pat *`, que não alcança o <body> dela. Sem isso sobravam a
    // margem do navegador mais o padding do wrapper, e a faixa de botões saía para fora da janela.
    const estilo = janela.document.createElement("style");
    estilo.textContent = `${ATENDENTE_CSS}${AJUSTES_NO_HUB}
body{margin:0;overflow:hidden}
.pat.pip-solo{padding:0;height:100vh}`;
    janela.document.head.appendChild(estilo);
    janela.document.documentElement.dataset.uixTheme =
      document.documentElement.dataset.uixTheme ?? "light";

    // Só zera se quem fechou foi ESTA janela: sem a comparação, o evento de uma janela antiga
    // derrubaria o estado de uma nova aberta em seguida.
    janela.addEventListener("pagehide", () =>
      setJanelaPip((atual) => (atual === janela ? null : atual)),
    );
    setJanelaPip(janela);
  }

  useEffect(() => () => janelaPip?.close(), [janelaPip]);

  // Sem ninguém na mesa não há o que flutuar: a janela fecha sozinha ao fim do atendimento.
  useEffect(() => {
    if (!credenciadoEmAtendimento && janelaPip) fecharPip();
  }, [credenciadoEmAtendimento, fecharPip, janelaPip]);

  if (lendoMesa) {
    return <div className="h-full" />;
  }

  // ESCOLHA DA MESA — a porta de entrada. Mesa ocupada por outro atendente aparece bloqueada: duas
  // pessoas na mesma mesa significa dois atendimentos brigando pelo mesmo cliente.
  if (!mesaId || !mesa) {
    return (
      <div className="pat" data-posto="secretaria">
        <style dangerouslySetInnerHTML={{ __html: ATENDENTE_CSS + AJUSTES_NO_HUB }} />
        <div className="escolha">
          <div className="lb">{nomeDoLancamento(evento) || "Prometeu"}</div>
          <h1>Em qual mesa você vai atender?</h1>
          <div className="sub">
            A escolha fica guardada neste computador até você sair da mesa.
          </div>

          {/* O erro TAMBÉM aparece aqui: se a primeira leitura falhar (rede/401), `mesas` fica
              vazio e a tela dizia "Nenhuma mesa cadastrada no Setup" com o erro real engolido —
              o atendente achava que o Setup tinha sido apagado no meio do evento. */}
          {erro ? <div className="erro">{erro}</div> : null}
          {mesas.length === 0 ? (
            <div className="fila-empty">
              {carregando
                ? "Carregando as mesas..."
                : erro
                  ? "Não consegui ler as mesas — veja o erro acima e recarregue a página."
                  : "Nenhuma mesa cadastrada no Setup deste lançamento."}
            </div>
          ) : (
            <div className="mesas-escolha">
              {mesas.map((m) => {
                // Bloqueia só mesa com OUTRO ATENDENTE sentado. Mesa com CLIENTE e sem atendente
                // tem que ser reentrável: era assim que um "Sair da mesa" no meio do atendimento
                // trancava o atendente fora da própria mesa até o cliente sair por outro caminho.
                const ocupadaPorOutro = Boolean(
                  m.atendenteNome && m.atendenteNome !== nomeDoAtendente,
                );
                // QUEM ESTÁ SENTADO NELA (correção do Lucas, 27/07). "em uso" não diz nada: o
                // atendente precisa saber QUEM está lá para não interromper o colega.
                const quemEsta = m.credenciadoId
                  ? (credenciados.find((c) => c.id === m.credenciadoId)?.nome ?? null)
                  : null;

                return (
                  <button
                    className="mesa-op"
                    disabled={ocupadaPorOutro}
                    key={m.id}
                    onClick={() => {
                      window.localStorage.setItem(CHAVE_DA_MESA, m.id);
                      setMesaId(m.id);
                      // Registra que este atendente sentou na mesa (aparece no Mapa do salão).
                      void sentarNaMesaRemoto({ mesaId: m.id, nome: nomeDoAtendente });
                    }}
                    type="button"
                  >
                    <span className="mlb">Mesa</span>
                    <span className="mnu">{m.numero}</span>
                    <span className="mwho" title={quemEsta ?? undefined}>
                      {quemEsta ?? (ocupadaPorOutro ? "em uso" : "livre")}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  const pausado = pausadoEm !== null;

  // A MESA DIZ QUE HÁ ATENDIMENTO, MAS QUEM MANDA É TER O CLIENTE EM MÃOS. A classe
  // `em-atendimento` esconde a fila e os indicadores; se ela entrasse sem o card existir (mesa
  // apontando para alguém que saiu da lista de credenciados), o atendente ficaria com a tela em
  // branco no meio do evento. Amarrar as duas coisas na mesma condição elimina esse estado.
  const emAtendimentoNaTela = Boolean(credenciadoEmAtendimento && cliente);

  // As classes de estado que o mockup punha no <body>.
  const classes = [
    "pat",
    "can-chamar",
    "can-atender",
    emAtendimentoNaTela ? "em-atendimento" : "",
    janelaPip ? "pip-out" : "",
  ]
    .filter(Boolean)
    .join(" ");

  // O CARD DO ATENDIMENTO (mockup `#atendimento`). Mora numa função porque ele é renderizado ou na
  // aba, ou dentro da janela flutuante — o mesmo card, dois lugares.
  const cardDoAtendimento =
    emAtendimentoNaTela && cliente ? (
      <div id="atendimento">
        {/* Pausado a faixa vira âmbar: é o mesmo aviso do mockup, só que o estado da pausa não
            existia lá (era sempre verde). A regra fica nos ajustes, não no CSS gerado. */}
        <div className={`pip-head${pausado ? " em-pausa" : ""}`}>
          <div className="em">
            <span className="pulse" />
            <span>{pausado ? "Pausado" : "Em atendimento"}</span>
          </div>
          <div className="pip-head-r">
            {janelaPip ? null : (
              <button
                className="b-popout"
                onClick={() => void abrirPip()}
                title="Abrir em janela flutuante"
                type="button"
              >
                <svg
                  fill="none"
                  height="15"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  width="15"
                >
                  <path d="M15 3h6v6M21 3l-9 9M10 5H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" />
                </svg>
              </button>
            )}
            <div className="cr">
              {cronometroDoAtendimento(inicioDoAtendimento, agora, pausaAcumuladaMs, pausadoEm)}
            </div>
          </div>
        </div>

        <div className="pip-body">
          <div className="at-cli">
            <div className="at-av">{iniciais(cliente.nome)}</div>
            <div>
              <div className="at-nome">{cliente.nome}</div>
              <div className="at-sub">
                {[
                  cliente.imobiliaria ?? "Sem imobiliária",
                  cliente.corretor,
                  `Secretaria · Mesa ${mesa.numero}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </div>
          </div>

          {/* AS UNIDADES em chip monoespaçado: é o código que o atendente digita no lançamento e
              lê em voz alta para conferir com o cliente. */}
          {cliente.unidades.length > 0 ? (
            <div className="u-wrap">
              {cliente.unidades.map((unidade) => (
                <span className="u-chip" key={unidade.id}>
                  {unidade.codigo}
                </span>
              ))}
            </div>
          ) : null}

          {/* O PIX E A PA seguem o cliente para cá. Não estão no mockup (que nasceu antes da PA
              existir), mas é durante o atendimento que a folha é lida. */}
          <div className="u-wrap" style={{ marginTop: 12 }}>
            {cliente.pagoEm ? <span className="pill ok">PIX de R$ 1.000 pago</span> : null}
            {cliente.paPath ? (
              <button
                className="pill brand"
                onClick={() => void abrirPa(cliente.paPath as string, cliente.nome)}
                type="button"
              >
                Abrir a PA
              </button>
            ) : (
              <span className="pill warn">PA pendente</span>
            )}
          </div>
        </div>

        {/* AS TRÊS SAÍDAS do atendimento, na ordem do mockup. */}
        <div className="at-actions">
          <button className="b-pausar" onClick={alternarPausa} type="button">
            {pausado ? "▶ Retomar" : "❚❚ Pausar"}
          </button>
          <button className="b-direcionar" onClick={abrirDirecionamento} type="button">
            ↪ Direcionar
          </button>
          <button
            className="b-finalizar"
            onClick={() => void finalizarAtendimento()}
            type="button"
          >
            ✓ Finalizar
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className={classes} data-posto="secretaria">
      <style dangerouslySetInnerHTML={{ __html: ATENDENTE_CSS + AJUSTES_NO_HUB }} />

      {/* Escuta o leitor USB: bipar o CUPOM da reserva abre o lançamento da proposta
          (Lucas, 24/08: "dentro da secretária eu lanço a proposta"). Crachás seguem o fluxo
          normal da mesa — o componente só age em QR de cupom. */}
      <BipDoCupomDaSecretaria operador={operador?.nome ?? null} />

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
          <h1>Atendimento</h1>
          <div className="sub">Prometeu · Gestão de Fila</div>
        </div>

        <div className="h-right">
          {/* O OPERADOR LOGADO: avatar, nome e "papel · zona". São 18 mesas com a mesma tela; sem
              o nome ninguém confere de relance que está no próprio posto. */}
          <div className="atend">
            <span className="av">{operador ? iniciais(operador.nome) : `M${mesa.numero}`}</span>
            <span>
              {operador?.nome ?? `Mesa ${mesa.numero}`}
              <small>
                {operador
                  ? `${papelLabel(operador.perfil)} · ${zonaLabel(operador.zona)}`
                  : "Atendente · Secretaria"}
              </small>
            </span>
          </div>
          <div className="clock">
            {new Date(agora).toLocaleTimeString("pt-BR", {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </div>
          <button
            className="hbtn"
            onClick={() => void carregar()}
            title="Atualizar"
            type="button"
          >
            ⟳
          </button>
          {/* O ESCAPE UNIVERSAL. Existe porque a mesa já travou em estados sem nenhum botão
              (01/08: `ocupada` com a chamada fechada por fora) e o atendente ficava paralisado
              esperando alguém soltar pelo banco. Aparece sempre que a mesa não está livre;
              devolve o cliente para a fila da secretaria sem mudar a etapa dele — liberar a
              mesa nunca pode significar perder a pessoa. */}
          {mesa.estado !== "livre" ? (
            <button
              className="hbtn"
              onClick={() => {
                if (!window.confirm("Liberar esta mesa? O cliente volta para a fila da secretaria.")) return;
                void liberarMesaRemoto({
                  credenciadoId: mesa.credenciadoId ?? undefined,
                  mesaId: mesa.id,
                }).then(({ error }) => {
                  if (error) setErro(error);
                  else void carregar(true);
                });
              }}
              title="Liberar a mesa em qualquer situação"
              type="button"
            >
              Liberar mesa
            </button>
          ) : null}
          <button
            className="hbtn sair"
            onClick={() => {
              // COM CLIENTE NA MESA, sair precisa de confirmação: um clique errado aqui durante
              // um atendimento deixava a mesa "em uso" na tela de escolha e o atendente trancado
              // fora da própria mesa (a escolha bloqueava toda mesa não-livre).
              if (
                mesa.credenciadoId &&
                !window.confirm(
                  "Esta mesa está com um cliente. Sair mesmo assim? O atendimento continua e você pode voltar escolhendo a mesa de novo.",
                )
              ) {
                return;
              }
              // Solta a mesa no Mapa do salão antes de sair.
              void sairDaMesaRemoto({ mesaId: mesa.id });
              window.localStorage.removeItem(CHAVE_DA_MESA);
              setMesaId(null);
            }}
            type="button"
          >
            Sair da mesa
          </button>
        </div>
      </header>

      {desconectado ? (
        <div className="erro">
          SEM CONEXÃO COM O SERVIDOR — a fila desta tela pode estar velha. Recarregue a página;
          se não voltar, saia e entre de novo.
        </div>
      ) : null}
      {erro ? <div className="erro">{erro}</div> : null}

      {/* A FAIXA DE INDICADORES: os dois primeiros são desta MESA hoje (não do evento inteiro). */}
      <div className="kpis">
        <div className="kpi ok">
          <div className="kpi-ic">
            <svg
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
            </svg>
          </div>
          <div>
            <div className="kpi-vl">{resumo ? String(resumo.atendimentosHoje) : "—"}</div>
            <div className="kpi-lb">Atendimentos hoje</div>
          </div>
        </div>
        <div className="kpi info">
          <div className="kpi-ic">
            <svg
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
          </div>
          <div>
            <div className="kpi-vl">{tempoMedio(resumo?.tempoMedioMs)}</div>
            <div className="kpi-lb">Tempo médio</div>
          </div>
        </div>
        <div className="kpi warn">
          <div className="kpi-ic">
            <svg
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
          </div>
          <div>
            <div className="kpi-vl">{fila.length}</div>
            <div className="kpi-lb">Em espera</div>
          </div>
        </div>
        <div className="kpi danger">
          <div className="kpi-ic">
            <svg
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
            >
              <path d="M5 22h14M5 2h14M17 22v-4.2a2 2 0 0 0-.6-1.4L12 12l-4.4 4.4a2 2 0 0 0-.6 1.4V22M7 2v4.2c0 .5.2 1 .6 1.4L12 12l4.4-4.4c.4-.4.6-.9.6-1.4V2" />
            </svg>
          </div>
          <div>
            <div className="kpi-vl">{maiorEspera}</div>
            <div className="kpi-lb">Maior espera</div>
          </div>
        </div>
      </div>

      <div className="grid">
        {/* A FILA ocupa a coluna larga da ESQUERDA (1fr) — é o que o atendente olha o dia todo. */}
        <div className="card">
          <div className="fila-tit">Fila da secretaria</div>

          {/* AS DUAS LISTAS DA MESMA FILA. "Aguardando retorno" é quem foi chamado e não veio:
              some da fila normal para não travar o próximo, mas continua à mão. */}
          <div className="ftabs">
            {(
              [
                ["fila", "Fila", fila.length],
                ["retorno", "Aguardando retorno", noShow.length],
              ] as const
            ).map(([id, rotulo, contagem]) => (
              <button
                className={abaDaFila === id ? "on" : ""}
                key={id}
                onClick={() => {
                  setAbaDaFila(id);
                  // Sair da aba desarma a exclusão: voltar depois e achar um "Confirmar?" já
                  // engatilhado é a forma de tirar do evento quem ninguém quis tirar.
                  setExclusaoArmada(null);
                }}
                type="button"
              >
                {rotulo} <span className="n">{contagem}</span>
              </button>
            ))}
          </div>

          <div className="fila">
            {carregando ? (
              <div className="fila-empty">Carregando...</div>
            ) : listaDaAba.length === 0 ? (
              <div className="fila-empty">
                {abaDaFila === "fila" ? "Fila vazia." : "Ninguém aguardando retorno."}
              </div>
            ) : (
              listaDaAba.map((c, indice) => {
                const minutos = minutosDesde(c.etapaDesde, agora);
                const esperandoDemais = (minutos ?? 0) >= ESPERA_CRITICA_MIN;
                const proximo = abaDaFila === "fila" && indice === 0;

                return (
                  <div className={`frow${proximo ? " prox" : ""}`} key={c.id}>
                    {/* O PRÓXIMO da fila vem com a posição invertida: é quem o botão "Chamar
                        próximo" vai levar. No "Aguardando retorno" ninguém tem vez na fila, então
                        o quadrado vira o símbolo de volta. */}
                    <div className="fpos">{abaDaFila === "fila" ? indice + 1 : "↩"}</div>
                    <div className="fav">{iniciais(c.nome)}</div>
                    <div className="finfo">
                      <div
                        className="fnome link"
                        onClick={() => setFicha(c)}
                        role="presentation"
                      >
                        {c.nome}
                      </div>
                      <div className="fimob">
                        {c.imobiliaria ?? "Sem imobiliária"}
                        {c.corretor ? ` · ${c.corretor}` : ""}
                      </div>
                    </div>
                    <div className={`fwait${esperandoDemais ? " old" : ""}`}>
                      ⏱ {esperaDesde(c.etapaDesde, agora)}
                    </div>
                    {/* RECHAMAR É O MESMO VERBO de chamar: o servidor limpa a marca de no-show
                        sozinho e reaproveita a chamada aberta, sem reiniciar o cronômetro. */}
                    <button
                      className="fcall"
                      disabled={Boolean(cliente) || ocupado}
                      onClick={() => void chamarProximo(c)}
                      type="button"
                    >
                      {abaDaFila === "fila" ? "Chamar" : "Rechamar"}
                    </button>
                    {/* NO-SHOW = TIRAR DE VEZ (decisão D2). Só existe na aba de retorno. Como não
                        há desfazer, o primeiro toque arma e o segundo executa.
                        SÓ PARA QUEM ENTROU PELO HUB: a ação `excluir` é restrita ao hub de
                        propósito (tira a pessoa do evento inteiro). Para o freela logado pelo
                        /evento o botão nem aparece — senão ele tocaria e levaria "Sessão do
                        Prometeu ausente", sem entender o motivo. O no-show recuperável (que é o
                        que ele precisa no dia) continua disponível na tela do atendimento. */}
                    {abaDaFila === "retorno" && hubUser ? (
                      <button
                        className="fcall no-show"
                        onClick={() =>
                          exclusaoArmada === c.id
                            ? void excluirDoEvento(c)
                            : setExclusaoArmada(c.id)
                        }
                        title="Tira da operação em definitivo: sai da fila e do aguardando retorno"
                        type="button"
                      >
                        {exclusaoArmada === c.id ? "Confirmar?" : "No-show"}
                      </button>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          {/* AS DUAS AÇÕES DO DIA, no rodapé da fila: chamar o próximo e avisar que estou ocupado.
              "Chamar próximo" é o botão mais apertado do evento, por isso o tamanho. */}
          <div className="cta">
            <button
              className="chamar-prox"
              // Ocupado, mesa com gente ou fila vazia: não há próximo para chamar.
              disabled={ocupado || Boolean(cliente) || fila.length === 0}
              onClick={() => void chamarProximo()}
              type="button"
            >
              <svg fill="currentColor" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
              Chamar próximo
            </button>
            <button
              className={`btn-ocupado${ocupado ? " on" : ""}`}
              onClick={() => setOcupado((estava) => !estava)}
              type="button"
            >
              <svg
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M8 12h8" />
              </svg>
              Ocupado
            </button>
          </div>
        </div>

        <div className="side">
          {/* MINHA MESA: o número grande é o que o atendente fala em voz alta quando chama. */}
          <div className={`card minha-mesa-card ${minhaMesa.classe}`}>
            <div className="card-head">
              <h2>Minha mesa</h2>
              <span className="mm-badge">{minhaMesa.rotulo}</span>
            </div>
            <div className="mm-body">
              <div className="mm-num">{mesa.numero}</div>
              <div className="mm-info">
                <div className="mm-lb">Mesa da secretaria</div>
                <div className="mm-sub">{minhaMesa.sub}</div>
              </div>
            </div>
          </div>

          <div className="card" style={{ flex: 1 }}>
            <div className="card-head">
              <h2>Últimas chamadas</h2>
            </div>
            <div className="ult">
              {chamadas.length === 0 ? (
                <div className="fila-empty" style={{ padding: 24 }}>
                  Sem chamadas ainda.
                </div>
              ) : (
                chamadas.map((chamada) => {
                  const pessoa =
                    pessoaPorNome.get(chamada.nome.trim().toLocaleLowerCase("pt-BR")) ??
                    null;
                  const status = statusDaChamada(pessoa, emAtendimento);

                  return (
                    <div className="ucall" key={chamada.id}>
                      <div className="uav">{iniciais(chamada.nome)}</div>
                      <div className="uinfo">
                        <div
                          className={`unome${pessoa ? " link" : ""}`}
                          onClick={pessoa ? () => setFicha(pessoa) : undefined}
                          role="presentation"
                        >
                          {chamada.nome}
                        </div>
                        <div className="udest">
                          {destinoDaChamada(chamada.zona, chamada.mesa)}
                        </div>
                      </div>
                      <span className={`ust ${status.classe}`}>{status.rotulo}</span>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      {/* O card do atendimento: na aba, ou dentro da janela flutuante (que tem o próprio root
          React, senão os cliques na janela não chegam ao React da aba). */}
      {janelaPip ? (
        <PipHost janela={janelaPip}>{cardDoAtendimento}</PipHost>
      ) : (
        cardDoAtendimento
      )}

      {/* MODAL DIRECIONAR (mockup `#dir-modal`): sem destino escolhido o "Confirmar" fica
          desligado — no mockup era um alerta do navegador. */}
      <div className={`modal-ov${direcionando ? " open" : ""}`}>
        <div className="modal">
          <h3>Direcionar cliente</h3>
          <p>Devolve o cliente para uma etapa anterior. Informe o motivo.</p>
          {/* Sem `htmlFor`: o que vem abaixo são botões, não um campo. Apontar para o textarea
              faria clicar aqui pular o foco para o motivo. */}
          <label>Direcionar para</label>
          <div className="dir-opts">
            {DESTINOS_DO_DIRECIONAMENTO.map((destino) => (
              <button
                className={destinoEscolhido === destino.etapa ? "on" : ""}
                key={destino.etapa}
                onClick={() => setDestinoEscolhido(destino.etapa)}
                type="button"
              >
                {destino.rotulo}
              </button>
            ))}
          </div>
          <label htmlFor="motivo-do-direcionamento">Motivo do direcionamento</label>
          <textarea
            id="motivo-do-direcionamento"
            onChange={(campo) => setMotivoDoDirecionamento(campo.target.value)}
            placeholder="Ex.: corrigir a proposta comercial, revisar condição de pagamento..."
            value={motivoDoDirecionamento}
          />
          <div className="modal-acts">
            <button onClick={() => setDirecionando(false)} type="button">
              Cancelar
            </button>
            <button
              className="conf"
              disabled={!destinoEscolhido}
              onClick={() => void confirmarDirecionamento()}
              type="button"
            >
              Confirmar direcionamento
            </button>
          </div>
        </div>
      </div>

      {/* FICHA DO CLIENTE (mockup `#cli-modal`): dados, unidades e jornada no evento.
          O `id` NÃO é decorativo: duas regras do mockup penduram nele o padding do card
          (`#cli-modal .modal{padding:0}` e `#cli-modal .modal-acts`). Sem ele a ficha cai na
          regra genérica do modal e ganha 24px de moldura sobre o padding que cada seção já traz. */}
      <div className={`modal-ov${ficha ? " open" : ""}`} id="cli-modal">
        {ficha ? (
          <div className="modal cli-card">
            <div className="cli-head">
              <div className="cli-av">{iniciais(ficha.nome)}</div>
              <div className="cli-hi">
                <div className="cli-nome">{ficha.nome}</div>
                <div className="cli-sub">
                  {ficha.posicao ? `${ficha.posicao}º da fila · ` : ""}
                  {ficha.pagoEm ? "PIX pago" : "sem PIX"}
                </div>
              </div>
              <button
                className="wpp-btn big"
                onClick={() => void reenviarLinkDaFila(ficha)}
                title="Reenviar o link de acompanhamento da fila"
                type="button"
              >
                {ICONE_WPP} Link da fila
              </button>
            </div>
            <div className="cli-grid">
              <div>
                <div className="cli-lb">CPF</div>
                <div className="cli-vl">{ficha.documento ?? "—"}</div>
              </div>
              <div>
                <div className="cli-lb">Telefone</div>
                <div className="cli-vl">{ficha.telefone ?? "—"}</div>
              </div>
              <div>
                <div className="cli-lb">Imobiliária</div>
                <div className="cli-vl">{ficha.imobiliaria ?? "—"}</div>
              </div>
              <div>
                <div className="cli-lb">Corretor</div>
                <div className="cli-vl">{ficha.corretor ?? "—"}</div>
              </div>
            </div>
            <div className="cli-sec">Unidades ({ficha.unidades.length})</div>
            {/* `#cli-unids` carrega os 26px laterais que alinham os chips com as outras seções. */}
            <div className="u-wrap" id="cli-unids">
              {ficha.unidades.length === 0 ? (
                <span className="cli-vl">Nenhuma unidade reservada.</span>
              ) : (
                ficha.unidades.map((u) => (
                  <span className="u-chip" key={u.id}>
                    {u.codigo}
                  </span>
                ))
              )}
            </div>
            {/* A RESERVA É LANÇADA NO C2X, não aqui (decisão do Lucas, 01/08: "esses dados vem
                tudo do C2X, nada é feito no hub"). Chegou a existir um campo de quadra/lote nesta
                tela por algumas horas; saiu porque dois lugares para registrar a mesma reserva é
                convite para divergirem — e divergência de lote vira briga no contrato. */}
            <div className="cli-sec">Jornada no evento</div>
            {/* A MESMA jornada da Central (Check-in → Negociação → Reserva → Secretária → Proposta
                → Finalizado + no-shows), reconstituída no servidor e buscada ao abrir a ficha. */}
            <div className="clt">
              {passosDaFicha === null || passosDaFicha.length === 0 ? (
                <div className="clt-item cur last">
                  <div className="clt-dot" />
                  <div className="clt-tx">
                    <div className="clt-t">
                      {passosDaFicha === null
                        ? "Carregando a jornada..."
                        : "Ainda sem passos registrados."}
                    </div>
                  </div>
                </div>
              ) : (
                passosDaFicha.map((passo, i, todos) => {
                  const ultimo = i === todos.length - 1;
                  return (
                    <div
                      className={`clt-item${ultimo && !passo.cancelado ? " cur last" : ""}`}
                      key={`${passo.titulo}-${i}`}
                    >
                      <div className="clt-dot" />
                      <div className="clt-tx">
                        <div className="clt-t">{passo.titulo}</div>
                        {passo.detalhe ? <div className="clt-w">{passo.detalhe}</div> : null}
                        <div className="clt-w">
                          {passo.quando
                            ? new Date(passo.quando).toLocaleTimeString("pt-BR", {
                                hour: "2-digit",
                                minute: "2-digit",
                              })
                            : "—"}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            <div className="modal-acts">
              <button onClick={() => setFicha(null)} type="button">
                Fechar
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* A CHAMADA EM DESTAQUE (mockup `.chamada-ov`): overlay escurecido, nome gigante, o destino
          em pílula e os TRÊS botões — Rechamar · Não veio · Compareceu. */}
      <div className={`chamada-ov${meuChamado ? " open" : ""}`}>
        {meuChamado ? (
          <div className="chamada-card">
            <div className="cring">
              <span className="pulse" />
              Chamando
            </div>
            <div className="cnome">{meuChamado.pessoa.nome}</div>
            <div className="cimob">
              {meuChamado.pessoa.imobiliaria ?? "Sem imobiliária"}
              {meuChamado.pessoa.corretor ? ` · ${meuChamado.pessoa.corretor}` : ""}
            </div>
            <div className="cdest">📍 Secretaria · Mesa {mesa.numero}</div>
            <div className="ctimer">
              chamado há {esperaDesde(meuChamado.chamadoEm, agora) || "agora"}
            </div>
            <div className="cacts">
              <button
                className="cb-rechamar"
                onClick={() => void rechamar()}
                type="button"
              >
                🔁 {rechamado ? "Chamado!" : "Rechamar"}
              </button>
              <button className="cb-ausencia" onClick={() => void naoVeio()} type="button">
                ✕ Não veio
              </button>
              <button
                className="cb-compareceu"
                onClick={() => void confirmarChegada()}
                type="button"
              >
                ✓ Compareceu
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* A PA ABRE DENTRO DA TELA (correção do Lucas): abrir em outra aba tira o atendente do
          atendimento e, num notebook no meio do evento, faz ele se perder entre janelas. */}
      {paAberta ? (
        <div className="pa-view" onClick={() => setPaAberta(null)} role="presentation">
          <div className="pv-top">
            <span>PA · {paAberta.nome}</span>
            <button className="hbtn" onClick={() => setPaAberta(null)} type="button">
              ✕
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do Storage */}
          <img
            alt={`PA de ${paAberta.nome}`}
            onClick={(evento) => evento.stopPropagation()}
            src={paAberta.url}
          />
        </div>
      ) : null}

      <div className={`${toast ? "show" : ""}`} id="toast">
        {toast}
      </div>
    </div>
  );
}
