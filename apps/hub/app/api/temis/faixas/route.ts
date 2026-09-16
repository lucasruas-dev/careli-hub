import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import {
  criarFaixa,
  desativarFaixa,
  editarFaixa,
  lerFaixas,
} from "@/lib/temis/estrutura-servico";

// FAIXAS DE PRAZO DO EMPREENDIMENTO — Temis. A PORTA DO HUB.
//
//   GET    → as faixas de um empreendimento, mais os índices cadastrados
//   POST   → cria uma faixa
//   PATCH  → edita uma faixa
//   DELETE → desativa (não apaga)
//
// Lucas (13/09/2026): *"em vez de cadastrar os juros e correção dentro de um plano, ter um cadastro
// de juros e correção separado por parcelas"*, e *"Faixa é por empreendimento"*.
//
// ⚠️ A LÓGICA MORA EM `lib/temis/estrutura-servico.ts`. O portal da Cecílio LÊ as faixas pela mesma
// função (`/api/incorporador/temis/faixas`) e não grava: planos e faixas continuam com a Careli.
//
// AUTORIZAÇÃO: leitura no GET, ESCRITA nos demais. A faixa decide quanto o comprador paga de juros.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await authorizeApoloRead(request);
  if (!auth.ok) return auth.response;
  return lerFaixas({ nome: auth.nome ?? "", papel: "leitura", tipo: "hub", userId: auth.userId }, request);
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return criarFaixa({ nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId }, request);
}

export async function PATCH(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return editarFaixa({ nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId }, request);
}

export async function DELETE(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;
  return desativarFaixa(
    { nome: auth.nome ?? "", papel: "escrita", tipo: "hub", userId: auth.userId },
    request,
  );
}
