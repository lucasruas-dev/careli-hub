// O ID DO CLIENTE DA COBRANÇA — do formato da tela para o número do C2X.
//
// Chamado TI-000138, aberto por Isac Santa Fé em 25/08/2026, impacto crítico:
// *"Não conseguimos colocar comentário de workflow, não fica salvo após fechar."*
//
// ⚠️ A TELA DA COBRANÇA NÃO TRABALHA COM NÚMERO. O cliente nasce do read-model com
// `id: `c2x-client-${rowId}`` (`lib/guardian/read-model.ts`), e é esse texto que os componentes
// carregam. A rota que grava a etapa do workflow fazia `Number(clienteId)`, que em
// "c2x-client-3757" dá NaN, e respondia 400 "Cliente inválido" — SEMPRE. Medido em 21/09/2026:
// `guardian_etapa_manual` tinha ZERO linhas, quase um mês depois de a gravação ter sido escrita.
//
// ⚠️ E OS DÍGITOS SÃO OS DO FIM, NUNCA TODOS. Tirar tudo que não é dígito de "c2x-client-3789"
// devolve 23789: o "2" de "c2x" entra no número. Isso já aconteceu neste repo, em outro lugar, e
// fez todo comprador virar prospect no Apolo — a nota está em `lib/apolo/server.ts`.

/**
 * O id numérico do cliente no C2X, seja qual for o formato que a tela mandou.
 *
 * Devolve `null` quando não há número plausível: quem chama responde 400 em vez de gravar em
 * cima de um cliente que não é aquele.
 */
export function idDoClienteDaCobranca(valor: unknown): null | number {
  if (typeof valor === "number") {
    return Number.isFinite(valor) && valor > 0 ? valor : null;
  }

  const texto = String(valor ?? "").trim();
  if (texto === "") return null;

  // Os dígitos do FIM. Ver a nota do topo: `replace(/\D/g, "")` contamina com o "2" de "c2x".
  const digitos = /(\d+)$/.exec(texto)?.[1];
  if (!digitos) return null;

  const numero = Number(digitos);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}
