import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { resolverCodigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import {
  autorizar,
  codigosDaSessao,
  foraDoEscopo,
  idsDaSessao,
} from "@/lib/apolo/incorporador/escopo";
import { createApoloAdminClient } from "@/lib/apolo/server";
import {
  carregarCadastroDeEmpreendimentos,
  type LinhaDoCadastro,
} from "@/lib/hercules/cadastro";
import { ehIdDoPai } from "@/lib/hercules/expandir-id-do-painel";
import { linksDoEmpreendimento } from "@/lib/hercules/links-do-empreendimento";
import { topoDaArvoreDeAlgum } from "@/lib/hercules/masterplan-do-empreendimento";

// OS LINKS PÚBLICOS DE UM PRODUTO — a aba Links da ficha do Hércules (portal da Gurgel).
//
// Lucas (10/09/2026): *"no perfil da gurgel vai ficar dentro de produtos, dentro do
// empreendimento"* — a ficha do produto, e não o menu do portal.
//
// ⚠️ O ESCOPO VEM DO TOKEN, NUNCA DA URL — a mesma regra da rota irmã (produto/imobiliarias) e
// pela MESMA peça (`resolverCodigosDoPedido`), não por uma cópia: `emp` só REDUZ o que a sessão
// já autorizou. Aqui isso vale duplo, porque o que sai daqui é um LINK ASSINADO: sem o recorte,
// um coordenador que só vende o Garden pediria `emp=` do Vale do Ouro e receberia um link
// funcional para o espelho de um produto que não é dele.
//
// ⚠️ E O TOKEN NÃO CARREGA O ESCOPO. O link do espelho vale para o empreendimento inteiro, para
// quem quer que o receba — é o objetivo dele. Por isso a conferência tem de acontecer AQUI, na
// emissão: depois de emitido, não há a quem perguntar.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const codesAutorizados = await codigosDaSessao(auth.sessao);

  // Zero código não é "ele não tem nada": a sessão só existe com empreendimento, então é o
  // catálogo do C2X fora do ar.
  if (codesAutorizados.length === 0) {
    return NextResponse.json(
      { error: "Não foi possível carregar os empreendimentos agora." },
      { status: 503 },
    );
  }

  const catalogo = await catalogoDeEmpreendimentos(Date.now());
  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);
  const pedido = new URL(request.url).searchParams.get("emp");
  const permitidos = new Set(await idsDaSessao(auth.sessao));

  // O cadastro só é carregado no caminho "pai:<uuid>", que é o que a ficha manda. Fail-closed:
  // cadastro fora do ar responde 503, e não 404 — sem ele não dá para provar que o pai é dele.
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

  const codes = resolverCodigosDoPedido({
    cadastro,
    catalogo,
    codesAutorizados,
    empreendimentos,
    pedido,
    permitidos,
  });

  // Pedido que não sobra nada = produto que não é dele. Nunca cai na visão consolidada.
  if (codes.length === 0) return foraDoEscopo();

  const client = createApoloAdminClient();
  if (!client) {
    return NextResponse.json(
      { error: "Não foi possível carregar os links agora." },
      { status: 503 },
    );
  }

  try {
    const topo = await topoDaArvoreDeAlgum(client, codes);

    return NextResponse.json(
      {
        data: {
          doPai: topo?.doPai ?? false,
          links: linksDoEmpreendimento({
            codigoDoTopo: topo?.codigo ?? null,
            nomeDoTopo: topo?.nome ?? null,
            temMapa: topo?.temMapa ?? false,
          }),
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[incorporador][produto] falha ao montar links", error);

    return NextResponse.json(
      { error: "Não foi possível carregar os links agora." },
      { status: 500 },
    );
  }
}
