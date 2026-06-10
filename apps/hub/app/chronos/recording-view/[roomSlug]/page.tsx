import type { Metadata } from "next";

import { getChronosPublicRoomBySlug } from "@/lib/chronos/server";
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

export default async function ChronosRecordingViewRoomRoute({
  params,
}: {
  params: Promise<{ roomSlug: string }>;
}) {
  const { roomSlug } = await params;
  const room = await getChronosPublicRoomBySlug(roomSlug).catch(() => null);

  return <ChronosRecordingViewPage initialRoom={room} />;
}
