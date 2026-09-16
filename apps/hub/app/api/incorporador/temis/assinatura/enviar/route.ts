import { enviarContratoDoAtor, preparoDoEnvio } from "@/lib/temis/assinatura-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// MANDAR O CONTRATO PARA ASSINATURA PELO PORTAL — o espelho de `/api/temis/assinatura/enviar`.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio manda para assinatura os contratos que ela
// confecciona, *pela Clicksign da conta da Careli*, com registro de quem enviou.
//
// ⚠️ UM CÓDIGO SÓ: `preparoDoEnvio` e `enviarContratoDoAtor` (`lib/temis/assinatura-servico.ts`) são
// as funções do hub, e é por elas que a MESMA conta, a MESMA guarda contra o segundo envelope e a
// MESMA conferência de e-mail repetido valem aqui. O que o ator do portal muda:
//   • GET e POST só para a proposta cujos cards são todos deste incorporador, no escopo da sessão —
//     antes de listar e-mail de comprador e antes de qualquer chamada à Clicksign;
//   • `temis_envelopes.enviado_por` é o usuário do portal e `enviado_por_nome` leva a origem
//     escrita; o log registra incorporador, usuário e envelope.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// ⚠️ O MESMO TETO DO HUB (120s), E NÃO É ENFEITE: `JANELA_DE_ENVIO_EM_CURSO_EM_MS`, em
// `lib/assinatura/envio-db.ts`, é calculada a partir dele. Um teto maior aqui faria a guarda chamar de
// "morto" um envio do portal que ainda está chamando a Clicksign.
export const maxDuration = 120;

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return preparoDoEnvio(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return enviarContratoDoAtor(auth.ator, request);
}
