"use client";

import {
  ArrowLeft,
  Building2,
  Camera,
  Check,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  QrCode,
  User,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";
import {
  origemDoClienteParaExibir,
  sufixoDeProponentes,
} from "@/lib/prometeu/identificacao-do-cliente";
import { rotuloDoLancamento } from "@/lib/prometeu/lancamento";
import { conteudoDoQrDoCupom } from "@/lib/prometeu/cupom";
import type { PrometeuEvento } from "@/lib/prometeu/types";

import {
  buscarClienteDaReserva,
  criarReservaTouchRemoto,
  fetchEventos,
  fetchReservaTouch,
  type ReservaTouchContadores,
  type ReservaTouchQuadra,
  type ReservaTouchUnidade,
} from "../../data/prometeu-operations";
import { useLancamentoSelecionado } from "../../lancamento-contexto";
import { usarLeitorQr } from "../checkin/usar-leitor-qr";
import { usarLeitorWedge } from "../usar-leitor-wedge";
import { imprimirCupomDaReserva } from "./imprimir-cupom";

// A POSIÇÃO DE RESERVA — monitor touch do lançamento (Lucas, 24/08/2026).
//
// Quiosque de fluxo contínuo: bipa a etiqueta → QUADRAS (só números + quantos livres) →
// LOTES disponíveis (multi-seleção, selecionado em grafite invertido) → Finalizar → cupom
// sai na térmica → a tela VOLTA SOZINHA para o início, limpa, pronta para o próximo bip.
//
// Decisões do Lucas nesta tela: mínimo de escrita (sem "Q"/"L", números grandes, ícones);
// só lote DISPONÍVEL aparece; seleção acumula entre quadras; mini dash Reservas · Propostas
// (lançadas na secretária) · Finalizadas no topo. Dois temas (tokens do hub).

type Cliente = {
  corretor: null | string;
  documento: null | string;
  etapa: string;
  id: string;
  imobiliaria: null | string;
  nome: string;
};

// Até 5 proponentes (limite do C2X); o 1º é o titular. Com mais de um, a % de participação é
// obrigatória e soma 100 — a tela redistribui igual ao adicionar e o operador ajusta em ±5.
type Proponente = {
  credenciadoId: string;
  documento: null | string;
  nome: string;
  percentual: number;
};

const MAX_PROPONENTES = 5;

// 3 proponentes → 33.34 / 33.33 / 33.33: o primeiro carrega o resto para fechar 100.
function dividirIgual(quantidade: number): number[] {
  const base = Math.floor(10000 / quantidade) / 100;
  const primeiro = Math.round((100 - base * (quantidade - 1)) * 100) / 100;
  return [primeiro, ...Array.from({ length: quantidade - 1 }, () => base)];
}

// ⚠️ O LEITOR USB agora vem do hook COMPARTILHADO (../usar-leitor-wedge). A cópia local que
// existia aqui não cancelava a ação padrão do Enter — e era essa a causa da tela cheia cair no
// bip (28/08/2026): o Enter do leitor re-clicava o botão de tela cheia, que estava focado desde
// o clique do operador, e o `alternarTelaCheia` chamava exitFullscreen(). Ver o cabeçalho de
// lib/prometeu/leitura-wedge.ts.

const CARTAO =
  "rounded-xl border border-line bg-surface transition-colors";
// O selecionado é GRAFITE INVERTIDO — padrão visual do Panteon; funciona nos dois temas por
// ser par fixo de alto contraste (fundo #2C2C2A + texto #F1EFE8).
const LOTE_LIVRE =
  "rounded-xl border border-line bg-surface text-ink hover:border-ink/40";
const LOTE_MARCADO = "rounded-xl border border-[#2C2C2A] bg-[#2C2C2A] text-[#F1EFE8]";

export function ReservaView() {
  // ⚠️ O LANÇAMENTO SELECIONADO NA TELA INICIAL MANDA (bug de 24/08: com o Vale do Ouro
  // selecionado, a tela mostrava os lotes do Villa Paris — o eventoDoDia ignora a escolha).
  const selecionado = useLancamentoSelecionado();
  const [evento, setEvento] = useState<null | PrometeuEvento>(null);
  const [quadras, setQuadras] = useState<ReservaTouchQuadra[]>([]);
  const [contadores, setContadores] = useState<null | ReservaTouchContadores>(null);
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);

  const [cliente, setCliente] = useState<null | Cliente>(null);
  const [proponentes, setProponentes] = useState<Proponente[]>([]);
  // true = o próximo bip ADICIONA um proponente em vez de começar reserva nova.
  const [bipandoProponente, setBipandoProponente] = useState(false);
  const [quadraAtiva, setQuadraAtiva] = useState<null | string>(null);
  const [marcadas, setMarcadas] = useState<Map<string, ReservaTouchUnidade>>(new Map());
  const [confirmando, setConfirmando] = useState(false);
  const [sucesso, setSucesso] = useState<null | { cliente: string; lotes: string[] }>(null);
  const [cameraAberta, setCameraAberta] = useState(false);
  const [bipando, setBipando] = useState(false);

  // TELA CHEIA do quiosque (Lucas, 24/08: monitor EM PÉ, "como aqueles tótens de pedidos").
  // Fullscreen no PRÓPRIO bloco da Reserva: rail, abas e barra do sistema somem; com o estado
  // ligado a tela inteira sobe de escala para leitura à distância. Esc também sai — por isso
  // o estado vem do evento fullscreenchange, não do clique.
  const raizRef = useRef<HTMLDivElement>(null);
  const botaoTelaCheiaRef = useRef<HTMLButtonElement>(null);
  const [telaCheia, setTelaCheia] = useState(false);
  // O que o OPERADOR pediu (não o que o navegador está fazendo). É a rede do quiosque: se a
  // tela cheia cair sem ele mandar, voltamos sozinhos no próximo bip — que é um gesto do
  // usuário e, portanto, autoriza requestFullscreen().
  const querTelaCheia = useRef(false);

  useEffect(() => {
    const aoMudar = () => setTelaCheia(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", aoMudar);
    return () => document.removeEventListener("fullscreenchange", aoMudar);
  }, []);

  // Esc e F11 são os jeitos de sair pelo teclado: se o operador apertou, ele QUER sair — a rede
  // desliga. Sem o F11 aqui o desejo continuava ligado e a tela voltava sozinha ao fullscreen no
  // toque seguinte, brigando com quem só queria dar uma olhada no Windows.
  useEffect(() => {
    const aoTeclar = (ev: KeyboardEvent) => {
      if (ev.key === "Escape" || ev.key === "F11") querTelaCheia.current = false;
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const entrarNaTelaCheia = useCallback(() => {
    if (document.fullscreenElement) return;
    void raizRef.current?.requestFullscreen().catch(() => undefined);
  }, []);

  const alternarTelaCheia = () => {
    if (document.fullscreenElement) {
      querTelaCheia.current = false;
      void document.exitFullscreen().catch(() => undefined);
      return;
    }
    querTelaCheia.current = true;
    entrarNaTelaCheia();
    // O botão continua FOCADO depois do clique. Com o foco nele, qualquer Enter que escape
    // (leitor mal configurado, sufixo extra) voltaria a clicá-lo e sairia da tela cheia.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const carregar = useCallback(async (eventoId?: string) => {
    const r = await fetchReservaTouch(eventoId);
    if (r.error) {
      setErro(r.error);
    } else if (r.data) {
      setErro(null);
      setQuadras(r.data.quadras);
      setContadores(r.data.contadores);
    }
    setCarregando(false);
  }, []);

  // O lançamento SELECIONADO manda; sem seleção (posto do operador via /m), cai no evento do
  // dia. Primeira carga + poll leve de 15s SEMPRE com o id explícito — sem ele a rota resolve
  // o "operável" e trai a seleção.
  useEffect(() => {
    let vivo = true;
    void (async () => {
      let alvo = selecionado;
      if (!alvo) {
        const eventos = await fetchEventos();
        if (!vivo) return;
        alvo = eventoDoDia(eventos.data ?? []) ?? null;
      }
      if (!vivo) return;
      setEvento(alvo);
      await carregar(alvo?.id);
    })();
    const timer = window.setInterval(() => {
      void carregar(selecionado?.id ?? undefined);
    }, 15_000);
    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
  }, [carregar, selecionado]);

  const aoBipar = useCallback(
    async (lido: string) => {
      const id = lido.trim();
      if (!id || bipando) return;
      setBipando(true);
      setErro(null);
      const r = await buscarClienteDaReserva(id, evento?.id);
      if (r.error || !r.data) {
        setErro(r.error ?? "Etiqueta não reconhecida.");
      } else if (bipandoProponente && cliente) {
        // Bip de MAIS um proponente: entra na lista e a participação redistribui igual.
        const novo = r.data.credenciado;
        setProponentes((atual) => {
          if (atual.some((p) => p.credenciadoId === novo.id)) {
            setErro("Esse proponente já está na reserva.");
            return atual;
          }
          if (atual.length >= MAX_PROPONENTES) return atual;
          const lista = [
            ...atual,
            { credenciadoId: novo.id, documento: novo.documento, nome: novo.nome, percentual: 0 },
          ];
          const divisao = dividirIgual(lista.length);
          return lista.map((p, i) => ({ ...p, percentual: divisao[i] ?? 0 }));
        });
        setBipandoProponente(false);
        setCameraAberta(false);
      } else {
        const c = r.data.credenciado;
        setCliente(c);
        setProponentes([
          { credenciadoId: c.id, documento: c.documento, nome: c.nome, percentual: 100 },
        ]);
        setBipandoProponente(false);
        setCameraAberta(false);
        setQuadraAtiva(null);
        setMarcadas(new Map());
      }
      setBipando(false);
    },
    [bipando, bipandoProponente, cliente, evento?.id],
  );

  // A REDE DO QUIOSQUE, e só ela: recuperar a tela cheia exige ATIVAÇÃO TRANSITÓRIA (gesto do
  // usuário), então mora nos dois lugares que são gesto de verdade — o keydown do leitor USB e o
  // toque na tela. Fora daí o `requestFullscreen()` é recusado pelo Chrome em silêncio; foi por
  // isso que a tentativa antiga, dentro de `aoBipar`, não valia nada quando o bip vinha da CÂMERA
  // (o callback dispara de dentro do loop de decodificação, sem gesto nenhum).
  const recuperarTelaCheia = useCallback(() => {
    if (!querTelaCheia.current) return;
    entrarNaTelaCheia();
  }, [entrarNaTelaCheia]);

  // Ajuste de ±5% num proponente extra; o TITULAR absorve a diferença (100 − soma dos demais).
  const ajustarPercentual = (credenciadoId: string, delta: number) => {
    setProponentes((atual) => {
      const ajustada = atual.map((p) =>
        p.credenciadoId === credenciadoId
          ? { ...p, percentual: Math.round((p.percentual + delta) * 100) / 100 }
          : p,
      );
      const extras = ajustada.slice(1);
      if (extras.some((p) => p.percentual < 5)) return atual;
      const somaExtras = extras.reduce((s, p) => s + p.percentual, 0);
      const titular = Math.round((100 - somaExtras) * 100) / 100;
      if (titular < 5) return atual;
      return [{ ...ajustada[0]!, percentual: titular }, ...extras];
    });
  };

  const removerProponente = (credenciadoId: string) => {
    setProponentes((atual) => {
      const lista = atual.filter((p) => p.credenciadoId !== credenciadoId);
      const divisao = dividirIgual(Math.max(lista.length, 1));
      return lista.map((p, i) => ({ ...p, percentual: divisao[i] ?? 0 }));
    });
  };

  // Os dois leitores: USB (sempre que a tela está em pé) e câmera (botão).
  usarLeitorWedge((v) => {
    recuperarTelaCheia();
    void aoBipar(v);
  }, !sucesso && !confirmando);
  const leitorCamera = usarLeitorQr({
    aoLer: (v) => void aoBipar(v),
    ativo: cameraAberta && (!cliente || bipandoProponente),
  });

  const quadra = useMemo(
    () => quadras.find((q) => q.quadra === quadraAtiva) ?? null,
    [quadras, quadraAtiva],
  );

  const alternarLote = (unidade: ReservaTouchUnidade) => {
    // A tela é a VITRINE das quadras o tempo todo (Lucas, 24/08: "precisamos ver o cliente
    // quando bipado"); navegar é livre, mas MARCAR lote exige um cliente bipado.
    if (!cliente) {
      setErro("Bipe a etiqueta do cliente para reservar.");
      window.setTimeout(() => setErro(null), 3_000);
      return;
    }
    setMarcadas((atual) => {
      const novo = new Map(atual);
      if (novo.has(unidade.codigo)) novo.delete(unidade.codigo);
      else novo.set(unidade.codigo, unidade);
      return novo;
    });
  };

  const resetar = useCallback(() => {
    setCliente(null);
    setProponentes([]);
    setBipandoProponente(false);
    setQuadraAtiva(null);
    setMarcadas(new Map());
    setSucesso(null);
    setErro(null);
  }, []);

  const finalizar = async () => {
    if (!cliente || !evento || marcadas.size === 0 || confirmando) return;
    setConfirmando(true);
    setErro(null);

    const unidades = [...marcadas.values()];
    const r = await criarReservaTouchRemoto({
      credenciadoId: cliente.id,
      eventoId: evento.id,
      proponentes,
      unidades,
    });

    if (r.error || !r.data) {
      setErro(r.error ?? "Não consegui reservar.");
      setConfirmando(false);
      // Lotes que conflitaram saem da seleção e da prateleira na hora.
      void carregar(evento.id);
      return;
    }

    const qrDataUrl = await QRCode.toDataURL(conteudoDoQrDoCupom(r.data.grupoId), {
      margin: 1,
      width: 340,
    });
    await imprimirCupomDaReserva({
      cliente: cliente.nome,
      codigoEvento: evento.enterpriseCode ?? "",
      outrosProponentes: proponentes
        .slice(1)
        .map((p) => ({ nome: p.nome, percentual: p.percentual })),
      dataHora: new Date().toLocaleString("pt-BR", {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      evento: rotuloDoLancamento(evento),
      grupoId: r.data.grupoId,
      qrDataUrl,
      unidades: unidades.map((u) => ({ lote: u.lote, quadra: u.quadra })),
    });

    setSucesso({ cliente: cliente.nome, lotes: unidades.map((u) => u.codigo) });
    setConfirmando(false);
    void carregar(evento.id);
    // Fluxo contínuo: mostra o "feito" por 4s e volta sozinho para o início.
    window.setTimeout(resetar, 4_000);
  };

  const totalDisponiveis = useMemo(
    () => quadras.reduce((soma, q) => soma + q.disponiveis.length, 0),
    [quadras],
  );

  // DE ONDE VEIO O CLIENTE (Lucas, 28/08: "queria trazer a imobiliária"). O payload do bip já
  // traz imobiliaria/corretor; a regra de montar a linha — e de NÃO desenhar nada quando não há
  // nenhum dos dois — mora em lib/prometeu/identificacao-do-cliente.ts.
  const origemDoCliente = useMemo(
    () => (cliente ? origemDoClienteParaExibir(cliente) : null),
    [cliente],
  );
  const sufixoProponentes = sufixoDeProponentes(proponentes.length);
  // Alvos de toque dos chips de proponente (Lucas: "é tela de toque — alvos grandes").
  const alvoDoChip = telaCheia ? "h-11 w-11" : "h-9 w-9";
  const iconeDoChip = telaCheia ? 18 : 14;

  return (
    // ⚠️ RETRATO PRIMEIRO (monitor em pé, 1080×1920): a PÁGINA nunca rola — `overflow-hidden`
    // aqui e `min-h-0` na coluna garantem que só a prateleira de lotes role por dentro. Header
    // e rodapé do cliente são `shrink-0`: ficam SEMPRE visíveis, aconteça o que acontecer.
    <div
      ref={raizRef}
      className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas p-4 sm:p-6"
      onPointerDown={(ev) => {
        // O operador toca a tela o tempo todo: se a tela cheia caiu sem ele pedir, o próximo
        // toque já devolve — sem esperar o próximo cliente chegar. O botão de tela cheia fica
        // FORA da rede, senão o toque nele restauraria e o clique logo em seguida sairia.
        if (botaoTelaCheiaRef.current?.contains(ev.target as Node)) return;
        recuperarTelaCheia();
      }}
    >
      <header className="mb-3 flex shrink-0 flex-col gap-2 landscape:flex-row landscape:items-center landscape:gap-3">
        <div className="min-w-0">
          <h1
            className={`truncate font-semibold text-ink ${telaCheia ? "text-xl portrait:text-2xl" : "text-lg"}`}
          >
            {evento ? rotuloDoLancamento(evento) : "Reserva"}
          </h1>
          <p className={`text-ink-muted ${telaCheia ? "text-sm" : "text-xs"}`}>
            {totalDisponiveis} lotes disponíveis
          </p>
        </div>
        {/* O mini dash do evento: Reservas · Propostas (secretária) · Finalizadas.
            Em retrato ele ocupa a linha inteira (os três cartões dividem a largura); em
            paisagem volta para a direita do título, como sempre foi. */}
        <div className="flex items-center gap-2 landscape:ml-auto">
          {(
            [
              ["Reservas", contadores?.reservas],
              ["Propostas", contadores?.propostas],
              ["Finalizadas", contadores?.finalizadas],
            ] as const
          ).map(([rotulo, valor]) => (
            <div
              key={rotulo}
              className={`${CARTAO} flex-1 text-center landscape:flex-none ${telaCheia ? "min-w-[92px] px-4 py-2" : "min-w-[86px] px-4 py-2"}`}
            >
              <div
                className={`font-bold tabular-nums text-ink ${telaCheia ? "text-3xl" : "text-2xl"}`}
              >
                {valor ?? "—"}
              </div>
              <div className={`text-ink-muted ${telaCheia ? "text-xs" : "text-[11px]"}`}>
                {rotulo}
              </div>
            </div>
          ))}
          <button
            ref={botaoTelaCheiaRef}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-line text-ink-soft transition hover:text-ink"
            onClick={alternarTelaCheia}
            title={telaCheia ? "Sair da tela cheia" : "Tela cheia"}
            type="button"
          >
            {telaCheia ? (
              <Minimize2 aria-hidden="true" size={22} />
            ) : (
              <Maximize2 aria-hidden="true" size={22} />
            )}
          </button>
        </div>
      </header>

      {erro ? (
        <p className="mb-3 shrink-0 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      {sucesso ? (
        <div className="grid min-h-0 flex-1 place-items-center overflow-hidden">
          <div className="max-w-full px-4 text-center">
            <span
              className={`mx-auto grid place-items-center rounded-full bg-[#2C2C2A] text-[#F1EFE8] ${telaCheia ? "h-32 w-32" : "h-20 w-20"}`}
            >
              <Check aria-hidden="true" size={telaCheia ? 64 : 40} />
            </span>
            <p
              className={`mt-4 break-words font-bold uppercase text-ink ${telaCheia ? "text-4xl" : "text-2xl"}`}
            >
              {sucesso.cliente}
            </p>
            <p className={`mt-1 break-words text-ink-soft ${telaCheia ? "text-2xl" : "text-lg"}`}>
              {sucesso.lotes.join(" · ")}
            </p>
            <p className={`mt-3 text-ink-muted ${telaCheia ? "text-xl" : "text-sm"}`}>
              Cupom impresso — leve à impressão da PA.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {carregando ? (
            <div className="grid flex-1 place-items-center text-ink-muted">
              <Loader2 aria-hidden="true" className="animate-spin" size={32} />
            </div>
          ) : quadraAtiva === null ? (
            // A ÚNICA coisa que rola na tela: a prateleira. `min-h-0` é o que impede o flex de
            // empurrar o rodapé do cliente para fora em retrato.
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className="mb-2 flex items-center gap-2 text-sm text-ink-muted">
                <MapPin aria-hidden="true" size={16} />
                Quadra
              </div>
              <div
                className={`grid gap-3 ${telaCheia ? "grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-4" : "grid-cols-[repeat(auto-fill,minmax(110px,1fr))]"}`}
              >
                {quadras.map((q) => (
                  <button
                    key={q.quadra}
                    className={`${CARTAO} px-2 text-center hover:border-ink/40 ${telaCheia ? "py-9" : "py-5"}`}
                    onClick={() => setQuadraAtiva(q.quadra)}
                    type="button"
                  >
                    <div className={`font-bold text-ink ${telaCheia ? "text-5xl" : "text-3xl"}`}>
                      {q.quadra}
                    </div>
                    <div
                      className={`mt-1 font-semibold text-ink-muted ${telaCheia ? "text-lg" : "text-sm"}`}
                    >
                      {q.disponiveis.length}
                    </div>
                  </button>
                ))}
                {quadras.length === 0 ? (
                  <p className="col-span-full text-sm text-ink-muted">
                    Nenhum lote disponível neste momento.
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className="mb-2 flex items-center gap-2 text-sm text-ink-muted">
                <MapPin aria-hidden="true" size={16} />
                <span className="font-semibold text-ink">{quadraAtiva}</span>·
                {quadra?.disponiveis.length ?? 0} disponíveis
              </div>
              <div
                className={`grid gap-3 ${telaCheia ? "grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4" : "grid-cols-[repeat(auto-fill,minmax(96px,1fr))]"}`}
              >
                {(quadra?.disponiveis ?? []).map((u) => {
                  const marcado = marcadas.has(u.codigo);
                  return (
                    <button
                      key={u.codigo}
                      className={`${marcado ? LOTE_MARCADO : LOTE_LIVRE} px-2 text-center ${telaCheia ? "py-8" : "py-5"}`}
                      onClick={() => alternarLote(u)}
                      type="button"
                    >
                      <span className={`font-bold ${telaCheia ? "text-4xl" : "text-2xl"}`}>
                        {u.lote}
                      </span>
                      {marcado ? (
                        <Check
                          aria-hidden="true"
                          className="mx-auto mt-1"
                          size={telaCheia ? 26 : 18}
                        />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Proponentes (até 5): chips com % — o titular absorve os ajustes dos demais. */}
          {bipandoProponente ? (
            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 py-3">
              {bipando ? (
                <Loader2 aria-hidden="true" className="animate-spin text-ink-muted" size={18} />
              ) : (
                <QrCode aria-hidden="true" className="text-ink-muted" size={18} />
              )}
              <span className="text-sm font-semibold text-ink">
                Bipe a etiqueta do próximo proponente
              </span>
              {cameraAberta ? (
                <div className="w-40 overflow-hidden rounded-lg border border-line">
                  <video ref={leitorCamera.videoRef} className="block w-full" muted playsInline />
                  <canvas ref={leitorCamera.canvasRef} className="hidden" />
                </div>
              ) : null}
              <div className="ml-auto flex gap-2">
                <button
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-soft"
                  onClick={() => setCameraAberta((v) => !v)}
                  title="Usar a câmera"
                  type="button"
                >
                  <Camera aria-hidden="true" size={16} />
                </button>
                <button
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-soft"
                  onClick={() => {
                    setBipandoProponente(false);
                    setCameraAberta(false);
                  }}
                  title="Cancelar"
                  type="button"
                >
                  <X aria-hidden="true" size={16} />
                </button>
              </div>
            </div>
          ) : null}
          {/* ⚠️ SEM ALTURA MÁXIMA AQUI. Uma versão anterior pôs `max-h-24` + `overflow-y-auto`
              nesta faixa: com 4 ou 5 proponentes em retrato a terceira linha de chips sumia atrás
              de um scroll interno sem indicação nenhuma, num monitor de toque. A faixa é
              `shrink-0` e o rodapé nunca dependeu dela — quem cede espaço é a prateleira de
              lotes, que rola e sinaliza que rola. */}
          {proponentes.length > 1 ? (
            <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
              {proponentes.map((p, indice) => (
                <span
                  key={p.credenciadoId}
                  className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface font-semibold text-ink ${telaCheia ? "py-1.5 pl-4 pr-2 text-base" : "py-1 pl-3 pr-1.5 text-xs"}`}
                >
                  {p.nome.split(/\s+/)[0]}
                  <b className="tabular-nums">{p.percentual}%</b>
                  {/* Tela de TOQUE: os 24px de antes exigiam precisão de mouse justamente no
                      único ajuste fino da tela, com cliente na frente. Agora são alvos de 36px
                      (44px em tela cheia), como o resto do quiosque. */}
                  {indice > 0 ? (
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        className={`grid place-items-center rounded-full text-ink-muted transition hover:bg-black/5 hover:text-ink dark:hover:bg-white/10 ${alvoDoChip}`}
                        onClick={() => ajustarPercentual(p.credenciadoId, -5)}
                        title="-5%"
                        type="button"
                      >
                        <Minus aria-hidden="true" size={iconeDoChip} />
                      </button>
                      <button
                        className={`grid place-items-center rounded-full text-ink-muted transition hover:bg-black/5 hover:text-ink dark:hover:bg-white/10 ${alvoDoChip}`}
                        onClick={() => ajustarPercentual(p.credenciadoId, 5)}
                        title="+5%"
                        type="button"
                      >
                        <Plus aria-hidden="true" size={iconeDoChip} />
                      </button>
                      <button
                        className={`grid place-items-center rounded-full text-ink-muted transition hover:bg-black/5 hover:text-ink dark:hover:bg-white/10 ${alvoDoChip}`}
                        onClick={() => removerProponente(p.credenciadoId)}
                        title="Remover"
                        type="button"
                      >
                        <X aria-hidden="true" size={iconeDoChip} />
                      </button>
                    </span>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}

          {/* Rodapé fixo: sem cliente é o convite ao bip (leitor sempre ligado); com cliente,
              a conferência (nome + lotes) e as ações. */}
          {!cliente ? (
            <footer
              className={`mt-3 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 ${telaCheia ? "py-4" : "py-3"}`}
            >
              {bipando ? (
                <Loader2
                  aria-hidden="true"
                  className="animate-spin text-ink-muted"
                  size={telaCheia ? 28 : 20}
                />
              ) : (
                <QrCode aria-hidden="true" className="text-ink-muted" size={telaCheia ? 28 : 20} />
              )}
              <p className={`font-semibold text-ink ${telaCheia ? "text-xl" : "text-sm"}`}>
                Bipe a etiqueta do cliente para começar a reserva
              </p>
              {cameraAberta ? (
                <div className="w-44 overflow-hidden rounded-lg border border-line">
                  <video ref={leitorCamera.videoRef} className="block w-full" muted playsInline />
                  <canvas ref={leitorCamera.canvasRef} className="hidden" />
                </div>
              ) : null}
              <button
                className="ml-auto inline-flex items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft transition hover:text-ink"
                onClick={() => setCameraAberta((v) => !v)}
                type="button"
              >
                {cameraAberta ? <X aria-hidden="true" size={16} /> : <Camera aria-hidden="true" size={16} />}
                {cameraAberta ? "Fechar câmera" : "Usar a câmera"}
              </button>
            </footer>
          ) : (
          // O CLIENTE EM DESTAQUE (Lucas, 28/08): nome grande, legível a um metro, com a
          // imobiliária logo abaixo. Em retrato o cartão vira duas faixas — identidade em cima,
          // ações em baixo, com o Finalizar esticado (alvo grande de toque).
          <footer
            className={`mt-3 flex shrink-0 flex-col gap-3 rounded-2xl border border-line bg-surface px-4 landscape:flex-row landscape:items-center landscape:gap-4 ${telaCheia ? "py-4" : "py-3"}`}
          >
            <div className="flex min-w-0 items-center gap-3 landscape:flex-1">
              <span
                className={`grid shrink-0 place-items-center rounded-xl bg-[#2C2C2A] text-[#F1EFE8] ${telaCheia ? "h-14 w-14" : "h-11 w-11"}`}
              >
                <User aria-hidden="true" size={telaCheia ? 30 : 22} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-baseline gap-2">
                  <span
                    className={`min-w-0 truncate font-black uppercase leading-tight tracking-tight text-ink ${telaCheia ? "text-3xl portrait:text-4xl" : "text-xl"}`}
                  >
                    {cliente.nome}
                  </span>
                  {sufixoProponentes ? (
                    <span
                      className={`shrink-0 rounded-full bg-[#2C2C2A] px-2 py-0.5 font-bold text-[#F1EFE8] ${telaCheia ? "text-base" : "text-xs"}`}
                      title={`${proponentes.length} proponentes`}
                    >
                      {sufixoProponentes}
                    </span>
                  ) : null}
                </div>
                {/* Sem imobiliária E sem corretor a linha simplesmente não existe — nada de
                    rótulo órfão nem buraco no cartão. */}
                {origemDoCliente ? (
                  <p
                    className={`mt-0.5 flex min-w-0 items-center gap-1.5 font-semibold text-ink-soft ${telaCheia ? "text-lg" : "text-sm"}`}
                  >
                    {origemDoCliente.tipo === "imobiliaria" ? (
                      <Building2 aria-hidden="true" className="shrink-0" size={telaCheia ? 20 : 15} />
                    ) : (
                      <UserRound aria-hidden="true" className="shrink-0" size={telaCheia ? 20 : 15} />
                    )}
                    <span className="truncate">{origemDoCliente.texto}</span>
                  </p>
                ) : null}
                <p
                  className={`mt-0.5 truncate ${marcadas.size > 0 ? "font-semibold text-ink" : "text-ink-muted"} ${telaCheia ? "text-base" : "text-xs"}`}
                >
                  {marcadas.size > 0 ? [...marcadas.keys()].join(" · ") : "Nenhum lote marcado"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 landscape:ml-auto landscape:shrink-0">
              <button
                className={`grid shrink-0 place-items-center rounded-xl border border-line text-ink transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10 ${telaCheia ? "h-16 w-16" : "h-12 w-12"}`}
                disabled={proponentes.length >= MAX_PROPONENTES || bipandoProponente}
                onClick={() => setBipandoProponente(true)}
                title="Adicionar proponente"
                type="button"
              >
                <UserPlus aria-hidden="true" size={telaCheia ? 28 : 20} />
              </button>
              <button
                className={`grid shrink-0 place-items-center rounded-xl border border-line text-ink transition hover:bg-black/5 dark:hover:bg-white/10 ${telaCheia ? "h-16 w-16" : "h-12 w-12"}`}
                onClick={() => (quadraAtiva === null ? resetar() : setQuadraAtiva(null))}
                title={quadraAtiva === null ? "Cancelar" : "Outra quadra"}
                type="button"
              >
                {quadraAtiva === null ? (
                  <X aria-hidden="true" size={telaCheia ? 28 : 20} />
                ) : (
                  <ArrowLeft aria-hidden="true" size={telaCheia ? 28 : 20} />
                )}
              </button>
              <button
                className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2C2C2A] font-bold text-[#F1EFE8] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 landscape:flex-none ${telaCheia ? "h-16 px-9 text-2xl" : "h-12 px-6 text-base"}`}
                disabled={marcadas.size === 0 || confirmando}
                onClick={() => void finalizar()}
                type="button"
              >
                {confirmando ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={telaCheia ? 28 : 20} />
                ) : (
                  <Check aria-hidden="true" size={telaCheia ? 28 : 20} />
                )}
                Finalizar
              </button>
            </div>
          </footer>
          )}
        </div>
      )}
    </div>
  );
}
