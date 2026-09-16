import { NextResponse } from "next/server";

import { autorizarPortalQueOperaSozinho } from "@/lib/apolo/incorporador/board-do-portal";
import { autorizar, foraDoEscopo } from "@/lib/apolo/incorporador/escopo";
import { ehPortalComercial, portalOperaVenda } from "@/lib/apolo/incorporador/perfis-de-portal";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { cadastrarProduto, entradaDoCorpo } from "@/lib/hercules/cadastrar-produto-server";

// O PRODUTO NOVO CADASTRADO PELO PRÓPRIO INCORPORADOR, no portal.
//
// Lucas (16/09/2026): *"a Cecilio quem vai fazer é o proprio time deles (...) eles meio que vão andar
// sozinhos"*. O time da Cecílio cadastra os prédios e loteamentos que ainda não existem (Ed. Jade,
// On Sky, Giant Towers...) sem passar pelo administrativo da Careli. A regra e as gravações moram em
// `cadastrarProduto` (lib/hercules/cadastrar-produto-server.ts), a mesma que o hub usa.
//
// ⚠️ SÓ O INCORPORADOR QUE OPERA A PRÓPRIA VENDA. `portalOperaVenda` é a régua, mas ela também é
// verdade para o COMERCIAL, e o comercial fica de fora: a Gurgel vende produto alheio, e o cadastro
// estrutural dela é feito pelo administrativo da Careli. Sem esta trava, um coordenador criava o
// "Ed. Jade" operado pela Gurgel e ocupava a sigla do prédio da Cecílio para sempre. Portal que só lê
// a carteira, e o comercial, recebem 404, a mesma resposta de rota inexistente, e não 403 (não é
// oráculo de "isto existe").
//
// ⚠️ QUEM OPERA O PRODUTO SAI DA SESSÃO ASSINADA, NUNCA DO CORPO. E a sessão é conferida no banco
// antes de gravar, pela revalidação ÚNICA de toda escrita do portal que opera sozinho
// (`autorizarPortalQueOperaSozinho`: portal ativo com o mesmo id e ainda confeccionando, conta ativa,
// escopo da conta agora). O cookie pode estar até uma navegação atrás do Setup (ver o GET de
// /api/incorporador/sessao), e criar produto é escrita estrutural: não vale por um cookie velho.
// Era uma revalidação escrita aqui mesmo; uma segunda cópia da régua é onde a primeira diverge.
//
// ⚠️ O PRODUTO NOVO SÓ ENTRA NO ESCOPO NA PRÓXIMA REVALIDAÇÃO DA SESSÃO. O cookie congela os
// empreendimentos do momento em que foi assinado; o vínculo novo em `apolo_incorporador_
// empreendimentos` só aparece quando o GET de /api/incorporador/sessao relê o banco e reemite o
// cookie, o que acontece a cada carga de tela. Por isso a resposta leva `recarregarSessao: true`: a
// tela chama o GET da sessão antes de abrir o produto, senão toda rota do portal responderia 404 para
// o produto que a pessoa acabou de criar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const { sessao } = auth;
  if (!portalOperaVenda(sessao.slug, sessao.tipo)) return foraDoEscopo();
  if (ehPortalComercial(sessao.tipo)) return foraDoEscopo();

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });
  }

  let corpo: unknown;
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const vigente = await autorizarPortalQueOperaSozinho(request, sessao);
  if (!vigente.ok) return vigente.response;

  const resultado = await cadastrarProduto(admin, {
    autor: { id: vigente.sessao.usuarioId, nome: vigente.sessao.usuarioNome },
    entrada: entradaDoCorpo(corpo),
    // O id da sessão VIGENTE: a revalidação já conferiu que é o mesmo id do portal no banco.
    incorporadorId: vigente.sessao.incorporadorId,
    origem: "portal",
    // O pai possível passa pela régua única do portal (`podeCadastrarNoProduto`).
    portal: { slug: vigente.sessao.slug, tipo: vigente.sessao.tipo },
  });

  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.erro, erros: resultado.erros }, { status: resultado.status });
  }

  const { produto } = resultado;
  return NextResponse.json(
    {
      data: {
        codigo: produto.codigo,
        enterpriseId: produto.enterpriseId,
        nome: produto.nome,
        produtoId: produto.produtoId,
        recarregarSessao: true,
        tipoProduto: produto.tipoProduto,
      },
    },
    { headers: { "Cache-Control": "no-store" }, status: 201 },
  );
}
