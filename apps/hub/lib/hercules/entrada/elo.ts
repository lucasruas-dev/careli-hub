// O ELO DA VENDA COM O PEDIDO DO C2X QUE PAGA A ENTRADA: puro.
//
// ⚠️ É O `eloDoPagamento` DA F8 (`lib/hercules/faturamento/elo-do-pagamento.ts`, branch local
// fix/assinatura-fonte-unica, sem push), NA MESMA ORDEM, com UMA diferença pedida em 02/10/2026:
// mais de um pedido candidato é "ambíguo", SEM DESEMPATE. A F8 escolhia o único com parcela de
// entrada; para a tela que diz ao time se a entrada está paga, escolher sozinho entre dois pedidos
// do mesmo comprador seria chutar, e o chute erra justamente no caso que alguém precisa olhar.
//
// Lucas: *"pagamento de venda será alimentado temporariamente pelo c2x, igual temos hoje na carteira
// do apolo"*. A ordem, a primeira que resolve vence:
//   1. carga: `origem_c2x_id` (o elo da regra escrita);
//   2. nativa assinada pela D4Sign: o pedido do envio (`contract_signatures →
//      acquisition_request_contracts`), que o espelho já ligou a esta venda pelo mesmo comprador;
//   3. nativa pela Clicksign: o pedido REDIGITADO no C2X nas unidades do mesmo terreno, em estágio 2
//      a 6 ou 9 (o 1 é a reserva no pai, sem parcela), do MESMO comprador.
// (A F8 tem um passo entre o 1 e o 2, o `c2x_pedido_id` da F10, coluna que ainda não existe em
// produção. Quando existir, ele entra aqui no mesmo lugar.)
//
// ⚠️ O DOCUMENTO DO COMPRADOR SÓ ENTRA E NUNCA SAI: dígitos comparados em memória e descartados. O
// retorno tem só o número do pedido e a regra (o teste procura os dígitos na saída serializada).

/** Estágios do pedido que podem ser "o pedido do boleto" (proposta em diante, não cancelado). */
export const ESTAGIOS_DO_PEDIDO_DO_BOLETO: readonly number[] = [2, 3, 4, 5, 6, 9];

/** Um pedido do C2X numa unidade do terreno da venda nativa (lido em memória, com o documento). */
export type PedidoDoTerreno = {
  arId: number;
  /** Só dígitos, EM MEMÓRIA. Vazio = não se sabe (e aí não casa). */
  documentoDoComprador: string;
  estagio: null | number;
};

export type EntradaDoElo = {
  /** O pedido do envio da D4Sign do contrato vigente, quando ele é da D4Sign e o C2X o respondeu. */
  arIdDoEnvioD4Sign: null | number;
  /** Dígitos do `cliente_documento` da venda, EM MEMÓRIA. */
  documentoDoComprador: string;
  origem: null | string;
  origemC2xId: null | number | string;
  /**
   * Pedidos do C2X que são o `origem_c2x_id` de OUTRA venda do Panteon no mesmo terreno (a da carga
   * distratada, por exemplo). Nunca pagam a entrada desta: o C2X pode ainda não ter cancelado o
   * pedido antigo quando o redigitado nasce.
   */
  pedidosDeOutrasVendas?: ReadonlySet<number>;
  /** Os pedidos das unidades do terreno (regra 3). `null` = não lidos (a venda não precisa deles). */
  pedidosDoTerreno: null | readonly PedidoDoTerreno[];
};

export type EloDaEntrada =
  | { arId: number; regra: "envio_d4sign" | "origem_c2x_id" | "terreno_mesmo_comprador"; tipo: "elo" }
  | { motivo: "dois_pedidos" | "sem_documento_no_panteon"; tipo: "ambiguo" }
  | {
      motivo: "carga_sem_pedido" | "pedido_de_outro_comprador" | "pedido_de_venda_desfeita" | "sem_pedido_no_c2x";
      tipo: "sem_pedido";
    };

const inteiroPositivo = (valor: unknown): null | number => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const digitos = (valor: null | string | undefined) => String(valor ?? "").replace(/\D/g, "");

/** O pedido do C2X que paga a entrada desta venda. Nunca devolve documento. */
export function eloDaEntrada(entrada: EntradaDoElo): EloDaEntrada {
  if (String(entrada.origem ?? "") !== "panteon") {
    const ar = inteiroPositivo(entrada.origemC2xId);
    return ar ? { arId: ar, regra: "origem_c2x_id", tipo: "elo" } : { motivo: "carga_sem_pedido", tipo: "sem_pedido" };
  }

  const doEnvio = inteiroPositivo(entrada.arIdDoEnvioD4Sign);
  if (doEnvio) return { arId: doEnvio, regra: "envio_d4sign", tipo: "elo" };

  // O mesmo pedido lido duas vezes (duas linhas do terreno com a mesma unidade do C2X) é UM candidato:
  // sem isto, a repetição sozinha viraria "dois pedidos".
  const vistos = new Set<number>();
  const vivos = (entrada.pedidosDoTerreno ?? []).filter((p) => {
    if (p.estagio === null || !ESTAGIOS_DO_PEDIDO_DO_BOLETO.includes(p.estagio) || vistos.has(p.arId)) return false;
    vistos.add(p.arId);
    return true;
  });
  if (vivos.length === 0) return { motivo: "sem_pedido_no_c2x", tipo: "sem_pedido" };

  const doPanteon = digitos(entrada.documentoDoComprador);
  // Sem o documento no Panteon ninguém casa: dizer "outro comprador" seria afirmar o que não se sabe.
  if (!doPanteon) return { motivo: "sem_documento_no_panteon", tipo: "ambiguo" };

  const doComprador = vivos.filter((p) => digitos(p.documentoDoComprador) === doPanteon);
  if (doComprador.length === 0) return { motivo: "pedido_de_outro_comprador", tipo: "sem_pedido" };
  // ⚠️ O PEDIDO QUE JÁ É DE OUTRA VENDA DO PANTEON SAI (revisão da F8 de 29/09): o mesmo comprador e o
  // mesmo lote têm a venda antiga (distratada) e a redigitada. Se só sobrar o antigo, a venda nova
  // ainda não foi digitada.
  const outras = entrada.pedidosDeOutrasVendas;
  const doMesmo = outras ? doComprador.filter((p) => !outras.has(p.arId)) : doComprador;
  if (doMesmo.length === 0) return { motivo: "pedido_de_venda_desfeita", tipo: "sem_pedido" };
  if (doMesmo.length > 1) return { motivo: "dois_pedidos", tipo: "ambiguo" };
  return { arId: (doMesmo[0] as PedidoDoTerreno).arId, regra: "terreno_mesmo_comprador", tipo: "elo" };
}
