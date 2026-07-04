// Demo de voz da CACÁ: gera o áudio (ElevenLabs) do texto e devolve o mp3 direto, pra o Lucas
// OUVIR a voz escolhida (Geni) no nosso sistema antes de plugar na CACÁ. Rota efêmera de
// validação, protegida por IRIS_TTS_DEMO_KEY (não expõe a chave da ElevenLabs). Abrir no
// browser: /api/iris/tts/demo?key=<demo>&text=<frase>. Ver [[project-caca-voice-tts]].
import type { NextRequest } from "next/server";

import {
  CACA_DEFAULT_TTS_MODEL,
  CACA_DEFAULT_VOICE_ID,
  CACA_NATURAL_VOICE_SETTINGS,
  synthesizeCacaSpeech,
} from "@/lib/iris/tts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEMO_PHRASE =
  "Oi! Aqui é a Cacá, da Careli. Recebi sua mensagem e já vou te ajudar com o seu boleto, tá bom? Um instante que eu confiro tudo pra você.";

// Lê um número da query com clamp; usa o fallback quando ausente/inválido. Pra afinar a voz
// pelo ouvido (stability/style/etc.) sem redeploy.
function numParam(
  url: URL,
  name: string,
  fallback: number,
  lo: number,
  hi: number,
): number {
  const raw = url.searchParams.get(name);

  if (raw == null || raw.trim() === "") {
    return fallback;
  }

  const value = Number(raw);

  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.min(hi, Math.max(lo, value));
}

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

  const voiceSettings = {
    stability: numParam(url, "stability", CACA_NATURAL_VOICE_SETTINGS.stability, 0, 1),
    similarity_boost: numParam(
      url,
      "similarity",
      CACA_NATURAL_VOICE_SETTINGS.similarity_boost,
      0,
      1,
    ),
    style: numParam(url, "style", CACA_NATURAL_VOICE_SETTINGS.style, 0, 1),
    use_speaker_boost: (url.searchParams.get("boost") ?? "1").trim() !== "0",
    speed: numParam(url, "speed", 1, 0.7, 1.2),
  };

  try {
    const { audio, contentType } = await synthesizeCacaSpeech({
      text,
      voiceId,
      modelId,
      voiceSettings,
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
