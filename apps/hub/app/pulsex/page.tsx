import { HERMES_ROUTE } from "@/lib/pulsex/routes";
import { redirect } from "next/navigation";

export default function LegacyHermesPage() {
  redirect(HERMES_ROUTE);
}
