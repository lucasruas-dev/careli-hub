import { NextResponse } from "next/server";

import { abrirEspelho, ERRO_GENERICO } from "@/lib/hercules/espelho/abrir-espelho";
import { estadoDoEspelho } from "@/lib/hercules/espelho/estado-do-espelho";
import { SEM_CACHE } from "@/lib/hercules/espelho/pecas-do-espelho";
import { pisoDeEntradaPublico, planosPublicos } from "@/lib/hercules/espelho/planos-publicos";

// A SITUAÇÃO DOS LOTES — a única peça do espelho que muda.
//
// ⚠️ `no-store`, E ISSO NÃO É NEGOCIÁVEL. Esta rota já tem um precedente caro: a irmã do telão do
// Prometeu rodou com `s-maxage=10, stale-while-revalidate=30` e a projeção mostrou um lote VERDE
// por 40 segundos DEPOIS de ele ter sido reservado, na frente do salão. `cache: "no-store"` no
// fetch do navegador não alcança a CDN — o header da resposta é que decide. Aqui o estrago seria
// um cliente escolhendo, e um corretor prometendo, um lote que já tem dono.
//
// ⚠️ SERVE AS DUAS VISÕES. Devolve o cadastro inteiro da árvore, e não só o que está desenhado:
// 29 dos 37 empreendimentos não têm masterplan e abrem na GRADE, onde esta é a única fonte.
//
// ⚠️ E NÃO SAI DAQUI NADA DE CLIENTE. Por lote: código, quadra, lote, situação em duas cores,
// preço de tabela e área. Nunca comprador, corretor, imobiliária, desconto ou etapa do processo.
//
// ⚠️ A COR É A DA RÉGUA ÚNICA (`lib/hercules/situacao-da-unidade.ts`, Lucas 18/09/2026: *"esses
// status tem que morar em um so lugar"*): verde se e só se a unidade está livre para a tela Venda.
// Se a leitura da situação falhar, `estadoDoEspelho` lança e esta rota responde 503. Nunca verde.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// O Lagoa Bonita tem 907 registros somando pai e filhos. A régua única lê as linhas do produto, as
// linhas antigas que apontam para elas e o processo vivo (propostas e as duas reservas), em páginas
// de 1.000, em paralelo com o cadastro do desenho. Folga.
export const maxDuration = 30;

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("e");
  const aberto = await abrirEspelho(token);

  if (!aberto.ok) {
    return NextResponse.json(
      { error: ERRO_GENERICO },
      { headers: { "Cache-Control": SEM_CACHE }, status: aberto.erro === "sem_token" ? 401 : 503 },
    );
  }

  const { client, codigo, filhosC2xIds, masterplan, nome, paiC2xId } = aberto.espelho;

  try {
    // Os planos vêm JUNTO, e não em rota própria: são no máximo meia dúzia de linhas e mudam
    // com a mesma frequência do resto (raramente). Uma requisição a menos no celular do cliente.
    const ids = [paiC2xId, ...filhosC2xIds].filter(Boolean) as string[];
    const [estado, planos, entradaMinimaPercentual] = await Promise.all([
      estadoDoEspelho(client, {
        enterpriseIdDoPai: paiC2xId,
        enterpriseIdsDosFilhos: filhosC2xIds,
      }),
      planosPublicos(client, ids),
      // O piso do empreendimento (8% no Garden), o mesmo que a Mesa de Venda entrega ao simulador.
      pisoDeEntradaPublico(client, ids),
    ]);

    return NextResponse.json(
      {
        data: {
          ...estado,
          empreendimento: { codigo, nome },
          entradaMinimaPercentual,
          // Vazio = empreendimento sem plano cadastrado. A tela esconde o simulador.
          planos,
          // A tela decide entre oferecer as duas visões ou só a grade.
          temMapa: masterplan !== null,
        },
      },
      { headers: { "Cache-Control": SEM_CACHE } },
    );
  } catch (error) {
    console.error("[publico][espelho] falha ao montar a situacao", error);

    // ⚠️ ERRO É ERRO, NÃO É MAPA VAZIO. Devolver `lotes: []` com 200 pintaria a tela inteira de
    // cinza — e o visitante leria isso como "não tem nada à venda aqui".
    return NextResponse.json(
      { error: ERRO_GENERICO },
      { headers: { "Cache-Control": SEM_CACHE }, status: 503 },
    );
  }
}
