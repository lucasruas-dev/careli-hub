// EM QUE FILA O ATENDIMENTO NASCE — e por que a fila escolhida na tela tem de ganhar.
//
// Chamado TI-000126, aberto por Northon Nascimento em 21/08/2026, impacto crítico:
// *"Tento chamar o usuário mas vai para os grupos e quando tento abrir novamente, diz que já tem um
// ticket aberto, mas não aparece a conversa."*
//
// ⚠️ A FILA ESCOLHIDA ERA DESCARTADA EM SILÊNCIO. A rota decidia `profileQueue ?? requestedQueue`:
// a fila do ASSUNTO ganhava da fila que a pessoa escolheu. Quando a fila escolhida não tem nenhum
// assunto cadastrado, a tela não manda assunto nenhum, e o servidor caía no assunto padrão do
// sistema — "Primeiro contato", que pertence à fila COBRANÇA. Medido no banco em 21/09/2026: 7 das
// 14 filas ativas não têm assunto (Central de Relacionamento, Contato, Compras, Gente&Cultura,
// Grupo, Antecipação e Supervisionamento), e 71 atendimentos nasceram assim, 29 deles em setembro.
//
// ⚠️ O EFEITO É O ATENDIMENTO SUMIR DA TELA DE QUEM O ABRIU. Cobrança é da central de ATENDIMENTO;
// quem abre pela central de Relacionamento tem a lista recortada por central (`centrais.ts`), então
// o atendimento novo não aparece — e a segunda tentativa é recusada com "já existe ticket aberto".
// É exatamente o relato, ponto a ponto.
//
// ⚠️ E ELE LEVAVA JUNTO O NÚMERO ERRADO. O canal segue a fila; com a fila trocada por baixo dos
// panos, a Central de Relacionamento (Evolution, 7250-6566) voltava a falar pelo 4143 da Meta — e
// com ela voltava a trava da janela de 24h que a 1.349.3 tinha tirado.

/** O que este módulo precisa saber de uma fila. */
export type FilaDaAbertura = {
  id: string;
  slug?: null | string;
};

/** O que este módulo precisa saber de um assunto (perfil de ticket). */
export type AssuntoDaAbertura = {
  id: string;
  queue_id?: null | string;
};

/**
 * A fila em que o atendimento nasce.
 *
 * ⚠️ QUEM ESCOLHEU NA TELA MANDA. O assunto só define a fila quando ninguém pediu fila — é o caso
 * de quem abre pelo Hades ou pelo Apolo mandando só o assunto, onde a fila do assunto É a intenção.
 */
// ⚠️ GENÉRICA DE PROPÓSITO: a fila escolhida devolve TUDO o que a rota leu dela (metadata, canal,
// SLA, prioridade), e um tipo estreito aqui apagaria esses campos no caminho — foi o que o
// typecheck acusou na primeira versão.
export function filaDaAbertura<
  Pedida extends FilaDaAbertura,
  DoAssunto extends FilaDaAbertura,
  Padrao extends FilaDaAbertura,
>(
  filaPedida: null | Pedida | undefined,
  filaDoAssunto: DoAssunto | null | undefined,
  filaPadrao: null | Padrao | undefined,
): DoAssunto | null | Padrao | Pedida {
  return filaPedida ?? filaDoAssunto ?? filaPadrao ?? null;
}

/**
 * O assunto que pode ser gravado num atendimento daquela fila.
 *
 * ⚠️ ASSUNTO DE OUTRA FILA NÃO SERVE, e não é preciosismo: é ele que carrega o SLA, a prioridade e
 * o nome que aparece na tela. Gravar "Primeiro contato" (da Cobrança) num atendimento do
 * Relacionamento faz o ticket prometer o SLA da cobrança e se dizer o que não é. Sem assunto da
 * fila, o atendimento nasce sem assunto e herda o padrão dela, que é a verdade.
 */
export function assuntoParaAFila<Assunto extends AssuntoDaAbertura>(
  assunto: Assunto | null | undefined,
  fila: FilaDaAbertura | null | undefined,
): Assunto | null {
  if (!assunto) return null;
  if (!fila) return assunto;
  const daFila = (assunto.queue_id ?? "").trim();
  return daFila === "" || daFila === fila.id ? assunto : null;
}
