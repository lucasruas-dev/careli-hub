import { previaDoContrato } from "@/lib/temis/contrato-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// A PRÉVIA DO CONTRATO NO PORTAL — o espelho de `/api/temis/contrato/previa` para o incorporador
// que confecciona a própria venda (hoje só `cecilio-rocha`).
//
// Decisões do Lucas (16/09/2026): a venda feita pelo time da Cecílio vai para a confecção DELA, no
// portal; a da Gurgel continua na Têmis da Careli. Mesmo corpo e mesma resposta da rota do hub, para
// a `PreviaDoContrato` só trocar a base e a credencial (cookie `apolo_inc` same-origin).
//
// ⚠️ UM CÓDIGO SÓ: a prévia inteira é `previaDoContrato` (`lib/temis/contrato-servico.ts`), a mesma
// função do hub. O que o ator do portal muda nela:
//   • a proposta só abre se TODOS os cards dela forem deste incorporador e estiverem no escopo da
//     sessão (a venda da Gurgel no VOC é da Careli: 404);
//   • a `minutaId` do corpo, quando vem, precisa ser de empreendimento da sessão;
//   • a edição manual vigente volta junto, porque quem confecciona é quem edita.
//
// ⚠️ A PORTA É `autorizarTemisDoPortal`: sem sessão 401; comercial (Gurgel) e `cer` 404 sem tocar
// no banco; cadastro inativo ou divergente 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return previaDoContrato(auth.ator, request);
}
