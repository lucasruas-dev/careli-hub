import type { SupabaseClient } from "@supabase/supabase-js";

import { apurarFatosDoContrato, type EnvelopeDoContrato, type FatosApurados } from "./fatos-do-contrato";

// A LEITURA DOS FATOS DO CONTRATO NO BANCO: assinou? pagou?
//
// ⚠️ MORAVA DENTRO DA ROTA DO PEDIDO DE CANCELAMENTO
// (`app/api/incorporador/venda/cancelamento-de-contrato/route.ts`) e saiu dela em 18/09/2026, sem
// mudar uma linha, porque a CONCLUSÃO do cancelamento na Têmis precisa refazer a MESMA apuração no
// instante de concluir (`lib/hercules/concluir-cancelamento-server.ts`). Duas cópias desta leitura
// divergiriam no primeiro conserto, e a divergência aqui é dinheiro: uma delas passaria a dizer
// "não pagou" sobre um contrato pago.
//
// A regra pura (o que conta como assinatura e como pagamento) continua em `fatos-do-contrato.ts`;
// este arquivo só busca o que ela precisa ler.

/** As datas que a proposta carrega, mais o id que liga eventos e envelopes. */
export type PropostaParaApurar = {
  data_assinatura: null | string;
  data_ato: null | string;
  data_faturamento: null | string;
  id: string;
};

/**
 * O que está gravado sobre este contrato — a fonte da classificação.
 *
 * ⚠️ FALHA DE LEITURA NÃO VIRA "NÃO PAGOU". Um erro no select devolveria silêncio, e silêncio aqui
 * significa cancelamento simples: exatamente a classificação errada para um contrato pago. Por isso
 * a exceção sobe e vira 503 na tela, em vez de virar um pedido classificado no escuro.
 */
export async function lerFatosDoContrato(
  admin: SupabaseClient,
  proposta: PropostaParaApurar,
): Promise<FatosApurados> {
  const { data, error } = await admin
    .from("hercules_proposta_eventos")
    .select("tipo")
    .eq("proposta_id", proposta.id)
    .limit(500);

  if (error) throw new Error(error.message);

  // ⚠️ O ENVELOPE DA TÊMIS PRECISA ENTRAR AQUI, SENÃO A APURAÇÃO É CEGA PARA A ASSINATURA DO
  // PANTEON — e este era o defeito, não a função. As duas fontes acima são do C2X
  // (`hercules_proposta_eventos` e `data_assinatura` só são escritas pela carga do legado): uma
  // venda que nasceu aqui, cujo contrato a Têmis mandou para a Clicksign e cujos compradores
  // assinaram, respondia "nenhuma assinatura registrada" e o pedido saía classificado como
  // CANCELAMENTO SIMPLES — sem distrato, sem apuração do que devolver e sem devolução ao cliente.
  // `apurarFatosDoContrato` já sabe ler o envelope; faltava alguém buscá-lo, porque ela é pura.
  //
  // ⚠️ SÓ `assinado`, e o filtro é da própria consulta: `parcial` é meio contrato assinado, e pela
  // regra do Lucas (12/09/2026) esse ainda VOLTA para a análise — tratá-lo como completo empurraria
  // para o distrato uma venda que só precisava de correção.
  const { data: envelopes, error: erroDoEnvelope } = await admin
    .from("temis_envelopes")
    .select("estado, fechado_em")
    .eq("proposta_id", proposta.id)
    .eq("estado", "assinado")
    .order("criado_em", { ascending: false })
    .limit(1);

  // ⚠️ E FALHA DE LEITURA NÃO VIRA "NÃO ASSINOU", pelo mesmo desenho do select acima: silêncio aqui
  // significa cancelamento simples, que é a classificação errada para um contrato assinado.
  if (erroDoEnvelope) throw new Error(erroDoEnvelope.message);

  return apurarFatosDoContrato(
    (data ?? []) as Array<{ tipo: string }>,
    {
      data_assinatura: proposta.data_assinatura,
      data_ato: proposta.data_ato,
      data_faturamento: proposta.data_faturamento,
    },
    ((envelopes ?? []) as EnvelopeDoContrato[])[0] ?? null,
  );
}
