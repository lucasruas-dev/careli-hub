import type { SupabaseClient } from "@supabase/supabase-js";

import { lerRegraDeOrdem, ORDEM_PADRAO, type RegraDeOrdem } from "./ordem";

// A REGRA DE ORDEM, LIDA DO CADASTRO — a cadeia da 0142, num lugar só.
//
//     unidade → categoria → regra de ordem            o recorte que assina diferente
//              ↘ sem regra → o empreendimento         o caso de todo dia
//              ↘ sem nada  → o padrão da casa         (todos ao mesmo tempo)
//
// ⚠️ "SEM REGRA" NÃO É `ordenada = false`, E ESTA É A ARMADILHA DESTA LEITURA. As duas colunas
// nascem com o default — `assinatura_ordenada` em `false` e `assinatura_ordem` em `null` — e uma
// categoria recém-criada é indistinguível de uma categoria onde alguém decidiu "todos ao mesmo
// tempo". Se a categoria vencesse pelo simples fato de existir, criar uma categoria APAGARIA em
// silêncio a ordem configurada no empreendimento: os contratos daquele recorte voltariam ao
// paralelo sem ninguém ter pedido, e o sintoma seria a vendedora recebendo o convite junto com o
// comprador.
//
// Por isso a categoria só ganha quando ela tem ALGUMA COISA gravada: a ordem ligada, ou uma lista de
// papéis. É o mesmo que "nulo = não cadastrado" que a política comercial já pratica nas colunas de
// percentual.
//
// ⚠️ E NÃO SE SOBE PARA A CATEGORIA PAI. `temis_categorias.categoria_pai_id` existe (0139), mas
// herdar por ele é comportamento não medido: são DUAS categorias na base inteira (medido em
// 08/09/2026) e nenhuma delas tem ordem cadastrada. Inventar a herança agora seria escrever a regra
// mais complicada antes de existir o primeiro caso que a justifique — e o dia em que ele existir, é
// aqui que ela entra, com o caso na mão.

export type OrigemDaRegra = "categoria" | "empreendimento" | "padrao";

export type RegraDeOrdemLida = {
  origem: OrigemDaRegra;
  regra: RegraDeOrdem;
};

type LinhaComOrdem = {
  assinatura_ordem: unknown;
  assinatura_ordenada: boolean | null;
};

/** A regra tem alguma coisa gravada, ou é só o default do banco? Ver a nota do topo. */
function foiCadastrada(linha: LinhaComOrdem | null): boolean {
  if (!linha) return false;
  return linha.assinatura_ordenada === true || linha.assinatura_ordem != null;
}

function daLinha(linha: LinhaComOrdem): RegraDeOrdem {
  return lerRegraDeOrdem({
    ordenada: linha.assinatura_ordenada === true,
    papeis: linha.assinatura_ordem,
  });
}

/**
 * A regra que vale para esta venda.
 *
 * ⚠️ FALHA DE LEITURA CAI NO PADRÃO, E NÃO DERRUBA O ENVIO. Um timeout do PostgREST na consulta da
 * categoria não pode impedir um contrato de ir para assinatura — mas também não pode INVENTAR uma
 * ordem. O padrão da casa é "todos ao mesmo tempo", que é o comportamento que 18 de 18
 * empreendimentos têm hoje (medido em 08/09/2026: zero com `assinatura_ordenada`), e a tela mostra
 * a origem antes de o operador confirmar — quem esperava ordem vê "padrão" e para.
 */
export async function regraDeOrdemDaVenda(
  sb: SupabaseClient,
  alvo: { enterpriseId?: null | string; unidadeId?: null | string },
): Promise<RegraDeOrdemLida> {
  let enterpriseId = (alvo.enterpriseId ?? "").trim();
  let categoriaId = "";

  if (alvo.unidadeId) {
    const { data, error } = await sb
      .from("hercules_unidades")
      .select("categoria_id, enterprise_id")
      .eq("id", alvo.unidadeId)
      .maybeSingle();

    if (error) {
      console.error("[assinatura][ordem] falha ao ler a unidade", error);
    } else {
      const linha = data as null | { categoria_id: null | string; enterprise_id: null | string };
      categoriaId = (linha?.categoria_id ?? "").trim();
      // ⚠️ O `enterprise_id` DA UNIDADE É O SEGUNDO CAMINHO, e ele salva os empreendimentos cujo
      // `c2x_enterprise_id` é nulo (LOX, PDX e RDX) — os mesmos que fariam a busca da minuta ir com
      // string vazia. Só entra quando quem chamou não soube dizer.
      if (!enterpriseId) enterpriseId = (linha?.enterprise_id ?? "").trim();
    }
  }

  if (categoriaId) {
    const { data, error } = await sb
      .from("temis_categorias")
      .select("assinatura_ordenada, assinatura_ordem")
      .eq("id", categoriaId)
      .maybeSingle();

    if (error) console.error("[assinatura][ordem] falha ao ler a categoria", error);

    const linha = (data as LinhaComOrdem | null) ?? null;
    if (foiCadastrada(linha) && linha) {
      return { origem: "categoria", regra: daLinha(linha) };
    }
  }

  if (enterpriseId) {
    const { data, error } = await sb
      .from("apolo_enterprise_settings")
      .select("assinatura_ordenada, assinatura_ordem")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle();

    if (error) console.error("[assinatura][ordem] falha ao ler o empreendimento", error);

    const linha = (data as LinhaComOrdem | null) ?? null;
    if (foiCadastrada(linha) && linha) {
      return { origem: "empreendimento", regra: daLinha(linha) };
    }
  }

  return { origem: "padrao", regra: ORDEM_PADRAO };
}

/** A origem em uma linha, para a tela dizer de onde a ordem veio. */
export function descreverOrigem(origem: OrigemDaRegra): string {
  const mapa: Record<OrigemDaRegra, string> = {
    categoria: "da categoria da unidade",
    empreendimento: "do Setup do empreendimento",
    padrao: "do padrão da casa (nada cadastrado)",
  };
  return mapa[origem];
}
