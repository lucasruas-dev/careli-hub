import { NextResponse } from "next/server";

import {
  adminOu503,
  autorDoCreditoNoPortal,
  autorizarOperacaoDeVenda,
  autorizarPortalQueOperaSozinho,
  cadNoEscopo,
  recorteDoProduto,
} from "@/lib/apolo/incorporador/board-do-portal";
import {
  escritaNoProduto,
  respostaDaEscrita,
} from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import {
  type CorpoDaConsulta,
  consultarCredito,
  type RespostaDoCredito,
  situacaoDoCredito,
} from "@/lib/serasa/consulta-servico";

// CONSULTA DE CRÉDITO PELO PORTAL QUE OPERA SOZINHO
// GET/POST /api/incorporador/board/[id]/serasa/consultar?emp=
//
// Decisão do Lucas (16/09/2026): *"A Cecílio, no portal"* faz a análise de crédito dos clientes
// dela. A consulta é paga e sai na conta da Careli, com registro de quem consultou. A Gurgel
// (comercial) NÃO ganha isto: o crédito das vendas dela continua com a Careli no Apolo. Os
// incorporadores padrão (cer, vistaalegre...) continuam sem saber que o Serasa existe.
//
// ⚠️ A REGRA É A DO HUB, NO MESMO SERVIÇO (`lib/serasa/consulta-servico.ts`). Esta casca só faz o
// que é do portal, nesta ordem, e nenhum passo pula o anterior:
//   1. `autorizarOperacaoDeVenda`: sessão e portal que opera venda (401 / 404);
//   2. `autorizarPortalQueOperaSozinho`: só quem confecciona (comercial e padrão: 404), com a conta e
//      o incorporador revalidados agora (a consulta é PAGA);
//   3. `recorteDoProduto` com a sessão vigente, e `cadNoEscopo` da CAD do endereço: fora do produto,
//      404 igual ao de inexistente. Nada é lido nem consultado antes disto (fail-closed).
// A ficha e o empreendimento que chegam ao serviço são os do ESCOPO, nunca os do corpo.
//
// Mesmo formato de requisição e de resposta de `/api/apolo/serasa/consultar`: a tela troca a base.
// O `entityId` do corpo (ou da query) é aceito para isso, e tem que ser o mesmo do endereço.
//
// (16/09/2026, D1) A CONSULTA (POST) SÓ NO PRODUTO QUE O PORTAL OPERA. A CAD do VOC (37) ou do VOR
// (41) está no escopo da Cecílio, mas o crédito dela é da Careli: 403 com `soConsulta`, antes de
// qualquer leitura do serviço e de qualquer cobrança. A porta 2 já revalidou a sessão, então a régua
// roda sobre a sessão vigente (`escritaNoProduto`), sem revalidar duas vezes. O GET (o painel) é
// leitura e não passa.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

type Contexto = { params: Promise<{ id: string }> };

function responder(resposta: RespostaDoCredito): NextResponse {
  return NextResponse.json(resposta.corpo, { headers: resposta.headers, status: resposta.status });
}

/** As portas 1 e 2 e o cliente admin, antes de ler o corpo. */
async function abrirPorta(request: Request) {
  const auth = autorizarOperacaoDeVenda(request);
  if (!auth.ok) return auth;

  const sozinho = await autorizarPortalQueOperaSozinho(request, auth.sessao);
  if (!sozinho.ok) return sozinho;

  const rec = await recorteDoProduto(request, sozinho.sessao);
  if (!rec.ok) return rec;

  const admin = adminOu503();
  if (!admin.ok) return admin;

  return { client: admin.client, ok: true as const, recorte: rec.recorte, sessao: sozinho.sessao };
}

/** A porta 3: a CAD do endereço no recorte. Devolve o empreendimento que o escopo resolveu. */
async function cadDoPedido(
  porta: Extract<Awaited<ReturnType<typeof abrirPorta>>, { ok: true }>,
  id: string,
  pedido: { enterpriseId: unknown; entityId: unknown },
): Promise<{ enterpriseId: string; ok: true } | { ok: false; response: NextResponse }> {
  const doPedido = typeof pedido.entityId === "string" ? pedido.entityId.trim() : "";
  if (doPedido && doPedido !== id) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "A ficha do pedido não confere com a do endereço." },
        { status: 400 },
      ),
    };
  }

  const escopo = await cadNoEscopo(porta.client, id, porta.recorte, pedido.enterpriseId);
  if (!escopo.ok) return escopo;

  // Imobiliária não tem CAD nem crédito: a decisão dela é a habilitação.
  if (escopo.escopo.imobiliaria || !escopo.escopo.enterpriseId) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Esta ficha não tem CAD na esteira: não há análise de crédito para ela." },
        { status: 409 },
      ),
    };
  }

  return { enterpriseId: escopo.escopo.enterpriseId, ok: true };
}

export async function GET(request: Request, context: Contexto) {
  const porta = await abrirPorta(request);
  if (!porta.ok) return porta.response;

  const { id } = await context.params;
  const url = new URL(request.url);
  const cad = await cadDoPedido(porta, id, {
    enterpriseId: url.searchParams.get("enterpriseId"),
    entityId: url.searchParams.get("entityId"),
  });
  if (!cad.ok) return cad.response;

  return responder(
    await situacaoDoCredito({
      autor: autorDoCreditoNoPortal(porta.sessao),
      client: porta.client,
      enterpriseId: cad.enterpriseId,
      entityId: id,
    }),
  );
}

export async function POST(request: Request, context: Contexto) {
  const porta = await abrirPorta(request);
  if (!porta.ok) return porta.response;

  const { id } = await context.params;
  const corpo = (await request.json().catch(() => ({}))) as CorpoDaConsulta;
  const cad = await cadDoPedido(porta, id, {
    enterpriseId: corpo.enterpriseId,
    entityId: corpo.entityId,
  });
  if (!cad.ok) return cad.response;

  // (16/09/2026, D1) Consulta paga só na CAD do produto que o portal opera.
  const escrita = await escritaNoProduto(porta.sessao, [cad.enterpriseId]);
  if (escrita !== "pode") return respostaDaEscrita(escrita);

  return responder(
    await consultarCredito({
      autor: autorDoCreditoNoPortal(porta.sessao),
      client: porta.client,
      corpo: { ...corpo, enterpriseId: cad.enterpriseId, entityId: id },
    }),
  );
}
