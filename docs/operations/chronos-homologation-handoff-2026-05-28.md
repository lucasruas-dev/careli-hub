# Chronos - handoff de homologacao

Assunto: [Chronos] Preparacao para homologacao

- Modulo: Chronos.
- Agente responsavel: Chronos Core.
- Protocolo: CHRONOS-20260528-009-RESERVA-CICLO-DRIVE.
- Ambiente atual: local.
- Status do pacote: PREPARADO / BLOQUEADO PARA PUBLICACAO DIRETA.
- Data de preparo: 2026-05-28 01:43:48 -03:00.

## Objetivo do recorte

Preparar o Chronos V1 para validacao em homologacao com:

- sidebar interno do Chronos com Agenda, Salas e Drive;
- Agenda funcional com criacao de compromisso em popup, visoes de calendario e preparo Google Agenda;
- Salas fixas com criacao, edicao, exclusao, link externo curto e fundo institucional;
- perfis oficiais fixos: Alinhamento, Resultado e Comunicado;
- sala externa por URL `/chronos/<slug>`;
- pre-entrada com nome/empresa para convidados e preferencias de fundo;
- sala de chamada com controles no padrao Hermes, gravacao local, chat, encerramento pelo host e ciclo formal por reserva;
- Drive organizado por gravacoes e atas;
- preparo de persistencia para gravacoes, chat, transcricoes, preferencias e atas;
- pipeline Athena/OpenAI preparado para transcricao e rascunho de ata revisavel.

## Arquivos incluidos no recorte Chronos

- `apps/hub/app/chronos/page.tsx`
- `apps/hub/app/chronos/[roomSlug]/page.tsx`
- `apps/hub/app/api/chronos/google-calendar/authorize/route.ts`
- `apps/hub/app/api/chronos/google-calendar/status/route.ts`
- `apps/hub/app/api/chronos/meetings/agent/route.ts`
- `apps/hub/app/api/chronos/profiles/route.ts`
- `apps/hub/app/api/chronos/public/rooms/[roomSlug]/chat/route.ts`
- `apps/hub/app/api/chronos/public/rooms/[roomSlug]/close/route.ts`
- `apps/hub/app/api/chronos/public/rooms/[roomSlug]/join/route.ts`
- `apps/hub/app/api/chronos/public/rooms/[roomSlug]/recording/route.ts`
- `apps/hub/app/api/chronos/public/rooms/[roomSlug]/recording/upload/route.ts`
- `apps/hub/app/api/chronos/public/rooms/[roomSlug]/transcript/route.ts`
- `apps/hub/app/api/chronos/rooms/route.ts`
- `apps/hub/lib/chronos/client.ts`
- `apps/hub/lib/chronos/google-calendar.ts`
- `apps/hub/lib/chronos/server.ts`
- `apps/hub/lib/chronos/types.ts`
- `apps/hub/modules/chronos/ChronosExternalRoomPage.tsx`
- `apps/hub/modules/chronos/ChronosPage.tsx`
- `apps/hub/package.json`
- `package-lock.json`
- `packages/database/migrations/0034_chronos_drive_chat_storage.sql`
- `docs/architecture/api-connection-governance.md`
- `docs/architecture/environment-governance.md`
- `docs/operations/engineering-operations.md`
- `docs/operations/releases-homologation.md`
- `docs/operations/panteon-recorte-protocols.md`
- `docs/operations/chronos-homologation-safety-gate-draft-2026-05-28.json`
- `docs/operations/chronos-homologation-handoff-2026-05-28.md`
- `.codex-deploy/chronos-homolog-20260528-0143/homologation-safety-gate.draft.json`

## Arquivos com atencao especial

- `turbo.json`: o diff atual mistura envs Chronos/Google com envs Iris. Nao copiar o arquivo inteiro para o pacote limpo sem reconciliar. Para o recorte Chronos, considerar somente:
  - `GOOGLE_CALENDAR_CLIENT_ID`
  - `GOOGLE_CALENDAR_CLIENT_SECRET`
  - `GOOGLE_CALENDAR_PRIMARY_CALENDAR_ID`
  - `GOOGLE_CALENDAR_REDIRECT_URI`
  - `GOOGLE_CALENDAR_SCOPES`
  - `HUB_CHRONOS_MINUTES_MODEL`
  - `HUB_CHRONOS_TRANSCRIPTION_MODEL`
- `packages/database/migrations/0034_chronos_drive_chat_storage.sql`: preparada, mas nao aplicada. DataOps deve revisar/aprovar antes de qualquer Supabase/Storage real.

## Arquivos excluidos

- Hades, Hermes, PulseX, Iris, Setup, SquadOps, Guardian, CareDesk, Atlas, Apolo, Ares e Zeus.
- `apps/hub/layouts/hub-shell.tsx`, pois o diff atual contem liberacao/role de modulo nao isolada no Chronos.
- `packages/shared/src/modules/registry.ts`, pois o diff atual e de Ares/Financeiro, nao de Chronos.
- migrations `0030`, `0031`, `0032` e `0033`, pois pertencem ao Ares.
- qualquer `.env`, secret, token, chave, alias, dominio, Vercel, Supabase remoto, Storage remoto, Google OAuth real ou OpenAI real.

## Validacoes ja executadas

- `npx.cmd eslint modules/chronos/ChronosExternalRoomPage.tsx modules/chronos/ChronosPage.tsx lib/chronos/server.ts lib/chronos/types.ts "app/api/chronos/public/rooms/[roomSlug]/chat/route.ts" "app/api/chronos/public/rooms/[roomSlug]/recording/upload/route.ts" "app/api/chronos/public/rooms/[roomSlug]/close/route.ts" --max-warnings 0`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`.
- `npm.cmd run check-types:hub`: OK.
- `npm.cmd run lint:hub`: OK, com warning conhecido `MODULE_TYPELESS_PACKAGE_JSON`.
- `npm.cmd run build --workspace @repo/hub`: OK, com warning conhecido Turbopack/NFT em `next.config.ts` ligado a SquadOps/Engineering Operations.
- `git diff --check -- apps/hub/lib/chronos/server.ts apps/hub/lib/chronos/types.ts apps/hub/modules/chronos/ChronosPage.tsx apps/hub/modules/chronos/ChronosExternalRoomPage.tsx "apps/hub/app/api/chronos/public/rooms/[roomSlug]/close/route.ts" packages/database/migrations/0034_chronos_drive_chat_storage.sql`: OK, apenas warnings CRLF conhecidos no Windows.
- Smoke local `GET http://localhost:3001/chronos`: HTTP 200 OK.
- Smoke local `GET http://localhost:3001/chronos/lideranca`: HTTP 200 OK.
- Smoke local `POST http://localhost:3001/api/chronos/public/rooms/lideranca/close` sem auth/body valido: HTTP 400 esperado.

## Validacao bloqueada

- Browser automatizado para screenshot/inspecao visual local: bloqueado pelo runtime com `spawn setup refresh`.
- Safety Gate de homologacao completo: bloqueado porque ainda nao existe pacote limpo/Preview URL/deployment esperado e a alias `homo.c2x.app.br` nao foi inspecionada nesta preparacao.
- O manifesto rastreavel esta em `docs/operations/chronos-homologation-safety-gate-draft-2026-05-28.json`; o espelho local em `.codex-deploy/` existe apenas para execucao futura do gate.

## Bloqueios para subir direto

- Worktree raiz esta misto, com alteracoes de varias squads e arquivos nao Chronos.
- Branch local `homolog` esta 13 commits atras de `origin/homolog`.
- Migration `0034` e Storage `chronos-drive` dependem de DataOps.
- Google Agenda e Athena/OpenAI dependem de envs server-side por ambiente, sem valores no repositorio.
- `turbo.json` mistura envs Chronos e Iris no mesmo diff.
- Nenhum deploy, Preview, alias ou Supabase remoto foi executado nesta preparacao.

## Sequencia recomendada para Zeus/DataOps

1. DataOps revisar `packages/database/migrations/0034_chronos_drive_chat_storage.sql`.
2. Lucas autorizar explicitamente qualquer aplicacao real em Supabase/Storage de homologacao.
3. Criar pacote limpo a partir da base aprovada de homologacao, preferencialmente `origin/homolog` atualizado.
4. Aplicar somente os arquivos Chronos listados neste handoff.
5. Reconciliar `turbo.json` para incluir apenas as chaves Chronos/Google necessarias, sem carregar envs Iris por acidente.
6. Rodar validacoes no pacote limpo:
   - `npm.cmd run check-types:hub`
   - `npm.cmd run lint:hub`
   - `npm.cmd run build --workspace @repo/hub`
   - smoke `GET /chronos`
   - smoke `GET /chronos/<slug>`
   - smoke de falha fechada em rota publica sem autorizacao.
7. Zeus inspecionar `https://homo.c2x.app.br`, preencher `expectedDeploymentId` e `rollbackDeploymentId` no manifesto.
8. Gerar Preview Vercel do pacote limpo somente apos autorizacao.
9. Rodar `scripts/homologation-safety-gate.mjs` com manifesto final preenchido.
10. Zeus, nao o agente Chronos, decide movimentar `homo.c2x.app.br`.

## Rollback

- Se a homologacao falhar antes de alias: descartar Preview e manter alias atual.
- Se alias for alterado por Zeus e falhar: retornar para `rollbackDeploymentId` registrado no manifesto final.
- Rollback funcional do recorte:
  - remover rotas publicas de sala externa;
  - restaurar comportamento anterior de sala/reuniao;
  - remover uso de Storage/chat/gravacao persistida;
  - manter `0034` sem aplicar ou reverter por DataOps se ja tiver sido aplicada em homologacao.

## Status

BLOQUEADO para publicacao direta. Preparacao documental concluida para DataOps/Zeus.
