import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";
import {
  escreverNaConversaDoTrabalho,
  lerConversaDoTrabalho,
} from "@/lib/temis/trabalho-servico";

// A CONVERSA DA VENDA, PELA TÊMIS DO PORTAL — o espelho de `/api/temis/trabalho/conversa`.
//
// ⚠️ UM CÓDIGO SÓ: ler e escrever são as mesmas funções da rota do hub. A `?proposta=` (ou o
// `proposta` do corpo) só abre quando a proposta tem um trabalho DESTE incorporador no escopo da
// sessão, conferido antes da leitura; fora disso, 404. A nota sai com o usuário do portal como
// autor, o mesmo `autor` que a conversa da venda do portal já grava.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return lerConversaDoTrabalho(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return escreverNaConversaDoTrabalho(auth.ator, request);
}
