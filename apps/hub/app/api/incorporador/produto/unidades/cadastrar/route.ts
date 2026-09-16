import { NextResponse } from "next/server";

import { autorizarPortalQueOperaSozinho } from "@/lib/apolo/incorporador/board-do-portal";
import { autorizar, foraDoEscopo, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { ehPortalComercial, portalOperaVenda } from "@/lib/apolo/incorporador/perfis-de-portal";
import {
  executarCadastroDeUnidades,
  PRODUTO_NAO_ENCONTRADO,
  produtoNoRecorteDoPortal,
} from "@/lib/hercules/cadastrar-unidades-panteon-server";
import { ehIdDoPai } from "@/lib/hercules/expandir-id-do-painel";

// CADASTRAR UNIDADES PELO PORTAL: o time do incorporador põe lote ou apartamento no PRÓPRIO produto.
//
// Decisão do Lucas (16/09/2026) para a Cecílio Rocha: *"a Cecilio quem vai fazer é o proprio time
// deles"*, e a unidade cadastrada pelo portal grava no Panteon (`hercules_unidades`), nunca no C2X.
// A regra inteira (conferir, criar, importar, atualizar) mora em
// lib/hercules/cadastrar-unidades-panteon-server.ts, a MESMA que a porta do hub chama
// (/api/apolo/empreendimentos/unidades/panteon). Esta rota só decide QUEM entra e EM QUÊ.
//
// ⚠️ A PORTA É A DO INCORPORADOR QUE OPERA A PRÓPRIA VENDA (`portalOperaVenda`, hoje só o Cecílio),
// e NÃO o comercial. `portalOperaVenda` também é verdade para a Gurgel, mas o comercial VENDE produto
// alheio; o estoque é de quem opera o produto, e na Gurgel quem cadastra é o administrativo da
// Careli. Os outros 35 portais de incorporador só leem a carteira: para eles, e para o comercial,
// esta rota não existe (404), como as de reserva e bloqueio.
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DO CORPO. O `emp` da query só ESCOLHE um produto que a sessão já
// alcança (`idsDaSessao`, com grupo expandido em divisões) e nunca amplia. Fail-closed em duas
// camadas: o id numérico fora da sessão para aqui, sem ler nada do banco; o "pai:<uuid>" só vira id
// dentro do servidor, e lá passa pela mesma conferência (`produtoNoRecorteDoPortal`) antes de
// qualquer outra resposta. Os dois casos devolvem o MESMO 404 de um produto inexistente.
//
// ⚠️ SEM VOCABULÁRIO INTERNO NA RESPOSTA. O `detalhe` técnico (migration pendente, mensagem do
// banco) vai para o log, não para o navegador do cliente: a mesma decisão das rotas da ficha do
// produto.
//
// ⚠️ SÓ PRODUTO MARCADO COM ESTE INCORPORADOR (`operado_por`), pela régua única do portal
// (`podeCadastrarNoProduto`, D1 de 16/09/2026). Unidade NOVA só em produto nascido no Panteon; no
// Garden 39, que é da Cecílio e veio do C2X, só a correção de preço, área e matrícula (D2). O VOC 37
// fica de fora: é da Careli, e para a Cecílio é só consulta.
//
// ⚠️ ESCRITA NÃO VALE POR COOKIE VELHO. O cookie dura 12 horas; conta desativada, portal desligado ou
// que deixou de operar a venda no Setup continuariam importando e mudando preço até ele vencer. Nas
// ações que gravam, a revalidação é a MESMA de toda escrita do portal que opera sozinho
// (`autorizarPortalQueOperaSozinho`: portal ativo com o mesmo id, conta ativa e o escopo da conta
// AGORA), e o recorte passa a ser o da sessão vigente, não o do cookie.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const SO_DIGITOS = /^\d{1,18}$/;

const naoEncontrado = () =>
  NextResponse.json({ error: PRODUTO_NAO_ENCONTRADO }, { status: 404 });

export async function POST(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  if (!portalOperaVenda(auth.sessao.slug, auth.sessao.tipo)) return foraDoEscopo();
  if (ehPortalComercial(auth.sessao.tipo)) return foraDoEscopo();

  const pedido = (new URL(request.url).searchParams.get("emp") ?? "").trim();
  if (!pedido) {
    return NextResponse.json({ error: "Informe o produto." }, { status: 400 });
  }

  // Só os dois formatos que apontam UM produto. "group:..." é o catálogo inteiro de um grupo, e
  // unidade não mora num grupo.
  if (!SO_DIGITOS.test(pedido) && !ehIdDoPai(pedido)) return naoEncontrado();

  let sessao = auth.sessao;
  let permitidos = new Set(await idsDaSessao(sessao));

  // Fail-closed ANTES de tocar no banco: id fora da sessão nem carrega o cadastro.
  if (SO_DIGITOS.test(pedido) && !permitidos.has(pedido)) return naoEncontrado();

  const corpo = (await request.json().catch(() => null)) as unknown;
  if (!corpo || typeof corpo !== "object") {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  const acao = (corpo as { acao?: unknown }).acao;
  if (acao === "criar" || acao === "importar" || acao === "atualizar") {
    const vigente = await autorizarPortalQueOperaSozinho(request, sessao);
    if (!vigente.ok) return vigente.response;
    sessao = vigente.sessao;
    // O escopo que vale para gravar é o de AGORA: o empreendimento revogado no Setup sai daqui.
    permitidos = new Set(await idsDaSessao(sessao));
    if (SO_DIGITOS.test(pedido) && !permitidos.has(pedido)) return naoEncontrado();
  }

  const resultado = await executarCadastroDeUnidades({
    // `bloqueado_por` é o `apolo_incorporador_usuarios.id` de quem cadastrou (0163), e o nome é
    // copiado no ato.
    autor: { id: sessao.usuarioId, nome: sessao.usuarioNome },
    corpo,
    pedido,
    podeOperar: (produto, { com0170 }) =>
      produtoNoRecorteDoPortal(produto, {
        com0170,
        incorporadorId: sessao.incorporadorId,
        permitidos,
        slug: sessao.slug,
        tipo: sessao.tipo,
      }),
  });

  if (!resultado.ok) {
    if (resultado.detalhe) {
      console.error("[incorporador][produto/unidades/cadastrar]", resultado.status, resultado.detalhe);
    }
    return NextResponse.json(
      resultado.data === undefined
        ? { error: resultado.error }
        : { data: resultado.data, error: resultado.error },
      { headers: { "Cache-Control": "no-store" }, status: resultado.status },
    );
  }

  return NextResponse.json(
    { data: resultado.data },
    { headers: { "Cache-Control": "no-store" } },
  );
}
