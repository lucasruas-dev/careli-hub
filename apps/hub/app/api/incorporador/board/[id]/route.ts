import {
  type CorpoDaFicha,
  lerFichaDoBoard,
  salvarFichaDoBoard,
} from "@/lib/apolo/board-do-servidor";
import {
  adminOu503,
  autorizarComercial,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";

// A FICHA de um item do Board, pelo portal comercial — GET e PATCH /api/incorporador/board/[id]?emp=
//
// Mesmo miolo da rota do hub (`lerFichaDoBoard` / `salvarFichaDoBoard`), com o escopo conferido
// ANTES: a CAD (entity_id + enterprise_id) tem que estar no produto do coordenador. Sem
// `?enterpriseId=`, a ficha é a da CAD mais recente DENTRO do recorte — nunca a de outro
// loteamento, que é o que o default "mais recente" da rota do hub devolveria.
//
// O autor da edição é a conta do portal (sessao.usuarioId / usuarioNome): o uuid vai em
// `actor_user_id` (a coluna não tem FK) e o nome no metadata, porque a conta não está em
// hub_users e o histórico mostraria um traço.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const pedido = new URL(request.url).searchParams.get("enterpriseId");

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte, pedido);
  if (!escopo.ok) return escopo.response;

  return lerFichaDoBoard(admin.client, id, escopo.escopo.enterpriseId);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const { id } = await context.params;
  const body = (await request.json().catch(() => ({}))) as CorpoDaFicha;

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte, body.enterpriseId);
  if (!escopo.ok) return escopo.response;

  // A CAD alvo é a que o escopo resolveu (a pedida, ou a mais recente do produto). Imobiliária
  // (sem esteira) segue com `enterpriseId` nulo e grava no cadastro da entidade, como no hub.
  return salvarFichaDoBoard(
    admin.client,
    id,
    { ...body, enterpriseId: escopo.escopo.enterpriseId },
    auth.sessao.usuarioId,
    auth.sessao.usuarioNome,
  );
}
