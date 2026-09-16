import {
  apagarCategoria,
  criarCategoria,
  editarCategoria,
  lerCategorias,
} from "@/lib/temis/estrutura-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// AS CATEGORIAS PELO PORTAL — o espelho de `/api/temis/categorias`, SOMENTE LEITURA.
//
// O GET lê pela mesma função do hub. A categoria mora no PAI (o VLO é o pai do VOC da Cecílio e do
// VOL do Lino), então ela é lida a partir da divisão do alcance, e o que é de outro dono sai
// recortado: a contagem de lotes e a ordem de assinatura herdada contam só as divisões do ator.
// POST, PATCH e DELETE respondem 404 ao portal (`somenteLeituraNoPortal`): a categoria continua com
// a Careli.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return lerCategorias(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return criarCategoria(auth.ator, request);
}

export async function PATCH(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return editarCategoria(auth.ator, request);
}

export async function DELETE(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return apagarCategoria(auth.ator, request);
}
