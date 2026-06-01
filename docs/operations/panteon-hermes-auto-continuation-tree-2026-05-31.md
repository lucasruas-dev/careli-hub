# Panteon Hermes - Arvore de Continuidade Automatica

Assunto: [Hermes] arvore automatica de continuidade

Status: `ATIVO_LOCAL / SEM DEPLOY / SEM OPERACAO SENSIVEL`

Esta arvore transforma a sequencia de recortes do Hermes em uma fila operacional
auditavel. Ela permite continuidade automatica apenas enquanto o trabalho estiver
dentro de codigo/documentacao local, com recortes pequenos, validacao registrada
e sem tocar ambiente critico.

## Escopo

- Modulo: Hermes.
- Nome tecnico legado: PulseX.
- Frente atual: mensagens, threads, notificacoes, presenca, chamadas e realtime.
- Caminhos permitidos pelo manifesto de fronteira:
  - `apps/hub/components/pulsex/**`
  - `apps/hub/lib/pulsex/**`
  - `apps/hub/app/hermes/**`
  - `apps/hub/app/pulsex/**`
  - `apps/hub/app/api/hermes/**`
  - `apps/hub/app/api/pulsex/**`
  - `packages/realtime/**`
- Coordenacao: Hermes Core, com registro no diario canonico e visibilidade para
  Zeus.
- Homologacao: deixada para o final, conforme orientacao do Lucas.

## Regras de continuidade automatica

O agente pode seguir sem nova pergunta quando todas as condicoes forem verdadeiras:

- o recorte for local, estrutural e reversivel;
- os arquivos estiverem dentro do escopo Hermes/PulseX, mais documentos
  operacionais do Panteon;
- nao houver criacao, edicao ou leitura de valores sensiveis;
- nao houver deploy, Preview, homologacao, producao, Vercel alias, Supabase admin,
  banco real, migration, env, secret, token, dominio ou integracao externa real;
- o comportamento funcional existente for preservado ou melhorado sem mudar
  contrato externo;
- o recorte tiver manifesto, registro nesta arvore, registro no diario e validacao
  local.

## Regras de parada

O agente deve parar e devolver status ao Lucas quando ocorrer qualquer item:

- falha em `check-types`, lint, build, manifesto, boundary check ou smoke local;
- necessidade de deploy, Preview, homologacao, producao, alias, dominio, env,
  secret, banco real, migration, service role ou chave externa;
- alteracao funcional em permissao, sessao/token, Supabase admin, schema real,
  chamadas externas ou realtime sensivel;
- aumento de escopo para Chronos, Hades, Iris, Zeus, Setup, Atlas ou outro modulo
  sem novo recorte explicito;
- Browser/Chrome visual for obrigatorio para assinar uma entrega e o conector
  seguir bloqueado;
- Lucas pedir pausa, mudanca de prioridade ou homologacao.

## Fila tecnica atual

| ordem | protocolo | bloco | status | criterio de pronto |
| ----: | --------- | ----- | ------ | ------------------ |
| 1 | `MD-20260531-082-HERMES-THREAD-NOTIFICATIONS` | notificacoes de respostas e links seguros | VALIDADO_LOCAL | sino/lista de threads nao lidas, contador por mensagem, links http/https seguros, fallback de replies vazio, manifesto, diario e validacoes locais |
| 2 | `MD-20260531-083-HERMES-THREAD-NOTIFICATION-CONTRACTS` | contrato local de notificacoes de thread | VALIDADO_LOCAL | helpers/tipos movidos para `lib/pulsex/thread-notifications.ts`, workspace menor e mesmo comportamento validado |
| 3 | `MD-20260531-084-HERMES-ROUTE-API-CONTRACTS` | wrappers `/hermes`/`/pulsex` e API de mensagens | VALIDADO_LOCAL | contrato central em `lib/pulsex/routes.ts`, aliases preservados e fetches sem hardcode local |
| 4 | `MD-20260531-085-HERMES-DATA-CLIENT` | client de dados Hermes | VALIDADO_LOCAL | `fetchHermesMessagesApi` centraliza sessao, Authorization, JSON e parse seguro sem alterar payload, endpoint ou schema |
| 5 | `MD-20260531-086-HERMES-WORKSPACE-DECOMPOSITION` | `pulsex-workspace.tsx` | VALIDADO_LOCAL | helpers puros de reacao, merge/sort, entrega/leitura e unread count movidos para `lib/pulsex/workspace-messages.ts` sem mudar UX |
| 6 | `MD-20260531-087-HERMES-REALTIME-CONTRACTS` | contratos realtime | VALIDADO_LOCAL | `broadcastHermesMessage` movido para `lib/pulsex/realtime.ts`, `@repo/realtime` validado e canal/payload preservados |

## Perfil de validacao por recorte

- `npm.cmd run check-types:hub`
- ESLint focado nos arquivos do recorte dentro de `apps/hub`
- `npm.cmd run lint:hub`
- `node scripts/panteon-recorte-manifest-check.mjs --manifest <manifesto>`
- `node scripts/panteon-boundary-check.mjs --module hermes --allow zeus --files <arquivos>`
- `git diff --check -- <arquivos>`
- build local do Hub com worker reduzido quando houver codigo:
  `$env:CIRCLE_NODE_TOTAL='2'; npm.cmd run build --workspace @repo/hub`
- smoke HTTP local via `next start` temporario nas rotas Hermes/PulseX
  relevantes

## Evidencia atual

- Recortes Hermes registrados ate
  `MD-20260531-087-HERMES-REALTIME-CONTRACTS`.
- Ultimo estado validado: ESLint focado, `check-types:hub`, `lint:hub`, build
  local e smoke HTTP local aprovados.
- Browser/in-app visual segue bloqueado por falha do conector `node_repl/browser`
  no sandbox durante bootstrap; nao substitui homologacao final.

## Conclusao

- Esta arvore autoriza continuidade automatica apenas para recortes locais,
  pequenos e auditaveis do Hermes.
- O impacto pratico e permitir que Hermes avance apos Hades sem abrir risco de
  publicar, trocar env, tocar banco ou alterar comportamento sensivel.
- Nao precisa de acao imediata do Lucas enquanto os recortes seguirem dentro das
  regras acima; Hermes esta fechado localmente ate
  `MD-20260531-087-HERMES-REALTIME-CONTRACTS`. Proxima acao tecnica local:
  varredura final do Hermes ou abertura de novo bloco, conforme prioridade do
  Hub.
