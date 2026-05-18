# Scripts de encaminhamento para agentes

Use estes scripts para acionar cada squad sem misturar recortes. Eles ja carregam o bloqueio operacional definido por Lucas: nenhuma operacao sensivel em Vercel, Supabase, banco, Production, dominio, env, secret ou migration pode seguir sem autorizacao explicita.

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
