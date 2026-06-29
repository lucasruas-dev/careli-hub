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
