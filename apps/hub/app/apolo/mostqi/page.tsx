import { HubShell } from "@/layouts/hub-shell";
import { MostqiTester } from "@/modules/apolo/blocks/mostqi/mostqi-tester";

export const dynamic = "force-dynamic";

export default function ApoloMostqiTestPage() {
  return (
    <HubShell chrome="operational" layoutMode="module">
      <MostqiTester />
    </HubShell>
  );
}
