// A FRASE QUE ATRAVESSA PARA O PORTAL NÃO FALA DO LADO DE DENTRO. Folha pura, sem import.
//
// Lucas, 18/08/2026, e o plano da fonte única (seção 5): o portal do incorporador nunca vê "C2X",
// "D4Sign", o id do documento da D4Sign (o uuid do C2X) nem o aviso de dois contratos. Desde a F2,
// quatro recusas ganharam a frase da D4Sign ("cancele na D4Sign pelo C2X", com o documento): a volta
// para correção, a conclusão do cancelamento, o indeferimento e o envio. As quatro rodam pelas
// MESMAS funções no hub e no portal, e é para o hub que a frase inteira serve (quem opera o C2X).
//
// ⚠️ O CORTE É NA PORTA DO PORTAL, E PELA MARCA "D4Sign" NA FRASE, DE PROPÓSITO. As quatro frases da
// D4Sign nascem em quatro arquivos que não sabem quem é o ator; levar o ator até lá mudaria quatro
// assinaturas para trocar um texto. A marca é estável: só as frases da D4Sign a contêm (a linha do
// espelho é a única da D4Sign em `temis_envelopes`). Frase que não a contém passa como está.

/** A frase interna fala da D4Sign (e, com ela, do C2X e do documento de lá)? */
export function falaDaD4Sign(texto: null | string | undefined): boolean {
  return /d4sign/i.test(String(texto ?? ""));
}

/** A recusa de cancelar ou voltar, para o portal: nada foi feito, e quem resolve é a Careli. */
export const RECUSA_POR_OUTRO_CANAL =
  "O contrato desta venda está em assinatura por outro canal, e daqui não dá para cancelar. Nada foi gravado. Fale com a Careli para liberar.";

/** A recusa do envio, para o portal: o segundo envelope não sai. */
export const ENVIO_POR_OUTRO_CANAL =
  "Este contrato já está em assinatura por outro canal. Nada foi enviado. Fale com a Careli antes de mandar de novo.";

/** O aviso do indeferimento, para o portal: o indeferimento valeu, a venda ficou. */
export const INDEFERIMENTO_POR_OUTRO_CANAL =
  "Contrato indeferido, mas a venda continua em Contrato: o contrato está em assinatura por outro canal. Fale com a Careli para liberar a venda.";

/**
 * A frase que vai ao ator: o hub recebe a interna inteira; o portal, a neutra quando a interna fala
 * da D4Sign.
 */
export function fraseParaOAtor<T extends null | string | undefined>(
  ehHub: boolean,
  texto: T,
  neutra: string,
): string | T {
  return !ehHub && falaDaD4Sign(texto) ? neutra : texto;
}
