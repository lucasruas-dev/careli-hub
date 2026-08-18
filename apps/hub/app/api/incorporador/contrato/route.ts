import { NextResponse } from "next/server";

import { contratoDaUnidade } from "@/lib/apolo/incorporador/contrato";
import { autorizar, foraDoEscopo, unidadeNoEscopo } from "@/lib/apolo/incorporador/escopo";
import { fetchD4SignContract } from "@/lib/guardian/d4sign";

// O CONTRATO ASSINADO DE UMA UNIDADE — o PDF do D4Sign, proxiado, para a Carteira do portal.
//
// Pedido do Lucas (18/08/2026): *"temos que trazer o contrato e nas parcelas dentro de carteira o
// link do boleto do asaas"*. A coluna Contrato existia só na tela interna; esta rota é a versão
// escopada dela (a interna, /api/apolo/empreendimentos/contrato/[id], recebe o uuid cru e NÃO
// atravessa para o portal — não confere dono).
//
// A ORDEM É FIXA E NÃO SE INVERTE (mesmo desenho de /api/incorporador/parcelas):
//   1. `autorizar`         — sem sessão assinada, 401 e nada mais roda;
//   2. `unidadeNoEscopo`   — a unidade é de um empreendimento DESTA sessão? ANTES de qualquer
//      leitura de dado;
//   3. `contratoDaUnidade` — o uuidDoc sai DO C2X, para AQUELA unidade. A rota NÃO aceita uuid
//      vindo da URL: aceitar transformaria o proxy num "baixe qualquer contrato da base";
//   4. `fetchD4SignContract` — o token D4Sign fica no servidor, NUNCA chega ao navegador (mesmo
//      desenho de /api/incorporador/crm/documentos/abrir e /api/hades/d4sign/contracts).
//
// Unidade fora do escopo, inexistente OU sem contrato assinado = 404 igualzinho (`foraDoEscopo`):
// para quem pergunta, os três casos são "não existe" — 403 ou mensagens diferentes confirmariam
// que o id é de alguém.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const cru = new URL(request.url).searchParams.get("unitId")?.trim() ?? "";
  const unitId = Number(cru);

  // Id que nem é um id responde como unidade que não existe.
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return foraDoEscopo();
  }

  // Escopo ANTES de qualquer leitura de dado. Fail-closed.
  const pertence = await unidadeNoEscopo(unitId, auth.sessao);
  if (!pertence) {
    return foraDoEscopo();
  }

  // O documento DESTA unidade, resolvido no C2X — nunca um uuid do cliente.
  const contrato = await contratoDaUnidade(unitId);
  if (!contrato) {
    return foraDoEscopo();
  }

  const pdf = await fetchD4SignContract(contrato.uuidDoc);
  if (!pdf.ok) {
    return NextResponse.json(
      { error: "Não foi possível abrir o contrato agora." },
      { status: pdf.status >= 500 ? pdf.status : 502 },
    );
  }

  const isPdf =
    pdf.contentType.includes("application/pdf") ||
    pdf.contentType.includes("application/octet-stream");
  const headers = new Headers({
    // "private": é dado do cliente logado — nenhum cache compartilhado pode guardar.
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="Contrato ${contrato.unidade}.pdf"`,
    "Content-Type": isPdf ? "application/pdf" : pdf.contentType,
    "X-Content-Type-Options": "nosniff",
  });
  if (pdf.contentLength) headers.set("Content-Length", pdf.contentLength);

  return new NextResponse(pdf.body, { headers });
}
