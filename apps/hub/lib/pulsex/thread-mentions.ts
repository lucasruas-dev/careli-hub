"use client";

// Threads com resposta que MENCIONA o usuario (decisao Lucas 7/jul: o chip de
// respostas na mensagem-pai precisa ficar visivelmente diferente quando voce
// foi citado dentro da thread). O provider global grava quando a resposta
// chega pelo realtime; o workspace le pra pintar o chip e limpa ao abrir a
// thread. localStorage = sobrevive a navegacao/reload; evento = re-render.

const STORAGE_PREFIX = "panteon:hermes:thread-mentions:";
const MAX_TRACKED_PARENTS = 100;

export const HERMES_THREAD_MENTIONS_EVENT = "careli:hermes:thread-mentions";

function storageKey(userId: string) {
  return `${STORAGE_PREFIX}${userId}`;
}

export function readHermesThreadMentionParents(userId: string): Set<string> {
  if (typeof window === "undefined" || !userId) {
    return new Set();
  }

  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];

    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeHermesThreadMentionParents(userId: string, parents: Set<string>) {
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify([...parents].slice(-MAX_TRACKED_PARENTS)),
    );
    window.dispatchEvent(new CustomEvent(HERMES_THREAD_MENTIONS_EVENT));
  } catch {
    // Storage cheio/bloqueado: o chip so perde a cor especial, nada quebra.
  }
}

export function addHermesThreadMentionParent(
  userId: string,
  parentMessageId: string,
) {
  if (typeof window === "undefined" || !userId || !parentMessageId) {
    return;
  }

  const parents = readHermesThreadMentionParents(userId);

  if (parents.has(parentMessageId)) {
    return;
  }

  parents.add(parentMessageId);
  writeHermesThreadMentionParents(userId, parents);
}

export function clearHermesThreadMentionParent(
  userId: string,
  parentMessageId: string,
) {
  if (typeof window === "undefined" || !userId || !parentMessageId) {
    return;
  }

  const parents = readHermesThreadMentionParents(userId);

  if (!parents.delete(parentMessageId)) {
    return;
  }

  writeHermesThreadMentionParents(userId, parents);
}
