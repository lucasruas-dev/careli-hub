import { HubShell } from "@/layouts/hub-shell";
import { ChronosPage } from "@/modules/chronos/ChronosPage";

export const dynamic = "force-dynamic";

export default function ChronosModulePage() {
  return (
    <HubShell layoutMode="module">
      <ChronosPage />
    </HubShell>
  );
}
