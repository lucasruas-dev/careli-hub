import type { NextRequest } from "next/server";

import { authorizeHubItTicketRequest } from "@/lib/hub-it-tickets/server";

// O RECADO DE VOZ VIRA TEXTO.
//
// Lucas (11/09/2026), sobre o Festos: *"capaz de reconhecer audio, imagem, arquivo prints,
// gravação"*.
//
// ⚠️ QUEM ESTÁ TRAVADO NÃO QUER DIGITAR. Descrever por escrito um erro que já irritou é trabalho
// extra em cima do problema — e é por isso que tanto relato chega em três palavras. Falar custa
// dez segundos e traz o contexto inteiro: o que a pessoa clicou, o que esperava, o que apareceu.
//
// ⚠️ A TRANSCRIÇÃO VIRA FALA DA PESSOA, e não um anexo. O texto volta para o campo do chat, ela vê
// o que foi entendido, corrige se saiu errado e envia. O Festos recebe texto como qualquer outro —
// nada de áudio pendurado numa conversa que ninguém mais vai ouvir.
//
// ⚠️ E É A OPENAI QUEM TRANSCREVE, não a Claude: não existe transcrição pela Anthropic em lugar
// nenhum do repo, e as outras quatro implementações do hub (Iris, HelpDesk, Cacá, ata do Chronos)
// já usam este mesmo endpoint. Uma quinta forma de transcrever não tornaria nada melhor.

/** O mesmo modelo que o HelpDesk já usa para transcrever evidência — o mais barato dos três em uso. */
const MODELO_PADRAO = "gpt-4o-mini-transcribe";

/**
 * ⚠️ 20 MB, ABAIXO DO TETO DA OPENAI (25 MB). Um recado de voz de suporte tem segundos; 20 MB já
 * são dezenas de minutos. O limite existe para o caso de alguém arrastar um arquivo errado — e
 * recusar aqui é melhor do que pagar o upload inteiro para a OpenAI recusar depois.
 */
const TETO_DO_AUDIO = 20 * 1024 * 1024;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const autorizacao = await authorizeHubItTicketRequest(request);

  if (!autorizacao.ok) {
    return autorizacao.response;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    return Response.json(
      { error: "A transcrição de áudio não está configurada neste ambiente." },
      { status: 503 },
    );
  }

  let audio: File | null = null;

  try {
    const formulario = await request.formData();
    const campo = formulario.get("audio");
    audio = campo instanceof File ? campo : null;
  } catch {
    audio = null;
  }

  if (!audio || audio.size === 0) {
    return Response.json({ error: "Nenhum áudio recebido." }, { status: 400 });
  }

  if (audio.size > TETO_DO_AUDIO) {
    return Response.json(
      { error: "O áudio é grande demais. Grave um recado mais curto." },
      { status: 413 },
    );
  }

  try {
    const corpo = new FormData();
    corpo.append(
      "model",
      process.env.HUB_IT_TICKET_TRANSCRIPTION_MODEL?.trim() || MODELO_PADRAO,
    );
    // Português declarado: sem isso o modelo às vezes decide que um "ok" isolado é inglês e
    // transcreve o resto com fonética errada.
    corpo.append("language", "pt");
    corpo.append("file", audio, audio.name || "recado.webm");

    const resposta = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      body: corpo,
      cache: "no-store",
      headers: { Authorization: `Bearer ${apiKey}` },
      method: "POST",
    });

    const payload = (await resposta.json().catch(() => null)) as null | {
      text?: unknown;
    };

    if (!resposta.ok || typeof payload?.text !== "string") {
      // ⚠️ O ERRO DA OPENAI FICA NO SERVIDOR. Ele cita modelo, cota e organização — nada disso
      // ajuda quem só queria contar um problema, e tudo isso é informação de dentro.
      console.error("[festo][transcricao] falha", resposta.status);

      return Response.json(
        { error: "Não consegui entender o áudio. Pode escrever?" },
        { status: 502 },
      );
    }

    return Response.json(
      { texto: payload.text.trim() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (erro) {
    console.error(
      "[festo][transcricao] erro",
      erro instanceof Error ? erro.message : String(erro),
    );

    return Response.json(
      { error: "Não consegui entender o áudio. Pode escrever?" },
      { status: 502 },
    );
  }
}
