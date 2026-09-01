import { HubShell } from "@/layouts/hub-shell";
import { TemisPage } from "@/modules/temis/TemisPage";

export const dynamic = "force-dynamic";

export default function TemisModulePage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <TemisPage />
    </HubShell>
  );
}
