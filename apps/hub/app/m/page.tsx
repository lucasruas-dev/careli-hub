import { redirect } from "next/navigation";

// A tela inicial do mobile é a fila de atendimento (Iris).
export default function MobileHomePage() {
  redirect("/m/iris");
}
