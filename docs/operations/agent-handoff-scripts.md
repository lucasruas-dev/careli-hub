# Scripts de encaminhamento para agentes

Use estes scripts para acionar cada squad sem misturar recortes. Eles ja carregam o bloqueio operacional definido por Lucas: nenhuma operacao sensivel em Vercel, Supabase, banco, Production, dominio, env, secret ou migration pode seguir sem autorizacao explicita.

## Padrao atual - modulo homologa, Hefesto produz

```text
Assunto:
[Hefesto] Promover producao por modulo homologado

Contexto:
O agente do modulo ja publicou homologacao do proprio recorte autorizado pelo Lucas e registrou no Zeus/Operations Center o modulo, pacote, atividades/protocolos, commit/deployment de homologacao, validacoes, riscos e status.

Objetivo:
promover para producao somente o recorte homologado e aprovado, mantendo fora da rodada qualquer item bloqueado, reprovado, pendente ou misturado com outro modulo.

Escopo obrigatorio:
- modulo: <Zeus/Hades/Iris/Hermes/Chronos/Atlas/Setup/outro>;
- pacote homologado: <DP/protocolo/commit>;
- atividades prontas: <AT/CB/TI/OP/AL/LO ou lista equivalente>;
- commit/deployment de homologacao;
- validacoes e healthchecks de homologacao;
- riscos conhecidos e rollback esperado.

Regras:
- confirmar que o recorte esta homologado por modulo;
- bloquear producao se o commit misturar modulo aprovado com modulo nao aprovado;
- publicar somente o aprovado;
- registrar deployment production, healthchecks, logs, rollback e status final no diario e no Operations Center quando aplicavel.

Status esperado:
EM PRODUCAO, OPERACIONAL COM ATENCAO ou BLOQUEADO com motivo tecnico concreto.
```

## 1. Hub ReleaseOps - commit da governanca documental

```text
Assunto:
[ReleaseOps] Commit isolado da governanca documental

Contexto:
O Hub InfraOps reorganizou a governanca operacional e moveu o diario vivo para `docs/operations/engineering-operations.md`. O caminho antigo `docs/codex/engineering-operations.md` ficou como ponte de compatibilidade.

Objetivo:
revisar, stagear e commitar somente o pacote documental de governanca, sem deploy e sem misturar alteracoes de produto.

Escopo permitido:
- `AGENTS.md`
- `docs/operations/README.md`
- `docs/operations/engineering-operations.md`
- `docs/operations/agent-handoff-scripts.md`
- `docs/codex/engineering-operations.md`
- `docs/architecture/agent-operating-model.md`
- `docs/architecture/security-governance.md`
- `docs/architecture/environment-governance.md`
- `docs/architecture/production-safety-policy.md`
- `docs/architecture/incident-response-policy.md`
- `docs/architecture/release-and-rollback-policy.md`
- `docs/architecture/secret-management-policy.md`

Fora de escopo:
- app code;
- Chronos;
- PulseX;
- Setup;
- Hub Shell;
- Supabase client;
- migrations;
- Vercel envs;
- deploy Preview ou Production.

Comandos esperados:
- `git status --short --branch`
- `git diff --check`
- revisar diff somente dos arquivos documentais
- criar commit semantico apenas se o recorte estiver limpo

Importante:
- nao publicar em Production;
- nao alterar Vercel;
- nao alterar Supabase;
- nao aplicar migration;
- nao expor secrets.

Retorno esperado:
- arquivos stageados/commitados;
- commit gerado, se houver;
- riscos;
- pendencias;
- status final.

Status esperado:
AGUARDANDO RELEASEOPS ou FINALIZADO
```

## 2. Hub Architect - risco Chronos auth/fallback

```text
Assunto:
[Architect] Revisar auth/fallback do Chronos antes de release

Contexto:
ReleaseOps bloqueou deploy completo porque o recorte Chronos esta misturado com outros pacotes e possui risco de producao. O achado principal: quando Supabase server-side nao esta configurado, `apps/hub/lib/chronos/server.ts` pode cair em fallback local aceitando bearer nao vazio como usuario admin local.

Objetivo:
revisar a arquitetura de autenticacao/autorizacao do Chronos e definir a correcao segura antes de qualquer homologacao ou producao.

Arquivos/areas a revisar:
- `apps/hub/lib/chronos/server.ts`
- `apps/hub/app/api/chronos/meetings/route.ts`
- `apps/hub/modules/chronos/ChronosPage.tsx`
- `packages/database/migrations/0019_chronos_core.sql`
- politicas em `docs/architecture/*`
- diario canonico `docs/operations/engineering-operations.md`

Regras obrigatorias:
- producao deve falhar fechado se Supabase server-side estiver ausente;
- nenhum fallback admin local pode ser aceito em Production;
- fallback local, se existir, deve ficar restrito e documentado para desenvolvimento local;
- nao aplicar migration;
- nao publicar deploy;
- nao alterar Vercel env;
- nao expor secrets.

Retorno esperado:
- causa do risco;
- decisao arquitetural recomendada;
- arquivos que precisam de ajuste;
- criterio de aceite para liberar Chronos;
- se precisa de DataOps antes/depois;
- riscos e pendencias.

Status esperado:
BLOQUEADO ou AGUARDANDO DATAOPS
```

## 3. Hub DataOps - avaliacao das migrations 0019 e 0020

```text
Assunto:
[DataOps] Avaliar migrations pendentes sem aplicar

Contexto:
O deploy completo foi bloqueado por conter migrations pendentes e recortes misturados:
- `packages/database/migrations/0019_chronos_core.sql`
- `packages/database/migrations/0020_remove_pulsex_department_announcement_channels.sql`

Objetivo:
avaliar impacto, ordem, riscos, dependencias e rollback dessas migrations, sem aplicar em banco real.

Escopo permitido:
- leitura das migrations;
- analise de dependencias;
- analise de RLS/grants/FKs/triggers;
- dry-run local ou revisao estatica se aplicavel;
- registrar parecer no diario canonico.

Fora de escopo:
- aplicar migration em Supabase real;
- alterar Production;
- alterar dados;
- criar, remover ou rotacionar chaves;
- executar seed real;
- publicar deploy.

Perguntas obrigatorias:
- `0019_chronos_core.sql` e reversivel? Qual rollback path?
- `0020_remove_pulsex_department_announcement_channels.sql` remove canal/dado que afeta PulseX publicado?
- as migrations podem ser aplicadas separadamente?
- existe dependencia entre Chronos e PulseX?
- homologacao deve receber qual migration primeiro?

Retorno esperado:
- parecer migration por migration;
- riscos;
- rollback path;
- ordem recomendada;
- se esta liberado para dry-run/homologacao;
- se precisa autorizacao explicita do Lucas para aplicar.

Status esperado:
AGUARDANDO DATAOPS ou BLOQUEADO
```

## 4. Hub ReleaseOps - separar PulseX, Setup e Hub Shell

```text
Assunto:
[ReleaseOps] Separar recorte PulseX Setup Hub Shell

Contexto:
O worktree atual mistura alteracoes de PulseX, Setup, Hub Shell, Supabase client, IA, Chronos, migrations e governanca. Deploy completo esta BLOQUEADO.

Objetivo:
auditar e separar um recorte publicavel que nao dependa de Chronos nem de migrations pendentes.

Areas a revisar:
- `apps/hub/app/setup/page.tsx`
- `apps/hub/components/pulsex/pulsex-workspace.tsx`
- `apps/hub/layouts/hub-shell.tsx`
- `apps/hub/lib/pulsex/supabase-data.ts`
- `apps/hub/lib/setup/data.ts`
- `apps/hub/lib/supabase/client.ts`
- `apps/hub/app/api/ai/chat/route.ts`
- `apps/hub/lib/hub-ai/client.ts`

Regras obrigatorias:
- nao incluir Chronos;
- nao incluir migrations;
- nao incluir governanca documental se ela ja estiver em commit separado;
- nao publicar Production sem autorizacao;
- nao alterar Vercel env;
- nao expor secrets.

Validacoes esperadas se o recorte ficar limpo:
- `npm.cmd run check-types:hub`
- `npm.cmd run lint:hub`
- `npm.cmd run build --workspace @repo/hub`
- smoke local se aplicavel

Retorno esperado:
- arquivos que pertencem ao recorte;
- arquivos excluidos do recorte;
- validacoes executadas;
- risco de deploy;
- proximo passo recomendado.

Status esperado:
AGUARDANDO RELEASEOPS ou BLOQUEADO
```

## 5. Hub InfraOps - gate de ambiente antes de qualquer deploy

```text
Assunto:
[InfraOps] Gate de ambiente antes de deploy

Contexto:
Ha historico recente de incidente por desalinhamento de envs Supabase/Vercel e o deploy completo atual esta bloqueado por recortes misturados, migrations e risco Chronos.

Objetivo:
executar gate de infraestrutura antes de qualquer deploy Preview/Production autorizado.

Validar:
- branch alvo;
- ambiente alvo: local, homologacao ou producao;
- se o recorte depende de env nova;
- se usa Supabase homolog ou production;
- se usa `NEXT_PUBLIC_*` somente para valores publicos;
- se usa service role/secret key somente server-side;
- se ha migration pendente;
- se ha rollback path;
- se healthcheck aplicavel existe.

Regras obrigatorias:
- iniciar como BLOQUEADO se envolver env, secret, Supabase, banco, migration, dominio, alias, Production ou protection bypass;
- nao alterar Vercel env sem autorizacao explicita do Lucas;
- nao aplicar migration;
- nao publicar Production;
- nao expor valores sensiveis.

Comandos permitidos sem expor valores:
- `git status --short --branch`
- `git diff --check`
- leitura de docs e scripts
- listagem/metadata de envs somente com nomes e ambientes, sem valores, quando autorizado

Retorno esperado:
- ambiente validado;
- pendencias de env sem valores;
- risco operacional;
- healthchecks recomendados;
- decisao: liberar recorte, bloquear ou encaminhar para DataOps/ReleaseOps/SupportOps.

Status esperado:
BLOQUEADO, AGUARDANDO RELEASEOPS ou AGUARDANDO DATAOPS
```

## 6. Hub SupportOps - smoke autenticado pos-correcao Supabase

```text
Assunto:
[SupportOps] Smoke autenticado PulseX apos correcao Supabase

Contexto:
InfraOps corrigiu o desalinhamento de envs Supabase/Vercel em Production. Healthchecks anonimos passaram, mas ainda falta smoke autenticado do PulseX com sessao real do Lucas.

Objetivo:
validar se PulseX/Auth em producao carrega canais, diretas e mensagens com usuario autenticado real.

Ambiente:
- Production `https://c2x.app.br`

Validar:
- login/logout se necessario para limpar sessao antiga;
- `/api/auth/profile` autenticado;
- PulseX abre sem "Sem canal";
- canais aparecem;
- diretas aparecem;
- mensagens carregam;
- sem erro 503 de Supabase nao configurado;
- sem exposicao de tokens no log/retorno.

Regras obrigatorias:
- nao alterar dados;
- nao alterar Vercel;
- nao alterar Supabase;
- nao expor token/JWT/chaves;
- se encontrar erro, registrar endpoint, status HTTP e mensagem sanitizada.

Retorno esperado:
- resultado do smoke;
- evidencias sanitizadas;
- impacto para usuario;
- se precisa InfraOps, DataOps ou PulseX Core.

Status esperado:
FINALIZADO ou NECESSITA CORRECAO
```

## 7. SquadOps Core - continuidade apos arquivamento do chat

```text
Assunto:
[SquadOps] Retomar Operations Center apos arquivamento do chat antigo

Contexto:
O chat anterior do SquadOps ficou pesado/lento e foi arquivado. Este novo agente deve continuar a partir do checkpoint registrado no diario canonico, sem tentar recuperar contexto do chat antigo fora do diario, dos arquivos e dos registros estruturados.

Leitura obrigatoria antes de agir:
- `AGENTS.md`
- `docs/operations/README.md`
- `docs/operations/engineering-operations.md`
- `docs/operations/squadops-center-process.md`
- `docs/architecture/design-guidelines.md`, se mexer em UI
- `apps/hub/modules/squadops/SquadOpsPage.tsx`
- `apps/hub/app/api/operations/monitoring/route.ts`
- `apps/hub/app/api/squadops/operations/route.ts`
- `apps/hub/app/api/squadops/operations/structured/route.ts`
- `apps/hub/lib/squadops/engineering-operations-source.ts`
- `packages/shared/src/modules/registry.ts`, somente leitura se nao houver mudanca de registry autorizada

Estado preservado:
- Producao OPS atual: `https://ops.c2x.app.br`.
- Ultimo recorte SquadOps em producao: commit `d169251 fix(squadops): refine monitoring risk chart`.
- Deployment Vercel Production: `dpl_HPyWL4BBuqzw8VKeYJnqf6G48G2t`.
- Alteracoes publicadas: cores semaforicas de monitoring, com vermelho reservado para critico e amarelo para medio, e grafico financeiro de linha para picos de performance.
- Sync estruturado manual ja executado: `recordsTotal=310` e `releasesUpserted=74`.
- Status no diario canonico: `PAUSADO / EM PRODUCAO`.

Objetivo do novo agente:
- Retomar SquadOps/Operations Center de forma leve e rastreavel.
- Continuar apenas o recorte explicitamente pedido pelo Lucas.
- Antes de qualquer codigo novo, mapear o diff atual e separar o que pertence a SquadOps do que pertence a Atlas, CareDesk, Home/Asana, Guardian, Setup, PulseX, shared, migrations ou artefatos locais.
- Preservar o deploy de producao atual como baseline.

Escopo permitido inicial:
- Leitura de diario, processos e arquivos SquadOps.
- `git status --short --branch`.
- `git diff -- apps/hub/modules/squadops/SquadOpsPage.tsx`.
- Leitura de rotas e servicos SquadOps/Operations Center.
- Validacao local de `/squadops` e `/api/operations/monitoring` se houver dev server ou quando for necessario.
- Ajustes somente em SquadOps quando Lucas pedir explicitamente.

Fora de escopo:
- Deploy sem autorizacao expressa.
- Vercel env, Supabase env, secrets, banco, migrations, dominio, alias ou production operation.
- Alterar Atlas, CareDesk, Home/Asana, Guardian, PulseX, Setup ou shared sem pedido claro.
- Commit com arquivos misturados.
- Reverter mudancas de outros agentes ou do Lucas.
- Expor valores sensiveis.

Regras obrigatorias:
- Comecar toda resposta com `Assunto: [SquadOps] ...`.
- Usar `docs/operations/engineering-operations.md` como diario vivo.
- Manter recorte limpo; nunca considerar entrega concluida se depender de dados estruturados sem reconciliar Operations Center.
- Se publicar recorte proprio com autorizacao explicita, atualizar `hub_engineering_operation_records`, reconciliar protocolos `AT/CB/TI/OP/AL/DP`, atualizar releases estruturadas quando aplicavel e depois registrar no diario.
- Validar com `check-types`, `lint`, `build` e smoke local/visual quando aplicavel.
- Para UI, manter densidade operacional, grafite `#101820`, acento `#A07C3B`, linguagem executiva compacta e tooltips UIX padronizados.

Checklist de retomada:
1. Ler os documentos obrigatorios.
2. Localizar no diario as entradas `[SquadOps] Linha financeira para picos de performance` e `[SquadOps] Checkpoint pausa antes de alteracao grande`.
3. Rodar `git status --short --branch`.
4. Separar mentalmente recortes paralelos e nao mexer neles.
5. Se Lucas pedir nova mudanca, implementar somente em arquivos SquadOps.
6. Validar localmente.
7. Registrar no diario canonico.
8. Entregar com status claro: `VALIDADO LOCAL`, `AGUARDANDO RELEASEOPS`, `EM PRODUCAO`, `BLOQUEADO` ou `PAUSADO`.

Retorno esperado:
- o que foi retomado;
- arquivos tocados;
- validacoes executadas;
- riscos;
- proximo passo/squad;
- status final.

Status inicial esperado:
PAUSADO / PRONTO PARA RETOMAR SQUADOPS
```
