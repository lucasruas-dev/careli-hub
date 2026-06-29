import type { SupabaseClient } from "@supabase/supabase-js";

import type { CacaAgentContact } from "@/lib/iris/caca-agent";

// Memória por cliente da Cacá: anotações curtas e duradouras que ela lembra entre atendimentos
// ("prefere boleto por e-mail", "paga atrasado", "já reclamou de demora", "fala formal").
// Guardadas em caredesk_contacts.metadata.cacaNotes (sem migration). Lidas no início do turno
// (injetadas na persona) e escritas pela ferramenta anotar_sobre_cliente. Nunca dado sensível.

export type CacaClientNote = {
  at: string;
  note: string;
};

const MAX_NOTES = 20;

export function readClientNotes(contact: CacaAgentContact): CacaClientNote[] {
  const raw = (contact.metadata as Record<string, unknown> | null | undefined)
    ?.cacaNotes;

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }

      const record = entry as Record<string, unknown>;
      const note = typeof record.note === "string" ? record.note.trim() : "";

      if (!note) {
        return null;
      }

      return {
        at: typeof record.at === "string" ? record.at : "",
        note,
      };
    })
    .filter((value): value is CacaClientNote => Boolean(value))
    .slice(-MAX_NOTES);
}

export async function appendClientNote(
  client: SupabaseClient,
  contactId: string,
  note: string,
): Promise<boolean> {
  const trimmed = note.trim();

  if (!trimmed) {
    return false;
  }

  const { data } = await client
    .from("caredesk_contacts")
    .select("metadata")
    .eq("id", contactId)
    .maybeSingle<{ metadata: Record<string, unknown> | null }>();

  const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
  const existing = Array.isArray(metadata.cacaNotes) ? metadata.cacaNotes : [];

  // Evita duplicar a mesma anotação.
  const alreadyThere = existing.some(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).note === "string" &&
      ((entry as Record<string, unknown>).note as string).trim().toLowerCase() ===
        trimmed.toLowerCase(),
  );

  if (alreadyThere) {
    return true;
  }

  metadata.cacaNotes = [
    ...existing,
    { at: new Date().toISOString(), note: trimmed },
  ].slice(-MAX_NOTES);

  const { error } = await client
    .from("caredesk_contacts")
    .update({ metadata })
    .eq("id", contactId);

  return !error;
}
