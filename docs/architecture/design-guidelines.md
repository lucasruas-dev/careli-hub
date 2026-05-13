# Careli Hub Visual Governance Guidelines

Este documento define a governanca visual oficial do Careli Hub. Ele deve orientar Home, Login, PulseX e futuros modulos para que o produto pareca uma unica plataforma operacional, nao um conjunto de telas soltas.

## Principio Central

O Careli Hub deve parecer uma Central Operacional enterprise: sobria, clara, viva em tempo real e pronta para trabalho continuo. A experiencia deve ser Guardian-like: institucional, elegante, densa quando necessario e sempre orientada a acao.

O objetivo visual nao e parecer um SaaS generico, uma landing page, um dashboard tecnico ou um painel decorativo. O produto deve transmitir sistema interno confiavel, com linguagem visual propria e consistente.

## Identidade Visual

### Direcao

- Guardian-like: estrutura editorial-operacional, hierarquia forte, leitura clara e sensacao de sistema critico.
- Grafite elegante: usar tons escuros profundos como base de autoridade, sem cair em azul/slate generico.
- Branco frio operacional: areas claras devem parecer precisas, limpas e profissionais, nao cremosas ou calorosas demais.
- Dourado `#A07C3B` como accent: usar para foco, status premium, selecao, chamadas de acao e detalhes institucionais.
- Aparencia institucional: telas devem parecer parte de uma operacao real da Careli.

### Evitar

- SaaS generico com gradientes chamativos, cards inflados, sombras decorativas e hero marketing.
- Excesso de bege, creme, areia, marrom ou paletas quentes dominantes.
- Dashboard tecnico com graficos sem contexto, metricas soltas e visual de ferramenta de infraestrutura.
- Texto explicativo demais ocupando espaco que deveria ser usado por acoes, presenca e status operacional.
- Mistura de estilos entre telas, principalmente entre Home, Login e modulos.

### Paleta Canonica

| Papel | Uso | Valor |
| --- | --- | --- |
| Grafite base | Shell, sidebar, areas institucionais | `#101820` |
| Dourado accent | Ativos, foco, chamadas primarias, marcadores | `#A07C3B` |
| Branco frio | Fundos operacionais claros | definir por token UIX |
| Texto principal | Conteudo de alta prioridade | definir por token UIX |
| Texto secundario | Metadados e contexto | definir por token UIX |
| Bordas | Separacao leve e estrutura | definir por token UIX |

Novas telas devem consumir tokens UIX quando existirem. Valores diretos so devem aparecer em fundacoes visuais ou em excecoes documentadas.

## Layout Global

### Hub Shell

Usar Hub Shell quando a tela pertence ao Hub como plataforma: Home, configuracoes globais, catalogo de modulos, usuarios, permissoes, notificacoes e areas compartilhadas.

O Hub Shell deve carregar a identidade central do Careli Hub: navegacao global, presenca, notificacoes, atividade e contexto de workspace quando aplicavel.

### Modulo Fullscreen

Usar modulo fullscreen quando a experiencia precisa de foco operacional proprio, como PulseX ou ferramentas com fluxo intenso. O modulo pode ocupar a tela inteira e reduzir a interferencia do Hub Shell, mas deve preservar a identidade UIX, tokens, padroes de componente e pontos de retorno ao Hub.

Fullscreen nao significa visual desconectado. O modulo pode ter identidade operacional propria, mas ainda deve parecer parte do ecossistema Careli.

### Launcher Global

Usar launcher global para alternar entre modulos, abrir a Home, acessar configuracoes e encontrar recursos transversais. O launcher deve ser rapido, previsivel e presente nos contextos onde o usuario pode mudar de tarefa.

O launcher nao deve virar menu de marketing ou vitrine. Ele existe para navegacao operacional.

### Sidebar Interna do Modulo

Usar sidebar interna quando um modulo tem secoes, filas, entidades ou fluxos proprios. Ela pertence ao modulo e nao substitui a navegacao global do Hub.

Uma sidebar interna deve deixar claro que o usuario ainda esta dentro do modulo. Ela pode usar nome, icone ou marca do modulo, mas deve manter spacing, estados e densidade coerentes com UIX.

## Sidebar Padrao

### Base Visual

- Cor base canonica: `#101820`.
- Superficie escura, elegante e institucional.
- Separadores discretos, sem bordas pesadas.
- Itens alinhados, previsiveis e com altura consistente.
- Icones sempre acompanhando a semantica da rota ou acao.

### Estados

| Estado | Regra |
| --- | --- |
| Default | Texto e icone com contraste suficiente, sem chamar atencao desnecessaria. |
| Hover | Leve elevacao visual por fundo, borda ou tom mais claro; sem animacoes exageradas. |
| Active | Usar `#A07C3B` como accent principal, com marcador, fundo sutil ou texto destacado. |
| Disabled | Baixo contraste controlado, mantendo legibilidade minima. |
| Focus | Indicador visivel e acessivel, alinhado ao accent UIX. |

### Icones

Icones devem reforcar reconhecimento rapido. Preferir bibliotecas padronizadas do projeto, com tamanho consistente. Evitar icones decorativos, redundantes ou com estilos misturados.

### Comportamento Recolhivel

A sidebar pode ser recolhivel em telas densas ou fluxos de foco. Quando recolhida:

- manter icones reconheciveis;
- preservar tooltips ou labels acessiveis;
- nao esconder estados criticos;
- nao alterar a rota ou a hierarquia da navegacao;
- evitar mudancas de layout que causem salto visual.

### Global vs Modulo

| Tipo | Responsabilidade |
| --- | --- |
| Sidebar global | Navegacao do Hub, modulos, configuracoes e recursos transversais. |
| Sidebar de modulo | Navegacao interna de um modulo especifico, como filas, visoes e operacoes. |

A sidebar global responde pela plataforma. A sidebar de modulo responde pelo trabalho dentro do modulo. Quando ambas existirem, a hierarquia visual deve deixar essa diferenca obvia.

## Home do Hub

A Home do Hub deve ser uma Central Operacional, nao um painel tecnico.

Ela deve conter:

- comunicacao institucional da Careli;
- pessoas online e presenca operacional;
- modulos disponiveis e seus estados;
- atividade recente relevante;
- pulse operacional com sinais de status, atencao e continuidade.

A Home deve ajudar o usuario a entender o que esta acontecendo agora e para onde agir em seguida. Evitar metricas vazias, graficos sem decisao, explicacoes longas ou layout de dashboard tecnico.

## Login

O Login deve parecer uma entrada de sistema enterprise. Ele deve ser direto, confiavel e institucional.

Regras:

- nao construir como landing page;
- nao usar texto tecnico;
- nao mostrar termos como "mock", "Supabase futuro", "placeholder", "dev only" ou similares;
- nao explicar arquitetura ou status de implementacao;
- priorizar marca, acesso, seguranca percebida e clareza;
- manter visual Guardian-like com grafite elegante, branco frio e accent dourado.

O Login e a porta de entrada da operacao. Ele deve transmitir que o usuario esta acessando uma plataforma real.

## Modulos

Cada modulo pode ter identidade operacional propria: cor secundaria, iconografia, terminologia, densidade e fluxo. Essa identidade deve complementar o Hub, nao competir com ele.

Todo modulo deve respeitar UIX:

- tokens de cor, tipografia, spacing e borda;
- componentes compartilhados quando existirem;
- estados de interacao consistentes;
- padroes de acessibilidade;
- hierarquia de headers, toolbars, filtros, listas e detalhes.

### Spacing

Usar spacing consistente e funcional. Telas operacionais devem ser density-ready: caber mais informacao quando necessario sem parecer espremidas. Evitar respiros exagerados herdados de landing pages.

### Cards e Surfaces

Cards devem representar unidades reais de informacao ou acao. Nao usar cards como decoracao de layout. Surfaces devem separar contexto, nao fragmentar a tela.

### Headers

Headers devem mostrar localizacao, estado e principais acoes. Evitar slogans e textos explicativos. Em modulo, o header deve deixar claro o contexto operacional atual.

### Toolbars

Toolbars devem priorizar comandos frequentes, filtros, busca, ordenacao, criacao e acoes em lote. Botoes devem ser concisos e alinhados ao padrao UIX.

### Filtros

Filtros devem ser rapidos de entender, faceis de limpar e adequados a operacao. Evitar filtros escondidos quando eles forem parte central do fluxo.

## Componentes UIX

Os componentes UIX sao a base da consistencia visual. Novas telas devem usar ou seguir estes componentes antes de criar variacoes locais.

| Componente | Regra de Uso |
| --- | --- |
| Button | Acoes claras, hierarquia primaria/secundaria/terciaria, estados visiveis e iconografia quando ajudar reconhecimento. |
| Surface | Agrupar contexto operacional sem virar decoracao. Usar bordas e fundos discretos. |
| Badge | Status, categorias e contagens curtas. Cores devem ter significado consistente. |
| TextField | Entrada objetiva, label claro, erro visivel e foco acessivel. |
| Sidebar | Navegacao global ou interna com estados padronizados e comportamento recolhivel previsivel. |
| Topbar | Contexto global, busca, presenca, notificacoes, usuario e atalhos essenciais. |
| DataTable | Dados comparaveis, densidade controlada, ordenacao, selecao e estados vazios uteis. |
| ActivityFeed | Linha de atividade recente, com tempo, ator, alvo e acao claramente identificaveis. |
| NotificationPanel | Alertas e mensagens acionaveis, agrupados por relevancia e estado. |
| Presence | Pessoas online, disponibilidade e contexto de modulo/workspace em tempo real. |

Variacoes locais devem ser justificadas por necessidade operacional do modulo. Quando uma variacao aparece em mais de um lugar, ela deve virar componente UIX.

## Regras de UX

### Desktop-first

O Careli Hub e uma plataforma operacional. O desktop deve ser a experiencia principal, com layouts preparados para comparacao, navegacao rapida, multitarefa e alta densidade.

Responsividade continua obrigatoria, mas nao deve transformar fluxos principais em experiencia mobile-first quando o trabalho real acontece no desktop.

### Realtime-first

Presenca, atividade, notificacoes e status devem ser tratados como parte central da experiencia. O usuario deve perceber que o sistema esta vivo e refletindo a operacao atual.

Estados realtime devem ser claros, sem ruido e sem animacoes excessivas.

### Density-ready

As telas devem aceitar mais informacao sem perder legibilidade. Isso exige grid, spacing, tabelas, listas e toolbars pensados para uso diario.

Density-ready nao significa poluicao visual. Significa estrutura suficiente para aumentar volume sem quebrar a leitura.

### Menos Texto, Mais Acao

Evitar blocos explicativos longos dentro do produto. Preferir labels claros, estados, comandos e informacao contextual acionavel.

Texto deve ajudar o usuario a decidir ou agir. Se o texto so explica a propria interface, provavelmente deve sair.

### Sem Poluicao Visual

Cada elemento deve ter funcao. Evitar duplicidade de informacao, iconografia excessiva, sombras decorativas, fundos ruidosos, badges sem significado e chamadas de acao concorrentes.

## Checklist Visual Para Novas Telas

Antes de aprovar uma nova tela, responder:

- Parece Careli?
- Parece Guardian-like?
- Esta limpo?
- Tem informacao demais?
- Parece sistema interno?
- Respeita UIX?
- Usa grafite elegante, branco frio operacional e `#A07C3B` com criterio?
- Evita SaaS generico?
- Evita excesso de bege/creme?
- Evita dashboard tecnico?
- A hierarquia de layout esta clara?
- As acoes principais estao obvias?
- A tela esta pronta para realtime?
- A densidade faz sentido para uso diario?
- O texto e operacional ou esta explicando demais?

Se uma resposta for negativa, a tela deve ser ajustada antes de seguir.

## Regra de Evolucao

Este documento e contrato visual. Mudancas relevantes na identidade, no shell, em componentes UIX ou em padroes de modulo devem atualizar este guia junto com a implementacao.

Quando houver duvida, escolher a opcao que faz o Careli Hub parecer mais institucional, mais operacional e mais consistente.
