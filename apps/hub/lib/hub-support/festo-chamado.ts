import {
  type HubItTicketCategory,
  hubItTicketCategories,
  type HubItTicketPriority,
  hubItTicketPriorities,
} from "@/lib/hub-it-tickets/types";

// O CHAMADO QUE O FESTO ABRE.
//
// Lucas (11/09/2026): *"eu quero que ele faça o preenchimento do ticket, e faça a devolução do
// mesmo. eu não quero ficar parando respondendo usuario se foi resolvido ou não"*.
//
// ⚠️ ESTE ARQUIVO É PURO DE PROPÓSITO. O que o modelo devolve é texto de fora, e validar texto de
// fora no meio da chamada de rede é onde erro de campo vira 500 sem ninguém entender. Aqui a
// conversão acontece sem banco e sem modelo, e por isso dá para testar caso a caso.

/** O que o Festos precisa dizer para abrir um chamado. Espelha o formulário, em português. */
export type ChamadoDitadoPeloFesto = {
  categoria?: unknown;
  descricao_do_usuario?: unknown;
  modulo?: unknown;
  prioridade?: unknown;
  resultado_esperado?: unknown;
  resultado_obtido?: unknown;
  resumo_tecnico?: unknown;
  titulo?: unknown;
};

/**
 * Quantos dias o Festos pede de prazo, por prioridade.
 *
 * ⚠️ A DATA DE ENTREGA É OBRIGATÓRIA NO CHAMADO, e o Festos não tem como saber a agenda de quem
 * atende. Deixar ele inventar a data seria pior que calcular: ele chutaria "amanhã" para agradar
 * quem está reclamando, e a combinação de entrega — que é um acordo entre pessoas, com aprovar e
 * reprogramar — nasceria queimada. O número aqui é uma PROPOSTA, e quem atende aprova ou remarca.
 */
const DIAS_DE_PRAZO: Record<HubItTicketPriority, number> = {
  alta: 2,
  baixa: 10,
  critica: 1,
  media: 5,
};

/**
 * A data que o Festos propõe como entrega, no formato que o chamado exige (`YYYY-MM-DD`).
 *
 * ⚠️ CONTA EM UTC, e isso é o que evita o erro clássico de data no Panteon: `toISOString()` sobre
 * uma data montada no fuso local devolve o DIA ANTERIOR para qualquer horário antes das 21h em
 * Brasília. Somando os dias sobre o marco UTC e lendo de volta em UTC, o dia é o mesmo que a pessoa
 * veria no calendário.
 */
export function dataSugeridaDeEntrega(
  prioridade: HubItTicketPriority,
  hoje: Date,
): string {
  const marco = Date.UTC(
    hoje.getFullYear(),
    hoje.getMonth(),
    hoje.getDate() + DIAS_DE_PRAZO[prioridade],
  );

  return new Date(marco).toISOString().slice(0, 10);
}

/**
 * Transforma o que o Festos ditou no payload que `createHubItTicket` aceita.
 *
 * Devolve `null` quando falta o essencial — título, relato ou leitura técnica. O agente é instruído
 * a mandar os três, mas instrução não é garantia, e um chamado sem relato é pior que nenhum: ele
 * ocupa a fila e ninguém consegue atender.
 */
export function chamadoParaOHelpDesk(
  ditado: ChamadoDitadoPeloFesto,
  {
    hoje,
    telaDaPessoa,
  }: {
    hoje: Date;
    telaDaPessoa: null | string;
  },
) {
  const titulo = texto(ditado.titulo);
  const descricao = texto(ditado.descricao_do_usuario);
  const resumo = texto(ditado.resumo_tecnico);

  if (!titulo || !descricao || !resumo) {
    return null;
  }

  const prioridade = prioridadeValida(ditado.prioridade);

  return {
    actualResult: texto(ditado.resultado_obtido) || undefined,
    category: categoriaValida(ditado.categoria),
    expectedResult: texto(ditado.resultado_esperado) || undefined,
    // O módulo é texto livre no chamado; sem ele, a tela onde a pessoa estava é a melhor pista que
    // existe — e é sempre verdadeira, porque veio do navegador e não do modelo.
    module: texto(ditado.modulo) || telaDaPessoa || "Panteon",
    priority: prioridade,
    requestedDeliveryDate: dataSugeridaDeEntrega(prioridade, hoje),
    sourcePath: telaDaPessoa ?? undefined,
    // ⚠️ A LEITURA TÉCNICA EXIGE 10 CARACTERES e o título 4 — as duas travas moram em
    // `normalizeCreateInput`. Textos curtos demais chegam aqui como string válida e explodem lá
    // dentro; completar com o relato é melhor que devolver erro para quem só queria ajuda.
    technicalSummary: resumo.length >= 10 ? resumo : `${resumo} · ${descricao}`,
    title: titulo,
    userDescription: descricao,
  };
}

/**
 * A conversa inteira, para ficar registrada no chamado.
 *
 * ⚠️ O REGISTRO É O ATENDIMENTO, e não um resumo dele. Quem for atender precisa ler o que a pessoa
 * escreveu com as palavras dela — inclusive o que ela respondeu quando o Festos perguntou. Um resumo
 * gerado por cima perderia justamente a frase solta que costuma conter a causa.
 */
export function transcricaoDoAtendimento(
  conversa: readonly { de: "festo" | "pessoa"; texto: string }[],
): string {
  return conversa
    .map((fala) => `${fala.de === "pessoa" ? "Pessoa" : "Festos"}: ${fala.texto}`)
    .join("\n\n");
}

/**
 * Os prints da conversa viram anexos do chamado.
 *
 * ⚠️ SEM ISTO, A EVIDÊNCIA MORRE NA CONVERSA. A pessoa manda o print, o Festos lê, entende, abre o
 * chamado — e quem for atender recebe a descrição do print em vez do print. O trabalho de reproduzir
 * o erro recomeça do zero, que é exatamente o custo que a plataforma existe para cortar.
 *
 * ⚠️ SÃO AS AMOSTRAS REDUZIDAS, e o chamado fica com elas. A amostra tem 1.600px e qualidade 0,72:
 * boa para ler uma mensagem de erro, pobre para inspecionar um detalhe fino. Quem precisa mandar o
 * arquivo bom continua tendo o formulário — e é por isso que o botão dele não saiu do chat.
 *
 * ⚠️ TETO DE QUATRO, os mais recentes. O formulário aceita quatro anexos; manter o mesmo número
 * evita que o chamado aberto pelo Festos tenha uma regra que ninguém mais tem. E a conversa que
 * rende mais de quatro prints é a conversa em que os primeiros já foram substituídos por outros
 * melhores.
 */
export function anexosDaConversa(
  conversa: readonly { imagens?: string[] }[],
  agora: Date,
): Array<{
  dataUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  type: "image";
}> {
  const carimbo = agora.toISOString().slice(0, 19).replace(/[:T]/g, "-");

  return conversa
    .flatMap((fala) => fala.imagens ?? [])
    .filter((imagem) => /^data:image\/(?:jpeg|png|gif|webp);base64,/.test(imagem))
    .slice(-4)
    .map((dataUrl, indice) => {
      const mimeType = /^data:([^;]+);/.exec(dataUrl)?.[1] ?? "image/jpeg";
      const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);

      return {
        dataUrl,
        fileName: `print-do-chat-${carimbo}-${indice + 1}.${mimeType.split("/")[1] ?? "jpg"}`,
        mimeType,
        // O tamanho real a partir do base64: 3 bytes para cada 4 caracteres. O campo é usado pela
        // trava de tamanho do HelpDesk, e mandar zero passaria por cima dela.
        sizeBytes: Math.ceil((base64.length * 3) / 4),
        type: "image" as const,
      };
    });
}

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function categoriaValida(valor: unknown): HubItTicketCategory {
  return hubItTicketCategories.includes(valor as HubItTicketCategory)
    ? (valor as HubItTicketCategory)
    : "outro";
}

function prioridadeValida(valor: unknown): HubItTicketPriority {
  return hubItTicketPriorities.includes(valor as HubItTicketPriority)
    ? (valor as HubItTicketPriority)
    : "media";
}
