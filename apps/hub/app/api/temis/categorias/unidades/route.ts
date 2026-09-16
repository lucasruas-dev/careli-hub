import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  lerUnidadesParaCategoria,
  vincularUnidadesACategoria,
} from "@/lib/temis/estrutura-servico";

// VINCULAR UNIDADES A UMA CATEGORIA — a segunda metade do pedido do Lucas (15/09/2026). A PORTA DO
// HUB.
//
// *"eu criei umas categorias mas não tem como eu vincular a unidade aquela categoria, não temos a
// tela de cadastro da unidade a qual eu posso vincular aquela unidade ao filho, categoria"*.
//
// ⚠️ A LÓGICA MORA EM `lib/temis/estrutura-servico.ts` (o alcance por terreno, a família do
// empreendimento, a paginação). O portal da Cecílio LÊ a lista pela mesma função
// (`/api/incorporador/temis/categorias/unidades`) e não vincula.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return vincularUnidadesACategoria(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;
  return lerUnidadesParaCategoria(
    { nome: auth.nome ?? "", papel: "leitura", tipo: "hub", userId: auth.userId },
    request,
  );
}
