import { notFound } from "next/navigation";

import { getChronosPublicRoomBySlug } from "@/lib/chronos/server";
import { ChronosExternalRoomPage } from "@/modules/chronos/ChronosExternalRoomPage";

export const dynamic = "force-dynamic";

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

  return <ChronosExternalRoomPage room={room} />;
}
