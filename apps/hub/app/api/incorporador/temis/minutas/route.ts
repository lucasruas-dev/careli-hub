import {
  arquivarMinuta,
  criarMinuta,
  lerMinutas,
  salvarMinuta,
} from "@/lib/temis/minutas-servico";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// AS MINUTAS PELO PORTAL — o espelho de `/api/temis/minutas`, com o mesmo pedido e a mesma resposta.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio *"também cria e edita os modelos"* dos produtos
// dela. Listar, abrir, criar, salvar, publicar e arquivar passam pelas MESMAS funções do hub
// (`lib/temis/minutas-servico.ts`), com o ator do portal: minuta de empreendimento fora do alcance
// (ou de um consolidado que não é inteiro dela) responde 404 antes de qualquer leitura.
//
// ⚠️ A MINUTA É DO PRODUTO, NÃO DA VENDA: a versão que o time da Cecílio publica vale também para os
// contratos das vendas da Gurgel naquele produto, que a Careli confecciona. O nome de quem mexe vai
// gravado com "(portal do incorporador)".
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return lerMinutas(auth.ator, request);
}

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return criarMinuta(auth.ator, request);
}

export async function PATCH(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return salvarMinuta(auth.ator, request);
}

export async function DELETE(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;
  return arquivarMinuta(auth.ator, request);
}
