import type { Metadata } from "next";

import { ChronosRecordingViewPage } from "@/modules/chronos/ChronosRecordingViewPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  other: {
    google: "notranslate",
  },
  robots: {
    follow: false,
    index: false,
  },
  title: "Chronos Recording View",
};

export default function ChronosRecordingViewRoute() {
  return <ChronosRecordingViewPage />;
}
