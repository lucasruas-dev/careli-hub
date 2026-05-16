import { HubShell } from "@/layouts/hub-shell";
import { CareDeskPage } from "@/modules/caredesk/CareDeskPage";

export const dynamic = "force-dynamic";

export default function CareDeskModulePage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <CareDeskPage loadFromSupabase />
    </HubShell>
  );
}
