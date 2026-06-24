import { ZeusPage } from "@/modules/squadops/ZeusPage";
import { cookies, headers } from "next/headers";

const zeusDedicatedHost = "ops.c2x.app.br";

export default async function ZeusModulePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [headerStore, cookieStore, params] = await Promise.all([
    headers(),
    cookies(),
    searchParams,
  ]);
  const host = headerStore.get("host")?.split(":")[0]?.toLowerCase() ?? "";
  // preview do modo OPS (standalone) em qualquer host via ?ops=1 ou cookie
  const forceStandalone =
    params.ops === "1" ||
    cookieStore.get("zeus_preview_ops")?.value === "1";

  return (
    <ZeusPage standalone={host === zeusDedicatedHost || forceStandalone} />
  );
}
