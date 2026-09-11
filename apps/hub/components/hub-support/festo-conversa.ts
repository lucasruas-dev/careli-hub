// O QUE O FESTO FALA NO BALÃO — e o que ele NÃO fala ali.
//
// Lucas (11/09/2026): *"ae pode ter varias mensagens, já tomou agua hoje? não esqueça de fazer um
// alongamento, ou seja, esse tipo de interação"* e, logo depois, *"não queria que fosse a mesma
// mensagem"*.
//
// ⚠️ O BALÃO É RECADO CURTO; O ATENDIMENTO É O CHAT. Correção do Lucas no mesmo dia, olhando um
// balão com diagnóstico técnico dentro: *"isso aqui é dentro do chat"*. A regra que ficou: o balão
// cutuca, chama e faz companhia — qualquer conteúdo de atendimento (o que ele descobriu, o que
// precisa de você, a devolutiva) vai para a conversa, onde fica registrado. Balão some em segundos;
// atendimento não pode sumir.
//
// ⚠️ E A FREQUÊNCIA É O QUE SEPARA CARINHO DE IRRITAÇÃO. Foi assim que o Clippy virou piada: não
// pelo que dizia, mas por quantas vezes. Aqui o espontâneo fala 2 a 3 vezes por dia — raro o
// bastante para ser lido quando aparecer, que é o que importa no dia em que o recado for sério.

/** Quanto tempo o Festo fica calado entre uma fala espontânea e outra. */
export const DESCANSO_ENTRE_FALAS_MS = 3 * 60 * 60 * 1000;

/**
 * As falas espontâneas.
 *
 * ⚠️ SORTEIO SEM REPETIÇÃO, e não sorteio simples: é a diferença entre baralho e dado. Dizer "já
 * tomou água?" duas vezes seguidas destrói a ilusão de que há alguém ali — e a partir daí a pessoa
 * para de ler o balão, inclusive quando ele traz algo que importa.
 */
export const FALAS_DO_FESTO: readonly string[] = [
  "Já tomou água hoje?",
  "Bebe uma água, vai. Faz diferença.",
  "Copo vazio aí do lado? Enche.",
  "Que tal um alongamento? Leva dois minutos.",
  "Estica os ombros, eu espero.",
  "Roda o pescoço devagar. Melhora.",
  "Levanta um pouco. Eu fico de olho aqui.",
  "Dá uma volta rápida, o sistema não foge.",
  "Descansa a vista: olha pra longe uns 20 segundos.",
  "Pisca mais. Tela resseca o olho.",
  "Respira fundo três vezes. Sério.",
  "Ajeita a postura aí, eu vi você curvado.",
  "Alonga o punho, quem digita o dia todo agradece.",
  "Mexe os dedos, é rápido.",
  "Olha pela janela um pouco.",
  "Levanta e olha alguma coisa verde. Ajuda a vista.",
  "Tá com fome? Come alguma coisa antes de continuar.",
  "Lanche da tarde é estratégia, não preguiça.",
  "Se o dia tá pesado, resolve uma coisa pequena primeiro.",
  "Uma tarefa por vez. Eu espero.",
  "Já salvou o que estava fazendo?",
  "O que não foi salvo não existe. Só lembrando.",
  "Se algo parecer errado, me avisa antes de recarregar.",
  "Viu um erro estranho? Tira print que eu leio.",
  "Tô por aqui se precisar.",
  "Qualquer coisa, é só me chamar.",
];

/** As do começo do dia. Separadas porque "bom dia" às 16h é pior do que não falar nada. */
export const FALAS_DA_MANHA: readonly string[] = [
  "Bom dia! Começando por onde hoje?",
  "Bom dia. Café já?",
  "Dia novo. Vamos nessa.",
];

export const FALAS_DA_TARDE: readonly string[] = [
  "Voltou do almoço? Bebe uma água antes.",
  "Boa tarde. Como foi a manhã?",
  "Metade do dia foi. Tá indo bem?",
];

export const FALAS_DA_NOITE: readonly string[] = [
  "Tá tarde. Amanhã o sistema continua aqui.",
  "Ainda por aí? Amanhã também é dia.",
  "Última hora. Quer fechar alguma coisa?",
];

/** As saudações do passar o mouse — curtas, porque o balão some em 3 segundos. */
export const SAUDACOES: readonly string[] = [
  "Oi! Precisa de ajuda?",
  "Oi! Travou alguma coisa?",
  "Oi! Me conta o que houve.",
  "Oi! Estou por aqui.",
];

/**
 * Sorteia sem repetir enquanto houver carta no baralho.
 *
 * ⚠️ `jaDitas` ENTRA E SAI, em vez de virar estado escondido aqui dentro: quem chama é que sabe se
 * a memória vale para a aba, para o dia ou para sempre. Uma lista global neste módulo perderia o
 * controle disso no primeiro lugar que reusasse a função.
 */
export function sortearSemRepetir(
  opcoes: readonly string[],
  jaDitas: readonly string[],
): { escolhida: string; jaDitas: string[] } {
  const restam = opcoes.filter((o) => !jaDitas.includes(o));
  // Baralho acabou: embaralha de novo. É o único momento em que uma fala pode voltar.
  const baralho = restam.length > 0 ? restam : [...opcoes];
  const escolhida = baralho[Math.floor(Math.random() * baralho.length)] ?? opcoes[0] ?? "";
  return {
    escolhida,
    jaDitas: restam.length > 0 ? [...jaDitas, escolhida] : [escolhida],
  };
}

/** A fala certa para a hora do dia. Fora das faixas, cai no catálogo geral. */
export function falasDaHora(hora: number): readonly string[] {
  if (hora >= 6 && hora < 11) return FALAS_DA_MANHA;
  if (hora >= 13 && hora < 15) return FALAS_DA_TARDE;
  if (hora >= 19 || hora < 6) return FALAS_DA_NOITE;
  return FALAS_DO_FESTO;
}
