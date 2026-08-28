// O QUE CHEGA DO LEITOR NEM SEMPRE É O QUE ESTÁ NO QR.
//
// O leitor 2D USB funciona como teclado: ele "digita" o conteúdo e dá Enter. Só que ele digita
// SCANCODES, e quem transforma scancode em letra é o layout de teclado do Windows. Leitor saído
// da caixa costuma vir em layout americano; a máquina do evento está em ABNT2. Resultado medido
// no primeiro teste com o hardware (28/08/2026, Villa Paris): o QR da FLAVIA, que guarda
//
//     b61427ca-3d5b-407b-937e-7c47769531f5
//
// chegou na tela como
//
//     b61427ca;3d5b;407b;937e;7c47769531f5
//
// — hífen virou ponto e vírgula. O id existe e está certo; só o separador se perdeu no caminho.
//
// ⚠️ POR QUE ISTO É CÓDIGO E NÃO "configura o leitor e pronto": configuração de leitor se perde.
// Basta o aparelho voltar ao padrão de fábrica, alguém levar outro leitor, ou o evento rodar numa
// máquina com layout diferente — e aí a fila para, com cliente na frente, e ninguém no salão vai
// diagnosticar layout de teclado. O ajuste no aparelho continua sendo o certo a fazer; isto aqui
// é a rede embaixo.
//
// ⚠️ CONSERTA APENAS O QUE TEM CARA DE UUID. Não sai trocando caractere de qualquer leitura: só
// quando o texto é um UUID inteiro cujos CINCO separadores são o MESMO caractere errado. Um
// código de unidade ("VLO-0212") ou um nome digitado à mão passam intactos.

/** Os separadores que já vimos (ou que o layout errado produz) no lugar do hífen. */
const SEPARADORES_TROCADOS = [";", "/", "'", "?", "_", "=", ":", ",", "-"];

const HEX = "[0-9a-fA-F]";

/**
 * Devolve o UUID canônico quando o texto é um UUID com separador trocado; senão devolve o texto
 * como veio (apenas aparado).
 *
 * O teste é rígido de propósito: 8-4-4-4-12 dígitos hexadecimais e o MESMO separador nas cinco
 * posições. Assim `b61427ca;3d5b;407b;937e;7c47769531f5` vira o id certo, e nada mais é tocado.
 */
export function normalizarLeituraDoQr(lido: string): string {
  const texto = String(lido ?? "").trim();
  if (!texto) return "";

  for (const sep of SEPARADORES_TROCADOS) {
    const escapado = sep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const padrao = new RegExp(
      `^(${HEX}{8})${escapado}(${HEX}{4})${escapado}(${HEX}{4})${escapado}(${HEX}{4})${escapado}(${HEX}{12})$`,
    );
    const casa = texto.match(padrao);
    if (casa) {
      return `${casa[1]}-${casa[2]}-${casa[3]}-${casa[4]}-${casa[5]}`.toLowerCase();
    }
  }

  // ⚠️ Último caso: leitor que come o separador de vez (32 hex corridos). Acontece com layout
  // em que o hífen cai numa tecla morta — o caractere simplesmente não é emitido.
  const corrido = texto.match(new RegExp(`^(${HEX}{32})$`));
  if (corrido) {
    const h = corrido[1]!.toLowerCase();
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  return texto;
}
