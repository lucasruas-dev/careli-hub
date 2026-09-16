import { NextResponse } from "next/server";

import { montarFilaDoBoard } from "@/lib/apolo/board-do-servidor";
import { analistasParaPortal } from "@/lib/apolo/incorporador/analistas-do-portal";
import {
  adminOu503,
  autorizarOperacaoDeVenda,
  recorteDoProduto,
  recorteParaFila,
} from "@/lib/apolo/incorporador/board-do-portal";
import { filaDoBoardParaPortal } from "@/lib/apolo/incorporador/fila-do-portal";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";

// A FILA DO BOARD DO APOLO, recortada pelo produto, pelo portal que opera a venda — GET /api/incorporador/board?emp=
//
// Pedido do Lucas (02/09/2026): a aba Cadastro do produto no Hércules é *"a mesma visão do apolo,
// imobiliária e cads"*. MESMO payload de GET /api/apolo/board ({ analistas, empreendimentos,
// itens, usuarioAtual }), MESMO miolo (`montarFilaDoBoard`), duas diferenças:
//   • só os itens cujo `enterpriseId` (CAD) ou cujo vínculo (imobiliária) está no recorte;
//   • `empreendimentos` são os nomes do produto (não os "abertos a credenciamento" do hub), e
//     `usuarioAtual` é a conta do portal (ela não está em hub_users).
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DA URL (ver board-do-portal.ts). Produto fora do escopo: 404.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  // (16/09/2026, D4) OS NOMES DOS ANALISTAS SÓ PARA O COMERCIAL. Decisão do Lucas: a Gurgel
  // (comercial) volta a ver os analistas da Careli como antes da onda 1; fora dele, a lista não sai do
  // servidor (`comAnalistasDoHub` ausente = vazia).
  const comercial = ehPortalComercial(auth.sessao.tipo);

  const fila = await montarFilaDoBoard(admin.client, {
    recorte: { ...recorteParaFila(rec.recorte), comAnalistasDoHub: comercial },
    usuarioId: auth.sessao.usuarioId,
  });
  if (!fila.ok) {
    return NextResponse.json({ error: fila.error }, { status: fila.status });
  }

  // (16/09/2026) OS ANALISTAS SEM A EQUIPE DA CARELI FORA DO COMERCIAL. A tela interna recebe nome e
  // e-mail de todo `hub_users`; no portal que opera sozinho vai só a conta do portal e, quando algum
  // card tem analista da Careli, uma entrada "Equipe Careli" no lugar dele
  // (lib/apolo/incorporador/analistas-do-portal.ts). O comercial recebe a fila com os nomes (D4).
  //
  // (16/09/2026, revisão) E, FORA DO COMERCIAL, SEM A ANÁLISE DE CRÉDITO: a etapa `revisao` vira
  // `credito` e o motivo da reprovação no Serasa não sai (lib/apolo/incorporador/fila-do-portal.ts).
  //
  // (16/09/2026, crédito no portal) O portal que opera sozinho (o Cecílio) também vê a fila como
  // ela é: é ele quem consulta o Serasa, aprova com restrição e indefere as CADs do próprio produto.
  const filaDoPortal = filaDoBoardParaPortal(fila.data, auth.sessao);

  return NextResponse.json(
    { data: comercial ? filaDoPortal : analistasParaPortal(filaDoPortal) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
