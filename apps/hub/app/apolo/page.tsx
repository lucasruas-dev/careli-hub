import { HubShell } from "@/layouts/hub-shell";
import { ApoloPage } from "@/modules/apolo/ApoloPage";

export const dynamic = "force-dynamic";

export default function ApoloModulePage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <ApoloPage />
    </HubShell>
  );
}
