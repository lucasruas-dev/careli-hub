// VARREDURA DA PRÉ-VENDA DESLIGADA — a regra nova alcançando o passado.
//
// Contexto (Lucas, 10/08): "cliente caindo de novo em pré-venda, pré-venda só existe se estiver
// habilitado". O guard que impede uma ficha de ENTRAR em `prevenda` com a cobrança desligada mora
// em `atualizarEtapa` e nasceu em 04/08 — ele vale do dia em que foi escrito para a frente. Quem já
// estava lá continuou lá, e a coluna Pré-venda seguiu cheia num empreendimento que não cobra nada.
// A limpeza teve que ser feita na mão, por SQL, DUAS vezes (146 CADs em 09/08). É o padrão que já
// se repetiu neste projeto: mudou a regra, alguém precisa varrer o resíduo.
//
// Aqui a varredura vira comportamento do produto: desligou a pré-venda de um empreendimento, as
// CADs que estavam nela saem no mesmo ato.
//
// PARA ONDE VAI CADA UMA:
//   • motivo de CRÉDITO REPROVADO na linha -> `revisao`. Essa ficha nunca deveria ter avançado (foi
//     o clique manual antigo, "Aprovar crédito (coordenador)", que empurrava reprovado direto para
//     a cobrança). Devolvê-la para revisão a coloca na fila da coordenação, que é o lugar dela.
//   • qualquer outra                        -> `credenciado`. Crédito aprovado, sem cobrança para
//     fazer: o fluxo segue.
//
// ⚠️ ESCRITA EM LOTE, DE PROPÓSITO. O caminho normal (`atualizarEtapa`, uma ficha por vez) subiria
// cada credenciado para o C2X e regeneraria a CAD — centenas de chamadas externas dentro do clique
// de um toggle, que estouraria o tempo da função. Aqui a etapa é corrigida em bloco e o envio ao
// C2X segue pelo caminho de sempre: o Board acende o alerta de "credenciado que nunca subiu".

import type { createApoloAdminClient } from "@/lib/apolo/server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

type LinhaPrevenda = { entity_id: string; motivo: null | string };

export const MOTIVO_VARREDURA =
  "Pré-venda desligada no empreendimento: seguiu sem a cobrança PIX.";

export const MOTIVO_VARREDURA_REVISAO =
  "Pré-venda desligada no empreendimento; ficha devolvida à revisão porque o crédito está reprovado.";

const ehUuid = (v: string): boolean =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** Crédito reprovado é o que a própria esteira carimbou no motivo quando mandou para revisão. */
export function ehMotivoDeReprovacao(motivo: null | string | undefined): boolean {
  return /cr[ée]dito\s+reprovado/i.test(motivo ?? "");
}

/**
 * Tira de `prevenda` todas as CADs do empreendimento. Devolve quantas foram para cada destino.
 * Nunca lança: é chamada logo depois de gravar o toggle, e uma falha aqui não pode desfazer o
 * desligamento que o operador acabou de pedir — ela volta no resultado, para a tela mostrar.
 */
export async function varrerPrevendaDesligada(
  adminClient: AdminClient,
  enterpriseId: string,
  atualizadoPor?: null | string,
): Promise<{ credenciado: number; erro: null | string; revisao: number }> {
  const vazio = { credenciado: 0, erro: null, revisao: 0 };
  const alvo = String(enterpriseId ?? "").trim();
  if (!alvo) return vazio;

  const { data, error } = await adminClient
    .from("apolo_esteira")
    .select("entity_id, motivo")
    .eq("enterprise_id", alvo)
    .eq("etapa", "prevenda")
    .limit(2000)
    .returns<LinhaPrevenda[]>();

  if (error) return { ...vazio, erro: error.message };

  const linhas = data ?? [];
  if (linhas.length === 0) return vazio;

  const paraRevisao = linhas.filter((l) => ehMotivoDeReprovacao(l.motivo)).map((l) => l.entity_id);
  const paraCredenciado = linhas
    .filter((l) => !ehMotivoDeReprovacao(l.motivo))
    .map((l) => l.entity_id);

  const agora = new Date().toISOString();
  const autor = atualizadoPor && ehUuid(atualizadoPor) ? atualizadoPor : null;
  const falhas: string[] = [];

  // ⚠️ EM LOTES DE 100: a lista de ids vai na URL do PostgREST, e uma varredura de centenas de
  // fichas estouraria o tamanho dela (foi o que derrubou a fila do Board).
  const mover = async (ids: string[], etapa: string, motivo: string) => {
    for (let i = 0; i < ids.length; i += 100) {
      const lote = ids.slice(i, i + 100);
      const { error: erroUpdate } = await adminClient
        .from("apolo_esteira")
        .update({ atualizado_em: agora, atualizado_por: autor, etapa, motivo })
        .eq("enterprise_id", alvo)
        .eq("etapa", "prevenda")
        .in("entity_id", lote);
      if (erroUpdate) falhas.push(erroUpdate.message);
    }
  };

  await mover(paraRevisao, "revisao", MOTIVO_VARREDURA_REVISAO);
  await mover(paraCredenciado, "credenciado", MOTIVO_VARREDURA);

  // Rastro: sem isto, amanhã ninguém sabe por que 90 fichas mudaram de etapa ao mesmo tempo — que
  // foi exatamente a dúvida deixada pelas duas varreduras manuais de 09/08.
  try {
    await adminClient.from("apolo_audit_events").insert(
      [...paraRevisao, ...paraCredenciado].map((entityId) => ({
        action: "etapa_change",
        actor_user_id: autor,
        entity_id: entityId,
        field_name: "etapa",
        metadata: {
          enterpriseId: alvo,
          motivo: "Pré-venda desligada no empreendimento",
          origem: "varredura-prevenda",
          para: paraRevisao.includes(entityId) ? "revisao" : "credenciado",
        },
        status: "mapped",
      })),
    );
  } catch {
    /* o rastro é desejável, não condição: as etapas já foram corrigidas */
  }

  return {
    credenciado: paraCredenciado.length,
    erro: falhas.length ? falhas.join(" · ") : null,
    revisao: paraRevisao.length,
  };
}
