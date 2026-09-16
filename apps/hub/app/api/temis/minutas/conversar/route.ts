import { authorizeApoloRead } from "@/lib/apolo/auth";
import { conversarSobreAMinuta } from "@/lib/temis/minutas-servico";

// A CONVERSA COM O AGENTE DA MINUTA — perguntar, corrigir, mandar fazer. A PORTA DO HUB.
//
// Lucas, 08/09/2026: *"acho que pode ter um chat entre o usuário e o agente"* e *"ele precisa
// entender muito sobre contratos, as nossas variáveis, queria esse tipo de interação"*.
//
// ⚠️ A LÓGICA MORA EM `lib/temis/minutas-servico.ts`: o portal da Cecílio conversa com o mesmo
// agente pela `/api/incorporador/temis/minutas/conversar`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;
  return conversarSobreAMinuta(
    {
      nome: autorizacao.nome ?? "",
      papel: "leitura",
      tipo: "hub",
      userId: autorizacao.userId,
    },
    request,
  );
}
