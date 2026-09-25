import { createHash } from "node:crypto";

// A IMPRESSÃO DIGITAL DA PARCELA DO LSOFT — o que religa o nosso trabalho à parcela depois da carga.
//
// O espelho do LSoft é regravado inteiro a cada carga: o importador APAGA `lsoft_parcelas` e insere
// de novo, com ids sorteados na hora. Tudo que guardamos apontando para o id antigo perde o alvo.
// A digital é a saída: um hash do CONTEÚDO da parcela, que a carga seguinte reproduz igual.
//
// ⚠️ ESTA FÓRMULA TEM TRÊS CÓPIAS E AS TRÊS PRECISAM CONCORDAR, senão o religamento falha sem erro
// nenhum e o dado só parece ter sumido:
//   1. o SQL das migrations 0103 e 0188 (`md5(concat_ws('|', ...))`);
//   2. o reconciliador (`scripts/lsoft/reconciliar-classificacao.mjs`);
//   3. este módulo, que é o que o servidor usa ao gravar.
// Conferido em 24/09/2026 contra as 180 marcas já gravadas: 174 das 177 com parcela viva batem byte
// a byte. As 3 que não batem são parcelas cujo vencimento mudou depois da marcação, que é
// exatamente o caso que as redes de reserva do reconciliador existem para resolver.
//
// ⚠️ `concat_ws` DO POSTGRES PULA NULO, não o transforma em string vazia. É por isso que o filtro
// abaixo descarta null e undefined ANTES do join, em vez de trocá-los por "". Um `coalesce(...,'')`
// de um lado, ou um `?? ""` do outro, geraria hashes diferentes para a mesma parcela.
//
// ⚠️ A ORDEM DOS CAMPOS É PARTE DO CONTRATO. Trocar dois de lugar produz um hash válido e errado,
// que não casa com nada do que já está gravado. Se um dia precisar mudar, é migration com backfill,
// nunca uma edição solta aqui.

/** Os campos da parcela que entram na digital, na ordem exata em que entram. */
export type ParcelaParaDigital = {
  cliente_codigo: null | string | undefined;
  empreendimento: null | string | undefined;
  observacoes: null | string | undefined;
  origem: null | string | undefined;
  parcela: null | string | undefined;
  /** "70456.35" ou 70456.35: o número vira a MESMA string que o `::text` do Postgres gera. */
  valor: null | number | string | undefined;
  /** No formato do banco, "AAAA-MM-DD". É o que o PostgREST devolve para coluna `date`. */
  vencimento: null | string | undefined;
};

const texto = (v: unknown): null | string => (v === null || v === undefined ? null : String(v));

/**
 * O valor como o Postgres o escreve.
 *
 * ⚠️ `numeric(14,2)::text` sai sempre com duas casas ("70456.35", "2119.00"). Mandar o número cru
 * do JavaScript produziria "2119" para o mesmo valor que o banco escreve "2119.00", e o hash
 * mudaria por causa de dois zeros.
 */
const numero = (v: unknown): null | string => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(2) : String(v);
};

/** md5 dos campos não nulos, unidos por "|". Espelha `md5(concat_ws('|', ...))`. */
export function digitar(campos: Array<null | string | undefined>): string {
  return createHash("md5")
    .update(campos.filter((c) => c !== null && c !== undefined).join("|"))
    .digest("hex");
}

/**
 * A digital de uma parcela do LSoft.
 *
 * ⚠️ NÃO SERVE COMO CHAVE ÚNICA: duas parcelas genuinamente idênticas (mesmo cliente, mesmo dia,
 * mesmo valor, mesma observação) têm a mesma digital de propósito. Quem desempata é o `ordinal`,
 * pela posição na lista ordenada por id. Medido: acontece uma vez na base inteira, no cliente
 * 00000294, com dois recebimentos de R$ 5.000,00 no mesmo dia.
 */
export function digitalDaParcela(parcela: ParcelaParaDigital): string {
  return digitar([
    texto(parcela.cliente_codigo),
    texto(parcela.empreendimento),
    texto(parcela.parcela),
    texto(parcela.vencimento),
    numero(parcela.valor),
    texto(parcela.observacoes),
    texto(parcela.origem),
  ]);
}
