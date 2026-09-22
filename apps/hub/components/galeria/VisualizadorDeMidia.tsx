"use client";

import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Loader2,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import {
  type PointerEvent as PointerEventDoReact,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { contadorDaGaleria, indiceVizinho, passoDoArrasto } from "./navegacao-da-galeria";

// O VISUALIZADOR DE MÍDIA — foto ou vídeo em popup, por cima da página, com tela cheia.
//
// Lucas (16/09/2026): *"quando abrir ter a opcao de ver em tela cheia, lembrando que nao precisa
// abrir em nova aba ou algo do tipo, abre como um popup mesmo"*.
//
// ⚠️ SEM DEPENDÊNCIA DO PORTAL, DE PROPÓSITO. Nasceu para a aba Arquivos do produto, mas a casa já
// tem três lightboxes escritos à mão (Iris, Hermes, anexos): este é o que serve a qualquer galeria.
// Por isso as cores são FIXAS (fundo quase preto, texto claro) e não os tokens `--inc-*`: foto é
// vista sobre escuro nos dois temas, como em todo visualizador de celular, e a peça não pode
// depender de uma variável que só existe dentro do portal.
//
// ⚠️ PORTAL NO <body>. A ficha do produto vive dentro de contêineres com `overflow: hidden` e
// `transform`; um `position: fixed` lá dentro fica preso na caixa do pai e o "popup" vira um
// retângulo cortado no meio da aba. `createPortal` tira o modal dessa árvore de CSS sem tirá-lo da
// árvore do React (o estado continua do dono).
//
// ⚠️ A TELA CHEIA TEM TRÊS CAMINHOS, e o terceiro é o iPhone:
//   1. `requestFullscreen` no próprio modal (desktop, Android, iPad recente): setas e contador
//      continuam na tela;
//   2. `webkitRequestFullscreen` (Safari antigo de iPad/Mac);
//   3. iPhone NÃO implementa a API em elemento comum (`document.fullscreenEnabled` é falso). Para o
//      vídeo, `webkitEnterFullscreen` abre o player nativo; para a foto, o modo IMERSIVO: esconde a
//      barra, as setas e a legenda e deixa a imagem ocupar a tela toda. É o que dá para fazer, e é o
//      que a pessoa quer quando aperta o botão na frente do cliente.
//   O estado da tela cheia de verdade vem do `fullscreenchange`, nunca do clique: o navegador sai
//   sozinho (Esc, gesto, troca de aba), e um booleano guardado no clique deixaria o botão mentindo
//   (mesma lição do EspelhoPublico).

export type MidiaDoVisualizador = {
  id: string;
  legenda?: null | string;
  /** Aparece enquanto o original carrega (foto) e como pôster (vídeo). */
  miniaturaUrl?: null | string;
  nome?: null | string;
  tipo: "documento" | "imagem" | "video";
  url: null | string;
};

type DocumentoComWebkit = Document & {
  webkitExitFullscreen?: () => void;
  webkitFullscreenElement?: Element | null;
};
type ElementoComWebkit = HTMLElement & { webkitRequestFullscreen?: () => void };
type VideoComWebkit = HTMLVideoElement & { webkitEnterFullscreen?: () => void };

const FOCAVEIS =
  'button:not([disabled]), [href], video[controls], input:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function VisualizadorDeMidia({
  indice,
  itens,
  onFechar,
  onIndice,
  rotulo = "Visualizador de fotos e vídeos",
}: {
  /** `null` = fechado. */
  indice: null | number;
  itens: readonly MidiaDoVisualizador[];
  onFechar: () => void;
  onIndice: (indice: number) => void;
  /** O nome do diálogo para leitor de tela. */
  rotulo?: string;
}) {
  if (indice === null || itens.length === 0 || typeof document === "undefined") return null;

  const atual = Math.min(Math.max(0, indice), itens.length - 1);

  return createPortal(
    <Modal
      indice={atual}
      itens={itens}
      onFechar={onFechar}
      onIndice={onIndice}
      rotulo={rotulo}
    />,
    document.body,
  );
}

function telaCheiaAtiva(): boolean {
  const doc = document as DocumentoComWebkit;
  return Boolean(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

function sairDaTelaCheia(): void {
  const doc = document as DocumentoComWebkit;
  if (doc.fullscreenElement) {
    void doc.exitFullscreen().catch(() => undefined);
  } else if (doc.webkitFullscreenElement) {
    doc.webkitExitFullscreen?.();
  }
}

function Modal({
  indice,
  itens,
  onFechar,
  onIndice,
  rotulo,
}: {
  indice: number;
  itens: readonly MidiaDoVisualizador[];
  onFechar: () => void;
  onIndice: (indice: number) => void;
  rotulo: string;
}) {
  const raiz = useRef<HTMLDivElement | null>(null);
  const botaoFechar = useRef<HTMLButtonElement | null>(null);
  const video = useRef<HTMLVideoElement | null>(null);
  const inicioDoArrasto = useRef<null | { x: number; y: number }>(null);
  const relogioDaTelaCheia = useRef<null | number>(null);

  const [cheia, setCheia] = useState(false);
  const [imersiva, setImersiva] = useState(false);

  const total = itens.length;
  const item = itens[indice];

  const andar = useCallback(
    (passo: number) => {
      if (total <= 1) return;
      onIndice(indiceVizinho(indice, total, passo));
    },
    [indice, onIndice, total],
  );

  // As funções mais recentes num ref: os efeitos abaixo instalam o ouvinte UMA vez por abertura, e
  // reinstalar a cada troca de foto faria o foco devolvido ao fechar apontar para o lugar errado.
  const acoes = useRef({ andar, imersiva, onFechar });
  useEffect(() => {
    acoes.current = { andar, imersiva, onFechar };
  }, [andar, imersiva, onFechar]);

  // ── Abrir: foco no modal, página sem rolagem; fechar: tudo de volta como estava ──────────────
  useEffect(() => {
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    botaoFechar.current?.focus();

    return () => {
      if (relogioDaTelaCheia.current !== null) window.clearTimeout(relogioDaTelaCheia.current);
      document.body.style.overflow = overflowAntes;
      if (telaCheiaAtiva()) sairDaTelaCheia();
      // Só devolve o foco se o elemento ainda está na página (a miniatura pode ter sido removida).
      if (antes && document.contains(antes)) antes.focus();
    };
  }, []);

  // ── Tela cheia de verdade: o estado vem do navegador ──────────────────────────────────────────
  useEffect(() => {
    const sincronizar = () => {
      const ativa = telaCheiaAtiva();
      setCheia(ativa);
      // Entrou de verdade (mesmo que tarde, depois do fallback): o modo imersivo sai de cena.
      if (ativa) setImersiva(false);
    };
    document.addEventListener("fullscreenchange", sincronizar);
    document.addEventListener("webkitfullscreenchange", sincronizar);
    return () => {
      document.removeEventListener("fullscreenchange", sincronizar);
      document.removeEventListener("webkitfullscreenchange", sincronizar);
    };
  }, []);

  // ── Teclado: Esc, setas e o foco preso no modal ───────────────────────────────────────────────
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      const { andar: andarAgora, imersiva: imersivaAgora, onFechar: fecharAgora } = acoes.current;

      if (evento.key === "Escape") {
        // O Esc é do popup: a tela de baixo (uma ficha, um drawer) não pode fechar junto.
        evento.preventDefault();
        evento.stopPropagation();
        if (imersivaAgora) setImersiva(false);
        else fecharAgora();
        return;
      }

      if (evento.key === "ArrowRight" || evento.key === "ArrowLeft") {
        // ⚠️ NO PLAYER, A SETA É DO VÍDEO (avança 5 s). Trocar de mídia ali tiraria o vídeo da tela
        // justamente quando a pessoa tenta voltar um trecho.
        const alvo = evento.target;
        if (alvo instanceof HTMLVideoElement || alvo instanceof HTMLInputElement) return;
        evento.preventDefault();
        evento.stopPropagation();
        andarAgora(evento.key === "ArrowRight" ? 1 : -1);
        return;
      }

      if (evento.key === "Tab" && raiz.current) {
        const focaveis = Array.from(raiz.current.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
          (el) => el.offsetParent !== null || el === document.activeElement,
        );
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (!primeiro || !ultimo) {
          evento.preventDefault();
          return;
        }
        const ativo = document.activeElement;
        const dentro = ativo instanceof Node && raiz.current.contains(ativo);
        if (evento.shiftKey && (ativo === primeiro || !dentro)) {
          evento.preventDefault();
          ultimo.focus();
        } else if (!evento.shiftKey && (ativo === ultimo || !dentro)) {
          evento.preventDefault();
          primeiro.focus();
        }
      }
    };

    document.addEventListener("keydown", aoTeclar, true);
    return () => document.removeEventListener("keydown", aoTeclar, true);
  }, []);

  /**
   * Entra ou sai da tela cheia.
   *
   * ⚠️ `automatica` é a abertura do modal, e ela NÃO CAI PARA O MODO IMERSIVO. O imersivo é o
   * consolo para quem PEDIU tela cheia num navegador que não a dá (iPhone): esconde a barra e as
   * setas, e o Esc passa a desfazer isso em vez de fechar. Na abertura automática isso seria uma
   * surpresa: o visualizador abriria sem botões e exigiria DOIS Esc para sair, num lugar onde
   * ninguém pediu nada. Sem tela cheia de verdade, fica o popup normal.
   */
  const alternarTelaCheia = useCallback((automatica = false) => {
    if (telaCheiaAtiva()) {
      sairDaTelaCheia();
      return;
    }
    if (imersiva) {
      setImersiva(false);
      return;
    }

    const elemento = raiz.current as ElementoComWebkit | null;
    // ⚠️ DECIDIDO NA HORA DO CLIQUE, sem `await` antes: a API só atende dentro do gesto, e o
    // `webkitEnterFullscreen` do iPhone também. Tentar a padrão, esperar falhar e só então cair no
    // fallback já seria fora do gesto.
    if (elemento && document.fullscreenEnabled && typeof elemento.requestFullscreen === "function") {
      let respondeu = false;
      void elemento.requestFullscreen().then(
        () => {
          respondeu = true;
        },
        () => {
          respondeu = true;
          if (!automatica) setImersiva(true);
        },
      );
      // ⚠️ A PROMESSA PODE FICAR PENDURADA PARA SEMPRE. Medido em 16/09/2026 num navegador
      // embutido (o painel de navegador do Claude): `fullscreenEnabled` verdadeiro, o pedido feito
      // dentro do clique, e nem resolve nem rejeita. Navegador embutido em aplicativo pode fazer o
      // mesmo (não medido). Sem este prazo o botão simplesmente não faz nada.
      if (relogioDaTelaCheia.current !== null) window.clearTimeout(relogioDaTelaCheia.current);
      relogioDaTelaCheia.current = window.setTimeout(() => {
        relogioDaTelaCheia.current = null;
        if (!respondeu && !telaCheiaAtiva() && !automatica) setImersiva(true);
      }, 900);
      return;
    }
    if (elemento && typeof elemento.webkitRequestFullscreen === "function") {
      elemento.webkitRequestFullscreen();
      return;
    }
    const player = video.current as null | VideoComWebkit;
    if (item?.tipo === "video" && player && typeof player.webkitEnterFullscreen === "function") {
      // ⚠️ SÓ A PEDIDO: o player nativo do iPhone cobre a tela e tira o popup de cena. Abrir
      // assim sozinho tiraria a galeria (setas, contador) de quem só quis ver a primeira foto.
      if (!automatica) player.webkitEnterFullscreen();
      return;
    }
    if (!automatica) setImersiva(true);
  }, [imersiva, item?.tipo]);

  // ── ABRIR JÁ EM TELA CHEIA ───────────────────────────────────────────────────────────────────
  //
  // Lucas (22/09/2026), com o print do vídeo do Cecílio Rocha aberto num quadradinho: *"quando
  // clicar abrir em full, estou tendo que clicar"* e *"o video tem que abrir em fulltela"*. Quem
  // está com o cliente na frente não quer dois cliques para ver a foto grande.
  //
  // ⚠️ SÓ UMA VEZ POR ABERTURA, e é isso que impede o laço: quem sai da tela cheia (Esc, gesto do
  // navegador, botão) fica fora, e trocar de foto não arrasta de volta. `jaPediu` mora num ref
  // porque o efeito não pode depender dele sem rodar de novo.
  //
  // ⚠️ E DEPENDE DA ATIVAÇÃO DO CLIQUE QUE ABRIU O MODAL. `requestFullscreen` só é atendido dentro
  // de um gesto; o navegador mantém a ativação por alguns segundos depois dele, e a montagem do
  // modal cabe nessa janela. Quando não cabe (abertura por teclado, por exemplo), o pedido é
  // recusado e o próprio `alternarTelaCheia` cai no modo imersivo — que é o mesmo resultado visual.
  const jaPediuTelaCheia = useRef(false);
  useEffect(() => {
    if (jaPediuTelaCheia.current) return;
    jaPediuTelaCheia.current = true;
    if (telaCheiaAtiva()) return;
    alternarTelaCheia(true);
  }, [alternarTelaCheia]);

  const aoTocar = (evento: PointerEventDoReact<HTMLDivElement>) => {
    if (evento.pointerType === "mouse") return;
    inicioDoArrasto.current = { x: evento.clientX, y: evento.clientY };
  };

  const aoSoltar = (evento: PointerEventDoReact<HTMLDivElement>) => {
    const inicio = inicioDoArrasto.current;
    inicioDoArrasto.current = null;
    // No vídeo o arrasto é da barra de progresso, não da galeria.
    if (!inicio || item?.tipo === "video") return;
    const passo = passoDoArrasto(evento.clientX - inicio.x, evento.clientY - inicio.y);
    if (passo !== 0) andar(passo);
  };

  if (!item) return null;

  const expandida = cheia || imersiva;
  const titulo = item.legenda || item.nome || (item.tipo === "video" ? "Vídeo" : "Foto");

  return (
    <div
      aria-label={rotulo}
      aria-modal="true"
      className={`vdm${imersiva ? " vdm--imersiva" : ""}`}
      ref={raiz}
      role="dialog"
    >
      <style>{ESTILO}</style>

      {/* Clicar no fundo (fora da mídia e dos botões) fecha, como em todo popup. */}
      <div aria-hidden="true" className="vdm-fundo" onClick={onFechar} />

      <header className="vdm-barra">
        <span aria-live="polite" className="vdm-contador">
          {contadorDaGaleria(indice, total)}
        </span>
        <span className="vdm-titulo" title={titulo}>
          {titulo}
        </span>
        <button
          aria-label={expandida ? "Sair da tela cheia" : "Ver em tela cheia"}
          className="vdm-botao"
          onClick={() => alternarTelaCheia()}
          title={expandida ? "Sair da tela cheia" : "Tela cheia"}
          type="button"
        >
          {expandida ? <Minimize2 aria-hidden="true" size={18} /> : <Maximize2 aria-hidden="true" size={18} />}
        </button>
        <button
          aria-label="Fechar"
          className="vdm-botao"
          onClick={onFechar}
          ref={botaoFechar}
          title="Fechar (Esc)"
          type="button"
        >
          <X aria-hidden="true" size={20} />
        </button>
      </header>

      <div className="vdm-palco" onPointerDown={aoTocar} onPointerUp={aoSoltar}>
        <Midia item={item} key={item.id} video={video} />
      </div>

      {total > 1 ? (
        <>
          <button
            aria-label="Anterior"
            className="vdm-seta vdm-seta--esquerda"
            onClick={() => andar(-1)}
            title="Anterior (seta para a esquerda)"
            type="button"
          >
            <ChevronLeft aria-hidden="true" size={28} />
          </button>
          <button
            aria-label="Próxima"
            className="vdm-seta vdm-seta--direita"
            onClick={() => andar(1)}
            title="Próxima (seta para a direita)"
            type="button"
          >
            <ChevronRight aria-hidden="true" size={28} />
          </button>
        </>
      ) : null}

      {item.legenda && item.nome && item.legenda !== item.nome ? (
        <p className="vdm-legenda">{item.nome}</p>
      ) : null}

      {/* No modo imersivo a barra some; sobra este botão discreto para voltar. */}
      {imersiva ? (
        <button
          aria-label="Sair da tela cheia"
          className="vdm-botao vdm-sair-imersiva"
          onClick={() => setImersiva(false)}
          type="button"
        >
          <Minimize2 aria-hidden="true" size={18} />
        </button>
      ) : null}
    </div>
  );
}

/** A mídia em si, remontada a cada item (`key`): o carregando/erro de uma não vaza para a outra. */
function Midia({
  item,
  video,
}: {
  item: MidiaDoVisualizador;
  video: RefObject<HTMLVideoElement | null>;
}) {
  const [estado, setEstado] = useState<"carregando" | "erro" | "pronto">(
    item.url ? "carregando" : "erro",
  );

  if (!item.url || estado === "erro") {
    return (
      <div className="vdm-erro" role="status">
        <ImageOff aria-hidden="true" size={36} />
        <p>Não foi possível exibir este arquivo neste navegador.</p>
      </div>
    );
  }

  // ⚠️ O PDF ABRE NO VISUALIZADOR DO PRÓPRIO NAVEGADOR (22/09/2026). Lucas, sobre a apresentação
  // do Garden Resort: *"um arquivo só: o PDF"* e *"tem que abrir em full"*. Um `iframe` com a URL
  // assinada entrega páginas, zoom e busca de graça, e em tela cheia ocupa tudo -- desenhar o PDF
  // página a página (pdf.js) custaria um megabyte de JavaScript para fazer pior.
  //
  // ⚠️ `sandbox` NÃO ENTRA AQUI. O Chrome desliga o próprio leitor de PDF em iframe com sandbox, e
  // a página passa a BAIXAR o arquivo em vez de mostrá-lo. O conteúdo vem do nosso bucket, com URL
  // assinada de uma hora, e não de terceiro.
  if (item.tipo === "documento") {
    return (
      <>
        <iframe
          className="vdm-midia vdm-documento"
          onError={() => setEstado("erro")}
          onLoad={() => setEstado("pronto")}
          src={item.url ?? undefined}
          title={item.nome ?? "Documento"}
        />
        {estado === "carregando" ? <Carregando /> : null}
      </>
    );
  }

  if (item.tipo === "video") {
    return (
      <>
        {/* ⚠️ `playsInline`: sem ele o iPhone abre o player nativo por conta própria no play, e o
            popup some atrás. A tela cheia do iPhone é pelo botão, quando a pessoa pede. */}
        <video
          autoPlay
          className="vdm-midia"
          controls
          onError={() => setEstado("erro")}
          onLoadedData={() => setEstado("pronto")}
          playsInline
          poster={item.miniaturaUrl ?? undefined}
          preload="metadata"
          ref={video}
          src={item.url}
        />
        {estado === "carregando" ? <Carregando /> : null}
      </>
    );
  }

  return (
    <>
      {/* A miniatura segura o lugar enquanto o original (até 25 MB) chega. */}
      {estado === "carregando" && item.miniaturaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- URL assinada do Storage, sem otimizador
        <img alt="" aria-hidden="true" className="vdm-midia vdm-previa" src={item.miniaturaUrl} />
      ) : null}
      {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada do Storage, sem otimizador */}
      <img
        alt={item.legenda || item.nome || "Foto"}
        className={`vdm-midia${estado === "carregando" ? " vdm-midia--carregando" : ""}`}
        draggable={false}
        onError={() => setEstado("erro")}
        onLoad={() => setEstado("pronto")}
        src={item.url}
      />
      {estado === "carregando" ? <Carregando /> : null}
    </>
  );
}

function Carregando() {
  return (
    <span aria-label="Carregando" className="vdm-carregando" role="status">
      <Loader2 aria-hidden="true" size={32} />
    </span>
  );
}

// ⚠️ CSS EM TEXTO, com prefixo `vdm-`, porque o componente não pode depender do Tailwind do hub nem
// do tema do portal (ver o cabeçalho), e estilo inline não alcança :hover, :focus-visible nem a
// media query de movimento reduzido.
const ESTILO = `
.vdm {
  position: fixed; inset: 0; z-index: 2147483000;
  display: flex; flex-direction: column;
  background: rgb(8 8 10 / .96); color: #f5f6f8;
  /* O popup mora no <body>, fora da casca que define a fonte da tela: sem isto, cai na serifada
     padrão do navegador em qualquer página que só pinta a fonte num contêiner. */
  font-family: var(--font-sans, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
  padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);
}
.vdm-fundo { position: absolute; inset: 0; }
.vdm-barra {
  position: relative; z-index: 2;
  display: flex; align-items: center; gap: 8px;
  padding: 10px 12px; min-height: 56px;
  background: linear-gradient(rgb(0 0 0 / .55), rgb(0 0 0 / 0));
}
.vdm-contador { font-size: 13px; font-variant-numeric: tabular-nums; opacity: .85; white-space: nowrap; }
.vdm-titulo {
  flex: 1; min-width: 0; font-size: 14px; font-weight: 600;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.vdm-botao {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; flex-shrink: 0;
  border: 0; border-radius: 999px; cursor: pointer;
  background: rgb(255 255 255 / .1); color: inherit;
}
.vdm-botao:hover { background: rgb(255 255 255 / .2); }
.vdm-botao:focus-visible, .vdm-seta:focus-visible { outline: 2px solid #f5f6f8; outline-offset: 2px; }
.vdm-palco {
  position: relative; z-index: 1; flex: 1; min-height: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 0 64px 16px; touch-action: pan-y pinch-zoom;
  pointer-events: none;
}
.vdm-palco > * { pointer-events: auto; }
/* ⚠️ width/height 100%, E NAO SO max-* (22/09/2026). Com o teto sozinho, a midia MENOR que
   o palco aparecia no tamanho natural: o video do Cecilio Rocha (1024x512) abria num
   quadradinho no meio da tela preta, e o Lucas mandou print. object-fit: contain garante
   que ampliar nao deforma nem corta. (Sem crase neste comentario: o CSS mora numa template
   string, e a crase a fecharia.) */
.vdm-midia {
  display: block; width: 100%; height: 100%; max-width: 100%; max-height: 100%;
  object-fit: contain; border-radius: 6px; background: transparent;
  user-select: none;
}
/* O quadro do PDF nao tem proporcao propria: ele ocupa o palco inteiro, com fundo claro para a
   pagina nao aparecer sobre o preto enquanto carrega. */
.vdm-documento { border: 0; background: #fff; }
.vdm-previa { position: absolute; filter: blur(6px); opacity: .6; max-width: calc(100% - 128px); max-height: calc(100% - 16px); }
.vdm-midia--carregando { opacity: 0; }
.vdm-carregando { position: absolute; display: inline-flex; pointer-events: none; }
.vdm-carregando svg { animation: vdm-girar 1s linear infinite; }
.vdm-erro {
  display: flex; flex-direction: column; align-items: center; gap: 10px;
  max-width: 320px; text-align: center; font-size: 14px; opacity: .85;
}
.vdm-erro p { margin: 0; }
.vdm-seta {
  position: absolute; z-index: 2; top: 50%; transform: translateY(-50%);
  display: inline-flex; align-items: center; justify-content: center;
  width: 48px; height: 48px; border: 0; border-radius: 999px; cursor: pointer;
  background: rgb(255 255 255 / .1); color: inherit;
}
.vdm-seta:hover { background: rgb(255 255 255 / .22); }
.vdm-seta--esquerda { left: max(8px, env(safe-area-inset-left)); }
.vdm-seta--direita { right: max(8px, env(safe-area-inset-right)); }
.vdm-legenda {
  position: relative; z-index: 2; margin: 0; padding: 0 16px 14px;
  font-size: 13px; text-align: center; opacity: .8;
}
.vdm-sair-imersiva { position: absolute; z-index: 3; top: max(10px, env(safe-area-inset-top)); right: max(10px, env(safe-area-inset-right)); opacity: .55; }
.vdm--imersiva { background: #000; }
.vdm--imersiva .vdm-barra, .vdm--imersiva .vdm-seta, .vdm--imersiva .vdm-legenda { display: none; }
.vdm--imersiva .vdm-palco { padding: 0; }
.vdm--imersiva .vdm-midia { border-radius: 0; }
.vdm:fullscreen { background: #000; }
@media (max-width: 640px) {
  .vdm-palco { padding: 0 0 12px; }
  .vdm-seta { width: 40px; height: 40px; background: rgb(0 0 0 / .45); }
  .vdm-previa { max-width: 100%; }
}
@media (prefers-reduced-motion: no-preference) {
  .vdm { animation: vdm-surgir .16s ease-out; }
  .vdm-midia { transition: opacity .18s ease-out; }
}
@keyframes vdm-surgir { from { opacity: 0; } to { opacity: 1; } }
@keyframes vdm-girar { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  .vdm-carregando svg { animation-duration: 2.4s; }
}
`;
