import {
  descartarEdicaoDoContrato,
  salvarEdicaoDoContrato,
} from "@/lib/temis/contrato-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// A ALTERAÇÃO MANUAL DO CONTRATO NO PORTAL — o espelho de `/api/temis/contrato/edicao`.
//
// ⚠️ UM CÓDIGO SÓ: `salvarEdicaoDoContrato` e `descartarEdicaoDoContrato`
// (`lib/temis/contrato-servico.ts`) são as funções do hub — o mesmo teto, a mesma recusa de texto
// vazio e a mesma faxina do HTML colado, que é o que impede `<script>` de chegar ao Chromium. O que o
// ator do portal muda nelas:
//   • PUT e DELETE só valem para a proposta cujos cards são todos deste incorporador, no escopo da
//     sessão (reescrever cláusula de contrato da Careli é o ato que esta porta mais precisa fechar);
//   • a `minutaId` do corpo, gravada como base da edição, precisa ser de empreendimento da sessão;
//   • `editado_por` é o usuário do portal e `editado_por_nome` leva a origem escrita.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function PUT(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return salvarEdicaoDoContrato(auth.ator, request);
}

export async function DELETE(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return descartarEdicaoDoContrato(auth.ator, request);
}
