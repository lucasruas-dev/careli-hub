import { getHadesDbPool } from "@/lib/guardian/db";

import { perfilDaParcela } from "./carteira-liquida";

// A PROPOSTA DE UMA VENDA, NA LÍNGUA DO DONO DO EMPREENDIMENTO.
//
// Pedido do Lucas (18/08/2026): *"nas vendas eu senti falta de trazer as propostas de cada venda,
// acho que deveria ter um popup trazendo: entrada, desconto, parcelamento da entrada e o tempo de
// financiamento"*.
//
// A tela interna já tem esse popup (`VendaPropostaModal` + `loadApoloVendaProposta`), mas ele fala
// a língua do OPERADOR: nome do plano comercial, juros, correção, corretor. Nada disso sai para o
// incorporador — ele é cliente, e o combinado comercial interno não é assunto dele. Este módulo
// remonta a proposta só com o que é do NEGÓCIO dele: quanto a unidade valia, por quanto saiu, como
// a entrada foi parcelada e em quantas vezes o financiamento vai.
//
// ⚠️ ONDE MORA CADA NÚMERO (investigado no C2X em 18/08/2026, ver as colunas antes de mexer):
//   • VALOR DE TABELA   = `enterprise_unities.price`.
//   • VALOR NEGOCIADO   — o C2X NÃO tem campo próprio (as colunas de `acquisition_requests` são
//     código, datas, plano e workflow; `annual_value` existe e está NULA na base inteira que
//     conferimos). O negociado REAL é a soma das parcelas geradas do contrato (Ato + Sinal +
//     Parcela, sem `payment_to_delete`): no VAL a soma fecha com o preço ao centavo (79.900,00 no
//     G 09). Quando o financiamento AINDA NÃO foi gerado (VOC/VOL têm contratos só com a entrada
//     emitida — 90% do preço fora dos payments), a soma seria uma mentira de 10%; nesse caso o
//     negociado sai NULO e a tela mostra "—", nunca um número errado.
//   • DESCONTO          = tabela − negociado, quando o negociado é apurável. Nos produtos antigos
//     (LOS/LOU) as parcelas carregam juros embutidos e a soma passa da tabela; isso é plano, não
//     ágio, então o desconto trava em zero em vez de sair negativo.
//   • ENTRADA           = parcelas de perfil Ato + Sinal, a MESMA régua de `perfilDaParcela` da
//     carteira (importada, não copiada — se a régua mudar lá, muda aqui junto).
//   • FINANCIAMENTO     = as parcelas de perfil "parcela" geradas; sem elas, o prazo vem do plano
//     comercial (`commercial_plans.parcels`) e o valor fica nulo.
//
// ⚠️ O QUE NÃO SAI DAQUI, POR DECISÃO: nome e percentuais do plano comercial interno, juros do
// plano, corretor e split. `LinhaDaPropostaCrua` nem carrega esses campos — allowlist começa na
// consulta, não no payload.

export type ParcelaDaEntrada = {
  /** 1..N, na ordem de vencimento — é o "1/4, 2/4" que o popup mostra. */
  n: number;
  paga: boolean;
  valor: number;
  /** 'YYYY-MM-DD'. */
  vencimento: null | string;
};

export type PropostaDaVenda = {
  desconto: null | number;
  entrada: {
    parcelas: ParcelaDaEntrada[];
    /** Entrada ÷ valor negociado (ou tabela, na falta dele), em 0–100. */
    percentual: null | number;
    total: number;
  };
  faturadoEm: null | string;
  financiamento: {
    /** Quantidade de parcelas mensais (o "tempo": 120x). Do contrato; sem ele, do plano. */
    parcelas: null | number;
    /** 'YYYY-MM-DD' da primeira parcela do financiamento gerada. */
    primeiroVencimento: null | string;
    /** Valor da parcela mensal gerada. Nulo quando o financiamento ainda não foi emitido. */
    valorParcela: null | number;
  };
  imobiliaria: null | string;
  /**
   * O PREVISTO PELO PLANO, para a venda que ainda não teve parcela emitida. Pedido do Lucas
   * (18/08/2026): *"a gente já consegue ver a proposta desde a segunda etapa, proposta emitida"*
   * — antes da emissão o popup dizia "a definir" em tudo, e o plano comercial do contrato já
   * conta a entrada (%) e o prazo. Negociado/desconto previstos só saem para plano PADRÃO
   * (negociado = tabela); plano personalizado fica sem previsão de total, porque o valor fechado
   * só nasce com a emissão.
   */
  previsao: null | {
    desconto: null | number;
    entradaPercentual: number;
    entradaTotal: number;
    negociado: null | number;
  };
  /** Rótulo compacto no formato dos cards ("LBFC1210", "VALG09"): código + bloco + lote. */
  unidade: string;
  valorNegociado: null | number;
  valorTabela: number;
};

/** O cabeçalho cru da proposta mais recente da unidade. Exportado para os testes. */
export type CabecalhoDaProposta = {
  ar_id: number;
  bloco: null | string;
  faturado_em: null | string;
  imobiliaria: null | string;
  codigo: null | string;
  lote: null | string;
  /** `initial_input_value` do plano (personalizado primeiro): a % de entrada contratada. */
  plano_entrada_pct: null | number | string;
  /** `commercial_plans.parcels` — o prazo do plano, plano B quando o financiamento não existe. */
  plano_parcelas: null | number;
  /** 1 quando existe plano personalizado do contrato (cpc): total fechado só na emissão. */
  plano_personalizado: null | number;
  valor_tabela: null | number | string;
};

/** Uma parcela crua do contrato. Só o que a montagem precisa — allowlist desde a consulta. */
export type ParcelaCruaDaProposta = {
  pago: null | number | string;
  pago_em: null | string;
  tipo: null | string;
  valor: null | number | string;
  vencimento: null | string;
};

function round2(valor: number): number {
  return Math.round(valor * 100) / 100;
}

function rotuloDaUnidade(
  cab: Pick<CabecalhoDaProposta, "bloco" | "codigo" | "lote">,
): string {
  // O formato dos cards ("LBFC1210"): código + bloco + lote, sem espaço. O Lucas estranhou o
  // "C12 10" solto no título do popup (18/08/2026) — o rótulo tem que ser o mesmo da tela.
  const bloco = String(cab.bloco ?? "").trim();
  const lote = String(cab.lote ?? "").trim();
  // Código sozinho não identifica a unidade: sem bloco e sem lote, melhor o traço honesto.
  if (!bloco && !lote) return "—";
  return `${String(cab.codigo ?? "").trim()}${bloco}${lote}`;
}

/** Paga na mesma régua da carteira (`situacaoDaLinha`): valor pago > 0 E data de pagamento. */
function estaPaga(parcela: ParcelaCruaDaProposta): boolean {
  return Number(parcela.pago ?? 0) > 0 && Boolean(parcela.pago_em);
}

/**
 * Monta a proposta a partir das linhas cruas. Função PURA de propósito: é ela que os testes
 * exercitam sem C2X, com os números do contrato real do VAL (G 09) como régua.
 */
export function montarProposta(
  cab: CabecalhoDaProposta,
  parcelas: ParcelaCruaDaProposta[],
): PropostaDaVenda {
  const valorTabela = round2(Number(cab.valor_tabela ?? 0));

  const daEntrada = parcelas.filter((p) => {
    const perfil = perfilDaParcela(p.tipo);
    return perfil === "ato" || perfil === "sinal";
  });
  const doFinanciamento = parcelas.filter((p) => perfilDaParcela(p.tipo) === "parcela");

  const entradaTotal = round2(
    daEntrada.reduce((soma, p) => soma + Number(p.valor ?? 0), 0),
  );

  // ⚠️ O NEGOCIADO SÓ EXISTE COM O FINANCIAMENTO GERADO. Contrato com a entrada emitida e o
  // financiamento ainda não (comum no VOC/VOL recém-vendido) tem soma = ~10% do preço; publicar
  // isso como "valor negociado" diria ao dono que o lote saiu por um décimo. Nulo é o honesto.
  const somaFinanciamento = doFinanciamento.reduce((soma, p) => soma + Number(p.valor ?? 0), 0);
  const valorNegociado =
    doFinanciamento.length > 0 ? round2(entradaTotal + somaFinanciamento) : null;

  // Desconto negativo não é desconto: nos planos antigos os juros vêm embutidos nas parcelas e a
  // soma passa da tabela. Isso é regra do plano (que não sai daqui), então trava em zero.
  const desconto =
    valorNegociado === null ? null : Math.max(0, round2(valorTabela - valorNegociado));

  const baseDoPercentual = valorNegociado ?? valorTabela;

  // Primeira parcela do financiamento pela ordem de vencimento (a consulta já ordena, mas a
  // montagem não depende disso — função pura confia só no que confere).
  const vencimentosFin = doFinanciamento
    .map((p) => p.vencimento)
    .filter((v): v is string => Boolean(v))
    .sort();

  // A PREVISÃO só existe enquanto NADA foi emitido: com qualquer parcela na praça, o que vale é
  // o emitido (misturar previsto com emitido no mesmo popup é pedir confusão).
  const pct = cab.plano_entrada_pct == null ? null : Number(cab.plano_entrada_pct);
  const personalizado = Number(cab.plano_personalizado ?? 0) === 1;
  const previsao =
    parcelas.length === 0 && pct != null && Number.isFinite(pct) && pct > 0 && valorTabela > 0
      ? {
          desconto: personalizado ? null : 0,
          entradaPercentual: round2(pct),
          entradaTotal: round2((valorTabela * pct) / 100),
          negociado: personalizado ? null : valorTabela,
        }
      : null;

  return {
    desconto,
    entrada: {
      parcelas: [...daEntrada]
        .sort((a, b) => (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999"))
        .map((p, i) => ({
          n: i + 1,
          paga: estaPaga(p),
          valor: round2(Number(p.valor ?? 0)),
          vencimento: p.vencimento,
        })),
      percentual: baseDoPercentual > 0 ? round2((entradaTotal / baseDoPercentual) * 100) : null,
      total: entradaTotal,
    },
    faturadoEm: cab.faturado_em,
    financiamento: {
      parcelas:
        doFinanciamento.length > 0
          ? doFinanciamento.length
          : cab.plano_parcelas != null
            ? Number(cab.plano_parcelas)
            : null,
      primeiroVencimento: vencimentosFin[0] ?? null,
      // O valor só sai de parcela GERADA (a primeira, que é o valor contratado; reajuste futuro
      // muda as seguintes). Estimar (tabela − entrada) ÷ prazo daria um número que ninguém deve.
      valorParcela:
        doFinanciamento.length > 0
          ? round2(
              Number(
                [...doFinanciamento].sort((a, b) =>
                  (a.vencimento ?? "9999").localeCompare(b.vencimento ?? "9999"),
                )[0]?.valor ?? 0,
              ),
            )
          : null,
    },
    imobiliaria: String(cab.imobiliaria ?? "").trim() || null,
    previsao,
    unidade: rotuloDaUnidade(cab),
    valorNegociado,
    valorTabela,
  };
}

/**
 * Lê no C2X (READ-ONLY) a proposta mais recente da unidade e monta o payload do popup.
 *
 * ⚠️ ESTA FUNÇÃO NÃO AUTORIZA NADA. Quem chama tem que ter passado por `autorizar()` e
 * `unidadeNoEscopo()` ANTES — é a regra de toda leitura por unidade do portal
 * (ver `lib/apolo/incorporador/escopo.ts`).
 */
export async function propostaDaVenda(
  unitId: number,
): Promise<
  { data: null | PropostaDaVenda; ok: true } | { error: string; ok: false }
> {
  if (!Number.isInteger(unitId) || unitId <= 0) {
    return { error: "Unidade invalida.", ok: false };
  }

  const pool = getHadesDbPool();
  if (!pool.ok) {
    return { error: `Configuracao C2X ausente: ${pool.missing.join(", ")}.`, ok: false };
  }

  const nome = (a: string) =>
    `coalesce(nullif(trim(${a}.name), ''), nullif(trim(${a}.fantasy_name), ''), nullif(trim(${a}.social_name), ''))`;

  try {
    // A proposta mais recente da unidade — o mesmo critério da tela interna
    // (`loadApoloVendaProposta`): revenda tem várias, vale a última.
    //
    // ⚠️ SÓ SE ELA ESTIVER VIVA. A subconsulta pina a MESMA "última proposta" que o payload de
    // vendas usa (vendas.ts, ordem created_at/id), e o filtro de estágio é a MESMA régua de
    // `deriveStage`: ativos 1, 2, 3, 4, 5, 6 e 9; terminais 7, 8, 10 e 11 ficam de fora. Unidade
    // cujo último contrato foi cancelado/distratado voltou a "Disponível" na tela (o clique nem
    // liga) — sem este filtro, quem chamasse a rota direto receberia a proposta TERMINADA como se
    // fosse a da venda. Com ele, responde `data: null`, igual a lote nunca vendido.
    const [cabs] = await pool.pool.query(
      `select ar.id ar_id,
              nullif(trim(eu.block), '') bloco,
              nullif(trim(eu.lot), '') lote,
              nullif(trim(e.code), '') codigo,
              eu.price valor_tabela,
              date_format(ar.billing_date, '%Y-%m-%d') faturado_em,
              coalesce(cps.parcels, cpc.parcels) plano_parcelas,
              coalesce(cpc.initial_input_value, cps.initial_input_value) plano_entrada_pct,
              (cpc.id is not null) plano_personalizado,
              ${nome("imo")} imobiliaria
         from acquisition_requests ar
         join enterprise_unities eu on eu.id = ar.enterprise_unity_id
         join enterprises e on e.id = eu.enterprise_id
         left join commercial_plans cps on cps.id = ar.commercial_plan_id
         left join commercial_plans cpc on cpc.id = (
                select cp2.id from commercial_plans cp2
                 where cp2.acquisition_request_id = ar.id
                 order by cp2.id desc
                 limit 1)
         left join users cli on cli.id = ar.client_id
         left join users imo on imo.id = cli.vinculed_by_id
        where ar.enterprise_unity_id = ?
          and ar.id = (
                select ar2.id from acquisition_requests ar2
                 where ar2.enterprise_unity_id = ar.enterprise_unity_id
                 order by ar2.created_at desc, ar2.id desc
                 limit 1)
          and ar.acquisition_request_stage_id in (1, 2, 3, 4, 5, 6, 9)
        limit 1`,
      [unitId],
    );

    const cab = (cabs as CabecalhoDaProposta[])[0];
    if (!cab) {
      return { data: null, ok: true };
    }

    const [parcelas] = await pool.pool.query(
      `select pt.name tipo,
              p.initial_value valor,
              p.paid_value pago,
              date_format(p.due_date, '%Y-%m-%d') vencimento,
              date_format(p.payment_date, '%Y-%m-%d') pago_em
         from payments p
         left join parcel_types pt on pt.id = p.parcel_type_id
        where p.acquisition_request_id = ?
          and coalesce(p.payment_to_delete, 0) = 0
        order by p.due_date asc, p.id asc`,
      [cab.ar_id],
    );

    return { data: montarProposta(cab, parcelas as ParcelaCruaDaProposta[]), ok: true };
  } catch (error) {
    console.error("[apolo][incorporador] falha ao ler a proposta da venda", error);
    return { error: "Nao foi possivel ler a proposta agora.", ok: false };
  }
}
