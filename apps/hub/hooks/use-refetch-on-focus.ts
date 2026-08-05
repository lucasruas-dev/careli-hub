"use client";

import { useEffect, useRef } from "react";

// useRefetchOnFocus — dispara um refetch quando a aba/janela volta a ficar VISÍVEL
// (document.visibilityState === "visible") ou recebe FOCO (window "focus"). É o que
// faz o Board/Esteira e a ficha do Apolo refletirem mudanças que chegam por fora
// (CPF corrigido, PIX pago por webhook, troca de etapa da esteira) sem o usuário
// precisar dar F5.
//
// ⚠️ NÃO é polling (regra de custo do Panteon): o refetch só roda quando o usuário
// VOLTA pra aba, nunca em intervalo. Um debounce simples (`minIntervalMs`, ~10s)
// evita a rajada de alternar abas rápido: guarda o timestamp do último disparo num
// ref e ignora chamadas mais novas que o intervalo. O timestamp nasce "agora"
// porque a montagem já buscou os dados — voltar pra aba nos primeiros ~10s não
// refaz o fetch à toa.
//
// Reaproveita o MESMO carregar que o componente já tem: passe a função de fetch
// (ou um bump de reloadKey). O callback fica num ref, então pode mudar de
// identidade a cada render sem re-registrar os listeners.

export function useRefetchOnFocus(
  refetch: () => void,
  options: { enabled?: boolean; minIntervalMs?: number } = {},
): void {
  const { enabled = true, minIntervalMs = 10_000 } = options;

  const refetchRef = useRef(refetch);
  useEffect(() => {
    refetchRef.current = refetch;
  }, [refetch]);

  // Momento do último disparo. Semeado com "agora" na 1ª montagem para não refazer
  // o fetch logo depois do carregamento inicial.
  const lastRunRef = useRef<number>(0);
  if (lastRunRef.current === 0) {
    lastRunRef.current = Date.now();
  }

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function maybeRefetch() {
      const now = Date.now();
      if (now - lastRunRef.current < minIntervalMs) {
        return;
      }
      lastRunRef.current = now;
      refetchRef.current();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        maybeRefetch();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", maybeRefetch);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", maybeRefetch);
    };
  }, [enabled, minIntervalMs]);
}
