"use client";

import { X } from "lucide-react";
import {
  type CSSProperties,
  type KeyboardEvent as KeyboardEventDoReact,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { fonte } from "@/modules/publico/ui/tokens";

import { T } from "../tema";

// AS PEÇAS DE TELA DO CADASTRO DE PRODUTO E DE UNIDADE: a janela e o campo com rótulo.
//
// ⚠️ ESTILO EM CLASSE COM OS TOKENS `T`, E NÃO TAILWIND. O portal fala variável CSS (`--inc-*`), e
// as classes do hub só funcionam dentro da moldura da TelaContratos. Com `T` a peça funciona nos
// dois lugares: no portal vale a cor do portal, e no hub os fallbacks `--uix-*` acompanham o tema
// de lá (a explicação inteira está em `T`, no tema.tsx). E classe, e não estilo inline, porque
// estilo inline não alcança :focus-visible nem a media query do celular.
//
// ⚠️ A JANELA NÃO FECHA CLICANDO FORA. É um formulário: um clique distraído no fundo apagaria o que
// a pessoa digitou, e no celular o "fora" é uma faixa que o polegar acerta sem querer. Fecha pelo
// X, pelo Esc e pelo botão da própria tela, e nenhum dos três enquanto a gravação está no ar.

const CSS_DA_JANELA = `
  .inc-janela-fundo {
    align-items: center; background: rgb(0 0 0 / .55); display: flex; inset: 0;
    justify-content: center; padding: 24px; position: fixed; z-index: 70;
  }
  .inc-janela {
    background: ${T.page}; border: 1px solid ${T.border}; border-radius: 14px;
    box-shadow: ${T.sombra}; box-sizing: border-box; color: ${T.text}; display: flex;
    flex-direction: column; font-family: ${fonte}; max-height: min(92dvh, 860px); outline: none;
    overflow: hidden; width: min(94vw, var(--inc-janela-largura, 520px));
  }
  .inc-janela-topo {
    align-items: flex-start; border-bottom: 1px solid ${T.border}; display: flex; gap: 12px;
    justify-content: space-between; padding: 12px 16px;
  }
  .inc-janela-titulo { font-size: 14px; font-weight: 650; line-height: 20px; margin: 0; }
  .inc-janela-descricao { color: ${T.muted}; font-size: 11.5px; line-height: 16px; margin: 2px 0 0; }
  .inc-janela-fechar {
    align-items: center; background: transparent; border: 1px solid ${T.border}; border-radius: 8px;
    color: ${T.sub}; cursor: pointer; display: inline-flex; flex: 0 0 auto; height: 32px;
    justify-content: center; padding: 0; width: 32px;
  }
  .inc-janela-fechar:disabled { cursor: default; opacity: .5; }
  /* align-content: start porque no celular a janela tem a altura da tela, e sem ele o grid
     esticaria as linhas do formulário para preencher o que sobra (buracos entre os campos). */
  .inc-janela-corpo {
    align-content: start; display: grid; flex: 1 1 auto; gap: 12px; min-height: 0; overflow: auto; padding: 16px;
  }
  .inc-janela-rodape {
    align-items: center; border-top: 1px solid ${T.border}; display: flex; flex-wrap: wrap; gap: 8px;
    justify-content: flex-end; padding: 12px 16px;
  }
  /* NO CELULAR A JANELA OCUPA A TELA: um cartão de 94vw com teclado aberto deixa dois campos à
     vista. O rodapé respeita a barra de gestos do iPhone. */
  @media (max-width: 640px) {
    .inc-janela-fundo { align-items: stretch; padding: 0; }
    .inc-janela { border: none; border-radius: 0; height: 100dvh; max-height: none; width: 100%; }
    .inc-janela-rodape { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
  }
`;

/**
 * Os estilos do formulário, compartilhados pelas duas telas. Vêm num <style> próprio porque o
 * `CadastroDeUnidades` também é montado FORA da janela (direto numa aba).
 */
export const CSS_DO_FORMULARIO = `
  .inc-form-grade { display: grid; gap: 10px 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .inc-form-grade--3 { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .inc-form-inteira { grid-column: 1 / -1; }
  .inc-form-item { align-content: start; display: grid; gap: 5px; min-width: 0; }
  .inc-form-rotulo {
    color: ${T.muted}; font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase;
  }
  .inc-form-campo {
    background: ${T.soft}; border: 1px solid ${T.border}; border-radius: 8px; box-sizing: border-box;
    color: ${T.text}; font: inherit; font-size: 13px; min-height: 38px; padding: 8px 10px; width: 100%;
  }
  /* ALTURA CRAVADA em campo e seletor: o <select> tem altura própria em cada navegador, e na mesma
     linha do formulário os dois ficavam desalinhados. */
  input.inc-form-campo, select.inc-form-campo { height: 40px; }
  /* O exemplo no campo vazio não pode parecer valor preenchido (no escuro, o muted é claro). */
  .inc-form-item input.inc-form-campo::placeholder { color: ${T.muted}; opacity: .6; }
  .inc-form-campo[aria-invalid="true"] { border-color: ${T.danger}; }
  .inc-form-campo:disabled { opacity: .6; }
  .inc-form-dica { color: ${T.muted}; font-size: 11px; line-height: 15px; margin: 0; }
  .inc-form-erro { color: ${T.danger}; font-size: 11.5px; font-weight: 600; line-height: 15px; margin: 0; }
  .inc-form-aviso { color: ${T.gold}; font-size: 11px; line-height: 15px; margin: 0; }
  .inc-foco:focus-visible, .inc-form-campo:focus-visible, .inc-janela-fechar:focus-visible {
    outline: 2px solid ${T.gold}; outline-offset: 1px;
  }
  .inc-botao {
    align-items: center; background: ${T.btnBg}; border: none; border-radius: 9px; color: ${T.btnFg};
    cursor: pointer; display: inline-flex; font: inherit; font-size: 13px; font-weight: 650; gap: 6px;
    justify-content: center; min-height: 38px; padding: 8px 18px; white-space: nowrap;
  }
  .inc-botao--discreto { background: transparent; border: 1px solid ${T.border}; color: ${T.sub}; font-weight: 600; }
  .inc-botao:disabled { cursor: default; opacity: .5; }
  .inc-caixa { background: ${T.card}; border: 1px solid ${T.border}; border-radius: 12px; padding: 12px; }
  .inc-recado { border-radius: 10px; font-size: 12.5px; line-height: 1.45; margin: 0; padding: 9px 12px; }
  .inc-recado--erro { background: ${T.dangerBg}; color: ${T.danger}; }
  .inc-recado--ok { background: ${T.okBg}; color: ${T.ok}; }
  .inc-recado--neutro { background: ${T.soft}; color: ${T.sub}; }
  .inc-so-leitor {
    border: 0; clip: rect(0 0 0 0); height: 1px; margin: -1px; overflow: hidden; padding: 0;
    position: absolute; white-space: nowrap; width: 1px;
  }
  @keyframes inc-cad-girar { to { transform: rotate(360deg); } }
  .inc-cad-girando { animation: inc-cad-girar 1s linear infinite; }
  @media (prefers-reduced-motion: reduce) { .inc-cad-girando { animation: none; } }
  @media (max-width: 640px) {
    .inc-form-grade, .inc-form-grade--3 { grid-template-columns: minmax(0, 1fr); }
    /* 16px no celular: abaixo disso o Safari do iPhone dá zoom na tela inteira ao tocar o campo.
       E 44px de altura, o alvo de toque mínimo. */
    .inc-form-campo { font-size: 16px; }
    input.inc-form-campo, select.inc-form-campo { height: 44px; }
  }
`;

/** O que recebe foco com Tab dentro da janela. */
const FOCAVEIS = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/**
 * ⚠️ O QUE ESTÁ NUM PAINEL `hidden` NÃO CONTA. O cadastro de unidades deixa as duas abas montadas e
 * esconde uma; sem este filtro, o "último" da janela seria um botão da aba escondida, `.focus()`
 * nele não pega, e o Tab escaparia da janela.
 */
function focaveisDe(raiz: HTMLElement): HTMLElement[] {
  return Array.from(raiz.querySelectorAll<HTMLElement>(FOCAVEIS)).filter(
    (el) => el.getAttribute("tabindex") !== "-1" && !el.closest('[aria-hidden="true"], [hidden]'),
  );
}

/**
 * A janela do cadastro: fundo, cartão, título, corpo que rola e rodapé.
 *
 * ACESSÍVEL DE VERDADE, e não só com `role`: o foco entra na janela ao abrir (no elemento marcado
 * com `data-foco-inicial`, ou no primeiro campo), fica preso nela com Tab e Shift+Tab, volta para
 * quem abriu ao fechar, e o Esc fecha. A página por baixo não rola enquanto ela está aberta.
 *
 * ⚠️ O ESC É OUVIDO NA JANELA, NÃO NO DOCUMENTO. Um campo com lista de sugestões (a cidade) usa o
 * Esc para fechar a própria lista e para a propagação; ouvindo no documento em fase de captura, a
 * janela fecharia antes de o campo ter a chance, e a pessoa perderia o formulário tentando só
 * esconder a lista.
 */
export function JanelaDoCadastro({
  aoFechar,
  bloqueada = false,
  children,
  descricao,
  largura = 520,
  rodape,
  titulo,
}: {
  aoFechar: () => void;
  /** Enquanto grava: Esc e X não fecham (fechar não cancela o POST, só esconde o resultado). */
  bloqueada?: boolean;
  children: ReactNode;
  descricao?: ReactNode;
  largura?: number;
  rodape?: ReactNode;
  titulo: string;
}) {
  const painel = useRef<HTMLDivElement | null>(null);
  const idTitulo = useId();
  const idDescricao = useId();

  // ⚠️ AS FUNÇÕES MAIS RECENTES NUM REF: o efeito de abertura roda UMA vez. Reinstalar a cada render
  // (o `aoFechar` do pai costuma ser uma arrow nova) devolveria o foco ao botão de abrir no meio da
  // digitação.
  const atual = useRef({ aoFechar, bloqueada });
  useEffect(() => {
    atual.current = { aoFechar, bloqueada };
  }, [aoFechar, bloqueada]);

  useEffect(() => {
    const antes = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflowAntes = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const raiz = painel.current;
    if (raiz) {
      const marcado = raiz.querySelector<HTMLElement>("[data-foco-inicial]");
      const primeiro = focaveisDe(raiz).find((el) => !el.classList.contains("inc-janela-fechar"));
      (marcado ?? primeiro ?? raiz).focus();
    }

    // O foco que escapa (leitor de tela, clique numa área sem foco, um alerta do navegador) volta
    // para dentro: Tab preso sozinho não cobre esses caminhos.
    const aoFocar = (evento: FocusEvent) => {
      const alvo = evento.target;
      const dentro = painel.current;
      if (!dentro || (alvo instanceof Node && dentro.contains(alvo))) return;
      (focaveisDe(dentro)[0] ?? dentro).focus();
    };
    document.addEventListener("focusin", aoFocar);

    // O teclado com o foco FORA da janela (no <body>, depois que o botão focado sumiu ou ficou
    // desabilitado): sem isto, Esc e Tab só voltariam a funcionar depois de um clique. De dentro da
    // janela o Esc nem chega aqui, porque `aoTeclar` para a propagação dele.
    const aoTeclarFora = (evento: KeyboardEvent) => {
      const dentro = painel.current;
      if (!dentro || (evento.target instanceof Node && dentro.contains(evento.target))) return;
      if (evento.key === "Escape") {
        evento.preventDefault();
        if (!atual.current.bloqueada) atual.current.aoFechar();
      } else if (evento.key === "Tab") {
        evento.preventDefault();
        (focaveisDe(dentro)[0] ?? dentro).focus();
      }
    };
    document.addEventListener("keydown", aoTeclarFora);

    return () => {
      document.removeEventListener("keydown", aoTeclarFora);
      document.removeEventListener("focusin", aoFocar);
      document.body.style.overflow = overflowAntes;
      if (antes && document.contains(antes)) antes.focus();
    };
  }, []);

  const aoTeclar = (evento: KeyboardEventDoReact<HTMLDivElement>) => {
    if (evento.key === "Escape") {
      evento.preventDefault();
      evento.stopPropagation();
      if (!atual.current.bloqueada) atual.current.aoFechar();
      return;
    }

    if (evento.key !== "Tab" || !painel.current) return;
    const focaveis = focaveisDe(painel.current);
    const primeiro = focaveis[0];
    const ultimo = focaveis[focaveis.length - 1];
    if (!primeiro || !ultimo) {
      evento.preventDefault();
      return;
    }
    const ativo = document.activeElement;
    if (evento.shiftKey && (ativo === primeiro || ativo === painel.current)) {
      evento.preventDefault();
      ultimo.focus();
    } else if (!evento.shiftKey && ativo === ultimo) {
      evento.preventDefault();
      primeiro.focus();
    }
  };

  return (
    <div
      className="inc-janela-fundo"
      // Clique no fundo não tira o foco da janela (e não fecha: ver o cabeçalho do arquivo).
      onMouseDown={(evento) => {
        if (evento.target === evento.currentTarget) evento.preventDefault();
      }}
    >
      <style>{CSS_DA_JANELA}</style>
      <style>{CSS_DO_FORMULARIO}</style>
      <div
        aria-describedby={descricao ? idDescricao : undefined}
        aria-labelledby={idTitulo}
        aria-modal="true"
        className="inc-janela"
        onKeyDown={aoTeclar}
        ref={painel}
        role="dialog"
        style={{ "--inc-janela-largura": `${largura}px` } as CSSProperties}
        tabIndex={-1}
      >
        <div className="inc-janela-topo">
          <div style={{ minWidth: 0 }}>
            <h2 className="inc-janela-titulo" id={idTitulo}>
              {titulo}
            </h2>
            {descricao ? (
              <p className="inc-janela-descricao" id={idDescricao}>
                {descricao}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Fechar"
            className="inc-janela-fechar"
            disabled={bloqueada}
            onClick={aoFechar}
            title={bloqueada ? "Aguarde terminar de gravar" : "Fechar"}
            type="button"
          >
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="inc-janela-corpo">{children}</div>
        {rodape ? <div className="inc-janela-rodape">{rodape}</div> : null}
      </div>
    </div>
  );
}

export type AtributosDoControle = {
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  "aria-required"?: true;
  id: string;
};

/**
 * Rótulo, controle, dica e erro, ligados por id: o leitor de tela lê o erro junto com o campo, e
 * tocar no rótulo foca o campo no celular.
 *
 * O erro SUBSTITUI o aviso e a dica no mesmo lugar: três linhas empilhadas embaixo de um campo
 * estreito empurram o formulário e ninguém lê nenhuma.
 */
export function CampoDoCadastro({
  aviso,
  classe,
  controle,
  dica,
  erro,
  obrigatorio = false,
  rotulo,
}: {
  aviso?: null | string;
  classe?: string;
  controle: (atributos: AtributosDoControle) => ReactNode;
  dica?: null | string;
  erro?: null | string;
  obrigatorio?: boolean;
  rotulo: string;
}) {
  const id = useId();
  const idNota = `${id}-nota`;
  const nota = erro ?? aviso ?? dica ?? null;

  return (
    <div className={classe ? `inc-form-item ${classe}` : "inc-form-item"}>
      <label className="inc-form-rotulo" htmlFor={id}>
        {rotulo}
        {obrigatorio ? (
          <>
            <span aria-hidden="true"> *</span>
            <span className="inc-so-leitor"> (obrigatório)</span>
          </>
        ) : null}
      </label>
      {controle({
        ...(nota ? { "aria-describedby": idNota } : {}),
        ...(erro ? { "aria-invalid": true } : {}),
        ...(obrigatorio ? { "aria-required": true } : {}),
        id,
      })}
      {nota ? (
        // Sem role="alert" aqui: com cinco campos errados seriam cinco anúncios seguidos. Quem
        // anuncia é o resumo da tela, e o foco vai para o primeiro campo errado.
        <p className={erro ? "inc-form-erro" : aviso ? "inc-form-aviso" : "inc-form-dica"} id={idNota}>
          {nota}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Os cabeçalhos da chamada, pelas DUAS PORTAS (o mesmo desenho do `ArquivosDoProduto`): no portal
 * o proxy libera /api/incorporador/* pelo cookie da sessão e não vai token nenhum; no hub a rota
 * pede o Bearer do Apolo.
 */
export async function cabecalhosDaChamada(semToken: boolean): Promise<Record<string, string>> {
  if (semToken) return { "Content-Type": "application/json" };
  const token = await getApoloAccessToken();
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}
