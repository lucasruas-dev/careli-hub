import { NextResponse } from "next/server";

import { authorizeApoloWrite } from "@/lib/apolo/auth";
import { ehPortalComercial } from "@/lib/apolo/incorporador/perfis-de-portal";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  cadastrarProduto,
  entradaDoCorpo,
  resolverIncorporadorPorSlug,
} from "@/lib/hercules/cadastrar-produto-server";

// O PRODUTO NOVO CADASTRADO PELO HUB (Apolo > Empreendimentos), no Panteon.
//
// Decisão do Lucas (16/09/2026): MESMO banco, MESMAS tabelas, MESMO código, e cada produto marca
// QUEM o opera. O C2X legado é SOMENTE LEITURA e está sendo desativado; produto novo nasce em
// `hercules_empreendimentos` com o id da sequence da 0170. A regra e as gravações são as mesmas do
// portal (`cadastrarProduto`, lib/hercules/cadastrar-produto-server.ts).
//
// ⚠️ ESCRITA DO APOLO: `authorizeApoloWrite`, e não a leitura. `viewer` olha o Apolo inteiro; criar
// produto abre um empreendimento novo para reserva, proposta e contrato.
//
// ⚠️ `operadoPorIncorporadorSlug` É OPCIONAL E VEM POR SLUG, NÃO POR ID. Ausente = a Careli opera.
// Presente, o id é resolvido no banco (portal inexistente ou desativado é recusado com erro de
// campo): aceitar um uuid cru do corpo deixaria um erro de cópia marcar o produto como de outro
// incorporador, e o `on delete restrict` da 0170 não salva disso.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await authorizeApoloWrite(request);
  if (!auth.ok) return auth.response;

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

  const bruto = corpo && typeof corpo === "object" ? (corpo as Record<string, unknown>).operadoPorIncorporadorSlug : null;
  const slugDoOperador = typeof bruto === "string" ? bruto.trim() : "";

  let incorporadorId: null | string = null;
  if (slugDoOperador) {
    const portal = await resolverIncorporadorPorSlug(admin, slugDoOperador);
    if (!portal.ok) {
      return NextResponse.json(
        { error: "Não foi possível conferir o incorporador agora. Tente de novo em instantes." },
        { status: 503 },
      );
    }
    if (!portal.incorporador || !portal.incorporador.ativo) {
      const mensagem = `Não existe portal ativo com o endereço "${slugDoOperador}".`;
      return NextResponse.json(
        { error: "Confira os campos destacados.", erros: { operadoPorIncorporadorSlug: mensagem } },
        { status: 422 },
      );
    }
    // ⚠️ PORTAL COMERCIAL NÃO OPERA PRODUTO (decisão do Lucas, 16/09/2026). A Gurgel opera a venda
    // dos produtos da Careli como sempre, mas não cadastra produto nem unidade; marcar um produto
    // como dela gravaria um dono que regra nenhuma lê, e o produto pareceria da Gurgel no Setup.
    if (ehPortalComercial(portal.incorporador.tipo)) {
      return NextResponse.json(
        {
          error: "Confira os campos destacados.",
          erros: {
            operadoPorIncorporadorSlug:
              "O portal comercial não opera produto. Escolha o portal do incorporador ou deixe com a Careli.",
          },
        },
        { status: 422 },
      );
    }
    incorporadorId = portal.incorporador.id;
  }

  const resultado = await cadastrarProduto(admin, {
    autor: { id: auth.userId, nome: auth.nome },
    entrada: entradaDoCorpo(corpo),
    incorporadorId,
    origem: "hub",
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
        operadoPor: produto.operadoPor,
        produtoId: produto.produtoId,
        tipoProduto: produto.tipoProduto,
      },
    },
    { headers: { "Cache-Control": "no-store" }, status: 201 },
  );
}
