# Parecer Guardian - deploy completo bloqueado em 2026-05-18

## Decisao Guardian

Mantenho o deploy completo `BLOQUEADO`.

Minha leitura atual do parecer de ReleaseOps e DataOps:

- o caso critico de codigo era Chronos auth/fallback e ja recebeu resposta do `Chronos Core`;
- o parecer inicial de banco/processo foi encaminhado ao DataOps e ja retornou;
- a conclusao DataOps devolve a decisao de RLS para `Chronos Core` antes de qualquer dry-run/apply real da `0019`.

## Atualizacao apos parecer DataOps

DataOps concluiu analise local/documental, sem consultar ou alterar Supabase real, Vercel env ou Production.

Decisao atualizada:

- `0019_chronos_core.sql` nao deve ser aplicada em Supabase real ainda;
- o DDL da `0019` nao depende tecnicamente da correcao de auth, mas o uso operacional depende;
- a `0019` tem RLS amplo: `hub_users.status=active` le dados Chronos, e `admin/leader/operator` gerencia tudo;
- Chronos Core deve confirmar ou restringir esse RLS antes de producao;
- `0020_remove_pulsex_department_announcement_channels.sql` pode seguir separada da `0019`, mas so junto/depois do recorte PulseX/Setup que filtra esses canais no app;
- DataOps liberou apenas dry-run local/temporario, nao apply real;
- qualquer aplicacao em Supabase real segue exigindo autorizacao explicita do Lucas.

## Atualizacao apos resposta Chronos Core

Chronos Core registrou hotfix `Fallback admin local fail-closed`.

Resultado verificado:

- `authorizeChronosRequest` retorna 503 seguro quando Supabase server-side esta ausente;
- `SUPABASE_SERVICE_ROLE_KEY` e normalizada com `trim`;
- fallback local exige `CHRONOS_ENABLE_LOCAL_FALLBACK=true`, `NODE_ENV=development` e runtime nao publicado;
- em production/runtime publicado, fallback admin local permanece bloqueado;
- validacoes do Chronos passaram conforme registro no diario.

Gate atual: `AGUARDANDO CHRONOS` para decisao de RLS da `0019`.

## O que e critico agora

### Critico 1 - Chronos Core - respondido

Motivo: `apps/hub/lib/chronos/server.ts` retorna usuario local admin quando Supabase server-side nao esta configurado, desde que exista qualquer bearer nao vazio. Isso nao pode chegar em Production.

Decisao: Chronos Core ja corrigiu o fallback para falhar fechado. Pendencia restante do Chronos e decidir/ajustar o modelo de RLS da `0019` antes de devolver para DataOps.

### Critico 2 - Hub DataOps - respondido

Motivo: existem migrations pendentes:

- `packages/database/migrations/0019_chronos_core.sql`
- `packages/database/migrations/0020_remove_pulsex_department_announcement_channels.sql`

Decisao: DataOps ja emitiu parecer inicial sem aplicar migration. Como Chronos Core fechou auth/fallback, proximo passo e Chronos Core confirmar ou restringir RLS da `0019`; depois DataOps pode reavaliar dry-run local/temporario.

## O que nao precisa virar prompt de dev agora

- PulseX, Setup, Hub Shell, IA e SquadOps aparecem no worktree, mas neste parecer nao ha evidencia de falha critica equivalente ao Chronos.
- Esses recortes devem ser separados por `Hub ReleaseOps`, nao corrigidos por varios devs antes de existir um bloqueio tecnico concreto.
- `Guardian Core` e `CoreDesk Core` nao entram neste caso.
- Governanca documental pode seguir como commit isolado por `Hub ReleaseOps`, sem deploy.

## Prompt historico - Chronos Core respondido

```text
Assunto:
[Chronos] Fechar auth fallback e RLS antes de release

Contexto:
ReleaseOps bloqueou o deploy completo porque Chronos tem risco de producao. DataOps avaliou a migration `0019_chronos_core.sql` e confirmou que ela nao deve ser aplicada em Supabase real ainda.

Riscos confirmados:
- `apps/hub/lib/chronos/server.ts` cria usuario local admin quando Supabase server-side nao esta configurado e existe qualquer bearer nao vazio;
- isso deve falhar fechado em Production;
- a migration `0019` tem RLS amplo: qualquer `hub_users.status=active` le dados Chronos, e `admin/leader/operator` gerencia tudo;
- para reunioes executivas, atas e transcricoes, Chronos Core deve confirmar ou restringir esse modelo antes de producao.

Objetivo:
corrigir Chronos para nunca aceitar fallback admin local em ambiente publicado/Production e validar se o RLS da `0019` esta aceitavel ou precisa ser reduzido antes de homologacao/producao.

Escopo:
- `apps/hub/lib/chronos/server.ts`
- `apps/hub/app/api/chronos/meetings/route.ts`, se precisar ajustar resposta de erro
- `apps/hub/modules/chronos/ChronosPage.tsx`, apenas se precisar ajustar UX do erro
- `packages/database/migrations/0019_chronos_core.sql`, apenas para revisar/propor ajuste de RLS, sem aplicar

Regras:
- Production deve retornar erro seguro quando Supabase server-side estiver ausente;
- fallback local, se mantido, deve ficar restrito a desenvolvimento local com flag explicita;
- validar se o client server-side deve usar resolvedor seguro de env em vez de ler apenas `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`;
- revisar o RLS da `0019`: confirmar se leitura por todo `hub_user active` e escrita por `admin/leader/operator` e aceitavel ou propor ajuste;
- nao aplicar migration `0019`;
- nao alterar Vercel env;
- nao alterar Supabase;
- nao publicar deploy;
- nao mexer em PulseX, Setup, Hub Shell, SquadOps, Guardian ou CareDesk.

Validar:
- `npm.cmd run check-types:hub`
- `npm.cmd run lint:hub`
- `npm.cmd run build --workspace @repo/hub`
- smoke local confirmando que Chronos sem auth/config segura falha fechado.

Retorno esperado:
- arquivos alterados;
- como o fallback foi bloqueado;
- parecer sobre RLS da `0019`;
- se precisa ajustar a migration antes de dry-run/homologacao;
- validacoes executadas;
- riscos remanescentes;
- status para DataOps avaliar `0019`.

Status esperado:
AGUARDANDO DATAOPS ou BLOQUEADO
```

## Prompt ativo - Chronos Core RLS da 0019

```text
Assunto:
[Chronos] Definir RLS da 0019 antes de dry-run

Contexto:
Chronos Core ja corrigiu o fallback admin local para falhar fechado em runtime publicado. DataOps avaliou `0019_chronos_core.sql` e concluiu que o bloqueio agora e operacional: antes de aplicar/dry-run em ambiente real, Chronos Core precisa confirmar ou restringir o RLS da `0019`.

Objetivo:
definir se o RLS atual da `0019` e aceitavel para Chronos ou se precisa ajuste antes de voltar para DataOps.

Regras:
- nao aplicar migration;
- nao alterar Supabase;
- nao alterar dados reais;
- nao executar seed real;
- nao alterar Vercel env;
- nao expor secrets.

Avaliar:
- se a leitura de todas as tabelas Chronos por qualquer `hub_user active` e aceitavel;
- se escrita por `admin/leader/operator` e aceitavel para reunioes executivas, atas e transcricoes;
- se deve restringir por permissoes `chronos:view`/`chronos:manage`, host/participante ou admin;
- se a migration `0019` precisa ajuste antes de dry-run/homologacao;
- se a decisao for manter o RLS amplo, justificar tecnicamente e operacionalmente;
- se a decisao for restringir, alterar/propor ajuste apenas na migration `0019`, sem aplicar.

Retorno esperado:
- decisao de RLS da `0019`;
- arquivos alterados, se houver;
- justificativa;
- riscos remanescentes;
- se pode devolver para DataOps realizar dry-run local/temporario;
- confirmar que apply real segue proibido sem autorizacao explicita do Lucas.

Status esperado:
AGUARDANDO DATAOPS ou BLOQUEADO
```

## Proxima decisao apos retornos

Quando `Chronos Core` responder:

- se RLS da `0019` estiver confirmado/ajustado, `Hub InfraOps` reavalia o gate;
- se o gate liberar, `Hub DataOps` pode fazer dry-run local/temporario da `0019` conforme autorizacao operacional;
- se o deploy desejado nao incluir Chronos nem migrations, `Hub ReleaseOps` pode publicar somente recortes limpos e autorizados;
- deploy completo continua bloqueado enquanto houver recortes misturados, migration pendente sem parecer ou fallback inseguro.
