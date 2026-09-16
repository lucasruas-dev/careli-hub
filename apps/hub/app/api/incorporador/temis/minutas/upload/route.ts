import {
  confirmarUploadDeMidia,
  pedirUploadDeMidia,
  reassinarMidia,
} from "@/lib/temis/minutas-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// A MÍDIA DO EDITOR PELO PORTAL — o espelho de `/api/temis/minutas/upload`.
//
// ⚠️ SEM BEARER, E SEM ARQUIVO NO CORPO. O editor da Cecílio pede aqui a URL assinada (cookie
// `apolo_inc`, same-origin), sobe os bytes direto para o Storage com o `token` dela e volta para
// confirmar. A função da Vercel nunca vê o arquivo, e o teto de ~4,5 MB do corpo não se aplica.
//
// As MESMAS funções do hub (`lib/temis/minutas-servico.ts`): a minuta do pedido, e a do caminho na
// confirmação e na re-assinatura, precisam estar no alcance do ator antes de tocar no Storage.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return pedirUploadDeMidia(auth.ator, request);
}

export async function PATCH(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return confirmarUploadDeMidia(auth.ator, request);
}

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return reassinarMidia(auth.ator, request);
}
