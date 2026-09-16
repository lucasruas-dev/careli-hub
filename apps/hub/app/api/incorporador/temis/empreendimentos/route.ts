import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";
import { listarEmpreendimentosDaTemis } from "@/lib/temis/trabalho-servico";

// OS EMPREENDIMENTOS DA TÊMIS DO PORTAL — o espelho de `/api/temis/empreendimentos`.
//
// ⚠️ UM CÓDIGO SÓ: `listarEmpreendimentosDaTemis` é a mesma função da rota do hub. Com o ator do
// portal, a lista é a dos empreendimentos que recebem CAD E estão na sessão já expandida, com a
// assimetria do portal: quem tem só a divisão não recebe a linha do consolidado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return listarEmpreendimentosDaTemis(auth.ator);
}
