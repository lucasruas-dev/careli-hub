// "Responder como Cacá" é restrito (Lucas, 30/jun): só o dono pode disparar uma
// mensagem assinada como Cacá num atendimento conduzido por ela. Fonte única de
// verdade usada pelo endpoint (server) e pelo cockpit (UI).
export const CACA_REPLY_ALLOWED_USER_IDS: readonly string[] = [
  "b2725781-a76a-4607-90c5-9c54608b8476", // Lucas Ruas (owner)
];

export function canReplyAsCaca(userId: string | null | undefined): boolean {
  return Boolean(userId && CACA_REPLY_ALLOWED_USER_IDS.includes(userId));
}
