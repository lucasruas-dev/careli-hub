import { type AtorDaTemis, nomeDoAutor, origemDoAtor } from "./ator";

// A AUTORIA DAS PEÇAS DO MODELO — quem gravou, e por QUAL PORTA.
//
// Decisão do Lucas (16/09/2026): a equipe da Cecílio *"também cria e edita os modelos"*. A partir
// daí a mesma minuta pode ter sido redigida pelo jurídico da Careli e ajustada pelo time do
// incorporador, e ela vale também para os contratos das vendas da Gurgel naquele produto. Um
// "Maria Souza" no `atualizado_por_nome` pode ser de qualquer um dos dois lados.
//
// ⚠️ A ORIGEM VAI NO NOME, como a frente do contrato decidiu para `enviado_por_nome` e afins
// (`autorDoAto`, em `contrato-servico.ts`): é o único lugar que todas as telas da Têmis já mostram,
// e o id do portal é um uuid de OUTRA tabela, indistinguível do de `hub_users` para quem lê. O
// formato é o mesmo, para a Careli ler "(portal do incorporador)" igual em todo canto.
//
// ⚠️ PUBLICAR, ARQUIVAR E DESATIVAR NÃO TINHAM AUTOR NENHUM, nem no hub. A migration 0173 cria as
// colunas de nome desses atos. Ela é ENRIQUECIMENTO, não trava: sem ela, as duas portas gravam como
// hoje (a segunda tentativa sai sem as colunas) e o ato do portal fica no log.

/** As colunas que a 0173 cria, por tabela. Só elas saem na segunda tentativa. */
export const COLUNAS_DA_0173 = {
  temis_anexos: ["desativado_por_nome"],
  temis_assinantes: ["desativado_por_nome"],
  temis_minutas: ["publicada_por_nome", "arquivada_por_nome"],
} as const;

/** O sufixo que diz "foi o portal". O mesmo texto de `autorDoAto` (contrato-servico.ts). */
export const SUFIXO_DO_PORTAL = " (portal do incorporador)";

/**
 * O nome do autor COM A ORIGEM, para as colunas `*_por_nome`.
 *
 * Hub: o nome que o chamador já resolveu (`nomeDoHub`), sem sufixo — exatamente o que a rota
 * gravava antes. Portal: o nome da sessão assinada mais o sufixo; sem nome, só a origem (não inventa
 * pessoa).
 */
export function nomeComOrigem(ator: AtorDaTemis, nomeDoHub?: null | string): null | string {
  if (ator.tipo === "hub") return nomeDoHub === undefined ? nomeDoAutor(ator) : nomeDoHub;
  const nome = nomeDoAutor(ator);
  return nome ? `${nome}${SUFIXO_DO_PORTAL}` : "Portal do incorporador";
}

/**
 * O erro do Supabase é "uma coluna da 0173 ainda não existe"?
 *
 * ⚠️ PELO NOME DA COLUNA NA MENSAGEM, e não só pelo código: `42703` e `PGRST204` dizem "coluna não
 * existe" para QUALQUER coluna. Engolir os dois sem olhar o nome faria um erro de digitação em
 * outra coluna virar, calado, uma gravação sem autor (a mesma cautela de `ehColunaDoDonoAusente`,
 * em `trabalhos-db.ts`).
 */
export function ehColunaDeAutoriaAusente(erro: unknown, colunas: readonly string[]): boolean {
  if (!erro || typeof erro !== "object") return false;
  const { code, message } = erro as { code?: unknown; message?: unknown };
  if (code !== "42703" && code !== "PGRST204") return false;
  const mensagem = typeof message === "string" ? message.toLowerCase() : "";
  return colunas.some((coluna) => mensagem.includes(coluna));
}

/**
 * Grava com as colunas da 0173 e, se elas ainda não existirem, grava de novo sem elas.
 *
 * `gravar(true)` monta a gravação COM as colunas novas; `gravar(false)`, sem elas. Qualquer outro
 * erro volta como veio, para a mensagem de sempre de quem chamou. A segunda tentativa só acontece
 * quando o PostgREST recusou a primeira inteira: não há gravação pela metade.
 */
export async function gravarComAutoria<R extends { error: unknown }>(
  colunas: readonly string[],
  gravar: (comAutoria: boolean) => PromiseLike<R>,
): Promise<R> {
  const primeira = await gravar(true);
  if (!primeira.error || !ehColunaDeAutoriaAusente(primeira.error, colunas)) return primeira;

  console.info("[temis][autoria] migration 0173 pendente: gravação sem o nome do ato");
  return gravar(false);
}

/**
 * Deixa no log o ato feito pelo portal. Do hub não sai nada novo.
 *
 * ⚠️ O LOG É A SEGUNDA TESTEMUNHA, E NÃO A PRIMEIRA. O nome já foi gravado na linha; o log guarda o
 * que a linha não tem coluna para guardar — de qual incorporador e com qual usuário do portal —, e
 * é a única testemunha de publicar e arquivar enquanto a 0173 não estiver no banco.
 */
export function registrarAtoDoPortal(
  ator: AtorDaTemis,
  ato: string,
  detalhes: Record<string, unknown>,
): void {
  if (ator.tipo !== "portal") return;
  console.info(`[temis][portal] ${ato}`, {
    ...detalhes,
    incorporadorId: ator.incorporadorId,
    origem: origemDoAtor(ator),
    slug: ator.slug,
    usuarioId: ator.usuarioId,
  });
}
