import { HubShell } from "@/layouts/hub-shell";
import { IrisPage } from "@/modules/caredesk/IrisPage";

export const dynamic = "force-dynamic";

export default function IrisModulePage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <IrisPage loadFromSupabase />
    </HubShell>
  );
}
