"use client";

import { useEffect, useRef, type RefObject } from "react";

type UseOutsideDismissOptions<TElement extends HTMLElement> = {
  enabled: boolean;
  onDismiss: () => void;
  ref: RefObject<TElement | null>;
};

export function useOutsideDismiss<TElement extends HTMLElement>({
  enabled,
  onDismiss,
  ref,
}: UseOutsideDismissOptions<TElement>) {
  const onDismissRef = useRef(onDismiss);

  useEffect(() => {
    onDismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (ref.current?.contains(target)) {
        return;
      }

      onDismissRef.current();
    }

    document.addEventListener("pointerdown", handlePointerDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
    };
  }, [enabled, ref]);
}
