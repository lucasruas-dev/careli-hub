// Demo de voz da CACÁ: gera o áudio (ElevenLabs) do texto e devolve o mp3 direto, pra o Lucas
// OUVIR a voz escolhida (Geni) no nosso sistema antes de plugar na CACÁ. Rota efêmera de
// validação, protegida por IRIS_TTS_DEMO_KEY (não expõe a chave da ElevenLabs). Abrir no
// browser: /api/iris/tts/demo?key=<demo>&text=<frase>. Ver [[project-caca-voice-tts]].
import type { NextRequest } from "next/server";

import {
  CACA_DEFAULT_TTS_MODEL,
  CACA_DEFAULT_VOICE_ID,
  synthesizeCacaSpeech,
} from "@/lib/iris/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_PHRASE =
  "Oi! Aqui é a Cacá, da Careli. Recebi sua mensagem e já vou te ajudar com o seu boleto, tá bom? Um instante que eu confiro tudo pra você.";

export async function GET(request: NextRequest) {
  const demoKey = process.env.IRIS_TTS_DEMO_KEY?.trim();
  const url = new URL(request.url);
  const providedKey = url.searchParams.get("key")?.trim() ?? "";

  if (!demoKey || providedKey !== demoKey) {
    return new Response("Nao autorizado.", { status: 401 });
  }

  const text = (url.searchParams.get("text")?.trim() || DEMO_PHRASE).slice(0, 800);
  const voiceId = url.searchParams.get("voice")?.trim() || CACA_DEFAULT_VOICE_ID;
  const modelId = url.searchParams.get("model")?.trim() || CACA_DEFAULT_TTS_MODEL;

  try {
    const { audio, contentType } = await synthesizeCacaSpeech({
      text,
      voiceId,
      modelId,
      outputFormat: "mp3_44100_128",
    });

    return new Response(audio, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-disposition": 'inline; filename="caca-voz.mp3"',
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha no TTS.";

    return new Response(`Erro: ${message}`, { status: 502 });
  }
}
