// QUEM FEZ A TRANSFERÊNCIA — a linha de autoria da pílula cinza da conversa.
//
// Chamado TI-000059, aberto pela operação: *"Precisamos que apareça quem foi o responsável pela
// transferência na Iris, pra sabermos exatamente quem fez a operação"*.
//
// ⚠️ O DADO NUNCA FALTOU: A TELA É QUE JOGAVA FORA. Medido no banco em 21/09/2026: as 2.521
// mensagens de transferência da Iris têm `provider_payload.operatorLabel` preenchido — 100% delas,
// desde 28/06/2026 —, e `mapMessageRow` já transforma isso em `senderLabel` antes de entregar à
// tela. A conversa mostrava só o corpo ("Transferencia registrada: Atendimento -> Cobrança.
// Motivo: …"), que cita a fila de origem, a de destino e o motivo, e nunca quem clicou. O cartão de
// nota interna, no mesmo arquivo, já mostrava autor e hora.
//
// ⚠️ POR ISSO O CONSERTO É NA TELA, E NÃO NO TEXTO DA MENSAGEM. Mudar o texto no servidor só valeria
// para transferência nova; lido daqui, o histórico inteiro passa a dizer quem fez — inclusive as 669
// transferências manuais e as 1.852 da Cacá que já estão gravadas.
//
// ⚠️ E A MÁQUINA SE IDENTIFICA COM O PRÓPRIO NOME. A transferência automática grava "Cacá" no mesmo
// campo (`meta-inbound-processor.ts`), então quem lê a conversa distingue "a Cacá passou para o
// Atendimento" de "a Beatriz passou para a Cobrança" sem precisar saber o que é `actor_type`.
//
// ⚠️ A REGRA VIVE AQUI PORQUE SÃO DUAS TELAS. A conversa do hub (`IrisPage`) e a do celular
// (`app/m/iris/[ticketId]`) desenham a mesma pílula em lugares diferentes; a linha de autoria sai
// igual nas duas porque as duas chamam esta função.

/** O pedaço da mensagem que interessa aqui. A tela passa o que já tem em mãos. */
export type MensagemDaPilula = {
  createdAt?: null | string;
  senderLabel?: null | string;
};

/**
 * A linha de autoria: "Beatriz Araújo · 17/09/2026 16:32".
 *
 * Devolve `null` quando não há nem nome nem data — pílula sem nada a acrescentar fica como está.
 *
 * ⚠️ SEM NOME NÃO SE INVENTA "OPERADOR". A nota interna pode cair no genérico porque ali sempre há
 * uma pessoa; aqui não: "Mensagem system recebida pelo WhatsApp" nasce sem autor nenhum (7 casos
 * medidos em produção), e escrever "Operador" nelas seria afirmar que alguém agiu. Nesse caso sobra
 * a hora, que é verdade e já ajuda.
 */
export function autoriaDaPilula(
  mensagem: MensagemDaPilula,
  formatarQuando: (valor: string) => string,
): null | string {
  const nome = (mensagem.senderLabel ?? "").trim();
  const iso = (mensagem.createdAt ?? "").trim();
  const formatado = iso === "" ? "" : formatarQuando(iso).trim();
  // ⚠️ "-" É O VAZIO DA TELA, e não uma data. `formatDateTime` do IrisPage devolve o traço para data
  // ausente ou inválida; deixá-lo passar imprimiria "Beatriz Araújo · -" na conversa.
  const quando = formatado === "-" ? "" : formatado;

  if (nome !== "" && quando !== "") return `${nome} · ${quando}`;
  if (nome !== "") return nome;
  return quando === "" ? null : quando;
}
