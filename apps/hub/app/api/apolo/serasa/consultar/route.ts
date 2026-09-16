import { NextResponse } from "next/server";

import { authorizeApoloCoordenacao, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  type AutorDoCredito,
  type CorpoDaConsulta,
  consultarCredito,
  type RespostaDoCredito,
  situacaoDoCredito,
} from "@/lib/serasa/consulta-servico";

// CONSULTA DE CRÉDITO no Serasa: o caminho que gasta dinheiro.
//
// GET  = SITUAÇÃO, custo zero: diz se está configurado, em que ambiente, se já existe consulta
//        recente do mesmo documento e quantas chamadas já saíram hoje.
// POST = CONSULTA de verdade. Exige `confirmado`.
//
// Mesma disciplina da MOST: orçamento e confirmação antes de qualquer chamada paga.
//
// (16/09/2026) A REGRA MORA EM `lib/serasa/consulta-servico.ts`. O portal que opera sozinho (Cecílio)
// passou a consultar pela própria porta (`/api/incorporador/board/[id]/serasa/consultar`), e as duas
// rotas chamam o MESMO serviço. Esta casca só faz o que é do hub: o Bearer com papel de escrita
// (admin, leader, operator) e o cliente admin. Respostas, status e portões são os de antes.
//
// (16/09/2026, D9) NOVA CONSULTA DENTRO DE 30 DIAS É DA COORDENAÇÃO. Decisão do Lucas: no hub, só a
// coordenação (admin e leader) força a cobrança de novo; o analista recebe a consulta guardada com o
// recado. O papel vai ao serviço como a PORTA pela qual o pedido passou, e a porta da coordenação só é
// consultada quando o corpo pede `forcar` (sem `forcar`, nada muda e não há ida extra ao banco). A
// porta que recusa ou falha vira `escrita`: na dúvida, não cobra. `lib/apolo/auth.ts` não muda.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

// O autor do hub é o id da porta de escrita. O nome fica null de propósito (revisão de 16/09/2026):
// o serviço não usa o nome do hub (o registro do hub não leva autor), e ler `auth.nome` amarrava esta
// rota à mudança de `lib/apolo/auth.ts` de outra onda, ainda fora do git.
function autorDoHub(
  userId: string,
  papel: Extract<AutorDoCredito, { tipo: "hub" }>["papel"] = "escrita",
): AutorDoCredito {
  return { nome: null, papel, tipo: "hub", userId };
}

/** O papel de quem pede `forcar`: a porta da coordenação passou? Recusa ou falha = escrita. */
async function papelDeQuemForca(request: Request): Promise<"coordenacao" | "escrita"> {
  try {
    const coordenacao = await authorizeApoloCoordenacao(request);
    return coordenacao.ok ? "coordenacao" : "escrita";
  } catch {
    return "escrita";
  }
}

function responder(resposta: RespostaDoCredito): NextResponse {
  return NextResponse.json(resposta.corpo, { headers: resposta.headers, status: resposta.status });
}

export async function GET(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  // Recebe a FICHA, não o documento: o CPF sai do cadastro, nunca da query string (não vaza
  // em log de proxy, e ninguém consulta um documento arbitrário por esta rota).
  const url = new URL(request.url);

  return responder(
    await situacaoDoCredito({
      autor: autorDoHub(auth.userId),
      client,
      enterpriseId: url.searchParams.get("enterpriseId"),
      entityId: url.searchParams.get("entityId") ?? "",
    }),
  );
}

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

  const client = createApoloAdminClient();
  if (!client) return NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

  const corpo = (await request.json().catch(() => ({}))) as CorpoDaConsulta;
  const papel = corpo.forcar ? await papelDeQuemForca(request) : "escrita";

  return responder(
    await consultarCredito({
      autor: autorDoHub(auth.userId, papel),
      client,
      corpo,
    }),
  );
}
