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
];
