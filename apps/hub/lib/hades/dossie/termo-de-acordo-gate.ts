// QUANDO O TERMO DE ACORDO PODE SAIR — e, quando não pode, A FRASE que diz por quê.
//
// O botão "Termo de acordo" mora no card do compromisso (`PropostasPanel.tsx`) e a rota que desenha
// o papel (`app/api/guardian/termo-de-acordo/route.ts`) recusa pelo mesmo motivo. As duas leem ESTE
// arquivo: se a régua morasse duas vezes, a tela acenderia o botão para um acordo que a rota recusa
// (ou o contrário), e o operador clicaria num botão que mente.
//
// ────────────────────────────────────────────────────────────────────────────────────────────
// ⚠️ BOTÃO APAGADO SEM MENSAGEM É DEFEITO. Por isso o gate não devolve `boolean`: devolve a FRASE.
// ────────────────────────────────────────────────────────────────────────────────────────────
//
// O dono do produto cobrou duas vezes (15/09/2026): um botão desabilitado que não diz o motivo faz a
// pessoa achar que o sistema quebrou, e ela abre chamado ou tenta de novo. `null` quer dizer "pode
// emitir"; qualquer texto quer dizer "não pode", e o texto é o que a tela escreve ao lado do botão,
// em uma frase que quem cobra entende sem saber o que é `approval_status`.
//
// ⚠️ SÓ ACORDO APROVADO EMITE, E DESDE 20/09/2026 ESSA RÉGUA TAMBÉM DECIDE O ENVIO PARA ASSINATURA.
// Lucas, nesse dia: *"o acordo so pode ficar disponivel para envio depois da aprovacao"* — e o envio
// chama ESTA função, não uma segunda leitura de `approval_status`
// (`lib/hades/acordo/envio-gate.ts`). Exigir a aprovação é o certo: o termo vai para a assinatura do
// cliente, do incorporador e da Careli, e a mesa do gestor existe exatamente para isso.
//
// ⚠️ E O QUADRO MUDOU. Em 16/09/2026 eram 18 acordos, 14 `pendente`, 4 `reprovado` e ZERO
// `aprovado` — o botão não acendia para ninguém, e foi por isso que a frase nasceu. Medido de novo
// em 20/09/2026: 40 acordos, 18 `aprovado`, 22 `reprovado`, zero pendentes. Ou seja, hoje o botão
// acende em 18 deles e a frase do reprovado é a que os outros 22 leem.
//
// ⚠️ PROMESSA NÃO TEM TERMO. Promessa é "pago dia tal", sem parcelamento nem atualização do débito:
// não há instrumento a assinar. A tela nem desenha o botão para ela; a frase existe para a rota,
// que pode receber o id de uma promessa de quem chamar a API na mão.
//
// ⚠️ ESTE ARQUIVO NÃO IMPORTA NADA EM TEMPO DE EXECUÇÃO, e é de propósito: ele vai para o navegador
// junto do `PropostasPanel`. Puxar daqui o desenho do PDF levaria o `pdf-lib` inteiro para o bundle
// da tela de atendimento só para decidir se um botão acende.

import type { GuardianApprovalStatus } from "@/lib/guardian/compromissos";

/** O que o gate precisa ler do compromisso — o `GuardianCompromissoDetail` serve inteiro. */
export type AcordoParaOGate = {
  acquisitionRequestC2xId: null | number;
  approvalStatus?: GuardianApprovalStatus | null;
  kind: string;
  metadata: Record<string, unknown>;
  parcelas: readonly unknown[];
  status: string;
};

export type SituacaoDaAprovacao = "aprovado" | "elaboracao" | "pendente" | "reprovado";

/**
 * A situação de aprovação como a tela mostra no selo.
 *
 * ⚠️ É A MESMA LEITURA QUE O SELO DO CARD USAVA, AGORA EM UM LUGAR SÓ: a coluna real
 * (`approval_status`, migration 0037) e, só para registro antigo com a coluna indefinida, o
 * `metadata.approval_status` da fase 1. Se o selo dissesse "Aprovada" e o gate lesse outra fonte, o
 * botão apareceria apagado com a frase "aguarda aprovação" embaixo de um selo verde.
 */
export function situacaoDaAprovacao(
  status: GuardianApprovalStatus | null | undefined,
  metadata: Record<string, unknown>,
): SituacaoDaAprovacao {
  const valor = status ?? (metadata.approval_status as string | undefined);
  if (valor === "aprovado" || valor === "reprovado") return valor;
  if (valor === "em_elaboracao" || valor === "elaboracao") return "elaboracao";
  return "pendente";
}

/** As frases, escritas uma vez. O teste cobra cada uma pelo texto. */
export const MOTIVOS_DO_TERMO = {
  cancelado: "Este acordo foi cancelado, então não há termo a emitir.",
  elaboracao: "O termo sai depois que o acordo for enviado e aprovado pelo gestor.",
  pendente: "O termo sai depois que o gestor aprovar este acordo.",
  promessa: "Promessa de pagamento não tem termo de acordo.",
  reprovado: "Este acordo foi reprovado pelo gestor, então não há termo a emitir.",
  semParcelas: "Este acordo não tem parcelas registradas, e o termo precisa delas.",
  semUnidade:
    "Este acordo não diz de qual unidade é (foi montado misturando contratos); refaça o acordo por unidade para emitir o termo.",
} as const;

/**
 * `null` quando o termo pode sair; senão, a frase que a tela escreve ao lado do botão apagado.
 *
 * ⚠️ A ORDEM DAS PERGUNTAS É A ORDEM EM QUE A PESSOA CONSEGUE AGIR. Primeiro o que é definitivo
 * (promessa, cancelado, reprovado), depois o que depende de outra pessoa (a aprovação), e só por
 * último o que é defeito do registro (sem unidade, sem parcelas). Um acordo pendente E sem unidade
 * mostra "aguarda aprovação": é o que o operador vê primeiro, e o gestor reprova o misturado antes
 * de o problema da unidade virar a frase da vez.
 *
 * ⚠️ `SEM UNIDADE` NÃO É HIPÓTESE. Medido de novo em 20/09/2026: 2 dos 40 acordos (AC-000012 e
 * AC-000014) têm `acquisition_request_c2x_id` nulo, nascidos antes de 11/09/2026 juntando parcelas
 * de dois contratos cada — e os dois estão reprovados. Sem a unidade o termo não tem PV nem objeto.
 */
export function motivoParaNaoEmitirOTermo(acordo: AcordoParaOGate): null | string {
  if (acordo.kind !== "acordo") return MOTIVOS_DO_TERMO.promessa;
  if (acordo.status === "cancelado") return MOTIVOS_DO_TERMO.cancelado;

  const situacao = situacaoDaAprovacao(acordo.approvalStatus, acordo.metadata);
  if (situacao === "reprovado") return MOTIVOS_DO_TERMO.reprovado;
  if (situacao === "elaboracao") return MOTIVOS_DO_TERMO.elaboracao;
  if (situacao === "pendente") return MOTIVOS_DO_TERMO.pendente;

  if (!acordo.acquisitionRequestC2xId) return MOTIVOS_DO_TERMO.semUnidade;
  if (acordo.parcelas.length === 0) return MOTIVOS_DO_TERMO.semParcelas;

  return null;
}
