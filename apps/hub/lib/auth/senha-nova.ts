// A RÉGUA DA SENHA NOVA — uma só, para os dois logins.
//
// ⚠️ UM ARQUIVO PORQUE SÃO DOIS SISTEMAS DE SENHA. O hub interno autentica no Supabase Auth e o
// portal do incorporador/comercial tem login próprio com scrypt. São duas telas e duas rotas; se
// cada uma trouxesse a sua régua, elas envelheceriam separadas e a mesma pessoa veria exigências
// diferentes nos dois lugares — o Lucas e a Nivea têm conta nos dois.
//
// ⚠️ A RÉGUA É CURTA DE PROPÓSITO. Exigir maiúscula, número e símbolo empurra todo mundo para
// `Careli@2026`, que é o que a regra produz quando ela é apertada sem ser longa. Oito caracteres e
// nada de senha óbvia cobre o caso real desta casa, que é senha inicial entregue pelo administrador
// e reaproveitada para sempre.

/** O piso. Menos que isto não é senha, é lembrete. */
export const MINIMO_DE_CARACTERES = 8;

// ⚠️ ESTA LISTA NÃO É SEGURANÇA, É ATRITO CONTRA O ÓBVIO. Ela não impede ninguém determinado; ela
// impede a senha que a pessoa digitaria sem pensar no primeiro acesso, que é o caso que motivou a
// troca. Tudo em minúsculo e sem acento, porque a comparação normaliza antes.
const OBVIAS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "senha123",
  "senha1234",
  "password",
  "panteon123",
  "careli123",
  "careli2026",
  "mudar123",
  "abcd1234",
  "qwertyui",
  "11111111",
]);

export type VereditoDaSenha = { erro: string; ok: false } | { ok: true; senha: string };

/**
 * Confere a senha nova. Devolve a senha já aparada quando passa.
 *
 * ⚠️ NÃO APARA O MIOLO, SÓ AS PONTAS. `trim` nas bordas evita o espaço que o navegador cola ao
 * colar; mexer no meio mudaria a senha que a pessoa acha que escolheu, e ela não entraria mais.
 */
export function conferirSenhaNova(cru: unknown): VereditoDaSenha {
  const senha = typeof cru === "string" ? cru.trim() : "";

  if (!senha) {
    return { erro: "Escolha uma senha.", ok: false };
  }
  if (senha.length < MINIMO_DE_CARACTERES) {
    return {
      erro: `A senha precisa ter pelo menos ${MINIMO_DE_CARACTERES} caracteres.`,
      ok: false,
    };
  }
  // ⚠️ 72 BYTES É O TETO DO bcrypt, e o Supabase Auth recusa acima disso com erro cru. Barrar aqui
  // dá uma frase que a pessoa entende, em vez de "unexpected error" no meio da troca.
  if (new TextEncoder().encode(senha).length > 72) {
    return { erro: "A senha ficou longa demais. Use até 72 caracteres.", ok: false };
  }

  const normalizada = senha
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  if (OBVIAS.has(normalizada)) {
    return { erro: "Essa senha é fácil demais. Escolha outra.", ok: false };
  }
  // Um caractere repetido do começo ao fim ("aaaaaaaa") passa no tamanho e não é senha.
  if (new Set(normalizada).size === 1) {
    return { erro: "Essa senha é fácil demais. Escolha outra.", ok: false };
  }

  return { ok: true, senha };
}
