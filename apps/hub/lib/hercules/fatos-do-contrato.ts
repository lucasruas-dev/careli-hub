// O QUE O SISTEMA SABE SOBRE ESTE CONTRATO — assinou? pagou?
//
// Lucas (06/09/2026), vendo a modal perguntar as duas coisas: *"essas informações do cancelamento
// de contrato é o sistema que tem que saber e dar opção com base nisso, não é o usuário que faz"*.
//
// ⚠️ ELE ESTÁ CERTO, E EU TINHA ESCOLHIDO O CAMINHO ERRADO. A primeira versão perguntava porque
// "não existe fonte confiável": `hercules_proposta_eventos` só é escrita pela carga do C2X, e a
// venda nativa nasce com zero eventos. Só que "zero eventos" NÃO é ignorância — é resposta. Uma
// venda que nasceu aqui ontem, cuja minuta a Têmis ainda nem gera e cujo primeiro vencimento é
// dia 10, não tem assinatura nem pagamento, e o sistema sabe disso com a mesma certeza com que
// sabe o valor negociado. Transformar isso em pergunta era passar para o coordenador uma conta que
// a máquina já tinha feito — e ainda por cima aceitar a resposta dele como verdade.
//
// ⚠️ E A APURAÇÃO É CONSERVADORA NOS DOIS SENTIDOS. Achar assinatura ou pagamento onde não há
// levaria a um distrato desnecessário; NÃO achar onde há levaria a cancelar sem devolver dinheiro
// do cliente, que é o erro caro. Por isso qualquer sinal conta como "sim": um evento, uma data
// preenchida, um faturamento. O silêncio das duas fontes é que vira "não".

/** Um evento da proposta, como ele chega de `hercules_proposta_eventos`. */
export type EventoDoContrato = { tipo: string; valor?: null | number | string };

/** As datas que a própria proposta carrega. */
export type DatasDoContrato = {
  /** Quando o contrato foi assinado — preenchida na carga do C2X. */
  data_assinatura?: null | string;
  /** O ato PAGO. Diferente de `primeiro_sinal`, que é a data prevista da primeira parcela. */
  data_ato?: null | string;
  /** Faturamento emitido: só acontece depois de o contrato estar de pé. */
  data_faturamento?: null | string;
};

export type FatosApurados = {
  assinaturaCompleta: boolean;
  /** A frase que a tela mostra em vez da pergunta: o que foi encontrado, e onde. */
  comoSoube: { assinatura: string; pagamento: string };
  houvePagamento: boolean;
};

/**
 * Os dois fatos, lidos do que está gravado.
 *
 * ⚠️ `primeiro_sinal` NÃO ENTRA, e é a armadilha óbvia desta função: ele é a data PREVISTA da
 * primeira parcela da entrada — nas três vendas nativas de hoje ele vale 10/09/2026, uma data no
 * futuro. Lê-lo como pagamento classificaria como distrato com devolução toda venda recém-criada,
 * devolvendo dinheiro que ninguém pagou.
 */
export function apurarFatosDoContrato(
  eventos: EventoDoContrato[],
  datas: DatasDoContrato,
): FatosApurados {
  // ⚠️ APARA ANTES DE COMPARAR. O tipo vem de carga de planilha e de import do legado; um espaço
  // sobrando faria um pagamento REAL contar como inexistente — e o erro dessa direção é o caro:
  // cancelar sem devolver dinheiro do cliente.
  const tipoDe = (e: EventoDoContrato) => String(e.tipo ?? "").trim().toLowerCase();
  const assinaturas = eventos.filter((e) => tipoDe(e) === "assinatura");
  const pagamentos = eventos.filter((e) => tipoDe(e) === "pagamento");

  const dataAssinatura = texto(datas.data_assinatura);
  const dataAto = texto(datas.data_ato);
  const dataFaturamento = texto(datas.data_faturamento);

  const assinaturaCompleta = assinaturas.length > 0 || Boolean(dataAssinatura);
  // ⚠️ O FATURAMENTO CONTA COMO PAGAMENTO. Uma venda faturada passou pelo caixa; tratá-la como não
  // paga faria o jurídico cancelar sem apurar o que devolver.
  const houvePagamento = pagamentos.length > 0 || Boolean(dataAto) || Boolean(dataFaturamento);

  return {
    assinaturaCompleta,
    comoSoube: {
      assinatura: assinaturas.length
        ? `${assinaturas.length} ${assinaturas.length === 1 ? "assinatura registrada" : "assinaturas registradas"}`
        : dataAssinatura
          ? `contrato assinado em ${diaEscrito(dataAssinatura)}`
          : "nenhuma assinatura registrada",
      pagamento: pagamentos.length
        ? `${pagamentos.length} ${pagamentos.length === 1 ? "pagamento registrado" : "pagamentos registrados"}`
        : dataAto
          ? `ato pago em ${diaEscrito(dataAto)}`
          : dataFaturamento
            ? `faturada em ${diaEscrito(dataFaturamento)}`
            : "nenhum pagamento registrado",
    },
    houvePagamento,
  };
}

function texto(valor: null | string | undefined): null | string {
  const t = String(valor ?? "").trim();
  return t || null;
}

/** "2026-09-10" → "10/09/2026". Data curta não vira `Date`: fuso deslocaria o dia. */
function diaEscrito(iso: string): string {
  const partes = iso.slice(0, 10).split("-");
  const [ano, mes, dia] = partes;
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}
