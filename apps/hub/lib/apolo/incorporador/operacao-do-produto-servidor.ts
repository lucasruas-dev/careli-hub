import { NextResponse } from "next/server";

import { lerCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";
import { expandirIdDoPainel, PREFIXO_DO_PAI } from "@/lib/hercules/expandir-id-do-painel";

import { autorizarPortalQueOperaSozinho } from "./board-do-portal";
import { foraDoEscopo, idsDaSessao } from "./escopo";
import {
  MENSAGEM_PRODUTO_SO_CONSULTA,
  podeEscreverNosEnterprises,
  type PortalDaEscrita,
} from "./operacao-do-produto";
import { ehPortalComercial, portalConfeccionaContrato } from "./perfis-de-portal";
import type { SessaoIncorporador } from "./sessao";

// A RÉGUA DE `operacao-do-produto.ts` NO SERVIDOR — o que toda rota de ESCRITA do portal chama antes
// de gravar.
//
// Decisão do Lucas (16/09/2026): no portal que confecciona (hoje só o `cecilio-rocha`) a escrita só
// vale no produto que ele opera (`hercules_empreendimentos.operado_por`). VOC (37) e VOR (41) ficam
// só consulta para a Cecílio; o Garden (39) e o que nasce no portal são dela. O comercial (a Gurgel)
// não muda nada e não paga ida ao banco por isto.
//
// ⚠️ REGRA DE USO: a rota chama DEPOIS do portão de sempre (`autorizarOperacaoDeVenda`, a sessão da
// Têmis...) e DEPOIS de conhecer o enterprise alvo (o da unidade, da CAD, do produto, da minuta), e
// ANTES de gravar. Leitura não chama: a Cecílio continua VENDO o VOC.
//
// ⚠️ TRÊS RESPOSTAS DIFERENTES, E CADA UMA DIZ UMA COISA:
//   • 404 (`foraDoEscopo`) — o produto não é do portal, ou o portal não confecciona: para ele, não
//     existe;
//   • 403 com `soConsulta: true` — o produto é do escopo, mas é operado por outro: a tela esconde o
//     botão e, se alguém chamar por HTTP, a recusa é explícita;
//   • 503 — não deu para conferir (cadastro fora do ar ou a 0170 ainda não aplicada). Nunca vira
//     "pode": sem provar quem opera, ninguém escreve.

/** O que a régua decidiu para um pedido de escrita. */
export type ResultadoDaEscrita = "fora" | "indisponivel" | "pode" | "so-consulta";

type Cadastro = { com0170: boolean; linhas: LinhaDoCadastro[] };

async function lerCadastro(): Promise<Cadastro | null> {
  try {
    return await lerCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[incorporador][operacao-do-produto] cadastro de empreendimentos indisponível", erro);
    return null;
  }
}

/** A decisão com o cadastro já em mãos (uma leitura só por pedido). */
function decidirComCadastro(
  portal: PortalDaEscrita,
  cadastro: Cadastro | null,
  enterpriseIds: readonly unknown[],
): Exclude<ResultadoDaEscrita, "fora"> {
  // ⚠️ SEM A 0170 A COLUNA NÃO VEIO, e toda linha sai "a Careli opera". Para quem escreve isso não é
  // "só consulta" (o Garden É da Cecílio): é "não deu para conferir agora".
  if (!cadastro || !cadastro.com0170) return "indisponivel";
  return podeEscreverNosEnterprises(portal, cadastro.linhas, enterpriseIds, cadastro.com0170)
    ? "pode"
    : "so-consulta";
}

/**
 * O portal pode escrever nestes enterprises? Sem revalidar a sessão: é para quem já revalidou (a
 * Têmis e o CRM do portal, que passam por `autorizarTemisDoPortal`) e só precisa da régua.
 *
 *   • comercial → "pode", sem banco;
 *   • portal que não confecciona → "fora";
 *   • cadastro fora do ar ou sem a 0170 → "indisponivel";
 *   • senão → "pode" ou "so-consulta" por `podeEscreverNosEnterprises`.
 */
export async function escritaNoProduto(
  portal: PortalDaEscrita,
  enterpriseIds: readonly unknown[],
): Promise<ResultadoDaEscrita> {
  if (ehPortalComercial(portal.tipo)) return "pode";
  if (!portalConfeccionaContrato(portal.slug, portal.tipo)) return "fora";
  return decidirComCadastro(portal, await lerCadastro(), enterpriseIds);
}

/**
 * Os ids do recorte que o portal OPERA de fato: a régua de escrita aplicada id a id.
 *
 * (16/09/2026, revisão do conjunto) ⚠️ PARA AS TRAVAS DE DADO GLOBAL DA FICHA. `autorizarEscritaNoProduto`
 * confere só o produto da CAD alvo; as travas de telefone, e-mail, identidade e da imobiliária
 * inteira perguntam "a pessoa tem algo FORA do que este portal pode mexer?". Com o recorte cru do
 * cookie, o VOC (37) e o VOR (41), que são só consulta para a Cecílio, contavam como "dentro", e ela
 * reescrevia o telefone (a chave da Iris) de uma cliente da Careli só por ter criado a CAD do Garden
 * na mesma ficha (D5). Aqui só fica o que a régua deixa escrever.
 *
 *   • comercial → o recorte inteiro, sem banco (a Gurgel como hoje);
 *   • portal que não confecciona → vazio (não escreve em nada);
 *   • cadastro fora do ar ou sem a 0170 → `null` (quem chama responde 503; nunca "pode");
 *   • senão → os ids em que `podeEscreverNosEnterprises` diz sim ("group:" nunca entra).
 */
export async function recorteQueOPortalOpera(
  portal: PortalDaEscrita,
  recorte: Iterable<string>,
): Promise<null | Set<string>> {
  const ids = [...recorte].map((id) => String(id).trim()).filter(Boolean);
  if (ehPortalComercial(portal.tipo)) return new Set(ids);
  if (!portalConfeccionaContrato(portal.slug, portal.tipo)) return new Set();
  const cadastro = await lerCadastro();
  if (!cadastro || !cadastro.com0170) return null;
  return new Set(
    ids.filter((id) => podeEscreverNosEnterprises(portal, cadastro.linhas, [id], cadastro.com0170)),
  );
}

/** A resposta HTTP de cada recusa. */
export function respostaDaEscrita(resultado: Exclude<ResultadoDaEscrita, "pode">): NextResponse {
  if (resultado === "so-consulta") {
    return NextResponse.json({ error: MENSAGEM_PRODUTO_SO_CONSULTA, soConsulta: true }, { status: 403 });
  }
  if (resultado === "indisponivel") {
    return NextResponse.json(
      { error: "Não foi possível conferir o produto agora. Tente de novo em instantes." },
      { status: 503 },
    );
  }
  return foraDoEscopo();
}

function ehGrupo(id: string): boolean {
  return id.toLowerCase().startsWith("group:");
}

/**
 * A porta de escrita das rotas do portal: revalida quem pede, confere o escopo do alvo e aplica a
 * régua de quem opera o produto.
 *
 *   • comercial → ok com a sessão recebida, sem banco (a Gurgel como hoje);
 *   • portal que confecciona →
 *       1. `autorizarPortalQueOperaSozinho` (portal ativo, id igual, conta ativa, escopo fresco). O
 *          cookie vale 12 horas: a conta desligada às 9h não pode seguir gravando até ele vencer;
 *       2. cada id pedido (menos "group:") precisa estar no escopo VIGENTE (`idsDaSessao`). Id
 *          revogado no Setup = 404, o mesmo de um produto que não existe. "pai:<uuid>" vale quando o
 *          pai alcança algo da sessão (a mesma expansão da ficha);
 *       3. a régua (`podeEscreverNosEnterprises`): 403 só consulta ou 503 sem a 0170.
 *   • qualquer outro portal → 404.
 *
 * ⚠️ A SESSÃO QUE SAI DAQUI É A VIGENTE (empreendimentos do cookie cruzados com os da conta agora).
 * É ela que a rota deve usar dali em diante.
 */
export async function autorizarEscritaNoProduto(
  request: Request,
  sessao: SessaoIncorporador,
  enterpriseIds: readonly unknown[],
): Promise<{ ok: true; sessao: SessaoIncorporador } | { ok: false; response: NextResponse }> {
  if (ehPortalComercial(sessao.tipo)) return { ok: true, sessao };
  if (!portalConfeccionaContrato(sessao.slug, sessao.tipo)) {
    return { ok: false, response: foraDoEscopo() };
  }

  const revalidada = await autorizarPortalQueOperaSozinho(request, sessao);
  if (!revalidada.ok) return revalidada;
  const vigente = revalidada.sessao;

  let permitidos: Set<string>;
  try {
    permitidos = new Set((await idsDaSessao(vigente)).map((id) => String(id).trim()));
  } catch (erro) {
    console.error("[incorporador][operacao-do-produto] escopo da sessão indisponível", erro);
    return { ok: false, response: respostaDaEscrita("indisponivel") };
  }

  const alvos = enterpriseIds
    .map((id) => (typeof id === "string" || typeof id === "number" ? String(id).trim() : ""))
    .filter((id) => id && !ehGrupo(id));
  // Pedido sem alvo não é "pode": a régua recusaria de qualquer jeito, e aqui a recusa é a do escopo.
  if (alvos.length === 0) return { ok: false, response: foraDoEscopo() };

  // O escopo dos ids do C2X/Panteon não precisa do cadastro: confere antes de ir ao banco.
  const doPai = alvos.filter((id) => id.startsWith(PREFIXO_DO_PAI));
  if (alvos.some((id) => !id.startsWith(PREFIXO_DO_PAI) && !permitidos.has(id))) {
    return { ok: false, response: foraDoEscopo() };
  }

  const cadastro = await lerCadastro();
  if (!cadastro) return { ok: false, response: respostaDaEscrita("indisponivel") };

  if (doPai.some((id) => expandirIdDoPainel(id, cadastro.linhas, permitidos).length === 0)) {
    return { ok: false, response: foraDoEscopo() };
  }

  const portal: PortalDaEscrita = {
    incorporadorId: vigente.incorporadorId,
    slug: vigente.slug,
    tipo: vigente.tipo,
  };
  const decisao = decidirComCadastro(portal, cadastro, alvos);
  if (decisao !== "pode") return { ok: false, response: respostaDaEscrita(decisao) };

  return { ok: true, sessao: vigente };
}
