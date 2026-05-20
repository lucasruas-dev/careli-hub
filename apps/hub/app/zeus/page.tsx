import { ZeusPage } from "@/modules/squadops/ZeusPage";
import { headers } from "next/headers";

const zeusDedicatedHost = "ops.c2x.app.br";

export default async function ZeusModulePage() {
  const headerStore = await headers();
  const host = headerStore.get("host")?.split(":")[0]?.toLowerCase() ?? "";

  return <ZeusPage standalone={host === zeusDedicatedHost} />;
}
