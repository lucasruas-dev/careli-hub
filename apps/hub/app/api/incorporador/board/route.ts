import { NextResponse } from "next/server";

import { montarFilaDoBoard } from "@/lib/apolo/board-do-servidor";
import {
  adminOu503,
  autorizarComercial,
  recorteDoProduto,
  recorteParaFila,
} from "@/lib/apolo/incorporador/board-do-portal";

// A FILA DO BOARD DO APOLO, recortada pelo produto do coordenador — GET /api/incorporador/board?emp=
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
  const auth = autorizarComercial(request);
  if (!auth.ok) return auth.response;

  const rec = await recorteDoProduto(request, auth.sessao);
  if (!rec.ok) return rec.response;

  const admin = adminOu503();
  if (!admin.ok) return admin.response;

  const fila = await montarFilaDoBoard(admin.client, {
    recorte: recorteParaFila(rec.recorte),
    usuarioId: auth.sessao.usuarioId,
  });
  if (!fila.ok) {
    return NextResponse.json({ error: fila.error }, { status: fila.status });
  }

  return NextResponse.json(
    { data: fila.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
