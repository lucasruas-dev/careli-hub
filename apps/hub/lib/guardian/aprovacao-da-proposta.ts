// Quem precisa passar pela mesa do gestor, e quem não precisa.
//
// Regra do Lucas (14/09/2026): "está caindo para aprovação promessas de pagamento, não
// precisa, somente os ACORDOS devem ser direcionados para aprovação". Até aqui
// `createGuardianCompromisso` carimbava "pendente" sem olhar o tipo — o comentário do
// código dizia "Toda proposta nasce ENVIADA pra aprovacao do Admin".
//
// ⚠️ APROVADA NO NASCIMENTO NÃO É APROVADA POR ALGUÉM, e a diferença importa: `approved_at`
// e `approved_by_user_id` ficam NULOS na promessa, porque decisão nenhuma foi tomada. Zero é
// decisão, nulo é esquecimento — aqui o nulo diz, com todas as letras, que ninguém decidiu.
//
// ⚠️ E ISSO TEM UM MOTIVO PRÁTICO: a aprovação é a ÚNICA trava antes do WhatsApp automático
// sair (lib/guardian/regua-cron.ts:179-188 pula todo compromisso que não esteja "aprovado").
// Se a promessa nascesse aprovada E a régua continuasse olhando só o status, ela passaria a
// disparar mensagem para cliente sozinha — efeito que o Lucas não pediu. Por isso a régua
// passa a exigir `approved_at`: decisão humana tomada, não estado herdado do nascimento.

import type { GuardianApprovalStatus } from "./compromissos";

export type CarimboDeAprovacao = {
  approval_status: GuardianApprovalStatus;
  approved_at: string | null;
  approved_by_user_id: string | null;
  submitted_at: string | null;
};

// ⚠️ A LISTA É DE QUEM DISPENSA, NÃO DE QUEM EXIGE. Um tipo novo de proposta que aparecesse
// aqui amanhã cairia no lado seguro (exige aprovação): entrar na fila à toa aborrece, passar
// direto é dinheiro saindo sem ninguém ver.
const DISPENSAM_APROVACAO = new Set(["promessa"]);

export function precisaDeAprovacao(kind: string): boolean {
  return !DISPENSAM_APROVACAO.has((kind ?? "").trim().toLowerCase());
}

export function carimboAoCriar(
  kind: string,
  agoraIso: string,
): CarimboDeAprovacao {
  if (precisaDeAprovacao(kind)) {
    return {
      approval_status: "pendente",
      approved_at: null,
      approved_by_user_id: null,
      submitted_at: agoraIso,
    };
  }

  // Nasce aprovada porque não precisava de aprovação — e não porque alguém aprovou.
  // `submitted_at` também fica nulo: não houve submissão a mesa nenhuma.
  return {
    approval_status: "aprovado",
    approved_at: null,
    approved_by_user_id: null,
    submitted_at: null,
  };
}

// ⚠️ AS COLUNAS QUE A TRAVA PRECISA LER, em um lugar só. Quem consultar o compromisso para
// decidir disparo TEM que trazer estas — eu mesmo esqueci `approved_at` no select da régua e
// a trava passaria a barrar TUDO, em silêncio, inclusive acordo legitimamente aprovado.
export const COLUNAS_DA_TRAVA = ["approval_status", "approved_at"] as const;

export function podeDispararLembrete(compromisso: {
  approval_status?: string | null;
  approved_at?: string | null;
}): { motivo: string; pode: boolean } {
  const status = String(compromisso.approval_status ?? "").trim().toLowerCase();

  if (status === "reprovado") {
    return { motivo: "proposta reprovada", pode: false };
  }

  if (status !== "aprovado") {
    return { motivo: `aprovacao ${status || "ausente"}`, pode: false };
  }

  // A trava que segura a promessa nascida aprovada: sem carimbo de decisão, ninguém
  // conferiu, e mensagem para cliente não se desfaz.
  if (!compromisso.approved_at) {
    return { motivo: "sem decisao humana registrada", pode: false };
  }

  return { motivo: "aprovado", pode: true };
}
