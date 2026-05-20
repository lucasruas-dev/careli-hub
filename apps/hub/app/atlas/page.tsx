import { HubShell } from "@/layouts/hub-shell";
import { AtlasPage } from "@/modules/atlas/AtlasPage";

export const dynamic = "force-dynamic";

export default function AtlasModulePage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <AtlasPage />
    </HubShell>
  );
}
