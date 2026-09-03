import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { pedidoPrecisaDeExpansao } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { foraDoEscopo, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import { comIdsDoGrupo } from "@/lib/apolo/incorporador/resumo-do-produto";
import { empreendimentosPermitidos, sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import { ehIdDoPai, expandirIdDoPainel } from "@/lib/hercules/expandir-id-do-painel";
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
// E MAIS DOIS FORMATOS NO PEDIDO, os da FICHA DO PRODUTO (FichaDoProduto → TelaContratos emp=;
// Lucas, 02/09/2026: *"produtos é replicar a tela que temos hoje em empreendimento do apolo"*):
//   • "pai:<uuid>", o PAI do cadastro do Panteon (hercules_empreendimentos) — expande pelo
//     cadastro para os c2x ids dos filhos autorizados (ou o do próprio pai, sem filho);
//   • o id NUMÉRICO do C2X de um FILHO ("33", o LBF aberto pelo chevron do Lagoa Bonita) — ele
//     mesmo, se autorizado. ⚠️ Não passa por `empreendimentosPermitidos`: aquela compara contra
//     os ids CRUS da sessão, que carrega "group:Lagoa Bonita" e não "33", e a ficha do filho
//     respondia 403 para um produto que É do coordenador. É a mesma régua de vendas/route.ts
//     (`pedidoPrecisaDeExpansao`, de codigos-do-pedido.ts).
// Os dois cruzam com `idsDaSessao` (escopo expandido) — só reduz, nunca amplia. Cadastro fora do
// ar responde 503, e não 404: sem cadastro não dá para provar que o pai é dele, e "não
// encontrado" para um produto que É dele vira ligação. Pedido que não alcança nada responde 404
// (`foraDoEscopo`), como lá.
//
// O GRUPO DO CATÁLOGO ("group:Vale do Ouro") entra por `comIdsDoGrupo`, a MESMA régua das rotas
// de produto (resumo, imobiliárias) e do Board: só quando os ids cobrem o grupo INTEIRO e a sessão
// o tem. A Têmis pode ter gravado o card no consolidado (é o que o seletor da tela interna manda
// quando a linha escolhida é a do grupo); com regras diferentes por aba, esse card contava aqui e
// sumia do Resumo e do Cadastro da MESMA ficha.
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

  let enterpriseIds: string[];

  if (pedidoPrecisaDeExpansao(pedido)) {
    // O PAI DO CADASTRO ou o id numérico de um FILHO (ficha do produto). Mesmo caminho de
    // vendas/route.ts: cadastro (só para o pai) → expansão dentro do escopo expandido da sessão →
    // nada sobrou = não é dele.
    let cadastro: LinhaDoCadastro[] = [];
    if (ehIdDoPai(pedido)) {
      try {
        cadastro = await carregarCadastroDeEmpreendimentos();
      } catch {
        return NextResponse.json(
          { error: "Não foi possível carregar os empreendimentos agora." },
          { status: 503 },
        );
      }
    }

    const permitidos = new Set(await idsDaSessao(sessao));
    const idsReais = expandirIdDoPainel(pedido, cadastro, permitidos);
    if (idsReais.length === 0) {
      return foraDoEscopo();
    }

    // Os ids reais mais o grupo do catálogo que eles cobrem por inteiro (quando a sessão o tem).
    const catalogo = await catalogoDeEmpreendimentos(Date.now());
    enterpriseIds = comIdsDoGrupo(idsReais, catalogo, permitidos);
  } else {
    // A PERMISSÃO primeiro, síncrona e sem tocar em banco nenhum: pedido que não sobra nada é o
    // cliente pedindo empreendimento que não é dele.
    const permitidos = empreendimentosPermitidos(sessao, pedido);
    if (permitidos.length === 0) {
      return NextResponse.json({ error: "Sem acesso a este empreendimento." }, { status: 403 });
    }

    // Depois a EXPANSÃO: os mesmos ids permitidos, nos formatos em que a Têmis pode ter gravado.
    // Sem catálogo (C2X fora do ar) `idsDaSessao` devolve o que a sessão traz — menos que o
    // correto, nunca mais.
    enterpriseIds = await idsDaSessao(sessao, pedido);
  }

  const trabalhos = await trabalhosDoBoard({ enterpriseIds });

  return NextResponse.json(
    { data: { atividades: ATIVIDADES, estagios: ESTAGIOS, nomes: NOME_DO_TIPO, trabalhos } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
