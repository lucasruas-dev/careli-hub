// O composer grava áudio no formato nativo do navegador — no Chrome é webm/opus, que o WhatsApp
// Cloud API NÃO aceita. Aqui convertemos pra MP3 (audio/mpeg, aceito pela Meta) re-encodando no
// cliente: decodifica via Web Audio API, faz downmix pra mono e codifica com lamejs. O encoder é
// carregado sob demanda (dynamic import) pra não pesar o bundle de quem nunca grava áudio.

// Formatos que o WhatsApp já aceita direto (Firefox grava ogg/opus; Safari, mp4) — não reencodar.
const WHATSAPP_NATIVE_AUDIO = /audio\/(ogg|mpeg|mp4|aac|amr)/i;
const MP3_KBPS = 128;
const MP3_BLOCK_SIZE = 1152;

export function audioNeedsTranscode(mimeType: string | null | undefined) {
  return !WHATSAPP_NATIVE_AUDIO.test(mimeType ?? "");
}

export function audioExtensionForMime(mimeType: string | null | undefined) {
  const normalized = (mimeType ?? "").toLowerCase();

  if (normalized.includes("ogg")) {
    return "ogg";
  }
  if (normalized.includes("mpeg") || normalized.includes("mp3")) {
    return "mp3";
  }
  if (normalized.includes("mp4")) {
    return "mp4";
  }
  if (normalized.includes("aac")) {
    return "aac";
  }
  if (normalized.includes("amr")) {
    return "amr";
  }
  if (normalized.includes("webm")) {
    return "webm";
  }

  return "bin";
}

export async function transcodeAudioToMp3(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioCtx) {
    throw new Error("Navegador sem suporte a conversao de audio.");
  }

  const audioContext = new AudioCtx();

  try {
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const samples = downmixToMonoInt16(audioBuffer);
    const { Mp3Encoder } = await import("@breezystack/lamejs");
    const encoder = new Mp3Encoder(1, audioBuffer.sampleRate, MP3_KBPS);
    const chunks: Uint8Array[] = [];

    for (let offset = 0; offset < samples.length; offset += MP3_BLOCK_SIZE) {
      const block = samples.subarray(offset, offset + MP3_BLOCK_SIZE);
      const encoded = encoder.encodeBuffer(block);

      if (encoded.length > 0) {
        chunks.push(encoded);
      }
    }

    const tail = encoder.flush();

    if (tail.length > 0) {
      chunks.push(tail);
    }

    if (!chunks.length) {
      throw new Error("Conversao de audio nao gerou conteudo.");
    }

    return new Blob(chunks as BlobPart[], { type: "audio/mpeg" });
  } finally {
    void audioContext.close();
  }
}

function downmixToMonoInt16(audioBuffer: AudioBuffer): Int16Array {
  const channelCount = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const result = new Int16Array(length);
  const channels: Float32Array[] = [];

  for (let channel = 0; channel < channelCount; channel += 1) {
    channels.push(audioBuffer.getChannelData(channel));
  }

  for (let i = 0; i < length; i += 1) {
    let sum = 0;

    for (const channel of channels) {
      sum += channel[i] ?? 0;
    }

    const sample = Math.max(-1, Math.min(1, sum / channelCount));
    result[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return result;
}
