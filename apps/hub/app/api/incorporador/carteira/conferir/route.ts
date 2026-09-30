import { NextResponse } from "next/server";

import { autorizar, foraDoEscopo, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";
import { EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO } from "@/lib/lsoft/carteira-no-financeiro";
import {
  lerPagamentosAConferir,
  marcarPagamentoConferido,
  observacaoValida,
  OBSERVACAO_MAXIMA,
  OBSERVACAO_MINIMA,
} from "@/lib/lsoft/pagamentos-a-conferir";
import { portalVeBaseLsoft } from "@/lib/lsoft/portais";

// PAGAMENTOS A CONFERIR NO FINANCEIRO DO PORTAL — a lista e o botão "Conferido".
//
// Lucas (30/09/2026): *"pode fazer a lista de pagamentos a conferir"*. É o que a baixa do hub não
// resolveu sozinha (ver `lib/lsoft/pagamentos-a-conferir.ts`).
//
// ⚠️ A MESMA PORTA DO GARDEN NO FINANCEIRO, e conferida nesta ordem: sessão do portal (`autorizar`),
// portal que vê a base do LSoft (`portalVeBaseLsoft`), fora do modo comercial (o coordenador não vê
// a carteira do incorporador) e o Garden dentro do escopo da sessão. Fora disso a rota não existe:
// 404, nunca 403.
//
// ⚠️ O POST NÃO ACEITA AUTOR, MOTIVO NEM EMPREENDIMENTO. Do corpo vêm só a cobrança, a observação e
// a impressão do motivo que a pessoa viu (para recusar se o problema mudou); quem conferiu é o
// usuário da sessão, e a cobrança só é aceita se estiver na lista viva (a checagem mora em
// `marcarPagamentoConferido`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A lista relê os pagamentos e as parcelas do mês (medido em 30/09/2026: alguns segundos). 60 s dá
// folga sem abrir espaço para laço longo, como nas outras rotas do LSoft.
export const maxDuration = 60;

async function porta(
  request: Request,
): Promise<{ ok: false; response: NextResponse } | { ok: true; sessao: SessaoIncorporador }> {
  const auth = autorizar(request);
  if (!auth.ok) return { ok: false, response: auth.response };
  const { sessao } = auth;
  if (ehPortalComercial(sessao.tipo) || !portalVeBaseLsoft(sessao.slug)) {
    return { ok: false, response: foraDoEscopo() };
  }
  const ids = await idsDaSessao(sessao);
  const temOEmpreendimento = EMPREENDIMENTOS_DO_LSOFT_NO_FINANCEIRO.some((emp) =>
    ids.includes(String(emp.c2xEnterpriseId)),
  );
  if (!temOEmpreendimento) return { ok: false, response: foraDoEscopo() };
  return { ok: true, sessao };
}

export async function GET(request: Request) {
  const entrada = await porta(request);
  if (!entrada.ok) return entrada.response;

  const lista = await lerPagamentosAConferir();
  if (!lista.ok) {
    // O detalhe do banco não atravessa para o portal externo: fica no log do servidor.
    console.error("[incorporador/carteira/conferir] leitura falhou:", lista.erro);
    return NextResponse.json(
      { error: "Não foi possível carregar os pagamentos a conferir agora." },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      data: {
        conferidoDisponivel: !lista.conferidoIndisponivel,
        conferir: lista.grupos.conferir,
        integracao: lista.grupos.integracao,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const entrada = await porta(request);
  if (!entrada.ok) return entrada.response;

  const corpo = (await request.json().catch(() => null)) as
    | { cobrancaId?: unknown; impressao?: unknown; observacao?: unknown }
    | null;
  const cobrancaId = typeof corpo?.cobrancaId === "string" ? corpo.cobrancaId.trim() : "";
  // A impressão do motivo que a pessoa viu: o servidor só a COMPARA com a da lista viva (409 se o
  // problema mudou). Nada dela é gravado.
  const impressao = typeof corpo?.impressao === "string" ? corpo.impressao.trim() : "";
  if (!cobrancaId || cobrancaId.length > 80 || !/^[0-9a-f]{16}$/.test(impressao)) {
    return NextResponse.json({ error: "Pagamento inválido." }, { status: 400 });
  }
  const observacao = observacaoValida(corpo?.observacao);
  if (!observacao) {
    return NextResponse.json(
      {
        error: `Escreva o que foi conferido (de ${OBSERVACAO_MINIMA} a ${OBSERVACAO_MAXIMA} caracteres).`,
      },
      { status: 400 },
    );
  }

  const resultado = await marcarPagamentoConferido({
    // Quem assina: o usuário da sessão do portal, nunca o que a tela mandar.
    autor: `${entrada.sessao.usuarioNome} (${entrada.sessao.slug})`,
    cobrancaId,
    impressao,
    observacao,
    origem: "incorporador",
  });
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.erro }, { status: resultado.status });
  }
  return NextResponse.json({ data: { ok: true } }, { headers: { "Cache-Control": "no-store" } });
}
