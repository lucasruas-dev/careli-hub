"use client";

import { useEffect } from "react";

const shouldRegisterPwa = process.env.NODE_ENV === "production";

export function PanteonPwaRuntime() {
  useEffect(() => {
    if (
      !shouldRegisterPwa ||
      !("serviceWorker" in navigator) ||
      !window.isSecureContext
    ) {
      return;
    }

    void navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);

  return null;
}
