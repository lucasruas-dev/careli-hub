import { HubShell } from "@/layouts/hub-shell";
import { IrisPage } from "@/modules/caredesk/IrisPage";

export const dynamic = "force-dynamic";

export default async function IrisModulePage({
  searchParams,
}: {
  searchParams: Promise<{ atendimento?: string }>;
}) {
  const { atendimento } = await searchParams;

  return (
    <HubShell chrome="operational" layoutMode="module">
      <IrisPage
        loadFromSupabase
        initialAttendanceProtocol={atendimento ?? null}
      />
    </HubShell>
  );
}
