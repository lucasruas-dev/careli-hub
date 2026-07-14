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
  const config = getEvolutionApiConfig();
  if (!config) {
    return { ok: false, error: "Gateway Evolution nao configurado." };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(
      `${config.url}/message/sendText/${encodeURIComponent(config.instance)}`,
      {
        method: "POST",
        headers: {
          apikey: config.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ number: groupJid, text }),
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timeout));

    const payload = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      const detail =
        payload && typeof payload === "object"
          ? JSON.stringify(payload).slice(0, 300)
          : `HTTP ${response.status}`;
      return { ok: false, error: `Evolution recusou o envio: ${detail}` };
    }

    let providerMessageId: string | null = null;
    if (payload && typeof payload === "object") {
      const key = (payload as Record<string, unknown>).key;
      if (key && typeof key === "object") {
        const id = (key as Record<string, unknown>).id;
        providerMessageId = typeof id === "string" ? id : null;
      }
    }

    return { ok: true, providerMessageId };
  } catch {
    return { ok: false, error: "Falha de rede ao falar com o gateway Evolution." };
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
