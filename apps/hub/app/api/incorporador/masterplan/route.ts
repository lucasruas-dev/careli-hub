import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import { loadApoloEnterprises } from "@/lib/apolo/empreendimentos";
import { codigosDaSessao } from "@/lib/apolo/incorporador/escopo";
import { MASTERPLANS_INTERNOS } from "@/lib/apolo/incorporador/empreendimentos-do-portal";
import { aplicarEstadoAtual, type EstadoDoLote, lerEstadoDosLotes } from "@/lib/apolo/incorporador/masterplan-estado";
import { recortarMasterplan } from "@/lib/apolo/incorporador/masterplan-recorte";
import { sessaoDoRequest } from "@/lib/apolo/incorporador/sessao";
import { deveClarearMasterplan } from "@/lib/apolo/incorporador/tema-portal";
import { getHadesDbPool } from "@/lib/guardian/db";
import { comTemaClaro } from "@/lib/apolo/masterplan-tema-claro";
import { comSimuladorAberto, loteDoPedido } from "@/lib/apolo/incorporador/masterplan-simulador";
import {
  pediuSoOEspelho,
  soOEspelho,
} from "@/lib/apolo/incorporador/masterplan-so-espelho";

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

// Código do C2X -> arquivo da tela. A lista mora em `empreendimentos-do-portal` porque quem OFERECE
// o mapa (a tela de Vendas) e quem o ENTREGA (esta rota) precisam concordar: oferecer um código que
// esta rota não conhece dá um quadro vazio no cliente.
const TELAS = MASTERPLANS_INTERNOS;

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

/**
 * O estado ATUAL dos lotes que este portal pode ver dentro DESTE arquivo de mapa.
 *
 * ⚠️ O ARQUIVO É COMPARTILHADO. O `vale-do-ouro.html` atende VLO, VOC e VOL: quem chega com VOC
 * pede o mesmo arquivo que o dono do VOL. A permissão, então, não pode ser "abriu o arquivo, viu
 * tudo" — ela é lote a lote, e sai do C2X, que é onde a divisão foi feita.
 *
 * Entram os códigos da SESSÃO que apontam para o mesmo arquivo: quem tiver VOC e VOL vê os dois
 * lados, quem tiver um vê o seu.
 *
 * ⚠️ ESTA CONSULTA FAZ AS DUAS COISAS DE PROPÓSITO. As chaves do mapa são o escopo (quem entra no
 * recorte) e o valor é o estado (situação, comprador e preço de agora). Eram a mesma pergunta ao
 * C2X sendo feita uma vez só: separar em duas rodadas custaria um segundo SELECT para responder o
 * que a primeira já sabe — e abriria a chance de as duas discordarem entre si.
 */
async function estadoDoEscopo(
  codesDaSessao: string[],
  arquivo: string,
): Promise<Map<string, EstadoDoLote> | null> {
  const doMesmoArquivo = codesDaSessao.filter((code) => MASTERPLANS_INTERNOS[code] === arquivo);
  if (doMesmoArquivo.length === 0) return null;

  return lerEstadoDosLotes(doMesmoArquivo);
}

export async function GET(request: Request) {
  const sessao = sessaoDoRequest(request);

  if (!sessao) {
    return NextResponse.json({ error: "Sessão ausente." }, { status: 401 });
  }

  const parametros = new URL(request.url).searchParams;
  const code = (parametros.get("code") ?? "").trim().toUpperCase();
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

  // ⚠️ O RECORTE, ANTES DE QUALQUER COISA. O arquivo cobre o loteamento inteiro; este portal tem
  // direito a uma parte dele. O que não é dele sai AQUI, no servidor — some do HTML, não da tela.
  //
  // FAIL-CLOSED: sem conseguir provar quais lotes são dele, o mapa não vai. Servir o arquivo cru
  // "porque o C2X não respondeu" é exatamente o vazamento que este código existe para fechar.
  const codesDaSessao = await codigosDaSessao(sessao);
  const estado = await estadoDoEscopo(codesDaSessao, arquivo);

  if (!estado) {
    console.error(`[incorporador][masterplan] sem escopo de lotes para ${code} (${arquivo})`);
    return NextResponse.json({ error: "Masterplan indisponível." }, { status: 503 });
  }

  // ⚠️ A SITUAÇÃO VEM DO C2X, NÃO DO ARQUIVO. O HTML é gerado com a situação gravada dentro, e o
  // que está em produção é de 11/08: venda, cancelamento e bloqueio posteriores não chegam nele.
  // O Lucas viu isso no VOL (*"o masterplan é dinâmico, não pode ser estático"*, 19/08/2026), com
  // 6 lotes disponíveis no mapa contra 2 na tela de Vendas. Aqui o desenho continua sendo o do
  // arquivo e só situação, comprador e preço são trocados pelo estado de agora.
  //
  // ANTES DO RECORTE, e não depois: assim o recorte segue sendo a última palavra sobre o que sai
  // daqui, com o mesmo código e o mesmo fail-closed de sempre.
  const atualizado = aplicarEstadoAtual(html, estado);

  if (atualizado.corrigidos > 0) {
    console.info(
      `[incorporador][masterplan] ${code}: ${atualizado.corrigidos} lote(s) com situação corrigida pelo C2X`,
    );
  }

  const recorte = recortarMasterplan(atualizado.html, new Set(estado.keys()));

  if (!recorte.ok) {
    console.error(`[incorporador][masterplan] recorte recusado para ${code}: ${recorte.erro}`);
    return NextResponse.json({ error: "Masterplan indisponível." }, { status: 503 });
  }

  // O TEMA, E SÓ O TEMA. O arquivo aprovado é ESCURO, feito para o shell do Apolo; quando o portal
  // era claro para todo mundo (Lucas, 11/08), ele era clareado à força aqui, senão eram dois
  // esquemas de cor brigando na mesma imagem. Com o portal ganhando alternador (18/08/2026), a
  // conta se inverte: em tela escura o mapa clareado vira um retângulo branco no meio do preto.
  //
  // Então o escuro NÃO tem transformação nenhuma — é o arquivo original, que já nasce certo. É por
  // isso que o parâmetro se chama "tema" e não "claro=1": ele diz em que tela o mapa vai aparecer,
  // e quem decide o que fazer com isso é o servidor.
  //
  // ⚠️ ISTO NÃO TOCA EM AUTORIZAÇÃO NEM EM ESCOPO. Tudo acima — sessão, tradução de código para id
  // do C2X, os lotes permitidos e o recorte fail-closed — já aconteceu, igual para os dois temas.
  // Um `?tema=` chutado na URL muda a cor do mapa de quem já tinha direito de vê-lo, e nada mais.
  //
  // ⚠️ SEM PARÂMETRO CONTINUA CLAREANDO: é o que chega do portal PERSONALIZADO (Cecílio, que não
  // tem alternador) e de qualquer link salvo. O comportamento de hoje segue sendo o padrão.
  const bruto = comCaminhoAbsoluto(recorte.html);

  // ⚠️ `so=espelho` É SÓ APRESENTAÇÃO, e vem DEPOIS de tudo o que decide o que a pessoa pode ver.
  // Sessão, tradução do código, lotes permitidos e recorte fail-closed já aconteceram acima: este
  // parâmetro esconde a casca da tela para o quadro embutido da Venda, e nada mais. Chutar
  // `so=espelho` na URL não revela um lote a mais.
  // ⚠️ TRÊS MODOS DE SERVIR O MESMO ARQUIVO. Inteiro (a tela A-INTERNO como sempre foi), SÓ O
  // ESPELHO (o quadro embutido na Mesa) e o SIMULADOR já aberto num lote — o "Monte o plano de
  // pagamento" que o Lucas aprovou, reusado em vez de reescrito. O arquivo é o mesmo nos três: o
  // que muda é o que fica visível e o que abre sozinho.
  const alvoDoSimulador = loteDoPedido(parametros.get("simular"));
  const corpo = alvoDoSimulador
    ? comSimuladorAberto(bruto, alvoDoSimulador.quadra, alvoDoSimulador.lote)
    : pediuSoOEspelho(parametros.get("so"))
      ? soOEspelho(bruto)
      : bruto;

  return new NextResponse(deveClarearMasterplan(parametros.get("tema")) ? comTemaClaro(corpo) : corpo, {
    headers: {
      // `no-store` porque a tela carrega situação e preço: nada disso pode ficar em cache de proxy.
      "Cache-Control": "no-store",
      "Content-Type": "text/html; charset=utf-8",
    },
  });
}
