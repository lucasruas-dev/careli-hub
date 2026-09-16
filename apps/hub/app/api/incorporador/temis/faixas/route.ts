import {
  criarFaixa,
  desativarFaixa,
  editarFaixa,
  lerFaixas,
} from "@/lib/temis/estrutura-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// AS FAIXAS DE PRAZO PELO PORTAL — o espelho de `/api/temis/faixas`, SOMENTE LEITURA.
//
// Decisão de 16/09/2026: planos e faixas continuam com a Careli. O GET lê pela mesma função do hub,
// só no empreendimento do alcance. POST, PATCH e DELETE existem para o pedido ter a mesma forma do
// hub, e a mesma função responde 404 ao portal antes de ler o corpo (`somenteLeituraNoPortal`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return lerFaixas(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return criarFaixa(auth.ator, request);
}

export async function PATCH(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return editarFaixa(auth.ator, request);
}

export async function DELETE(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return desativarFaixa(auth.ator, request);
}
