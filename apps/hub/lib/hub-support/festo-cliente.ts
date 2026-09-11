"use client";

import { getHubSupabaseClient } from "@/lib/supabase/client";

// A CHAMADA DO NAVEGADOR PARA O FESTO.
//
// ⚠️ SEPARADA DO COMPONENTE de propósito: o que sai daqui é um contrato (o que sobe, o que volta,
// o que significa cada erro), e contrato dentro de arquivo de tela vira cópia no dia em que o Festos
// aparecer numa segunda tela — o que já está previsto.

export type FalaDoChat = {
  de: "festo" | "pessoa";
  /** Os prints que foram junto, já reduzidos, como data URL. */
  imagens?: string[];
  texto: string;
};

export type RespostaDoFesto = {
  /** O chamado que ELE abriu neste turno, quando abriu. */
  chamado: null | { protocolo: string; titulo: string };
  texto: string;
};

export async function falarComOFesto({
  conversa,
  tela,
}: {
  conversa: readonly FalaDoChat[];
  tela: null | string;
}): Promise<RespostaDoFesto> {
  const resposta = await fetch("/api/hub/festo/conversa", {
    body: JSON.stringify({ conversa, tela }),
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${await tokenDaSessao()}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });

  const payload = (await resposta.json().catch(() => null)) as null | {
    chamado?: RespostaDoFesto["chamado"];
    error?: unknown;
    texto?: unknown;
  };

  if (!resposta.ok) {
    throw new Error(
      typeof payload?.error === "string" && payload.error.trim()
        ? payload.error
        : "O Festos não respondeu agora.",
    );
  }

  if (typeof payload?.texto !== "string" || !payload.texto.trim()) {
    throw new Error("O Festos não respondeu agora.");
  }

  return {
    chamado: payload.chamado ?? null,
    texto: payload.texto.trim(),
  };
}

/**
 * ⚠️ O TOKEN VEM DA SESSÃO VIVA, e não de um valor guardado. O Supabase renova o access token a
 * cada hora; uma cópia lida uma vez e reusada durante a conversa começaria a devolver 401 no meio
 * do atendimento — e o Festos pareceria ter caído justamente nas conversas longas.
 */
export async function tokenDaSessao(): Promise<string> {
  const client = getHubSupabaseClient();

  if (!client) {
    return "local-hub-user";
  }

  const sessao = await client.auth.getSession();
  const token = sessao.data.session?.access_token;

  if (sessao.error || !token) {
    throw new Error("Sua sessão expirou. Recarregue a página para falar comigo.");
  }

  return token;
}
