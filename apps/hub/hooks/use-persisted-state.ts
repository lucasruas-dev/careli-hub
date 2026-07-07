"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// usePersistedState — drop-in do useState que faz o estado de UI "continuar de
// onde estava" ao navegar (módulo→módulo→voltar) e ao dar reload. É a peça que
// resolve, em todo o Hub, a regressão de as telas voltarem ao estado inicial:
// troque `useState(x)` por `usePersistedState("modulo.campo", x)`.
//
// Como funciona (e por que é seguro/barato):
//   • cache em MEMÓRIA (por aba) → na navegação client-side o React remonta a
//     tela e o initializer lê o valor daqui de forma SÍNCRONA = volta instantânea,
//     sem flash.
//   • sessionStorage (ou localStorage) → camada DURÁVEL, sobrevive a reload/Ctrl+F5.
//   • NADA vai à rede. Zero polling. Não tem relação com o incidente de custo do
//     Hermes — é 100% client-side.
//   • Seguro em SSR (Next 16): a primeira montagem hidratada devolve o valor
//     inicial (bate com o HTML do server) e a hidratação do storage acontece em
//     efeito, depois do paint → sem hydration mismatch.
//
// A `key` deve ser ESTÁVEL (string literal), única por pedaço de estado. Convenção:
// "<modulo>.<area>.<campo>" — ex.: "iris.board.ownerView", "hermes.activeChannel".

type PersistBackend = "session" | "local" | "memory";

// Cache do processo (client). Sobrevive à navegação client-side; some no F5
// (aí o storage durável reidrata). Por-aba, por-realm → sem vazamento entre abas.
const memoryCache = new Map<string, unknown>();

const KEY_PREFIX = "panteon:ui:";

function resolveStorage(backend: PersistBackend): Storage | null {
  if (backend === "memory" || typeof window === "undefined") {
    return null;
  }

  try {
    return backend === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    // Modo privado / storage bloqueado por política — memória ainda funciona.
    return null;
  }
}

function readStored<T>(key: string, backend: PersistBackend): T | undefined {
  const storage = resolveStorage(backend);

  if (!storage) {
    return undefined;
  }

  try {
    const raw = storage.getItem(KEY_PREFIX + key);

    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch {
    return undefined;
  }
}

function writeStored(key: string, value: unknown, backend: PersistBackend) {
  const storage = resolveStorage(backend);

  if (!storage) {
    return;
  }

  try {
    storage.setItem(KEY_PREFIX + key, JSON.stringify(value));
  } catch {
    // Cota cheia / bloqueado — ignora; o cache em memória segue válido na sessão.
  }
}

export function usePersistedState<T>(
  key: string,
  initialValue: T | (() => T),
  options: { backend?: PersistBackend } = {},
): [T, (next: T | ((prev: T) => T)) => void] {
  const backend = options.backend ?? "session";

  const [value, setValueState] = useState<T>(() => {
    // Remontagem client-side dentro da sessão → cache tem o valor → sem flash.
    // SSR / primeira hidratação → cache vazio → valor inicial (bate com o server).
    if (memoryCache.has(key)) {
      return memoryCache.get(key) as T;
    }

    return typeof initialValue === "function"
      ? (initialValue as () => T)()
      : initialValue;
  });

  // Hidratação fria do storage durável: só na 1ª montagem e só se a memória ainda
  // não tem o valor. Em efeito (pós-paint) para não quebrar a hidratação do SSR.
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current || memoryCache.has(key)) {
      return;
    }

    hydratedRef.current = true;
    const stored = readStored<T>(key, backend);

    if (stored !== undefined) {
      memoryCache.set(key, stored);
      setValueState(stored);
    }
    // key/backend são estáveis por instância de uso; roda uma vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setValue = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValueState((prev) => {
        const resolved =
          typeof next === "function"
            ? (next as (previous: T) => T)(prev)
            : next;

        memoryCache.set(key, resolved);
        writeStored(key, resolved, backend);

        return resolved;
      });
    },
    [key, backend],
  );

  return [value, setValue];
}
