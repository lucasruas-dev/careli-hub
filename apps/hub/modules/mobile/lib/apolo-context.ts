import type {
  IrisApoloContextEntity,
  IrisTicket,
} from "@/modules/caredesk/types/iris-types";
import { getMobileAccessToken } from "@/modules/mobile/lib/access-token";

// Busca o contexto completo do cliente no Apolo (read-model Iris<-Apolo, que já
// hidrata carteira/parcelas via C2X) — mesmo endpoint que o cockpit do desktop
// (loadApoloContext em IrisPage): GET /api/apolo/relationships?q=<telefone|nome>.

function onlyDigits(value?: string | null): string {
  return (value ?? "").replace(/\D/g, "");
}

function pickEntity(
  entities: IrisApoloContextEntity[],
  phoneDigits: string,
): IrisApoloContextEntity | null {
  if (phoneDigits.length >= 8) {
    const tail = phoneDigits.slice(-8);
    const matched = entities.find((entity) =>
      (entity.contacts ?? []).some((contact) =>
        onlyDigits(contact.value).includes(tail),
      ),
    );

    if (matched) {
      return matched;
    }
  }

  return entities[0] ?? null;
}

export async function loadApoloContextForTicket(
  ticket: IrisTicket,
): Promise<IrisApoloContextEntity | null> {
  const phoneDigits = onlyDigits(ticket.contactPhone);
  const matchedDigits = onlyDigits(ticket.crm360Registration?.matchedPhone);
  const label = (ticket.contactLabel ?? "").trim();
  // O read-model do Apolo (apolo_search_entries.normalized_text) é buscado por
  // TEXTO (ilike). Telefone/documento ficam HASHEADOS nos identifiers, então
  // buscar por telefone NUNCA casa aqui — mas o `document_masked` está dentro do
  // normalized_text. Logo o DOCUMENTO (que o phone-match já nos deu) é a chave
  // certa; o nome é fallback (pode não casar por diferença de sobrenome).
  const documentQuery = (ticket.crm360Registration?.documentMasked ?? "").trim();

  if (
    !documentQuery &&
    label.length < 3 &&
    phoneDigits.length < 8 &&
    matchedDigits.length < 8
  ) {
    return null;
  }

  const accessToken = await getMobileAccessToken();

  // 1) Read-model do Apolo: documento (casa no normalized_text) > nome.
  const candidates = [documentQuery, label].filter(
    (value, index, values) =>
      value.length >= 3 && values.indexOf(value) === index,
  );

  for (const candidate of candidates) {
    const response = await fetch(
      `/api/apolo/relationships?q=${encodeURIComponent(candidate)}&limit=20`,
      {
        cache: "no-store",
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      data?: { entities?: IrisApoloContextEntity[] };
    } | null;

    if (!response.ok) {
      continue;
    }

    const entities = payload?.data?.entities ?? [];

    if (entities.length) {
      return pickEntity(entities, phoneDigits);
    }
  }

  // 2) Fallback: resolver direto no C2X (mesmo do cockpit desktop). Cobre os
  // casos que o read-model não acha por variação de telefone (9º dígito) etc. —
  // é o que faz o "Vinculado" (phone-match) bater com a carteira/financeiro.
  try {
    const response = await fetch("/api/iris/c2x/resolve", {
      body: JSON.stringify({
        phones: [
          ticket.contactPhone,
          ticket.crm360Registration?.matchedPhone,
        ].filter((phone): phone is string => Boolean(phone)),
        query: label,
      }),
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const payload = (await response.json().catch(() => null)) as {
      data?: { entities?: IrisApoloContextEntity[] };
    } | null;

    if (response.ok) {
      const entities = payload?.data?.entities ?? [];

      if (entities.length) {
        return pickEntity(entities, phoneDigits);
      }
    }
  } catch {
    // Sem C2X disponível: fica só com o read-model do Apolo.
  }

  return null;
}
