import type { SupabaseClient } from "@supabase/supabase-js";

import type { EstagioDoTrabalho } from "@/lib/temis/trabalhos";

import { VENDA_DESFEITA } from "./acao-de-cancelamento";
import { etapaDaVendaParaOCard, type ReflexoNaVenda } from "./reflexo-da-temis";

// A VENDA ANDA JUNTO COM O CARD — a escrita do reflexo, num lugar só.
//
// Lucas, 24/09/2026: *"preciso garantir que tudo que acontece na temis reflete no hercules"*. A
// tradução mora em `reflexo-da-temis.ts`; aqui mora o molde de escrita de
// `app/api/incorporador/venda/contrato/route.ts` (proposta → contrato): comparar-e-trocar na etapa
// lida, `etapa_desde` e `etapa_por` na mesma escrita, e a linha em `hercules_proposta_etapas` depois.
//
// ⚠️ QUEM CHAMA JÁ MOVEU O CARD E JÁ GRAVOU A PASSAGEM, e chama com o MESMO par de/para que foi para
// o histórico do card. A venda só anda se o card andou: o reflexo roda depois do `update` do card,
// nunca antes, nunca no lugar dele.
//
// ⚠️ NUNCA LANÇA, E FALHA AQUI NÃO DESFAZ O CARD. O card é o fato que já aconteceu (e, no envio, o
// envelope já está ativo na Clicksign). O que não deu certo volta como `recusado` com o porquê, vira
// log `[hercules][reflexo]` e, onde há resposta para a tela, `avisoDoHercules`.
//
// ⚠️ NUNCA ESCREVE `hercules_unidades`, `data_assinatura` NEM `data_faturamento`. Faturar não vira
// cadastro `vendida` (a retomada da conclusão de um distrato só solta `reservada`,
// concluir-cancelamento-server.ts, e `vendida` prenderia o lote num distrato futuro) e
// `data_faturamento` é a data PREVISTA do legado, que muda a classificação do cancelamento. As duas
// são decisão pendente do Lucas.

const WORKSPACE = "careli";

/** Um movimento do card, como ele foi para o histórico do card. */
export type PassoDoCard = {
  /** Quem moveu (o NOME, que é o que `etapa_por` e `autor_nome` guardam). Nulo = o webhook. */
  autorNome: null | string;
  de: string;
  /** A frase da linha do histórico da venda ("Envio para assinatura na Têmis"). */
  motivo: string;
  para: EstagioDoTrabalho;
  propostaId: null | string;
  trabalhoTipo: string;
};

/**
 * Leva a venda do card para a etapa que o movimento do card pede, se ela estiver numa das origens
 * aceitas. Ver a tabela em `etapaDaVendaParaOCard`.
 */
export async function refletirCardNaVenda(
  sb: SupabaseClient,
  passo: PassoDoCard,
): Promise<ReflexoNaVenda> {
  const traducao = etapaDaVendaParaOCard(passo.trabalhoTipo, passo.de, passo.para);
  const propostaId = String(passo.propostaId ?? "").trim();
  if (!traducao || !propostaId) return { feito: "nao_se_aplica" };

  try {
    const { data, error } = await sb
      .from("hercules_propostas")
      .select("id, etapa")
      .eq("workspace_id", WORKSPACE)
      .eq("id", propostaId)
      .maybeSingle<{ etapa: null | string; id: string }>();

    if (error || !data) {
      console.error(
        `[hercules][reflexo] não deu para ler a venda ${propostaId} depois de o card andar de ${passo.de} para ${passo.para}`,
        error ?? "venda não encontrada",
      );
      return { etapaLida: null, feito: "recusado", porque: "leitura_falhou" };
    }

    const etapaLida = String(data.etapa ?? "").trim();

    // ⚠️ VENDA MORTA NÃO RESSUSCITA. É o card de contrato assinado que fica pendurado em
    // Pré-faturamento ou Em assinatura depois de um distrato (concluir-cancelamento-server.ts): um
    // webhook atrasado ou uma marcação no card não podem pôr a venda distratada de volta no funil.
    if (VENDA_DESFEITA.has(etapaLida)) {
      return { etapaLida, feito: "recusado", porque: "venda_desfeita" };
    }

    if (etapaLida === traducao.destino) return { feito: "ja_estava" };

    // ⚠️ NUNCA PULA DUAS, E NUNCA EMPURRA A VENDA QUE VOLTOU A QUEM VENDEU. Venda em `proposta` com
    // card em assinatura é divergência (o indeferimento a devolveu, ou a carga a pôs lá): quem
    // decide é gente, e o log diz onde.
    if (!(traducao.origensAceitas as readonly string[]).includes(etapaLida)) {
      console.warn(
        `[hercules][reflexo] card de contrato andou de ${passo.de} para ${passo.para} e a venda ${propostaId} está em "${etapaLida}": ela só vai para "${traducao.destino}" a partir de ${traducao.origensAceitas.join(" ou ")}.${traducao.destino === "faturado" && etapaLida === "contrato" ? " Venda atrasada: o envio para assinatura não refletiu." : ""}`,
      );
      return { etapaLida, feito: "recusado", porque: "etapa_fora_da_origem" };
    }

    const agora = new Date().toISOString();
    const { data: movida, error: erroDaEscrita } = await sb
      .from("hercules_propostas")
      .update({
        atualizado_em: agora,
        etapa: traducao.destino,
        // ⚠️ O MAPA PINTA PELA PROPOSTA DE `etapa_desde` MAIS RECENTE, e o funil conta o passo por
        // ele. Mesma razão da rota de contrato.
        etapa_desde: agora,
        // ⚠️ QUEM MOVEU ANDA JUNTO COM A ETAPA, na mesma escrita. Webhook grava nulo, como a
        // passagem automática do card (estado-db.ts): nulo é "o sistema moveu sozinho".
        etapa_por: passo.autorNome ?? null,
      })
      .eq("id", propostaId)
      .eq("workspace_id", WORKSPACE)
      // ⚠️ COMPARAR-E-TROCAR COM A ETAPA LIDA: entre a leitura e aqui outra mão pode ter mexido na
      // venda (o conclusor do cancelamento, o indeferimento, a carga). Zero linhas = nada mais se
      // grava, nem o histórico.
      .eq("etapa", etapaLida)
      .select("id");

    if (erroDaEscrita) {
      console.error(`[hercules][reflexo] a venda ${propostaId} não acompanhou o card`, erroDaEscrita);
      return { etapaLida, feito: "recusado", porque: "escrita_falhou" };
    }
    if (!movida || movida.length === 0) {
      // ⚠️ ZERO LINHAS NÃO É FALHA QUANDO OUTRA MÃO LEVOU A VENDA EXATAMENTE AO DESTINO (revisão de
      // 24/09/2026). O webhook do assinado e o envio, ou dois cliques, podem levar a mesma venda à
      // mesma etapa ao mesmo tempo: o que este passo queria já é verdade, e o aviso "a venda mudou
      // enquanto o card andava" mandaria alguém conferir uma venda que está certa. A releitura decide;
      // se ela falhar, fica a recusa com a etapa da primeira leitura (o lado que avisa).
      const relida = await relerEtapa(sb, propostaId);
      if (relida === traducao.destino) return { feito: "ja_estava" };
      console.warn(
        `[hercules][reflexo] a venda ${propostaId} mudou entre a leitura e a escrita (estava em "${etapaLida}", agora "${relida ?? "não deu para reler"}"); o card andou de ${passo.de} para ${passo.para} e a venda não foi tocada.`,
      );
      return { etapaLida: relida ?? etapaLida, feito: "recusado", porque: "mudou_no_meio" };
    }

    // ⚠️ O HISTÓRICO VEM DEPOIS, E NÃO DERRUBA A ETAPA (a mesma regra de venda/contrato/route.ts). A
    // venda já andou; o que se perde é a linha, e isso vira log.
    const { error: erroDoHistorico } = await sb.from("hercules_proposta_etapas").insert({
      autor_nome: passo.autorNome ?? null,
      de: etapaLida,
      motivo: passo.motivo,
      para: traducao.destino,
      proposta_id: propostaId,
      quando: agora,
      workspace_id: WORKSPACE,
    });
    if (erroDoHistorico) {
      console.error(
        `[hercules][reflexo] a venda ${propostaId} andou de ${etapaLida} para ${traducao.destino}, mas a linha do histórico não foi gravada`,
        erroDoHistorico,
      );
    }

    return { de: etapaLida, feito: "andou", para: traducao.destino };
  } catch (erro) {
    console.error(`[hercules][reflexo] falha inesperada ao refletir o card na venda ${propostaId}`, erro);
    return { etapaLida: null, feito: "recusado", porque: "leitura_falhou" };
  }
}

/** A etapa da venda, relida depois de um comparar-e-trocar que não casou. `null` = a releitura falhou. */
async function relerEtapa(sb: SupabaseClient, propostaId: string): Promise<null | string> {
  const { data, error } = await sb
    .from("hercules_propostas")
    .select("etapa")
    .eq("workspace_id", WORKSPACE)
    .eq("id", propostaId)
    .maybeSingle<{ etapa: null | string }>();
  if (error || !data) return null;
  return String(data.etapa ?? "").trim();
}

/**
 * O log de quem chama quando a venda não acompanhou. Um formato só, para a busca nos logs da Vercel
 * achar todos os lugares com a mesma frase.
 */
export function registrarReflexoQueNaoAndou(
  trabalhoId: string,
  passo: Pick<PassoDoCard, "de" | "para" | "propostaId">,
  reflexo: ReflexoNaVenda,
): void {
  if (reflexo.feito !== "recusado") return;
  console.error(
    `[hercules][reflexo] card ${trabalhoId} andou de ${passo.de} para ${passo.para} e a venda ${passo.propostaId ?? "(sem venda)"} não acompanhou: ${reflexo.porque}`,
  );
}

/** O motivo gravado no histórico da venda, por destino do card. */
export function motivoDoReflexo(de: string, para: EstagioDoTrabalho): string {
  if (para === "assinatura") return "Envio para assinatura na Têmis";
  if (para === "analise") return "Contrato voltou para correção na Têmis";
  if (para === "faturado") return "Contrato faturado na Têmis";
  if (para === "prazo_legal") return "Contrato assinado por todos na Têmis";
  return `Card de contrato andou de ${de} para ${para} na Têmis`;
}
