import type { NextRequest } from "next/server";

import {
  FESTO_VOICE_ID,
  FESTO_VOICE_SETTINGS,
  oFestosTemVoz,
  textoParaVoz,
} from "@/lib/hub-support/festo-voz";
import { authorizeHubItTicketRequest } from "@/lib/hub-it-tickets/server";
import { synthesizeCacaSpeech } from "@/lib/iris/tts";

// O FESTOS FALA.
//
// Lucas (11/09/2026): *"deixa ele responder em audio também"*.
//
// ⚠️ ROTA SEPARADA DA CONVERSA, de propósito. A síntese leva segundos; feita dentro de
// `/api/hub/festo/conversa`, somaria à latência do modelo e a pessoa ficaria esperando o texto
// aparecer por causa de um áudio que talvez ela nem fosse ouvir. Aqui o texto chega primeiro, é
// lido, e a voz vem depois — que é também como o Telão do Prometeu faz.
//
// ⚠️ E O ÁUDIO SÓ NASCE QUANDO ALGUÉM PEDE. A ElevenLabs cobra por caractere: gerar voz para toda
// resposta, inclusive as que ninguém ouviria, seria pagar por silêncio em escala.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Espelha o teto de `textoParaVoz`, com folga — o corte fino é lá, este é a porta. */
const TETO_DO_PEDIDO = 4_000;

export async function POST(request: NextRequest) {
  const autorizacao = await authorizeHubItTicketRequest(request);

  if (!autorizacao.ok) {
    return autorizacao.response;
  }

  if (!oFestosTemVoz()) {
    // Sem voz escolhida ainda (ou sem chave, no ambiente local). O chat esconde o botão quando
    // recebe isto — melhor mudo do que falando com a voz de outro agente.
    return Response.json({ error: "O Festos ainda não tem voz." }, { status: 503 });
  }

  const corpo = (await request.json().catch(() => null)) as null | { texto?: unknown };
  const texto = textoParaVoz(
    typeof corpo?.texto === "string" ? corpo.texto.slice(0, TETO_DO_PEDIDO) : "",
  );

  if (!texto) {
    return Response.json({ error: "Nada para falar." }, { status: 400 });
  }

  try {
    const { audio, contentType } = await synthesizeCacaSpeech({
      // ⚠️ 20 SEGUNDOS, o mesmo teto que a CACÁ usa no WhatsApp. Acima disso a pessoa já releu a
      // resposta e seguiu adiante; manter a função viva esperando só gasta.
      signal: AbortSignal.timeout(20_000),
      text: texto,
      voiceId: FESTO_VOICE_ID,
      voiceSettings: FESTO_VOICE_SETTINGS,
    });

    return new Response(audio, {
      headers: {
        "cache-control": "no-store",
        "content-type": contentType,
      },
      status: 200,
    });
  } catch (erro) {
    // ⚠️ O DETALHE DO PROVEDOR FICA NO SERVIDOR: ele cita cota, plano e id de voz. Para quem está
    // no chat, o que importa é que dá para ler — e o texto já está na tela.
    console.error(
      "[festo][voz] falha na sintese",
      erro instanceof Error ? erro.message : String(erro),
    );

    return Response.json({ error: "Não consegui falar agora." }, { status: 502 });
  }
}
