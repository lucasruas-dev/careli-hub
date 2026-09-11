"use client";

import { useAthenaTicketRecording } from "@/components/hub-support/athena-ticket-recording-provider";
import {
  DESCANSO_ENTRE_FALAS_MS,
  falasDaHora,
  SAUDACOES,
  sortearSemRepetir,
} from "@/components/hub-support/festo-conversa";
import { type EstadoDoFesto, FestoRobo } from "@/components/hub-support/festo-robo";
import { falasDoTraje, trajeDaData } from "@/components/hub-support/festo-traje";
import { HubTicketOpenForm } from "@/components/hub-support/hub-ticket-open-form";
import { useOutsideDismiss } from "@/hooks/use-outside-dismiss";
import { useAuth } from "@/providers/auth-provider";
import { X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

// FESTO — o suporte do Panteon, e o botão que o abre.
//
// Lucas (11/09/2026) escolheu o nome, e encurtou logo em seguida: *"Hefesto, otimo"* e depois
// *"Deixa Festo"*. Vem de Hefesto, o ferreiro dos deuses: quem conserta e forja — que é o que se
// pede ao suporte. O apelido ficou sendo o nome.
//
// ⚠️ E O ENCURTAMENTO RESOLVEU UMA COLISÃO: "Hefesto" era, até 23/06/2026, como o agente de
// engenharia (o Claude) se chamava, antes de tudo virar "Zeus". "Festo" não se confunde com aquilo
// em nenhuma conversa antiga.
//
// Lucas (11/09/2026): *"eu quero mudar essa imagem, colocar uma imagem de central de suporte mesmo,
// e outra coisa, está fixo, tem hora que atrapalha de ver a tela e tal, pode deixar solta"*.
//
// ⚠️ ELE JÁ ESTAVA EM TODAS AS TELAS. O `hub-shell` monta este dock para qualquer pessoa logada —
// o que faltava não era alcance, era o botão parecer o que é e sair da frente quando incomoda.
//
// ⚠️ A MARCA SAIU E O HEADSET ENTROU. O avatar da Athena dizia "assistente de IA", e quem está com
// a tela travada não procura um assistente: procura o suporte. O fone é o símbolo universal disso,
// e não precisa de arquivo de imagem para existir — um ícone escala em qualquer tela e não pesa.
//
// ⚠️ E ELE ARRASTA. Um botão fixo no canto inferior direito cobre justamente o rodapé das tabelas
// e o último campo dos formulários longos, e não havia saída a não ser recarregar a página.
// Arrastar resolve sem esconder o suporte de quem precisa dele.

/** Onde o botão para. Guardado por navegador; `null` = o canto de sempre. */
type Posicao = { x: number; y: number };

const CHAVE_DA_POSICAO = "panteon-suporte-posicao";
const LADO = 56;
const MARGEM = 12;
/**
 * ⚠️ ABAIXO DISTO É CLIQUE, NÃO ARRASTE. Sem esta folga, o tremor natural da mão entre apertar e
 * soltar viraria um micro-arraste e o botão não abriria — o defeito clássico de dock arrastável:
 * a pessoa clica, nada acontece, e ela conclui que o suporte está quebrado.
 */
const FOLGA_DO_CLIQUE = 4;

export function HubSupportDock() {
  const { hubUser } = useAuth();
  const pathname = usePathname();
  const { isRecordingProtected, nativeTicketFormCount } =
    useAthenaTicketRecording();
  const [open, setOpen] = useState(false);
  const [recordingMinimized, setRecordingMinimized] = useState(false);
  const [posicao, setPosicao] = useState<null | Posicao>(null);
  const [arrastando, setArrastando] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);
  /** O que o ponteiro fez desde que desceu: para separar clique de arraste no `pointerup`. */
  const gesto = useRef<null | { moveu: boolean; x: number; y: number }>(null);
  /** O que o Festo está dizendo agora. `null` = calado. */
  const [fala, setFala] = useState<null | string>(null);
  const [piscando, setPiscando] = useState(false);
  const [pulando, setPulando] = useState(false);
  /** As falas já ditas nesta aba, para o sorteio não repetir. Ver `sortearSemRepetir`. */
  const jaDitas = useRef<string[]>([]);
  const sumirFala = useRef<null | ReturnType<typeof setTimeout>>(null);

  const shouldKeepTicketVisible =
    isRecordingProtected && nativeTicketFormCount === 0;
  const compactPanel =
    recordingMinimized || (!open && shouldKeepTicketVisible);
  const panelVisible = open || recordingMinimized || shouldKeepTicketVisible;

  useOutsideDismiss({
    enabled: open && !recordingMinimized && !arrastando,
    onDismiss: requestClose,
    ref: dockRef,
  });

  // A posição volta como a pessoa deixou. Leitura protegida: aba privativa e navegador com
  // armazenamento bloqueado lançam no próprio acesso, e o suporte não pode sumir por causa disso.
  useEffect(() => {
    try {
      const cru = localStorage.getItem(CHAVE_DA_POSICAO);
      if (!cru) return;
      const salvo = JSON.parse(cru) as Partial<Posicao>;
      if (typeof salvo.x === "number" && typeof salvo.y === "number") {
        setPosicao(dentroDaTela(salvo as Posicao));
      }
    } catch {
      // sem posição salva: fica no canto de sempre
    }
  }, []);

  /**
   * ⚠️ A JANELA ENCOLHE E O BOTÃO PRECISA SEGUIR. Sem isto, quem arrastou o botão para a direita
   * num monitor grande e depois abriu o hub no notebook não acharia mais o suporte: ele estaria
   * fora da área visível, sem nenhuma forma de trazer de volta.
   */
  useEffect(() => {
    if (!posicao) return;
    const aoRedimensionar = () => setPosicao((atual) => (atual ? dentroDaTela(atual) : atual));
    window.addEventListener("resize", aoRedimensionar);
    return () => window.removeEventListener("resize", aoRedimensionar);
  }, [posicao]);

  /**
   * Faz o Festo dizer alguma coisa por alguns segundos.
   *
   * ⚠️ O BALÃO É RECADO CURTO, e nunca atendimento. Correção do Lucas (11/09/2026), olhando um
   * diagnóstico técnico dentro do balão: *"isso aqui é dentro do chat"*. O que ele descobriu, o
   * que precisa de você e a devolutiva vão para a CONVERSA, onde ficam registrados; aqui só entra
   * o que pode sumir sem perda.
   */
  const dizer = useCallback((texto: string, segundos: number) => {
    setFala(texto);
    if (sumirFala.current) clearTimeout(sumirFala.current);
    sumirFala.current = setTimeout(() => setFala(null), segundos * 1000);
  }, []);

  // A piscada em intervalo IRREGULAR é o que faz parecer olho. De 5 em 5 segundos exatos, lê como
  // led de aparelho — e aí o robô vira enfeite piscando, não alguém prestando atenção.
  useEffect(() => {
    let vivo = true;
    let proxima: ReturnType<typeof setTimeout>;
    const agenda = () => {
      proxima = setTimeout(
        () => {
          if (!vivo) return;
          setPiscando(true);
          setTimeout(() => setPiscando(false), 260);
          agenda();
        },
        4000 + Math.random() * 5000,
      );
    };
    agenda();
    return () => {
      vivo = false;
      clearTimeout(proxima);
    };
  }, []);

  /**
   * A fala espontânea: água, alongamento, bom dia.
   *
   * ⚠️ 2 A 3 VEZES POR DIA, e a raridade é o recurso. Foi assim que o Clippy virou piada: não pelo
   * que dizia, mas por quantas vezes. Falando pouco, o balão continua sendo LIDO — o que importa no
   * dia em que o recado for sério.
   *
   * ⚠️ E ELE NÃO FALA COM O PAINEL ABERTO: ali a pessoa está escrevendo um problema, e um "já tomou
   * água?" por cima disso é exatamente o tipo de coisa que faz desligar o suporte.
   */
  useEffect(() => {
    const relogio = setInterval(() => {
      if (open || recordingMinimized) return;
      const agora = new Date();
      // ⚠️ NA DATA, A FALA DA DATA TEM PRECEDÊNCIA. Um "já tomou água?" na semana da pátria com a
      // bandeira na mão desperdiçaria a única coisa que faz o adereço valer: a piada de estar ali.
      const doTraje = falasDoTraje(trajeDaData(agora));
      const catalogo = doTraje.length > 0 ? doTraje : falasDaHora(agora.getHours());
      const sorteio = sortearSemRepetir(catalogo, jaDitas.current);
      jaDitas.current = sorteio.jaDitas;
      dizer(sorteio.escolhida, 8);
    }, DESCANSO_ENTRE_FALAS_MS);
    return () => clearInterval(relogio);
  }, [dizer, open, recordingMinimized]);

  const aoDescer = useCallback((evento: React.PointerEvent<HTMLButtonElement>) => {
    const alvo = evento.currentTarget;
    alvo.setPointerCapture(evento.pointerId);
    const caixa = alvo.getBoundingClientRect();
    gesto.current = {
      moveu: false,
      x: evento.clientX - caixa.left,
      y: evento.clientY - caixa.top,
    };
  }, []);

  const aoMover = useCallback((evento: React.PointerEvent<HTMLButtonElement>) => {
    const atual = gesto.current;
    if (!atual) return;

    const caixa = evento.currentTarget.getBoundingClientRect();
    const andou =
      Math.abs(evento.clientX - caixa.left - atual.x) +
      Math.abs(evento.clientY - caixa.top - atual.y);

    if (!atual.moveu && andou < FOLGA_DO_CLIQUE) return;

    atual.moveu = true;
    setArrastando(true);
    setPosicao(
      dentroDaTela({ x: evento.clientX - atual.x, y: evento.clientY - atual.y }),
    );
  }, []);

  const aoSubir = useCallback(
    (evento: React.PointerEvent<HTMLButtonElement>) => {
      const atual = gesto.current;
      gesto.current = null;
      evento.currentTarget.releasePointerCapture(evento.pointerId);

      if (atual?.moveu) {
        setArrastando(false);
        setPosicao((fim) => {
          if (fim) {
            try {
              localStorage.setItem(CHAVE_DA_POSICAO, JSON.stringify(fim));
            } catch {
              // sem persistência: a posição vale só nesta sessão
            }
          }
          return fim;
        });
        return;
      }

      // Não moveu: é clique. O balão sai de cena — o assunto agora é o painel.
      setFala(null);
      if (compactPanel) {
        restoreRecordingPanel();
        return;
      }
      setOpen((atualAberto) => !atualAberto);
    },
    [compactPanel],
  );

  if (
    !hubUser ||
    (shouldHideGlobalAthena(pathname) && !shouldKeepTicketVisible)
  ) {
    return null;
  }

  /**
   * ⚠️ O PAINEL ABRE PARA O LADO QUE TEM ESPAÇO. Com o botão arrastado para o topo da tela, um
   * painel que sempre sobe ficaria metade fora da janela — e a pessoa veria o suporte cortado
   * exatamente quando precisa dele.
   */
  const abaixo = posicao !== null && posicao.y < window.innerHeight / 2;

  // ⚠️ UM ESTADO SÓ CHEGA AO ROBÔ, e a ordem é a da urgência: piscar é vida, pular é reação.
  // Somar os dois faria o robô piscar no meio do pulo, que lê como defeito e não como expressão.
  const estadoDoFesto: EstadoDoFesto = pulando
    ? "pulando"
    : "repouso";

  return (
    <div
      className={`fixed z-[80] flex items-end gap-3 ${
        abaixo ? "flex-col-reverse" : "flex-col"
      } ${posicao ? "" : "bottom-5 right-5"}`}
      ref={dockRef}
      style={
        posicao
          ? { left: posicao.x, top: posicao.y, transform: "translateX(-100%)", marginLeft: LADO }
          : undefined
      }
    >
      {panelVisible ? (
        <section
          className={
            compactPanel
              ? "w-[min(24rem,calc(100vw-2rem))]"
              : "w-[min(33rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.24)]"
          }
        >
          <header
            className={`border-b border-slate-100 bg-[#101820] px-4 py-3 text-white ${
              compactPanel ? "hidden" : ""
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center">
                  <FestoRobo className="size-11" />
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-sm font-semibold">Festo</p>
                  <p className="m-0 mt-1 truncate text-xs text-white/65">
                    Suporte do Panteon. Conte o que aconteceu.
                  </p>
                </div>
              </div>
              <button
                aria-label="Fechar o Festo"
                className="grid size-8 place-items-center rounded-lg text-white/70 transition hover:bg-white/10 hover:text-white"
                onClick={requestClose}
                type="button"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          </header>

          <div
            className={
              compactPanel
                ? "p-0"
                : "max-h-[calc(100dvh-12rem)] overflow-y-auto p-4"
            }
          >
            <HubTicketOpenForm
              compactRecordingMode={compactPanel}
              onRestoreRequest={restoreRecordingPanel}
            />
          </div>
        </section>
      ) : null}

      {/* ⚠️ O BALÃO SÓ APARECE COM O PAINEL FECHADO. Com a conversa aberta, um balão flutuando ao
          lado seria uma segunda voz do mesmo Festo dizendo outra coisa. */}
      {fala && !panelVisible ? (
        <div
          className="max-w-[15rem] self-end rounded-xl rounded-br-sm bg-inverse px-3 py-2 text-[12.5px] leading-snug text-surface shadow-[0_10px_26px_rgba(15,23,42,0.22)]"
          role="status"
        >
          {fala}
        </div>
      ) : null}

      <button
        aria-expanded={open && !compactPanel}
        aria-label={
          compactPanel ? "Restaurar o Festo" : "Falar com o Festo — arraste para mover"
        }
        // ⚠️ O BOTÃO CONTINUA TENDO 56px, mesmo sem o círculo desenhado: o fundo sumiu, a ÁREA
        // DE CLIQUE não. Sem isto o alvo viraria a silhueta do robô, com cantos vazios que não
        // respondem — e errar o clique no botão de suporte é o pior lugar para essa frustração.
        className={`relative grid size-14 shrink-0 touch-none place-items-center rounded-full transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
          arrastando ? "scale-105 cursor-grabbing" : "cursor-grab"
        }`}
        onMouseEnter={() => {
          if (open || arrastando) return;
          setPulando(true);
          setTimeout(() => setPulando(false), 640);
          const sorteio = sortearSemRepetir(SAUDACOES, jaDitas.current);
          jaDitas.current = sorteio.jaDitas;
          dizer(sorteio.escolhida, 3);
        }}
        onPointerCancel={() => {
          gesto.current = null;
          setArrastando(false);
        }}
        onPointerDown={aoDescer}
        onPointerMove={aoMover}
        onPointerUp={aoSubir}
        title="Festo · suporte do Panteon (arraste para mover)"
        type="button"
      >
        <FestoRobo
          className={`size-14 ${piscando ? "festo-piscando" : ""}`}
          estado={estadoDoFesto}
        />
        {/* O ponto verde diz que o Festo atende agora. Quando o chat existir, ele vira o contador
            de "tem resposta esperando você" — que é o recado que hoje ninguém recebe. */}
        <span className="absolute right-0 top-0 size-3 rounded-full bg-emerald-500 ring-2 ring-canvas" />
      </button>
    </div>
  );

  function requestClose() {
    if (isRecordingProtected) {
      setOpen(false);
      setRecordingMinimized(true);
      return;
    }

    setOpen(false);
    setRecordingMinimized(false);
  }

  function restoreRecordingPanel() {
    setRecordingMinimized(false);
    setOpen(true);
  }
}

/** Prende a posição à janela, sempre com o botão inteiro visível. */
function dentroDaTela(posicao: Posicao): Posicao {
  if (typeof window === "undefined") return posicao;
  return {
    x: Math.min(Math.max(posicao.x, MARGEM), window.innerWidth - LADO - MARGEM),
    y: Math.min(Math.max(posicao.y, MARGEM), window.innerHeight - LADO - MARGEM),
  };
}

function shouldHideGlobalAthena(pathname: string) {
  return (
    pathname.startsWith("/zeus") ||
    pathname.startsWith("/hermes") ||
    pathname.startsWith("/hades/cobranca") ||
    pathname.startsWith("/hades/atendimento")
  );
}
