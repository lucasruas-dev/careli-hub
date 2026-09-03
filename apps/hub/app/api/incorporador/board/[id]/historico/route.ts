import { historicoDaFicha } from "@/lib/apolo/board-do-servidor";
import {
  adminOu503,
  autorizarComercial,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";

// HISTÓRICO da ficha pelo portal comercial — GET /api/incorporador/board/[id]/historico?emp=
//
// Mesmo miolo da rota do hub (`historicoDaFicha`), com o escopo conferido antes: a pessoa tem
// que ter CAD (ou vínculo de imobiliária) no produto do coordenador. Fora dele: 404.
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

  const escopo = await cadNoEscopo(admin.client, id, rec.recorte);
  if (!escopo.ok) return escopo.response;

  return historicoDaFicha(admin.client, id);
}
