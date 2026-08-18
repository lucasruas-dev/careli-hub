import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

// A gestão de incorporadores MUDOU para o Setup (pedido do Lucas, 18/08/2026: "essa tela poderia
// estar dentro do setup"). O link antigo já circulou em mensagens e no changelog, então esta rota
// não pode quebrar: só encaminha para a aba nova.
export default function IncorporadoresPage() {
  redirect("/setup?aba=incorporadores");
}
