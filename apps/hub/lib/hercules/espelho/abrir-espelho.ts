// ABRIR O ESPELHO DE UM TOKEN — a porta única das rotas públicas.
//
// As três rotas públicas (arte, geometria, situação) e a própria página começam iguais: validar o
// token, achar o empreendimento e descobrir se ele tem masterplan publicado. Isso mora aqui para
// as quatro nunca discordarem sobre o que um token significa.
//
// ⚠️ FAIL-CLOSED. Token inválido, empreendimento apagado, Supabase fora do ar: tudo devolve
// `null` e a rota responde 401/503. Nada aqui devolve "o primeiro empreendimento" nem cai num
// padrão — um espelho que abre o loteamento errado é pior do que um espelho que não abre.
import type { SupabaseClient } from "@supabase/supabase-js";

import { createApoloAdminClient } from "@/lib/apolo/server";
import { validarTokenDoEspelho } from "@/lib/hercules/link-do-espelho";
import { topoDaArvore } from "@/lib/hercules/masterplan-do-empreendimento";

export type EspelhoAberto = {
  /** O client de servidor, para quem for ler mais coisa. */
  client: SupabaseClient;
  codigo: string;
  /** Os `c2x_enterprise_id` dos filhos — onde a venda acontece. */
  filhosC2xIds: string[];
  /** `null` quando não há masterplan publicado: a página abre direto na GRADE. */
  masterplan: null | { versao: number };
  nome: string;
  /** O `c2x_enterprise_id` do topo. `null` em pai sem id do C2X. */
  paiC2xId: null | string;
};

/**
 * Resolve o token num espelho, ou devolve o motivo.
 *
 * O motivo é para o LOG e para o código HTTP — nunca para a tela do visitante, que recebe sempre
 * a mesma frase. Distinguir "token inválido" de "empreendimento não existe" na resposta
 * transformaria a rota num oráculo: dá para varrer códigos e descobrir o que a Careli vende.
 */
export async function abrirEspelho(
  token: null | string,
): Promise<
  | { erro: "indisponivel" | "sem_token"; ok: false }
  | { espelho: EspelhoAberto; ok: true }
> {
  const codigo = validarTokenDoEspelho(token);
  if (!codigo) return { erro: "sem_token", ok: false };

  const client = createApoloAdminClient();
  if (!client) return { erro: "indisponivel", ok: false };

  const topo = await topoDaArvore(client, codigo);
  if (!topo) return { erro: "indisponivel", ok: false };

  // A versão publicada. Sem ela não há arte nem geometria — mas a grade continua funcionando,
  // então isto NÃO é erro: é `masterplan: null`.
  const { data } = await client
    .from("hercules_masterplans")
    .select("versao")
    .eq("empreendimento_id", topo.id)
    .not("publicado_em", "is", null)
    .maybeSingle<{ versao: number }>();

  return {
    espelho: {
      client,
      codigo: topo.codigo,
      filhosC2xIds: topo.filhosC2xIds,
      masterplan: data ? { versao: data.versao } : null,
      nome: topo.nome,
      paiC2xId: topo.c2xEnterpriseId,
    },
    ok: true,
  };
}

/** A única frase que o visitante vê quando algo falha. Igual para todos os motivos. */
export const ERRO_GENERICO = "Link inválido ou indisponível.";
