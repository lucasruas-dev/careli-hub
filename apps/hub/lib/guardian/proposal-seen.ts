"use client";

// Marcacao de novidade nas propostas (por usuario/navegador, sem backend novo).
// Guarda no localStorage o instante em que o usuario viu cada proposta; a
// "novidade" e quando houve atividade (nova mensagem/decisao/edicao) depois.

const PREFIX = "guardian-proposal-seen:";

export function getProposalSeen(id: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + id);
  } catch {
    return null;
  }
}

export function markProposalSeen(id: string): void {
  try {
    window.localStorage.setItem(PREFIX + id, new Date().toISOString());
  } catch {
    // sem localStorage (SSR/privado): ignora
  }
}

// Ultima atividade conhecida da proposta (decisao/edicao = updatedAt; mensagem =
// lastCommentAt). A maior das duas.
export function proposalLastActivity(item: {
  lastCommentAt?: string | null;
  updatedAt?: string | null;
}): string | null {
  const times = [item.updatedAt, item.lastCommentAt].filter(
    (value): value is string => Boolean(value),
  );
  if (times.length === 0) {
    return null;
  }
  return times.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

export function hasProposalUpdate(item: {
  id: string;
  lastCommentAt?: string | null;
  updatedAt?: string | null;
}): boolean {
  const last = proposalLastActivity(item);
  if (!last) {
    return false;
  }
  const seen = getProposalSeen(item.id);
  if (!seen) {
    return true;
  }
  return last > seen;
}
