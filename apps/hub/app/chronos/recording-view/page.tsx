import type { Metadata } from "next";

import { ChronosRecordingViewPage } from "@/modules/chronos/ChronosRecordingViewPage";

export const dynamic = "force-dynamic";

const chronosRecordingBootScript = `
(() => {
  if (window.__chronosRecordingStartLogged) {
    return;
  }

  window.__chronosRecordingStartLogged = true;
  console.log("START_RECORDING");

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
