import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";

// O MASTERPLAN INTERNO, servido para quem tem sessão.
//
// A tela é o A-INTERNO, aprovado pelo Lucas com nove prints de validação. Ela NÃO é reescrita aqui:
// esta rota entrega o próprio arquivo, byte a byte, e a aba Produtos o exibe num quadro. Trocar o
// desenho por outro mapa já foi tentado e reprovado no mesmo dia.
//
// POR QUE OS ARQUIVOS SAÍRAM DE `public/`. Qualquer coisa em public/ é servida como estático e não
// passa por gate nenhum: o masterplan interno do Garden respondia 200 para quem tivesse o link,
// sem login, com preço de 406 lotes e 186 nomes de compradores dentro do HTML. Fora de public/ o
// arquivo só é alcançável por aqui, e aqui a sessão é conferida antes.
//
// O que continua público, de propósito: as PLANTAS (as imagens). Elas não têm preço, situação nem
// nome de ninguém, e é o desenho do loteamento que qualquer folder de venda já mostra. E o
// masterplan público do Vale do Ouro (/masterplans/vale-do-ouro.html) segue onde está e como está,
// que é o link que o Lucas já distribuiu.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Código do C2X -> arquivo da tela. O Vale do Ouro tem TRÊS códigos apontando para o mesmo mapa:
// no chão é um loteamento só, e a divisão em VOL (Lino) e VOC (Cecílio) foi feita lote a lote.
const TELAS: Record<string, string> = {
  GDN: "garden.html",
  VLO: "vale-do-ouro.html",
  VOC: "vale-do-ouro.html",
  VOL: "vale-do-ouro.html",
};

// ⚠️ O `process.cwd()` NÃO É O MESMO NOS DOIS AMBIENTES: no dev server ele é a pasta do app
// (apps/hub) e no build da Vercel pode ser a raiz do monorepo. Cravar um dos dois faz a tela
// funcionar numa máquina e sumir na outra, com 503 e nenhuma pista. Por isso os dois caminhos são
// tentados, e o primeiro que existir vale.
const PASTAS = [
  path.join(process.cwd(), "masterplans-internos"),
  path.join(process.cwd(), "apps", "hub", "masterplans-internos"),
];

function caminhoDaTela(arquivo: string): null | string {
  for (const pasta of PASTAS) {
    const alvo = path.join(pasta, arquivo);
    if (fs.existsSync(alvo)) return alvo;
  }
  return null;
}

// O HTML do Garden nasceu ao lado da própria planta e a referencia por caminho RELATIVO. Servido
// por /api/..., esse relativo viraria /api/incorporador/garden-planta.jpg e a planta não
// carregaria. O do Vale do Ouro já usa caminho absoluto e passa intacto.
function comCaminhoAbsoluto(html: string): string {
  return html.replace('src="garden-planta.jpg"', 'src="/garden/garden-planta.jpg"');
}

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);

  if (!sessao) {
    return NextResponse.json({ error: "Sessão ausente." }, { status: 401 });
  }

  const code = (new URL(request.url).searchParams.get("code") ?? "").trim().toUpperCase();
  const arquivo = TELAS[code];

  if (!arquivo) {
    return NextResponse.json({ error: "Masterplan não encontrado." }, { status: 404 });
  }

  // ESCOPO: o código pedido tem que pertencer a este incorporador. A permissão é por id do C2X, e
  // o pedido chega por código, então a tradução acontece aqui — nunca confiando no que veio na URL.
  const c2x = await loadApoloEnterprises();

  if (!c2x.ok) {
    return NextResponse.json(
      { error: "Não foi possível validar o acesso agora." },
      { status: 503 },
    );
  }

  const idPorCodigo = new Map<string, string>();
  for (const linha of c2x.data.rows) {
    const candidatos = linha.stages?.length ? linha.stages : [linha];
    for (const candidato of candidatos) {
      if (candidato.code) {
        idPorCodigo.set(String(candidato.code).toUpperCase(), String(candidato.id));
      }
    }
  }

  const id = idPorCodigo.get(code);

  if (!id || !sessao.enterpriseIds.includes(id)) {
    // 404, não 403: para quem não tem o empreendimento, ele simplesmente não existe.
    return NextResponse.json({ error: "Masterplan não encontrado." }, { status: 404 });
  }

  const caminho = caminhoDaTela(arquivo);

  if (!caminho) {
    console.error(
      `[incorporador][masterplan] arquivo ausente: ${arquivo} (procurado em ${PASTAS.join(" e ")})`,
    );
    return NextResponse.json({ error: "Masterplan indisponível." }, { status: 503 });
  }

  let html: string;
  try {
    html = fs.readFileSync(caminho, "utf8");
  } catch {
    console.error(`[incorporador][masterplan] falha ao ler ${caminho}`);
    return NextResponse.json({ error: "Masterplan indisponível." }, { status: 503 });
  }

  return new NextResponse(comCaminhoAbsoluto(html), {
    headers: {
      // `no-store` porque a tela carrega situação e preço: nada disso pode ficar em cache de proxy.
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
