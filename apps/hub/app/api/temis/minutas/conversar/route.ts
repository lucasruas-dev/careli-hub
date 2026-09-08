import { NextResponse } from "next/server";

import { CLAUDE_MODEL, getAnthropicClient } from "@/lib/ai/claude";
import { authorizeApoloRead } from "@/lib/apolo/auth";
import { catalogoParaOModelo, CONHECIMENTO_DA_TEMIS } from "@/lib/temis/agente-conhecimento";
import {
  descreverProposta,
  motivoDaRecusa,
  type Proposta,
  type TipoDeProposta,
  triarPropostas,
} from "@/lib/temis/marcar-variaveis";

// A CONVERSA COM O AGENTE DA MINUTA — perguntar, corrigir, mandar fazer.
//
// Lucas, 08/09/2026: *"acho que pode ter um chat entre o usuário e o agente"* e *"ele precisa
// entender muito sobre contratos, as nossas variáveis, queria esse tipo de interação"*.
//
// ⚠️ POR QUE ISTO EXISTE SEPARADO DO BOTÃO. O botão "Marcar variáveis" é uma varredura: lê a minuta
// inteira e devolve tudo que enxergou. Serve para o primeiro passe, e é onde ele é imbatível. Mas
// uma minuta de verdade tem casos que só uma pessoa resolve, e que a varredura sozinha erra ou pula:
//
//   "esse aí é o cônjuge, não o comprador"        — a correção que ensina no meio do trabalho
//   "por que você não marcou a cláusula VII?"     — a pergunta que descobre uma variável faltando
//   "marca só a parte das partes por enquanto"    — o recorte que a varredura não sabe fazer
//   "o que é [valor_garantia_fiduciaria]?"        — a dúvida sobre o próprio catálogo
//
// ⚠️ ELE RESPONDE E PROPÕE NA MESMA VOLTA, e essa é a diferença para um chat comum. A resposta em
// texto explica; as propostas, quando vêm, passam pela MESMA triagem do botão (catálogo, trecho
// existente, trecho único) e caem na mesma lista de aplicar. Conversa que só dá conselho obrigaria
// o operador a traduzir a conversa em cliques — que é o trabalho que o agente veio fazer.
//
// ⚠️ E ELE CONTINUA SEM REESCREVER O TEXTO. A conversa não abre exceção: a única coisa que muda o
// documento é uma proposta aplicada. Ver `lib/temis/marcar-variaveis.ts`.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

/** O texto da minuta que acompanha cada volta da conversa. */
const TETO_DE_TEXTO = 120_000;

/** Quantas voltas da conversa viajam. Além disso, o começo cai — o contexto é a minuta, não o papo. */
const TETO_DE_MENSAGENS = 24;

/**
 * ⚠️ A MARCA QUE SEPARA CONVERSA DE PROPOSTA. Sem ela o modelo teria de escolher entre falar e
 * propor: JSON puro impede a explicação, e texto puro impede a aplicação. Com a marca, ele faz as
 * duas coisas na mesma resposta — e o que estiver fora dela é lido como conversa, nunca como
 * comando.
 */
const ABRE = "<PROPOSTAS>";
const FECHA = "</PROPOSTAS>";

const COMO_CONVERSAR = `
# COMO VOCÊ CONVERSA AQUI

Você está falando com quem prepara a minuta — normalmente o jurídico ou o Lucas. Ele está com o
documento aberto na tela, ao lado desta conversa.

Responda em português do Brasil, direto, sem preâmbulo e sem repetir a pergunta. Frases curtas.
Quando ele apontar um erro seu, corrija sem se desculpar e siga.

Você conhece o catálogo inteiro e a arquitetura acima: use isso para RESPONDER, não só para propor.
Se ele perguntar o que é uma variável, de onde vem o valor, por que você não marcou um trecho, ou
qual das duas parecidas é a certa — responda com o que você sabe.

⚠️ QUANDO ELE PEDIR PARA VOCÊ FAZER ALGUMA COISA NO DOCUMENTO, responda em texto E acrescente as
propostas, entre as marcas, no FIM da mensagem:

${ABRE}{"propostas":[{"tipo":"variavel","trecho":"...","contexto":"...","nome":"cpf_cliente","motivo":"..."}]}${FECHA}

As regras das propostas são as mesmas de sempre (trecho copiado do texto, único ou com contexto,
nome do catálogo). Elas passam pela mesma conferência, e ele aplica clicando.

Se a mensagem dele for uma pergunta, responda só em texto — não force proposta nenhuma.
Se você não tem certeza de um trecho, diga isso em vez de propor: proposta errada num contrato
assinado é cara, e ele está do seu lado para tirar a dúvida.`;

type MensagemDaConversa = { conteudo: string; papel: "agente" | "usuario" };

export async function POST(request: Request) {
  const autorizacao = await authorizeApoloRead(request);
  if (!autorizacao.ok) return autorizacao.response;

  const cliente = getAnthropicClient();
  if (!cliente) {
    return NextResponse.json(
      { erro: "A IA não está configurada (falta ANTHROPIC_API_KEY)." },
      { status: 503 },
    );
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    mensagens?: unknown;
    texto?: unknown;
  };
  const texto = typeof corpo.texto === "string" ? corpo.texto : "";
  const mensagens = lerMensagens(corpo.mensagens);

  if (mensagens.length === 0) {
    return NextResponse.json({ erro: "Sem pergunta." }, { status: 400 });
  }

  // ⚠️ A MINUTA VIAJA CORTADA, e a conversa continua. Um contrato de 140 mil caracteres não cabe
  // numa volta com histórico; cortar o TEXTO (e dizer que cortou) é melhor do que recusar a
  // conversa — as perguntas costumam ser sobre o começo do documento, onde ficam as partes.
  const cortado = texto.length > TETO_DE_TEXTO;
  const minuta = cortado ? texto.slice(0, TETO_DE_TEXTO) : texto;

  let bruto = "";
  try {
    const resposta = await cliente.messages.create({
      max_tokens: 8_000,
      messages: [
        {
          content: [
            `CATÁLOGO DE VARIÁVEIS:\n${catalogoParaOModelo()}`,
            "---",
            minuta.trim()
              ? `TEXTO DA MINUTA ABERTA NA TELA${cortado ? " (cortado no começo do documento — diga isso se a pergunta for sobre o fim)" : ""}:\n\n${minuta}`
              : "A minuta na tela está vazia.",
          ].join("\n\n"),
          role: "user",
        },
        {
          content: "Certo. Li a minuta e conheço o catálogo. O que você precisa?",
          role: "assistant",
        },
        ...mensagens.map((m) => ({
          content: m.conteudo,
          role: m.papel === "usuario" ? ("user" as const) : ("assistant" as const),
        })),
      ],
      model: CLAUDE_MODEL.frontier,
      system: `${CONHECIMENTO_DA_TEMIS}\n\n${COMO_CONVERSAR}`,
    });
    bruto = resposta.content.map((bloco) => (bloco.type === "text" ? bloco.text : "")).join("");
  } catch (e) {
    console.error("[temis][conversar] falha ao chamar o modelo", e instanceof Error ? e.message : e);
    return NextResponse.json({ erro: "A IA não respondeu. Tente de novo." }, { status: 502 });
  }

  const { fala, propostas } = separar(bruto);
  const { aceitas, recusadas } = triarPropostas(texto, propostas);

  return NextResponse.json({
    propostas: [...aceitas]
      .sort((a, b) => a.posicao - b.posicao)
      .map((a) => ({
        acao: descreverProposta(a),
        contexto: a.contexto ?? "",
        motivo: a.motivo,
        nome: a.nome,
        origem: a.variavel?.origem ?? "",
        posicao: a.posicao,
        rotulo: a.variavel?.rotulo ?? descreverProposta(a),
        tipo: a.tipo,
        trecho: a.trecho,
      })),
    recusadas: recusadas.map((r) => ({
      motivo: motivoDaRecusa(r),
      nome: r.proposta.nome ?? "",
      trecho: r.proposta.trecho,
    })),
    resposta: fala,
  });
}

/**
 * Separa o que é conversa do que é proposta.
 *
 * ⚠️ SEM AS MARCAS, TUDO É CONVERSA. Um modelo que esqueceu de fechar o bloco produz uma mensagem
 * estranha, não uma proposta inventada — e o operador vê o texto e pede de novo. O contrário
 * (adivinhar propostas dentro da fala) abriria a porta para aplicar o que ele só estava explicando.
 */
function separar(bruto: string): { fala: string; propostas: Proposta[] } {
  const inicio = bruto.indexOf(ABRE);
  const fim = bruto.indexOf(FECHA, inicio + 1);
  if (inicio < 0 || fim < 0) return { fala: bruto.trim(), propostas: [] };

  const fala = (bruto.slice(0, inicio) + bruto.slice(fim + FECHA.length)).trim();
  const dentro = bruto.slice(inicio + ABRE.length, fim);
  return { fala, propostas: lerPropostas(dentro) };
}

/** O mesmo leitor tolerante da rota de marcar: cerca de código e texto em volta não derrubam. */
function lerPropostas(bruto: string): Proposta[] {
  const semCerca = bruto.replace(/^```(?:json)?/gm, "").replace(/```$/gm, "").trim();
  const inicio = semCerca.indexOf("{");
  const fim = semCerca.lastIndexOf("}");
  if (inicio < 0 || fim <= inicio) return [];

  try {
    const corpo = JSON.parse(semCerca.slice(inicio, fim + 1)) as { propostas?: unknown };
    if (!Array.isArray(corpo.propostas)) return [];
    return corpo.propostas
      .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === "object")
      .map((p) => ({
        contexto: typeof p.contexto === "string" ? p.contexto : undefined,
        motivo: typeof p.motivo === "string" ? p.motivo : "",
        nome: typeof p.nome === "string" ? p.nome : "",
        tipo: typeof p.tipo === "string" ? (p.tipo as TipoDeProposta) : undefined,
        trecho: typeof p.trecho === "string" ? p.trecho : "",
      }));
  } catch {
    return [];
  }
}

/** As mensagens da conversa, saneadas. Só as últimas — o contexto que importa é a minuta. */
function lerMensagens(cru: unknown): MensagemDaConversa[] {
  if (!Array.isArray(cru)) return [];
  return cru
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === "object")
    .map((m) => ({
      conteudo: typeof m.conteudo === "string" ? m.conteudo.slice(0, 8_000) : "",
      papel: m.papel === "agente" ? ("agente" as const) : ("usuario" as const),
    }))
    .filter((m) => m.conteudo.trim() !== "")
    .slice(-TETO_DE_MENSAGENS);
}
