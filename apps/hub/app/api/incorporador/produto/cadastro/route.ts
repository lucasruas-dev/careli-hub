import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { loadApoloEnterpriseCadastro } from "@/lib/apolo/empreendimentos";
import {
  codigosParaOC2x,
  montarCadastrosDoProduto,
} from "@/lib/apolo/incorporador/cadastro-do-produto";
import { resolverCodigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { autorizar, codigosDaSessao } from "@/lib/apolo/incorporador/escopo";
import {
  empreendimentosIndisponiveis,
  propriosDoPortal,
} from "@/lib/apolo/incorporador/proprios-do-portal";
import { ehIdDoPai } from "@/lib/hercules/expandir-id-do-painel";

// O CADASTRO DE UM PRODUTO PELA PORTA DO PORTAL — as abas Cadastro e Relacionamentos da ficha do
// produto no modo incorporador (FichaDoProduto com `modo="incorporador"`).
//
// Lucas (16/09/2026), sobre o portal da Cecílio Rocha: *"literalmente ter dois sistemas, mas ele
// seria uma replica que temos hoje"* · *"a Cecilio quem vai fazer e o proprio time deles"*. A ficha
// do produto replica a tela Empreendimento do Apolo, e as duas abas são as MESMAS `CadastroTab` e
// `RelacionamentosTab` de lá, alimentadas por esta rota no lugar de
// /api/apolo/empreendimentos/cadastro (que exige o Bearer do hub, e o time do cliente não tem
// sessão no hub).
//
// ⚠️ O ESCOPO VEM DO TOKEN, NUNCA DA URL — o mesmo esqueleto das rotas irmãs (produto/resumo,
// produto/links): `codigosDaSessao` e o cadastro do Panteon são as fontes, o `emp` só REDUZ
// (`resolverCodigosDoPedido` entende "pai:<uuid>", id numérico e id do catálogo), e pedido que não
// sobra nada responde 404. SEM `emp` NÃO HÁ LEITURA: a aba é de UM produto, e a lista de todos os
// cadastros da sessão não é pergunta que a tela faça.
//
// ⚠️ O PAYLOAD É ALLOWLIST (`montarCadastrosDoProduto`, com teste). O loader do Apolo devolve os
// players com telefone, e-mail, documento, endereço e o id interno da ficha no CRM; aqui sai o nome
// e o papel. O porquê, campo a campo, está em lib/apolo/incorporador/cadastro-do-produto.ts.
//
// ⚠️ SEM VOCABULÁRIO INTERNO NA RESPOSTA. O `error` do loader nomeia o C2X ("Configuracao C2X
// ausente: …"); a tela mostra o `error` cru, então aqui sai um texto neutro e o detalhe vai pro
// log — a mesma decisão das rotas produto/unidades e vendas/assinaturas.
//
// ⚠️ CUSTO. Uma consulta ao C2X (a mesma da ficha interna) quando a pessoa ABRE a aba. Nada aqui
// vira polling. O produto que só existe no Panteon nem chega a consultar o legado.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const indisponivel = () =>
  NextResponse.json(
    { error: "Não foi possível carregar o cadastro agora." },
    { status: 503 },
  );

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const pedido = (new URL(request.url).searchParams.get("emp") ?? "").trim();
  if (!pedido) {
    return NextResponse.json({ error: "Informe o produto." }, { status: 400 });
  }

  const codesAutorizados = await codigosDaSessao(auth.sessao);
  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  // O empreendimento que só existe no Panteon entra pela peça comum às rotas da ficha (o porquê e
  // a guarda do cadastro estão em proprios-do-portal.ts).
  const doPanteon = await propriosDoPortal({
    catalogo,
    codesAutorizados,
    sessao: auth.sessao,
  });

  // Sessão só existe com empreendimento: zero código é fonte fora do ar, não falta de permissão.
  if (doPanteon.codesComProprios.length === 0) return empreendimentosIndisponiveis();

  // Sem cadastro não dá para provar que o pai é dele: 503, e não 404.
  if (ehIdDoPai(pedido) && doPanteon.cadastro === null) return empreendimentosIndisponiveis();

  const codes = resolverCodigosDoPedido({
    cadastro: doPanteon.cadastro ?? [],
    catalogo,
    codesAutorizados: doPanteon.codesComProprios,
    empreendimentos: empreendimentosDoPortal(catalogo, codesAutorizados),
    pedido,
    permitidos: new Set(doPanteon.idsDaSessao),
    proprios: doPanteon.proprios,
  });

  // ⚠️ NÃO É `foraDoEscopo()`, pelo mesmo motivo da rota produto/unidades: a aba mostra o `error`
  // cru numa caixa vermelha, e o "Nao encontrado." sem acento destoaria do resto da ficha num caso
  // legítimo (o produto saiu do recorte com a ficha aberta). Mesmo status, 404.
  if (codes.length === 0) {
    if (doPanteon.cadastro === null) return empreendimentosIndisponiveis();
    return NextResponse.json(
      { error: "Este produto não está mais no seu recorte." },
      { status: 404 },
    );
  }

  try {
    const doLegado = codigosParaOC2x(codes, doPanteon.proprios);
    const result: Awaited<ReturnType<typeof loadApoloEnterpriseCadastro>> =
      doLegado.length > 0
        ? await loadApoloEnterpriseCadastro(doLegado)
        : { cadastros: [], ok: true };

    if (!result.ok) {
      console.error("[incorporador][produto/cadastro] C2X indisponível:", result.error);
      return indisponivel();
    }

    const cadastros = montarCadastrosDoProduto({
      cadastroDoPanteon: doPanteon.cadastro ?? [],
      codes,
      doC2x: result.cadastros,
      proprios: doPanteon.proprios,
    });

    return NextResponse.json(
      { data: { cadastros } },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[incorporador][produto/cadastro] falha ao carregar cadastro", error);
    return indisponivel();
  }
}
