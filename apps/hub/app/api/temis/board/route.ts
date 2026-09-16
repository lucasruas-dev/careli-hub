import { authorizeApoloRead } from "@/lib/apolo/auth";
import { atorDoHub, contarOBoard } from "@/lib/temis/trabalho-servico";

// O BOARD DA TÊMIS — o que cada empreendimento consegue contratar hoje.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB. A contagem (planos ativos, planos sem minuta, minutas publicadas
// e em rascunho, e a lista de quem recebe CAD) mora em `contarOBoard`
// (`lib/temis/trabalho-servico.ts`), a mesma que `/api/incorporador/temis/board` chama com o ator do
// portal. Para o hub não há recorte: a Careli enxerga todos os empreendimentos.
//
// ⚠️ ESTE BOARD NÃO LISTA TRABALHOS, e por isso não tem filtro de dono: minuta e plano são do
// PRODUTO, que Careli e incorporador dividem. Quem esconde da Careli o que a Cecílio confecciona é
// `/api/temis/trabalhos`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;

  return contarOBoard(atorDoHub(auth, "leitura"));
}
