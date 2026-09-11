// O QUE SE PEDIU — o bloco que abre a análise de um cancelamento, distrato ou cessão.
//
// Lucas (10/09/2026), abrindo o card do Otavio: *"agora entendi, não é contrato novo, um
// cancelamento, então faltou o motivo do cancelamento e eu preciso saber o que é, quando abro a
// tela eu não identifiquei que era um cancelamento"*.
//
// ⚠️ O DADO SEMPRE ESTEVE LÁ; A TELA É QUE NÃO PEDIA A COLUNA. `temis_trabalhos.observacao` guarda
// o pedido inteiro desde 08/09 — motivo, contrato, o que o sistema apurou sobre assinatura e
// pagamento, e a classificação que decidiu entre cancelamento e distrato. O `select` da tela de
// trabalho não trazia esse campo, então a etapa 1 mostrava a proposta comercial da venda e mais
// nada: quem abria via um contrato novo, não um pedido de desfazer.
//
// ⚠️ E ISSO É O CORAÇÃO DA ANÁLISE, não um detalhe. Lucas (10/09/2026): *"essa tela é uma tela de
// análise, ou seja, quando for distrato, cancelamento, cessão tem que trazer os dados que devem ser
// analisados"*. Num cancelamento, o que se analisa é o PEDIDO: por que se está desfazendo, se o
// contrato chegou a existir, se houve pagamento — e se o dinheiro volta.

import type { TipoDeTrabalho } from "./trabalhos";

export type ItemDoPedido = { rotulo: string; valor: string };

export type PedidoDoTrabalho = {
  /** Os pedaços que a observação carregava, já separados. Vazio quando o texto é livre. */
  itens: ItemDoPedido[];
  /**
   * O texto como veio, quando não segue o formato do Hércules.
   *
   * ⚠️ TEXTO LIVRE NÃO SE JOGA FORA. Os pedidos abertos pelo coordenador são frases escritas por
   * gente ("cedente pediu transferência para o filho", "inadimplência de 6 parcelas") — e são
   * exatamente o motivo que o operador precisa ler. Um parser que só entende o formato da máquina
   * apagaria da tela o único dado que esses cards têm.
   */
  livre: null | string;
  /** Ninguém registrou o pedido. A tela mostra como pendência, e não como bloco vazio. */
  semRegistro: boolean;
  titulo: string;
};

const TITULO: Record<TipoDeTrabalho, string> = {
  cancelamento: "O pedido de cancelamento",
  cancelamento_correcao: "O pedido de cancelamento por correção",
  cessao: "O pedido de cessão",
  contrato: "O pedido",
  distrato: "O pedido de distrato",
};

/**
 * ⚠️ O SEPARADOR É O ` · ` QUE A ROTA DO HÉRCULES ESCREVE, e o formato está medido, não suposto:
 *
 *   Pedido de cancelamento pela tela Venda do Hércules · COD 000006 · motivo: teste ·
 *   apurado pelo sistema: nenhuma assinatura registrada, nenhum pagamento registrado ·
 *   as assinaturas não fecharam e nada foi pago: o contrato não chegou a se formar
 *
 * (`app/api/incorporador/venda/cancelamento-de-contrato/route.ts`, conferido nos dois cards vivos
 * em 10/09/2026.) Com ajuste manual, a quarta parte vira `AJUSTE MANUAL de Fulano: …`.
 */
const SEPARADOR = " · ";

/**
 * O pedido que abriu este trabalho, pronto para a tela.
 *
 * `null` no tipo `contrato`: ali o "pedido" é a própria proposta, e ela já ocupa a tela inteira
 * logo abaixo. Repetir "Proposta entregue pela tela Venda do Hércules" acima da proposta seria uma
 * linha que não acrescenta nada a quem está olhando para ela.
 */
export function pedidoDoTrabalho(args: {
  observacao: null | string;
  tipo: TipoDeTrabalho;
}): null | PedidoDoTrabalho {
  if (args.tipo === "contrato") return null;

  const titulo = TITULO[args.tipo];
  const texto = String(args.observacao ?? "").trim();

  if (!texto) {
    // ⚠️ A FALTA É INFORMAÇÃO. "Registrar o motivo do distrato" é a primeira atividade do tipo
    // (`ATIVIDADES` em `trabalhos.ts`): um pedido sem motivo registrado é trabalho a fazer, e
    // esconder isso faria a tela parecer completa quando não está.
    return { itens: [], livre: null, semRegistro: true, titulo };
  }

  const itens: ItemDoPedido[] = [];
  const sobrou: string[] = [];

  for (const parte of texto.split(SEPARADOR).map((p) => p.trim()).filter(Boolean)) {
    const item = lerParte(parte);
    if (item) itens.push(item);
    else sobrou.push(parte);
  }

  // ⚠️ A ÚLTIMA PARTE SEM RÓTULO É A CLASSIFICAÇÃO, e ela é a frase mais importante do bloco:
  // é o que decide entre cancelamento e distrato, e se há valor a devolver
  // (`classificarCancelamento`, em `cancelamento.ts`). Ela é escrita sem prefixo, então só se
  // reconhece pela posição — por isso vem depois do laço, e só quando o resto foi entendido.
  if (itens.length > 0 && sobrou.length > 0) {
    itens.push({ rotulo: "Classificação", valor: sobrou[sobrou.length - 1] ?? "" });
  }

  if (itens.length === 0) {
    return { itens: [], livre: texto, semRegistro: false, titulo };
  }

  return { itens, livre: null, semRegistro: false, titulo };
}

/** Uma parte da observação vira item quando tem um prefixo que a nomeia. */
function lerParte(parte: string): ItemDoPedido | null {
  const baixo = parte.toLowerCase();

  if (baixo.startsWith("motivo:")) {
    return { rotulo: "Motivo", valor: primeiraMaiuscula(depoisDe(parte, ":")) };
  }
  if (baixo.startsWith("cod ")) {
    return { rotulo: "Contrato", valor: parte.trim() };
  }
  if (baixo.startsWith("apurado pelo sistema:")) {
    return { rotulo: "Apuração", valor: primeiraMaiuscula(depoisDe(parte, ":")) };
  }
  if (baixo.startsWith("ajuste manual de ")) {
    // ⚠️ AJUSTE MANUAL VAI COM O NOME DE QUEM AJUSTOU, e num rótulo diferente do da apuração
    // automática. A rota já grava a diferença de propósito: o jurídico confere a classificação
    // antes de redigir, e "o sistema apurou" e "alguém corrigiu à mão" pesam diferente.
    return { rotulo: "Ajuste manual", valor: parte.slice("AJUSTE MANUAL de ".length).trim() };
  }
  if (baixo.startsWith("pedido de") && baixo.includes("pela tela")) {
    return { rotulo: "Origem", valor: primeiraMaiuscula(depoisDe(parte, "pela tela")) };
  }

  return null;
}

function depoisDe(texto: string, marca: string): string {
  const onde = texto.toLowerCase().indexOf(marca.toLowerCase());
  return onde < 0 ? texto.trim() : texto.slice(onde + marca.length).trim();
}

function primeiraMaiuscula(texto: string): string {
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : texto;
}
