import type { HubUserContext } from "@repo/shared";

export type HubAiUserContext = {
  avatarUrl?: string;
  id: string;
  name: string;
  firstName: string;
  role: HubUserContext["role"];
};

export function buildHubAiUserContext(
  hubUser: HubUserContext | null,
): HubAiUserContext | null {
  if (!hubUser) {
    return null;
  }

  return {
    avatarUrl: hubUser.avatarUrl,
    firstName: getFirstName(hubUser.name),
    id: hubUser.id,
    name: hubUser.name,
    role: hubUser.role,
  };
}

export function getHubAiThinkingMessage(user: HubAiUserContext | null) {
  return user?.firstName
    ? `Só um instante, ${user.firstName}.`
    : "Só um instante.";
}

export function getHubAiUserInstruction(user: HubAiUserContext | null) {
  if (!user) {
    return "Usuário logado não identificado no contexto da tela.";
  }

  return `Usuário logado: ${user.name}. Chame-o de ${user.firstName} na primeira linha de toda resposta ao operador.`;
}

function getFirstName(name: string) {
  const firstName = name.trim().split(/\s+/)[0];

  return firstName || name;
}
