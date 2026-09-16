import { NextResponse } from "next/server";

import {
  conferirProdutoDaSessao,
  executarMostNoPortal,
  lerPedidoDoMost,
  recusaDaEscritaNoCadastro,
} from "@/lib/apolo/incorporador/cadastro-do-portal";
import { respostaDaEscrita } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// LEITURA E ENRIQUECIMENTO PELA MOST no cadastro de cliente do CRM do portal. Espelho de
// /api/apolo/mostqi, só com as três ações do wizard (extract, enrich, enrich-company).
//
// ⚠️ TORNEIRA PAGA PELA CARELI: ~R$ 0,50 por imagem lida e ~R$ 1,60 por enriquecimento. Por isso a
// porta é a do portal que opera sozinho (`autorizarTemisDoPortal`: comercial e padrão levam 404), e
// cada consulta fica registrada com o usuário e o slug em `apolo_ocr_reads`. A regra inteira está
// em `lib/apolo/incorporador/cadastro-do-portal.ts`.
//
// (16/09/2026, revisão do conjunto) ⚠️ E SÓ PARA O PRODUTO QUE O PORTAL OPERA, como as outras rotas do
// cadastro (salvar, checar-cpf, upload-url). Esta era a única porta do Novo cliente sem produto: uma
// conta da Cecílio só com produtos de consulta (VOC, VOR) gastava leitura e enriquecimento da MOST na
// conta da Careli por chamada HTTP direta. O produto vem no corpo e é obrigatório: sem produto 400, fora
// da sessão 404, só consulta 403, cadastro sem a 0170 503. O wizard do portal manda o produto escolhido.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O enriquecimento roda datasets on-demand e pode passar de 100s (igual ao interno).
export const maxDuration = 300;

const noStore = { "Cache-Control": "no-store" } as const;

export async function POST(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  const corpo = (await request.json().catch(() => null)) as null | Record<string, unknown>;

  const produto = conferirProdutoDaSessao(auth.ator, corpo?.enterpriseId);
  if (!produto.ok) {
    return NextResponse.json({ error: produto.error }, { headers: noStore, status: produto.status });
  }
  const recusa = await recusaDaEscritaNoCadastro(auth.ator, produto.enterpriseId);
  if (recusa) return respostaDaEscrita(recusa);

  const lido = lerPedidoDoMost(corpo);
  if (!lido.ok) {
    return NextResponse.json({ error: lido.error }, { headers: noStore, status: lido.status });
  }

  const resposta = await executarMostNoPortal({
    adminClient: createApoloAdminClient(),
    ator: auth.ator,
    pedido: lido.pedido,
  });

  return NextResponse.json(resposta.corpo, { headers: noStore, status: resposta.status });
}
