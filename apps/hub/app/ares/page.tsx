import { HubShell } from "@/layouts/hub-shell";
import { AresPage } from "@/modules/ares/AresPage";

export const dynamic = "force-dynamic";

export default function AresModulePage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <AresPage />
    </HubShell>
  );
}
