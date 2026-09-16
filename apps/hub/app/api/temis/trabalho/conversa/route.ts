import {
  autorizarEmissaoDeContrato,
  autorizarLeituraDeContrato,
} from "@/lib/temis/autorizacao";
import {
  atorDoHub,
  escreverNaConversaDoTrabalho,
  lerConversaDoTrabalho,
} from "@/lib/temis/trabalho-servico";

// A CONVERSA DA VENDA, VISTA PELA TÊMIS.
//
// Lucas (09/09/2026): *"chat - documento - historico ficam em todas as etapas"* — a coluna fixa da
// tela de trabalho.
//
// ⚠️ ESTA ROTA É SÓ A PORTA DO HUB. Ler e escrever moram em `lib/temis/trabalho-servico.ts`, e são
// as mesmas funções que `/api/incorporador/temis/trabalho/conversa` chama com o ator do portal —
// que só alcança a conversa da proposta de um trabalho DELE.
//
// ⚠️ E NÃO É `/api/incorporador/venda/conversa`. Aquela autoriza pelo cookie `apolo_inc` e recorta
// pelo LOTE (o coordenador vê a unidade); esta recorta pela PROPOSTA, que é a chave do card. Um lote
// passa por várias negociações, e num card da Têmis a conversa do comprador anterior seria de outra
// venda.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarLeituraDeContrato(request);
  if (!auth.ok) return auth.response;

  return lerConversaDoTrabalho(atorDoHub(auth, "leitura"), request);
}

export async function POST(request: Request) {
  // Escrever na conversa é ato de quem trabalha o contrato, não de quem consulta.
  const auth = await autorizarEmissaoDeContrato(request);
  if (!auth.ok) return auth.response;

  return escreverNaConversaDoTrabalho(atorDoHub(auth, "coordenacao"), request);
}
