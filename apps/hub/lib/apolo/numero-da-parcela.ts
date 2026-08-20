// O NÚMERO DA PARCELA, como o comprador vê no boleto.
//
// Regra do Lucas: *"o Ato sempre será 1/1 — o Sinal depende de quantas vezes foi parcelado, mas o
// sinal tem que mostrar somente do sinal, aí sim o parcelamento que vai buscar de quantas vezes
// foi parcelado o saldo devedor"* (20/08/2026, sobre o extrato do portal; a mesma regra já tinha
// sido dada em 19/08 sobre a carteira interna).
//
// ⚠️ ESTE ARQUIVO EXISTE PORQUE A REGRA FOI CORRIGIDA UMA VEZ E O CONSERTO NÃO ALCANÇOU TODO
// MUNDO. Em 19/08 a carteira interna passou a numerar por tipo, com uma função privada dentro de
// `lib/apolo/carteira.ts`. O extrato do portal continuou montando a string na mão
// (`${parcela_n}/${parcela_total}`) e, por isso, seguiu mostrando "0/156" em Ato e Sinal por mais
// um dia. Régua de negócio duplicada é régua que vai divergir; agora existe UMA, e quem numerar
// parcela daqui para a frente chama esta.
//
// ⚠️ POR QUE O C2X EXIGE ISSO. Ele guarda DOIS pares de contadores na mesma linha de `payments`, e
// preenche um ou outro conforme o tipo (medido no Vale do Ouro, 20/08/2026):
//
//   tipo    | current_signal_parcel | total_signal_parcels | current_total_parcel | total_parcels
//   Ato     |          0            |        1..4          |          0           |     156
//   Sinal   |        1..4           |        1..4          |          0           |     156
//   Parcela |          0            |        1..4          |        1..156        |     156
//
// Ou seja: `total_parcels` vale 156 em TODAS as linhas, inclusive no Ato e no Sinal, e o contador
// "atual" vem ZERADO nas duas. Ler o par errado é o que produzia "0/156" — um número que não
// existe em lugar nenhum do contrato.

/** Os campos que a numeração precisa, com o nome que cada consulta já usa. */
export type ContadoresDaParcela = {
  /** `parcel_types.name`: "Ato", "Sinal", "Parcela", "Avulso". */
  tipo: null | string;
  /** `current_signal_parcel` — qual parcela DO SINAL. */
  sinalAtual: null | number;
  /** `total_signal_parcels` — em quantas vezes o SINAL foi parcelado. */
  sinalTotal: null | number;
  /** `current_total_parcel` — qual parcela DO SALDO DEVEDOR. */
  parcelaAtual: null | number;
  /** `total_parcels` — em quantas vezes o SALDO DEVEDOR foi parcelado. */
  parcelaTotal: null | number;
};

/** Zero e nulo são a mesma coisa aqui: "o C2X não preencheu este contador". */
function naoZero(valor: unknown): null | number {
  const numero = Number(valor);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

/**
 * "1/1" para o Ato, "n/total do sinal" para o Sinal, "n/total do saldo" para a Parcela.
 *
 * Devolve "-" quando não há contador nenhum: melhor a ausência explícita do que um número
 * inventado, que é o que "0/156" era.
 */
export function numeroDaParcela(dados: ContadoresDaParcela): string {
  const tipo = (dados.tipo ?? "").trim().toLowerCase();

  // O ATO É SEMPRE ÚNICO. Ele é a entrada do negócio, acontece uma vez, e o C2X não guarda
  // contador para ele — daí o "1/1" fixo em vez de tentar ler campo nenhum.
  if (tipo.includes("ato")) return "1/1";

  const doSinal = tipo.includes("sinal");
  const atual = doSinal ? naoZero(dados.sinalAtual) : naoZero(dados.parcelaAtual);
  const total = doSinal ? naoZero(dados.sinalTotal) : naoZero(dados.parcelaTotal);

  if (atual === null && total === null) return "-";

  return `${atual ?? "-"}/${total ?? "-"}`;
}
