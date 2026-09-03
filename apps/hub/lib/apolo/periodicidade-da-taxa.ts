// A TAXA DO C2X É AO ANO OU AO MÊS? — a régua, sozinha, sem nada do servidor junto.
//
// ⚠️ ESTE ARQUIVO EXISTE POR CAUSA DE UM BUILD QUEBRADO. A régua morava em
// `planos-comerciais-c2x.ts`, que importa `getHadesDbPool` e, por tabela, o mysql2. Enquanto só o
// servidor a usava, tudo bem; quando a tela do Hércules passou a precisar dela (pelo
// `fluxo-de-venda.ts`, que é núcleo puro e roda dos dois lados), o bundle do cliente foi atrás da
// cadeia inteira e parou em `node:buffer`:
//
//     Module build failed: UnhandledSchemeError: Reading from "node:buffer" is not handled
//
// Uma constante de negócio não pode arrastar um driver de banco para o navegador. Aqui ela fica
// sozinha, e os dois lados importam daqui.

/**
 * A partir de que valor a taxa do C2X é ANUAL.
 *
 * ⚠️ O SCHEMA DO LEGADO NÃO DIZ A UNIDADE. `contractual_interest` guarda 8.0000 na Lavra do Ouro
 * (ao ano) e 0.6434 no Villa Paris (ao mês) — a mesma taxa econômica, gravada de dois jeitos. Os
 * valores que existem no banco são 0, 0.5, 0.6434, 0.7207, 0.8, 6 e 8: há um vão enorme entre 0,8 e
 * 6, e nenhum juro imobiliário real fica entre eles. O corte em 2 cai no meio do vão com folga dos
 * dois lados.
 *
 * Mesmo assim é PALPITE, e palpite sobre dinheiro não pode ficar mudo: a tela de cadastro mostra a
 * leitura ao operador para ele confirmar, e o que ele confirmar passa a valer.
 */
export const CORTE_ANUAL = 2;

/**
 * A taxa crua do C2X é ao ANO ou ao MÊS?
 *
 * Usada em três lugares: o cadastro de planos, o extrato do cliente (onde escrever "a.a." num juro
 * mensal saía errado em 853 contratos) e a ficha da unidade no Hércules.
 */
export function periodicidadeDaTaxa(taxa: null | number | undefined): "anual" | "mensal" {
  return typeof taxa === "number" && taxa >= CORTE_ANUAL ? "anual" : "mensal";
}
