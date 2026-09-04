// O CÓDIGO DA VENDA — um número, e só um, do primeiro telefonema até o contrato.
//
// Lucas (04/09/2026): *"eu gosto muito de protocolo"*, *"no contrato a gente devia apontar um
// número de contrato que com esse número a gente tem a vida dessa venda toda mapeada"*, *"em vez de
// protocolo vamos tratar como COD"* e, desfazendo o prefixo por etapa que eu tinha proposto: *"eu
// não gosto do RS, acho que tem que ser um código somente, aí ele vai existir unicamente
// independente do estágio"*.
//
// ⚠️ O CÓDIGO NÃO MUDA — nem de forma, nem de letra. A primeira versão trocava o prefixo conforme a
// fase (RS → PR → CT), e ele desfez com razão: um código que muda de cara não é o mesmo código. O
// corretor anota `000123` na reserva e é `000123` que ele diz no telefone seis meses depois, com o
// contrato assinado. A fase quem diz é a tela, que já mostra a etapa ao lado — o número não precisa
// carregar essa informação, e carregá-la só cria uma segunda coisa para conferir.
//
// ⚠️ ZEROS À ESQUERDA, e não o número cru: `000123` se lê e se dita como código; `123` se lê como
// quantidade. Seis dígitos é o mesmo tamanho do protocolo da Iris (`AT-000123`), que a casa já
// escreve e fala todo dia.

export const DIGITOS_DO_CODIGO = 6;

/**
 * O código como se escreve e se fala: `000123`.
 *
 * O valor guardado no banco é o número cru (`hercules_reservas.protocolo_numero`); a forma é
 * decidida aqui, num lugar só, para as telas e as mensagens não divergirem.
 */
export function codigoDaVenda(numero: null | number | undefined): string {
  if (numero === null || numero === undefined || !Number.isFinite(Number(numero))) return "";
  return String(Math.trunc(Number(numero))).padStart(DIGITOS_DO_CODIGO, "0");
}

/**
 * O número cru de volta, a partir do que a pessoa digitou.
 *
 * ⚠️ ACEITA COM E SEM ZEROS, e ignora um prefixo de letras se alguém colar um código antigo
 * (`RS-000123`, que chegou a existir por algumas horas): quem procura digita o que tem anotado, e
 * exigir o formato exato transforma a busca num quiz sobre a nossa convenção.
 */
export function numeroDoCodigo(texto: null | string | undefined): null | number {
  const limpo = String(texto ?? "").trim();
  if (!limpo) return null;
  const digitos = limpo.replace(/^[A-Za-z]{2}\s*-?\s*/, "").replace(/\D/g, "");
  if (!digitos) return null;
  const numero = Number.parseInt(digitos, 10);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}
