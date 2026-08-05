// O tópico do canal Realtime da fila de um evento. Puro (sem deps de servidor) porque é usado
// dos DOIS lados: o servidor faz broadcast nele quando alguém é chamado, e a tela do cliente
// (pública, anon) o assina para reagir na hora. Ver [[project_prometeu_tela_cliente]].
export function topicoDaFila(eventoId: string): string {
  return `prometeu:fila:${eventoId}`;
}

// Evento de broadcast: a fila mudou (alguém foi chamado). Quem recebe faz um refresh imediato.
export const EVENTO_CHAMADO = "chamado";

// Comando do MAESTRO para os telões (música/vídeo de fundo sincronizado em todas as TVs).
// Mesmo tópico da fila — os telões já estão inscritos nele; só o event name difere.
export const EVENTO_PALCO = "palco";
