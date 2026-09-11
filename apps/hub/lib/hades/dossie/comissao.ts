// A COMISSÃO QUE SEPARA O VALOR DE VENDA DA CORRETAGEM — regra pura, sem banco.
//
// ⚠️ O PERCENTUAL VEM DO PANTEON, NÃO DO C2X. Regra do Lucas em 11/09/2026, textual: "nesse caso
// de % (tudo relacionado ao comercial, plano e tal) não precisa consultar o C2X, a única coisa
// que você consulta é referente a financeiro, pagamento, parcelas". Até então `dados.ts` lia
// `commercial_policies.total_value_commission` do MySQL legado — e aquele número tem estrutura
// diferente: no C2X a comissão é repartida em CINCO papéis (coordenador, imobiliária, gerente,
// captador e careli), e no Panteon são duas caixas. Medido no Veredas em 11/09: 1,66 + 4,00 +
// 0,45 + 0,32 + 0,07 = 6,50, e nenhuma dessas pontas corresponde às duas do cadastro daqui.
// Reconciliar as duas estruturas seria inventar uma regra que ninguém escreveu.
//
// ⚠️ A ARITMÉTICA É EM CENTAVOS INTEIROS, e é cópia deliberada de `lib/temis/dados-do-contrato.ts`
// (`parteEmCentavos`). O contrato de corretagem imprime as duas pontas e manda somá-las; se o
// dossiê somasse em reais, o mesmo negócio sairia com um centavo de diferença entre o papel e o
// relatório. Medido lá e travado em teste aqui: R$ 170.010,08 a 1,5% e 5% dá R$ 2.550,15 +
// R$ 8.500,50 = R$ 11.050,65; em reais a conta dá 11050.6552, que vira R$ 11.050,66.

export type ComissaoCadastrada = {
  /** `apolo_enterprise_settings.comissao_coordenadora_percentual`. */
  coordenadoraPercent: null | number;
  /** `apolo_enterprise_settings.comissao_imobiliaria_percentual`. */
  imobiliariaPercent: null | number;
};

export type ReparticaoDaVenda = {
  corretagemCoordenadora: null | number;
  corretagemImobiliaria: null | number;
  /** Soma das duas pontas, em pontos percentuais. `null` quando alguma não está cadastrada. */
  percentualTotal: null | number;
  /** O que o comprador paga pela intermediação. `null` = não apurado. */
  valorCorretagem: null | number;
  /** O preço da unidade menos a corretagem: o "valor de venda de verdade". */
  valorTotalLote: null | number;
};

const NAO_APURADO: ReparticaoDaVenda = {
  corretagemCoordenadora: null,
  corretagemImobiliaria: null,
  percentualTotal: null,
  valorCorretagem: null,
  valorTotalLote: null,
};

function percentualValido(valor: null | number | undefined): null | number {
  if (valor === null || valor === undefined) return null;
  if (!Number.isFinite(valor) || valor < 0) return null;

  return valor;
}

/** `Math.round((centavos * taxa) / 100)` — o arredondamento é o do CENTAVO, não o da casa do %. */
function parteEmCentavos(valorEmCentavos: number, taxa: number): number {
  return Math.round((valorEmCentavos * taxa) / 100);
}

/**
 * Reparte o preço total da aquisição entre a unidade e a corretagem.
 *
 * ⚠️ ZERO É DECISÃO, NULO É ESQUECIMENTO. Empreendimento em que uma das pontas não recebe tem
 * `0` cadastrado, e a conta segue normalmente. Já uma ponta NULA torna a corretagem inteira
 * desconhecida: imprimir só a ponta cadastrada entregaria ao jurídico uma corretagem menor que a
 * real e, por tabela, um valor de venda maior — exatamente o erro que esta separação existe para
 * não cometer. É a mesma distinção que o contrato faz, e pela mesma razão.
 *
 * @param precoTotal `enterprise_unities.price`, que é o preço da aquisição INTEIRA (unidade mais
 *                   corretagem) — conferido no contrato real em 03/08/2026.
 */
export function repartirVenda(
  precoTotal: number,
  comissao: ComissaoCadastrada,
): ReparticaoDaVenda {
  const coordenadora = percentualValido(comissao.coordenadoraPercent);
  const imobiliaria = percentualValido(comissao.imobiliariaPercent);

  if (coordenadora === null || imobiliaria === null) {
    return NAO_APURADO;
  }

  const percentualTotal = coordenadora + imobiliaria;

  // Sem preço não há o que repartir. Devolver zero faria o PDF imprimir "R$ 0,00" numa linha que
  // o leitor entenderia como apurada — o percentual, esse sim, já é conhecido e sai.
  if (!Number.isFinite(precoTotal) || precoTotal <= 0) {
    return { ...NAO_APURADO, percentualTotal };
  }

  const emCentavos = Math.round(precoTotal * 100);
  const daCoordenadora = parteEmCentavos(emCentavos, coordenadora);
  const daImobiliaria = parteEmCentavos(emCentavos, imobiliaria);
  const corretagemEmCentavos = daCoordenadora + daImobiliaria;

  return {
    corretagemCoordenadora: daCoordenadora / 100,
    corretagemImobiliaria: daImobiliaria / 100,
    percentualTotal,
    valorCorretagem: corretagemEmCentavos / 100,
    valorTotalLote: (emCentavos - corretagemEmCentavos) / 100,
  };
}
