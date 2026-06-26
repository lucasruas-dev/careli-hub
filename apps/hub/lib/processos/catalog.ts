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
  // Quando preenchido, o no vira um link: clicar abre o processo com esse id.
  processoLink?: string;
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
              { id: "proposta", label: "Proposta", kind: "etapa", x: 678, y: 86, processoLink: "acordos-promessas", nota: "Operador gera a promessa ou o acordo (oferta na mesa). Clique para abrir o processo Acordos & Promessas." },
              { id: "acerto", label: "Acerto", kind: "etapa", x: 860, y: 86, processoLink: "regua-lembretes", nota: "Cliente aceitou (promessa/acordo enviado). A régua de lembretes cuida do pagamento. Clique para abrir a Régua de lembretes." },
              { id: "pago", label: "Pago / Finalizado", kind: "fim-sucesso", x: 860, y: 226 },
              { id: "juridico", label: "Jurídico", kind: "fim-escalonamento", x: 326, y: 242 },
            ],
            transicoes: [
              { de: "inicio", para: "acionar", gatilho: "parcela há mais de 3 dias vencida", modo: "auto" },
              { de: "acionar", para: "contato", gatilho: "operador faz contato (meta 1/dia)", modo: "manual" },
              { de: "contato", para: "negociacao", gatilho: "cliente responde no WhatsApp (Iris)", modo: "auto" },
              { de: "contato", para: "juridico", gatilho: "5 tentativas sem resposta", modo: "auto" },
              { de: "negociacao", para: "proposta", gatilho: "operador propõe a condição (data de promessa ou acordo)", modo: "manual" },
              { de: "proposta", para: "acerto", gatilho: "cliente aceita a proposta", modo: "manual" },
              { de: "acerto", para: "pago", gatilho: "débito do cliente zera", modo: "auto" },
              { de: "acerto", para: "negociacao", gatilho: "não paga (1ª vez)", modo: "auto", tag: "quebra" },
              { de: "negociacao", para: "juridico", gatilho: "2ª quebra (acerto não pago de novo)", modo: "auto", tag: "quebra" },
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
              "Quebra é uma TAG: 1º acerto não pago volta para Negociação; na 2ª quebra vai direto ao Jurídico.",
              "Proposta → Acerto: o operador propõe e o cliente aceita a condição (data de promessa ou acordo).",
              "O nó Acerto abre o processo Acordos & Promessas, que detalha promessa × acordo e o desfecho.",
              "Pago é automático: ao zerar o débito o cliente sai do Hades e a timeline registra o encerramento com o protocolo.",
              "Protocolos encadeados: Atendimento (AT) → Cobrança (CB) → Promessa (PR) / Acordo (AC).",
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
          {
            id: "acordos-promessas",
            nome: "Acordos & Promessas",
            resumo:
              "Detalha a Proposta da régua: o operador propõe uma PROMESSA (cliente paga o que já deve até uma data) ou um ACORDO (renegocia com desconto, entrada e parcelas), registra e ENVIA ao cliente. Termina no Acerto — daí a Régua de lembretes cuida do pagamento. (Desenho fechado; execução pendente.)",
            disciplina: "O&M",
            status: "rascunho",
            objetivo:
              "Padronizar o registro e o envio de promessas e acordos, com a cobrança via C2X/Asaas, deixando o cliente em Acerto na régua.",
            responsavel: "Operação de Cobrança (Hades)",
            entradas: [
              "Proposta na régua de cobrança (ver Workflow de cobrança)",
              "Parcelas / unidade do C2X selecionadas",
            ],
            saidas: [
              "Promessa ou acordo registrado, com protocolo (PR / AC)",
              "Boletos / link enviados ao cliente pelo Iris",
              "Cliente em Acerto na régua (lembretes lá)",
            ],
            estados: [
              { id: "inicio", label: "Proposta", kind: "inicio", x: 12, y: 134, nota: "Vem da régua (workflow): o operador vai propor a condição." },
              { id: "decisao", label: "Promessa ou acordo?", kind: "etapa", x: 140, y: 130 },
              { id: "prom_reg", label: "Promessa registrada", kind: "etapa", x: 350, y: 24 },
              { id: "prom_envio", label: "Link enviado", kind: "etapa", x: 545, y: 24 },
              { id: "ac_aguard", label: "Aguardando emissão", kind: "etapa", x: 350, y: 244 },
              { id: "ac_emitido", label: "Boletos emitidos", kind: "etapa", x: 540, y: 244 },
              { id: "ac_envio", label: "Faturas enviadas", kind: "etapa", x: 720, y: 244 },
              { id: "acerto", label: "Acerto → régua", kind: "fim-sucesso", x: 770, y: 130, processoLink: "regua-lembretes", nota: "Tudo enviado: o cliente está em Acerto na régua. Clique para abrir a Régua de lembretes." },
            ],
            transicoes: [
              { de: "inicio", para: "decisao", gatilho: "operador vai propor a condição ao cliente", modo: "manual" },
              { de: "decisao", para: "prom_reg", gatilho: "cliente só promete pagar o que já deve, sem renegociar", modo: "manual", rotulo: "Promessa" },
              { de: "decisao", para: "ac_aguard", gatilho: "cliente renegocia; operador abre atividade pro financeiro (Asana) emitir os boletos novos no C2X", modo: "manual", rotulo: "Acordo" },
              { de: "prom_reg", para: "prom_envio", gatilho: "operador reenvia o link do boleto (que já existe no C2X) pelo Iris", modo: "manual" },
              { de: "prom_envio", para: "acerto", gatilho: "link enviado ao cliente", modo: "manual" },
              { de: "ac_aguard", para: "ac_emitido", gatilho: "financeiro emite os boletos novos no C2X", modo: "manual" },
              { de: "ac_emitido", para: "ac_envio", gatilho: "operador seleciona as faturas + template de acordo", modo: "manual" },
              { de: "ac_envio", para: "acerto", gatilho: "faturas enviadas ao cliente pelo Iris", modo: "manual" },
            ],
            sla: [
              { item: "Promessa · financeiro", valor: "nenhuma atividade — o boleto da parcela já existe no C2X" },
              { item: "Acordo · financeiro", valor: "atividade manual (Asana) → financeiro emite os boletos novos no C2X" },
              { item: "Envio", valor: "operador seleciona as faturas + template e encaminha pelo Iris" },
              { item: "Cobrança", valor: "boletos sempre gerados no C2X (integrado ao Asaas); Hades não emite" },
              { item: "Fim do processo", valor: "ao enviar, o cliente fica em Acerto na régua (lembretes lá)" },
            ],
            decisoes: [
              "Hades REGISTRA e orquestra; o C2X COBRA (gera o boleto). Hades não emite boleto.",
              "Braço Promessa = registro simples: só a data + parcela(s), sem atividade financeira; o boleto já existe no C2X (operador reenvia o link pelo Iris).",
              "Braço Acordo = renegociação: atividade pro financeiro (Asana hoje) emitir os boletos novos no C2X; depois o operador encaminha as faturas.",
              "Operador aponta as faturas na devolutiva — o seletor de parcelas relacionadas já existe no fluxo de cobrança pela Iris.",
              "O processo termina no Acerto: a partir daí a Régua de lembretes (no Workflow) cuida do pagamento e da quebra.",
              "Protocolos encadeados: Atendimento (AT) → Cobrança (CB) → Promessa (PR) / Acordo (AC).",
              "Desenho aprovado com o Lucas; a entidade e o envio ainda serão construídos (precisa de migration).",
            ],
            execucao: { automatizado: false },
          },
          {
            id: "regua-lembretes",
            nome: "Régua de lembretes",
            resumo:
              "Depois do Acerto, todo dia o sistema confere o vencimento e dispara um lembrete por WhatsApp em D-3, D-2, D-1 e no dia. Se pagar, finaliza; se vencer sem pagar, volta à régua de cobrança. (Desenho fechado; execução pendente — é a 1ª automação BPM.)",
            disciplina: "O&M",
            status: "rascunho",
            objetivo:
              "Lembrar o cliente do vencimento da promessa/acordo de forma automática e barata (WhatsApp), maximizando o pagamento no prazo.",
            responsavel: "Operação de Cobrança (Hades)",
            entradas: [
              "Cliente em Acerto (promessa ou acordo enviado)",
              "Vencimento da parcela / data prometida (C2X)",
            ],
            saidas: [
              "Lembretes disparados (D-3, D-2, D-1, no dia)",
              "Pagamento (sai do Hades) ou quebra (volta à régua de cobrança)",
            ],
            estados: [
              { id: "inicio", label: "Acerto", kind: "inicio", x: 12, y: 130, nota: "Promessa/acordo enviado, aguardando pagamento." },
              { id: "check", label: "Régua diária", kind: "etapa", x: 160, y: 126, nota: "Todo dia confere o C2X e a distância até o vencimento." },
              { id: "lembrete", label: "Lembrete WhatsApp", kind: "etapa", x: 390, y: 20, nota: "Dispara em D-3, D-2, D-1 e no dia do vencimento." },
              { id: "pago", label: "Pago", kind: "fim-sucesso", x: 390, y: 130 },
              { id: "quebra", label: "Quebra → régua", kind: "fim-escalonamento", x: 390, y: 244, processoLink: "workflow-cobranca", nota: "Venceu sem pagar: volta pra Negociação na régua. Clique para abrir o Workflow." },
            ],
            transicoes: [
              { de: "inicio", para: "check", gatilho: "o acerto entra na régua de lembretes", modo: "auto" },
              { de: "check", para: "lembrete", gatilho: "faltam 3, 2, 1 dias ou vence hoje — e ainda não pagou", modo: "auto", rotulo: "lembra" },
              { de: "check", para: "pago", gatilho: "boleto pago no C2X (débito zera)", modo: "auto", rotulo: "pagou" },
              { de: "check", para: "quebra", gatilho: "venceu sem pagamento", modo: "auto", rotulo: "venceu" },
            ],
            sla: [
              { item: "Lembretes", valor: "D-3, D-2, D-1 e no dia do vencimento / data prometida" },
              { item: "Antes de lembrar", valor: "confere no C2X se o boleto já não foi pago" },
              { item: "Canal", valor: "WhatsApp (Iris), com template Meta aprovado" },
              { item: "Custo", valor: "WhatsApp é mais barato que o disparo do Asaas (Lucas)" },
              { item: "Cadência", valor: "cron diário (1x/dia), sem polling; idempotente (não duplica)" },
              { item: "Quebra", valor: "venceu sem pagar → volta à régua (Negociação)" },
            ],
            decisoes: [
              "Roda num cron diário: 1 verificação por dia, sem polling (consciência de custo).",
              "Antes de disparar, confere no C2X se já pagou; se pagou, finaliza e não manda.",
              "4 pontos de lembrete: D-3, D-2, D-1 e no dia. Custo de WhatsApp aprovado (mais barato que o Asaas).",
              "Log de lembrete enviado (idempotência) pra não duplicar se o cron rodar de novo.",
              "É a 1ª peça executável (BPM) da Cobrança — o resto ainda é O&M (documentado).",
              "Desenho aprovado com o Lucas; a automação ainda será construída (cron + template + log).",
            ],
            execucao: { automatizado: false },
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

export function getProcessRelations(processId: string): {
  incoming: { id: string; nome: string }[];
  outgoing: { id: string; nome: string }[];
} {
  const byId = new Map<string, PopProcess>();
  POP_CATALOG.forEach((mod) =>
    mod.telas.forEach((screen) =>
      screen.processos.forEach((process) => byId.set(process.id, process)),
    ),
  );

  const outgoing = new Set<string>();
  byId.get(processId)?.estados.forEach((state) => {
    if (state.processoLink && state.processoLink !== processId && byId.has(state.processoLink)) {
      outgoing.add(state.processoLink);
    }
  });

  const incoming = new Set<string>();
  byId.forEach((process, id) => {
    if (id === processId) {
      return;
    }
    if (process.estados.some((state) => state.processoLink === processId)) {
      incoming.add(id);
    }
  });

  const toEntries = (ids: Set<string>) =>
    [...ids].map((id) => ({ id, nome: byId.get(id)?.nome ?? id }));

  return { incoming: toEntries(incoming), outgoing: toEntries(outgoing) };
}

export function firstPopProcessId(): string {
  return POP_CATALOG[0]?.telas[0]?.processos[0]?.id ?? "";
}
