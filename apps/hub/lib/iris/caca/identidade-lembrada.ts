import type { SupabaseClient } from "@supabase/supabase-js";

import type { CacaAgentContact } from "@/lib/iris/caca-agent";

// MEMORIA DE IDENTIDADE da CACA: lembra que ESTE numero de WhatsApp ja' validou um cadastro,
// pra o cliente nao recomecar do zero em cada atendimento novo.
//
// O PROBLEMA (auditoria de 26/jul): a identidade validada por CPF vivia em
// `ticket.metadata.cacaAutomation` e MORRIA quando o ticket fechava — e o fechamento automatico
// e' de 4 horas. Como 64,5% dos atendimentos vem de clientes reincidentes, a mesma pessoa
// digitava CPF e nome completo semana atras semana.
//
// Guardado em `caredesk_contacts.metadata.cacaIdentidade` (sem migration, mesmo padrao do
// [[client-memory]]).
//
// SEGURANCA — o numero de WhatsApp nao e' prova de identidade pra sempre (numero e' reciclado,
// aparelho e' emprestado, parente usa o telefone). Duas travas proporcionais:
//   1. VALIDADE de 30 dias: passou disso, valida de novo do zero.
//   2. RECONFIRMACAO LEVE: quando a identidade vem da memoria (e nao do telefone que casa com o
//      cadastro, nem de uma validacao feita AGORA), a CACA confirma o NOME do titular antes de
//      expor dado financeiro. Fricao baixa pra quem e' o dono, barreira pra quem nao e'.
// Nunca guardamos o documento completo: so' o final mascarado, pra conferencia humana.

const VALIDADE_EM_DIAS = 30;

export type IdentidadeLembrada = {
  c2xClientId: string;
  displayName: string | null;
  // Ex.: "•••456-70" — serve pra auditoria/conferencia, nunca pra reidentificar.
  documentoMascarado: string | null;
  validadoEm: string;
};

export function mascararDocumento(documento: string): string | null {
  const digitos = documento.replace(/\D/g, "");

  if (digitos.length < 4) {
    return null;
  }

  return `•••${digitos.slice(-4)}`;
}

function comoRegistro(valor: unknown): Record<string, unknown> {
  return valor && typeof valor === "object" && !Array.isArray(valor)
    ? (valor as Record<string, unknown>)
    : {};
}

// Logica pura (testavel): valida o formato e aplica a validade de 30 dias.
export function interpretarIdentidadeLembrada(
  bruto: unknown,
  agora: Date = new Date(),
): IdentidadeLembrada | null {
  const registro = comoRegistro(bruto);
  const c2xClientId =
    typeof registro.c2xClientId === "string" && registro.c2xClientId.trim()
      ? registro.c2xClientId.trim()
      : null;
  const validadoEm =
    typeof registro.validadoEm === "string" ? registro.validadoEm : "";

  if (!c2xClientId || !validadoEm) {
    return null;
  }

  const quando = new Date(validadoEm);

  if (Number.isNaN(quando.getTime())) {
    return null;
  }

  const diasDesde = (agora.getTime() - quando.getTime()) / 86_400_000;

  if (diasDesde < 0 || diasDesde > VALIDADE_EM_DIAS) {
    // Fora da validade (ou data no futuro, que indica registro corrompido): ignora e obriga
    // uma validacao nova.
    return null;
  }

  return {
    c2xClientId,
    displayName:
      typeof registro.displayName === "string" && registro.displayName.trim()
        ? registro.displayName.trim()
        : null,
    documentoMascarado:
      typeof registro.documentoMascarado === "string"
        ? registro.documentoMascarado
        : null,
    validadoEm,
  };
}

export function lerIdentidadeLembrada(
  contact: CacaAgentContact,
  agora?: Date,
): IdentidadeLembrada | null {
  const metadata = comoRegistro(contact.metadata);

  return interpretarIdentidadeLembrada(metadata.cacaIdentidade, agora);
}

export async function gravarIdentidadeLembrada({
  c2xClientId,
  client,
  contactId,
  displayName,
  documento,
}: {
  c2xClientId: string;
  client: SupabaseClient;
  contactId: string;
  displayName: string | null;
  documento: string;
}): Promise<boolean> {
  const { data } = await client
    .from("caredesk_contacts")
    .select("metadata")
    .eq("id", contactId)
    .maybeSingle<{ metadata: Record<string, unknown> | null }>();

  const metadata = comoRegistro(data?.metadata);

  metadata.cacaIdentidade = {
    c2xClientId,
    displayName,
    documentoMascarado: mascararDocumento(documento),
    validadoEm: new Date().toISOString(),
  };

  const { error } = await client
    .from("caredesk_contacts")
    .update({ metadata })
    .eq("id", contactId);

  return !error;
}
