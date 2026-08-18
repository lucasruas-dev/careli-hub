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
  // Interno: entra no bump de versão (sinal de atualização da PWA + aba Deploy do Zeus),
  // mas NÃO aparece no painel de Novidades da Home (ex.: ajuste de polish pós-go-live que o
  // Lucas pediu pra não anunciar). Ver [[feedback-deploy-changelog-obrigatorio]].
  internal?: boolean;
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
    buildTag: "2026-08-18-ordem-de-assinatura",
    deployedAt: "2026-08-18T18:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "As barrinhas passam a seguir a ORDEM DE ASSINATURA: imobiliaria, comprador, incorporador, coordenacao e backoffice, que e como o contrato de fato anda. Antes vinham em ordem alfabetica, com o Backoffice (que assina por ultimo) na frente, e a barra nao mostrava a progressao",
              "A ordem e a mesma em todas as linhas: contrato que foge do padrao nao desalinha as colunas das outras, entao a lista continua servindo para comparar unidade com unidade",
              "O Huber aparece como Coordenadora de venda, nao mais como Imobiliaria",
            ],
            screen: "Contratos",
          },
        ],
      },
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: ["As mesmas duas correcoes na visao Contratos"],
            screen: "Vendas - Contratos",
          },
        ],
      },
    ],
    rollback: "v1.159.0 (2026-08-18-contratos-sem-espera)",
    technical: {
      done:
        "ORDEM: a posicao de cada perfil sai da MEDIA dos degraus dele no recorte, calculada uma vez depois de todas as linhas montadas (ordenarGruposPelaOrdemDeAssinatura). Ordenar cada linha pelo proprio degrau parece equivalente e nao e: contrato com um perfil a menos embaralha as colunas e a lista deixa de funcionar como tabela, que foi o defeito que a alfabetica tinha vindo consertar mais cedo no mesmo dia. A ordem sai do DADO e nao de uma constante com os cinco nomes de hoje: se o fluxo mudar, a tela acompanha em vez de mentir em silencio. Dois testes novos, um deles com um contrato fora do padrao provando que as colunas continuam alinhadas. HUBER: conferido no C2X (scripts/apolo/conferir-papel-huber.mjs) que ele NAO esta em coordenador_id, manager_id nem captivator_id de nenhum empreendimento — e Administrador no perfil e chega como Imobiliaria em cinco empreendimentos. Ou seja, a correcao anterior (papel pelo cadastro do empreendimento) nao tinha como alcanca-lo. Agora ha excecao declarada por users.id em PAPEL_FIXO_POR_USUARIO_C2X, e o papel do cadastro passou a ser lido nos TRES leitores (antes so no painel antigo: a tela de Contratos e o portal chamavam perfilDeTela sem o argumento).",
      motivation:
        "Lucas, com o print da tabela de assinatura: nao esta padrao isso nao? imobiliaria, comprador, incorporador, coordenacao e backoffice? E, no mesmo dia pela segunda vez: o huber e coordenacao.",
    },
    title: "Assinaturas na ordem em que o contrato anda",
    type: "melhoria",
    version: "1.160.0",
  },
  {
    buildTag: "2026-08-18-contratos-sem-espera",
    deployedAt: "2026-08-18T17:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A tela de Contratos abre na hora. Ela deixou de esperar a consulta ao D4Sign para desenhar: mostra a lista do sistema imediatamente e confere as assinaturas em segundo plano, atualizando sozinha quando a conferencia termina",
              "Enquanto carrega aparece o esqueleto da pagina, os blocos no formato do conteudo, em vez da frase Carregando os contratos. E o mesmo carregamento do resto do Panteon",
            ],
            screen: "Contratos",
          },
        ],
      },
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "Mesma coisa: as telas abrem na hora e se completam sozinhas",
              "O esqueleto de carregamento respeita o tema do portal, claro e escuro",
            ],
            screen: "Vendas",
          },
        ],
      },
    ],
    rollback: "v1.158.0 (2026-08-18-portal-sem-jargao)",
    technical: {
      done:
        "MEDIDO antes de mexer (scripts/apolo/medir-catalogo-real.mjs e medir-carga-contratos.mjs): catalogo D4Sign frio 4,4 s em 8 paginas, mais 7,0 s dos 20 detalhes do teto, contra 0,1 s do SQL que traz a mesma lista. Perto de 12 s de tela parada, e nao em caso raro: o cache e da INSTANCIA serverless e a Vercel recicla instancia o tempo todo. Paralelizar mais nao resolveria (medido: 3,0 s mais 4,5 s = 7,5 s). O que resolve e nao esperar. OpcoesDeLote.semEsperar usa so o que esta em memoria (o cache, e o catalogo apenas SE ja estiver quente); o que falta volta ok:false e cai no fallback honesto do C2X, com o aviso de sempre, e volta MARCADO em vez de sumir (entrada ausente seria lida como documento inexistente, enquanto ok:false e nao sei agora). O aquecimento roda no after() das duas rotas, DEPOIS da resposta: chamar antes do NextResponse.json desfaz o ganho inteiro. O campo conciliando manda a tela perguntar de novo em cerca de 6 s e nao e polling, porque so existe quando o servidor pede, some sozinho quando a resposta chega conciliada e com o catalogo quente nunca acontece; o cache de 5 min da lib nao guarda quadro com conciliando, senao prenderia a tela no dado do C2X depois de o aquecimento terminar. O repique troca os dados sem voltar ao esqueleto, e falha no repique nao apaga numeros que ja estao na frente do usuario. Tres testes novos travam o comportamento, incluindo o de que ZERO chamadas saem com o cache frio.",
      motivation:
        "Lucas: esta demorando muito para carregar as paginas, e gostaria de trazer o carregamento que ja tem no panteon, mas olha por favor essa demora.",
    },
    title: "Contratos: a tela abre na hora e se completa sozinha",
    type: "melhoria",
    version: "1.159.0",
  },
  {
    buildTag: "2026-08-18-portal-sem-jargao",
    deployedAt: "2026-08-18T16:05:00-03:00",
    modules: [
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "Sai do portal o aviso que citava os sistemas por dentro ('o D4Sign confirmou a situacao; a marcacao vem do sistema antigo'). O loteador nao decide nada com aquilo e falar de tripa do sistema numa tela de cliente so passa insegurancia",
              "Sai tambem o selo de procedencia nas linhas e o aviso dentro do popup da unidade, pelo mesmo motivo",
              "Fica UM aviso, raro, e escrito para cliente: quando a confirmacao das assinaturas nao responde, a tela diz que alguns contratos podem levar alguns minutos para aparecer atualizados. Sem nome de sistema nenhum",
              "A tela Contratos do Apolo continua com a sinalizacao completa: e o time da Careli que decide de quem cobrar, e para isso precisa saber a procedencia de cada linha",
            ],
            screen: "Vendas - Contratos",
          },
        ],
      },
    ],
    rollback: "v1.157.0 (2026-08-18-fonte-da-assinatura)",
    technical: {
      done:
        "A limpeza e no SERVIDOR, nao na tela: a rota /api/incorporador/vendas/assinaturas zera avisoDosAssinantes, remove aviso e fonte de cada unidade e troca o texto tecnico de avisoDaFonte por uma frase de cliente. Esconder no componente deixaria o jargao viajando no JSON, visivel na aba de rede — o portal nao fala de C2X nem em payload. O tipo local da linha perdeu aviso/fonte com o porque escrito em cima, para ninguem 'consertar' isso de volta. A lib segue intacta e a tela interna recebe tudo. Tambem registrado: as 454 pendencias falsas da Lavra do Ouro tem causa conhecida (contratos rodados a mao, fora do fluxo do C2X) e a decisao do dono e seguir o D4Sign ali — a tela filtrada em LOS ja mostra o numero certo, porque documento finalizado e resolvido pela listagem em lote antes do teto por carga.",
      motivation:
        "Lucas, vendo a faixa no portal: 'nao queria esse tipo de comunicado para o incorporador'.",
    },
    title: "Portal do incorporador sem jargao de sistema",
    type: "melhoria",
    version: "1.158.0",
  },
  {
    buildTag: "2026-08-18-fonte-da-assinatura",
    deployedAt: "2026-08-18T15:05:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A tela agora DIZ de onde vem cada assinatura. Quando o D4Sign nao responde, o que aparece continua sendo o registro do sistema antigo, mas com aviso: antes a tela mostrava dado velho calado, que era justamente o defeito que motivou a troca de fonte",
              "Sao dois avisos diferentes e cada um diz uma coisa: um e o D4Sign sem responder (a situacao pode estar errada), o outro e a situacao confirmada com a marcacao de quem assinou vindo do sistema antigo. Nenhum substitui o outro",
              "Contrato que o D4Sign diz cancelado sai da conta e a unidade volta para Aguardando emissao, em vez de ficar cobrando assinatura de contrato morto",
              "Dentro do popup da unidade o aviso aparece sempre que houver: e ali que se olha nome por nome para decidir de quem cobrar",
            ],
            screen: "Contratos",
          },
        ],
      },
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "Mesma sinalizacao de procedencia da tela interna, na visao Contratos",
              "O portal parou de receber dado interno que nao desenha nada na tela (identificadores do sistema antigo e a contabilidade da conferencia). Nada de dado pessoal estava envolvido, mas aquele pacote vai para o navegador de um cliente externo e agora leva so o que a tela mostra",
            ],
            screen: "Vendas - Contratos",
          },
        ],
      },
    ],
    rollback: "v1.156.0 (2026-08-18-comprovante-de-renda)",
    technical: {
      done:
        "Os dois leitores (carregarPainelDeContratos e lerAssinaturasDoPortal) ja chamavam montarQuadroComD4Sign; o que faltava era a TELA — avisoDaFonte, avisoDosAssinantes e o aviso/fonte por linha chegavam do servidor e eram descartados. No portal o tipo local da linha e uma COPIA do tipo da lib (o portal nao importa a lib, que puxa mysql2) e campo que a copia nao declara chega em runtime com o TypeScript apagando o tipo: foi o que manteve o aviso invisivel. Selo por linha SO no fallback real (c2x-legado); para o caso majoritario quem avisa e a faixa do topo, senao 165 carimbos matam o sinal. CONFERIDO contra o C2X: no recorte VOC+VOL a tela bate casa por casa com o SQL cru e com producao (2.295 linhas / 1.202 assinadas / 185 unidades, filtro send_document_signature = 1 mais status <> 6), e no pareamento assinante a assinante deu ZERO divergencia nas duas direcoes — no Vale do Ouro o C2X esta certo. O gap do C2X esta na LAVRA DO OURO: 454 das 496 pendencias falsas do acervo (151 documentos finalizados no D4Sign e abertos no C2X), resolvidas pela listagem em lote sem chamada por documento. Medicoes em docs/operations/d4sign-como-fonte-medicao-2026-08-18.md.",
      motivation:
        "Lucas: 'queria usar somente o D4Sign, o C2X tem muito gap ainda' e, na conferencia, 'olha se esta batendo com o C2X, por favor'.",
    },
    title: "Assinaturas: a tela diz de onde vem cada informacao",
    type: "melhoria",
    version: "1.157.0",
  },
  {
    buildTag: "2026-08-18-comprovante-de-renda",
    deployedAt: "2026-08-18T14:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Etapa nova no Setup do empreendimento: COMPROVANTE DE RENDA. Ligada, passa a ser obrigatorio anexar o comprovante para enviar a CAD, junto dos documentos que ja sao exigidos",
              "O cliente entrega UM dos tres: extrato bancario dos ultimos 3 meses, contracheque ou declaracao de imposto de renda",
              "Nasce DESLIGADA em todos os empreendimentos: nada muda ate alguem ligar a chave, e ligar vale da proxima CAD em diante",
              "Como as outras etapas, ela fica inativa quando a chave geral Recebendo CAD esta desligada",
            ],
            screen: "Empreendimento - Setup",
          },
        ],
      },
      {
        module: "Cadastro (CAD)",
        screens: [
          {
            items: [
              "Com a etapa ligada, o wizard ganha o passo Renda antes da revisao: escolhe a forma, anexa e segue; trocar de forma descarta o anexo anterior para nao subir documento duplicado",
              "O comprovante aparece na ficha do cliente junto dos outros documentos, com o tipo identificado (extrato, contracheque ou imposto de renda)",
            ],
            screen: "Wizard de cadastro",
          },
        ],
      },
    ],
    rollback: "v1.155.0 (2026-08-18-contratos-e-vale-do-ouro)",
    technical: {
      done:
        "Migration 0095 aplicada em producao (comprovante_renda_habilitado, boolean not null default false — ao contrario da 0071, que nasceu true: aqui true viraria exigencia nova em massa). A regra pura vive em lib/apolo/cadastro-obrigatorios.ts e casa por FAMILIA de categoria (extrato | contracheque | irpf: qualquer uma satisfaz). O flag NUNCA vem do corpo: as duas rotas de salvar releem a chave no banco e o empreendimento sai do token da sessao, entao POST forjado nao desliga a exigencia. Documento segue o caminho atual (bucket apolo-documents, uploadApoloDocument, apolo_documents com document_type), e a contabilidade de 3,2MB no corpo ja manda o excedente por URL assinada, sem risco novo de 413.",
      motivation:
        "Lucas: 'vamos criar uma nova etapa, comprovante de renda... quando estiver ativa vira uma obrigatoriedade na hora de subir a CAD'.",
    },
    title: "Comprovante de renda como etapa do credenciamento",
    type: "novidade",
    version: "1.156.0",
  },
  {
    buildTag: "2026-08-18-contratos-e-vale-do-ouro",
    deployedAt: "2026-08-18T13:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A tela de assinaturas virou CONTRATOS, no mesmo desenho do portal: taxa por perfil, uma linha por unidade com barra por grupo, popup com a tabela de assinatura e o PDF do contrato",
              "O painel antigo continua a um clique, na aba ao lado, para a conferencia linha a linha que o time usa",
              "Filtro por empreendimento mostrando nome E sigla: acabou a confusao entre os quatro VALE DO OURO",
            ],
            screen: "Assinaturas / Contratos",
          },
          {
            items: [
              "O total geral parou de contar o Vale do Ouro DUAS VEZES: o registro historico (VLO) tem os mesmos lotes das divisoes vivas (VOC + VOL) e nao entra mais nas somas. O numero certo e 4.262 unidades e R$ 1.040.273.342, no lugar de 4.560 e R$ 1.068.042.231",
              "O historico continua listado e acessivel (e por ele que se chega ao masterplan e as CADs), agora identificado como historico",
              "O papel de quem assina passa a sair do CADASTRO do empreendimento: quem e coordenador ou gerente aparece como coordenacao, nao mais como imobiliaria",
            ],
            screen: "Empreendimento",
          },
        ],
      },
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "As abas Contratos e Assinaturas viraram UMA, chamada Contratos, com o PDF no fim de cada linha",
              "Os grupos da barra ficam sempre na mesma ordem (alfabetica), para dar para comparar uma unidade com a outra de relance",
              "Valor e data de geracao do contrato na linha; imobiliaria e faturamento no popup",
            ],
            screen: "Vendas - Contratos",
          },
        ],
      },
    ],
    rollback: "v1.154.0 (2026-08-18-assinatura-por-unidade)",
    technical: {
      done:
        "ENTERPRISE_MIRRORS em c2x-analytics.ts (VLO espelho de VOC+VOL) tira o espelho das somas sem removê-lo das leituras (masterplan 35, CADs da esteira e painel do coordenador dependem dele); displayEnterprise deixa de colapsar os quatro num rótulo só. perfilDeTela passa a receber o papel no cadastro do empreendimento (coordenador/gerente/captador vencem o profile genérico do C2X): medido, o Huber (2510) tem profile Imobiliária e é manager_id de 9 empreendimentos. Portal: visões Contratos e Assinaturas fundidas numa chamada só (lerContratosVivos compartilhado), grupos em ordem alfabética estável. Apolo: nova tela em /apolo/assinaturas reusando o núcleo do portal (lib/apolo/assinaturas/nucleo.ts), com e-mail do assinante e filtro por empreendimento; BI público intocado. Base do D4Sign como fonte da verdade preparada (d4sign-assinaturas.ts + divergências).",
      motivation:
        "Lucas: 'os dados não batem, revisa como está o Vale do Ouro'; 'o Huber é o Coordenador, está como imobiliária'; 'a tela de assinatura devia chamar contratos'; 'quero levá-la para dentro do Apolo'.",
    },
    title: "Contratos no Apolo, Vale do Ouro sem contar duas vezes",
    type: "novidade",
    version: "1.155.0",
  },
  {
    buildTag: "2026-08-18-assinatura-por-unidade",
    deployedAt: "2026-08-18T12:10:00-03:00",
    modules: [
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "TAXA DE ASSINATURA POR PERFIL nos cards: Comprador, Imobiliaria, Coordenadora de venda, Incorporador, Backoffice e Corretor, cada um com percentual, fracao e barra; o elo mais atrasado aparece primeiro, em vermelho",
              "ASSINATURA POR UNIDADE: cada unidade mostra uma barrinha por perfil que assina naquele contrato, o total (5 de 8) e com quem esta parado e ha quantos dias",
              "Clicar na unidade abre a TABELA DE ASSINATURA do contrato: assinante, perfil, se ja assinou, se e a vez dele ou se ainda aguarda, com a data",
              "Filtros em pilha com contagem (todas, pendentes, concluidas, parado com cada perfil), busca por unidade ou comprador, e a lista ordenada pelo que esta parado ha mais tempo",
              "Blocos do painel interno replicados: Comprador, Geral, Prazo de 7 dias e a fila degrau a degrau quando o empreendimento usa ordem de assinatura",
            ],
            screen: "Vendas - Assinaturas",
          },
        ],
      },
    ],
    rollback: "v1.153.0 (2026-08-18-portal-no-escuro)",
    technical: {
      done:
        "assinaturas.ts devolve unidades (esquema + grupos por perfil), fila, taxas e KPIs do painel interno, sem consulta nova (mesma leitura reagrupada); painel-assinatura.ts so ganhou export de prazoDoComprador/PRAZO_COMPRADOR para a regua de 7 dias ser importada em vez de copiada. NOME_DEGRAU do painel NAO foi copiado: medido no C2X, aquela tabela descreve o Vale do Ouro e no LBR a ordem 3 e da imobiliaria; o rotulo agora sai dos perfis que assinam no degrau. A fila so aparece onde ha ordem de verdade (after_position > 0).",
      motivation:
        "Lucas: 'do jeito que esta eu nao sei o status de assinatura das unidades' e 'esses cards poderiam trazer a taxa de assinatura das imobiliarias, backoffice, coordenacao, incorporador'.",
    },
    title: "Assinaturas por unidade, com barra de progresso e o esquema do contrato",
    type: "novidade",
    version: "1.154.0",
  },
  {
    buildTag: "2026-08-18-portal-no-escuro",
    deployedAt: "2026-08-18T09:10:00-03:00",
    modules: [
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "MODO ESCURO no portal, com o cliente escolhendo: claro, escuro ou seguir o aparelho, no menu e na tela de login",
              "O escuro passa a ser o PADRAO de quem nunca escolheu; o portal personalizado continua abrindo no tema do aparelho, e agora tambem pode escolher",
              "O mapa do empreendimento acompanha o tema: no escuro ele vem escuro, sem virar um retangulo branco no meio da tela",
              "A escolha fica salva e vale ja no carregamento, sem a tela piscar branco",
              "A logo do Panteon na porta e a mesma do login do sistema, maior e legivel nos dois temas",
            ],
            screen: "Portal (todas as telas)",
          },
          {
            items: [
              "Gestao de assinaturas refeita: os KPIs viraram indicadores com barra de progresso e o palco agora e QUEM ESTA COM A BOLA, com os contratos parados esperando cada pessoa e ha quantos dias",
              "A lista completa de assinantes virou um bloco recolhido com busca, no fim da tela",
              "Resumo de vendas reordenado: composicao do estoque e ritmo antes do perfil do comprador",
              "Todas as barras dos graficos mostram o valor no topo",
            ],
            screen: "Vendas (Resumo e Assinaturas)",
          },
        ],
      },
    ],
    rollback: "v1.152.1 (2026-08-18-panteon-na-porta-do-portal)",
    technical: {
      done:
        "Tokens do portal em tres estados (claro na base, media query guardada por :not([data-inc-tema=claro]), e [data-inc-tema=escuro]); escolha em localStorage aplicada por script pre-pintura no layout; TEMA_PADRAO_DO_PORTAL=escuro separado de escolhaInicialDoPortal(bruto, personalizado) para nao colar 'nunca escolheu' com 'escolheu sistema'; rota do masterplan respeita ?tema= (deveClarearMasterplan) sem tocar em escopo; logo do hub reaproveitada com filter invert(1) no claro. Aba Assinaturas reescrita (cards de quem esta na vez + acordeao), Resumo reordenado e rotulo em toda barra com escalonamento em dois niveis.",
      motivation:
        "Lucas: 'temos que disponibilizar o dark tambem', depois 'ficou muito bom esse modo dark, quero ele padrao daqui pra frente' e 'pode deixar a Cecilio escolher tambem'; a aba de assinaturas estava longa demais para usar.",
    },
    title: "Portal do incorporador no escuro, por escolha do cliente",
    type: "novidade",
    version: "1.153.0",
  },
  {
    buildTag: "2026-08-18-panteon-na-porta-do-portal",
    deployedAt: "2026-08-18T08:40:00-03:00",
    modules: [
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "A tela de login do portal passou a assinar Panteon acima do nome do empreendimento, como o menu de dentro ja fazia",
              "O portal personalizado segue com a marca do proprio cliente na porta, sem mudanca",
            ],
            screen: "Login do portal",
          },
          {
            items: [
              "A aba Assinaturas foi reorganizada: em cima, QUEM ESTA COM A BOLA (um card por pessoa, com os contratos parados com ela e ha quantos dias), e o quadro completo dos assinantes virou uma lista recolhida com busca",
              "Indicadores da aba ganharam barra de progresso no que e fracao (compradores que assinaram, unidades 100% assinadas)",
              "Quando ninguem esta segurando contrato, a tela diz isso em vez de mostrar uma tabela cheia de zeros",
            ],
            screen: "Vendas - Assinaturas",
          },
          {
            items: [
              "TODA barra dos graficos mostra o valor no topo, tambem no modo R$ (antes so a maior de cada mes)",
              "Ordem do resumo trocada: composicao do estoque e ritmo de vendas vem antes do perfil do comprador",
            ],
            screen: "Vendas - Resumo",
          },
        ],
      },
    ],
    rollback: "v1.152.0 (2026-08-18-contratos-e-assinaturas-no-portal)",
    technical: {
      done:
        "Moldura da porta recebe o slug e assina com o simbolo + nome do Panteon quando ehPortalPersonalizado(slug) e falso. Aba Assinaturas redesenhada (tiles com barra de progresso, cards de 'com a bola agora' com unidades e tempo de espera, lista dos 63 recolhida com busca; a lista de pendentes foi fundida nos cards e sobrou bloco proprio para envio sem assinante). Rotulo em TODA barra com valor: escalonamento por conflito real (o rotulo sobe acima da barra mais alta da vizinhanca e salta um nivel quando encostaria no rotulo a esquerda), formato curto no modo R$. Medido na tela: 0 colisao rotulo-rotulo e 0 rotulo-barra nos dois modos, sem texto vertical. Ordem das secoes do Resumo trocada.",
      motivation:
        "Lucas: faltou a logo do Panteon na porta; a tela de assinatura estava longa e confusa; ainda havia barra sem indicador; e o perfil do comprador vinha antes do estoque e do ritmo.",
    },
    title: "Assinaturas reorganizada, Panteon na porta e todo grafico com numero",
    type: "melhoria",
    version: "1.152.1",
  },
  {
    buildTag: "2026-08-18-contratos-e-assinaturas-no-portal",
    deployedAt: "2026-08-18T03:30:00-03:00",
    modules: [
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "Aba CONTRATOS GERADOS: todos os contratos vivos do empreendimento, com data de geracao, valor, situacao da assinatura, faturamento e o PDF do contrato assinado",
              "Aba GESTAO DE ASSINATURAS: o quadro por assinante (quantos assinou, quantos estao NA VEZ dele, quantos aguardam os anteriores) com a mesma regra de ordem do painel interno, e os indicadores de % assinado, unidades 100% assinadas e tempo medio ate assinar",
              "Indicador novo de CLIENTES UNICOS no resumo de vendas",
            ],
            screen: "Vendas (Contratos - Assinaturas)",
          },
        ],
      },
    ],
    rollback: "v1.151.1 (2026-08-18-proposta-prevista-pelo-plano)",
    technical: {
      done:
        "lib/apolo/incorporador/contratos.ts (regua de estagio derivada de STAGE_MAP, escolha de envio uuidDoc>maior id, teto 500 com flag truncado) e assinaturas.ts (importa marcarSituacao/perfilDeTela do painel interno; LEFT JOIN em signers para envio sem assinante nao sumir) + rotas escopadas por codigosDaSessao; TelaVendas com as visoes Contratos e Assinaturas (fetch na abertura, cache por recorte) e KPI clientesUnicos. Correcoes da revisao: billing_date por date_format (DATE + timezone Z voltava um dia) e envio sem assinante visivel nas duas abas.",
      motivation:
        "Pedido do Lucas: acompanhar contratos gerados e o andamento das assinaturas dentro de Vendas, com clientes unicos como indicador.",
    },
    title: "Vendas do portal: contratos gerados e gestao de assinaturas",
    type: "novidade",
    version: "1.152.0",
  },
  {
    buildTag: "2026-08-18-proposta-prevista-pelo-plano",
    deployedAt: "2026-08-18T03:05:00-03:00",
    internal: true,
    modules: [
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "O popup da proposta mostra o PREVISTO pelo plano comercial quando as parcelas ainda nao foram emitidas: entrada (valor e %), negociado e desconto, validos desde a etapa Proposta emitida",
              "Plano personalizado segue sem numero previsto de negociado e desconto: o valor fechado so nasce na emissao",
              "Titulo do popup no formato dos cards (LBFC1210), em vez do bloco e lote crus",
            ],
            screen: "Vendas - Pipeline (popup da proposta)",
          },
        ],
      },
    ],
    rollback: "v1.151.0 (2026-08-18-portal-do-incorporador-padrao)",
    technical: {
      done:
        "venda-proposta.ts: previsao pelo plano (coalesce cpc/cps initial_input_value; negociado previsto = tabela so para plano padrao) quando zero parcelas emitidas; rotulo compacto codigo+bloco+lote; modal da TelaVendas renderiza o previsto com rotulos proprios. Validado com o contrato real 4283 (LBF C12-10) em teste.",
      motivation:
        "Lucas: a proposta e visivel desde a segunda etapa no C2X, e o popup dizia a definir em tudo antes da emissao.",
    },
    title: "Popup da proposta: previsto pelo plano antes da emissao",
    type: "melhoria",
    version: "1.151.1",
  },
  {
    buildTag: "2026-08-18-portal-do-incorporador-padrao",
    deployedAt: "2026-08-18T02:40:00-03:00",
    modules: [
      {
        module: "Portal do incorporador",
        screens: [
          {
            items: [
              "Portal PADRAO completo para o loteador, com a marca dele: CRM, Vendas e Carteira, tudo filtrado so pelo que e dele",
              "CRM no desenho do CRM 360: lista de compradores, cadastros e imobiliarias, e a ficha completa com Resumo, Cadastro, Relacionamentos, Carteira, Financeiro, Documentos e Historico",
              "Documentos da ficha em tres fontes: os do cadastro no Apolo abrem direto, o contrato assinado abre em PDF, e os arquivos guardados no C2X aparecem listados",
              "Vendas como um BI: indicadores de propostas, faturadas e cancelamentos, grafico mensal, ranking de imobiliarias, perfil agregado do comprador, pipeline em colunas e o popup da proposta de cada venda (entrada, desconto, parcelamento e financiamento)",
              "Carteira identica a do Apolo, com a coluna nova de VALOR LIQUIDO por unidade, o contrato assinado, o boleto de cada parcela e a aba de indicadores no desenho do BI",
              "Masterplan de cada empreendimento com recorte por dono: o lote das outras glebas aparece em cinza escuro, sem nome e sem valor",
            ],
            screen: "Portal (CRM - Vendas - Carteira - Mapa)",
          },
        ],
      },
      {
        module: "Setup",
        screens: [
          {
            items: [
              "Tela nova Incorporadores: criar o portal, marcar os empreendimentos (com a chave de carteira administrada), e gerenciar as contas de acesso de cada incorporador",
              "Mudanca feita no Setup vale no proximo carregamento do portal, sem precisar sair e entrar de novo",
            ],
            screen: "Incorporadores",
          },
        ],
      },
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O valor VENCIDO da carteira estava zerado nas unidades com boleto emitido pela integracao: corrigido aqui e no Hades (a integracao pre-preenche o valor pago ao emitir o boleto, e a conta abatia isso sem conferir se houve pagamento)",
            ],
            screen: "Empreendimento - Carteira",
          },
        ],
      },
    ],
    rollback: "v1.150.0 (2026-08-17-corretor-avisado-e-habilitar-sem-beco)",
    technical: {
      done:
        "Portal do incorporador reconstruido portando as telas reais do Apolo (CarteiraTab, VendasTab/kanban, CRM 360 lista+ficha) com escopo por sessao assinada (codigosDaSessao/idsDaSessao/unidadeNoEscopo/pessoaNoEscopo) e allowlist campo a campo em toda rota /api/incorporador/*. Masterplans internos novos (Lagoa Bonita 495, Vista Alegre 126, Recanto do Para 199) gerados dos SVGs do C2X pelo molde novo; recorte por escopo com quadra string e moldura interna removida do fonte. Correcoes: OUTSTANDING so abate paid_value com payment_date (apolo + guardian); camada cinza injetada no ULTIMO </body> (o primeiro era string JS do exportador e matava o app do mapa); sessao do portal revalidada no banco a cada carga com reemissao de cookie. Gestao de incorporadores movida para o Setup com secao de contas.",
      motivation:
        "Pedido do Lucas: portal padrao dos loteadores no nivel do BI que ele mesmo mantinha no Power BI, para Vista Alegre, Lagoa Bonita (LBF) e os proximos, sem afetar o portal personalizado do Cecilio.",
    },
    title: "Portal do incorporador: CRM, Vendas, Carteira e mapa, no padrao Panteon",
    type: "novidade",
    version: "1.151.0",
  },
  {
    buildTag: "2026-08-17-corretor-avisado-e-habilitar-sem-beco",
    deployedAt: "2026-08-17T21:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O CORRETOR passou a ser avisado: quando a imobiliaria e habilitada, ele recebe no WhatsApp que a imobiliaria dele o credenciou, e em quais empreendimentos",
              "Ate agora ele era o unico que nao sabia de nada: o aviso ia so para a imobiliaria e para o coordenador, e o corretor descobria quando alguem lembrava de contar",
              "Sai UMA mensagem por corretor, com todos os empreendimentos juntos",
            ],
            screen: "Apolo - Board (habilitar imobiliaria)",
          },
          {
            items: [
              "Imobiliaria que voltou para correcao pode ser habilitada DIRETO da tela de validacao: confere a ficha, marca os empreendimentos e habilita",
              "Antes, depois de reabrir a validacao o botao Habilitar nao acendia mais, porque ele so aceitava empreendimento NOVO. Nenhuma das 420 imobiliarias habilitadas conseguiria voltar por ali",
              "Antes de habilitar quem veio de correcao, a tela MOSTRA os pontos que foram apontados e pede a confirmacao de que foram resolvidos",
            ],
            screen: "Apolo - Board (validacao da imobiliaria)",
          },
          {
            items: [
              "Telefone e e-mail aparecem inteiros no painel de mensagens, sem asteriscos: e tela interna e quem esta olhando precisa conferir o numero",
            ],
            screen: "Apolo - Board (mensagens da ficha)",
          },
        ],
      },
    ],
    rollback: "41df2760 (v1.149.0)",
    technical: {
      done:
        "AVISO AO CORRETOR (pedido do Lucas: *'pode mandar mensagem para ele também, falando que a imobiliária x credenciou ele no empreendimento x'*). MEDIDO ANTES: em todo o histórico de `apolo_disparos` os destinatários do credenciamento são só `imobiliaria` e `coordenador:` — o corretor NUNCA recebeu nada. E 58 de 58 corretores de imobiliária habilitada têm telefone em `apolo_contacts`, então o disparo tem para onde ir. Nova `corretoresDaImobiliaria` (lê o vínculo entre entidades: `entity_id` = imobiliária, `related_entity_id` = corretor; erro de leitura NÃO vira lista vazia em silêncio, senão 'ninguém avisado' seria indistinguível de 'imobiliária sem corretor') e `mensagemCorretorCredenciado` (6 testes). ⚠️ UMA MENSAGEM POR CORRETOR, com TODOS os empreendimentos juntos: uma por empreendimento faria a equipe receber três seguidas quase iguais. O disparo é gravado com o `entity_id` DO CORRETOR, não o da imobiliária — é na ficha dele que o operador vai procurar quando ele disser que não recebeu. Tom de AVISO, não de parabéns: quem credenciou foi a imobiliária, a Careli só liberou. O reenvio manual NÃO espalha para a equipe (`corretoresParaAvisar` vazio por padrão). ⚠️ DOIS DEFEITOS DA REVISÃO ADVERSARIAL SOBRE O QUE SUBIU HÁ MINUTOS (v1.149.0), os dois corrigidos aqui: (a) ALTA, e era regressão nossa: `podeHabilitar` só acendia com empreendimento NOVO, então depois de 'Reabrir validação' o botão morria — medido, das 420 imobiliárias com papel `active`, as 38 que têm vínculo têm 100% deles `verified`, ou seja NENHUMA voltaria pela tela, e o rodapé da imobiliária não tem outro caminho. A rota sempre aceitou (pedido `verified` cai em `jaHabilitados` e o papel volta a `active`); era só a tela que não deixava chegar lá. Agora o botão também acende quando o papel não é `active`, que é o fluxo que o Lucas descreveu: *'seria validar a partir dessa tela, habilita, se os erros foram corrigidos, e dali ela vai para habilitada'*. (b) MÉDIA: a rota disparava o WhatsApp mesmo sem alterar UMA LINHA — `promoverPapel` fica true só com `jaHabilitados`. Com a resposta perdida (rede, timeout), a tela dizia 'o credenciamento NÃO mudou' (falso) e mantinha o botão aceso; o segundo clique mandava a mensagem de novo, agora com o texto TROCADO, porque `primeiraVez` já era false: o parceiro receberia 'seu cadastro foi aprovado' e em seguida 'você está habilitada em mais um empreendimento'. Agora o aviso só sai se `plano.habilitar + plano.novos > 0` — a trava real é do servidor, a da tela virou conveniência. CONFERÊNCIA DA CORREÇÃO (pedido: *'perguntar se os erros xyz foram corrigidos'*): o GET de `/habilitar` passou a devolver as `pendencias` da última correção, lidas de `apolo_audit_events.metadata` — a MESMA fonte que o reenvio usa, para a pergunta e a mensagem nunca divergirem — e só quando a entidade está de fato em `attention`. A tela lista os pontos e trava o botão até o operador marcar que conferiu. MÁSCARAS REMOVIDAS (*'pode tirar esses *, não precisa esconder nada no Panteon'*): `mascararTelefone`/`mascararEmail` viraram `formatarTelefone`/`formatarEmail`, que formatam sem esconder. Vale para o painel INTERNO; rota pública continua não devolvendo telefone de parceiro.",
      motivation:
        "Sequência de pedidos do Lucas na ficha da imobiliária, mais dois defeitos que a revisão adversarial encontrou no código que tinha acabado de subir.",
    },
    title: "O corretor tambem e avisado, e habilitar deixou de ter beco sem saida",
    type: "melhoria",
    version: "1.150.0",
  },
  {
    buildTag: "2026-08-17-imobiliaria-habilitada-e-status-do-whatsapp",
    deployedAt: "2026-08-17T20:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Imobiliaria ja habilitada agora aparece como CONCLUIDA: as duas bolinhas verdes e o selo Apta, em vez de continuar marcada como se estivesse em validacao",
              "Sumiu o botao Habilitar que ficava no rodape mesmo depois de habilitada, apontando para caixinhas que nao estavam na tela",
              "A habilitacao de verdade continua no painel de empreendimentos, e o botao so acende quando ha empreendimento NOVO marcado: clique repetido nao redispara mais o WhatsApp de boas-vindas",
              "Quem ja e credenciada e pede um empreendimento novo continua aparecendo aqui, com o pedido desmarcado esperando a liberacao",
              "O botao Voltar virou REABRIR VALIDACAO, com o aviso do que ele faz: na imobiliaria ele nao volta etapa, ele desfaz a habilitacao e o portal para de aceitar o CNPJ dela",
              "Recusar e Enviar para correcao agora aparecem depois de reabrir a validacao, para nao ficarem ao lado de uma ficha ja habilitada",
            ],
            screen: "Apolo - Board (imobiliaria)",
          },
          {
            items: [
              "Painel novo de MENSAGENS ENVIADAS na ficha: o que foi enviado, para quem, o telefone, a data e a hora, e se deu certo ou qual foi o erro",
              "Quando o envio falha, a tela diz o motivo em portugues (numero que nao e WhatsApp, ficha sem telefone) em vez de deixar o operador no escuro",
              "⚠️ Este canal NAO devolve confirmacao de entrega nem de leitura, e a tela diz isso: nao ha como saber se a pessoa leu. So as mensagens que saem pela Meta trazem entregue e lido",
              "Botao de REENVIAR a mensagem da situacao atual da imobiliaria, mostrando antes para quem vai. O reenvio vai so para a imobiliaria, nunca para o coordenador",
            ],
            screen: "Apolo - Board (mensagens da ficha)",
          },
        ],
      },
    ],
    rollback: "3d6aaeca (v1.148.0)",
    technical: {
      done:
        "Quatro pedidos do Lucas sobre a ficha da imobiliária habilitada, feitos por agente e revisados aqui. ETAPA VERDE: `habilitada` passou a valer `etapas.length` e não a posição 1 — com 1 ela era a etapa ATUAL (bolinha cinza numerada), com `length` a ficha entra como concluída, mesmo tratamento que a CAD `credenciado` já tinha. BOTÃO DO RODAPÉ: o do print era o avanço genérico, que só sabia mostrar 'marque abaixo os empreendimentos' apontando para caixinhas ausentes naquele ponto da trilha; saiu para imobiliária. A habilitação real é a do painel, e a regra de quando ela pode acontecer virou função pura testada (`podeHabilitar`, `empreendimentosNovos`, `tudoLiberado` em `credenciamento-etapa.ts`, 11 testes) — antes o botão continuava ativo com tudo liberado e cada clique redisparava o WhatsApp para imobiliária e coordenador. Também saíram 'Enviar ao coordenador' (que só respondia 'validação de imobiliária não passa por análise de crédito') e o 'Aprovar' genérico; 'Voltar' virou 'Reabrir validação' porque na imobiliária ele DESFAZ a habilitação, e o nome antigo escondia isso. STATUS DOS DISPAROS: nova rota `board/[id]/disparos` (GET status, POST reenvio) e `credenciamento-disparos.ts` (18 testes). ⚠️ MEDIDO ANTES DE DESENHAR: `apolo_disparos` não tem coluna de canal nem de e-mail, e os 24 disparos `relacionamento:whatsapp` estão com `wa_message_id`, `delivered_at` e `read_at` TODOS NULOS — o Evolution não devolve recibo, só o webhook da Meta preenche (302 `prevenda_cobranca` lidos comprovam o outro caminho). A tela diz isso explicitamente em vez de exibir um 'entregue' que ninguém confirmou: inventar confirmação de leitura seria pior que não mostrar. Telefone e e-mail saem mascarados. REENVIO: reusa `avisarCredenciamento*` e `telefoneDaImobiliaria([representante, empresa])` — a regra do telefone NÃO foi duplicada (é a que já custou 3 imobiliárias sem aviso, porque `\"\" ?? x` continua `\"\"`). Manda o aviso da situação ATUAL (habilitada → habilitação; correção → pedido com os motivos; recusada → recusa), e os motivos saem de `apolo_audit_events.metadata`: quando não há motivo registrado o reenvio é RECUSADO, em vez de mandar uma recusa sem dizer o que houve — que é a queixa que criou a ação de correção. 'Cadastro aprovado' vs 'mais um empreendimento' sai do histórico de disparos, não de chute. Grava `origem = reenvio:whatsapp` e evento `credenciamento_reenvio` na auditoria. MEDIDO: 418 de 440 imobiliárias estão em papel `active` + entidade `review` (é a combinação NORMAL, não defeito), 440 papéis para 440 entidades (sem duplicado, `maybeSingle` seguro), e a EDSON LUIZ BARBOSA não tem NENHUMA linha em `apolo_disparos` — foi habilitada antes do disparo existir. FICA REGISTRADO, sem correção nesta entrega: a rota `/habilitar` ainda dispara o WhatsApp mesmo quando `plano.habilitar` e `plano.novos` estão vazios; hoje quem impede é o botão da tela. Fechar no servidor muda comportamento de escrita e ficou para uma próxima, com decisão do Lucas.",
      motivation:
        "Lucas, 17/08, com print: 'a imobiliária já está habilitada e ainda fica aparecendo o campo de habilitar. Outra, se ela já está habilitada a etapa de habilitada deveria estar verde. Aqui nessa tela seria ótimo trazer os status do envio das mensagens, se foi enviado, hora, se recebeu, quem recebeu, para a gente não ficar no escuro, e um botão de reenviar a mensagem'.",
    },
    title: "Imobiliaria habilitada, e o que aconteceu com o WhatsApp dela",
    type: "melhoria",
    version: "1.149.0",
  },
  {
    buildTag: "2026-08-17-assinatura-de-quem-e-a-vez",
    deployedAt: "2026-08-17T19:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O quadro de assinaturas passou a separar o que esta COM a pessoa do que ainda depende de quem assina antes dela: coluna Assinar e coluna Aguardando",
              "A diferenca e grande: o Northon aparecia com 181 contratos a assinar e so 2 estao de fato com ele; a Nivea aparecia com 178 e nao tem nenhum",
              "Clicar em qualquer numero do quadro abre a lista de assinaturas ja filtrada por aquela pessoa e situacao, com botao de limpar",
              "O filtro de status ganhou duas opcoes: pendente e a vez dele, e pendente aguardando alguem antes",
            ],
            screen: "Apolo - Assinaturas",
          },
        ],
      },
      {
        module: "Publico",
        screens: [
          {
            items: [
              "O painel de assinatura ganhou uma versao publica, em /publico/assinaturas: abre sem login, para circular com quem nao tem conta no Panteon",
            ],
            screen: "BI de assinatura",
          },
        ],
      },
    ],
    rollback: "46a6baee (v1.147.0)",
    technical: {
      done:
        "A FILA DE ASSINATURA E ORDENADA, e o painel contava como se não fosse. `contract_signature_signers.after_position` é o degrau, e ele já vinha para a tela como `degrau` — mas o quadro somava tudo que a pessoa não tinha assinado num campo só. MEDIDO NO C2X antes de mexer: os degraus do Vale do Ouro vão de 1 a 10 e a ordem é respeitada À RISCA (0 contratos com alguém de degrau maior assinando antes de um menor), e a cadeia real é corretor (1) → comprador (2) → testemunhas do Cecílio Rocha (3) → Lino e Cecílio (4 e 5) → Gurgel e imobiliária (6) → Northon (7) → Nívea (8). Com isso, o número que o painel mostrava era inacionável: o NORTHON aparecia com 181 pendências e só 2 estavam com ele; a NÍVEA com 178 e ZERO. Cobrar por esse número é cobrar quem não pode agir. Nova `marcarSituacao(linhas)` (6 testes, com a cadeia real): por CONTRATO, acha o menor degrau ainda pendente e marca cada assinatura como `assinado` | `vez` | `aguardando`. ⚠️ QUEM DIVIDE O DEGRAU ASSINA EM PARALELO: o contrato tem dois no degrau 3 e três no 5, e nenhum trava o outro — por isso a conta é `degrau <= frente`, não `degrau === frente`. ⚠️ A FRENTE É POR CONTRATO, nunca global: calcular globalmente deixaria o Northon 'aguardando' em tudo por causa de um contrato atrasado alheio (teste próprio para isso). O clique no número do quadro preenche os filtros que JÁ EXISTIAM (usuário + status) e rola até o analítico; zero não vira botão, porque clique que leva a tabela vazia parece tela quebrada. BI PÚBLICO: nova rota `/api/publico/bi/assinaturas` (liberada UMA A UMA no proxy) e página `/publico/assinaturas`, com o MESMO componente da tela interna — só a fonte muda, via prop. Painel duplicado viraria duas verdades sobre o mesmo contrato, e a que ninguém abre é a que desatualiza. O cache de 5 min mora na lib e vale para os dois: link que circula não pode virar uma consulta ao legado por pessoa que abre. Escopo fixo no servidor (Vale do Ouro), sem parâmetro na query — rota anônima que aceita `codes` deixa qualquer um pedir a carteira de qualquer loteamento. ⚠️ REGISTRADO NO CÓDIGO E NO PROXY: ao contrário do BI público de vendas, que é só agregado, este sai com NOME E E-MAIL de quem assina (inclusive sócios do incorporador) e a unidade de cada contrato. Levantei isso antes de liberar; a decisão do Lucas foi 'só deixa público, somente isso'. A página é `noindex`, mesmo padrão de /publico/painel.",
      motivation:
        "Lucas, 17/08: 'queria que ao clicar no nome do assinante no quadro de assinaturas o analítico filtrasse... e respeitando a ordem: se falta dois ainda para chegar no Northon, não devia contar no campo assinar, poderia ter um novo campo aguardando. E outra, deixa esse BI público também'.",
    },
    title: "Assinaturas: de quem e a vez, e de quem nao e",
    type: "melhoria",
    version: "1.148.0",
  },
  {
    buildTag: "2026-08-17-lagoa-bonita-e-um-empreendimento-so",
    deployedAt: "2026-08-17T18:05:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Habilitar imobiliaria no Lagoa Bonita volta a funcionar: marcar Lagoa Bonita agora libera as tres areas de uma vez, como sempre foi a intencao",
              "Antes o botao recusava com 'Empreendimento que esta imobiliaria nao pediu', justamente sobre o empreendimento que ela tinha acabado de pedir",
              "O mesmo vale para Lavra do Ouro, Rio de Pedras e Portal dos Vales, que tem a mesma estrutura",
            ],
            screen: "Apolo - Board (habilitar imobiliaria)",
          },
          {
            items: [
              "O filtro de empreendimento passa a listar TODOS os que estao abertos a credenciamento, e nao so os que ja aparecem em algum card: o Lagoa Bonita nao aparecia porque nao tinha nenhuma CAD",
              "O card da imobiliaria agora mostra o empreendimento vindo da habilitacao dela, e nao so do texto do cadastro",
            ],
            screen: "Apolo - Board (filtro)",
          },
          {
            items: [
              "No cadastro do corretor, o CPF passou a ser a PRIMEIRA pergunta, e a consulta traz o nome completo a partir dele",
              "Antes o nome vinha primeiro e era digitado a mao, o que abre espaco para grafia diferente da base e para deixar o CPF em branco",
            ],
            screen: "Apolo - cadastro (corretores)",
          },
        ],
      },
      {
        module: "Portal do corretor",
        screens: [
          {
            items: [
              "Imobiliaria habilitada no Lagoa Bonita volta a enxergar o empreendimento na hora de enviar CAD",
              "A DANY CASTRO estava habilitada nas tres areas desde sempre e o Lagoa Bonita nao aparecia para os corretores dela",
            ],
            screen: "Envio de CAD",
          },
        ],
      },
    ],
    rollback: "24bea2e4 (v1.146.0)",
    technical: {
      done:
        "UM EMPREENDIMENTO, DOIS FORMATOS DE ID, e cada ponta comparava só um deles. O id pode ser o do GRUPO (`group:Lagoa Bonita`, que é o que o portal público grava porque lá fora não existe divisão) ou o das DIVISÕES (33/LBF, 27/LBR, 32/LBP, como o C2X conhece). Os DOIS estão gravados em produção hoje. ⚠️ ISSO QUEBRAVA OS DOIS LADOS, e nenhum formato funcionava nos dois: (a) o POST de habilitar EXPANDIA os escolhidos para as divisões e comparava contra os pedidos, que estavam no formato do grupo — `[33,27,32]` contra `[group:Lagoa Bonita]` não casa nada, e a imobiliária recebia 'Empreendimento que esta imobiliaria nao pediu: 33, 27, 32' sobre o empreendimento que tinha ACABADO de pedir (visto ao vivo pela Nívea, com o Lucas na chamada); (b) o portal público cruzava o vínculo contra a lista de empreendimentos, onde Lagoa Bonita é UM item de id `group:Lagoa Bonita` — a DANY CASTRO, `verified` nas TRÊS divisões desde sempre, não via o Lagoa Bonita, e os corretores dela não conseguiam enviar CAD. Habilitação que existe no banco e não existe na prática é pior que habilitação ausente, porque ninguém vai procurar. Expansão de um lado só era o defeito, nas duas pontas. NOVO `lib/apolo/empreendimento-equivalencia.ts` (13 testes, com os dados REAIS do C2X): `canonizador(catalogo)` traduz qualquer id para o do grupo, e `cobertoPor(emp, vinculos)` aceita vínculo em qualquer formato. Ligado nos dois pontos: o POST canoniza escolhidos E pedidos antes de comparar, e `filtrarEmpreendimentosHabilitados` passa a casar por equivalência. Nenhuma migration: os vínculos que já existem seguem valendo nos dois formatos, e os NOVOS nascem canônicos. A trava continua de pé — empreendimento que a imobiliária realmente não pediu segue recusado (teste próprio). Regra do Lucas: 'quando clicar em Lagoa Bonita, tem que habilitar todos os Lagoa Bonita' · 'para eles não tem essa de divisão, isso é interno'. FILTRO DO BOARD: o seletor se montava a partir dos cards (`itens.flatMap(...)`), então empreendimento sem nenhuma CAD não existia como opção — não havia como perguntar 'e o Lagoa Bonita?', a resposta era a ausência da pergunta. Medido: dos 8 abertos a credenciamento, o Lagoa Bonita era o ÚNICO sem card, e o único que sumia. Agora sai do catálogo (`credenciamento_ativo`), unido ao que está nos cards para não perder grafia antiga da esteira. Junto: o card da imobiliária passa a ler o empreendimento do VÍNCULO (a fonte de verdade, e a única que existe para quem veio do C2X) antes do texto do cadastro — a DANY CASTRO aparecia sem empreendimento nenhum porque `metadata.cadastro` dela é nulo. Novo `lib/apolo/catalogo-empreendimentos.ts` (7 testes) com leitura ENXUTA (`select id, code, name`) e cache de 10 min: `loadApoloEnterprises` faz `left join enterprise_unities` com dez agregações de sale_status sobre TODAS as unidades, e pendurar isso no Board (que tem refetch-on-focus) sairia caro só para saber o nome. CADASTRO DE CORRETOR: o CPF virou a primeira pergunta e a MOST traz o nome (CARELI_PF_01, basic_data). É a mesma regra que o portal público segue desde 20/07 ('o corretor digita o CPF, a MOST traz o nome completo'); no wizard interno o nome ainda era digitado à mão e o CPF vinha depois. ⚠️ CUSTO: passa a rodar DUAS queries por corretor (PF_01 para o nome + PF_04 para o CRECI), uma vez por CPF — mesmo custo que o público já paga. O que o operador digitou sempre ganha: a busca preenche o que está vazio, nunca sobrescreve. MEDIDO: 24 dos 82 corretores estão sem CPF, todos criados em maio pelo sync do C2X — as duas telas de cadastro já exigiam CPF, então o resíduo é do legado e não da entrada.",
      motivation:
        "Bug visto ao vivo (17/08): a Nívea tentando habilitar uma imobiliária no Lagoa Bonita e o botão recusando. O diagnóstico encontrou o mesmo defeito do outro lado, afetando quem já estava habilitado.",
    },
    title: "Lagoa Bonita volta a ser um empreendimento so",
    type: "correcao",
    version: "1.147.0",
  },
  {
    buildTag: "2026-08-17-log-erros-e-politica-comercial",
    deployedAt: "2026-08-17T15:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Tela nova: Log Erros mostra quem tentou enviar CAD ou se credenciar e NAO conseguiu, desde a tela do CPF ate o envio",
              "Quem conseguiu continua aparecendo no Board, como CAD na fila de validacao: aqui so entra quem ficou pelo caminho",
              "As linhas marcadas como SEM SAIDA sao as mais graves: a pessoa recebeu resposta cordial, nao viu erro nenhum, e o fluxo dela terminou ali. E o corretor cuja imobiliaria nao esta credenciada, a imobiliaria sem empreendimento liberado e o CNPJ que nao passou na portaria",
              "Tres resumos no topo: o que mais barrou, quais imobiliarias mais travam e em que passo o corretor para",
              "Filtro de 24 horas, 7 dias ou 30 dias",
            ],
            screen: "Apolo - Log Erros",
          },
          {
            items: [
              "Aba nova de Politicas Comerciais no empreendimento: mostra como o split de pagamento esta dividido no C2X, por tipo de parcela (ato, sinal da imobiliaria, sinal do corretor e mensal)",
              "A % de gestao de carteira do empreendimento passa a ser cadastrada aqui, e vale para todas as divisoes de uma vez",
              "Quando as divisoes do mesmo empreendimento tem split diferente, a tela avisa em vez de mostrar so uma: e o caso do Lagoa Bonita, onde a carteira e nossa apenas no LBF",
              "Empreendimento sem % cadastrada significa que a Careli nao administra a carteira dele",
            ],
            screen: "Apolo - Empreendimento (Politicas Comerciais)",
          },
          {
            items: [
              "A tela Importar CADs saiu do menu: a CAD nasce no proprio Apolo, pelo portal do corretor, e trazer ficha do Asana nao faz mais sentido",
            ],
            screen: "Apolo - menu",
          },
        ],
      },
      {
        module: "Portal do corretor",
        screens: [
          {
            items: [
              "A tela nao informa mais em qual imobiliaria concorrente um corretor ja esta: quando ha conflito, ela pede para falar com a central",
            ],
            screen: "Credenciamento de imobiliaria",
          },
        ],
      },
    ],
    rollback: "01adf844 (v1.145.0)",
    technical: {
      done:
        "LOG ERROS. Pedido do Lucas: 'uma imobiliaria tentou subir a CAD e deu erro, teria como ter essa visao? Tinha que pegar DESDE O INICIO, quando informa o CPF, imobiliaria'. Migration 0093 (`apolo_cad_log_erros`, RLS ligada sem policy de select: so a service role le). ⚠️ A DESCOBERTA QUE MUDOU O DESENHO: as paredes mais graves NAO sao erro HTTP. Corretor cuja imobiliaria nao esta credenciada recebe HTTP 200 com mensagem cordial; imobiliaria credenciada sem empreendimento habilitado, idem. Um log que olhasse so para status >=400 mostraria o funil saudavel enquanto a porta de entrada devolve gente todo dia. Por isso a tabela guarda DUAS naturezas, separadas por selo na tela: ERRO (>=400, a pessoa viu e pode tentar de novo) e BARREIRA (200, fluxo encerrado em silencio). Sucesso NAO entra: regra do Lucas, 'a tentativa de certo e a CAD que chega na validacao'. COMO O CONTEXTO CHEGA: sao 85 `return responder(...)` nas 14 rotas publicas, e passar o contexto em cada um seria 85 chances de esquecer — com o esquecimento SILENCIOSO (a coluna fica '—' e ninguem sabe se falta dado ou codigo). A rota chama `anotarContexto(request, {...})` assim que descobre quem e, um WeakMap por requisicao guarda, e o `responder()` le; anotar de novo ACUMULA e string vazia nao apaga o que ja se sabia. Registro via `after()` do Next, NUNCA `void promise`: na Vercel a funcao e congelada quando a resposta sai e a promessa solta nao termina — a tela mostraria 'nenhuma recusa' com o formulario quebrando na cara do corretor. ⚠️ REVISAO ADVERSARIAL (15 agentes, 5 lentes) PEGOU 7 DEFEITOS CONFIRMADOS, TODOS CORRIGIDOS: (a) VAZAMENTO DE DADO DE CLIENTE — a mensagem de conflito de nucleo familiar nomeia TERCEIRO ('o CPF do conjuge do JOAO DA SILVA ja possui CAD para o Vale do Ouro') e estava sendo gravada inteira numa tabela especificada como 'sem dado do cliente', ainda por cima no card 'o que mais barrou', que agrupa pela string e viraria lista de nomes de compradores; criado `ContextoDaTentativa.motivo`, o motivo canonico que ganha da mensagem quando ela vem de camada de negocio. (b) VAZAMENTO DE CARTEIRA DE CONCORRENTE, anterior a esta rodada: `/publico/imobiliaria/credenciar` devolvia `explicarConflitos` cru ('FULANO ja trabalha o Vale do Ouro pela Imobiliaria X') numa rota ANONIMA atras so do CNPJ — quem chutasse nomes e CPFs mapearia a rede dos concorrentes; a resposta publica virou generica e o detalhe foi para o log interno, que e onde ele ja deveria estar (a mesma regra ja estava escrita no /checar-cpf). (c) as DUAS recusas mais caras do /salvar (401 de sessao expirada e 400 sem empreendimento) saiam por `erro()` cru, fora do caminho do log — e o 401 e o corretor que preencheu a CAD toda e perdeu no envio, o caso que motivou dobrar o TTL de 45 para 90 min. (d) 429 e 503 escapavam nas 14 rotas, porque todas fazem `return preparo.response` direto: teto de uso batido e Supabase fora do ar ficavam invisiveis justo nos dois incidentes em que a tela mais precisaria falar; registro movido para dentro do `prepararRota`, um ponto so. (e) MASCARA DE CPF RECONSTRUIVEL: guardava o 9o digito e os dois verificadores, e como os DVs sao calculados dos 9 primeiros, validar os candidatos derruba o espaco de 100 mil para um punhado — era base de CPF disfarcada de mascara; agora so os 3 primeiros. (f) o insert engolia o `error` do PostgREST sem rastro, deixando 'tabela que parou de aceitar linha' indistinguivel de 'nao houve recusa'. (g) contador 'sem saida' contado sobre a pagina truncada e exibido na mesma frase que o total do periodo, dois denominadores lado a lado sugerindo uma proporcao que nao existia. Ainda: `imobiliaria_entity_id` validado como uuid antes do insert (um id fora de formato derrubaria a LINHA INTEIRA, nao so o campo), e o GET passou a selecionar o CNPJ mascarado — sem ele a coluna 'Quem' ficaria vazia no fluxo inteiro de credenciamento, que e onde o Lucas viu o problema. POLITICA COMERCIAL. Migration 0092 (`gestao_carteira_percentual`). Precedencia definida pelo Lucas: 'toda parte financeira, enquanto nao migramos tudo para o Apolo, o C2X tem prioridade; o que vai nascer ja no Apolo e a % da gestao de carteira'. A fonte da gestao mudou tres vezes ate assentar no `split_enterprises`: so ha gestao quando existe linha 'Gestora de recebiveis' no grupo Mensal (os `10+10` de `commercial_policies` eram campo morto). O PATCH grava todas as divisoes numa chamada e relata o que ja gravou se falhar no meio — a tela fazia um PATCH por divisao, e uma falha na segunda deixaria a Lagoa Bonita com uma gleba em 97% e outra em 96%, exatamente o que 'uma % por empreendimento' proibe. ⚠️ A ABA ELEGIA `politicas[0]` como referencia e apresentava o veredito como do empreendimento inteiro: se o banco devolvesse o LBR primeiro, a tela AFIRMARIA 'a Careli nao administra a carteira deste empreendimento' sobre um empreendimento onde administramos. Consolidado pela regra do negocio (se ALGUMA divisao tem gestao, o empreendimento tem) e com aviso explicito quando as divisoes divergem. NAO ENTRA NESTA ENTREGA, e fica registrado: `liquido-incorporador.ts` esta pronto e testado mas SEM NENHUM CHAMADOR, entao gravar a % ainda nao muda tela alguma — ela so ganha funcao quando a Carteira do portal do incorporador existir. ASANA: tela removida do menu e o bloco (6 arquivos) apagado, mas o BACKEND fica de pe de proposito — `lib/apolo/asana-import.ts` tambem alimenta o diagnostico de CAD, o backfill de empreendimento e o relatorio das imobiliarias. A tela ativa do Apolo e persistida no localStorage, entao quem estivesse em 'Importar CADs' abriria o Apolo EM BRANCO; `telaValida()` faz a tela salva que nao existe mais cair no CRM.",
      motivation:
        "Lucas, 17/08: 'queria registrar os erros de input de CAD... uma imobiliaria tentou subir a CAD e deu erro, teria como ter essa visao? Tinha que pegar desde o inicio, quando informa o CPF, imobiliaria. A tela pode ser Log Erros.' E, sobre a politica: 'no cadastro do empreendimento podemos trazer a aba politicas comerciais, e la registrar o valor de comissao, bem como o valor da gestao de carteira'.",
    },
    title: "Log Erros: quem tentou cadastrar e nao conseguiu",
    type: "novidade",
    version: "1.146.0",
  },
  {
    buildTag: "2026-08-17-validacao-imobiliaria-tres-acoes",
    deployedAt: "2026-08-17T09:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A validacao da imobiliaria passou a ter TRES acoes: validar, enviar para correcao e indeferir",
              "CORRECAO e a novidade: quando falta um documento ou veio o arquivo errado, a imobiliaria recebe o que precisa ajustar e o cadastro dela continua de pe, sem ser recusado",
              "Ela fica na coluna Em correcao ate resolver, e quando voltar e so habilitar",
              "Quem foi recusada e regularizou pode ser reaberta e volta para a fila de validacao",
              "Os motivos sugeridos na correcao agora sao de documento de empresa, comecando pelo mais comum: enviou o Cartao de CNPJ no lugar do contrato social",
            ],
            screen: "Apolo - Board (validacao da imobiliaria)",
          },
          {
            items: [
              "O card da imobiliaria para de sumir da tela: habilitada, em correcao ou recusada, ela continua visivel na coluna certa, inclusive depois de atualizar a pagina",
              "A ficha da imobiliaria ja habilitada abre mostrando que ela esta apta, e nao mais em Validacao",
              "Sumiu a mensagem sobre CAD na esteira, que nao fazia sentido para imobiliaria: ela nao tem CAD, e ela quem cadastra os compradores",
              "Quando todos os empreendimentos ja estao liberados, a tela diz isso, em vez de travar o botao sem explicar",
            ],
            screen: "Apolo - Board (imobiliarias)",
          },
        ],
      },
    ],
    rollback: "911a946d (v1.144.2)",
    technical: {
      done:
        "REGRA DO LUCAS (17/08): a validacao de imobiliaria tem TRES decisoes, nao duas. Faltava CORRECAO, e a falta dela tem custo medido: a Beatriz Teodora levou TRES indeferimentos por ter enviado o Cartao de CNPJ no lugar do contrato social — um caso de pendencia, tratado como recusa porque nao havia outra opcao. ONDE O ESTADO MORA: `apolo_entity_profiles.status` so aceita active|review|blocked|archived, entao nao ha valor para 'em correcao' la; `apolo_entities.status` aceita `attention`, que significa exatamente 'aguardando acao de fora'. Correcao grava entidade `attention` com o PAPEL AINDA EM `review` (ela nao foi aprovada nem recusada), sem migration. Nova `mensagemImobiliariaCorrecao` (6 testes) com tom de pedido, nao de recusa, e `MOTIVOS_CORRECAO_IMOBILIARIA` proprios — os de CAD (comprovante de endereco, documento do socio) sao de comprador. O COORDENADOR NAO recebe aviso de correcao, de proposito: ele precisa saber quem foi habilitado e quem foi recusado, mas pendencia de documento e assunto entre a Careli e o parceiro. Nova acao `reabrir` para quem regularizou. A IMOBILIARIA NAO VAI MAIS PARA A ESTEIRA em caminho nenhum: so `indeferir` tinha sido desviado, e reabrir/avancar/voltar/correcao/enviar-ao-coordenador continuavam chamando `moverEtapa`, que grava em `apolo_esteira` — onde ela nao tem linha (435 de 435) — e devolvia 409 pedindo 'informe o empreendimento no cadastro' a quem valida uma EMPRESA. ⚠️ A REVISAO ADVERSARIAL SOBRE A FRENTE INTEIRA pegou 6 defeitos, dois deles no codigo desta mesma rodada: (a) a perna nova da fila filtrava por `updated_at`, que NINGUEM carimbava — a tabela nao tem trigger e o default `now()` so vale no INSERT, entao o filtro significava 'cadastrada ha 30 dias' e a imobiliaria em correcao sumiria da tela ainda esperando resposta; carimbado nas tres transicoes. (b) `enviarParaRevisao` seguia sem desvio, e revisao e o desvio do credito reprovado da CAD, que imobiliaria nao tem. (c) na aba Todos o kanban nao tem coluna 'habilitada', entao o card era DESCARTADO sem entrar em lista nem badge; a coluna passa a entrar ao lado de Credenciado quando ha imobiliaria na lista. (d) `progresso` vinha da esteira e ficava 0 para sempre: a ficha habilitada abria em 'Validacao', sem selo de apta, e o botao Voltar (disabled quando etapa 0) nunca ficava clicavel. (e) o botao Habilitar continuava ativo com tudo ja liberado, e cada clique redisparava o WhatsApp de boas-vindas para imobiliaria e coordenador. (f) indeferir nao devolvia a entidade para `review`, entao indeferir depois de habilitar fazia o card sumir em vez de ir para Recusada. Ainda: orientacao deixou de sair na tarja vermelha de erro e virou aviso neutro. ✅ REGRA CONFIRMADA E DOCUMENTADA NO CODIGO: imobiliaria cadastrada pelo WIZARD INTERNO nasce credenciada de proposito — 'cadastro feito pelo operador vale ja como validacao'. Os portais PUBLICOS rebaixam (papel review, vinculos pending) porque la quem preenche e a propria imobiliaria. A diferenca entre os caminhos e QUEM preencheu; a revisao apontou isso como defeito e nao e.",
      motivation:
        "Lucas: 'temos que ter 3 acoes em validacao de imobiliaria: validar, correcao, indeferimento. Essa correcao e o status que deveria ter acontecido com a Beatriz: ela mandou um documento errado, eu preciso avisar ela sobre a pendencia, ela vai para correcao e quando corrigir eu habilito'.",
    },
    title: "Validacao de imobiliaria: validar, corrigir ou indeferir",
    type: "novidade",
    version: "1.145.0",
  },
  {
    buildTag: "2026-08-16-boas-vindas-no-telefone-certo",
    deployedAt: "2026-08-16T05:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A imobiliaria habilitada volta a receber a mensagem de boas-vindas: hoje tres foram liberadas e nenhuma foi avisada, mesmo tendo celular no cadastro",
              "Quando a imobiliaria nao tem representante legal na ficha (as que vieram do sistema antigo), o aviso sai pelo telefone da empresa",
            ],
            screen: "Apolo - credenciamento de imobiliaria",
          },
        ],
      },
    ],
    rollback: "cf6bde9e (v1.144.1)",
    technical: {
      done:
        "MEDIDO EM 16/08: `credenciamento_aprovado` com 3 de 3 falhas e erro `sem telefone` (DANY CASTRO, F M S MACIEL, HRQ NEGOCIOS), enquanto `credenciamento_coordenador`, disparado no mesmo segundo, saiu 3 de 3. A habilitacao em si funcionou — papel `active` e vinculos `verified`, as tres ja podiam enviar CAD —, so o aviso nao saiu. **As tres tinham celular em `apolo_contacts` o tempo todo.** DUAS CAUSAS SOMADAS: (1) na rota publica o plano B do telefone era `corpo.telefone`, que so existe no CADASTRO NOVO — no fluxo de habilitacao o corpo traz apenas corretores e empreendimentos, entao nao havia plano B nenhum; e (2) `normalizarTelefone(undefined)` devolve STRING VAZIA e o `??` **nao troca string vazia**, so null/undefined, entao `\"\" ?? contato` continuava vazio e o codigo nem chegava a olhar o contato da empresa. Agrava que as fichas vindas do C2X nao tem `socios[]`, e para elas o representante legal simplesmente nao existe: o contato da empresa era a UNICA fonte. Criado `telefoneDaImobiliaria(fontes[])` em `disparo-credenciamento.ts`, que percorre as fontes na ordem (representante > empresa > corpo) e **pula vazio**, devolvendo null quando nao ha nenhuma — ligado nos tres pontos de disparo (habilitar, indeferir e a rota publica), que antes repetiam a regra com `??` cada um a seu modo. +7 testes, incluindo o caso exato desta falha. ⚠️ FICA REGISTRADO, sem correcao nesta entrega: `imob_pix_enviado`, `imob_pix_pago` e `prevenda_cobranca` estao em 100% de falha na medicao de 60 dias, mas pararam de rodar em 29-30/07 — ou foram desligados, ou quebraram e ninguem percebeu.",
      motivation:
        "Varredura dos disparos por central (pedido do Lucas: comunicado de imobiliaria, corretor e coordenador sai pelo Relacionamento) encontrou a falha acontecendo no mesmo dia.",
    },
    title: "Boas-vindas da imobiliaria saem no telefone certo",
    type: "correcao",
    version: "1.144.2",
  },
  {
    buildTag: "2026-08-15-correcoes-do-credenciamento",
    deployedAt: "2026-08-15T20:15:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A imobiliaria recusada continua na coluna Recusada depois de atualizar a pagina; antes ela voltava para Validacao e parecia que a recusa nao tinha sido gravada",
              "O telefone corrigido na ficha passa a valer para os avisos: antes a tela mostrava o numero novo e a mensagem saia para o antigo",
            ],
            screen: "Apolo - Board (validacao da imobiliaria)",
          },
          {
            items: [
              "No portal externo, quando algo impede a habilitacao (falta o CPF de um corretor, conflito de corretor, sessao expirada), agora tem o botao Corrigir e tentar de novo, mantendo o que ja foi preenchido",
              "O CPF do corretor e cobrado na propria tela, em vez de so recusar depois de enviar",
              "Os corretores informados sao gravados mesmo quando a imobiliaria ja trabalhava aquele empreendimento",
              "Habilitar pelo Board voltou a funcionar para as imobiliarias que estao esperando validacao, nao so para as ja credenciadas",
            ],
            screen: "Apolo - credenciamento de imobiliaria",
          },
        ],
      },
    ],
    rollback: "d1dfd057 (v1.144.0)",
    technical: {
      done:
        "Patch dos 7 achados que a SEGUNDA revisao adversarial confirmou sobre as correcoes da v1.144.0, mais os 2 que apareceram em producao no mesmo dia (imobiliaria Beatriz Teodora). CAUSA COMUM DOS DOIS INCIDENTES: a v1.144.0 moveu a gravacao da ficha para `metadata.cadastroEditado` para a correcao humana nao ser encoberta pelo C2X, mas **so o GET do Board aprendeu a ler essa camada**. `representanteDaImobiliaria` (que escolhe o telefone do disparo), a cascata do CRM e o envio ao C2X seguiam lendo `metadata.cadastro`: o Lucas corrigiu o telefone do representante, a tela passou a mostrar o numero novo e a mensagem de indeferimento saiu DUAS VEZES para o numero antigo, recusada pelo Evolution com `exists:false`. Criado `lib/apolo/cadastro-efetivo.ts` (4 testes) e ligado nos tres leitores. A REVISAO TINHA PREVISTO ISSO — o achado estava na lista antes de o caso acontecer. SEGUNDO INCIDENTE: o card recusado voltava para Validacao a cada F5, porque a coluna da imobiliaria saia de `apolo_esteira.etapa` e ela **nao tem linha na esteira** (435 de 435); a decisao estava em `apolo_entity_profiles.status` e a tela nunca lia esse campo. A fila passou a devolver `papelStatus` (em lotes de 100, o `.in()` estoura a URL) e o Board usa: blocked=Recusada, active=Habilitada. A Beatriz foi indeferida TRES vezes por causa disso. OS OUTROS ACHADOS: (a) a tela de erro do portal EXTERNO era um beco sem saida — `habilitacao` truthy fazia a guarda do passo dos corretores nunca mais valer e nada zerava o estado, entao a imobiliaria perdia empreendimento, CNPJ e equipe e so saia recarregando; e o caminho ficou alcancavel justamente pela correcao da guarda. Vale para 400, 409, 401 e 429, que sao desfechos PROJETADOS. (b) `pendentePorEnterprise` filtrava `!== 'verified'`, o que varria junto `blocked` e `archived`: numa rota PUBLICA, quem soubesse o CNPJ ressuscitaria um vinculo bloqueado de proposito — agora so `pending` sobe, e bloqueado devolve 409 explicando. (c) a expansao de grupo em stageIds estava dentro do `if (jaCredenciada)`, entao o botao do Board seguia devolvendo 400 para as 16 paradas em review. (d) o atalho `ja-habilitada` respondia 200 e DESCARTAVA os corretores digitados — caso comum, porque a vitrine do portal externo pede o empreendimento antes do CNPJ e nao filtra o que ela ja trabalha. (e) insert duplicado em `apolo_entity_identifiers` (indice unico) derrubava o salvamento de uma ficha que JA tinha gravado. (f) a trava de host do anexo tinha sido aplicada so no caminho Meta; o de grupos seguia com `includes`. (g) `resumoDaHabilitacao` nao contava `novos` e respondia 'nenhum empreendimento habilitado' logo depois de criar dois.",
      motivation:
        "Relato do Lucas em producao: 'reprovamos a Beatriz Teodoro e ela nao recebeu mensagem nenhuma' e, depois, 'mesmo indeferindo ela nao foi para recusada'. Os dois viraram achados confirmados da revisao adversarial da v1.144.0.",
    },
    title: "Correcoes do credenciamento: recusa que fica, aviso no telefone certo e saida para o erro",
    type: "correcao",
    version: "1.144.1",
  },
  {
    buildTag: "2026-08-15-cadastro-editavel-e-anexo-60mb",
    deployedAt: "2026-08-15T19:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O botao Editar agora abre TODO o cadastro da imobiliaria: dados da empresa, socios e corretores",
              "Da para corrigir o telefone do representante legal, que e justamente para onde saem os avisos do credenciamento",
              "Antes nada disso salvava: o Salvar respondia erro e voltava sem gravar, mesmo nos campos que pareciam liberados",
              "O telefone e o e-mail corrigidos passam a valer tambem para os disparos, nao so na tela",
            ],
            screen: "Apolo - Board (validacao da imobiliaria)",
          },
          {
            items: [
              "Imobiliaria que ja e credenciada consegue se habilitar num empreendimento novo pelo portal externo: antes a tela parava e nao criava o vinculo",
              "Ela informa os corretores que vao trabalhar aquele empreendimento e ja sai habilitada, com a mensagem de boas-vindas",
              "O portal interno passou a gravar de verdade: o botao trocava de tela sem registrar nada",
              "As mensagens saem nos dois caminhos, externo e interno",
            ],
            screen: "Apolo - credenciamento de imobiliaria",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O anexo subiu de 3MB para 60MB",
              "Arquivo grande vai direto para o armazenamento, sem passar pela tela, entao nao trava mais no meio",
            ],
            screen: "Iris - conversa",
          },
        ],
      },
    ],
    rollback: "2290ea55 (v1.143.0 credenciamento de imobiliaria)",
    technical: {
      done:
        "⚠️ REVISAO ADVERSARIAL ANTES DO DEPLOY encontrou 12 defeitos que typecheck, 784 testes, lint e build passaram por cima; todos corrigidos e listados no fim. 1) EDITAR A FICHA DA IMOBILIARIA NAO SALVAVA NADA. Duas travas empilhadas: na tela, campo sem `chave` cai no ramo de leitura (`!editando || !campo.chave`) e o bloco inteiro de dados da empresa vinha como `{ label, valor }` puro; no servidor, o `PATCH /api/apolo/board/[id]` so sabia gravar em `apolo_esteira.ficha` e devolvia **409** sem achar a linha. **Medido: das 435 entidades com papel `imobiliaria`, ZERO tem linha em `apolo_esteira`** — esteira e CAD de PESSOA num empreendimento. Ou seja, nem telefone e e-mail (que ja tinham chave) gravavam, e consertar so a tela daria input habilitado que nao salva. Sem esteira, agora grava em `apolo_entities.metadata.cadastro`, que e a base que o GET ja le (`metadata.cadastro` < C2X < esteira) — so cai ai quando nao existe esteira para ganhar dele, entao PF com CAD segue igual. O `metadata` e reescrito INTEIRO no update: leitura e merge em dois niveis para nao derrubar `bornRole`. TELEFONE E E-MAIL VAO TAMBEM PARA `apolo_contacts` via `atualizarContatoDoContato` (que grava `value` e `normalized_value` juntos): a tela mostra o cadastro por cima do contato, entao gravar so no metadata deixaria a TELA certa e o DISPARO errado, mandando a mensagem para o numero velho. Socio e corretor moram em ARRAY e nao tem chave plana: usam chave com caminho (`socios.0.telefone`, `socios.0.endereco.cep`) e `expandirCamposComCaminho` (`lib/apolo/campos-aninhados.ts`, 9 testes) reagrupa no array inteiro antes de enviar — mandar a chave com ponto crua criaria um campo literal `\"socios.0.telefone\"` ao lado do array e a tela seguiria mostrando o valor velho. Indice inexistente e descartado, nao repassado. 2) O TESTE DO LUCAS (Raiane Oliveira / Jardim das Gerais) falhava nos DOIS portais: no externo, `/publico/imobiliaria/iniciar` respondia `ja-credenciada` e encerrava, sem chegar na rota que cria o vinculo (agora devolve uma pre-sessao assinada e segue para informar corretores); no interno, o botao era `onClick={() => setEtapa(\"enviado\")}`, so trocava de tela. O `credenciar` passou a aceitar o CNPJ da PRE-SESSAO (assinado, nao pode ser trocado pelo corpo) e a exigir razao social/e-mail/telefone so no cadastro NOVO. 3) ANEXO 60MB: o teto de 3MB nao era escolha — o arquivo viajava em base64 dentro do JSON e a **Vercel corta o corpo de qualquer requisicao serverless em 4,5MB** (base64 infla ~33%). Rota nova `/api/iris/media/upload-url` assina o upload direto para o Supabase Storage e so a referencia volta; o caminho e montado no servidor, nunca vem do cliente (com path livre daria para sobrescrever midia de outra conversa). Mesmo padrao ja em producao no Hermes, Prometeu e cadastro do Apolo. ── OS 12 DEFEITOS PEGOS NA REVISAO (nenhum aparecia no gate): (a) o passo dos corretores do portal EXTERNO era INALCANCAVEL — a guarda `if (!preSessao && !habilitacao)` devolvia o portao de novo, porque quem ja e credenciada so recebe `tokenHabilitacao`; o beco sem saida tinha andado uma tela, so isso. (b) o botao do portal INTERNO devolvia 400 em 100% dos casos: ele manda os empreendimentos que ela AINDA NAO trabalha, e a rota so promovia vinculo existente — `planejarHabilitacao` ganhou `ativos`/`novos` (+4 testes, 12 no total) e a rota passou a CRIAR o vinculo ja verified, expandindo grupo em stageIds; a trava do corretor, as mensagens e as contagens tambem passaram a cobrir os novos. (c) `escrita-contato.ts` gravava `status: 'active'`, que **nao existe no CHECK** de apolo_contacts (verified|pending|attention|blocked) nem no de apolo_relationships — o insert falhava SEMPRE, e o `update({is_primary:false})` que roda ANTES ja tinha zerado o contato principal: a entidade ficava sem telefone principal e o disparo caia no numero antigo. Mesmo bug ja corrigido em prevenda-fluxo.ts (v1.115.0); esta funcao nunca tinha sido exercitada porque a escrita do cockpit ficou pronta sem UI. (d) a falha do contato voltava como `{ auditoria, ok: true }`: resposta 200, tela dizendo 'salvo', ninguem lendo esse campo. (e) gravar em `metadata.cadastro` colocava a correcao ABAIXO do C2X no merge do GET, e o C2X manda em creci, dataAbertura, dataAtualizacaoCadastral e no endereco — o operador corrigiria o CRECI e o valor velho voltaria no F5; agora existe `metadata.cadastroEditado`, aplicado POR ULTIMO. (f) razao social e CNPJ editaveis derrubavam a rodada INTEIRA: viajam pela rota de identidade, que recusa com 409 toda ficha espelho do C2X (**medido: 417 das 435 imobiliarias sao espelho**), e em `salvarTudo` a identidade vai primeiro e da throw — voltaram a ser leitura. (g) nome fantasia so no metadata enquanto o CRM le `apolo_entities.trade_name`. (h) a trava do corretor era contornavel DEIXANDO O CPF EM BRANCO (o conflito e apurado por CPF) e ficava cega acima de 2000 vinculos verified — CPF virou obrigatorio e o filtro foi para o banco. (i) vinculo `pending` contava como 'ja habilitada': tela de sucesso falsa e corretores descartados — agora o pendente e PROMOVIDO. (j) insert dos corretores sem checar erro. (k) na Iris, o `url` nao era copiado para `outboundMedia`: o cliente recebia o anexo grande e a conversa ficava SEM ele; e havia uma faixa morta entre ~2,86MB e 3MB (base64 infla 4/3 e o teto do data URL e 4.000.000 de caracteres) onde o documento nao ia por nenhum dos dois caminhos — o limite inline caiu para 2,5MB. (l) a trava 'so URL do nosso bucket' era um `includes('/iris-media/')`, que aceita QUALQUER dominio com esse trecho no caminho; agora exige https + host do nosso Supabase. Ainda: auto-aprovacao publica passou a exigir a pre-sessao assinada, e a auditoria comparava com `String()`, que devolve '[object Object]' para todo array — edicao de socio nunca virava linha.",
      motivation:
        "Lucas, testando o credenciamento: 'fui testar a imobiliaria Raiane Oliveira, fiz habilitacao para trabalhar o Jardim das Gerais, mesmo aparecendo a mensagem nao criou o vinculo' e 'temos que poder editar os dados do cadastro todo das imobiliarias, tudo tem que ser editavel quando eu clico em Editar'. E: 'aumenta por favor para 60MB o limite de anexo dentro da iris, hoje esta 3, nao da para nada'.",
    },
    title: "Cadastro da imobiliaria editavel, credenciamento nos dois portais e anexo de 60MB",
    type: "correcao",
    version: "1.144.0",
  },
  {
    buildTag: "2026-08-15-credenciamento-imobiliaria",
    deployedAt: "2026-08-15T18:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Aprovar a imobiliaria no Board voltou a funcionar: o botao Habilitada dava erro e nao gravava nada",
              "Ao validar, agora aparecem os empreendimentos que ela pediu, e voce marca quais libera",
              "Recusar tambem funciona, com o motivo em caixinhas de selecao",
              "16 imobiliarias estavam paradas desde 11/08 sem conseguir enviar CAD",
            ],
            screen: "Apolo - Board (validacao da imobiliaria)",
          },
          {
            items: [
              "Ao habilitar, o representante da imobiliaria recebe a confirmacao no WhatsApp, pelo numero do Relacionamento",
              "Cada coordenador recebe o aviso dos empreendimentos que sao dele",
              "A mensagem muda conforme o caso: quem chega agora recebe boas-vindas de credenciamento; quem ja trabalha com a gente recebe o aviso do empreendimento novo",
              "Se o cadastro for recusado, a imobiliaria recebe os motivos e o caminho para retomar",
            ],
            screen: "Apolo - avisos do credenciamento",
          },
          {
            items: [
              "Imobiliaria que ja tem cadastro e so quer trabalhar um empreendimento novo nao passa mais pela fila de validacao: e liberada na hora",
              "Um corretor nao pode trabalhar o mesmo empreendimento por duas imobiliarias diferentes",
            ],
            screen: "Apolo - credenciamento",
          },
        ],
      },
    ],
    rollback: "df35c44d (v1.142.0 envio instantaneo da Iris)",
    technical: {
      done:
        "CAUSA RAIZ: o Board desenha a trilha da imobiliaria como `cadastro -> habilitada`, mas `ETAPAS_ESTEIRA` so conhece as etapas da CAD — o clique devolvia **400 'Etapa invalida.'**. E indeferir devolvia **409** pedindo para 'informar o empreendimento no cadastro' de uma empresa que nao tem CAD, porque `atualizarEtapa` exige linha em `apolo_esteira`, cuja PK `(entity_id, enterprise_id)` nao aceita nulo. Imobiliaria NAO passa pela esteira: rota propria `/board/[id]/habilitar` (GET lista o pedido, POST habilita/indefere) mexendo onde o portal do corretor le — papel `active` (dados.ts:218) e vinculos `verified` (dados.ts:~265). Ordem das escritas: empreendimentos ANTES do papel, senao o CNPJ valeria com zero empreendimento liberado. DISPARO pelo EVOLUTION (numero do Relacionamento), nao pela Meta: `sendEvolutionDirectText` e novo, o gateway so tinha envio para grupo. Telefone e o do REPRESENTANTE LEGAL (`metadata.cadastro.socios[]` com flag `representanteLegal`), nao o da empresa — medido: 16/16 tem celular pelo representante contra 15/16 pela empresa, porque varios cadastraram FIXO. Coordenador sai de `players.coordenador_vendas` do C2X, AGRUPADO (quem cuida de 3 produtos recebe 1 mensagem, nao 3). Trava do corretor barra no momento da habilitacao com 409 nomeando os conflitos. Imobiliaria ja credenciada passou a ser habilitada direto pelo portal (vinculo nasce `verified`), com auditoria `automatico: true`. ⚠️ 4 bugs que o typecheck NAO pegaria e o banco pegou: `rejected` nao existe no CHECK do papel (era `blocked`); `apolo_disparos` nao tem coluna `canal` e `origem` e NOT NULL; `apolo_enterprise_settings` nao tem `name`; e o GET nasceu sem `authorizeApoloRead`. +25 testes (aprovacao, mensagens, trava).",
      motivation:
        "Relato do Lucas: 'mesmo aprovando o cadastro da imobiliaria nao esta indo para habilitacao e com isso a imobiliaria fica sem poder subir CAD'.",
    },
    title: "Credenciamento de imobiliaria: aprovar voltou a funcionar, e agora avisa",
    type: "correcao",
    version: "1.143.0",
  },
  {
    buildTag: "2026-08-15-iris-envio-instantaneo",
    deployedAt: "2026-08-15T17:20:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A mensagem que voce envia aparece na conversa na hora, sem esperar a confirmacao do WhatsApp",
              "Antes ela so surgia depois que o WhatsApp respondia, o que levava 2 segundos na maioria das vezes e passava de 3 em uma a cada sete",
              "Se o envio falhar, o texto volta para o campo de digitacao, do jeito que ja era, para voce corrigir e mandar de novo",
            ],
            screen: "Iris - conversa",
          },
        ],
      },
    ],
    rollback: "de135c46 (v1.141.1 legenda das centrais)",
    technical: {
      done:
        "A mensagem otimista JA EXISTIA em `sendMessage`, mas era usada so como plano B quando o servidor nao devolvia a linha, ou seja, nunca no caminho feliz: a tela esperava o round-trip inteiro (token + rota + Meta + gravacao). Medida de producao no 4143: 2,17s de mediana, 15% acima de 3s. Agora ela entra ANTES do fetch e `handleLocalMessageSettled` reconcilia depois, trocando a local (id `local-…`) pela real — a uniao historico+snapshot e por ID, entao sem essa troca a mensagem apareceria duas vezes. ⚠️ ARMADILHA QUE ISSO ABRIA: `shouldRepairOutboundMessage` reenvia toda outbound `queued` sem externalMessageId, e a otimista casa com o criterio exato; o id dela entra em `repairingOutboundMessageIds` para o reparo pular, senao o CLIENTE receberia a mensagem duas vezes. `sending` continua ligado de proposito, como trava de duplo clique. Em caso de falha o balao sai da tela e o texto volta ao composer, preservando o comportamento anterior.",
      motivation:
        "Relato do time de que a Iris demora. Esta e a metade do problema que nao depende de RLS; a recepcao (realtime) espera o ajuste dos vinculos de acesso.",
    },
    title: "A mensagem enviada aparece na hora",
    type: "melhoria",
    version: "1.142.0",
  },
  {
    buildTag: "2026-08-15-iris-rotulo-centrais",
    deployedAt: "2026-08-15T16:55:00-03:00",
    // Ajuste de rotulo no mesmo dia da entrega: quem le o painel ja viu as centrais na
    // v1.141.0, e uma entrada nova so para trocar duas linhas de texto poluiria.
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Relacionamento passou a dizer 'Corretor e imobiliaria', sem 'parceiro'",
              "Gurgel passou a dizer 'Comercial'",
            ],
            screen: "Iris - Board",
          },
        ],
      },
    ],
    rollback: "75eea601 (v1.141.0 Gurgel como terceira central)",
    technical: {
      done:
        "So `IRIS_CENTRAL_DESCRICAO` em lib/centrais.ts, que alimenta a legenda das abas do Board e o texto entre parenteses do select do Setup. As duas trocas andam juntas: o 'parceiro' que morava no Relacionamento ERA a Gurgel, que virou central propria na 0090.",
      motivation:
        "Pedido do Lucas ao ver a tela: tirar 'parceiro' do Relacionamento e a Gurgel virar 'Comercial'.",
    },
    title: "Legenda das centrais",
    type: "melhoria",
    version: "1.141.1",
  },
  {
    buildTag: "2026-08-15-iris-central-gurgel",
    deployedAt: "2026-08-15T16:40:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O numero da Gurgel virou central propria: agora sao tres subtelas no Board, Atendimento, Relacionamento e Gurgel",
              "O atendimento da Gurgel saiu de dentro do Relacionamento e passou a ter tela so dele",
              "Quem trabalha na Gurgel ja enxerga a central, sem precisar de ajuste no Setup",
              "No Setup, o campo Central da fila passou a listar as tres opcoes",
            ],
            screen: "Iris - Board",
          },
        ],
      },
    ],
    rollback: "0938ec3d (v1.140.0 duas centrais)",
    technical: {
      done:
        "Migration 0090, aplicada: `metadata.central = 'gurgel'` na fila `gurgel` (sai do Relacionamento, onde a 0087 a tinha posto) e no canal `whatsapp-gurgel`. A ordem das centrais virou uma lista unica, `IRIS_CENTRAIS` em lib/centrais.ts, que alimenta as abas do Board E o select do Setup: central nova aparece nos dois sem alguem lembrar de editar dois lugares. Icone: o predio (Building2) foi para a Gurgel, onde diz o que precisa dizer (a central e de UMA empresa). A 0090 acrescenta uma trava que faltava na 0087: alem de barrar fila sem central, agora barra fila com central INVALIDA — um typo ('gurguel') passava batido e fazia a fila sumir de todas as subtelas, porque a tela casa o valor exato. Estado: Atendimento 9 filas/89 abertos, Relacionamento 6/60, Gurgel 1/3.",
      motivation:
        "Pedido do Lucas: o telefone da Gurgel vira central propria, ficando Atendimento, Relacionamento e Gurgel.",
    },
    title: "Gurgel virou a terceira central",
    type: "novidade",
    version: "1.141.0",
  },
  {
    buildTag: "2026-08-15-iris-centrais-subtelas",
    deployedAt: "2026-08-15T16:15:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O Board virou a tela principal, com duas subtelas no topo: Atendimento e Relacionamento",
              "Cada subtela mostra so as abas que fazem sentido nela: Grupos aparece no Relacionamento, e sumiu do Atendimento onde nunca teve nada",
              "A aba 'Atendimento' de dentro do Board virou 'Conversas', para nao repetir o nome da central logo acima",
              "A subtela que voce nao esta vendo mostra quantas conversas tem sem ler, entao da para perceber movimento do outro lado",
              "O icone do Relacionamento virou um aperto de mao, que faz par com o fone do Atendimento",
            ],
            screen: "Iris - Board",
          },
        ],
      },
    ],
    rollback: "0fe42143 (v1.139.0 seletor de central na barra lateral)",
    technical: {
      done:
        "Decisao do Lucas ao ver a v1.139.0: 'board poderia ser a tela principal, ae teria duas subtelas, atendimento e relacionamento'. O seletor saiu da sidebar (`IrisModuleShell` voltou ao contrato antigo) e virou `IrisCentralTabs` no topo do kanban, acima das abas de canal, o que resolve dois problemas que a versao anterior criou: a palavra 'Atendimento' aparecia como central E como aba, e na sidebar recolhida os dois blocos de icone viravam uma coluna so. `abasDaCentral()` define quais abas cada central mostra, e `abaEfetiva` cai na primeira aba valida quando a aba persistida nao existe na central escolhida (senao quem estava em Grupos e trocasse para Atendimento veria tela vazia). A contagem de nao lidas por central le o `IrisData` BRUTO de proposito: com o dado ja recortado, o outro lado seria sempre 0. ⚠️ ACHADO PELO CONFERIDOR MANUAL: havia uma SEGUNDA chamada de `ManagementView` (o board embarcado no cockpit do Hades) que ficou sem as props novas. O `@ts-nocheck` do IrisPage escondeu o erro e isso teria quebrado o cockpit em producao; o embed agora recebe central='todas' e lista vazia, ficando identico ao que era. Ver [[reference_typecheck_nao_cobre_ts_nocheck]].",
      motivation:
        "Pedido do Lucas: o Board como tela principal, com Atendimento e Relacionamento como subtelas.",
    },
    title: "Board com as duas centrais como subtelas",
    type: "melhoria",
    version: "1.140.0",
  },
  {
    buildTag: "2026-08-15-iris-centrais-na-tela",
    deployedAt: "2026-08-15T15:50:00-03:00",
    // Ficou ~20 min no ar e o layout do seletor mudou logo em seguida (virou subtela do
    // Board, v1.140.0). Marcada como interna para o painel de Novidades nao contar a mesma
    // entrega duas vezes, com a versao intermediaria descrevendo uma tela que nao existe mais.
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Iris agora abre por central: Atendimento (o cliente final) ou Relacionamento (corretor, imobiliaria e parceiro)",
              "O seletor fica no alto do menu, e todas as telas abaixo dele respeitam a escolha: Board, Historico, Disparos e Relatorios",
              "Quem atende so uma das centrais nao ve seletor nenhum, ja entra direto na sua",
              "A central escolhida fica guardada, entao a Iris reabre onde voce estava",
            ],
            screen: "Iris - Board e Fila",
          },
          {
            items: [
              "O e-mail passou a entrar pela caixa certa: cobranca, financeiro, juridico e antecipacao vao para o Atendimento; contato, RH e compras vao para o Relacionamento",
              "A Caca responde nas caixas do Atendimento",
              "E-mail de uma caixa sem area definida cai em 'E-mail (outros)' em vez de sumir",
              "Vale para o e-mail que chegar de agora em diante; o que ja estava na caixa fica como esta",
            ],
            screen: "Iris - e-mail",
          },
          {
            items: [
              "A fila agora tem o campo Central, para dizer em qual das duas visoes ela aparece",
              "Salvar uma fila de e-mail deixou de exigir um numero de WhatsApp, o que travava as filas novas",
            ],
            screen: "Iris - Setup",
          },
        ],
      },
    ],
    rollback: "cac37213 (v1.138.0 as duas centrais no banco)",
    technical: {
      done:
        "TELA: `lib/centrais.ts` recorta `IrisData` (filas + tickets, casando por queueSlug) e o IrisPage passou a derivar `irisData` desse recorte, entao as views nao souberam da mudanca: 'a mesma estrutura, somente a separacao'. As centrais que a pessoa ve sao DERIVADAS das filas que ela ja enxerga (`canSeeResource`), sem vinculo novo. O Setup recebe o dado BRUTO de proposito, senao nao daria para mapear fila da outra central. MIGRATION 0089, aplicada: conserta a 0088, que preencheu `config.ingestMailbox` quando o roteador casa por `external_account_id` (`gmail-inbound.ts:203`) — os 7 canais estavam inertes, 0 tickets, e todo e-mail seguia caindo na mesma porta. Cada canal ganhou o proprio endereco + `ingestSinceEpoch` de agora (sem esse corte, `gmail-inbound.ts:151` nao filtra por data e ~1 mes de e-mail nao lido viraria ticket de uma vez). O canal antigo virou a caixa robo (external = ingest = caca@) e cede prioridade ao canal do contato@. Conferido simulando o findEmailChannel nos 9 cenarios de destinatario. ⚠️ ACHADO: `IrisPage.tsx` e `iris-setup-view.tsx` tem `@ts-nocheck` (36 arquivos no repo tem), entao o typecheck NAO cobre os dois. As edicoes foram conferidas removendo o pragma temporariamente: nenhum dos 78 erros esta nas linhas tocadas.",
      motivation:
        "Pedido do Lucas: as duas centrais como visao de topo, com a mesma estrutura, e o e-mail dividido por caixa.",
    },
    title: "Iris abre por central, e o e-mail entra pela caixa certa",
    type: "novidade",
    version: "1.139.0",
  },
  {
    buildTag: "2026-08-15-iris-duas-centrais",
    deployedAt: "2026-08-15T14:20:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O atendimento passou a ter duas centrais: Central de Atendimento (o cliente final) e Central de Relacionamento (corretor, imobiliaria e parceiro)",
              "Cada fila agora pertence a uma central, entao da para olhar so a sua operacao em vez da caixa inteira",
              "As conversas do numero de Relacionamento sairam de dentro do canal de Grupo e ganharam canal proprio",
              "As respostas que a coordenadora da Relacionamento manda pelo celular passaram a aparecer com o nome dela, e nao mais em branco",
            ],
            screen: "Iris - Board e Fila",
          },
          {
            items: [
              "Cada caixa de e-mail ganhou canal e fila proprios: contato, RH, compras, cobranca, financeiro, juridico e antecipacao",
              "Contato, RH e Compras ficam na Central de Relacionamento; o resto fica na Central de Atendimento",
              "Filas novas comecam visiveis so para administrador ate serem vinculadas as pessoas no Setup",
              "Nesta versao o e-mail que chega ainda caia todo na mesma porta; a separacao por caixa foi ligada na versao seguinte",
            ],
            screen: "Iris - e-mail",
          },
        ],
      },
    ],
    rollback: "33968bfc (v1.137.1 Caca sem travessao)",
    technical: {
      done:
        "Migrations 0087 e 0088, as duas ja aplicadas em producao com autorizacao. A 0087 carimba `metadata.central` em 12 filas (8 atendimento, 4 relacionamento) e falha se sobrar fila orfa, porque fila sem central sumiria das duas visoes. A 0088 cria 7 canais de e-mail e 4 filas novas (Contato, RH, Compras, Antecipacao). A central vive em `metadata` e nao em coluna nova, seguindo o padrao que as filas ja usam. ⚠️ CORRECAO DA PROPRIA 0088: os canais novos nasceram INERTES. O roteador (`gmail-inbound.ts:203`) casa o destinatario com `external_account_id`, e a 0088 preencheu `config.ingestMailbox`, que so serve de desempate entre grupo e caixa robo. Com `external_account_id` nulo os 7 canais nunca batem, e todo e-mail segue caindo no canal antigo. Corrigido pela 0089. A tela ainda nao tem o seletor de central: e o proximo passo.",
      motivation:
        "Pedido do Lucas: separar Atendimento de Relacionamento como visao de topo, com a mesma estrutura, e dividir o e-mail por caixa. Hoje 118 tickets de e-mail em 30 dias caiam todos na mesma porta.",
    },
    title: "Iris dividida em duas centrais, e o e-mail por caixa",
    type: "novidade",
    version: "1.138.0",
  },
  {
    buildTag: "2026-08-15-caca-sem-travessao",
    deployedAt: "2026-08-15T12:45:00-03:00",
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Caca parou de usar travessao no texto que vai para o cliente",
            ],
            screen: "Iris - atendimento da Caca",
          },
        ],
      },
    ],
    rollback: "ee7fa0b4 (v1.137.0 Caca com motor novo)",
    technical: {
      done:
        "A persona usava travessao em 50 linhas do proprio prompt, inclusive dentro dos exemplos de fala que a Caca imita. Exemplo em prompt e instrucao: no PRIMEIRO atendimento com o Opus 5 (ticket 5745c035, 11:30) ela escreveu 'R$ 689,33 — e nenhuma delas', contra a regra da casa. As 50 linhas foram trocadas por virgula/dois-pontos (comentario de codigo nao entra, nao vai pro modelo) e a proibicao virou regra explicita no bloco de formato, no texto e na voz. A revisao adversarial tinha apontado isto como higiene e eu tratei como baixa prioridade: errei a classificacao, porque saiu na primeira mensagem em producao.",
      motivation:
        "Regra do Lucas: sem travessao em texto que vai para cliente.",
    },
    title: "Caca sem travessao",
    type: "correcao",
    version: "1.137.1",
  },
  {
    buildTag: "2026-08-15-caca-motor-opus-5",
    deployedAt: "2026-08-15T12:10:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Caca passou a usar o nosso modelo de IA mais capaz para atender o cliente",
              "Ela enxerga o dobro da conversa (24 mensagens no lugar de 14), entao para de perder o comeco do atendimento",
              "Volta a lembrar do comprovante e do audio que o cliente mandou nas mensagens anteriores",
              "Respostas mais curtas e diretas, principalmente na hora de passar o atendimento para um analista",
              "Quando ela nao consegue concluir a resposta, o atendimento vai para uma pessoa em vez de sair uma frase generica",
              "Ao consultar uma CAD aprovada, ela deixou de afirmar que o PIX ja foi enviado sem conferir a ficha",
            ],
            screen: "Iris - atendimento da Caca",
          },
        ],
      },
    ],
    rollback: "a71dd1c8 (v1.136.0 Central de Relacionamento)",
    technical: {
      done:
        "A CACA passa a rodar em claude-opus-5, por um tier `frontier` proprio em lib/ai/claude.ts. O tier `heavy` FICA no Opus 4.8: os outros 6 consumidores dele (Athena, copiloto do Zeus, ata e pauta do Chronos, evidencia do HelpDesk, autor de template) pedem 900 a 2.200 tokens sem mandar `thinking`, e no modelo novo o max_tokens vira teto de raciocinio MAIS resposta, o que truncaria os seis. Se o modelo nao estiver liberado na conta, o turno e refeito no `heavy` (agent.ts), entao a troca nao vira falha tecnica pro cliente. HARNESS: maxTokens 1024->4000; a chamada final de fechamento passou a repassar thinking/effort (omitir deixou de significar desligado); thinking:false manda {type:'disabled'}; stop_reason `refusal`/`max_tokens` viram transferencia; `pause_turn` deixa de ser tratado como resposta final; iteracoes 6->8; historico 14->24 com desempate por id; client Anthropic com maxRetries 1 e timeout 90s (era 2 e 10 min). CACHE: persona dividida em estavel (cacheada, TTL 1h) e contexto do turno, subindo o prefixo reaproveitado para 96% no cliente e 95% na direcao, com persona-cache.test.ts travando a separacao. TELEMETRIA: usage por turno (tokens, cache, latencia, stop_reason) em metadata.cacaAutomation.lastUsage, sem migration. RISCO OPERACIONAL: envio recusado pela Meta deixava a linha outbound morta e a guarda de turno via 'ja respondido' PARA SEMPRE, calando o atendimento - agora vai pro humano; corte em 3.900 caracteres so no texto da CACA e antes de gravar; retry so em 429/5xx/rede E se nenhuma ferramenta com efeito colateral tiver rodado; maxDuration 300 no webhook; timeout no TTS; montarTurnoDeFalha lia o objeto errado e apagava o vinculo do cadastro. consultar_status_cad afirmava que o PIX 'ja foi emitido e enviado' na etapa prevenda, que so prova credito aprovado. Revisado por 37 agentes em quatro lentes com refutacao adversarial: 11 achados confirmados e tratados, 22 derrubados. Detalhe em docs/operations/caca-motor-opus-5.md. A parte do meio desta mudanca ja tinha subido por acidente na v1.136.0 (git add -A de outra sessao no mesmo working tree); este deploy completa e corrige.",
      motivation:
        "Lucas: \"eu quero para a Caca o melhor motor, quero um agente bem inteligente mesmo\". Medido antes (01 a 15/08): 484 tickets dela, 78,9% terminando em transferencia, e a taxa de resolucao sozinha caindo de 51,8% em junho para ~20% em agosto porque o mix virou boleto, que e o assunto em que ela nao tem ferramenta.",
    },
    title: "Caca: motor novo e conserto do harness",
    type: "melhoria",
    version: "1.137.0",
  },
  {
    buildTag: "2026-08-15-iris-central-relacionamento",
    deployedAt: "2026-08-15T11:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A fila Direct passou a se chamar Central de Relacionamento",
              "O atendimento 1:1 com corretor e imobiliaria ganhou canal proprio, separado do monitoramento de grupos",
              "As respostas que a coordenadora manda pelo celular passam a mostrar o autor no board",
            ],
            screen: "Iris - Central de Relacionamento",
          },
        ],
      },
    ],
    technical: {
      done:
        "Primeiro passo da modernizacao da Iris, sobre o diagnostico em docs/operations/iris-diagnostico-2026-08.md (12 agentes, 66 achados criticos/altos, com medicao em producao). Grupo e Direct dividiam o MESMO canal `whatsapp-grupo`, que nao tem numero nem fila: dai a fila Direct herdar o 4143 ao abrir atendimento e 9.187 mensagens do 1:1 estarem gravadas como se fossem de grupo. O processador agora resolve os DOIS canais de uma vez, fora do laco, e escolhe pelo tipo do JID; enquanto a migration 0086 nao for aplicada ele cai no canal do grupo, entao o codigo sobe sem depender da ordem. A autoria da saida sem operador passa a ser o dono padrao DA FILA (nao um id fixo): no 1:1 quem responde pelo celular e sempre a coordenadora, e a fila do Grupo, que nao tem dono padrao porque la respondem tres pessoas, continua sem autor - atribuir ali viraria metrica falsa. Medido antes: 3.247 saidas em 30 dias sem autor (80% daquele atendimento) contra 814 pela Iris. O slug interno da fila (relacionamento-direct) NAO foi tocado de proposito: renomear slug para arrumar rotulo ja quebrou coisa aqui, e a v1.38.0 fez a mesma distincao. A migration 0086 NAO foi aplicada neste deploy.",
      motivation:
        "Lucas: \"vamos separar sistemicamente\" e \"nao quero esse nome direct, tratar com a central de relacionamento\". Sao duas operacoes diferentes dividindo um canal por acidente historico: o grupo e monitoramento sem ticket; o 1:1 e atendimento com SLA e uma responsavel.",
    },
    title: "Iris: Central de Relacionamento com canal proprio",
    type: "novidade",
    version: "1.136.0",
  },
  {
    buildTag: "2026-08-14-credenciamento-lagoa-bonita",
    deployedAt: "2026-08-14T20:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Lagoa Bonita agora mostra a logo do empreendimento e o nome em caixa alta, como os demais",
              "Ao pedir credenciamento em Lagoa Bonita, a imobiliaria passa a ser habilitada nos tres empreendimentos (LBF, LBR e LBP)",
            ],
            screen: "Portal publico de credenciamento de imobiliaria",
          },
        ],
      },
    ],
    technical: {
      done:
        "Tres defeitos com a mesma origem: o Lagoa Bonita e um grupo consolidado do C2X (ENTERPRISE_GROUPS) e ja estava gravado em apolo_enterprise_settings com o id sintetico `group:Lagoa Bonita`, mas logo e credenciamento sao por enterprise_id individual. (1) LOGO: `uploadEnterpriseLogo` grava o arquivo com `safeId()`, que troca `:` e espaco por `_` (`group_Lagoa_Bonita`), e o consumidor procurava a chave crua no mapa, nunca achava, e caia no fallback que desenha o code (`LBF + LBR + LBP`); empreendimento de id numerico passava ileso, por isso so este aparecia quebrado. `safeId` virou `chaveDaLogo`, exportada, e o lookup usa a mesma transformacao. (2) CAIXA ALTA: o nome dos simples vem do C2X ja em maiusculas e o do grupo vinha do `display` do ENTERPRISE_GROUPS; uppercase aplicado em `listEmpreendimentosAtivos`, sem tocar no `display`, que o BI usa. (3) OS TRES: o credenciamento gravava o vinculo com o id do grupo, que nao casa com nenhum enterprise_id do C2X, e a imobiliaria ficaria credenciada sem poder vender em nenhum dos tres; `CredenciamentoEmpreendimento` ganhou `stageIds` e a rota expande o grupo antes de gravar, um vinculo por etapa. Vale para qualquer grupo do ENTERPRISE_GROUPS, nao so Lagoa Bonita. NAO e retroativo: quem se credenciou antes tem o vinculo no id do grupo.",
      motivation:
        "Lucas, com print do portal: \"aqui lagoa bonita tem que vim unificado, ao cadastrar para lagoa bonita habilita os tres\", mais a logo do empreendimento e o nome em caixa alta.",
    },
    title: "Credenciamento: Lagoa Bonita unificado, com logo e os tres empreendimentos",
    type: "correcao",
    version: "1.135.0",
  },
  {
    buildTag: "2026-08-14-iris-cadastro-apolo",
    deployedAt: "2026-08-14T19:40:00-03:00",
    // Fora do painel de Novidades da Home (decisão do Lucas, 14/08). Continua entrando no bump de
    // versão e na aba Deploy do Zeus — o registro técnico e o sinal de atualização da PWA não se
    // perdem; o que não acontece é o anúncio para o time.
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O painel do atendimento agora diz se quem está do outro lado tem cadastro no Apolo, e o que ele é: Comprador, Corretor, Imobiliária, Prospect",
              "Mostra o vínculo separado em Trabalho ou Contato, com o nome de quem — \"Imobiliária: Imparável Soluções\" — e o nome abre a ficha no Apolo",
              "Acha também quem não tem ficha própria e só existe como contato de outra pessoa (o cônjuge do comprador, o corretor da imobiliária)",
              "Quando a consulta ao Apolo falha, avisa que não conseguiu verificar em vez de mostrar a tela de quem não tem cadastro",
              "Botão para corrigir nome, documento, telefone e e-mail sem sair da conversa (mudar nome ou documento pede o motivo, que fica no histórico)",
              "Botão para vincular o contato a uma pessoa ou empresa já cadastrada",
              "Cadastro novo continua sendo no Apolo: o cockpit leva para lá com o telefone já preenchido na busca",
            ],
            screen: "Iris · Atendimento (aba Cliente)",
          },
        ],
      },
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Link direto para uma ficha: /apolo?entidade=<id> abre o cadastro daquela pessoa em vez da lista",
              "Os vínculos de imobiliária agora apontam para a FICHA da imobiliária, não só para o nome escrito — 4.746 vínculos corrigidos",
            ],
            screen: "Apolo · CRM 360",
          },
        ],
      },
    ],
    rollback: "v1.133.0 (buildTag 2026-08-14-glotes-api)",
    technical: {
      done:
        "lib/iris/apolo/identidade-contato.ts resolve o telefone em TRÊS fontes (identificador por hash, apolo_contacts por texto e o telefone gravado no metadata do vínculo) e devolve ESTADO — entidade | vinculo | nenhum | indisponivel — em vez de booleano: 'não achei' e 'não consegui olhar' tinham o mesmo desenho e faziam o operador duplicar ficha. A terceira fonte é a que estava faltando: 204 vínculos guardam telefone no metadata e 101 desses números não pertencem a entidade nenhuma (80 são cônjuges). PERFIL vem da CARTEIRA (apolo_financial_snapshots), não de apolo_entity_profiles: comprador de verdade costuma ter só 'pessoa_fisica' e 'usuario' lá, que são rótulos de cadastro e não papel — mesma régua do isBuyer do CRM (server.ts:1008). VÍNCULO respeita a DIREÇÃO: 'Imobiliaria ou responsavel comercial' descreve a contraparte, não o titular, e exibi-lo como papel do titular dizia que a compradora era a responsável comercial da imobiliária. Escrita em app/api/iris/apolo/contato (POST com ação): corrigir identidade via atualizarIdentidade (valida DV, colisão em duas fontes, exige motivo, audita), contato gravando value E normalized_value juntos (o upsert do CRM deixa o normalized_value velho e a busca passa a devolver ficha errada), e vínculo com metadata.kind trabalho/contato, atualizando em vez de duplicar. Criar entidade NÃO entra: fica no Apolo. Campos pessoais da ficha também não, porque metadata.cadastro perde para apolo_esteira.ficha e a tela do CRM grava na camada perdedora — pendência do Apolo, registrada. Deep link: /apolo?entidade=&q= reusa o pendingEntityIdRef; o q é obrigatório junto porque a lista do CRM é busca, não a base inteira. Backfill (scripts/backfill-vinculo-imobiliaria.ts) casou por vinculed_by_id + uuid determinístico, não por nome: o próprio label foi gerado desse id (server.ts:2884), então o casamento é exato por construção. Bug pego no log do dev e não pelo typecheck: o modal importava a lista de vínculos de um arquivo que puxa mysql2, arrastando o driver de banco para o bundle do browser e quebrando a página da Iris.",
      motivation:
        "Lucas: \"não temos a informação que esse contato que está conversando com a gente está cadastrado no apolo, ou vinculado a alguma entidade\". Caso concreto: a Ingrity, corretora da L&I com CPF e telefone cadastrados, aparecia no cockpit como desconhecida; e a Ilza, compradora, aparecia como se fosse a responsável comercial da imobiliária dela.",
    },
    title: "Iris sabe quem está do outro lado: cadastro, papel e vínculo no atendimento",
    type: "novidade",
    version: "1.134.0",
  },
  {
    buildTag: "2026-08-14-glotes-api",
    deployedAt: "2026-08-14T17:10:00-03:00",
    modules: [
      {
        module: "Integrações",
        screens: [
          {
            items: [
              "A carteira do Lavra do Ouro passa a ser entregue ao GLOTES, o sistema do próprio cliente, por uma API de leitura",
              "São cinco conjuntos: loteamentos, clientes, lotes, vendas e as parcelas mensais",
              "O cliente puxa quando quiser, e depois da primeira carga só o que mudou",
            ],
            screen: "Integrações · GLOTES (Lavra do Ouro)",
          },
        ],
      },
    ],
    technical: {
      done:
        "Cinco endpoints GET sob /api/integrations/glotes (loteamentos, clientes, lotes, vendas, recebimentos), paginados por cursor opaco (base64 de id:<n>, não OFFSET: com OFFSET uma inserção concorrente faz a próxima página pular linha, e numa carga de 66 mil parcelas isso passa despercebido). Implementa o contrato já fechado com o cliente em docs/integrations/glotes-openapi.yaml. SEGURANÇA: a rota entra na allowlist do proxy.ts e se protege por dentro (lib/integrations/glotes/porta.ts) — token dedicado no header X-Glotes-Token comparado em tempo constante, NUNCA aceito em query string (URL vaza em log de proxy, histórico e Referer, e este token abre nome, CPF e endereço de 375 titulares); sem GLOTES_API_TOKEN a API responde 503, falha fechada; escopo travado NO SERVIDOR nos enterprises 1 e 4, sem parâmetro de loteamento; teto de 120 req/min por IP; log de acesso com filtros e contagem, sem o corpo da resposta; Cache-Control no-store. Convenções do contrato: dinheiro como string decimal de duas casas (somar 66 mil parcelas em float diverge do fechamento em centavos), documento e CEP só com dígitos, e todo campo pedido presente mesmo quando a Careli não tem o dado. Decisões do Lucas aplicadas: recebimentos traz SÓ o parcelamento (Ato e Sinal são a entrada, já descrita em vendas — mandá-los de novo contaria a entrada duas vezes), percentual_reajuste sempre nulo (o plano tem duas taxas ambíguas) e do lote sai só area_total. Conferido contra a base: 375 clientes, 493 lotes, 475 vendas, 66.805 parcelas. Pendência P3 do contrato resolvida com teste: payments.updated_at acompanha a alteração (13.303 linhas alteradas após criadas, zero pagamentos recentes com marca defasada), então alterado_desde é confiável.",
      motivation:
        "O cliente Lavra do Ouro administra a carteira dele no GLOTES e precisa dos dados que a Careli mantém. Lucas: \"preciso que eles já possam fazer a integração\". Até aqui existia só o levantamento e o contrato; faltava a API.",
    },
    title: "API da carteira Lavra do Ouro para o GLOTES",
    type: "novidade",
    version: "1.133.0",
  },
  {
    buildTag: "2026-08-14-painel-coordenador",
    deployedAt: "2026-08-14T12:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Painel único do coordenador, sem login, com o empreendimento escolhido no topo e quatro abas: CAD, Imobiliárias, Assinatura e Sinal (c2x.app.br/publico/painel)",
              "CAD: o funil de cadastros com busca por cliente, filtro por imobiliária e ranking, agora contando tudo o que está no Apolo",
              "Imobiliárias: quem está credenciado no empreendimento, quantos corretores tem, quantas CADs mandou e quem ainda não mandou nenhuma",
              "Assinatura: a mesma tela do painel interno, com o cenário do comprador, a fila por ordem de assinatura e quem falta assinar",
              "Sinal: o que foi gerado de entrada (Ato + Sinal), o que foi quitado, o que vence, o que atrasou e o que vence nos próximos 7 dias",
              "Filtro, busca e ordenação por coluna nas quatro abas",
              "O link antigo da Central de CADs continua funcionando e abre direto na aba CAD",
            ],
            screen: "Apolo · Painel do coordenador",
          },
          {
            items: [
              "O aviso \"sem CAD\" não aparece mais nos cards de imobiliária, onde ele nunca fez sentido",
            ],
            screen: "Apolo · Board",
          },
        ],
      },
    ],
    rollback: "dpl_2rmBQ7tAvWwAN51jBGg9RaVQ4Wdq",
    technical: {
      done:
        "Rota nova /publico/painel (server component, navegação por link ?emp=&aba=, noindex): cada aba carrega só a sua fonte, então abrir CAD não paga a consulta do C2X. lib/apolo/painel-coordenador.ts lê o Apolo (esteira + credenciamento) e lib/apolo/painel-sinal.ts lê o C2X (payments, parcel_type 1 e 2 = Ato e Sinal, payment_to_delete = 0). Empreendimento é agrupado por enterprise_id, NUNCA pelo texto: 'VALE DO OURO' e 'Vale do Ouro' convivem no banco, e o Vale do Ouro são três enterprises (35 masterplan, 36 VOL, 37 VOC) com o mesmo nome. A aba Imobiliárias filtra por PAPEL (apolo_entity_profiles.profile = 'imobiliaria'): o vínculo 'empreendimento' também existe em ficha de prospect e de corretor, e sem o filtro a conta dava 76 no Vale do Ouro em vez de 30. A produção por imobiliária cruza pela ENTIDADE (imobiliariaEntityIdEmLote), não pelo nome, senão a J&F aparecia com zero CAD porque a esteira guarda o apelido que o corretor digitou. A canonização do nome da imobiliária saiu de app/api/apolo/board/route.ts para lib/apolo/imobiliaria-grafia.ts e agora serve o Board e o painel. Fonte de CAD 100% Apolo: o Asana saiu do painel público, do resumo e da tool consultar_cad da CACÁ (as 575 CADs que viveram lá já estão na esteira). /publico/cads/[emp] virou redirect. Estudo do racional financeiro do Power BI (aba Financiamento) em docs/operations/c2x-financiamento-racional.md, incluindo o achado de que a comissão de 7,5% chumbada lá é a política do Vista Alegre, e não uma constante (Vale do Ouro é 6%, em commercial_policies.total_value_commission).",
      motivation:
        "Lucas: \"queria juntar os painéis de CAD, assinatura e financeiro do sinal em um painel só, ele deve ser público para os coordenadores acessarem\", com todos os empreendimentos que estão recebendo CAD. Depois: \"pode cortar o vínculo com o Asana de uma vez\", \"nesse painel não quero valor líquido, quero o cenário de pagamentos\" e \"falta colocar os filtros, ordenação, para o coordenador procurar\". O perfil de acesso do time comercial vem depois e substitui o link aberto.",
    },
    title: "Painel do coordenador: CAD, imobiliárias, assinatura e sinal num lugar só",
    type: "novidade",
    version: "1.132.0",
  },
  {
    buildTag: "2026-08-13-painel-assinatura-vale-do-ouro",
    deployedAt: "2026-08-13T18:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Painel de assinatura do Vale do Ouro, com o cenário do comprador, a fila de assinatura degrau a degrau e a lista de quem falta (c2x.app.br/apolo/assinaturas)",
              "Mostra quantas unidades já têm o comprador assinado e de quem cada contrato está esperando agora",
              "Atualiza sozinho, com o horário da última leitura na tela",
            ],
            screen: "Apolo · Painel de assinatura",
          },
        ],
      },
    ],
    technical: {
      done:
        "Tela nova em /apolo/assinaturas lendo o C2X, no lugar do Painel Assinatura do Power BI. As regras de leitura foram extraídas do .pbit do Lucas (Arquivo > Exportar > Modelo do Power BI, que traz o DataModelSchema em JSON legível; o .pbix não serve, o DataModel vem comprimido em VertiPaq) e estão em docs/operations/c2x-painel-assinatura-dax.md: só contrato com `send_document_signature` = 1 e status <> 6, \"Comprador\" é o perfil `Cliente` do C2X, quem tem e-mail @careli.adm.br vira \"Backoffice\", e o prazo do comprador é de 7 dias. Cache de 5 minutos no SERVIDOR (lib/apolo/painel-assinatura.ts), não por aba: medido na base, chegam ~7 assinaturas por hora nas horas úteis, então cada ciclo traz meia assinatura nova, e sem o cache dez pessoas com a tela aberta virariam 120 consultas/hora no legado, que tem pool de 5 conexões. A tela pede de 60 em 60s (quase sempre bate no cache) e pausa quando a aba sai de foco. Se o C2X cair, devolve o cache velho com o carimbo antigo em vez de sumir com o painel. Os números batem com o painel do Power BI: no Vista Alegre o card Comprador dá 39 de 39, igual.",
      motivation:
        "Lucas: \"quero só a visão do Vale do Ouro, quero um painel em html\" e depois \"vamos colocar um tempo para gente atualizar esse painel\". O Painel Assinatura do Power BI cobre o Vista Alegre e não o Vale do Ouro, que está em pleno lançamento com 179 contratos em assinatura e R$ 25,9 mi em unidades esperando.",
    },
    title: "Painel de assinatura do Vale do Ouro",
    type: "novidade",
    version: "1.131.0",
  },
  {
    buildTag: "2026-08-13-incorporador-gestao-portal",
    deployedAt: "2026-08-13T00:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Tela nova para criar o incorporador, dizer quais empreendimentos ele enxerga e abrir as contas de acesso dele (c2x.app.br/apolo/incorporadores)",
              "A senha do incorporador se define e se troca por aqui; deixar em branco na edição mantém a que já existe",
            ],
            screen: "Apolo · Acessos de incorporador",
          },
        ],
      },
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O portal ganhou menu lateral com CRM, Vendas, Carteira e Produtos",
              "A marca do incorporador agora recebe o cliente só na tela de acesso; dentro do portal a marca é o Panteon",
            ],
            screen: "Portal do incorporador",
          },
        ],
      },
    ],
    technical: {
      done:
        "Três peças. (1) `lib/apolo/incorporador/gestao.ts` + rotas `/api/apolo/incorporadores` e `/api/apolo/incorporadores/usuarios`, com `authorizeApoloWrite` nas duas pernas (inclusive no GET: a lista de empreendimentos por incorporador É a regra de permissão). A lista de empreendimentos é substituída inteira a cada gravação, porque merge deixaria empreendimento pendurado quando o operador desmarca; `carteira_administrada` é preservado pela tela ao remontar a lista. `senha_hash` nunca sai do servidor, e senha vazia na edição mantém a atual. (2) Tela `/apolo/incorporadores`. (3) Portal: header horizontal virou casca com menu lateral (`.inc-shell`/`.inc-side`/`.inc-nav` no TEMA_CSS, que vira faixa rolável abaixo de 860px, já que estilo inline não responde a media query), aba CRM entrou como esqueleto e a `<Marca>` do cabeçalho passou a ser o símbolo do Panteon; `logoUrl`/`logoEscuraUrl` saíram das props do Portal e ficaram só no login.",
      motivation:
        "Lucas, 12/08: \"eu preciso ter um local que eu crio o login e senha desses usuarios e vincula-los ao perfil correto\" e \"podemos usar a mesma estrutura para todos, somente a tela de login eu quero com a marca da cecilio, as demais pode ser o panteon mesmo\". Recanto do Pará, Vista Alegre e Lavra do Ouro entram agora, e o caminho até aqui era INSERT manual no Supabase, onde uma linha errada em `apolo_incorporador_empreendimentos` é um cliente vendo a carteira do outro.",
    },
    title: "Acessos de incorporador: tela de gestão e portal no padrão Panteon",
    type: "novidade",
    version: "1.130.0",
  },
  {
    buildTag: "2026-08-12-cad-conjuge-portal",
    deployedAt: "2026-08-12T20:45:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A trava de casal passou a enxergar também as CADs abertas pelo portal do corretor, que é por onde tudo nasce hoje",
            ],
            screen: "Apolo · Cadastro de CAD e portal público do corretor",
          },
        ],
      },
    ],
    technical: {
      done:
        "Correção da v1.127.0, publicada horas antes. A trava de núcleo familiar lia SÓ `apolo_esteira.ficha->>'conjugeCpf'`, e nenhum fluxo de criação de CAD escreve `ficha`: ela só é gravada pelo import do Asana (descontinuado em 04/08) e pela edição manual do board. Medido na base: das 43 CADs vindas do portal público, ZERO têm `conjugeCpf` na ficha e 10 têm o cônjuge em `apolo_relationships`; do Asana é o inverso, 89 pela ficha e 2 pelo relacionamento. Ou seja, a trava fechava o buraco histórico e deixava passar todo caso novo. Agora lê as DUAS fontes, com a ficha ganhando quando as duas existem (é a que o operador revisou). Simulado contra as 656 CADs: de 10 para 12 casais pegos, e os 2 novos são justamente de `cadastro-manual` e `publico-cad`. Segunda correção, no mesmo arquivo: o ramo que pergunta se o cônjuge informado já tem CAD própria listava os donos do empreendimento e procurava o CPF entre eles com `.in('id', donos.slice(0, 100))`, sem `order by`. Em empreendimento com centenas de CADs, quais 100 entravam era decisão do planner, então o mesmo casal passava numa tentativa e era barrado na outra. Invertido: resolve o CPF por `hashIdentifier` e pergunta se alguma dessas fichas tem CAD aqui. Determinístico e sem teto. Achado pela revisão adversarial, que só terminou depois do deploy.",
      motivation:
        "A revisão adversarial da própria trava, retomada após a interrupção da sessão anterior, apontou que a fonte escolhida estava congelada no passado. Confirmado na base antes de corrigir.",
    },
    title: "Trava de casal: passa a enxergar as CADs do portal do corretor",
    type: "correcao",
    version: "1.129.0",
  },
  {
    buildTag: "2026-08-12-garden-plano-normal",
    deployedAt: "2026-08-12T20:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Plano Normal do Garden atualizado: entrada de 10%, 5 reforços anuais de R$ 25.000 e 60 meses",
              "Num lote de R$ 435.000 isso dá entrada de R$ 43.500 e parcela de R$ 4.442",
              "O plano Investidor Parcelado passou a mostrar, ao lado do nome, que é válido para as próximas 16 unidades",
            ],
            screen: "Portal do incorporador · Produtos · Plano de pagamento do Garden",
          },
        ],
      },
    ],
    technical: {
      done:
        "`PLANOS` do garden.html: o Normal foi de entrada 8%, 6 × 20.000 e 84 meses para entrada 10%, 5 × 25.000 e 60 meses. Conferido contra o print do Lucas: 435.000 menos 43.500 de entrada menos 125.000 de anuais dá 266.500, que em 60 meses é R$ 4.441,67, os R$ 4.442 que a tela dele mostrava. A ressalva do Investidor Parcelado entra como CAMPO do plano (`ressalva`), não como texto fixo no HTML, então qualquer plano ganha uma condição depois sem tocar no render. Renderizada como etiqueta âmbar ao lado do nome, que é onde o corretor lê ao escolher o plano, e não no rodapé. ⚠️ O número 16 é fixo: quando as 16 unidades forem vendidas, alguém precisa avisar. Amarrar na contagem de disponíveis faria o texto mudar sozinho conforme o mapa, e o que está prometido ao cliente deixaria de ser uma decisão.",
      motivation:
        'Lucas, 12/08, com print da tela: "para o garden muda o plano normal, tem que ficar assim" e "na frente do plano investidor parcelado coloca uma frase, válido para as próximas 16 unidades".',
    },
    title: "Garden: plano Normal novo e a validade do Investidor Parcelado na tela",
    type: "melhoria",
    version: "1.128.0",
  },
  {
    buildTag: "2026-08-12-cad-duplicidade-conjuge",
    deployedAt: "2026-08-12T19:15:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Casal passa a contar como um cadastro só por empreendimento: se o CPF do titular ou o do cônjuge já tem CAD ali, o sistema avisa e não deixa abrir outra",
              "O aviso aparece assim que o CPF é identificado, pelo MOST ou digitado, e não no fim do preenchimento",
              "A mensagem diz de quem é a CAD que já existe, por exemplo: o CPF do cônjuge do ALCIMAR RODRIGO MAIA já possui CAD para o empreendimento VALE DO OURO",
              "A quantidade de unidades continua livre: o casal pode comprar quantas quiser, com um cadastro só",
              "Corrigida a trava de CPF repetido, que deixava passar quando a mesma pessoa tinha mais de uma ficha na base",
            ],
            screen: "Apolo · Cadastro de CAD e portal público do corretor",
          },
        ],
      },
    ],
    technical: {
      done:
        "Duas falhas independentes, achadas pelo caso Alcimar e Sirlei (ele entrou em 20/07 pelo Asana com o CPF dela no campo de cônjuge; ela entrou em 05/08 pelo portal público e foi aceita). PRIMEIRA: o dedup por documento fazia `.limit(1).maybeSingle()` e conferia as CADs de UMA ficha escolhida sem ordem nenhuma. Como a mesma pessoa tem mais de uma ficha em 516 casos (o import do Asana criava uma cópia COM `document_hash` e sem vínculo, enquanto a CAD ficava na outra, SEM hash: são 437 fichas soltas, todas com hash, contra 116 das 656 CADs reais), a busca caía na cópia vazia, não achava CAD e liberava. Foi assim que Lucélia, Ronaldo e Rafael entraram duas vezes no Vale do Ouro em agosto, cada um por uma imobiliária. Agora lê TODAS as fichas do documento e todas as CADs delas, e anexa na que já tem esteira. SEGUNDA: não existia regra de cônjuge em lugar nenhum. Entra `lib/apolo/nucleo-familiar.ts`: o núcleo de uma CAD é o par {CPF titular, CPF cônjuge} e duas CADs do mesmo empreendimento colidem se os pares cruzarem em qualquer CPF, o que cobre os quatro sentidos, inclusive o cônjuge tendo entrado primeiro (aconteceu em 4 dos 10 pares). A fonte é `apolo_esteira.ficha->>'conjugeCpf'` (94 preenchidos) e não `apolo_relationships` (só 16 com CPF, e `related_entity_id` nulo em todos). Dígito verificador conferido dos dois lados, senão CPF em branco casa com todo mundo. Simulada contra as 656 CADs: pega os 10 casais reais, zero falso positivo. Duas rotas novas de checagem na identificação (`/api/publico/cad/checar-cpf` e `/api/apolo/cadastro/checar-cpf`), a pública com teto de uso próprio porque responder se um CPF tem cadastro é um oráculo. A checagem da tela é conveniência e falha ABERTA; a autoridade é a trava do salvar, que é fail-closed. A mensagem não revela a imobiliária que cadastrou antes: isso é carteira de concorrente.",
      motivation:
        'Lucas, 12/08: "o Romulo subiu a cad do Alcimar, agora o Caio subiu a cad da Sirlei que é esposa do Alcimar para o mesmo empreendimento, deveria ter barrado essa CAD". E a regra: "o casal pode comprar quantas unidades quiser, o que não pode é ter cadastros distintos entre eles".',
    },
    title: "CAD: casal é um cadastro só por empreendimento",
    type: "correcao",
    version: "1.127.0",
  },
  {
    buildTag: "2026-08-12-garden-planilha-revisada",
    deployedAt: "2026-08-12T18:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Garden atualizado com a planilha revisada pela Cecílio Rocha: 40 preços, 19 situações e 145 compradores",
              "Reservado e vendido passaram a ser a mesma coisa no mapa, com a mesma cor. O Garden fica com 88 disponíveis e 317 vendidos",
              "O nome do comprador aparece agora em 315 dos 317 vendidos, contra 183 antes",
              "Nenhum lote disponível está sem preço: os 88 têm valor de tabela",
              "O filtro Reservado some da legenda enquanto não houver lote nessa situação, e volta sozinho quando existir de novo",
            ],
            screen: "Portal do incorporador · Produtos · Masterplan do Garden",
          },
        ],
      },
    ],
    technical: {
      done:
        "Os 406 lotes do Garden viviam colados à mão dentro do HTML, sem gerador (diferente do Vale do Ouro). Entra `scripts/apolo/garden-atualizar-lotes.mjs`: lê a planilha do cliente, confere o cabeçalho antes de qualquer linha (ler xlsx durante o salvamento do Excel devolve coluna deslocada SEM erro), preserva os polígonos — que não existem no Excel e sem os quais o lote some do mapa em silêncio — e recusa lote sem polígono conhecido em vez de gravá-lo mudo. A planilha repete Q10 L01 em duas linhas idênticas, então são 405 lotes e não 406; a repetida é descartada, senão o polígono é desenhado duas vezes e o percentual por situação sai inflado. `Reservado` passou a mapear para o mesmo código de `Vendido`: na planilha do Garden reservado nunca significou reserva de alguém (111 lotes, nenhum com comprador), era lote fora de venda, e unificar libera o status Reservado para o significado novo, a unidade com proposta emitida e 48h de validade. ⚠️ O CONVERSOR DE VALORES QUASE FOI PARA O AR ERRADO: a primeira versão só tratava um ponto de milhar, e `R$ 1.102.000` virou 1.102. Peguei na conferência; agora `testarConversor()` roda uma bateria antes de gravar e aborta sem tocar no arquivo se algum caso falhar.",
      motivation:
        'Lucas, 12/08: "eles acabaram de me encaminhar a tabela toda corrigida, vamos precisar de atualizar os dados e tudo" e, sobre a situação, "o reservado passa vendido também, então vendido e reservado fica como vendido e recebe a mesma coloração".',
    },
    title: "Garden com a planilha revisada, e reservado virando vendido no mapa",
    type: "melhoria",
    version: "1.126.0",
  },
  {
    buildTag: "2026-08-11-simulador-tabela-oficial",
    deployedAt: "2026-08-11T14:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O plano de pagamento abre na tabela oficial, com o valor da unidade e a parcela mensal em destaque. Saíram os dois modos do topo",
              "Os planos com desconto mostram o valor do lote já com o desconto aplicado, e o preço de tabela logo abaixo",
              "Cada plano é editável na hora: entrada, reforços anuais, prazo e parcela. O ajuste vale só naquela proposta e não altera a tabela do empreendimento",
              "A proposta só é liberada quando a conta fecha o valor da unidade. Enquanto faltar, a tela diz quanto falta e o botão fica desligado",
              "Tabela nova do Garden: Normal, Investidor Parcelado (8% de desconto, entrada de 8% e até 84 parcelas) e Investidor (12% de desconto)",
              "A correção aparece por plano: Investidor é só IPCA, os demais são IPCA mais 6% ao ano",
              "Botão Visualizar proposta: mostra o documento pronto, com as logos, antes de gerar",
              "Gerar proposta pede nome e CPF do cliente, com o CPF conferido de verdade, e preenche o campo de assinatura",
              "Os três modos antigos continuam existindo, agora dentro de Proposta Personalizada",
            ],
            screen: "Portal do incorporador · Produtos · Plano de pagamento",
          },
        ],
      },
    ],
    technical: {
      done:
        "O modal do plano ganhou duas vistas: `ofMesa` (tabela oficial, o padrão ao abrir) e `persMesa` (a mesa de duas colunas que já existia). O motor financeiro NÃO foi tocado. A trava usa VALOR PRESENTE (`vpDe`), não soma nominal, com tolerância de R$ 1,00: com juros zero os dois coincidem, mas no dia em que o Garden cadastrar taxa a conta continua certa sozinha. O alvo é o preço do PLANO (tabela menos o desconto oficial), não a tabela cheia, senão o próprio plano da planilha seria invendável. Enquanto ninguém digita a parcela ela é derivada e fecha por construção; `tocouParcela` marca a edição manual e é aí que a trava morde. ⚠️ CADA PLANO GANHOU `id`: o Investidor Parcelado foi para 84 meses e passou a empatar com o Normal, e o código identificava plano pelo número de meses (`planoDe(84)`) — na Proposta Personalizada os dois viravam o mesmo botão, e escolher Investidor Parcelado traria o desconto do Normal (zero), R$ 34.400 a mais num lote de R$ 430.000, sem aviso nenhum. `planoDe(id, meses)` resolve por id com queda para o prazo, e as composições do otimizador passaram a carregar o id. A pré-visualização é uma folha branca com o layout do PDF, para o desenho ser aprovado antes de existir arquivo. O botão de emitir ainda NÃO emite e diz isso na tela, no lugar do `alert()` antigo que prometia proposta e não fazia nada.",
      motivation:
        'Lucas, 11/08, depois da reunião com a Cecílio Rocha: "vai aparecer primeiro a tabela oficial, dando destaque para o valor da unidade e a da parcela mensal", "não podemos deixar gerar nenhuma proposta quando esse não atingir o valor total da unidade" e "vamos substituir esses dois botões por um botão que vamos chamar Proposta Personalizada". A tabela nova e a correção por plano vieram na mesma conversa.',
    },
    title: "Simulador do Garden: a tabela oficial primeiro, e a proposta que só fecha somando a unidade",
    type: "melhoria",
    version: "1.125.0",
  },
  {
    buildTag: "2026-08-11-masterplan-sem-caixa",
    deployedAt: "2026-08-11T09:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O masterplan do Vale do Ouro deixou de ficar dentro de uma caixa: agora é só o desenho na tela, como um mapa",
              "Cada situação mostra o percentual: disponível, reservado e vendido sobre os lotes à venda (somam 100% entre si), e bloqueado sobre o loteamento inteiro",
            ],
            screen: "Portal do incorporador · Produtos",
          },
        ],
      },
    ],
    technical: {
      done:
        "O retângulo que aparecia em volta da planta NÃO era cor de fundo, era a `box-shadow` do `.palco` (0 10px 40px em preto a 55%). Ela é a sombra do RETÂNGULO do palco, não do desenho: no Garden passa despercebida porque a foto é retangular e preenche o palco, mas com a planta transparente do Vale do Ouro o desenho é um polígono e a sombra segue quadrada em volta dele. Desligada junto com o fundo do `.palco`, do `.plano` e da `.cena`, no bloco do tema claro. Passei três rodadas oferecendo cor de fundo antes de achar a sombra.",
      motivation:
        "Lucas, 11/08: \"não dá somente para ela existir sem esse retângulo? como se fosse um mapa? tem que ter um jeito\" — e tinha.",
    },
    title: "Masterplan sem caixa: o mapa solto na tela",
    type: "correcao",
    version: "1.124.0",
  },
  {
    buildTag: "2026-08-11-vale-do-ouro-planta-oficial",
    deployedAt: "2026-08-11T08:35:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Vale do Ouro com a planta oficial: sem moldura, sem fundo e sem as logos impressas. O desenho se apoia direto na tela, como acontece no Garden",
              "Lote bloqueado voltou a ser visível no mapa. Antes ele quase sumia contra o verde da planta",
              "Os 298 lotes conferidos um a um contra o desenho novo: todos caem sobre o lote certo",
            ],
            screen: "Portal do incorporador · Produtos",
          },
        ],
      },
    ],
    technical: {
      done:
        "A planta passou a ser o PNG oficial entregue pelo Lucas (9999x6118, transparente, sem logos), no lugar da arte de venda que era limpa por script. Isso aposentou `masterplan-planta-limpa.mjs`, que apagava as quatro marcas por componente conexo e recortava a moldura azul: com a arte transparente na origem, nada disso é preciso. Entra `masterplan-planta-vale-do-ouro.mjs`, que faz trim do alfa, reduz para 4400px e grava WebP (3,3 MB). ⚠️ O ENQUADRAMENTO É OUTRO, e os 298 polígonos vivem em coordenadas da arte antiga: em vez de recalcular 1.880 vértices, o `viewBox` do SVG aponta para a janela equivalente na arte velha (81 28 3652 2369) e as duas viram a mesma janela. Só é válido porque a proporção interna do desenho bate (desvio 0,06%), e o script TRAVA acima de 1,5% e confere lote a lote no fim: 298/298 sobre o desenho, 0 na rua. O palco do mapa perdeu o fundo (`.plano` e `.cena` transparentes): com planta recortada, o fundo do palco virava um retângulo branco em volta do terreno. E o bloqueado ganhou DUAS cores, porque marcador e preenchimento vivem sobre fundos opostos: `#64748b` no chip e no selo (sobre papel branco) e um véu `#e2e8f0` a 62% no mapa (sobre o verde-oliva #a1aa25 da planta, medido). Escurecer não separava: o véu claro fica a 160 de distância do fundo, contra 96 do cinza anterior.",
      motivation:
        "Lucas, 11/08, em sequência: \"tem esse preto ae que ficou horrivel\", \"tem como tirar o fundo azul?\", \"ainda tem um fundo branco, no garden não tem esse fundo branco\", \"os bloqueados ficou ruim, não da para ver\" e \"não tem como subir sem o palco do mapa?\". O PNG oficial foi ele quem ofereceu: \"você quer o png do mapa para refazer?\".",
    },
    title: "Vale do Ouro: a planta oficial no masterplan, sem moldura e sem palco",
    type: "melhoria",
    version: "1.123.0",
  },
  {
    buildTag: "2026-08-11-masterplan-claro-em-tela-cheia",
    deployedAt: "2026-08-11T07:50:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O masterplan abre em TELA CHEIA: antes ele entrava espremido numa faixa no meio da página e ficava do tamanho de uma miniatura",
              "Versão CLARA do mapa, na mesma paleta do portal. O desenho é o mesmo, o que mudou foi a cor",
              "Botão \"Voltar aos produtos\" no alto da tela, porque ali não há menu lateral. A tecla Esc faz o mesmo",
            ],
            screen: "Portal do incorporador · Produtos",
          },
        ],
      },
    ],
    technical: {
      done:
        "A tela do masterplan saiu do `<main>` do portal (maxWidth 1180) e virou camada `position: fixed; inset: 0`, com o body travado enquanto está aberta e Escape ligado — dentro de um iframe o voltar do navegador não sai, então sem botão o cliente fica preso. TEMA CLARO em `lib/apolo/masterplan-tema-claro.ts`, injetado pela rota que serve o arquivo: o A-INTERNO tem a paleta quase toda em tokens no `:root`, então redefinir os tokens vira a tela inteira sem tocar em uma medida sequer do desenho aprovado, e o arquivo original segue escuro para o Apolo interno. Os valores que estavam cravados assumindo fundo escuro foram tratados um a um: realce branco translúcido (some sobre branco) virou grafite translúcido, divisa quase preta virou a linha clara, o azul #cfe0ff do simulador virou azul escuro, e as tintas de texto de verde/âmbar/vermelho passaram a escurecer em vez de clarear. Medido na tela servida: data-uix-theme=light, --canvas #f7f8fa, --txt #121722, rail branco, 406 lotes intactos.",
      motivation:
        "Lucas, 11/08, vendo a primeira versão: \"ficou ruim, primeiro tem que seguir o esquema de cor do sistema. e outra está pequeno, não era assim que abrir o link, tem que usar a tela toda\", depois \"tem que fazer a versão claro dessa tela\" e \"essa tela não tem sidebar lateral, tem que ter um botão ou algo parecido para voltar a tela inicial do perfil\".",
    },
    title: "Portal do incorporador: masterplan em tela cheia e na versão clara",
    type: "melhoria",
    version: "1.122.0",
  },
  {
    buildTag: "2026-08-10-esteira-nao-volta-e-prevenda-so-se-habilitada",
    deployedAt: "2026-08-10T22:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "540 fichas voltaram a aparecer no Board: a fila estava servindo só 115 das 653 CADs, e 433 credenciados e 107 fichas em crédito reprovado tinham sumido da tela",
              "Aprovar e avançar agora GRAVAM antes de mover o card. Antes o card andava só na tela e a recarga devolvia o cliente para a etapa anterior",
              "Quando o servidor recusa a mudança de etapa, a tela diz o motivo em vermelho, em vez de mostrar o avanço que não aconteceu",
              "A ficha sem CAD ganhou o selo \"sem CAD\": é ela que reaparece em Validação a cada recarga, e agora dá para ver quem é e o que falta (o empreendimento no cadastro)",
              "A análise de crédito não roda mais numa ficha sem empreendimento: a consulta é paga e não teria onde gravar o resultado",
            ],
            screen: "Esteira de credenciamento (Board)",
          },
          {
            items: [
              "Crédito reprovado tem saída pela coordenação: no card em \"Crédito em revisão\", o botão roxo \"Aprovar com restrição (coordenação)\" libera a ficha anexando a evidência do de-acordo (PDF, PNG ou JPEG, até 3 MB, obrigatória)",
              "Fica registrado quem aprovou, quando, por quê, e a evidência vai para a pasta do cliente",
              "São 157 fichas paradas em crédito reprovado esperando essa decisão, a mais antiga desde 23/07",
            ],
            screen: "Análise de crédito",
          },
          {
            items: [
              "Pré-venda só existe onde ela está habilitada COM valor de PIX definido. Onde não está, a etapa some da trilha e da coluna do Board, em vez de aparecer e receber cliente",
              "Vale do Ouro Lino, Vale do Ouro Cecílio e Garden estavam com a cobrança de R$ 1.000 ligada sem ninguém ter ligado: era o padrão do sistema, e o primeiro cliente aprovado cairia nela",
              "Desligar a pré-venda de um empreendimento agora tira do ar as fichas que já estavam nela, na hora, e a tela diz quantas saíram e para onde",
            ],
            screen: "Empreendimentos",
          },
          {
            items: [
              "O card do empreendimento abre o masterplan DENTRO do portal, com a marca do cliente em volta: mapa, filtros, tabela de lotes e simulador, a mesma tela que o time da Careli usa",
              "Vale do Ouro entrou no mapa: 298 lotes desenhados um a um, com situação e preço vindos do C2X",
              "A planta do Vale do Ouro está limpa, só o desenho do loteamento, sem as logos impressas e sem a moldura",
              "Lote bloqueado ganhou cor própria (cinza), separado de reservado: dos 110 que apareciam como reservados, só 2 eram reserva de verdade",
              "As telas do masterplan saíram do endereço aberto e agora exigem login: quem não tem acesso ao empreendimento não abre o mapa dele",
            ],
            screen: "Portal do incorporador · Produtos",
          },
        ],
      },
    ],
    technical: {
      done:
        "(1) BOARD, perna (b): `.in(\"id\", 653 uuids)` montava URL de 25.697 chars e o PostgREST devolvia 400 — medido em produção hoje com a service key. Como o código só desiste quando as DUAS pernas falham, a falha era muda: 115 de 653 CADs servidas (433 credenciados + 107 em revisão sem card). Passou a ler em LOTES DE 100, em paralelo. (2) SERASA: `consultar/route.ts` chamava `atualizarEtapa` em :343 e :489 e ignorava `semCad`/`error`, devolvendo `etapa` = o ALVO calculado. Sem linha em `apolo_esteira`, o Board monta o card com `etapa: null` e `colunaDoItem` o joga em Validação a cada carga — caso real: 4 consultas PAGAS na mesma ficha (04/08, 06/08, 07/08 e 10/08), tela dizendo \"avançou\" nas quatro. Agora barra ANTES de gastar (409 quando a CAD não tem empreendimento), devolve `etapaNaoGravada` quando a consulta já saiu, e não dispara mais o aviso ao coordenador sem gravação (fecha a task #38). (3) BOARD/tela: `onAvancar` era `progresso++` puro, e a semeadura era `{...semeado, ...atual}` (sessão vencia o servidor), então nada corrigia. Tudo passa por `moverEtapa`: grava, lê a resposta, e só então mexe na tela; o banco passou a vencer a sessão na semeadura de progresso E de desvios. O botão genérico sumiu da Análise de crédito (dizia \"Consultar Serasa\" e só empurrava o card para a Pré-venda). (4) PRÉ-VENDA: `resolverPrevendaHabilitada` era fail-open em três saídas (sem empreendimento, sem linha, erro) e o default da coluna na 0071 é TRUE — 36, 37 e 39 amanheceram ligados com `valor_pix` NULO. Agora é FAIL-CLOSED e exige flag + valor > 0, regra isolada em `prevendaLigadaNaSetting` e usada tanto por ficha (servidor) quanto em lote (Board). `plantarFichaPrevenda` (bancada) e `gerar-pix` passaram a respeitar o toggle — eram os dois caminhos que escapavam. (5) VARREDURA: desligar a pré-venda agora move as CADs que estavam nela (reprovado -> revisao, resto -> credenciado), em lotes de 100 e com rastro em `apolo_audit_events`; era feito na mão por SQL, duas vezes em 09/08, 146 CADs. (6) Override: `registrarOverrideCredito` deixou de engolir erro e devolve o resultado; teto do upload caiu de 8 MB (maior que o corte da Vercel) para 3 MB, com mensagem. (7) PORTAL DO INCORPORADOR: as telas do masterplan interno saíram de `public/` (estático não passa por gate: /garden/interno-3634d57f.html respondia 200 sem cookie, com preço de 406 lotes e 186 nomes de comprador dentro) para `apps/hub/masterplans-internos/`, servidas por `GET /api/incorporador/masterplan?code=` que confere a sessão assinada E traduz código -> id para validar o escopo (VOL devolve 404 para o Cecílio). `outputFileTracingIncludes` no next.config para o arquivo subir no bundle da função. A aba Produtos abre a tela num quadro, sem sair do portal. (8) MASTERPLAN DO VALE DO OURO: 298 polígonos extraídos de MASTERPLAN_VALE_DO_OURO.svg pelo `inkscape:label` (4 lotes têm id divergente do label; pelo id trocariam de lugar), conferidos 298/298 contra o C2X e 298/298 caindo sobre área de lote. Planta recortada por componente conexo (41 ilhas apagadas: as 4 logos impressas e a moldura), com o recorte indo para o `viewBox` do SVG — assim nenhum dos 1.880 vértices precisou ser recalculado. Quarto estado (Bloqueado) porque 108 dos 110 'reservados' eram lotes fora de venda. Planos comerciais lidos do C2X, com o juros do PLANO NORMAL (0,7207% a.m.) que a primeira leitura tinha zerado. ⚠️ O GARDEN NÃO É GERADO: os dados dele são da planilha do Lucas, não do C2X (o cadastro do Garden no legado é de pré-lançamento). 24 testes novos.",
      motivation:
        "Lucas, 10/08: \"cliente que já teve analise de credito feito voltando para validação... cliente não volta no fluxo. e outra, precisamos ter um campo para aprovar cadastro de cliente que tiveram analise de credito reprovado, nesse campo temos que colocar a evidência, eu já havia solicitado isso. e outra, cliente caindo de novo em pre-venda, pre-venda só existe se estiver habilitado\". A apuração no banco mostrou que a regressão NÃO está gravada (zero fichas com crédito em validação, zero `etapa_change` para validação): ela é de tela, produzida por ações que não gravavam e por uma fila que servia 18% das CADs. O campo do item (2) já existia em produção desde 05/08 e nunca foi usado uma vez — nem anunciado.",
    },
    title:
      "Apolo: o cliente para de voltar no fluxo, pré-venda só existe se estiver habilitada, e o masterplan entra no portal do incorporador",
    type: "correcao",
    version: "1.121.0",
  },
  {
    buildTag: "2026-08-10-iris-email-preso-e-janela-de-24h",
    deployedAt: "2026-08-10T15:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "E-mail de cliente voltou a entrar: dois e-mails estavam presos desde ontem e falhavam a cada 5 minutos, 240 vezes por dia",
              "O atendimento não mostra mais \"janela aberta\" quando o cliente ainda não respondeu, que era o que fazia a mensagem morrer depois de enviada",
              "O erro de envio agora explica o que houve em português, no lugar de \"Re-engagement message\"",
              "O botão de reabrir conversa parou de oferecer modelo que a Meta ainda não aprovou",
            ],
            screen: "Atendimento",
          },
        ],
      },
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Portal do incorporador no ar: o dono do loteamento entra com a marca dele e vê os empreendimentos que tem com a Careli",
            ],
            screen: "Portal do incorporador",
          },
        ],
      },
    ],
    technical: {
      done:
        "(1) GMAIL: `parseGmailMessage` mandava o header `Date` CRU (\"Sun, 9 Aug 2026 09:11:25 -0300 (BRT)\") para coluna timestamptz — 22007 em toda ingestão, 240/dia, duas mensagens presas desde 09/08 repetindo a cada ciclo do cron. Agora `internalDate` (epoch do Gmail, já ISO) é a fonte e o header passa por `paraIso()`; data inválida vira null e a mensagem ENTRA. As presas seguem unread, então voltam sozinhas. 7 testes novos. (2) JANELA DE 24h: `getIrisCustomerServiceWindow` priorizava `metadata.customerServiceWindowOpenedAt`, gravado por `lib/apolo/acao-atendimento.ts` no disparo do TEMPLATE de convite — só que template não abre janela pela regra da Meta (o próprio metadata dizia `awaiting_customer_reply`). Tela pintava verde, liberava o textarea, e a Meta recusava com 131047. Corrigido nas DUAS pontas: a origem parou de gravar e a leitura parou de aceitar, o que alcança os 246 tickets que já nasceram com o carimbo falso (245 sem inbound). (3) `META_DELIVERY_ERROR_LABELS` casava só por código e as 38 falhas de 30 dias têm `code: null` — entrou `META_DELIVERY_ERROR_BY_TITLE` com os 5 títulos reais medidos no banco. (4) `isMetaTemplateUnavailableStatus` passou a barrar PENDING/IN_REVIEW: 3 dos 6 modelos oferecidos no reabrir voltariam 132001.",
      motivation:
        "Lucas, 10/08: \"estamos varios erros na iris, analisa por favor\" e depois \"mas foca na mensagens que não estamos conseguindo enviar\", com print de 8 atendimentos em ERRO DE ENVIO. O diagnóstico separou o que é defeito nosso do que é conta a pagar: 9 das falhas são \"Business eligibility payment issue\", pendência financeira na conta do WhatsApp Business, que nenhum código resolve.",
    },
    title: "Iris: e-mail preso volta a entrar e a janela de 24h para de mentir",
    type: "correcao",
    version: "1.120.0",
  },
  {
    buildTag: "2026-08-10-bi-segue-a-situacao-do-lote-no-c2x",
    deployedAt: "2026-08-10T08:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O BI agora mostra a MESMA situação que aparece na tela do C2X: em negociação e vendido contam como vendido, reserva é reserva, disponível é disponível",
              "Família Lino: 93 vendidos, 1 reserva e 6 disponíveis, batendo lote a lote com o C2X (antes o painel dizia 96, 4 e 2)",
              "O ranking de imobiliária e o perfil do comprador voltaram a enxergar as vendas em assinatura: eram 41 vendas de Cecílio Rocha fora da conta",
              "Oito vendas que estavam sendo contadas duas vezes no ranking saíram da conta: a mesma venda aparecia no registro antigo do lote e no atual",
              "Nova conferência automática: se um lote ficar marcado como vendido depois da proposta ser cancelada, o painel avisa embaixo da barra de estoque",
              "O BI único do lançamento saiu do ar: agora são só os dois painéis por coordenação, Cecílio Rocha e Família Lino",
            ],
            screen: "BI do Vale do Ouro",
          },
        ],
      },
    ],
    technical: {
      done:
        "Duas fontes discordavam: `statusUnidades` decidia o desfecho pela PROPOSTA e a tela do C2X mostra o `sale_status_id` da UNIDADE. Agora estoque, card do topo e reservas saem todos de `SITUACAO_DO_LOTE` (3+4 -> Vendido, 2 -> Reservado, 5 -> Bloqueado, resto -> Disponível), e `PROPOSTA_DO_LOTE` foi removido. Conferido: VOL 93+1+6=100, VOC 84+1+5=90, VLO 149+37+4=190. Achado no caminho: `VENDA` era `stage IN (3,9)` e perdia as 41 propostas do VOC em 'Em assinatura' (5), o que subcontava ranking, perfil, contratos e cobrança; virou `IN (3,4,5,6,9)` e agora propostas vivas = unidades vendidas nos três recortes (177/84/93). Como contar pela unidade cria o risco inverso (proposta cancelada não libera o lote sozinha), entrou `sqlDaCoerencia()`: quatro contadores de divergência lote x proposta no payload, exibidos como nota no painel. Medido hoje: 0, 0, 0, 0. Segundo achado: as \"órfãs do 35\" não eram órfãs. As 8 propostas vivas do master têm gêmeo na carteira com a MESMA venda e o MESMO cliente (VLO0104/4738 <-> VOC0104/4738), então o JOIN_GEMEO/CARTEIRA_DA_PROPOSTA fazia dupla contagem em ranking, perfil, planos, contratos e cobrança: ranking somava 89 no VOC contra 84 do card, e 185 contra 177 no lançamento inteiro. O master saiu de TODAS as consultas (LISTA_ENTERPRISES, JOIN_GEMEO e filtroCarteira removidos; `recorteDaCarteira` devolve só `listaUnidades`), e o duelo Cecílio x Lino passou a contar unidade. Agora todo agregado fecha com o card: VOC 84 em estoque/ranking/sexo/planos/idades/parcelas, VOL 93. Por ordem do Lucas (\"pode excluir esse BI unico\"), public/bi/vale-do-ouro.html foi apagado e o campo `porTipo` (duelo Cecílio x Lino) saiu do motor junto, que era a única tela que o consumia: uma consulta a menos por ciclo de 60s. A rota /api/publico/bi/vale-do-ouro continua liberada no proxy.ts, servindo os dois recortes por ?carteira=; a URL /bi/vale-do-ouro.html passa a responder 404.",
      motivation:
        "Lucas, 09/08, comparando o painel com a tela do C2X lado a lado: \"existe somente os status: Vendido - Reserva - Disponivel... teria que ser 93 vendido, 6 disponivel, 1 [reserva]\". E no minuto seguinte: \"proposta podem ser canceladas, temos que ficar de olho nas atualizações\" — daí o vigia, em vez de trocar um número silenciosamente errado por outro.",
    },
    title: "BI do Vale do Ouro passa a contar pela situação do lote no C2X",
    type: "correcao",
    version: "1.119.0",
  },
  {
    buildTag: "2026-08-07-estoque-conta-lote-nao-proposta",
    deployedAt: "2026-08-07T08:15:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O estoque do BI passa a contar LOTE, não proposta: vendidos, reservados e disponíveis agora sempre somam o total de lotes à venda",
              "Corrigido o número de lotes disponíveis, que aparecia bem maior que a realidade: mostrava 28 quando só 5 estão livres de verdade",
              "Lote com reserva aberta não aparece mais como disponível",
              "Os nomes das carteiras na tela agora são Cecílio Rocha e Família Lino",
            ],
            screen: "BI do Vale do Ouro",
          },
        ],
      },
    ],
    technical: {
      done:
        "O painel somava 157 vendidas + 46 reservas + 28 disponíveis = 231 sobre 190 lotes. Duas causas, as duas de contar a entidade errada: (1) RESERVA vinha de PROPOSTA em estágio 1, e 14 delas apontavam para lote que JÁ TEM VENDA (reserva antiga sem baixa), então o mesmo lote entrava como vendido e reservado; (2) DISPONÍVEL vinha do sale_status_id do cadastro, sem olhar proposta viva, e os 9 lotes vendidos que ficaram no master têm o gêmeo na carteira marcado como Reservado. Agora `statusUnidades` e `reservas` percorrem o LOTE COMERCIAL (uma linha por lote físico) e decidem por precedência via PROPOSTA_DO_LOTE(): tem venda -> Vendido; senão tem reserva -> Reservado; senão Disponível. O EXISTS casa as propostas do próprio lote E as do master pelo NÚMERO DO LOTE (SUBSTRING(name,4)), mesma regra do gêmeo. Validado nos três recortes: todos 157+28+5=190, VOC 76+10+4=90, VOL 81+18+1=100.",
      motivation:
        "Lucas, 07/08: \"tem alguma coisa errada, pois tínhamos somente 190 lotes para vendas e o resto estava bloqueado, somando os valores não dá isso\". Ele estava certo: eu tinha visto o sintoma (avisei que o disponível estava otimista) e tratei como imprecisão a acertar depois, quando era erro de cálculo. Risco real de corretor oferecer lote já reservado no salão.",
    },
    title: "Estoque do BI passa a contar lote, e o disponível deixa de mentir",
    type: "correcao",
    version: "1.118.0",
  },
  {
    buildTag: "2026-08-07-bi-por-carteira-e-estoque-real",
    deployedAt: "2026-08-07T07:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Novo painel só da Coordenação Cecílio e outro só da Coordenação Lino, além do painel do lançamento inteiro que já existia",
              "O percentual de vendas passa a ser sobre os lotes postos à venda: mostrava 53% quando o real é 83%, porque contava junto 108 lotes que nunca foram lançados",
              "Os 108 lotes ainda não lançados continuam visíveis, agora como número à parte",
              "Nota nova explicando por que a barra de estoque e os totais divergem: 9 vendas e 32 reservas seguem no registro antigo do lote",
            ],
            screen: "BI do Vale do Ouro",
          },
        ],
      },
    ],
    technical: {
      done:
        "lib/prometeu/bi-vale-do-ouro.ts ganhou o tipo CarteiraDoVale (todos|voc|vol) + normalizarCarteira + recorteDaCarteira; montarBiValeDoOuro(carteira) serve os TRÊS recortes com o mesmo SQL. A rota /api/publico/bi/vale-do-ouro aceita ?carteira=voc|vol (MESMA rota, então o proxy.ts não muda e o cache de 60s continua valendo). ⚠️ AS ÓRFÃS DO MASTER: sobraram no VLO(35) 9 vendas e 32 reservas que não migraram; filtrar a carteira só por enterprise_id sumiria com elas dos DOIS painéis (soma daria 148 em vez de 157). A atribuição é pela carteira do LOTE GÊMEO, casado por SUBSTRING(name,4): VLO0104 -> VOC0104(37) ou VOL0104(36). NÃO se usa o campo tipo (interna/externa): ele acerta hoje por coincidência estrutural e quebraria em silêncio num recadastro. Provado no C2X: os 298 lotes do master têm exatamente 1 gêmeo cada, COUNT(*) = COUNT(DISTINCT unidade) nos três recortes (157/76/81) e nenhum lote tem proposta viva no master e na carteira ao mesmo tempo. DENOMINADOR: separados os lotes COMERCIAIS (price > 1) do estoque NÃO LANÇADO (price <= 1 e sale_blocked); os 108 já estavam assim no 35 antes da divisão e nenhum tem proposta. Páginas: public/bi/vale-do-ouro-voc.html e -vol.html copiadas da aprovada (mesmo CSS, sem o bloco de duelo, que só faz sentido no unificado). Conferência no MySQL: VOC 76 + VOL 81 = 157 vendas e VGV 10.992.544 + 12.007.185 = 22.999.729, idêntico ao recorte todos.",
      motivation:
        "Lucas, 07/08: \"o BI está todo errado, temos que refazer considerando agora o VOC e VOL\" e depois \"quero fazer um painel para cada um\". A investigação mostrou que o total já somava as três carteiras corretamente; o que distorcia era contar os 108 lotes nunca lançados como estoque, o que fazia o lançamento parecer 53% vendido.",
    },
    title: "BI do Vale do Ouro ganha um painel por coordenação",
    type: "melhoria",
    version: "1.117.0",
  },
  {
    buildTag: "2026-08-05-corretor-fora-da-fila-e-vinculo-visivel",
    deployedAt: "2026-08-05T14:05:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cadastro de corretor não aparece mais na fila de validação: 15 saem da tela",
              "Excluir um vínculo agora some da lista de verdade; antes o vínculo excluído continuava aparecendo e o botão parecia não funcionar",
              "Quando não dá para excluir, a tela avisa o motivo em vez de não fazer nada",
            ],
            screen: "Board e CRM 360",
          },
          {
            items: [
              "Naturalidade e nacionalidade do cônjuge abrem para digitar quando a leitura do documento não traz",
              "A revisão mostra a imobiliária e o corretor da CAD enviada pelo link público; antes o vínculo aparecia em branco",
            ],
            screen: "Cadastro e portal de CAD",
          },
        ],
      },
    ],
    technical: {
      done:
        "1) CORRETOR NA FILA, o SEGUNDO portão: /api/apolo/board monta a fila de DUAS fontes, e a segunda (apolo_entities com status='review' e source='apolo') não olha a esteira. Barrar só a gravação na esteira dava impressão de resolvido e a tela seguia igual. A consulta ganhou `.or(\"metadata->>bornRole.is.null,metadata->>bornRole.neq.corretor\")` — o is.null preserva entidades antigas sem bornRole, que um neq puro descartaria (NULL não é \"diferente de\" nada em SQL). Medido: 110 na fila, 15 são corretor e saem. 2) VÍNCULO EXCLUÍDO CONTINUAVA NA TELA: excluir ARQUIVA a linha (status 'archived') para manter histórico, mas lib/apolo/server.ts trazia todos os status; agora filtra archived antes do map. A rota de archive já ignorava arquivados e devolvia 404 na segunda tentativa, e relationships-panel.tsx engolia a falha sem `else` — passou a avisar, com mensagem específica para o 404. 3) CÔNJUGE: os dois campos viraram CampoDoDocumento, fechando o último dos três blocos (titular e sócio já tinham). 4) REVISÃO PÚBLICA: PublicoConfig ganhou imobiliariaNome/corretorNome, o PortaoCorretor passa os dois no onValidado e StepRevisao os exibe; no público a lista de imobiliárias (que resolve o rótulo no interno) não é carregada e não há rota pública que a liste, por isso o campo vinha vazio. 295 testes.",
      motivation:
        "Lucas testando em 05/08: cadastrou um corretor e ele apareceu na validação mesmo depois da primeira correção; o botão de excluir vínculo parecia morto (na verdade já tinha arquivado, e a tela continuava mostrando); a revisão do link público não trazia imobiliária nem corretor; e o cônjuge tinha os mesmos campos travados que já corrigimos no titular e no sócio.",
    },
    title: "Corretor sai da fila, vínculo excluído some e revisão mostra quem trouxe a CAD",
    type: "correcao",
    version: "1.116.0",
  },
  {
    buildTag: "2026-08-05-cliente-pj-no-c2x-e-cad-que-explica",
    deployedAt: "2026-08-05T13:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cliente pessoa jurídica agora sobe para o C2X como CLIENTE, com CNPJ e razão social; antes toda empresa era enviada como imobiliária, e por isso nenhuma chegava lá",
              "O envio passa a decidir pelo PAPEL do cadastro, não por ser pessoa física ou jurídica",
              "O aviso no card agora acende também para a CAD credenciada que NUNCA foi tentada no C2X, não só para a que falhou",
            ],
            screen: "Board e envio para o C2X",
          },
          {
            items: [
              "A tela diz o que falta para avançar, em vez de só deixar o botão apagado: nome, CPF, naturalidade, escolaridade, renda, o que estiver faltando",
              "Cadastro de corretor não entra mais na fila de validação: corretor não tem documento de comprador para validar",
              "Naturalidade e nacionalidade do sócio abrem para digitar quando a leitura não traz (a CNH não tem naturalidade impressa)",
              "O endereço é completado pelo CEP mesmo quando ele vem da leitura do comprovante, não só quando digitado",
            ],
            screen: "Cadastro e portal de CAD",
          },
          {
            items: [
              "Textos do portal explicam o passo a passo: de quem é o CPF pedido, qual documento anexar em cada etapa e o que ter em mãos antes de começar",
            ],
            screen: "Portal público de CAD",
          },
          {
            items: [
              "A barra de etapas acompanha o crédito aprovado que vai direto para credenciado quando a pré-venda está desligada",
            ],
            screen: "Análise de crédito",
          },
        ],
      },
    ],
    technical: {
      done:
        "1) CLIENTE PJ: nasceu perfilPorPapel() em c2x-write.ts e perfilDaFicha() em c2x-write-server.ts, usadas TANTO pelo filtro da fila QUANTO pela montagem do payload (uma fonte só). O perfil sai de metadata.bornRole (cobertura medida: 109/109 das entidades source=apolo), com de-para prospect→cliente(2), imobiliaria→imobiliaria(6), incorporador→incorporador(3); corretor/colaborador/fornecedor/parceiro NÃO sobem. montarPayloadCliente ganhou o desvio `if (c.isCompany)` com cnpj/social_name/fantasy_name/person_type jurídica, e montarDados passou a ler metadata.cadastro.socios para preencher o que o C2X pede de pessoa. O formato-alvo não é suposição: o C2X já tem 80 users com profile_id=2 + person_type_id=2 exatamente assim. ⚠️ O caminho PF foi verificado byte a byte contra o HEAD e está IDÊNTICO; teste congela o payload PF para acusar regressão futura. Filtro novo medido em produção: 87 candidatas viram 78, entram as 6 PJ prospect credenciadas (incl. Vovo Braga) e saem os 15 corretores. 2) ALERTA: a decisão saiu da rota e virou função pura em lib/apolo/c2x-alerta-board.ts (alertaC2xDaCad) com 3 estados (erro / sem_confirmacao / nunca_tentado), 8 testes; cobre os 97 credenciados que não tinham linha em apolo_c2x_sync e por isso eram invisíveis. 3) O QUE FALTA NA TELA: podeAvancarPf/Pj passaram a derivar de uma LISTA de faltantes, e a mesma lista alimenta o aviso, então botão e aviso nunca discordam. 4) Corretor fora da esteira: a gravação em apolo_esteira passou a checar o papel (era só empreendimento+imobiliária, e o cadastro de corretor tem os dois); 12 corretores removidos da fila, os 5 que também são compradores preservados. 5) Board: o índice da barra passou a sair de INDICE_POR_ETAPA, o mesmo mapa do reload. 295 testes.",
      motivation:
        "Lucas testando o fluxo real em 05/08: a Vovo Braga (padaria, cliente PJ) chegou a credenciado e não apareceu no C2X; um cadastro de corretor caiu na fila de validação sem ter o que validar; e um cadastro PF ficou travado com o botão apagado sem dizer o que faltava. Palavras dele: \"seria ótimo colocar um aviso do que falta a ser preenchido\".",
    },
    title: "Cliente empresa chega ao C2X, e o cadastro diz o que falta",
    type: "correcao",
    version: "1.115.0",
  },
  {
    buildTag: "2026-08-05-cad-aceita-20mb-e-completa-endereco",
    deployedAt: "2026-08-05T11:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Documento da CAD agora aceita até 20MB por arquivo: contrato social escaneado em PDF passa direto, sem precisar trocar por foto",
              "O arquivo grande sobe direto para o armazenamento, sem passar pelo formulário; o pequeno continua indo como sempre",
              "Frente e verso do mesmo documento continuam virando um PDF único, como antes",
              "Quando o documento passa de 20MB, a mensagem diz o tamanho real do arquivo e o que fazer, e nada do que foi preenchido se perde",
            ],
            screen: "Cadastro e portal de CAD",
          },
          {
            items: [
              "Endereço lido de comprovante agora é completado pelo CEP: antes, quando a leitura vinha ruim, o campo de rua ficava com o texto errado do documento",
              "Naturalidade e nacionalidade do sócio abrem para digitar quando a leitura não traz (a CNH não tem naturalidade impressa, então isso acontece bastante)",
            ],
            screen: "Sócios e endereço",
          },
        ],
      },
    ],
    technical: {
      done:
        "UPLOAD EM DOIS CAMINHOS (estratégia definida pelo Lucas: 'se for um arquivo grande ele vai direto, se não segue o fluxo'). O documento que cabe no corpo continua viajando em base64 no JSON, byte a byte como antes; o que não cabe sobe por signed upload URL (mesmo padrão já em produção no Prometeu PA e nos anexos do Hermes) e viaja como referência (storagePath + sizeBytes). A escolha é POR CATEGORIA (categoriasParaUploadDireto soma o base64 da categoria), então RG frente+verso vão sempre pelo mesmo caminho e o agrupamento em PDF único é preservado: quando a categoria vai pelo caminho direto, o servidor baixa do Storage e junta com o mesmo juntarEmPdf; acima de 24MB somados vira arquivo por página COM aviso na tela, nunca em silêncio. Novas rotas /api/apolo/cadastro/upload-url e /api/publico/cad/upload-url só ASSINAM (não recebem arquivo); o caminho é montado no servidor a partir do dono da sessão (prefixoUploadDireto + uuid + nome sanitizado), nunca do que o cliente manda, e as TRÊS rotas de salvar validam com caminhoUploadDiretoValido. A pública exige a sessão assinada (x-cad-sessao) e ganhou balde de rate-limit próprio. uploadApoloDocument confere o tamanho REAL com .info() e move do staging para a pasta da entidade antes de criar a linha: se o arquivo não estiver lá, não nasce documento com link quebrado. validarDocumentosObrigatorios passou a aceitar as DUAS formas de anexo (fileBase64 OU storagePath) e continua recusando quando não há nenhuma. Bundle antigo em cache segue funcionando. Também: useEffect que dispara a busca de CEP quando o endereço vem do OCR (antes só rodava se o operador digitasse), e CampoDoDocumento aplicado à naturalidade/nacionalidade do sócio. 267 testes.",
      motivation:
        "Lucas, 05/08, cadastrando a Vovo Braga pelo link público: o contrato social em PDF somava 3,8MB e o envio barrava em 3,2MB, obrigando a trocar o PDF por foto. Pedido dele: 'deixa o padrão 20MB para documentos'. Só aumentar o número faria o envio estourar o limite de corpo da Vercel e virar erro seco no fim do cadastro, daí os dois caminhos. No mesmo cadastro, o comprovante do sócio foi lido com 58% de confiança e trouxe 'CPF/CNPJ:.' no lugar da rua, e a naturalidade do sócio ficou travada sem como preencher.",
    },
    title: "CAD aceita documento de 20MB e completa o endereço pelo CEP",
    type: "melhoria",
    version: "1.114.0",
  },
  {
    buildTag: "2026-08-05-cad-chega-no-c2x-e-avisa-quando-falha",
    deployedAt: "2026-08-05T08:50:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A CAD credenciada pelo PIX agora sobe sozinha para o C2X: antes só subia quando a etapa era movida pelo Board, e quem era credenciado pelo pagamento ficava de fora sem ninguém perceber",
              "Novo aviso na CAD que não conseguiu subir para o C2X: um ícone no card mostra o motivo (falta escolaridade, regime de bens, cliente sem imobiliária e por aí vai)",
              "O ícone também avisa quando o C2X respondeu que deu certo mas o cadastro não apareceu lá, que é o caso mais traiçoeiro porque parece sucesso",
            ],
            screen: "Board e envio para o C2X",
          },
          {
            items: [
              "Naturalidade virou campo obrigatório: sem ela o C2X recusa o cadastro, e a nacionalidade é preenchida sozinha a partir da cidade",
              "Quando a leitura do documento não traz a naturalidade, o campo abre para digitar e continua digitável enquanto se escreve",
              "Cadastro de empresa (PJ) pelo link público do corretor volta a avançar: o botão Confirmar e avançar ficava travado esperando a imobiliária, que no link já vem do próprio corretor",
            ],
            screen: "Cadastro e portal de CAD",
          },
          {
            items: [
              "Só quem tem permissão de edição altera os ajustes do empreendimento (pré-venda, análise de crédito, limite e valor do PIX); antes quem tinha acesso apenas de leitura conseguia mudar",
            ],
            screen: "Empreendimentos",
          },
        ],
      },
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "Se o preparo da sala falhar, aparece a mensagem do erro em vez de deixar a tela carregando para sempre",
            ],
            screen: "Sala de vídeo",
          },
        ],
      },
    ],
    technical: {
      done:
        "1) SEGURANÇA: as sondas /api/apolo/c2x-sync/obrigatorios e /unidades-sonda aceitavam `host` no CORPO e usavam esse host como destino do fetch que leva o token de escrita do C2X nos headers — sessão admin comprometida extraía a credencial de produção. Agora o destino sai da env e o corpo só pode PEDIR um host de uma allowlist (resolverHostSonda em lib/apolo/c2x-integracao.ts), que devolve a constante canônica, nunca o texto do corpo; host não permitido = 400 ANTES de qualquer fetch. 3 testes de regressão cobrem usuário embutido na URL, sufixo, porta trocada e downgrade para http. 2) PIX→C2X: aoEnviarPixPrevenda e aoConfirmarPagamentoPrevenda gravavam etapa='credenciado' por escrita direta, fora de atualizarEtapa, então o gancho subirParaC2xAoCredenciar nunca rodava (mesma classe do furo que já haviam remendado só para a fila do Prometeu). Passaram a chamar o envio best-effort, e no webhook do Asaas ele roda DEPOIS da fila e cobre também a saída antecipada de 'sem evento ativo' — o webhook tem teto de 30s e não reprocessa, então o lugar na fila pela hora do pagamento vem primeiro. 3) ALERTA: /api/apolo/board lê apolo_c2x_sync por STATUS (não por .in() com centenas de ids, que estoura a URL do PostgREST) e o Board ganhou o selo SeloC2x; motivoLegivel() troca o `<br>` do Rails por '; ' (13 das 41 falhas em produção vinham com a tag crua). 4) Naturalidade obrigatória em validarCamposMinimos (servidor, as duas rotas) e em podeAvancarPf; novo CampoDoDocumento decide ReadField x TextField UMA VEZ na montagem — o ternário por valor travava o input na primeira letra digitada e criava beco sem saída. 5) PATCH/POST de empreendimentos/settings passaram de authorizeApoloRead (que inclui viewer) para authorizeApoloWrite. 6) Chronos: gate do host passou a depender do isHost RESPONDIDO pelo servidor, não do Bearer enviado, e a falha no preparo sai do loader mostrando o erro. Migration 0082 (apolo_credito_overrides) aplicada. 265 testes passando.",
      motivation:
        "Lucas, 05/08: não conseguia avançar o cadastro da Vovo Braga (PJ) pelo link público, e pediu um alerta visual para quando uma CAD não subir para o C2X. A investigação mostrou que o problema era maior: 36 CADs com erro e 5 aceitas sem confirmação estavam gravadas em apolo_c2x_sync sem ninguém ver, o fluxo principal do negócio (PIX pago credencia) nunca chamava o envio ao C2X, e as sondas de diagnóstico entregavam o token de produção para qualquer host informado no corpo.",
    },
    title: "CAD credenciada chega ao C2X, e avisa na tela quando não chega",
    type: "correcao",
    version: "1.113.0",
  },
  {
    buildTag: "2026-08-04-cad-exige-obrigatorios",
    deployedAt: "2026-08-04T16:45:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A CAD não sobe mais sem os documentos e dados obrigatórios: se faltar identificação, comprovante de endereço ou algum campo, o envio é barrado na hora",
              "O botão de enviar mostra o que está faltando, em vez de deixar submeter e cair em correção depois",
              "A leitura automática do documento continua como era: se não ler, os campos abrem para preencher à mão — o que trava é documento ou dado faltando, nunca a leitura",
              "Vale para o link público do corretor e para o cadastro manual interno",
            ],
            screen: "Cadastro e portal de CAD",
          },
        ],
      },
    ],
    technical: {
      done:
        "Novo módulo lib/apolo/cadastro-obrigatorios.ts como fonte única da regra (requisitosDocumentos, validarDocumentosObrigatorios, validarCamposMinimos), espelhando o que o wizard já exigia para avançar: PF = identificacao + comprovante_endereco, mais certidao/identificacao_conjuge conforme estado civil; PJ = cartão CNPJ + contrato_social + documento de sócio. A trava roda no SERVIDOR (400 antes de criar a entidade) em /api/publico/cad/salvar e /api/apolo/cadastro/salvar — as duas tinham o mesmo furo, validavam só tamanho e quantidade. No cliente, o botão Enviar ganhou disabled + lista do que falta. A validação conta o ARQUIVO anexado (fileBase64 presente), nunca o sucesso do OCR nem score de qualidade — preserva a regra do v1.105.0 (MOST não trava). 20 testes novos, 244 no total.",
      motivation:
        "Em 04/08, 12 clientes subiram CAD pelo link só com o PDF do formulário, sem identificação e sem comprovante — o portal aceitava e marcava correção depois. Willian Jones Pereira foi o caso que o Lucas apontou. Regra dele: não pode subir sem todos os dados obrigatórios preenchidos.",
    },
    title: "CAD não sobe mais sem documento e sem dado",
    type: "correcao",
    version: "1.112.0",
  },
  {
    buildTag: "2026-08-04-apolo-dono-do-cadastro",
    deployedAt: "2026-08-04T13:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O cadastro feito no Apolo para de ser desfeito pela sincronização do C2X: o que a equipe preenche e corrige aqui fica",
              "A carteira, o financeiro e as vendas continuam vindo do C2X normalmente, atualizados como sempre",
              "Fichas de cliente, imobiliária e corretor que existem só no C2X continuam nascendo aqui, para nenhuma carteira ficar sem dono",
            ],
            screen: "CRM 360 e cadastro",
          },
          {
            items: [
              "A mensagem de CAD já existente agora diz em qual empreendimento ela está",
              "Saiu o texto que afirmava que o cliente já estava apto",
            ],
            screen: "Portal de CAD (corretor)",
          },
        ],
      },
    ],
    technical: {
      done:
        "persistApoloEntityBatch (lib/apolo/server.ts:3401) passou a usar ON CONFLICT DO NOTHING (ignoreDuplicates do postgrest-js, confirmado no dist que roda) nas 8 tabelas de identidade — apolo_entities, entity_profiles, source_links, entity_identifiers, contacts, addresses, relationships e search_entries —, mantendo upsert normal nas 6 de carteira (commercial_links, financial_snapshots, documents, timeline_events, audit_events, module_records). Cria quem não existe, nunca sobrescreve quem existe: sem isso a carteira de um cliente novo ficaria órfã por violação de FK. Aplicado a todos os perfis, sem filtro, para não conviverem dois comportamentos na mesma função. Novo teste sync-c2x-identidade.test.ts com banco fake que imita as duas cláusulas do Postgres. Junto: dedup de CAD passou a comparar enterprise_id (cadastro-persist.ts) e a mensagem parou de afirmar aptidão.",
      motivation:
        "O sync montava o metadata do zero e o upsert substituía a coluna jsonb inteira, então cada rodada apagava metadata.cadastro e o que o operador tinha corrigido. Em 20/jul isso custou a etapa e o analista de 122 CADs numa única passada. Decisão do Lucas em 04/08: o Apolo é dono do cadastro, o C2X é dono do dinheiro.",
    },
    title: "O Apolo passa a ser dono do cadastro",
    type: "correcao",
    version: "1.111.0",
  },
  {
    buildTag: "2026-08-03-dossie-juridico",
    deployedAt: "2026-08-03T18:10:00-03:00",
    modules: [
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Novo botão Dossiê jurídico na aba Propostas do cliente: gera o relatório executivo para encaminhar ao jurídico",
              "O documento sai pronto com identificação, dashboard, classificação de risco, contrato, memória de cálculo parcela a parcela, histórico das tratativas, documentos e campo de aprovações",
              "A multa e os juros saem do contrato do próprio cliente, com a cláusula citada dentro do documento",
              "O histórico traz tudo o que foi feito pelo cliente: acordos, promessas, ligações, WhatsApp e as análises internas",
              "Na hora de gerar, o operador escolhe o motivo do encaminhamento e a recomendação operacional",
              "A correção monetária é um campo para preencher à mão; em branco, o documento declara que ela é devida e está pendente de apuração",
              "O dossiê fica anexado nos documentos do cliente e abre em uma aba nova",
            ],
            screen: "Cliente > Propostas",
          },
        ],
      },
    ],
    technical: {
      done:
        "lib/hades/dossie/: encargos.ts extrai multa/juros/índice do texto do contrato (acquisition_request_contracts.complete_text), reconhecendo as duas minutas em uso (Vale do Ouro e Lavra do Ouro, esta com ordem invertida) — 10/10 contratos reais com cláusula citável, 12 testes. dados.ts agrega o C2X separando DÍVIDA VENCIDA de SALDO TOTAL. tratativas.ts junta guardian_compromissos + guardian_compromisso_comments + caredesk_ticket_events (estes com ticket_id NULL, ligados só por metadata.client_id). pdf.ts monta as 13 seções com pdf-lib. Rota POST /api/guardian/dossie (authorizeHadesWrite, que é o único que devolve o nome do usuário para a capa) → uploadApoloDocument em apolo_documents, sem substituir dossiês anteriores (série histórica). Correção monetária entra por percentual digitado, em coluna própria da memória de cálculo.",
      motivation:
        "O encaminhamento ao jurídico era montado à mão a cada caso, juntando print de tela, extrato e conversa. Agora sai um documento só, com cada número tendo origem citável no contrato — que é o que se pode levar para os autos.",
    },
    title: "Dossiê jurídico do cliente em um clique",
    type: "novidade",
    version: "1.110.0",
  },
  {
    buildTag: "2026-08-03-vigia-grupos-whatsapp",
    deployedAt: "2026-08-03T15:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Se a conexão dos grupos de WhatsApp cair, os administradores recebem aviso na central de notificações em até 5 minutos",
              "Quando a conexão volta, chega o aviso de normalização",
              "A PA fotografada no bip da secretaria passa a entrar automaticamente nos documentos do cliente",
            ],
            screen: "Grupos de WhatsApp",
          },
        ],
      },
    ],
    technical: {
      done:
        "Vigia da instância Evolution: lib/iris/evolution-saude.ts consulta connectionState e avisa APENAS na virada (caiu/voltou), usando a própria hub_notifications como memória de estado (context.vigia/situacao) — sem tabela nova. Rota /api/iris/evolution/saude (GET com CRON_SECRET dispara o aviso; sem credencial devolve só o estado, servindo de health check) + cron de 5 min. Junto: gancho registrarPa → apolo_documents no registrarPa (lib/prometeu/pa.ts), best-effort, com backfill já aplicado nas 118 PAs do lançamento.",
      motivation:
        "Em 03/08 a sessão do WhatsApp dos grupos caiu às 7h57 e só foi descoberta às 14h41 pela operadora tentando responder um cliente: ~7h de grupos mudos sem ninguém saber.",
    },
    title: "Aviso automático quando os grupos de WhatsApp caem",
    type: "novidade",
    version: "1.109.0",
  },
  {
    buildTag: "2026-08-03-espelho-masterplan",
    deployedAt: "2026-08-03T14:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O masterplan do Vale do Ouro passa a refletir as vendas das duas carteiras em até 1 minuto",
              "O corretor continua vendo um mapa só, com a disponibilidade sempre atual",
            ],
            screen: "Masterplan (mapa do corretor)",
          },
        ],
      },
    ],
    technical: {
      done:
        "Espelho do masterplan: lib/apolo/espelho-masterplan.ts casa as 298 unidades do VLO(35) com as gêmeas de VOC(37)/VOL(36) por (quadra, lote) e copia sale_status_id/sale_blocked apenas quando divergem. Rota /api/apolo/masterplan/espelho (GET por cron, POST manual com sessão admin) + cron de 1 minuto no vercel.json. Minuto sem movimento = 1 SELECT que volta vazio (~300ms, zero escrita); log só quando muda. Testado contra produção: divergência simulada em VLO0101 detectada e corrigida na execução seguinte.",
      motivation:
        "O corretor oferece lote pela cor do mapa (show_map/35) e a venda acontece no VOC/VOL: cor atrasada = lote vendido oferecido de novo = venda perdida (Lucas, 03/08).",
    },
    title: "Masterplan reflete as duas carteiras quase em tempo real",
    type: "novidade",
    version: "1.108.0",
  },
  {
    buildTag: "2026-08-03-divisao-vale-do-ouro",
    deployedAt: "2026-08-03T12:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Logos dos empreendimentos padronizadas: mesma caixa, logo inteira (sem corte) e selo com o código quando a imagem não carrega",
            ],
            screen: "Cadastro de imobiliária e portal do corretor",
          },
        ],
      },
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O BI do Vale do Ouro passa a somar os três empreendimentos da família (master + Cecílio + Lino) — o placar continua o do lançamento inteiro",
              "O comparativo de carteiras agora vem da divisão real por empreendimento",
            ],
            screen: "BI Vale do Ouro",
          },
        ],
      },
    ],
    technical: {
      done:
        "Divisão VLO(35) → VOC(37, Cecílio) + VOL(36, Lino) executada no C2X: 298 unidades replicadas pela API oficial, 280 propostas migradas por (quadra, lote) com backup, VLO aposentado (sale_blocked). BI: constantes ENTERPRISES [35,36,37] para propostas e LISTA_UNIDADES_VIVAS (36,37) para contagem de unidades (evita dobrar o empreendimento); duelo por enterprise_id. Novo componente LogoEmpreendimento (contain + fallback onError) usado no portal de imobiliária e no portão do corretor. Lançamento encerrado (evento status=encerrado, 118 concluídos).",
      motivation:
        "Cada unidade pertence a uma empresa diferente (pedido do Lucas): separação por empreendimento a partir da unidade, com o trabalho do corretor centralizado no master.",
    },
    title: "Vale do Ouro dividido em duas carteiras + logos padronizadas",
    type: "melhoria",
    version: "1.107.0",
  },
  {
    buildTag: "2026-08-03-cad-sem-gargalo",
    deployedAt: "2026-08-03T09:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Limites de uso recalibrados para escritório inteiro no mesmo Wi-Fi (OCR 400/dia, envio 60/h, identificação 40/10min por IP)",
              "Sessão do corretor vale 4 horas (era 45 min) — a CAD com calma não morre mais no Enviar",
              "CPF que já está na base SEM CAD não é mais recusado: a CAD anexa na ficha existente (destrava ~3.900 CPFs do sync/backfill)",
              "Documentos grandes: aviso claro ANTES do envio apontando o arquivo a trocar (em vez do erro 413 sem saída)",
              "Bloqueio de limite e sessão expirada agora aparecem com a mensagem real (não mais como 'leitura falhou')",
              "Assistente CACÁ do portal exige identificação (endpoint pago não fica mais aberto a anônimos)",
            ],
            screen: "Portal público de CAD",
          },
        ],
      },
    ],
    technical: {
      done:
        "Revisão de 4 lentes + refutação (37 agentes, 30 achados confirmados) na véspera da carga dos corretores. Corrigidos os 7 críticos de código: tetos em rate-limit.ts; SESSAO_TTL_SEGUNDOS 45min→4h; modo anexo no cadastro-persist (dedup distingue ficha de CAD via apolo_esteira, merge de metadata preservando source/c2xSynced); guard de tamanho total no enviar() com mensagem acionável; catch do OCR diferenciando 429/401; 401 no assistente sem sessão/pré-sessão; rota do 409 repassa a mensagem verdadeira. Dado: credenciamento do VOC(37) desativado nos settings (CAD 100% no master VLO, decisão do Lucas). Backlog registrado: aprovação de imobiliária (review→active INEXISTE — paliativo manual), upload por signed URL, sliding session, notificação de CAD nova, timeout MOST, teto global de gasto.",
      motivation:
        "Pedido do Lucas 03/08: revisar o fluxo de CAD e imobiliária antes do dia de trabalho em massa dos corretores; garantir zero gargalo.",
    },
    title: "Portal de CAD sem gargalos para a carga dos corretores",
    type: "melhoria",
    version: "1.106.0",
  },
  {
    buildTag: "2026-08-02-telao-tv-independente",
    deployedAt: "2026-08-02T15:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "TV independente: o telão abre por um link com token próprio, sem operador logado e sem sessão para vencer no meio do evento",
              "Os links das TVs (salão e secretaria) ficam no Setup → aba Telões, com botão copiar",
              "O link vale enquanto o lançamento durar; evento novo pede link novo",
            ],
            screen: "Telão",
          },
        ],
      },
    ],
    technical: {
      done:
        "Token HMAC do telão (lib/prometeu/link-do-telao.ts, mesmo desenho do link da fila, SESSAO_CAD_SECRET, sem exp — revoga pelo ciclo do evento); rota /api/prometeu/telao aceita ?tv= como terceira via e valida o evento do token contra o operável; rota liberada no proxy (valida por dentro); telao.html anexa o token e pula a sessão do hub; GET /api/prometeu/palco devolve linksTv atrás do login; botões de copiar na aba Telões do Setup.",
      motivation:
        "TV logada com cookie de operador (TTL 14h) expirava no meio do evento e o telão morria mudo (401 em loop na tarde de 02/08). Pedido do Lucas: tirar o operador da TV.",
    },
    title: "Telão: TV independente por link com token",
    type: "melhoria",
    version: "1.105.2",
  },
  {
    buildTag: "2026-08-02-fechamento-dia-1",
    deployedAt: "2026-08-02T11:00:00-03:00",
    // Interna: página de fechamento para a diretoria, sem anúncio no painel do time.
    internal: true,
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Relatório de fechamento do atendimento do dia 1 publicado em /bi/fechamento-01-08.html",
            ],
            screen: "BI Vale do Ouro",
          },
        ],
      },
    ],
    technical: {
      done:
        "Dia 01/08 encerrado via encerrarDia (108 concluídos guardados, 499 arquivados com motivo, mesas liberadas, evento segue em andamento para o dia 2). Página estática de fechamento no padrão do BI: funil do dia, curvas de check-in×conclusão, placar das mesas e resumo do arquivamento.",
      motivation:
        "Pedido do Lucas 02/08: encerrar o dia de ontem (guardar atendimentos, arquivar não-finalizados) e gerar relatório de fechamento no padrão do BI de vendas.",
    },
    title: "Fechamento do dia 1 do lançamento",
    type: "novidade",
    version: "1.105.1",
  },
  {
    buildTag: "2026-08-02-cadastro-sem-trava-most",
    deployedAt: "2026-08-02T10:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A leitura automática (MOST) não trava mais nenhum documento: certidão, RG/CNH, cartão CNPJ e comprovante seguem mesmo quando a leitura falha ou desconfia do tipo",
              "O arquivo enviado é SEMPRE salvo, leia a MOST ou não",
              "Quando a leitura falha, os campos abrem para preenchimento manual (aviso âmbar no lugar do bloqueio vermelho)",
              "Vale para o wizard interno e para o portal público de CAD",
            ],
            screen: "Cadastro (wizard e portal do corretor)",
          },
        ],
      },
    ],
    technical: {
      done:
        "conferirDocumento não lança mais (tipo trocado e baixa confiança viram avisos em ext.avisoQualidade); DocUploader retém o arquivo ANTES da validação e trata falha do OCR por arquivo (extração vazia + aviso, em vez de descartar); StepCertidao com canNext por documento enviado (não mais leitura reconhecida) e banner âmbar. Travas de NEGÓCIO (ex.: documento do titular no lugar do cônjuge) continuam.",
      motivation:
        "Pedido do Lucas 02/08: a MOST recusava certidão de casamento legítima e trancava o cadastro; quando não ler, abre manual e salva o arquivo imputado.",
    },
    title: "Cadastro: leitura MOST não trava mais documento",
    type: "melhoria",
    version: "1.105.0",
  },
  {
    buildTag: "2026-08-01-bi-vale-do-ouro",
    deployedAt: "2026-08-01T19:30:00-03:00",
    // Interna: página pública de BI para a diretoria; não precisa anunciar no painel do time.
    internal: true,
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "BI de Vendas do lançamento publicado em /bi/vale-do-ouro.html (link público, sem login)",
            ],
            screen: "BI Vale do Ouro",
          },
        ],
      },
    ],
    technical: {
      done:
        "BI REALTIME em /bi/vale-do-ouro.html: página estática (fora do gate, como o telão) que consome /api/publico/bi/vale-do-ouro (rota nova, liberada UMA A UMA no proxy, só agregados, CDN s-maxage=60 — N espectadores = 1 consulta MySQL/min). Motor em lib/prometeu/bi-vale-do-ouro.ts (vendas, VGV, lotes Cecílio×Lino, ranking, planos, entrada, contratos, cobranças, investidores, perfil, cidades por endereço). Poll de 60s com guard sem-payload. Sem nomes de compradores.",
      motivation:
        "Lucas pediu o BI com link público no nosso domínio (sem moldura do claude.ai) e com dados realtime do C2X.",
    },
    title: "BI público do Vale do Ouro (realtime)",
    type: "novidade",
    version: "1.104.1",
  },
  {
    buildTag: "2026-08-01-fila-secretaria-definitiva",
    deployedAt: "2026-08-01T14:10:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Voltaram os botões Compareceu, Não veio e Rechamar ao chamar um cliente",
              "Quem já está sentado numa mesa sai da fila das outras mesas e não pode ser chamado de novo",
              "Cliente chamado não some mais da fila quando o fluxo anda por outro caminho",
              "Finalizar com a tela desatualizada não conclui mais a pessoa errada",
              "Sair da mesa com cliente pede confirmação, e a mesa volta a aceitar o atendente",
            ],
            screen: "Mesa da secretaria",
          },
          {
            items: [
              "Rechamar agora sempre anuncia no telão (antes ficava mudo minutos depois da 1ª chamada)",
              "Duas chamadas seguidas não se atropelam: o telão anuncia uma por vez",
              "A lista de Próximos não mostra mais quem já foi chamado ou já está em atendimento",
              "Se a TV perder a conexão, aparece a faixa vermelha TELÃO DESCONECTADO",
            ],
            screen: "Telão",
          },
          {
            items: [
              "Falha de rede não apaga mais a fila da tela (mantém o que está na tela e tenta de novo)",
              "O leitor de QR pausa enquanto a foto da PA está aberta (não bipa o próximo da fila sem querer)",
              "Chamar de volta quem constava como Não veio na secretaria devolve a pessoa à fila dela (não abre mais chamada do salão)",
            ],
            screen: "Check-in / organizador",
          },
          {
            items: [
              "Nova aba Telões: o maestro muda a música/vídeo de fundo de TODAS as TVs de uma vez (tocar, pausar, volume e cortar áudio)",
              "As chamadas de cada telão continuam independentes; TV que ligar depois entra no mesmo fundo",
            ],
            screen: "Setup",
          },
        ],
      },
    ],
    technical: {
      done:
        "Revisão completa do fluxo da fila da secretaria (32 agentes, 27 achados confirmados) e correção em lote: emTransitoTodos no payload da fila (regressão do overlay do atendente); filtro de sentados nas 3 filas e no telão; fechamento de chamadas órfãs em moverEtapa/liberarMesa/bipDaSecretaria; trava anti-corrida e anti-roubo no chamarCredenciado; validação do ocupante real no liberarMesa; marcarEmAtendimento com contagem de linhas; guard de payload no checkin-view; fila de anúncios + ?alvo= + watchdog + aviso de desconexão no telão; telefones da fila em lotes de 300; log de falha do WhatsApp de chamado. Maestro dos telões (rota /api/prometeu/palco + broadcast 'palco' + aba Telões no Setup). Cron do relatório diário das imobiliárias (18h) REMOVIDO do vercel.json a pedido do Lucas (01/08) — para religar, devolver a entrada e deployar.",
      motivation:
        "Dia do lançamento Vale do Ouro: mesas travando ao chamar, clientes sumindo da fila, telão mudo em rechamadas. Pedido do Lucas: revisar tudo e dar solução definitiva.",
    },
    title: "Fila da secretaria: solução definitiva",
    type: "correcao",
    version: "1.104.0",
  },
  {
    buildTag: "2026-08-01-apolo-c2x-ficha-completa",
    deployedAt: "2026-08-01T07:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "As CADs prontas para subir ao C2X saltaram de 200 para mais de 350. O dado não estava faltando: sexo, regime de bens, RG e o endereço já estavam preenchidos na ficha, e a integração só olhava a importação. Agora ela lê as duas, com a ficha do operador valendo mais — a mesma regra da CAD que o cliente assina.",
              "Coluna nova 'Conferir': fichas em que o nome da mãe ou a data de nascimento não batem entre a importação e a ficha ficam de fora do envio automático, para alguém olhar. Esses campos vão no contrato.",
              "Botão novo 'Ver o que falta no MOST': mostra quem ainda precisa de consulta paga e quanto custa, ANTES de gastar. Só depois aparece o botão que consulta, e ele preenche apenas campo vazio — nunca sobrescreve o que já estava lá.",
              "O botão de enviar ao C2X agora pergunta antes. Ele criava os cadastros direto no clique, sem confirmação.",
            ],
            screen: "Apolo · Subir cadastros para o C2X",
          },
          {
            items: [
              "Corrigir o telefone na edição do cadastro agora grava de verdade. Antes a tela dizia 'salvo', mas o número novo não entrava — e a cobrança do PIX continuava indo para o antigo. Se a gravação falhar, a tela agora avisa em vez de fingir que deu certo.",
            ],
            screen: "Apolo · CRM · Editar cadastro",
          },
        ],
      },
    ],
    rollback: "1.101.0",
    technical: {
      done: "A ficha de uma pessoa nascida no Apolo vive em DUAS fontes (apolo_entities.metadata.cadastro, da importação do Asana, e apolo_esteira.ficha, do operador) e montarDados (c2x-write-server) lia só a primeira — por isso o diagnóstico acusava sexo faltando em 335 de 343, regime em 343 e endereço em 333, com o dado presente na ficha o tempo todo. Novo lib/apolo/cadastro-cascata.ts (29 testes) com unirCadastroEFicha / unirEndereco / unirConjuge, na MESMA ordem da CAD assinada (cad-de-entidade.ts:6): ficha ganha, CAMPO A CAMPO. Também: RG saía fixo como null; nacionalidade agora é derivada da naturalidade (UF sufixada, ou a tabela cities do C2X, casando sem acento nas duas pontas); fichas carregadas em blocos de 100 no lote (limite de URL do PostgREST); novo status 'conferir' em ItemLote. Revisão adversarial (3 lentes + refutação) derrubou 4 defeitos, todos corrigidos antes do deploy: (1) o cônjuge ia com o label antigo do relacionamento em vez do que o operador corrigiu na ficha, e casado com cônjuge só na ficha subiria sem assinante; (2) o endereço escolhia a fonte inteira enquanto a CAD escolhe campo a campo; (3) cidadesBrasileiras comparava 'PARÁ DE MINAS' contra 'PARA DE MINAS'; (4) o gate de divergência não pega CAD com a pessoa trocada, porque a importação copia o cadastro para a ficha e as duas nascem idênticas — documentado no código, a checagem forte segue sendo classificarCad (cad-diagnostico.ts), com a âncora do proponente no Asana. Enriquecimento MOST: enrichPerson passou a devolver birthDate (era pago na PF_01 e descartado na leitura) e nova rota /api/apolo/c2x-sync/enriquecer com dryRun por padrão, ondas de 4 e gravação via gravarFichaDoLote (só preenche chave vazia). ARMADILHA registrada: existem duas matchFaixaRendaId (c2x-match casa por similaridade e devolve null para 'DE 2 A 4 SALARIOS MINIMOS'; c2x-fields lê o limite inferior e é a do MOST) — usar a errada gravava renda vazia depois de pagar a consulta. tsc limpo, 189 testes verdes no lib/apolo.",
      motivation:
        "Lucas: 'mas eu quero preencher tudo, quero enviar completinha' e 'pode rodar de uma vez o enriquecimento das informações'. A investigação mostrou que o enriquecimento era quase todo de graça: faltava ler a fonte certa, não comprar dado.",
    },
    title: "Apolo: a integração com o C2X passou a ler a ficha inteira",
    type: "melhoria",
    version: "1.103.0",
  },
  {
    buildTag: "2026-07-31-prometeu-telao-rechamar",
    deployedAt: "2026-07-31T16:40:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Correção: o Rechamar agora anuncia de novo no telão. Antes, chamar a mesma pessoa outra vez não repetia o anúncio (o telão achava que já tinha falado).",
              "Se você rechamar alguém que não foi o último chamado, o telão anuncia a pessoa certa — e não repete o nome de quem já passou.",
            ],
            screen: "Prometeu · Telão",
          },
        ],
      },
    ],
    rollback: "1.101.0",
    technical: {
      done: "BUGFIX do Rechamar no telão. Causa: rechamar REAPROVEITA a linha de prometeu_chamadas (mesmo id, e chamado_em intocado — decisão do Lucas 27/07 pra não zerar o cronômetro de espera), e o telao.html decidia anunciar comparando o id da chamada: id igual = 'já anunciei'. Fix em duas partes: (1) o endpoint /api/prometeu/telao passou a devolver credenciadoId em cada card; (2) o telao.html usa o payload do broadcast ({c: credenciadoId}, que dispara em TODA chamada, inclusive rechamada) como gatilho — procura o alvo entre atual+jaChamados do canal e anuncia ELE. Sutileza tratada: rechamar alguém que não é o topo (chamei Ana, depois Bruno, rechamo Ana) anunciava o Bruno; agora `lastChamadaId` acompanha SEMPRE o topo (independente de quem foi anunciado), então o poll de 20s não reanuncia o topo depois de uma rechamada. Alvo de outro canal é ignorado. 8 cenários provados em teste (carga inicial muda, chamada nova, poll sem novidade, rechamada fora do topo, poll pós-rechamada, rechamada dupla, alvo de outro canal, chamada nova após rechamadas). Telão independente (TV sem login) foi DESCARTADO pelo Lucas para este empreendimento. tsc limpo.",
      motivation:
        "Lucas, testando o telão: 'o rechamar não funcionou'. E hoje: 'para esse empreendimento não vamos ter o telão independente, então faça a correção do rechamar'.",
    },
    title: "Prometeu: correção do Rechamar no telão",
    type: "correcao",
    version: "1.102.0",
  },
  {
    buildTag: "2026-07-31-prometeu-operador-telas-por-perfil",
    deployedAt: "2026-07-31T15:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A equipe do evento agora entra por uma tela própria do lançamento (c2x.app.br/evento), com o nome do empreendimento, funcionando no celular e no computador. É por aqui que entra quem não tem login do hub.",
              "Cada pessoa cai direto no seu posto: organizador no check-in, atendente na tela de atendimento e gestor no painel de gestão. Antes, atendente e gestor viam 'tela em construção'.",
              "O atendente não precisa mais escolher a mesa: entra direto na mesa que o Setup definiu para ele. Ao sair, a mesa é liberada sozinha.",
              "No Setup, o Gestor não pede mais posto (aparece 'Toda a operação') e os gestores ficam numa faixa separada, fora das colunas de posto.",
            ],
            screen: "Prometeu · Acesso da equipe",
          },
        ],
      },
    ],
    rollback: "1.100.0",
    technical: {
      done: "Área /evento passou a rotear por PERFIL (evento-app.tsx): organizador->CheckinView, atendente->AtendenteView, gestor->GestaoMobile (com max-w-2xl no PC). Login (login-operador.tsx) reescrito: identidade do lançamento via nova rota pública GET /api/publico/prometeu/evento (devolve SÓ o nome; liberada uma a uma no proxy.ts) + 1 coluna no celular / 2 colunas no lg. Setup: perfil gestor esconde o seletor de Posto e ganha faixa própria; central-view e porZona excluem gestor das listas de posto. CORREÇÕES DA REVISÃO ADVERSARIAL (30 agentes, 22 achados confirmados, 10 únicos): (1) SEGURANÇA — novo autorizarOperacaoDeEscrita (authorizePrometeuWrite na via do hub) para chamar/atender/liberar: sem ele um VIEWER do hub passaria a operar mesa e disparar WhatsApp real; restaura também chamado_por/por (auditoria gravava null). (2) SEGURANÇA — na via do cookie do operador, etapa/moverPara só passam se a mesa informada estiver ocupada por AQUELE credenciado: sem isso liberar/chamar viravam a ação 'mover' (restrita ao hub) e concluíam qualquer um dos 431. (3) app/evento/layout.tsx ganhou .panteon-mobile-root + viewport: a área herdava html{min-width:1024px} e escapava no celular (armadilha recorrente). (4) novo lib/prometeu/evento-do-dia.ts espelha eventoOperavelId (em_andamento > ativo) nas 3 telas: elas buscavam só 'ativo' e cairiam no fallback lista[0] ao INICIAR o evento. (5) GestaoMobile: 'if (data?.credenciados)' no lugar de '?? []' — blip de rede no poll zerava a tela (armadilha do Hermes). (6) botão de no-show DEFINITIVO só com hubUser (a ação excluir é restrita ao hub; o freela levaria 'Sessão ausente'). (7) atendente entra direto na mesa do cadastro (operador.mesaId) — a escolha lia 'em uso' pelo CLIENTE, não pelo colega, e dois atendentes pegavam a mesma mesa. (8) Sair solta a mesa e limpa o storage (o aparelho roda entre pessoas no turno). tsc limpo.",
      motivation:
        "Lucas, montando a equipe na véspera: 'gestor não precisa de local' e, ao descobrir que atendente/gestor não tinham tela no /evento, definiu o modelo — 'todos os externos acessam pelo login do Vale do Ouro, faz uma tela para mobile e pc; os internos acessam o hub'.",
    },
    title: "Prometeu: acesso da equipe do evento (cada perfil na sua tela, celular e PC)",
    type: "novidade",
    version: "1.101.0",
  },
  {
    buildTag: "2026-07-30-apolo-cancelar-pix-prazo",
    deployedAt: "2026-07-30T17:55:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Ferramenta admin: cancelar os PIX de pré-venda não pagos quando o prazo fecha (conferir antes, depois cancelar com confirmação; os pagos ficam intactos).",
            ],
            screen: "Apolo · Imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.99.0",
    technical: {
      done: "Cancelamento em lote dos PIX não pagos da conta Gurgel (pré-venda), pro fim do prazo (18h). lib/apolo/asaas-prevenda.ts ganhou listarCobrancas(status,paginado) e cancelarCobranca (DELETE /v3/payments/{id} — o Asaas recusa deletar paga). Rota GET /api/apolo/asaas/cancelar-pendentes (authorizeApoloAdmin, maxDuration 300): lista PENDING+OVERDUE (paginado, teto 50pg); dryRun por padrão (só resumo total/valor/porStatus/amostra); confirmar=1 deleta cada, com trava dupla (pula status fora de [PENDING,OVERDUE], nunca toca pago). Botão em vincular-imobiliarias.tsx: 'Conferir o que seria cancelado' (dryRun) → mostra total+valor → 'Cancelar N PIX' (window.confirm) → resultado. Interno.",
      motivation:
        "Lucas: 'o prazo do PIX é hoje até 18h, depois não podemos receber. tem como cancelar todos os pix?'. Feito às 17:47 pra disparar às 18h; só os não pagos.",
    },
    title: "Apolo: cancelar PIX de pré-venda não pagos (fim do prazo)",
    type: "novidade",
    version: "1.100.0",
  },
  {
    buildTag: "2026-07-30-prometeu-telao-auth-fix",
    deployedAt: "2026-07-30T17:20:00-03:00",
    internal: true,
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Correção: o telão não estava chamando ninguém porque a busca de dados dava erro de autenticação. Agora funciona.",
            ],
            screen: "Prometeu · Telão",
          },
        ],
      },
    ],
    rollback: "1.98.0",
    technical: {
      done: "BUGFIX do telão (v1.97 não funcionava): o endpoint /api/prometeu/telao usa authorizePrometeuRead, que EXIGE Bearer da sessão Supabase; o telao.html (HTML estático) fazia fetch SEM Authorization → 401 sempre (mesmo logado), então buscarTelao retornava null e nem os dados carregavam nem o realtime conectava. Fix: tokenDoHub() lê o access_token da sessão no localStorage (chave sb-<ref>-auth-token, mesma origem) e o buscarTelao passa Authorization: Bearer + credentials:'same-origin' (o cookie do operador do evento cobre o outro caso). O teste no preview dava 401 e foi lido como 'esperado sem login', mascarando que dá 401 sempre. Lucas pegou ao vivo: chamou pro salão e o telão não anunciou (a chamada ESTAVA no banco com zona=salao).",
      motivation:
        "Lucas testando: 'chamei uma pessoa para o salão e o telão não chamou'. Causa: 401 no endpoint por falta do Bearer.",
    },
    title: "Prometeu: correção do telão (autenticação do endpoint)",
    type: "correcao",
    version: "1.99.0",
  },
  {
    buildTag: "2026-07-30-apolo-relatorio-disparo-manual",
    deployedAt: "2026-07-30T16:45:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Botão 'Disparar agora para TODAS (real)' na tela de Imobiliárias: dispara o relatório (e-mail + WhatsApp) na hora, com confirmação obrigatória.",
            ],
            screen: "Apolo · Imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.97.0",
    technical: {
      done: "Botão de disparo manual do relatório diário das imobiliárias em vincular-imobiliarias.tsx: dispararGeral() chama GET /api/apolo/imobiliarias/relatorio-diario SEM params (mesmo caminho do cron das 18h) com o Bearer do admin Apolo, atrás de window.confirm (é outward + custo de WhatsApp). Mostra enviados + OK de e-mail/WhatsApp. Interno (ferramenta admin, não vai ao painel de novidades). Motivo: Lucas quis disparar o relatório fora do horário e não havia botão de disparo geral (só teste e reenvio).",
      motivation:
        "Lucas: 'consegue fazer um disparo agora?' — disparo real pra todas, ciente de que o cron das 18h também roda hoje (recebem 2x).",
    },
    title: "Apolo: botão de disparo manual do relatório das imobiliárias",
    type: "melhoria",
    version: "1.98.0",
  },
  {
    buildTag: "2026-07-30-prometeu-telao-real",
    deployedAt: "2026-07-30T18:40:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O Telão agora funciona de verdade: quando alguém é chamado no salão ou na secretaria, o telão daquela TV mostra o nome e o destino (mesa ou salão) e a CACÁ anuncia por voz, em tempo real.",
              "Cada TV escolhe o setor ao abrir (Salão de vendas ou Secretaria) e mostra só as chamadas dele, com as listas de 'já chamados' e 'próximos'.",
            ],
            screen: "Prometeu · Telão",
          },
        ],
      },
    ],
    rollback: "1.96.0",
    technical: {
      done: "Telão real (escopo: chamada + voz). NOVO endpoint GET /api/prometeu/telao?canal=salao|secretaria (autorizarOperacao; descobre o evento ativo; cruza prometeu_chamadas por zona com listCredenciados p/ nome+imob+corretor e prometeu_mesas p/ número; devolve atual+jaChamados+proximos via filaDoSalao/filaDaSecretaria + config pública do Realtime {url, publishable key, topico}). telao.html PORTADO (visual/áudio/voz do mockup INTACTOS, feedback mockup=spec): trocado o BroadcastChannel (mesma origem) + dados fake pelo broadcast prometeu:fila:<eventoId> (supabase-js via esm.sh) + fetch ao endpoint; ao receber, aplicarDados anuncia só se atual.id mudou; 1ª carga não re-anuncia; poll de 20s como rede de segurança; controles de demo (.ctrl) escondidos; removido o poll do locutor (localhost:5180). Preview validado: estrutura idêntica, endpoint 401 sem auth, canal aplica, esm.sh carrega, console limpo. Comemoração de venda e locutor ao vivo ficam pra fase futura. tsc limpo.",
      motivation:
        "Lucas: 'quando chamar no salão e na secretaria tem que chamar no telão' + 'tem que ser igual o que eu aprovei no mockup'. Escopo escolhido: só a chamada, com a voz da CACÁ.",
    },
    title: "Prometeu: telão ligado de verdade (chamada em tempo real + voz da CACÁ)",
    type: "novidade",
    version: "1.97.0",
  },
  {
    buildTag: "2026-07-30-prometeu-fila-posicao-realtime",
    deployedAt: "2026-07-30T18:05:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Na tela do cliente, a posição na fila agora atualiza em tempo real: quando alguém é chamado e a fila anda, o número de todo mundo que está esperando muda na hora (antes levava até 15 segundos).",
            ],
            screen: "Prometeu · Tela do cliente",
          },
        ],
      },
    ],
    rollback: "1.95.0",
    technical: {
      done: "AcompanharFila.tsx: o handler de broadcast do canal prometeu:fila:<eventoId> passou a atualizar a posição de TODOS os clientes na fila (não só o chamado). Quem é o alvo (payload.c === meuId) faz buscar() imediato (alerta na hora); os demais fazem buscar() com jitter aleatório de até 1,2s (Math.random) pra espalhar o burst de N celulares, protegidos pelo snapshot de 4s do servidor. Guarda `vivo` evita refresh após desmontar. DIAGNÓSTICO desta sessão: o broadcast do servidor FUNCIONA em prod (capturado ao vivo via listener no canal do evento, payload {c}); o 'delay' relatado era descasamento de teste (link de uma pessoa, chamado em outra) — só o chamado reagia na hora, por design. Lucas pediu tempo real pra todos.",
      motivation:
        "Lucas escolheu 'tempo real' quando perguntei se a posição dos que esperam devia atualizar na hora (item 2) ou seguir no poll de 15s. O alerta de 'é a sua vez' (item 1) já era instantâneo.",
    },
    title: "Prometeu: posição na fila em tempo real pra quem espera",
    type: "melhoria",
    version: "1.96.0",
  },
  {
    buildTag: "2026-07-30-prometeu-chamado-whatsapp",
    deployedAt: "2026-07-30T15:20:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Reforço do alerta: quando o cliente é chamado, ele também recebe um WhatsApp 'É a sua vez' com um botão pra abrir a tela da fila. Isso avisa em qualquer celular, com a tela bloqueada ou o app fechado (o alarme da tela só funciona com a aba aberta).",
              "No Setup do evento tem o novo botão 'Criar template de chamado' e o interruptor 'Avisar por WhatsApp ao chamar' (liga/desliga por evento).",
            ],
            screen: "Prometeu · Setup e chamado",
          },
        ],
      },
    ],
    rollback: "1.94.0",
    technical: {
      done: "Reforço do chamado por WhatsApp (template 'prometeu_chamado', UTILITY, SEM header de imagem — corpo {{1}}=nome, {{2}}=destino + botão URL pro link da fila). Novos: lib/prometeu/chamado-template.ts, app/api/prometeu/chamado-template/route.ts (cria o template), lib/prometeu/chamado-disparo.ts (enviarChamadoPorWhatsApp, best-effort, gate config.avisarChamadoPorWhatsapp default true, modo teste reusa PROMETEU_WELCOME_TEST_PHONE, destino por zona via descreverDestinoChamado). Plugado nas ações 'chamar' e 'chamar-do-salao' da rota credenciados via after() (junto do broadcast realtime). Setup: toggle avisarChamado + botão criar template (criarTemplateChamadoRemoto). Broadcast ganhou timeout de 3s (AbortController) pra não segurar o after(). tsc limpo. IMPORTANTE: só dispara depois que o template for aprovado pela Meta (criar pelo Setup e aguardar).",
      motivation:
        "Lucas escolheu montar o reforço WhatsApp como o canal confiável pra iPhone/tela bloqueada, já que o alarme da tela (Fase 1) só vale com a aba aberta.",
    },
    title: "Prometeu: reforço do chamado por WhatsApp (É a sua vez)",
    type: "novidade",
    version: "1.95.0",
  },
  {
    buildTag: "2026-07-30-prometeu-tela-cliente-alerta-chamado",
    deployedAt: "2026-07-30T14:40:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Quando o cliente é chamado, o celular dele agora avisa na hora: toca um alarme, vibra e mostra uma notificação. O aviso chega em tempo real (sem o atraso de antes).",
              "A tela do cliente ganhou o botão 'Tocar um alarme quando for a minha vez'. Ao tocar nele, o cliente autoriza o som, a vibração e a notificação (o navegador exige esse toque).",
              "O número da posição na fila ficou com o 'º' grudado no numeral (1º, 2º), em vez do símbolo solto ao lado.",
            ],
            screen: "Prometeu · Tela do cliente",
          },
        ],
      },
    ],
    rollback: "1.93.0",
    technical: {
      done: "Fase 1 do alerta em realtime na tela do cliente (AcompanharFila.tsx). SERVIDOR: novo lib/prometeu/realtime-fila.ts (avisarFilaEmRealtime) faz broadcast HTTP no endpoint /realtime/v1/api/broadcast (best-effort, service role), disparado via after() nas ações 'chamar' e 'chamar-do-salao' da rota credenciados; payload mínimo { c: credenciadoId } (só o UUID do chamado reage, os demais seguem no poll de 15s — custo mínimo). Tópico compartilhado em lib/prometeu/fila-topic.ts (prometeu:fila:<eventoId>). CLIENTE: subscribe anon via getHubSupabaseClient().channel com rejoin/backoff (padrão IrisPage); ao receber, buscar() imediato. O ALERTA (alerta.mp3 + navigator.vibrate + Notification via ServiceWorkerRegistration.showNotification, com fallback new Notification) nasce da TRANSIÇÃO de estado para 'chamado', então dispara mesmo se o broadcast falhar (poll cobre). Botão 'ativar avisos' desbloqueia áudio + pede permissão no gesto. Numeral: 'º' grudado (removido ml-1, tom #c9b892). tsc limpo. LIMITES: vale com a aba aberta; iOS não vibra e só notifica via PWA instalado; Fase 2 (Web Push) cobre tela bloqueada.",
      motivation:
        "Lucas: 'na hora que chamar tem que ser em realtime' (o chamado tinha ~10s de atraso do poll) e 'não tem como colocar um som quando o cliente é chamado e fazer o telefone dele vibrar?' + 'garantir que o cliente veja que foi chamado'. E o ajuste do 'º' no numeral.",
    },
    title: "Prometeu: alerta em tempo real quando o cliente é chamado (som + vibração + notificação)",
    type: "novidade",
    version: "1.94.0",
  },
  {
    buildTag: "2026-07-30-prometeu-tela-cliente-nome-posicao",
    deployedAt: "2026-07-30T10:36:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Ajustes na tela do cliente: o nome do cliente agora aparece em destaque (bem maior) no topo, e o bloco da posição ficou mais limpo (só o número na fila, sem o texto embaixo).",
            ],
            screen: "Prometeu · Tela do cliente",
          },
        ],
      },
    ],
    rollback: "1.92.0",
    technical: {
      done: "Ajustes visuais em AcompanharFila.tsx (estado na_fila): (1) nome do cliente promovido a destaque (Bem-vindo pequeno + nome em text-[26px] font-black); (2) removido o texto de status abaixo do anel ('Você é o próximo' / 'N pessoas na frente') — Lucas quer só a posição. Mantido o chip de perspectiva (ETA). tsc limpo. Próximo: realtime no chamado + vibração/som/notificação (em investigação).",
      motivation:
        "Lucas, após validar o fix de layout: 'nome do cliente pequeno, aumenta' e 'tirar o texto abaixo da posição, deixar só a posição na fila'.",
    },
    title: "Prometeu: tela do cliente com nome em destaque e posição mais limpa",
    type: "melhoria",
    version: "1.93.0",
  },
  {
    buildTag: "2026-07-30-prometeu-tela-cliente-mobile-fix",
    deployedAt: "2026-07-30T10:14:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Corrigida a tela do cliente no celular: o conteúdo estava aparecendo deslocado e cortado (escapando para a direita). Agora abre certo, centralizado, tanto no navegador do WhatsApp quanto no Chrome.",
            ],
            screen: "Prometeu · Tela do cliente",
          },
        ],
      },
    ],
    rollback: "1.91.0",
    technical: {
      done: "Fix do layout quebrado da tela pública do cliente (/publico/fila) no celular. Causa: globals.css tem `html { min-width: 1024px }` (o hub é desktop) e o AcompanharFila.tsx (reescrito na v1.89) NÃO tinha a classe que neutraliza isso — então a página renderizava a 1024px num viewport de ~375px (html.clientWidth=375 mas body.width=1024) e o conteúdo escapava pra direita, cortado. FIX: classe `publico-shell` no <main> (mesma regra `html:has(.publico-shell){min-width:0;overflow-x:hidden}` que /publico/cad já usa). Diagnóstico e correção provados no browser (dpr 2, viewport 375): com a classe, min-width 1024→0 e body 1024→375. Registrado em memória (reference_html_minwidth_quebra_mobile) como armadilha recorrente. tsc limpo.",
      motivation:
        "Lucas testou o link no celular (WhatsApp e fora dele) e a tela veio 'quebrada, aquele mesmo erro de disposição'. É o mesmo bug do /publico/cad de 20/jul.",
    },
    title: "Prometeu: corrige a tela do cliente escapando pra direita no celular",
    type: "correcao",
    version: "1.92.0",
  },
  {
    buildTag: "2026-07-30-prometeu-gestao-painel-analitico",
    deployedAt: "2026-07-30T07:06:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A Gestão no celular ganhou um Painel mais completo: o Bipar credencial no topo, os tempos do evento (tempo médio no evento e de atendimento) e o fluxo do dia por fase (Recepção → Salão → Secretaria) com quantos estão em cada uma e o tempo médio da fase.",
              "Nova aba Analítico: a lista de quem está no evento agora, com busca e filtros por etapa, imobiliária e corretor (ex.: quem está em negociação da RR Soluções). Toca no cliente e abre a jornada dele.",
              "O 'Voltar' pra escolher entre Operação e Gestão ficou explícito no topo.",
            ],
            screen: "Prometeu · Celular · Gestão",
          },
        ],
      },
    ],
    rollback: "1.90.0",
    technical: {
      done: "Gestão mobile enriquecida (modules/prometeu/blocks/gestao/gestao-mobile.tsx). Painel: bip no topo; bloco Tempos (tempoEvento = kpis.tempoMedio; tempoAtendimento = tempoMedioMin das etapas de atendimento); bloco Fluxo por fase (componente Fluxo: 3 fases, contagem por etapa + tempo médio de permanência ATUAL da fase, ignorando concluído/cancelado). Nova aba Analítico (componente Analitico): lista de presentes (entrouEm!=null) com busca + chips de etapa + selects imob/corretor (opções sempre incluem o valor filtrado, pra não travar vazio no polling), toca abre a JornadaDrawer. Header com Voltar explícito (onTrocarModo). TabBar com 3 abas. Os tempos por fase são de PERMANÊNCIA ATUAL (ao vivo, onde a fila trava), não histórico de movimentações — barato e sem query nova. Revisão adversarial (3 achados corrigidos, 2 de alta): o Fluxo e os tempos passaram a operar sobre PRESENTES (entrouEm!=null), não sobre credenciados cru — senão os centenas de pré-cadastros (etapa 'recepcao' sem check-in) inflavam a 'Aguardando' e faziam o tempo da Recepção somar a hora do CADASTRO; e o rótulo do Analítico virou neutro ('no evento') + chip Cancelado, pra não contradizer o KPI 'Presentes agora'. tsc limpo; 113 testes verdes.",
      motivation:
        "Lucas (frente Gestão): indicadores por fase + tempos no Painel, Analítico no celular com filtro por etapa+imobiliária ('quem está em negociação da imobiliária X'), e o Voltar mais óbvio. Mockup aprovado.",
    },
    title: "Prometeu: Gestão no celular com fluxo, tempos e Analítico filtrável",
    type: "novidade",
    version: "1.91.0",
  },
  {
    buildTag: "2026-07-30-prometeu-boas-vindas-checkin",
    deployedAt: "2026-07-30T06:23:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "No check-in, o cliente passa a receber automaticamente um WhatsApp de boas-vindas com a logo do C2X, a posição dele na fila e um botão que abre a tela de acompanhamento. Liga/desliga pelo Setup ('Enviar pelo WhatsApp').",
              "No Setup há um botão 'Criar template de boas-vindas' para submeter o modelo à Meta (a aprovação fica com a Meta).",
            ],
            screen: "Prometeu · Boas-vindas no check-in",
          },
        ],
      },
    ],
    rollback: "1.89.0",
    technical: {
      done: "Entrega 2 da tela do cliente: disparo automático da boas-vindas no check-in via template Meta (ver memória project_prometeu_tela_cliente). (1) sendMetaWhatsAppTemplateMessage (lib/iris/meta-whatsapp.ts) ganhou param OPCIONAL urlButtonParameter → adiciona o componente button sub_type=url no envio (aditivo; sem ele o envio segue idêntico, não afeta o convite nem o resto da Iris). (2) lib/prometeu/boas-vindas-template.ts: definição do template prometeu_boas_vindas (UTILITY, pt_BR, header IMAGE logo C2X, body {{1}}nome {{2}}lançamento {{3}}posição, botão URL /publico/fila?t={{1}}). (3) app/api/prometeu/boas-vindas-template (POST): cria/submete à Meta no 4143, baixa a logo por URL, trata duplicata 2388023 — disparado pelo botão do Setup. (4) lib/prometeu/boas-vindas-disparo.ts: enviarBoasVindasDoCheckIn BEST-EFFORT (try/catch, nunca derruba o check-in), gate config.senhaPorWhatsapp, posição via filaDaRecepcao (mesma que o cliente vê), token do link assinado como parâmetro do botão. MODO TESTE: env PROMETEU_WELCOME_TEST_PHONE redireciona TODO check-in pra um número (o do Lucas nos testes). ⚠️ só entrega com o template APROVADO pela Meta; até lá devolve o motivo sem afetar o check-in. Revisão adversarial (6 achados corrigidos): o disparo roda via after() FORA do caminho crítico (não segura o organizador na porta esperando a Meta); telefone normalizado por comprimento (não colide com DDD 55/RS); fallbacks não-vazios pra lançamento/posição (a Meta recusa parâmetro vazio); maxDuration=60 na rota; e de quebra listUnidades passou a fatiar o .in em lotes (evitava um 400 silencioso da URL em evento grande). tsc limpo; 113 testes verdes.",
      motivation:
        "Lucas: no check-in, mandar a boas-vindas com a logo C2X e a posição, levando à tela do cliente. Para teste, 'todo check-in deve cair no meu celular' (modo teste). Decisão: automático via template (revoga o wa.me manual), submeter à Meta já.",
    },
    title: "Prometeu: boas-vindas automática no check-in (template + link da fila)",
    type: "novidade",
    version: "1.90.0",
  },
  {
    buildTag: "2026-07-30-prometeu-tela-cliente",
    deployedAt: "2026-07-30T00:58:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A tela que o cliente vê no celular ganhou visual novo: logo do C2X, a posição na fila em destaque, a perspectiva de atendimento (faixa de tempo, ex.: '20 a 35 min') e um mini-fluxo do circuito (Recepção → Salão → Secretaria) mostrando onde ele está e pra onde vai.",
            ],
            screen: "Prometeu · Tela do cliente",
          },
        ],
      },
    ],
    rollback: "1.88.0",
    technical: {
      done: "Redesenho da tela pública do cliente (modules/publico/prometeu/AcompanharFila.tsx, /publico/fila?t=token) + perspectiva de atendimento (ver memória project_prometeu_tela_cliente). Toda a cadeia de dados foi REUSADA sem mexer (derivarAcompanhamento, snapshot cache 4s, poll 15s com visibilitychange, token assinado, barreira de privacidade). Novidades: (1) UI nova em Tailwind (logo /c2x-logo-branca.png, posição num anel SVG, pessoas na frente, mini-fluxo recepção→salão→secretaria via passoAtual derivado de estado/zona); (2) ETA como FAIXA (decisão do Lucas): campo etaMinutos {de,ate}|null no AcompanhamentoDaFila, calculado no server = pessoasNaFrente × (tempoMedioAtendimento do config ou 10min ÷ capacidade de mesas), faixa ±30%, só quando há gente na frente — número derivado, sem furar a barreira de privacidade. 3 testes novos + teste de privacidade atualizado; 113 testes verdes; tsc limpo. AINDA MANUAL o disparo (wa.me); o template automático de boas-vindas é a próxima entrega.",
      motivation:
        "Lucas: tela do cliente 'moderna, de impressionar', com posição, perspectiva de atendimento e mini-fluxo. Mockup aprovado ('ficou do jeito que eu queria').",
    },
    title: "Prometeu: tela do cliente na fila com posição, perspectiva e mini-fluxo",
    type: "melhoria",
    version: "1.89.0",
  },
  {
    buildTag: "2026-07-30-prometeu-gestao-mobile",
    deployedAt: "2026-07-30T00:21:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "No celular, ao abrir o Prometeu agora aparece a escolha Operação ou Gestão. Operação é o de sempre (escolher posto e bipar a fila); Gestão abre uma tela feita pra mão.",
              "Gestão no celular: indicadores do evento no topo, botão 'Bipar credencial' (lê o QR e abre a jornada do cliente) e a lista de reservas seguradas com corretor, imobiliária e tempo (vermelho acima de 30 min), com filtros.",
            ],
            screen: "Prometeu · Celular · Gestão",
          },
        ],
      },
    ],
    rollback: "1.87.0",
    technical: {
      done: "Partes A (bifurcação) e B (Gestão) do perfil GESTÃO no MOBILE (ver memória project_prometeu_perfil_gestao). app/m/prometeu passou a renderizar EntradaGestorMobile (escolha Operação|Gestão) — todo login do hub que chega no /m é gestor, então a escolha aparece pra todos ali; freela entra por /evento (ainda não tocado). Operação → SeletorDePosto (inalterado). Gestão → GestaoMobile (nova, Tailwind, não usa o cockpit que não é responsivo): fetchFila+polling 10s, KPIs via nova função pura lib/prometeu/kpis.ts (calcularKpisDoEvento, extraída da CentralView pra Central e Gestão não divergirem), bip (usarLeitorQr) que abre a jornada em drawer (fetchJornada), e a aba Reservas (etapa 'reserva' parada, alerta 30min, filtros imob/corretor com set.add do valor filtrado pra não travar vazio). PENDENTE: freela gestor no /evento e a Gestão no PC (Central sem o Mapa). tsc limpo; 110 testes verdes; revisão adversarial.",
      motivation:
        "Lucas atualizou no celular e não via a Gestão: o bip e as reservas (v1.87) viviam só na Central do PC. Esta é a porta de entrada + a tela mobile. Mockup aprovado (menos texto). Acesso: login do hub = gestor (não só admin).",
    },
    title: "Prometeu: Gestão no celular (escolha Operação/Gestão + KPIs, bip e reservas)",
    type: "novidade",
    version: "1.88.0",
  },
  {
    buildTag: "2026-07-29-prometeu-gestao-bip-reservas",
    deployedAt: "2026-07-29T23:38:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Novo botão 'Bipar credencial' na Central: aponte a câmera para o QR do crachá e abre direto a jornada daquele cliente (check-in, salão, secretaria, tempos).",
            ],
            screen: "Prometeu · Central",
          },
          {
            items: [
              "Nova aba 'Reservas' na Central: lista quem está com a reserva parada (reservou e não seguiu pra secretaria), com corretor, imobiliária e tempo. Fica vermelho passando de 30 minutos. Filtros por imobiliária, corretor e 'só em alerta' pra o coordenador cobrar quem está segurando unidade.",
            ],
            screen: "Prometeu · Central · Reservas",
          },
        ],
      },
    ],
    rollback: "1.86.0",
    technical: {
      done: "Primeiras 2 das 4 partes do perfil GESTÃO do Prometeu (ver memória project_prometeu_perfil_gestao). (C) BIP DO GESTOR: botão no header da CentralView abre overlay de câmera reusando o hook usarLeitorQr (blocks/checkin); ehIdDeCredencial valida o QR (id cru); acha o cliente na lista já em memória e abre o mesmo modal de jornada dos cards (setModal tipo jornada) — sem rota nova, sem efeito no banco. (D) RESERVAS SEGURADAS: nova aba 'reservas' + subcomponente Reservas que filtra presentesTodos por etapa==='reserva' && !noShow, tabela Cliente/Corretor/Imobiliária/Tempo ordenada por etapaDesde asc, alerta (vermelho + chip) a partir de 30min (LIMITE_RESERVA_MS), filtros de imobiliária/corretor/só-alerta client-side. Base = ETAPA reserva (prometeu_unidades não é escrita hoje). Reusa .ltable/.ana-bar/NomeNaTabela/duracao. Ainda SEM a bifurcação de perfil (A) e a Gestão enxuta (B) — por ora bip e reservas vivem na Central do time. tsc limpo; 110 testes verdes; revisão adversarial.",
      motivation:
        "Lucas: escalada do perfil Gestão. 'função de bip para o gestor... abre a tela da jornada dele'; e a tela de reservas para o coordenador pegar corretor/imobiliária que reserva unidade e não devolve ('guardando'). Decisões: reserva=etapa parada, alerta 30min, ordem bip→reservas→bifurcação→gestão.",
    },
    title: "Prometeu: bip do gestor (abre a jornada) e aba de reservas seguradas",
    type: "novidade",
    version: "1.87.0",
  },
  {
    buildTag: "2026-07-29-prometeu-noshow-mapa-pip",
    deployedAt: "2026-07-29T22:27:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Quando o organizador do salão marca 'não veio', a pessoa passa a ficar na aba 'Não vieram' do PRÓPRIO salão, não mais na tela da recepção.",
            ],
            screen: "Prometeu · Organizador do salão",
          },
          {
            items: [
              "Os cards das mesas da secretaria agora mostram o NOME COMPLETO do cliente que está sendo atendido.",
              "Removida a legenda de cores do rodapé do Mapa do salão.",
            ],
            screen: "Prometeu · Central · Mapa do salão",
          },
          {
            items: [
              "A janela flutuante (picture-in-picture) do atendimento parou de cortar o conteúdo: nome, contexto e botões voltam a caber inteiros.",
            ],
            screen: "Prometeu · Atendimento",
          },
        ],
      },
    ],
    rollback: "1.85.0",
    technical: {
      done: "Três ajustes no Prometeu. (1) NO-SHOW POR POSTO: o 'não veio' do salão vazava para a tela da recepção porque a aba 'Não vieram' filtrava por etapa (salão->'negociacao'), mas a etapa NÃO muda no no-show e o salão chama de quem está em 'recepcao'. Fix: marcarNoShow grava metadata.noShow.zona (o posto que marcou); PrometeuCredenciado ganhou noShowZona (via lerNoShowZona no map de listCredenciados); a rota /credenciados e marcarNoShowRemoto repassam zona; checkin-view filtra a aba por c.noShowZona === posto (fallback pela etapa só p/ no-show antigo, que some no reset). (2) MAPA DO SALÃO: card da mesa mostra sentado.nome completo (era iniciais + 1º nome) num bloco .atd-cliente com ellipsis + tempo; removida a legenda .maplegend (exclusiva dessa aba, não afeta o Painel). (3) PIP: o card saía cortado ~197px à esquerda — a regra .pat.em-atendimento:not(.pip-out) #atendimento (especificidade maior) impunha transform:translateX(-50%)+width:min(720px,94vw) dentro do PiP, vencendo .pat.pip-solo. Fix: +:not(.pip-solo) na regra da aba, então dentro do PiP só a regra pip-solo (static, 100%, transform:none) vale. tsc limpo; 110 testes do Prometeu verdes.",
      motivation:
        "Lucas, sobre a operação do dia (lançamento 01/08): 'quando ele fala que o cliente não veio, a fila do aguardando tem que ser na tela dele, está indo para o checkin'; 'no mapa do salão dá pra colocar o nome do cliente, tirar essa legenda'; 'a tela do picture in picture ainda continua quebrado'.",
    },
    title: "Prometeu: no-show por posto, nome do cliente no mapa do salão e PiP consertado",
    type: "correcao",
    version: "1.86.0",
  },
  {
    buildTag: "2026-07-29-apolo-board-nome-imob-padronizado",
    deployedAt: "2026-07-29T22:08:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "No Board da esteira, cada imobiliária agora aparece com um nome só. Antes a mesma imobiliária vinha escrita de formas diferentes nos cards ('RR Soluções' e 'RR Soluções Imobiliárias LTDA', 'Mais Lotes' e 'Mais Lotes Negócios Imobiliários LTDA'); agora todos os cards dela mostram a grafia mais usada.",
            ],
            screen: "Apolo · Board da esteira",
          },
        ],
      },
    ],
    rollback: "1.84.0",
    technical: {
      done: "app/api/apolo/board/route.ts: o card exibia o texto cru de apolo_esteira.imobiliaria (grafias variadas para a mesma imobiliária). Agora agrupa as CADs pela ENTIDADE da imobiliária (imobiliariaEntityIdEmLote por vínculo em apolo_relationships + fallback no de-para apolo_imobiliaria_match por texto normalizado) e exibe, para todas as CADs de uma imobiliária, a grafia MAIS FREQUENTE (empate: mais curta, depois alfabética). Preserva a grafia original (acentos e siglas como J&F/L&I), sem forçar caixa, e evita os display_name feios da entidade (nomes PF com CPF). Só leitura, sem migration, sem tocar no front (ItemFila inalterado). Vale do Ouro: 50+ grafias colapsam em ~28 imobiliárias (RR Soluções 134, Mais Lotes 62, J&F 43...). Validado por SQL replicando a heurística. tsc limpo. Decisão do Lucas: 'unificar já, apelido depois' — o apelido curador curto (ex.: Rômulo Siqueira, Avança) fica para um passo seguinte.",
      motivation:
        "Lucas, sobre um print do Board: 'temos que padronizar esses nomes'. A mesma imobiliária aparecia com grafias diferentes entre os cards. Mesma raiz já corrigida em etiquetas do Prometeu e no relatório das imobiliárias.",
    },
    title: "Apolo: Board mostra um nome só por imobiliária",
    type: "melhoria",
    version: "1.85.0",
  },
  {
    buildTag: "2026-07-29-prometeu-fila-congela-por-fase",
    deployedAt: "2026-07-29T21:26:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A fila da recepção agora CONGELA a posição de quem já fez check-in: ligar ou desligar a janela de check-in não reordena mais quem já está na fila. O novo regime (com a janela aberta, a prioridade do PIX; com ela fechada, a ordem de chegada) passa a valer só para quem bipar dali pra frente.",
              "Com a janela aberta, quem ainda não pagou o PIX passa a ser chamado na ordem de chegada física (hora do check-in), não mais pela data do cadastro.",
            ],
            screen: "Prometeu · Fila da recepção",
          },
        ],
      },
    ],
    rollback: "1.83.0",
    technical: {
      done: "filaDaRecepcao (lib/prometeu/data.ts) reordenava a fila DINAMICAMENTE pelo estado ATUAL do flag global checkinHabilitado, então togglar re-embaralhava a fila inteira retroativamente. Fix por modelo de FASES congeladas (sem migration): (1) config.checkinFase = contador que sobe +1 a cada virada do flag, calculado em atualizarEvento comparando o valor gravado vs o novo (salvar o Setup por outro motivo não mexe na fase); (2) fazerCheckIn carimba em metadata.recepcao={fase,ligado} o regime vigente no momento do check-in (merge, sem apagar noShow/pa); (3) filaDaRecepcao ordena pela chave congelada — fase asc, depois PIX-first só se o regime congelado estava ligado, depois ordem do PIX, depois chegada; fallback pra quem não tem regime (check-in pré-fix). Reset de ensaio limpa metadata.recepcao. SEGUNDO fix no mesmo ponto (bug pré-existente, pego por revisão adversarial multi-agente antes de subir): o discriminador de 'pagou PIX' era c.posicao != null, mas posicao é DERIVADA (indice+1) e vem preenchida pra todos — então no regime ligado todo não-pagante caía no grupo do PIX e era ordenado pela DATA DA CAD (chegou_em) em vez da chegada física. Trocado por c.ordemFila != null (a chave real da fila do evento). Teste de mutação confirma que os testes de desempate entre não-pagantes agora pegam a regressão. 3 testes novos de congelamento + fixtures dos testes tornados realistas (posicao sempre não-nula); 110 testes do Prometeu verdes; tsc limpo.",
      motivation:
        "Lucas relatou (29/07): bipou pagantes com a janela aberta, desligou (pagantes novos foram pro fim, ok), religou e a fila TODA reordenou pelo PIX. Esperado: 'na hora da mudança o que já foi registrado não mexe, somente nos novos'. É o coração do dia do lançamento (01/08).",
    },
    title: "Prometeu: fila da recepção congela ao ligar/desligar o check-in",
    type: "correcao",
    version: "1.84.0",
  },
  {
    buildTag: "2026-07-29-relatorio-imob-por-texto",
    deployedAt: "2026-07-29T22:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O relatório das imobiliárias agora inclui também as CADs cuja imobiliária estava só como texto de apelido (ex.: 'Mais Lotes', 'RR Soluções'), não só as que tinham vínculo por entidade. A seção 'Crédito em Revisão' e as demais voltam a mostrar todo mundo.",
            ],
            screen: "Apolo · Relatório das imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.82.0",
    technical: {
      done: "Complemento do fix do relatório: 458 das 566 fichas do Vale do Ouro tinham a imobiliária só como TEXTO curto ('rr solucoes' 117, 'mais lotes' 46, 'moura' 39...) e o de-para (apolo_imobiliaria_match) só cobria as grafias longas, então caíam fora (ex.: 145 em revisão, quase todas some). (1) Backfill: gravei 25 grafias curtas → entidade no apolo_imobiliaria_match (resolução 1-a-1 por nome, inequívoca; ambíguas 'alves'/'romulo siqueira'/'bora comprar'/'varp' ficaram de fora p/ revisão do Lucas). (2) relatorio-imobiliaria.ts: fallback pelo TEXTO da esteira → apolo_imobiliaria_match quando não há vínculo por entidade. Validado: fichas que resolvem 534→567/570; em revisão 145/145. Prometeu também melhora (já lê o match). tsc limpo.",
      motivation:
        "Lucas: 'os crédito em revisão também estão faltando'. Andreza Carvalho (Mais Lotes) e ~140 outros em revisão sumiam por terem a imobiliária só como texto de apelido.",
    },
    title: "Apolo: relatório inclui CADs com imobiliária só em texto (de-para de apelidos)",
    type: "correcao",
    version: "1.83.0",
  },
  {
    buildTag: "2026-07-29-prometeu-etiqueta-imob-por-entidade",
    deployedAt: "2026-07-29T21:10:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Nas etiquetas, as imobiliárias agora vêm agrupadas pela ENTIDADE cadastrada no Apolo, não pelo texto. Antes, a mesma imobiliária aparecia em caixas separadas por causa de grafias diferentes (ex.: 'Mais Lotes' e 'MAIS LOTES NEGOCIOS IMOBILIARIOS LTDA'), e credenciados com vínculo mas sem texto caíam em 'sem imobiliária'.",
            ],
            screen: "Prometeu · Etiquetas",
          },
        ],
      },
    ],
    rollback: "1.81.0",
    technical: {
      done: "listCredenciados (lib/prometeu/data.ts) passou a resolver a imobiliária de cada credenciado pela ENTIDADE: 1) vínculo do cliente no Apolo (imobiliariaEntityIdEmLote, ilike 'imobili%' + related_entity_id, mais recente); 2) reforço pelo de-para de texto apolo_imobiliaria_match. Sobrescreve o campo 'imobiliaria' com o nome canônico da entidade + novo campo imobiliariaEntityId (tipo PrometeuCredenciado). Resolução em LEITURA, sem backfill de dados. A tela de etiquetas agrupa pelo nome (agora canônico), então unifica sozinha. Simulação no evento: 3 grafias (RR+Mais Lotes) viraram 2 caixas (RR SOLUCOES 91, MAIS LOTES 45), zero grafia solta. Fixtures de teste atualizados. tsc limpo.",
      motivation:
        "Lucas: nas etiquetas tem que vir agrupado pela entidade que cadastramos no Apolo. Grafias de texto duplicavam a imobiliária e escondiam a Dionata sozinha e o Antonio sem imobiliária.",
    },
    title: "Prometeu: etiquetas agrupam a imobiliária pela entidade do Apolo",
    type: "correcao",
    version: "1.82.0",
  },
  {
    buildTag: "2026-07-29-apolo-relatorio-vinculo-imobiliaria",
    deployedAt: "2026-07-29T20:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrigido um erro grave no relatório das imobiliárias: clientes que estavam vinculados a uma imobiliária não apareciam no relatório dela. Agora todo cliente com imobiliária vinculada aparece, independentemente de como o vínculo foi criado.",
            ],
            screen: "Apolo · Relatório das imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.80.0",
    technical: {
      done: "Causa: o relatório (relatorio-imobiliaria.ts), os avisos (disparo-imobiliaria.ts) e o write-back C2X (c2x-write-server.ts) resolviam a imobiliária do cliente filtrando SÓ relationship_type='Imobiliaria da CAD' (o tipo legado do Asana). Vínculos criados pelo fluxo atual têm tipo 'imobiliaria' (minúsculo) e eram ignorados — o cliente sumia do relatório (ex.: Antonio Carlos→Paulo Oliveira, Dionata→Mais Lotes). Fix: NOVO lib/apolo/imobiliaria-do-cliente.ts (imobiliariaEntityIdDoCliente + imobiliariaEntityIdEmLote) casa qualquer vínculo de imobiliária por entidade (ilike 'imobili%' + related_entity_id not null + status!=archived, mais recente vence) e é usado nos 3 lugares. Sem migration. tsc limpo. FALTA (Parte 2): etiquetas do Prometeu agrupam por texto (3 grafias de Mais Lotes) — backfill de-para texto→entidade + agrupar por entidade.",
      motivation:
        "Lucas apontou como extremamente grave: CADs vinculadas somindo do relatório da imobiliária. Descompasso entre o tipo de vínculo legado e o novo.",
    },
    title: "Apolo: relatório volta a mostrar todo cliente com imobiliária vinculada",
    type: "correcao",
    version: "1.81.0",
  },
  {
    buildTag: "2026-07-29-apolo-excluir-vinculo",
    deployedAt: "2026-07-29T19:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Agora dá pra EXCLUIR um relacionamento direto na lista (abra o grupo em Relacionamentos, cada vínculo tem um botão de lixeira). O vínculo sai da lista e fica registrado no Histórico.",
              "Para TROCAR a imobiliária de um cliente: exclua o vínculo atual e adicione a nova pelo '+ Adicionar'. Tudo no mesmo lugar, sem card separado.",
            ],
            screen: "Apolo · Ficha do cliente · Relacionamentos",
          },
        ],
      },
    ],
    rollback: "1.79.0",
    technical: {
      done: "Ajuste do fluxo de trocar imobiliária conforme o Lucas: removido o card 'Imobiliária de trabalho' (duplicava o lugar) + arquivos órfãos (imobiliaria-da-cad-card, lib/apolo/imobiliaria-vinculo, rota entities/[id]/imobiliaria). NOVA rota POST /api/apolo/relationships/archive (arquiva por related_entity_id ou label + timeline 'relacionamento_excluido'). relationships-panel.tsx: botão de excluir em cada RelRow (dentro do modal do grupo), chama a rota e recarrega. Revertido o mapeamento 'Imobiliária'->'Imobiliaria da CAD' no create (aquele tipo era só artefato do import do Asana; o vínculo normal é 'Imobiliária'). tsc limpo.",
      motivation:
        "Lucas: dois lugares pra imobiliária confundiam. Um lugar só (a lista de Relacionamentos), com excluir + adicionar. E 'esquece o Imobiliaria da CAD', era específico do Asana.",
    },
    title: "Apolo: excluir vínculo na lista de relacionamentos",
    type: "melhoria",
    version: "1.80.0",
  },
  {
    buildTag: "2026-07-29-apolo-busca-por-papel",
    deployedAt: "2026-07-29T18:55:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrigida a busca ao adicionar/trocar relacionamento: ao escolher o nível (ex.: Imobiliária), a busca agora traz SÓ entidades daquele tipo. Antes, procurar uma imobiliária pelo nome trazia junto todos os clientes captados por ela e a imobiliária sumia no meio da lista.",
            ],
            screen: "Apolo · Relacionamentos",
          },
        ],
      },
    ],
    rollback: "1.78.0",
    technical: {
      done: "Bug: apolo_search_entries.normalized_text agrega a imobiliária de cada cliente, então q='rr soluc' retornava ~90 (a imobiliária + os clientes dela), e o modal mostra só os 8 primeiros (ordem alfabética) — a imobiliária ficava fora. A rota GET /api/apolo/relationships já aceitava ?profile= mas o modal não enviava. Fix: add-relationship-modal.tsx mapeia o nível→papel (PERFIL_POR_NIVEL: Comprador/Prospect/Corretor/Imobiliária/Incorporador/Parceiro/Fornecedor) e passa &profile= na busca; imobiliaria-da-cad-card.tsx também busca com &profile=imobiliaria. tsc limpo.",
      motivation:
        "Lucas tentando vincular a imobiliária RR Soluções: escolhia 'Imobiliária', buscava e vinham só pessoas físicas (os clientes dela). O filtro de tipo não era aplicado na busca.",
    },
    title: "Apolo: busca de relacionamento filtra pelo tipo escolhido",
    type: "correcao",
    version: "1.79.0",
  },
  {
    buildTag: "2026-07-29-apolo-trocar-imobiliaria",
    deployedAt: "2026-07-29T18:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Na ficha do cliente, aba Relacionamentos, agora dá pra TROCAR a imobiliária de trabalho: um card mostra a imobiliária atual e o botão 'Trocar' abre a busca pra escolher outra.",
              "A imobiliária antiga fica arquivada (mantém o histórico da troca) e a nova passa a valer nos relatórios, disparos e na carteira que a imobiliária vê.",
              "A troca vale no Apolo na hora; no C2X (sistema de vendas) precisa ser ajustada à mão, então o card mostra um aviso 'pendente de refletir no C2X' até isso ser feito.",
            ],
            screen: "Apolo · Ficha do cliente · Relacionamentos",
          },
        ],
      },
    ],
    rollback: "1.77.0",
    technical: {
      done: "Troca da imobiliária do cliente (vínculo apolo_relationships tipo 'Imobiliaria da CAD', que é o que relatório/disparo/c2x-write leem — não o 'Imobiliária' solto do modal). lib/apolo/imobiliaria-vinculo.ts (lerImobiliariaDaCad + trocarImobiliariaDaCad: arquiva o vínculo atual com metadata.arquivado*, cria o novo com pendenteC2x=true, grava timeline 'imobiliaria_trocada'). Rota app/api/apolo/entities/[id]/imobiliaria (GET atual + PATCH troca, authorizeApoloRead/Write). UI: modules/apolo/blocks/crm/imobiliaria-da-cad-card.tsx no topo da aba Relacionamentos (busca reusa GET /api/apolo/relationships?q= filtrando profile 'imobiliaria'; selo 'pendente no C2X'). Sem migration (tabela já existe). C2X manual: a API de escrita só cria usuário (POST /users), não atualiza vinculed_by_id de quem já existe. tsc limpo.",
      motivation:
        "Demandas de trocar a imobiliária de clientes (excluir uma, incluir outra) e não havia como fazer no Apolo. Decisão do Lucas: Apolo automático, C2X manual, arquivar o antigo, na ficha do cliente.",
    },
    title: "Apolo: trocar a imobiliária do cliente na ficha",
    type: "novidade",
    version: "1.78.0",
  },
  {
    buildTag: "2026-07-29-acao-backfill-atendimentos",
    deployedAt: "2026-07-29T16:10:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Os convites que já tinham sido disparados antes viraram atendimentos na aba Ações (sem reenviar nada pro cliente): cada um ganhou seu card com protocolo e a conversa. Quem já tinha respondido aparece com a resposta na conversa.",
            ],
            screen: "Iris · Board · Ações",
          },
        ],
      },
    ],
    rollback: "1.76.0",
    technical: {
      done: "lib/apolo/acao-backfill.ts (backfillAtendimentosDaAcao): itera os alvos com disparo_wa_message_id e chama abrirAtendimentoDaAcao REUSANDO o wa_message_id existente (não fala com a Meta, não reenvia); insere a resposta já capturada na conversa (inbound button) quando houver e reabre o ticket. abrirAtendimentoDaAcao ganhou idempotência de mensagem (não duplica se já existe caredesk_messages com aquele external_message_id). Exposto via op:'backfill' na rota pública /api/publico/acao (protegido pela sessão da campanha). tsc limpo.",
      motivation:
        "13 credenciados receberam o convite antes de o disparo passar a abrir atendimento (v1.76). Backfill traz esses disparos para a aba Ações como atendimentos, sem reenviar mensagem.",
    },
    title: "Ações: disparos antigos viram atendimentos (sem reenvio)",
    type: "correcao",
    version: "1.77.0",
  },
  {
    buildTag: "2026-07-29-acao-vira-atendimento",
    deployedAt: "2026-07-29T15:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A aba Ações agora mostra ATENDIMENTOS de verdade: disparar o convite abre um atendimento com protocolo (AT-...), igual a qualquer outro, e ao clicar no card abre a tela de atendimento com a conversa (o convite enviado e a resposta do cliente).",
              "Esses atendimentos moram só na aba Ações, não poluem a fila de atendimento geral. A Cacá não responde sozinha (é contato ativo), o time atende. As unidades que o cliente escolhe no botão continuam sendo registradas na campanha.",
            ],
            screen: "Iris · Board · Ações",
          },
        ],
      },
    ],
    rollback: "1.75.0",
    technical: {
      done: "Ação de contato passou a se comportar como atendimento normal, segregado na aba Ações. NOVO lib/apolo/acao-atendimento.ts (abrirAtendimentoDaAcao): cria/reusa contato + ticket (protocolo via next_caredesk_ticket_protocol, metadata.acaoId/alvoId, activeContactConsent=awaiting_customer_reply, contactOrigin=active, subject=nome da ação) + mensagem outbound (external_message_id=wa_message_id) + ref no canal 4143 (whatsapp-careli). acao-disparo.ts chama isso após o envio (best-effort). acao-template.ts compartilha TXT/botões + renderConvitePreview (texto na conversa). meta-inbound-processor.ts: removido o early-return — registrarRespostaDeAcao vira efeito colateral (grava unidades no alvo) e a resposta segue o fluxo normal, casando o ticket do disparo por findTicketByReplyContextMessageId; gate isActiveContactTicket mantém a Cacá fora. Board: IrisTicket/IrisBoardTicket ganharam isAcao (derivado de metadata.acaoId em mapTicketRow); ticketsDaAba e naoLidasPorAba roteiam isAcao→aba acoes; a aba usa o kanban normal (AcoesBoard descartado). Clique abre a conversa de graça (ticket real). tsc limpo.",
      motivation:
        "Lucas: a ação tem que se comportar como um atendimento normal (mesmo layout, mesmo protocolo, clicar no card abre a tela de atendimento), só que na aba Ações. Reusa o fluxo de contato ativo que a Iris já tem.",
    },
    title: "Iris: ação de contato vira atendimento de verdade (aba Ações)",
    type: "novidade",
    version: "1.76.0",
  },
  {
    buildTag: "2026-07-29-board-aba-acoes",
    deployedAt: "2026-07-29T14:10:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "NOVA aba 'Ações' no Board, ao lado de Grupos: mostra a campanha de contato em massa com a MESMA cara do quadro de atendimento (cards em colunas), mas com os cards e os números só da ação.",
              "Cada card é um credenciado e anda pelas 5 colunas: Erro de envio (disparo falhou), Com a Cacá (WhatsApp enviado esperando a resposta do botão), Pendente (ninguém contatou), Aguardando cliente (falou por telefone, falta fechar as unidades) e Resolvido hoje (respondeu ou telefônico já com unidades). No topo, os números da ação: total, contatados, telefônico, WhatsApp, respostas e falhas.",
            ],
            screen: "Iris · Board · Ações",
          },
        ],
      },
    ],
    rollback: "1.74.0",
    technical: {
      done: "Aba 'acoes' em iris-board-kanban.tsx (ABAS_DO_BOARD + AbaDoBoard). Quando ativa, troca o miolo (indicadores+filtros+kanban de tickets) pelo componente novo AcoesBoard (modules/caredesk/blocks/acoes/acoes-board.tsx): read-only, busca /api/apolo/acoes[/id], KPIs do resumo + 5 colunas reusando o STATUS_FLOW (cores/rótulos), mapeadas por colunaDoAlvo (erro=disparo falhou; resolvido=respondeu||telefônico c/ unidades; caca=whatsapp enviado; aguardando=telefônico s/ unidades; pendente=sem contato). Cards com selos (canal/status/PIX/respondeu) + resposta/erro. A OPERAÇÃO (marcar/disparar) segue na AcoesView (tabela) em /iris/acoes e na tela pública. tsc limpo.",
      motivation:
        "Lucas quer acompanhar os disparos como cards no Board, no mesmo formato do atendimento, só que com os números da ação. A ação não vira ticket na fila, então a aba lê direto a campanha.",
    },
    title: "Iris: aba Ações no Board (cards da campanha)",
    type: "novidade",
    version: "1.75.0",
  },
  {
    buildTag: "2026-07-29-acao-resposta-caca",
    deployedAt: "2026-07-29T13:20:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Quando o cliente responde o convite tocando num botão (1 unidade / 2 a 3 / acima de 3), a resposta cai direto na Ação: aparece 'Respondeu' e as unidades já marcadas como veio do cliente. NÃO abre atendimento na fila e a Cacá não responde, é só o registro.",
              "Na lista da Ação, o disparo por WhatsApp agora mostra o status: 'enviado' quando deu certo e 'falhou' com o motivo do erro logo abaixo, pra saber por que não foi.",
            ],
            screen: "Iris · Ações",
          },
        ],
      },
    ],
    rollback: "1.73.0",
    technical: {
      done: "Fase 3 da Ação de Contato (captura da resposta + status). lib/apolo/acao-resposta.ts: registrarRespostaDeAcao casa o inbound pelo context.id do reply = apolo_acao_alvos.disparo_wa_message_id, grava resposta_em/resposta_texto e deriva unidades do texto do botão (derivarUnidades, unidades_origem='cliente'). Gancho no meta-inbound-processor.ts logo após extractInboundMessageDetail: se registrado, marca o webhook processed e RETORNA antes de criar contato/ticket (não polui a fila, não aciona a Cacá); custo extra só quando há replyContextMessageId (índice idx_apolo_acao_alvos_wamid). lib/apolo/acoes.ts: listarAlvos passou a trazer disparo_erro + resposta_texto (tipo AcaoAlvo). acoes-view: badge do disparo com 'enviado'/'falhou' + motivo do erro, selo 'Respondeu' e o texto/opção do cliente. Teste acao-resposta.test.ts (3) verde. tsc limpo.",
      motivation:
        "Fechar o ciclo: disparo → cliente toca o botão → resposta na ação, sem virar 397 tickets na fila (regra do Lucas). E dar visibilidade de sucesso/erro do envio na própria tela.",
    },
    title: "Ações: Cacá registra a resposta do convite + status do disparo",
    type: "novidade",
    version: "1.74.0",
  },
  {
    buildTag: "2026-07-29-acao-tela-publica",
    deployedAt: "2026-07-29T11:45:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Ação de contato agora tem uma TELA PÚBLICA com senha: a equipe (inclusive freela sem conta do sistema) abre pelo link da campanha e entra só com a senha, sem login.",
              "A tela pública mostra a mesma lista da aba interna (marcar Telefônico com perfil e unidades, ou WhatsApp), sem o botão de criar template (esse fica só no interno).",
            ],
            screen: "Iris · Ações",
          },
        ],
      },
    ],
    rollback: "1.72.0",
    technical: {
      done: "Fase 1b da Ação de Contato: tela pública com portão de senha. app/publico/acao/[slug]/page.tsx + modules/publico/acao/AcaoPublicoPortal.tsx (portão + reusa a AcoesView em modo público via prop tokenPublico). Sessão HMAC (lib/apolo/acao-sessao.ts, header x-acao-sessao, TTL 8h, reusa SESSAO_CAD_SECRET). Rotas /api/publico/acao/sessao (senha→token) e /api/publico/acao (GET dados + POST contato/disparar, confere alvo∈ação), liberadas no proxy.ts (PUBLIC_API_PREFIXES). AcoesView ganhou o modo tokenPublico (fetch por x-acao-sessao em vez do Bearer do hub; botão de template escondido). Migration 0078 (imagem_path) aplicada. Slug 'vale-do-ouro' + hash da senha gravados. tsc limpo.",
      motivation:
        "Lucas: a tela da ação pedia login; o time (com freelas) precisa acessar por link público com senha, como o portal de CAD.",
    },
    title: "Ações: tela pública com senha para a equipe",
    type: "novidade",
    version: "1.73.0",
  },
  {
    buildTag: "2026-07-29-acao-template-convite",
    deployedAt: "2026-07-29T10:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Na aba Ações, botão 'Criar template do convite': escolhe a arte e cria o template do WhatsApp na Meta prontinho (com a imagem no topo e os 3 botões de resposta 1 / 2-3 / acima de 3), igual ao 'Criar templates' da imobiliária. A Meta aprova, e aí liberamos o disparo.",
            ],
            screen: "Iris · Ações",
          },
        ],
      },
    ],
    rollback: "1.71.0",
    technical: {
      done: "Rota POST /api/apolo/acoes/[acaoId]/template (multipart): recebe a arte, uploadMetaWhatsAppTemplateHeaderMedia → handle, createMetaWhatsAppMessageTemplate (MARKETING, pt_BR, HEADER IMAGE + BODY {{1}} + BUTTONS 3 quick-reply), grava template_meta_name='convite_vale_ouro' na ação (mesmo se já existir na Meta). Número 4143 (PHONE_4143). Botão na acoes-view (input file escondido). Texto do convite fixo no servidor (aprovado pelo Lucas, sem menção a documentos). tsc limpo.",
      motivation:
        "Lucas quer o padrão 'um clique cria o template pronto' (como os 4 da imobiliária), não preencher a bancada à mão. O gargalo é a aprovação da Meta, então subir isso já pra ele submeter.",
    },
    title: "Ações: botão que cria o template do convite na Meta",
    type: "novidade",
    version: "1.72.0",
  },
  {
    buildTag: "2026-07-29-iris-acoes-contato",
    deployedAt: "2026-07-29T09:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "NOVA aba Ações (contato em massa), separada da fila de atendimento: a primeira ação é o 'Convite Vale do Ouro' com os 397 credenciados.",
              "O operador desce a lista (com filtros de não contatados / pagou PIX / busca) e marca o contato de cada cliente: Telefônico (falou → preenche perfil Moradia/Investimento + unidades 1 / 2-3 / acima de 3) ou WhatsApp (não conseguiu falar).",
            ],
            screen: "Iris · Ações",
          },
        ],
      },
    ],
    rollback: "1.70.0",
    technical: {
      done: "Fase 1 da Ação de Contato. Migration 0077 (apolo_acoes + apolo_acao_alvos, RLS deny-all) APLICADA + seed da ação 'Convite Vale do Ouro' com 397 alvos (dos prometeu_credenciados + telefone do apolo_contacts). lib/apolo/acoes.ts (ler ação, listarAlvos com PIX ao vivo, salvarContato pelos 2 canais, resumo, hash de senha scrypt da tela pública). Rotas /api/apolo/acoes (lista) e /api/apolo/acoes/[acaoId] (GET detalhe + PATCH contato), authorizeApoloWrite. Tela: modules/caredesk/blocks/acoes/acoes-view.tsx (lista corrida + filtros + fluxo telefônico inline) em /iris/acoes. FALTA: link no menu, tela pública com senha, template Meta + disparo pelo 4143, Cacá gravar a resposta. tsc limpo.",
      motivation:
        "Lucas: ação em massa não pode ficar no atendimento (viraria 397 tickets). Aba própria pra gerenciar o disparo e o retorno. Telefone é o canal prioritário; WhatsApp (template) só quando não fala.",
    },
    title: "Iris: aba Ações (contato em massa) + Convite Vale do Ouro",
    type: "novidade",
    version: "1.71.0",
  },
  {
    buildTag: "2026-07-29-prometeu-reset-reintegra",
    deployedAt: "2026-07-29T08:05:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O 'Iniciar evento real' agora REINTEGRA quem foi retirado da operacao durante os testes (o 'No-show definitivo'). Antes, um credenciado tirado num ensaio sumia do evento REAL mesmo depois do reset.",
            ],
            screen: "Prometeu · Iniciar evento real",
          },
        ],
      },
    ],
    rollback: "1.69.0",
    technical: {
      done: "iniciarEventoReal (data.ts): o update de reset dos credenciados passou a zerar encerrado_em + encerrado_motivo junto com etapa/entrou_em. Descoberto ao conferir os números: o Vale do Ouro batia 397/95 no Apolo e 396/94 no Prometeu — a diferença era 1 credenciado (EMANUEL FERNANDO DA SILVA, que PAGOU o PIX) retirado por um teste de 'No-show definitivo' em 28/jul. Emanuel reintegrado à mão (UPDATE encerrado_em=null) e o reset corrigido para não repetir. tsc limpo, reset-bloqueado.test.ts (6) verde. O reset roda 1x na virada ensaio->real e depois trava, então todo encerrado_em ali só pode ser lixo de teste.",
      motivation:
        "Um credenciado real não pode sumir do evento por causa de um teste. Blindagem para o dia 01/08.",
    },
    title: "Prometeu: o reset reintegra quem foi excluído no ensaio",
    type: "correcao",
    version: "1.70.0",
  },
  {
    buildTag: "2026-07-28-prometeu-jornada-circuito",
    deployedAt: "2026-07-28T20:45:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A jornada do cliente (na Central e na ficha do Atendimento) agora mostra a passagem pelo CIRCUITO do evento: Check-in → Negociacao → Reserva (com as unidades) → Secretaria (check-in e atendimento) → Proposta → Finalizado.",
              "Os no-shows (quando a pessoa foi chamada e nao veio) aparecem na jornada.",
              "'Etiqueta impressa' saiu da jornada: e um detalhe operacional, nao um passo da jornada de venda.",
            ],
            screen: "Prometeu · Jornada do cliente",
          },
        ],
      },
    ],
    rollback: "1.68.0",
    technical: {
      done: "Nova PrometeuPassoJornada + jornadaDoCredenciado(data.ts): reconstitui a jornada do HISTORICO — entrou_em (check-in) + prometeu_movimentacoes (cada para_etapa vira um passo, LABEL_DA_JORNADA) + a chamada da secretaria atendida (Secretaria · atendimento) + metadata.noShow (Nao veio) + unidades no passo Reserva — ordenado pelo relogio (passos sem carimbo vao ao fim). Rota GET /api/prometeu/jornada?credenciadoId (autorizarOperacao; buscada SO ao abrir o modal, fora do polling). fetchJornada. central-view: componente Jornada virou async (useEffect + fetchJornada). atendente-view: a ficha (cli-modal) busca a MESMA jornada (passosDaFicha). Removidos labelDaEtapa e PROMETEU_ETAPAS orfaos do atendente-view. tsc limpo, 107 testes verdes, lint sem erros novos.",
      motivation:
        "Lucas (Parte 2 de 2): a jornada mostrava a etapa atual + etiqueta, nao o caminho pelo circuito. A gestao precisa ver por onde o cliente passou (negociacao, reserva com unidades, secretaria, proposta) e os no-shows. Sem migration.",
    },
    title: "Prometeu: jornada do cliente reformulada (circuito do evento + no-shows)",
    type: "novidade",
    version: "1.69.0",
  },
  {
    buildTag: "2026-07-28-prometeu-mapa-atendente-indicadores",
    deployedAt: "2026-07-28T20:00:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "No Mapa do salao da Central, cada mesa da secretaria agora mostra QUEM esta atendendo nela (o operador que entrou na mesa). Antes aparecia sempre 'sem atendente'.",
              "Cada mesa mostra os INDICADORES do atendente para a gestao: atendimentos fechados (AT), unidades vendidas nesses atendimentos (UN), tempo medio e tempo total na cadeira.",
            ],
            screen: "Central · Mapa do salao",
          },
        ],
      },
    ],
    rollback: "1.67.0",
    technical: {
      done: "Migration 0076: prometeu_mesas.atendente_nome (texto; quem atende e' OPERADOR do evento OU admin testando, guardar o nome direto evita join — atendente_user_id nao serve pro operador). data.ts: listMesas devolve atendenteNome; sentarNaMesa/sairDaMesa; resumoDeTodasAsMesas (por mesa: atendimentos fechados, unidades somadas, tempoMedioMs, tempoTotalMs — mesma derivacao do resumoDaMesa: atendimento fecha na 1a movimentacao depois de sentar). Rota nova /api/prometeu/mesa (PATCH sentar/sair, autorizarOperacao aceita hub OU operador). Rota /fila: param resumoMesas=1 devolve resumoDeMesas (so a Central pede, o Atendente/Telao nao pagam). atendente-view: ao escolher a mesa grava o atendente (operador?.nome ?? hubUser?.name via useAuth), ao Sair da mesa limpa. central-view: card da mesa mostra atendenteNome (fallback no operador cadastrado) + os 4 indicadores. tsc limpo, 107 testes verdes.",
      motivation:
        "Lucas testando o Mapa do salao: as mesas mostravam 'sem atendente' porque a escolha da mesa vivia so no localStorage; e faltavam os indicadores por mesa que a gestao acompanha no dia. Parte 1 de 2 — a jornada reformulada (etapas do circuito + no-shows) vem em seguida.",
    },
    title: "Prometeu: Mapa do salao mostra o atendente e os indicadores por mesa",
    type: "novidade",
    version: "1.68.0",
  },
  {
    buildTag: "2026-07-28-prometeu-finalizar-e-menu",
    deployedAt: "2026-07-28T18:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O botao Finalizar agora ENCERRA o atendimento de verdade: conclui o cliente E libera a mesa para chamar o proximo. Antes o cliente ia para concluido mas a mesa ficava presa, sem poder chamar outro. O mesmo valia para o Direcionar e o Nao veio.",
              "A tela passou a se chamar Atendimento tambem no menu lateral (era Atendente).",
              "Novo botao para RECOLHER o menu lateral: encolhe para so os icones e da mais tela para o atendimento. Clicar de novo expande.",
              "A jornada do cliente (na ficha e no Analitico da Central) agora COMECA no check-in: CAD recebida e pre-venda paga eram pre-evento e saiam fora de ordem na linha do tempo — a jornada do dia comeca quando a pessoa chega.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "1.66.0",
    technical: {
      done: "BUG do Finalizar (causa-raiz): o PATCH /api/prometeu/credenciados valida `credenciadoId` logo na entrada, mas finalizarAtendimento/confirmarDirecionamento/naoVeio chamavam a acao 'liberar' SO com mesaId -> 400, e o front NAO checava o retorno -> a mesa ficava presa com o cliente ja movido (etapa=concluido, mesa=atendimento). Fix: Finalizar e Direcionar viraram UM request atomico (liberarMesaRemoto com credenciadoId + etapa; o liberarMesa ja avanca a etapa via moverPara) e checam o erro; naoVeio passa credenciadoId (sem etapa, so solta a mesa) e checa o erro. Guard do endpoint mantido (todas as acoes exigem credenciadoId). Removido o moverCredenciado orfao do import. Mesa 02 do ensaio destravada por SQL. prometeu-module.tsx: label 'Atendente'->'Atendimento' (id inalterado); sidebar colapsavel (estado menuRecolhido; aside w-232<->w-64 com transition; header e labels somem, nome do posto vira tooltip; botao PanelLeftClose/Open). Jornada (central-view Jornada + atendente-view ficha): removidos os passos 'CAD recebida' (chegouEm) e 'Pre-venda paga' (pagoEm); a timeline comeca em 'Check-in confirmado' (entrouEm). tsc limpo, 107 testes verdes.",
      motivation:
        "Lucas testando o ensaio: clicava Finalizar e o atendimento nao encerrava nem liberava a mesa — o defeito mais critico da operacao do dia (mesa travada = fila parada). Mais a faxina de nomenclatura (Atendimento) e o menu recolhivel para ganhar area de trabalho.",
    },
    title: "Prometeu: Finalizar encerra e libera a mesa + menu recolhivel",
    type: "correcao",
    version: "1.67.0",
  },
  {
    buildTag: "2026-07-28-prometeu-tela-atendimento",
    deployedAt: "2026-07-28T15:40:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A tela passou a se chamar Atendimento e ficou mais limpa: saiu o titulo Central Atendente e as abas Recepcao/Salao/Secretaria do topo (a separacao ja vem do login do operador).",
              "O atendente deixou de ver o painel Fila do salao: a tela dele e a fila da secretaria.",
              "Saiu o botao de WhatsApp na fila do atendente: quem chega aqui ja esta na ultima etapa, nao faz sentido reenviar o link da fila.",
              "O Aguardando retorno (nao veio) agora aparece so na fila onde foi marcado: quem deu nao veio na secretaria nao aparece mais no salao nem na recepcao, e vice-versa. Cada posto ve so o seu.",
              "A janela flutuante do atendimento voltou a responder: Pausar, Direcionar e Finalizar agora funcionam dentro dela.",
            ],
            screen: "Atendente",
          },
        ],
      },
    ],
    rollback: "1.65.0",
    technical: {
      done: "atendente-view.tsx: header renomeado (Atendimento), removidos o bloco .postos e o card .negociacao-card (fila do salao) + as pecas orfas (state filaSalao, cronometroDesde, CSS .negociacao-card); botao .wpp-btn removido da fila (mantido na ficha). No-show por fila: a rota devolve o no-show global, e cada tela filtra pela etapa da sua zona (atendente = secretaria; checkin-view do organizador: recepcao->recepcao, salao->negociacao, secretaria->secretaria) — a etapa nao muda no no-show, entao ela diz de qual fila a pessoa e. PiP: a janela flutuante ganhou root React proprio (PipHost com createRoot no document dela) no lugar do createPortal — com portal, o React escutava os eventos no root da aba principal e clique numa window separada nao chegava la, por isso Finalizar/Pausar/Direcionar nao respondiam. data.ts iniciarEventoReal: nova helper limparMarcasDeEnsaio remove metadata.noShow e metadata.pa de todos os credenciados no reset (merge por linha, licao da 0057) — antes o no-show e a PA de teste sobreviviam ao reset. 107 testes verdes.",
      motivation:
        "Ajustes da tela de atendimento apontados pelo Lucas testando o ensaio: a tela e so da secretaria, entao cabecalho e paineis de outras zonas saem; o no-show tem que respeitar a fila de origem; a janela flutuante estava com os botoes mortos; e o reset tem que zerar tudo do ensaio, inclusive no-show e PA.",
    },
    title: "Prometeu: faxina na tela de Atendimento + no-show por fila + PiP e reset",
    type: "correcao",
    version: "1.66.0",
  },
  {
    buildTag: "2026-07-28-apolo-c2x-cadastros",
    deployedAt: "2026-07-28T13:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova tela Subir cadastros para o C2X: diz quantas CADs estao PRONTAS pra subir e o que falta em cada uma das demais (falta nacionalidade, falta regime de bens, etc.), pra o time saber onde ir.",
              "Um botao envia as CADs prontas pro C2X de uma vez, com o cadastro completo: dados pessoais, endereco, telefone, pessoas para assinatura e conjuge (os dois assinam quando casado).",
              "A imobiliaria da CAD virou o vinculo do cliente no C2X automaticamente.",
            ],
            screen: "Subir cadastros para o C2X",
          },
          {
            items: [
              "A ficha do Cadastro no CRM agora pode ser EDITADA: botao Editar na aba Cadastro deixa o time preencher o que faltou (regime de bens, escolaridade, naturalidade...) com os campos certos.",
              "O conjuge voltou a aparecer na aba Cadastro (estava cadastrado, mas a tela nao mostrava).",
            ],
            screen: "CRM / Cadastro",
          },
        ],
      },
    ],
    rollback: "1.64.0",
    technical: {
      done: "Integracao de ESCRITA Apolo->C2X (POST /api/v1/users). lib/apolo/c2x-write.ts (montagem+transporte, 11 testes) + c2x-write-server.ts (orquestracao: le a ficha, resolve o vinculed_by_id pela cadeia relacionamento 'Imobiliaria da CAD'->CNPJ->id no C2X, envia, le o id por CPF no banco de prod, grava a fila apolo_c2x_sync, carimba c2xSynced). Nested attributes materializados: addresses_attributes (state_id/city_id resolvidos via states/cities), phones_attributes (+55/whatsapp), signers_attributes (titular+conjuge), spouse_attributes. Camada de lote processarLoteC2x (dryRun diagnostica, envia as prontas) + tela /apolo/sync-c2x. Edicao do cadastro: lib/apolo/cadastro-editar.ts (merge do metadata, nao substitui) + rota /api/apolo/cadastro/[entityId] + aba Cadastro editavel. Migration 0074_apolo_c2x_sync. Dry-run: 164 prontas / 243 faltando. ⚠️ Env de escrita aponta pro AMBIENTE DE TESTE do C2X (teste.careli.adm.br) ate a URL de producao; o envio real do lote so quando o Lucas clicar.",
      motivation:
        "O C2X ganha os cadastros do Apolo sem digitacao manual. A API e enxuta (so /users), entao o de-para inteiro foi resolvido pelo banco. 91/93 casados estavam sem regime de bens (barra no C2X) -> o time preenche pela edicao no CRM em vez de um default automatico (decisao do Lucas).",
    },
    title: "Apolo: subir cadastros para o C2X + editar a ficha no CRM",
    type: "novidade",
    version: "1.65.0",
  },
  {
    buildTag: "2026-07-27-prometeu-telas-do-mockup-com-motor",
    deployedAt: "2026-07-27T21:00:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A Central e a tela do Atendente agora usam o MESMO codigo visual dos layouts aprovados, com os numeros reais por tras.",
              "Na Central, clicar em qualquer card mostra QUEM esta ali: a lista abre com nome, imobiliaria e ha quanto tempo a pessoa espera, e da para ver por imobiliaria.",
              "Clicar numa linha do Analitico (ou numa mesa do Mapa do salao) abre a jornada do cliente no evento: CAD, PIX, check-in, etiqueta, unidades, PA e a etapa atual.",
              "Relogio ao vivo e o selo AO VIVO voltaram ao topo da Central.",
              "O Mapa do salao mostra o nome do atendente sentado em cada mesa e quem esta sendo atendido nela.",
              "No Atendente, a tela de atendimento pode sair para uma JANELA FLUTUANTE: da para usar o C2X em tela cheia sem perder o cronometro nem os botoes. Fechar a janela nao encerra o atendimento.",
              "Voltou a ficha do cliente ao clicar no nome, com CPF, telefone, imobiliaria, corretor, unidades e a jornada no evento.",
              "O botao de WhatsApp na fila reenvia para o cliente o link de acompanhamento da propria posicao.",
            ],
            screen: "Central e Atendente",
          },
          {
            items: [
              "Nova pagina para o CLIENTE acompanhar a fila pelo celular, sem login: mostra o lancamento, o nome dele, a posicao e avisa em destaque quando ele for chamado.",
            ],
            screen: "Fila do cliente",
          },
        ],
      },
    ],
    rollback: "1.63.2",
    technical: {
      done: "Novo metodo de porte: scripts/prometeu/escopar-css-do-mockup.mjs extrai o <style> do mockup e o escopa num wrapper (.pcx / .pat), traduzindo :root/body para o wrapper, body.dark para [data-uix-theme=dark] e movendo o estado do <body> (can-atender, em-atendimento, data-posto, pip-out) para o wrapper; markup e classes copiados do mockup; so a origem do dado muda. scripts/prometeu/conferir-classes-do-porte.mjs confere as classes do JSX contra o CSS. Revisao adversarial (5 lentes, 21 achados, 11 confirmados) corrigiu: guard de payload em carregar() — um blip de rede zerava as mesas e trocava a tela do atendimento pela escolha de mesa; naoVeio/finalizar/rechamar passaram a checar o erro antes de liberar a mesa; dedupe de @keyframes no escopador (pat-pat-pulse nao existia); ids #cli-modal/#cli-unids/#ana-lista/#ana-kanban devolvidos ao JSX; reset do <body> na janela do Document PiP; modal da Central passou a guardar as ETAPAS e derivar a lista, acompanhando o polling. Pagina do cliente: token HS256 (credenciadoId+eventoId, sem PII) na mesma SESSAO_CAD_SECRET do comprovante do Serasa, snapshot com cache de 4s por evento para ~390 celulares nao virarem incidente de fatura. 107 testes no modulo.",
      motivation:
        "O Lucas cortou a tela do Atendente tres vezes e fechou a questao: 'pega o codigo do mockado e habilita motor'. Portar deixou de ser reimplementar em Tailwind seguindo uma lista e passou a ser reusar o CSS e o markup do mockup. O evento e em 01/08.",
    },
    title: "Prometeu: Central e Atendente com o layout aprovado e os motores ligados",
    type: "novidade",
    version: "1.64.0",
  },
  {
    buildTag: "2026-07-27-prometeu-atendente-porte-completo",
    deployedAt: "2026-07-27T19:45:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A tela do Atendente foi portada do layout aprovado: os 4 indicadores no topo (Atendimentos hoje, Tempo medio, Em espera, Maior espera), todos com numero real.",
              "Fila com foto/iniciais, imobiliaria e corretor, o proximo em destaque e o tempo em VERMELHO a partir de 45 minutos de espera.",
              "Abas Fila e Aguardando retorno: quem nao veio fica separado, com botao Rechamar.",
              "Coluna direita com Minha mesa (Disponivel / Aguardando cliente / Em atendimento), Fila do salao em negociacao e Ultimas chamadas.",
              "Chamar proximo e Ocupado no rodape da fila, como no layout aprovado.",
              "O painel de atendimento toma a tela, com cronometro que comeca na hora exata em que a pessoa sentou, e ganhou Pausar, Direcionar e Finalizar.",
            ],
            screen: "Atendente",
          },
        ],
      },
    ],
    rollback: "1.63.1",
    technical: {
      done: "Porte item a item de public/prometeu/atendente.html seguindo docs/operations/prometeu-atendente-spec-do-mockup.md, em 4 lotes. Novo `derivarResumoDaMesa`/`resumoDaMesa` em lib/prometeu/data.ts deriva atendimentosHoje e tempoMedio de prometeu_chamadas.atendido_em + a movimentacao de saida, SEM migration; `mesaId` virou parametro OPCIONAL de /api/prometeu/fila para a Central/Telao/Fila nao pagarem as consultas extras no polling de 10s. `emAtendimentoDesde` do servidor eliminou a dependencia do relogio local no cronometro. 5 testes novos (67 no modulo).",
      motivation:
        "O Lucas cortou TRES versoes por falta de fidelidade ao mockup aprovado. Desta vez o mockup foi inventariado item a item numa spec versionada no repo, e o porte seguiu a lista — nao a interpretacao.",
    },
    title: "Prometeu: tela do Atendente igual ao layout aprovado",
    type: "novidade",
    version: "1.63.2",
  },
  {
    buildTag: "2026-07-27-prometeu-chamada-do-mockup",
    deployedAt: "2026-07-27T18:20:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A chamada no Atendente voltou a ser a tela aprovada: fundo escurecido, nome em letra grande, a mesa em destaque e os botoes Rechamar, Nao veio e Compareceu.",
              "A PA abre DENTRO da tela, nao mais em outra aba do navegador.",
              "Topo da Secretaria mostra quantos estao no SALAO (era o numero da propria fila com o rotulo do salao: dizia 1 quando havia 5 em negociacao).",
            ],
            screen: "Atendente",
          },
        ],
      },
    ],
    rollback: "1.63.0",
    technical: {
      done: "Modal de chamada portado de public/prometeu/atendente.html (overlay rgba(8,11,17,.62)+blur 7px, card 26px/760px, nome clamp(48px,7vw,80px), pilula do destino, 3 acoes). Visualizador da PA em overlay com a URL assinada, no lugar de window.open. Contador do topo passou a ler filaRecepcao/filaSalao (o posto ANTERIOR) em vez de filaDoPosto.",
      motivation:
        "Lucas: 'era para seguir o que ja estava construido' — eu inventei layout onde havia mockup aprovado. Reincidencia da licao de 19/jul.",
    },
    title: "Prometeu: chamada segue o mockup e PA abre na tela",
    type: "correcao",
    version: "1.63.1",
  },
  {
    buildTag: "2026-07-27-prometeu-aba-noshow",
    deployedAt: "2026-07-27T18:15:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Rechamar e Nao veio viraram botoes separados, com caixa e area de toque propria. Estavam colados e dava pra marcar no-show sem querer.",
              "Rechamar avisa que funcionou: o botao vira Chamado! por 2 segundos.",
              "Quem nao veio ganhou ABA PROPRIA (Nao vieram, com o total), em vez de ficar misturado no fim da fila.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.99",
    technical: {
      done: "PainelEmTransito: botoes com borda/fundo e gap; estado `rechamado` da o retorno visual por 2s. `aba` ganhou o valor noshow e `listaNoShow` saiu de dentro de listaFila. A barra de abas aparece no salao apenas quando ha no-show, sem o botao Ler QR (la a camera abre pelo painel).",
      motivation:
        "Lucas testando no celular: os dois textos colados, rechamar sem retorno nenhum, e o pedido de separar as filas.",
    },
    title: "Prometeu: aba de no-show e botoes separados",
    type: "melhoria",
    version: "1.63.0",
  },
  {
    buildTag: "2026-07-27-prometeu-atendente-real",
    deployedAt: "2026-07-27T17:55:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A tela de Atendente SAIU DO MOCKUP: agora mostra a fila real da secretaria, com os clientes do lancamento.",
              "Ao entrar, o atendente escolhe A MESA em que vai sentar. Mesa em uso por outro aparece bloqueada. A escolha fica guardada no computador, com Sair da mesa no topo.",
              "Chamar proximo reserva a mesa; quando a pessoa senta, Chegou na mesa abre o atendimento; se nao aparecer, Nao veio manda pro no-show e libera a mesa.",
              "A PA do cliente abre direto da mesa. Quem esta sem PA aparece marcado, na mesa e na fila.",
              "Sumiu o seletor Organizador/Atendente: esta tela e exclusiva do atendimento da secretaria.",
            ],
            screen: "Atendente",
          },
        ],
      },
    ],
    rollback: "1.62.98",
    technical: {
      done: "Novo blocks/atendente/atendente-view.tsx (React) no lugar do iframe atendente.html. Escolha de mesa em localStorage (prometeu:mesa-do-atendente), mesa nao-livre bloqueada. Le filaSecretaria/mesas/credenciados/emTransito de /api/prometeu/fila com refresh de 10s e gate de visibilityState. Reusa chamarCredenciadoRemoto (com mesaId), atenderRemoto, liberarMesaRemoto, marcarNoShowRemoto, moverCredenciado e urlDaPaRemoto. O cliente da mesa vem do BANCO (mesa.credenciadoId), nao de estado local: recarregar a pagina nao perde o atendimento.",
      motivation:
        "Lucas: 'a tela de atendimento continua a mesma coisa' — era iframe de mockup com nomes ficticios. Ele tambem pediu a selecao de mesa e a remocao do seletor de perfil.",
    },
    title: "Prometeu: tela do atendente com a fila real e escolha de mesa",
    type: "novidade",
    version: "1.62.99",
  },
  {
    buildTag: "2026-07-27-prometeu-no-show",
    deployedAt: "2026-07-27T17:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "NOVO: botao Nao veio no painel de chamados. Chamou, rechamou e ninguem apareceu? Marca e a pessoa sai da tela — sem isso o chamado ficava preso pra sempre, porque so o bip do QR o fechava.",
              "Quem nao veio aparece no FIM da fila com um traco no lugar do numero. Se reaparecer, e so Chamar de novo e ele volta ao fluxo normal.",
              "Rechamar NAO reinicia mais o cronometro: o tempo conta desde a PRIMEIRA chamada, que e o que diz quando desistir.",
              "O topo do Salao mostra Recepcao e o da Secretaria mostra Salao de vendas, em vez de esperando na recepcao.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.97",
    technical: {
      done: "marcarNoShow/limparNoShow/estaEmNoShow em metadata.noShow (jsonb, SEM migration): fecha a chamada aberta e tira das 3 filas. `chamarCredenciado` limpa o no-show sozinho (reaparecer = voltar ao fluxo) e parou de reescrever `chamado_em` na rechamada. Acao `no-show` na rota, aberta ao operador. `noShow` entrou em PrometeuCredenciado e no payload da fila; a lista mostra os faltantes no fim com posicao 0.",
      motivation:
        "Lucas testando: 'pode acontecer que o cliente nao apareceu, eu ja rechamei, se eu nao tirar da tela vai ficar preso'. E o rechamar zerando o cronometro escondia justamente o caso que vira no-show.",
    },
    title: "Prometeu: no-show e cronometro que nao reinicia",
    type: "novidade",
    version: "1.62.98",
  },
  {
    buildTag: "2026-07-27-iris-nomes-dos-participantes",
    deployedAt: "2026-07-27T17:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A mencao (@) nos grupos passa a mostrar o NOME dos participantes, puxado da agenda do WhatsApp espelhado, e nao so o numero.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "1.62.96",
    technical: {
      done: "`fetchEvolutionContatos` (POST /chat/findContacts) le a agenda da instancia, preferindo `name` (agenda) a `pushName` (perfil) e descartando grupos/broadcast. Rota /api/iris/group-participants-names casa por numero pelos ULTIMOS 8 DIGITOS (o 9o digito varia entre agenda e grupo) e preenche display_name; `dryRun` por padrao, so grava com dryRun:false.",
      motivation:
        "O backfill de participantes semeou so os numeros porque findGroupInfos nao devolve nome. O Lucas apontou que a instancia espelha um WhatsApp com os contatos salvos — e estava certo: a agenda estava disponivel e nunca tinha sido lida.",
    },
    title: "Iris: mencao de grupo mostra o nome do participante",
    type: "melhoria",
    version: "1.62.97",
  },
  {
    buildTag: "2026-07-27-prometeu-pa-da-secretaria",
    deployedAt: "2026-07-27T16:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "NOVO: no bip da secretaria da para fotografar a PA (a folha A4 com a proposta feita no salao). E o que o atendimento REMOTO precisa para lancar a proposta de quem nao esta no evento.",
              "A PA nao trava a fila: se a foto falhar, o botao Seguir sem a PA deixa o cliente passar normalmente.",
              "A fila da secretaria mostra um selo verde em quem ja tem PA e SEM PA em quem falta, pro organizador voltar depois.",
              "Quem esta sem PA segue no atendimento presencial, mas nao pode ir para o atendimento remoto.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.95",
    technical: {
      done: "Bucket privado prometeu-pa (15MB, so imagem). lib/prometeu/pa.ts: lerPa/podeAtenderRemoto/criarUrlDeUploadDaPa/registrarPa/urlParaVerPa — caminho em metadata.pa (jsonb, SEM migration), com MERGE do metadata e recusa de PA sem path. Rota /api/prometeu/pa (POST assina, PATCH carimba, GET assina leitura) com autorizarOperacao. enviarPaRemoto sobe DIRETO pro Storage e so grava o path DEPOIS do upload confirmar. CapturaDaPa (camera nativa, capture=environment) + SeloDaPa. `paPath` entrou em PrometeuCredenciado. 7 testes novos (62 no modulo).",
      motivation:
        "Lucas: parte do atendimento e REMOTO e quem atende de fora nao tem o papel na mao. Regra dele: o bip PASSA sem PA (a fila nao para), mas sem PA nao ha encaminhamento remoto. O cuidado com o path vem do incidente do Zeus hoje — 20 anexos orfaos por perder o caminho do arquivo.",
    },
    title: "Prometeu: registrar a PA no bip da secretaria",
    type: "novidade",
    version: "1.62.96",
  },
  {
    buildTag: "2026-07-27-prometeu-analitico-so-quem-chegou",
    deployedAt: "2026-07-27T16:00:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O Analitico passou a mostrar SO quem ja fez check-in. Antes listava os 396 credenciados como se estivessem na Recepcao, mesmo sem terem chegado.",
              "Os tempos absurdos (98h) sumiram junto: o cronometro contava desde o cadastro, nao desde a chegada.",
            ],
            screen: "Central",
          },
        ],
      },
    ],
    rollback: "1.62.94",
    technical: {
      done: "central-view.tsx: `filtrados` passou a exigir `entrouEm !== null` antes da busca. Vale para Lista e Kanban, que consomem a mesma lista.",
      motivation:
        "Lucas: 'a recepcao e quando o cliente faz o check-in e nao os que estao na fila principal'. Mesma armadilha ja vista no Painel: recepcao e o estado PADRAO de quem so esta habilitado.",
    },
    title: "Prometeu: Analitico reflete a fila, nao o cadastro",
    type: "correcao",
    version: "1.62.95",
  },
  {
    buildTag: "2026-07-27-prometeu-bip-limpo-e-fila-secretaria",
    deployedAt: "2026-07-27T15:45:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Ao tocar em Bipar, o leitor de QR abre DIRETO. Antes aparecia primeiro a confirmacao do bip anterior e era preciso fechar pra so entao ler o proximo.",
              "A SECRETARIA passou a ver a fila DELA: quem ela mesma bipou na chegada e espera atendimento, em vez da fila do salao.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.93",
    technical: {
      done: "onIrParaCamera limpa `resultado` antes de trocar de aba (o resultado ficava pendurado e a tela de confirmacao reaparecia). Nova `filaDaSecretaria` (etapa secretaria, ordem por etapaDesde) exposta na rota; CheckinView usa filaSecretaria no posto secretaria.",
      motivation:
        "Lucas testando: o fluxo do bip mostrava a tela do cliente anterior; e a fila da secretaria e formada pelos bips DELA, nao herdada do salao.",
    },
    title: "Prometeu: bip abre limpo e secretaria ve a fila dela",
    type: "correcao",
    version: "1.62.94",
  },
  {
    buildTag: "2026-07-27-prometeu-chamado-sai-da-fila",
    deployedAt: "2026-07-27T15:25:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Chamou, saiu da fila: a pessoa passa para o painel 'Aguardando chegar' e nao aparece mais na lista de espera. Assim ninguem chama o mesmo cliente duas vezes sem querer.",
              "Rechamar deixou de abrir uma chamada nova. Antes cada toque criava uma linha e o mesmo cliente aparecia varias vezes no painel; agora so' reinicia o cronometro dele.",
              "O painel de chamados cresce com a tela: com 5 chamados nao corta mais ninguem.",
              "Fila vazia deixou de dizer 'nada encontrado para a busca' quando ninguem buscou nada.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.92",
    technical: {
      done: "chamarCredenciado passou a procurar chamada em aberto do credenciado: se existe, faz UPDATE do chamado_em (rechamada) em vez de INSERT — a origem do cliente duplicado no painel. Rota /api/prometeu/fila remove `idsEmTransito` de filaRecepcao e filaSalao. PainelEmTransito com max-h em vh no lugar de rem. Mensagem de lista vazia passou a olhar a busca, nao o total do evento. 2 testes novos (9 no arquivo).",
      motivation:
        "Lucas testando: 'consegui bipar o cliente mais de uma vez', 'chamei 5 e comecou a cortar', 'quando eu chamar ele tem que sair da fila e ir pro transito'. O terceiro pedido resolve o primeiro: fora da fila, nao ha botao para chamar de novo.",
    },
    title: "Prometeu: chamou sai da fila e rechamar nao duplica",
    type: "correcao",
    version: "1.62.93",
  },
  {
    buildTag: "2026-07-27-prometeu-em-transito-e-cronometro",
    deployedAt: "2026-07-27T15:10:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "DA PARA CHAMAR VARIOS AO MESMO TEMPO: o painel 'Chamando' virou lista e mostra todos os que foram chamados e ainda nao apareceram, com o tempo de cada um. Quem bipar primeiro e' confirmado primeiro.",
              "O que foi chamado num celular aparece nos outros: a lista vem do banco, nao do ultimo toque da tela.",
              "A tela atualiza sozinha a cada 10 segundos (so' com o app aberto na frente).",
              "A fila mostra o CRONOMETRO de espera de cada pessoa, com a hora do check-in em letra menor embaixo.",
              "A numeracao da fila ficou em destaque laranja em todos, nao so' no primeiro.",
              "O painel de chamada ficou bem mais visivel: moldura dourada, contador e botao verde de bipar.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.91",
    technical: {
      done: "Nova `listEmTransito` (chamadas com atendido_em null) exposta em /api/prometeu/fila. CheckinView: estado `chamando` unico substituido por `emTransito` do servidor + `chamadosEmTransito` cruzando com credenciados; PainelEmTransito (lista, contador, backdrop-blur, cronometro por linha) no lugar do CartaoChamando; `useRelogio`/`tempoDesde` compartilhados; polling de 10s com gate de visibilityState e recarga silenciosa (nao acende Carregando nem limpa erro); chamar/bipar disparam carregar(true); posicao da fila em laranja solido; carregar entrou nas deps do registrar.",
      motivation:
        "Lucas testando no celular: 'eu posso ter uma menina chamando 5 pessoas' — o estado local so' guardava o ultimo chamado e nao atravessava aparelhos. Tambem pediu cronometro no lugar da hora, numeracao em destaque, atualizacao automatica e o painel de chamada mais forte ('esta muito discreto').",
    },
    title: "Prometeu: varios chamados ao mesmo tempo, cronometro e auto-refresh",
    type: "melhoria",
    version: "1.62.92",
  },
  {
    buildTag: "2026-07-27-prometeu-circuito-e-fila-por-posto",
    deployedAt: "2026-07-27T14:35:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O cliente ANDA no circuito: ao ser confirmado no salao, ele SAI da fila da recepcao. Antes continuava aparecendo na espera mesmo ja' sendo atendido.",
              "Cada posto ve a fila do posto ANTERIOR: o salao ve quem espera na recepcao, a secretaria ve quem esta no salao. O contador do topo passou a ser do posto, nao do evento inteiro.",
              "O alerta do salao diz a verdade: quem JA' passou pelo salao ouve 'ja' passou por aqui e esta em Negociacao', em vez de 'nao foi chamado'.",
              "O salao nao tem mais aba de check-in: a tela dele so' chama e bipa.",
              "Check-in nao pede mais toque no 'Proximo': bipou, mostrou, a camera volta sozinha.",
              "A fila mostra a imobiliaria E o corretor de cada pessoa.",
              "Saiu o texto de dentro/fora da janela e as bolinhas verdes viraram laranja.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.90",
    technical: {
      done: "filaDaRecepcao passou a filtrar `etapa === 'recepcao'` (antes so' excluia concluido/cancelado). Nova `filaDoSalao` (etapa negociacao, ordem por etapaDesde) exposta em /api/prometeu/fila. bipDoSalao separa 'nao foi chamado' de 'ja' passou por aqui e esta em X' pela etapa atual. CheckinView: `filaDoPosto` escolhe a fila por posto, contador do header por posto, abas escondidas no salao (com botao Fila no rodape da camera), botao Proximo removido no sucesso, texto de janela removido, corretor no item/cartao/confirmacao, posicao em laranja. 2 testes atualizados + 1 novo (53 no modulo).",
      motivation:
        "Rodada de correcoes do Lucas testando no celular. A mais importante: 'quando o cliente vai para outra fila ele tem que sair da que ele estava, ele tem que andar no circuito' — sem isso o organizador chamava gente que ja' estava sendo atendida. O alerta errado apareceu num caso real: ele chamou uma pessoa, bipou outra que ja' estava no salao, e a tela disse que ela nunca fora chamada.",
    },
    title: "Prometeu: cliente anda no circuito e cada posto ve a sua fila",
    type: "correcao",
    version: "1.62.91",
  },
  {
    buildTag: "2026-07-27-prometeu-fila-ordem-e-salao-chama",
    deployedAt: "2026-07-27T14:10:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A aba Fila mostra a POSICAO de cada um (01, 02, 03...), com o proximo em dourado. Antes a lista vinha do bip mais recente para o mais antigo, que e' o oposto da ordem de chamada.",
              "Buscar por nome nao muda as posicoes: continuam sendo as da fila inteira.",
              "SALAO agora abre na FILA, com botao Chamar em cada pessoa.",
              "Ao chamar, sobe o cartao CHAMANDO com o nome e o relogio andando. Nao existe mais botao 'Compareceu': quem confirma e' o QR. Rechamar e Nao veio continuam.",
              "Confirmado o bip, o cartao some e a tela volta para a fila, pronta para o proximo.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.89",
    technical: {
      done: "CheckinView: aba Fila passou a usar `filaRecepcao` (vem ordenada do servidor) no lugar de ordenar por entrouEm desc; AbaFila recebe {credenciado, posicao} e mostra a posicao no lugar do icone de check. Salao: aba inicial `fila`, prop onChamar, estado `chamando`/`chamandoDesde`, componente CartaoChamando (relogio de 1s, Rechamar/Nao veio/Bipar) e limpeza do cartao quando o bip confirma. Rota nova `chamar-do-salao` com autorizarOperacao e zona travada em 'salao', sem mesa e sem moverPara.",
      motivation:
        "Correcoes do Lucas testando em producao: (1) a fila nao mostrava ordem e vinha na sequencia errada; (2) o organizador do salao trabalha OLHANDO a fila e chamando, nao bipando o tempo todo — e a confirmacao tem que ser o QR, nao um clique, senao nao ha conferencia de quem apareceu. Bloqueio no caminho: `chamar` exigia login do hub e o organizador do salao e' freela.",
    },
    title: "Prometeu: fila com posicao e salao chamando pela fila",
    type: "melhoria",
    version: "1.62.90",
  },
  {
    buildTag: "2026-07-27-prometeu-postos-do-organizador",
    deployedAt: "2026-07-27T13:45:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O app do organizador abre perguntando o posto: Recepcao, Salao ou Secretaria. A escolha fica guardada no aparelho, com 'Trocar de posto' no rodape.",
              "SALAO: o QR confirma a chamada. Bipar quem NAO foi chamado nao move ninguem — a tela mostra o nome e avisa para a pessoa aguardar a chamada.",
              "SECRETARIA: o QR registra a chegada de quem foi por conta propria e fecha a etapa anterior sozinho, sem ninguem apertar nada.",
              "Passar o mesmo QR duas vezes na secretaria nao acusa erro: e' o organizador conferindo.",
            ],
            screen: "App do organizador (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.87",
    technical: {
      done: "lib/prometeu/data.ts: bipDoSalao (exige chamada em aberto, marca atendido_em com filtro de corrida, move para negociacao) e bipDaSecretaria (sem chamada previa, idempotente se ja esta na etapa). Rota credenciados PATCH ganhou bip-salao/bip-secretaria ANTES do gate de escrita do hub, com autorizarOperacao — cada uma so move pro seu destino. `chamar()` passou a devolver `status` para a tela separar recusa por regra (409) de erro tecnico. CheckinView ganhou prop `posto` (3 textos, ramifica a acao, `posto` na dep do useCallback) + resultado `recusado` em ambar. Novo seletor-de-posto.tsx com persistencia em localStorage. 6 testes novos (52 no modulo).",
      motivation:
        "Faltavam 2 dos 3 pontos de QR do trilho fisico a 5 dias do lancamento. Bloqueio achado no caminho: SO o check-in aceitava o operador do evento; salao e secretaria teriam falhado na mao do freela, que e' quem opera no dia.",
    },
    title: "Prometeu: organizador escolhe o posto (recepcao, salao, secretaria)",
    type: "novidade",
    version: "1.62.88",
  },
  {
    buildTag: "2026-07-27-zeus-migracao-gravacoes",
    deployedAt: "2026-07-27T13:10:00-03:00",
    internal: true,
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "As gravacoes de tela antigas voltaram a migrar para o Storage: o sistema dizia que o arquivo estava invalido, mas o arquivo estava inteiro.",
            ],
            screen: "HelpDesk",
          },
        ],
      },
    ],
    rollback: "1.62.86",
    technical: {
      done: "`decodeDataUrl` passou de `^data:([^;,]+);base64,` para `^data:(.*?);base64,`. O `[^;,]+` parava no primeiro `;`, entao `data:video/webm;codecs=vp8;base64,...` nunca casava. 4 testes novos (9 no arquivo).",
      motivation:
        "Mesmo `;codecs=` que ja tinha derrubado a lista branca do bucket, agora no parser. O sintoma era pior: a tela acusava 'data-URL invalido', como se o anexo estivesse corrompido — e nao estava, o base64 completo estava no banco.",
    },
    title: "Zeus: gravacoes de tela migram para o Storage",
    type: "correcao",
    version: "1.62.87",
  },
  {
    buildTag: "2026-07-27-zeus-migracao-anexos-tipo",
    deployedAt: "2026-07-27T12:25:00-03:00",
    internal: true,
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "A migracao dos anexos antigos para o Storage voltou a rodar: gravacao de tela, planilha e CSV estavam sendo recusadas pelo tipo do arquivo.",
              "Quando um anexo falha, a tela passa a mostrar o motivo em vez de so 'upload falhou'.",
            ],
            screen: "HelpDesk",
          },
        ],
      },
    ],
    rollback: "1.62.84",
    technical: {
      done: "`tipoAceitoPeloBucket` corta o parametro depois do `;` (video/webm;codecs=vp8 -> video/webm) e cai para application/octet-stream quando o tipo nao esta na lista branca do bucket. Erro do Storage passa a ser propagado na mensagem de falha. 5 testes.",
      motivation:
        "O bucket hub-it-ticket-attachments compara o content-type inteiro contra a lista branca. 22 dos 47 anexos legados nao migravam: 17 gravacoes de tela (sufixo de codec), 4 planilhas e 1 CSV. A mensagem generica 'upload falhou' escondia a causa.",
    },
    title: "Zeus: migracao de anexos aceita gravacao e planilha",
    type: "correcao",
    version: "1.62.86",
  },
  {
    buildTag: "2026-07-27-iris-reabrir-conversa-parametros",
    deployedAt: "2026-07-27T12:35:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Reabrir conversa depois das 24h voltou a funcionar. Dava 'Nao foi possivel reabrir a conversa' em qualquer cliente.",
              "A mensagem sai preenchida com nome do cliente, quem esta atendendo, protocolo e assunto.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "1.62.84",
    technical: {
      done: "O botao mandava `bodyParameters: []` fixo. Agora a rota /api/iris/meta/messages preenche os parametros no SERVIDOR quando o chamador nao manda nenhum, resolvendo por CHAVE a partir de `variables` do template (mesma regra de /api/iris/tickets). Assunto cai pro perfil do ticket, depois fila, depois 'seu atendimento' — nunca vazio, que a Meta tambem recusa.",
      motivation:
        "Regressao introduzida em 26/07 no proprio botao de reabrir: a Meta recusa quando a quantidade de parametros nao bate com o template aprovado, e o modelo de devolutiva declara quatro. Ficou no servidor porque e' onde existem ticket, contato e operador, e assim protege qualquer chamador.",
    },
    title: "Iris: reabrir conversa voltou a funcionar",
    type: "correcao",
    version: "1.62.85",
  },
  {
    buildTag: "2026-07-27-zeus-layout-anexo",
    deployedAt: "2026-07-27T12:05:00-03:00",
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "Anexar uma evidencia na devolutiva nao empurra mais os botoes pra fora da tela: o de mandar pra validacao aparecia cortado.",
              "Nome de arquivo comprido agora e' encurtado com reticencias, em vez de esticar a coluna inteira.",
            ],
            screen: "HelpDesk",
          },
        ],
      },
    ],
    rollback: "1.62.83",
    technical: {
      done: "min-w-0 nas duas colunas do detalhe do chamado (grid item nasce com min-width:auto e nao encolhe abaixo do conteudo) + flex-wrap no rodape de acoes da devolutiva.",
      motivation:
        "Bastava um nome como 'Captura de tela 2026-07-27 113434.png' pra coluna inchar e o rodape vazar pra fora do modal. A lista de anexos ja' tinha `truncate` no nome, mas truncate nao faz nada enquanto ninguem permite o encolhimento — a protecao estava la' e era inofensiva.",
    },
    title: "Zeus: layout do chamado nao quebra com anexo",
    type: "correcao",
    version: "1.62.84",
  },
  {
    buildTag: "2026-07-27-anexo-aparece-na-tela",
    deployedAt: "2026-07-27T15:10:00-03:00",
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "Print e video do chamado voltaram a APARECER: a miniatura carrega e a tela cheia abre.",
              "Vale tambem para os anexos antigos que ja tinham sido movidos para o Storage e apareciam como quadrado cinza.",
            ],
            screen: "Helpdesk",
          },
          {
            items: [
              "Quem abriu o chamado volta a ver a propria evidencia anexada no historico do HelpDesk.",
            ],
            screen: "Meus chamados",
          },
        ],
      },
    ],
    rollback: "1.62.82",
    technical: {
      done: "helpdesk-board e hub-user-tickets-panel liam SO' `attachment.dataUrl` (base64 legado) e ignoravam `attachment.url`, a URL assinada do Storage que o servidor ja' devolvia. Criada a fonte unica `url ?? dataUrl` e aplicada nos 14 pontos das duas telas (card, tela cheia, video, audio, arquivo e os guards de exibicao).",
      motivation:
        "Depois de religar os 20 anexos orfaos (1.62.82) a evidencia continuou sem aparecer: o defeito estava na LEITURA da tela, nao no dado. Como o guard do visualizador era `expandedAttachment?.dataUrl`, anexo do Storage nem abria em tela cheia. Isso alcanca tambem os 43 anexos migrados em julho, que estavam invisiveis desde entao.",
    },
    title: "Anexo do chamado agora aparece na tela",
    type: "correcao",
    version: "1.62.83",
  },
  {
    buildTag: "2026-07-27-anexo-do-chamado-nao-abria",
    deployedAt: "2026-07-27T14:30:00-03:00",
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "Print e video anexados no chamado voltaram a abrir. Desde 14/07 o arquivo subia mas o chamado nao guardava onde ele ficou, entao a evidencia nao aparecia para ninguem.",
              "Os 20 anexos afetados (14/07 a 27/07) foram recuperados: os arquivos estavam salvos e voltaram a ficar visiveis nos chamados.",
              "Anexo sem arquivo nao e mais aceito em silencio: se o envio falhar, o usuario e avisado na hora em vez de descobrir depois que a evidencia sumiu.",
            ],
            screen: "Helpdesk",
          },
        ],
      },
    ],
    rollback: "1.62.81",
    technical: {
      done: "normalizeAttachments (lib/hub-it-tickets/server.ts) remonta o anexo campo a campo e nao copiava `storagePath` — o campo morria entre o navegador e o insert. Passou a copiar (sanitizado) e a descartar anexo sem storagePath E sem dataUrl, que so gerava linha fantasma. Backfill: 20 linhas religadas aos objetos do bucket por (usuario + tamanho + janela de 15 min), 20/20 com casamento unico.",
      motivation:
        "O upload direto ao Storage foi ligado em 14/07 e a partir dali o cliente parou de mandar base64 quando o upload dava certo. Como o `storagePath` era descartado no servidor, a linha nascia sem storage_path E sem content_data_url: 20 anexos gravados sem lugar nenhum de onde ler o arquivo. Campo OPCIONAL esquecido num remonte nao quebra typecheck — passou verde por 13 dias.",
    },
    title: "Anexo do chamado nao abria",
    type: "correcao",
    version: "1.62.82",
  },
  {
    buildTag: "2026-07-27-credito-do-conjuge",
    deployedAt: "2026-07-27T12:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cliente casado ou em uniao estavel ganhou o botao Consultar credito do conjuge, na etapa de credito.",
              "Titular reprovado manda a ficha para Credito em revisao, como sempre. Se o conjuge for aprovado, a ficha e liberada e o credenciamento segue.",
              "Conjuge reprovado nao mexe em nada: nao derruba quem tem credito nem avisa o coordenador.",
              "Sem o CPF do conjuge na ficha, o sistema avisa onde preencher em vez de deixar o botao sem resposta.",
            ],
            screen: "Board · Analise de credito",
          },
        ],
      },
    ],
    rollback: "1.62.80",
    technical: {
      done: "POST /apolo/serasa/consultar aceita `alvo: titular|conjuge`. Para conjuge o CPF sai de apolo_esteira.ficha.conjugeCpf (nunca do corpo), a consulta e sempre PF, grava com finalidade `analise-credito-conjuge` e o registro fica no entity_id do titular. `transicao` virou nullable: conjuge reprovado nao chama atualizarEtapa nem dispara aviso. O GET passou a devolver `conjuge:{nome,temCpf,temConjuge}` (o CPF em si nao trafega) para a tela decidir o botao.",
      motivation:
        "Compra em casal e comum e a renda que sustenta a compra pode ser a do conjuge, mas nao havia como consultar o credito dele: o conjuge nao e entidade no Apolo, e o motor so aceitava o documento da ficha. Sem isso, ficha reprovada no titular morria em revisao mesmo com o casal tendo credito.",
    },
    title: "Credito do conjuge resgata a ficha",
    type: "novidade",
    version: "1.62.81",
  },
  {
    buildTag: "2026-07-27-apolo-nome-no-card-e-entrada-manual",
    deployedAt: "2026-07-27T10:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrigiu o nome do cliente na validacao da CAD? O card, a lista e o titulo da tela passam a mostrar o nome novo na hora, sem precisar de F5.",
            ],
            screen: "Board",
          },
          {
            items: [
              "Quando a leitura do documento nao traz um dado (ou traz errado), o campo abre para o operador digitar em vez de travar o cadastro.",
              "Vale para nome, CPF, nome da mae, naturalidade e nacionalidade.",
              "Um aviso diz exatamente o que faltou na leitura.",
              "Nao da mais para avancar sem nome e sem um CPF valido: o erro aparece na etapa, e nao so' no fim do cadastro.",
            ],
            screen: "Cadastro de prospect",
          },
        ],
      },
    ],
    rollback: "1.62.79",
    technical: {
      done: "board-view: `onIdentidadeSalva` atravessa ValidacaoLadoALado -> PainelEtapa -> DetalheBoard -> BoardView e dispara carregarFila so' quando a identidade muda; carregarFila passou a ressincronizar `selecionado` por id (o titulo lia de estado proprio). cadastro-flow: campos da identidade alternam ReadField/TextField, com o CPF usando `cpfValido` (nao `vazio`) como criterio; `podeAvancarPf` exige nome e CPF valido.",
      motivation:
        "O nome ia certo pro banco (39 edicoes registradas, nenhuma recusada) mas a fila era carregada uma vez so' e ninguem a avisava. No cadastro, o caso real da Katia Duarte mostrou os dois lados: contracheque e conta de luz nao tem CPF, e o contracheque ainda devolve texto solto (\"Ferias Vencidas\") no campo de CPF — criterio de campo vazio deixaria esse lixo travado na tela.",
    },
    title: "Apolo: nome atualiza no card e cadastro aceita digitacao",
    type: "correcao",
    version: "1.62.80",
  },
  {
    buildTag: "2026-07-27-direct-dono-padrao",
    deployedAt: "2026-07-27T01:10:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Conversa nova no numero de Relacionamento (Direct) ja' nasce com responsavel, em vez de cair em Sem responsavel.",
              "Quem responde pelo Direct e' configuravel: sai do cadastro da fila, sem depender de atualizacao do sistema.",
              "O fechamento automatico de 4h continua valendo para o Direct enquanto ninguem tiver assumido a conversa.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.62.78",
    technical: {
      done: "getDirectQueue passa a ler `metadata`; o insert do ticket Direct aplica `metadata.defaultAssigneeUserId` da fila. fechar-sem-interacao inclui os Direct cujo dono ainda e' o padrao (trava de corrida vira eq no dono lido, no lugar de is null). saveIrisQueue passou a fazer MERGE do metadata da fila em vez de substituir o objeto inteiro.",
      motivation:
        "Dos 106 tickets que a fila Direct ja' recebeu, os 106 nasceram sem dono e nenhum foi atribuido a ninguem: Sem responsavel virou a maior coluna do Board. Sem o ajuste no cron, porem, dar dono desligaria o fechamento automatico dessa fila (22 dos 148 fechamentos ate hoje).",
    },
    title: "Direct nasce com responsavel",
    type: "melhoria",
    version: "1.62.79",
  },
  {
    buildTag: "2026-07-27-board-tag-status-no-card",
    deployedAt: "2026-07-27T00:40:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Quando voce agrupa o Board por operador, canal ou fila, o card passa a mostrar a etiqueta de status (Pendente, Aguardando cliente, Com a Caca...).",
              "Agrupando por status a etiqueta some, porque a propria coluna ja diz.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.62.77",
    technical: {
      done: "BoardCard e BoardColumnView recebem `agrupadoPor`. Chip de status reusa statusColumnKey + STATUS_FLOW (mesma classificacao e mesma cor do cabecalho da coluna) e so renderiza quando o agrupamento nao e por status.",
      motivation:
        "Agrupado por operador o quadro dizia de quem era o atendimento, mas nao em que pe estava: o operador tinha que abrir o card pra saber. A regra e o card mostrar o que a coluna nao diz, sem repetir a mesma informacao em dois lugares.",
    },
    title: "Board: etiqueta de status no card",
    type: "melhoria",
    version: "1.62.78",
  },
  {
    buildTag: "2026-07-27-board-filtros-combinaveis",
    deployedAt: "2026-07-27T00:05:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O Board ganhou filtros que se combinam: dá para ver, por exemplo, só os atendimentos da Cinthia que estão pendentes no WhatsApp. Cada pessoa monta a visão que precisa.",
              "Dentro de um mesmo filtro é possível marcar mais de um valor, como duas operadoras ao mesmo tempo.",
              "Com filtro ligado, a tela mostra quantos atendimentos estão aparecendo do total, e um botão para limpar tudo de uma vez.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.62.76",
    technical: {
      done: "iris-board-kanban.tsx: nova função exportada valorDaDimensao(dimensao, ticket, helpers) — a MESMA usada pelo agrupamento e pelos filtros, para coluna e filtro nunca discordarem. Estado `filtros` (Record<GroupMode, string[]>, persistido em iris.board.filtros): dentro da dimensão os valores somam (OU), entre dimensões restringem (E). O seletor só oferece valores que existem na aba atual. O contador 'mostrando X de Y' evita o clássico filtro esquecido ligado. Antes o Board só tinha AGRUPAMENTO (muda colunas, não esconde nada), então a barra parecia filtro e não filtrava.",
      motivation: "Lucas: 'dar a oportunidade de colocar mais de 1 filtro, operador e status, operador status canal, temos que dar oportunidade do operador montar a visão dele'.",
    },
    title: "Iris: filtros combináveis no Board",
    type: "melhoria",
    version: "1.62.77",
  },
  {
    buildTag: "2026-07-26-painel-abas-so-icone",
    deployedAt: "2026-07-26T23:55:00-03:00",
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "As abas do painel do cliente voltaram a mostrar apenas o ícone, com o nome no tooltip.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "1.62.75",
    technical: {
      done: "iris-cobranca-context.tsx: removido o rótulo de texto das abas do painel. Com 5 abas em 340px não cabe, e o texto sobrepunha o ícone tanto na versão com rótulo em todas quanto na versão só na aba ativa (confirmado por print do Lucas nas duas tentativas). Se um dia quisermos rótulo aqui, o caminho é reduzir o número de abas, não espremer texto.",
      motivation: "Lucas: 'pode deixar somente o ícone mesmo'. A tentativa de resolver a queixa dos ícones sem nome quebrou o layout duas vezes.",
    },
    title: "Iris: abas do painel voltam a ser só ícone",
    type: "correcao",
    version: "1.62.76",
  },
  {
    buildTag: "2026-07-26-board-abas-atendimento-email-grupos",
    deployedAt: "2026-07-26T23:45:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O Board ganhou abas: Atendimento, E-mail e Grupos. Cada aba mostra só o que é dela e traz o número de conversas sem ler.",
              "Os indicadores passaram a contar apenas a aba aberta. Antes os grupos entravam na conta e inflavam o total: o Board dizia 137 abertos quando havia 98 atendimentos, porque somava 39 grupos que nunca são finalizados.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.62.74",
    technical: {
      done: "iris-board-kanban.tsx: novo estado abaAtiva (persistido em iris.board.aba) e ticketsDaAba, que separa por natureza — ticket.isGroup vai para Grupos, isEmailBoardTicket para E-mail, o resto para Atendimento. O filtro entra ANTES dos indicadores e do visibleTickets, então cada aba recalcula os próprios números. naoLidasPorAba conta ticket.unread por natureza e alimenta o badge. É separação de APRESENTAÇÃO: a origem dos dados (iris-data-client, onde os grupos entram na mesma lista via ...groupConversations) segue intacta, o que mantém a conversa de grupo funcionando como está.",
      motivation: "Lucas: os grupos poluem os indicadores e não têm como ser finalizados. A opção por abas dentro do Board (em vez de tela separada) foi escolha dele, e é também o caminho de menor risco.",
    },
    title: "Iris: Board com abas de Atendimento, E-mail e Grupos",
    type: "melhoria",
    version: "1.62.75",
  },
  {
    buildTag: "2026-07-26-iris-abas-cronometro-no-card",
    deployedAt: "2026-07-26T23:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Correção: as abas do painel do cliente estavam com o texto sobrepondo os ícones. Agora só a aba aberta mostra o nome, e as outras seguem com o ícone.",
              "O cronômetro de espera passou a aparecer também no card do Board, e não só dentro da conversa. É no quadro que se escolhe quem atender.",
              "O cronômetro agora conta o tempo real que passou, mesmo de madrugada e no fim de semana. A cor de alerta continua contando só o horário comercial, para não acusar ninguém por mensagem que chegou às 23h.",
            ],
            screen: "Atendimento e Board",
          },
        ],
      },
    ],
    rollback: "1.62.73",
    technical: {
      done: "(1) iris-cobranca-context.tsx: o rótulo das abas virou exclusivo da aba ativa (a versão anterior punha texto nas 5 e estourava os 340px do painel, sobrepondo ícone e texto em produção). (2) iris-board-kanban.tsx: o rodapé do card passou a exibir helpers.slaLabel (que já devolve 'esperando 2h14' / 'Aguardando cliente') com ícone de relógio, no lugar de 'vencido · data'; a data foi para o title. (3) lib/espera.ts ganhou minutosCorridos: o TEXTO usa relógio de parede e a COR usa minutos úteis — sem isso, à noite tudo exibia 'esperando agora' e o cronômetro parecia quebrado (o Lucas testou às 23h e não viu). 14 testes.",
      motivation: "Lucas viu a tela quebrada nas abas e pediu o cronômetro também no card. O 'não vi o cronômetro' foi consequência do relógio pausar fora do expediente.",
    },
    title: "Iris: conserto das abas e cronômetro no card do Board",
    type: "correcao",
    version: "1.62.74",
  },
  {
    buildTag: "2026-07-26-iris-reabrir-conversa-e-cronometro",
    deployedAt: "2026-07-26T23:15:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Quando passa de 24h desde a última mensagem do cliente, o atendimento deixa de ficar sem saída: aparece uma faixa no rodapé com os modelos aprovados e o botão Reabrir conversa, que envia no mesmo protocolo. Antes o campo de texto ficava desabilitado e não havia nenhum caminho, então o pedido do cliente ficava sem resposta.",
              "O cabeçalho da conversa passou a mostrar um cronômetro ao vivo com o tempo que o cliente está esperando resposta. Ele conta só quando a bola está com a gente e só em horário comercial, e some assim que respondemos.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "1.62.72",
    technical: {
      done: "REABRIR CONVERSA: /api/iris/meta/messages passou a aceitar `template: {name, language, bodyParameters}` e enviar via sendMetaWhatsAppTemplateMessage no protocolo atual. Três travas foram derrubadas para o template ser alcançável: o 409 da janela fechada (agora só vale para texto livre), a exigência de body (template puro passa, e o histórico guarda o texto renderizado) e a ausência do ramo de envio. UI em iris-composer-actions.tsx (faixa âmbar com seletor, prévia e botão), alimentada por irisData.templates → AttendanceView → IrisConversationPanel → composer (cadeia conferida por grep, não só por typecheck). CRONÔMETRO: blocks/conversation/iris-cronometro-espera.tsx, atualiza a cada 30s, reusa modules/caredesk/lib/espera (12 testes).",
      motivation: "A auditoria da tela mostrou que 80 dos 98 atendimentos abertos estavam com a janela da Meta fechada, 61 deles com a bola conosco: o operador lia o pedido e não tinha o que clicar, e o '+ Novo atendimento' recusava com 409 mandando abrir o atendimento existente, que é justamente onde ele não podia escrever. O cronômetro foi pedido do Lucas para enxergar o tempo sem interação.",
    },
    title: "Iris: dá para responder quem está fora da janela de 24h, e o cronômetro mostra a espera",
    type: "melhoria",
    version: "1.62.73",
  },
  {
    buildTag: "2026-07-26-iris-onda1-fila-e-relogio",
    deployedAt: "2026-07-26T22:20:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A fila voltou a mostrar a última mensagem de cada atendimento. Antes a maioria dos itens aparecia como 'Sem mensagens registradas' e era preciso abrir um por um só para descobrir o que o cliente queria.",
              "O relógio de espera parou de marcar quem não está esperando: quem já foi respondido e não voltou não conta mais como atrasado, e o tempo não corre de madrugada nem no fim de semana. Antes quase todos os cards ficavam vermelhos, inclusive os que aguardavam o cliente.",
              "No lugar de 'Vencido', o card mostra há quanto tempo o cliente espera de fato (ex.: 'esperando 2h14'), com destaque só a partir de 2 horas e alerta a partir de 8.",
              "Ao encerrar um atendimento em que o cliente falou por último, a tela mostra a mensagem que ficaria sem resposta antes de confirmar. O motivo já vem preenchido como Finalizado.",
              "As abas do painel do cliente (Cliente, Carteira, Financeiro, Timeline, Tickets) agora aparecem com nome, não só com o ícone.",
            ],
            screen: "Atendimento e Board",
          },
        ],
      },
    ],
    rollback: "1.62.71",
    technical: {
      done: "Onda 1 do redesenho da Iris. (1) iris-data-client: segunda passada auto-corretiva para a prévia da fila — a leitura em lote pedia 300 msgs para 100 tickets e conversas longas consumiam o orçamento, deixando 60 de 100 itens sem preview (no banco, ZERO abertos estão sem mensagem); agora quem ficou de fora é buscado em lotes de 20 com 5 msgs por ticket. (2) modules/caredesk/lib/espera.ts (novo, 12 testes): relógio conta só quando a bola é nossa e só em horário comercial (seg-sex 8h-18h), faixas 2h/8h; isSlaCritical/slaLabel/slaClasses passaram a usá-la mantendo a assinatura, e a cópia da regra em iris-data-client (que alimenta o contador do topo) foi alinhada — estavam divergindo. (3) IrisCobrancaCloseModal recebe pendenciaDoCliente e o motivo nasce 'Finalizado'; a função closeTicket() do IrisPage era CÓDIGO MORTO (nunca chamada, o botão abre o modal direto) e foi removida. (4) Abas do painel com rótulo visível. Sobe junto o Lote 2 da CACÁ (memória de identidade, 11 testes; mural de avisos inerte até a migration 0073).",
      motivation: "O time reportou que a Iris está confusa e difícil de trabalhar. A auditoria da tela mostrou que 96 de 98 abertos apareciam em vermelho (inclusive 19 de 19 que aguardavam o cliente), que a fila não mostrava o assunto e que o aviso de encerramento construído para evitar os 136 fechamentos indevidos nunca executava.",
    },
    title: "Iris: a fila mostra o assunto e o relógio para de marcar quem não espera",
    type: "melhoria",
    version: "1.62.72",
  },
  {
    buildTag: "2026-07-26-relatorio-nome-exibicao",
    deployedAt: "2026-07-26T19:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O relatório da imobiliária passa a ser endereçado ao NOME DE EXIBIÇÃO dela, e não à razão social. Antes a Diimóveis recebia como 'EDMILSON LINO DA SILVA', a FR Freitas como 'L A DE FREITAS' e a Trindade Imóveis como 'RTRINDADE EMPREENDIMENTOS LTDA', nomes que o parceiro não reconhece.",
            ],
            screen: "Imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.62.70",
    technical: {
      done: "disparo-imobiliaria.ts (contatoDaEntidadeImobiliaria): a resolução do nome passou de `legal_name || display_name` para `display_name || trade_name || legal_name`. Afeta o cabeçalho e o assunto do relatório diário e do reenvio. O nome do CLIENTE segue vindo de legal_name (para pessoa física é o nome completo, que é o correto).",
      motivation: "Lucas viu o relatório da Trindade chegar como 'RTRINDADE EMPREENDIMENTOS LTDA' e questionou. Investigando, a razão social do cadastro tem um typo ('RTRINDADE') e em outras imobiliárias ela é o nome da pessoa física por trás do CNPJ. Decisão dele: usar o nome de exibição.",
    },
    title: "Apolo: relatório vai no nome que a imobiliária conhece",
    type: "correcao",
    version: "1.62.71",
  },
  {
    buildTag: "2026-07-26-relatorio-reenvio-limpo",
    deployedAt: "2026-07-26T19:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O reenvio do relatório para uma imobiliária agora sai igual ao original. O aviso de retificação (o texto que pede para desconsiderar o e-mail anterior) só entra quando é realmente uma correção, e não em todo reenvio.",
            ],
            screen: "Imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.62.69",
    technical: {
      done: "relatorio-diario/route.ts: o banner AVISO_RETIFICACAO virou opt-in por `retificacao=1` (antes vinha grudado em todo `reenvio=1`). Sobe junto, sem efeito visível: memória de identidade da CACÁ (identidade-lembrada.ts, 11 testes — o número que já validou um cadastro por CPF não revalida por 30 dias, com reconfirmação leve do nome) e o mural de avisos operacionais (avisos-operacionais.ts, 8 testes), que fica INERTE porque a migration 0073 ainda não foi aplicada (a leitura devolve lista vazia e a CACÁ responde sem esse contexto).",
      motivation: "Em 26/07 o refresh token do Gmail da caixa da Cacá expirou e as 25 imobiliárias não receberam o relatório das 18h por e-mail (o aviso de WhatsApp saiu). No reenvio, o banner de retificação afirmaria algo falso: não houve e-mail anterior nem erro de atribuição. Lucas: 'quero o relatório normal, sem mensagem'.",
    },
    title: "Apolo: reenvio de relatório sai limpo, sem aviso de retificação",
    type: "correcao",
    version: "1.62.70",
  },
  {
    buildTag: "2026-07-26-caca-lote1-turno-e-falha",
    deployedAt: "2026-07-26T13:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A Cacá não responde mais duas vezes quando o cliente manda mensagens seguidas: ela espera o cliente terminar e responde uma vez só, considerando tudo que ele escreveu.",
              "Quando a assistente tem um problema técnico, ela agora avisa com honestidade e encaminha para uma pessoa do time, em vez de mandar uma resposta genérica que ignorava o que o cliente acabou de pedir.",
              "Parcela vencida deixou de ser tratada como acusação: se o pagamento pode estar em processamento, a Cacá diz o que consta e pede o comprovante, em vez de afirmar que o cliente está em atraso.",
              "Ao encerrar um atendimento em que a última mensagem é do cliente, o sistema avisa e mostra o que ficaria sem resposta, para o atendimento não morrer com a pendência do nosso lado.",
            ],
            screen: "Atendimento e assistente virtual",
          },
        ],
      },
    ],
    rollback: "1.62.68",
    technical: {
      done: "Lote 1 da Cacá, a partir da auditoria de 1.091 atendimentos. (1) NOVO lib/iris/caca/guarda-de-turno.ts (+7 testes): decidirTurno() cala a execução quando há inbound mais recente (rajada, quem responde é a execução da última mensagem, que lê o histórico inteiro) ou quando já existe outbound posterior à inbound processada (corrida). Aplicado 2x no meta-inbound-processor: antes de chamar o modelo (economiza token) e imediatamente antes do envio, que é onde a janela real de corrida mora. (2) Fim do fallback para o motor determinístico como resposta ao cliente: agora 1 retry do Claude e, na segunda falha, montarTurnoDeFalha() devolve handoff.required=true com texto honesto e o motivo técnico na razão do handoff. O motor legado segue apenas para CACA_ENGINE != claude (desligado de propósito). (3) persona.ts: regra ATRASO É HIPÓTESE. (4) IrisPage.closeTicket: confirmação mostra a última mensagem do cliente quando a direção é inbound.",
      motivation: "Auditoria da central (26/jul): o Claude falhou 26 vezes em 14 atendimentos e caía num motor legado sem memória que tratava o cliente pelo apelido do WhatsApp (AT-000923: 6 dessas na conversa de uma cliente idosa, que depois ameaçou a Defensoria). No mesmo ticket houve prova de corrida: resposta do legado às 12:52:28 e do Claude às 12:52:36. A falha era invisível (só console.error). Além disso 136 atendimentos foram fechados como Finalizado com o cliente falando por último, e a Cacá afirmou atraso de 13 dias num valor pago no mesmo dia (AT-000168).",
    },
    title: "Iris: a Cacá para de repetir resposta e assume quando falha",
    type: "correcao",
    version: "1.62.69",
  },
  {
    buildTag: "2026-07-26-cockpit-privacidade-telefone",
    deployedAt: "2026-07-26T11:00:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O cockpit do atendimento passou a exibir a carteira e o financeiro do cliente somente quando o telefone do contato confirma a identidade no Apolo, evitando mostrar dados de um cliente com o mesmo nome.",
            ],
            screen: "Cockpit de atendimento",
          },
        ],
      },
    ],
    rollback: "1.62.66",
    technical: {
      done: "Correção de privacidade no cockpit: pickIrisApoloEntityForTicket retorna null (não pega entities[0] por nome); loadApoloContext só consulta o Apolo por documento (>=3 dígitos), sem cair no telefone solto nem no nome do contato; mesmo ajuste no mobile (apolo-context.ts). Sobe junto, interna da CACÁ e sem painel: tool registrar_chave_pix, o cliente responde a chave PIX de devolução no recibo e a Cacá grava em apolo_esteira (migration 0072 já aplicada).",
      motivation: "Incidente: um contato de WhatsApp (Ana Paula) com o mesmo primeiro nome de uma compradora do Lavra viu a carteira dela no cockpit, sem o telefone bater. Regra: telefone é o único gatilho do match.",
    },
    title: "Iris: cockpit só mostra o cliente quando o telefone confirma a identidade",
    type: "correcao",
    version: "1.62.68",
  },
  {
    buildTag: "2026-07-25-pix-vale-do-ouro-remetente-contato",
    deployedAt: "2026-07-25T20:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Os e-mails de pré-venda (cobrança e recibo do PIX) do empreendimento Vale do Ouro passam a sair de contato@careli.adm.br; os demais empreendimentos seguem saindo da caixa da Cacá.",
            ],
            screen: "Pré-venda (PIX)",
          },
        ],
      },
    ],
    rollback: "1.62.66",
    technical: {
      done: "cobranca-prevenda.ts: helper remetentePrevenda(empreendimento) — Vale do Ouro (nome contém 'vale do ouro' ou code 'vlo') → 'Careli - C2X <contato@careli.adm.br>'; senão getCacaSender (caca@). enviarEmailPrevenda ganhou o param `from`. Aplicado nos 3 caminhos de disparo: lib cobranca-prevenda/recibo-prevenda (usados por gerar-pix + disparo-lote) e a CÓPIA da bancada/route.ts (cobrança + recibo). Fallback preservado: se o Send-As de contato@ não estiver liberado na conta caca@, o Gmail recusa e reenvia pela caixa padrão (caca@).",
      motivation: "Lucas: voltar o remetente do PIX pro contato@careli.adm.br, mas SÓ no Vale do Ouro (os outros seguem na Cacá). Sem anúncio no painel de novidades.",
    },
    title: "Apolo: PIX do Vale do Ouro sai do contato@ (demais seguem na Cacá)",
    type: "melhoria",
    version: "1.62.67",
  },
  {
    buildTag: "2026-07-25-apolo-setup-empreendimento-e-fila-toggle",
    deployedAt: "2026-07-25T19:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O empreendimento ganhou uma aba própria de Setup: os controles de Recebendo CAD, Análise de Crédito, Pré-venda e a logo saíram de dentro do Cadastro e agora ficam todos numa aba só, mais fácil de achar.",
              "Com a Análise de Crédito desligada no empreendimento, a esteira não consulta mais o Serasa — a ficha aprovada avança direto (pré-venda se ligada, senão credenciado).",
              "Antes de consultar o Serasa, o sistema confere o dígito verificador do CPF: CPF inválido é barrado com aviso, sem gastar a consulta (que é paga).",
            ],
            screen: "Empreendimento e Cadastro de CAD",
          },
          {
            items: [
              "Board, esteira e a ficha do cliente agora se atualizam sozinhos quando você volta pra aba — sem precisar dar F5 pra ver um PIX pago, uma correção de CPF ou uma troca de etapa.",
            ],
            screen: "Board / Esteira",
          },
        ],
      },
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O Setup do lançamento agora tem duas abas: Configurações e Equipe.",
              "O check-in virou um liga/desliga (no lugar da janela de data e hora). Ligado, quem pagou o PIX tem prioridade na fila; desligado, a fila ordena pela hora de chegada (o check-in físico) e o PIX perde a vez.",
              "Ao escolher o empreendimento, a Construtora já vem preenchida com o Incorporador — e continua editável se precisar ajustar.",
            ],
            screen: "Setup do lançamento",
          },
        ],
      },
    ],
    rollback: "1.62.65",
    technical: {
      done: "APOLO: empreendimentos-view.tsx ganhou a aba 'setup' (ApoloEnterpriseTab += 'setup'); o CredenciamentoCard (toggles credenciamento_ativo/analise_credito_habilitada/prevenda_habilitada + limite + valor PIX + logo) foi movido do CadastroTab para a aba Setup. serasa/consultar/route.ts: guard de resolverAnaliseHabilitada (análise off → atualizarEtapa direto pra prevenda/credenciado, sem consultar) + cpfValido antes da consulta (412 sem gastar). Auto-refresh: hook use-refetch-on-focus (visibilitychange+focus, debounce 10s) em board-view.tsx e ApoloPage.tsx. PROMETEU: filaDaRecepcao(credenciados, checkinHabilitado) — troca o credenciadoNaJanela pelo flag config.checkinHabilitado do evento (ligado=ordem do PIX; desligado=ordem de chegada); fila-recepcao.test.ts reescrito (9 testes verdes). setup-view.tsx: 2 abas + CheckinCard (switch grava config.checkinHabilitado, some a janela data/hora) + construtora herda incorporador (só quando vazia); incorporador propagado por PrometeuEmpreendimento/listEmpreendimentosAtivos/rota empreendimentos.",
      motivation: "Lucas: lista de pendências Apolo+Prometeu 'em paralelo'. A aba Setup nasceu de 'não achei a aba de setup do empreendimento' (os toggles estavam soterrados no Cadastro). O check-in liga/desliga substitui a janela data/hora, com a regra de fila validada por ele (25/jul).",
    },
    title: "Apolo: aba Setup do empreendimento + Análise/CPF no crédito; Prometeu: check-in liga/desliga e Setup em abas",
    type: "melhoria",
    version: "1.62.66",
  },
  {
    buildTag: "2026-07-25-comprovante-nao-trava-pdf-rasterizado",
    deployedAt: "2026-07-25T18:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Comprovante de endereço (e documentos genéricos) não travam mais o cadastro por qualidade. Quando a leitura vem com baixa confiança, aparece um aviso âmbar e o cadastro segue — o operador confere os dados na validação. RG/CNH/passaporte e cartão CNPJ continuam exigindo boa leitura.",
              "PDF passou a ser convertido em imagem de alta resolução antes de ir pra leitura. Um comprovante em PDF tirado de portal (nítido) reprovava porque a leitora rasterizava em baixa resolução; agora a conversão é feita no navegador, em alta, e a leitura melhora.",
            ],
            screen: "Cadastro de CAD",
          },
        ],
      },
    ],
    rollback: "1.62.64",
    technical: {
      done: "cadastro-flow.tsx: o gate de qualidade (conferirDocumento) só LANÇA para famílias padronizadas (BLOQUEIA_POR_QUALIDADE = {identidade, cnpj}); comprovante/certidão/'outro' com score < mínimo viram `ext.avisoQualidade` (não-bloqueante), mostrado em âmbar no DocUploader (novo estado `aviso`, lido de `merged.avisoQualidade` após onExtracted). document-capture.ts: arquivoParaLeitura rasteriza a 1ª página do PDF via pdfjs-dist (import DINÂMICO) num JPEG 2600px@0.9 (worker servido de /public/pdf.worker.min.mjs), com FALLBACK pro PDF cru se o pdf.js falhar. Dep nova: pdfjs-dist ^6.1.200.",
      motivation: "Comprovante em PDF de portal (fatura Vero, legível) reprovava por 'qualidade inferior' e o print do mesmo passava. A MOST não mede legibilidade e sim confiança de LEITURA; o PDF cru era rasterizado por ELA em DPI baixo. Decisão do Lucas 25/jul: comprovante não trava (vira aviso) + rasterizar o PDF em alta do nosso lado.",
    },
    title: "Apolo: comprovante em PDF não trava mais o cadastro; leitura de PDF melhorada",
    type: "correcao",
    version: "1.62.65",
  },
  {
    buildTag: "2026-07-25-cads-publico-validacao-recebidas",
    deployedAt: "2026-07-25T17:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Dashboard público de CADs: Validação voltou a contar só o Asana (o 'validacao' do Apolo saiu da soma). Recebidas voltou a ser o total de CADs recebidas do Asana, como era antes.",
            ],
            screen: "Central de CADs (público)",
          },
        ],
      },
    ],
    rollback: "1.62.63",
    technical: {
      done: "CadPublicDashboard.tsx: mValidacao = counts.validacao (removido o `+ apolo?.validacao`). mRecebidas = base.length (era a soma dos cards mValidacao+mAnalise+mRevisao+mPrevenda+mCredenciado+mDuplicados+mIncorretas); pctDoTotal volta a ter base.length como denominador.",
      motivation: "Lucas: 'tira o validação do apolo na somatória no card de validação e volta o recebidas como estava antes'.",
    },
    title: "Apolo: dashboard de CADs — Validação só do Asana, Recebidas como antes",
    type: "correcao",
    version: "1.62.64",
  },
  {
    buildTag: "2026-07-25-cads-publico-fontes",
    deployedAt: "2026-07-25T16:20:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Dashboard público de CADs: cada número agora vem da fonte certa. Validação, Duplicados e CAD's Incorretas do Asana; Análise de Crédito, Crédito em Revisão, Pré-venda, Credenciado e PIX do Apolo (a esteira real).",
              "A Validação soma as seções do Asana ainda em processamento (Recepção, Análise de Documento, Em Cadastro, Análise de Crédito); as que já avançaram (Crédito Reprovado, Emissão Pix, Finalizados) não entram — o funil delas é o Apolo.",
              "A % do Crédito em Revisão passou a ser sobre credenciado + crédito em revisão (o que foi analisado), não sobre revisão + pré-venda.",
              "Validação = Asana + Apolo (soma as duas fontes). CAD's Incorretas conta só a seção exata (as Resolvidas ficam de fora). Recebidas passou a ser a soma dos cards (sem o PIX, que já está no Credenciado), então o total bate com o funil.",
            ],
            screen: "Central de CADs (público)",
          },
        ],
      },
    ],
    rollback: "1.62.62",
    technical: {
      done: "CadPublicDashboard.tsx: os cards Análise de Crédito/Crédito em Revisão/Pré-venda deixaram de contar os records do Asana (counts) e passaram a usar apolo.analiseCredito/creditoRevisao/prevenda (etapas credito/revisao/prevenda da apolo_esteira), junto de Credenciado/PIX que já eram do Apolo; ficam DENTRO do guard `apolo ? ...`. Clicabilidade: carregarListasCredenciamento estendida para as listas do Apolo de credito/revisao/prevenda. FIX DA DIFERENÇA DE 44: o canonical() (mapa seção Asana -> card) foi simplificado — só Duplicados e Incorretas têm balde próprio; TODO o resto do Asana cai em Validação (antes 'Análise de Crédito'/'Crédito Reprovado'/'Emissão Pix' do Asana caíam nos cards de crédito, que agora mostram o Apolo, virando registros órfãos fora de qualquer card). Agora Validação+Duplicados+Incorretas fecham o total Recebidas.",
      motivation: "Lucas: 'somente validação, duplicados, cads incorretas vamos trazer do asana; análise de crédito, crédito em revisão, pré-venda, credenciado e pix vamos trazer do apolo'. E depois: 'deu uma diferença de 44, soma para validação as seções do asana Análise de Crédito, em cadastro'.",
    },
    title: "Apolo: dashboard público de CADs com a fonte certa por card",
    type: "correcao",
    version: "1.62.63",
  },
  {
    buildTag: "2026-07-25-empreendimento-fluxo-configuravel",
    deployedAt: "2026-07-25T15:50:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A tela do empreendimento agora liga/desliga cada etapa da esteira: Recebendo CAD (master), Análise de Crédito (com o limite) e Pré-venda (com o valor do PIX).",
              "Com a Pré-venda DESLIGADA, o cadastro aprovado no crédito vai DIRETO para credenciado, sem gerar PIX — é o 'encerrar os PIX mas continuar cadastrando'.",
              "Os valores de limite e PIX agora são digitados em formato de moeda (R$ 1.000,00).",
            ],
            screen: "Empreendimento · Credenciamento",
          },
        ],
      },
    ],
    rollback: "1.62.58",
    technical: {
      done: "Migration 0071: apolo_enterprise_settings ganhou analise_credito_habilitada e prevenda_habilitada (bool, default true — preserva o fluxo de hoje). empreendimentos-view.tsx: seção de credenciamento reorganizada em hierarquia (master credenciamento_ativo trava os dois blocos quando OFF; Análise de Crédito exige limite; Pré-venda exige valor do PIX; máscara de moeda; trava 'não salva ON sem valor' no cliente E no servidor). enterprise-settings.ts + settings/route.ts: leem/gravam as 2 flags. FLUXO: lib/apolo/limite-credito.ts ganhou resolverPrevendaHabilitada (resolve o empreendimento da ficha, default true); serasa/consultar/route.ts usa isso — crédito aprovado vai para 'prevenda' se ligada, senão DIRETO para 'credenciado'. REVERTIDO no mesmo deploy: os campos editáveis do cadastro (Lucas não quer editável no wizard, corrige na Validação). FALTA (próxima leva): Análise de Crédito OFF pular a consulta do Serasa; hoje o toggle grava mas o fluxo ainda passa pelo crédito.",
      motivation: "Lucas (25/jul): o PIX tem prazo (monta a fila); chega a quinta, encerra os PIX mas continua cadastrando — o crédito aprovado precisa ir direto pra credenciado sem PIX. Cada empreendimento controla seu fluxo.",
    },
    title: "Apolo: fluxo da esteira configurável por empreendimento (liga/desliga crédito e PIX)",
    type: "novidade",
    version: "1.62.59",
  },
  {
    buildTag: "2026-07-24-prometeu-acesso-operador",
    deployedAt: "2026-07-24T22:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "NOVA área do evento em c2x.app.br/evento: a equipe do dia (organizador, atendente, gestor) loga com usuário e senha próprios — não precisa de conta do hub e só enxerga o Prometeu.",
              "Ao entrar, a pessoa cai direto no posto dela: o organizador da recepção já abre no check-in.",
              "No Setup do Prometeu você cadastra cada operador: nome, usuário (nome.sobrenome), senha, perfil e posto.",
            ],
            screen: "Acesso do operador",
          },
        ],
      },
    ],
    rollback: "1.62.57",
    technical: {
      done: "AUTH PRÓPRIA do operador do evento (não é hub_user). Migration 0070 prometeu_operadores (username, senha_hash scrypt, perfil, zona, mesa_id). lib/prometeu/operador-auth.ts (scrypt + token HMAC assinado com PROMETEU_SESSION_SECRET, TTL 14h, 10 testes de segurança) + operadores.ts (CRUD) + operador-server.ts (lerOperadorDaSessao/autorizarOperacao). Rotas /api/prometeu/operador/{login,logout,eu} públicas (allowlist do proxy, cada uma se valida por dentro; login com rate limit 8/5min, cookie httpOnly+secure assinado) + /operadores admin (só hub). ÁREA /evento: layout limpo sem MobileViewport; /evento na allowlist do auth-provider (o operador não tem sessão do hub); evento-app decide login vs posto por perfil; login-operador. GATE: proxy.ts deixa /api/prometeu/* passar quando há cookie prometeu_op (a rota valida por dentro); credenciados PATCH checkin aceita operador OU hub via autorizarOperacao, TODAS as demais ações (mover/pagamento/chamar/etc) seguem authorizePrometeuWrite (só hub); fila e eventos GET aceitam operador. Setup: equipe-conteudo.tsx reescrito para cadastrar operadores. Removido o modelo antigo hub_users (prometeu_equipe/listEquipe/meuPosto). Typecheck limpo, 48 testes prometeu verdes.",
      motivation: "Lucas (24/jul): a equipe do evento loga com nome.sobrenome + senha, só vê o Prometeu, cai no posto. FASE 1 (login) da operação do dia; faltam as telas de salão/secretaria/atendente e o trilho comercial do C2X — próximo chat.",
    },
    title: "Prometeu: acesso próprio da equipe do evento (login por posto)",
    type: "novidade",
    version: "1.62.58",
  },
  {
    buildTag: "2026-07-24-prometeu-checkin-aba-fila",
    deployedAt: "2026-07-24T20:15:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O check-in do organizador ganhou a aba FILA: mostra só quem JÁ fez check-in (não o cadastro inteiro), com a hora de entrada, o marcador de PIX pago e busca — o organizador confere na hora se a pessoa entrou.",
              "Corrigido: ler o QR antes da lista carregar não acusa mais 'não é deste lançamento'. Agora avisa que a lista está carregando e pede para tentar de novo.",
              "O termo 'crachá' virou 'credenciamento' nas mensagens.",
            ],
            screen: "Check-in (celular)",
          },
        ],
      },
    ],
    rollback: "1.62.55",
    technical: {
      done: "checkin-view.tsx: duas abas (checkin/fila) num toggle; a camera (usarLeitorQr) so roda com aba==='checkin' (economiza bateria e nao le QR na fila). AbaFila lista os credenciados ordenados (quem entrou primeiro, por hora do check-in desc; depois os que faltam, alfabetico) com busca, badge verde/relogio por status e o icone de PIX pago. GUARD: identificar() agora bloqueia com mensagem clara quando carregando|credenciados.length===0 — antes, ler o QR durante o carregamento da lista (0 credenciados) caia direto em 'nao e deste lancamento', que foi o que o Lucas viu (evento Vale do Ouro estava configurado e com 348 credenciados; era so timing). Rotas /api/prometeu/eventos e /fila respondem em <0.3s, nao havia travamento. Textos 'cracha' -> 'credenciamento'.",
      motivation: "Lucas testou no celular: bipou e deu 'este cracha nao e deste lancamento' com '0 na fila'. Era a lista ainda carregando. E pediu: aba de fila para o organizador ver se a pessoa realmente entrou, e trocar 'cracha' por 'credenciamento'.",
    },
    title: "Prometeu: aba de fila no check-in + fim do falso 'não é deste lançamento'",
    type: "melhoria",
    version: "1.62.57",
  },
  {
    buildTag: "2026-07-24-prometeu-aba-mobile",
    deployedAt: "2026-07-24T19:45:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O app no celular ganhou a aba PROMETEU, ao lado de Hermes e Iris. É por ela que o organizador chega no check-in do evento.",
              "Antes a tela existia mas só pela URL direta; como o app abre em tela cheia (sem barra de endereço), não havia como chegar nela pelo celular.",
            ],
            screen: "App mobile",
          },
        ],
      },
    ],
    rollback: "1.62.54",
    technical: {
      done: "mobile-top-bar.tsx: terceira aba (ListOrdered, /m/prometeu) ao lado de Hermes/Iris; texto e gaps reduzidos (12.5px, gap-1, icone 15) para as tres caberem na largura do celular. A tela /m/prometeu (check-in por QR) ja existia desde a 1.62.49 mas nao tinha ponto de entrada no app standalone. Quando a frente de equipe/postos fechar, esta mesma aba passa a abrir no posto atribuido a pessoa logada.",
      motivation: "Lucas, no celular: 'ele abre full eu nao tenho como ir para o prometeu'. A PWA abre em standalone, sem barra de URL, entao sem uma aba no menu nao havia como acessar o check-in.",
    },
    title: "Prometeu: aba no app do celular para chegar no check-in",
    type: "melhoria",
    version: "1.62.55",
  },
  {
    buildTag: "2026-07-24-reenvio-retificacao-relatorio-v2",
    deployedAt: "2026-07-24T19:20:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Botão de reenvio do relatório com retificação para as imobiliárias afetadas (banner 'desconsidere o e-mail anterior').",
            ],
            screen: "Imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.62.52",
    technical: {
      done: "O relatorio das 18h disparou as 18:00:52 (cron), 4 minutos ANTES de a correcao das imobiliarias terminar (18:05:21) — a trava do envio nao ficou no ar a tempo do cron. 7 imobiliarias receberam com cliente errado (J&F, LM, Romulo, Paulo Oliveira, Flat com cliente a mais; RR e Mais Lotes sem clientes que sao delas). Como o banco ja esta correto, um reenvio sai certo. montarRelatorioImobiliaria ganhou `avisoRetificacao` (banner ambar no topo + prefixo [Correcao] no assunto + linha no texto). relatorio-diario/route.ts ganhou modo `?reenvio=1&imobiliarias=a|b|c` que envia SO por e-mail (real da imobiliaria), SO para as listadas, com o banner. Botao de reenvio em vincular-imobiliarias.tsx aciona com o Bearer da sessao. O 1o reenvio pegou so 6 de 7: o filtro casa o NOME DO RELATORIO (legal_name||display_name), e a LM Imoveis aparece como 'ODAIR RODRIGUES TEIXEIRA' (o titular do CNPJ), entao 'LM IMOVEIS' nao casava. O campo de termos virou EDITAVEL (pre-preenchido com 'ODAIR RODRIGUES TEIXEIRA' para completar a LM que faltou), o que tambem evita novo ciclo se algum nome de imobiliaria divergir do esperado.",
      motivation: "Lucas: 'vamos enviar para 7 e colocar uma mensagem falando para desconsiderar o e-mail anterior'.",
    },
    title: "Apolo: reenvio do relatório com retificação para as 7 afetadas",
    type: "correcao",
    version: "1.62.54",
  },
  {
    buildTag: "2026-07-24-relatorio-imob-religado",
    deployedAt: "2026-07-24T18:20:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Relatório das imobiliárias religado: as 9 CADs do Vale do Ouro com imobiliária errada foram corrigidas e o envio voltou ao normal.",
            ],
            screen: "Relatório das imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.62.51",
    technical: {
      done: "relatorio-diario/route.ts: ENVIO_RELATORIO_PAUSADO volta a false, religando o cron das 18h e o disparo manual. A flag fica no codigo como kill-switch reutilizavel. Correcao de dados concluida em producao: 8 CADs re-vinculadas do Asana errado para a imobiliaria do C2X (5 -> RR Solucoes, 3 -> Mais Lotes), tanto no vinculo 'Imobiliaria da CAD' (escopo do relatorio) quanto no texto da esteira; VALERIA DO NASCIMENTO FERREIRA mantida como RR (unico caso de cadastro C2X de outro empreendimento, confirmado por varredura). 472 fichas do Vale do Ouro intactas.",
      motivation: "Lucas autorizou destravar apos a correcao das imobiliarias.",
    },
    title: "Apolo: relatório das imobiliárias religado após a correção",
    type: "correcao",
    version: "1.62.52",
  },
  {
    buildTag: "2026-07-24-etiqueta-tamanho-certo",
    deployedAt: "2026-07-24T17:30:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "CORRECAO: a etiqueta saia PEQUENA num canto da folha. Agora imprime no tamanho cheio, 100x50mm, ocupando a etiqueta inteira.",
            ],
            screen: "Etiqueta",
          },
        ],
      },
    ],
    rollback: "1.62.49",
    technical: {
      done: "A impressao deixou de sair da pagina do hub e passou a sair de um DOCUMENTO ISOLADO (iframe), exatamente como o mockup public/prometeu/etiqueta.html que ja tinha sido validado na Honeywell. Causa do 'pequeno': window.print() na pagina inteira do app fazia o CSS global do hub e o preset de papel do driver ('Prometeu') competirem com o @page{size:100mm 50mm}, e o Chrome encolhia a etiqueta num canto de uma folha maior. imprimir-etiquetas.ts monta um iframe oculto, escreve um documento so com as etiquetas + ETIQUETA_PRINT_DOC_CSS (visual + @page + break-after) e chama iframe.contentWindow.print(); espera doc.images carregarem antes (QR e data URL, mas o logo vem da rede) e remove o iframe no afterprint. etiqueta-css.ts foi partido em ETIQUETA_TELA_CSS (preview React) e ETIQUETA_PRINT_DOC_CSS (documento de impressao); o hack antigo de #print-area + portal + body>*{display:none} foi removido, nao e mais necessario. VALIDADO no navegador: a .etq no iframe mede 378x189px = 100x50mm exatos e o stylesheet tem @page size 100mm 50mm.",
      motivation: "Lucas, testando na Honeywell depois do fix da folha branca: 'saiu bem pequena'. A raiz era imprimir a pagina do app em vez de um documento isolado como o mockup fazia.",
    },
    title: "Prometeu: etiqueta imprime no tamanho certo (100x50mm)",
    type: "correcao",
    version: "1.62.50",
  },
  {
    buildTag: "2026-07-24-prometeu-checkin-qr",
    deployedAt: "2026-07-24T16:35:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "NOVA TELA para o organizador que fica na porta da fila: abre no celular em c2x.app.br/m/prometeu, aponta a camera para o QR do cracha e o check-in esta feito.",
              "O retorno toma a tela inteira: VERDE quando entrou, AMBAR quando a pessoa ja tinha entrado, VERMELHO quando o cracha e de outro lancamento. Mostra o nome grande e avisa quando o cliente ja pagou o PIX de R$ 1.000.",
              "Sem camera ou sem permissao, da para digitar o codigo do cracha. Se o codigo servir para mais de uma pessoa, a tela pergunta qual delas em vez de escolher sozinha.",
              "Os atendentes seguem no notebook, na tela normal do Prometeu. Esta tela e so para quem esta em pe na fila.",
            ],
            screen: "Check-in (celular)",
          },
          {
            items: [
              "CORRECAO: a etiqueta imprimia em BRANCO. Ja sai com o conteudo na Honeywell.",
            ],
            screen: "Etiqueta",
          },
        ],
      },
    ],
    rollback: "1.62.48",
    technical: {
      done: "CHECK-IN: app/m/prometeu (nova rota, dentro do /m para herdar sessao, login e PWA) + modules/prometeu/blocks/checkin/. usar-leitor-qr.ts tenta BarcodeDetector (nativo, sem custo de CPU) e cai para jsQR (dependencia nova, ^1.4.0, JS puro) quando nao existe: BarcodeDetector NAO existe no Safari do iPhone nem no Firefox, entao so com ele o organizador de iPhone ficaria sem check-in na porta do evento. facingMode environment forca a camera traseira (sem isso abre a frontal). Trava anti-repeticao de 2,5s por valor lido: a camera le o mesmo cracha dezenas de vezes por segundo enquanto ele esta na frente dela. O componente guarda o callback numa ref para nao remontar a camera a cada render. QR de outro lancamento e recusado por comparacao com a lista do evento; codigo curto ambiguo abre escolha manual (ver credencial.ts). Reusa fazerCheckInRemoto e a acao 'checkin'. h-full em vez de min-h-dvh: o MobileViewport ja trava 100dvh. CORRECAO DA IMPRESSAO EM BRANCO (a 1.62.48 subiu com esse bug): no mockup HTML o #print-area era filho direto do <body>, entao o @media print body>*{display:none} + #print-area{display:block} funcionava. Portado para React, o #print-area ficou enterrado na arvore do HubShell — body>*{display:none} escondia o container inteiro e a etiqueta ia junto (folha em branco). FIX: etiqueta-view.tsx monta o #print-area via createPortal(document.body), voltando a ser filho direto do body, e o CSS ganhou #print-area{display:none} de base para esconde-lo na tela fora da impressao. Validado no navegador: fora do print display=none e filho direto do body; no print o app some (body>*) e o #print-area vence por especificidade de ID e reaparece com o conteudo.",
      motivation: "Lucas: 'os organizadores irao ficar somente com o celular ou um tablet nas filas que tem o check-in.' E, testando a etiqueta da 1.62.48 na Honeywell: 'ta imprimindo branco' — a armadilha classica do porte mockup->React da impressao.",
    },
    title: "Prometeu: check-in pelo celular + etiqueta que imprime de verdade",
    type: "novidade",
    version: "1.62.49",
  },
  {
    buildTag: "2026-07-24-prometeu-etiqueta-real",
    deployedAt: "2026-07-24T16:20:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A tela de Etiqueta saiu do mockup: agora lista os credenciados DE VERDADE do lançamento (348 hoje), no lugar dos 13 clientes de exemplo.",
              "Todo credenciado do lançamento esta apto a imprimir. A lista nasce da fila, do que o Apolo entrega, e o empreendimento vem do evento — nao ha mais escolha de empreendimento na propria tela, que era o que gerava etiqueta do lançamento errado.",
              "O QR passou a ser de VERDADE. O do mockup era um desenho, nenhum leitor conseguiria ler.",
              "Cliente que ja pagou o PIX de R$ 1.000 sai com um icone na etiqueta, sem texto: e sinal para o time interno saber que ha valor a abater.",
              "A tela marca quem ja teve etiqueta impressa, entao da para ver quem falta em vez de reimprimir o lote inteiro.",
            ],
            screen: "Etiqueta",
          },
          {
            items: [
              "O termo 'bipar' saiu de todas as telas do modulo: o nome do processo e CHECK-IN. As 'Janelas de credenciamento' agora sao 'Janelas de check-in'.",
            ],
            screen: "Setup, Fila e Central",
          },
        ],
      },
    ],
    rollback: "1.62.47",
    technical: {
      done: "modules/prometeu/blocks/etiqueta/ (novo): etiqueta-view.tsx le prometeu_credenciados via fetchFila (a mesma fonte da Fila, sem lista paralela) e etiqueta-css.ts traz o CSS de impressao COPIADO LITERALMENTE de public/prometeu/etiqueta.html. O CSS nao foi reescrito em Tailwind de proposito: cada medida em mm e cada break-after foi descoberto contra a Honeywell PC42t real e esta documentado em [[reference-prometeu-etiqueta-termica]] (lote empilhado numa pagina so, etiqueta em branco no fim, corte na borda a ~1,5mm). lib/prometeu/credencial.ts (novo, 11 testes): o QR carrega o ID COMPLETO do credenciado — encurtar nao traz ganho (a camera le qualquer tamanho) e traria risco real, porque um codigo de 6 digitos tem ~0,4% de chance de colidir entre 348 pessoas, o que no dia seria check-in na pessoa ERRADA; o codigo curto APL-XXXXXX continua impresso apenas como plano B para digitar quando o QR nao le, e quem busca por ele TEM que tratar mais de um resultado. O QR nao carrega URL: o cracha fica exposto o evento inteiro e qualquer um fotografa. QR gerado com a lib qrcode que ja existia (comprovante do Serasa). marcarEtiquetaImpressaRemoto carimba no evento afterprint, nunca antes: carimbar no clique marcaria como impressa a etiqueta de quem cancelou o dialogo. Backend nao precisou de nada novo — marcarEtiquetaImpressa e a acao 'etiqueta' ja existiam. Terminologia: bipar/bipou/bipagem/janela de credenciamento trocados em types, data, central, fila, setup, operations e rotas; public/prometeu/atendente.html ficou de fora por ser mockup a ser substituido.",
      motivation: "Lucas, sobre a tela de etiquetas: 'estao com dados mockados ainda, e nao tem nenhum cliente do Vale do Ouro que esta credenciado que esteja pronto para ser emitido as etiquetas. Hoje essa tela faz o vinculo errado com o empreendimento. os clientes tem que nascer da fila, do que o apolo entrega'. E sobre o PIX: 'nao pode ser escrito, e so um icone para referenciar para o time interno que aquele cliente pagou o pix, pois precisamos abater esse valor'. Evento real em 01/08.",
    },
    title: "Prometeu: etiqueta de verdade, com QR que lê e marca de PIX pago",
    type: "novidade",
    version: "1.62.48",
  },
  {
    buildTag: "2026-07-24-prometeu-lancamento-na-tela",
    deployedAt: "2026-07-24T15:20:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A Fila agora mostra DE QUAL LANCAMENTO ela e, com o nome do empreendimento e a data ao lado do titulo.",
              "Se o evento ainda nao estiver ligado a um empreendimento, a tela avisa e aponta o Setup, em vez de deixar a duvida no ar.",
              "O termo 'bipar' saiu das telas: o nome do processo e CHECK-IN.",
            ],
            screen: "Fila",
          },
          {
            items: [
              "Ao escolher o empreendimento do evento, o nome por extenso passa a ser guardado junto, e e ele que aparece nas outras telas.",
            ],
            screen: "Setup",
          },
        ],
      },
    ],
    rollback: "1.62.46",
    technical: {
      done: "lib/prometeu/lancamento.ts (novo): nomeDoLancamento (config.enterpriseNome -> enterpriseCode -> nome do evento, degrade honesto, nunca inventa empreendimento), lancamentoSemEmpreendimento e dataDoLancamento. ARMADILHA COBERTA POR TESTE: data_evento e timestamptz e o Setup grava so o dia ('2026-08-01'), que o Postgres guarda como meia-noite UTC — formatar via Date no fuso de Brasilia devolveria 31/07 e o evento apareceria com a data errada em TODA tela; por isso a data e lida como texto puro (regex nos 10 primeiros chars), sem passar por Date. O nome do empreendimento so existe no C2X (MySQL legado) e buscar la a cada leitura sairia caro, entao PrometeuEventoConfig ganhou enterpriseNome e o Setup grava junto (ele ja tem a lista carregada) — sem migration, usando o config que existe justamente para 'o que o Setup preenche e ainda nao merece coluna propria'. fila-view.tsx: chip com Building2 + aviso ambar quando falta vinculo. Terminologia: 'bipar/bipou/bipagem' trocado por check-in em types.ts, central-view, fila-view, setup-view (texto visivel) e prometeu-operations; public/prometeu/atendente.html ficou de fora de proposito, e mockup a ser substituido. 10 testes em lancamento.test.ts.",
      motivation: "Lucas, abrindo a frente do Prometeu: 'me incomoda o fato de eu nao saber de qual empreendimento (lancamento) e essa fila, tinha que ter alguma coisa vinculando ao Vale do Ouro'. O evento em producao estava com enterprise_id, enterprise_code e data_evento nulos, embora o Setup ja tivesse os campos. Tambem e a fundacao da etiqueta real: sem saber o empreendimento, a etiqueta nao tem de quem nascer.",
    },
    title: "Prometeu: a fila diz de qual lancamento ela e",
    type: "melhoria",
    version: "1.62.47",
  },
  {
    buildTag: "2026-07-24-pix-pago-credencia",
    deployedAt: "2026-07-24T14:05:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cliente que PAGA o PIX vai para Credenciado com a tag PIX PAGO, mesmo quando o envio do link falhou e o time mandou o link na mao pela central.",
              "Antes ele pagava e continuava parado em Pre-venda no Board, parecendo cliente travado com o dinheiro ja na conta.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.62.45",
    technical: {
      done: "prevenda-fluxo.ts, aoConfirmarPagamentoPrevenda: alem de carimbar pago_em/pagamento_ref e mexer na fila, passa a mover a etapa prevenda -> credenciado (update com eq('etapa','prevenda'), mesma trava do envio: nunca puxa ninguem para tras). Quem credenciava era so o aoEnviarPixPrevenda, ou seja o ENVIO do link; quando o disparo falhava, o pagamento nao consertava a etapa. A fila do Prometeu ja estava correta nesse cenario (o ramo 'pagou e nao estava na fila' insere com a hora do pagamento): caso real 23/07, VICENTINA LUZIA DE PAULO entrou na posicao 66, entre quem pagou 19:25 e quem pagou 21:40. Varredura da base: 73 pagaram, 72 ja credenciados, 1 presa (a Vicentina). NAO mexi no significado de 'credenciado' (documentos validos + credito ok + PIX gerado): confirmado pelo Lucas que os 275 credenciados sem pagamento sao o desenho correto.",
      motivation: "Lucas: 'a Vicentina nao recebeu o link e o sistema entendeu que ela ficou presa no pre-venda, mas meu time mandou via central o link e ela pagou'. Pagamento confirmado tem que credenciar, tenha o aviso saido ou nao.",
    },
    title: "Apolo: PIX pago credencia o cliente mesmo se o link falhou",
    type: "correcao",
    version: "1.62.46",
  },
  {
    buildTag: "2026-07-24-iris-atendimento-nao-some-v2",
    deployedAt: "2026-07-24T12:15:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "CORRECAO CRITICA: atendimento ABERTO nao some mais do Board. A tela carregava so os 200 tickets mais recentes, entao os antigos ficavam invisiveis para o time — mas continuavam bloqueando novo atendimento do mesmo cliente, que ficava mandando mensagem sem ninguem ver.",
              "O Historico agora enxerga TODOS os atendimentos encerrados (antes mostrava 53 de 775), entao buscar um protocolo antigo passa a funcionar.",
            ],
            screen: "Board e Historico",
          },
          {
            items: [
              "O cliente da carteira aparece com o NOME DO APOLO, nao com o apelido do WhatsApp. Quem estava listado como 'beteapa70' volta a ser 'Elizabete Aparecida das Dores'. So os 100 primeiros telefones da fila eram cruzados com o Apolo; do 101 em diante ficava o apelido.",
            ],
            screen: "Nome do cliente",
          },
          {
            items: [
              "Atendimento que morreu na mao da CACA agora fecha sozinho: se ela respondeu e o cliente nao voltou em 4 horas, o ticket encerra com o motivo 'Sem interação - Assistente Virtual'.",
              "Isso libera o cliente para o time chamar de novo: enquanto o ticket ficava aberto, qualquer tentativa de iniciar conversa dava 'cliente ja esta em atendimento'.",
              "Atendimento com operador responsavel NUNCA e fechado pela automacao, mesmo parado.",
            ],
            screen: "Encerramento automatico",
          },
        ],
      },
    ],
    rollback: "1.62.43",
    technical: {
      done: "iris-data-client.ts: a leitura unica com .limit(200) ordenada por opened_at desc virou DUAS com a mesma regua de acesso (montarQueryTickets): abertos (neq status closed, sem janela de data) + encerrados (eq closed, order closed_at desc, limit 400). ticketsRows concatena as duas. A trava de 'cliente ja em atendimento' consulta o BANCO, por isso ticket fora da janela bloqueava sem aparecer. Incidente 24/jul: AT-000033 (Leticia, 29/06) e AT-001045 (Elizabete) presos com uma operadora que nao os via. ARMADILHA (a 1.62.44 subiu e foi revertida por isso): os ids dos tickets viajam na URL do PostgREST em .in('ticket_id', ids) — com 200 tickets a URL tinha 8k chars e passava, com ~1.000 foi a 27k e o Supabase respondeu 400 Bad Request, derrubando a tela inteira com 'nao foi possivel carregar a operacao'. Medido contra o banco real: 300 ids = 12k chars = 200 OK; 700 ids = 27k chars = 400. Agora contatos, mensagens e usuarios sao lidos pelo helper lerEmLotes (100 ids por requisicao, ~4k chars, 3x de folga), com os ABERTOS na frente da lista para que o corte por lote so afete preview de encerrado antigo. " +
        "NOME DO APOLO: /api/iris/apolo/phone-match ja resolvia as variantes de 9o digito (a Elizabete casa por 31980208670 vindo de 553180208670), mas normalizePhoneInput corta a lista em .slice(0,100) — com a fila acima disso, o excedente voltava 'missing' e ticketContactLabel caia no display_name do contato (apelido do WhatsApp). enrichTicketsWithCrm360 passou a mandar em lotes de 100 e a so consultar quem nao tem resposta em cache (registrado = nunca reconsulta; missing = TTL de 10min), senao a janela maior de tickets multiplicaria o custo do refresh de 90s — ver [[project-hermes-cost]]. FECHAMENTO AUTOMATICO: lib/iris/fechar-sem-interacao.ts + cron horario /api/iris/tickets/fechar-sem-interacao (x-vercel-cron ou CRON_SECRET, allowlist do proxy). Fecha quando a ULTIMA mensagem e da CACA (outbound + sender_type operator + sender_user_id NULL) ha mais de 4h; ignora ticket com assigned_to_user_id e reconfirma o filtro no proprio UPDATE (corrida com o operador). closed_at = hora da ultima mensagem, nao a do cron, para o historico e os relatorios de tempo nao mentirem. A leitura das mensagens pagina por .range() ate esgotar: com corte por limit, os tickets MAIS parados (mensagens antigas) seriam os primeiros a escapar. ?simulacao=1 conta sem tocar. Regra coberta por 9 testes em fechar-sem-interacao.test.ts. Backlog medido em 24/jul: 104 candidatos, todos sem operador, o mais antigo parado desde 14/jul.",
      motivation:
        "Time relatou 'cliente em atendimento' para clientes que nao apareciam no Board, e Historico mostrando 53 encerrados de 775. As duas coisas eram o mesmo limite de 200. Na mesma varredura: 104 tickets zumbis presos na CACA e cliente da carteira exibido com o apelido do WhatsApp.",
    },
    title: "Iris: atendimento aberto nao some mais do Board (e o Historico ve tudo)",
    type: "correcao",
    version: "1.62.45",
  },
  {
    buildTag: "2026-07-24-comparativo-asana-fecha-conta",
    deployedAt: "2026-07-24T10:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O comparativo Asana x Board passou a reconhecer quem JA esta na esteira mesmo sem o vinculo da task (CAD cadastrada a mao ou pelo portal). Antes essas apareciam como 'falta importar' e os numeros do Asana e do Board nunca fechavam.",
              "A linha de cada secao agora mostra 'no Board' com o total real e, entre parenteses, quantas estao sem vinculo da task.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.62.42",
    technical: {
      done: "comparativo/route.ts: monta um Set com os nomes normalizados das fichas da esteira do empreendimento; CAD sem apolo_source_links cujo nome bate vira noBoardSemVinculo (por secao e no resumo) em vez de faltante. resumo.faltamImportar = validas - importadas - noBoardSemVinculo, entao naAsanaValidas = importadas + noBoardSemVinculo + faltamImportar. comparativo.tsx: 'faltam' desconta noBoardSemVinculo e o 'no Board' soma os dois, com o detalhe entre parenteses. Bloco 4 do plano das duplicatas. NAO mexi no mapeamento secao->etapa (Credito Reprovado -> revisao): reetiquetaria em massa, fica para decisao a parte.",
      motivation: "Lucas: 'no asana eu tenho um numero em credito reprovado, no apolo eu tenho outro'. A Thais, cadastrada a mao, existia no Board mas contava como faltante por nao ter vinculo de task.",
    },
    title: "Comparativo Asana x Board: os numeros passam a fechar",
    type: "correcao",
    version: "1.62.43",
  },
  {
    buildTag: "2026-07-24-leitura-asana-antiduplicata",
    deployedAt: "2026-07-24T10:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Ler os documentos de uma CAD que JA foi importada nao cria mais uma segunda ficha da mesma pessoa: o sistema reconhece a CAD pelo vinculo com a task do Asana e reaproveita a ficha existente.",
              "Nova trava: se ja existe ficha com o MESMO NOME no mesmo empreendimento (em outro cadastro), a CAD vai para CONFERENCIA em vez de entrar duplicada. Pega o caso do CPF lido do documento errado (o do conjuge).",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.62.41",
    technical: {
      done: "criarEntidadesDoLote (asana-import.ts): antes de qualquer coisa consulta apolo_source_links pelo gid — task ja vinculada reusa aquele entity_id e conta como reaproveitada, em vez de cair no dedup por CPF e criar entidade nova. separarPorConflito: quando a entidade e nova, roda fichaDeHomonimo (nome normalizado igual em OUTRA entidade + mesmo empreendimento na esteira) e devolve conflito para conferencia. Bloco 2 do plano das duplicatas. 256 testes passando.",
      motivation: "GUILHERME e WELINTON viraram duas fichas: a leitura releu a task ja credenciada e, como o OCR trouxe o CPF do conjuge (CPFs '379...'), o dedup por CPF nao casou e criou a segunda ficha.",
    },
    title: "Importar CADs: nao duplica mais ficha ao reler documento",
    type: "correcao",
    version: "1.62.42",
  },
  {
    buildTag: "2026-07-24-templates-imob-diagnostico",
    deployedAt: "2026-07-24T09:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Ao criar os templates na Meta, a tela agora mostra o MOTIVO real da recusa (o que a Meta reclamou), em vez do generico 'Invalid parameter'.",
            ],
            screen: "Mensagens do WhatsApp (Meta)",
          },
        ],
      },
    ],
    rollback: "1.62.40",
    technical: {
      done: "templates/route.ts: o catch passou a extrair error_user_title/error_user_msg/error_subcode de MetaWhatsAppSendError.details e devolver em `detalhe`; vincular-imobiliarias.tsx exibe esse detalhe abaixo do status de cada template. Os 4 textos ja tinham sido corrigidos (v1.62.38) para nao terminarem numa variavel, que era a causa do 'Invalid parameter'.",
      motivation: "A criacao dos 4 templates falhou com 'Invalid parameter', que sozinho nao diz nada — sem o detalhe da Meta, corrigir template vira adivinhacao.",
    },
    title: "Templates da imobiliaria: mostrar o motivo real da recusa da Meta",
    type: "melhoria",
    version: "1.62.41",
  },
  {
    buildTag: "2026-07-24-cadastro-manual-dedup-fluxo",
    deployedAt: "2026-07-24T09:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cadastro de CAD (prospect): depois de escolher a imobiliária, o operador escolhe o EMPREENDIMENTO dela (se ela trabalha mais de um; se só um, já vem preenchido) e o CORRETOR. A CAD entra na esteira já com empreendimento — não nasce mais 'órfã'.",
              "DEDUP por CPF/CNPJ: se a pessoa já tem ficha, o cadastro NÃO cria uma segunda — avisa que já existe. Fecha a causa dos cadastros duplicados no mesmo empreendimento (os 'dois Pedro Alexandro').",
            ],
            screen: "Cadastro de CAD",
          },
        ],
      },
    ],
    rollback: "1.62.39",
    technical: {
      done: "createApoloEntity ganhou dedup por documento OPT-IN (input.dedupPorDocumento) que casa document_hash + apolo_entity_identifiers; ligado só nos fluxos de PROSPECT (rota /api/apolo/cadastro/salvar e /api/publico/cad/salvar), retornando entityIdExistente (409) em vez de inserir cego — os fluxos de imobiliária/corretor ficam intactos (têm dedup por papel). A rota do cadastro manual passou a gravar apolo_esteira (empreendimento/imobiliaria/corretor, etapa validacao, origem 'cadastro-manual') a partir do novo campo payload.vinculo. Novas rotas GET /api/apolo/imobiliarias/[id]/empreendimentos e /corretores (lib/apolo/imobiliaria-cadastro.ts, reusando empreendimentosHabilitados do portal). Wizard cadastro-flow.tsx: no prospect interno, seletor de empreendimento (0=aviso,1=read-only,>1=select) + corretor, exigidos para avançar; vinculo no payload. Bloco 1 do plano de correção das duplicatas.",
      motivation: "Incidente: o cadastro manual criava fichas duplicadas (sem dedup) e sem empreendimento (nasciam órfãs, quebrando aviso ao coordenador e relatórios). Lucas pediu o fluxo imobiliária->empreendimento->corretor + dedup.",
    },
    title: "Cadastro manual: fluxo imobiliária→empreendimento→corretor + dedup",
    type: "correcao",
    version: "1.62.40",
  },
  {
    buildTag: "2026-07-24-backfill-empreendimento-asana",
    deployedAt: "2026-07-24T08:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova varredura 'Empreendimento faltando': acha as fichas que entraram na esteira sem empreendimento, procura cada uma no Asana pelo nome e preenche. Tem Simular (só mostra) antes de Preencher.",
            ],
            screen: "Vincular imobiliárias",
          },
        ],
      },
    ],
    rollback: "1.62.38",
    technical: {
      done: "backfill-empreendimento.ts + rota /api/apolo/esteira/backfill-empreendimento (GET simula, POST aplica; authorizeApoloWrite, só com ASANA_ACCESS_TOKEN = producao). Reusa escanearCads (todas as CADs, cada uma com empreendimento) + casarComApolo (casa por nome, mesma regra do import). Só grava quando o casamento é exato (1 candidato) e consistente (mesma pessoa, mesmo empreendimento em todas as CADs); homonimos/divergentes viram lista de conferencia. So preenche campo VAZIO (is null), nunca sobrescreve. Botao Simular/Preencher em vincular-imobiliarias.",
      motivation: "Fichas de cadastro manual entravam sem empreendimento e quebravam o aviso ao coordenador + sumiam dos relatorios. Rede pra pescar as orfas (e as futuras) a partir do Asana, que e a fonte das CADs.",
    },
    title: "Varredura para preencher empreendimento faltando pelo Asana",
    type: "melhoria",
    version: "1.62.39",
  },
  {
    buildTag: "2026-07-24-aviso-coordenador-empreendimento",
    deployedAt: "2026-07-24T07:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Quando o aviso de reprovacao ao coordenador falha por a ficha estar SEM empreendimento, a mensagem agora diz isso claramente, em vez de culpar o telefone do coordenador.",
            ],
            screen: "Analise de credito",
          },
          {
            items: [
              "Corrigidos os textos dos 4 templates de aviso a imobiliaria: a Meta recusava ('Invalid parameter') porque terminavam numa variavel; agora tem texto depois e passam na aprovacao.",
            ],
            screen: "Mensagens do WhatsApp (Meta)",
          },
        ],
      },
    ],
    rollback: "1.62.37",
    technical: {
      done: "disparo-reprovacao.ts: quando nao ha telefone do coordenador, a mensagem distingue os casos (ficha sem empreendimento / empreendimento nao mapeado no C2X / sem coordenador de vendas / coordenador sem telefone) em vez do generico 'coordenador sem telefone'. A causa mais comum era ficha com apolo_esteira.empreendimento NULL (3 fichas do cadastro manual, corrigidas no banco para 'Vale do Ouro'). templates/route.ts: os 4 textos foram reescritos para nao terminar numa {{n}} (regra da Meta UTILITY).",
      motivation: "Incidente: aviso de reprovacao da Thais falhava com 'Coordenador sem telefone', mas a causa real era a ficha sem empreendimento. E os templates da imobiliaria davam 'Invalid parameter' na criacao.",
    },
    title: "Aviso ao coordenador: mensagem honesta + templates da imobiliaria corrigidos",
    type: "correcao",
    version: "1.62.38",
  },
  {
    buildTag: "2026-07-24-templates-imob-meta",
    deployedAt: "2026-07-24T06:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Botao para criar na Meta os 4 templates de aviso a imobiliaria (credito reprovado, PIX enviado, PIX pago e relatorio) e conferir o status de aprovacao, na tela de vincular imobiliarias.",
            ],
            screen: "Mensagens do WhatsApp (Meta)",
          },
        ],
      },
    ],
    rollback: "1.62.36",
    technical: {
      done: "Bloco 'Mensagens do WhatsApp (Meta)' em vincular-imobiliarias.tsx: POST /api/apolo/imobiliarias/templates cria os 4 templates UTILITY pt_BR (texto, sem midia) no numero 4143; GET mostra o status (APPROVED/PENDING/REJECTED). A rota exige sessao (authorizeApoloWrite), por isso o acionamento e por botao na tela — nao da para disparar via CLI. Textos aprovados pelo Lucas; template do relatorio ficou so texto (avisa que foi por e-mail).",
      motivation: "Lucas: criar as mensagens para disparar os relatorios; decidiu manter tudo em texto (sem a imagem dos cards).",
    },
    title: "Criar os templates de aviso a imobiliaria na Meta",
    type: "melhoria",
    version: "1.62.37",
  },
  {
    buildTag: "2026-07-24-emails-da-caca",
    deployedAt: "2026-07-24T05:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Todos os e-mails automaticos (cobranca e recibo do PIX, avisos e relatorio das imobiliarias) passam a sair da CAIXA DA CACA, com o nome 'Caca - C2X' no remetente, no lugar do 'contato@' generico.",
            ],
            screen: "E-mails da Caca",
          },
        ],
      },
    ],
    rollback: "1.62.35",
    technical: {
      done: "Novo getCacaSender() em lib/iris/gmail (nome 'Caca - C2X' + caixa robo caca@ via getGmailIngestMailbox). Os 5 pontos de disparo transacional (disparo-imobiliaria, recibo-prevenda, cobranca-prevenda, bancada Asaas, relatorio-diario) passaram a usar getCacaSender no lugar de PREVENDA_EMAIL_FROM/contato@. sendGmailMessage ganhou formatFromHeader: display name acentuado vai em RFC 2047 (senao 'Caca' quebra o header). Enviar da propria caca@ (caixa autenticada) dispensa alias/Send-As. A resposta de threads da Iris (email-reply) fica intacta (usa o alias do grupo quando existe).",
      motivation: "Lucas: o e-mail de teste chegou de 'contato@careli.adm.br'; todos os e-mails devem sair da caixa da Caca.",
    },
    title: "Todos os e-mails saem da caixa da Caca",
    type: "correcao",
    version: "1.62.36",
  },
  {
    buildTag: "2026-07-24-relatorio-imob-titlecase",
    deployedAt: "2026-07-24T04:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "No relatorio das imobiliarias, os nomes de cliente e corretor agora seguem o padrao do Hub (Primeira Maiuscula), em vez de sair em CAIXA ALTA como estavam no banco.",
            ],
            screen: "Relatorio das imobiliarias",
          },
        ],
      },
    ],
    rollback: "1.62.34",
    technical: {
      done: "relatorio-imobiliaria.ts passou a aplicar toTitleCase (lib/format/name-case) em nomeCliente, corretor e nos nomes vindos do Asana (duplicadas/incorretas). Fonte legada (OCR/esteira) vem em caixa alta; normalizacao so na exibicao, nunca no dado. Nome da imobiliaria fica como o cadastro (razao social pode ter sigla).",
      motivation: "Lucas: na previa os nomes vinham em Primeira Maiuscula, mas no e-mail real vinham em caixa alta (cliente) e caixa trocada (corretor 'Caio silva'). Seguir o padrao do Hub.",
    },
    title: "Relatorio das imobiliarias: nomes em Primeira Maiuscula",
    type: "correcao",
    version: "1.62.35",
  },
  {
    buildTag: "2026-07-24-relatorio-imob-dashboard",
    deployedAt: "2026-07-24T03:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O relatorio diario das imobiliarias virou um dashboard: header com a marca C2X, 6 cards (CADs, Credenciados, PIX pagos, Em revisao, Duplicadas, Incorretas) e uma quebra por status.",
              "Traz Duplicadas e CADs Incorretas (com o MOTIVO, direto do Asana), o valor recebido nos credenciados, e uma secao de erro no envio do PIX (cliente + o que aconteceu).",
              "Botao 'Testar o relatorio' na tela de vincular imobiliarias: manda o relatorio de uma imobiliaria (dados reais) para um e-mail, so pra conferir antes do disparo.",
            ],
            screen: "Relatorio das imobiliarias",
          },
        ],
      },
    ],
    rollback: "1.62.33",
    technical: {
      done: "relatorio-imobiliaria.ts junta 3 fontes por imobiliaria (vinculo 'Imobiliaria da CAD'): esteira (credenciados/revisao/validacao/credito + PIX so DATA), Asana via escanearCads (secoes 'duplic'/'incorret', motivo do custom field 'Motivo da reprovacao'), apolo_disparos falhados (erro do PIX traduzido). emails-imobiliaria.ts montarRelatorioImobiliaria reescrito: header escuro + logo branca c2x-logo-branca.png (nova em public/), 6 cards e-mail-safe (total = soma sem PIX pago), secoes, rodape Caca + botao WhatsApp 553199264143. Rota relatorio-diario ganhou modo ?teste=email&imobiliaria=nome (admin) que envia so por e-mail. Botao na tela vincular-imobiliarias.",
      motivation: "Iteracao com o Lucas sobre o formato: dashboard com 6 cards somando o total, marca C2X (logo branca), motivo das incorretas do Asana, PIX so data, e um jeito de ele receber o teste antes de ligar o disparo real.",
    },
    title: "Relatorio das imobiliarias vira dashboard (C2X, Asana, teste)",
    type: "melhoria",
    version: "1.62.34",
  },
  {
    buildTag: "2026-07-24-avisos-imobiliaria",
    deployedAt: "2026-07-24T01:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "As IMOBILIARIAS passam a ser avisadas automaticamente sobre as CADs dos clientes delas, por WhatsApp e e-mail: quando o credito e reprovado, quando o PIX e enviado ao cliente e quando o PIX e pago.",
              "Nos avisos de PIX, a imobiliaria ve o STATUS de envio ao cliente: WhatsApp e e-mail enviados (com a hora) ou o erro, ja traduzido.",
              "RELATORIO DIARIO as 18h: cada imobiliaria recebe por e-mail o relatorio de performance dos seus clientes (situacao, credito e PIX de cada um) e um aviso no WhatsApp de que foi enviado.",
              "SEGURANCA: o resultado da analise de credito (valores) NUNCA vai para a imobiliaria — so o status Aprovado / Reprovado / Em analise.",
            ],
            screen: "Avisos as imobiliarias",
          },
        ],
      },
    ],
    rollback: "1.62.32",
    technical: {
      done: "Vinculo de trabalho: 457 relationships 'Imobiliaria da CAD' (prospect -> entidade da imobiliaria), a prova do sync. lib/apolo/disparo-imobiliaria.ts (resolve contato pela entidade, dispara WA template + e-mail, best-effort, celular BR obrigatorio), emails-imobiliaria.ts (avisos + relatorio HTML, so status de credito), relatorio-imobiliaria.ts (agrupa por imob via vinculo). Ganchos best-effort: serasa/consultar (reprovado), cobranca-prevenda enviarCobrancaPrevenda (pix enviado, com statusEnvioAoCliente), webhook Asaas (pix pago, respeita a trava de reentrega). Cron 0 21 * * * (18h BRT) em /api/apolo/imobiliarias/relatorio-diario (allowlist proxy + x-vercel-cron/CRON_SECRET). Rota /api/apolo/imobiliarias/templates cria os 4 templates Meta — pendente aprovacao (ate la, WhatsApp falha e so o e-mail sai).",
      motivation: "Pedido do Lucas: em vez de tela com login, avisar as imobiliarias automaticamente do andamento das CADs e mandar um relatorio de performance diario. Sem redisparo, so daqui pra frente.",
    },
    title: "Avisos automaticos e relatorio diario as imobiliarias",
    type: "novidade",
    version: "1.62.33",
  },
  {
    buildTag: "2026-07-23-vincular-imobiliarias-cads",
    deployedAt: "2026-07-24T00:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova ferramenta interna: VINCULAR IMOBILIARIAS DAS CADS. Lista cada imobiliaria que aparece nas CADs (por nome) e deixa casar com o cadastro (entidade) dela no Apolo.",
              "E o primeiro passo para o vinculo por ENTIDADE (hoje a imobiliaria e so texto): a base do acompanhamento que as imobiliarias vao ter dos seus clientes.",
            ],
            screen: "Vincular imobiliarias",
          },
        ],
      },
    ],
    rollback: "1.62.31",
    technical: {
      done: "Nova pagina /apolo/imobiliarias + rota GET/POST /api/apolo/imobiliarias/vinculo + lib imobiliaria-match.ts. GET agrupa apolo_esteira.imobiliaria por nome normalizado (sem acento/caixa/espaco), com contagem de CADs e o match atual. O seletor de entidade reusa /api/apolo/imobiliarias (loadApoloImobiliarias, papel 'imobiliaria', ~413 opcoes, todas com contato), filtrado no front. POST salva o de-para em apolo_imobiliaria_match (migration 0068, chave nome_normalizado unico). PROXIMO PASSO (nao neste deploy): propagar o match para imobiliaria_entity_id na esteira e para o related_entity_id dos relacionamentos comerciais (hoje NULL, so label texto), e alimentar a Central de CADs escopada por entidade.",
      motivation: "As imobiliarias das CADs vivem so como TEXTO (apolo_esteira.imobiliaria e apolo_relationships.label com related_entity_id NULL). So 124 de 457 prospects do Vale do Ouro tem vinculo de entidade. As entidades existem (vieram do C2X) mas o nome nao casa exato, entao o Lucas casa manualmente. Fundacao da Central de CADs das imobiliarias.",
    },
    title: "Vincular imobiliarias das CADs ao cadastro do Apolo",
    type: "novidade",
    version: "1.62.32",
  },
  {
    buildTag: "2026-07-23-cads-publico-ordem-refugo",
    deployedAt: "2026-07-23T23:40:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Central de CADs: os cards Duplicados e CAD's Incorretas passaram para DEPOIS do PIX Compensado — o refugo fecha a fileira, na sequencia do funil.",
            ],
            screen: "Central de CADs (publica)",
          },
        ],
      },
    ],
    rollback: "1.62.30",
    technical: {
      done: "CadPublicDashboard: cards 'duplicados' e 'incorretas' movidos no JSX para depois do bloco do Apolo (credenciado/pago). Sem mudanca de dados nem de logica.",
      motivation: "Pedido do Lucas: refugo (duplicadas/incorretas) por ultimo, depois do PIX recebido.",
    },
    title: "Central de CADs: refugo depois do PIX Compensado",
    type: "melhoria",
    version: "1.62.31",
  },
  {
    buildTag: "2026-07-23-cads-publico-cards-clicaveis",
    deployedAt: "2026-07-23T23:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Na Central de CADs publica, os cards CREDENCIADO e PIX COMPENSADO agora sao CLICAVEIS como os outros: ao clicar, a lista de baixo mostra quem esta em cada um (nome, imobiliaria e data), vindo do Apolo.",
              "O card PIX COMPENSADO passa a mostrar o percentual de quem JA PAGOU sobre os CREDENCIADOS (a conversao da pre-venda), alem do valor recebido.",
            ],
            screen: "Central de CADs (publica)",
          },
        ],
      },
    ],
    rollback: "1.62.29",
    technical: {
      done: "Nova funcao carregarListasCredenciamento(empreendimento) em cads-publico-resumo.ts: lista credenciados (etapa=credenciado) e pagos (pago_em not null) do Apolo com nome (apolo_entities), imobiliaria e data. A page passa apoloListas ao dashboard. CadPublicDashboard: novos Status 'credenciado'/'pago', os dois kpiInfo viraram kpiCard clicaveis; `shown` usa as listas do Apolo (filtradas por imob/busca) quando o status e credenciado/pago, sem entrar no `base`/'Recebidas' (que segue sendo o total do Asana); kanban ganha a coluna correspondente. PIX Compensado: sub = pctDe(pagos, credenciados) + valor.",
      motivation: "Pedido do Lucas: os cards do fim do funil (Credenciado e PIX Compensado) nao eram clicaveis como os demais, e faltava o % de pagos sobre os credenciados.",
    },
    title: "Central de CADs: cards Credenciado e PIX Compensado clicaveis + % de pagos",
    type: "melhoria",
    version: "1.62.30",
  },
  {
    buildTag: "2026-07-23-caca-consolidado-cads",
    deployedAt: "2026-07-23T22:45:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A CACA passa a trazer o CONSOLIDADO das CADs de um empreendimento — SO PARA A GESTAO (numeros verificados da direcao): total de fichas, quantas em cada etapa, quantos ja pagaram o PIX e o valor total recebido.",
              "Cliente, corretor e imobiliaria continuam vendo so a PROPRIA ficha pelo CPF — o numero somado do empreendimento nao aparece pra eles.",
            ],
            screen: "CACA",
          },
        ],
      },
    ],
    rollback: "1.62.28",
    technical: {
      done: "Nova tool consultar_consolidado_cads na CACA, registrada DENTRO do bloco assistantMode (so numeros de gestao/direcao a recebem) — reusa carregarResumoApolo(empreendimento), o mesmo resumo do dashboard publico de CADs: conta por etapa em apolo_esteira e soma o valor pago deduplicando PAYMENT_CONFIRMED/RECEIVED em apolo_asaas_eventos. Orientacao no bloco de persona do MODO ASSISTENTE (nao na persona geral), deixando claro que e numero de gestao. Sem CPF; default Vale do Ouro.",
      motivation: "A CACA respondia a direcao que nao conseguia trazer o total das CADs do Vale do Ouro, so caso a caso. Faltava dar a ferramenta de resumo — restrita a gestao, porque o consolidado nao pode vazar pra cliente/corretor/imobiliaria.",
    },
    title: "CACA traz o consolidado das CADs (so para gestao)",
    type: "melhoria",
    version: "1.62.29",
  },
  {
    buildTag: "2026-07-23-serasa-credito-pj",
    deployedAt: "2026-07-23T22:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Analise de credito agora roda para PJ (CNPJ), nao so para PF. O sistema ja detectava o CNPJ, mas mandava o relatorio de PF pro Serasa e dava erro 'report not found'.",
              "O relatorio passa a ser escolhido pelo TIPO da ficha: PF usa o relatorio PF, PJ usa o relatorio PJ (RELATORIO_BASICO_PJ_PME). Uma PJ nunca mais recebe o relatorio errado.",
            ],
            screen: "Board · Analise de credito",
          },
        ],
      },
    ],
    rollback: "1.62.27",
    technical: {
      done: "serasa/consultar/route.ts: o reportName passou a ser resolvido no SERVIDOR pelo entity_kind (nao mais exigido/confiado do corpo). PF = SERASA_REPORT_PF || corpo || 'RELATORIO_BASICO_PF_PME' (comportamento inalterado). PJ = SERASA_REPORT_PJ (env nova, gravada como RELATORIO_BASICO_PJ_PME via CLI) || override da tela se nao for nome de PF; sem isso, erro 412 claro pedindo a env. consultarPJ ja existia (endpoint business-information-report, valida 14 digitos). PENDENTE: avaliarCredito le a estrutura de negativeData do relatorio PF; a resposta PJ tem shape diferente, entao o veredito automatico (aprovado/reprovado) de PJ sera calibrado com a primeira resposta real.",
      motivation: "Caso real do Lucas: ficha PJ (loja simbolica, CNPJ) travada na analise de credito com 'RELATORIO_BASICO_PF_PME not found'. O nome do relatorio PJ (basico) foi confirmado empiricamente no levantamento (docs/architecture/serasa-credito-integracao.md: 200 completo pra CNPJs reais em homologacao).",
    },
    title: "Analise de credito de PJ (relatorio por tipo de ficha)",
    type: "melhoria",
    version: "1.62.28",
  },
  {
    buildTag: "2026-07-23-esconde-disparo-massa",
    deployedAt: "2026-07-23T21:15:00-03:00",
    // Interno: mudanca operacional (esconder uma tela), nao anuncia no painel de novidades.
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Tela de disparo em massa do PIX escondida: o processo passou a ser ficha a ficha, pelo botao Gerar PIX da pre-venda. A URL antiga redireciona pro Apolo.",
            ],
            screen: "Disparo do PIX",
          },
        ],
      },
    ],
    rollback: "1.62.26",
    technical: {
      done: "app/apolo/disparo-pix/page.tsx passou a redirect('/apolo'). O componente disparo-massa.tsx e a rota api/apolo/asaas/disparo-lote seguem no codigo (reversivel), so a pagina foi desconectada.",
      motivation: "Decisao do Lucas (23/jul): nao havera mais disparo em massa; esconder a tela evita acionamento por engano agora que o fluxo e individual.",
    },
    title: "Esconder a tela de disparo em massa do PIX",
    type: "correcao",
    version: "1.62.27",
  },
  {
    buildTag: "2026-07-23-gerar-pix-na-ficha",
    deployedAt: "2026-07-23T20:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O botao GERAR PIX da etapa de pre-venda agora FUNCIONA: num clique emite a cobranca e ja dispara no WhatsApp e no e-mail do cliente, com a ficha (CAD) anexada. O ciclo gerou -> enviou aparece na hora, na propria ficha.",
              "Nao cobra duas vezes: se a ficha ja tem PIX emitido, ja pagou, ou nao esta na etapa de pre-venda, o botao avisa e nao cria cobranca.",
              "O botao antigo do rodape (que so pulava a etapa sem gerar nada) saiu da pre-venda pra nao confundir.",
            ],
            screen: "Board · Pre-venda",
          },
          {
            items: [
              "Novo campo VALOR DO PIX DE CREDENCIAMENTO por empreendimento, na aba Cadastro do empreendimento (ao lado do limite de credito).",
              "Com mais de um empreendimento ativo, o botao Gerar PIX da ficha usa o valor certo pelo empreendimento dela. Vazio = padrao R$ 1.000.",
            ],
            screen: "Empreendimento · Cadastro",
          },
        ],
      },
    ],
    rollback: "1.62.25",
    technical: {
      done: "Nova rota POST api/apolo/board/[id]/gerar-pix: le apolo_esteira (409 se pago; GUARD de etapa!=prevenda; devolve o existente se pagamento_ref real; reserva antiga >90s e retomavel), resolve nome+documento (document_masked -> identifiers), reserva com update condicional (is null OU eq da reserva antiga), emitirCobrancaPix(valor por empreendimento) + enviarCobrancaPrevenda dentro de try/catch que NAO libera a reserva em erro ambiguo (evita cobranca dupla). emitirCobrancaPix passou a devolver paymentId tambem no ramo de erro sem-link, pra o chamador gravar em vez de reemitir. Botao movido pra dentro de status-pix.tsx; rodape esconde o generico em prevenda. VALOR POR EMPREENDIMENTO: migration 0067 (coluna valor_pix nullable em apolo_enterprise_settings) PENDENTE DE OK; getValorPix/setEnterpriseValorPix resilientes a coluna ausente (fallback R$ 1.000); PATCH de settings aceita valorPix; UI na aba Cadastro do empreendimento.",
      motivation: "O botao Gerar PIX do rodape so incrementava a etapa localmente: parecia funcionar mas nao emitia cobranca. Uma auditoria adversarial da rota nova apontou 3 furos (sem guard de etapa, reserva presa pra sempre, cobranca orfa virando dupla), corrigidos antes de subir. Pedido do Lucas: valor do PIX por empreendimento como referencia quando houver mais de um ativo.",
    },
    title: "Gerar PIX da ficha (com travas anti-duplicidade) e valor do PIX por empreendimento",
    type: "correcao",
    version: "1.62.26",
  },
  {
    buildTag: "2026-07-23-comparativo-asana-board",
    deployedAt: "2026-07-23T19:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova aba ASANA x BOARD: mostra de um lado quantas CADs existem no Asana e do outro quantas ja estao no Board, e quantas FALTAM subir.",
              "Duplicadas e CAD incorreta ficam FORA da conta dos dois lados (aparecem so como refugo), porque nao sao trabalho pendente.",
              "Quebra secao por secao e ABRE A LISTA DE NOMES de quem ainda nao subiu, cada um com um seletor: marque so quem quer subir, ou deixe tudo desmarcado pra importar a secao inteira.",
              "IMPORTA DALI MESMO num clique, lendo os documentos pela MOST (o formulario do Asana nao tem CPF, esse dado so existe dentro do documento). O progresso e o gasto real aparecem enquanto roda.",
              "Tambem aponta quem existe so no Board e nao tem task no Asana (cadastro manual ou portal publico).",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.62.24",
    technical: {
      done: "Nova rota GET api/apolo/asana/comparativo: escanearCads com secoes vazias (varre o projeto inteiro do empreendimento), exclui secoes cujo nome normalizado contem 'duplic'/'incorret', cruza os gids com apolo_source_links (asana/cad_task) pra saber quem ja subiu, le a etapa de cada entidade em apolo_esteira, devolve os FALTANTES {gid,nome} por secao e lista quem esta na esteira do empreendimento SEM task. UI: comparativo.tsx como primeira aba de importacao-view (que passa a abrir nela); cada secao expande a lista com checkbox por CAD (marcar todos/limpar) e um unico botao Importar que roda o orcamento internamente e filtra pelos gids marcados (vazio = secao inteira), lendo em lotes de 5 em asana/leitura com barra de progresso e gasto acumulado. Sem passo separado de 'calcular custo'.",
      motivation: "Nao havia como saber o tamanho da diferenca entre o Asana e o Board sem contar na mao, e a importacao vivia em outra aba exigindo digitar o nome exato da secao.",
    },
    title: "Comparativo Asana x Board, com importacao na mesma tela",
    type: "novidade",
    version: "1.62.25",
  },
  {
    buildTag: "2026-07-23-pix-na-mao-do-time-e-da-caca",
    deployedAt: "2026-07-23T18:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A etapa de pre-venda agora entrega o PIX na mao: copiar o link de pagamento, copiar o codigo copia-e-cola e baixar o QR Code, pra reenviar por fora quando o cliente pede.",
              "E sempre a MESMA cobranca ja emitida: reenviar nao cobra de novo. Quem ja pagou nao mostra mais o PIX, pra ninguem pagar duas vezes.",
            ],
            screen: "Board · Pre-venda",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A CACA agora ENTENDE O BOARD DO APOLO: sabe a esteira inteira (validacao, analise de credito, pre-venda, revisao, credenciado), o que acontece em cada etapa e como funciona a fila do evento (ordenada pela hora do pagamento).",
              "RAIO-X DA FICHA no atendimento: pelo CPF ela responde em que etapa a CAD esta, qual imobiliaria e corretor, SE O CLIENTE PAGOU e quando, se o PIX foi enviado, PARA QUAL TELEFONE e PARA QUAL E-MAIL, se foi entregue, se foi lido e SE DEU ERRO, com o motivo em portugues.",
              "Ela ENCAMINHA o PIX do credenciamento na conversa: cliente, corretor ou imobiliaria pede ('nao recebi', 'me manda de novo', 'manda o PIX do fulano'), ela pede o CPF e manda o link na hora, sem transferir pro time.",
              "Ela tambem ENCAMINHA A FICHA (CAD) em PDF quando pedirem, com link de 1 hora e os dados atuais do cadastro.",
              "Travas de seguranca: nao manda link de pagamento pra quem JA PAGOU (evita pagamento em duplicidade), so entrega a ficha ao titular ou ao corretor/imobiliaria daquela CAD, e os contatos aparecem mascarados o suficiente pra conferir sem expor.",
              "CORRECAO de contexto: ela ainda dizia que 'o PIX chega amanha ao meio-dia' e falava em 'confirmar participacao'. O PIX ja foi enviado, e o enquadramento correto e etapa da ficha de cadastro.",
            ],
            screen: "CACA",
          },
        ],
      },
    ],
    rollback: "1.62.23",
    technical: {
      done: "api/apolo/board/[id]/pix passa a devolver `pix` (invoiceUrl + payload copia-e-cola + QR base64 + vencimento) consultando o Asaas sob demanda, so quando pagamento_ref existe, nao e reserva e pago_em e null. status-pix.tsx ganhou a caixa 'Reenviar este PIX' com copiar/baixar. CACA: 3 tools novas — enviar_pix_credenciamento (CPF -> esteira -> consultarCobranca/obterQrCodePix), consultar_ficha_credenciamento (raio-x juntando apolo_esteira + apolo_disparos com traducao de erro e contato mascarado) e enviar_ficha_cad (montarFichaCad -> signed URL 1h) — mais o bloco 'BOARD DO APOLO' na persona com a esteira, a fila do evento e as regras de entrega.",
      motivation: "Pedido do Lucas apos o disparo dos 296: o disparo em massa acabou e a operacao volta ao fluxo normal de atendimento. A CACA precisa resolver na central, sem transferir — e para isso precisa do mesmo contexto que um atendente tem abrindo o Board.",
    },
    title: "CACA entende o Board do Apolo e resolve o credenciamento no atendimento",
    type: "novidade",
    version: "1.62.24",
  },
  {
    buildTag: "2026-07-23-fila-data-da-cad",
    deployedAt: "2026-07-23T17:55:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "CORRECAO: a fila mostrava a hora do DISPARO para quem entrou por CAD (todo mundo com o mesmo horario de hoje). Agora mostra a data em que a CAD chegou de verdade, que e a data da task no Asana.",
              "A ordem entre quem ainda nao pagou passa a ser a da chegada da CAD, e nao a ordem em que o sistema processou o lote.",
            ],
            screen: "Fila",
          },
        ],
      },
    ],
    rollback: "1.62.22",
    technical: {
      done: "lib/prometeu/data.ts: chegadaDasFichas() le apolo_esteira.chegou_em pelos entity_ids e injeta chegou_em em CredenciadoRow ANTES de ordenarFilaDoEvento, que passa a desempatar por (chegou_em ?? created_at). Novo campo chegouEm em PrometeuCredenciado; fila-view usa chegouEm ?? etapaDesde. Sem migration: o dado ja existia na esteira (267 dos 268 da fila tem, de 30/05 a 16/07).",
      motivation: "No disparo em massa todos entram na fila no mesmo minuto, entao created_at/etapa_desde viravam a hora do laco. A fila do lancamento e ordenada por merito (hora do PIX; na falta dele, chegada da CAD), e mostrar a hora do disparo apagava esse criterio.",
    },
    title: "Fila do evento: data real da CAD",
    type: "correcao",
    version: "1.62.23",
  },
  {
    buildTag: "2026-07-23-disparo-massa-pix",
    deployedAt: "2026-07-23T17:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Disparo em massa do PIX da pre-venda: emite a cobranca e manda a mensagem com a ficha (CAD) anexada por WhatsApp e por e-mail, lote a lote, com botao de PARAR no meio.",
              "Ninguem e cobrado duas vezes: a ficha e reservada antes de criar a cobranca no Asaas, e quem ja tem PIX emitido nunca volta pro lote.",
              "CORRECAO IMPORTANTE: celular no formato antigo (sem o 9o digito) ia quebrado pra Meta e a pessoa nao recebia nada. Sao 12 das 296 fichas.",
              "SEGURANCA: telefone que nao e celular brasileiro nao recebe mais WhatsApp. A mensagem leva a ficha com CPF, RG e filiacao anexada, e um numero estrangeiro prefixado com 55 pode cair na mao de outra pessoa. Esses vao so por e-mail e aparecem na lista de falhas.",
              "Quem nao recebeu por NENHUM canal fica na coluna de pre-venda em vez de sumir pra fila do evento como se tivesse sido avisado.",
              "Quem pagar sem estar na fila do lancamento passa a entrar nela automaticamente, com a hora do pagamento.",
            ],
            screen: "Disparo do PIX",
          },
        ],
      },
    ],
    rollback: "1.62.21",
    technical: {
      done: "Novo: app/api/apolo/asaas/disparo-lote (GET previa custo zero + POST lote com confirmado), lib/apolo/cobranca-prevenda.ts (caminho de envio extraido da bancada) e modules/apolo/blocks/asaas/disparo-massa.tsx em /apolo/disparo-pix. Travas: (1) reserva otimista em apolo_esteira.pagamento_ref com update condicional is('pagamento_ref', null) antes do Asaas, liberada se a emissao falhar; (2) filtro por pagamento_ref IS NULL em vez de etapa; (3) parada automatica por erro de conta/template/limite da Meta (131031, 130429, 132001, 132000, 190) e do Asaas. normalizarTelefone agora usa fixLegacyBrazilianMobileNumber e exige o padrao de celular BR (55+DDD+9+8), com o comprimento decidindo o DDI (DDD 55 do RS era confundido com o DDI). aoEnviarPixPrevenda so roda se algum canal saiu. aoConfirmarPagamentoPrevenda passa a inserir na fila quem pagou sem estar nela.",
      motivation: "Sao 296 cobrancas de R$ 1.000 em clientes reais. Uma auditoria em 45 agentes sobre o fluxo apontou 3 defeitos com vitima concreta na base: 12 celulares no formato antigo, 5 telefones fora do padrao BR (risco de entregar a CAD a terceiro) e a esteira avancando mesmo sem ninguem receber.",
    },
    title: "Disparo em massa do PIX da pre-venda",
    type: "novidade",
    version: "1.62.22",
  },
  {
    buildTag: "2026-07-23-leitura-com-as-mesmas-regras",
    deployedAt: "2026-07-23T15:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A leitura de documentos (MOST) passa a seguir as MESMAS regras do import por CPF: quem ja tem ficha nao entra por cima da que existe, e o conflito aparece na tela com a imobiliaria atual e a nova.",
              "CORRECAO: o corretor nao subia na leitura. A ficha nascia com a imobiliaria preenchida e o corretor em branco; agora vem junto, igual ao import.",
              "ECONOMIA: CAD que ja esta no Board sai do lote e do orcamento. Antes, mover a CAD de secao no Asana fazia pagar a leitura de novo — agora o card 'Fora do lote' mostra quantas foram poupadas.",
              "Quem foi lido mas ficou de fora aparece separado das CADs sem CPF: o documento lido fica salvo e a releitura nao e cobrada de novo.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.62.20",
    technical: {
      done: "separarPorConflito extraida para lib/apolo/asana-import.ts e usada pelas DUAS portas de entrada (importar-secao e leitura), com campo vazio na ficha atual tratado como complemento e nao como divergencia (a base tem 3 fichas sem imobiliaria e 2 sem empreendimento, que virariam falso conflito). leitura/route.ts: corretor propagado no orcamento -> tela -> POST (CadParaLeitura ganhou o campo), email/telefone no vinculo e conflitos na resposta. orcarLeitura: nova economia (c) por apolo_source_links (asana/cad_task) — pula quem ja foi importado antes de listar anexos; totalCads passa a ser o do lote.",
      motivation: "A leitura era a outra porta de entrada da esteira e nao tinha a regra de duplicidade: seria o buraco por onde a mesma pessoa entraria duas vezes no mesmo empreendimento. E o formulario do Asana nao tem CPF, entao a importacao da secao Analise de Credito depende dela.",
    },
    title: "Leitura de documentos com as mesmas regras do import (e sem pagar duas vezes)",
    type: "melhoria",
    version: "1.62.21",
  },
  {
    buildTag: "2026-07-23-import-secao-por-cpf",
    deployedAt: "2026-07-23T14:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Novo canal: importar a SECAO INTEIRA do Asana usando o CPF escrito na propria CAD, sem depender de o nome bater com o cadastro.",
              "Comprador que volta a comprar em outro lancamento entra como prospect do novo empreendimento REAPROVEITANDO o cadastro — a pessoa nao duplica, o que muda e o vinculo (imobiliaria, corretor, empreendimento).",
              "BLOQUEIA a mesma pessoa entrando duas vezes no mesmo empreendimento por imobiliarias diferentes: em vez de sobrescrever, lista o conflito com a imobiliaria atual e a nova, pra o negocio decidir de quem e o cliente.",
              "Simula antes de gravar: mostra quantas entram, quantas conflitam e quantas nao tem CPF na CAD (essas continuam dependendo da leitura do documento).",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.62.19",
    technical: {
      done: "app/api/apolo/asana/importar-secao (novo): escanearCads -> acharCpfNoTexto (custo zero) -> lookupApoloByDocument (resolve identidade sem criar, inclusive no dry-run, senao a simulacao nao teria como mostrar conflito) -> criarEntidadesDoLote (reaproveita quem ja tem o CPF) -> aplicarVinculos. Conflito e detectado comparando empreendimento e imobiliaria da ficha atual, normalizados. UI: bloco novo em importar-cads.tsx com simular/aplicar e lista de conflitos.",
      motivation: "Caso real (Danilo): comprador do C2X virando prospect do Vale do Ouro por outra imobiliaria. A tela antiga casava por nome e a esteira tem PK por entity_id, entao o caso nao subia direito.",
    },
    title: "Importar secao inteira por CPF, sem duplicar pessoa",
    type: "melhoria",
    version: "1.62.20",
  },
  {
    buildTag: "2026-07-23-contatos-e-falhas-visiveis",
    deployedAt: "2026-07-23T13:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "CORRECAO: corrigir o telefone ou o e-mail na bancada nao tinha efeito — o envio continuava indo pro contato antigo. O contato informado agora e gravado e passa a ser o PRINCIPAL.",
              "CORRECAO: ficha sem telefone (ou sem e-mail) nao registrava nada. Agora conta como FALHA de envio, marca o card e aparece na auditoria — antes sumia em silencio.",
            ],
            screen: "Pre-venda",
          },
        ],
      },
    ],
    rollback: "1.62.18",
    technical: {
      done: "prevenda-fluxo.ts/plantarFichaPrevenda: `status` gravava 'active', que viola o CHECK de apolo_contacts ('verified'|'pending'|'attention'|'blocked'), e o erro do insert NAO era checado — falha silenciosa classica. Agora grava 'pending', checa o error e devolve o motivo; alem disso desmarca is_primary dos demais do mesmo tipo, senao o envio continuava lendo o contato antigo. bancada/route.ts e recibo-prevenda.ts: o registro em apolo_disparos passou pra FORA do if de telefone e os casos 'sem telefone/sem e-mail' viraram erro.",
      motivation: "Teste de erro do Lucas: ele digitou telefone e e-mail invalidos e o envio saiu normalmente para os contatos corretos antigos.",
    },
    title: "Contato informado passa a valer + falha de envio deixa de sumir",
    type: "correcao",
    version: "1.62.19",
  },
  {
    buildTag: "2026-07-23-prometeu-tela-fila",
    deployedAt: "2026-07-23T12:40:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Tela FILA (nova): a fila do evento antes do check-in, com nome, CPF, telefone, imobiliaria, corretor e a data/hora que define a posicao (PIX ou cadastro).",
              "O organizador pode furar a fila (subir/descer) — com MOTIVO obrigatorio, registrado com quem mudou e quando.",
              "Quem faz check-in sai da fila do evento e passa para a recepcao; a tela mostra quantos ja entraram.",
            ],
            screen: "Fila",
          },
        ],
      },
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Falha no envio da cobranca ou do recibo marca o card em vermelho, e um filtro isola quem falhou. So aparece quando existe erro — sem erro, sem ruido na tela.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.62.17",
    technical: {
      done: "modules/prometeu/blocks/fila/fila-view.tsx (novo) + entrada no menu. Reusa o que ja existia no backend: fetchFila (credenciados x filaRecepcao), ajustarOrdem (furar fila com motivo auditado) e fazerCheckIn. /api/prometeu/fila passa a enriquecer com TELEFONE vindo de apolo_contacts (nao existe coluna em prometeu_credenciados). board/route.ts devolve erroEnvio (apolo_disparos com status 'falhou'); board-view marca card, linha e ganha filtro condicional.",
      motivation: "Lucas: precisa ver e reordenar a fila antes do evento, e enxergar rapidamente quais envios falharam sem poluir a tela.",
    },
    title: "Prometeu: tela de Fila com reordenacao + marcacao de erro de envio",
    type: "melhoria",
    version: "1.62.18",
  },
  {
    buildTag: "2026-07-23-esteira-sem-regressao",
    deployedAt: "2026-07-23T11:50:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "CORRECAO CRITICA: a esteira nao regride mais. Reconsultar o Serasa de uma ficha que ja estava em pre-venda ou credenciada devolvia ela para revisao — desfazendo a aprovacao do coordenador e ate o pagamento ja feito.",
              "A aprovacao do coordenador passa a valer: uma reconsulta reprovada nao derruba mais quem ele liberou.",
              "O aviso de reprovacao nao e mais reenviado quando a ficha esta protegida (evita avisar o coordenador de que um cliente que ja pagou foi reprovado).",
              "Credenciado e o ultimo estagio: a ficha entra como CONCLUIDA, com todas as etapas verdes, selo de Credenciado e sem botao de avancar.",
              "Etapa Pre-venda mostra agora o ciclo do PIX: gerado, enviado (WhatsApp e e-mail, com entregue/lido) e recebido — com os erros em destaque.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.62.16",
    technical: {
      done: "lib/apolo/esteira.ts: atualizarEtapa ganhou `automatico` — gatilho de maquina nao move quem ja esta em ordem >= prevenda (nem promove, nem rebaixa) e devolve `mantida`. `nuncaRebaixar` sozinho nao resolvia: revisao/correcao/indeferido ficam fora da ORDEM e venciam qualquer comparacao. serasa/consultar: passa automatico e so dispara o aviso se a transicao NAO foi mantida. board-view: INDICE_POR_ETAPA.credenciado 3 -> 4 (concluida => verdes + selo + sem botao). status-pix.tsx (novo) + /api/apolo/board/[id]/pix: junta apolo_esteira, apolo_disparos e apolo_asaas_eventos.",
      motivation: "Lucas testou: estava em credenciado (ja pago), reconsultou o credito e a ficha voltou para analise; e a aprovacao dele como coordenador nao se sustentava.",
    },
    title: "Esteira sem regressao + status do PIX na ficha",
    type: "correcao",
    version: "1.62.17",
  },
  {
    buildTag: "2026-07-23-central-cads-funil",
    deployedAt: "2026-07-23T11:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Cards refeitos na ordem da esteira: Validacao (Recepcao + Analise de Documento), Analise de Credito, Credito em Revisao, Pre-Venda, Duplicados e CAD's Incorretas.",
              "CORRECAO: 'Em cadastro' mostrava 244 somando Analise de Documento com Analise de Credito, enquanto a secao 'Em Cadastro' do Asana tinha ZERO.",
              "Credito em Revisao passa a mostrar o % sobre o que ja passou pelo credito (revisao + pre-venda), nao sobre o total.",
              "Dois cards novos vindos do Apolo: Credenciado e PIX Compensado (com a quantidade e o VALOR ja recebido).",
            ],
            screen: "Central de CADs (publica)",
          },
        ],
      },
    ],
    rollback: "1.62.15",
    technical: {
      done: "CadPublicDashboard: canonical() reescrito com a ordem certa (o especifico antes do generico, senao 'Analise de Documento' e 'Analise de Credito' caem no mesmo balde); cards fixos do funil + os nao-mapeados renderizados com nome cru pra soma sempre fechar com Recebidas; kpiInfo (nao clicavel) pros numeros do Apolo. lib/apolo/cads-publico-resumo.ts (novo): le apolo_esteira por empreendimento e soma o valor pago via apolo_asaas_eventos, deduplicando CONFIRMED/RECEIVED do mesmo pagamento.",
      motivation: "Os cards nao refletiam a esteira: agrupavam etapas diferentes e nao mostravam o que acontece depois da emissao do PIX.",
    },
    title: "Central de CADs: cards na ordem da esteira + Credenciado e PIX Compensado",
    type: "melhoria",
    version: "1.62.16",
  },
  {
    buildTag: "2026-07-23-prevenda-caminho-unico-da-ficha",
    deployedAt: "2026-07-23T10:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "CORRECAO: o recibo do PIX nao chegava. A cobranca usava os contatos da tela e o recibo ia busca-los no cadastro do Asaas, que nasce so com nome e CPF. Agora os dois leem a MESMA fonte: a ficha da pessoa.",
              "O pagamento passa a se identificar sozinho: a cobranca leva o id da ficha na referencia e o webhook le de volta, sem consultar o Asaas.",
              "Todo envio fica registrado (canal, destinatario, template, resultado) e a entrega/leitura e atualizada automaticamente pela Meta.",
            ],
            screen: "Pre-venda",
          },
        ],
      },
    ],
    rollback: "1.62.14",
    technical: {
      done: "prevenda-fluxo.ts: contatosDaFicha (le apolo_contacts; considera 'whatsapp' E 'phone' — o C2X grava 4.067 como whatsapp e so 520 como phone), plantarFichaPrevenda (bancada grava contatos + ficha em prevenda, idempotente) e registrarDisparoPrevenda (apolo_disparos, que o meta-inbound-processor ja atualiza por wa_message_id). bancada/route.ts: externalReference = entity_id; cobranca e recibo leem da ficha; montarFichaCad recebe entityId. recibo-prevenda.ts reescrito: entityId em vez de customerId, sem ida ao Asaas. webhook: externalReference -> entityId.",
      motivation: "Teste real do Lucas: cobranca chegou, recibo nao. Causa: dois caminhos diferentes pra mesma pessoa.",
    },
    title: "Pre-venda: cobranca e recibo pelo mesmo caminho (a ficha)",
    type: "correcao",
    version: "1.62.15",
  },
  {
    buildTag: "2026-07-23-emitiu-pix-cobra-na-hora",
    deployedAt: "2026-07-23T01:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Emitir o PIX ja dispara a cobranca no WhatsApp e no e-mail, num clique so (era preciso um segundo clique).",
              "O retorno mostra o que aconteceu em CADA canal, mais a etapa e a fila — da pra auditar cada envio.",
            ],
            screen: "Bancada Asaas",
          },
        ],
      },
    ],
    rollback: "1.62.13",
    technical: {
      done: "bancada/route.ts: disparo da cobranca extraido para enviarCobrancaPrevenda() (ficha gerada UMA vez -> signed URL no WhatsApp + bytes no e-mail -> aoEnviarPixPrevenda), reusada pelo botao manual e pela acao gerar-pix com o flag enviarCobranca. Falha de um canal NAO derruba o outro nem a emissao do PIX: cada um devolve seu status. UI: checkbox 'ao gerar, ja enviar' (ligado por padrao) e resumo por canal.",
      motivation: "Ensaiar o fluxo real do lancamento ponta a ponta: emitiu -> cliente recebe a cobranca; pagou -> recebe o recibo.",
    },
    title: "Emitiu o PIX, a cobranca sai na hora",
    type: "melhoria",
    version: "1.62.14",
  },
  {
    buildTag: "2026-07-23-prevenda-texto-10-dias-uteis",
    deployedAt: "2026-07-23T00:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Mensagens do PIX: o prazo de restituicao passa de 15 dias para 10 DIAS UTEIS (WhatsApp e e-mail, cobranca e recibo).",
              "As mensagens agora avisam que a ficha de cadastro vai junto, pro cliente validar as informacoes.",
            ],
            screen: "Pre-venda",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "CACA (interna): alinhada ao texto novo — o PIX e etapa da ficha (nao 'confirmacao de participacao') e o prazo e de 10 dias uteis.",
            ],
            screen: "CACA",
          },
        ],
      },
    ],
    rollback: "1.62.12",
    technical: {
      done: "Texto trocado nos 6 pontos (2 templates WhatsApp + 4 trechos dos e-mails). Templates renomeados para cad_pix_cobranca_v2 / cad_pix_recibo_v2 em bancada/route.ts e recibo-prevenda.ts: os cad_pix_* ja estavam ATIVOS na Meta com o texto antigo e template aprovado nao se edita livremente. Os antigos seguem ativos ate o v2 aprovar, sem buraco no envio. persona.ts: bloco da acao corrigido (dizia 'confirmar a participacao') e ganhou o prazo.",
      motivation: "Pedido do time: 15 dias -> 10 dias uteis, e avisar que a CAD vai junto pro cliente validar.",
    },
    title: "PIX: prazo de 10 dias uteis e aviso da ficha em anexo",
    type: "melhoria",
    version: "1.62.13",
  },
  {
    buildTag: "2026-07-23-prevenda-fila-prometeu",
    deployedAt: "2026-07-23T00:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O Board agora abre no KANBAN (a tabela continua a um clique, no alternador do cabecalho).",
              "Enviou o PIX: a ficha sai de Pre-venda e vira Credenciado automaticamente, e a pessoa ja entra na fila do Prometeu.",
              "Selo PIX PAGO no card e na lista (passe o mouse pra ver a hora), com filtro de PIX pago / pendente.",
            ],
            screen: "Board",
          },
        ],
      },
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "A fila se monta sozinha: quem pagou vai pra frente pela HORA do pagamento; quem ainda nao pagou fica no fim, por ordem de chegada da CAD.",
            ],
            screen: "Fila do evento",
          },
        ],
      },
    ],
    rollback: "1.62.11",
    technical: {
      done: "Migration apolo_esteira_pagamento_prevenda: colunas pago_em e pagamento_ref + indice. lib/apolo/prevenda-fluxo.ts (novo): aoEnviarPixPrevenda (prevenda->credenciado + adicionarCredenciado no evento ativo, origem 'prevenda' com indice unico anti-duplicata) e aoConfirmarPagamentoPrevenda (carimba a esteira com `is null` pra ser idempotente + registrarPagamento no Prometeu). Webhook e disparo da bancada ligados nos dois. board/route.ts devolve pagoEm; board-view.tsx ganhou selo e filtro.",
      motivation: "Dentro de Credenciado convivem quem pagou e quem so recebeu a cobranca; faltava marcar, filtrar e alimentar a fila do lancamento.",
    },
    title: "PIX enviado vira Credenciado e alimenta a fila do Prometeu",
    type: "melhoria",
    version: "1.62.12",
  },
  {
    buildTag: "2026-07-22-webhook-fecha-recibo",
    deployedAt: "2026-07-22T14:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Ciclo do PIX fechado: quando o pagamento e confirmado, o RECIBO sai automaticamente pro cliente (WhatsApp + e-mail), sem ninguem apertar nada.",
              "Protecao contra reentrega do Asaas: o recibo sai UMA vez so, mesmo se o mesmo evento chegar repetido.",
            ],
            screen: "Pre-venda (webhook Asaas)",
          },
        ],
      },
    ],
    rollback: "1.62.10",
    technical: {
      done: "lib/apolo/recibo-prevenda.ts (novo): consulta o cliente no Asaas pelo customerId (o evento so traz o id), acha a ficha no Apolo pelo CPF pra pegar nome e empreendimento, e dispara o recibo nos dois canais; nunca lanca, cada canal devolve seu status. asaas-prevenda.ts: consultarClienteAsaas. webhook/route.ts: detecta PAYMENT_RECEIVED/CONFIRMED, checa reentrega ANTES do insert (se ja houve evento de confirmacao pro mesmo payment_id, nao redispara) e chama o recibo; maxDuration 30.",
      motivation: "O webhook so registrava o evento. Com o pagamento de teste confirmado, faltava fechar o ciclo: pagou -> recibo.",
    },
    title: "Pagou o PIX, recibo sai sozinho (webhook)",
    type: "melhoria",
    version: "1.62.11",
  },
  {
    buildTag: "2026-07-22-prevenda-email-remetente",
    deployedAt: "2026-07-22T14:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Os e-mails da pre-venda passam a sair como contato@careli.adm.br (antes saiam da caixa robo caca@).",
            ],
            screen: "Bancada Asaas",
          },
        ],
      },
    ],
    rollback: "1.62.9",
    technical: {
      done: "bancada/route.ts: remetente em PREVENDA_EMAIL_FROM (default contato@careli.adm.br), passado no `from` do sendGmailMessage. Se o Gmail recusar o remetente (alias nao liberado em 'Enviar e-mail como' na conta caca@), reenvia pela caixa padrao e avisa no retorno, em vez de perder a mensagem.",
      motivation: "O primeiro teste chegou como caca@; pro cliente quem fala e o contato@.",
    },
    title: "E-mails da pre-venda saem do contato@",
    type: "melhoria",
    version: "1.62.10",
  },
  {
    buildTag: "2026-07-22-prevenda-email",
    deployedAt: "2026-07-22T13:45:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "As mensagens do PIX (cobranca e recibo) passam a sair TAMBEM por e-mail, junto com o WhatsApp.",
              "O e-mail da cobranca leva a ficha (CAD) em PDF anexada de verdade, e tem versao HTML com botao de pagamento.",
            ],
            screen: "Bancada Asaas",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "O envio de e-mail da Iris passa a suportar ANEXO (multipart/mixed). Sem anexo, o envio continua igual.",
            ],
            screen: "E-mail",
          },
        ],
      },
    ],
    rollback: "1.62.8",
    technical: {
      done: "lib/iris/gmail.ts: sendGmailMessage ganhou `attachments` (corpo vira parte de um multipart/mixed; caminho sem anexo intacto). lib/apolo/emails-prevenda.ts (novo): monta assunto/texto/HTML da cobranca e do recibo. bancada/route.ts: montarFichaCad gera o PDF UMA vez (signed URL pro WhatsApp, bytes pro e-mail) e o disparo envia nos dois canais, reportando o status de cada um; falha de e-mail nao derruba o WhatsApp.",
      motivation: "Lucas: mandar as mensagens do PIX tambem por e-mail, sempre junto com o WhatsApp. O Gmail da Iris (caixa caca@) ja enviava, mas nao suportava anexo.",
    },
    title: "Pre-venda: PIX e recibo tambem por e-mail (com a ficha anexada)",
    type: "melhoria",
    version: "1.62.9",
  },
  {
    buildTag: "2026-07-22-cad-pix-templates-ficha",
    deployedAt: "2026-07-22T13:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Board: removido o aviso de 'previa de layout' — as acoes gravam de verdade.",
            ],
            screen: "Board",
          },
          {
            items: [
              "Mensagens do PIX refeitas: o pagamento deixa de ser 'confirmacao de participacao' e passa a ser ETAPA DA FICHA DE CADASTRO (CAD).",
              "A ficha (CAD em PDF) agora vai ANEXADA na mensagem de cobranca, pro cliente conferir os proprios dados.",
            ],
            screen: "Bancada Asaas",
          },
        ],
      },
    ],
    rollback: "1.62.7",
    technical: {
      done: "bancada/route.ts: novos templates cad_pix_cobranca (header DOCUMENT + amostra via uploadMetaWhatsAppTemplateHeaderMedia) e cad_pix_recibo, com texto reposicionado; disparo da cobranca monta o anexo (lookupApoloByDocument -> montarCadDeEntidade -> montarCadPdf -> signed URL do bucket privado). board-view.tsx: removido o badge de previa.",
      motivation: "O texto antigo dizia 'confirme sua participacao', o que esta errado: quem nao paga tambem pode comprar e ir ao evento. O PIX e etapa da ficha de cadastro. Os templates antigos (prevenda_pix_*) foram preservados; subimos nomes novos pra nao derrubar o que ja esta aprovado.",
    },
    title: "PIX como etapa da ficha (CAD) + ficha anexada na cobranca",
    type: "melhoria",
    version: "1.62.8",
  },
  {
    buildTag: "2026-07-22-caca-cad-envio-asana",
    deployedAt: "2026-07-22T11:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "CACA (interna): nesta acao, o envio das CADs e feito pelo time via Asana. A CACA NAO divulga link de formulario; se um corretor perguntar como enviar, orienta falar com o contato na Careli / encaminha pro time.",
            ],
            screen: "CACA",
          },
        ],
      },
    ],
    rollback: "1.62.6",
    technical: {
      done: "persona.ts: bloco da acao de lancamento passa a instruir que o ENVIO e via Asana (time) e a NAO divulgar link de formulario de CAD nesta acao.",
      motivation: "Lucas: nao divulgar o link do formulario para o Vale do Ouro, pois as CADs entram pelo Asana.",
    },
    title: "CACA: envio de CAD via Asana (sem divulgar formulario)",
    type: "melhoria",
    version: "1.62.7",
  },
  {
    buildTag: "2026-07-22-caca-status-cad",
    deployedAt: "2026-07-22T10:40:00-03:00",
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "CACA (interna): novo contexto do processo de CAD da acao de lancamento + ferramenta consultar_status_cad, que informa pelo CPF se a CAD esta em validacao, com credito aprovado (recebe o PIX amanha) ou reprovada.",
            ],
            screen: "CACA",
          },
        ],
      },
    ],
    rollback: "1.62.5",
    technical: {
      done: "lib/iris/caca/tools.ts + executors.ts: tool consultar_status_cad (por CPF -> lookupApoloByDocument -> etapa da apolo_esteira: prevenda=aprovado, revisao=reprovado, validacao/sem-esteira=em validacao; fallback so trata como CAD nova quem e review+source apolo). Disponivel no atendimento normal (nao so admin). persona.ts: bloco TEMPORARIO da acao de lancamento (cronograma validacao ate 12h / PIX amanha ao meio-dia) e como responder por status.",
      motivation: "Enxurrada de duvidas de clientes e corretores sobre o andamento da CAD na acao de lancamento; a CACA so sabia consultar em massa, nao responder o status de uma pessoa.",
    },
    title: "CACA: status da CAD por CPF + contexto da acao de lancamento",
    type: "melhoria",
    version: "1.62.6",
  },
  {
    buildTag: "2026-07-22-bancada-asaas-templates",
    deployedAt: "2026-07-22T10:20:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Bancada Asaas (interna): verificar o status de aprovacao dos templates da pre-venda na Meta e disparar cobranca/recibo de teste pro WhatsApp.",
            ],
            screen: "Bancada Asaas",
          },
        ],
      },
    ],
    rollback: "1.62.4",
    technical: {
      done: "app/api/apolo/asaas/bancada/route.ts: acoes status-templates (listMetaWhatsAppMessageTemplates dos 2 templates), disparar-cobranca e disparar-recibo (sendMetaWhatsAppTemplateMessage pelo 4143). UI preview-asaas.tsx: badge de status + telefone de teste + botoes de disparo.",
      motivation: "Validar ao vivo as comunicacoes da pre-venda (quais templates a Meta aprovou e como a mensagem chega).",
    },
    title: "Bancada Asaas: status dos templates + disparo de teste",
    type: "melhoria",
    version: "1.62.5",
  },
  {
    buildTag: "2026-07-22-relacionamento-modal-hooks",
    deployedAt: "2026-07-22T09:45:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrigido: a tela da ficha quebrava (tela branca) ao clicar em Adicionar na aba Relacionamentos. Agora o cadastro de vinculo abre normalmente.",
            ],
            screen: "CRM 360 - Relacionamentos",
          },
        ],
      },
    ],
    rollback: "1.62.3",
    technical: {
      done: "modules/apolo/blocks/crm/add-relationship-modal.tsx: o useEffect do debounce de busca ficava DEPOIS do early-return `if (!open) return null`. Com o modal fechado rodavam so os useState; ao abrir, entrava tambem o useEffect -> a contagem de hooks mudava e o React derrubava a arvore (erro minificado #310). useEffect movido para antes do early-return, com guarda `!open`.",
      motivation: "React #310 (rendered more hooks than during the previous render) ao abrir o modal de adicionar relacionamento.",
    },
    title: "Relacionamentos: modal de adicionar quebrava a ficha",
    type: "correcao",
    version: "1.62.4",
  },
  {
    buildTag: "2026-07-22-cad-cpf-legivel",
    deployedAt: "2026-07-22T09:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrigido: CADs enviadas pelo portal/wizard guardavam o CPF/CNPJ mascarado (so os 2 ultimos digitos). Agora nascem com o documento completo, legivel na validacao e pronto para a consulta ao Serasa.",
            ],
            screen: "Board - Validacao / Cadastro",
          },
        ],
      },
    ],
    rollback: "1.62.2",
    technical: {
      done: "lib/apolo/cadastro-persist.ts: createApoloEntity gravava document_masked/value_masked mascarados (maskDocument). Trocado por formatDocument (numero completo), alinhando com o sync do C2X, o import do Asana e o identidade-persist, que sempre gravaram completo. Era a unica porta que mascarava, e travava a analise de credito ('A ficha nao tem CPF completo'). Backfill manual da unica CAD real afetada (Poliana), CPF confirmado por hash.",
      motivation: "Documento mascarado na CAD travava a consulta ao Serasa e a esteira inteira (incidente 22/jul).",
    },
    title: "CAD: CPF/CNPJ completo e legivel na validacao",
    type: "correcao",
    version: "1.62.3",
  },
  {
    buildTag: "2026-07-22-board-fila-limite",
    deployedAt: "2026-07-22T09:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrigido: CADs novas que nao apareciam no Board. A fila de validacao estava limitada a 200 itens (as mais antigas), escondendo as CADs recentes acima disso.",
            ],
            screen: "Board - Validacao",
          },
        ],
      },
    ],
    rollback: "1.62.1",
    technical: {
      done: "app/api/apolo/board/route.ts: teto da origem review+apolo de 200 -> 2000 (ordem ascending cortava as CADs recentes; ha 272 em validacao, a 'Poliana' 272a nao aparecia).",
      motivation: "CAD enviada nao aparecia no Board (incidente reportado pelo Lucas).",
    },
    title: "Board: CADs novas sumindo da fila de validacao",
    type: "correcao",
    version: "1.62.2",
  },
  {
    buildTag: "2026-07-22-templates-prevenda",
    deployedAt: "2026-07-22T04:40:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: ["Bancada Asaas: botao para criar na Meta os 2 templates da pre-venda (cobranca + recibo)."],
            screen: "Asaas preview (interno)",
          },
        ],
      },
    ],
    rollback: "1.62.1",
    technical: {
      done: "Rota bancada acao 'criar-templates': cria prevenda_pix_cobranca (nome/emp/valor/link) e prevenda_pix_recibo (nome/valor/emp) via createMetaWhatsAppMessageTemplate (UTILITY, pt_BR, phone 4143), idempotente. Botao na tela (roda na Vercel, credenciais Meta completas).",
      motivation: "Submeter os templates da pre-venda a aprovacao da Meta.",
    },
    title: "Templates da pre-venda (cobranca + recibo)",
    type: "melhoria",
    version: "1.62.2",
  },
  {
    buildTag: "2026-07-22-bancada-asaas-ajustes",
    deployedAt: "2026-07-22T04:10:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Bancada Asaas: descricao da cobranca 'Pré-venda - CAD <codigo>, Empreendimento <nome>' + aviso de que o pagamento nao reserva unidade; vencimento e codigo da CAD configuraveis.",
            ],
            screen: "Asaas preview (interno)",
          },
        ],
      },
    ],
    rollback: "1.62.0",
    technical: {
      done: "Rota bancada: descricao = 'Pré-venda - CAD <cadCodigo>, Empreendimento <emp>. Este pagamento nao garante reserva de unidades...'; externalReference = cadCodigo (casa no webhook); vencimento padrao 2026-07-30. UI com campos empreendimento/codigo CAD/vencimento.",
      motivation: "Ajustes do Lucas na cobranca de teste da pre-venda.",
    },
    title: "Bancada Asaas: descricao com codigo da CAD + aviso",
    type: "melhoria",
    version: "1.62.1",
  },
  {
    buildTag: "2026-07-22-bancada-asaas",
    deployedAt: "2026-07-22T03:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Bancada de teste do Asaas (pre-venda): testar comunicacao, gerar PIX real, ver QR/expiracao e os eventos do webhook.",
            ],
            screen: "Asaas preview (interno)",
          },
        ],
      },
    ],
    rollback: "1.61.4",
    technical: {
      done: "Conta Gurgel (ASAAS_GURGEL_API_KEY, separada da Careli/Hades). lib/apolo/asaas-prevenda.ts (myAccount, criar cliente, criar PIX, QR, status). Rota /api/apolo/asaas/bancada (testar/gerar-pix/status + GET eventos). Webhook /api/publico/asaas/webhook grava apolo_asaas_eventos (migration 0066) com recebido_em (clock_timestamp, com hora) + headers crus (descobrir a auth do webhook); valida asaas-access-token se ASAAS_WEBHOOK_TOKEN setado. Tela /apolo/asaas-preview.",
      motivation: "Validar ao vivo a integracao Asaas da pre-venda: comunicacao, geracao de PIX e os dois bloqueadores (expiracao do QR sem chave PIX propria; webhook sem hora do pagamento).",
    },
    title: "Bancada de teste do Asaas (pre-venda)",
    type: "novidade",
    version: "1.62.0",
  },
  {
    buildTag: "2026-07-22-verificacao-ajustes-crm",
    deployedAt: "2026-07-22T02:45:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Data e hora agora no horario de Brasilia.",
              "Campos mais limpos: fonte 'Serasa Experian' no lugar do codigo do relatorio, 'Finalidade: CAD - <empreendimento>', e sem o campo Ambiente.",
              "Corrigida a quebra de layout no celular.",
            ],
            screen: "Verificacao publica do comprovante",
          },
          {
            items: [
              "Botao 'Abrir no CRM' no detalhe da ficha: abre o cadastro do cliente no CRM sem precisar copiar e pesquisar.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.61.3",
    technical: {
      done: "comprovante.ts dataBR com timeZone America/Sao_Paulo (afeta pagina e PDF). VerificarComprovante: removidos relatorio(codigo)/ambiente, add 'Base consultada: Serasa Experian' e 'Finalidade: CAD - <empreendimento>' (empreendimento vem do read-model, variavel); dd com break-words + viewport meta na page. BoardView recebe onOpenEntity=openEntityInCrm (ApoloPage) e mostra botao 'Abrir no CRM' no header do detalhe.",
      motivation: "Ajustes do Lucas na tela de verificacao (hora BR, nomes, responsivo) + atalho pro CRM a partir do Board.",
    },
    title: "Verificacao do comprovante: ajustes + atalho pro CRM no Board",
    type: "melhoria",
    version: "1.61.4",
  },
  {
    buildTag: "2026-07-22-qr-comprovante-fix",
    deployedAt: "2026-07-22T02:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrigido o QR do comprovante: o endereço de verificação agora é sempre o do site (c2x.app.br), garantindo que a leitura do QR abra a página certa.",
            ],
            screen: "Comprovante de credito",
          },
        ],
      },
    ],
    rollback: "1.61.2",
    technical: {
      done: "comprovante.ts: BASE_URL do QR fixado em https://c2x.app.br (nao usa mais NEXT_PUBLIC_APP_URL, que vinha errada no .env.local apontando pra URL do Supabase). 11 comprovantes gerados no backfill local (QR apontava pra URL errada) foram regenerados com o dominio correto; os 111 de producao ja estavam corretos.",
      motivation: "Lucas reportou erro ao ler o QR de um comprovante (era um dos gerados no backfill local, com dominio errado no QR).",
    },
    title: "Correcao do QR do comprovante de credito",
    type: "correcao",
    version: "1.61.3",
  },
  {
    buildTag: "2026-07-22-card-corretor",
    deployedAt: "2026-07-22T01:45:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "No card do quadro, o corretor agora aparece EMBAIXO da imobiliaria, em duas linhas, sem cortar o texto.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.61.1",
    technical: {
      done: "board-view.tsx CardBoard: imobiliaria e corretor em duas linhas (cada uma truncate) em vez de concatenadas numa linha so.",
      motivation: "Lucas: o corretor estava sendo cortado ao ficar na mesma linha da imobiliaria.",
    },
    title: "Card do Board: corretor embaixo da imobiliaria",
    type: "melhoria",
    version: "1.61.2",
  },
  {
    buildTag: "2026-07-22-cad-viva",
    deployedAt: "2026-07-22T01:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A CAD do cliente agora e salva automaticamente nos documentos e ATUALIZADA a cada etapa do processo, trazendo sempre as informacoes mais recentes.",
              "Na etapa de credito, os botoes viram 'Baixar comprovante' e 'Baixar CAD' (o salvamento e automatico).",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.61.0",
    technical: {
      done: "lib/apolo/salvar-cad.ts (gerarESalvarCad: montarCadDeEntidade -> montarCadPdf -> uploadApoloDocument tipo 'cad', idempotente por origem 'automatico', substitui a anterior). Gatilho em toda transicao de etapa: /serasa/consultar (na consulta) e board/[id]/etapa (movimento manual), best-effort. Rota board/[id]/salvar-cad reusa a CAD existente (gera se nao ha). maxDuration=30 na rota de etapa.",
      motivation: "Lucas: a CAD e um documento vivo, atualizado a cada etapa com as novas informacoes, salvo automaticamente.",
    },
    title: "CAD viva: salva e atualizada a cada etapa",
    type: "melhoria",
    version: "1.61.1",
  },
  {
    buildTag: "2026-07-21-comprovante-verificacao",
    deployedAt: "2026-07-22T00:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Toda consulta de credito gera um COMPROVANTE em PDF (score, dividas vencidas e veredito), salvo automaticamente nos documentos do cliente.",
              "Botoes para baixar o comprovante e para salvar a CAD nos documentos, na etapa de credito do Board.",
            ],
            screen: "Board - Analise de credito",
          },
          {
            items: [
              "O comprovante traz um QR code que abre uma pagina publica de verificacao (c2x.app.br/publico/verificar), sem login.",
              "A pagina confirma que o documento e autentico e mostra os dados tecnicos da consulta: data, quem solicitou, relatorio usado e ambiente. Os valores de credito ficam so no PDF.",
            ],
            screen: "Verificacao publica do comprovante",
          },
        ],
      },
    ],
    rollback: "1.60.0",
    technical: {
      done: "Comprovante de credito: lib/serasa/comprovante-pdf.ts (pdf-lib + qrcode, logo C2X, valores + QR), comprovante.ts (monta dados da serasa_consultas, fingerprint sha256 dos valores, gera+salva em apolo_documents tipo 'comprovante-credito', idempotente por consulta), comprovante-token.ts (HMAC HS256 reusando SESSAO_CAD_SECRET, falha-fechada). Gatilho best-effort no /serasa/consultar apos gravar. Rotas board/[id]/comprovante (baixar) e board/[id]/salvar-cad. Pagina publica app/publico/verificar (server component, sem login, mostra autenticidade + dados tecnicos da consulta: data/operador/relatorio/ambiente; score/dividas ficam so no PDF; sem senha). Dep nova: qrcode. Migration 0064 apolo_disparos (frente anterior) e 0065 (coluna comprovante_senha_hash, ficou orfa apos decisao de nao usar senha).",
      motivation: "Guardar o comprovante da consulta na pasta do cliente e permitir verificar a autenticidade pelo QR, com transparencia dos dados tecnicos da consulta ao Serasa.",
    },
    title: "Comprovante de credito com QR de verificacao",
    type: "novidade",
    version: "1.61.0",
  },
  {
    buildTag: "2026-07-21-credito-esteira-cad",
    deployedAt: "2026-07-21T23:55:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Analise de credito no Serasa, em producao: consulta por cliente na etapa de credito, com resultado APROVADO ou REPROVADO, score, dados cadastrais e restricoes (dividas vencidas, refin, protestos, cheques, pefin).",
              "Credito aprovado avanca sozinho para Pre-venda; reprovado vai para Credito em revisao.",
            ],
            screen: "Board - Analise de credito",
          },
          {
            items: [
              "A Validacao agora traz a ficha completa dos CADs que vieram do C2X (nascimento, nome da mae, sexo, naturalidade, endereco).",
              "Imobiliaria e corretor (do Asana) aparecem na fila, no card do quadro e nas CADs em PDF.",
            ],
            screen: "Board - Validacao",
          },
          {
            items: [
              "Limite de credito por empreendimento: restricoes acima do valor reprovam o cliente (vazio = R$ 1.000).",
            ],
            screen: "Empreendimento - Cadastro",
          },
          {
            items: [
              "Credito reprovado avisa automaticamente o coordenador do empreendimento pela Iris, com a CAD do cliente anexa (e o corretor tambem, quando tem telefone cadastrado).",
              "Cada aviso mostra a devolutiva de entrega (enviado, entregue, lido) e fica registrado no historico da ficha.",
              "Botao de reenviar o aviso ao coordenador ou ao corretor, so para o perfil admin.",
            ],
            screen: "Board - Aviso de reprovacao",
          },
        ],
      },
    ],
    rollback: "1.59.1",
    technical: {
      done: "Serasa em producao (relatorio basico PF, 7 env). Esteira persiste em apolo_esteira: rota PATCH /board/[id]/etapa + gatilho no /serasa/consultar (aprovado->prevenda, reprovado->revisao, sem rebaixar). Limite por empreendimento em apolo_enterprise_settings.limite_credito (migration 0063). Validacao le o c2xCadastro ao vivo (fetchC2xCadastroByEntity) e mescla metadata < c2x < esteira.ficha. montarCadDeEntidade gera a CAD real (logo C2X centralizada, imobiliaria/corretor da coluna apolo_esteira, autenticacao sempre via gerarCodigoAutenticacao). Backfill imobiliaria/corretor do Asana (completar-vinculos): 379 corretores + 391 imobiliarias. Disparo de reprovacao (lib/apolo/disparo-reprovacao.ts): coordenador do empreendimento (manager_id do C2X, com telefone) sempre + corretor se tiver telefone; templates Meta reprovacao_de_credito e reprovacao_de_credito_corretor pelo numero 4143, com a CAD anexa. Gatilho automatico ao reprovar + reenvio manual so-admin (POST /serasa/reenviar-reprovacao, authorizeApoloAdmin). Registro em apolo_audit_events (historico) + apolo_disparos (migration 0064) com devolutiva de entrega que o meta-inbound-processor casa por wa_message_id.",
      motivation: "Ligar a analise de credito na esteira de credenciamento: consulta, decisao aprovado/reprovado, ficha completa, vinculos de imobiliaria/corretor e o aviso automatico ao coordenador quando reprova.",
    },
    title: "Analise de credito Serasa e esteira de credenciamento",
    type: "novidade",
    version: "1.60.0",
  },
  {
    buildTag: "2026-07-21-serasa-veredito-aprovado-reprovado",
    deployedAt: "2026-07-21T22:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A tela de preview de credito passa a mostrar APROVADO ou REPROVADO em destaque, com o motivo.",
              "Regra do Vale do Ouro: reprovado quando o total das restricoes passa de R$ 1.000 (o limite e por empreendimento).",
            ],
            screen: "Analise de credito (preview)",
          },
        ],
      },
    ],
    rollback: "1.59.0",
    technical: {
      done: "lib/serasa/avaliacao.ts: totalRestricoes (soma o balance de todos os blocos de negativeData) + avaliarCredito(cru, limite) — aprovado se total <= limite (default R$ 1.000, do Vale do Ouro; parametrizavel por empreendimento). Rota /preview devolve o veredito; a tela mostra em verde/vermelho. 27 testes verdes (fixture real: 5.499,77 de restricao reprova no limite de 1.000).",
      motivation: "O Lucas: 'ter um campo que vai falar se esta aprovado ou reprovado; para o Vale do Ouro, restricao acima de 1000 reais reprova'.",
    },
    title: "Serasa: veredito aprovado/reprovado por limite de restricao",
    type: "melhoria",
    version: "1.59.1",
  },
  {
    buildTag: "2026-07-21-serasa-preview-validacao",
    deployedAt: "2026-07-21T22:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Tela de preview da analise de credito (/apolo/serasa-preview): escolhe um CPF da massa de teste, consulta o Serasa e mostra score, situacao, dados cadastrais e restricoes detalhadas.",
              "Serve para validar o que a integracao traz antes de ligar no cadastro.",
            ],
            screen: "Analise de credito (preview)",
          },
        ],
      },
    ],
    rollback: "1.58.1",
    technical: {
      done: "Com a massa de teste do Serasa (21/jul), a integracao PF foi finalizada. Descobertas: (1) o PF autorizado e RELATORIO_AVANCADO_TOP_SCORE_PF_PME (o basico da 412 USER-NOT-AUTHORIZED [BPCB]); trocado o default. (2) Schema real de PF capturado (fixture exemplo-resposta-pf.json): o parser antigo lia o score do lugar errado (fica em attributes.attributesResponse[].scoring, nao em score.score) e as negativacoes das listas (que vem vazias; a contagem esta em summary.count). resumo.ts reescrito lidando com os dois schemas (PF por summary.count, PJ por listas); 23 testes verdes. Nova rota POST /api/apolo/serasa/preview (consulta ao vivo sem amarrar a um CAD, grava com finalidade 'preview-validacao', devolve resumo + cru). Tela PreviewSerasa com os 23 CPFs da massa. PJ ainda sem reportName autorizado — perguntar ao Serasa.",
      motivation: "O Lucas pediu uma tela para validar as informacoes que a analise de credito traz antes de cravar o que vai pro cadastro. E a massa de teste destravou o teste real da integracao PF.",
    },
    title: "Serasa: tela de preview + PF finalizado com a massa de teste",
    type: "melhoria",
    version: "1.59.0",
  },
  {
    buildTag: "2026-07-21-imobiliaria-publica-comeca-empreendimento",
    deployedAt: "2026-07-21T21:15:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O cadastro publico de imobiliaria agora COMECA pela escolha do empreendimento ('Quais empreendimentos voce quer trabalhar?'), depois o CNPJ e o cadastro completo, com os empreendimentos ja marcados.",
            ],
            screen: "Cadastro publico de imobiliaria",
          },
        ],
      },
    ],
    rollback: "1.58.0",
    technical: {
      done: "ImobiliariaPublicoPortal ganhou o passo de escolha de empreendimento (vitrine multi-select dos ativos) ANTES do CNPJ, espelhando o CredenciamentoFlow interno. Os escolhidos vao ao CadastroFlow via empreendimentosIniciais (empreendimentosHerdados = true -> o wizard nao repete o seletor na Identificacao). Antes o publico comecava pelo CNPJ.",
      motivation: "Lucas: 'o da imobiliaria comeca escolhendo o empreendimento a qual ela quer se habilitar, eu quero o mesmo fluxo' (o mesmo do credenciamento interno).",
    },
    title: "Imobiliaria publica: comeca pela escolha do empreendimento",
    type: "melhoria",
    version: "1.58.1",
  },
  {
    buildTag: "2026-07-21-cad-publico-formulario-completo",
    deployedAt: "2026-07-21T20:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O link publico de CAD passa a usar o FORMULARIO COMPLETO, o mesmo do hub: documento, foto pelo celular, leitura automatica, ficha e revisao.",
              "O corretor so entra no formulario depois de se identificar: informa o CPF, se nao tiver cadastro faz na hora (CNPJ da imobiliaria, dados, CRECI) e escolhe o empreendimento.",
              "O cadastro publico de imobiliaria tambem passa a usar o formulario completo.",
            ],
            screen: "Cadastro publico (corretor e imobiliaria)",
          },
          {
            items: [
              "Vincular empreendimento a uma imobiliaria na aba Relacionamentos: a busca agora acha o empreendimento enquanto voce digita, sem precisar apertar Enter.",
            ],
            screen: "Ficha - Relacionamentos",
          },
        ],
      },
    ],
    rollback: "1.57.1",
    technical: {
      done: "CadastroFlow ganhou um modo publico via prop `publico` (React Context com adapter dos 4 fetches; default = comportamento interno atual, byte a byte). Interno intacto (revisado + 176 testes). Telas publicas: PortaoCorretor (CPF -> CNPJ -> dados -> CRECI -> empreendimento, sessao assinada) entrega ao CadastroFlow tipo=prospect; PortaoImobiliaria idem para tipo=imobiliaria. Rotas publicas novas: /api/publico/cad/salvar, /api/publico/imobiliaria/{iniciar,cadastro}; ocr virou multiplexer (extract/enrich/enrich-company) exigindo sessao do corretor (trava de custo). Descartados os flows simplificados CadPublicoFlow e ImobiliariaPublicoFlow. Modal de relacionamento: busca com debounce (350ms) ao digitar, alem do Enter. Confirmado: loadApoloEnterprises traz o Vale do Ouro (VLO/id 35, VALE DO OURO; VDO/19 e VEREDAS DO OURO).",
      motivation: "O Lucas: 'tenho ele dentro do hub para quem e interno e tenho ele publico para os corretores enviarem sem login, e o mesmo processo'. Antes o publico era um formulario simplificado paralelo; agora reusa o completo. E o vinculo empreendimento-imobiliaria (pre-requisito para o corretor chegar no formulario) travava porque a busca so disparava no Enter.",
    },
    title: "CAD publico: formulario completo e vinculo de empreendimento",
    type: "melhoria",
    version: "1.58.0",
  },
  {
    buildTag: "2026-07-21-portal-publico-cad-ajustes",
    deployedAt: "2026-07-21T19:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrige o layout do formulario no celular: o conteudo escapava para a direita e ficava cortado.",
              "O botao da assistente ganha o icone de IA (Sparkles) no lugar do '?'.",
            ],
            screen: "Cadastro publico (corretor)",
          },
        ],
      },
    ],
    rollback: "1.57.0",
    technical: {
      done: "globals.css tem `html { min-width: 1024px }` (o hub e desktop), que fazia o card centralizar num espaco de 1024px e deslocar para a direita no celular. Adicionada a excecao `html:has(.publico-shell) { min-width: 0; overflow-x: hidden }` (mesmo padrao do app /m com .panteon-mobile-root) e a classe `publico-shell` no container raiz da CascaPublica. Botao flutuante da CACA: icone Sparkles (lucide-react, o mesmo que o Apolo usa para IA) no estado fechado; X no aberto.",
      motivation: "O portal e mobile-first e o corretor abre no celular. O min-width de desktop quebrava a tela no dispositivo real (visto num Android em 20/jul).",
    },
    title: "Portal publico: ajuste de layout no celular e icone da assistente",
    type: "correcao",
    version: "1.57.1",
  },
  {
    buildTag: "2026-07-21-portal-publico-cad",
    deployedAt: "2026-07-21T18:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Link publico para o corretor enviar a CAD do cliente, sem login, direto do celular.",
              "O corretor informa o CPF: se ja tem cadastro, segue direto; se nao, a propria tela faz o cadastro na hora.",
              "Nome e CRECI vem preenchidos pelo CPF; o corretor so confere.",
              "So aparecem os empreendimentos que a imobiliaria dele esta habilitada a trabalhar. Com um so, ja segue para a ficha.",
              "Link publico para a imobiliaria se cadastrar e escolher os empreendimentos que quer trabalhar.",
              "A CAD gerada leva a logo do C2X e o nome do corretor e da imobiliaria.",
            ],
            screen: "Cadastro publico (corretor e imobiliaria)",
          },
          {
            items: [
              "Vinculo de empreendimento na aba Relacionamentos: agora e possivel ligar uma imobiliaria a um empreendimento.",
            ],
            screen: "Ficha · Relacionamentos",
          },
        ],
      },
    ],
    rollback: "1.56.0",
    technical: {
      done: "Rotas publicas em /publico/cad e /publico/imobiliaria (fora do HubShell, allowlist no proxy). Fluxo do corretor por maquina de estados: CPF -> CNPJ (prova credenciamento) -> dados (nome/CRECI da MOST via CARELI_PF_01 + CARELI_PF_06) -> empreendimento -> CAD. Sessao assinada (SESSAO_CAD_SECRET): a imobiliaria e os empreendimentos habilitados vem do token, nunca do corpo, entao o anonimo nao escolhe a que imobiliaria se vincula. Toda CAD nasce com corretor_entity_id + imobiliaria_entity_id + enterprise_id, com CHECK no banco (migration 0061) que impede CAD publica sem vinculo. Teto por IP em publico_rate_limit (0062). Correcoes: busca de CNPJ agora olha apolo_entity_identifiers (as 412 imobiliarias nao tem document_hash); nivel Empreendimento do modal de relacionamento grava metadata.enterpriseId (empreendimento nao e entidade Apolo); CRECI migrou de CARELI_PF_04 (9 datasets) para CARELI_PF_06 (so class_organization, R$ 0,177). Inclui tambem melhorias do Serasa que estavam na branch (parser lendo a resposta real, contador que atualiza no erro).",
      motivation: "Levar a captura de CAD para fora do hub: o corretor sobe a ficha do cliente pelo celular, por um link enviado no WhatsApp, sem depender de operador nem de login. O CPF do corretor cadastrado e a trava de custo (so quem esta credenciado dispara OCR/enriquecimento). Fase 1 do acesso externo — o app com login proprio vem depois.",
    },
    title: "Portal publico: CAD do corretor e cadastro de imobiliaria",
    type: "melhoria",
    version: "1.57.0",
  },
  {
    buildTag: "2026-07-21-serasa-bancada-teste",
    deployedAt: "2026-07-21T16:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Bancada de teste da autenticacao do Serasa: quatro botoes, um para cada combinacao de host e endpoint que a documentacao deixa em aberto.",
              "Cada clique faz UMA chamada e mostra o que voltou. Sem repeticao automatica.",
              "So aparece em homologacao; em producao a bancada nao existe.",
            ],
            screen: "Board · Analise de credito",
          },
        ],
      },
    ],
    rollback: "1.55.0",
    technical: {
      done: "POST /api/apolo/serasa/bancada: uma chamada de autenticacao por requisicao, sem retry e sem lote. Teto proprio de 40 tentativas/dia (o Serasa bloqueia o IP acima de 200 e a liberacao exige formalizacao). Recusa rodar quando SERASA_AMBIENTE != homologacao. Cada tentativa e registrada em serasa_consultas com finalidade 'bancada-descoberta-endpoint', entao entra na conta do teto e deixa historico. A resposta de SUCESSO nao volta inteira para a tela (carrega o token): volta so a lista de campos; a de ERRO volta crua, que e onde esta o diagnostico. As 7 env vars foram configuradas em producao (homologacao).",
      motivation: "A documentacao do Serasa publica DOIS caminhos de token e DOIS hosts de teste sem dizer qual vale para a nossa credencial, e a resposta do time deles pode demorar. Decisao do Lucas: descobrir por tentativa e erro. Sao 4 combinacoes — menos de dez chamadas contra um teto de 200/dia.",
    },
    title: "Serasa: bancada de teste da autenticacao",
    type: "melhoria",
    version: "1.56.0",
  },
  {
    buildTag: "2026-07-21-apolo-serasa-motor-e-tela",
    deployedAt: "2026-07-21T15:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A etapa Analise de credito ganhou a tela de consulta ao Serasa.",
              "Enquanto a integracao nao estiver liberada pelo Serasa, a tela informa o que falta em vez de oferecer um botao que nao funciona.",
              "O ambiente fica sempre visivel: resultado de homologacao aparece marcado como teste, para nao ser confundido com consulta real.",
              "Consulta anterior do mesmo CPF e reaproveitada; para consultar de novo, o aviso de nova cobranca e explicito.",
            ],
            screen: "Board · Analise de credito",
          },
          {
            items: [
              "Ficha ja corrigida ou editada a mao nao e mais reprocessada pela correcao de titulares.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.54.0",
    technical: {
      done: "Migration 0059 (serasa_consultas): uma linha por chamada, inclusive as que falham, com ambiente OBRIGATORIO e sem default. lib/serasa/{config,auth,client,resumo}.ts, 23 testes. Hosts, credenciais e ambiente 100% por env: a documentacao do Serasa publica TRES hosts (uat-api, sandbox-api, api) e DOIS caminhos de token, entao nada fica cravado no codigo. `ambienteConfere` recusa a consulta quando o ambiente declarado nao bate com o host — o cenario caro e URL de producao rodando com rotulo de teste. Documento sempre em header (X-Document-Id), nunca em query string; X-Retailer-Document-Id sempre enviado, senao a documentacao diz que a cobranca vai para o cliente distribuidor. Teto de 150/dia em homologacao (o Serasa bloqueia o IP acima de 200) e reaproveitamento de consulta em 30 dias. O resumo do relatorio e heuristico e assumidamente provisorio: o schema da resposta nao esta documentado, entao o cru fica salvo inteiro.",
      motivation: "Proximo passo da esteira: a analise de credito das 122 CADs e manual hoje. Decisao do Lucas: montar tela, resultado, ligacao com o cadastro e comprovante ANTES de comecar a consultar. As perguntas que travam o codigo (endpoint de token, host de homologacao, grafia dos reportName) foram enviadas ao Serasa em 21/jul.",
    },
    title: "Apolo: analise de credito com Serasa (motor e tela)",
    type: "novidade",
    version: "1.55.0",
  },
  {
    buildTag: "2026-07-21-apolo-historico-ficha",
    deployedAt: "2026-07-21T14:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Novo botao Historico na ficha: mostra quem editou, quando e quantos campos mudaram.",
              "Clicando na edicao, abre o detalhe campo a campo com o valor anterior e o novo.",
              "A correcao de titular tambem aparece no historico, com o documento mascarado.",
            ],
            screen: "Board · Validacao",
          },
        ],
      },
    ],
    rollback: "1.53.0",
    technical: {
      done: "GET /api/apolo/board/[id]/historico le apolo_audit_events (edit_ficha + edit_identity) e AGRUPA por autor+minuto: um Salvar alteracoes com 13 campos e UM evento com 13 alteracoes, nao 13 eventos. Rotulos legiveis (escolaridadeId -> Escolaridade). Nome do autor resolvido em uma consulta so a hub_users. Carregado sob demanda no clique — a maioria das fichas nunca foi editada e buscar em toda abertura seria consulta a toa com 270 na fila.",
      motivation: "Fechando o pedido do Lucas de 21/jul: as alteracoes ja eram registradas (o que mudou, para qual valor e quem), mas so davam para ler por SQL. Agora ele valida pela propria tela.",
    },
    title: "Apolo: historico de alteracoes na ficha",
    type: "novidade",
    version: "1.54.0",
  },
  {
    buildTag: "2026-07-21-apolo-padrao-idade-telefone",
    deployedAt: "2026-07-21T13:15:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A idade passou a acompanhar a data de nascimento enquanto voce digita.",
              "A secao Conjuge aparece assim que voce marca Casado, sem precisar salvar antes.",
              "Nomes, filiacao, naturalidade e endereco seguem o padrao Primeira Maiuscula.",
              "Telefone ganha o formato (37) 99956-9096 enquanto voce digita — e os que vieram importados aparecem no mesmo padrao.",
            ],
            screen: "Board · Validacao",
          },
        ],
      },
    ],
    rollback: "1.52.1",
    technical: {
      done: "montarSecoes passou a receber o `rascunho` e mescla por cima do cadastro, entao tudo que e DERIVADO acompanha a digitacao (idade via calcIdade, e o `casado` que decide a secao Conjuge e o regime de bens). lib/format/phone-br.ts (novo, 9 testes) com mascara progressiva e normalizacao dos formatos que vieram do Asana: 37999569096, (37)998256365, +55 37 99860-2317, 0379991251532 e dois numeros separados por barra. Guarda: numero que comeca com 55 e ja tem tamanho nacional NAO perde os dois primeiros digitos. Padronizacao aplicada na exibicao E no PATCH do servidor, porque o mesmo campo entra pela digitacao e pela importacao. Nomes usam o toTitleCase que ja e a regra global do Hub.",
      motivation: "Lucas editou a ficha do Mateus e apontou: idade nao atualizava ao trocar a data, faltava o padrao de Primeira Maiuscula e os telefones precisavam sair todos no formato do Apolo, tanto o digitado quanto o importado.",
    },
    title: "Apolo: idade ao vivo, Primeira Maiuscula e telefone padronizado",
    type: "melhoria",
    version: "1.53.0",
  },
  {
    buildTag: "2026-07-21-apolo-fix-carregamento-validacao",
    deployedAt: "2026-07-21T12:45:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A ficha voltou a carregar: a tela ficava presa em Carregando documentos.",
            ],
            screen: "Board · Validacao",
          },
        ],
      },
    ],
    rollback: "1.52.0",
    technical: {
      done: "Restaurado o useEffect que busca /api/apolo/documentos e /api/apolo/board/[id] e desliga o estado `carregando`. Ele foi APAGADO por engano na v1.52.0, quando a substituicao do autosave pelo modo de edicao recortou um bloco de texto grande demais e levou o efeito junto.",
      motivation: "Sem o efeito nenhum fetch era disparado e `carregando` nunca virava false — spinner eterno, com a validacao inutilizavel. O typecheck passou porque o codigo seguia VALIDO sem o efeito: type-check nao cobre 'faltou uma peca'. Licao: em arquivo de 2 mil linhas, substituir bloco por recorte de texto e fragil; usar ancoras menores e conferir o que ficou entre elas. E rodar o build (que tambem passou aqui) nao substitui abrir a tela.",
    },
    title: "Apolo: ficha da validacao voltou a carregar",
    type: "correcao",
    version: "1.52.1",
  },
  {
    buildTag: "2026-07-21-apolo-modo-edicao-validacao",
    deployedAt: "2026-07-21T12:15:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A ficha ganhou modo de edicao: confira em leitura, clique em Editar ficha, altere o que precisar e salve de uma vez.",
              "TODOS os campos ficam editaveis, inclusive nome, documento e o tipo Pessoa Fisica / Juridica. A idade continua vindo da data de nascimento.",
              "Cliente casado abre os campos do conjuge: nome, CPF, nascimento, mae, telefone e e-mail.",
              "Toda alteracao fica registrada: o campo, o valor anterior, o novo valor e quem alterou.",
              "Um aviso aponta quando a ficha diverge do formulario do Asana — proponente diferente ou Pessoa Fisica x Juridica.",
            ],
            screen: "Board · Validacao",
          },
        ],
      },
    ],
    rollback: "1.51.1",
    technical: {
      done: "board-view: estado `editando` + `rascunho` (so o que foi mexido). Salvar separa identidade (nome/documento/tipo, chaves __) da ficha: a identidade vai para POST /api/apolo/board/[id]/identidade e ABORTA o salvamento se falhar; o resto vai no PATCH. Recarrega do servidor depois, porque a identidade muda em outra tabela. PATCH passou a gravar UMA LINHA POR CAMPO em apolo_audit_events (action edit_ficha, com de/para/autor) — antes so existia ficha_editada_por, que guarda apenas o ultimo editor. Diagnostico le o Perfil dos custom_fields do Asana (o projeto tem dois campos Perfil; pega o preenchido) e marca divergencia de PF/PJ. GET devolve o conjuge de apolo_relationships e o laudo do Asana.",
      motivation: "Regra do Lucas: o operador vai olhar CAD por CAD e alterar o que perceber errado, e e obrigatorio saber depois o que mudou, para qual valor e por quem. O autosave campo a campo nao dava trilha coerente e permitia gravacao sem querer. Nas PJ nada e preenchido automaticamente (o Asana nao traz CNPJ): o sistema aponta e o operador resolve.",
    },
    title: "Apolo: modo de edicao na validacao da CAD",
    type: "melhoria",
    version: "1.52.0",
  },
  {
    buildTag: "2026-07-21-apolo-indice-busca-identidade",
    deployedAt: "2026-07-21T11:45:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Ficha com titular corrigido volta a aparecer na busca pelo nome novo.",
              "Se alguma parte da correcao falhar, a tela avisa em vez de dar como concluida.",
            ],
            screen: "Board · Validacao",
          },
        ],
      },
    ],
    rollback: "1.51.0",
    technical: {
      done: "apolo_search_entries.status e NOT NULL SEM DEFAULT: o upsert do PostgREST monta INSERT ... ON CONFLICT e o INSERT viola a restricao antes de chegar ao conflito. Como o erro nao era checado, as 11 fichas corrigidas ficaram indexadas pelo nome ANTIGO. Trocado por UPDATE (a linha sempre existe para entidade existente) com insert de fallback informando status. Erro de delete e insert de identificador tambem passaram a abortar: se o insert falhasse apos o delete, a pessoa ficaria sem documento e invisivel ao dedup. Os 11 indices ja afetados foram corrigidos por SQL.",
      motivation: "As 11 correcoes de titular gravaram certo em apolo_entities mas a busca continuou devolvendo o nome antigo — a ficha do Mateus indexada como Karla. O comentario do codigo dizia 'sem isso a ficha some da busca' e a implementacao falhava em silencio.",
    },
    title: "Apolo: indice de busca na troca de identidade",
    type: "correcao",
    version: "1.51.1",
  },
  {
    buildTag: "2026-07-21-apolo-corrigir-titular",
    deployedAt: "2026-07-21T11:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Novo Corrigir titulares: poe cada pessoa no seu lugar nas fichas que ficaram com o conjuge no lugar do proponente.",
              "Mostra o orcamento e a lista nome a nome ANTES de gastar; so le documento depois da confirmacao.",
              "Traz o CPF do proponente do documento dele, e o conjuge fica com o documento dele.",
              "Ficha sem documento do proponente nao e alterada: entra como pendente de conferencia.",
            ],
            screen: "Importar CADs · Completar dados",
          },
        ],
      },
    ],
    rollback: "1.50.2",
    technical: {
      done: "lib/apolo/documento.ts (validacao de CPF e CNPJ — CNPJ nao existia no repo, e por isso a JFL entrou como PF com o CPF do socio). lib/apolo/identidade-persist.ts grava identidade com quatro protecoes que a auditoria do codigo apontou: recusa ficha espelho do C2X (resync de 6/6h reescreveria), recusa documento que ja pertence a outra ficha, DELETE+INSERT do identificador (upsert deixaria dois CPFs is_primary e a CACA atenderia a pessoa errada) e recalculo do normalized_text (senao a ficha some da busca). lib/apolo/corrigir-titular.ts le os anexos ate achar o documento do proponente, reaproveitando o que ja foi lido por SHA-256. Rota com GET de orcamento e POST confirmado, em lotes de 5.",
      motivation: "A leitura parava no primeiro anexo com CPF valido; no PDF do casal esse costuma ser o do CONJUGE. O diagnostico com ancora no formulario do Asana achou 15 fichas assim. Regra do Lucas: se o formulario aponta o Mateus, o CPF tem que ser o do Mateus.",
    },
    title: "Apolo: corrigir titular das CADs",
    type: "melhoria",
    version: "1.51.0",
  },
  {
    buildTag: "2026-07-21-apolo-diagnostico-titular",
    deployedAt: "2026-07-21T10:15:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Novo Diagnosticar titulares: compara cada CAD com o formulario do Asana e diz de quem e a ficha.",
              "Aponta as fichas que ficaram com o conjuge no lugar do proponente, as que estao sem conjuge e as que precisam de conferencia.",
              "Nao altera cadastro nenhum e nao tem custo: so grava o laudo para conferencia.",
              "O CEP passou a preencher logradouro, bairro, cidade e UF na validacao.",
            ],
            screen: "Importar CADs · Completar dados",
          },
        ],
      },
    ],
    rollback: "1.50.1",
    technical: {
      done: "lib/apolo/cad-diagnostico.ts com classificarCad puro e 9 testes sobre casos reais (Mateus x Karla, Marcia x Helio, Maria Eduarda x Joao Marcus, diploma lido como nome). Similaridade token a token, porque a distancia de edicao sobre a string inteira reprovava 'JOAO MARCOS REZENDE COELHO' lido como 'JOAO MARCUS REZENDE COMO'. Decisao RELATIVA entre os dois candidatos da CAD (proponente x conjuge) com vantagem minima de 0,25; empate fica com o proponente. POST /api/apolo/asana/diagnostico grava o laudo em apolo_audit_events (action diagnostico_cad), nunca no cadastro.",
      motivation: "A leitura de documentos para no primeiro anexo com CPF valido; no PDF do casal esse costuma ser o do CONJUGE, e a ficha nasce com a identidade da pessoa errada enquanto telefone, profissao e renda vem do formulario e sao do proponente. So o Asana sabe quem e proponente e quem e conjuge. Eu mesmo errei o diagnostico da ficha da Karla olhando so o documento — dai a necessidade de laudo antes de corrigir.",
    },
    title: "Apolo: diagnostico de titular das CADs",
    type: "melhoria",
    version: "1.50.2",
  },
  {
    buildTag: "2026-07-21-apolo-validacao-espelha-formulario",
    deployedAt: "2026-07-21T08:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A ficha de validacao passou a mostrar exatamente os campos da revisao do formulario: Identificacao, Perfil, Endereco, Contato e Conjuge.",
              "Idade aparece de novo, calculada a partir da data de nascimento.",
              "Endereco aparece mesmo quando esta vazio — antes a secao sumia justamente nas CADs que precisavam do preenchimento.",
              "Nome do pai, RG e orgao emissor sairam: nao fazem parte da revisao do formulario.",
              "Corrigida a lista suspensa que abria branca no modo escuro e ficava ilegivel.",
            ],
            screen: "Board · Validacao",
          },
          {
            items: [
              "A data que aparece na fila voltou a ser a da CAD no Asana, e nao a hora em que a importacao rodou.",
              "Nova aba Completar dados: rele o formulario do Asana e preenche o que faltou nas CADs ja importadas, sem custo.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.50.0",
    technical: {
      done: "board-view: montarSecoes espelha o montarCadDoc do wizard (mesmas secoes, ordem e rotulos), com calcIdade e regime de bens condicionado a casado/uniao estavel (ids 2 e 6). Endereco deixou de ser condicional e le ficha -> apolo_addresses. O <select> voltou a bg-surface: o popup e desenhado pelo browser com a cor COMPUTADA do elemento, e bg-transparent resolvia para branco enquanto a option herdava text-ink claro. chegou_em: criadoEm agora atravessa escanearCads -> orcamento -> tela -> aplicarVinculos (a rota mandava null cravado). gravarChegadaDoLote faz o backfill so onde esta null.",
      motivation: "O Lucas abriu a validacao e faltava metade: sem endereco, sem idade, com campos que a revisao do formulario nao tem, lista ilegivel no dark e a fila inteira marcada com a mesma data (392 registros as 01:58). A regra que ele fixou: a validacao confere o que aparece na revisao ao final do formulario, PF e PJ.",
    },
    title: "Apolo: validacao espelha a revisao do formulario",
    type: "correcao",
    internal: true,
    version: "1.50.1",
  },
  {
    buildTag: "2026-07-20-apolo-validacao-editavel",
    deployedAt: "2026-07-20T14:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A ficha da validacao virou formulario: o operador completa o que faltou com o documento aberto do lado.",
              "Cada campo salva sozinho, ao sair dele — nao existe botao de salvar para esquecer de apertar.",
              "Sexo, estado civil, escolaridade, faixa de renda e profissao usam as listas padronizadas do sistema.",
              "RG e orgao emissor passaram a aparecer: ja vinham sendo lidos do documento e ficavam escondidos.",
              "O que o operador digita nunca mais e apagado por uma nova importacao.",
            ],
            screen: "Board · Validacao",
          },
          {
            items: [
              "Reimportar uma CAD de quem ja e cliente deixou de criar um segundo cadastro da mesma pessoa.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.49.0",
    technical: {
      done: "Migration 0058 (apolo_esteira.ficha jsonb) + PATCH em /api/apolo/board/[id] gravando campo a campo com merge. A tela le metadata.cadastro mesclado com a ficha, e a ficha ganha. gravarFichaDoLote passa a copiar o cadastro importado para a ficha preenchendo SO campo vazio, para reimportar nunca desfazer digitacao humana. acharPorCpf consulta apolo_entity_identifiers.value_hash alem de apolo_entities.document_hash: o sync do C2X grava document_hash null e deixava 4.133 das 4.286 entidades invisiveis ao dedup. 59 testes no Apolo.",
      motivation: "A ficha vivia em apolo_entities.metadata, que o sync do C2X substitui inteiro a cada rodada — o mesmo mecanismo que apagou a esteira de 122 CADs em 20/jul. Com o operador digitando na tela o dia todo, o prejuizo passaria a ser trabalho humano. O dedup cego ja tinha duplicado um cliente real (RAFAEL GONCALVES LEITE).",
    },
    title: "Apolo: validacao editavel pelo operador",
    type: "melhoria",
    version: "1.50.0",
  },
  {
    buildTag: "2026-07-20-apolo-cad-formulario-completo",
    deployedAt: "2026-07-20T11:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A importacao passou a ler o formulario inteiro da CAD: profissao, renda, estado civil, escolaridade, telefone e e-mail do cliente.",
              "O conjuge vem junto, com nome, contato, profissao e renda — igual ao cadastro feito a mao.",
              "Profissao, escolaridade, estado civil e renda sao convertidos para as listas padronizadas do sistema, mesmo vindo escritos a mao no Asana.",
              "O que nao for reconhecido com seguranca fica em branco para o operador escolher, em vez de entrar errado.",
              "Nada disso tem custo: e informacao que ja estava na CAD.",
            ],
            screen: "Importar CADs",
          },
          {
            items: [
              "A lista ganhou filtro por etapa, com a contagem de cada uma.",
              "Da para ordenar clicando no cabecalho: nome, etapa, documento, empreendimento e data de chegada.",
              "O CPF aparece completo, como ja acontecia nas CADs vindas do C2X.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.48.2",
    technical: {
      done: "asana-descricao.ts faz o parse do corpo do formulario (rotulo/valor, aceitando valor na mesma linha ou na seguinte) e separa proponente, conjuge e corretor — os tres tem e-mail e telefone, e confundi-los gravaria o contato do corretor como do cliente. c2x-match.ts casa texto livre com as listas fechadas do C2X: profissao por similaridade contra 234 opcoes (limiar alto: Pedreiro nao pode virar Padeiro), escolaridade por sinonimos (2 grau, faculdade, cursando), renda convertendo reais para faixa de salarios. matchEstadoCivilId ja existia e foi reusado. Board: filtro por etapa com contagem, ThOrdenavel com 3 estados por coluna, e CPF completo (272 registros corrigidos no banco). 54 testes.",
      motivation: "A descricao da CAD tinha profissao, renda, estado civil, escolaridade e o conjuge inteiro, e estava sendo ignorada — enquanto o plano era pagar enriquecimento (R$ 1,06 por CPF, R$ 292 nos 275) para descobrir parte do mesmo. O Lucas apontou tambem que a profissao do Asana e escrita livre e a do C2X e lista fechada, o que exigia a ponte entre as duas.",
    },
    title: "Apolo: importacao le o formulario completo da CAD",
    type: "novidade",
    version: "1.49.0",
  },
  {
    buildTag: "2026-07-20-apolo-board-etapa-telefone",
    deployedAt: "2026-07-20T10:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "As 122 CADs voltaram a aparecer na coluna Analise de credito.",
              "O telefone voltou a aparecer na ficha de validacao: quase todas mostravam um traco mesmo com o numero salvo.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.48.1",
    technical: {
      done: "A rota do Board lia esteira?.etapa da tabela nova em quase tudo, menos na propria linha da etapa, que continuava em row.metadata.esteira.etapa — vazio para as entidades vindas do C2X. Varredura confirmou que nao sobrou nenhuma outra leitura do metadata. A ficha de validacao passou a aceitar contact_type 'whatsapp' alem de 'phone'.",
      motivation: "O Board mostrava 275 itens em Validacao e zero em Analise de credito, com o banco tendo 153 e 122 corretos. E o telefone aparecia vazio em 94% das fichas: o C2X grava 4.064 contatos como 'whatsapp' e so 248 como 'phone', mas a ficha procurava apenas por 'phone'.",
    },
    title: "Apolo: etapa e telefone na ficha de validacao",
    type: "correcao",
    version: "1.48.2",
  },
  {
    buildTag: "2026-07-20-apolo-esteira-tabela",
    deployedAt: "2026-07-20T09:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A etapa de cada CAD parou de sumir sozinha: ela saiu do cadastro da pessoa e ganhou lugar proprio, fora do alcance da sincronizacao com o C2X.",
              "As 122 CADs que sumiram da coluna Analise de credito voltaram.",
              "Os documentos anexados voltaram a aparecer na tela de validacao.",
              "A ficha agora nasce com o que foi lido do documento: nome, nascimento, RG, orgao emissor e filiacao — antes so o CPF era aproveitado.",
              "Reimportar deixou de rebaixar quem ja avancou na esteira e de trocar o analista de quem ja estava cuidando do caso.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.48.0",
    technical: {
      done: "Migration 0057 cria apolo_esteira (entity_id PK) e migra o que restava em metadata.esteira; a rota do Board le dela e a importacao escreve nela. Correcao de dados: 122 entidades do Finalizado restauradas para credito, e 150 fichas preenchidas a partir do que ja estava salvo em apolo_ocr_reads (custo zero). extrairCadastro/mesclarCadastros aproveitam a extracao inteira e o nome do documento ganha do titulo da task. etapaMaisAvancada impede rebaixamento (6 testes). Board passou a ler { documents } na raiz: lia data.documents numa rota que nao tem envelope, entao a validacao NUNCA exibiu documento.",
      motivation: "As 122 CADs perderam etapa e analista as 02:56, muito depois da importacao: o sync do C2X monta a entidade com metadata proprio e faz upsert, SUBSTITUINDO o metadata inteiro. Guardar a esteira ali significava perde-la a cada rodada do sync. A correcao mais segura foi tabela separada, sem tocar no caminho que sincroniza ~4 mil entidades do legado.",
    },
    title: "Apolo: esteira em tabela propria, imune ao sync do C2X",
    type: "correcao",
    version: "1.48.1",
  },
  {
    buildTag: "2026-07-20-apolo-ler-cads",
    deployedAt: "2026-07-20T08:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova aba Ler documentos: cria os cadastros das CADs que ainda nao existem no Apolo, lendo o documento anexado.",
              "Antes de qualquer coisa ela mostra o CUSTO em reais e so libera o botao depois que voce confirma que entende que a consulta e cobrada.",
              "Enquanto roda, mostra o gasto real acontecendo — que costuma ficar abaixo do orcado.",
              "Economias automaticas: CAD com CPF ja escrito no texto nao gasta consulta, planilha e zip nao sao enviados, e documento ja lido antes nao e cobrado de novo.",
              "Cada cadastro criado entra em Validacao com os documentos ao lado, para o operador conferir e completar o que faltou.",
              "CAD sem CPF legivel aparece numa lista de pendencias para cadastro manual.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.47.0",
    technical: {
      done: "Migration 0056 (apolo_ocr_reads) com file_sha256 unico: registro das leituras pagas, chave pelo HASH DO BYTE. lib/apolo/asana-ocr.ts com orcarLeitura (gratis) e lerDocumentosDoLote (pago, lotes de 5). Rota /api/apolo/asana/leitura: GET orca, POST exige confirmado e orquestra ler -> criarEntidadesDoLote -> aplicarVinculos (etapa validacao) -> trazerDocumentosDoLote. criarEntidadesDoLote faz dedup por document_hash NO CODIGO, porque a migration 0026 dropou o indice unico e createApoloEntity insere cego. cpfValido valida digito verificador (createApoloEntity so conta 11 digitos). Rotacao automatica de imagem DESLIGADA: no wizard ela reenvia em [0,90,270,180] e custaria ate 4x pelo mesmo arquivo. 12 testes nas funcoes que decidem custo e o que entra como CPF.",
      motivation: "As secoes que faltam nao tem cadastro no Apolo: o CPF so existe dentro do documento anexado, e ler custa R$ 0,506 por imagem. Como nao havia log, cache nem dedup de consultas, reimportar pagaria tudo de novo — e ja se sabia de CAD repetida (5 pessoas com 2 CADs), que significa o mesmo documento cobrado duas vezes.",
    },
    title: "Apolo: ler documentos das CADs e criar os cadastros",
    type: "novidade",
    version: "1.48.0",
  },
  {
    buildTag: "2026-07-20-apolo-documentos-asana",
    deployedAt: "2026-07-20T07:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Os documentos anexados nas CADs do Asana agora podem ser trazidos para a ficha no Apolo, com barra de progresso.",
              "E o arquivo que a validacao do Board mostra ao lado dos dados, para conferir cadastro contra documento.",
              "Enviar de novo nao duplica: cada arquivo ja trazido e reconhecido e pulado.",
              "A tela passou a explicar a conta de CADs e pessoas, porque a mesma pessoa pode ter mais de uma CAD no Asana.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.46.5",
    technical: {
      done: "lib/apolo/asana-documentos.ts baixa o anexo pelo download_url (link assinado do Asana, sem mandar o token para host de terceiro) e sobe via uploadApoloDocument para o bucket apolo-documents, ligado a entidade. uploadApoloDocument ganhou metadataExtra, usado para gravar asanaAnexoGid — a chave de dedup. A entidade sai do vinculo em apolo_source_links, nao de casamento por nome. Rota /api/apolo/asana/documentos processa lotes de ate 10 CADs (maxDuration 300) e a tela itera somando o progresso. Concorrencia de 4 downloads, mesmo numero ja usado no relatorio de performance do Asana; teto de 15MB por arquivo.",
      motivation: "A validacao lado a lado do Board precisa do documento, e ate agora as CADs importadas tinham so os dados. Isto NAO passa pela MOST: baixar e guardar nao tem custo de consulta, diferente da leitura por iOCR, que fica como etapa separada.",
    },
    title: "Apolo: documentos das CADs do Asana no Board",
    type: "novidade",
    version: "1.47.0",
  },
  {
    buildTag: "2026-07-20-apolo-cad-etapa-data",
    deployedAt: "2026-07-20T06:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Da para escolher em que etapa as CADs entram: o padrao passou a ser Analise de credito, porque elas ainda precisam passar pelo Serasa.",
              "Nomes com erro de digitacao ganharam a lista Quase casaram: mostra o nome no Asana e no Apolo lado a lado para voce confirmar qual e.",
              "A data de chegada passou a ser a da CAD no Asana. Antes vinha da criacao do cadastro no Apolo, que para a maioria era o mesmo segundo do sync do C2X.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.46.4",
    technical: {
      done: "Sugestao por distancia de edicao (Levenshtein) com indice por primeiro nome, limiar 0,86, exposta como lista quaseCasados que NUNCA aplica sozinha. Etapa da importacao virou parametro (validacao/credito/credenciado, padrao credito) com seletor na barra de confirmacao. A data de criacao da task do Asana e gravada em metadata.esteira.chegouEm e a rota do Board usa ela no lugar do created_at da entidade. 14 testes, incluindo os tres erros de digitacao reais como regressao.",
      motivation: "Tres CADs nao casaram por uma letra (Cristiana/Cristina, Higno/Higino, Feliphe/Felipe) e corrigir a mao resolveria hoje e voltaria na proxima importacao. A data de chegada estava errada: vinha do created_at da entidade, e 100 das 121 tinham o mesmo horario porque foram criadas em lote pelo sync do C2X — o que ainda ordenava a fila errado.",
    },
    title: "Apolo: etapa na importacao, sugestao de nome parecido e data de chegada correta",
    type: "correcao",
    version: "1.46.5",
  },
  {
    buildTag: "2026-07-20-apolo-cad-analista",
    deployedAt: "2026-07-20T05:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Da para escolher o analista responsavel na hora de importar: ele ja vem preenchido com quem esta logado.",
              "O analista de cada item passou a ser lido do banco no Board, em vez de sumir a cada carregamento.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.46.3",
    technical: {
      done: "aplicarVinculos grava analistaId em metadata.esteira; a rota de importacao devolve a lista de hub_users ativos e o id de quem esta logado, e a tela traz um seletor na barra de confirmacao. A rota do Board projeta analistaId e o board-view semeia analistaPorItem na carga, preservando o que o operador mexeu na sessao.",
      motivation: "Os itens importados entravam todos como 'Sem analista' e alguem teria que atribuir um a um. O analistaPorItem era mais um estado local que nao persistia — mesmo padrao da etapa.",
    },
    title: "Apolo: analista responsavel na importacao das CADs",
    type: "correcao",
    version: "1.46.4",
  },
  {
    buildTag: "2026-07-20-apolo-cad-empreendimento",
    deployedAt: "2026-07-20T04:15:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "As CADs importadas passam a guardar o empreendimento, a imobiliaria e o corretor da ficha do Asana.",
              "No Board, a coluna Empreendimento deixa de aparecer vazia para quem veio da importacao, e a imobiliaria aparece embaixo do nome.",
              "A lista Ja importados virou selecionavel: marcar ali nao duplica, so completa os dados de uma importacao anterior.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.46.2",
    technical: {
      done: "aplicarVinculos passou a gravar empreendimento, imobiliaria e corretor em metadata.esteira, e a ATUALIZAR os dados mesmo quando o vinculo ja existe (o insert em apolo_source_links continua sendo a trava de duplicacao: no 23505 o link nao repete mas o metadata e reescrito). A rota do Board usa o empreendimento do cadastro quando existe e cai para o da esteira quando nao — cadastro antigo nao tem metadata.cadastro. A tela envia os dados da CAD junto e permite marcar os ja importados para reaplicar.",
      motivation: "Depois da importacao das 121 CADs a coluna Empreendimento ficou vazia: eu tinha o dado em maos durante a importacao (era o proprio filtro da busca) e nao gravei na entidade. Sem poder reaplicar nos ja importados, a unica saida seria mexer no banco a mao.",
    },
    title: "Apolo: CAD importada leva empreendimento, imobiliaria e corretor",
    type: "correcao",
    version: "1.46.3",
  },
  {
    buildTag: "2026-07-20-apolo-board-etapa-persistida",
    deployedAt: "2026-07-20T03:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "As CADs importadas do Asana agora aparecem na coluna Credenciado, como deviam.",
              "A etapa de cada item passou a vir do banco: antes ela existia so na tela e voltava para Validacao a cada carregamento.",
            ],
            screen: "Board",
          },
        ],
      },
    ],
    rollback: "1.46.1",
    technical: {
      done: "A rota do Board passou a buscar em duas frentes e deduplicar: a fila normal (status review + source apolo) e quem tem metadata.esteira preenchido. Sem a segunda, as CADs importadas ficavam de fora: sao cadastros antigos, com status 'active' e sem source. O item devolvido ganhou o campo etapa (metadata.esteira.etapa) e o board-view semeia o progresso a partir dele, preservando o que o operador moveu na sessao (INDICE_POR_ETAPA faz a ponte texto->indice de ETAPAS_CAD).",
      motivation: "A importacao das CADs gravou 124 vinculos e 121 entidades marcadas como credenciado, mas o Board continuava vazio: a escrita da etapa tinha sido implementada e a leitura nao. O progresso era useState local, e o filtro da fila excluia justamente as entidades importadas.",
    },
    title: "Apolo: Board passou a ler a etapa salva no banco",
    type: "correcao",
    version: "1.46.2",
  },
  {
    buildTag: "2026-07-20-apolo-importar-cads-concluidas",
    deployedAt: "2026-07-20T02:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A busca de CADs deixou de ignorar as tarefas concluidas no Asana, que era o caso de toda a secao Finalizado.",
              "Quando a busca nao encontra nada, a tela passa a mostrar o motivo: as secoes com a contagem de CADs e os valores de empreendimento que existem de verdade, clicaveis.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.46.0",
    technical: {
      done: "escanearCads e sondarCadsNoAsana pararam de filtrar task.completed. escanearCads passou a devolver diagnostico { porSecao, valoresEmpreendimento, descartadasPorEmpreendimento } e a tela mostra os valores como botoes que preenchem o filtro, mais a opcao de buscar sem filtro de empreendimento.",
      motivation: "A busca em Finalizado voltava sempre zero: as tasks daquela secao estao marcadas como concluidas no Asana e o codigo descartava toda task completed — contradicao com o proprio recorte. Sem o diagnostico, a tela pedia para conferir a grafia sem dizer qual era o valor certo.",
    },
    title: "Apolo: importacao deixava de fora as CADs concluidas",
    type: "correcao",
    version: "1.46.1",
  },
  {
    buildTag: "2026-07-20-apolo-importar-cads-finalizado",
    deployedAt: "2026-07-20T01:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Importar CADs agora traz de verdade: busca as CADs de um empreendimento no Asana e compara com os cadastros do Apolo.",
              "O resultado vem em quatro listas: casaram, ambiguos, sem cadastro e ja importados.",
              "As que casaram vem marcadas e podem ser desmarcadas; nos ambiguos voce escolhe qual cadastro e o certo.",
              "Nada e gravado ate voce clicar em Importar, e o botao mostra quantas serao afetadas.",
              "Rodar a importacao de novo nao duplica: cada CAD fica vinculada a sua tarefa no Asana.",
              "Este primeiro lote nao le nenhum documento, entao nao tem custo de consulta.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.45.0",
    technical: {
      done: "lib/apolo/asana-import.ts: escanearCads pagina o projeto do Asana e filtra por empreendimento e secao; casarComApolo indexa apolo_entities por nome normalizado (acento, caixa, espaco, pontuacao) e separa em casados/ambiguos/naoCasados/jaImportados; aplicarVinculos grava apolo_source_links (unique source_system+source_table+source_id = trava de reimportacao) e a etapa em metadata.esteira. Rota /api/apolo/asana/importar (GET preview read-only, POST exige confirmado e a lista explicita de itens). authorizeApoloWrite novo: escrita exclui o papel viewer. 10 testes na normalizacao de nome e no mapa de secoes.",
      motivation: "Primeiro lote da migracao das CADs do Asana, escolhido pelo Lucas: a secao Finalizado do Vale do Ouro ja tem cadastro no Apolo, entao casa por nome e marca como credenciado sem gastar iOCR (R$ 0,506 por imagem). Serve de ensaio da mecanica antes das secoes que exigem leitura paga. A etapa nao precisou de migration: apolo_entities.metadata e jsonb livre e o Board ja le de la.",
    },
    title: "Apolo: importar as CADs finalizadas do Asana",
    type: "novidade",
    version: "1.46.0",
  },
  {
    buildTag: "2026-07-19-apolo-importar-cads-sondagem",
    deployedAt: "2026-07-20T00:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova tela Importar CADs: mostra o que existe na central de CAD do Asana antes de trazer qualquer coisa.",
              "Lista as secoes com a quantidade de CADs em cada uma e os tipos de arquivo anexados.",
              "Mostra todos os campos preenchidos nas CADs, com exemplos, e destaca se existe campo de CPF.",
              "Etapa de leitura apenas: nada e criado no Apolo e nenhum documento e lido nesta tela.",
            ],
            screen: "Importar CADs",
          },
        ],
      },
    ],
    rollback: "1.44.2",
    technical: {
      done: "sondarCadsNoAsana estendida: alem de secoes e anexos, monta o catalogo de custom fields do projeto (nome, quantos preenchidos, ate 3 valores distintos) e uma amostra de tasks com gid e campos. Nova tela apolo/blocks/importacao consumindo /api/apolo/asana/cads, entrada 'importacao' no catalogo do Apolo. Read-only: sem escrita e sem iOCR.",
      motivation: "Dois bloqueios apareceram ao montar a importacao das CADs: createApoloEntity exige CPF/CNPJ valido (se as CADs nao trouxerem documento em campo, ele teria que sair dos anexos por iOCR, que e consulta cobrada na MOST) e o Board nao persiste etapa alguma (a fila e derivada de apolo_entities com status review, entao Finalizado->Credenciado nao tem onde ser gravado). O token do Asana so existe em producao, entao sem uma tela nao havia como enxergar os dados para decidir o mapeamento e o custo.",
    },
    title: "Apolo: sondagem das CADs do Asana",
    type: "novidade",
    version: "1.45.0",
  },
  {
    buildTag: "2026-07-19-prometeu-central-telacheia",
    deployedAt: "2026-07-19T23:30:00-03:00",
    // Correcao: entra na versao e na aba Deploy do Zeus, mas fora do painel de Novidades
    // (regra do Lucas 20/jul — o time so quer ver o que e novidade de verdade).
    internal: true,
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "Tela cheia na Central: some o menu e fica so o painel, para acompanhar de longe no dia.",
              "Escala da tela em tres opcoes: notebook, monitor e TV (informando as polegadas). A escolha fica salva.",
              "Sala Cancelados voltou ao Mapa do salao, e a Secretaria ganhou a faixa com aguardando chamada, espera media e atendimento medio.",
              "Numeros corrigidos: Aguardando na espera contava quem ainda nem tinha chegado ao evento.",
              "Presentes agora deixou de somar quem ja concluiu ou desistiu.",
              "Tempo medio total parou de crescer sozinho com o relogio: agora mede da entrada ate a conclusao de verdade.",
              "Fila da recepcao deixou de mostrar quem ja foi atendido.",
              "Falha de conexao nao aparece mais como Nenhum lancamento cadastrado, e busca sem resultado nao diz mais que o evento esta vazio.",
            ],
            screen: "Central",
          },
        ],
      },
    ],
    rollback: "1.44.1",
    technical: {
      done: "Tela cheia via requestFullscreen no container da Central (nao no documento, para a TV mostrar so o painel) com listener de fullscreenchange. Escala por zoom no container, presets 1 / 1.28 / TV pela formula calibrada 0.0175*pol+0.72, persistida em localStorage. Correcoes de calculo: porEtapa passa a exigir entrouEm (recepcao e o estado padrao de quem so esta habilitado); presentes exclui concluido e cancelado; tempo medio usa etapaDesde do concluido em vez do relogio; conversao sobre quem passou pelo evento; filaDaRecepcao exclui concluido e cancelado. Limite de gargalo unificado entre Painel e Mapa. Dois testes novos na fila (17 no total).",
      motivation: "Revisao adversarial da Central (34 agentes, 30 achados, 21 confirmados) apontou que a aba Painel contava quem nunca tinha chegado ao evento — mostraria centenas aguardando com o salao vazio — e que o tempo medio inflava sozinho ao longo do dia. O Lucas pediu o modo tela cheia, que faltava do mockup aprovado.",
    },
    title: "Prometeu: tela cheia, escala por tela e correcao dos numeros da Central",
    type: "correcao",
    version: "1.44.2",
  },
  {
    buildTag: "2026-07-19-prometeu-central-completa",
    deployedAt: "2026-07-19T21:00:00-03:00",
    internal: true,
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "As abas Painel e Mapa do salao voltaram: a versao anterior tinha so a parte de lista e kanban.",
              "Painel: mapa da jornada por zona (recepcao, salao, secretaria e cancelados), com destaque automatico de gargalo quando a espera passa do limite.",
              "Painel: fila da recepcao, funil de unidades, ultimas chamadas e atividade ao vivo, todos com dados do evento.",
              "Mapa do salao: ocupacao de cada area e as mesas da secretaria coloridas por estado (livre, ocupada, em atendimento).",
              "Analitico: busca e Ver por cliente, imobiliaria ou unidade; Lista e Kanban voltaram a ser sub-abas daqui.",
            ],
            screen: "Central",
          },
        ],
      },
    ],
    rollback: "1.44.0",
    technical: {
      done: "Central reescrita seguindo a estrutura do mockup aprovado (public/prometeu/cockpit.html): KPIs no topo e abas Painel / Mapa do salao / Analitico, com Lista e Kanban como sub-abas do Analitico. Rotas de leitura estendidas com listChamadasRecentes e listAtividadeRecente. Onde nao ha fonte real o valor aparece como travessao em vez de numero inventado: o valor em R$ do funil depende das unidades no C2X, ainda nao ligadas ao evento.",
      motivation: "Regressao introduzida na v1.44.0: ao trocar o mockup pela tela React foi portada apenas a aba Analitico, e Painel e Mapa do salao sumiram sem aviso. O Lucas percebeu a falta ao abrir o modulo em producao.",
    },
    title: "Prometeu: Painel e Mapa do salao de volta na Central",
    type: "correcao",
    version: "1.44.1",
  },
  {
    buildTag: "2026-07-19-prometeu-modulo-real",
    deployedAt: "2026-07-19T18:00:00-03:00",
    modules: [
      {
        module: "Prometeu",
        screens: [
          {
            items: [
              "O Setup agora salva de verdade: empreendimento (puxado dos ativos do Apolo), construtora, local, mesas da secretaria e as metas de tempo.",
              "As mesas da secretaria sao criadas junto, numeradas, quando voce salva.",
              "Janelas de credenciamento por dia: e o horario que decide como a fila do dia se organiza.",
              "Botao Ativar lancamento libera a fase de preparacao (subir CAD, imprimir etiqueta, montar a fila).",
              "Botao Iniciar evento real zera o que veio dos testes e comeca o dia limpo, preservando os credenciados, a fila e as etiquetas ja impressas.",
              "Encerrar o dia fecha a operacao: quem concluiu fica para a analise de desempenho, quem parou no meio sai da fila (e continua no historico).",
            ],
            screen: "Setup",
          },
          {
            items: [
              "A Central deixou de ser demonstracao e passou a ler os dados reais do lancamento.",
              "Kanban por etapa e visao em lista, com quanto tempo cada pessoa esta no evento e no estagio atual.",
              "Nova aba Recepcao: a ordem de chamada do dia, mostrando em cada pessoa por que ela esta naquela posicao.",
              "A fila nasce da hora do pagamento do PIX; quem for credenciado depois do horario entra por ordem de chegada.",
            ],
            screen: "Central",
          },
        ],
      },
    ],
    rollback: "1.43.0",
    technical: {
      done: "Migrations 0053/0054/0055 (prometeu_eventos, credenciados, unidades, mesas, chamadas, movimentacoes, janelas_credenciamento) com RLS. Camada lib/prometeu (types/data/auth) + rotas /api/prometeu/{eventos,eventos/status,fila,credenciados,janelas,empreendimentos}. Telas Central e Setup em React substituindo os mockups HTML. Ordem da fila por chave numerica (ordem_fila) derivando a posicao na leitura, permitindo ajuste manual do admin sem recalculo em massa. Acoes irreversiveis (reset e encerramento) restritas ao dono do evento por e-mail verificado no token, e reset bloqueado em definitivo apos o inicio. 15 testes cobrindo as regras da fila, o fuso de Brasilia e a trava do reset.",
      motivation: "O Prometeu era 100% mockup e o lancamento acontece em ~2 semanas. Passou a ter banco e telas reais. Revisao adversarial antes do deploy encontrou 28 defeitos confirmados; os tres graves (reset forcavel no meio do evento, regra da fila implementada mas desconectada da tela, e limpeza que falhava em silencio marcando o evento como iniciado) foram corrigidos antes de subir.",
    },
    title: "Prometeu: modulo real do dia do lancamento",
    type: "novidade",
    version: "1.44.0",
  },
  {
    buildTag: "2026-07-19-apolo-credenciamento-board",
    deployedAt: "2026-07-19T12:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Novo cadastro de Imobiliaria: mesmo fluxo do PJ, com CRECI Juridico, empreendimentos vinculados e uma etapa para os corretores (nome, CPF, telefone, e-mail e CRECI).",
              "O CRECI do corretor e buscado sozinho quando o CPF fica completo; se nao vier, o campo continua editavel.",
              "E-mail passou a ser obrigatorio e unico em socios e corretores — ele sera a credencial de acesso.",
              "Na Revisao da ficha da um clique para voltar e corrigir qualquer etapa.",
            ],
            screen: "Cadastro",
          },
          {
            items: [
              "Portal de credenciamento para as imobiliarias: escolhe os empreendimentos (com as logos), informa o CNPJ e, se ja for cadastrada, pede habilitacao so nos que faltam.",
              "CNPJ nao encontrado nao joga direto para o cadastro: da para conferir e tentar de novo.",
            ],
            screen: "Credenciamento",
          },
          {
            items: [
              "Nova tela Board: fila de validacao das imobiliarias e das CADs, em lista ou kanban.",
              "Na validacao, os dados do cadastro aparecem lado a lado com os documentos originais, com zoom para conferir.",
              "Cada tipo tem o seu funil: a CAD passa por credito e pre-venda; a imobiliaria vai de Validacao a Habilitada.",
              "Chat interno e historico do processo em um popup, com registro desde a chegada.",
              "Recusar ou mandar para correcao agora exige o motivo, que fica no historico.",
            ],
            screen: "Board",
          },
          {
            items: [
              "No cadastro do empreendimento da para enviar a logo e marcar se ele esta recebendo credenciamento.",
              "So os empreendimentos ativos aparecem para as imobiliarias.",
            ],
            screen: "Empreendimento",
          },
          {
            items: ["Botao para limpar os filtros da busca."],
            screen: "CRM 360",
          },
        ],
      },
    ],
    rollback: "1.42.0 (2026-07-17-iris-mencao-nos-grupos)",
    technical: {
      done:
        "Apolo/cadastro: tipo 'imobiliaria' habilitado em cadastro-tipos + page lendo ?tipo -> prop no CadastroFlow (persona pj forcada, steps proprios, role dinamico no salvar). Empresa.creci, CorretorCadastro, MultiSelectField (empreendimentos ativos), StepCorretores com auto-busca de CRECI (query CARELI_PF_04) e e-mail unico; socios passam a exigir e-mail. cad-pdf: titulo dinamico e vinculo so quando existe. cadastro-persist: corretores -> relationship 'corretor' (contato) e empreendimentos -> 'empreendimento' (trabalho); ENABLED_ROLES += imobiliaria. mostqi: EnrichmentResult.creci + extractCreci (class_organization). " +
        "Empreendimento: enterprise-logos.ts (bucket apolo-documents, prefixo enterprise-logos/{id}, signed URL) + enterprise-settings.ts (credenciamento_ativo) + rotas logo/settings; migration 0052_apolo_enterprise_settings ja aplicada em producao. " +
        "Credenciamento: /apolo/credenciamento + lib/apolo/credenciamento.ts (ativos com logo; consulta CNPJ casa vendas do C2X via vinculed_by_id UNIAO relationships do Apolo). " +
        "Board: tela dentro do Apolo (apoloScreens + ApoloPage), rotas /api/apolo/board e /board/[id]; a fila filtra metadata.source='apolo' (sem isso vinham ~512 entidades do sync C2X). MOCKS REMOVIDOS do cadastro (LOCAL_MOCK + 10 funcoes): o localhost passa a ler documento de verdade — cada leitura vira consulta cobrada na MOST. " +
        "Asana: rota read-only /api/apolo/asana/cads (sondagem da central de CADs, sem custo).",
      motivation:
        "Abrir o canal externo de credenciamento das imobiliarias e montar a esteira interna que valida imobiliaria, corretores e CADs ate o credenciamento do cliente.",
    },
    title: "Apolo: credenciamento de imobiliarias e Board de validacao",
    type: "novidade",
    version: "1.43.0",
  },
  {
    buildTag: "2026-07-17-iris-mencao-nos-grupos",
    deployedAt: "2026-07-17T15:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Menção com @ nos grupos: digite @ no campo de mensagem e escolha um participante (ou @todos). A pessoa é notificada de verdade no WhatsApp — não é só um texto.",
              "Quem já mandou mensagem no grupo aparece com o nome; quem nunca falou aparece pelo número (o WhatsApp não entrega o nome na lista) e o nome vai aparecendo conforme a pessoa fala.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "commit e1a9d59e (v1.41.1)",
    technical: {
      done: "Grupo tem que funcionar como grupo: @ pra mencionar. migration 0051: caredesk_whatsapp_group_participants (group_id, phone, display_name, is_admin) + RLS. O WhatsApp so devolve NUMERO na lista de participantes; o nome vem do pushName de quem fala — por isso display_name e opcional e vai sendo preenchido: cada msg de grupo faz upsert do participante (rememberGroupParticipant) e a criacao do grupo semeia via findGroupInfos (seedGroupParticipants). Rota POST /api/iris/group-participants-backfill (sessao) semeia os 17 grupos ja monitorados, reentrante. NOTIFICACAO REAL: nao basta escrever @fulano — a msg tem que sair com `mentioned`/`mentionsEveryOne`, senao vira texto morto. sendEvolutionGroupText/Media ganham mentions; /api/iris/group-messages aceita { everyone } (@todos) e { phones } (so em grupo; no direct nao aplica). UI: IrisMentionPicker no composer (participantes filtrados + @todos), inserindo @Nome e guardando o telefone; no envio, buildMentionsFromDraft monta os mentioned a partir do que ainda esta escrito. participantsByGroup viaja no metadata da conversa.",
      motivation:
        "Lucas: 'tem que ter a opcao de mencao, o famoso @'. E: 'tem que funcionar como se fosse um grupo de WhatsApp normal mesmo'.",
    },
    title: "Iris: menção @ nos grupos (participantes + @todos, notificando de verdade)",
    type: "novidade",
    version: "1.42.0",
  },
  {
    buildTag: "2026-07-17-iris-recupera-midia-antiga",
    deployedAt: "2026-07-17T11:15:00-03:00",
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Os áudios, imagens e PDFs recebidos nos grupos e no Direct ANTES de ontem à noite voltam a abrir (foram recuperados do WhatsApp).",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "commit 844d06c4 (v1.41.0)",
    technical: {
      done: "O time nao ouvia audios: as midias anteriores ao conserto do download (corte 16/jul ~23h, v1.41.0) nunca tiveram o binario baixado — o processador so gravava '[audio]'/'[documento]' e provider_payload.media ficava null, entao nao havia audioUrl pro player. A Evolution AINDA guarda os binarios (verificado chamando chat/getBase64FromMediaMessage num audio 'falhado'), entao da pra preencher retroativamente: 35 pendentes (19 imagem, 9 audio, 4 doc, 2 sticker, 1 video). POST /api/iris/media-backfill (sessao de operador; FORA de /api/iris/evolution porque o gate libera aquele prefixo por PREFIXO): varre as msgs evolution sem media, busca, sobe pro Storage (uploadInboundMediaBuffer) e grava provider_payload.media.{url,type,fileName,mimeType}; roda em lote (limit 10, max 25) e e reentrante. Tambem: persistInboundMedia falhava MUDO (retornava null sem log) — o que cegou o diagnostico; agora loga messageId/tipo/chat.",
      motivation:
        "Lucas: 'estamos com problema de ouvir os audios no grupo e direct'. Diagnostico: nao era o player nem o formato (ogg/opus abre e o arquivo e servido certo) — era midia antiga sem arquivo nenhum.",
    },
    title: "Iris: recupera as mídias antigas dos grupos/Direct (áudio, imagem, PDF)",
    type: "correcao",
    version: "1.41.1",
  },
  {
    buildTag: "2026-07-15-iris-niveis-de-acesso",
    deployedAt: "2026-07-15T23:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Níveis de acesso: cada fila agora é vinculada a departamento/setor e você só enxerga as filas da sua área. Operador e líder veem o seu setor; coordenador vê todo o seu departamento; admin vê tudo.",
              "PDF, imagem, áudio e arquivos recebidos nos grupos e no Direct agora ABREM (antes aparecia só o texto '[documento]' e não dava pra abrir).",
              "Marcação de pendência corrigida: mensagem de alguém de fora marca a conversa como não-lida e Pendente; assim que a gente responde pela Iris, ela sai de pendente.",
            ],
            screen: "Atendimento e Setup",
          },
        ],
      },
    ],
    rollback: "commit 1e756c62 (v1.40.0)",
    technical: {
      done: "ACESSO: migration 0050 cria caredesk_queue_scopes (queue_id, department_id, sector_id; sector_id NULL = departamento inteiro) + unique parciais + RLS (leitura autenticado / escrita operador-lider-admin). E N:N porque Grupo/Direct pertencem a DOIS departamentos (Operacao+Relacao). Reaproveita o que ja existia: hub_departments/hub_sectors/hub_user_assignments/operational_profile (op1..adm). lib/hub/access-scope.ts = regua pura (canSeeResource), reusavel por Apolo/Hades. loadIrisData resolve o escopo do usuario logado (perfil + assignments ativos, somando todos) e filtra FILAS, TICKETS e GRUPOS. Setup>Filas ganhou editor de vinculos. Vinculos semeados: Atendimento/Gurgel/Suporte/Juridico->Operacao (dep. inteiro, pois o setor Atendimento nao tem ninguem alocado), Cobranca->Op-Cobranca, Contrato->Op-Contrato, Financeiro->Adm-Financeiro, Grupo/Direct->Operacao+Relacao; Comunicados arquivada. MIDIA: o processador Evolution nunca BAIXAVA o arquivo (o messages.upsert so traz a referencia) — agora busca via chat/getBase64FromMediaMessage, sobe pro Storage e grava provider_payload.media.{url,type,fileName}. PENDENCIA: loadGroupConversations tinha unread:false e status:'open' FIXOS (grupo nunca marcava e ficava eterno Pendente); agora status=waiting_customer quando a ultima e nossa. No Direct, o update de status so rodava na 1a resposta.",
      motivation:
        "Lucas: 'vamos precisar criar niveis de acesso na Iris, vincular as filas a setores e departamentos' + reclamacao do time: nao abriam PDF/PNG e a marcacao de novas mensagens/pendente nao funcionava.",
    },
    title: "Iris: níveis de acesso por setor + PDF/arquivos abrindo + pendência correta",
    type: "novidade",
    version: "1.41.0",
  },
  {
    buildTag: "2026-07-15-apolo-crm360",
    deployedAt: "2026-07-15T22:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Carteira agora se adapta ao papel: incorporador, imobiliária, corretor e comprador — cada um vê a carteira do seu ponto de vista.",
              "Navegação em camadas (empreendimento → imobiliária → comprador) com adimplente/inadimplente por cliente; ao clicar no comprador abre a ficha dele.",
            ],
            screen: "Carteira",
          },
          {
            items: [
              "O Financeiro de imobiliária/incorporador/corretor vira o Extrato por participante — o split dos pagamentos pagos, batendo com o relatório do Asaas.",
              "Traz unidade, tipo/parcela/competência, o valor real do split e o comprovante da cobrança no Asaas.",
              "Busca livre + filtros de período/empreendimento/tipo, ordenação clicando na coluna e cabeçalho fixo ao rolar.",
            ],
            screen: "Financeiro",
          },
          {
            items: [
              "Nova aba Histórico: a ficha corrida da entidade — reúne num lugar só venda, pagamento, atendimento (Iris), negociação (Hades) e reunião (Chronos).",
              "Linha do tempo agrupada por dia, com ícone e cor por tipo; hora real quando a fonte tem.",
              "Botão Registrar pra lançar manualmente uma ação que o hub não capturou (ligação, visita, nota…).",
            ],
            screen: "Histórico",
          },
          {
            items: [
              "Correção: a tela de Empreendimentos às vezes não carregava (ficava no esqueleto) — resolvido.",
              "Navegação entre fichas: o botão voltar retorna pra aba de onde você saiu; lista de entidades pode ser recolhida pra ganhar tela.",
            ],
            screen: "Empreendimentos e navegação",
          },
        ],
      },
    ],
    rollback: "commit 40100d11 (v1.39.0)",
    technical: {
      done: "CRM 360 (Apolo), leitura sobre C2X (read-only) + Supabase. Carteira: lib/apolo/carteira.ts loadApoloCarteiraScoped por papel (filterByKind: comprador=client_id, imobiliaria=vinculed_by_id, incorporador=incorporador_id, corretor=corretores_enterprises — acquisition_requests.corretor_id e sempre nulo); drill-down navegavel no ScopedPortfolioPanel; isApoloTabUnavailableForEntity liberado por papel. Extrato: lib/apolo/extrato.ts usa split_data.fixedValue (valor REAL pago pelo Asaas, casado por perfil) em vez do calculo por percentual; numeracao por tipo (Ato/Sinal via signal_parcels, Parcela via total_parcels) + competencia (reference_date); rota /api/apolo/extrato; filtros/ordenacao client-side + sticky header. Historico: lib/apolo/timeline.ts agrega pagamentos+vendas(C2X: payments/acquisition_request_historics, todos os estagios), Iris(caredesk_tickets via caredesk_contacts.c2x_user_id∪email∪phone), Hades(guardian_compromissos.client_c2x_id), Chronos(chronos_participants.email) e manuais(apolo_timeline_events, metadata.source=manual); identidade multi-chave (c2xId∪emails∪phones, inclui contatos dos relacionamentos); hora real do pagamento via updated_at quando cai no mesmo dia (webhook Asaas), senao dateOnly; fuso America/Sao_Paulo; rota GET/POST /api/apolo/timeline (POST grava evento manual com autor=operador). Fix: carregamento de empreendimentos trocou ref-guard global por cancelamento por-execucao (race que travava no skeleton com fetch lento).",
      motivation:
        "Lucas fechou a tela CRM 360 do Apolo: carteira e financeiro POR PAPEL/participante (o Apolo e o centro, C2X e uma das fontes), e o Historico como ficha corrida que absorve TODOS os modulos do Panteon num lugar so (premissa: registrar tudo).",
    },
    title: "Apolo: CRM 360 — Carteira por papel, Extrato por participante e Histórico (ficha corrida)",
    type: "novidade",
    version: "1.40.0",
  },
  {
    buildTag: "2026-07-15-iris-relacionamento-direct",
    deployedAt: "2026-07-15T17:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Novo canal Relacionamento (número 6566) com duas filas: Grupo (o monitoramento dos grupos) e Direct (as conversas 1:1).",
              "Direct é atendimento normal — abre ticket, tem SLA, encerramento e transferência —, mas sem template pra iniciar e sem a janela de 24h (fala-se livremente a qualquer hora).",
              "Filtro da fila agora tem cor por canal: WhatsApp (verde), Grupo (âmbar), Direct (ciano) e E-mail (índigo), pra distinguir de bate-olho.",
              "As respostas que o time manda direto do celular do número de Relacionamento agora aparecem na conversa (antes eram ignoradas).",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "commit a49d4446 (v1.38.0)",
    technical: {
      done: "Estrutura (migration 0049): 'Relacionamento' vira o CANAL (slug whatsapp-grupo renomeado); a fila de grupos vira 'Grupo'; nova fila 'Direct' (slug relacionamento-direct). evolution-inbound-processor reescrito: @g.us->grupo (GRP-xxxx, sem ticket); @s.whatsapp.net->abre/reusa ticket na fila Direct (contato por telefone, SLA, source_entity_type whatsapp-direct); fromMe deixa de ser descartado e entra como SAÍDA (dedup por external_message_id cobre o eco dos envios via Iris). Saída: /api/iris/group-messages generalizada (resolve alvo grupo=group_jid/direct=telefone; dono group_id/ticket_id; grupo assina, direct vai limpo; texto/midia/audio/reacao; direct marca 1a resposta+waiting_customer). Cockpit: ticketIsDirect/ticketIsEvolution; direct = atendimento normal sem janela/template; canSendFreeForm nao exige janela; composer esconde a barra de 24h (isEvolutionChannel). UI: filtro de canal com chip Direct + cor por canal (icone sempre tingido + ativo preenchido); badge Direct (User ciano); isDirect na camada de dados; queueChipClasses direct=ciano. Board inclui grupos (fora das metricas) e direct (atendimento normal, conta metricas).",
      motivation:
        "Lucas: o numero 6566 (operacional, Evolution) precisa das 1:1 como atendimento de verdade (ticket/SLA/encerramento), mas sem template nem janela porque nao e Meta; e cor por canal pra ler a fila mais rapido.",
    },
    title: "Iris: canal Relacionamento com filas Grupo e Direct (1:1) + cor por canal",
    type: "novidade",
    version: "1.39.0",
  },
  {
    buildTag: "2026-07-15-iris-relacionamento",
    deployedAt: "2026-07-15T14:30:00-03:00",
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "A fila de grupos de WhatsApp passou a se chamar Relacionamento (fila, filtro, canal e ficha da conversa).",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "commit f7cea2ef (v1.36.x)",
    technical: {
      done: "Renomeacao APENAS de rotulo (Grupos/Grupo -> Relacionamento). Slugs internos (grupos-whatsapp, whatsapp-grupo), source_entity_type e isGroup INALTERADOS. migration 0048: caredesk_queues.name e caredesk_channels.name. Codigo: IRIS_INBOX_CHANNEL_FILTERS, badge tooltip, painel de contexto, channelLine, loadGroupConversations labels, queueChipClasses passa a casar 'relacionament' pra manter a cor ambar. Toasts de envio perderam o sufixo 'ao grupo'. Interno (bump de versao sem entrar no painel).",
      motivation:
        "Lucas: 'dentro da Iris em vez de chamar grupo, vai chamar Relacionamento'.",
    },
    title: "Iris: fila de grupos vira Relacionamento",
    type: "melhoria",
    version: "1.38.0",
  },
  {
    buildTag: "2026-07-15-apolo-comprador-fix",
    deployedAt: "2026-07-15T19:15:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Corrigido: clientes que compraram apareciam como Prospect (e o filtro Comprador vinha vazio). Agora Comprador e Prospect batem com a carteira.",
            ],
            screen: "CRM 360",
          },
        ],
      },
    ],
    rollback: "commit 30f66e27 (v1.37.0)",
    technical: {
      done: "Bug no marcador isBuyer (loadApoloDashboard): o id do cliente saía de String(hadesClientId).replace(/\\D/g,'') sobre 'c2x-client-<id>' — o '2' de 'c2x' entrava nos digitos ('c2x-client-3789' -> 23789), entao carteira.buyerClientIds.has() nunca casava e TODO comprador virava prospect (e o matchesApoloFilters do filtro Comprador derrubava todos). Fix: extrair os digitos FINAIS via /(\\d+)$/. Removidos os logs de diagnostico [apolo][carteira]/[apolo][buyer-filter].",
      motivation:
        "Lucas viu a Rejane (2 lotes faturados no Vista Alegre, na carteira) marcada como Prospect. Mesma causa do filtro Comprador vazio.",
    },
    title: "Apolo: corrige Comprador aparecendo como Prospect",
    type: "correcao",
    version: "1.37.1",
  },
  {
    buildTag: "2026-07-15-apolo-empreendimento-crm360",
    deployedAt: "2026-07-15T18:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova tela por empreendimento com abas: Resumo, Cadastro, Unidades, Vendas, Carteira e Relacionamentos.",
              "Vendas: funil por estagio em kanban com a movimentacao ao lado; o card mostra ha quanto tempo a unidade esta no estagio e, ao clicar, abre a proposta (plano comercial, parcelamento e historico).",
              "Carteira: visao por unidade com filtro e ordenacao, coluna Faturado, selo de cobranca (promessa/acordo/negociacao) e o contrato que abre na hora pela D4Sign.",
            ],
            screen: "Empreendimento",
          },
          {
            items: [
              "A ficha do cliente puxa os dados cadastrais direto do C2X, com os campos certos conforme o perfil (pessoa fisica x juridica).",
              "O cabecalho passa a mostrar Comprador ou Prospect e os papeis reais (imobiliaria, corretor...) no lugar do generico 'Usuario'.",
              "Relacionamentos: conjuge, representante legal e assinante aparecem como contato; a ficha da imobiliaria mostra os clientes vinculados a ela (compradores e prospects) e os empreendimentos onde ela vendeu.",
            ],
            screen: "CRM 360",
          },
        ],
      },
    ],
    rollback: "commit e7f86496 (v1.36.0)",
    technical: {
      done: "Deploy da branch feat/apolo-empreendimentos (merge da origin/main v1.36.0: dark mode + grupos da Iris; conflitos resolvidos: Chronos ficou com a versao de prod, Apolo com a reescrita funcional dark-aware). Tela de Empreendimento (Carteira/Vendas/Cobranca/Contrato) + CRM 360 com enricher read-time do C2X (fetchC2xCadastroByEntity em lib/apolo/server.ts: users+lookups+addresses+spouses+legal_representatives+signers+grafo da imobiliaria por vinculed_by_id). Carteira do C2X memoizada (loadC2xCarteiraData, TTL 60s) pra filtro/KPI/isBuyer saírem da mesma base. Tudo READ-ONLY sobre o C2X (fonte ate o go-live do Apolo).",
      motivation:
        "Colocar no ar a frente do Apolo (empreendimento + CRM 360 enriquecido) acumulada na branch. Filtro Comprador e validacao visual do dark mode ficam como pendencia pos-deploy (decisao do Lucas: subir o aprovado e validar depois).",
    },
    title: "Apolo: tela de Empreendimento + CRM 360 enriquecido pelo C2X",
    type: "novidade",
    version: "1.37.0",
  },
  {
    buildTag: "2026-07-14-iris-grupo-anexo-audio-reacao",
    deployedAt: "2026-07-14T16:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "No grupo de WhatsApp agora dá para enviar imagem, documento e áudio, além de reagir com emoji — antes só texto funcionava.",
              "Corrigido: reagir ou anexar num grupo dava o erro 'Informe o telefone WhatsApp em formato internacional'.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "commit f516f0af (v1.35.0)",
    technical: {
      done: "O envio ao grupo (v1.35.0) so cobria TEXTO; os outros 5 caminhos de saida do cockpit (reagir, audio, anexo, editar, reenviar) seguiam chamando /api/iris/meta/messages, que valida telefone — e grupo nao tem contactPhone (confirmado nos logs: 400 no meta/messages e ZERO chamadas em /api/iris/group-messages). Agora: evolution-api ganha sendEvolutionGroupMedia (sendMedia), sendEvolutionGroupAudio (sendWhatsAppAudio) e sendEvolutionGroupReaction (sendReaction — usa a chave do provedor: remoteJid do grupo + external_message_id + fromMe); postEvolutionMessage centraliza as chamadas. /api/iris/group-messages aceita media {dataUrl,fileName,mimeType,type} (sobe pro Storage via uploadIrisMediaBuffer; a conversa le provider_payload.media.{url,type,fileName}, igual ao Meta) e action 'react' (toggle em provider_payload.reactions; tirar = reacao vazia no WhatsApp). IrisPage: sendGroupRequest centraliza a saida do grupo. Editar e reenviar-local seguem sem suporte em grupo (avisam).",
      motivation:
        "Lucas tentou reagir a uma mensagem no grupo e recebeu erro de telefone. A causa: entreguei o envio ao grupo pela metade (so texto), e os demais caminhos caiam no Meta.",
    },
    title: "Iris: anexo, áudio e reação nos grupos de WhatsApp",
    type: "novidade",
    version: "1.36.0",
  },
  {
    buildTag: "2026-07-14-iris-grupos-sem-ticket",
    deployedAt: "2026-07-14T14:20:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Agora dá para RESPONDER no grupo de WhatsApp direto pela Iris. A mensagem sai assinada com o nome de quem escreveu.",
              "Grupo deixou de ser ticket: não tem mais encerramento, status nem SLA. Cada grupo tem um código próprio (GRP-0001) e a conversa é permanente.",
              "As mensagens do grupo aparecem ao vivo, sem precisar de F5.",
              "Indicadores do topo (SLA, 1ª resposta, TDR) não contam grupos — grupo não é atendimento.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "commit eaf0a699 (v1.34.2)",
    technical: {
      done: "REFACTOR: grupo sai da arquitetura de ticket. migration 0046: caredesk_messages.ticket_id vira nullable + coluna group_id (+ check: mensagem pertence a ticket OU grupo); caredesk_whatsapp_groups ganha codigo GRP-xxxx (sequence); tickets de grupo e contatos sinteticos apagados (mensagens movidas ao grupo ANTES — o FK ticket_id e ON DELETE CASCADE). migration 0047 CORRIGE a 0045, que habilitou RLS na tabela de grupos SEM policy: como loadIrisData roda no navegador, a tabela devolvia zero linhas e o grupo era invisivel. ENVIO: POST /api/iris/group-messages (sessao de operador; fica FORA de /api/iris/evolution porque o gate libera por prefixo) -> sendEvolutionGroupText (numero observador, membro do grupo), corpo assinado com signWhatsAppBody e salvo sem assinatura. loadGroupConversations monta cada grupo como conversa (formato IrisTicket, protocolo = GRP-xxxx). applyRealtimeMessageRow aceita ticket_id OU group_id. Board inclui grupos (unica porta de entrada do cockpit) mas o snapshot de metricas os exclui.",
      motivation:
        "Lucas, ao ver o grupo encerrado por engano: 'para os grupos, vamos tirar essa coisa de ticket, encerramento... podemos criar um ID para o grupo, pois la na frente, quando comecarmos a registrar as atividades, vamos precisar vincular a um ID que substituira o ticket'. O GRP-xxxx e a ancora: as ATIVIDADES detectadas no grupo (fase CACA) e que viram ticket, vinculadas ao grupo.",
    },
    title: "Iris: responder no grupo + grupo deixa de ser ticket (GRP-xxxx)",
    type: "novidade",
    version: "1.35.0",
  },
  {
    buildTag: "2026-07-14-dark-sidebars-hotfix",
    deployedAt: "2026-07-14T10:05:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A barra lateral (menu) ficou no grafite do tema, sem o tom azulado, e o botão de novo cadastro ganhou o dourado da marca.",
            ],
            screen: "Ajustes do tema escuro",
          },
        ],
      },
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "A barra lateral também passou pro grafite do tema.",
            ],
            screen: "Ajustes do tema escuro",
          },
        ],
      },
    ],
    rollback: "commit 20becf94 (v1.34.1)",
    technical: {
      done: "Hotfix visual do tema escuro pos-v1.34.1: (1) sidebars de Apolo e Chronos migradas da classe base .panteon-module-sidebar (azulada fixa #232832, nao segue tema) para .panteon-module-sidebar--themed (grafite neutro no escuro, clara no claro), espelhando o Hades — cores internas convertidas pra theme-aware (item ativo #171b23/#2A2B32->bg-black/[0.07] dark:bg-white/[0.08], textos->tokens, tile da marca->dourado bg-[#101211]/border-[#A07C3B], icone inativo->text-ink-muted). (2) Botao '+' de novo cadastro (apolo-shell): bg-inverse (virava caixa clara no escuro) -> bg-[#A07C3B] (dourado da marca). (3) Blocos <pre> do MOSTQI tester: bg-inverse+text-slate-100 (claro-sobre-claro invisivel no escuro) -> bg-[#101211] fixo. Deploy via worktree sobre origin/main v1.34.1 (patch so dos 4 arquivos do hotfix). Typecheck limpo. LICAO: a regra #101820->bg-inverse do script de conversao e certa pra botoes de texto (invertem), mas errada pra sidebar sempre-escura, botoes so-icone e code blocks — esses precisam de dark fixo.",
      motivation:
        "Fechar os pontos claros/azulados que sobraram no tema escuro do Apolo e Chronos apos a v1.34.1 (menu lateral, botao novo, blocos de codigo).",
    },
    title: "Ajustes do tema escuro em Apolo e Chronos (menu lateral, botões)",
    type: "correcao",
    version: "1.34.2",
  },
  {
    buildTag: "2026-07-14-apolo-chronos-setup-escuro",
    deployedAt: "2026-07-14T09:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O Apolo (CRM 360, ficha do cliente e cadastro) ganhou o tema escuro.",
            ],
            screen: "Tema escuro",
          },
        ],
      },
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "A agenda ficou no tema escuro, incluindo a grade do calendário (dia/semana/mês), os eventos e os detalhes ao clicar.",
            ],
            screen: "Tema escuro",
          },
        ],
      },
      {
        module: "Setup",
        screens: [
          {
            items: [
              "As telas de Setup (usuários, departamentos, setores, módulos, permissões) ganharam o tema escuro.",
            ],
            screen: "Tema escuro",
          },
        ],
      },
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "Nas telas de página cheia (como o Setup), o seu nome e os ícones do topo voltaram a ficar legíveis no tema escuro.",
            ],
            screen: "Ajuste da barra de topo",
          },
        ],
      },
    ],
    rollback: "commit 8269f848 (v1.34.0)",
    technical: {
      done: "Conversao dark de Apolo (modules/apolo), Chronos (modules/chronos, exceto as paginas standalone de video ChronosExternalRoomPage/RecordingViewPage) e Setup (app/setup/page.tsx) via script de receita (~1.950 subst. em 47 arquivos): neutros hex+slate->tokens, fundo de pagina->bg-canvas, enfase escura (#101820/#0d141c/#1f2937 +text-white)->bg-inverse+text-brand-ink, intents e gold escuro com dark:. Chronos FullCalendar: override dark dedicado no <style> do chronos-calendar-canvas (scope :root[data-uix-theme=dark]) — grade grafite, bordas #2b2e2c, texto claro, eventos azul translucido, aneis brancos entre eventos->escuros. hub-shell: PanteonTopbarUser da topbar WorkspaceLayout (L618) agora recebe onDark={mode===dark} (useHubTheme) — corrige nome/icones apagados no escuro nas paginas de pagina cheia. Deploy feito de worktree isolado (branch local estava em feat/iris-email-ui, 8 commits atras da main com WIP de outra sessao); patch so das minhas mudancas aplicado sobre origin/main v1.34.0. Typecheck limpo.",
      motivation:
        "Estender o tema claro/escuro ao Apolo, Chronos e Setup (estagio 3), fechando mais tres modulos. Restam Agenda (Meu dia), Ares/Atlas e Mobile.",
    },
    title: "Tema escuro no Apolo, Chronos e Setup",
    type: "melhoria",
    version: "1.34.1",
  },
  {
    buildTag: "2026-07-13-iris-fila-grupos-whatsapp",
    deployedAt: "2026-07-13T18:10:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Nova fila Grupos: os grupos de WhatsApp monitorados pela CACÁ aparecem na Iris como conversas (cada grupo é uma conversa, somente leitura).",
              "Cada mensagem do grupo mostra quem enviou (o participante), como no WhatsApp.",
              "Filtro por canal no topo da fila (Tudo / WhatsApp / Grupo / E-mail) para separar as conversas por tipo.",
              "Canal de grupo com identidade própria (cor âmbar) e sem a Janela de 24h do WhatsApp, que não se aplica a grupos.",
            ],
            screen: "Atendimento",
          },
        ],
      },
    ],
    rollback: "commit 513599f4 (v1.33.1)",
    technical: {
      done: "Gateway Evolution API (instancia caca-observadora, numero dedicado, read-only) num VPS Lightsail; webhook messages.upsert -> POST /api/iris/evolution (gate central liberado, segredo compartilhado IRIS_EVOLUTION_WEBHOOK_SECRET) -> evolution-inbound-processor: 1 grupo = 1 ticket na fila Grupos (canal whatsapp-grupo, provider evolution, isolado das resolucoes Meta), contato sintetico = o grupo, dedup por external_message_id. Migration 0045 (canal+fila+caredesk_whatsapp_groups). UI: isGroup na camada de dados (source_entity_type), filtro de canal em icones na fila, badge de grupo, remetente por mensagem (provider_payload.groupParticipantName -> senderLabel), assunto=nome do grupo, esconde Janela WhatsApp, cor ambar (queueChipClasses). Nome do grupo via findGroupInfos (env EVOLUTION_API_URL/KEY).",
      motivation:
        "Lucas quer monitorar os grupos de WhatsApp dele pela Iris/CACÁ (ver o que e demanda, se esta tendo resposta), com pouca interacao do agente. A API oficial da Meta nao serve (Groups API so cria grupos proprios, max 8, exige OBA), entao gateway Evolution read-only. Fase 1 = recepcao + fila; classificacao/digest da CACÁ vem depois.",
    },
    title: "Iris: fila de grupos de WhatsApp (monitoramento pela CACÁ)",
    type: "novidade",
    version: "1.34.0",
  },
  {
    buildTag: "2026-07-13-iris-email-ajustes",
    deployedAt: "2026-07-13T16:20:00-03:00",
    internal: true,
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Cockpit: a resposta de e-mail enviada mostra só a mensagem do operador (a assinatura vai pro cliente, mas não polui a conversa interna).",
            ],
            screen: "Atendimento",
          },
        ],
      },
      {
        module: "Setup",
        screens: [
          {
            items: [
              "A coluna Cargo em Usuários passa a exibir o valor salvo (a lista não estava carregando o campo).",
            ],
            screen: "Usuários",
          },
        ],
      },
    ],
    rollback: "commit c002cccb (v1.33.0)",
    technical: {
      done: "Interno (nao entra no painel de Novidades, mas bumpa versao pra a PWA pegar o build novo). email-reply: caredesk_messages.body guarda so o texto digitado (envio ao cliente segue assinado). loadUsersQuery (lib/setup/data.ts) inclui job_title no SELECT (a lista do Setup nao carregava o campo -> coluna Cargo mostrava '-' mesmo salvando). Flag ChangelogEntry.internal filtra do HomeNovidadesPanel.",
      motivation:
        "Ajustes pos-go-live da UI de e-mail (v1.33.0). Lucas pediu pra nao anunciar no painel, mas sem bump de versao a PWA nao entrega o fix aos clientes (bundle cacheado).",
    },
    title: "Ajustes da UI de e-mail (interno)",
    type: "correcao",
    version: "1.33.1",
  },
  {
    buildTag: "2026-07-13-iris-email-ui",
    deployedAt: "2026-07-13T15:30:00-03:00",
    modules: [
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Os e-mails que chegam em contato@careli.adm.br agora aparecem na Iris como atendimento, com visual próprio de e-mail (cor azul, envelope) e a caixa (Contato) aparecendo como fila.",
              "Board: agrupar por Fila mostra 'Contato' como fila; agrupar por Canal separa WhatsApp | E-mail. O assunto do e-mail aparece no card.",
              "Cockpit de e-mail com cara de e-mail: cabeçalho com De / Para / Assunto, mensagens em formato de carta e avatar na cor do canal (azul).",
              "Ao abrir um e-mail, o operador responde direto pelo compositor: a resposta sai por e-mail (HTML), no mesmo assunto/conversa do cliente, com assinatura automática formatada: logo da Careli, nome + cargo do operador, e-mail, WhatsApp (link) e site.",
              "E-mail não tem a janela de 24h do WhatsApp. Anexo, áudio e reação (recursos do WhatsApp) ficam ocultos no e-mail.",
            ],
            screen: "Atendimento / Board",
          },
        ],
      },
      {
        module: "Setup",
        screens: [
          {
            items: [
              "Cadastro de usuários ganhou o campo Cargo (ex.: Analista de Atendimento), com coluna na lista e nos formulários de criar/editar.",
              "O cargo alimenta a assinatura automática das respostas de e-mail da Iris.",
            ],
            screen: "Usuários",
          },
        ],
      },
    ],
    rollback: "commit 73d039d8 (v1.32.3)",
    technical: {
      done: "UI de e-mail na Iris (Fase B-UI + outbound). Novo campo IrisTicket.channelKind (de caredesk_channels.kind) populado em mapTicketRow; helper isEmailTicket. getIrisCustomerServiceWindow curto-circuita e-mail como janela sempre aberta (sem 24h). Composer recebe channelKind: placeholder/labels de e-mail e desabilita anexo/audio; handlePickAttachment/reactToMessage/prepareEdit bloqueiam e-mail. Sidebar do cockpit mostra Canal=E-mail e oculta 'Janela WhatsApp'. Board card e inbox sidebar mostram ícone Mail. Nova rota POST /api/iris/tickets/email-reply (gated por config.outbound_enabled): resolve destinatario/assunto/thread do ultimo inbound e envia via sendGmailMessage (In-Reply-To/References/threadId), registrando a mensagem outbound e assumindo o ticket. sendMessage() roteia channelKind==='email' -> sendEmailReply. Typecheck e lint limpos.",
      motivation:
        "Continuacao da integracao de e-mail na Iris: a Fase A (conexao Gmail) e a Fase B inbound (e-mail -> ticket) ja estavam no ar; faltava a superficie de trabalho (ver o ticket de e-mail na fila, o cockpit e responder por e-mail). Pre-requisitos operacionais para o envio funcionar: ligar config.outbound_enabled do canal e configurar Send-As de contato@ na caixa caca@.",
    },
    title: "E-mail na Iris: fila, cockpit e resposta por e-mail",
    type: "novidade",
    version: "1.33.0",
  },
  {
    buildTag: "2026-07-13-chronos-titulo-agenda",
    deployedAt: "2026-07-13T11:20:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "O topo e a aba da sala de reunião agora mostram o nome da sala e o assunto da reunião agendada (puxado da Agenda).",
              "Reunião espontânea (sem agenda) mostra só o nome da sala.",
              'Corrigido: antes a aba mostrava sempre "Careli", em qualquer sala.',
            ],
            screen: "Sala de reunião",
          },
        ],
      },
    ],
    rollback: "commit ddc10fe0 (v1.32.2)",
    technical: {
      done: "ChronosExternalRoomPage: document.title (aba) e o <h1> do cabecalho passam a exibir room.name + meetingSubject (antes o title era fixo 'Careli'). Novo campo ChronosPublicRoom.meetingSubject preenchido em getChronosPublicRoomBySlug via helper resolveChronosPublicRoomAgendaSubject: reusa resolveChronosPublicReservationMeeting (reuniao ativa lobby/live ou agendada na janela) e ignora entrada espontanea (ad-hoc marcada por metadata.source = 'chronos-whereby-native-entry' ou titulo auto '{sala} | Whereby'), retornando null nesses casos. Typecheck limpo.",
      motivation:
        "Pedido do Lucas: trazer o nome da sala + o assunto da reuniao agendada no topo/aba da sala externa. Antes a aba mostrava 'Careli' fixo em qualquer sala e nao existia o assunto na tela.",
    },
    title: "Nome da sala + assunto da agenda no topo da reuniao",
    type: "melhoria",
    version: "1.32.3",
  },
  {
    buildTag: "2026-07-13-chronos-fundo-sala",
    deployedAt: "2026-07-13T10:42:00-03:00",
    modules: [
      {
        module: "Chronos",
        screens: [
          {
            items: [
              "O papel de parede C2X agora aparece de verdade no fundo da sala de reunião (tela de entrada, galeria e quando a câmera está desligada).",
              "Antes o fundo ficava branco porque o vídeo estava configurado para descartar o papel de parede aplicado na sala.",
            ],
            screen: "Sala de reunião",
          },
        ],
      },
    ],
    rollback: "commit cd08e447 (v1.32.1)",
    technical: {
      done: "ChronosExternalRoomPage: atributo do <whereby-embed> background 'off' -> 'on'. Com 'off' o embed ficava transparente e DESCARTAVA o room-background aplicado via Room Theme API (applyChronosWherebyRoomTheme: PUT /rooms/{roomName}/theme/room-background + room-knock-page-background), resultando em fundo branco na sala do hub (a sala manual do Whereby, com background on, mostrava o wallpaper). Com 'on' o Whereby pinta o fundo da sala com o wallpaper C2X que a API ja setava. Doc oficial confirma que a Room Theme API vale para salas efemeras (POST /meetings). Typecheck limpo.",
      motivation:
        "O wallpaper C2X do fundo da sala nao aparecia nas reunioes do hub (so na sala manual do Whereby). Causa raiz: o embed estava com background 'off' (transparente), jogando fora o papel de parede que a Room Theme API ja aplicava corretamente na sala.",
    },
    title: "Fundo da sala de reuniao com o papel de parede C2X",
    type: "correcao",
    version: "1.32.2",
  },
  {
    buildTag: "2026-07-13-zeus-escuro-acabamentos",
    deployedAt: "2026-07-13T08:34:15-03:00",
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "O Zeus (HelpDesk, Monitoramento e Deploys) ganhou o tema escuro completo.",
              "No HelpDesk, a prioridade “Alta” agora aparece em verde no quadro.",
            ],
            screen: "Tema escuro",
          },
        ],
      },
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "Barra de topo (abas) e o menu de módulos passaram pro grafite neutro, sem o tom azulado.",
              "O status de presença (Online/Agenda/Ausente…) ficou legível no fundo escuro.",
              "A barra de título do app agora combina com o fundo (era um azul que destoava), e a logo do Panteon na aba ficou branca.",
            ],
            screen: "Acabamentos do tema escuro",
          },
        ],
      },
    ],
    rollback: "commit cceda2f6 (v1.32.0)",
    technical: {
      done: "Conversão dark do módulo Zeus (squadops): script de receita (~1.830 substituições) em 16 arquivos — neutros slate/white/ink→tokens, fundo de página→bg-canvas, variantes dark nos intents, botões #101820+text-white→bg-inverse+text-brand-ink. helpdesk-board priorityVariant: alta 'warning'→'success' (verde). Acabamentos da moldura (sempre-escura, decisão do Lucas): panteon-module-tabs aba ativa #1b2430→#242725 e tile #101820→#101211; hub-shell launcher #232832→#242725 + tile/item-ativo neutros + backdrop bg-black/[0.06]→/50; panteon-topbar-user PanteonPresenceControl agora recebe onDark e usa tons translucidos no escuro (getPresenceTone light/dark) + dropdown escuro; aba da Home usa /panteon-mark-light.png (logo branca) no lugar da marca dourada de homolog. CHROME DA JANELA (a 'barra azulada' real do PWA/desktop): themeColor + msapplication-TileColor (app/layout.tsx) e theme_color + background_color (manifest + manifest-mobile) de #101820 (navy) → #101211 (grafite neutro). Typecheck limpo.",
      motivation:
        "Estender o tema claro/escuro ao Zeus e fechar os acabamentos do escuro que ainda destoavam (azulado na barra de topo, menu de módulos, status de presença e, principalmente, a cor da janela do app desktop que vinha do manifest PWA).",
    },
    title: "Tema escuro no Zeus + acabamentos (barra, menu, status, janela)",
    type: "melhoria",
    version: "1.32.1",
  },
  {
    buildTag: "2026-07-12-tema-claro-escuro",
    deployedAt: "2026-07-12T21:49:11-03:00",
    modules: [
      {
        module: "Panteon",
        screens: [
          {
            items: [
              "Novo botão de tema no topo do hub: alterna entre claro e escuro num clique, e a sua preferência fica salva.",
              "A tela Início (Home) já vem 100% ajustada aos dois temas.",
            ],
            screen: "Tema claro/escuro",
          },
        ],
      },
      {
        module: "Hermes",
        screens: [
          {
            items: [
              "Comunicação ajustada ao tema escuro: lista de canais, conversas, threads e a barra de escrever.",
            ],
            screen: "Comunicação",
          },
        ],
      },
      {
        module: "Iris",
        screens: [
          {
            items: [
              "Atendimento ajustado ao tema escuro: fila, conversa, cockpit do cliente e os balões de mensagem.",
            ],
            screen: "Atendimento",
          },
        ],
      },
      {
        module: "Hades",
        screens: [
          {
            items: [
              "Cobrança ajustada ao tema escuro: painel, fila, tela de cobrança e a ficha do cliente.",
            ],
            screen: "Cobrança",
          },
        ],
      },
    ],
    rollback: "commit 0a786ca6 (v1.31.13)",
    technical: {
      done: "Tema claro/escuro global finalizado e validado em 4 frentes: Panteon (Home/shell/topbar/sidebar), Hermes (pulsex), Iris (caredesk) e Hades (guardian). Mecanismo: theme-provider injeta os tokens uix inline no :root; useHubTheme() expoe {mode,setMode,toggle}; @custom-variant dark + tokens @theme (bg-canvas<surface<subtle, text-ink/soft/muted, border-line...). Padrao de montagem: fundo=bg-canvas (mais escuro) < cards=bg-surface. Sidebar/nav via .panteon-module-sidebar--themed + __active-icon (chip preto + icone branco). KpiCard ganhou accent (tiles de icone coloridos, texto neutro). Correcao de infra junto: pool do C2X (lib/guardian/db.ts) com maxIdle/idleTimeout + withHadesDbRetry (retry em ER_CON_COUNT_ERROR) pra mitigar 'Too many connections'. Tambem embarcado: Prometeu como MOCK (modules/prometeu + /public/prometeu servido publico via allowlist do proxy; rota publica /api/prometeu/tts com voz da Caca ElevenLabs capada em 320 chars) pra apresentacao da fila do lancamento. A receita de tokens tocou tambem Apolo/Chronos/Agenda/Monitoramento/Inteligencia, ainda NAO finalizados no escuro (claro e o padrao, entao seguem iguais no claro).",
      motivation:
        "Entregar o tema claro/escuro do hub com as 4 telas de maior uso 100% ajustadas, mantendo o claro como padrao. Prometeu sobe como mock pra apresentacao da fila do lancamento.",
    },
    title: "Tema claro/escuro no hub (Panteon, Hermes, Iris e Hades)",
    type: "novidade",
    version: "1.32.0",
  },
  {
    buildTag: "2026-07-11-apolo-sidebar",
    deployedAt: "2026-07-11T17:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O Apolo ganhou o menu lateral igual aos outros módulos, que recolhe pra uma faixa fina.",
              "Por enquanto com uma tela só, o CRM 360; as demais entram aos poucos. O botão de novo cadastro continua no topo do CRM.",
            ],
            screen: "CRM 360",
          },
        ],
      },
    ],
    rollback: "commit dde2aa6f (v1.31.12)",
    technical: {
      done: "Novo ApoloSidebar (modules/apolo/blocks/shell/apolo-sidebar.tsx) espelhando o Sidebar do Hades (mesma pele panteon-module-sidebar, colapsavel w-60/72px, estado em apolo.sidebarCollapsed via usePersistedState), mas comandando a tela por estado interno (activeScreen) em vez de rota. catalog.ts: ApoloScreenItem ganhou flag hidden; CRM 360 reordenado pra primeiro (default ja era crm), Dashboard e Relatorios marcados hidden (o sidebar so mostra !hidden). ApoloHeader perdeu o seletor de telas (nav) e a prop onChangeScreen; ficou so com acoes + botao de novo cadastro. ApoloPage: renderiza o sidebar + offset lg:pl-60/72px no container. Telas Dashboard/Relatorios seguem no codigo, so ocultas do menu ate o Lucas liberar.",
      motivation:
        "Padronizar o Apolo com os demais modulos (menu lateral), com o CRM 360 como a tela principal. As outras telas entram uma a uma conforme o Lucas for liberando.",
    },
    title: "Apolo: menu lateral (sidebar) com o CRM 360",
    type: "melhoria",
    version: "1.31.13",
  },
  {
    buildTag: "2026-07-11-cadastro-enxuto",
    deployedAt: "2026-07-11T16:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O cadastro de prospect ficou enxuto: mostra só o que é automático (identificação, contato, renda), que é o que sai no CAD.",
              "As consultas sob demanda (certidões, análise financeira) saíram do cadastro; elas ficam para o operador rodar depois, na ficha do cliente.",
            ],
            screen: "Cadastro de CAD — Revisão",
          },
          {
            items: [
              "A configuração de enriquecimento foi fechada: GOLD e validação de contato ficaram de fora, endereço/profissional/risco/vínculos também; automático só o essencial. Custo por cadastro de prospect caiu de ~R$ 17 para ~R$ 2,23.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit ec371aa5 (v1.31.11)",
    technical: {
      done: "Decisao do Lucas (11/jul): o cadastro/CAD mostra so o enriquecimento AUTO; o sob demanda vai pro Apolo. cadastro-flow: enviar() so marca enviado (nao dispara mais CARELI_PF_02 certidoes); removido o bloco Certidoes + botao 'Rodar analise financeira' (GOLD) da Revisao; removidos rodarAnalise/rodarGold, estados cert/gold, CertidaoCard, mockCertidoes, types Analise/Certidao. enrichment-spec: pf_gold (12) + auth_score_gold (4) -> fora; certidoes (PF_02) operador; excluidos por decisao nome do pai/obito/outros docs (basic_data) + addresses_extended + occupation_data + kyc + business_relationships + social_assistance + professional_turnover -> fora; related_people -> operador; phones/emails (PF_01) -> auto. class_organization (CRECI) -> fora no PROSPECT (so no cadastro de imobiliaria/corretor). Restou AUTO no prospect: basic_data, phones_extended, emails_extended, financial_data = 4 datasets ~R$ 2,23/cadastro (era ~R$ 17). PENDENTE (proxima fase): cadastro de imobiliaria/corretor (com CRECI) e a ficha do Apolo rodando o sob demanda.",
      motivation:
        "Fechar o enriquecimento: automatico so o que vale e sai no CAD; o caro (GOLD/AuthScore) fora; o resto sob demanda no Apolo. Reduz o custo do cadastro em ~86%.",
    },
    title: "Cadastro de prospect: enxuto (só o automático) + enriquecimento fechado",
    type: "melhoria",
    version: "1.31.12",
  },
  {
    buildTag: "2026-07-11-cad-pdf-de-verdade",
    deployedAt: "2026-07-11T15:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O CAD agora vira um PDF de verdade: o botão Baixar CAD (PDF) gera o arquivo e baixa direto, sem passar pela tela de impressão do navegador.",
              "Mesmo layout de antes (cabeçalho com o vínculo, dados em blocos, rodapé neutro), agora como documento pronto pra guardar ou enviar.",
            ],
            screen: "Cadastro de CAD — Revisão",
          },
        ],
      },
    ],
    rollback: "commit 88ce98b6 (v1.31.10)",
    technical: {
      done: "Gerar CAD saiu do window.print (dialogo Salvar como PDF, rejeitado) para PDF vetorial via pdf-lib. Novo modules/apolo/blocks/cadastro/cad-pdf.ts: montarCadPdf(cad) monta o documento (A4, Helvetica/Bold, cabecalho Cadastro de CAD + Enviado em + imobiliaria/corretor a direita, nome+papel, secoes em 2 colunas com label uppercase + valor, campos full em largura cheia, wrap por largura, rodape 'Ficha gerada automaticamente' + nome do arquivo em todas as paginas, sem Careli); gerarCadPdf baixa via Blob. cadastro-flow.gerarCad passou a montar CadSecao[] estruturado (cadField/cadSection devolvem objeto) e chama gerarCadPdf; removidos imprimirCad + escapeHtml. Botao 'Gerar CAD' (Printer) -> 'Baixar CAD (PDF)' (Download). pdf-lib@1.17.1 add ao apps/hub. Verificado: PDF de teste gerado pelo codigo real, layout fiel, acentos ok. Edge conhecido: CAD longo (com conjuge) pode deixar 1 campo orfao na pag 2 (a polir).",
      motivation:
        "O Lucas ja tinha aprovado o layout e rejeitou o dialogo de impressao. Precisava do PDF de verdade com urgencia (apresentando o Apolo).",
    },
    title: "Cadastro: Baixar CAD gera PDF de verdade (sem diálogo de impressão)",
    type: "melhoria",
    version: "1.31.11",
  },
  {
    buildTag: "2026-07-10-helpdesk-agente-triagem",
    deployedAt: "2026-07-10T23:55:00-03:00",
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "Novo botão Rodar triagem no detalhe do chamado: o agente lê o relato, procura chamado duplicado, confere se já foi corrigido em alguma versão do painel de novidades, sugere o tipo/impacto e escreve a devolutiva.",
              "Casos claros (duplicata ou já corrigido) o agente responde direto e move o chamado para validação; os demais viram um rascunho pronto para você revisar e enviar.",
              "O agente nunca fecha o chamado e nunca diz que consertou: é triagem e resposta. Quando é bug de verdade, ele sinaliza para escalar.",
            ],
            screen: "HelpDesk — detalhe do chamado",
          },
        ],
      },
    ],
    rollback: "commit 43384e57 (v1.31.9)",
    technical: {
      done: "Agente de triagem Nivel 1 do HelpDesk. lib/triage.ts: runHubItTicketTriage via completeWithClaudeStructured (tool-use forcado, modelo default) — contexto = chamado + candidatos a duplicata (lista leve, ate 50) + changelog recente (25). Trava 'misto por confianca' no SERVIDOR (normalizeTriageResult): so autonomy=responder com confianca alta E duplicata/versao real E sem escalar; fallback seguro se a IA cair. Rota POST /api/hub/it-tickets/triage (admin-only, maxDuration 60) so LE. Board: runTriage — responder=updateHubItTicket direto (adminResponse+resolutionSummary+classificacao, status aguardando_cliente) e nunca fecha; rascunho=pre-preenche o draft. TriageBar no header do detalhe (botao + painel: respondido/rascunho, confianca, duplicata, versao, escalar, nota). v1.31.9 -> v1.31.10.",
      motivation:
        "Fase seguinte ao diagnostico do HelpDesk: com a Fase 0 (anexos no Storage, resolution_summary) pronta, o agente ataca os 14 chamados sem resposta e os 12 parados em 'novo'. Nivel 1 = triagem + resposta; jamais fecha ticket sozinho (ja ha um robo fechando 90% por timeout).",
    },
    title: "HelpDesk: agente de triagem (lê, acha duplicata, confere changelog e responde)",
    type: "novidade",
    version: "1.31.10",
  },
  {
    buildTag: "2026-07-10-estadocivil-escolaridade-declarados",
    deployedAt: "2026-07-10T18:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Decisão do cadastro: estado civil e escolaridade saem do enriquecimento e passam a ser declarados no formulário. Os dois vinham vazios ou eram só estimativa, e o estado civil ainda dispara a etapa do cônjuge, então precisa ser confiável.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit 8b4fe87b (v1.31.8)",
    technical: {
      done: "Decisao do Lucas na avaliacao do enriquecimento: estadoCivil (basic_data) e escolaridade (demographic_data) passam de politica 'auto' para 'fora' por padrao — sao declarados no formulario, nao enriquecidos. Motivo: estado civil vem vazio com frequencia na base e dispara a etapa de conjuge/certidao (nao pode depender do enriquecimento); escolaridade e apenas uma estimativa. Notas dos dois campos atualizadas. Principio geral: campo que aciona passo legal ou que retorna vazio com frequencia = declarado no form, enriquecimento so como sugestao.",
      motivation:
        "Regra que o laboratorio existe pra fechar: o que e confiavel o bastante pra vir automatico vs. o que precisa ser declarado. Estado civil e escolaridade caem no segundo grupo.",
    },
    title: "Cadastro: estado civil e escolaridade declarados (fora do enriquecimento)",
    type: "melhoria",
    version: "1.31.9",
  },
  {
    buildTag: "2026-07-10-authscore-telefone-pais",
    deployedAt: "2026-07-10T18:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A Validação de contato deixava o código do país no telefone (+55), mandando 13 dígitos quando o AuthScore aceita só 10 ou 11. Agora o +55 é removido sozinho, e a validação passa a responder.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit a1f69eb9 (v1.31.7)",
    technical: {
      done: "A CARELI_PF_05 (AuthScore) recusava com HTTP 400 (result:null) porque o telefone ia com o codigo do pais: soDigitos('+5531983013616') = 13 digitos, e o AuthScore exige DDD+numero (10-11). Novo telefoneAuthScore(raw) tira o prefixo 55 quando o resultado passa de 11 digitos e comeca com 55; usado no validarContato e no rodarTudo (params da PF_05). CEP/demais campos ja iam certos.",
      motivation:
        "Sem o telefone no formato certo, a unica etapa que valida o contato declarado (a checagem do fim do cadastro) nao rodava.",
    },
    title: "Enriquecimento: telefone do AuthScore sem o código do país",
    type: "correcao",
    version: "1.31.8",
  },
  {
    buildTag: "2026-07-10-rodar-tudo-cronometro",
    deployedAt: "2026-07-10T17:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Botão Rodar tudo: dispara todas as consultas de uma vez, em paralelo, e a validação de contato junto se você tiver preenchido o telefone, o e-mail ou o CEP.",
              "Cronômetro ao lado mostra o tempo correndo enquanto roda e trava no total ao terminar.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit 6cfcf139 (v1.31.6)",
    technical: {
      done: "Extraido rodarQuery(digits, query, params) que faz o fetch sem tocar em 'rodando', permitindo paralelismo. consultar() envolve com validacao + estado rodando; novo rodarTudo() valida o documento, cronometra (performance.now + setInterval 100ms em tempoTotal) e dispara Promise.allSettled de todas as queries nao-contato + PF_05 se houver contato declarado. Botao 'Rodar tudo' (Zap) + chip cronometro (Timer) que fica dourado enquanto roda e verde com o total no fim. Botoes individuais e Validar desabilitam durante rodandoTudo. Paralelo importa: as certidoes (PF_02) levam ~190s, sequencial somaria os tempos.",
      motivation:
        "Lucas quer testar tudo de uma vez e saber quanto tempo o conjunto leva, em vez de clicar query por query.",
    },
    title: "Enriquecimento: botão Rodar tudo + cronômetro",
    type: "melhoria",
    version: "1.31.7",
  },
  {
    buildTag: "2026-07-10-bestinfo-objeto",
    deployedAt: "2026-07-10T16:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O e-mail e o telefone sugeridos deixaram de aparecer como \"[object Object]\": a tela agora lê o valor certo mesmo quando o dado vem aninhado.",
              "Os campos que dependem da Validação de contato passam a explicar isso, em vez de mandar rodar uma consulta que não existe como botão.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit 2dfa6d83 (v1.31.5)",
    technical: {
      done: "O BestInfo do GOLD real embrulha cada contato num objeto (Email={EmailAddress}, Phone={AreaCode,Number}), entao o render 'texto' mostrava [object Object]. Novo primitivoDe(value) extrai um texto legivel de valor primitivo, objeto (por chaves usuais: value/emailaddress/phonenumber/number/addressmain/... senao junta primitivos) ou lista; aplicado nos renders texto/lista/objeto. mockProbe do pf_gold ajustado pra estrutura aninhada. Empty-state dos campos de query 'contato' (CARELI_PF_05) diz 'Preencha e rode a Validacao de contato' em vez de 'Rode a query CARELI_PF_05' (nao ha botao).",
      motivation:
        "O telefone e o e-mail sugeridos sao dois dos campos que o Lucas mais precisa avaliar, e vinham ilegiveis. A estrutura real do BestInfo so apareceu com a consulta em producao.",
    },
    title: "Enriquecimento: e-mail/telefone sugeridos legíveis (fim do [object Object])",
    type: "correcao",
    version: "1.31.6",
  },
  {
    buildTag: "2026-07-10-helpdesk-tipo-reclassificacao",
    deployedAt: "2026-07-10T22:40:00-03:00",
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "O Tipo e o Impacto que você escolhe ao abrir o chamado agora são respeitados. Antes o sistema adivinhava pelo texto e apagava a sua escolha (era o TI-000061: coloco melhoria e vira erro).",
            ],
            screen: "Abrir chamado",
          },
          {
            items: [
              "Novo bloco Classificação no topo do chamado: dá para corrigir o Tipo e o Impacto ali mesmo e salvar na hora.",
              "A leitura técnica do Zeus ganhou destaque visual, para se distinguir do resto do chamado.",
            ],
            screen: "HelpDesk — detalhe do chamado",
          },
        ],
      },
    ],
    rollback: "commit d2d3aad1 (v1.31.4)",
    technical: {
      done: "(A) hub-ticket-open-form: o useEffect que rodava inferCategory/inferPriority sobrescrevia a escolha do usuario a cada tecla na descricao. Agora categoryTouchedRef/priorityTouchedRef travam a inferencia depois que a pessoa mexe no seletor (inferencia so pre-preenche). (B) Reclassificacao pelo Zeus no detalhe: HubItTicketUpdateInput + normalizeUpdateInput aceitam category/priority (guards ja existiam); update do admin grava so quando difere. TicketDraft ganha category/priority (init do ticket, parse do localStorage tolerante, save so envia se mudou; guard do save aceita reclassificacao pura). ClassificationEditor no header (selects Tipo/Impacto + botao Salvar classificacao). (C) DetailBlock da leitura do Zeus com gradiente/borda dourada e icone em circulo. v1.31.4 -> v1.31.5.",
      motivation:
        "O TI-000061 e uma queixa sobre o proprio tipo (melhoria vira erro), que bate com o achado do diagnostico de que todo ticket cai em erro/media: a classificacao nunca era do usuario, era adivinhada do texto. Corrigido na origem (form) e no detalhe (reclassificacao pelo Zeus).",
    },
    title: "HelpDesk: tipo do chamado respeita a escolha + reclassificação pelo Zeus",
    type: "correcao",
    version: "1.31.5",
  },
  {
    buildTag: "2026-07-10-authscore-pf05-turnover",
    deployedAt: "2026-07-10T16:00:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "Nova etapa Validação de contato: você preenche o telefone, o e-mail e o endereço que a pessoa declarou e o AuthScore responde se conferem com a base. É a checagem do fim do cadastro.",
              "A rotatividade profissional entrou no Perfil ampliado, então esses campos também passam a vir preenchidos.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit 3c0c21b4 (v1.31.3)",
    technical: {
      done: "A MOST criou CARELI_PF_05 com o AUTHSCORE GOLD isolado e adicionou professional_turnover a CARELI_PF_04. professional_turnover deixou de ser 'novo' (entra na PF_04). Os 4 campos auth_score_gold passaram a apontar para CARELI_PF_05 (deixaram de ser 'novo'). QuerySpec ganhou flag 'contato': a PF_05 nao vira botao comum (exige entrada declarada) e sim um painel Validacao de contato com telefone/email/cep/logradouro/numero/bairro/cidade/UF. probeEnrichment/route aceitam opts.params (merge no objeto parameters alem do cpf); validarContato monta {cpf, modelCode:'scorealgorithmimpl', phone, cep, addressLine1/2, neighborhood, city, state, email}. mockProbe: PF_04 volta a ter professional_turnover, novo bloco PF_05 com auth_score_gold. Removido o texto da 'query pontilhada' (nao ha mais query proposta). Custo: PF_04 agora 9 datasets (8 x 0,177 + turnover 0,18 = R$ 1,60); PF_05 (AuthScore) R$ 3,069.",
      motivation:
        "O AuthScore precisa do contato declarado como entrada, entao pertence a uma etapa de validacao propria, no fim do cadastro, nao a uma consulta por CPF. Com a PF_05 e o painel, o Lucas ve o resultado real dessa checagem.",
    },
    title: "Enriquecimento: validação de contato (AuthScore PF_05) + turnover na PF_04",
    type: "novidade",
    version: "1.31.4",
  },
  {
    buildTag: "2026-07-10-pf04-sem-authscore",
    deployedAt: "2026-07-10T15:10:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "O Perfil ampliado passou a responder de verdade: a MOST tirou dele a validação de contato (AuthScore), que exigia dados que a consulta por CPF não tem, e os outros oito dados agora chegam normalmente.",
              "A validação de telefone, e-mail e endereço vira uma etapa própria, feita no fim do cadastro quando esses dados já foram preenchidos.",
              "O painel deixou de listar como pendente o que a MOST já entregou.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit 59d2504e (v1.31.2)",
    technical: {
      done: "A CARELI_PF_04 dava HTTP 400 porque incluia o dataset auth_score_gold (AUTHSCORE GOLD / Q-DB-128-F), que exige parametros alem do cpf (modelCode='scorealgorithmimpl', phone, cep, addressLine1/2, neighborhood, city, state, email). A MOST removeu o AuthScore da query; os outros 8 datasets respondem. No codigo: os 9 datasets da PF_04 deixaram de ser 'novo' (a query existe), so professional_turnover continua pendente; os 4 campos do auth_score_gold (telefoneConfirmado/emailConfirmado/enderecoConfirmado/falecido) voltaram a 'novo' com nota explicando que AuthScore e uma validacao com entrada declarada, a rodar no fim do cadastro; auth_score_gold saiu do mockProbe da PF_04. Custo da PF_04 sem AuthScore: 8 x R$ 0,177 = R$ 1,42 por consulta.",
      motivation:
        "Sem o AuthScore fora, a PF_04 inteira falhava e o Lucas nao via nenhum dos datasets novos. E o AuthScore, por precisar do contato declarado como entrada, e uma etapa de validacao, nao um enriquecimento por CPF.",
    },
    title: "Enriquecimento: Perfil ampliado responde (AuthScore vira etapa à parte)",
    type: "correcao",
    version: "1.31.3",
  },
  {
    buildTag: "2026-07-10-perfil-ampliado-pf04",
    deployedAt: "2026-07-10T14:20:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A MOST criou a consulta de perfil ampliado: escolaridade estimada, conselho de classe (o CRECI do corretor), conferência do telefone e do e-mail declarados, compliance, rede de relacionamentos, benefícios sociais e comportamento.",
              "O botão Perfil ampliado agora responde de verdade e passa a preencher as abas Rede, Digital e Risco.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit 6ddc215a (v1.31.1)",
    technical: {
      done: "A MOST confirmou por e-mail (10/jul) a criacao da CARELI_PF_04 com os 9 datasets pedidos: demographic_data, class_organization, auth_score_gold, kyc, related_people, business_relationships, social_assistance, related_people_phones, interests_and_behaviors. A query deixou de ser 'proposta' na spec (label 'Perfil ampliado'). professional_turnover NAO entrou: a MOST informou que existe a R$ 0,18 sem faturamento minimo, valor ausente das 3 tabelas; entrou em most-precos.ts como PROF-TURNOVER-F [0.18, 0.164, 0.149] (os dois ultimos ESTIMADOS pela proporcao dos demais datasets) e os 3 campos que dependem dele ganharam nota. mockProbe alinhado. Custo da PF_04: 8 datasets a R$ 0,177 + auth_score_gold R$ 3,069 = R$ 4,49 por consulta.",
      motivation:
        "Sem a query, os datasets novos so existiam no simulado, e o Lucas nao conseguia julgar a qualidade do dado real para decidir o que entra no cadastro.",
    },
    title: "Enriquecimento: perfil ampliado (CARELI_PF_04) no ar",
    type: "novidade",
    version: "1.31.2",
  },
  {
    buildTag: "2026-07-10-enriquecimento-tres-planos",
    deployedAt: "2026-07-10T12:40:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A seção de custo agora compara os três planos da MOST lado a lado: você informa quantos cadastros faz por mês e a tela mostra a fatura em cada um, destacando o mais barato.",
              "Quando o consumo fica abaixo do faturamento mínimo do plano, a tela avisa que você paga o mínimo mesmo assim.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit c044cd9b (v1.31.0)",
    technical: {
      done: "most-precos.ts regenerado a partir dos 3 PDFs de proposta (SEM FM / FM R$1.500 / FM R$5.000): TABELA codigo -> [preco_semfm, preco_fm1500, preco_fm5000] com 107 codigos, mapas dataset->codigo por persona, precoDataset(persona, dataset, plano), custoOcrImagem(plano), faturaMensal(consumo, plano) aplicando o piso do FM. calcularCusto ganhou o parametro plano. Tela: seletor de plano + cadastros/mes + comparacao das 3 faturas com destaque do vencedor e aviso de piso. Descontos NAO uniformes: enriquecimento -9% (FM 1.500) e -17,5% (FM 5.000); iOCR e IA generativa de -32% a -68%; OCR-104 (facematch 1:N) FICA MAIS CARO nos planos com FM. Viradas (cesta com GOLD+AuthScore, 3 imagens): ate 83 cad/mes SEM FM, 84 a 312 FM 1.500, 313+ FM 5.000. Cesta enxuta: SEM FM ate 456.",
      motivation:
        "A MOST mandou as tres propostas. O preco e por consulta em todas; o que muda e o unitario e o faturamento minimo. Sem simular a fatura do mes com a decisao de campos em cima, escolher plano seria chute.",
    },
    title: "Enriquecimento: comparação dos três planos da MOST",
    type: "melhoria",
    version: "1.31.1",
  },
  {
    buildTag: "2026-07-10-helpdesk-storage-narracao",
    deployedAt: "2026-07-10T21:30:00-03:00",
    modules: [
      {
        module: "Zeus",
        screens: [
          {
            items: [
              "Gravação de tela agora grava com o seu microfone: dá para narrar o erro enquanto mostra a tela, tudo num arquivo só.",
              "Qualidade do vídeo muito melhor (o texto da tela ficou legível) e a gravação passou de 1 para 5 minutos.",
              "Print agora sai em PNG, sem borrar texto e bordas.",
              "Anexos podem ser bem maiores: eles saíram do banco e foram para o armazenamento de arquivos.",
            ],
            screen: "Abrir chamado",
          },
          {
            items: [
              "A tela abre muito mais rápido: os anexos só são baixados quando você abre o chamado.",
            ],
            screen: "Meus chamados",
          },
          {
            items: [
              "Para mandar um chamado para validação ou fechá-lo, agora é obrigatório descrever a resolução. Antes esse resumo era apagado sozinho a cada resposta.",
              "O board deixa de esconder chamados antigos depois do 120º.",
            ],
            screen: "HelpDesk",
          },
        ],
      },
    ],
    rollback: "commit bfef668c (v1.30.1)",
    technical: {
      done: "Fase 0 do diagnostico do HelpDesk. (1) Anexos saem do Postgres: migration 0045 adiciona storage_path, bucket privado hub-it-ticket-attachments (150MB), rota attachment-upload devolve signed upload URL e o cliente sobe direto pro Storage (contorna o body de ~4.5MB da Vercel); leitura por createSignedUrls em lote; content_data_url fica como leitura dupla ate o backfill. Rota admin attachments-backfill + card no board migram os 88 anexos legados (53MB) em lotes e depois liberam o espaco. (2) Qualidade: getDisplayMedia + getUserMedia combinados num MediaStream (narracao), video 450kbps -> 2.5Mbps VP9+Opus 30fps, print JPEG 0.82 -> PNG, 60s -> 5min; a IA recebe amostra reduzida (analysisDataUrls) em vez do arquivo. (3) Payload: hub-user-tickets-panel usava details=full (a Nivea baixava 35MB por abertura) -> details=list + hidratacao sob demanda; default de details invertido pra list (full virou opt-in); fetchAllPagedRows pagina eventos/anexos/tickets (teto 1000 do PostgREST + .limit(120) fixo). (4) resolution_summary era zerado a cada admin update (?? null) e agora sobrevive, e virou obrigatorio pra validacao/fechamento. v1.30.1 -> v1.31.0.",
      motivation:
        "Diagnostico completo da aba HelpDesk: 90% dos fechamentos eram o timeout de 3 dias, resolution_summary vazio em 71/71 tickets e 53MB de anexos em base64 dentro do Postgres. A ma qualidade do video e do print e a falta de narracao tinham a MESMA causa: tudo precisava caber no base64 do banco.",
    },
    title: "HelpDesk: gravação com narração, qualidade real e anexos fora do banco",
    type: "melhoria",
    version: "1.31.0",
  },
  {
    buildTag: "2026-07-10-enriquecimento-custo-real",
    deployedAt: "2026-07-10T11:30:00-03:00",
    modules: [
      {
        module: "Apolo",
        screens: [
          {
            items: [
              "A tela agora é sobre a decisão: o painel mostra quantos campos são automáticos, quantos ficam sob demanda e quantos ficam de fora, com a lista do que precisa ser pedido à MOST.",
              "Os campos do GOLD (score, negativações e melhor contato) foram reunidos no dataset que a consulta realmente devolve, então a aba Financeiro passa a preencher.",
              "A certidão da Receita saiu do automático: o cadastro básico já traz a situação do CPF em dois segundos, enquanto a certidão leva mais de três minutos.",
              "Sexo aparece por extenso e a tela lista os datasets recebidos em cada consulta.",
              "O custo virou uma seção recolhida de referência, porque o plano ainda está sendo revisto com a MOST.",
            ],
            screen: "Enriquecimento (laboratório)",
          },
        ],
      },
    ],
    rollback: "commit 9df49c18 (v1.30.0)",
    technical: {
      done: "lib/apolo/most-precos.ts: tabela de precos da proposta MOST SEM FM (codigo + R$ por dataset, PF e PJ) + CUSTO_OCR_IMAGEM 0,506 + RATE_LIMIT_OCR_MENSAL. calcularCusto passou a devolver reais (custoAuto, custoOperador, custoOcr, datasetsAuto ordenados por preco, semPreco) em vez de unidades; PLANO_UNIDADES_PADRAO virou IMAGENS_POR_CADASTRO_PADRAO. CORRECAO DO MODELO: o contrato MST-0031/26 tem Faturamento Minimo Mensal = R$ 0,00 e os 10.000 da clausula 3.3.5 sao rate limiter de paginas de OCR, nao um plano de datasets. CARELI_PF_03 devolve UM dataset pf_gold (Q-DB-118-F, R$ 11,628) com Score/BestInfo/Negative/Protests dentro: os campos que apontavam para pf_gold_score/_bestinfo/_negative_flag/_negative_info foram remapeados. ondemand_rf_status virou politica operador (a PF_02 inteira leva ~188s e basic_data.taxIdStatus responde em 2,6s). resolverCampo faz fallback varrendo os datasets recebidos e mostra o selo 'veio de X'. mockProbe alinhado ao retorno real.",
      motivation:
        "A proposta e o contrato da MOST chegaram: o custo nao e por unidade, e por dataset em reais, variando de R$ 0,177 a R$ 14,62. A configuracao sugerida custava R$ 17,99 por cadastro, com 89% concentrados no GOLD completo e no AuthScore. Sem ver o preco ao lado do campo, a decisao do que enriquecer era chute.",
    },
    title: "Enriquecimento: custo real em reais (a MOST cobra por dataset)",
    type: "melhoria",
    version: "1.30.1",
  },
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
