import { NextResponse, type NextRequest } from "next/server";

import { authorizeIrisMetaRequest } from "@/lib/iris/meta-server";

// Transcricao de audio da Athena (operador fala -> texto). Usa o endpoint de
// transcricao da OpenAI (Whisper). O audio em si fica como bolha de voz no
// front; aqui so devolvemos o texto pra Athena entender.

const DEFAULT_TRANSCRIBE_MODEL = "whisper-1";
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // limite da OpenAI

export async function POST(request: NextRequest) {
  const authorization = await authorizeIrisMetaRequest(request, [
    "admin",
    "leader",
    "operator",
  ]);

  if (!authorization.ok) {
    return authorization.response;
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "Transcrição de áudio indisponível: chave de IA não configurada." },
      { status: 503 },
    );
  }

  let inbound: FormData;
  try {
    inbound = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Áudio inválido para transcrição." },
      { status: 400 },
    );
  }

  const file = inbound.get("audio");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json(
      { error: "Nenhum áudio recebido." },
      { status: 400 },
    );
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json(
      { error: "Áudio muito grande para transcrição." },
      { status: 413 },
    );
  }

  const model =
    process.env.HUB_IRIS_TRANSCRIBE_MODEL?.trim() || DEFAULT_TRANSCRIBE_MODEL;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);

  try {
    const outbound = new FormData();
    const fileName =
      file instanceof File && file.name ? file.name : "athena-audio.webm";
    outbound.append("file", file, fileName);
    outbound.append("model", model);
    outbound.append("language", "pt");

    const response = await fetch(
      "https://api.openai.com/v1/audio/transcriptions",
      {
        body: outbound,
        headers: { Authorization: `Bearer ${apiKey}` },
        method: "POST",
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Não foi possível transcrever o áudio agora." },
        { status: 502 },
      );
    }

    const data = (await response.json().catch(() => null)) as {
      text?: string;
    } | null;
    const text = typeof data?.text === "string" ? data.text.trim() : "";

    return NextResponse.json({ text });
  } catch {
    return NextResponse.json(
      { error: "Não foi possível transcrever o áudio agora." },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
