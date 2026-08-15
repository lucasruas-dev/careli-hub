// Cliente leve da Evolution API (instância caca-observadora) para consultas
// pontuais — hoje só o nome/subject de um grupo, usado para dar título à
// conversa no cockpit. Best-effort: qualquer falha retorna null e o chamador
// segue com um título genérico.

type EvolutionGroupInfo = {
  subject: string | null;
  size: number | null;
  // A lista vem SEM nome — só número e se é admin. O nome a gente aprende do
  // pushName de quem fala.
  participants: { phoneNumber: string | null; admin: string | null }[];
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
// Menção: pra pessoa ser NOTIFICADA de verdade no celular, não basta escrever
// "@fulano" no texto — a mensagem tem que sair com a lista de mencionados. Sem
// isso vira texto morto. `mentionsEveryOne` é o @todos.
export type EvolutionMentions = {
  everyone?: boolean;
  phones?: string[]; // dígitos, sem @s.whatsapp.net
};

function mentionsPayload(mentions?: EvolutionMentions | null) {
  if (!mentions) {
    return {};
  }

  if (mentions.everyone) {
    return { mentionsEveryOne: true };
  }

  if (mentions.phones?.length) {
    return {
      mentioned: mentions.phones.map((phone) => `${phone}@s.whatsapp.net`),
    };
  }

  return {};
}

export async function sendEvolutionGroupText({
  groupJid,
  mentions,
  text,
}: {
  groupJid: string;
  mentions?: EvolutionMentions | null;
  text: string;
}): Promise<EvolutionSendResult> {
  return postEvolutionMessage("sendText", {
    number: groupJid,
    text,
    ...mentionsPayload(mentions),
  });
}

// Imagem / documento no grupo (Evolution: sendMedia).
export async function sendEvolutionGroupMedia({
  base64,
  caption,
  fileName,
  groupJid,
  mediatype,
  mentions,
  mimeType,
  url,
}: {
  // Uma das duas. `url` é o caminho do arquivo GRANDE: o campo `media` da Evolution aceita tanto
  // base64 quanto URL, e mandar a URL evita carregar 60MB na memória da função serverless.
  base64?: string;
  caption: string;
  fileName: string;
  groupJid: string;
  mediatype: "document" | "image" | "video";
  mentions?: EvolutionMentions | null;
  mimeType: string;
  url?: string;
}): Promise<EvolutionSendResult> {
  return postEvolutionMessage("sendMedia", {
    caption,
    fileName,
    media: url ?? base64,
    mediatype,
    mimetype: mimeType,
    number: groupJid,
    ...mentionsPayload(mentions),
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

// TEXTO 1:1 pelo número do RELACIONAMENTO (o celular, não a Meta).
//
// Regra do Lucas (15/08): comunicado para corretor, imobiliária e coordenador sai por aqui, e
// só o do cliente final sai pelo 4143. **Não precisa de template nem respeita janela de 24h**,
// porque o Evolution não é a API oficial — que é exatamente o que faz os avisos à imobiliária
// pararem de falhar (medido: `imob_pix_enviado` falhava em 95% pela Meta).
//
// O `number` aceita telefone puro com DDI: a mesma rota que o grupo usa com o JID.
export async function sendEvolutionDirectText({
  telefone,
  text,
}: {
  // só dígitos, com DDI (ex.: 5531997250000)
  telefone: string;
  text: string;
}): Promise<EvolutionSendResult> {
  const numero = telefone.replace(/\D/g, "");

  if (numero.length < 12) {
    // Sem DDI o gateway entrega para o número errado (ou para ninguém) em silêncio.
    return { ok: false, error: "Telefone sem DDI: nao da para enviar." };
  }

  return postEvolutionMessage("sendText", { number: numero, text });
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

// A AGENDA DA INSTÂNCIA. O número do Relacionamento espelha um WhatsApp real, com os contatos
// salvos no aparelho — e é de lá que sai o nome de quem NUNCA falou no grupo.
//
// Até 27/07 a gente só tinha os nomes de quem falava (o `pushName` que vem na mensagem), então
// a menção listava números. Este endpoint traz a agenda inteira de uma vez.
//
// `name` é o nome SALVO na agenda (o que o time escreveu); `pushName` é o nome que a pessoa
// escolheu no perfil dela. Preferimos o da agenda: é como o time chama a pessoa.
export type EvolutionContato = { name: string | null; phone: string };

export async function fetchEvolutionContatos(): Promise<EvolutionContato[]> {
  const config = getEvolutionApiConfig();
  if (!config) return [];

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);

    const response = await fetch(
      `${config.url}/chat/findContacts/${encodeURIComponent(config.instance)}`,
      {
        body: JSON.stringify({}),
        headers: { apikey: config.apiKey, "Content-Type": "application/json" },
        method: "POST",
        signal: controller.signal,
      },
    ).finally(() => clearTimeout(timeout));

    if (!response.ok) return [];

    const data = (await response.json()) as unknown;
    const lista = Array.isArray(data)
      ? data
      : Array.isArray((data as Record<string, unknown>)?.contacts)
        ? ((data as Record<string, unknown>).contacts as unknown[])
        : [];

    return lista
      .map((item) => {
        if (!item || typeof item !== "object") return null;

        const c = item as Record<string, unknown>;
        const bruto =
          typeof c.remoteJid === "string"
            ? c.remoteJid
            : typeof c.id === "string"
              ? c.id
              : "";

        // Grupos e listas de transmissão entram na mesma resposta: só interessa gente.
        if (!bruto || bruto.includes("@g.us") || bruto.includes("broadcast")) {
          return null;
        }

        const phone = bruto.split("@")[0]?.replace(/\D/g, "") ?? "";
        if (!phone) return null;

        const nomeDaAgenda =
          typeof c.name === "string" && c.name.trim() ? c.name.trim() : null;
        const nomeDoPerfil =
          typeof c.pushName === "string" && c.pushName.trim()
            ? c.pushName.trim()
            : null;

        return { name: nomeDaAgenda ?? nomeDoPerfil, phone };
      })
      .filter((c): c is EvolutionContato => c !== null);
  } catch {
    return [];
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

    const participants = Array.isArray(record.participants)
      ? (record.participants as unknown[])
          .map((item) => {
            if (!item || typeof item !== "object") {
              return null;
            }
            const p = item as Record<string, unknown>;
            return {
              admin: typeof p.admin === "string" ? p.admin : null,
              phoneNumber:
                typeof p.phoneNumber === "string"
                  ? p.phoneNumber
                  : typeof p.id === "string"
                    ? p.id
                    : null,
            };
          })
          .filter(
            (p): p is { phoneNumber: string | null; admin: string | null } =>
              p !== null,
          )
      : [];

    return { subject, size, participants };
  } catch {
    return null;
  }
}
