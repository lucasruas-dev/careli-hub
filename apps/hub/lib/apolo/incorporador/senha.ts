// Senha das contas de incorporador.
//
// scrypt com sal aleatório por conta, guardado como "sal:hash" em
// apolo_incorporador_usuarios.senha_hash. A comparação é em tempo constante: comparar hash com
// === vaza o prefixo correto pelo relógio, e isso é login de gente de fora.
//
// ⚠️ TERCEIRA CÓPIA DESTE PAR NO REPO. Já existem `hashSenha`/`verificarSenha` em
// lib/prometeu/operador-auth.ts e `hashSenhaAcao`/`verificarSenhaAcao` em lib/apolo/acoes.ts,
// com o mesmo algoritmo e os mesmos parâmetros. Não unifiquei junto com esta entrega porque
// mexer nas outras duas é refatorar dois módulos em produção por conta de uma feature nova; a
// unificação está anotada como tarefa à parte. Se você veio consertar algo aqui, conserte nas
// três.
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);

const KEYLEN = 64;
const SALT_BYTES = 16;

/** Gera "salHex:hashHex". Nunca guarde a senha crua. */
export async function hashSenhaIncorporador(senha: string): Promise<string> {
  const sal = randomBytes(SALT_BYTES);
  const derivada = (await scrypt(senha, sal, KEYLEN)) as Buffer;

  return `${sal.toString("hex")}:${derivada.toString("hex")}`;
}

/** Confere a senha digitada contra o hash guardado. Qualquer defeito no formato reprova. */
export async function verificarSenhaIncorporador(
  senha: string,
  guardado: string | null | undefined,
): Promise<boolean> {
  if (!guardado) return false;

  const [salHex, hashHex] = guardado.split(":");
  if (!salHex || !hashHex) return false;

  try {
    const esperada = Buffer.from(hashHex, "hex");
    const derivada = (await scrypt(senha, Buffer.from(salHex, "hex"), esperada.length)) as Buffer;

    return derivada.length === esperada.length && timingSafeEqual(derivada, esperada);
  } catch {
    return false;
  }
}
