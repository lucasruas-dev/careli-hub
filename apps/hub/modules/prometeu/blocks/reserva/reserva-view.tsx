"use client";

import {
  ArrowLeft,
  Building2,
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
  primeiroNome,
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
import { usarLeitorWedge } from "../usar-leitor-wedge";
import { visualDoTotem } from "./escala-visual";
import { imprimirCupomDaReserva, logoDoCupom } from "./imprimir-cupom";
import { usarEscalaDoTotem } from "./usar-escala-do-totem";

// A POSIÇÃO DE RESERVA — tela touch do lançamento (Lucas, 24/08/2026).
//
// ⚠️ RODA EM TAMANHOS BEM DIFERENTES, e é isso que explica metade das decisões daqui: monitor
// em pé no balcão, TABLET DEITADO no suporte (Lucas, 28/08: "pode deixar melhor deitado, o
// suporte que tenho fica bom assim") e a janela do hub, para conferir sentado. Quem resolve o
// tamanho é a escala — lib/prometeu/escala-do-totem.ts decide qual, escala-visual.ts diz
// quanto vale cada um.
//
// Quiosque de fluxo contínuo: o CLIENTE passa a própria credencial no LEITOR FIXO do balcão
// (⚠️ a TELA fica com o OPERADOR — o cliente alcança só o leitor, então os textos daqui
// informam ESTADO, não dão instrução a ninguém) → QUADRAS (só números + quantos livres) →
// LOTES disponíveis (multi-seleção, selecionado em grafite invertido) → Finalizar → cupom
// sai na térmica → a tela VOLTA SOZINHA para o início, limpa, pronta para o próximo bip.
//
// ⚠️ SEM LEITURA POR CÂMERA AQUI (Lucas, 28/08): "nessa etapa nunca iremos ter bip por camera".
// O leitor é FIXO no balcão e quem passa a credencial é o CLIENTE — mas quem OLHA a tela é o
// operador. A câmera segue existindo no CHECK-IN, que é outra tela e outro operador.
//
// Decisões do Lucas nesta tela: mínimo de escrita (números grandes, ícones);
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

const CARTAO = "rounded-xl border border-line bg-surface transition-colors";
// O selecionado é GRAFITE INVERTIDO — padrão visual do Panteon; funciona nos dois temas por
// ser par fixo de alto contraste (fundo #2C2C2A + texto #F1EFE8).
const LOTE_LIVRE =
  "rounded-xl border border-line bg-surface text-ink hover:border-ink/40";
const LOTE_MARCADO =
  "rounded-xl border border-[#2C2C2A] bg-[#2C2C2A] text-[#F1EFE8]";

export function ReservaView() {
  // ⚠️ O LANÇAMENTO SELECIONADO NA TELA INICIAL MANDA (bug de 24/08: com o Vale do Ouro
  // selecionado, a tela mostrava os lotes do Villa Paris — o eventoDoDia ignora a escolha).
  const selecionado = useLancamentoSelecionado();
  const [evento, setEvento] = useState<null | PrometeuEvento>(null);
  const [quadras, setQuadras] = useState<ReservaTouchQuadra[]>([]);
  const [contadores, setContadores] = useState<null | ReservaTouchContadores>(
    null,
  );
  const [erro, setErro] = useState<null | string>(null);
  const [carregando, setCarregando] = useState(true);

  const [cliente, setCliente] = useState<null | Cliente>(null);
  const [proponentes, setProponentes] = useState<Proponente[]>([]);
  // true = o próximo bip ADICIONA um proponente em vez de começar reserva nova.
  const [bipandoProponente, setBipandoProponente] = useState(false);
  const [quadraAtiva, setQuadraAtiva] = useState<null | string>(null);
  const [marcadas, setMarcadas] = useState<Map<string, ReservaTouchUnidade>>(
    new Map(),
  );
  const [confirmando, setConfirmando] = useState(false);
  const [sucesso, setSucesso] = useState<null | {
    cliente: string;
    lotes: string[];
  }>(null);
  const [bipando, setBipando] = useState(false);

  // TELA CHEIA do quiosque (Lucas, 24/08: "como aqueles tótens de pedidos"). Fullscreen no
  // PRÓPRIO bloco da Reserva: rail, abas e barra do sistema somem. Esc também sai — por isso o
  // estado vem do evento fullscreenchange, não do clique.
  const raizRef = useRef<HTMLDivElement>(null);
  const botaoTelaCheiaRef = useRef<HTMLButtonElement>(null);
  const [telaCheia, setTelaCheia] = useState(false);
  // O que o OPERADOR pediu (não o que o navegador está fazendo). É a rede do quiosque: se a
  // tela cheia cair sem ele mandar, voltamos sozinhos no próximo bip — que é um gesto do
  // usuário e, portanto, autoriza requestFullscreen().
  const querTelaCheia = useRef(false);

  // ⚠️ O TAMANHO NÃO VEM DA TELA CHEIA — vem do espaço que a tela tem. Aqui o `telaCheia` é só
  // UM dos sinais de quiosque, e nem é o principal: o atalho do posto (`--kiosk`) ocupa o
  // monitor inteiro sem passar pela Fullscreen API, e por muito tempo a tela do evento
  // renderizou em tamanho de janelinha por causa disso. Ver lib/prometeu/escala-do-totem.ts.
  const escala = usarEscalaDoTotem(raizRef, telaCheia);
  const visual = visualDoTotem(escala);

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
      if (ev.key === "Escape" || ev.key === "F11")
        querTelaCheia.current = false;
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
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
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

      // ⚠️ ATENDIMENTO EM CURSO NÃO É INTERROMPIDO POR UM BIP (Lucas, 28/08, depois de acontecer
      // de verdade: *"eu estava reservando um lote para algumas pessoas, e sem querer eu bipei
      // outro cliente, automaticamente fechou o que eu estava reservando"*).
      //
      // O leitor fica FIXO no balcão e quem passa a credencial é o CLIENTE — então o bip
      // indevido não é hipótese remota: é o próximo da fila encostando o crachá enquanto o
      // atual ainda escolhe. Antes, esse bip trocava o cliente e apagava os lotes já marcados,
      // sem aviso e sem volta. Agora ele é RECUSADO com o nome de quem está em atendimento;
      // para trocar, o operador cancela (X) ou finaliza.
      //
      // A exceção é o segundo proponente, que é justamente um bip esperado — e nesse caso
      // `bipandoProponente` está ligado, pedido pelo operador.
      if (cliente && !bipandoProponente) {
        setErro(
          `${primeiroNome(cliente.nome)} está em atendimento. Finalize ou cancele a reserva antes de passar outra credencial.`,
        );
        return;
      }

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
            {
              credenciadoId: novo.id,
              documento: novo.documento,
              nome: novo.nome,
              percentual: 0,
            },
          ];
          const divisao = dividirIgual(lista.length);
          return lista.map((p, i) => ({ ...p, percentual: divisao[i] ?? 0 }));
        });
        setBipandoProponente(false);
      } else {
        const c = r.data.credenciado;
        setCliente(c);
        setProponentes([
          {
            credenciadoId: c.id,
            documento: c.documento,
            nome: c.nome,
            percentual: 100,
          },
        ]);
        setBipandoProponente(false);
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

    const qrDataUrl = await QRCode.toDataURL(
      conteudoDoQrDoCupom(r.data.grupoId),
      {
        margin: 1,
        width: 340,
      },
    );
    await imprimirCupomDaReserva({
      cliente: cliente.nome,
      codigoEvento: evento.enterpriseCode ?? "",
      // Só o nome: a participação de cada proponente é assunto da PA, não do cupom.
      outrosProponentes: proponentes.slice(1).map((p) => ({ nome: p.nome })),
      dataHora: new Date().toLocaleString("pt-BR", {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "2-digit",
        year: "numeric",
      }),
      evento: rotuloDoLancamento(evento),
      grupoId: r.data.grupoId,
      logoSrc: logoDoCupom(),
      // Resolvida aqui e não pelo `origemDoCliente` do render, para não depender da ordem em
      // que os useMemo aparecem no arquivo.
      origem: origemDoClienteParaExibir(cliente)?.texto ?? null,
      qrDataUrl,
      unidades: unidades.map((u) => ({ lote: u.lote, quadra: u.quadra })),
    });

    // Q/L aqui também: o cliente está com o cupom na mão, que diz "QUADRA A · LOTE 19".
    setSucesso({
      cliente: cliente.nome,
      lotes: unidades.map((u) => `${u.quadra} ${u.lote}`),
    });
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

  return (
    // ⚠️ A PÁGINA NUNCA ROLA, em nenhuma orientação: `overflow-hidden` aqui e `min-h-0` na
    // coluna garantem que só a prateleira de lotes role por dentro. Header e rodapé do cliente
    // são `shrink-0` — ficam SEMPRE visíveis, aconteça o que acontecer.
    //
    // Isso importa mais deitado do que em pé: no tablet a altura é o recurso escasso (uns 800px
    // contra os 1920 do monitor em pé), e é justamente aí que um rodapé empurrado para fora
    // deixaria o operador sem o Finalizar.
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
            className={`truncate font-semibold text-ink ${visual.tituloDoEvento}`}
          >
            {evento ? rotuloDoLancamento(evento) : "Reserva"}
          </h1>
          <p className={`text-ink-muted ${visual.subtituloDoEvento}`}>
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
              className={`${CARTAO} flex-1 text-center landscape:flex-none ${visual.cartaoDoContador}`}
            >
              <div
                className={`font-bold tabular-nums text-ink ${visual.numeroDoContador}`}
              >
                {valor ?? "—"}
              </div>
              <div className={`text-ink-muted ${visual.rotuloDoContador}`}>
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
              className={`mx-auto grid place-items-center rounded-full bg-[#2C2C2A] text-[#F1EFE8] ${visual.medalhaDeSucesso}`}
            >
              <Check aria-hidden="true" size={visual.iconeDeSucesso} />
            </span>
            <p
              className={`mt-4 break-words font-bold uppercase text-ink ${visual.nomeNoSucesso}`}
            >
              {sucesso.cliente}
            </p>
            <p
              className={`mt-1 break-words text-ink-soft ${visual.lotesNoSucesso}`}
            >
              {sucesso.lotes.join(" · ")}
            </p>
            <p className={`mt-3 text-ink-muted ${visual.avisoNoSucesso}`}>
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
              <div className={`grid ${visual.gradeDeQuadras}`}>
                {quadras.map((q) => (
                  <button
                    key={q.quadra}
                    className={`${CARTAO} px-2 text-center hover:border-ink/40 ${visual.cartaoDaQuadra}`}
                    onClick={() => setQuadraAtiva(q.quadra)}
                    type="button"
                  >
                    <div
                      className={`font-bold text-ink ${visual.numeroDaQuadra}`}
                    >
                      {q.quadra}
                    </div>
                    <div
                      className={`mt-1 font-semibold text-ink-muted ${visual.livresDaQuadra}`}
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
              <div className={`grid ${visual.gradeDeLotes}`}>
                {(quadra?.disponiveis ?? []).map((u) => {
                  const marcado = marcadas.has(u.codigo);
                  return (
                    <button
                      key={u.codigo}
                      className={`${marcado ? LOTE_MARCADO : LOTE_LIVRE} px-2 text-center ${visual.cartaoDoLote}`}
                      onClick={() => alternarLote(u)}
                      type="button"
                    >
                      <span className={`font-bold ${visual.numeroDoLote}`}>
                        {u.lote}
                      </span>
                      {marcado ? (
                        <Check
                          aria-hidden="true"
                          className="mx-auto mt-1"
                          size={visual.iconeDoLote}
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
                <Loader2
                  aria-hidden="true"
                  className="animate-spin text-ink-muted"
                  size={18}
                />
              ) : (
                <QrCode
                  aria-hidden="true"
                  className="text-ink-muted"
                  size={18}
                />
              )}
              <span
                className={`font-semibold text-ink ${visual.tituloDaQuadraAberta}`}
              >
                Aguardando a credencial do outro comprador
              </span>
              <div className="ml-auto flex gap-2">
                <button
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-soft"
                  onClick={() => {
                    setBipandoProponente(false);
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
                  className={`inline-flex items-center gap-1.5 rounded-full border border-line bg-surface font-semibold text-ink ${visual.chipDeProponente}`}
                >
                  {p.nome.split(/\s+/)[0]}
                  <b className="tabular-nums">{p.percentual}%</b>
                  {/* Tela de TOQUE: os 24px de antes exigiam precisão de mouse justamente no
                      único ajuste fino da tela, com cliente na frente. Agora são alvos de 36px
                      (44px em tela cheia), como o resto do quiosque. */}
                  {indice > 0 ? (
                    <span className="inline-flex items-center gap-0.5">
                      <button
                        className={`grid place-items-center rounded-full text-ink-muted transition hover:bg-black/5 hover:text-ink dark:hover:bg-white/10 ${visual.alvoDoChip}`}
                        onClick={() => ajustarPercentual(p.credenciadoId, -5)}
                        title="-5%"
                        type="button"
                      >
                        <Minus aria-hidden="true" size={visual.iconeDoChip} />
                      </button>
                      <button
                        className={`grid place-items-center rounded-full text-ink-muted transition hover:bg-black/5 hover:text-ink dark:hover:bg-white/10 ${visual.alvoDoChip}`}
                        onClick={() => ajustarPercentual(p.credenciadoId, 5)}
                        title="+5%"
                        type="button"
                      >
                        <Plus aria-hidden="true" size={visual.iconeDoChip} />
                      </button>
                      <button
                        className={`grid place-items-center rounded-full text-ink-muted transition hover:bg-black/5 hover:text-ink dark:hover:bg-white/10 ${visual.alvoDoChip}`}
                        onClick={() => removerProponente(p.credenciadoId)}
                        title="Remover"
                        type="button"
                      >
                        <X aria-hidden="true" size={visual.iconeDoChip} />
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
              className={`mt-3 flex shrink-0 flex-wrap items-center gap-3 rounded-xl border border-dashed border-line bg-surface px-4 ${visual.paddingDoRodape}`}
            >
              {bipando ? (
                <Loader2
                  aria-hidden="true"
                  className="animate-spin text-ink-muted"
                  size={visual.iconeDoBip}
                />
              ) : (
                <QrCode
                  aria-hidden="true"
                  className="text-ink-muted"
                  size={visual.iconeDoBip}
                />
              )}
              {/* ⚠️ ESTA TELA FICA COM O OPERADOR; o cliente só alcança o leitor (Lucas, 28/08:
                  "essa tela vai ficar com operador, o cliente vai ver somente o scaner").
                  Portanto ela informa ESTADO, não dá instrução: nem "bipe a etiqueta do cliente"
                  (mandava o operador fazer o que é do cliente), nem "passe sua credencial"
                  (falava com quem não está lendo). "Aguardando cliente" é o que o operador
                  precisa saber de relance: o posto está livre e pronto. */}
              <p className={`font-semibold text-ink ${visual.textoDeEspera}`}>
                Aguardando cliente
              </p>
            </footer>
          ) : (
            // O CLIENTE EM DESTAQUE (Lucas, 28/08): nome grande, legível a um metro, com a
            // imobiliária logo abaixo. Em retrato o cartão vira duas faixas — identidade em cima,
            // ações em baixo, com o Finalizar esticado (alvo grande de toque).
            <footer
              className={`mt-3 flex shrink-0 flex-col gap-3 rounded-2xl border border-line bg-surface px-4 landscape:flex-row landscape:items-center landscape:gap-4 ${visual.paddingDoRodape}`}
            >
              <div className="flex min-w-0 items-center gap-3 landscape:flex-1">
                <span
                  className={`grid shrink-0 place-items-center rounded-xl bg-[#2C2C2A] text-[#F1EFE8] ${visual.avatarDoCliente}`}
                >
                  <User aria-hidden="true" size={visual.iconeDoAvatar} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-baseline gap-2">
                    {/* ⚠️ O TAMANHO É DITADO PELO NOME MAIS LONGO, não pelo mais bonito. Em
                      retrato (1080 de largura) o `text-4xl` cortava "FLAVIA CALDEIRA ANDRADE"
                      em "FLAVIA CALDEIRA ANDR…" — e nome truncado no tótem é o operador
                      confirmando reserva com meia identificação na tela. Um degrau abaixo
                      cabe, e continua legível de longe (Lucas, 28/08: "pode diminuir um
                      pouco o nome"). */}
                    <span
                      className={`min-w-0 truncate font-black uppercase leading-tight tracking-tight text-ink ${visual.nomeDoCliente}`}
                    >
                      {cliente.nome}
                    </span>
                    {sufixoProponentes ? (
                      <span
                        className={`shrink-0 rounded-full bg-[#2C2C2A] px-2 py-0.5 font-bold text-[#F1EFE8] ${visual.seloDeProponentes}`}
                        title={`${proponentes.length} proponentes`}
                      >
                        {sufixoProponentes}
                      </span>
                    ) : null}
                  </div>
                  {/* Sem imobiliária E sem corretor a linha simplesmente não existe — nada de
                    rótulo órfão nem buraco no cartão. */}
                  {/* Um degrau abaixo do nome, e menor que ele: "F M S MACIEL IMOVEIS · IGOR
                    FERNANDO CLODOMIRO" também estourava a largura em retrato. Aqui truncar
                    incomoda menos (o nome do corretor é o fim da linha), mas quanto mais
                    couber, melhor para o operador conferir com a etiqueta na mão. */}
                  {origemDoCliente ? (
                    <p
                      className={`mt-0.5 flex min-w-0 items-center gap-1.5 font-semibold text-ink-soft ${visual.origemDoCliente}`}
                    >
                      {origemDoCliente.tipo === "imobiliaria" ? (
                        <Building2
                          aria-hidden="true"
                          className="shrink-0"
                          size={visual.iconeDaOrigem}
                        />
                      ) : (
                        <UserRound
                          aria-hidden="true"
                          className="shrink-0"
                          size={visual.iconeDaOrigem}
                        />
                      )}
                      <span className="truncate">{origemDoCliente.texto}</span>
                    </p>
                  ) : null}
                  {/* ⚠️ QUADRA E LOTE, NÃO O CÓDIGO DA UNIDADE (Lucas, 28/08: "o codigo da unidade
                    não é legal para esse processo pois confunde"). "RVPA19 · RVPB10" é código de
                    sistema: ninguém lê isso em voz alta, e com dois lotes de número igual em
                    quadras diferentes (RVPA10 e RVPB10) a diferença fica escondida no meio da
                    sigla. O corretor e o cliente falam "quadra A, lote 19" — é essa a leitura
                    que precisa bater com o cupom e com a placa no terreno. */}
                  <p
                    className={`mt-0.5 truncate ${marcadas.size > 0 ? "font-semibold text-ink" : "text-ink-muted"} ${visual.lotesMarcados}`}
                  >
                    {marcadas.size > 0
                      ? [...marcadas.values()]
                          .map((u) => `${u.quadra} ${u.lote}`)
                          .join("  ·  ")
                      : "Nenhum lote marcado"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 landscape:ml-auto landscape:shrink-0">
                <button
                  className={`grid shrink-0 place-items-center rounded-xl border border-line text-ink transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10 ${visual.botaoDeAcao}`}
                  disabled={
                    proponentes.length >= MAX_PROPONENTES || bipandoProponente
                  }
                  onClick={() => setBipandoProponente(true)}
                  title="Adicionar proponente"
                  type="button"
                >
                  <UserPlus aria-hidden="true" size={visual.iconeDeAcao} />
                </button>
                {/* ⚠️ VOLTAR E CANCELAR SÃO BOTÕES DIFERENTES. Eram um só, que trocava de função
                  conforme a tela: dentro de uma quadra virava "voltar" e o operador ficava SEM
                  saída — preso ao atendimento, tendo que finalizar para se livrar dele. Ficou
                  pior depois que passamos a recusar o bip de outro cliente com "finalize ou
                  cancele": a mensagem mandava fazer algo que a tela não oferecia naquele
                  momento (Lucas, 28/08: "aqui também precisamos de um botão de cancelar"). */}
                {quadraAtiva !== null ? (
                  <button
                    className={`grid shrink-0 place-items-center rounded-xl border border-line text-ink transition hover:bg-black/5 dark:hover:bg-white/10 ${visual.botaoDeAcao}`}
                    onClick={() => setQuadraAtiva(null)}
                    title="Outra quadra"
                    type="button"
                  >
                    <ArrowLeft aria-hidden="true" size={visual.iconeDeAcao} />
                  </button>
                ) : null}
                <button
                  className={`grid shrink-0 place-items-center rounded-xl border border-line text-ink-soft transition hover:border-ink/40 hover:text-ink ${visual.botaoDeAcao}`}
                  onClick={resetar}
                  title="Cancelar atendimento"
                  type="button"
                >
                  <X aria-hidden="true" size={visual.iconeDeAcao} />
                </button>
                <button
                  className={`inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#2C2C2A] font-bold text-[#F1EFE8] transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 landscape:flex-none ${visual.botaoFinalizar}`}
                  disabled={marcadas.size === 0 || confirmando}
                  onClick={() => void finalizar()}
                  type="button"
                >
                  {confirmando ? (
                    <Loader2
                      aria-hidden="true"
                      className="animate-spin"
                      size={visual.iconeDeAcao}
                    />
                  ) : (
                    <Check aria-hidden="true" size={visual.iconeDeAcao} />
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
