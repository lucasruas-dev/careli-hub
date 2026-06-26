// Catalogo de Processos POP (Procedimento Operacional Padrao) do Panteon.
// Fonte unica, no codigo (mesmo padrao do changelog): Modulo -> Tela -> Processo.
//
// Cada processo carrega campos de O&M (objetivo, responsavel, entradas/saidas,
// fluxograma = estados + transicoes, regras/SLA, decisoes) e um espaco opcional
// de BPM (execucao/indicadores) que so e preenchido quando o processo for
// automatizado e medido. Assim o mesmo dado documenta hoje (O&M) e pode alimentar
// o motor de workflow amanha (BPM) sem retrabalho.

export type PopDiscipline = "O&M" | "BPM";
export type PopProcessStatus = "vigente" | "rascunho";

export type PopStateKind =
  | "inicio"
  | "etapa"
  | "fim-sucesso"
  | "fim-escalonamento";

export type PopState = {
  id: string;
  label: string;
  kind: PopStateKind;
  // Posicao autorada no fluxograma (userspace do SVG), pra ficar limpo e intencional.
  x: number;
  y: number;
  nota?: string;
};

export type PopTransitionMode = "auto" | "manual";

export type PopTransition = {
  de: string; // id do estado de origem
  para: string; // id do estado de destino
  gatilho: string;
  modo: PopTransitionMode;
  rotulo?: string; // rotulo curto exibido na propria seta (ex.: "Sim"/"Nao")
  tag?: string; // marcador opcional (ex.: "quebra")
};

export type PopSla = { item: string; valor: string };

export type PopProcess = {
  id: string;
  nome: string;
  resumo: string;
  disciplina: PopDiscipline;
  status: PopProcessStatus;
  objetivo?: string;
  responsavel?: string;
  entradas?: string[];
  saidas?: string[];
  estados: PopState[];
  transicoes: PopTransition[];
  sla?: PopSla[];
  decisoes?: string[];
  // BPM-ready: vazio ate o processo virar automatizado/medido.
  execucao?: { automatizado: boolean; indicadores?: string[] };
};

export type PopScreen = { id: string; tela: string; processos: PopProcess[] };
export type PopModule = { id: string; modulo: string; telas: PopScreen[] };

export const POP_CATALOG: readonly PopModule[] = [
  {
    id: "hades",
    modulo: "Hades",
    telas: [
      {
        id: "cobranca",
        tela: "Cobrança",
        processos: [
          {
            id: "workflow-cobranca",
            nome: "Workflow de cobrança (régua)",
            resumo:
              "Máquina de estados que conduz o cliente inadimplente do primeiro acionamento até a regularização ou o jurídico, guiada por dados do C2X, interação no WhatsApp (Iris) e ações do operador.",
            disciplina: "O&M",
            status: "vigente",
            objetivo:
              "Padronizar a recuperação de crédito com cadência diária de contato, registro de toda interação e escalonamento previsível.",
            responsavel: "Operação de Cobrança (Hades)",
            entradas: [
              "Parcela vencida há mais de 3 dias no C2X",
              "Cliente dentro do escopo do operador (faixa de atraso)",
            ],
            saidas: [
              "Cliente regularizado (sai do Hades)",
              "Caso escalado para o Jurídico",
            ],
            estados: [
              { id: "inicio", label: "Parcela +3d vencida", kind: "inicio", x: 16, y: 92 },
              { id: "acionar", label: "Acionar", kind: "etapa", x: 150, y: 86 },
              { id: "contato", label: "Contato", kind: "etapa", x: 326, y: 86 },
              { id: "negociacao", label: "Negociação", kind: "etapa", x: 502, y: 86 },
              { id: "promessa", label: "Promessa de pagamento", kind: "etapa", x: 678, y: 86 },
              { id: "acordo", label: "Acordo", kind: "etapa", x: 860, y: 86 },
              { id: "pago", label: "Pago / Finalizado", kind: "fim-sucesso", x: 860, y: 226 },
              { id: "juridico", label: "Jurídico", kind: "fim-escalonamento", x: 326, y: 242 },
            ],
            transicoes: [
              { de: "inicio", para: "acionar", gatilho: "parcela há mais de 3 dias vencida", modo: "auto" },
              { de: "acionar", para: "contato", gatilho: "operador faz contato (meta 1/dia)", modo: "manual" },
              { de: "contato", para: "negociacao", gatilho: "cliente responde no WhatsApp (Iris)", modo: "auto" },
              { de: "contato", para: "juridico", gatilho: "5 tentativas sem resposta", modo: "auto" },
              { de: "negociacao", para: "promessa", gatilho: "operador registra promessa/acordo (protocolo)", modo: "manual" },
              { de: "promessa", para: "acordo", gatilho: "operador marca acordo aceito", modo: "manual" },
              { de: "acordo", para: "pago", gatilho: "débito do cliente zera", modo: "auto" },
              { de: "acordo", para: "negociacao", gatilho: "não paga (1ª vez)", modo: "auto", tag: "quebra" },
              { de: "negociacao", para: "juridico", gatilho: "2º acordo não pago", modo: "auto", tag: "quebra" },
            ],
            sla: [
              { item: "Entrada no funil", valor: "parcela vencida há mais de 3 dias" },
              { item: "Cadência de contato", valor: "1 tentativa por dia" },
              { item: "Sem resposta", valor: "5 tentativas → Jurídico" },
              { item: "Quebra de acordo", valor: "2ª quebra → Jurídico" },
              { item: "Reentrada", valor: "novo ciclo recomeça no Acionar, com protocolos novos" },
            ],
            decisoes: [
              "Interação = resposta do cliente no canal de mensageria (Hades → Iris).",
              "Quebra é uma TAG: 1º acordo não pago volta para Negociação; 2º não pago vai direto ao Jurídico.",
              "Promessa → Acordo é manual: o operador sinaliza o aceite.",
              "Pago é automático: ao zerar o débito o cliente sai do Hades e a timeline registra o encerramento com o protocolo.",
              "Protocolos encadeados: Atendimento (AT) → Cobrança (CB) → Promessa/Acordo.",
              "SLAs ficam em constantes no código (ajustáveis sob demanda).",
            ],
            execucao: { automatizado: false },
          },
          {
            id: "classificacao-risco",
            nome: "Classificação de risco e prioridade",
            resumo:
              "Cada cliente em atraso recebe um score de risco (0 a 99) calculado de seis fatores; o score define a prioridade na fila — Crítica, Alta, Média ou Baixa — com regras de override por gravidade.",
            disciplina: "O&M",
            status: "vigente",
            objetivo:
              "Priorizar o esforço de cobrança no que tem maior risco e maior chance de recuperação, de forma objetiva e auditável.",
            responsavel: "Operação de Cobrança (Hades)",
            entradas: [
              "Parcela vencida no C2X (dias de atraso, nº de parcelas, valor, histórico)",
            ],
            saidas: [
              "Prioridade do cliente na fila (Crítica / Alta / Média / Baixa)",
              "Score de risco (0–99) exibido no card do cliente",
            ],
            estados: [
              { id: "score", label: "Score de risco (0–99)", kind: "inicio", x: 20, y: 34 },
              { id: "d1", label: "Score ≥ 85?", kind: "etapa", x: 215, y: 30 },
              { id: "critica", label: "Crítica", kind: "fim-escalonamento", x: 410, y: 30 },
              { id: "d2", label: "Score ≥ 65?", kind: "etapa", x: 215, y: 128 },
              { id: "alta", label: "Alta", kind: "etapa", x: 410, y: 128 },
              { id: "d3", label: "Score ≥ 40?", kind: "etapa", x: 215, y: 226 },
              { id: "media", label: "Média", kind: "etapa", x: 410, y: 226 },
              { id: "baixa", label: "Baixa", kind: "fim-sucesso", x: 410, y: 324 },
            ],
            transicoes: [
              { de: "score", para: "d1", gatilho: "calcula o score somando os 6 fatores", modo: "auto" },
              { de: "d1", para: "critica", gatilho: "score ≥ 85 · ou >12 parcelas vencidas · ou ≥180 dias de atraso", modo: "auto", rotulo: "Sim" },
              { de: "d1", para: "d2", gatilho: "score abaixo de 85", modo: "auto", rotulo: "Não" },
              { de: "d2", para: "alta", gatilho: "score ≥ 65 · ou ≥7 parcelas vencidas · ou ≥90 dias de atraso", modo: "auto", rotulo: "Sim" },
              { de: "d2", para: "d3", gatilho: "score abaixo de 65", modo: "auto", rotulo: "Não" },
              { de: "d3", para: "media", gatilho: "score ≥ 40", modo: "auto", rotulo: "Sim" },
              { de: "d3", para: "baixa", gatilho: "score abaixo de 40", modo: "auto", rotulo: "Não" },
            ],
            sla: [
              { item: "Dias em atraso", valor: "≥91: +30 · 61–90: +24 · 31–60: +18 · 16–30: +12 · 1–15: +6" },
              { item: "Parcelas vencidas", valor: ">12: +25 · 7–12: +20 · 3–6: +13 · 1–2: +6" },
              { item: "Valor em atraso", valor: "≥50k: +15 · ≥15k: +14 · ≥10k: +10 · ≥5k: +6 · >0: +3" },
              { item: "Taxa de inadimplência", valor: "≥75%: +10 · ≥50%: +8 · ≥25%: +5 · ≥10%: +3 · >0: +1" },
              { item: "Histórico de atraso", valor: "≥180d ou >12p: +15 · ≥90d ou ≥7p: +10 · ≥31d ou ≥3p: +5" },
              { item: "Situação especial", valor: "≥180 dias ou >12 parcelas: +5" },
              { item: "Score final", valor: "soma dos fatores, limitado a 99" },
            ],
            decisoes: [
              "Faixas de prioridade pelo score: Crítica ≥ 85 · Alta ≥ 65 · Média ≥ 40 · Baixa < 40.",
              "Override por gravidade: >12 parcelas vencidas OU ≥180 dias de atraso elevam para Crítica; ≥7 parcelas OU ≥90 dias elevam para Alta — mesmo que o score puro fosse menor.",
              "O score (0–99) aparece no card do cliente; a prioridade ordena a fila.",
              "Os pesos de cada fator ficam em constantes no código (ajustáveis sob demanda).",
            ],
            execucao: { automatizado: true, indicadores: ["distribuição por prioridade", "score médio da carteira"] },
          },
        ],
      },
    ],
  },
];

export function findPopProcess(processId: string): PopProcess | undefined {
  for (const mod of POP_CATALOG) {
    for (const screen of mod.telas) {
      const found = screen.processos.find((process) => process.id === processId);

      if (found) {
        return found;
      }
    }
  }

  return undefined;
}

export function firstPopProcessId(): string {
  return POP_CATALOG[0]?.telas[0]?.processos[0]?.id ?? "";
}
