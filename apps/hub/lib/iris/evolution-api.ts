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
