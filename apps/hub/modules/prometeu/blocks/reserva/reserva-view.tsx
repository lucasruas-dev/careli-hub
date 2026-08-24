"use client";

import {
  ArrowLeft,
  Camera,
  Check,
  Loader2,
  MapPin,
  Minus,
  Plus,
  QrCode,
  User,
  UserPlus,
  X,
} from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { eventoDoDia } from "@/lib/prometeu/evento-do-dia";
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
import { usarLeitorQr } from "../checkin/usar-leitor-qr";
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

// Leitor USB (wedge de teclado): chars em rajada + Enter. Janela de 300ms entre teclas —
// digitação humana não dispara, o leitor sim.
function usarLeitorWedge(aoLer: (valor: string) => void, ativo: boolean) {
  const bufferRef = useRef("");
  const ultimoRef = useRef(0);
  const aoLerRef = useRef(aoLer);

  useEffect(() => {
    aoLerRef.current = aoLer;
  }, [aoLer]);

  useEffect(() => {
    if (!ativo) return;
    const aoTeclar = (ev: KeyboardEvent) => {
      const agora = Date.now();
      if (agora - ultimoRef.current > 300) bufferRef.current = "";
      ultimoRef.current = agora;

      if (ev.key === "Enter") {
        const lido = bufferRef.current.trim();
        bufferRef.current = "";
        if (lido.length >= 6) aoLerRef.current(lido);
        return;
      }
      if (ev.key.length === 1) bufferRef.current += ev.key;
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [ativo]);
}

const CARTAO =
  "rounded-xl border border-line bg-surface transition-colors";
// O selecionado é GRAFITE INVERTIDO — padrão visual do Panteon; funciona nos dois temas por
// ser par fixo de alto contraste (fundo #2C2C2A + texto #F1EFE8).
const LOTE_LIVRE =
  "rounded-xl border border-line bg-surface text-ink hover:border-ink/40";
const LOTE_MARCADO = "rounded-xl border border-[#2C2C2A] bg-[#2C2C2A] text-[#F1EFE8]";

export function ReservaView() {
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

  // Evento do dia + primeira carga; depois poll leve de 15s (o telão e a trava do servidor
  // são a verdade — o poll só mantém a prateleira honesta entre um cliente e outro).
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const eventos = await fetchEventos();
      if (!vivo) return;
      const doDia = eventoDoDia(eventos.data ?? []);
      setEvento(doDia ?? null);
      await carregar(doDia?.id);
    })();
    const timer = window.setInterval(() => void carregar(), 15_000);
    return () => {
      vivo = false;
      window.clearInterval(timer);
    };
  }, [carregar]);

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
  usarLeitorWedge((v) => void aoBipar(v), !sucesso && !confirmando);
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

  return (
    <div className="flex h-full min-h-0 flex-col bg-canvas p-4 sm:p-6">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink">
            {evento ? rotuloDoLancamento(evento) : "Reserva"}
          </h1>
          <p className="text-xs text-ink-muted">{totalDisponiveis} lotes disponíveis</p>
        </div>
        {/* O mini dash do evento: Reservas · Propostas (secretária) · Finalizadas. */}
        <div className="ml-auto flex gap-2">
          {(
            [
              ["Reservas", contadores?.reservas],
              ["Propostas", contadores?.propostas],
              ["Finalizadas", contadores?.finalizadas],
            ] as const
          ).map(([rotulo, valor]) => (
            <div key={rotulo} className={`${CARTAO} min-w-[92px] px-4 py-2 text-center`}>
              <div className="text-2xl font-bold tabular-nums text-ink">{valor ?? "—"}</div>
              <div className="text-[11px] text-ink-muted">{rotulo}</div>
            </div>
          ))}
        </div>
      </header>

      {erro ? (
        <p className="mb-3 rounded-lg border border-red-300/60 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-300">
          {erro}
        </p>
      ) : null}

      {sucesso ? (
        <div className="grid flex-1 place-items-center">
          <div className="text-center">
            <span className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-[#2C2C2A] text-[#F1EFE8]">
              <Check aria-hidden="true" size={40} />
            </span>
            <p className="mt-4 text-2xl font-bold text-ink">{sucesso.cliente}</p>
            <p className="mt-1 text-lg text-ink-soft">{sucesso.lotes.join(" · ")}</p>
            <p className="mt-3 text-sm text-ink-muted">Cupom impresso — leve à impressão da PA.</p>
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          {carregando ? (
            <div className="grid flex-1 place-items-center text-ink-muted">
              <Loader2 aria-hidden="true" className="animate-spin" size={32} />
            </div>
          ) : quadraAtiva === null ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mb-2 flex items-center gap-2 text-sm text-ink-muted">
                <MapPin aria-hidden="true" size={16} />
                Quadra
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-3">
                {quadras.map((q) => (
                  <button
                    key={q.quadra}
                    className={`${CARTAO} px-2 py-5 text-center hover:border-ink/40`}
                    onClick={() => setQuadraAtiva(q.quadra)}
                    type="button"
                  >
                    <div className="text-3xl font-bold text-ink">{q.quadra}</div>
                    <div className="mt-1 text-sm font-semibold text-ink-muted">
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
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mb-2 flex items-center gap-2 text-sm text-ink-muted">
                <MapPin aria-hidden="true" size={16} />
                <span className="font-semibold text-ink">{quadraAtiva}</span>·
                {quadra?.disponiveis.length ?? 0} disponíveis
              </div>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(96px,1fr))] gap-3">
                {(quadra?.disponiveis ?? []).map((u) => {
                  const marcado = marcadas.has(u.codigo);
                  return (
                    <button
                      key={u.codigo}
                      className={`${marcado ? LOTE_MARCADO : LOTE_LIVRE} px-2 py-5 text-center`}
                      onClick={() => alternarLote(u)}
                      type="button"
                    >
                      <span className="text-2xl font-bold">{u.lote}</span>
                      {marcado ? (
                        <Check aria-hidden="true" className="mx-auto mt-1" size={18} />
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Proponentes (até 5): chips com % — o titular absorve os ajustes dos demais. */}
          {bipandoProponente ? (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 py-3">
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
          {proponentes.length > 1 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {proponentes.map((p, indice) => (
                <span
                  key={p.credenciadoId}
                  className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-3 pr-1.5 text-xs font-semibold text-ink"
                >
                  {p.nome.split(/\s+/)[0]}
                  <b className="tabular-nums">{p.percentual}%</b>
                  {indice > 0 ? (
                    <span className="inline-flex items-center">
                      <button
                        className="grid h-6 w-6 place-items-center rounded-full text-ink-muted hover:text-ink"
                        onClick={() => ajustarPercentual(p.credenciadoId, -5)}
                        title="-5%"
                        type="button"
                      >
                        <Minus aria-hidden="true" size={12} />
                      </button>
                      <button
                        className="grid h-6 w-6 place-items-center rounded-full text-ink-muted hover:text-ink"
                        onClick={() => ajustarPercentual(p.credenciadoId, 5)}
                        title="+5%"
                        type="button"
                      >
                        <Plus aria-hidden="true" size={12} />
                      </button>
                      <button
                        className="grid h-6 w-6 place-items-center rounded-full text-ink-muted hover:text-ink"
                        onClick={() => removerProponente(p.credenciadoId)}
                        title="Remover"
                        type="button"
                      >
                        <X aria-hidden="true" size={12} />
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
            <footer className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 py-3">
              {bipando ? (
                <Loader2 aria-hidden="true" className="animate-spin text-ink-muted" size={20} />
              ) : (
                <QrCode aria-hidden="true" className="text-ink-muted" size={20} />
              )}
              <p className="text-sm font-semibold text-ink">
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
          <footer className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
            <User aria-hidden="true" className="text-ink-muted" size={18} />
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">
                {cliente.nome}
                {proponentes.length > 1 ? ` +${proponentes.length - 1}` : ""}
              </p>
              <p className="truncate text-xs text-ink-muted">
                {marcadas.size > 0 ? [...marcadas.keys()].join(" · ") : "Nenhum lote marcado"}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <button
                className="grid h-12 w-12 place-items-center rounded-xl border border-line text-ink transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                disabled={proponentes.length >= MAX_PROPONENTES || bipandoProponente}
                onClick={() => setBipandoProponente(true)}
                title="Adicionar proponente"
                type="button"
              >
                <UserPlus aria-hidden="true" size={20} />
              </button>
              <button
                className="grid h-12 w-12 place-items-center rounded-xl border border-line text-ink transition hover:bg-black/5 dark:hover:bg-white/10"
                onClick={() => (quadraAtiva === null ? resetar() : setQuadraAtiva(null))}
                title={quadraAtiva === null ? "Cancelar" : "Outra quadra"}
                type="button"
              >
                {quadraAtiva === null ? (
                  <X aria-hidden="true" size={20} />
                ) : (
                  <ArrowLeft aria-hidden="true" size={20} />
                )}
              </button>
              <button
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-[#2C2C2A] px-6 text-base font-bold text-[#F1EFE8] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                disabled={marcadas.size === 0 || confirmando}
                onClick={() => void finalizar()}
                type="button"
              >
                {confirmando ? (
                  <Loader2 aria-hidden="true" className="animate-spin" size={20} />
                ) : (
                  <Check aria-hidden="true" size={20} />
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
