import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";
import { contarOBoard } from "@/lib/temis/trabalho-servico";

// O BOARD DA TÊMIS DO PORTAL — o espelho de `/api/temis/board` para quem confecciona.
//
// ⚠️ UM CÓDIGO SÓ: `contarOBoard` é a mesma função da rota do hub. Com o ator do portal, as três
// leituras (planos, minutas e quem recebe CAD) saem do banco já recortadas aos empreendimentos da
// sessão, e a contagem de outro produto nem é lida. Lista vazia aqui é real (os produtos dele podem
// não estar recebendo CAD), e não falha de leitura.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return contarOBoard(auth.ator);
}
