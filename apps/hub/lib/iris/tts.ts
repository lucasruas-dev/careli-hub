// Text-to-speech da CACÁ via ElevenLabs. Gera a voz a partir do texto que a CACÁ escreve,
// pra ela responder em ÁUDIO no WhatsApp (nota de voz). A key vem do ambiente (nunca no
// código). Voz padrao = "Geni" (atendente PT-BR escolhida pelo Lucas). Ver
// [[project-caca-claude-migration]] e [[project-caca-voice-tts]].

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// Voz "Geni e o Zefelin" (atendente realista, PT-BR) — biblioteca ElevenLabs.
export const CACA_DEFAULT_VOICE_ID = "JPaHP82NTgRbDP91t8zP";
// Melhor qualidade multilingue (cobre PT-BR). Trocar por turbo/flash se latencia pesar.
export const CACA_DEFAULT_TTS_MODEL = "eleven_multilingual_v2";

export type CacaVoiceSettings = {
  stability: number; // 0..1 — MAIS BAIXO = mais expressivo/natural (menos robotico)
  similarity_boost: number; // 0..1 — fidelidade a voz original
  style: number; // 0..1 — exagero de estilo/emocao (alto demais soa forcado)
  use_speaker_boost: boolean;
  speed?: number; // 0.7..1.2 — <1 fala mais calma
};

// Ajuste "natural" (ponto de partida): estabilidade mais baixa + um tanto de estilo. Refinar
// por ouvido no demo (query params) antes de fixar. Ver [[project-caca-voice-tts]].
export const CACA_NATURAL_VOICE_SETTINGS: CacaVoiceSettings = {
  stability: 0.4,
  similarity_boost: 0.8,
  style: 0.45,
  use_speaker_boost: true,
};

// mp3 = playback fácil no browser (demo). opus/ogg = nota de voz nativa do WhatsApp.
export type ElevenLabsOutputFormat =
  | "mp3_44100_128"
  | "mp3_44100_64"
  | "opus_48000_64"
  | "opus_48000_32";

export type CacaSpeechResult = {
  audio: ArrayBuffer;
  contentType: string;
  outputFormat: ElevenLabsOutputFormat;
};

function contentTypeForFormat(format: ElevenLabsOutputFormat): string {
  return format.startsWith("opus") ? "audio/ogg" : "audio/mpeg";
}

// Sintetiza a fala. Lança erro com o detalhe do provedor quando falha (pra logar/mostrar).
export async function synthesizeCacaSpeech({
  text,
  voiceId = CACA_DEFAULT_VOICE_ID,
  modelId = CACA_DEFAULT_TTS_MODEL,
  outputFormat = "mp3_44100_128",
  voiceSettings = CACA_NATURAL_VOICE_SETTINGS,
  apiKey = process.env.ELEVENLABS_API_KEY,
  signal,
}: {
  text: string;
  voiceId?: string;
  modelId?: string;
  outputFormat?: ElevenLabsOutputFormat;
  voiceSettings?: CacaVoiceSettings;
  apiKey?: string;
  signal?: AbortSignal;
}): Promise<CacaSpeechResult> {
  const clean = text.trim();

  if (!clean) {
    throw new Error("Texto vazio para TTS.");
  }

  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY ausente no ambiente.");
  }

  const url = `${ELEVENLABS_TTS_URL}/${encodeURIComponent(voiceId)}?output_format=${outputFormat}`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "content-type": "application/json",
      accept: contentTypeForFormat(outputFormat),
    },
    body: JSON.stringify({
      text: clean,
      model_id: modelId,
      voice_settings: voiceSettings,
    }),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    // Detalhe pode conter mensagem do provedor (nunca a key) — seguro logar.
    throw new Error(
      `ElevenLabs TTS ${response.status}: ${detail.slice(0, 500) || response.statusText}`,
    );
  }

  const audio = await response.arrayBuffer();

  return { audio, contentType: contentTypeForFormat(outputFormat), outputFormat };
}
