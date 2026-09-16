import { autorizarLeituraDeContrato } from "@/lib/temis/autorizacao";
import { atorDoHub, lerHistoricoDoTrabalho } from "@/lib/temis/trabalho-servico";

// O HISTÓRICO DA VENDA, VISTO PELA TÊMIS — a terceira aba da coluna fixa.
//
// Lucas (09/09/2026): *"chat - documentos - historico"*, e *"ficam em todas as etapas"*.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB. A montagem (o funil do Hércules por `?proposta=` e as passagens
// de etapa do card por `?trabalho=`, numa lista só, ordenada pela data) mora em
// `lerHistoricoDoTrabalho` (`lib/temis/trabalho-servico.ts`), a mesma que
// `/api/incorporador/temis/trabalho/historico` chama com o ator do portal.
//
// ⚠️ UMA LISTA SÓ, ORDENADA PELA DATA — e não duas listas lado a lado. Quem lê está perguntando "o
// que aconteceu com esta venda, em que ordem"; quem diz de onde veio cada linha é o campo `fonte`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  return lerHistoricoDoTrabalho(atorDoHub(auth, "leitura"), request);
}
