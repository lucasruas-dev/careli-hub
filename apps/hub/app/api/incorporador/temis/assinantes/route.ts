import {
  incluirAssinante,
  lerQuadroDeAssinatura,
  removerAssinante,
} from "@/lib/temis/estrutura-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// O QUADRO DE ASSINATURA PELO PORTAL — o espelho de `/api/temis/assinantes`.
//
// CRUD completo (ler, incluir, remover), só no empreendimento do alcance, pelas MESMAS funções do
// hub (`lib/temis/estrutura-servico.ts`). O quadro traz nome, CPF mascarado e e-mail de quem assina:
// fora do alcance é 404 antes de ler a tabela e o representante legal do cadastro.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return lerQuadroDeAssinatura(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return incluirAssinante(auth.ator, request);
}

export async function DELETE(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return removerAssinante(auth.ator, request);
}
