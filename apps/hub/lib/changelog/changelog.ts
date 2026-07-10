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
    buildTag: "2026-07-10-apolo-laboratorio-enriquecimento",
    deployedAt: "2026-07-10T00:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova tela para avaliar o enriquecimento antes de ligá-lo no cadastro: consulta um CPF ou CNPJ e mostra o dado real que o MOST devolve, organizado nas abas Identificação, Contato, Endereço, Profissional, Financeiro, Risco, Rede e Digital.",
              "Cada campo tem o seletor Automático, Sob demanda ou Fora, e o painel lateral calcula quantos cadastros o plano contratado aguenta com a escolha feita.",
              "As consultas são acumulativas: você dispara só a query que precisa e os resultados se somam na tela.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit f55b4fb3 (v1.29.3)",
    technical: {
      done: "mostqi.probeEnrichment(documento, {query}) devolve os datasets crus (name/status/data) por query nomeada, aceitando CPF (11) e CNPJ (14) via parameters {cpf}|{cnpj}; callEnrichment passou a receber parameters em vez de cpf. mockProbe cobre CARELI_PF_01/02/03/04 e PJ_01/02/03 com payload fiel ao BigDataCorp (localhost = simulado, custo zero). Nova action probe na rota /api/apolo/mostqi. lib/apolo/enrichment-spec.ts: 8 abas, ~80 campos (PF+PJ) com dataset de origem, chaves de leitura tolerante (deepFind case-insensitive + caminho pontuado), politica sugerida (auto|operador|fora) e query CARELI que entrega o dado; calcularCusto conta datasets distintos marcados auto (1 dataset = 1 unidade; plano padrao 10.000). Tela modules/apolo/blocks/enriquecimento/enrichment-lab.tsx. CARELI_PF_04 e a query PROPOSTA com os datasets novos (demographic_data, class_organization, auth_score_gold, kyc, related_people, business_relationships, social_assistance, professional_turnover, interests_and_behaviors, related_people_phones): so responde em prod depois que o MOST cria-la.",
      motivation:
        "Lucas paga por dataset consultado. Antes de levar o enriquecimento pro Apolo, ele precisa ver o dado real com o olho e decidir campo a campo o que entra automatico no CAD, o que fica sob demanda do operador e o que sai — com o custo do plano visivel na decisao.",
    },
    title: "Apolo: laboratório de enriquecimento (decidir o que entra no CAD)",
    type: "novidade",
    version: "1.30.0",
  },
  {
    buildTag: "2026-07-09-cadastro-certidoes-financeiro",
    deployedAt: "2026-07-09T18:55:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cadastro de CAD: ao clicar em Enviar, as certidões do cliente (antecedentes, trabalhista, Receita, processos, sanções) são consultadas em segundo plano e aparecem com o status de cada uma.",
              "Novo botão Rodar análise financeira, que faz a consulta profunda (renda, patrimônio e mais) sob demanda.",
            ],
            screen: "Cadastro de CAD — Revisão",
          },
        ],
      },
    ],
    rollback: "commit 8025d70f (v1.29.2)",
    technical: {
      done: "mostqi.enrichPerson aceita opts.query; callEnrichment usa a query passada (CARELI_PF_02 certidoes / _03 GOLD) alem da default _01. route: repassa body.query. cadastro-flow StepRevisao: Enviar dispara PF_02 (certidoes, background) e mostra CertidaoCard (status por tone + link PDF); botao Rodar analise financeira dispara PF_03 (renda/patrimonio + certidoes). LOCAL_MOCK usa mockCertidoes. ATENCAO: parser de PF_02 (extractCertidoes) e o mapeamento do GOLD sao best-effort, a validar com resposta real em prod. v1.29.2 -> v1.29.3.",
      motivation:
        "Lucas: ligar as consultas pesadas do MOST em duas etapas — certidoes automaticas no envio (PF_02) e financeiro profundo manual (PF_03) — validando tela a tela antes de levar pro Apolo.",
    },
    title: "Cadastro: certidões no envio (PF_02) + análise financeira manual (PF_03)",
    type: "novidade",
    version: "1.29.3",
  },
  {
    buildTag: "2026-07-09-cadastro-doc-e-comprovante",
    deployedAt: "2026-07-09T18:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cadastro de CAD: o Tipo do documento agora mostra qual é (CNH, RG, Passaporte; e nos comprovantes: conta de luz, água, telefone, correspondência bancária).",
              "Comprovante de endereço ganhou um selo de validade: Atual (emitido nos últimos 3 meses) ou Desatualizado, com a data.",
              "Botão X para sair da tela de cadastro.",
            ],
            screen: "Cadastro de CAD",
          },
        ],
      },
    ],
    rollback: "commit 9c7a081b (v1.29.1)",
    technical: {
      done: "mapDocType (c2x-fields) reconhece CNH/RG/Passaporte + comprovantes (luz/agua/telefone/gas/bancario/comprovante) e, quando nao reconhece, mostra a classificacao crua do MOST (titleCase) em vez de generico. cadastro-flow: Endereco ganhou tipoDocumento + dataDocumento (acharDataComprovante varre ext.fields por data); campo Tipo + selo ComprovanteRecencia (mesesDesde <= 3 = atual); botao X (link /apolo) no header. v1.29.1 -> v1.29.2.",
      motivation:
        "Lucas validou o PF real: faltava saber qual documento foi lido, saber se o comprovante esta atual (3 meses) e ter como sair da tela.",
    },
    title: "Cadastro: tipo de documento específico + validade do comprovante + sair",
    type: "melhoria",
    version: "1.29.2",
  },
  {
    buildTag: "2026-07-09-cadastro-pf-fixes",
    deployedAt: "2026-07-09T17:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cadastro de CAD: sexo e patrimônio agora vêm preenchidos do enriquecimento (antes ficavam em branco).",
              "Endereço passa a aparecer com a primeira letra maiúscula, no mesmo padrão dos outros campos.",
              "Novo botão Enviar na tela de revisão, separado do Gerar CAD (que continua gerando o PDF).",
            ],
            screen: "Cadastro de CAD",
          },
        ],
      },
    ],
    rollback: "commit e1fac848 (v1.29.0)",
    technical: {
      done: "mostqi.ts normalizeEnrichment: sexo (basic_data.gender/sex) e patrimonio (financial_data.totalAssets) viram campos proprios (renda limpa, so a faixa); EnrichmentResult ganhou sexo+patrimonio. cadastro-flow: titleCase no StepEndereco; botao Enviar (estado enviado; placeholder ate o wiring de e-mail de confirmacao + outbox). v1.29.0 -> v1.29.1.",
      motivation:
        "Lucas testou o cadastro real em prod (Vercel->proxy->MOST): patrimonio e sexo nao vinham (bug de mapeamento do enriquecimento), enderecos em caixa alta, e faltava um botao Enviar distinto do Gerar CAD.",
    },
    title: "Cadastro: sexo/patrimônio do enriquecimento + endereço em title case + botão Enviar",
    type: "correcao",
    version: "1.29.1",
  },
  {
    buildTag: "2026-07-09-apolo-pj-imobiliarias-most",
    deployedAt: "2026-07-09T16:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cadastro de CAD agora reconhece também EMPRESA: se você sobe um cartão CNPJ, ele abre a ficha de pessoa jurídica (razão social, sócios/QSA, situação, CNAE); RG ou CNH seguem abrindo pessoa física.",
              "O seletor de imobiliária/corretor no cadastro passou a trazer a base real do Apolo (não mais uma lista de exemplo).",
              "Ficha do cliente: agora aparecem TODOS os papéis da pessoa em etiquetas (ex.: Corretor + Comprador ao mesmo tempo) e uma nova aba Relacionamentos, separando vínculos de trabalho e de contato.",
            ],
            screen: "Cadastro de CAD e ficha do cliente",
          },
        ],
      },
    ],
    rollback: "commit ec26bf83 (v1.28.0)",
    technical: {
      done: "Cadastro: persona por documento (isCnpjDoc -> PJ; senão PF) com ficha/enriquecimento/CAD de empresa (cadastro-flow.tsx). Imobiliárias reais via GET /api/apolo/imobiliarias -> loadApoloImobiliarias() (leitura leve do read-model, perfil imobiliaria). MOST agora sai por PROXY de IP fixo: app (Vercel) -> Caddy na VPS Lightsail 54.21.0.240 (https://54-21-0-240.sslip.io, header X-Proxy-Secret) -> production-mostqiapi.com (whitelist); query default CARELI_PF_01 (mostqi.ts + envs MOSTQI_BASE_URL/PROXY_SECRET/ENRICHMENT_QUERY). Apolo record-workspace: chips de todos os papeis + nova aba Relacionamentos (relationships-panel, trabalho/contato) + rota interna /apolo/mock para iterar a ficha. v1.28.0 -> v1.29.0.",
      motivation:
        "Lucas: cadastrar empresa (PJ) além de PF, usar a base real de imobiliárias, ligar o MOST em produção pela porta oficial (IP fixo na whitelist) e começar a reestruturação do Apolo como CRM de grafo (papéis + relacionamentos).",
    },
    title: "Apolo: cadastro PJ + imobiliárias reais + MOST por IP fixo + papéis/relacionamentos na ficha",
    type: "novidade",
    version: "1.29.0",
  },
  {
    buildTag: "2026-07-09-apolo-cadastro-cad",
    deployedAt: "2026-07-09T00:45:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Novo botão + no topo do Apolo abre o cadastro de CAD: você escolhe o tipo (Prospect já disponível; Imobiliária, Colaborador, Fornecedor e Parceiro chegam em breve).",
              "Cadastro de Prospect por documento: suba o RG ou a CNH e o sistema lê os dados e completa o resto pela consulta ao CPF (nome da mãe, telefone, faixa de renda, sexo). O endereço vem do comprovante.",
              "Casado ou união estável abre a ficha completa do cônjuge (também lida e enriquecida) e pede a certidão correspondente ao estado civil, com a autenticidade verificada.",
              "Telefone com país (bandeira e formato de cada país) e edição livre, e-mail com validação. No fim, o CAD sai como um documento em PDF pronto para imprimir.",
            ],
            screen: "Cadastro de CAD",
          },
        ],
      },
    ],
    rollback: "commit b55f4f2d (v1.27.5)",
    technical: {
      done: "Novo fluxo /apolo/cadastro (CadastroFlow): wizard Identificacao -> Endereco -> (Certidao se casado/div/sep/uniao) -> Revisao. Leitura de documento via MOST (route /api/apolo/mostqi: authenticate/extract/enrich; lib/apolo/mostqi.ts) + enriquecimento por CPF. Campos do C2X em lib/apolo/c2x-fields.ts (sexo/estado civil/escolaridade/faixa renda com ids FK) + c2x-professions.ts (234). Conjuge: ficha espelho do titular, lida + enriquecida (sexo/telefone/renda/patrimonio), escolaridade/profissao manuais, email != titular. PhoneField internacional (PHONE_COUNTRIES + mascara por pais). Gera CAD como documento HTML proprio em janela nova (window.print), titulo Cadastro de CAD, subtitulo Prospect, vinculo/imobiliaria no topo. Botao + no ApoloHeader (apolo-shell) abre seletor de tipos (lib/apolo/cadastro-tipos.ts; so Prospect disponivel). ATENCAO: MOST em prod exige IP na whitelist; a Vercel nao tem IP fixo, entao a leitura de documento pode falhar ate colocarmos um proxy de IP fixo (LOCAL_MOCK cobre so o localhost). v1.27.5 -> v1.28.0.",
      motivation:
        "Lucas: montar o cadastro de CAD do Apolo (foco Prospect) por documento, com leitura e enriquecimento automaticos e CAD final impressao-ready, ligado ao botao + do Apolo com seletor de tipo.",
    },
    title: "Apolo: cadastro de CAD por documento (Prospect) com leitura + enriquecimento MOST",
    type: "novidade",
    version: "1.28.0",
  },
  {
    buildTag: "2026-07-07-chronos-lupa-apresentacao",
    deployedAt: "2026-07-07T19:10:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Nova LUPA na videochamada: botões flutuantes de zoom (até 3x) para ampliar a SUA visão da tela apresentada e arrastar para navegar — sem afetar quem está apresentando.",
              "Dica de uso: dê duplo clique na apresentação (o Whereby a maximiza) e use a lupa em cima.",
              "Tela de configurar sala agora mostra qual fundo personalizado está definido (antes dizia 'sem fundo' mesmo com fundo salvo).",
            ],
            screen: "Sala de vídeo e configuração de salas",
          },
        ],
      },
    ],
    rollback: "commit 0cd6b3fc (v1.27.4)",
    technical: {
      done: "ChronosExternalRoomPage: whereby-embed envolvido em scroller de zoom (conteudo z*100% + iframe 100/z% com transform scale(z) origin 0 0 — rolagem natural cobre a area ampliada); overlay de pan por pointer capture quando z>1 (bloqueia cliques no player; botao Nx volta a 1x); controles flutuantes ZoomIn/ZoomOut/reset (niveis 1/1.5/2/3). Nao ha como mirar so no tile da apresentacao (iframe cross-origin do Whereby); o combo duplo-clique-maximiza + lupa entrega o efeito. rooms-management-screen: dialogo mostra 'Fundo personalizado definido: nome' quando ha fundo salvo sem os bytes (strip de 7/jul). v1.27.4 -> v1.27.5.",
      motivation:
        "Lucas (ao vivo numa apresentacao, 18h40): 'teria como colocar uma lupa para quem esta vendo o video dar zoom sem eu, que estou apresentando, dar zoom na minha tela?' + dialogo de sala mentindo 'sem fundo enviado' apos o strip dos bytes.",
    },
    title: "Chronos: lupa na videochamada (zoom individual na apresentação)",
    type: "novidade",
    version: "1.27.5",
  },
  {
    buildTag: "2026-07-07-hermes-threads-no-canal",
    deployedAt: "2026-07-07T17:55:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "Respostas de thread não lidas agora acendem a bolinha e o contador na frente do canal (antes só mensagens diretas contavam).",
              "A bolinha fica vermelha quando a resposta te menciona — e só apaga quando você abre a thread.",
              "Central de notificações: uma cor única por módulo na barrinha lateral (Hermes dourado, Chronos azul, Iris violeta, Hades verde).",
            ],
            screen: "Canais e Central de notificações",
          },
        ],
      },
    ],
    rollback: "commit b6a75b06 (v1.27.2)",
    technical: {
      done: "pulsex-workspace: threadUnreadByChannelId (useMemo sobre messages x threadUnreadCountByMessageId x threadMentionParents) somado aos contadores do canal via channelsForSidebar (canal aumentado antes da ConversationSidebar — bolinha/contador/vermelho ganham threads sem tocar nos componentes). Morre ao abrir a thread (threadReadState), independente da leitura do canal. panteon-notification-button: barrinha da central por MODULE_ACCENTS[moduleId] em vez de severidade (mencao segue clara no titulo). v1.27.3 -> v1.27.4 (colisao de versao com a entrada Iris motivo-encerramento, publicada em paralelo).",
      motivation:
        "Print do Lucas 17:42: central com '2 mensagens em Atendimento' pendentes (respostas de thread) e canal SEM bolinha; e itens do Hermes com duas cores na central (severidade) parecendo modulos distintos.",
    },
    title: "Hermes: respostas de thread acendem o canal + cor única por módulo na central",
    type: "correcao",
    version: "1.27.4",
  },
  {
    buildTag: "2026-07-07-iris-motivo-encerramento",
    deployedAt: "2026-07-07T15:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Para encerrar um atendimento agora é obrigatório informar o ASSUNTO e o MOTIVO do encerramento.",
              "O motivo tem 3 opções: Finalizado · Sem Interação · Sem Continuidade. O botão Encerrar só libera depois de escolher os dois.",
              "O motivo fica registrado no ticket (e na timeline) — dá pra saber por que cada atendimento foi fechado.",
            ],
            screen: "Atendimento — Encerrar",
          },
        ],
      },
    ],
    rollback: "commit anterior na main",
    technical: {
      done: "IrisCobrancaCloseModal: novo select 'Motivo do encerramento' (IRIS_CLOSE_REASON_OPTIONS: Finalizado/Sem Interação/Sem Continuidade), obrigatório; onConfirm passa { note, reason, subject } e o Encerrar fica disabled sem subject+reason. IrisPage.performClose envia closeMotivo pra PATCH /api/iris/tickets action=close + inclui no log da timeline. API: parse closeMotivo (normalizeText) e persiste metadata.closedMotivo (enforçado na UI; fechamentos automáticos da Caca seguem sem motivo). v1.27.2 -> v1.27.3.",
      motivation:
        "Pedido do Lucas: no encerramento da Iris exigir assunto + motivo (3 opções) e apontar por que o ticket está sendo fechado.",
    },
    title: "Iris: motivo do encerramento obrigatório (Finalizado/Sem Interação/Sem Continuidade)",
    type: "melhoria",
    version: "1.27.3",
  },
  {
    buildTag: "2026-07-07-iris-mensagens-instantaneas",
    deployedAt: "2026-07-07T15:40:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Mensagem nova do atendimento aberto aparece NA HORA na conversa (antes demorava alguns segundos e às vezes só com F5).",
              "A conexão em tempo real agora se reconecta sozinha quando cai — sem precisar dar F5 pra 'acordar' a fila.",
            ],
            screen: "Atendimento (conversa e fila)",
          },
        ],
      },
    ],
    rollback: "commit b5bcb8fd",
    technical: {
      done: "IrisPage realtime: (1) INSERT/UPDATE de caredesk_messages agora aplica payload.new DIRETO na conversa aberta (mapMessageRow + upsert ordenado no activeThread, guard por selectedTicketIdRef) — antes todo evento so agendava refresh debounced de 2,5s que recarregava a fila inteira; (2) assinatura resiliente: .subscribe(status) com rejoin + backoff (2s->30s) em CHANNEL_ERROR/TIMED_OUT/CLOSED e refresh de recuperacao ao reconectar — o canal morria em silencio e so o polling de 90s ou o F5 salvavam. Mesmo playbook do Hermes v1.27.0. v1.27.1 -> v1.27.2.",
      motivation:
        "Time (via Lucas 7/jul ~15h30): mensagens na Iris demorando a aparecer; notificacao chega e a mensagem nao; as vezes so com F5.",
    },
    title: "Iris: mensagens aparecem na hora (e a conexão se recupera sozinha)",
    type: "correcao",
    version: "1.27.2",
  },
  {
    buildTag: "2026-07-07-hermes-busca-canal",
    deployedAt: "2026-07-07T13:45:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "A lupa no topo da conversa agora funciona: clique nela e busque um texto DENTRO do canal aberto.",
              "A conversa passa a mostrar só as mensagens que contêm o termo, com o número de resultados. Esc ou o X fecham a busca.",
            ],
            screen: "Conversa (canal)",
          },
        ],
      },
    ],
    rollback: "commit e8ac3cbf (v1.27.0)",
    technical: {
      done: "A lupa do ConversationHeader era um botão sem ação. Agora abre um input inline; o termo é elevado ao pulsex-workspace (messageSearchQuery, reset ao trocar de canal) e filtra as mensagens do canal ativo por body (case-insensitive), passando a lista filtrada pra MessageList + contador de resultados no header. Zero rede — filtro client-side sobre as mensagens já carregadas. v1.27.0 -> v1.27.1.",
      motivation:
        "Lucas: habilitar a lupa no Hermes para o time procurar texto dentro do canal.",
    },
    title: "Hermes: busca de texto dentro do canal (lupa)",
    type: "novidade",
    version: "1.27.1",
  },
  {
    buildTag: "2026-07-07-hermes-notificacoes-v2",
    deployedAt: "2026-07-07T13:30:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "Fim do delay: ao clicar na notificação, a mensagem já aparece na conversa na hora (antes demorava alguns segundos).",
              "Clicar numa notificação da central abre DIRETO no canal (o popup flutuante não abre mais).",
              "O aviso escrito dentro do app saiu: agora é só o som + marcações visuais (aba, central e bolinha na frente do canal).",
              "Nova convenção de cores: DOURADO = mensagem nova · VERMELHO = você foi mencionado (bolinha do canal, badge e aba).",
              "O marcador de respostas na mensagem fica VERMELHO quando alguém te menciona dentro da thread.",
            ],
            screen: "Canais, central e notificações",
          },
        ],
      },
    ],
    rollback: "commit 6d46b581",
    technical: {
      done: "(1) Toast in-app removido do handleHermesMessage (som mantido, gate por foco). (2) openHermesChannel fora do /hermes: router.push(getHermesChannelPath) em vez de popup (workspace ja le ?channel/?thread no mount). (3) Convencao dourado/vermelho: conversation-item (bolinha leading + badges) e panteon-module-tabs (mention rose-500, unread dourado — estava invertido). (4) lib/pulsex/thread-mentions.ts (localStorage por usuario + evento): provider grava quando reply menciona; workspace pinta o chip de respostas (message-item threadHasMention, prioridade sobre unread) e limpa em markThreadRepliesRead. (5) lib/pulsex/recent-messages-cache.ts (Map em escopo de modulo, 30/canal): provider alimenta no realtime; loadActiveChannelMessages SEMEIA a 1a carga do canal com o cache (mergeHermesChannelMessages replaceChannel:false) antes do fetch reconciliar — mata o delay notificacao->mensagem. v1.26.2 -> v1.27.0.",
      motivation:
        "Pedido do Lucas 7/jul ~13h: tirar o aviso escrito in-app, cor distinta quando mencionado (canal e thread), central abrindo direto no canal, e 'o principal: a notificacao chega primeiro que a mensagem' — fechar a dor de cabeca do Hermes de vez.",
    },
    title: "Hermes: mensagens instantâneas, cores de menção e central direto no canal",
    type: "melhoria",
    version: "1.27.0",
  },
  {
    buildTag: "2026-07-07-hermes-notificacoes-persistentes",
    deployedAt: "2026-07-07T11:20:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "Notificações não somem mais sozinhas ao restaurar o hub minimizado: a reconciliação buscava mensagens ANTIGAS do banco e zerava os contadores por engano. Agora busca as mais recentes.",
              "Nova marcação NA FRENTE do canal: bolinha dourada quando há mensagem não lida (âmbar quando há menção) + nome em negrito. Só some quando você abre o canal de verdade.",
              "Ao restaurar a janela com a conversa aberta na tela, a mensagem é marcada como lida com honestidade (você está vendo ela).",
            ],
            screen: "Canais e Central de notificações",
          },
        ],
      },
    ],
    rollback: "commit f9ae51ef",
    technical: {
      done: "refreshHermesSnapshot buscava listRecentChannelMessages com after=getOldestHermesReadCursor (cursor do canal mais ANTIGO) e a API/fallback ordenam ASC com after — canal parado ha semanas => janela de 200 mensagens toda VELHA => withChannelUnreadCounts zerava => catch-up de foco apagava badge/aba/central segundos apos restaurar a janela ('minimizado chega; ao abrir some'). Fix: fetch sem after (modo sem cursor ja devolve as 200 mais recentes em ordem cronologica); getOldestHermesReadCursor removido. + conversation-item: bolinha leading (dourada unread/ambar mencao) + nome bold. + pulsex-workspace: listener de window focus marca lida a conversa ABERTA na tela ao restaurar (leitura legitima; receipt zera contadores locais). v1.26.1 -> v1.26.2.",
      motivation:
        "Lucas 10:35/11:05: 'notificacoes sumindo no hermes... mega revisao' + detalhe decisivo 'no panteon nao somem; com hub minimizado, ao abrir some' + pedido explicito de marcacao na frente do canal.",
    },
    title: "Hermes: notificações persistentes + marcação na frente do canal",
    type: "correcao",
    version: "1.26.2",
  },
  {
    buildTag: "2026-07-07-chronos-teto-1000-servidor",
    deployedAt: "2026-07-07T10:55:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Achada e corrigida a causa das reuniões que faltavam no calendário: o banco corta silenciosamente qualquer consulta em 1000 linhas, e a busca da agenda parava dias ANTES de hoje (a linha 1000 caía em 03/07). Só apareciam as reuniões em que você era o organizador.",
              "Agora a agenda busca em páginas e cobre a janela inteira (30 dias pra trás, 90 pra frente). A semana deve finalmente bater com o Google.",
            ],
            screen: "Agenda",
          },
        ],
      },
    ],
    rollback: "commit b4e4eff4",
    technical: {
      done: "PostgREST db-max-rows=1000 IGNORA o .limit() do codigo: a query geral (janela asc, limit 5000) devolvia as 1000 linhas mais antigas e morria em 03/07 (SQL: row_number 1000 = 03/07 20:00; semana atual so via query owned). Fix: helper listChronosPagedRows (.range em paginas de 1000, teto configuravel) aplicado nas 3 queries de reunioes do snapshot (geral -30/+90d 6pg, owned 3pg, artefatos 3pg) + listChronosMeetingRelatedRows pagina DENTRO de cada chunk de 100 ids (participantes/segmentos de 100 reunioes podem passar de 1000 linhas) + ordenacao secundaria por id p/ paginacao estavel. 3o incidente do teto-1000 (Iris v1.20.1, participacoes v1.25.2) — auditoria global de queries sem paginacao ja aberta como task. v1.26.0 -> v1.26.1.",
      motivation:
        "Lucas 10:28: 'reunioes nao apareceram, mesmo erro' — v1.26.0 carregava sem erro mas a semana continuava so com reunioes host=Lucas; simulacao SQL do pipeline provou payload deveria ter 6 reunioes na terca e o servidor devolvia so 1.",
    },
    title: "Chronos: semana completa no calendário (teto de 1000 no servidor)",
    type: "correcao",
    version: "1.26.1",
  },
  {
    buildTag: "2026-07-07-chronos-snapshot-leve",
    deployedAt: "2026-07-07T10:40:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Correção definitiva do 'Não foi possível carregar o Chronos': o módulo carregava TODOS os dados de TODAS as reuniões (transcrições completas, histórico, sincronização com o Whereby) em cada acesso e o servidor caía por memória nos horários de pico.",
              "Agora a agenda abre leve: transcrição, timeline e chat carregam só quando você abre a reunião.",
              "A sincronização de gravações/transcrições do Whereby passou a rodar em segundo plano (a cada 15 min), não mais durante o carregamento da página.",
            ],
            screen: "Agenda e Drive",
          },
        ],
      },
    ],
    rollback: "commit eb792774",
    technical: {
      done: "SNAPSHOT LEVE: listChronosSnapshot nao carrega mais timeline (4MB) + transcript segments (9MB) de todas as reunioes — só resumo leve (transcriptSegmentCount + transcriptSpeakerLabels via select meeting_id,speaker_label). Nova rota GET /api/chronos/meetings/[id]/artifacts (timeline+transcript+chat de UMA reuniao, com check host/participante/admin) + hidratacao sob demanda no ChronosPage (useEffect na selecao, Set de hidratadas). syncPendingChronosWherebyArtifactsForSnapshot REMOVIDO do GET -> export runChronosWherebyArtifactSweep chamado pelo sync-cron (*/15min, teto por rodada, actor = host da reuniao). drive_snapshot_diagnostic reduzido a contagens. Drive card/library usam o resumo leve. Causa raiz dos OOMs 'instance was killed' no /api/chronos/meetings (7 kills/4h, medicao: transcricoes 9MB + timeline 4MB + participantes 2.7MB por load por usuario + Whereby API inline). v1.25.3 -> v1.26.0.",
      motivation:
        "Lucas 09:59: 'teria como resolver de vez esse problema? estamos desde manha' — Chronos com 'Nao foi possivel carregar' recorrente mesmo apos v1.25.1/1.25.2; logs mostraram OOM persistente com apenas 284 reunioes visiveis.",
    },
    title: "Chronos: carregamento leve e estável (fim do 'não foi possível carregar')",
    type: "correcao",
    version: "1.26.0",
  },
  {
    buildTag: "2026-07-07-hermes-thread-nao-lida",
    deployedAt: "2026-07-07T10:00:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "Resposta em thread agora conta como mensagem não lida: o badge do canal, o @ na aba do Hermes e o item na central não somem mais sozinhos.",
              "A central passa a mostrar o filtro do Hermes quando há novidades do chat.",
            ],
            screen: "Canais e Central de notificações",
          },
        ],
      },
    ],
    rollback: "commit 21fc381a",
    technical: {
      done: "withChannelUnreadCounts (lib/pulsex/workspace-messages.ts) excluia mensagens com threadParentMessageId da contagem de nao-lidas. O realtime marcava badge canal/aba/central corretamente, mas o catch-up de foco (refreshHermesSnapshot, throttle 5s) recalculava por essa funcao -> unread=0 -> setHermesChannels substituia o estado e o retain filter derrubava o item da central (id fora de hermesNotificationIds). Fix: thread reply conta como nao-lida (so deletadas ficam fora); consistente com a decisao de 1/jul (thread entra na central) e com o push 'respondeu voce'. v1.25.2 -> v1.25.3.",
      motivation:
        "Teste do Lucas 09:35: push 'Nivea respondeu voce em Tecnologia' chegou, @ ambar apareceu na aba do Hermes e SUMIU sozinho; canal sem indicacao de nova mensagem e central sem o item (nem chip Hermes).",
    },
    title: "Hermes: resposta em thread não some mais das notificações",
    type: "correcao",
    version: "1.25.3",
  },
  {
    buildTag: "2026-07-07-chronos-hotfix-participacao",
    deployedAt: "2026-07-07T09:45:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Correção: algumas reuniões em que você é convidado ainda não apareciam no calendário (a lista de participações vinha incompleta do banco). Agora a agenda bate com o Google.",
            ],
            screen: "Agenda",
          },
        ],
      },
    ],
    rollback: "commit 5776cbb2",
    technical: {
      done: "loadChronosParticipatedMeetingIds paginado (.range em blocos de 1000, teto 20 paginas): o PostgREST cap de 1000 linhas devolvia um recorte arbitrario das participacoes (Lucas: 4.566 linhas por email) -> Set incompleto -> reunioes de convidado sumiam aleatoriamente do calendario. Mesmo padrao do teto-1000 da Iris (v1.20.1). v1.25.1 -> v1.25.2.",
      motivation:
        "Print do Lucas 09:22: agenda do Chronos com 3 eventos na semana vs Google com ~15; participacoes conferidas no banco estavam corretas — o loader e que cortava em 1000.",
    },
    title: "Chronos: reuniões de convidado voltaram a aparecer (teto de 1000)",
    type: "correcao",
    version: "1.25.2",
  },
  {
    buildTag: "2026-07-07-chronos-hotfix-snapshot",
    deployedAt: "2026-07-07T09:20:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Correção rápida: a Agenda e o Drive não carregavam para administradores logo após a v1.25.0 (erro de memória no servidor). Já normalizou.",
            ],
            screen: "Agenda e Drive",
          },
        ],
      },
    ],
    rollback: "commit 5776cbb2",
    technical: {
      done: "isChronosMeetingVisibleInSnapshot: participatedMeetingIds carregado p/ todos (admin inclusive) e import do Google visivel APENAS por host/participacao — sem bypass de admin nesse ramo (admin mantem bypass so nos ARTEFATOS). v1.25.0 abriu ~4k imports p/ admin e o snapshot carrega participantes/timeline/transcricao por reuniao -> OOM ('instance was killed because it ran out of available memory') no GET /api/chronos/meetings. v1.25.0 -> v1.25.1.",
      motivation:
        "Print do Lucas ~08:59: 'Nao foi possivel carregar o Chronos' na Agenda e Drive vazios em prod, minutos apos o go-live da v1.25.0.",
    },
    title: "Chronos: hotfix — Agenda/Drive carregando de novo para admins",
    type: "correcao",
    version: "1.25.1",
  },
  {
    buildTag: "2026-07-07-chronos-agenda-confiavel",
    deployedAt: "2026-07-07T08:00:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "O calendário agora mostra TODAS as reuniões da equipe (antes algumas sumiam e cada tela mostrava uma coisa).",
              "Reuniões importadas do Google aparecem para todos os convidados, não só para quem criou.",
              "A agenda sincroniza com o Google sozinha, de 15 em 15 minutos, mesmo com o hub fechado.",
              "Só entram no Chronos reuniões da empresa: a rotina pessoal do Google de cada um fica fora.",
              "Reuniões duplicadas (a mesma reunião aparecendo 2 ou 3 vezes) foram unificadas.",
            ],
            screen: "Agenda",
          },
          {
            items: [
              "Visual novo dos cards: status de Vídeo, Transcrição e Ata em etiquetas coloridas com detalhe ao passar o mouse.",
              "Quem participou agora aparece mesmo em salas abertas sem convite (nomes vêm da transcrição).",
              "Vídeos que estavam presos como 'Pendente' voltaram a ficar disponíveis (limite de upload corrigido).",
            ],
            screen: "Drive",
          },
        ],
      },
    ],
    rollback: "commit 5776cbb2",
    technical: {
      done: "listChronosSnapshot: janela -45/+120d asc limit 5000 (antes limit 1500 starts_at DESC cortava a semana atual com >1500 futuras); visibilidade de imports Google p/ admin+participantes; filtro de import company-only (Careli:*/@careli.adm.br/deslocamento; envs CHRONOS_GOOGLE_IMPORT_*); lookup de vinculo deterministico (created_at asc); etag early-exit + nota de timeline so com mudanca real (620k notas de spam apagadas); host_user_id nao e mais roubado pelo sync; cron novo /api/chronos/google-calendar/sync-cron (*/15min); Drive card redesenhado (chips artefato, pessoas via transcript speakers, objetivo generico oculto); 'Sala pendente' -> endereco Google/'Google Agenda'. Banco: 354 duplicatas removidas (canonica preservada), 1.404 itens pessoais soft-cancelados, Global file size limit 50MB->2GB + bucket 2GB (madrugada), 29 orfaos re-enfileirados no egress. v1.24.5 -> v1.25.0.",
      motivation:
        "Prints do Lucas 7/jul: Google Calendar x agenda Chronos x Meu dia com 3 respostas diferentes, videos sem aparecer, atas travadas, Drive baguncado. Diagnostico completo achou 6 causas raizes (ver memoria project_chronos_diagnostico_completo).",
    },
    title: "Chronos: agenda confiável, sync automático e Drive repaginado",
    type: "melhoria",
    version: "1.25.0",
  },
  {
    buildTag: "2026-07-07-promessa-multi-parcela",
    deployedAt: "2026-07-07T00:55:00-03:00",
    modules: [
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Na Nova promessa, o operador agora pode marcar MAIS DE UMA parcela (antes travava em uma só).",
              "Novo botão 'Incluir todas' pra selecionar todas as parcelas em negociação de uma vez (e 'Limpar seleção' pra desmarcar).",
            ],
            screen: "Cobrança — Nova promessa",
          },
        ],
      },
    ],
    rollback: "commit 2f105460",
    technical: {
      done: "PropostasPanel: a função toggle tinha um ramo `if (kind === 'promessa')` que limpava a seleção e deixava só a parcela clicada (single-select). Removido — promessa e acordo agora multi-selecionam via o Set `selected`. O submit já guardava c2x_parcelas como array e amount = soma das selecionadas, então nada mais precisou mudar no backend. Adicionado toggleAll + botão 'Incluir todas'/'Limpar seleção'. v1.24.4 -> v1.24.5.",
      motivation:
        "Print/gravação do Lucas: no formulário de Nova promessa do Hades o operador não conseguia incluir mais de uma parcela na mensagem do template; pediu multi-seleção + incluir todas.",
    },
    title: "Hades: Nova promessa aceita várias parcelas + 'Incluir todas'",
    type: "melhoria",
    version: "1.24.5",
  },
  {
    buildTag: "2026-07-07-iris-header-nome-apolo",
    deployedAt: "2026-07-07T00:45:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Corrigido o nome no topo do atendimento: quando o cliente é comprador reconhecido no Apolo, o título agora mostra o nome COMPLETO do cadastro (ex.: 'Henrique Cirilo Aguiar') em vez do nome do WhatsApp (ex.: só 'Aguiar').",
            ],
            screen: "Atendimento (cabeçalho da conversa)",
          },
        ],
      },
    ],
    rollback: "commit 2f105460",
    technical: {
      done: "O cabeçalho da conversa (IrisPage) usava ticketContactLabel, que depende do crm360Registration (overlay leve do /api/iris/apolo/phone-match). Quando o phone-match não casa, caía pro display_name do WhatsApp. O painel 'Cliente' já usava a fonte rica (apoloContextEntity.displayName, carregada por ticket). Agora o header prefere apoloContextEntity?.displayName e cai pro ticketContactLabel. Header e painel passam a bater. v1.24.3 -> v1.24.4.",
      motivation:
        "Print do Lucas (AT-000040 Aguiar): comprador com nome completo no painel da direita, mas o topo mostrava só 'Aguiar'.",
    },
    title: "Iris: nome completo do comprador no topo do atendimento",
    type: "correcao",
    version: "1.24.4",
  },
  {
    buildTag: "2026-07-06-hades-persistencia",
    deployedAt: "2026-07-07T00:20:00-03:00",
    modules: [
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Agora o Hades também continua de onde você estava: o cliente aberto no cockpit não volta mais pra fila zerada ao trocar de tela e voltar.",
              "No painel geral, o empreendimento em foco e os painéis expandidos/recolhidos também ficam do jeito que você deixou.",
            ],
            screen: "Cobrança (cockpit) e painel geral",
          },
        ],
      },
    ],
    rollback: "commit 4f6d8ad1",
    technical: {
      done: "A persistência de navegação (v1.24.0) cobriu os filtros do desk do Hades, mas faltou o cliente selecionado no cockpit (AttendancePage.selectedId) e TODO o dashboard (app/guardian/page.tsx, que não passou pelo sweep). Agora: selectedId persistido (session), e no dashboard enterprise (session) + expandedPanels (local). selectedKpi fica efêmero de propósito (não reabre o drawer sozinho). v1.24.2 -> v1.24.3.",
      motivation:
        "Lucas: o Hades não estava com a continuação de tela que fizemos antes, toda hora voltava pro estado inicial.",
    },
    title: "Hades: continua de onde você estava (cliente do cockpit + filtro do painel)",
    type: "melhoria",
    version: "1.24.3",
  },
  {
    buildTag: "2026-07-06-competencia-c2x",
    deployedAt: "2026-07-07T00:10:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Corrigida a competência (mês de referência) das parcelas na ficha do cliente: agora vem sempre do C2X, igual ao Hades.",
              "Antes, parcela com vencimento renegociado mostrava a competência pelo mês do vencimento (ex.: uma parcela de 11/2025 aparecia como 07/2026). Agora bate com o C2X.",
            ],
            screen: "Atendimento (carteira / parcelas do cliente)",
          },
        ],
      },
    ],
    rollback: "commit 69768b3d",
    technical: {
      done: "mapC2xPortfolioInstallment (lib/apolo/server.ts) montava reference (competência) a partir do vencimento (dueDateInput). O Iris lê a carteira do Apolo, então divergia do Hades (attendance.ts), que usa a coluna reference_date do C2X. Fix: SELECT de date_format(p.reference_date) e reference passa a usar reference_date (cai pro vencimento só se vazio). v1.24.1 -> v1.24.2.",
      motivation:
        "Print do Lucas (Henrique Cirilo Aguiar): parcelas 21/22 pagas com vencimento renegociado apareciam como 07/2026 no Iris vs 11/2025 e 12/2025 no Hades/C2X. Regra: competência tem que vir do C2X.",
    },
    title: "Iris: competência da parcela vem do C2X (bate com o Hades)",
    type: "correcao",
    version: "1.24.2",
  },
  {
    buildTag: "2026-07-06-iris-crm360-resiliente",
    deployedAt: "2026-07-06T23:55:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Corrigido: em atendimento de cliente comprador, o nome do cadastro (Apolo) e os dados do cliente no lado direito às vezes sumiam no meio da conversa e o nome virava o do WhatsApp.",
              "Agora, uma vez que o cliente é reconhecido no Apolo, o nome e o painel continuam firmes mesmo se uma atualização em segundo plano falhar ou demorar. Não pisca mais.",
            ],
            screen: "Atendimento (ficha do cliente)",
          },
        ],
      },
    ],
    rollback: "commit 27a5c04a",
    technical: {
      done: "O nome/painel exibidos são um overlay do CRM 360 (ticketContactLabel usa crm360Registration). enrichTicketsWithCrm360 re-busca /api/iris/apolo/phone-match a cada refresh (interval 90s + realtime + foco) com timeout de 4s; em timeout/falha fazia `return data` SEM registration → todos os tickets perdiam o cadastro de uma vez (nome caía pro display_name salvo do contato, ex.: handle do WhatsApp, e o painel esvaziava). Fix: cache em memória por telefone do último cadastro REGISTRADO; falha/timeout ou 'missing' transitório mantém o último conhecido. Client-side, reseta no reload. v1.24.0 -> v1.24.1.",
      motivation:
        "Relato de atendente (prints do Lucas): comprador com nome certo no início do atendimento e, após um tempo, nome virava o do WhatsApp e os dados do Apolo sumiam do lado direito.",
    },
    title: "Iris: nome e ficha do comprador não somem mais no meio do atendimento",
    type: "correcao",
    version: "1.24.1",
  },
  {
    buildTag: "2026-07-06-persistencia-navegacao",
    deployedAt: "2026-07-06T23:00:00-03:00",
    modules: [
      {
        module: "Hub (todos os módulos)",
        screens: [
          {
            items: [
              "Agora o Hub lembra onde você estava: ao clicar num card e voltar, ou ao trocar de módulo/tela e retornar, os filtros, a organização, a aba e a seleção continuam do mesmo jeito, não voltam mais ao início.",
              "Exemplos: organizou a Iris por colaborador e abriu um atendimento? Ao voltar, segue por colaborador. Estava num canal do Hermes e foi pra outra tela? O canal continua aberto na volta.",
              "Vale pra Iris, Hermes, Apolo, Chronos, Hades, Zeus, Atlas e Ares. O estado dura enquanto a aba estiver aberta e sobrevive ao Ctrl+F5.",
            ],
            screen: "Navegação (filtros, abas, organização e seleção)",
          },
        ],
      },
    ],
    rollback: "commit 6e10537f (deploy dpl_o65nfGtk232ny6kWjKbrBRxrgMQr)",
    technical: {
      done: "Nova primitiva usePersistedState (apps/hub/hooks/use-persisted-state.ts): drop-in do useState com cache em memória (volta instantânea na navegação client-side, sem flash) + sessionStorage (sobrevive a reload) ou localStorage p/ preferência. Zero rede/polling, seguro em SSR. Causa raiz da regressão: o Next.js desmonta a página ao navegar, então todo useState local voltava ao inicial. Aplicada na navegação/filtros/seleção primários de Iris (board organizar/ordenar/visão/busca + view/ticket/sidebar), Hermes (canal ativo + filtros + sidebar), Apolo, Chronos (tela/drive/reunião/sidebar), Zeus (view+filtros), Atlas (filtros+sidebar), Ares (seção/filtros/visão+sidebar), Hades desk (busca/filtros/seção/fila) e inteligência (trend/KPI), + dashboard público de CADs (por empreendimento). v1.23.7 -> v1.24.0.",
      motivation:
        "Time reclamando muito das regressões de 'a tela volta pro estado inicial' ao navegar e voltar. Pedido do Lucas: tudo tem que continuar de onde estávamos, em todos os módulos.",
    },
    title: "As telas continuam de onde você estava (filtros, abas, organização e seleção)",
    type: "melhoria",
    version: "1.24.0",
  },
  {
    buildTag: "2026-07-06-notificacao-foco-janela",
    deployedAt: "2026-07-06T20:00:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "Corrigido o motivo de 'a mensagem não chega / vai direto pro histórico': se você deixava o Hermes aberto num canal e ia trabalhar em OUTRA janela (ou 2º monitor), as mensagens daquele canal eram marcadas como lidas sozinhas e não avisavam.",
              "Agora só conta como 'você está vendo' quando a janela do Hermes está realmente em foco. Deixou aberto atrás? A mensagem vira notificação normal (bolinha + som + aviso).",
              "⚠️ Dê um Ctrl+F5 para pegar a correção.",
            ],
            screen: "Central de notificações e canais",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Mesma correção aplicada nas notificações do atendimento (evita som duplicado e avisos perdidos quando o hub está aberto atrás de outra janela).",
            ],
            screen: "Central de notificações",
          },
        ],
      },
    ],
    rollback: "commit 9103ef8c (v1.23.6)",
    technical: {
      done: "Causa raiz da intermitência 'não recebo / vai pro histórico' das notificações: handleHermesMessage decidia isViewingChannel por document.visibilityState === 'visible', que é TRUE mesmo com a janela atrás de outro app ou em 2º monitor — marcava lido (markChannelNotificationsRead + markHermesChannelRead no servidor) e a msg caía no log-histórico (read:true) sem gerar a notificação-por-canal pendente. Trocado por document.hasFocus() (windowHasFocus). Som in-app agora exige foco (evita duplicar com o Web Push que dispara justamente sem foco); toast visual segue com visibilidade. Mesmo tratamento no realtime da central hub_notifications (Iris/Hades/Chronos). É a ponta que faltava do mesmo conceito já corrigido no sw.js (RC2). v1.23.6 -> v1.23.7.",
      motivation:
        "Time reclamando muito das notificações (Hermes e Iris). Sintoma do Lucas: Central mandando Hermes direto pro histórico + 'tem hora funciona tem hora não'. Padrão de uso: hub aberto o dia todo enquanto trabalha em outras janelas — exatamente o cenário que o bug atingia.",
    },
    title: "Notificações: fim do 'vai direto pro histórico' quando o hub está aberto atrás de outra janela",
    type: "correcao",
    version: "v1.23.7",
  },
  {
    buildTag: "2026-07-06-retencao-fila-n1-caca-prefill",
    deployedAt: "2026-07-06T18:30:00-03:00",
    modules: [
      {
        module: "Hub",
        screens: [
          {
            items: [
              "Banco de dados em dieta: a fila de cobrança acumulava um retrato completo a cada 15 minutos desde o início (157 mil registros!) — agora guarda só as últimas 24h e limpa o resto sozinha.",
              "Hermes e Home mais rápidos: consultas que iam ao banco dezenas de vezes por carregamento agora vão 2-3 vezes.",
              "Cacá mais estável: corrigido um caso raro em que ela caía no modo simplificado no meio da conversa.",
            ],
            screen: "Infraestrutura e desempenho",
          },
        ],
      },
    ],
    rollback: "commit a6f9c8a9 (v1.23.5)",
    technical: {
      done: "Itens 5-7 do plano do diagnóstico de 6/jul: (1) RETENÇÃO da c2x_guardian_attendance_queue — persistQueueSnapshot apaga gerações is_current=false com synced_at >24h (era insert-only: ~96 snapshots/dia acumulando 157k linhas/394MB; primeiro run pós-deploy limpa o estoque). (2) N+1s: filterAccessibleChannelIds em LOTE no GET multi-canal do Hermes (2-3 consultas no lugar de ~40; mesma semântica incl. fallback de departamento) + loadAvailabilityHistoryEvents da Home em 1 consulta com teto por usuário reaplicado em memória (era 8). (3) Cacá: buildConversation garante fim com turno user (modelos novos rejeitam prefill de assistant — 400 'assistant message prefill' 3× nos logs; reancora no inbound). report-render já estava consertado pela outra frente (zero ocorrências desde 4/jul). chronos_timeline_events (660k) fica pra decisão de produto (retention de histórico). v1.23.5 -> v1.23.6.",
      motivation:
        "Fila do diagnóstico custo+performance de 6/jul: tabela gigante bloqueava o degrau Small do compute (~-US$45/mês); N+1s inflavam latência e invocações; prefill derrubava a Cacá pro fallback determinístico.",
    },
    title: "Banco em dieta: retenção da fila de cobrança + consultas em lote + Cacá estável",
    type: "melhoria",
    version: "v1.23.6",
  },
  {
    buildTag: "2026-07-06-custo-banco-numeros-cobranca-estabilidade",
    deployedAt: "2026-07-06T15:00:00-03:00",
    modules: [
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Envio da cobrança não erra mais o número do cliente: celulares no formato antigo ganham o 9º dígito automaticamente e clientes no exterior são enviados com o código do país certo (antes viravam um DDD inexistente e falhavam).",
              "Casos reais corrigidos: AT-000214, AT-000229 e AT-000247 (seção de envios com erro).",
            ],
            screen: "Fila de cobrança — disparo de template",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "As informações do CRM (perfil e situação do cliente) voltaram a carregar na fila — a consulta falhava silenciosamente quando o volume de atendimentos cresceu.",
            ],
            screen: "Fila — enriquecimento do CRM 360",
          },
        ],
      },
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Gravações das reuniões voltaram a ser arquivadas no Drive (o formato do arquivo era recusado no upload) e o processamento não morre mais por falta de memória em gravações grandes.",
            ],
            screen: "Drive — gravações",
          },
        ],
      },
      {
        module: "Hub",
        screens: [
          {
            items: [
              "Otimização interna: fim de milhões de gravações desnecessárias no banco (conversas diretas do Hermes e presença) — economia de infraestrutura e mais folga de desempenho.",
            ],
            screen: "Infraestrutura",
          },
        ],
      },
    ],
    rollback: "anotar deployment anterior no go-live",
    technical: {
      done: "Pacote de estabilidade+custo (diagnóstico 6/jul): (1) phone-match consultava apolo_entity_identifiers com IN de centenas de hashes numa URL -> PostgREST 400 -> rota 500 SILENCIOSA (Iris sem CRM na fila); agora em lotes de 50 + log do erro real. (2) Upload de gravação Whereby->storage com contentType video/mp4 explícito (bucket recusava application/octet-stream; 33 falhas desde 2/jul) + upload em STREAMING (response.body direto, sem arrayBuffer) nas rotas webhook/egress — 208 OOM kills desde 22/jun em chronos/meetings, whereby/webhook, egress-cron, apolo/sync. (3) Números da cobrança: resolveC2xWhatsAppNumberFromApolo resolve direto o formato Hades c2x-client-NNNN + 9º dígito automático (fixLegacyBrazilianMobileNumber) + 9 testes vitest. (4) Custo banco: fast-path sem escrita no ensureDirectChannelAccess (~2,7M upserts/poll) + heartbeat presença 30s->90s (~1,57M updates). v1.23.4 -> v1.23.5.",
      motivation:
        "Diagnóstico completo custo+performance de 6/jul: erro ativo na Iris (500 contínuo), perda de gravações do Chronos, 208 OOM kills e fixes de custo parados na branch desde 3/jul.",
    },
    title: "Estabilidade: CRM na fila da Iris, gravações do Chronos, números da cobrança e banco mais leve",
    type: "correcao",
    version: "v1.23.5",
  },
  {
    buildTag: "2026-07-04-caca-voz",
    deployedAt: "2026-07-04T00:20:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A CACÁ agora responde em ÁUDIO quando o cliente manda um áudio (e continua no texto quando o cliente escreve). A voz é natural, com sotaque carioca, pra o atendimento ficar mais humano e acolhedor.",
              "Quando a resposta tiver um link de boleto, ela vai por texto (link precisa ser clicável). Se por algum motivo a voz falhar, a CACÁ responde por escrito na hora, então o cliente nunca fica sem resposta.",
            ],
            screen: "Atendimento — CACÁ",
          },
        ],
      },
    ],
    rollback: "commit 5b4fc79",
    technical: {
      done: "Ativada a resposta em voz da CACÁ (fase 2) via env CACA_VOICE_ENABLED=1 (Production). Espelhar: inbound audio -> resposta em voz (ElevenLabs TTS, voz GDzHdQOi6jjf8zaXhCYD/eleven_v3, stability 0.22/style 0.6) enviada por sendMetaWhatsAppAudioMessage (mp3); inbound texto -> texto. Só com o engine Claude. Modo-voz no prompt (persona voiceMode): estilo falado + pontuação reforçada, sem asterisco/emoji/link/número abreviado. Guarda de link (URL -> texto) e fallback pra texto se o TTS falhar. Vale todas as filas. Master switch permite desligar sem deploy (remover a env).",
      motivation:
        "Lucas: dar voz à CACÁ pra o atendimento soar mais humano; escolheu a voz carioca no comparador e autorizou o go-live em produção.",
    },
    title: "CACÁ responde em áudio (voz no atendimento)",
    type: "novidade",
    version: "v1.23.4",
  },
  {
    buildTag: "2026-07-03-iris-bandeira-svg",
    deployedAt: "2026-07-03T17:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A bandeira do país ao lado do telefone agora é uma imagem de verdade — aparece igual no Windows, no navegador e no celular. Antes o Windows mostrava só as duas letras do país (ex.: 'BR') num quadradinho, porque o emoji de bandeira não é desenhado no Windows.",
            ],
            screen: "Atendimento — painel do cliente",
          },
        ],
      },
    ],
    rollback: "commit 75f75e75",
    technical: {
      done: "A bandeira estava como emoji (regional indicator), que o Windows NÃO renderiza como bandeira (vira 'BR'/'US' em quadradinho — glifo ausente na Segoe UI Emoji). Trocado por SVG real: dep country-flag-icons (React SVG, self-hosted, sem CDN) + componente <PhoneFlag> (modules/caredesk/components/phone-flag.tsx) que deriva o ISO2 do E.164 via novo iso2ForE164 (lib/iris/phone-country.ts) e renderiza o SVG (globo lucide no país desconhecido). Aplicado nos campos Telefone do IrisCobrancaContextSidebar (IrisPage.tsx, modo cobrança e Apolo) e do iris-conversation-readonly (histórico); tipo dos campos passou de string p/ ReactNode. flagEmojiForE164 mantido (refatorado sobre iso2ForE164) p/ contextos de texto puro.",
      motivation:
        "Lucas no Windows via 'BR'/'US' em quadradinho em vez da bandeira. Limitação do SO (emoji de bandeira não desenha no Windows) — resolvido renderizando SVG.",
    },
    title: "Iris: bandeira do país como imagem (aparece no Windows)",
    type: "correcao",
    version: "v1.23.3",
  },
  {
    buildTag: "2026-07-03-iris-bandeira-painel",
    deployedAt: "2026-07-03T14:00:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A BANDEIRA do país agora aparece ao lado do telefone no painel de cadastro do atendimento (antes só aparecia na visão de histórico). Dá pra identificar num relance quando o número é de fora.",
            ],
            screen: "Atendimento — painel do cliente",
          },
        ],
      },
    ],
    rollback: "commit d13f2085",
    technical: {
      done: "A bandeira do país (v1.23.1) tinha sido adicionada só em iris-conversation-readonly.tsx (visão read-only/histórico), mas o painel de contexto do atendimento ao vivo é o IrisCobrancaContextSidebar renderizado em IrisPage.tsx (campos Telefone nas linhas ~3817 modo cobrança e ~3875 modo Apolo). Adicionado flagEmojiForE164(ticket.contactPhone) nos dois campos Telefone + import em IrisPage.tsx. Robustez no helper flagEmojiForE164: número sem código de país reconhecido e com 10-11 dígitos agora assume BR (sistema BR-first) em vez de casar prefixo errado (ex.: nacional '31983440284' virava 🇳🇱).",
      motivation:
        "Lucas não via a bandeira: ela tinha ido pro componente errado (histórico) e não pro painel que o operador usa no atendimento.",
    },
    title: "Iris: bandeira do país no painel do atendimento",
    type: "correcao",
    version: "v1.23.2",
  },
  {
    buildTag: "2026-07-03-iris-telefone-estrangeiro",
    deployedAt: "2026-07-03T13:00:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Números de telefone ESTRANGEIROS (EUA/Canadá, Portugal, etc.) agora são enviados corretamente no disparo ativo. Antes o sistema forçava tudo para o formato brasileiro (ex.: um número dos EUA virava um +55 inexistente e a mensagem não chegava).",
              "No cadastro/atendimento, o telefone agora mostra a BANDEIRA do país ao lado — dá pra ver num relance quando o número é de fora (e até flagrar cadastro errado).",
            ],
            screen: "Atendimento — telefone e disparo",
          },
        ],
      },
    ],
    rollback: "commit 245e5527",
    technical: {
      done: "Números estrangeiros deixavam de entregar porque o código ignorava o `phone_code` (país) do C2X e montava tudo como BR (ex.: +1 (617) 755-0385 -> +55 (61) 7755-0385). Novo util puro lib/iris/phone-country.ts: buildC2xWhatsAppNumber(phone_code, phone) monta E.164 respeitando o país — BR/vazio = lógica BR (55+9º dígito); estrangeiro = país+nacional sem 9º dígito; celular BR válido (DD+9+8) sempre tratado como BR (cobre phone_code errado no cadastro). VALIDADO contra a base (2.366 BR intactos, 283 estrangeiros corrigidos). Aplicação: lib/guardian/attendance.ts loadC2xUserWhatsAppNumber (lê phone_code do primário) + app/api/iris/tickets/route.ts re-deriva o número certo pela entidade Apolo (apolo_source_links -> c2x user) antes de disparar (fallback pro número que veio se não resolver). Bandeira: flagEmojiForE164 (dial code -> ISO2 -> emoji) no painel de contexto (iris-conversation-readonly). Distribuição: +1=248, +44=15, +351=11, etc. (~283 total).",
      motivation:
        "Lucas: disparo ativo falhando 'undeliverable' pra clientes com telefone de fora (caso Elizete, +1 do Canadá). Regra: usar o telefone do cadastro, todos como WhatsApp, e identificar o estrangeiro pelo phone_code.",
    },
    title: "Iris: telefone estrangeiro no disparo + bandeira do país",
    type: "correcao",
    version: "v1.23.1",
  },
  {
    buildTag: "2026-07-03-apresentacao-lancamento",
    deployedAt: "2026-07-03T12:00:00-03:00",
    modules: [
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "Nova página pública c2x.app.br/apresentacao com a apresentação interativa do processo de lançamento (Pré, Lançamento e Pós) para loteadores: capa com as marcas, linha do tempo das fases, fluxograma do circuito do dia do evento e projeção em tela cheia.",
            ],
            screen: "c2x.app.br/apresentacao",
          },
        ],
      },
    ],
    rollback: "commit 280b3e13",
    technical: {
      done: "Rewrites no next.config.ts do hub: /apresentacao e /apresentacao/:path* proxiam o site estatico careli-processo-lancamento.vercel.app (projeto Vercel separado da mesma conta; republicar a apresentacao NAO exige deploy do hub). Nenhuma mudanca no gate do proxy.ts: ele so cobre /api/*, e a rota nova e pagina publica sem dado do hub. O HTML da apresentacao e autossuficiente (logos embutidas em base64), entao caminho relativo nao quebra atras do rewrite.",
      motivation:
        "Lucas apresenta o processo de lancamento a loteadores contratantes e quer a URL na marca da empresa (c2x.app.br/apresentacao) em vez do dominio vercel.app.",
    },
    title: "Apresentação do processo de lançamento em c2x.app.br/apresentacao",
    type: "novidade",
    version: "v1.23.0",
  },
  {
    buildTag: "2026-07-03-iris-9digito",
    deployedAt: "2026-07-03T09:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Quando o WhatsApp não entrega uma mensagem de disparo ativo (o famoso \"não entregue\" por causa do 9º dígito do celular), a Iris agora reenvia sozinha na outra variante do número — reduz mensagens que sumiam silenciosamente na cobrança/retorno.",
            ],
            screen: "Atendimento — entrega",
          },
        ],
      },
    ],
    rollback: "commit a2668043",
    technical: {
      done: "Auto-retry do 9o digito no webhook de status do Meta (processStatusUpdate em meta-inbound-processor.ts): ao receber status 'failed' com 'Message undeliverable' generico (code null) num numero BR, reenvia UMA vez (anti-loop via flag nineDigitRetry) na variante oposta do 9o digito — SO se essa variante nao for a que o Meta ja tentou (wa_id que falhou), evitando reenvio inutil + custo de template. Reaponta a mensagem (delivery_status->sent, novo external_message_id) e cria ref pro novo wa_message_id. Vale template (reusa name/language/bodyParameters/phoneNumberId) e texto. Best-effort (nunca quebra o webhook). Diagnostico: em 48h ~280 envios / ~4 falhas (1,4%), todas 'undeliverable' de destinatario — nao era pane.",
      motivation:
        "Lucas reportou 'erro de envio'; a analise mostrou envio saudavel (98 entregues/89 lidas/24h) e falhas pontuais de destinatario por normalizacao do 9o digito (ex.: 5531983440284 -> wa_id 553183440284). Auto-retry reduz esses sumicos no disparo ativo.",
    },
    title: "Iris: reenvio automático na falha de entrega do 9º dígito",
    type: "correcao",
    version: "v1.22.1",
  },
  {
    buildTag: "2026-07-02-hermes-notificacoes-l1-l4",
    deployedAt: "2026-07-02T23:15:00-03:00",
    modules: [
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "A notificação do Windows agora chega SEMPRE — mesmo com o Panteon minimizado ou atrás de outra janela (era a causa do 'tem hora que chega, tem hora que não').",
              "Clicar na notificação abre a conversa NA HORA, sem recarregar o sistema (adeus espera de ~8 segundos) — e funciona até com o Hermes já aberto em outro canal.",
              "@Menção ficou de primeira classe: notificação própria ('fulano mencionou você') e badge âmbar com @ no canal e na aba Hermes do topo.",
              "Resposta na SUA thread avisa direto: 'fulano respondeu você' — e com a thread aberta a resposta aparece instantaneamente.",
              "⚠️ Na primeira vez, dê um Ctrl+F5 para atualizar o mecanismo de notificação.",
            ],
            screen: "Notificações (Windows, canais, aba e central)",
          },
        ],
      },
    ],
    rollback: "deployment kqagkuvy6 (dpl_2aCFaU9PCMs1YMcS87SNe65ubRdY)",
    technical: {
      done: "Reforma das notificações em 4 lotes. L1: sw.js só suprime push com janela FOCADA (visibilityState visible descartava push com o hub atrás de outro app); clique navega via postMessage->router.push (SPA) no lugar de client.navigate (full reload ~8s); rota nova POST /api/hermes/messages/push (Bearer, autor-only, lê a msg do banco) chamada fire-and-forget pelo fallback de INSERT direto do createHermesMessage — antes esse caminho não disparava push nenhum; payload distinto p/ @menção (título+tag) e thread (título + &thread= no deep-link). L2: evento panteon:deeplink (provider->workspace) aplica canal/thread com o Hermes já montado (?channel= só era lido na montagem); resposta em thread aberta carrega na hora via bridge (poll de 8s vira rede de segurança). L3: unreadMentionCount por canal (types/workspace-messages/provider, zera com o lido) + badge âmbar @N na lista (expandida/colapsada) e na aba do topo (hermesMentionUnreadCount no contexto); push 'respondeu você' direcionado ao autor da mensagem-pai. L4: telemetria [hermes:push] (1 linha JSON por mensagem nos logs Vercel: members/subscriptions/sent/failed/expired/mentioned/thread). v1.21.2 -> v1.22.0.",
      motivation:
        "Prioridade máxima do Lucas: notificações do Hermes instáveis há 1+ mês, time reclamando (push engolido, delay de 8s no clique, menção sem destaque). Diagnóstico completo com 3 causas raízes na memória project-hermes-notifications-diagnosis.",
    },
    title: "Hermes: notificações confiáveis — Windows, @menção, threads e clique instantâneo",
    type: "melhoria",
    version: "v1.22.0",
  },
  {
    buildTag: "2026-07-02-iris-anexos",
    deployedAt: "2026-07-02T19:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Agora dá pra ENVIAR arquivos, fotos e prints no atendimento pelo WhatsApp: clique no clipe (📎) para escolher uma imagem ou documento (PDF, Word, Excel, etc.), ou simplesmente COLE um print com Ctrl+V direto no campo de mensagem.",
              "Antes de enviar, você vê uma prévia do anexo e pode escrever uma legenda junto. Fotos grandes são reduzidas automaticamente para enviar rápido.",
              "Quando a mensagem é só emoji (sem texto), ela aparece GRANDE na conversa — igual ao WhatsApp (quanto menos emojis, maior fica).",
              "O seletor de emoji (😊) ganhou MUITAS opções novas — rostos, gestos, corações e símbolos úteis, com rolagem.",
            ],
            screen: "Atendimento — anexos e emoji",
          },
        ],
      },
    ],
    rollback: "commit c389bba1",
    technical: {
      done: "Envio de mídia de saída na Iris (imagem/documento) espelhando o pipeline do áudio: sendMetaWhatsAppMediaMessage (upload /media -> media_id -> messages com caption/filename) em meta-whatsapp.ts; rota /api/iris/meta/messages ganhou normalizeAttachmentMedia (whitelist jpg/png + PDF/Office/txt, limite ~3MB base64 pelo teto de body da Vercel) e createQueuedTicketMessage generico (provider_payload.media.{url,type,fileName} ja renderizado por MessageContent). No compositor: paperclip real (input file) + colar imagem (onPaste) + preview do anexo com legenda; imagem grande e reduzida no cliente via canvas (max 1600px, JPEG 0.85). Emoji: MessageContent renderiza mensagem so-emoji grande (tamanho por quantidade); IRIS_EMOJI_OPTIONS 12 -> ~59 com seletor rolavel. Versao mantida em v1.21.2 por decisao do Lucas (nao bumpar). v1.21.1 -> v1.21.2.",
      motivation:
        "Pedido do time: enviar arquivos/fotos/prints no atendimento (o clipe estava 'em breve') + emoji sozinho aparecer grande e mais opcoes na paleta.",
    },
    title: "Iris: enviar arquivos, fotos e prints + emoji no atendimento",
    type: "melhoria",
    version: "v1.21.2",
  },
  {
    buildTag: "2026-07-02-caca-imobiliaria",
    deployedAt: "2026-07-02T16:15:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Cacá agora atende as IMOBILIÁRIAS sobre os clientes DELAS: dá pra pedir um panorama da carteira (quantos clientes em dia, quantos com parcela vencida e o total vencido), consultar um cliente específico (cadastro + situação financeira) e receber o boleto de um cliente — tudo restrito aos clientes vinculados àquela imobiliária.",
              "A Cacá ficou mais natural na conversa: se o cliente puxar um assunto fora do trabalho, ela responde numa boa, sem ficar forçando o papo de volta pra boleto a cada frase.",
            ],
            screen: "Atendimento (Cacá)",
          },
        ],
      },
    ],
    rollback: "commit b75c30da",
    technical: {
      done: "Cacá (engine Claude) ganhou 3 ferramentas escopadas pela imobiliaria: resumo_carteira_imobiliaria, consultar_cliente_da_imobiliaria e gerar_boleto_cliente_imobiliaria. Autorizacao SEMPRE por vinculo users.vinculed_by_id (a imobiliaria so alcanca clientes vinculados a ela; nunca CPF solto). Escopo abre por telefone que bate com o cadastro da imobiliaria OU CNPJ confirmado. Read-model C2X novo (read-only): findC2xImobiliariaClients (resolve por nome/CPF dentro do vinculo) + loadC2xImobiliariaCarteiraSummary (agregado por cliente, vencida = payment_status_id 7). Persona: secao de atendimento de imobiliaria + liberacao de conversa fora do contexto de trabalho. v1.21.0 -> v1.21.1.",
      motivation:
        "Lucas: a imobiliaria pode ver cadastro/financeiro/boleto dos clientes DELA (sao clientes dela) — caso real da Raiane Imobiliaria pedindo a saude financeira dos boletos dos clientes, que a Cacá recusava e transferia. E: nao quero a Cacá presa em boleto/financeiro; se o cliente falar de assunto fora do trabalho, pode responder naturalmente.",
    },
    title: "Cacá atende imobiliárias sobre os clientes delas + conversa mais natural",
    type: "melhoria",
    version: "v1.21.1",
  },
  {
    buildTag: "2026-07-02-app-mobile",
    deployedAt: "2026-07-02T14:30:00-03:00",
    modules: [
      {
        module: "Panteon Mobile",
        screens: [
          {
            items: [
              'Agora o Panteon tem APP no celular! Para instalar é só ACESSAR c2x.app.br/m pelo navegador do celular e tocar em "Adicionar à tela de início" — ele abre como app, em tela cheia. (Android: menu ⋮ → Instalar app / Adicionar à tela inicial. iPhone: Compartilhar → Adicionar à Tela de Início.)',
              "No app você usa a Iris (fila de atendimento agrupada por seção, ficha do cliente e cronômetro de \"sem resposta\") e o Hermes (canais e conversas estilo WhatsApp: responder em thread, reações, tags e @menção). As notificações ficam no sino no topo.",
              "É a mesma conta e os mesmos dados de sempre — só que na palma da mão.",
            ],
            screen: "App no celular — c2x.app.br/m",
          },
        ],
      },
    ],
    rollback: "commit 02fa4994",
    technical: {
      done: "App mobile do Panteon publicado em /m (PWA standalone; manifest-mobile com id/scope/start_url /m). Rotas ADITIVAS em app/m/* + modules/mobile/*, reaproveitando providers/dados de producao (usePanteonNotifications, loadIrisData + loadTicketMessages, listChannelMessages/createHermesMessage/threads, cockpit via /api/apolo/relationships buscando por DOCUMENTO). Casca: barra topo (avatar+abas Hermes/Iris+sino); fila Iris por secao (perfil colorido + cronometro sem-resposta) + cockpit Apolo em popup; Hermes chat (separador de data, avatar, historico paginado, threads/reacoes/tags/@mencao, anexos visiveis, abre no fim, bolinha verde de novas); login mobile dedicado; central sem-dobrar (esconde diario por-mensagem, mantem 1 por canal). globals.css neutraliza o min-width:1024 do desktop via :has(.panteon-mobile-root). Fez merge limpo com a linha de producao (Chronos/agentes da outra sessao). v1.20.2 -> v1.21.0.",
      motivation:
        "Lucas: 'como eu faco para levar o Panteon para meu celular que de para usar bem? hoje fica tudo quebrado, nao tem uma UI legal'. O desktop nao encaixa no celular — a solucao foi um app mobile-first estilo WhatsApp sob /m, instalavel como PWA, aprovado tela a tela via mockup.",
    },
    title: "Chegou o Panteon no celular — app mobile em c2x.app.br/m",
    type: "novidade",
    version: "v1.21.0",
  },
  {
    buildTag: "2026-07-01-revisao-agentes-ata-cadastro",
    deployedAt: "2026-07-01T17:30:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              'O "erro ao gerar a ata" foi corrigido na raiz: a Athena agora entrega a ata (e a pauta) num formato estruturado garantido — sem depender de sorte na formatação da resposta da IA.',
            ],
            screen: "Ata e pauta",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Cacá agora consegue consultar o CADASTRO de qualquer perfil validado — colaborador, imobiliária e prospect incluídos (antes só comprador com carteira tinha ficha). A identidade continua travada por CPF/CNPJ + nome.",
              "Quando um atendimento exige muitas consultas seguidas, a Cacá fecha a resposta com o que já apurou em vez de responder uma frase genérica.",
            ],
            screen: "Atendimento (Cacá)",
          },
        ],
      },
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "A análise de evidências dos chamados de TI também passou pro formato estruturado garantido — menos casos caindo na análise local básica.",
            ],
            screen: "HelpDesk",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-ihdftbgd0",
    technical: {
      done: "Revisao completa dos agentes de IA. (1) CAUSA RAIZ do erro da ata: pedir JSON a mao com Markdown grande embutido quebrava no JSON.parse (newline/aspas sem escape). Novo helper completeWithClaudeStructured (lib/ai/claude.ts) = saida estruturada via tool-use FORCADO (tool_choice) — a API serializa o JSON. Aplicado na ata + pauta do Chronos (chronos/meetings/agent) e na analise de evidencias (it-tickets/evidence-analysis, tool inline por causa dos image blocks). (2) runClaudeAgent (lib/ai/claude-agent.ts): ao estourar maxToolIterations fazia text vazio -> fallback generico; agora faz UMA chamada final com tool_choice none pro modelo fechar com o que apurou. (3) CACA cadastro p/ todo perfil: loadC2xUserCadastro (lib/guardian/attendance.ts) le o cadastro DIRETO do users do C2X por id (mesmos joins da fila, SEM exigir payments/acquisition_requests; read-only; carteira zerada); consultarCadastro (caca/executors.ts) cai nesse leitor quando o loader de carteira nao acha. VALIDADO contra o C2X real (users.id=123 via CPF) e contra o Apolo (source c2x/users#123). Agentes texto-puro (ai/chat, squadops/copilot, iris/attendant) e template-author (ja usava tool_choice) revisados sem problema. v1.20.1 -> v1.20.2.",
      motivation:
        "Lucas: 'revisa todos os agentes, caca, athena, principalmente na geracao da ata, revisa com cuidado para gente fechar isso de uma vez'. A ata falhava intermitente desde a migracao pro Claude (perdeu o json_schema da OpenAI); o colaborador nao conseguia consultar o proprio cadastro.",
    },
    title: "Agentes de IA revisados: ata do Chronos estável + Cacá lê cadastro de qualquer perfil",
    type: "correcao",
    version: "v1.20.2",
  },
  {
    buildTag: "2026-07-01-iris-mensagens-e-perfil-caca",
    deployedAt: "2026-07-01T16:10:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              'As conversas voltaram a aparecer no atendimento: tickets recentes mostravam "Sem mensagens registradas" mesmo com conversa. O sistema carregava as mensagens mais antigas e cortava as novas depois que a central passou de mil mensagens — corrigido.',
              "A Cacá agora entende o PERFIL de quem fala: se é colaborador, parceiro ou prospect (sem carteira de financiamento), ela não trata a ausência de parcelas/cadastro como erro do sistema — contextualiza pelo perfil da pessoa.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-ctf8d2sup",
    technical: {
      done: "Bug de exibicao no cockpit: modules/caredesk/data/iris-data-client.ts carregava caredesk_messages com .order(created_at asc) SEM .limit explicito; o teto de 1000 linhas do PostgREST devolvia as 1000 MAIS ANTIGAS quando o workspace passou de 1000 msgs (total=1029, 1023 antes do ticket ativo), deixando tickets recentes 'sem mensagens'. Fix imediato: buscar as 1000 MAIS NOVAS (desc) + .limit(1000) e reordenar ascendente por ticket em groupMessagesByTicket (preserva ultima-msg, nao-lidas e a thread). CONSERTO DEFINITIVO: a conversa ABERTA carrega o historico COMPLETO do ticket sob demanda (loadTicketMessages por ticket_id, sem o teto por-workspace) e o IrisPage mescla por id com as mensagens ao vivo do snapshot (activeThread + selectedTicketForView) — assim nenhum ticket, novo ou antigo, trunca, qualquer que seja o volume. Consciencia de perfil da Cacá (motor Claude): CacaToolContext.customerProfileLabel + describeApoloProfile(profiles), setado na verificacao por telefone (agent.ts) e por CPF (validar_identidade); persona.ts ganhou a secao 'Entenda o PERFIL'; consultar_cadastro (dados360 nulo) e consultar_financeiro (tudo vazio) passam a explicar que e ESPERADO p/ nao-comprador, nao erro/instabilidade. v1.20.0 -> v1.20.1.",
      motivation:
        "Lucas, em teste real, viu a conversa da Cacá sumida do cockpit da Iris (mensagens no banco, nao exibidas) e a Cacá dizendo 'instabilidade' quando, por ele ser colaborador (sem carteira), simplesmente nao ha financeiro. Ela precisa entender o perfil de quem atende.",
    },
    title: "Iris: conversas reaparecem no atendimento + Cacá entende o perfil do contato",
    type: "correcao",
    version: "v1.20.1",
  },
  {
    buildTag: "2026-07-01-aviso-nova-versao",
    deployedAt: "2026-07-01T15:40:00-03:00",
    modules: [
      {
        module: "Hub",
        screens: [
          {
            items: [
              'Quando sai uma atualização do Panteon, aparece no topo (ao lado do sino) o aviso "Nova versão" — é só clicar pra recarregar e já ficar na versão nova, sem precisar lembrar do Ctrl+F5.',
            ],
            screen: "Barra do topo",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-ctf8d2sup",
    technical: {
      done: "Endpoint publico GET /api/version (force-dynamic, no-store) devolve PANTEON_VERSION do build no servidor; liberado no proxy.ts (allowlist PUBLIC_API_PREFIXES, so string de versao). Componente cliente PanteonUpdatePill (components/panteon/panteon-update-pill.tsx) polla /api/version a cada 5min + no focus (ignora aba oculta), compara com a PANTEON_VERSION cozida no bundle e, se diferir, mostra uma pilula dourada ao lado do sino que faz window.location.reload(). Montado no PanteonTopbarUser antes do sino. So aparece quando ha diferenca real de versao; o efeito comeca a valer do PROXIMO deploy depois deste. v1.19.0 -> v1.20.0.",
      motivation:
        "Lucas: build novo nao refletia sozinho — o painel de Novidades e o selo de versao do avatar so trocam depois do Ctrl+F5 (o bundle/PWA ficam cacheados na aba). O aviso in-app resolve: o usuario ve que saiu versao nova e recarrega quando quiser.",
    },
    title: "Aviso de nova versão no topo (um clique pra atualizar)",
    type: "melhoria",
    version: "v1.20.0",
  },
  {
    buildTag: "2026-07-01-agentes-para-claude",
    deployedAt: "2026-07-01T11:30:00-03:00",
    modules: [
      {
        module: "Hub",
        screens: [
          {
            items: [
              "Os assistentes de IA do hub (Athena de operação, copiloto do Zeus, ata e pauta do Chronos, análise de evidências e o atendimento) agora rodam no Claude (Opus), com respostas mais precisas. A transcrição de áudio segue na OpenAI.",
              "A CACÁ e a Athena agora leem anexos de planilha (xlsx), Word (docx), csv e texto — além de imagem e PDF que já liam.",
              "A Athena do atendimento virou um agente que busca sozinha os dados do cliente no hub (perfil, carteira, histórico de tickets) — respostas mais completas e conscientes do perfil (comprador, imobiliária, colaborador, prospect).",
            ],
            screen: "Agentes de IA",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-dliu9omzo",
    technical: {
      done: "Migração OpenAI (gpt-5.5) → Claude de 6 agentes de texto. Novo helper lib/ai/claude.ts completeWithClaude (system+historico->texto, normaliza alternancia e 1o-user). Migrados: /api/ai/chat (Athena hub-wide, Sonnet default), /api/squadops/copilot (Opus), /api/iris/athena (Opus + PDF do contrato como document block), /api/iris/attendant (Caca, Sonnet), /api/chronos/meetings/agent (ata+agenda Opus via completeWithClaude + parseChronos*Json existente; transcricao continua OpenAI), /api/hub/it-tickets/evidence-analysis (Opus, imagens como image block base64; transcricao continua OpenAI). Prompts revisados/melhorados por agente. source label -> claude; HubItTicketEvidenceAnalysis.source ganhou 'claude'. Audio (whisper-1/gpt-4o-transcribe*) permanece OpenAI. CACA-Claude (caca/agent.ts) ja existia atras de CACA_ENGINE=claude — flip da flag e env, a parte. v1.18.1 -> v1.19.0.",
      motivation:
        "Politica do Lucas: todo agente do hub em Claude (Opus prioridade), OpenAI so de fallback pro que o Claude nao faz (audio). Migracao + melhoria de prompt/tom de uma vez.",
    },
    title: "Agentes de IA do hub migrados para Claude (Opus)",
    type: "melhoria",
    version: "v1.19.0",
  },
  {
    buildTag: "2026-07-01-apolo-chrome-fix-iris-unread-badge",
    deployedAt: "2026-07-01T10:45:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A barra do topo (abas do Panteon) voltou a aparecer no Apolo.",
            ],
            screen: "CRM 360",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Os cards do Board agora mostram um selo verde com a quantidade de mensagens não lidas.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-9a39b554o",
    technical: {
      done: 'Apolo: apolo/page.tsx passou a usar <HubShell chrome="operational" layoutMode="module"> (era só layoutMode). Sem chrome operacional o shell não renderiza o PanteonModuleTabsBar nem dá altura fixa à ContentArea (isOperationalChrome), então o container h-[calc(100dvh-3.25rem)] do ApoloPage ficava sem encaixe e cobria o topo (pior no PWA, onde 100dvh conta a janela toda); agora consistente com Iris/Hades/Chronos/Atlas. Iris: badge de não lidas no BoardCard (iris-board-kanban) — selo verde (bg-emerald-500, igual à fila de atendimento) com ticket.unreadCount (>9 vira "9+"), só quando >0; unreadCount já vinha de computeUnreadCount e é preservado no update otimista. v1.18.0 -> v1.18.1.',
      motivation:
        "Correção da regressão do topo do Apolo (barra fixa) + pedido do Lucas: marcador de mensagens não lidas nos cards do Board da Iris.",
    },
    title: "Apolo: topo de volta + Iris: contador de não lidas no Board",
    type: "correcao",
    version: "v1.18.1",
  },
  {
    buildTag: "2026-07-01-iris-athena-templates-cobranca-vars",
    deployedAt: "2026-07-01T04:00:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Nos cards da fila e do board, agora aparece o protocolo (AT-xxxx) acima do nome do contato.",
              "Criar template ficou mais simples: você escolhe a FILA (não mais o assunto) — o número de envio é preenchido automaticamente pela fila. O assunto passa a ser escolhido só na hora de enviar.",
              "Ao abrir um atendimento, os templates aparecem filtrados pela fila escolhida — só os daquela fila.",
              "Nova Athena no Setup → Templates: descreva o template em português e ela monta pronto — categoria certa, corpo, variáveis, botões e sugestão de anexo — e já preenche o formulário pra você.",
              "Na cobrança, os templates agora preenchem sozinhos empreendimento, valor total, vencimento, unidade, saldo em aberto, dias de atraso e link do boleto das parcelas vencidas.",
            ],
            screen: "Atendimento / Configurações · Templates",
          },
        ],
      },
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A barra de indicadores do topo (Relacionamentos, Compradores, Unidades, Qualidade) agora fica fixa ao rolar a lista.",
            ],
            screen: "CRM 360",
          },
        ],
      },
      {
        module: "Hub",
        screens: [
          {
            items: [
              "As telas de Setup (configuração) agora só aparecem para perfil admin.",
            ],
            screen: "Setup",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-8r1qrk03h",
    technical: {
      done: "Iris: (1) protocolo nos cards (iris-board-kanban + iris-ticket-queue: ticket.protocol acima do nome). (2) Template redesign — criar template sem Assunto (send-time) e com seletor de FILA (iris-setup-view @ts-nocheck): fila seta queueLabel + phoneNumberId (fila.channelId→data.channels[].phoneNumberId); guard 'Fila obrigatoria'; +channels no Pick do prop data. Modal iris-start-attendance-modal ganhou seletor de Fila e filtra templates por FILA (readTemplateMetadataString(t,'queueLabel')===selectedQueue.name); expus phoneNumberId no IrisChannel+iris-data-client. Removidos guards templateSubjectMissing (sync+create) + aviso/disabled. (3) Setup só admin — hub-shell visibleHubModules+canOpenShellModule (id==='setup'→role admin); módulo já tinha page-gate getSetupAccess; aba Setup da Iris (IrisPage @ts-nocheck: filtro navigationItems + render guard canManageHubSetup). Apolo: barra fixa sem perder sidebar — h-[calc(100dvh-3.25rem)] no container do ApoloPage (chrome padrão mantém o rail; layout interno já fixo), scoped (não mexe hermes/setup). HOTFIX: o seletor de Fila do IrisTemplateSetupPanel usava data.queues/data.channels (ReferenceError 'data is not defined' → tela branca no /iris; @ts-nocheck não pega): trocado por props queues/channels (channels adicionado às props do painel + IrisChannel importado). +Wiring empreendimento/valor: iris-start-attendance-modal soma o valor das parcelas vencidas selecionadas (parseBrlNumber) e junta empreendimento(s), envia em metadata.relatedInstallmentsTotal/relatedEnterprise; tickets/route lê e preenche valuesByKey.empreendimento/valor (antes fixos em '-'). +Variáveis de cobrança completas: modal captura dueDate+paymentUrl nas overdue rows, computa unidade (unitCodes únicos), vencimento+dias_atraso (parcela vencida mais antiga via parseBrDateMs), saldo_aberto (financial.overdueAmount|soma) e link_boleto (1a paymentUrl); envia em metadata; route preenche valuesByKey.unidade/vencimento/dias_atraso/saldo_aberto/link+link_boleto. Catálogo IRIS_META_TEMPLATE_VARIABLES: placeholders únicos (fim do {{4}}×3), readiness 'Cobrança', +saldo_aberto/dias_atraso, link→link_boleto. AGENTE ATHENA (autoria de templates, copiloto interno): lib/iris/athena/template-author.ts (Claude Opus via getAnthropicClient, tool emitir_template com schema estruturado, system prompt=catálogo+regras Meta+domínio Careli) + rota /api/iris/athena/templates (auth admin) + painel no iris-setup-view (descreve→gera→pré-preenche templateForm). v1.16.0/v1.17.0(quebrado) -> v1.18.0.",
      motivation:
        "Ajustes de UI pedidos pelo Lucas: separar criação do template (fila) do envio, protocolo nos cards, Setup só admin, barra do Apolo fixa. + Cobrança preenche os dados do cliente sozinha e a Athena passa a redigir templates com IA (Claude Opus). Fix da tela branca do /iris.",
    },
    title: "Iris: Athena monta templates com IA + cobrança preenche os dados sozinha (e fix da tela branca)",
    type: "novidade",
    version: "v1.18.0",
  },
  {
    buildTag: "2026-07-01-iris-fila-vinculada-ao-numero",
    deployedAt: "2026-07-01T00:20:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Cada FILA agora fica vinculada a um número de WhatsApp: ao criar/editar uma fila, você escolhe o número (Atendimento/4143, Gurgel ou Jurídico). Campo obrigatório.",
              "Ao abrir um atendimento, ele já sai pelo número da fila — Jurídico manda pelo número do Jurídico, Gurgel pelo da Gurgel, e o restante pelo 4143. Sem escolher número na mão.",
              "Transferência ficou segura: só dá para transferir entre filas do MESMO número. Como a conversa (janela de 24h) é por número, não é possível passar um atendimento do 4143 para o Jurídico/Gurgel — para isso, abre-se um atendimento novo por aquele número.",
            ],
            screen: "Configurações · Filas / Atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-gew210p4u",
    technical: {
      done: "Iris multi-número: (1) vínculo fila→número em caredesk_queues.metadata.channelId (sem migration) — IrisQueueConfig +channelId, iris-data-client select+mapQueueRow, IrisPage createQueueForm/queueToForm/saveIrisQueue (grava metadata.channelId), iris-setup-view seletor 'Número (WhatsApp)' obrigatório (label sem prefixo WhatsApp). (2) tickets/route.ts: getChannelById+getQueueChannel resolvem o canal por queue.metadata.channelId → legado config.defaultQueueSlug → padrão 4143; abertura de atendimento e trava de transferência usam getQueueChannel/getQueuePhoneNumberId(queue); +metadata nos selects de fila. Corrige também o número de envio após a migração do 4143 (env META_WHATSAPP_PHONE_NUMBER_ID apontava pro id morto). (3) trava: em action=transfer, compara o número da fila destino com source_context.phoneNumberId do ticket → 409 se diferente. (4) rota admin /api/iris/meta/register-number (POST {phoneNumberId,pin}) pra ativar número na Cloud API. As 7 filas migradas: atendimento/suporte/financeiro/comunicados/cobranca→4143, gurgel→Gurgel, juridico→9072. v1.15.3 -> v1.16.0.",
      motivation:
        "Migração dos números (Gurgel + 4143) para a WABA própria Careli-Panteon (saindo da Elife/Smarters). Lucas quer tudo separado por número: cada fila vinculada ao seu número, atendimento saindo pelo número certo, e transferência travada entre números diferentes (a janela de 24h do WhatsApp é por número).",
    },
    title: "Iris: filas vinculadas ao número (multi-número separado + trava de transferência)",
    type: "novidade",
    version: "v1.16.0",
  },
  {
    buildTag: "2026-06-30-caca-cadastro-transferencia",
    deployedAt: "2026-06-30T20:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Cacá agora responde dúvidas de CADASTRO do cliente (estado civil, profissão, endereço, cônjuge, RG etc.) — sempre depois de confirmar a identidade do titular.",
              "Imobiliárias/empresas: a Cacá confirma se a empresa TEM cadastro na Careli e informa os dados só com o CNPJ (pessoa jurídica não precisa de validação de identidade).",
              "Ao transferir para uma pessoa, a Cacá agora DEMONSTRA que analisou o caso (diz a parcela/valor/vencimento que identificou e por que precisa do time), em vez de mandar um genérico 'já encaminhei'.",
              "Correção: ao informar a próxima parcela, a data agora sai sempre certa (antes, em alguns casos, apontava uma parcela mais distante como se fosse a próxima).",
            ],
            screen: "Atendimento (Cacá)",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-alyca001n",
    technical: {
      done: "Cacá (motor Claude): 2 ferramentas novas de cadastro — consultar_cadastro (PF, gated por ensureVerified, lê loadHadesAttendanceClient().dados360: estado civil/regime, nascimento, naturalidade/nacionalidade, profissão, RG, e-mail/telefone do cadastro, endereço completo, nome da mãe, cônjuge+conjugeDados) e consultar_cadastro_imobiliaria (PJ, NÃO gated — regra Lucas: PJ só precisa do CNPJ; lookupApoloByDocument 14díg -> confirma existência + displayName/profiles + enriquece com dados360 se houver c2xClientId; rejeita 11díg=CPF pra não vazar PF). persona.ts ganhou a seção 'Dados cadastrais' (como acessa cada dado, regra PF-confirma/PJ-só-CNPJ, e que NÃO altera cadastro -> transfere). + Correção 1: transferirParaHumano reescrito pra DEMONSTRAR a análise (parcela/valor/motivo específicos, nunca genérico) com guidance dentro/fora do horário (CacaToolContext.businessHoursOpen/nextContactLabel, agent.ts calcula businessHoursForNow antes do toolContext). + Fix do sort da próxima parcela por dueDateInput (ISO) em vez de dueDate (BR DD/MM/AAAA). Helpers loadClientRecord/formatCadastroEndereco, tipo CacaClientRecord. v1.15.2 -> v1.15.3.",
      motivation:
        "Lucas pediu que a Cacá tire dúvidas cadastrais usando o banco C2X (com a regra de identidade: PF confirma, PJ só CNPJ — caso AT-000063 da imobiliária Fr Freitas) e que a transferência demonstre a análise em vez de soar genérica. Lote único de melhorias da Cacá.",
    },
    title: "Iris: Cacá tira dúvidas de cadastro (cliente e imobiliária) e transfere demonstrando análise",
    type: "melhoria",
    version: "v1.15.3",
  },
  {
    buildTag: "2026-06-30-caca-le-pdf-imagem-claude",
    deployedAt: "2026-06-30T19:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Cacá voltou a LER os PDFs e imagens que o cliente envia — agora pelo Claude. Antes ela dependia da OpenAI para isso, que estava bloqueada (sem saldo), e por isso respondia 'não consigo abrir o conteúdo'.",
              "Áudio continua sendo transcrito normalmente (segue na OpenAI/Whisper).",
            ],
            screen: "Atendimento (Cacá)",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-86wrgi6od",
    technical: {
      done: "lib/iris/caca-media-analysis.ts: summarizeCacaMedia reescrito de OpenAI (/v1/responses, modelo gpt-5.5) para a Messages API do Claude via getAnthropicClient()/resolveClaudeModel('default')=Sonnet 4.6. Imagem -> bloco image (base64), PDF -> bloco document (base64, application/pdf); video e documento nao-PDF -> retorna null (fallback amigavel da Caca). Audio segue no Whisper (OpenAI) — guard de OPENAI_API_KEY movido para o ramo de audio. Removidos helpers OpenAI orfaos (readOpenAiError/extractOpenAiText/isRecord). Corrige o erro real visto no provider_payload: 'You exceeded your current quota' da OpenAI bloqueando TODA leitura de midia. v1.15.1 -> v1.15.2.",
      motivation:
        "A chave da OpenAI estourou a quota e travou a leitura de PDF/imagem/audio da Cacá. Lucas pediu para tirar a dependencia da OpenAI movendo a leitura para o Claude (texto da Cacá ja esta no Claude).",
    },
    title: "Iris: Cacá volta a ler PDF e imagem (agora pelo Claude)",
    type: "correcao",
    version: "v1.15.2",
  },
  {
    buildTag: "2026-06-30-produtores-central-notificacoes",
    deployedAt: "2026-06-30T18:05:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Quando o cliente responde num atendimento que é SEU (atribuído a você), você recebe uma notificação na central (com som e push) — mesmo sem estar na tela da Iris. Atendimentos sob a Cacá não geram aviso.",
            ],
            screen: "Atendimento",
          },
        ],
      },
      {
        module: "Meu dia",
        screens: [
          {
            items: [
              "Tarefas e retornos com lembrete agora te avisam na hora certa, na central.",
            ],
            screen: "Agenda",
          },
        ],
      },
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Você é avisado na central cerca de 20 minutos antes de uma reunião que vai participar.",
            ],
            screen: "Reuniões",
          },
        ],
      },
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Um resumo diário dos contratos críticos da carteira chega pros admins na central.",
            ],
            screen: "Cobrança",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-4ktsbcdhp",
    technical: {
      done: "Produtores da central (hub_notifications). Iris (evento): meta-inbound-processor emite publishHubNotification para o assigned_to_user_id quando chega mensagem do cliente (so quando ha operador humano atribuido; Caca usa handlingOwner no metadata, sem assigned). Cron unico /api/notifications/sweep (a cada 15min, allowlist no proxy.ts, auth x-vercel-cron/CRON_SECRET): (1) Meu dia — hub_agenda_items com remind_at vencido e reminded_at null, dedup nativo; (2) Chronos — chronos_meetings starts_at em [now,+20min], dedup via hub_notifications da ultima 1h por meetingReminderId, notifica chronos_participants; (3) Hades — digest diario (janela 12:00-12:14 BRT, dedup pelo proprio insert do dia) com loadHadesOverview().summary.criticalContracts -> admins. Atlas read-only (occurrences vem de sync, sem evento de criacao) e 'Chronos novo convite' redundante com o reminder -> fora de proposito. v1.15.0 -> v1.15.1.",
      motivation:
        "Lucas pediu que TODOS os modulos (menos Apolo/Ares) virem produtores da central, incluindo os baseados em estado (crons), com dedup e consciencia de custo.",
    },
    title: "Notificações: Iris, Meu dia, Chronos e Hades passam a avisar na central",
    type: "melhoria",
    version: "v1.15.1",
  },
  {
    buildTag: "2026-06-30-barra-panteon-central-notificacoes",
    deployedAt: "2026-06-30T17:30:00-03:00",
    modules: [
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "Chegou a barra Panteon no topo de todo o sistema: os módulos que você abre viram abas, como num navegador. Trocar de módulo agora é só clicar na aba — sem reabrir o menu.",
              "O '+' abre o menu de módulos, o 'x' fecha a aba e 'Panteon' (na ponta esquerda) leva pra Home. As abas abertas ficam salvas.",
              "Cada aba mostra o contador de não-lidos do módulo — ex.: mensagem nova no Hermes aparece na aba do Hermes.",
            ],
            screen: "Barra de navegação (todos os módulos)",
          },
          {
            items: [
              "A central do sino foi reorganizada por módulo: dá pra filtrar por 'Todos', Hermes, Zeus, Iris… com a contagem de cada um.",
              "O Zeus agora também notifica na central (antes não aparecia) e cada módulo tem seu próprio som.",
              "O som parou de falhar: toca mesmo quando a notificação chega pelo modo de segurança, não só ao vivo.",
            ],
            screen: "Central de notificações (sino)",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-nhe4im7lw",
    technical: {
      done: "Frente 1 (barra): PanteonModuleTabsBar vira o topbar de TODO chrome do HubShell (operacional + dashboard); abas dos módulos abertos persistem em localStorage (careli:hub-open-modules); Panteon = 1ª aba (Home). PanteonTopbarUser (sino/presença/avatar) movido pra barra (onDark) e removido dos 6 cabeçalhos de módulo (single presence controller). Botão launcher removido das 6 sidebars (o '+' cobre). Zeus virou chrome operacional in-hub (standalone ops.c2x intocado). Home: chrome operational + layoutMode=module (sem padding do ContentArea) + HomeModuleRail (lista de módulos alfabética, edge-to-edge). Fix guardian Sidebar (inset-y-0 -> top-[3.25rem]). Frente 2 (central): backbone único em hub_notifications (migrations 0039 colunas+RLS+publicação realtime, 0040 solta FK module_id); lib/notifications (publishHubNotification = insere linha + Web Push genérico). Zeus helpdesk emite pela central. Provider assina hub_notifications por realtime filtrado por usuário + catch-up foco/45s; som por módulo desacoplado do realtime + autoplay unlock; unreadByModule. UI panteon-notification-button com chips por módulo. v1.14.2 -> v1.15.0.",
      motivation:
        "Lucas pediu navegação por abas (trocar de módulo sem reabrir o launcher) e a revisão da central de comunicação: Hermes com som intermitente e gente sem receber, Zeus desconectado da central, e organizar as notificações de vários módulos por módulo.",
    },
    title: "Barra Panteon com abas + Central de notificações reorganizada",
    type: "novidade",
    version: "v1.15.0",
  },
  {
    buildTag: "2026-06-30-iris-responder-como-caca-restrito",
    deployedAt: "2026-06-30T11:50:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O botão 'Responder como Cacá' passou a ser restrito: só o usuário autorizado (dono) consegue ver e usar essa ação nos atendimentos da Cacá.",
            ],
            screen: "Atendimento (Cacá)",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-gojhsmcz4",
    technical: {
      done: "Controle de acesso de 'Responder como Cacá' centralizado em lib/iris/caca-reply-access.ts (canReplyAsCaca + allowlist de user ids). Endpoint /api/iris/tickets/caca-reply devolve 403 se o user não estiver na allowlist; IrisPage só passa onSendAsCaca (que faz o botão aparecer) quando canReplyAsCaca(hubUser.id). v1.14.1 -> v1.14.2.",
      motivation:
        "Lucas pediu que a ação de responder como Cacá fique disponível somente para o usuário dele.",
    },
    title: "Iris: 'Responder como Cacá' restrito ao usuário autorizado",
    type: "melhoria",
    version: "v1.14.2",
  },
  {
    buildTag: "2026-06-30-iris-responder-como-caca",
    deployedAt: "2026-06-30T11:25:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Nos atendimentos conduzidos pela Cacá, o operador agora pode enviar uma mensagem ao cliente assinada como Cacá (botão 'Responder como Cacá' no rodapé). Útil para uma correção ou complemento pontual sem precisar assumir o atendimento — a conversa continua com a Cacá.",
            ],
            screen: "Atendimento (Cacá)",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-4bcaiid8h",
    technical: {
      done: "Novo endpoint POST /api/iris/tickets/caca-reply (auth operator/leader/admin): resolve contato/canal/phone_number_id do ticket, envia via sendMetaWhatsAppTextMessage com signWhatsAppBody('Cacá', body) e registra em caredesk_messages (provider_payload.automation='caca', operatorLabel='Cacá', manualCaca=true, manualSenderUserId) + upsert em caredesk_whatsapp_message_refs. NÃO reatribui o ticket (segue Cacá). UI: IrisConversationComposerActions ganhou botão 'Responder como Cacá' + mini-composer no banner travado (lockedByCaca); IrisPage.handleSendAsCaca posta no endpoint e injeta a mensagem via onMessageCreated. Caminho do operador (/api/iris/meta/messages) intocado. v1.14.0 -> v1.14.1.",
      motivation:
        "Permitir uma correção/complemento na voz da Cacá (ex.: corrigir uma informação) sem tirar o atendimento dela nem expor credenciais — o servidor de produção envia. Construído para resolver a correção de uma parcela informada errada, mas fica reutilizável.",
    },
    title: "Iris: responder como Cacá nos atendimentos dela",
    type: "melhoria",
    version: "v1.14.1",
  },
  {
    buildTag: "2026-06-30-caca-parcela-tickets-mesmo-numero",
    deployedAt: "2026-06-30T10:50:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Corrigido um erro em que a Cacá podia informar a próxima parcela errada — ela apontava uma parcela de meses à frente em vez da que vence primeiro. Agora ela sempre calcula a próxima parcela na ordem correta.",
            ],
            screen: "Atendimento (Cacá)",
          },
          {
            items: [
              "Um cliente não pode mais ter dois atendimentos abertos ao mesmo tempo no mesmo número: ao tentar abrir, o sistema avisa que já existe um atendimento ativo (em qual fila e com quem) e oferece abrir o existente. Filas em números diferentes (ex.: Jurídico) seguem como conversas separadas, do jeito que o cliente vê no WhatsApp.",
              "O mesmo cliente deixa de virar dois contatos por causa do 9º dígito do celular (com 9 e sem 9 passam a ser a mesma pessoa) — o que evitava atendimentos e tickets duplicados.",
            ],
            screen: "Abrir atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-q3cuzarte",
    technical: {
      done: "Cacá (lib/iris/caca/executors.ts, consultarFinanceiro): a próxima parcela ordenava aVencer por item.dueDate em formato BR DD/MM/AAAA via String.localeCompare -> '20/01/2027' vinha antes de '20/07/2026' -> apontava parcela errada como próxima. Passou a ordenar por dueDateInput (ISO AAAA-MM-DD). Tickets: regra única buildBrazilianPhoneVariants (com/sem 9º dígito e com/sem 55) em meta-whatsapp.ts, aplicada em findOrCreateContact (inbound e operador), buildWhatsAppIdVariants e nos candidatos da janela de 24h -> inbound deixa de forkar contato pelo 9º dígito. Check 1: findActiveTicketForContactIdentity no POST de /api/iris/tickets bloqueia 2º ticket ativo no MESMO channel_id (número), devolve 409 com activeTicket {protocol, queueLabel, assigneeLabel}; iris-start-attendance-modal trata o 409 com card âmbar + 'Abrir o atendimento existente'. Fluxo Hades/cobrança e vínculo de atendimento ficam fora da guarda. v1.13.0 -> v1.14.0.",
      motivation:
        "Cacá entregou dado financeiro incorreto a um cliente (parcela errada por bug de ordenação de data) — corrigido com urgência. E fechar a duplicidade de contatos/tickets pelo 9º dígito brasileiro, respeitando que filas em números diferentes (Jurídico/Gurgel) são chats separados pro cliente e não entram na regra de um-ticket-por-número.",
    },
    title:
      "Cacá: parcela correta + tickets sem duplicar (9º dígito e um por número)",
    type: "correcao",
    version: "v1.14.0",
  },
  {
    buildTag: "2026-06-30-iris-board-fila-perfil-caca",
    deployedAt: "2026-06-30T08:25:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Novo Board em kanban: visão macro com colunas que se organizam sozinhas (Erro de envio · Com a Cacá · Pendente · Aguardando cliente · Resolvido hoje), indicadores no topo (abertos, SLA crítico, 1ª resposta, TDR, tempo médio), busca única e ordenação. Dá pra alternar entre kanban e lista. Já nasce pensado pra multicanal (WhatsApp hoje, e-mail depois).",
              "Fila de atendimento repaginada: nome do cliente em destaque, o perfil ao lado (Comprador / Prospect / Imobiliária…), bolinha de status e um número verde com quantas mensagens do cliente estão sem resposta. Os atendimentos conduzidos pela Cacá ficam isolados, sem poluir a fila.",
              "Cards e cockpit mostram o PERFIL do contato (Comprador, Prospect, Imobiliária, Corretor…) e, pra quem comprou, se está adimplente (verde) ou inadimplente (vermelho).",
            ],
            screen: "Board e Fila",
          },
          {
            items: [
              "A Cacá passa a respeitar o horário de atendimento (segunda a sexta, das 9h às 18h): fora do expediente, ao transferir ela avisa que o time não está atendendo agora e quando vamos retornar — sem prometer resposta imediata.",
              "Ao precisar de um analista, a Cacá mostra que analisou o caso (ex.: identifica a parcela em aberto) e explica por que vai transferir — pro cliente sentir que ela entendeu o problema antes de passar adiante.",
              "As mensagens enviadas ao cliente saem assinadas com o nome de quem está atendendo (o operador, ou 'Cacá').",
            ],
            screen: "Atendimento (Cacá)",
          },
          {
            items: [
              "Template de abertura do atendimento ativo corrigido (o nome do operador e o assunto saíam trocados no texto).",
              "Quando um envio falha, agora aparece o motivo real do WhatsApp/Meta (ex.: problema de pagamento) em vez do genérico 'Falha no envio'.",
              "O assunto do ticket começa em branco — o operador define.",
              "'CRM 360' virou 'Apolo' nos textos das telas.",
            ],
            screen: "Operação e ajustes",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-2plaomin8",
    technical: {
      done: "Board kanban novo (blocks/board/iris-board-kanban.tsx) substituindo a lista; colunas auto por statusColumnKey (erro via hasDeliveryError, Cacá via isCacaOwned exposto nos helpers), busca/ordenação client-side, indicador TDR (responseTimeLabel), toggle kanban/lista. Fila (IrisConversationInboxSidebar) refinada + badge de não-lidas (computeUnreadCount = inbound desde a última outbound) + filtro isCacaOwnedTicket. Perfil Comprador/Prospect + adimplência: readBoardTicketCrm/BoardProfileChip; phone-match estendido pra puxar apolo_financial_snapshots em batch (delinquency). Cabeçalho da conversa mostra perfil (não tipo de pessoa) + fila. Assinatura WhatsApp (signWhatsAppBody, assina na troca de remetente; Cacá assina sempre). Fix do mapeamento de variáveis do template (metadata.variables). Motivo do erro Meta capturado no webhook (extractStatusError) + traduzido na tela. Persona Cacá: horário (businessHoursForNow) + transferência demonstrando análise e encaminhando a 'analista da Careli'. Assunto inbound = null + data-client sem fallback. 'CRM 360'->'Apolo'. v1.12.3 -> v1.13.0.",
      motivation:
        "Lote grande de UX da Iris (Board macro multicanal, fila legível com perfil/adimplência, cards Comprador/Prospect) + Cacá mais 'humana' (ciente do horário, transferência consciente que demonstra análise) pra que o cliente associe a Cacá a um agente que resolve — reduzindo a dependência de atendimento humano ao longo do tempo.",
    },
    title:
      "Iris: novo Board, fila repaginada, perfil/adimplência e Cacá mais esperta",
    type: "novidade",
    version: "v1.13.0",
  },
  {
    buildTag: "2026-06-29-caca-memoria-por-cliente",
    deployedAt: "2026-06-29T12:06:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Cacá agora tem memória por cliente: ela lembra de coisas úteis dos atendimentos anteriores (ex.: 'prefere boleto por e-mail', 'fala mais formal') e personaliza o atendimento. Ela mesma registra o que aprende; nunca guarda dado sensível.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-5696af7wp",
    technical: {
      done: "Memória por cliente da Cacá SEM migration: guardada em caredesk_contacts.metadata.cacaNotes (lib/iris/caca/client-memory.ts: readClientNotes/appendClientNote, cap 20, dedup). Lida no início do turno (runCacaClaudeTurn) e injetada na persona ('O que já sabemos deste cliente'); escrita pela ferramenta nova anotar_sobre_cliente (input nota), com guard de não anotar dado sensível na descrição+persona. v1.12.2 -> v1.12.3.",
      motivation:
        "Lucas perguntou se a Cacá aprende/conhece melhor os clientes com o tempo e aprovou a memória por cliente. Não é treino de modelo: são anotações curtas e duradouras que a Cacá lê e escreve por contato, pra personalizar (preferências, jeito, situação recorrente).",
    },
    title: "Iris: Cacá ganha memória por cliente",
    type: "novidade",
    version: "v1.12.3",
  },
  {
    buildTag: "2026-06-29-cockpit-formatacao-whatsapp",
    deployedAt: "2026-06-29T11:54:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "No painel de atendimento, o negrito/itálico das mensagens agora aparece formatado (antes mostrava os asteriscos `*` literais). O cliente sempre viu o negrito; agora o operador também vê.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-4ed6if9pm",
    technical: {
      done: "Componente WhatsAppText em IrisPage.tsx renderiza a formatação do WhatsApp no cockpit: *negrito*->strong, _italico_->em, ~tachado~->s. Aplicado no texto da mensagem (MessageContent) e na legenda de mídia (MessageCaption). O WhatsApp do cliente já renderizava; o cockpit mostrava o marcador literal. v1.12.1 -> v1.12.2.",
      motivation:
        "Lucas (acompanhando os atendimentos da Cacá pelo cockpit): 'gosto do negrito, mas o * não'. A Cacá usa negrito do WhatsApp (*texto*); no app do cliente vira negrito, mas o painel mostrava o asterisco. Renderizar no cockpit mantém o negrito e tira o marcador.",
    },
    title: "Iris: negrito do WhatsApp formatado no cockpit",
    type: "correcao",
    version: "v1.12.2",
  },
  {
    buildTag: "2026-06-29-caca-atender-terceiros",
    deployedAt: "2026-06-29T11:45:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Cacá agora atende quando alguém pede informação de outra pessoa (parente, filho, esposa, amigo ajudando) — desde que confirme o CPF do proponente e o nome (ou outro dado do cadastro). Antes ela recusava de cara.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-d97qjcp3j",
    technical: {
      done: "Ajuste na persona da Cacá (lib/iris/caca/persona.ts): regra de 'atender pela outra pessoa'. É comum um parente/amigo ajudar o titular; a Cacá não deve recusar de cara. Pode tratar do cadastro de um terceiro DESDE QUE confirme a identidade do proponente (CPF/CNPJ + nome ou outro dado, via validar_identidade). A ferramenta já suportava; o texto da persona estava restrito demais ('só posso falar do seu cadastro'). v1.12.0 -> v1.12.1.",
      motivation:
        "No teste ao vivo (Lucas), a Cacá recusou dar info de outra pessoa. Regra de negócio: muitos titulares são atendidos por parentes próximos; a Cacá deve poder atender, validando o proponente (CPF + nome/cadastro) antes de expor dado ou enviar boleto.",
    },
    title: "Iris: Cacá atende por outra pessoa (com validação)",
    type: "correcao",
    version: "v1.12.1",
  },
  {
    buildTag: "2026-06-29-caca-claude-super-agente",
    deployedAt: "2026-06-29T11:31:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Cacá agora é um agente de verdade: lê a conversa inteira, consulta o financeiro do cliente (parcelas, valores, vencimentos) e responde de forma mais natural e resolutiva — menos 'menu', mais atendente.",
              "Quando o numero do WhatsApp e o mesmo do cadastro, ela ja atende sem pedir CPF; quando nao e, valida com seguranca antes de mostrar dado ou enviar boleto.",
              "Separa a informacao da parcela do link do boleto: se a parcela existe mas o link nao esta disponivel, ela avisa e encaminha pro time — nao diz mais que 'nao ha boleto'.",
              "Quando precisa de uma pessoa, ela transfere de verdade pro time interno.",
              "Le imagem e PDF que o cliente envia e entende audios (transcricao).",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-qtbc68otu",
    technical: {
      done: "Cacá migrada de OpenAI (gpt-5.5, máquina de estados) para um agente Claude com tool-use (Opus 4.8) atrás da flag CACA_ENGINE=claude, com FALLBACK automático para a Cacá determinística se a Claude falhar/estiver ausente (try/catch em maybeSendCacaAutoReply) — nenhum atendimento fica sem resposta. Novos arquivos: lib/ai/claude.ts (client + roteamento Sonnet/Opus/Haiku), lib/ai/claude-agent.ts (loop manual de tool-use + prompt caching no system + thinking adaptativo + effort + cap de iterações), lib/iris/caca/{persona,tools,executors,agent}.ts. 5 ferramentas (validar_identidade, consultar_financeiro, listar_boletos, gerar_link_boleto, transferir_para_humano) ligadas em Hades (loadHadesAttendanceClient), Asaas (prepareBoletoResendAction modo link, nunca disparo pago) e Apolo (lookupApoloByDocument/lookupApoloByPhone, exportados). Trava de identidade nas ferramentas (ensureVerified) + identidade por TELEFONE (número do WhatsApp == cadastro de comprador com unidade → verificado sem CPF). Imagem nativa (URL do bucket iris-media) + transcrição segue na OpenAI (Whisper; Claude não faz speech-to-text). v1.11.0 -> v1.12.0.",
      motivation:
        "A Cacá estava 'burrinha': máquina de estados rígida que só sabia entregar boleto, não consultava o banco pra responder, não lia o contexto da conversa (re-perguntava o que o cliente já tinha dito) e dizia que ia transferir sem transferir. O agente Claude com ferramentas reais resolve os casos que o Lucas apontou (Elício: consulta financeiro; Brenda: separa info de link; Lais: lê contexto; print 1: transfere de verdade). Custo liberado pelo Lucas → Opus 4.8 no raciocínio. Migração entra atrás de flag com fallback pra não arriscar o atendimento ao vivo.",
    },
    title: "Iris: Cacá vira um super-agente (Claude)",
    type: "novidade",
    version: "v1.12.0",
  },
  {
    buildTag: "2026-06-29-iris-midia-atendimento",
    deployedAt: "2026-06-29T10:13:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Audios recebidos do cliente agora tocam direto na conversa (antes ficava so um aviso, sem som).",
              "Para responder por audio: ao gravar aparece uma animacao com cronometro e, ao parar, um preview pra voce ouvir antes de enviar — so vai pro cliente quando voce confirma.",
              "Imagens e documentos recebidos aparecem na conversa: a imagem abre em tela cheia sem sair da Iris e o documento vira um cartao com download.",
              "Mensagens que o WhatsApp nao repassa (enquete, contato, 'ver uma vez') agora mostram um aviso claro em vez de 'unsupported'.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-1qfzgyn3l",
    technical: {
      done: "Midia inbound (audio/imagem/documento/video) baixada 1x da Meta (download compartilhado entre Storage e a leitura da CACA via param preloaded em analyzeCacaInboundMedia) e persistida num bucket publico iris-media (lib/iris/meta-media-storage.ts: uploadIrisMediaBuffer/uploadInboundMediaBuffer/persistInboundMediaToStorage), gravando provider_payload.media.url + providerMediaId no inbound (meta-inbound-processor) — o front (iris-data-client: mediaUrl/mediaKind/mediaFileName) renderiza player/preview/cartao. Rendering novo (MessageContent em IrisPage): imagem com lightbox (overlay + Esc), documento com download, video com player, audio como antes; rotulo amigavel para type 'unsupported'. Envio de voz: Chrome grava webm/opus (Meta recusa) -> transcodifica client-side pra MP3 (lib/iris/audio-transcode.ts via @breezystack/lamejs: decode Web Audio -> downmix mono -> encode), parser de dataUrl da rota /api/iris/meta/messages corrigido (aceita ';codecs=opus'); audio enviado tambem guardado no Storage (createQueuedTicketMessage -> uploadIrisMediaBuffer outbound) pra tocar no cockpit. Composer com gravacao estilo WhatsApp: animacao+cronometro gravando e preview (ouvir/descartar/enviar) ao parar (estado audioPreview + start/stop/cancelAudioRecording + sendRecordedAudio). Endpoint admin POST /api/iris/meta/media/backfill recupera midia ja recebida (id via provider_payload ou log de webhook). Bucket iris-media criado no Supabase de producao. v1.10.0 -> v1.11.0.",
      motivation:
        "Operadores precisavam ouvir os audios e ver as imagens/documentos que os clientes enviam (chegavam so como aviso de texto, sem conteudo) e poder responder por audio. A Meta nao entrega URL duravel da midia e o carregador de mensagens roda no browser (auth Bearer nao-cookie), entao a midia e persistida num Storage publico (mesmo modelo do Hermes) e a URL fica na propria mensagem. O envio exige transcodificar porque o WhatsApp Cloud API nao aceita webm. O preview antes de enviar (igual WhatsApp) evita mandar audio errado pro cliente.",
    },
    title: "Iris: audio, imagens e documentos no atendimento",
    type: "melhoria",
    version: "v1.11.0",
  },
  {
    buildTag: "2026-06-29-iris-abertura-template",
    deployedAt: "2026-06-29T05:59:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Novo formulario de abrir atendimento (mesmo estilo do Hades): busca o cliente, mostra a carteira e os tickets dele, e voce escolhe se personaliza a mensagem por ticket (protocolo) ou por parcelas.",
            ],
            screen: "Atendimento",
          },
          {
            items: [
              "Montagem de template mais inteligente: ao inserir uma variavel (Primeiro nome, Operador, Protocolo, Assunto, Parcelas...), ela ja entra numerada em ordem e o envio preenche cada uma com o valor certo — da pra montar qualquer mensagem.",
              "O telefone 4143 (atendimento) agora aparece na lista de telefones de envio dos templates.",
            ],
            screen: "Configuracoes",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-2to2i7hgp",
    technical: {
      done: "Form de abertura de janela reescrito (blocks/start-attendance/iris-start-attendance-modal.tsx) no estilo HadesAttendanceModal, mesma assinatura de props (sem mexer no wiring do IrisPage): busca Apolo + hidrata parcelas via /api/apolo/relationships + toggle Tickets|Parcelas (tickets single-select -> protocolo+assunto; parcelas multi-select = Hades) + envio janela-aberta-primeiro/409->template. Binding de variaveis por chave: builder (addTemplateVariable) atribui placeholder sequencial {{n}} e guarda nº->chave em variables; backend buildTemplateBodyParameters resolve por chave (valuesByKey: primeiro_nome/nome_cliente/protocolo/assunto/parcelas/operador; CRM->'-') ordenando pelo placeholder, com trava allKeysKnown (fallback legado [nome,parcelas,protocolo] p/ templates antigos); mapLocalTemplateRow expoe variables; chaves assunto+parcelas no catalogo. Multi-WABA: listMetaWhatsAppPhoneNumbers passa a consultar tambem META_WHATSAPP_EXTRA_BUSINESS_ACCOUNT_IDS (WABA Elife 1278786467773434 do 4143; extensivel por env CSV) -> 4143 no dropdown; e resolveMetaWhatsAppTemplateScope busca a WABA do telefone selecionado nas WABAs configurada+extras (corrige IRIS_TEMPLATE_PHONE_WABA_MISSING ao criar/consultar template no 4143). Go-live 29/jun ~05:59. v1.9.0 -> v1.10.0.",
      motivation:
        "Fechar o redesign da Iris: abrir atendimento ativo igual ao Hades e deixar o operador montar templates escolhendo variaveis (cada {{n}} vinculado a uma variavel, preenchido por chave no envio). Multi-WABA porque o 4143 (atendimento, catch-all) vive na WABA da Elife, separada da Panteon; templates sao por-WABA, entao o template de abertura precisa existir na WABA do 4143. Billing proprio na WABA Elife configurado por Lucas (29/jun) destrava o envio fora da janela de 24h.",
    },
    title: "Iris: abrir atendimento + templates com variaveis",
    type: "novidade",
    version: "v1.10.0",
  },
  {
    buildTag: "2026-06-29-iris-cockpit-redesign",
    deployedAt: "2026-06-29T05:09:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Tela de atendimento totalmente repensada: a fila agora mostra quem esta em espera ou pendente, com cronometro; toca um som quando chega mensagem; e clicar no card ja abre a conversa (nao precisa mais acertar o icone).",
              "Cockpit do cliente em 5 abas (Cliente, Carteira, Financeiro, Linha do tempo e Tickets), igual ao do Hades e lendo do Apolo — a Carteira traz boleto e contrato por unidade.",
              "Assunto do atendimento fica em destaque, da pra editar e e obrigatorio pra encerrar; perfil e situacao (adimplente/inadimplente) aparecem no topo; e a Athena, a assistente do operador, foi pro rodape.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-7k4y6t9t8",
    technical: {
      done: "Go-live (29/jun ~05:09, c2x.app.br -> careli-hub-hub-i2bs-161bke09i, rollback 7k4y6t9t8; ops 307 intocado). Redesign completo da tela de atendimento da Iris espelhando o Hades: fila renomeada 'Fila de atendimento' com marcadores Espera/Pendente + cronometro, som compartilhado Iris/Hades, central de notificacoes + clique no card abre atendimento (board-click), composer travado quando a CACA conduz, fila da CACA so admin/lider, cores WhatsApp/Hermes, Athena movida pro rodape (lista de tickets na Iris), chrome do centro limpo (assunto editavel no separador sticky, data com dia da semana), perfil + adimplente/inadimplente no header, botao Notas, assunto obrigatorio no encerramento, cockpit IrisCobrancaContextSidebar com 5 abas (Cliente/Carteira c/ boleto+contrato/Financeiro mock/Timeline/Tickets) com fonte Apolo, variavel Assunto {{10}} adicionada ao builder de template. Codigo ainda em working tree (nao commitado). v1.8.0 -> v1.9.0.",
      motivation:
        "Lucas quer o atendimento da Iris IDENTICO ao do Hades (mesma fila, conversa, cockpit em abas e Athena), lendo o contexto do cliente do Apolo, para unificar a operacao de atendimento e cobranca. Pendente: form de abertura de janela (copiar do HadesAttendanceModal, toggle tickets/parcelas) + substituicao da variavel Assunto no envio.",
    },
    title: "Iris: nova tela de atendimento (cockpit do cliente)",
    type: "novidade",
    version: "v1.9.0",
  },
  {
    buildTag: "2026-06-28-zeus-hub-apolo",
    deployedAt: "2026-06-28T22:55:00-03:00",
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "O Zeus (centro de operacoes) agora vive DENTRO do Hub: aparece no menu para admins, com o mesmo cabecalho/avatar dos outros modulos. O dominio separado (ops) sera desligado em breve.",
            ],
            screen: "Operacoes",
          },
        ],
      },
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Telas do cliente em evolucao: Resumo repensado (ativo desde, perfil, ultimos eventos e cenario financeiro) e Financeiro com a visao do cliente. A aba Documentos saiu.",
              "Sincronizacao automatica com o C2X ligada (a cada 6h) — os dados do cliente passam a se atualizar sozinhos, sem depender de carga manual.",
            ],
            screen: "CRM 360",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-6ja4kr7ot",
    technical: {
      done: "Go-live (28/jun noite, c2x.app.br -> careli-hub-hub-i2bs-r5782mwun, rollback 6ja4kr7ot). Zeus reintegrado ao Hub: proxy.ts parou de esconder /zeus+/squadops nos hosts do hub; hub-shell exibe Zeus no menu/launcher so para admin (canAccessZeusModule); removido o ZeusOpsPresenceBar (chrome proprio) -> usa o chrome padrao do hub (sem duplicacao). Apolo: modularizacao completa (ApoloPage 3.530->~334; blocks/data/types como Iris/Hades), dedup de entidades por documento NA LEITURA (collapseDuplicateApoloEntities em server.ts), cron de sync /api/apolo/sync/c2x 6/6h (GET autenticado x-vercel-cron/CRON_SECRET + entrada no vercel.json), busca escopada no banco (/api/apolo/search), cockpit em redesenho (Resumo+Financeiro mocks, Documentos removido, Carteira/Financeiro so comprador, Timeline unica). Iris: resolver C2X-direto presente (sera revertido; arquitetura Iris<-Apolo). Deploy via CLI tgz (git desconectado) exige working tree limpo (.turbo/.next/.codex*/outputs/.vercel-snapshots) + .npmrc production=false + buildCommand 'npm install --include=dev && turbo build'. v1.7.0 -> v1.8.0.",
      motivation:
        "Trazer o Zeus pra dentro do Hub (um dominio so, rumo a desligar o ops e reconectar o git, acabando com a fragilidade do deploy via CLI) e ligar o cron do Apolo — o read-model estava defasado desde 21/mai, o que travava a resolucao do cliente na Iris. Cockpit do Apolo em redesenho, validado por mock.",
    },
    title: "Zeus dentro do Hub + Apolo em evolucao",
    type: "novidade",
    version: "v1.8.0",
  },
  {
    buildTag: "2026-06-28-hades-cobranca-golive",
    deployedAt: "2026-06-28T00:30:00-03:00",
    modules: [
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Nova tela de atendimento de cobranca (fila · conversa · contexto do cliente) com a Athena, a assistente do operador: ela escreve a resposta, resume a conversa, organiza os boletos e ate le o contrato (D4Sign) pra tirar duvida.",
              "Da pra registrar acordo e promessa direto no atendimento; e a CACA responde sozinha quando o cliente toca \"Receber boleto\".",
            ],
            screen: "Atendimento",
          },
          {
            items: [
              "Historico reorganizado: agrupado por dia, com o tipo claro (acordo, promessa, quitacao, atendimento, quebra...) e a origem (automatico do Hades ou manual do operador).",
              "Filtro por data, atividade e protocolo; registrar atividade virou um popup central com o botao + no canto.",
            ],
            screen: "Timeline do cliente",
          },
        ],
      },
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "Novo \"Meu dia\": sua agenda, tarefas e retornos num lugar so — puxa as reunioes do Chronos e as tarefas do Asana.",
              "Home reformulada e melhorias de interface (os tooltips nao cortam mais).",
            ],
            screen: "Home",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-jur4gvue9",
    technical: {
      done: "Go-live (28/jun, c2x.app.br -> careli-hub-hub-i2bs-d2ph65a67) consolidando a frente de cobranca (Hades) + adjacencias no commit 36ecb75c. Cockpit de atendimento do Hades (3 zonas) reusando o motor da Iris, contexto proprio (Cliente/Parcelas/Propostas/Timeline/Tickets), direcionamento/encerramento e registro de acordo/promessa inline (render-prop, sem import circular). Athena (assistente do operador, /api/iris/athena, gpt-5.5): escrita/atalhos/selecionar msg/audio (whisper)/leitura de contrato via D4Sign (contract-reader). CACA automatica: contato ativo de cobranca pula CPF e manda boleto direto no inbound 'Receber boleto' (caca-agent + meta-inbound-processor); ativa so em prod. Central de Propostas (aprovacao/chat) + motor de compromissos (lib/rotas) + regua-cron OFF ate o template Meta novo. Modulo Meu dia (hub_agenda_items, migration 0038): rotas /api/agenda/{items,meetings,asana}, reunioes do Chronos e ponte read-only do Asana; Home em bento; botoes Retorno/Tarefa do composer vinculam o protocolo. Timeline (cliente OperationalTimeline + cockpit) reorganizada (agrupada/tipada/origem; popup central + filtro macro). Tooltip do uix via portal. Migrations 0037/0038 ja em prod. Dados de teste (5 compromissos AC-/PR-) limpos no go-live; fila (validEnterpriseWhere) mantida aberta pro treinamento. v1.6.3 -> v1.7.0.",
      motivation:
        "Levar pra producao todo o trabalho da frente de cobranca validado em previews (cockpit + Athena + CACA + propostas) e o modulo Meu dia, antes do go-live da Iris (segunda) — muito disso sera reaproveitado la.",
    },
    title: "Hades: atendimento de cobrança com a Athena + Meu dia na Home",
    type: "novidade",
    version: "v1.7.0",
  },
  {
    buildTag: "2026-06-26-security-gate-central",
    deployedAt: "2026-06-26T10:30:00-03:00",
    modules: [
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "Reforco de seguranca em todo o Hub: qualquer informacao agora exige login. So a videochamada do Chronos (cliente externo, sem login no sistema) fica aberta — como deve ser.",
              "Tapados 3 pontos que ainda respondiam sem login: a busca do Apolo (CRM), a visualizacao de boleto na Cobranca e a checagem de banco.",
            ],
            screen: "Plataforma",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-71eyvk82g",
    technical: {
      done: "Auditoria de seguranca de todas as ~100 rotas /api (todos os modulos). Achado: nao havia middleware global; cada rota so tinha a auth que ela mesma fazia. A maioria ja estava protegida por helper de modulo (authorizeHadesRead / authorizeChronosRequest / createAuthorizedAresContext / authorizeIrisMetaRequest / authorizeZeusAdminRequest etc.). CAMADA 1 (3 rotas abertas tapadas): apolo/search (vazava nome/CPF mascarado/perfil do CRM) -> novo lib/apolo/auth.ts (authorizeApoloRead); guardian/asaas/payment-viewing -> authorizeHadesRead + InstallmentsCard.tsx passou a enviar o Bearer; guardian/db/health -> removido o nome do banco (vira liveness puro). CAMADA 2 (gate central): novo apps/hub/middleware.ts exige Bearer em todo /api/* fora da allowlist (chronos/public da videochamada, webhook Meta, crons, OAuth callback, login, db/health, pwa/manifest); matcher so /api, paginas intocadas (ninguem deslogado). Monitor OPS: probes da fila Hades passaram a esperar 401 (protegidas desde o A5). Sem migration. v1.6.2 -> v1.6.3.",
      motivation:
        "Cumprir a politica do Lucas (tudo exige login, exceto a videochamada do Chronos) de forma sistemica: alem de tapar os 3 buracos remanescentes, o middleware garante que qualquer rota /api nova ja nasca trancada (defense-in-depth), evitando novos vazamentos de PII como o da fila/detalhe (A5).",
    },
    title: "Segurança: gate central de login em todas as APIs",
    type: "correcao",
    version: "v1.6.3",
  },
  {
    buildTag: "2026-06-26-hades-fila-auth",
    deployedAt: "2026-06-26T08:45:00-03:00",
    modules: [
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Reforco de seguranca: a fila de cobranca e o detalhe do cliente agora exigem login pra carregar — os dados sensiveis do cliente ficam protegidos de acesso nao autenticado.",
            ],
            screen: "Cobranca",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-7uxsw7al2",
    technical: {
      done: "A5 (auth/PII): as rotas /api/guardian/attendance/queue e /client/[id] nao validavam sessao e devolviam PII do C2X (nome/CPF/divida/endereco/conjuge) a requisicoes sem auth (nao ha middleware global). Helper compartilhado lib/guardian/auth.ts (authorizeHadesRead: valida Bearer Supabase + hub_user ativo) aplicado nas duas rotas; a pagina ja enviava o Bearer, agora o servidor valida. Sem migration. Confirmado: sem auth -> 401; logado -> carrega. Dashboard ja estava protegido (createAuthorizedContext). v1.6.1 -> v1.6.2.",
      motivation:
        "Fechar exposicao de dados pessoais (LGPD) na fila/detalhe da cobranca. Politica do Lucas: tudo exige login, exceto a videochamada do Chronos. Proximo: auditoria completa de todos os modulos + gate central (middleware + allowlist).",
    },
    title: "Segurança: fila e detalhe da Cobrança agora exigem login",
    type: "correcao",
    version: "v1.6.2",
  },
  {
    buildTag: "2026-06-26-processos-pop-cross-link",
    deployedAt: "2026-06-26T03:03:00-03:00",
    modules: [
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "Processos POP agora tem processos CONECTADOS: clique num passo do fluxograma e ele abre o processo ligado.",
              'Cada processo mostra "Processos vinculados" no topo (chips) e o painel de Novidades passou a mostrar a hora, alem da data.',
              "A Cobranca ganhou os processos Acordos & Promessas e Regua de lembretes, ligados ao Workflow.",
            ],
            screen: "Processos POP",
          },
        ],
      },
    ],
    rollback: "careli-hub-hub-i2bs-8cp13ddzj",
    technical: {
      done: "Iteracao da Processos POP: cross-link entre processos (PopState.processoLink + onOpenProcess no ProcessFlowchart; clique abre o processo alvo no modal/full) + relacoes automaticas derivadas (getProcessRelations) exibidas como 'Processos vinculados'. Workflow de cobranca renomeado Promessa/Acordo -> Proposta/Acerto; A&P reestruturado (termina no Acerto, braco acordo com envio) + novo processo Regua de lembretes (D-3/2/1/0, cron diario). Fork rotulo reposicionado (ponto na bezier). Painel Novidades passou a exibir data + hora (formatBrDate). v1.6.0 -> v1.6.1.",
      motivation:
        "Conectar os processos da Cobranca numa arvore navegavel (workflow <-> acordos/promessas <-> regua), deixando o desenho do motor de cobranca completo e visual para o time; e registrar a hora dos deploys no painel de Novidades.",
    },
    title: "Processos POP: processos conectados (cross-link) + Cobrança completa",
    type: "melhoria",
    version: "v1.6.1",
  },
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
