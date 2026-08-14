import { responder } from "@/lib/integrations/glotes/handler";

// Conjunto "vendas" da carteira Lavra do Ouro para o GLOTES.
// Autenticação, teto, validação de parâmetro e log ficam em lib/integrations/glotes/.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  return responder(request, "vendas");
}
