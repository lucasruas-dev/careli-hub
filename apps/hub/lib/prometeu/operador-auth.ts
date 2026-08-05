import {
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

// AUTENTICACAO PROPRIA do operador do Prometeu (nao e' o Supabase Auth do hub).
//
// Decisao do Lucas (24/jul): a equipe do evento loga com nome.sobrenome + senha, so ve o
// Prometeu, e nao e' usuario do hub. Como e' auth do zero, TODO cuidado importa:
//   - senha nunca em texto: scrypt com sal aleatorio por operador;
//   - comparacao em tempo constante (timingSafeEqual) contra timing attack;
//   - sessao = token assinado por HMAC com PROMETEU_SESSION_SECRET (segredo fora do banco),
//     com expiracao — se o segredo vazar troca-se a env e todas as sessoes caem.
//
// O token NAO e' criptografado (o payload e' legivel), mas e' ASSINADO: ninguem forja um sem o
// segredo. Nao guardamos nada sensivel nele — so id do operador, perfil, zona e expiracao.

const scrypt = promisify(scryptCb);

const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export const PROMETEU_SESSION_COOKIE = "prometeu_op";
// 14h cobre um dia de evento inteiro com folga, sem deixar sessao viva por semanas.
export const PROMETEU_SESSION_TTL_MS = 14 * 60 * 60 * 1000;

export type PrometeuOperadorSessao = {
  exp: number;
  eventoId: string;
  mesaId: string | null;
  operadorId: string;
  perfil: string;
  username: string;
  zona: string;
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function getSessionSecret(): string {
  const secret = process.env.PROMETEU_SESSION_SECRET?.trim();
  if (!secret) {
    // Falha explicita: sem o segredo, assinar/validar seria inseguro (qualquer um forjaria).
    throw new Error("PROMETEU_SESSION_SECRET ausente — sessao do operador indisponivel.");
  }
  return secret;
}

// ---------------------------------------------------------------- senha

// Gera "saltHex:hashHex" para guardar em prometeu_operadores.senha_hash.
export async function hashSenha(senha: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = (await scrypt(senha, salt, SCRYPT_KEYLEN)) as Buffer;
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

// Confere a senha digitada contra o hash guardado, em tempo constante.
export async function verificarSenha(
  senha: string,
  hashGuardado: string,
): Promise<boolean> {
  const [saltHex, hashHex] = hashGuardado.split(":");
  if (!saltHex || !hashHex) {
    return false;
  }

  const salt = Buffer.from(saltHex, "hex");
  const esperado = Buffer.from(hashHex, "hex");
  const derived = (await scrypt(senha, salt, esperado.length)) as Buffer;

  if (derived.length !== esperado.length) {
    return false;
  }

  return timingSafeEqual(derived, esperado);
}

// ---------------------------------------------------------------- sessao

// Cria o token assinado da sessao. `payload` sem `exp` — a expiracao e' carimbada aqui.
export function criarTokenSessao(
  payload: Omit<PrometeuOperadorSessao, "exp">,
  agoraMs: number,
): string {
  const corpo: PrometeuOperadorSessao = {
    ...payload,
    exp: agoraMs + PROMETEU_SESSION_TTL_MS,
  };
  const parteCorpo = base64url(JSON.stringify(corpo));
  const assinatura = createHmac("sha256", getSessionSecret())
    .update(parteCorpo)
    .digest("base64url");

  return `${parteCorpo}.${assinatura}`;
}

// Valida o token: assinatura correta (HMAC em tempo constante) E nao expirado. Devolve a sessao
// ou null. Nunca lanca por token malformado — token invalido = sem sessao.
export function validarTokenSessao(
  token: string | undefined | null,
  agoraMs: number,
): PrometeuOperadorSessao | null {
  if (!token) {
    return null;
  }

  const ponto = token.indexOf(".");
  if (ponto <= 0) {
    return null;
  }

  const parteCorpo = token.slice(0, ponto);
  const assinaturaRecebida = token.slice(ponto + 1);

  let assinaturaEsperada: string;
  try {
    assinaturaEsperada = createHmac("sha256", getSessionSecret())
      .update(parteCorpo)
      .digest("base64url");
  } catch {
    return null;
  }

  const a = Buffer.from(assinaturaRecebida);
  const b = Buffer.from(assinaturaEsperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return null;
  }

  try {
    const corpo = JSON.parse(
      Buffer.from(parteCorpo, "base64url").toString("utf8"),
    ) as PrometeuOperadorSessao;

    if (!corpo.operadorId || typeof corpo.exp !== "number" || corpo.exp < agoraMs) {
      return null;
    }

    return corpo;
  } catch {
    return null;
  }
}

// Normaliza o username digitado: minusculas, sem espacos nas pontas. O padrao e' nome.sobrenome,
// mas aceitamos o que a pessoa digitar e comparamos por lower() (o indice do banco tambem e' lower).
export function normalizarUsername(valor: string): string {
  return valor.trim().toLowerCase();
}
