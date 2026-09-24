import type { EstagioDoTrabalho } from "./trabalhos";

// CANCELAR O CONTRATO PELA TÊMIS — a parte pura, que a tela e o servidor dividem.
//
// Lucas (23/09/2026): *"coloca por favor um botão de cancelamento de contrato na temis. o time vai
// precisar cancelar"*, com o print do contrato da MAURA MARIA PASSOS (Vale do Ouro VOC, Quadra 03
// Lote 06) em "Em assinatura", 1 de 11 assinantes já tendo assinado.
//
// ⚠️ A TELA DO JURÍDICO TINHA UM BOTÃO SÓ, E ELE NÃO CANCELA NADA. "Voltar para análise" devolve o
// card para a etapa anterior para o contrato ser corrigido e reenviado; o que faltava é ENCERRAR a
// vida do contrato. Medido em 23/09/2026: o fluxo de cancelamento existe inteiro e já rodou em
// produção (9 cards concluídos), mas a única porta de ENTRADA dele é a tela Venda do Hércules, que
// exige a sessão do PORTAL (cookie `apolo_inc`). O hub não tem pasta de venda nenhuma: a Nívea e o
// Northon, de dentro da Têmis, não tinham caminho para começar um cancelamento.
//
// ⚠️ ESTE ARQUIVO NÃO IMPORTA NADA DE SERVIDOR, de propósito — o mesmo desenho de
// `conclusao-do-cancelamento.ts`: a tela de trabalho é `"use client"`, e importar o serviço
// arrastaria a Clicksign e o Supabase para o pacote do navegador. As frases moram aqui porque a
// tela ESCREVE o que o servidor VAI FAZER, e duas cópias delas divergiriam no primeiro conserto.

/**
 * AS ETAPAS EM QUE O CONTRATO SE CANCELA DAQUI — as mesmas três em que o "Voltar para análise"
 * aparece hoje.
 *
 * ⚠️ `analise` FICA DE FORA, E NÃO É ESQUECIMENTO. Ali o card já tem saída: o Indeferir devolve a
 * venda de `contrato` para `proposta` (`devolverVendaNoIndeferimento`), e o corretor cancela a
 * proposta no Hércules com um clique, sem passar pelo jurídico. Oferecer o cancelamento do contrato
 * na análise seria matar a venda com o instrumento mais caro quando o mais barato resolve.
 *
 * ⚠️ `faturado` E `indeferido` TAMBÉM FICAM DE FORA. No faturado a venda já foi faturada e o
 * desfazer envolve dinheiro reconhecido (o caminho é o pedido pela tela Venda, que classifica e
 * cobra as declarações do distrato); no indeferido não há contrato de pé para cancelar.
 */
export const MOMENTOS_DE_CANCELAR_O_CONTRATO: readonly EstagioDoTrabalho[] = [
  "contrato",
  "assinatura",
  "prazo_legal",
];

/**
 * Este card oferece o cancelamento do contrato?
 *
 * ⚠️ SÓ O CARD DE TIPO `contrato`. No card de cancelamento ou de distrato quem desfaz a venda é o
 * "Concluir cancelamento" que já existe, e um segundo botão com o mesmo efeito na mesma tela é como
 * a casa acaba com duas réguas para a mesma pergunta.
 */
export function podeCancelarOContrato(tipo: string, estagio: string): boolean {
  return (
    String(tipo ?? "").trim() === "contrato" &&
    (MOMENTOS_DE_CANCELAR_O_CONTRATO as readonly string[]).includes(String(estagio ?? "").trim())
  );
}

/**
 * O mínimo do motivo escrito — o mesmo do pedido pela tela Venda do Hércules.
 *
 * ⚠️ TRÊS CARACTERES NÃO SÃO UMA EXPLICAÇÃO, E AINDA ASSIM O LIMITE É ESTE. Ele é o que a casa já
 * exige no outro caminho do MESMO ato, e um limite maior aqui faria o mesmo cancelamento ser aceito
 * pelo Hércules e recusado pela Têmis. Quem protege o registro é a obrigatoriedade, não o tamanho.
 */
export const MOTIVO_MINIMO_DO_CANCELAMENTO = 3;

export type MotivoConferido =
  | { erro: string; ok: false }
  | { motivo: string; ok: true };

/**
 * O motivo escrito, obrigatório.
 *
 * ⚠️ UM CONTRATO CANCELADO SEM MOTIVO É UMA PERGUNTA SEM RESPOSTA DAQUI A SEIS MESES. Ele é a única
 * frase que explica por que este contrato foi desfeito, e vai para três lugares: a marca do pedido
 * na venda, a observação do card na fila e o histórico do card. Por isso a conferência é do
 * SERVIDOR também, e não só do botão desabilitado na tela.
 */
export function conferirMotivoDoCancelamento(bruto: unknown): MotivoConferido {
  const motivo = String(bruto ?? "").trim();
  if (motivo.length < MOTIVO_MINIMO_DO_CANCELAMENTO) {
    return { erro: "Diga o motivo do cancelamento do contrato.", ok: false };
  }
  return { motivo, ok: true };
}

/**
 * O QUE O BOTÃO VAI FAZER, escrito antes do clique.
 *
 * ⚠️ A PRIMEIRA PALAVRA É "ENCERRA", e é ela que separa este botão do vizinho. Quem já usou a tela
 * aprendeu que a saída de um contrato é "voltar para análise"; ler "encerra" é o que impede o clique
 * automático de quem esperava o conserto.
 */
export const AVISO_DO_CANCELAMENTO_DO_CONTRATO =
  "Isto ENCERRA o contrato, e não é o 'Voltar para análise': a venda é desfeita, a reserva cai e a unidade volta para a disponibilidade se não houver outro dono. Não se desfaz.";

/**
 * O QUE ACONTECE COM O ENVELOPE — a frase que o caso da MAURA (1 de 11 assinado) exige.
 *
 * ⚠️ ELA DIZ AS TRÊS COISAS QUE CUSTAM. Que o envelope morre na Clicksign (senão os outros 10
 * continuariam podendo assinar um contrato cancelado, e a casa ficaria com um documento assinado que
 * não vale); que quem já assinou perde o que assinou; e que o envelope cancelado fica na lista da
 * conta de PRODUÇÃO para sempre. É a gêmea de `AVISO_DA_VOLTA_COM_ENVELOPE`, e pelo mesmo motivo:
 * resumir devolveria a surpresa para depois do clique.
 */
export const AVISO_DO_ENVELOPE_NO_CANCELAMENTO =
  "O envelope é CANCELADO na Clicksign ANTES de a venda cair. Quem já recebeu o convite perde o acesso, quem já assinou terá assinado um contrato que não vale mais, e o envelope cancelado continua na lista da conta para sempre. Se a Clicksign recusar, NADA é cancelado aqui e a tela diz o que aconteceu.";

/**
 * A frase inteira da confirmação, montada pelos fatos que a tela tem.
 *
 * `codigo` é o COD da venda; `envelopeVivo` é a resposta de `envelopeQueSegura` no servidor (a mesma
 * régua da volta), e `null` quer dizer que não há envelope segurando esta venda.
 */
export function avisoDoCancelamentoDoContrato(args: {
  codigo: null | string;
  /** Há envelope vivo? `null` = não; `false` em `conferido` = não deu para perguntar. */
  envelopeVivo: null | { conferido: boolean; estado: string };
}): string {
  const venda = args.codigo ? `A venda ${args.codigo}` : "A venda deste card";
  // ⚠️ LEITURA QUE FALHOU AVISA PELO PIOR CASO, como na volta: `conferido: false` é "o servidor não
  // conseguiu perguntar", e pode haver envelope vivo. A frase neutra ali esconderia o preço.
  const mexeNoEnvelope = Boolean(args.envelopeVivo) && args.envelopeVivo?.estado !== "assinado";
  return [
    `${venda}: ${AVISO_DO_CANCELAMENTO_DO_CONTRATO.charAt(0).toLowerCase()}${AVISO_DO_CANCELAMENTO_DO_CONTRATO.slice(1)}`,
    mexeNoEnvelope ? AVISO_DO_ENVELOPE_NO_CANCELAMENTO : null,
  ]
    .filter(Boolean)
    .join(" ");
}
