// Texto e botões do template do CONVITE da ação, num só lugar: a rota que CRIA o template na Meta e
// o disparo (que precisa do texto renderizado para mostrar a mensagem na conversa do atendimento).
// Ver [[project_apolo_acao_contato]].

export const NOME_TEMPLATE_CONVITE = "convite_vale_ouro";
export const BOTOES_CONVITE = ["1 unidade", "2 a 3", "acima de 3"];

// {{1}} = primeiro nome do cliente. Termina com texto real (a Meta recusa body que fecha numa {{n}}).
export const TXT_CONVITE =
  "Olá {{1}}! 🏡\n" +
  "Nós do time do *Vale do Ouro* ficamos muito felizes com o seu interesse. O convite pro grande dia está aí em cima: *sábado, 01 de agosto*, credenciamento até *8h30*.\n" +
  "Estaremos ansiosos para recebê-lo(a)! Qualquer dúvida, é só falar por aqui. Antes, uma pergunta rápida: quantas unidades você pretende adquirir?";

// O texto que vai na CONVERSA do atendimento (o {{1}} já resolvido com o primeiro nome).
export function renderConvitePreview(primeiroNome: string): string {
  return TXT_CONVITE.replace("{{1}}", primeiroNome || "tudo bem");
}
