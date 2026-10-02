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
//
// ⚠️ DUAS REGRAS DA REVISÃO DE 02/10/2026, SÓ NO CAMINHO DO TERRENO:
//   • O PEDIDO QUE NASCEU NO C2X ANTES DA VENDA NÃO CASA SOZINHO. O VOR Q14 L01 tinha o pedido 5032,
//     criado em 25/09 19:24 para a proposta 10a51c41 (cancelada em 01/10); a proposta nova do mesmo
//     comprador, eec9f905, é de 01/10 17:53. Pelo lote e pelo CPF o 5032 casava com a nova, e a tela
//     mostraria a entrada de uma venda que não existe mais. A venda nativa nasce no Panteon e só
//     DEPOIS é redigitada no C2X: um pedido mais velho que ela é de outra proposta, ou no mínimo pede
//     um olho humano. Sai "ambíguo" com o número, e a tela pede para conferir.
//   • O PEDIDO DESFEITO DO COMPRADOR NÃO SOME CALADO. Sem candidato vivo, a tela dizia "a venda ainda
//     não foi digitada" também quando ela FOI digitada e já está cancelada ou distratada no C2X. Só
//     quando não sobra candidato vivo do comprador, os desfeitos dele (lidos à parte por
//     `ler-entrada.ts`, e só os nascidos depois da venda) viram "pedido desfeito no C2X".

/** Estágios do pedido que podem ser "o pedido do boleto" (proposta em diante, não cancelado). */
export const ESTAGIOS_DO_PEDIDO_DO_BOLETO: readonly number[] = [2, 3, 4, 5, 6, 9];

/** Um pedido do C2X numa unidade do terreno da venda nativa (lido em memória, com o documento). */
export type PedidoDoTerreno = {
  arId: number;
  /**
   * `acquisition_requests.created_at` em ISO com `-03:00` (o C2X grava Brasília sem fuso, e quem lê
   * converte por `instanteDeBrasilia`). `null` = não se sabe, e aí a data não decide nada.
   */
  criadoEm: null | string;
  /** Só dígitos, EM MEMÓRIA. Vazio = não se sabe (e aí não casa). */
  documentoDoComprador: string;
  estagio: null | number;
};

export type EntradaDoElo = {
  /** O pedido do envio da D4Sign do contrato vigente, quando ele é da D4Sign e o C2X o respondeu. */
  arIdDoEnvioD4Sign: null | number;
  /**
   * `hercules_propostas.criado_em` da venda (ISO). É por ele que o pedido do terreno nascido ANTES da
   * venda não casa sozinho. Ausente ou ilegível = a data não decide nada (o comportamento de antes).
   */
  criadoEmDaVenda?: null | string;
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
  /**
   * Os pedidos CANCELADOS OU DISTRATADOS (estágios 7, 8, 10 e 11) das unidades do terreno, nascidos
   * depois da venda. Só são lidos quando o elo sem eles não achou candidato vivo do comprador
   * (`olhaOsDesfeitos`). Ausente = não lidos.
   */
  pedidosDesfeitosDoTerreno?: null | readonly PedidoDoTerreno[];
  /** Os pedidos das unidades do terreno (regra 3). `null` = não lidos (a venda não precisa deles). */
  pedidosDoTerreno: null | readonly PedidoDoTerreno[];
};

/** Os "sem pedido" do terreno em que não sobrou candidato vivo do comprador. */
type SemCandidatoVivo = "pedido_de_outro_comprador" | "pedido_de_venda_desfeita" | "sem_pedido_no_c2x";

export type EloDaEntrada =
  | { arId: number; regra: "envio_d4sign" | "origem_c2x_id" | "terreno_mesmo_comprador"; tipo: "elo" }
  | { motivo: "dois_pedidos" | "sem_documento_no_panteon"; tipo: "ambiguo" }
  | { arId: number; motivo: "pedido_anterior_a_venda"; tipo: "ambiguo" }
  | { motivo: "carga_sem_pedido" | SemCandidatoVivo; tipo: "sem_pedido" }
  | { arId: number; motivo: "pedido_desfeito_no_c2x"; tipo: "sem_pedido" };

const inteiroPositivo = (valor: unknown): null | number => {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

const digitos = (valor: null | string | undefined) => String(valor ?? "").replace(/\D/g, "");

/** O instante em milissegundos, ou `null` quando não dá para ler (e aí a data não decide nada). */
const instante = (iso: null | string | undefined): null | number => {
  const ms = Date.parse(String(iso ?? ""));
  return Number.isNaN(ms) ? null : ms;
};

const MOTIVOS_SEM_CANDIDATO_VIVO: ReadonlySet<string> = new Set<SemCandidatoVivo>([
  "pedido_de_outro_comprador",
  "pedido_de_venda_desfeita",
  "sem_pedido_no_c2x",
]);

/**
 * O elo do terreno saiu sem candidato vivo do comprador: vale ler os pedidos desfeitos (`ler-entrada.ts`
 * faz a segunda consulta só quando isto diz sim, e só com o documento e a data da venda em mãos).
 */
export function olhaOsDesfeitos(elo: EloDaEntrada): boolean {
  return elo.tipo === "sem_pedido" && MOTIVOS_SEM_CANDIDATO_VIVO.has(elo.motivo);
}

/** O pedido do C2X que paga a entrada desta venda. Nunca devolve documento. */
export function eloDaEntrada(entrada: EntradaDoElo): EloDaEntrada {
  if (String(entrada.origem ?? "") !== "panteon") {
    const ar = inteiroPositivo(entrada.origemC2xId);
    return ar ? { arId: ar, regra: "origem_c2x_id", tipo: "elo" } : { motivo: "carga_sem_pedido", tipo: "sem_pedido" };
  }

  const doEnvio = inteiroPositivo(entrada.arIdDoEnvioD4Sign);
  if (doEnvio) return { arId: doEnvio, regra: "envio_d4sign", tipo: "elo" };

  const doPanteon = digitos(entrada.documentoDoComprador);
  const outras = entrada.pedidosDeOutrasVendas;
  const daVenda = instante(entrada.criadoEmDaVenda);

  /**
   * Sem candidato vivo do comprador: o desfeito DELE, nascido depois da venda e que não é de outra
   * venda do Panteon, vira "pedido desfeito no C2X". Com mais de um, vale o mais novo (é o que a
   * pessoa vai procurar lá). Sem documento ou sem a data da venda, nada muda.
   */
  const semCandidatoVivo = (motivo: SemCandidatoVivo): EloDaEntrada => {
    if (!doPanteon || daVenda === null) return { motivo, tipo: "sem_pedido" };
    const desfeito = (entrada.pedidosDesfeitosDoTerreno ?? [])
      .filter((p) => {
        const nasceu = instante(p.criadoEm);
        return digitos(p.documentoDoComprador) === doPanteon && !outras?.has(p.arId) && nasceu !== null && nasceu >= daVenda;
      })
      .sort((a, b) => (instante(b.criadoEm) ?? 0) - (instante(a.criadoEm) ?? 0) || b.arId - a.arId)[0];
    return desfeito
      ? { arId: desfeito.arId, motivo: "pedido_desfeito_no_c2x", tipo: "sem_pedido" }
      : { motivo, tipo: "sem_pedido" };
  };

  // O mesmo pedido lido duas vezes (duas linhas do terreno com a mesma unidade do C2X) é UM candidato:
  // sem isto, a repetição sozinha viraria "dois pedidos".
  const vistos = new Set<number>();
  const vivos = (entrada.pedidosDoTerreno ?? []).filter((p) => {
    if (p.estagio === null || !ESTAGIOS_DO_PEDIDO_DO_BOLETO.includes(p.estagio) || vistos.has(p.arId)) return false;
    vistos.add(p.arId);
    return true;
  });
  if (vivos.length === 0) return semCandidatoVivo("sem_pedido_no_c2x");

  // Sem o documento no Panteon ninguém casa: dizer "outro comprador" seria afirmar o que não se sabe.
  if (!doPanteon) return { motivo: "sem_documento_no_panteon", tipo: "ambiguo" };

  const doComprador = vivos.filter((p) => digitos(p.documentoDoComprador) === doPanteon);
  if (doComprador.length === 0) return semCandidatoVivo("pedido_de_outro_comprador");
  // ⚠️ O PEDIDO QUE JÁ É DE OUTRA VENDA DO PANTEON SAI (revisão da F8 de 29/09): o mesmo comprador e o
  // mesmo lote têm a venda antiga (distratada) e a redigitada. Se só sobrar o antigo, a venda nova
  // ainda não foi digitada.
  const doMesmo = outras ? doComprador.filter((p) => !outras.has(p.arId)) : doComprador;
  if (doMesmo.length === 0) return semCandidatoVivo("pedido_de_venda_desfeita");
  if (doMesmo.length > 1) return { motivo: "dois_pedidos", tipo: "ambiguo" };
  const unico = doMesmo[0] as PedidoDoTerreno;
  // ⚠️ NASCEU ANTES DA VENDA: não casa sozinho (o 5032 do VOR Q14 L01, ver o topo). Sem uma das duas
  // datas, a data não decide.
  const nasceu = instante(unico.criadoEm);
  if (daVenda !== null && nasceu !== null && nasceu < daVenda) {
    return { arId: unico.arId, motivo: "pedido_anterior_a_venda", tipo: "ambiguo" };
  }
  return { arId: unico.arId, regra: "terreno_mesmo_comprador", tipo: "elo" };
}
