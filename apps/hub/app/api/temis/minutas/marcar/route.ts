import { authorizeApoloRead } from "@/lib/apolo/auth";
import { marcarVariaveisDaMinuta } from "@/lib/temis/minutas-servico";

// O SUPER AGENTE DA MINUTA — lê o texto e diz onde cada variável entra. A PORTA DO HUB.
//
// Lucas (07/09/2026): *"isso é o que eu quero, um super agente que consiga inserir as variáveis,
// olhar o texto e identificar onde as variáveis vão, e conhece todas as variáveis, pode subir para
// opus 5"*.
//
// ⚠️ A LÓGICA (as duas passadas, o stream, o prazo de 280 segundos, a triagem das propostas) MORA
// EM `lib/temis/minutas-servico.ts`: o portal da Cecílio usa o mesmo agente pela
// `/api/incorporador/temis/minutas/marcar`.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// Contrato inteiro num modelo de fronteira: precisa de fôlego. O teto da Vercel é 300.
export const maxDuration = 300;

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;
  return marcarVariaveisDaMinuta(
    {
      nome: autorizacao.nome ?? "",
      papel: "leitura",
      tipo: "hub",
      userId: autorizacao.userId,
    },
    request,
  );
}
