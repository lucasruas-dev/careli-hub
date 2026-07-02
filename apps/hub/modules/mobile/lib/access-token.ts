import { getHubSupabaseClient } from "@/lib/supabase/client";

/**
 * Bearer da sessao Supabase para chamar as rotas /api protegidas pelo gate do
 * proxy.ts. Mesmo caminho que o IrisPage (getIrisAccessToken) usa no desktop —
 * reaproveitado aqui para nao duplicar a regra de sessao.
 */
export async function getMobileAccessToken(): Promise<string> {
  const client = getHubSupabaseClient();

  if (!client) {
    throw new Error("Conexao do Supabase indisponivel.");
  }

  const { data, error } = await client.auth.getSession();
  const accessToken = data.session?.access_token;

  if (error || !accessToken) {
    throw new Error("Sessao ausente.");
  }

  return accessToken;
}
