import { completeWithClaudeStructured } from "@/lib/ai/claude";

import type { JanelaDoRelatorio } from "./janela";
import { horaNaCasa } from "./janela";
import type { MensagemDaJanela, TicketDaJanela } from "./metricas";

// A LEITURA DO DIA — o que os números não contam.
//
// Lucas (17/09/2026), depois de ver a primeira versão só com indicadores: *"coloca os atendimentos
// que vc entender que foi positivo, os negativos, se teve algum cliente insatisfeito, bem completo
// dando dica de ação"*.
//
// ⚠️ ISTO É A ÚNICA PARTE DO RELATÓRIO QUE UM MODELO ESCREVE, e por isso ela é cercada por três
// travas — um relatório para a diretoria que inventa um caso é pior do que um relatório sem casos:
//
//   1. **O modelo só vê conversa de verdade.** Nada de resumo pré-mastigado: ele lê as mensagens,
//      com hora e protocolo, e é obrigado a devolver o protocolo de cada afirmação.
//   2. **Protocolo que não existe some.** `validarLeitura` descarta o item cujo protocolo não
//      estava no material enviado. É a defesa contra o caso bonito e inexistente.
//   3. **Citação tem de ser trecho real.** Se o modelo devolver aspas que não aparecem na conversa
//      daquele protocolo, a citação cai (o item fica, sem as aspas).
//
// ⚠️ E A LEITURA NÃO SEGURA O RELATÓRIO. Sem `ANTHROPIC_API_KEY`, com erro na API ou com resposta
// fora do formato, o e-mail sai com os blocos medidos e sem esta seção. O indicador nunca depende
// do modelo.

/** Quantas conversas vão para a leitura. Teto de custo e de contexto. */
const TETO_DE_CONVERSAS = 40;

/** Quantas mensagens de cada conversa. O suficiente para entender o desfecho. */
const TETO_DE_MENSAGENS = 24;

/** O que denuncia cliente contrariado. Serve para ESCOLHER a conversa, nunca para concluir nada. */
const SINAIS_DE_INSATISFACAO = [
  "absurdo",
  "advogad",
  "cancelar",
  "consumidor",
  "decepcion",
  "descaso",
  "desrespeito",
  "insatisf",
  "já falei",
  "ja falei",
  "mentira",
  "não aguento",
  "nao aguento",
  "não resolve",
  "nao resolve",
  "palhaçada",
  "processar",
  "procon",
  "péssimo",
  "pessimo",
  "reclamar",
  "reclamação",
  "revoltado",
  "ridículo",
  "ridiculo",
  "toda vez",
  "até quando",
  "ate quando",
  "ninguém responde",
  "ninguem responde",
];

export type ConversaParaLeitura = {
  cliente: null | string;
  fila: string;
  minutosAteResposta: null | number;
  protocolo: string;
  /** `08:14 cliente: ...` — a conversa como ela aconteceu, em texto. */
  transcricao: string;
};

export type ItemDaLeitura = {
  /** Uma frase do que aconteceu. */
  detalhe: string;
  /** Trecho textual da conversa, quando houver. */
  citacao?: null | string;
  protocolo: string;
  titulo: string;
};

export type AcaoRecomendada = {
  /** Por que agora: o fato que sustenta a recomendação. */
  motivo: string;
  /** O que fazer, em uma frase de ação. */
  acao: string;
  protocolos?: string[];
};

export type LeituraDoDia = {
  acoes: AcaoRecomendada[];
  descartados: number;
  insatisfeitos: ItemDaLeitura[];
  modelo: string;
  negativos: ItemDaLeitura[];
  positivos: ItemDaLeitura[];
};

function semAcento(v: string): string {
  return v.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Escolhe as conversas que merecem leitura.
 *
 * ⚠️ NÃO É AMOSTRA ALEATÓRIA. A conversa que interessa é a que tem SINAL: cliente contrariado,
 * espera longa, recado sem resposta, ticket fechado logo depois de uma pergunta, entrega que
 * falhou. Mandar 40 conversas sorteadas gastaria o mesmo e traria o dia médio, que os números já
 * contam melhor.
 */
export function selecionarConversas(
  tickets: TicketDaJanela[],
  mensagens: MensagemDaJanela[],
  janela: JanelaDoRelatorio,
): ConversaParaLeitura[] {
  const porTicket = new Map<string, MensagemDaJanela[]>();
  for (const m of mensagens) {
    if (m.direcao !== "inbound" && m.direcao !== "outbound") continue;
    const lista = porTicket.get(m.ticketId);
    if (lista) lista.push(m);
    else porTicket.set(m.ticketId, [m]);
  }

  const ticketPorId = new Map(tickets.map((t) => [t.id, t]));
  const candidatas: Array<{ conversa: ConversaParaLeitura; peso: number }> = [];

  for (const [id, lista] of porTicket) {
    const ticket = ticketPorId.get(id);
    if (!ticket?.protocolo) continue;

    const ordenada = [...lista].sort((a, b) => a.criadoEm.localeCompare(b.criadoEm));
    const naJanela = ordenada.filter((m) => {
      const quando = new Date(m.criadoEm);
      return quando >= janela.inicio && quando <= janela.fim;
    });
    if (naJanela.length === 0) continue;

    // A maior espera do cliente dentro desta conversa.
    let maiorEspera: null | number = null;
    let semResposta = false;
    for (const [indice, m] of ordenada.entries()) {
      if (m.direcao !== "inbound") continue;
      const quando = new Date(m.criadoEm);
      if (quando < janela.inicio || quando > janela.fim) continue;
      const resposta = ordenada.slice(indice + 1).find((o) => o.direcao === "outbound");
      if (!resposta) {
        semResposta = true;
        continue;
      }
      const minutos = (new Date(resposta.criadoEm).getTime() - quando.getTime()) / 60_000;
      maiorEspera = maiorEspera === null ? minutos : Math.max(maiorEspera, minutos);
    }

    const texto = semAcento(naJanela.map((m) => m.texto ?? "").join(" "));
    const contrariado = SINAIS_DE_INSATISFACAO.some((sinal) => texto.includes(semAcento(sinal)));
    const falhou = naJanela.some((m) => m.entrega === "failed");
    const fechadoNaJanela =
      ticket.fechadoEm !== null &&
      new Date(ticket.fechadoEm) >= janela.inicio &&
      new Date(ticket.fechadoEm) <= janela.fim;
    const terminouComPergunta =
      fechadoNaJanela && (naJanela[naJanela.length - 1]?.texto ?? "").includes("?");

    // ⚠️ O PESO É A ORDEM DA FILA DE LEITURA, não uma nota. Insatisfação vem primeiro porque é o
    // que o Lucas pediu para não escapar.
    const peso =
      (contrariado ? 100 : 0) +
      (semResposta ? 40 : 0) +
      (terminouComPergunta ? 30 : 0) +
      (falhou ? 20 : 0) +
      Math.min(30, (maiorEspera ?? 0) / 10) +
      // Conversa com troca de verdade ensina mais do que um "ok" solto.
      Math.min(20, naJanela.length);

    if (peso < 12) continue;

    const recorte = naJanela.slice(-TETO_DE_MENSAGENS);
    candidatas.push({
      conversa: {
        cliente: ticket.cliente ?? null,
        fila: ticket.fila,
        minutosAteResposta: maiorEspera,
        protocolo: ticket.protocolo,
        transcricao: recorte
          .map((m) => {
            const quem = m.direcao === "inbound" ? "cliente" : m.daCaca ? "CACÁ" : "equipe";
            const corpo = (m.texto ?? "").replace(/\s+/g, " ").trim();
            const tipo = m.tipo && m.tipo !== "text" ? ` [${m.tipo}]` : "";
            return `${horaNaCasa(m.criadoEm)} ${quem}${tipo}: ${corpo || "(sem texto)"}`;
          })
          .join("\n"),
      },
      peso,
    });
  }

  return candidatas
    .sort((a, b) => b.peso - a.peso)
    .slice(0, TETO_DE_CONVERSAS)
    .map((c) => c.conversa);
}

const ITEM = {
  properties: {
    citacao: {
      description: "Trecho EXATO da conversa, entre 3 e 200 caracteres. Vazio se não houver.",
      type: "string",
    },
    detalhe: { description: "O que aconteceu, em uma ou duas frases.", type: "string" },
    protocolo: { description: "O protocolo da conversa, exatamente como recebido.", type: "string" },
    titulo: { description: "Título curto, sem ponto final.", type: "string" },
  },
  required: ["titulo", "detalhe", "protocolo"],
  type: "object",
} as const;

const ESQUEMA = {
  properties: {
    acoes: {
      description: "De 3 a 6 recomendações práticas para amanhã, em ordem de impacto.",
      items: {
        properties: {
          acao: { description: "O que fazer, começando por um verbo.", type: "string" },
          motivo: { description: "O fato do dia que sustenta a ação.", type: "string" },
          protocolos: { items: { type: "string" }, type: "array" },
        },
        required: ["acao", "motivo"],
        type: "object",
      },
      type: "array",
    },
    insatisfeitos: {
      description: "Clientes que demonstraram insatisfação. Lista vazia se não houve.",
      items: ITEM,
      type: "array",
    },
    negativos: {
      description: "De 2 a 5 atendimentos que correram mal, ou falhas de processo.",
      items: ITEM,
      type: "array",
    },
    positivos: {
      description: "De 2 a 5 atendimentos que merecem elogio, com o que exatamente foi bem feito.",
      items: ITEM,
      type: "array",
    },
  },
  required: ["positivos", "negativos", "insatisfeitos", "acoes"],
  type: "object",
} as const;

const INSTRUCAO = `Você lê as conversas de atendimento de uma administradora de carteiras de loteamento e escreve a parte qualitativa do relatório que vai para a diretora de operações.

Como escrever:
- Português do Brasil, frase curta, tom de colega que leu tudo. Sem travessão, sem jargão de consultoria, sem elogio vazio.
- Fale do ATENDIMENTO, não do cliente: "a resposta levou 40 minutos", não "o cliente é impaciente".
- Todo item carrega o protocolo da conversa de onde ele saiu. Sem protocolo, não escreva o item.
- A citação, quando existir, é trecho LITERAL da conversa. Nunca escreva aspas aproximadas.
- Não invente valor, prazo, nome ou desfecho que não esteja na conversa. Se a conversa não mostra o final, diga que ficou em aberto.
- Nos positivos, diga o que a pessoa fez de concreto (conferiu identidade, ofereceu antecipação, resolveu sem transferir).
- Nos negativos, separe o erro de atendimento (resposta que não veio, ticket fechado com pergunta aberta) do problema de processo (boleto que demorou, template sem dados).
- Em insatisfeitos, entre só quem demonstrou insatisfação na conversa. Se ninguém demonstrou, devolva lista vazia; não force.
- As ações são para amanhã, específicas e verificáveis. Nada de "melhorar a comunicação".`;

/** Chama o modelo. `null` quando não há chave, quando a API falha ou quando não há conversa. */
export async function lerODia(
  conversas: ConversaParaLeitura[],
  numeros: { abertos: number; fechados: number; mediana: null | number },
): Promise<LeituraDoDia | null> {
  if (conversas.length === 0) return null;

  const material = conversas
    .map(
      (c) =>
        `### ${c.protocolo} · fila ${c.fila}${c.cliente ? ` · cliente ${c.cliente}` : ""}${
          c.minutosAteResposta !== null
            ? ` · maior espera ${Math.round(c.minutosAteResposta)} min`
            : ""
        }\n${c.transcricao}`,
    )
    .join("\n\n");

  const resposta = await completeWithClaudeStructured<{
    acoes: AcaoRecomendada[];
    insatisfeitos: ItemDaLeitura[];
    negativos: ItemDaLeitura[];
    positivos: ItemDaLeitura[];
  }>({
    inputSchema: ESQUEMA as never,
    maxTokens: 4096,
    messages: [
      {
        content: `O dia teve ${numeros.abertos} atendimentos abertos, ${numeros.fechados} encerrados e resposta mediana de ${
          numeros.mediana === null ? "indisponível" : `${numeros.mediana.toFixed(1)} minutos`
        }. Abaixo estão as ${conversas.length} conversas que mais chamaram atenção hoje, com hora de cada mensagem.\n\n${material}`,
        role: "user",
      },
    ],
    system: INSTRUCAO,
    toolDescription: "Entrega a leitura qualitativa do dia de atendimento.",
    toolName: "leitura_do_dia",
  });

  if (!resposta) return null;

  return validarLeitura(
    {
      acoes: resposta.data.acoes ?? [],
      descartados: 0,
      insatisfeitos: resposta.data.insatisfeitos ?? [],
      modelo: resposta.model,
      negativos: resposta.data.negativos ?? [],
      positivos: resposta.data.positivos ?? [],
    },
    conversas,
  );
}

/**
 * A conferência do que o modelo afirmou.
 *
 * ⚠️ PROTOCOLO INVENTADO É ITEM DESCARTADO, e o número de descartes vai no rodapé do bloco: se
 * começar a subir, é sinal de que o material está curto ou a instrução afrouxou.
 *
 * ⚠️ CITAÇÃO QUE NÃO ESTÁ NA CONVERSA CAI, mas o item fica: a observação pode estar certa mesmo
 * com as aspas mal copiadas — o que não pode é o e-mail publicar aspas que ninguém disse.
 */
export function validarLeitura(
  leitura: LeituraDoDia,
  conversas: ConversaParaLeitura[],
): LeituraDoDia {
  const porProtocolo = new Map(conversas.map((c) => [c.protocolo.trim().toUpperCase(), c]));
  let descartados = 0;

  const limpar = (itens: ItemDaLeitura[]): ItemDaLeitura[] =>
    itens.filter((item) => {
      const conversa = porProtocolo.get(String(item.protocolo ?? "").trim().toUpperCase());
      if (!conversa) {
        descartados += 1;
        return false;
      }
      const citacao = (item.citacao ?? "").trim();
      if (citacao) {
        const normal = (v: string) => semAcento(v).replace(/\s+/g, " ").replace(/["“”']/g, "");
        if (!normal(conversa.transcricao).includes(normal(citacao))) {
          item.citacao = null;
        }
      }
      return true;
    });

  const positivos = limpar(leitura.positivos);
  const negativos = limpar(leitura.negativos);
  const insatisfeitos = limpar(leitura.insatisfeitos);

  const acoes = leitura.acoes.map((a) => ({
    ...a,
    protocolos: (a.protocolos ?? []).filter((p) =>
      porProtocolo.has(String(p ?? "").trim().toUpperCase()),
    ),
  }));

  return { acoes, descartados, insatisfeitos, modelo: leitura.modelo, negativos, positivos };
}
