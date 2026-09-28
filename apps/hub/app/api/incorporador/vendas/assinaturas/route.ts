import { NextResponse } from "next/server";

import { catalogoDeEmpreendimentos } from "@/lib/apolo/catalogo-empreendimentos";
import { codigosDoPedido } from "@/lib/apolo/incorporador/codigos-do-pedido";
import { empreendimentosDoPortal } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import {
  autorizar,
  codigosDaSessao,
  foraDoEscopo,
  idsDosCodigosNoCadastro,
} from "@/lib/apolo/incorporador/escopo";
import { empreendimentosIndisponiveis, propriosDoPortal } from "@/lib/apolo/incorporador/proprios-do-portal";
import { createApoloAdminClient } from "@/lib/apolo/server";
import { lerContratosDoPanteon } from "@/lib/assinatura/contratos-do-panteon";
import { quadroDosContratos, quadroParaOPortal } from "@/lib/assinatura/contratos-do-panteon-montagem";

// GESTÃO DE ASSINATURA — a aba de Vendas do portal do incorporador, e as sub-abas Assinatura e Resumo
// da tela Contratos do Hércules (`AssinaturasDoProduto`, pílula Contratos da `TelaVendas`).
//
// Mesmo esqueleto de /api/incorporador/vendas: escopo do TOKEN (`codigosDaSessao`), `emp` só
// reduz (`codigosDoPedido`), pedido que não sobra nada é 404.
//
// Os NOMES dos assinantes do fluxo aparecem (decisão já comunicada ao dono). Telefone e e-mail
// não atravessam.
//
// ⚠️ A LEITURA ÚNICA (F4 da fonte única, 28/09/2026). Lucas: *"já cansei de falar que informações de
// venda, contrato, assinatura tem que morar em um local e ele alimentar tudo"*. Até aqui esta rota
// lia o C2X e a D4Sign AO VIVO (`lerAssinaturasDoPortal`) e somava por cima as vendas nativas do
// Panteon (`unirComOPanteon`, v1.389.0). Agora ela lê SÓ o Panteon (`lerContratosDoPanteon`): as
// vendas vivas com contrato das duas origens e os envelopes de contrato dos dois provedores, com a
// D4Sign espelhada pela F3. Sai o C2X, sai a D4Sign ao vivo e sai o `after(aquecer...)`.
//
// ⚠️ SEM EXCEÇÃO QUE LÊ O C2X (resposta 1 do Lucas: "aparecem pelo envelope, sem ler o C2X"). A venda
// que não está no Panteon (o Garden, o que foi vendido direto no C2X depois da carga) aparece pelo
// envelope que o espelho ligou à unidade; no portal ela não diz por que não tem venda.
//
// ⚠️ CONTRATO DE VENDA DESFEITA SOME DAQUI (resposta 2, o padrão (a)): fica só na tela interna, com o
// aviso. É diferença visível em relação à versão anterior, que mostrava o envio até o C2X cancelá-lo.
//
// ⚠️ O QUE ATRAVESSA É UMA ALLOWLIST (`quadroParaOPortal`, plano seção 5): nada de e-mail, provedor,
// procedência, aviso de linha, id do documento no provedor, nem os nomes dos sistemas (decisão do
// Lucas em 18/08/2026: *"não queria esse tipo de comunicado para o incorporador"*). A queda da
// conferência continua sendo dita, com o texto genérico (`AVISO_DE_ATUALIZACAO`).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const codesAutorizados = await codigosDaSessao(auth.sessao);
  const catalogo = await catalogoDeEmpreendimentos(Date.now());

  // ⚠️ O EMPREENDIMENTO QUE SÓ EXISTE NO PANTEON — a mesma expansão da rota /venda, pela peça
  // comum (`propriosDoPortal`; o porquê e a guarda do cadastro estão lá), inclusive os `proprios`
  // que seguem para `codigosDoPedido`. Sem ela a pílula Contratos de um produto nascido no Panteon
  // respondia "Nao encontrado.".
  const doPanteon = await propriosDoPortal({
    catalogo,
    codesAutorizados,
    sessao: auth.sessao,
  });

  // Zero código (nem do C2X, nem do Panteon) = fonte fora do ar, não falta de permissão. Mesma
  // decisão da rota de vendas.
  if (doPanteon.codesComProprios.length === 0) return empreendimentosIndisponiveis();

  const empreendimentos = empreendimentosDoPortal(catalogo, codesAutorizados);

  const pedido = new URL(request.url).searchParams.get("emp");

  // ⚠️ O MESMO `emp` DA ROTA DE VENDAS, RESOLVIDO PELA MESMA FUNÇÃO ("pai:<uuid>" do cadastro do
  // Panteon, ou o id numérico de um filho). Cadastro fora do ar = 503 (resposta pronta).
  const resolvido = await codigosDoPedido({
    catalogo,
    codesAutorizados: doPanteon.codesComProprios,
    empreendimentos,
    pedido,
    proprios: doPanteon.proprios,
    sessao: auth.sessao,
  });
  if (!resolvido.ok) return resolvido.response;

  const { codes } = resolvido;

  // Com o cadastro do Panteon fora do ar, "não sobrou nada" pode ser um produto do Panteon que só
  // não deu para traduzir: 503, e não 404.
  if (codes.length === 0) {
    return doPanteon.cadastro === null ? empreendimentosIndisponiveis() : foraDoEscopo();
  }

  // ⚠️ A LEITURA É PELO ID (`hercules_unidades.enterprise_id`), NÃO PELA SIGLA (a sigla muda num
  // renome, PAN-124). O cadastro dá o id; o catálogo do C2X só de reserva para quem não tem linha nele
  // (ACT, SDT, TSC), e catálogo fora do ar não derruba a tela.
  const traduzido = idsDosCodigosNoCadastro(doPanteon.cadastro, catalogo, codes, doPanteon.idsDaSessao);
  if (traduzido.semId.length > 0) {
    console.warn(`[incorporador][assinaturas] códigos sem id no cadastro nem no catálogo: ${traduzido.semId.join(",")}`);
  }
  if (traduzido.ids.length === 0 && doPanteon.cadastro === null) return empreendimentosIndisponiveis();

  const admin = createApoloAdminClient();
  if (!admin) {
    return NextResponse.json({ error: "Não foi possível ler as assinaturas agora." }, { status: 503 });
  }

  const leitura = await lerContratosDoPanteon({ admin, escopo: { enterpriseIds: traduzido.ids } });
  if (!leitura.ok) {
    return NextResponse.json({ error: leitura.erro }, { status: 503 });
  }

  const quadro = quadroParaOPortal(quadroDosContratos(leitura.contratos, { interno: false }));

  return NextResponse.json(
    { data: { ...quadro, filtro: pedido?.trim() ? pedido.trim() : null } },
    { headers: { "Cache-Control": "no-store" } },
  );
}
