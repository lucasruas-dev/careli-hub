import {
  lerUnidadesParaCategoria,
  vincularUnidadesACategoria,
} from "@/lib/temis/estrutura-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// AS UNIDADES DA CATEGORIA PELO PORTAL — o espelho de `/api/temis/categorias/unidades`, SOMENTE
// LEITURA.
//
// O GET lista pela mesma função do hub, recortada à família DO ALCANCE: a família do empreendimento
// sobe ao pai e desce a todas as divisões, e sem o recorte a Cecílio (VOC) receberia os lotes do
// Lino (VOL). O PATCH (vincular) responde 404 ao portal (`somenteLeituraNoPortal`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return vincularUnidadesACategoria(auth.ator, request);
}

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return lerUnidadesParaCategoria(auth.ator, request);
}
