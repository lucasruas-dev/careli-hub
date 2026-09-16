import { conversarSobreAMinuta } from "@/lib/temis/minutas-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// A CONVERSA COM O AGENTE DA MINUTA PELO PORTAL — o espelho de `/api/temis/minutas/conversar`.
//
// ⚠️ A MINUTA ABERTA É CONFERIDA ANTES DO MODELO, como na varredura (decisão do Lucas, 16/09/2026:
// escrita só no que a Cecílio opera). O agente conversa sobre o texto que a tela manda e não grava
// nada, mas só na minuta (`minutaId` do corpo ou `?minutaId=`) de produto que o portal opera. Quem
// entra é decidido por `autorizarTemisDoPortal`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return conversarSobreAMinuta(auth.ator, request);
}
