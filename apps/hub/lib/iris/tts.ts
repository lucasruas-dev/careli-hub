// Text-to-speech da CACÁ via ElevenLabs. Gera a voz a partir do texto que a CACÁ escreve,
// pra ela responder em ÁUDIO no WhatsApp (nota de voz). A key vem do ambiente (nunca no
// código). Voz padrao = "Geni" (atendente PT-BR escolhida pelo Lucas). Ver
// [[project-caca-claude-migration]] e [[project-caca-voice-tts]].

const ELEVENLABS_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

// Voz escolhida pelo Lucas (biblioteca ElevenLabs) — "Voz 1" do comparador, afinada no demo
// (preset Natural). Trocada em 4/jul (era GDzHdQOi6jjf8zaXhCYD).
export const CACA_DEFAULT_VOICE_ID = "RVmX026jCrF5VqUvpCk0";
// eleven_v3: mais expressivo/natural (escolha do Lucas no teste). Latencia maior, mas ok pra
// nota de voz assincrona no WhatsApp. multilingual_v2 = alternativa mais rapida/barata.
export const CACA_DEFAULT_TTS_MODEL = "eleven_v3";

export type CacaVoiceSettings = {
  stability: number; // 0..1 — MAIS BAIXO = mais expressivo/natural (menos robotico)
  similarity_boost: number; // 0..1 — fidelidade a voz original
  style: number; // 0..1 — exagero de estilo/emocao (alto demais soa forcado)
  use_speaker_boost: boolean;
  speed?: number; // 0.7..1.2 — <1 fala mais calma
};

// Preset "Natural" afinado pelo Lucas no demo (4/jul) e fixado como padrão da CACÁ:
// stability 0.40 · style 0.45 · speed 1.0 · similarity_boost 0.8 · speaker boost on.
export const CACA_NATURAL_VOICE_SETTINGS: CacaVoiceSettings = {
  similarity_boost: 0.8,
  speed: 1,
  stability: 0.4,
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

// Gera a nota de voz da CACÁ pronta pro envio no WhatsApp (base64 + mime + nome). mp3 é o
// formato mais seguro aceito pelo WhatsApp Cloud (audio/mpeg); toca como áudio. (PTT nativo
// exigiria ogg/opus — melhoria futura.) Ver [[project-caca-voice-tts]].
export async function synthesizeCacaVoiceNote(
  text: string,
  opts?: { voiceId?: string; modelId?: string; signal?: AbortSignal },
): Promise<{ audioBase64: string; mimeType: string; fileName: string }> {
  const { audio } = await synthesizeCacaSpeech({
    text,
    voiceId: opts?.voiceId,
    modelId: opts?.modelId,
    outputFormat: "mp3_44100_128",
    signal: opts?.signal,
  });

  return {
    audioBase64: Buffer.from(audio).toString("base64"),
    mimeType: "audio/mpeg",
    fileName: "caca.mp3",
  };
}
