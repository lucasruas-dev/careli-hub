import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";
import { lerDocumentosDoTrabalho } from "@/lib/temis/trabalho-servico";

// OS DOCUMENTOS DA VENDA, PELA TÊMIS DO PORTAL — o espelho de `/api/temis/trabalho/documentos`.
//
// ⚠️ UM CÓDIGO SÓ: `lerDocumentosDoTrabalho` é a mesma função da rota do hub. Com o ator do portal:
//   • a proposta precisa ter um trabalho DESTE incorporador no escopo, conferido antes de ler;
//   • os documentos do proponente saem por `documentosDoApoloParaPortal` (a régua de toda porta de
//     portal sobre `listApoloDocuments`), como portal que opera sozinho: o COMPROVANTE DO SERASA sai
//     só das CADs do escopo (a Cecílio faz a análise de crédito dela), e a peça interna da Careli
//     nunca sai, nem na lista nem pelo `?abrir=`;
//   • `?abrir=` só assina link de documento que está na lista que este ator recebe.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  return lerDocumentosDoTrabalho(auth.ator, request);
}
