import { SquadOpsPage } from "@/modules/squadops/SquadOpsPage";
import { headers } from "next/headers";

const squadOpsDedicatedHost = "ops.c2x.app.br";

export default async function SquadOpsModulePage() {
  const headerStore = await headers();
  const host = headerStore.get("host")?.split(":")[0]?.toLowerCase() ?? "";

  return <SquadOpsPage standalone={host === squadOpsDedicatedHost} />;
}
