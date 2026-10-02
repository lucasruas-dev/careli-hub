// DE ONDE É O CARD DA TÊMIS: o empreendimento (o pai, e o filho quando houver) e a categoria da unidade.
//
// Lucas (02/10/2026), olhando no quadro o card "Vale do Ouro · VOL · Quadra 03 · Lote 07": *"uma
// correção, quando tiver filho ou categoria, trazer aqui para gente saber de onde especificamente é"*,
// e logo depois: *"já veio o filho"*. O filho já aparecia, mas por sorte: vinha do `enterprise_nome`
// gravado na abertura do card, e 5 cards do Vale do Ouro (2 VOC, 2 VOL, 1 VOR, medido em 02/10/2026)
// foram gravados só "Vale do Ouro". A categoria não aparecia em lugar nenhum.
//
// A REGRA DA CASA ([[feedback_pai_e_a_fonte_unidade_unica]], não perguntar de novo): o PAI na frente,
// depois o filho e a categoria, quando houver. "Unidade interna/externa" NÃO é categoria e não mora
// em `temis_categorias`, então não chega aqui.
//
// ⚠️ NADA AQUI DERRUBA O QUADRO, e nada aqui grava. Toda falha de leitura vira log e o card sai como
// saía antes desta correção: o nome gravado e nenhuma categoria. Um quadro em branco por causa de um
// rótulo seria uma troca ruim (a mesma lição de `contratosDasPropostas`).
import type { SupabaseClient } from "@supabase/supabase-js";

import { carregarCadastroDeEmpreendimentos, type LinhaDoCadastro } from "@/lib/hercules/cadastro";

/** O que o card já sabe, lido de `temis_trabalhos`. */
export type CardParaOrigem = {
  /** `enterprise_codigo`: a sigla gravada na abertura (VOL, LBF, ACP). */
  codigo: string;
  /** `enterprise_id`: o id do C2X gravado na abertura ("36"). */
  enterpriseId: string;
  id: string;
  /** `enterprise_nome`, como foi gravado na abertura. É a reserva quando o cadastro não responde. */
  nomeGravado: string;
  propostaId: null | string;
};

export type OrigemDoCard = {
  /** O nome da categoria da unidade (`temis_categorias.nome`). `null` = a unidade não tem. */
  categoria: null | string;
  /** "Vale do Ouro · VOL" no filho; "Garden" no empreendimento sem filho. */
  nome: string;
};

/** Só o que a régua do nome precisa de cada linha do cadastro. */
export type LinhaDoProdutoNoCard = Pick<
  LinhaDoCadastro,
  "c2xEnterpriseId" | "codigo" | "id" | "nome" | "paiId"
>;

type ClienteDoBanco = Pick<SupabaseClient, "from">;

// O separador que o cadastro já usa entre o pai e o filho ("Vale do Ouro · VOL").
const SEPARADOR = " · ";

/** ⚠️ LOTE DE 100 no `.in()`: a URL do PostgREST estoura com lista grande (700 ids deram 400). */
const LOTE = 100;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : valor == null ? "" : String(valor).trim();
}

/**
 * O nome do empreendimento do card, PURO.
 *
 * ⚠️ ACHA A LINHA PELA SIGLA DO CARD, e pelo id do C2X quando a sigla não acha. A sigla é a que o
 * card gravou e é ela que diz o FILHO (`hercules_unidades.segmento_id` está nulo nesses lotes, medido
 * em 02/10/2026). O id cobre a sigla trocada no cadastro depois da abertura (o Panteon manda na sigla
 * desde o PAN-124); nos 36 cards de 02/10/2026 os dois casam com a mesma linha.
 *
 * ⚠️ FILHO = NOME DO PAI + SIGLA DO FILHO, montado aqui, e não o `nome` gravado na linha do filho.
 * Hoje dá no mesmo ("Vale do Ouro · VOL" nos dois), mas o pai é a fonte: renomeado o pai, o card
 * acompanha sem depender de alguém lembrar de renomear cada filho.
 *
 * Não achou no cadastro (ou o cadastro não veio): o nome gravado no card, como antes.
 */
export function nomeDoEmpreendimentoDoCard(
  card: Pick<CardParaOrigem, "codigo" | "enterpriseId" | "nomeGravado">,
  cadastro: readonly LinhaDoProdutoNoCard[],
): string {
  const sigla = texto(card.codigo).toUpperCase();
  const id = texto(card.enterpriseId);

  const linha =
    (sigla ? cadastro.find((l) => texto(l.codigo).toUpperCase() === sigla) : undefined) ??
    (id ? cadastro.find((l) => texto(l.c2xEnterpriseId) === id) : undefined);

  if (!linha) return card.nomeGravado;

  const paiId = texto(linha.paiId);
  if (!paiId) return texto(linha.nome) || card.nomeGravado;

  const nomeDoPai = texto(cadastro.find((l) => l.id === paiId)?.nome);
  const siglaDoFilho = texto(linha.codigo).toUpperCase();
  if (nomeDoPai && siglaDoFilho) return `${nomeDoPai}${SEPARADOR}${siglaDoFilho}`;

  // Filho cujo pai não veio na leitura: o nome da própria linha, que já traz o pai na frente.
  return texto(linha.nome) || card.nomeGravado;
}

/** A origem de UM card, PURA: o nome pela régua acima e a categoria pela proposta. */
export function origemDoCard(
  card: CardParaOrigem,
  fontes: {
    cadastro: readonly LinhaDoProdutoNoCard[];
    categoriaPorProposta: ReadonlyMap<string, string>;
  },
): OrigemDoCard {
  const propostaId = texto(card.propostaId);
  const categoria = propostaId ? texto(fontes.categoriaPorProposta.get(propostaId)) : "";
  return {
    categoria: categoria || null,
    nome: nomeDoEmpreendimentoDoCard(card, fontes.cadastro),
  };
}

/**
 * A origem de todos os cards do quadro, por id do card.
 *
 * ⚠️ POUCAS CONSULTAS PARA O QUADRO INTEIRO, NUNCA UMA POR CARD. O quadro recarrega sozinho a cada
 * minuto por aba aberta. São: o cadastro de empreendimentos (uma leitura, ~40 linhas), e a cadeia da
 * categoria em lote: propostas, unidades e, só quando alguma unidade tem categoria, as categorias.
 *
 * ⚠️ NUNCA LANÇA. Qualquer falha vira `console.error` e o card sai com o nome gravado e sem categoria.
 */
export async function origemDosCards(
  sb: ClienteDoBanco,
  cards: readonly CardParaOrigem[],
): Promise<Map<string, OrigemDoCard>> {
  const porCard = new Map<string, OrigemDoCard>();
  if (cards.length === 0) return porCard;

  try {
    const propostaIds = cards.map((c) => texto(c.propostaId)).filter(Boolean);
    const [cadastro, categoriaPorProposta] = await Promise.all([
      cadastroParaOCard(),
      categoriasDasPropostas(sb, propostaIds),
    ]);

    for (const card of cards) {
      porCard.set(card.id, origemDoCard(card, { cadastro, categoriaPorProposta }));
    }
  } catch (erro) {
    console.error("[temis][origem] falha ao montar a origem dos cards; saem como gravados", erro);
    porCard.clear();
  }

  return porCard;
}

/** O cadastro inteiro (pais e filhos). Falhou: lista vazia, e o card fica com o nome gravado. */
async function cadastroParaOCard(): Promise<LinhaDoProdutoNoCard[]> {
  try {
    return await carregarCadastroDeEmpreendimentos();
  } catch (erro) {
    console.error("[temis][origem] falha ao ler o cadastro de empreendimentos", erro);
    return [];
  }
}

/**
 * O nome da categoria da unidade de cada proposta: `hercules_propostas.unidade_id` →
 * `hercules_unidades.categoria_id` → `temis_categorias.nome`.
 *
 * ⚠️ A CATEGORIA É A DA UNIDADE DA PROPOSTA, a mesma que a cadeia do contrato usa para escolher a
 * minuta (`categoriaId` em `PontosDePartida`, ./cadeia-do-contrato). O card não pode dizer uma
 * categoria e o contrato sair pela minuta de outra.
 *
 * ⚠️ AS TRÊS LEITURAS SÃO POR CHAVE PRIMÁRIA, uma linha por id: um lote de 100 ids devolve no máximo
 * 100 linhas, longe do teto de 1.000 do PostgREST. Lote que falha vira log e os cards dele saem sem
 * categoria; os outros lotes seguem.
 */
async function categoriasDasPropostas(
  sb: ClienteDoBanco,
  propostaIds: readonly string[],
): Promise<Map<string, string>> {
  const porProposta = new Map<string, string>();

  const propostas = await lerPorIds<{ id: string; unidade_id: null | string }>(
    sb,
    "hercules_propostas",
    "id, unidade_id",
    propostaIds,
  );
  const unidadeDaProposta = new Map<string, string>();
  for (const p of propostas) {
    const unidadeId = texto(p.unidade_id);
    if (unidadeId) unidadeDaProposta.set(texto(p.id), unidadeId);
  }
  if (unidadeDaProposta.size === 0) return porProposta;

  const unidades = await lerPorIds<{ categoria_id: null | string; id: string }>(
    sb,
    "hercules_unidades",
    "id, categoria_id",
    [...unidadeDaProposta.values()],
  );
  const categoriaDaUnidade = new Map<string, string>();
  for (const u of unidades) {
    const categoriaId = texto(u.categoria_id);
    if (categoriaId) categoriaDaUnidade.set(texto(u.id), categoriaId);
  }
  // ⚠️ O CASO DE QUASE TODO DIA: nenhuma unidade do quadro tem categoria (só o Lagoa Bonita tem), e a
  // terceira consulta nem sai.
  if (categoriaDaUnidade.size === 0) return porProposta;

  const categorias = await lerPorIds<{ id: string; nome: null | string }>(
    sb,
    "temis_categorias",
    "id, nome",
    [...categoriaDaUnidade.values()],
  );
  const nomeDaCategoria = new Map<string, string>();
  for (const c of categorias) {
    const nome = texto(c.nome);
    if (nome) nomeDaCategoria.set(texto(c.id), nome);
  }

  for (const [propostaId, unidadeId] of unidadeDaProposta) {
    const categoriaId = categoriaDaUnidade.get(unidadeId);
    const nome = categoriaId ? nomeDaCategoria.get(categoriaId) : undefined;
    if (nome) porProposta.set(propostaId, nome);
  }

  return porProposta;
}

/** Lê as linhas de uma tabela pelos ids, em lotes de 100. Lote que falha: log, e segue sem ele. */
async function lerPorIds<T>(
  sb: ClienteDoBanco,
  tabela: string,
  colunas: string,
  ids: readonly string[],
): Promise<T[]> {
  const unicos = [...new Set(ids.map(texto).filter(Boolean))];
  const linhas: T[] = [];

  for (let i = 0; i < unicos.length; i += LOTE) {
    const lote = unicos.slice(i, i + LOTE);
    try {
      const { data, error } = await sb.from(tabela).select(colunas).in("id", lote);
      if (error) {
        console.error(`[temis][origem] falha ao ler ${tabela} para a categoria do card`, error);
        continue;
      }
      linhas.push(...((data ?? []) as unknown as T[]));
    } catch (erro) {
      // O supabase-js devolve o erro em vez de lançar, mas uma rede que cai no meio não pode levar
      // junto o nome do empreendimento, que já veio de outra leitura.
      console.error(`[temis][origem] falha ao ler ${tabela} para a categoria do card`, erro);
    }
  }

  return linhas;
}
