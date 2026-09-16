import { createHash } from "node:crypto";

import type { createApoloAdminClient } from "@/lib/apolo/server";
import { type Balde, consumir } from "@/lib/publico/cad/rate-limit";

// O TETO DE USO DAS TORNEIRAS PAGAS QUE O PORTAL ABRIU PARA GENTE DE FORA.
//
// Revisão da onda 3 (16/09/2026): o portal da Cecílio ganhou a MOST (leitura de documento a ~R$ 0,50
// por imagem e enriquecimento de pessoa a ~R$ 1,60 por consulta) e o agente da minuta (modelo de
// fronteira com até 120 mil caracteres por pedido), todos pagos pela Careli. O link público já tinha
// teto por IP (`lib/publico/cad/rate-limit.ts`); o portal não tinha nada, e uma conta (ou um cookie
// vazado) repetindo a chamada em laço virava fatura sem limite.
//
// ⚠️ O MESMO CONTADOR DO PÚBLICO, COM OUTRA CHAVE. Reaproveita `consumir` e a tabela
// `publico_rate_limit` (janela fixa, sem histórico de acesso) em vez de inventar um segundo
// mecanismo. A chave é o USUÁRIO DO PORTAL, e não o IP: o time inteiro da Cecílio pode trabalhar no
// mesmo Wi-Fi, e o que se quer segurar é a conta. O prefixo `portal-incorporador:` garante que ela
// nunca coincide com a chave de um IP do público.
//
// ⚠️ OS TETOS SÃO OS DO PÚBLICO, que foram calibrados com o trabalho real de um escritório inteiro
// (ver REGRAS em rate-limit.ts): 400 leituras por dia, 60 consultas pagas por dia e 40 conversas com
// o agente por hora, agora por PESSOA. Tabela ausente ou leitura que falhou deixa passar, como lá: o
// teto é defesa contra laço, não porteiro.

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

/** As torneiras do portal e o balde (a regra de janela e teto) de cada uma. */
export type TorneiraDoPortal = "agente-da-minuta" | "consulta-paga" | "leitura-de-documento";

const BALDE_DA_TORNEIRA: Record<TorneiraDoPortal, Balde> = {
  "agente-da-minuta": "assistente",
  "consulta-paga": "creci",
  "leitura-de-documento": "ocr",
};

/** A frase do 429. Diz o que fazer, não o número do teto. */
export const MENSAGEM_DO_TETO_DO_PORTAL =
  "Muitas consultas seguidas por esta conta. Aguarde e tente de novo mais tarde, ou fale com a Careli.";

/**
 * Quantas pessoas cheias o PORTAL inteiro soma por torneira (o teto da conta vezes este número).
 *
 * (16/09/2026, revisão do conjunto) O teto era só por usuário: um portal com dez contas (ou dez
 * cookies) somava dez tetos. O teto do portal fecha isso sem apertar quem trabalha: três pessoas
 * cheias por dia no mesmo portal é mais que o time da Cecílio faz hoje, e o que passar disso é laço.
 */
export const PESSOAS_CHEIAS_POR_PORTAL = 3;

/** A chave do contador do PORTAL (todas as contas dele), com prefixo próprio e em hash. */
export function chaveDoPortal(ator: { incorporadorId: string }): string {
  return createHash("sha256").update(`portal-incorporador:portal:${ator.incorporadorId}`).digest("hex");
}

/** A chave do contador: o usuário do portal, com prefixo próprio e em hash. */
export function chaveDoUsuarioDoPortal(ator: { incorporadorId: string; usuarioId: string }): string {
  return createHash("sha256")
    .update(`portal-incorporador:${ator.incorporadorId}:${ator.usuarioId}`)
    .digest("hex");
}

/**
 * Conta UMA chamada da torneira e diz se ela ainda cabe no teto. Sem cliente do banco, ou com o
 * contador fora do ar, não há como contar, e aí deixa passar (a mesma escolha de `consumir`): o
 * teto segura laço, e o time trabalhando não pode ficar refém do contador.
 */
export async function cabeNoTetoDoPortal(
  adminClient: AdminClient | null,
  ator: { incorporadorId: string; usuarioId: string },
  torneira: TorneiraDoPortal,
): Promise<boolean> {
  if (!adminClient) return true;
  try {
    const balde = BALDE_DA_TORNEIRA[torneira];
    const daConta = await consumir(adminClient, balde, chaveDoUsuarioDoPortal(ator));
    if (!daConta.permitido) return false;
    // O teto do portal inteiro (ver `PESSOAS_CHEIAS_POR_PORTAL`), na mesma janela do balde.
    const doPortal = await consumir(adminClient, balde, chaveDoPortal(ator), {
      teto: daConta.teto * PESSOAS_CHEIAS_POR_PORTAL,
    });
    return doPortal.permitido;
  } catch (erro) {
    console.warn("[portal][teto] contador indisponível, chamada liberada", {
      erro: (erro as Error).message,
      torneira,
    });
    return true;
  }
}
