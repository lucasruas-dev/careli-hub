import type { Metadata } from "next";

import { ChronosRecordingViewPage } from "@/modules/chronos/ChronosRecordingViewPage";

export const dynamic = "force-dynamic";

const chronosRecordingBootScript = `
(() => {
  if (window.__chronosRecordingStartSignalBooted) {
    return;
  }

  window.__chronosRecordingStartSignalBooted = true;

  const emitStartSignal = () => {
    window.__chronosRecordingStartLogged = true;
    console.log("START_RECORDING");
  };

  window.__chronosRecordingEmitStartSignal = emitStartSignal;

  const scheduleStartSignals = () => {
    [250, 750, 1500, 3000, 5000, 8000, 12000, 20000].forEach((delay) => {
      window.setTimeout(emitStartSignal, delay);
    });
  };

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", scheduleStartSignals, {
      once: true,
    });
  } else {
    scheduleStartSignals();
  }

  window.addEventListener("load", emitStartSignal, { once: true });
  window.addEventListener("pageshow", emitStartSignal, { once: true });

  window.addEventListener(
    "pagehide",
    () => {
      if (window.__chronosRecordingEndLogged) {
        return;
      }

      window.__chronosRecordingEndLogged = true;
      console.log("END_RECORDING");
    },
    { once: true },
  );
})();
`;

export const metadata: Metadata = {
  robots: {
    follow: false,
    index: false,
  },
  title: "Chronos Recording View",
};

export default function ChronosRecordingViewRoute() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: chronosRecordingBootScript }} />
      <ChronosRecordingViewPage />
    </>
  );
}
