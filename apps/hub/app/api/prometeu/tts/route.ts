import { NextResponse, type NextRequest } from "next/server";

import {
  CACA_NATURAL_VOICE_SETTINGS,
  synthesizeCacaSpeech,
  type CacaVoiceSettings,
} from "@/lib/iris/tts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Voz da CACÁ pro Telão do Prometeu (chamada de senha + comemoração de venda). O Telão roda
// PÚBLICO nas TVs (sem login), entao esta rota é pública (ver allowlist no proxy.ts). Como o
// ElevenLabs é PAGO, limitamos o tamanho do texto pra conter custo/abuso. Sem ELEVENLABS_API_KEY
// (local), retorna 503 e o Telão cai no fallback de voz do navegador. Ver [[project_caca_voice_tts]].
const MAX_TTS_TEXT = 320;

type PrometeuTtsBody = {
  text?: string;
  voiceSettings?: CacaVoiceSettings;
  modelId?: string;
};

export async function POST(request: NextRequest) {
  let body: PrometeuTtsBody | null = null;

  try {
    body = (await request.json()) as PrometeuTtsBody;
  } catch {
    body = null;
  }

  const text = String(body?.text ?? "").trim().slice(0, MAX_TTS_TEXT);

  if (!text) {
    return NextResponse.json({ error: "Texto ausente para a voz." }, { status: 400 });
  }

  try {
    const { audio, contentType } = await synthesizeCacaSpeech({
      text,
      voiceSettings: body?.voiceSettings ?? CACA_NATURAL_VOICE_SETTINGS,
      modelId: body?.modelId,
    });

    return new NextResponse(audio, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "no-store",
      },
    });
  } catch {
    // Sem key (local) ou erro do provedor: o Telão detecta o !ok e usa a voz do navegador.
    return NextResponse.json({ error: "Voz indisponível." }, { status: 503 });
  }
}
