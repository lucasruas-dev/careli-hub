import { consertarSignatario } from "@/lib/temis/assinatura-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// CONSERTAR UM SIGNATÁRIO PELO PORTAL — o espelho de `/api/temis/assinatura/signatario`.
//
//   POST { acao: "reenviar",     envelopeId, signerId }
//   POST { acao: "trocar_email", email, envelopeId, signerId }
//
// ⚠️ UM CÓDIGO SÓ: `consertarSignatario` (`lib/temis/assinatura-servico.ts`) é a função do hub, com
// a mesma leitura do envelope no nosso banco antes de falar com a Clicksign e a mesma recusa de
// e-mail torto antes da remoção (o ponto sem volta).
//
// ⚠️ O QUE O ATOR DO PORTAL ACRESCENTA É O DONO DO ENVELOPE. O `envelopeId` vem do corpo; antes de
// qualquer chamada ele é traduzido na proposta dele (`temis_envelopes.proposta_id`), e a proposta
// precisa ter todos os cards deste incorporador, no escopo da sessão. Sem isso, alguém de fora
// removeria signatário de um contrato da Careli, dentro da conta da Careli. Fora do alcance: 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return consertarSignatario(auth.ator, request);
}
