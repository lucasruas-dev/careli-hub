// A ESCALA DO TÓTEM — de que tamanho a tela de reserva se desenha.
//
// ⚠️ ANTES ISSO ERA UM INTERRUPTOR, E O INTERRUPTOR ERRADO. A tela tinha dois tamanhos e
// escolhia entre eles por `document.fullscreenElement`: em tela cheia, tudo grande; fora dela,
// tudo pequeno. Dois problemas nasceram daí:
//
// 1. TELA CHEIA NÃO É TAMANHO. O Chrome aberto pelo atalho do posto (`--kiosk`) ocupa o monitor
//    inteiro SEM usar a Fullscreen API — `document.fullscreenElement` é null. A tela do evento
//    renderizava no tamanho de janelinha, justamente na máquina onde ela precisa ser lida de
//    longe. Ninguém tinha percebido porque nos testes a tela cheia era ligada no botão.
// 2. "GRANDE" NÃO É UM TAMANHO SÓ. Um monitor em pé (1080×1920) tem 1920px de altura; um tablet
//    deitado tem por volta de 800. A mesma escala nos dois deixa o tablet sem espaço: header e
//    rodapé comem a tela e sobra uma frestinha para os lotes — que é a única coisa que o
//    operador realmente usa.
//
// Agora o tamanho vem do ESPAÇO QUE A TELA TEM (a altura do quadro em px de CSS), que é o que
// de fato manda. Três degraus:
//
//   ampla    — monitor do posto, em pé ou deitado. Leitura a um metro ou mais.
//   media    — TABLET DEITADO no suporte (Lucas, 28/08/2026) e notebooks de 768px. Leitura de
//              perto, altura curta: os mesmos elementos, um degrau menores, para sobrar
//              prateleira de lotes.
//   compacta — a tela dentro do hub, com rail e abas em volta. Não é posto, é conferência.

export type EscalaDoTotem = "ampla" | "compacta" | "media";

export type MedidaDaTela = {
  /** window.innerHeight */
  alturaDaJanela: number;
  /** window.screen.height */
  alturaDaTela: number;
  /** a altura real do quadro da reserva, medida no elemento */
  alturaDoQuadro: number;
  /** Boolean(document.fullscreenElement) */
  telaCheiaPelaApi: boolean;
};

// Acima disto é monitor de posto: cabe a escala de leitura à distância.
const ALTURA_AMPLA = 1000;
// Abaixo disto (celular deitado, janela espremida) nem a escala média cabe.
const ALTURA_MEDIA = 560;
// A janela do navegador nunca bate no pixel com a tela do sistema; a folga absorve a diferença.
const FOLGA_DE_QUIOSQUE = 8;

/**
 * O quiosque é o que ocupa o monitor inteiro — POR QUALQUER CAMINHO. Vale a Fullscreen API (o
 * botão da tela) e vale o `--kiosk` do atalho do posto, que não passa pela API nenhuma: ali o
 * sinal é a janela ter a altura da própria tela, sem barra de endereço nem barra de título.
 */
export function emModoQuiosque(medida: MedidaDaTela): boolean {
  if (medida.telaCheiaPelaApi) return true;
  if (medida.alturaDaTela <= 0 || medida.alturaDaJanela <= 0) return false;
  return medida.alturaDaJanela >= medida.alturaDaTela - FOLGA_DE_QUIOSQUE;
}

export function escalaDoTotem(medida: MedidaDaTela): EscalaDoTotem {
  // Dentro do hub a tela divide espaço com rail, abas e cabeçalho: cresce e atrapalha.
  if (!emModoQuiosque(medida)) return "compacta";

  // O quadro é a medida boa (já desconta o que houver em volta); a janela é o plano B de quem
  // ainda não mediu — no primeiro render, antes do ResizeObserver responder.
  const altura =
    medida.alturaDoQuadro > 0 ? medida.alturaDoQuadro : medida.alturaDaJanela;

  if (altura >= ALTURA_AMPLA) return "ampla";
  if (altura >= ALTURA_MEDIA) return "media";
  return "compacta";
}
