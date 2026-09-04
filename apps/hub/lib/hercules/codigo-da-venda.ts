// O CÓDIGO DA VENDA — um número, do primeiro telefonema até o contrato.
//
// Lucas (04/09/2026): *"eu gosto muito de protocolo"*, *"código de reserva, que vira depois código
// de proposta, que vira depois código de contrato"* e, fechando o desenho: *"no contrato a gente
// devia apontar um número de contrato que com esse número a gente tem a vida dessa venda toda
// mapeada"*.
//
// ⚠️ UM NÚMERO, TRÊS PREFIXOS. RS-000123 vira PR-000123 e depois CT-000123. Três protocolos
// independentes dariam ao corretor três números para a mesma negociação, e na hora de procurar
// ninguém lembraria qual anotou. Com um só, o número do contrato é a chave que devolve a venda
// inteira — reserva, proposta, assinatura e faturamento.
//
// ⚠️ A TELA CHAMA DE **COD**, e é esse o nome no produto (Lucas, 04/09/2026: *"em vez de
// protocolo vamos tratar como COD"*). O mecanismo é o mesmo protocolo sequencial da Iris; o que
// muda é a palavra que o corretor lê, e ela vence.
//
// ⚠️ E O PREFIXO É DERIVADO, NUNCA GRAVADO. O banco guarda o número cru
// (`hercules_reservas.protocolo_numero`); o texto sai daqui, da etapa em que a venda ESTÁ. Gravar
// "RS-000123" obrigaria a reescrever a linha a cada passo — e a errar quando alguém voltasse atrás.

/** Onde a venda está. É a mesma `EtapaDoFluxo`, aceita como string para não acoplar os módulos. */
export type EtapaDoCodigo = string;

/**
 * As letras de cada fase.
 *
 * ⚠️ ASSINATURA E FATURAMENTO CONTINUAM `CT`, e isso é decisão de negócio, não economia de código:
 * depois que o contrato existe, o documento é ele — assinar e faturar são atos SOBRE o contrato, e
 * um prefixo novo faria parecer que a venda virou outra coisa.
 */
const PREFIXO: Record<string, string> = {
  assinatura: "CT",
  contrato: "CT",
  faturado: "CT",
  proposta: "PR",
  reservado: "RS",
};

/** A fase que a etapa representa, por extenso — para a tela dizer o que o prefixo significa. */
const FASE: Record<string, string> = {
  CT: "contrato",
  PR: "proposta",
  RS: "reserva",
};

export const DIGITOS_DO_CODIGO = 6;

/**
 * O código como se escreve e se fala: `RS-000123`.
 *
 * Etapa desconhecida (cancelado, distrato, ou uma etapa que ainda não existe) cai em `RS`: o número
 * nasceu na reserva, e mostrar o começo é mais honesto do que inventar uma fase.
 */
export function codigoDaVenda(numero: null | number | undefined, etapa?: EtapaDoCodigo): string {
  if (numero === null || numero === undefined || !Number.isFinite(Number(numero))) return "";
  const prefixo = PREFIXO[String(etapa ?? "").trim().toLowerCase()] ?? "RS";
  return `${prefixo}-${String(Math.trunc(Number(numero))).padStart(DIGITOS_DO_CODIGO, "0")}`;
}

/** "reserva" · "proposta" · "contrato" — o que aquele prefixo quer dizer. */
export function faseDoCodigo(codigo: string): null | string {
  const prefixo = String(codigo ?? "").trim().slice(0, 2).toUpperCase();
  return FASE[prefixo] ?? null;
}

/**
 * O número cru de volta, a partir do que a pessoa digitou.
 *
 * ⚠️ ACEITA AS TRÊS FORMAS, porque quem procura digita o que tem na mão: o código inteiro de
 * qualquer fase (`CT-000123`), sem o prefixo (`000123`) ou só o número (`123`). Exigir o formato
 * exato transformaria a busca num quiz sobre a nossa convenção.
 */
export function numeroDoCodigo(texto: null | string | undefined): null | number {
  const limpo = String(texto ?? "").trim();
  if (!limpo) return null;
  const digitos = limpo.replace(/^[A-Za-z]{2}\s*-?\s*/, "").replace(/\D/g, "");
  if (!digitos) return null;
  const numero = Number.parseInt(digitos, 10);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}
