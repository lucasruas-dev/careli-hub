// O TEMA DO PORTAL DO INCORPORADOR — a parte que é decisão, não pintura.
//
// Pedido do Lucas (18/08/2026): *"um detalhe, temos que disponibilizar o dark também"*. O portal já
// tinha as duas paletas, mas quem escolhia era o SISTEMA OPERACIONAL do cliente
// (`prefers-color-scheme`): quem trabalha com o notebook no claro nunca via o escuro, e vice-versa.
// Faltava a escolha ser DELE.
//
// Este arquivo é de propósito sem React e sem DOM: são as duas perguntas que decidem tudo —
// "qual tema vale agora?" e "o mapa vai claro ou escuro?" — e as duas precisam responder igual em
// três lugares que não se falam (o script que pinta antes da tela, o componente do portal e a rota
// que serve o masterplan). Regra que mora em três lugares é regra que diverge; aqui ela mora em um.

/** O que a PESSOA escolheu. "sistema" segue o aparelho; é uma escolha como as outras. */
export type TemaEscolhido = "claro" | "escuro" | "sistema";

/**
 * O TEMA DE QUEM NUNCA ESCOLHEU — e não é mais o do aparelho.
 *
 * Decisão do Lucas em 18/08/2026, vendo o portal no escuro pela primeira vez: *"ficou muito bom
 * esse modo dark, muito bom mesmo, quero ele padrão daqui pra frente"*. Então o loteador que abre
 * o portal pela primeira vez vê o ESCURO, tenha o notebook dele no claro ou não; quem preferir
 * outra coisa troca no alternador, e quem quiser o comportamento antigo escolhe "seguir o
 * aparelho" de propósito.
 *
 * ⚠️ ISTO É O PADRÃO DE QUEM NÃO ESCOLHEU, NÃO UM ATALHO PARA "sistema". As duas coisas eram a
 * mesma antes desta data (storage vazio caía em "sistema"), e é justamente essa colagem que não
 * pode voltar: sem separar, clicar em "seguir o aparelho" viraria indistinguível de nunca ter
 * clicado, e o portal ignoraria a escolha explícita de quem quer seguir o sistema.
 */
export const TEMA_PADRAO_DO_PORTAL: TemaEscolhido = "escuro";

/**
 * A escolha inicial do PORTAL: o que está salvo, ou o padrão quando não há nada salvo.
 *
 * ⚠️ SÓ PARA O PORTAL. `lerTemaEscolhido` continua caindo em "sistema" para entrada desconhecida,
 * e é ela que a rota do masterplan usa: mudar aquele fallback faria o mapa parar de ser clareado
 * quando ninguém manda tema (link antigo, portal personalizado do Cecílio), trocando a aparência
 * de quem não pediu nada.
 */
export function escolhaInicialDoPortal(
  bruto: null | string | undefined,
  /**
   * Portal PERSONALIZADO (Cecílio)? Ele também escolhe o tema desde 18/08/2026, mas o ponto de
   * partida dele continua sendo o aparelho: mudar o padrão de um portal que já está no ar e
   * aprovado trocaria a cara do sistema dele sem ninguém pedir.
   */
  personalizado = false,
): TemaEscolhido {
  const cru = String(bruto ?? "").trim().toLowerCase();
  if (cru === "claro" || cru === "escuro" || cru === "sistema") return cru;

  return personalizado ? "sistema" : TEMA_PADRAO_DO_PORTAL;
}

/** O que a TELA usa de fato, depois de resolver o "sistema" contra a preferência do aparelho. */
export type TemaEfetivo = "claro" | "escuro";

/**
 * A chave do localStorage. Prefixo `careli:` igual ao do tema do hub (`careli:hub-theme`), e chave
 * SEPARADA de propósito: o portal é do cliente do incorporador, o hub é da equipe da Careli — quem
 * usa os dois não deve ter o tema de um mandando no outro.
 */
export const CHAVE_TEMA = "careli:incorporador-tema";

/**
 * O atributo que carrega a escolha até o CSS, no `<html>`.
 *
 * ⚠️ ELE SÓ EXISTE QUANDO HÁ ESCOLHA EXPLÍCITA. Ausência do atributo = "sistema", que é o que faz a
 * media query voltar a mandar sem precisar de JavaScript nenhum.
 */
export const ATRIBUTO_TEMA = "data-inc-tema";

/**
 * Lê um tema escolhido de qualquer entrada crua (localStorage, query string, atributo do DOM).
 *
 * ⚠️ O QUE NÃO RECONHECE VIRA "sistema", e isso é a decisão segura: storage de outra versão, valor
 * digitado na URL ou lixo de extensão não podem travar o portal num tema que ninguém pediu.
 */
export function lerTemaEscolhido(bruto: null | string | undefined): TemaEscolhido {
  const valor = String(bruto ?? "").trim().toLowerCase();

  return valor === "claro" || valor === "escuro" ? valor : "sistema";
}

/**
 * O tema que vale AGORA: a escolha explícita vence sempre; "sistema" cai na preferência do aparelho.
 *
 * `sistemaPrefereEscuro` chega de fora (no navegador é o `matchMedia`) para esta função continuar
 * pura — e testável sem DOM.
 */
export function resolverTemaEfetivo(
  escolha: TemaEscolhido,
  sistemaPrefereEscuro: boolean,
): TemaEfetivo {
  if (escolha === "claro" || escolha === "escuro") return escolha;

  return sistemaPrefereEscuro ? "escuro" : "claro";
}

/**
 * A ROTA DO MASTERPLAN: clarear o arquivo ou servir como ele nasceu?
 *
 * O A-INTERNO nasce ESCURO (`data-uix-theme="dark"`) e a rota o clareia à força com `comTemaClaro`,
 * porque o portal era claro e tela escura dentro de moldura clara é duas paletas brigando na mesma
 * imagem. Com o portal em escuro o problema se inverte: o mapa clareado vira um retângulo branco no
 * meio da tela escura. A saída é não fazer nada — no escuro o arquivo original JÁ está certo.
 *
 * ⚠️ ISTO É APARÊNCIA E SÓ APARÊNCIA. O parâmetro não entra em autorização, escopo nem recorte: a
 * rota confere a sessão e recorta os lotes exatamente igual nos dois temas. Um `?tema=` chutado na
 * URL muda a cor do mapa de quem já tinha direito a vê-lo, e nada além disso.
 *
 * ⚠️ E O PADRÃO É CLAREAR. Sem parâmetro (portal antigo em cache, portal PERSONALIZADO do Cecílio,
 * link salvo) o comportamento é o de hoje, byte a byte.
 */
export function deveClarearMasterplan(temaDoPedido: null | string | undefined): boolean {
  return lerTemaEscolhido(temaDoPedido) !== "escuro";
}

/**
 * O SCRIPT QUE PINTA ANTES DA TELA APARECER.
 *
 * ⚠️ SEM ISTO O PORTAL PISCA BRANCO. A escolha mora no localStorage, que só existe no navegador: o
 * servidor renderiza sem saber dela, e se a aplicação esperasse o React montar, quem escolheu o
 * escuro veria a tela clara inteira por um quadro antes de virar. O jeito que o repo já usa para
 * rodar coisa antes do resto (`<script dangerouslySetInnerHTML>` no começo do `<body>`, como o
 * sinal de gravação do Chronos no `app/layout.tsx`) resolve: o navegador executa isto ENQUANTO
 * lê o HTML, antes de pintar qualquer pixel do portal, e o atributo já está no `<html>` quando o
 * CSS do tema é aplicado.
 *
 * Ele não escreve nada, não decide nada e não fala com a rede: copia a escolha do storage para o
 * atributo. Storage bloqueado (modo restrito, iframe de terceiro) cai no `catch` e o portal segue
 * no tema do sistema, que é o comportamento de antes do alternador existir.
 *
 * ⚠️ O PORTAL PERSONALIZADO (Cecílio) NÃO RECEBE ESTE SCRIPT — ver `app/incorporador/[slug]/layout.tsx`.
 */
export function scriptDeTemaAntesDaPintura(padrao: TemaEscolhido = TEMA_PADRAO_DO_PORTAL): string {
  return [
    "(function(){",
    "var raiz=document.documentElement;",
    `var padrao=${JSON.stringify(padrao)};`,
    "var escolha=null;",
    `try{escolha=window.localStorage.getItem(${JSON.stringify(CHAVE_TEMA)});}catch(_erro){}`,
    `if(escolha==="claro"||escolha==="escuro"){raiz.setAttribute(${JSON.stringify(ATRIBUTO_TEMA)},escolha);}`,
    `else if(escolha==="sistema"||padrao==="sistema"){raiz.removeAttribute(${JSON.stringify(ATRIBUTO_TEMA)});}`,
    `else{raiz.setAttribute(${JSON.stringify(ATRIBUTO_TEMA)},padrao);}`,
    "})();",
  ].join("");
}

/** O script com o padrão do portal PADRÃO. Mantido para quem já importava a constante. */
export const SCRIPT_TEMA_ANTES_DA_PINTURA = [
  "(function(){",
  "var raiz=document.documentElement;",
  `var padrao=${JSON.stringify(TEMA_PADRAO_DO_PORTAL)};`,
  "var escolha=null;",
  `try{escolha=window.localStorage.getItem(${JSON.stringify(CHAVE_TEMA)});}catch(_erro){}`,
  // "sistema" é o ÚNICO caso que apaga o atributo: aí a media query volta a mandar. Sem escolha
  // nenhuma (primeira visita, storage bloqueado) entra o padrão do portal, hoje o escuro.
  `if(escolha==="claro"||escolha==="escuro"){raiz.setAttribute(${JSON.stringify(ATRIBUTO_TEMA)},escolha);}`,
  `else if(escolha==="sistema"){raiz.removeAttribute(${JSON.stringify(ATRIBUTO_TEMA)});}`,
  `else{raiz.setAttribute(${JSON.stringify(ATRIBUTO_TEMA)},padrao);}`,
  "})();",
].join("");
