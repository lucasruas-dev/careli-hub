import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";
import { lerHistoricoDoTrabalho } from "@/lib/temis/trabalho-servico";

// O HISTÓRICO DA VENDA, PELA TÊMIS DO PORTAL — o espelho de `/api/temis/trabalho/historico`.
//
// ⚠️ UM CÓDIGO SÓ: `lerHistoricoDoTrabalho` é a mesma função da rota do hub. `?trabalho=` e
// `?proposta=` passam cada um pelo seu alcance (o card do incorporador; a proposta de um card
// dele) antes de qualquer leitura. Um só fora já é 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return lerHistoricoDoTrabalho(auth.ator, request);
}
