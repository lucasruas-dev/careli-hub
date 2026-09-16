import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  apagarCategoria,
  criarCategoria,
  editarCategoria,
  lerCategorias,
} from "@/lib/temis/estrutura-servico";

// CATEGORIAS DO TEMIS — o agrupamento livre de planos dentro do empreendimento. A PORTA DO HUB.
//
// Pedido do Lucas (01/09/2026): *"empreendimento já vai vir do apolo, ae eu posso criar as
// subcategorias"*.
//
// ⚠️ A LÓGICA MORA EM `lib/temis/estrutura-servico.ts` (a categoria vive no PAI, a ordem de
// assinatura herdada, a contagem de lotes por terreno). O portal da Cecílio LÊ pela mesma função
// (`/api/incorporador/temis/categorias`) e não grava: a categoria continua com a Careli.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;
  return lerCategorias(
    { nome: auth.nome ?? "", papel: "leitura", tipo: "hub", userId: auth.userId },
    request,
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return criarCategoria(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return editarCategoria(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return apagarCategoria(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}
