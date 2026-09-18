// ABRIR ATENDIMENTO POR UMA FILA QUE NÃO FALA PELA META.
//
// Lucas (18/09/2026): *"A janela tem que existir somente para o canal de atendimento, 4143, o canal
// do relacionamento o número está rodando fora da meta"*.
//
// ⚠️ A JANELA DE 24H É REGRA DA META, NÃO DO WHATSAPP. Ela existe porque a API oficial só deixa
// escrever livre para quem falou com o número nas últimas 24h. A Central de Relacionamento fala pela
// Evolution (canal `whatsapp-relacionamento`, provider `evolution`, sem `external_account_id`), onde
// essa regra não existe. O modal já sabia disso e dizia "não precisa de template. É só abrir e
// escrever"; a rota de tickets não sabia, e respondia 409 "Janela de 24h fechada" no mesmo clique.
//
// ⚠️ E A ROTA NEM CHEGAVA AO CANAL CERTO. As buscas de canal dela filtram `provider = 'meta'`, então
// a fila ligada à Evolution caía no número padrão (4143). Medido em 18/09/2026: dos 1.237 tickets da
// fila Central de Relacionamento, NENHUM foi aberto pelo modal. Todos nasceram de mensagem recebida
// pela Evolution. Abrir atendimento por essa fila nunca funcionou.

/** A marca que faz a Iris tratar o ticket como conversa 1:1 da Evolution. */
export const ORIGEM_DO_TICKET_DIRETO = "whatsapp-direct";

/**
 * O canal cadastrado da fila fala fora da Meta?
 *
 * Canal ausente conta como Meta: a fila sem canal cai no número padrão, que é da Meta, e afrouxar
 * aí deixaria passar um envio que a Meta recusaria. É a mesma regra do modal
 * (`filaForaDaMeta`, iris-start-attendance-modal.tsx).
 */
export function canalForaDaMeta(
  canal: { provider?: null | string } | null | undefined,
): boolean {
  return (canal?.provider ?? "").trim().toLowerCase() === "evolution";
}

export type DecisaoDaAbertura = {
  /** Recusar a abertura com 409, pedindo template. */
  bloquearPorJanela: boolean;
  /** Mandar o template da Meta na abertura. */
  enviarTemplate: boolean;
};

/**
 * O que a abertura faz com a janela de 24h.
 *
 * ⚠️ FORA DA META NÃO HÁ TEMPLATE NEM TRAVA, mesmo que a tela mande um template: template é objeto
 * da Meta, e mandá-lo aqui sairia pelo número 4143, que não é o da fila.
 */
export function decidirAbertura({
  foraDaMeta,
  janelaAberta,
  pediuTemplate,
}: {
  foraDaMeta: boolean;
  janelaAberta: boolean;
  pediuTemplate: boolean;
}): DecisaoDaAbertura {
  if (foraDaMeta) {
    return { bloquearPorJanela: false, enviarTemplate: false };
  }

  return {
    bloquearPorJanela: !pediuTemplate && !janelaAberta,
    enviarTemplate: pediuTemplate && !janelaAberta,
  };
}

/**
 * A origem gravada no ticket novo.
 *
 * ⚠️ FORA DA META O TICKET NASCE COMO O PROCESSADOR DA EVOLUTION O CRIA, com a marca de conversa
 * direta e o telefone em `source_entity_id`. São três leitores que dependem disso:
 *   • a tela (`isDirect`, iris-data-client.ts) só libera o envio sem janela com essa marca;
 *   • o envio direto (group-messages/route.ts) recusa ticket sem ela e usa o telefone daqui;
 *   • a resposta do cliente só cai neste ticket se o processador da Evolution achar a marca
 *     (`ensureOpenDirectTicket`, evolution-inbound-processor.ts); sem ela, abriria um segundo.
 *
 * O vínculo com o Apolo não se perde: a entidade continua em `source_context.apoloEntityId`, e a
 * timeline do cliente acha os tickets pelo telefone do contato, não pela origem.
 */
export function origemDoTicket({
  foraDaMeta,
  sourceEntityId,
  sourceEntityType,
  telefone,
}: {
  foraDaMeta: boolean;
  sourceEntityId: null | string;
  sourceEntityType: string;
  telefone: string;
}): { sourceEntityId: null | string; sourceEntityType: string } {
  return foraDaMeta
    ? { sourceEntityId: telefone, sourceEntityType: ORIGEM_DO_TICKET_DIRETO }
    : { sourceEntityId, sourceEntityType };
}
