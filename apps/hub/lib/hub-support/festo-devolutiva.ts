import { completeWithClaude, resolveClaudeModel } from "@/lib/ai/claude";
import {
  registrarDevolutivaDoFesto,
  type ResumoParaDevolutiva,
} from "@/lib/hub-it-tickets/server";

// A DEVOLUTIVA — o Festos volta para contar o que foi feito.
//
// Lucas (11/09/2026): *"também gosto que a forma que ele devolveu o ticket da pessoa, ele pode
// falar o que foi feito e tal"* e *"eu não quero ficar parando respondendo usuario se foi resolvido
// ou não, devolver ele retorna ao usuario"*.
//
// ⚠️ O QUE ISTO RESOLVE É UM PROBLEMA DE TRADUÇÃO, e não de aviso. O aviso já existia: quando um
// chamado vai para validação, a pessoa é notificada. O que ela lê é o `resolution_summary`, escrito
// por quem consertou, para quem consertou — "ajustado o gate de papel na rota do incorporador".
// Quem abriu o chamado não sabe o que é um gate de papel, não sabe se aquilo é o problema dela, e
// no fim não responde. São 107 dos 116 chamados fechados pela rotina de 3 dias por falta de
// resposta: o silêncio do usuário é, em boa parte, silêncio de quem não entendeu a resposta.
//
// ⚠️ E ELA NÃO SUBSTITUI A RESPOSTA DE QUEM ATENDEU. O `resolution_summary` continua lá, inteiro,
// assinado por quem escreveu. Isto é uma segunda fala, do Festos, em cima daquela — e é por isso
// que ela entra como evento dele, e não como resposta administrativa.

/**
 * ⚠️ O TIER BARATO, e de propósito. Traduzir um parágrafo técnico em duas frases de gente é a
 * tarefa mais fácil que este agente tem, e ela roda em TODO chamado que chega a validação, fora do
 * caminho da resposta. Gastar o modelo de conversa aqui seria pagar caro pelo que o barato faz
 * igual.
 */
const TIER_DA_DEVOLUTIVA = "default" as const;

const COMO_DEVOLVER = [
  "Voce e o Festos, o suporte ao usuario interno do Panteon, o sistema da Careli.",
  "Alguem do time abriu um chamado e a equipe tecnica acabou de trabalhar nele. Sua tarefa e contar isso para quem abriu.",
  "",
  "ESCREVA:",
  "- 2 a 4 linhas, em portugues do Brasil, falando com a pessoa pelo primeiro nome.",
  "- Comece pelo que MUDOU para ela, nao pelo que foi feito por dentro.",
  "- Traduza o texto tecnico: nada de nome de arquivo, rota, tabela, variavel, migration, versao de codigo ou jargao.",
  "- Termine perguntando se resolveu, e diga que ela pode responder ali mesmo no chamado.",
  "",
  "NAO FACA:",
  "- Nao invente o que nao esta no resumo tecnico. Se o resumo for vago, diga que o time mexeu naquilo e peca para ela conferir.",
  "- Nao prometa prazo, nem diga que outra coisa tambem foi corrigida.",
  "- Nao use markdown, asterisco, titulo nem lista. Texto corrido.",
  "- Nao se despeca com formalidade de protocolo ('atenciosamente', 'cordialmente').",
].join("\n");

/**
 * Traduz o que a equipe fez e devolve para quem abriu o chamado.
 *
 * ⚠️ NUNCA LANÇA. É chamada por `after()`, depois que a resposta já foi para quem atendeu: uma
 * falha aqui não pode derrubar a atualização do chamado, que já está gravada. Devolve `false`
 * quando não deu para devolver, e o chamado segue exatamente como estava.
 */
export async function devolverAoUsuarioComOFesto(
  protocolo: string,
  resumo: ResumoParaDevolutiva,
): Promise<boolean> {
  try {
    // Sem resumo técnico não há o que traduzir — e inventar uma devolutiva por cima de nada é
    // pior que ficar calado: a pessoa responderia "não resolveu" a uma resposta que não existiu.
    if (!resumo.resumoDaResolucao?.trim()) {
      return false;
    }

    const completion = await completeWithClaude({
      maxTokens: 700,
      messages: [
        {
          content: [
            `Primeiro nome de quem abriu: ${primeiroNome(resumo.quemAbriu)}`,
            `Titulo do chamado: ${resumo.titulo}`,
            `O que a pessoa relatou: ${resumo.relato}`,
            `O que a equipe registrou como resolucao: ${resumo.resumoDaResolucao}`,
            resumo.respostaAoUsuario
              ? `Resposta que a equipe escreveu: ${resumo.respostaAoUsuario}`
              : null,
            "",
            "Escreva a devolutiva para essa pessoa.",
          ]
            .filter(Boolean)
            .join("\n"),
          role: "user",
        },
      ],
      model: resolveClaudeModel(TIER_DA_DEVOLUTIVA),
      system: COMO_DEVOLVER,
    });

    const texto = completion?.text?.trim();
    if (!texto) return false;

    return await registrarDevolutivaDoFesto(protocolo, {
      fonte: "devolutiva-da-resolucao",
      referencia: null,
      texto,
    });
  } catch (erro) {
    console.error(
      `[festo] falha ao devolver o chamado ${protocolo}`,
      erro instanceof Error ? erro.message : String(erro),
    );
    return false;
  }
}

function primeiroNome(nome: string): string {
  return nome.trim().split(/\s+/)[0] || "você";
}
