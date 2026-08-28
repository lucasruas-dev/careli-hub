import { normalizarLeituraDoQr } from "./leitura-qr";

// A REGRA DO LEITOR USB (wedge de teclado), fora do React para poder ser testada.
//
// O leitor 2D "digita" o conteúdo do QR em rajada e termina com Enter. Quem escuta é um
// listener de `keydown` no window — e é aí que mora o bug que o Lucas viu no salão em
// 28/08/2026: **o Enter do leitor também ativa o botão que estiver com o foco**.
//
// Ativar um <button> com Enter é a AÇÃO PADRÃO do keydown. Então o operador clicava em "Tela
// cheia" (o botão fica focado depois do clique), bipava a etiqueta, e o Enter do leitor
// re-clicava o mesmo botão: `alternarTelaCheia` via `document.fullscreenElement` preenchido e
// chamava `exitFullscreen()`. A tela caía da tela cheia exatamente no bip. O mesmo Enter
// re-alternava o último lote tocado e re-disparava o último botão da PA/Secretária.
//
// A correção é na causa: quando o Enter veio de MÁQUINA, o handler chama `preventDefault()` e
// ele deixa de ativar o botão focado. Digitação humana (Enter em formulário, Enter para
// confirmar um diálogo) continua passando, porque não vem em rajada.
//
// ⚠️ CANCELAR NÃO É O MESMO QUE ACEITAR (28/08/2026, 2ª rodada). A primeira versão só cancelava
// o Enter da leitura ACEITA, e sobrava um buraco com o mesmo sintoma: leitor com sufixo CR+LF
// manda um segundo Enter (buffer já zerado), e etiqueta amassada devolve rajada curta demais
// para virar leitura. Nos dois casos o Enter passava e re-clicava o botão focado — na Reserva,
// o lote que o operador acabara de tocar, DESMARCANDO a seleção em silêncio. Por isso a decisão
// tem dois eixos independentes: `aceita` (entrega para a tela) e `cancelarPadrao` (mata a ação
// do Enter). Todo Enter com cara de máquina é cancelado, mesmo quando não vira leitura.

/** Janela entre teclas que separa máquina de gente: acima disso o buffer é zerado. */
export const JANELA_DE_RAJADA_MS = 300;

/** Fora de campo de texto, uma rajada com este tamanho já é código. */
export const MINIMO_DE_LEITURA = 6;

/** Dentro de um input, só aceitamos o que tem tamanho de UUID — não roubamos digitação. */
export const MINIMO_DE_LEITURA_EM_CAMPO = 32;

/**
 * Acima deste intervalo médio entre teclas a rajada é gente digitando, não leitor.
 * Datilografia veloz fica em torno de 100 ms/tecla; o wedge despeja em 5–15 ms.
 */
export const MS_POR_TECLA_DE_MAQUINA = 30;

export type AvaliacaoDaLeitura = {
  /**
   * true = é bip de leitor. A tela deve tratar a leitura E cancelar a ação padrão do Enter
   * (senão o Enter ativa o botão focado — ver o cabeçalho deste arquivo).
   */
  aceita: boolean;
  /** O texto já normalizado (separador de UUID trocado pelo layout de teclado). */
  valor: string;
};

/**
 * Decide se o que veio na rajada é uma leitura de leitor e devolve o valor normalizado.
 *
 * @param texto O buffer acumulado entre teclas rápidas, antes do Enter.
 * @param emCampo Se o foco estava num input/textarea/contentEditable.
 */
export function avaliarLeituraDoWedge(input: {
  emCampo: boolean;
  texto: string;
}): AvaliacaoDaLeitura {
  const bruto = String(input.texto ?? "").trim();
  const minimo = input.emCampo ? MINIMO_DE_LEITURA_EM_CAMPO : MINIMO_DE_LEITURA;
  return { aceita: bruto.length >= minimo, valor: normalizarLeituraDoQr(bruto) };
}

export type DecisaoDoEnter = AvaliacaoDaLeitura & {
  /**
   * true = chamar `preventDefault()`/`stopPropagation()`. Independe de `aceita`: o Enter
   * excedente de uma rajada não vira leitura, mas também não pode clicar o botão focado.
   */
  cancelarPadrao: boolean;
};

/**
 * A decisão completa do Enter: o que entregar para a tela e se a ação padrão morre aqui.
 *
 * @param charsDaRajada Quantos caracteres entraram no buffer desde que ele foi zerado.
 * @param duracaoDaRajadaMs Do primeiro ao último caractere do buffer.
 * @param msDesdeAUltimaLeitura Distância até o Enter da leitura anterior (sufixo CR+LF).
 */
export function decidirEnterDoWedge(input: {
  charsDaRajada: number;
  duracaoDaRajadaMs: number;
  emCampo: boolean;
  msDesdeAUltimaLeitura: number;
  texto: string;
}): DecisaoDoEnter {
  const leitura = avaliarLeituraDoWedge({ emCampo: input.emCampo, texto: input.texto });
  if (leitura.aceita) return { ...leitura, cancelarPadrao: true };

  // ⚠️ Dentro de um campo de texto NÃO cancelamos nada que não seja leitura: ali o Enter é da
  // pessoa (submeter a busca, confirmar o formulário) e roubá-lo quebraria a tela.
  if (input.emCampo) return { ...leitura, cancelarPadrao: false };

  // Sufixo do próprio bip: leitor configurado com CR+LF manda um segundo Enter logo atrás,
  // já com o buffer zerado.
  if (input.msDesdeAUltimaLeitura <= JANELA_DE_RAJADA_MS) {
    return { ...leitura, cancelarPadrao: true };
  }

  // Rajada curta demais para virar leitura (etiqueta amassada, bip cortado) mas digitada em
  // ritmo de máquina: não é leitura, e também não é gente querendo clicar o botão focado.
  if (input.charsDaRajada >= 2) {
    const porTecla = input.duracaoDaRajadaMs / (input.charsDaRajada - 1);
    if (porTecla <= MS_POR_TECLA_DE_MAQUINA) return { ...leitura, cancelarPadrao: true };
  }

  return { ...leitura, cancelarPadrao: false };
}

/** O foco está num lugar onde a pessoa digita de verdade? */
export function focoEmCampoDeTexto(alvo: unknown): boolean {
  const elemento = alvo as null | { isContentEditable?: boolean; tagName?: string };
  if (!elemento) return false;
  const tag = String(elemento.tagName ?? "").toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || Boolean(elemento.isContentEditable);
}
