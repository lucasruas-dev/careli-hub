// O TOPO DA ÁRVORE — dado um empreendimento, quem responde por ele no espelho público.
//
// ⚠️ QUEM RESPONDE É SEMPRE O PAI. Abrir o espelho de VOC, VOL, VOR, LBF, LBP ou LBR significa
// abrir o loteamento inteiro, porque o loteamento É um só: o desenho do masterplan é do pai, e
// para quem está de fora não existe divisão interna
// ([[feedback_corretor_nao_ve_divisao_interna]]) — o cliente vê "Vale do Ouro", não "a carteira
// VOC do Vale do Ouro".
//
// ⚠️ E O TOPO RESPONDE TENDO MAPA OU NÃO. Lucas (10/09/2026): *"os que não tiverem espelho vão
// ter a grade"*. Medido no banco no mesmo dia: 8 dos 37 empreendimentos têm masterplan publicado
// em `hercules_masterplans`. Os outros 29 continuam com link público — ele abre na grade. Por
// isso `temMapa` é um CAMPO da resposta, e não a condição para haver resposta.
//
// Sobe UM nível só, e de propósito: `hercules_empreendimentos.pai_id` é usado com um nível de
// profundidade em todo o repo (`arvoreDeEmpreendimentos` monta pai → visões, sem neto), e uma
// subida recursiva aqui inventaria uma hierarquia que a tabela não tem.
import type { SupabaseClient } from "@supabase/supabase-js";

export type TopoDaArvore = {
  /** `hercules_empreendimentos.c2x_enterprise_id` do topo. `null` em pai sem id do C2X (LOX). */
  c2xEnterpriseId: null | string;
  codigo: string;
  /** `true` quando o topo é o PAI do empreendimento pedido, e não ele mesmo. A tela avisa. */
  doPai: boolean;
  /** Os `c2x_enterprise_id` dos filhos — onde a venda acontece. Vazio quando não há filho. */
  filhosC2xIds: string[];
  /** `hercules_empreendimentos.id` do topo. */
  id: string;
  nome: string;
  /** Há masterplan publicado? `false` faz a página abrir direto na grade. */
  temMapa: boolean;
};

type LinhaEmpreendimento = {
  c2x_enterprise_id: null | string;
  codigo: string;
  id: string;
  nome: string;
  pai_id: null | string;
};

const COLUNAS = "c2x_enterprise_id, codigo, id, nome, pai_id";

/**
 * O topo da árvore de um empreendimento, pelo CÓDIGO do cadastro do Panteon.
 *
 * `null` só quando o código não existe no cadastro.
 */
export async function topoDaArvore(
  client: SupabaseClient,
  codigo: string,
): Promise<null | TopoDaArvore> {
  const alvo = codigo.trim().toUpperCase();
  if (!alvo) return null;

  const { data: proprio } = await client
    .from("hercules_empreendimentos")
    .select(COLUNAS)
    .eq("codigo", alvo)
    .maybeSingle<LinhaEmpreendimento>();

  if (!proprio) return null;

  let topo = proprio;
  let doPai = false;

  if (proprio.pai_id) {
    const { data: pai } = await client
      .from("hercules_empreendimentos")
      .select(COLUNAS)
      .eq("id", proprio.pai_id)
      .maybeSingle<LinhaEmpreendimento>();
    if (pai) {
      topo = pai;
      doPai = true;
    }
  }

  const [temMapa, filhosC2xIds] = await Promise.all([
    temMapaPublicado(client, topo.id),
    filhosDoTopo(client, topo.id),
  ]);

  return {
    c2xEnterpriseId: topo.c2x_enterprise_id,
    codigo: topo.codigo,
    doPai,
    filhosC2xIds,
    id: topo.id,
    nome: topo.nome,
    temMapa,
  };
}

/**
 * O primeiro topo resolvido entre vários códigos.
 *
 * A ficha do Apolo trabalha com `row.codes` — um código na linha simples, VÁRIOS no produto
 * consolidado (o Lagoa Bonita chega como ["LBF","LBP","LBR"]). Todos os filhos do mesmo pai levam
 * ao MESMO topo, então o primeiro que resolver responde pelos outros.
 */
export async function topoDaArvoreDeAlgum(
  client: SupabaseClient,
  codigos: readonly string[],
): Promise<null | TopoDaArvore> {
  for (const codigo of codigos) {
    const topo = await topoDaArvore(client, codigo);
    if (topo) return topo;
  }
  return null;
}

async function temMapaPublicado(
  client: SupabaseClient,
  empreendimentoId: string,
): Promise<boolean> {
  const { data } = await client
    .from("hercules_masterplans")
    .select("id")
    .eq("empreendimento_id", empreendimentoId)
    // O índice único `hercules_masterplans_uma_publicada` garante no máximo uma publicada por
    // empreendimento — mas o filtro tem de estar aqui, porque versões antigas ficam na tabela.
    .not("publicado_em", "is", null)
    .maybeSingle<{ id: string }>();

  return Boolean(data);
}

/**
 * Os `c2x_enterprise_id` dos filhos.
 *
 * ⚠️ É ONDE A VENDA ACONTECE. O cadastro do pai pode estar parado — no Vale do Ouro ele dá como
 * `vendida` 4 lotes que os filhos têm como disponíveis
 * ([[reference_hercules_unidades_e_um_retrato_parado]]). Quem lê o estado precisa dos dois
 * conjuntos para aplicar a régua "o filho decide, o pai completa".
 */
async function filhosDoTopo(
  client: SupabaseClient,
  paiId: string,
): Promise<string[]> {
  const { data } = await client
    .from("hercules_empreendimentos")
    .select("c2x_enterprise_id")
    .eq("pai_id", paiId);

  return ((data ?? []) as { c2x_enterprise_id: null | string }[])
    .map((f) => f.c2x_enterprise_id)
    .filter((id): id is string => Boolean(id));
}
