import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { isChronosLiveKitProviderEnabled } from "@/lib/chronos/livekit";
import { getChronosPublicRoomBySlug } from "@/lib/chronos/server";
import { ChronosExternalRoomPage } from "@/modules/chronos/ChronosExternalRoomPage";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description: "Convite de reunião Careli pelo Chronos.",
  openGraph: {
    description: "Acesse a sala da reunião Chronos.",
    images: [
      {
        alt: "Careli",
        height: 1600,
        url: "/careli-invite-logo.png",
        width: 1600,
      },
    ],
    siteName: "Careli",
    title: "Convite Careli",
    type: "website",
  },
  other: {
    google: "notranslate",
  },
  title: "Convite Careli | Chronos",
  twitter: {
    card: "summary_large_image",
    description: "Acesse a sala da reunião Chronos.",
    images: ["/careli-invite-logo.png"],
    title: "Convite Careli",
  },
};

export default async function ChronosExternalRoomRoute({
  params,
}: {
  params: Promise<{ roomSlug: string }>;
}) {
  const { roomSlug } = await params;
  const room = await getChronosPublicRoomBySlug(roomSlug);

  if (!room) {
    notFound();
  }

  return (
    <ChronosExternalRoomPage
      isLiveKitProviderEnabled={isChronosLiveKitProviderEnabled()}
      room={room}
    />
  );
}
