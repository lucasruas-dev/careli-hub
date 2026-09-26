// O VALOR DE `apolo_esteira.origem` DA CAD QUE NASCE DA CARTEIRA (26/09/2026).
//
// ⚠️ MÓDULO SEM DEPENDÊNCIA NENHUMA, DE PROPÓSITO. Quem grava é `cad-do-comprador.ts`, quem decide
// é `cliente-credenciado.ts`, e quem precisa IGNORAR essa CAD é a Têmis (`dados-do-contrato.ts`,
// "quem vendeu" a venda antiga). Importar a constante de `compra-ativa.ts` arrastaria para a Têmis
// o `lib/apolo/server` (e o pool do C2X) só por causa de uma string.

/** O valor de `apolo_esteira.origem` da CAD que nasce da carteira. */
export const ORIGEM_COMPRADOR_DA_CARTEIRA = "comprador_da_carteira";
