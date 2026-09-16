import { NextResponse } from "next/server";

import { destinoDoEnvio, destinoPedidoNoCorpo } from "@/lib/apolo/arquivos-do-produto";
import {
  listarArquivosDoProduto,
  prepararEnvioDoArquivo,
  registrarArquivoDoProduto,
  removerArquivoDoProduto,
  resolverProdutoDoPedido,
  type ResultadoDoArquivo,
  todosOsIdsConhecidos,
} from "@/lib/apolo/arquivos-do-produto-servidor";
import { authorizeApoloRead, authorizeApoloWrite } from "@/lib/apolo/auth";
import { createApoloAdminClient } from "@/lib/apolo/server";

// AS FOTOS E OS VÍDEOS DO PRODUTO, PELA PORTA DO APOLO — para a Careli também poder subir.
//
// Mesmos verbos e mesma regra da porta do portal (/api/incorporador/produto/arquivos): as duas
// chamam `arquivos-do-produto-servidor.ts`. O que muda é o portão e o alcance:
//   • portão: `authorizeApoloRead` para ler, `authorizeApoloWrite` para enviar e remover (o
//     `viewer` do hub olha, não mexe);
//   • alcance: o time da Careli abre qualquer empreendimento por desenho, então o `permitidos` é
//     tudo o que a casa CONHECE (catálogo do C2X + cadastro do Panteon). Id que ninguém conhece
//     continua 404: sem isso, um id digitado criaria pasta e linha de um empreendimento fantasma.
//
// ⚠️ `enviado_origem = 'hub'` E O NOME DE QUEM ENVIOU VEM DO GATE (`authorization.nome`), copiado no
// ato. Na leitura desta porta o nome volta; na do portal, só "Careli".
//
// ⚠️ O `emp` AQUI É O `row.id` DA TELA EMPREENDIMENTO ("37" ou "group:Lagoa Bonita") ou o
// "pai:<uuid>" do cadastro. Produto consolidado lê as divisões juntas e, para ENVIAR, exige o
// `destino` (a divisão): a foto mora numa divisão só (ATENCAO 1 da 0169).
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

const indisponivel = () =>
  NextResponse.json({ error: "Supabase indisponivel." }, { status: 503 });

function responder<T>(resultado: ResultadoDoArquivo<T>) {
  if (!resultado.ok) {
    return NextResponse.json({ error: resultado.error }, { status: resultado.status });
  }
  return NextResponse.json({ data: resultado.data });
}

function produtoDaCasa(pedido: unknown) {
  return resolverProdutoDoPedido(typeof pedido === "string" ? pedido : null, (bases) =>
    todosOsIdsConhecidos(bases.cadastro, bases.catalogo),
  );
}

export async function GET(request: Request) {
  const authorization = await authorizeApoloRead(request);
  if (!authorization.ok) return authorization.response;

  const admin = createApoloAdminClient();
  if (!admin) return indisponivel();

  const produto = await produtoDaCasa(new URL(request.url).searchParams.get("emp"));
  if (!produto.ok) return responder(produto);

  const [arquivos, escrita] = await Promise.all([
    listarArquivosDoProduto(admin, produto.data.ids, { comAutor: true }),
    // (16/09/2026, revisão) A aba agora está na tela Empreendimento do Apolo, aberta a todo papel de
    // leitura. A segunda conferência do token custa uma ida ao Auth quando a aba abre, e evita o
    // `viewer` ver o botão de enviar e só descobrir o 403 depois de escolher o arquivo.
    authorizeApoloWrite(request),
  ]);
  if (!arquivos.ok) return responder(arquivos);

  return NextResponse.json(
    {
      data: {
        arquivos: arquivos.data,
        destinos: escrita.ok ? produto.data.destinos : [],
        // O botão: a tela liga com `podeEditar` e só mostra com isto; a escrita confere de novo.
        podeEnviar: escrita.ok,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const authorization = await authorizeApoloWrite(request);
  if (!authorization.ok) return authorization.response;

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

  const produto = await produtoDaCasa(corpo.emp);
  if (!produto.ok) return responder(produto);

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
      autor: { id: authorization.userId, nome: authorization.nome, origem: "hub" },
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
  const authorization = await authorizeApoloWrite(request);
  if (!authorization.ok) return authorization.response;

  const admin = createApoloAdminClient();
  if (!admin) return indisponivel();

  const url = new URL(request.url);
  const produto = await produtoDaCasa(url.searchParams.get("emp"));
  if (!produto.ok) return responder(produto);

  return responder(
    await removerArquivoDoProduto(admin, {
      autorId: authorization.userId,
      id: url.searchParams.get("id"),
      ids: produto.data.ids,
    }),
  );
}
