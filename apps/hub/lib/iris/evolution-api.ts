// Cliente leve da Evolution API (instância caca-observadora) para consultas
// pontuais — hoje só o nome/subject de um grupo, usado para dar título à
// conversa no cockpit. Best-effort: qualquer falha retorna null e o chamador
// segue com um título genérico.

type EvolutionGroupInfo = {
  subject: string | null;
  size: number | null;
};

function getEvolutionApiConfig() {
  const url = process.env.EVOLUTION_API_URL?.replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY;
  const instance = process.env.EVOLUTION_INSTANCE || "caca-observadora";

  if (!url || !apiKey) {
    return null;
  }

  return { url, apiKey, instance };
}

export type EvolutionSendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; error: string };

// Envia texto para um grupo pelo número observador (que é membro do grupo).
// A mensagem aparece no grupo como vinda desse número, não do operador.
export async function sendEvolutionGroupText({
  groupJid,
  text,
}: {
  groupJid: string;
  text: string;
}): Promise<EvolutionSendResult> {
  return postEvolutionMessage("sendText", { number: groupJid, text });
}

// Imagem / documento no grupo (Evolution: sendMedia).
export async function sendEvolutionGroupMedia({
  base64,
  caption,
  fileName,
  groupJid,
  mediatype,
  mimeType,
}: {
  base64: string;
  caption: string;
  fileName: string;
  groupJid: string;
  mediatype: "document" | "image" | "video";
  mimeType: string;
}): Promise<EvolutionSendResult> {
  return postEvolutionMessage("sendMedia", {
    caption,
    fileName,
    media: base64,
    mediatype,
    mimetype: mimeType,
    number: groupJid,
  });
}

// Audio no grupo (Evolution: sendWhatsAppAudio — vai como mensagem de voz).
export async function sendEvolutionGroupAudio({
  base64,
  groupJid,
}: {
  base64: string;
  groupJid: string;
}): Promise<EvolutionSendResult> {
  return postEvolutionMessage("sendWhatsAppAudio", {
    audio: base64,
    number: groupJid,
  });
}

// Reacao com emoji (Evolution: sendReaction). Precisa da CHAVE da mensagem
// original no WhatsApp: remoteJid do grupo + id do provedor + fromMe.
export async function sendEvolutionGroupReaction({
  emoji,
  fromMe,
  groupJid,
  providerMessageId,
}: {
  emoji: string;
  fromMe: boolean;
  groupJid: string;
  providerMessageId: string;
}): Promise<EvolutionSendResult> {
  return postEvolutionMessage("sendReaction", {
    key: { fromMe, id: providerMessageId, remoteJid: groupJid },
    reaction: emoji,
  });
}

async function postEvolutionMessage(
  endpoint: "sendMedia" | "sendReaction" | "sendText" | "sendWhatsAppAudio",
  payload: Record<string, unknown>,
): Promise<EvolutionSendResult> {
  const config = getEvolutionApiConfig();
  if (!config) {
    return { ok: false, error: "Gateway Evolution nao configurado." };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(
      `${config.url}/message/${endpoint}/${encodeURIComponent(config.instance)}`,
      {
        method: "POST",
        headers: {
          apikey: config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timeout));

    const data = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const detail =
        data && typeof data === "object"
          ? JSON.stringify(data).slice(0, 300)
          : `HTTP ${response.status}`;
      return { ok: false, error: `Evolution recusou o envio: ${detail}` };
    }

    let providerMessageId: string | null = null;
    if (data && typeof data === "object") {
      const key = (data as Record<string, unknown>).key;
      if (key && typeof key === "object") {
        const id = (key as Record<string, unknown>).id;
        providerMessageId = typeof id === "string" ? id : null;
      }
    }

    return { ok: true, providerMessageId };
  } catch {
    return {
      ok: false,
      error: "Falha de rede ao falar com o gateway Evolution.",
    };
  }
}

export type EvolutionInboundMedia = {
  base64: string;
  mimeType: string | null;
  fileName: string | null;
};

// Baixa o binário de uma mídia RECEBIDA (imagem/PDF/áudio/documento). O
// messages.upsert não traz o arquivo — só a referência —, então buscamos pela
// chave da mensagem. Sem isso o cockpit não tem o que abrir.
export async function fetchEvolutionMediaBase64(
  messageId: string,
): Promise<EvolutionInboundMedia | null> {
  const config = getEvolutionApiConfig();
  if (!config) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(
      `${config.url}/chat/getBase64FromMediaMessage/${encodeURIComponent(
        config.instance,
      )}`,
      {
        method: "POST",
        headers: {
          apikey: config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message: { key: { id: messageId } } }),
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as unknown;
    if (!data || typeof data !== "object") {
      return null;
    }

    const record = data as Record<string, unknown>;
    const base64 = typeof record.base64 === "string" ? record.base64 : "";
    if (!base64) {
      return null;
    }

    return {
      base64,
      mimeType:
        typeof record.mimetype === "string"
          ? record.mimetype
          : typeof record.mimeType === "string"
            ? record.mimeType
            : null,
      fileName:
        typeof record.fileName === "string"
          ? record.fileName
          : typeof record.filename === "string"
            ? record.filename
            : null,
    };
  } catch {
    return null;
  }
}

export async function fetchEvolutionGroupInfo(
  groupJid: string,
): Promise<EvolutionGroupInfo | null> {
  const config = getEvolutionApiConfig();
  if (!config) {
    return null;
  }

  try {
    const endpoint = `${config.url}/group/findGroupInfos/${encodeURIComponent(
      config.instance,
    )}?groupJid=${encodeURIComponent(groupJid)}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(endpoint, {
      headers: { apikey: config.apiKey },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as unknown;
    if (typeof data !== "object" || data === null) {
      return null;
    }

    const record = data as Record<string, unknown>;
    const subject =
      typeof record.subject === "string" && record.subject.trim()
        ? record.subject.trim()
        : null;
    const size =
      typeof record.size === "number" && Number.isFinite(record.size)
        ? record.size
        : null;

    return { subject, size };
  } catch {
    return null;
  }
}
