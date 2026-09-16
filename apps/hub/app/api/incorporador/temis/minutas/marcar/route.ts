import { marcarVariaveisDaMinuta } from "@/lib/temis/minutas-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// O SUPER AGENTE DA MINUTA PELO PORTAL — o espelho de `/api/temis/minutas/marcar`.
//
// ⚠️ A MINUTA ABERTA É CONFERIDA ANTES DO MODELO (decisão do Lucas, 16/09/2026: escrita só no que a
// Cecílio opera). O agente recebe o texto que já está na tela e o catálogo de variáveis e não grava
// nada, mas é o primeiro passo de editar a minuta: `marcarVariaveisDaMinuta` exige a `minutaId` (do
// corpo ou de `?minutaId=`) de produto que o portal opera, e responde 403 só consulta na minuta do
// VOC. Quem entra é `autorizarTemisDoPortal`: cada chamada é um Opus 5 com até 120 mil caracteres, e
// o comercial e o `cer` recebem 404 sem tocar em nada.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Contrato inteiro num modelo de fronteira: precisa de fôlego. O teto da Vercel é 300.
export const maxDuration = 300;

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return marcarVariaveisDaMinuta(auth.ator, request);
}
