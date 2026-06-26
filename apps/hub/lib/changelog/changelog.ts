// Changelog do Panteon (fonte unica). Alimenta a aba Deploy no Zeus (tecnico) e o
// painel de novidades na Home (amigavel). Uma entrada por deploy de producao.
// Mais NOVA primeiro (indice 0 = o que esta no ar). Versao = semver; data/hora a parte.

export type ChangelogType = "correcao" | "melhoria" | "novidade";

// Bloco amigavel para o time: Modulo -> Tela -> bullets (acoes).
export type ChangelogScreen = {
  items: string[];
  screen: string;
};

export type ChangelogModule = {
  module: string;
  screens: ChangelogScreen[];
};

export type ChangelogEntry = {
  buildTag: string;
  deployedAt: string;
  modules: ChangelogModule[];
  rollback?: string;
  // Detalhe tecnico (so no Zeus).
  technical: {
    done: string;
    motivation: string;
  };
  title: string;
  type: ChangelogType;
  version: string;
};

export const PANTEON_CHANGELOG: readonly ChangelogEntry[] = [
  {
    buildTag: "2026-06-26-processos-pop",
    deployedAt: "2026-06-26T00:20:00-03:00",
    modules: [
      {
        module: "Panteon",
        screens: [
          {
            items: [
              'Nova aba "Processos POP" na Home: a biblioteca de processos e regras de negocio da Careli, organizada por modulo e tela.',
              "Cada processo tem fluxograma interativo (passe o mouse pra ver gatilho e SLA, clique pra focar o caminho), regras, SLA e ficha.",
              "Estreia com o Hades/Cobranca: o workflow de cobranca (a regua) e a classificacao de risco e prioridade.",
            ],
            screen: "Processos POP",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-fyue6qzpt",
    technical: {
      done: 'Nova area Hub-level "Processos POP" como aba da Home (app/page.tsx HomeTab; e aba, nao modulo no sidebar). Catalogo tipado em lib/processos/catalog.ts (Modulo->Tela->Processo, campos O&M + execucao BPM-ready); biblioteca com busca + pastas aninhadas (modulo->tela); detalhe em modal e visao full inline; fluxograma interativo proprio em SVG (hover com gatilho/SLA, click-to-focus, zoom, rotulos Sim/Nao). Seed: workflow de cobranca (maquina de estados) + classificacao de risco (arvore de decisao do score 0-99 -> prioridade). Sem dependencia nova, sem polling, sem migration. v1.5.0 -> v1.6.0.',
      motivation:
        "Centralizar os POPs e regras de negocio num lugar visual e vivo no Hub (O&M), comecando pela documentacao do workflow e do score de risco da Cobranca, com base que pode evoluir para BPM executavel.",
    },
    title: "Processos POP: biblioteca de processos e regras com fluxograma interativo",
    type: "novidade",
    version: "v1.6.0",
  },
  {
    buildTag: "2026-06-25-hades-dashboard-cockpit",
    deployedAt: "2026-06-25T18:40:00-03:00",
    modules: [
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Os numeros do Dashboard agora batem entre si — cards, paineis e graficos saem todos da mesma fonte ao vivo do C2X.",
              "Aging com um botao pra alternar a visao por parcela e por cliente.",
              "Clicar num card abre o detalhamento real (parcelas, clientes ou contratos).",
              "Clicar num empreendimento filtra tudo: aging, ranking de inadimplentes e contratos criticos.",
              "Visual mais limpo: sem os filtros que nao usavamos e com textos mais enxutos.",
            ],
            screen: "Dashboard",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-p5quqx6yg",
    technical: {
      done: "Dashboard do Hades passou a fonte unica ao vivo (loadHadesOperationalIntelligence + drill-down /api/guardian/kpi-drilldown), com os MESMOS predicados dos cards (overdueWhere); read-model virou fallback. Aging unico com toggle parcela/cliente + escopo por empreendimento; contratos criticos por empreendimento; nomes do C2X em Title Case; uppercase->Primeira Maiuscula em todo o Hades; barra de filtros mock removida. A1 (read-model + cron 15min + Asaas link-only) subiu junto. Prod careli-hub-hub-i2bs (HEAD pos-merge); rollback careli-hub-hub-i2bs-p5quqx6yg.",
      motivation:
        "Os paineis divergiam dos cards (mistura de read-model congelado de 17/mai com dados ao vivo); reconciliacao + limpeza de UI pedida pelo Lucas, com drill-down real por indicador.",
    },
    title: "Dashboard do Hades: numeros reconciliados + detalhamento real",
    type: "melhoria",
    version: "v1.5.0",
  },
  {
    buildTag: "2026-06-25-iris-caca-templates-ui",
    deployedAt: "2026-06-25T03:00:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              'A Iris agora tem a assistente de IA "CACA" atendendo no WhatsApp: ela identifica o cliente, confirma o cadastro com seguranca e ja envia o boleto.',
              "Quando precisa, ela transfere pra um atendente humano com o resumo do caso.",
            ],
            screen: "Atendimento",
          },
          {
            items: [
              "Tela de Templates mais limpa: a contagem (aprovados, pendentes, rejeitados) foi pros filtros.",
              'Filas e Assuntos agora cadastram em janela (pop-up): clique na fila pra filtrar os assuntos, no lapis pra editar e no "+" pra criar.',
            ],
            screen: "Setup",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-chs97qv89",
    technical: {
      done: "Port da Iris avancada decomposta + CACA (runtime V10 via Responses API, auth deterministica por fragmento de CPF, cache de billing por instancia TTL 120s) sobre a main; token Meta permanente (System User); hotfix Send/X na tela de templates; reforma de UI do Setup (templates enxuta + Filas&Assuntos com forms em modal). Prod dpl_GGAQgo52hENW38pbdbJcimxaTruv; merge feat/iris-caca-port->main (e509124).",
      motivation:
        "Levar o atendimento com IA da Iris (CACA, antes so em homolog) para producao, com Setup mais enxuto e estruturado conforme pedido do Lucas.",
    },
    title: "Iris: atendimento com IA (CACA) + Setup remodelado",
    type: "novidade",
    version: "v1.4.0",
  },
  {
    buildTag: "2026-06-24-novidades-workflow",
    deployedAt: "2026-06-24T17:30:00-03:00",
    modules: [
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "A Home ganhou um painel de Novidades mostrando o que mudou no Panteon (e a build atual).",
            ],
            screen: "Home",
          },
        ],
      },
      {
        module: "HelpDesk",
        screens: [
          {
            items: [
              "As etapas do seu chamado agora sao as MESMAS que a TI usa: Backlog, Novo, Em tratativa, Validacao, Revisao e Finalizado.",
            ],
            screen: "Meus chamados",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-huqm0q57v",
    technical: {
      done: "Novo HomeNovidadesPanel (le o changelog). Workflow unificado em lib/hub-it-tickets/workflow.ts; board do Zeus e painel do time importam a mesma logica.",
      motivation:
        "O painel de Rotina (Asana) deu lugar a Novidades; e o time via 11 status crus enquanto a TI via 5 etapas no Zeus - agora os dois usam o mesmo fluxo.",
    },
    title: "Novidades na Home + fluxo de chamados unificado",
    type: "melhoria",
    version: "v1.3.0",
  },
  {
    buildTag: "2026-06-24-thread-google-hd",
    deployedAt: "2026-06-24T14:11:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "O botao de resposta fica AZUL quando chega uma resposta nova e DOURADO depois de lida — na hora, sem precisar abrir.",
              "Clicar em qualquer lugar da mensagem abre o painel de respostas (nao so no iconezinho).",
            ],
            screen: "Conversa",
          },
          {
            items: [
              "Clicar na notificacao de uma resposta abre direto o painel de respostas.",
            ],
            screen: "Notificacao",
          },
        ],
      },
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Ao conectar o Google Agenda, agora ele oferece a sua conta @careli.adm.br certa (antes pegava a conta pessoal e dava erro).",
            ],
            screen: "Agenda",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-ndeb2afq9",
    technical: {
      done: "Bridge global passou a incrementar threadCount/lastThreadReplyAt ao receber resposta; clique no balao com guardas; notificacao carrega threadParentMessageId (evento + ?thread=). OAuth: hd=careli.adm.br + prompt=select_account.",
      motivation:
        "A marcacao de resposta so atualizava ao abrir a conversa, e a notificacao abria o canal em vez da thread. No Chronos, o OAuth deixava autorizar com a conta Google pessoal conflitante (gtempaccount) -> erro org_internal.",
    },
    title: "Respostas na conversa em tempo real + Google Agenda",
    type: "melhoria",
    version: "v1.2.0",
  },
  {
    buildTag: "2026-06-24-hermes-notif-overhaul",
    deployedAt: "2026-06-24T11:40:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "A notificacao do Windows agora vem SEMPRE com a foto e a mensagem de quem enviou.",
              "Acabou o som/aviso repetido ao reabrir o Hermes.",
              "O Historico de notificacoes agora lista CADA mensagem recebida no dia.",
            ],
            screen: "Notificacoes",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-1o1f9dhzn",
    technical: {
      done: "Provider virou notificador unico (som + toast + central + log); Web Push (SW) virou a unica notificacao de SO (avatar do banco). Workspace parou de alertar (matou re-disparo no catch-up). Log diario por mensagem.",
      motivation:
        "Dois notificadores sobrepostos + dedupe em memoria causavam som duplicado e re-disparo ao reabrir; a notificacao in-app nao tinha o avatar (nao vem no realtime), entao o time recebia generica.",
    },
    title: "Overhaul das notificacoes do Hermes",
    type: "melhoria",
    version: "v1.1.0",
  },
  {
    buildTag: "2026-06-24-chronos-google-connect",
    deployedAt: "2026-06-24T10:05:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Agora todo o time consegue conectar o Google Agenda (antes dava 'Sessao ausente').",
            ],
            screen: "Agenda",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-eemgj5bfi",
    technical: {
      done: "Cliente passou a buscar a URL de consentimento via fetch AUTENTICADO (com Bearer) e navegar para o Google; a rota /authorize devolve a URL em JSON.",
      motivation:
        "O botao de conectar navegava direto para a rota /authorize, e navegacao do browser nao manda o header Authorization -> 401 'Sessao ausente'. So quem ja estava conectado funcionava.",
    },
    title: "Conexao do Google Agenda corrigida",
    type: "correcao",
    version: "v1.0.1",
  },
  {
    buildTag: "2026-06-24-thread-emoji-edit",
    deployedAt: "2026-06-24T08:30:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "Da pra EDITAR as suas respostas dentro da conversa (botao de lapis).",
              "Emoji no campo de resposta.",
              "Alinhamento do campo de resposta arrumado.",
            ],
            screen: "Conversa",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-65ic8l18u",
    technical: {
      done: "handleEditMessage passou a tratar respostas (editThreadReplyMessage); onEditMessage nos itens de resposta; emoji picker reaproveitado; linha do compositor realinhada (alturas iguais, texto centralizado).",
      motivation:
        "Nao dava para editar uma resposta depois de enviada, faltava emoji no compositor da thread e a linha estava desalinhada.",
    },
    title: "Respostas: edicao, emoji e alinhamento",
    type: "novidade",
    version: "v1.0.0",
  },
  {
    buildTag: "2026-06-22-hermes-lote",
    deployedAt: "2026-06-22T19:00:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "Som de notificacao corrigido (sem duplicar ao reabrir).",
              "Respostas em thread carregando os dados certos.",
              "Envio de imagens grandes (ate 50MB) por link assinado.",
              "Historico de mensagens e da aba diario corrigidos.",
            ],
            screen: "Conversa",
          },
        ],
      },
    ],
    technical: {
      done: "Lote consolidado de correcoes do Hermes (som, thread data, central, respostas-notif, historico, imagens 50MB).",
      motivation: "Apontamentos do time em 22/jun.",
    },
    title: "Lote de correcoes do Hermes",
    type: "correcao",
    version: "v0.9.0",
  },
];
