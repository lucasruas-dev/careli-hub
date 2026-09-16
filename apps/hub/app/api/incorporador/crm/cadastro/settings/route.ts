import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import {
  configuracaoDoCadastroNoPortal,
  lerCadastroDaOperacao,
  produtosDoPanteonDaSessao,
  recusaDaEscritaNoCadastro,
} from "@/lib/apolo/incorporador/cadastro-do-portal";
import { respostaDaEscrita } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { autorizarTemisDoPortal } from "@/lib/temis/portao-do-portal";

// O QUE O "NOVO CLIENTE" DO CRM DO PORTAL PRECISA SABER ANTES DO WIZARD.
//
//   • sem `enterpriseId`: os produtos que esta sessão pode cadastrar, só os que o portal OPERA
//     (`operado_por`, decisão do Lucas de 16/09/2026). É também como a TelaCrm descobre se mostra o
//     botão: lista vazia ou portal que não opera sozinho (404 no portão) = sem botão. Sem a 0170 ou
//     com o cadastro fora do ar: 503 com a lista vazia.
//   • com `enterpriseId`: o que o produto exige (comprovante de renda, a etapa do Setup) e as
//     imobiliárias habilitadas nele. Produto fora da sessão: 404; produto só de consulta: 403.
//
// No hub o equivalente é /api/apolo/empreendimentos/settings, que devolve TODOS os empreendimentos
// por desenho; aqui o parâmetro só reduz o que a sessão já alcança.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const noStore = { "Cache-Control": "no-store" } as const;

export async function GET(request: Request) {
  const auth = await autorizarTemisDoPortal(request);
  if (!auth.ok) return auth.response;

  const enterpriseId = new URL(request.url).searchParams.get("enterpriseId");

  if (enterpriseId) {
    const recusa = await recusaDaEscritaNoCadastro(auth.ator, enterpriseId);
    if (recusa) {
      const resposta = respostaDaEscrita(recusa);
      resposta.headers.set("Cache-Control", "no-store");
      return resposta;
    }
  }

  // A lista lê o cadastro UMA vez: a régua de quem opera e os produtos nascidos no Panteon (que o
  // catálogo do C2X não conhece) saem da mesma leitura. Cadastro fora do ar = 503 sem produto.
  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const cadastro = enterpriseId ? null : await lerCadastroDaOperacao();
  const doPanteon =
    !enterpriseId && !cadastro
      ? []
      : await produtosDoPanteonDaSessao(auth.ator, catalogo, cadastro?.linhas);

  const resposta = await configuracaoDoCadastroNoPortal({
    adminClient: createApoloAdminClient(),
    ator: auth.ator,
    cadastro,
    catalogo,
    doPanteon,
    enterpriseId,
  });

  return NextResponse.json(resposta.corpo, { headers: noStore, status: resposta.status });
}
