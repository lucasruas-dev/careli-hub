import type { NextRequest } from "next/server";

import {
  atenderComOFesto,
  type FalaDaConversa,
} from "@/lib/hub-support/festo-agente";
import { authorizeHubItTicketRequest } from "@/lib/hub-it-tickets/server";

// A PORTA DA CONVERSA COM O FESTO.
//
// ⚠️ A AUTORIZAÇÃO É A MESMA DO HELPDESK, e não uma nova. `authorizeHubItTicketRequest` já resolve
// sessão, usuário ativo do hub e perfil — e devolve exatamente a pessoa em nome de quem o chamado
// vai ser aberto. Uma checagem própria aqui seria uma segunda definição de "quem pode abrir
// chamado", que um dia divergiria da primeira sem ninguém notar.
//
// ⚠️ E ELA RODA ANTES DE QUALQUER COISA CUSTAR. Sem isto, quem não tem acesso ao hub ainda assim
// gastaria uma chamada ao modelo por mensagem — o jeito mais barato de alguém de fora transformar o
// suporte numa fatura.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
/**
 * ⚠️ O TURNO PODE PENSAR, CONSULTAR E ABRIR CHAMADO. O padrão da Vercel corta em 10s, e a conversa
 * que chama duas ferramentas passa disso com facilidade — a pessoa veria o Festos falhar exatamente
 * nos atendimentos mais úteis, que são os que terminam em registro.
 */
export const maxDuration = 120;

/** Quantas falas sobem por turno. O bastante para o assunto, longe do teto de contexto. */
const TETO_DE_FALAS = 24;
const TETO_POR_FALA = 4_000;
/**
 * ⚠️ DUAS IMAGENS POR FALA, E SO NAS TRES ULTIMAS. O corpo de uma funcao da Vercel morre em ~4,5 MB
 * e cada print reduzido pesa algumas centenas de KB em base64: sem teto, uma conversa com seis
 * prints passa a falhar com 413 no meio do atendimento. E o print que importa e o que a pessoa
 * acabou de mandar — os antigos ja foram lidos e o que valia deles esta no texto da conversa.
 */
const IMAGENS_POR_FALA = 2;
const FALAS_QUE_LEVAM_IMAGEM = 3;
const TETO_DA_IMAGEM_EM_BYTES = 1_600_000;

export async function POST(request: NextRequest) {
  const autorizacao = await authorizeHubItTicketRequest(request);

  if (!autorizacao.ok) {
    return autorizacao.response;
  }

  const corpo = (await request.json().catch(() => null)) as null | {
    conversa?: unknown;
    tela?: unknown;
  };
  const conversa = lerConversa(corpo?.conversa);

  if (!conversa.length) {
    return Response.json({ error: "Escreva o que aconteceu." }, { status: 400 });
  }

  try {
    const atendimento = await atenderComOFesto({
      agora: new Date(),
      conversa,
      tela: lerTela(corpo?.tela),
      usuario: autorizacao.user,
    });

    return Response.json(atendimento, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (erro) {
    // ⚠️ O MOTIVO FICA NO SERVIDOR. O que a pessoa precisa saber é que o Festos caiu e que o chamado
    // continua ao alcance dela; mensagem de erro do modelo na tela do suporte não ajuda ninguém e
    // ainda vaza nome de modelo e limite de conta.
    console.error(
      "[festo] falha no atendimento",
      erro instanceof Error ? erro.message : String(erro),
    );

    return Response.json(
      {
        error:
          "Não consegui responder agora — deve ser coisa do meu lado, não sua.",
      },
      { status: 502 },
    );
  }
}

function lerConversa(valor: unknown): FalaDaConversa[] {
  if (!Array.isArray(valor)) {
    return [];
  }

  return valor
    .filter(
      (fala): fala is FalaDaConversa =>
        Boolean(fala) &&
        typeof fala === "object" &&
        ((fala as FalaDaConversa).de === "festo" ||
          (fala as FalaDaConversa).de === "pessoa") &&
        typeof (fala as FalaDaConversa).texto === "string" &&
        // Texto vazio passa quando vem print junto: mandar a imagem sem legenda e o gesto mais
        // natural do mundo, e descartar essa fala faria o Festos responder ao que veio antes.
        ((fala as FalaDaConversa).texto.trim().length > 0 ||
          Array.isArray((fala as FalaDaConversa).imagens)),
    )
    .slice(-TETO_DE_FALAS)
    .map((fala, indice, todas) => ({
      de: fala.de,
      imagens:
        indice >= todas.length - FALAS_QUE_LEVAM_IMAGEM
          ? lerImagens(fala.imagens)
          : [],
      texto: fala.texto.trim().slice(0, TETO_POR_FALA),
    }));
}

/**
 * Os prints que vieram na fala.
 *
 * ⚠️ O CRIVO E O FORMATO, NAO A CONFIANCA. Isto vem do navegador: aceitar qualquer string que
 * comece com `data:` deixaria passar SVG (que executa script quando renderizado) e arquivos que a
 * API recusa com 400 — derrubando o turno inteiro por causa de um anexo. Sobra o que a Anthropic
 * aceita: jpeg, png, gif e webp em base64.
 */
function lerImagens(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];

  return valor
    .filter(
      (imagem): imagem is string =>
        typeof imagem === "string" &&
        /^data:image\/(?:jpeg|png|gif|webp);base64,/.test(imagem) &&
        imagem.length <= TETO_DA_IMAGEM_EM_BYTES,
    )
    .slice(0, IMAGENS_POR_FALA);
}

/**
 * A tela vem do navegador, então é texto de fora.
 *
 * ⚠️ SÓ O CAMINHO, NUNCA A URL INTEIRA. Query string de tela do Panteon carrega id de cliente,
 * protocolo e às vezes documento; tudo isso iria parar no prompt e no chamado sem que ninguém
 * tivesse pedido. O caminho basta para saber onde a pessoa está.
 */
function lerTela(valor: unknown): null | string {
  if (typeof valor !== "string") {
    return null;
  }

  const limpo = valor.trim().split("?")[0]?.slice(0, 200) ?? "";

  return limpo.startsWith("/") ? limpo : null;
}
