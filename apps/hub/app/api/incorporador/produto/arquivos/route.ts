import { NextResponse } from "next/server";

import { destinoDoEnvio, destinoPedidoNoCorpo } from "@/lib/apolo/arquivos-do-produto";
import {
  listarArquivosDoProduto,
  prepararEnvioDoArquivo,
  registrarArquivoDoProduto,
  removerArquivoDoProduto,
  resolverProdutoDoPedido,
  type BasesDoPedido,
  type ResultadoDoArquivo,
} from "@/lib/apolo/arquivos-do-produto-servidor";
import { autorizar, foraDoEscopo, idsDaSessao } from "@/lib/apolo/incorporador/escopo";
import { podeEscreverNosEnterprises } from "@/lib/apolo/incorporador/operacao-do-produto";
import { autorizarEscritaNoProduto } from "@/lib/apolo/incorporador/operacao-do-produto-servidor";
import { ehPortalComercial, portalOperaVenda } from "@/lib/apolo/incorporador/perfis-de-portal";
import type { SessaoIncorporador } from "@/lib/apolo/incorporador/sessao";
import { createApoloAdminClient } from "@/lib/apolo/server";

// AS FOTOS E OS VÍDEOS DO PRODUTO, PELA PORTA DO PORTAL — a aba Arquivos da ficha.
//
// Lucas (16/09/2026): *"vamos subir videos, imagens dos produtos para que eles na hora que estiver
// negociando com o cliente possa mostrar essas fotos, imagens e videos"* · *"a Cecilio quem vai
// fazer e o proprio time deles (...) eles meio que vao andar sozinhos sem o time administrativo da
// Careli"*.
//
// ⚠️ LER É DE TODO PORTAL; ESCREVER É DE QUEM OPERA A VENDA. O GET passa por `autorizar` (qualquer
// sessão de portal enxerga as fotos dos produtos que já enxerga); POST e DELETE exigem também
// `portalOperaVenda` — a regra ÚNICA de "este portal opera a venda" (comercial e a lista
// explícita, hoje só o Cecílio). O incorporador comum recebe 404 na escrita, como nas rotas de
// venda e de board: a porta não existe para ele.
//
// ⚠️ E NO PORTAL QUE OPERA SOZINHO, SÓ NO PRODUTO QUE ELE OPERA (D1, 16/09/2026). A Cecílio sobe foto
// do Garden e dos produtos nascidos no portal; o VOC e o VOR são só consulta para ela. POST e DELETE
// passam por `autorizarEscritaNoProduto` (revalida portal, conta e escopo, e aplica a régua de quem
// opera: 403 só consulta, 503 sem conferir); o GET liga o botão pela MESMA régua
// (`podeEscreverNosEnterprises`), com o cadastro que já leu. O comercial continua como era.
//
// ⚠️ O ESCOPO VEM DO COOKIE, NUNCA DA URL. `emp` é o `linha.id` da ficha ("pai:<uuid>" ou id do C2X)
// e só REDUZ: `resolverProdutoDoPedido` cruza com `idsDaSessao` pela mesma régua de produto/resumo
// e devolve 404 para o que não é dele. O `destino` do envio precisa estar DENTRO desse recorte, e o
// arquivo removido precisa ser de um id dele.
//
// ⚠️ O ARQUIVO NUNCA PASSA POR AQUI. O corpo de uma função da Vercel é cortado em 4,5 MB; vídeo de
// produto passa disso no primeiro segundo. `preparar` assina, o navegador grava direto no bucket,
// `registrar` confere com `.info()` antes de criar a linha (modelo: venda/documentos).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const indisponivel = () =>
  NextResponse.json({ error: "Configuração indisponível." }, { status: 503 });

function responder<T>(resultado: ResultadoDoArquivo<T>, cabecalhos?: HeadersInit) {
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({ data: resultado.data }, { headers: cabecalhos });
}

/**
 * O produto pedido, recortado pela sessão. `aoLerBases` recebe o cadastro que a resolução já leu
 * (e se a 0170 veio): é com ele que o GET decide o botão de envio sem uma segunda leitura.
 */
function produtoDaSessao(
  sessao: SessaoIncorporador,
  pedido: unknown,
  aoLerBases?: (bases: BasesDoPedido) => void,
) {
  return resolverProdutoDoPedido(typeof pedido === "string" ? pedido : null, async (bases) => {
    aoLerBases?.(bases);
    return new Set(await idsDaSessao(sessao));
  });
}

export async function GET(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;

  const admin = createApoloAdminClient();
  if (!admin) return indisponivel();

  const lidas: { bases: BasesDoPedido | null } = { bases: null };
  const produto = await produtoDaSessao(
    auth.sessao,
    new URL(request.url).searchParams.get("emp"),
    (bases) => {
      lidas.bases = bases;
    },
  );
  if (!produto.ok) return responder(produto);

  const arquivos = await listarArquivosDoProduto(admin, produto.data.ids, { comAutor: false });
  if (!arquivos.ok) return responder(arquivos);

  // O botão acende pela régua de quem opera o produto: o comercial como sempre; no portal que opera
  // sozinho, só com a 0170 e com todos os ids do produto operados por ele. É só o botão: POST e
  // DELETE conferem de novo, no banco, antes de gravar.
  const podeEnviar =
    portalOperaVenda(auth.sessao.slug, auth.sessao.tipo) &&
    (ehPortalComercial(auth.sessao.tipo) ||
      (lidas.bases !== null &&
        podeEscreverNosEnterprises(
          { incorporadorId: auth.sessao.incorporadorId, slug: auth.sessao.slug, tipo: auth.sessao.tipo },
          lidas.bases.cadastro,
          produto.data.ids,
          lidas.bases.com0170,
        )));

  return NextResponse.json(
    {
      data: {
        arquivos: arquivos.data,
        // Só quem opera a venda recebe os destinos: é o seletor do botão de envio.
        destinos: podeEnviar ? produto.data.destinos : [],
        podeEnviar,
      },
    },
    // no-store: a resposta carrega links assinados. Não é para cache de CDN nem de navegador.
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalOperaVenda(auth.sessao.slug, auth.sessao.tipo)) return foraDoEscopo();

  const admin = createApoloAdminClient();
  if (!admin) return indisponivel();

  let corpo: {
    acao?: unknown;
    altura?: unknown;
    caminho?: unknown;
    comMiniatura?: unknown;
    destino?: unknown;
    duracao?: unknown;
    emp?: unknown;
    largura?: unknown;
    legenda?: unknown;
    mime?: unknown;
    miniatura?: unknown;
    nome?: unknown;
    tamanho?: unknown;
  };
  try {
    corpo = (await request.json()) as typeof corpo;
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }

  if (corpo.acao !== "preparar" && corpo.acao !== "registrar") {
    return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  }

  const produto = await produtoDaSessao(auth.sessao, corpo.emp);
  if (!produto.ok) return responder(produto);

  // ⚠️ ANTES DE ASSINAR OU REGISTRAR QUALQUER COISA: o portal que opera sozinho só grava no produto
  // que ele opera, com a sessão revalidada. O comercial passa sem ida ao banco.
  const escrita = await autorizarEscritaNoProduto(request, auth.sessao, produto.data.ids);
  if (!escrita.ok) return escrita.response;
  const sessao = escrita.sessao;

  // ⚠️ O DESTINO É CONFERIDO NOS DOIS PASSOS, contra o recorte DESTE pedido. No `registrar` não
  // basta o caminho ser coerente: a pasta tem de ser de um id que a sessão alcança agora. Sem
  // `destino` no corpo, o `registrar` usa a pasta do caminho (e ela passa pela mesma conferência).
  const destino = destinoDoEnvio(produto.data.ids, destinoPedidoNoCorpo(corpo));
  if (!destino) {
    return NextResponse.json(
      { error: "Escolha em qual empreendimento o arquivo vai ficar." },
      { status: 422 },
    );
  }

  if (corpo.acao === "preparar") {
    return responder(
      await prepararEnvioDoArquivo(admin, {
        comMiniatura: corpo.comMiniatura === true,
        destino,
        mime: corpo.mime,
        nome: corpo.nome,
        tamanho: corpo.tamanho,
      }),
    );
  }

  return responder(
    await registrarArquivoDoProduto(admin, {
      altura: corpo.altura,
      autor: {
        id: sessao.usuarioId ?? null,
        nome: sessao.usuarioNome ?? null,
        origem: "portal",
      },
      caminho: corpo.caminho,
      destino,
      duracao: corpo.duracao,
      largura: corpo.largura,
      legenda: corpo.legenda,
      miniatura: corpo.miniatura,
      nome: corpo.nome,
    }),
  );
}

export async function DELETE(request: Request) {
  const auth = autorizar(request);
  if (!auth.ok) return auth.response;
  if (!portalOperaVenda(auth.sessao.slug, auth.sessao.tipo)) return foraDoEscopo();

  const admin = createApoloAdminClient();
  if (!admin) return indisponivel();

  const url = new URL(request.url);
  const produto = await produtoDaSessao(auth.sessao, url.searchParams.get("emp"));
  if (!produto.ok) return responder(produto);

  // A mesma porta do envio: remover foto é escrita no produto.
  const escrita = await autorizarEscritaNoProduto(request, auth.sessao, produto.data.ids);
  if (!escrita.ok) return escrita.response;

  return responder(
    await removerArquivoDoProduto(admin, {
      autorId: escrita.sessao.usuarioId ?? null,
      id: url.searchParams.get("id"),
      ids: produto.data.ids,
    }),
  );
}
