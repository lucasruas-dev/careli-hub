// A ROTINA DE ABRIR UM LANÇAMENTO: trazer para a fila quem já está credenciado.
//
// Regra do Lucas (21/08/2026): *"isso é padrão. Toda vez que eu habilitar um lançamento, o
// sistema já tem que buscar as cads do credenciado, entender se tem pix, fazer toda essa
// rotina."*
//
// ⚠️ POR QUE NÃO ACONTECE SOZINHO. A fila é alimentada quando a CAD MUDA de etapa
// (`garantirNaFilaDoLancamento`, chamada da esteira e do webhook do PIX). Quem já estava em
// `credenciado` há semanas nunca mais muda de etapa — então, para um lançamento criado hoje,
// essas pessoas simplesmente não entram. Era o caso das 20 CADs do Villa Paris: credenciadas, e
// invisíveis para o evento recém-criado.
//
// ⚠️ O PIX MUDA A ORDEM DA FILA, e é por isso que ele entra aqui.
//   • Empreendimento COM pré-venda: quem pagou tem lugar marcado, na ordem do pagamento. É o
//     `pago_em` da esteira que vira `ordem_fila` no Prometeu.
//   • Empreendimento SEM pré-venda (o caso do Villa Paris): ninguém pagou, ninguém tem lugar
//     marcado, e a fila desempata pela CHEGADA DA CAD — a data em que o corretor mandou. Foi o
//     que o Lucas pediu: *"como nesse empreendimento a gente não tem o pix, a ordem da fila
//     iniciar é quando eles mandaram as cads"*.
// Mandar `pagoEm` onde não há PIX inventaria uma ordem de pagamento que não existe; não mandar
// onde há PIX jogaria quem pagou para o fim da fila.

import type { createApoloAdminClient } from "./server";

type AdminClient = NonNullable<ReturnType<typeof createApoloAdminClient>>;

// A etapa que entra na fila. Quem está em validação ou revisão ainda não pode ser atendido no
// salão — a fila do dia é de quem pode comprar.
const ETAPA_ALVO = "credenciado";

export type ResultadoPopularFila = {
  comPix: boolean;
  credenciadas: number;
  entraram: number;
  erro?: string;
  jaEstavam: number;
  recusadas: number;
  recusasPorMotivo: Record<string, number>;
};

const vazio = (patch: Partial<ResultadoPopularFila> = {}): ResultadoPopularFila => ({
  comPix: false,
  credenciadas: 0,
  entraram: 0,
  jaEstavam: 0,
  recusadas: 0,
  recusasPorMotivo: {},
  ...patch,
});

/**
 * Traz para a fila do lançamento todas as CADs já credenciadas daquele empreendimento.
 *
 * Idempotente: quem já está na fila conta como `jaEstavam` e nada é duplicado — dá para rodar de
 * novo a cada ativação sem medo.
 *
 * Nunca lança. A ativação do lançamento não pode falhar porque a fila não pôde ser populada: o
 * operador consegue refazer pelo botão, e um lançamento ativo com fila vazia é bem menos ruim que
 * um lançamento que não ativa.
 */
export async function popularFilaDoLancamento(
  client: AdminClient,
  eventoId: string,
): Promise<ResultadoPopularFila> {
  try {
    const { getEvento } = await import("@/lib/prometeu/data");
    const { garantirNaFilaDoLancamento } = await import("./credenciado-para-fila");

    const evento = await getEvento(client as never, eventoId);
    if (!evento) return vazio({ erro: "Lançamento não encontrado." });

    // ⚠️ SEM EMPREENDIMENTO NÃO DÁ PARA SABER QUEM TRAZER. Varrer "todas as CADs credenciadas"
    // jogaria o Garden e o Lagoa Bonita na fila do Villa Paris. Lançamento criado pela tela nova
    // sempre tem; os antigos podem não ter.
    const enterpriseId = (evento.enterpriseId ?? "").trim();
    if (!enterpriseId) {
      return vazio({ erro: "Lançamento sem empreendimento: escolha o empreendimento no Setup." });
    }

    // TEM PIX? A pré-venda é configuração DO EMPREENDIMENTO. Fail-closed: na dúvida, trata como
    // SEM pré-venda — assim a fila cai na ordem de chegada da CAD, que é uma ordem verdadeira,
    // em vez de uma ordem de pagamento inventada.
    const { data: settings } = await client
      .from("apolo_enterprise_settings")
      .select("prevenda_habilitada")
      .eq("enterprise_id", enterpriseId)
      .maybeSingle<{ prevenda_habilitada: boolean | null }>();

    const comPix = settings?.prevenda_habilitada === true;

    const { data, error } = await client
      .from("apolo_esteira")
      .select("entity_id, pago_em")
      .eq("enterprise_id", enterpriseId)
      .eq("etapa", ETAPA_ALVO);

    if (error) return vazio({ comPix, erro: "Falha ao ler a esteira." });

    const fichas = (data ?? []) as { entity_id: string; pago_em: null | string }[];

    let entraram = 0;
    let jaEstavam = 0;
    const recusasPorMotivo: Record<string, number> = {};

    for (const ficha of fichas) {
      const r = await garantirNaFilaDoLancamento(client, ficha.entity_id, {
        enterpriseId,
        eventoId,
        // Só onde a pré-venda existe. Ver o comentário do topo.
        pagoEm: comPix ? ficha.pago_em : null,
      });

      if (r.entrou) entraram += 1;
      else if (r.naFila) jaEstavam += 1;
      else recusasPorMotivo[r.motivo] = (recusasPorMotivo[r.motivo] ?? 0) + 1;
    }

    const recusadas = Object.values(recusasPorMotivo).reduce((a, b) => a + b, 0);

    return {
      comPix,
      credenciadas: fichas.length,
      entraram,
      jaEstavam,
      recusadas,
      recusasPorMotivo,
    };
  } catch {
    return vazio({ erro: "Falha ao montar a fila do lançamento." });
  }
}
