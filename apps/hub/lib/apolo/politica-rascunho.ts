// O QUE ESTÁ NA TELA × O QUE ESTÁ GUARDADO, na política comercial do empreendimento.
//
// ⚠️ ISTO NASCEU DE UM CHAMADO REAL. Em 11/09/2026 o Lucas mandou um print da tela com "1,5" e
// "4,5" nos campos de comissão e, três linhas abaixo, a frase "Comissão total do contrato: não
// cadastrado. O C2X registra 6,5%". A leitura natural é que o Panteon e o C2X discordavam. Não
// discordavam: aqueles dois números eram o PLACEHOLDER do input, e o banco estava vazio — 17 das
// 18 linhas de `apolo_enterprise_settings` com as duas colunas nulas, medido no mesmo dia.
//
// O campo mostrava um exemplo em cinza, a frase mostrava o servidor, e nada na tela dizia qual
// das duas era a verdade. Um formulário que não distingue rascunho de salvo transforma "não
// preenchi" em "o sistema está errado", e foi exatamente o que aconteceu.

/** Texto do campo → número, aceitando a vírgula que o operador digita. */
function comoNumero(valor: string): null | number {
  const limpo = valor.trim().replace(",", ".");
  if (!limpo) return null;

  const n = Number(limpo);

  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * O campo tem alteração que ainda não foi salva?
 *
 * @param rascunho O que está no input. `undefined` = o operador não tocou no campo nesta sessão,
 *                 e aí não há o que avisar, mesmo que o banco esteja vazio.
 * @param salvo    O valor que veio do servidor. `null` = não cadastrado.
 */
export function temAlteracaoNaoSalva(
  rascunho: string | undefined,
  salvo: null | number,
): boolean {
  if (rascunho === undefined) return false;

  const digitado = comoNumero(rascunho);

  // Texto que ainda não é número ("1," no meio da digitação, ou qualquer bobagem) de fato não
  // está no banco — avisar aqui está certo.
  if (Number.isNaN(digitado)) return true;

  // ⚠️ VAZIO É DIFERENTE DE ZERO nos dois lados. Limpar um campo preenchido é uma alteração
  // (na política, `null` quer dizer "não fazemos isso neste empreendimento", que é decisão e
  // precisa ser salva); e digitar "0" sobre um campo vazio também é.
  if (digitado === null) return salvo !== null;
  if (salvo === null) return true;

  return digitado !== salvo;
}
