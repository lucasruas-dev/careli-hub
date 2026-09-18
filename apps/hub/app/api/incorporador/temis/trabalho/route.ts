import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";
import { abrirCardDoTrabalho, decidirSobreOTrabalho } from "@/lib/temis/trabalho-servico";

// A TELA DE TRABALHO DE UM CARD, PELO PORTAL — o espelho de `/api/temis/trabalho`.
//
// ⚠️ UM CÓDIGO SÓ: abrir o card e decidir sobre ele (indeferir, concluir cancelamento ou distrato,
// voltar para análise cancelando o
// envelope da Clicksign) são as mesmas funções da rota do hub. O card precisa ser do incorporador
// (`operado_por`) E estar no escopo da sessão, conferido ANTES de ler; fora disso, 404.
//
// ⚠️ NO PORTAL, QUALQUER CONTA QUE CONFECCIONA EMITE E DECIDE. No hub o POST é da coordenação e o
// `podeEmitir` é a régua dela; aqui a decisão do Lucas (16/09/2026) é o time inteiro da Cecílio
// operar (*"eles meio que vão andar sozinhos"*), então `podeEmitir` é `true` e o POST passa só pela
// porta do portal. O autor gravado é o usuário do portal (`idDoAutor` + `nomeDoAutor`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O mesmo teto da rota do hub, pelo mesmo motivo: voltar para análise pode cancelar o envelope na
// Clicksign, e o corte da Vercel no meio disso deixaria ninguém sabendo se o envelope morreu.
export const maxDuration = 60;

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return abrirCardDoTrabalho(auth.ator, request, { podeEmitir: async () => true });
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return decidirSobreOTrabalho(auth.ator, request);
}
