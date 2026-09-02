import { NextResponse } from "next/server";

import { idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import { empreendimentosPermitidos, sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import { ATIVIDADES, ESTAGIOS, NOME_DO_TIPO } from "@/lib/temis/trabalhos";
import { trabalhosDoBoard } from "@/lib/temis/trabalhos-db";

// A ABA CONTRATOS DO PORTAL COMERCIAL — o board da Têmis, recortado pelo coordenador.
//
// Pedido do Lucas (02/09/2026): o Hércules (c2x.app.br/incorporador/gurgel) ganha as abas CRM ·
// Vendas · Contratos · Financeiro · Lançamento; "Contratos" é *"o board da Têmis recortado pelo
// escopo do coordenador, somente leitura por enquanto"*. Quem marca atividade e faz o card andar
// continua sendo a Têmis, pela rota interna (/api/temis/trabalhos, com Bearer do Apolo). Por isso
// aqui só existe GET: não há POST para o navegador chamar, nem com o cookie certo.
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DA URL. `?empreendimento=` só ESTREITA dentro do que a sessão
// autoriza (`empreendimentosPermitidos`); pedir um id de fora devolve vazio e a rota responde 403,
// nunca o board inteiro. `trabalhosDoBoard` recebe a lista pronta — nenhum enterprise_id livre do
// cliente chega ao banco.
//
// ⚠️ SÓ O PORTAL COMERCIAL. O cookie do incorporador comum (o dono do loteamento) também passa em
// `sessaoDoRequest`, mas os cards trazem o CPF do comprador, e a regra das rotas do incorporador é
// "documento pessoal nunca sai daqui" (ver carteira/route.ts). Para ele esta rota não existe: 404,
// como as demais que não estão na aba dele.
//
// ⚠️ DOIS FORMATOS DE ID NA MESMA COLUNA. `temis_trabalhos.enterprise_id` é texto e a tela interna
// grava o `id` do seletor de empreendimentos — que é a divisão ("35") OU o consolidado
// ("group:Lagoa Bonita"), conforme a linha escolhida. Os vínculos da sessão vêm nos dois formatos
// também (medido em 17/08/2026: 150 com divisão, 1 com grupo). `idsDaSessao` devolve grupo + divisões
// de tudo o que a sessão alcança, com a assimetria certa (o grupo abre as divisões; a divisão vale
// só por ela) — é a lista que um `.in()` usa sem perder card e sem ganhar card alheio.
//
// MESMO FORMATO de GET /api/temis/trabalhos, de propósito: o TemisKanban é UM componente com duas
// portas, e o catálogo (atividades, estágios, nomes) viaja junto pelo mesmo motivo de lá — duplicar
// no cliente faria as duas telas divergirem no dia em que alguém acrescentasse uma atividade.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);
  if (!sessao) {
    return NextResponse.json({ error: "Sessao expirada." }, { status: 401 });
  }

  // 404 e não 403: para quem não tem a aba, a rota não existe (mesma régua de boletos/route.ts).
  if (!ehPortalComercial(sessao.tipo)) {
    return NextResponse.json({ error: "Nao encontrado." }, { status: 404 });
  }

  const pedido = new URL(request.url).searchParams.get("empreendimento");

  // A PERMISSÃO primeiro, síncrona e sem tocar em banco nenhum: pedido que não sobra nada é o
  // cliente pedindo empreendimento que não é dele.
  const permitidos = empreendimentosPermitidos(sessao, pedido);
  if (permitidos.length === 0) {
    return NextResponse.json({ error: "Sem acesso a este empreendimento." }, { status: 403 });
  }

  // Depois a EXPANSÃO: os mesmos ids permitidos, nos formatos em que a Têmis pode ter gravado.
  // Sem catálogo (C2X fora do ar) `idsDaSessao` devolve o que a sessão traz — menos que o
  // correto, nunca mais.
  const enterpriseIds = await idsDaSessao(sessao, pedido);
  const trabalhos = await trabalhosDoBoard({ enterpriseIds });

  return NextResponse.json(
    { data: { atividades: ATIVIDADES, estagios: ESTAGIOS, nomes: NOME_DO_TIPO, trabalhos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
