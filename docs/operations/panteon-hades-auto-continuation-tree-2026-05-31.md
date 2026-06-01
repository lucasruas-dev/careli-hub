# Panteon Hades - Arvore de Continuidade Automatica

Assunto: [Hades] arvore automatica de continuidade

Status: `ATIVO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL`

Esta arvore transforma a sequencia de recortes do Hades em uma fila operacional
auditavel. Ela permite continuidade automatica apenas enquanto o trabalho estiver
dentro de codigo/documentacao local, com recortes pequenos, validacao registrada
e sem tocar ambiente critico.

## Escopo

- Modulo: Hades.
- Frente atual: decomposicao do WhatsApp operacional em
  `apps/hub/modules/guardian/attendance/components/WhatsAppConversationPanel.tsx`.
- Coordenacao: Hades Core, com registro no diario canonico e visibilidade para
  Zeus.
- Homologacao: deixada para o final, conforme orientacao do Lucas.

## Regras de continuidade automatica

O agente pode seguir sem nova pergunta quando todas as condicoes forem verdadeiras:

- o recorte for local, estrutural e reversivel;
- os arquivos estiverem dentro do escopo Hades/Guardian Attendance, mais
  documentos operacionais do Panteon;
- nao houver criacao, edicao ou leitura de valores sensiveis;
- nao houver deploy, Preview, homologacao, producao, Vercel alias, Supabase admin,
  banco real, migration, env, secret, token, dominio ou integracao externa real;
- o comportamento funcional existente for preservado;
- o recorte tiver manifesto, registro nesta arvore, registro no diario e validacao
  local.

## Regras de parada

O agente deve parar e devolver status ao Lucas quando ocorrer qualquer item:

- falha em `check-types`, lint, build, manifesto, boundary check ou smoke local;
- necessidade de deploy, Preview, homologacao, producao, alias, dominio, env,
  secret, banco real, migration, service role ou chave externa;
- alteracao funcional em Iris, Hades financeiro, Guardian DB, D4Sign, Asaas,
  Meta real ou sessao/token;
- aumento de escopo para outro modulo sem novo recorte explicito;
- Browser/Chrome visual for obrigatorio para assinar uma entrega e o conector
  seguir bloqueado;
- Lucas pedir pausa, mudanca de prioridade ou homologacao.

## Fila tecnica atual

| ordem | protocolo | bloco | status | criterio de pronto |
| ----: | --------- | ----- | ------ | ------------------ |
| 1 | `MD-20260531-058-HADES-WHATSAPP-TICKET-CLOSE-MODAL` | modal de encerramento de ticket | VALIDADO_LOCAL | componente proprio, uso no painel, manifesto, diario e validacoes locais |
| 2 | `MD-20260531-059-HADES-WHATSAPP-COMPOSER-BUTTONS` | botoes de header/composer | VALIDADO_LOCAL | botoes reutilizaveis fora do painel, sem alterar labels/acoes |
| 3 | `MD-20260531-060-HADES-WHATSAPP-OPERATION-DRAWER` | drawer operacional promessa/acordo/boleto/parcelas | VALIDADO_LOCAL | drawer isolado preservando calculos e eventos atuais |
| 4 | `MD-20260531-061-HADES-WHATSAPP-TICKET-SETUP-MODAL` | modal de abertura/complemento de ticket Iris | VALIDADO_LOCAL | modal isolado preservando templates, filas, SLA e validacoes atuais |
| 5 | `MD-20260531-062-HADES-WHATSAPP-AUTH-TOKEN-BOUNDARY` | fronteira de token Iris | BLOQUEADO_PARA_MUDANCA_FUNCIONAL | apenas refatoracao sem mudar auth; qualquer comportamento de sessao para e pede revisao |
| 6 | `MD-20260531-063-HADES-WHATSAPP-FINAL-SWEEP` | limpeza final de imports/fronteiras | VALIDADO_LOCAL | painel menor, imports coerentes, validacoes finais locais |
| 7 | `MD-20260531-064-HADES-TYPED-FOUNDATION-SURFACES` | surfaces basicas tipadas | VALIDADO_LOCAL | remover `@ts-nocheck` de componentes pequenos sem alterar comportamento visual ou regra |
| 8 | `MD-20260531-065-HADES-TYPED-LAYOUT-STATUS-FOUNDATION` | layout/status foundation tipados | VALIDADO_LOCAL | remover `@ts-nocheck` de layout, tabela simples e mapas de status/workflow |
| 9 | `MD-20260531-066-HADES-TYPED-CLIENT-ACTIONS-CARDS` | cards de cliente e acoes tipados | VALIDADO_LOCAL | remover `@ts-nocheck` de componentes pequenos de cliente sem alterar callbacks |
| 10 | `MD-20260531-067-HADES-TYPED-SIDEBAR-CONTRACTS` | sidebar e contratos tipados | VALIDADO_LOCAL | tipar menu lateral e arquivo central de tipos sem alterar rotas |
| 11 | `MD-20260531-068-HADES-TYPED-QUEUE-PANEL` | QueuePanel tipado | VALIDADO_LOCAL | remover `@ts-nocheck` do painel de fila sem alterar filtros ou callbacks |
| 12 | `MD-20260531-069-HADES-TYPED-ATTENDANCE-PAGE` | AttendancePage tipado | VALIDADO_LOCAL | remover `@ts-nocheck` do orquestrador com guards sem mudar fetch/payload |
| 13 | `MD-20260531-070-HADES-TYPED-TICKET-OPERATIONS-QUEUE` | TicketOperationsQueue tipado | VALIDADO_LOCAL | remover `@ts-nocheck` da inbox operacional sem alterar filtros, KPIs ou callbacks |
| 14 | `MD-20260531-071-HADES-TYPED-DESK-PAGE` | DeskPage tipado | VALIDADO_LOCAL | remover `@ts-nocheck` da mesa multicanal sem alterar carregamento, token ou abertura Iris/WhatsApp |
| 15 | `MD-20260531-072-HADES-TYPED-OPERATIONAL-TIMELINE` | OperationalTimeline tipado | VALIDADO_LOCAL | remover `@ts-nocheck` da timeline sem alterar eventos manuais, anexos ou salvamento |
| 16 | `MD-20260531-073-HADES-TYPED-INSTALLMENTS-CARD` | InstallmentsCard tipado | VALIDADO_LOCAL | remover `@ts-nocheck` da visao de parcelas sem alterar calculos, filtros ou Asaas |
| 17 | `MD-20260531-074-HADES-TYPED-LOCAL-DATA-SOURCE` | data.ts tipado | VALIDADO_LOCAL | remover `@ts-nocheck` da fonte local sem alterar fila, mocks ou integracoes |
| 18 | `MD-20260531-075-HADES-TYPED-MONITORING-PAGE` | MonitoringPage tipado | VALIDADO_LOCAL | remover `@ts-nocheck` do monitoramento sem alterar consultas Hades/Iris |
| 19 | `MD-20260531-076-HADES-TYPED-INTELLIGENCE-PAGE` | IntelligencePage tipado | VALIDADO_LOCAL | remover `@ts-nocheck` da inteligencia sem alterar IA, charts ou UX |
| 20 | `MD-20260531-077-HADES-TYPED-AGREEMENTS-CENTER-CARD` | AgreementsCenterCard tipado | VALIDADO_LOCAL | remover `@ts-nocheck` da central de acordos sem alterar promessas, acordos ou persistencia |
| 21 | `MD-20260531-078-HADES-TYPED-GUARDIAN-ROUTE-WRAPPERS` | wrappers Guardian tipados | VALIDADO_LOCAL | remover `@ts-nocheck` dos wrappers de rota sem alterar componentes renderizados |
| 22 | `MD-20260531-079-HADES-TYPED-AI-COPILOT-DRAWER` | AiCopilotDrawer tipado | VALIDADO_LOCAL | remover `@ts-nocheck` do drawer Athena sem alterar IA, boleto, token ou ticket TI |
| 23 | `MD-20260531-080-HADES-TYPED-CLIENT-DETAIL-PANEL` | ClientDetailPanel tipado | VALIDADO_LOCAL | remover `@ts-nocheck` do detalhe do cliente sem alterar carteira, documentos, timeline ou acordos |
| 24 | `MD-20260531-081-HADES-TYPED-WHATSAPP-CONVERSATION-PANEL` | WhatsAppConversationPanel tipado | VALIDADO_LOCAL | remover `@ts-nocheck` do painel WhatsApp sem alterar Iris, thread, checklist ou envio |

## Perfil de validacao por recorte

- `npm.cmd run check-types:hub`
- ESLint focado nos arquivos do recorte dentro de `apps/hub`
- `npm.cmd run lint:hub`
- `node scripts/panteon-recorte-manifest-check.mjs --manifest <manifesto>`
- `node scripts/panteon-boundary-check.mjs --module hades --allow iris --allow zeus --files <arquivos>`
- checagem de trailing whitespace nos arquivos do recorte
- `git diff --check -- <arquivos>`
- build local do Hub com worker reduzido quando houver codigo:
  `$env:CIRCLE_NODE_TOTAL='2'; npm.cmd run build --workspace @repo/hub`
- smoke HTTP local via `next start` temporario nas rotas Hades/Guardian/Iris
  relevantes

## Evidencia atual

- Recortes Hades ja registrados ate
  `MD-20260531-081-HADES-TYPED-WHATSAPP-CONVERSATION-PANEL`.
- Ultimo estado validado: check-types, lint, build local e smoke HTTP local
  aprovados no recorte `MD-061`; sweep documental/estrutural `MD-063`
  validado sem mudanca funcional adicional; `MD-064`, `MD-065`, `MD-066` e
  `MD-067` validaram components pequenos/contratos sem `@ts-nocheck` com
  check-types, lint e build; `MD-068` validou o primeiro painel medio sem trava;
  `MD-069` validou o orquestrador de atendimento; `MD-070` validou a inbox
  operacional de tickets; `MD-071` validou a mesa multicanal; `MD-072`
  validou a timeline operacional com anexos tipados; `MD-073` validou a visao
  de parcelas; `MD-074` validou a fonte local de dados; `MD-075` validou o
  monitoramento; `MD-076` validou a inteligencia; `MD-077` validou a central
  operacional de acordos/promessas; `MD-078` validou wrappers Guardian de
  cobranca, inteligencia e monitoramento; `MD-079` validou o drawer Athena/Copilot
  do Hades; `MD-080` validou o painel de detalhe do cliente; `MD-081`
  validou o painel WhatsApp/Iris.
- Browser/in-app visual segue registrado como bloqueado por falha recorrente do
  runtime do conector; nao substitui homologacao final.

## Conclusao

- Esta arvore autoriza continuidade automatica apenas para recortes locais,
  pequenos e auditaveis do Hades.
- O impacto pratico e reduzir o tempo de espera entre recortes sem abrir risco de
  publicar, trocar env, tocar banco ou alterar comportamento sensivel.
- Nao precisa de acao imediata do Lucas enquanto os recortes seguirem dentro das
  regras acima; a fila WhatsApp local do Hades esta fechada ate `MD-063`, a
  tipagem segura de surfaces iniciou em `MD-064`, continuou em `MD-065` e seguiu
  para cards de cliente em `MD-066`, sidebar/contratos em `MD-067`, QueuePanel
  em `MD-068`, orquestrador AttendancePage em `MD-069`, inbox operacional em
  `MD-070`, DeskPage em `MD-071`, OperationalTimeline em `MD-072` e
  InstallmentsCard em `MD-073`, data source em `MD-074`, MonitoringPage em
  `MD-075`, IntelligencePage em `MD-076`, AgreementsCenterCard em `MD-077` e
  wrappers Guardian em `MD-078`, AiCopilotDrawer em `MD-079` e
  ClientDetailPanel em `MD-080` e WhatsAppConversationPanel em `MD-081`, enquanto
  `MD-20260531-062-HADES-WHATSAPP-AUTH-TOKEN-BOUNDARY` permanece bloqueado para
  mudanca funcional.
