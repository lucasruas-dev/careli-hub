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

// ⚠️ E FALTAVA A FONTE QUE O PRÓPRIO PANTEON ESCREVE — o defeito mais caro deste arquivo, e ele é
// anterior à Têmis assinar contrato nenhum. As duas fontes acima são do C2X: `data_assinatura` só é
// preenchida na carga do legado e `hercules_proposta_eventos` só é escrita por ela. Uma venda que
// nasceu aqui, cujo contrato a Têmis mandou para a Clicksign e cujos DOIS compradores assinaram,
// continuava respondendo "nenhuma assinatura registrada" — e o pedido de cancelamento saía
// classificado como CANCELAMENTO, sobre um contrato assinado por todos.
//
// ⚠️ ESCRITO COM TODAS AS LETRAS, porque é disto que depende a regra que o Lucas fechou em
// 12/09/2026 (*"se ele estiver todo assinado tem que fazer distrato"*): sem o envelope aqui, um
// contrato assinado no Panteon seria cancelado como se nunca tivesse existido — sem distrato, sem
// apuração do que devolver e sem devolução ao cliente. A assinatura existe, está na Clicksign, e o
// único lugar do nosso lado que sabe disso é `temis_envelopes.estado = "assinado"`.

/** Um evento da proposta, como ele chega de `hercules_proposta_eventos`. */
export type EventoDoContrato = { tipo: string; valor?: null | number | string };

/**
 * O envelope da Têmis desta proposta, como ele está em `temis_envelopes`.
 *
 * `estado` é a palavra da casa (`EstadoDaAssinatura`), escrita pelo webhook da Clicksign; só
 * `assinado` conta — `parcial` é meio contrato assinado, e meio contrato assinado não vira distrato.
 * `fechado_em` é carimbado na mesma escrita que leva o estado a terminal (`estado-db.ts`).
 */
export type EnvelopeDoContrato = {
  estado?: null | string;
  fechado_em?: null | string;
};

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
 *
 * ⚠️ `envelope` É OPCIONAL NA ASSINATURA E OBRIGATÓRIO NA PRÁTICA. Ele é opcional para não quebrar
 * quem chama, mas quem apura o fato de uma venda NATIVA e não o passa está perguntando só ao C2X —
 * que nunca ouviu falar desta venda — e vai receber "não assinou" sobre um contrato assinado. Quem
 * lê `temis_envelopes` é o chamador, porque esta função é pura de propósito.
 */
export function apurarFatosDoContrato(
  eventos: EventoDoContrato[],
  datas: DatasDoContrato,
  envelope?: EnvelopeDoContrato | null,
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

  // ⚠️ SÓ `assinado` CONTA, e a comparação é com a palavra da casa gravada pelo webhook. `parcial`
  // é UM comprador de dois: pela regra do Lucas (12/09/2026) esse contrato ainda VOLTA para a
  // análise, e tratá-lo como completo empurraria para o distrato uma venda que só precisava de
  // correção.
  const envelopeAssinado = String(envelope?.estado ?? "").trim().toLowerCase() === "assinado";
  const fechadoEm = envelopeAssinado ? texto(envelope?.fechado_em) : null;

  const assinaturaCompleta = assinaturas.length > 0 || Boolean(dataAssinatura) || envelopeAssinado;
  // ⚠️ O FATURAMENTO CONTA COMO PAGAMENTO. Uma venda faturada passou pelo caixa; tratá-la como não
  // paga faria o jurídico cancelar sem apurar o que devolver.
  const houvePagamento = pagamentos.length > 0 || Boolean(dataAto) || Boolean(dataFaturamento);

  return {
    assinaturaCompleta,
    comoSoube: {
      // ⚠️ AS FONTES ANTIGAS CONTINUAM FALANDO PRIMEIRO, e isso é conservadorismo, não descuido: as
      // vendas importadas do C2X já são descritas por elas há meses, e o envelope entrou aqui para
      // quebrar o SILÊNCIO das nativas, não para reescrever o que já tinha resposta.
      assinatura: assinaturas.length
        ? `${assinaturas.length} ${assinaturas.length === 1 ? "assinatura registrada" : "assinaturas registradas"}`
        : dataAssinatura
          ? `contrato assinado em ${diaEscrito(dataAssinatura)}`
          : envelopeAssinado
            ? // ⚠️ A FRASE DIZ DE ONDE VEIO. Quem lê a modal precisa saber que a prova não está no
              // Panteon nem no C2X: ela está na Clicksign, e é lá que se confere o documento
              // assinado antes de assumir um distrato.
              fechadoEm
              ? `contrato assinado por todos na Clicksign em ${diaDoInstante(fechadoEm)}`
              : "contrato assinado por todos na Clicksign"
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

/**
 * O DIA DE UM INSTANTE, no fuso da casa.
 *
 * ⚠️ ELE É O CONTRÁRIO DE `diaEscrito`, E OS DOIS ESTÃO CERTOS. As datas do C2X são dia PELADO
 * ("2026-08-14"), e transformá-las em `Date` deslocaria o dia; `fechado_em` é um INSTANTE com fuso,
 * gravado em UTC — cortar os dez primeiros caracteres diria 12/09 para um contrato que fechou às
 * 21h30 do dia 11 em Brasília. Instante se converte; dia pelado, não.
 *
 * Valor ilegível sai como ele mesmo: melhor a string crua do que uma data inventada num texto que
 * o jurídico vai ler.
 */
function diaDoInstante(iso: string): string {
  const data = new Date(iso);
  return Number.isNaN(data.getTime())
    ? iso
    : data.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

/** "2026-09-10" → "10/09/2026". Data curta não vira `Date`: fuso deslocaria o dia. */
function diaEscrito(iso: string): string {
  const partes = iso.slice(0, 10).split("-");
  const [ano, mes, dia] = partes;
  return ano && mes && dia ? `${dia}/${mes}/${ano}` : iso;
}
