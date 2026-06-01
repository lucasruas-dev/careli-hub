# Panteon - governanca multiagente v2

Assunto: [Zeus] governanca multiagente v2

Status: `RASCUNHO OPERACIONAL / AGUARDANDO APROVACAO DO LUCAS`

Base: `docs/operations/panteon-production-snapshot-2026-05-30.md`

## Regra central

Todo agente deve atuar por modulo, bloco e protocolo. Nenhum agente deve publicar root misto, alterar producao, mover alias, mexer em env, secret, banco, migration, Supabase ou Vercel sensivel sem autorizacao explicita do Lucas.

Cada modulo do Hub tem um agente construtor. Zeus e o modulo/agente master em `ops.c2x.app.br/zeus`: controla engenharia, Data, Infra, SupportOps, homologacao, producao, riscos, recortes e incidentes. Hefesto auxilia Zeus em release/producao. Athena e a central dos agentes de IA conectados a OpenAI e atua por contrato dentro dos modulos.

Contrato operacional inicial: `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`.
Contrato Athena/Iris Caca: `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`.
Contrato Athena/Hades Copilot: `docs/operations/panteon-athena-hades-copilot-contract-2026-05-30.md`.
Contrato Athena/Chronos Minutes: `docs/operations/panteon-athena-chronos-minutes-contract-2026-05-30.md`.
Contrato Athena/logs seguros: `docs/operations/panteon-athena-logs-payload-safe-contract-2026-05-30.md`.

## Estado atual

- Producao congelada em `dpl_GpLQK812ChTr53ZGmqhrDefbjx4n`.
- Rollback imediato: `dpl_FoWV8qikCmJbxSyEFYa4z3AeLrs6`.
- Marco de codigo: `e5c7ac3 fix(chronos): restore google calendar fidelity`.
- Marco de registro: `a145058 docs(zeus): register chronos google calendar production deploy`.
- Root `homolog`: atrasado e misto; bloqueado para deploy.

## Papeis

### Lucas

- Autoridade final de negocio e producao.
- Aprova operacoes sensiveis.
- Aprova protocolos para Preview, Homo e Producao.
- Decide conflitos entre recortes e prioridade de squads.

### Zeus

- Modulo do Hub e guardiao operacional.
- Braco direito do Lucas para engenharia, Data, Infra, SupportOps, incidentes, governanca e controle.
- Opera no dominio `ops.c2x.app.br/zeus`.
- Coordena Safety Gate, snapshots, homologacao compartilhada, incidentes, rollback planejado e protecao de aliases.
- Pode diagnosticar Vercel, Supabase, banco, envs, logs e APIs de forma nao destrutiva.
- Mantem operacoes sensiveis `BLOQUEADO` ate autorizacao explicita.
- Nao substitui dono de modulo para feature de produto.

### Hefesto

- Auxiliar operacional do Zeus para release.
- Promove producao somente por protocolo homologado, validado e autorizado.
- Inspeciona `c2x.app.br` e `ops.c2x.app.br` antes e depois de qualquer deploy de producao.
- Executa healthchecks finais e registra rollback.
- Bloqueia commit, pacote ou worktree misto.

### Athena

- E a central dos agentes de IA conectados a OpenAI.
- Atua em IA, analise, copilots e agentes inteligentes.
- Nao altera codigo fora de recorte aprovado.
- Nao consome ou registra secrets, tokens ou payload sensivel desnecessario.
- Deve seguir owner do modulo quando IA tocar produto.
- E uma camada transversal: nao substitui Hades, Iris, Chronos, Zeus ou outro owner de produto.
- Opera pelo contrato `AT-20260530-001-ATHENA-ZEUS-CONTRACT` e por contratos derivados por modulo, incluindo `AT-20260530-002-ATHENA-IRIS-CACA`, `AT-20260530-003-ATHENA-HADES-COPILOT`, `AT-20260530-004-ATHENA-CHRONOS-MINUTES` e `AT-20260530-005-ATHENA-LOGS-PAYLOAD-SAFE`.

### Agentes de modulo

- Sao os construtores dos modulos do Hub.
- Implementam somente o modulo/bloco autorizado.
- Validam localmente.
- Criam ou atualizam `protocolId`.
- Entregam handoff com arquivos, validacoes, riscos e rollback.
- Podem gerar Preview do proprio recorte somente quando Lucas autorizar.
- Nao movimentam `homo.c2x.app.br` como rotina.

## Ambientes

- `localhost`: validacao local, nunca Preview nem homologacao.
- `Preview Vercel`: deployment publico/imutavel de recorte candidato.
- `https://homo.c2x.app.br`: alias compartilhado de homologacao, coordenado por Zeus.
- `https://c2x.app.br` e `https://ops.c2x.app.br`: producao compartilhada, coordenada por Hefesto ou Zeus apenas quando Lucas autorizar diretamente.

## Unidade oficial de trabalho

Todo trabalho deve ter:

- modulo dono;
- bloco funcional;
- `protocolId`;
- worktree e branch;
- arquivos incluidos;
- arquivos excluidos;
- validacoes;
- riscos e pendencias;
- rollback;
- status;
- decisao de Lucas quando houver Preview, Homo ou Producao.

Formato recomendado:

```text
<MODULO>-<YYYYMMDD>-<NNN>-<TEMA>
```

Exemplo:

```text
ZEUS-20260530-001-FOTOGRAFIA-REESTRUTURACAO
```

## Regras de bloqueio

Status inicial `BLOQUEADO` quando envolver:

- production deployment;
- alias, dominio, Vercel, Preview protegido ou rollback;
- Supabase, banco, migration, RLS, Storage ou service role;
- env, secret, token, bearer, chave externa ou `POSTGRES_URL`;
- API externa com acao real;
- recorte misto;
- root atrasado;
- worktree sujo;
- divergencia entre diario, Git e deployment vigente.

## Root e worktrees

Regras:

- O root principal nao e local padrao para agentes trabalharem simultaneamente.
- Cada agente deve confirmar `cwd`, branch e status ao iniciar.
- Worktree sujo bloqueia deploy ate separar recorte limpo.
- `.codex-deploy/*` e `.codex-artifacts/*` sao evidencia operacional e nao devem ser removidos sem inventario e autorizacao.
- Pacote limpo deve declarar base, inclusoes, exclusoes, validacoes e rollback.

## Modulos oficiais do Hub

Lista validada pelo Lucas a partir do sidebar:

- Panteon
- Zeus
- Apolo
- Ares
- Atlas
- Chronos
- Hades
- Hermes
- Iris

Athena, Hefesto e Setup sao camadas/squads/areas operacionais governadas, mas nao entram nesta lista como modulos do sidebar. Zeus e modulo do Hub e tambem agente operacional.

Documento operacional complementar: `docs/operations/panteon-module-agent-map.md`.
Manifesto inicial de fronteiras: `docs/operations/panteon-module-boundary-manifest-v1.json`.

## Modelo de fronteira por recorte

Antes de editar, todo agente deve declarar:

- modulo;
- agente dono;
- bloco/capacidade;
- arquivos incluidos;
- arquivos excluidos;
- se Athena participa e em quais arquivos de IA;
- se Zeus precisa atuar como Data/Infra/Safety Gate;
- se Hefesto sera necessario para release/producao.

Um recorte fica `BLOQUEADO` quando toca arquivo fora do manifesto de fronteira sem declarar cross-module e sem aprovacao do Zeus.

## Ownership inicial por modulo e camada

| Modulo | Owner operacional | Pastas principais | Observacao |
| --- | --- | --- | --- |
| Panteon | Zeus / Hub Shell | `apps/hub/app/page.tsx`, `apps/hub/layouts`, `apps/hub/lib/operational-home.ts`, registry compartilhado | Home principal, shell, launcher, topbar/sidebar e cockpit operacional. |
| Zeus | Zeus | `apps/hub/modules/squadops`, `apps/hub/lib/squadops`, `apps/hub/app/zeus`, `apps/hub/app/api/zeus`, `docs/operations` | Modulo do Hub e agente operacional: Operations Center, SupportOps, DataOps, InfraOps e governanca. |
| Apolo | Apolo Core | `apps/hub/modules/apolo`, `apps/hub/lib/apolo`, `apps/hub/app/apolo`, `apps/hub/app/api/apolo` | Cadastro mestre, CRM e relacoes C2X. |
| Ares | Ares Core | `apps/hub/modules/ares`, `apps/hub/lib/ares`, `apps/hub/app/ares`, `apps/hub/app/api/ares` | Pessoas, dimensoes, bases financeiras e estrutura operacional. |
| Atlas | Atlas Core | `apps/hub/modules/atlas`, `apps/hub/lib/atlas`, `apps/hub/app/atlas`, `apps/hub/app/api/atlas` | Indicadores, FPE, desempenho, ocorrencias e evidencias. |
| Chronos | Chronos Core | `apps/hub/modules/chronos`, `apps/hub/lib/chronos`, `apps/hub/app/chronos`, `apps/hub/app/api/chronos` | Agenda, salas, Drive, Google Agenda, gravacoes e atas. |
| Iris | Iris Core | `apps/hub/modules/caredesk`, `apps/hub/lib/iris`, `apps/hub/app/iris`, `apps/hub/app/api/iris` | Atendimento, Meta/WhatsApp e Caca. |
| Hades | Hades Core | `apps/hub/modules/guardian`, `apps/hub/lib/guardian`, `apps/hub/app/hades`, `apps/hub/app/guardian`, `apps/hub/app/api/hades`, `apps/hub/app/api/guardian` | Cobranca, atendimento financeiro, Asaas/D4Sign, carteira, acordos e legado tecnico Guardian. |
| Hermes | Hermes Core | `apps/hub/components/pulsex`, `apps/hub/lib/pulsex`, `apps/hub/app/hermes`, `apps/hub/app/api/hermes` | Mensagens, threads, realtime e chamadas. |
| Hefesto | Hefesto | `docs/operations/releases-production.md`, pacotes `.codex-deploy/*` | Camada operacional: producao, healthchecks e rollback. |
| Athena | Athena / owner do modulo consumidor | `apps/hub/lib/hub-ai`, `apps/hub/app/api/ai`, rotas `copilot`, agentes de modulo como Chronos Minutes, Iris Caca e evidence analysis | Agente/camada transversal de IA, prompts, copilots, transcricao, resumo e analise; muda produto somente com owner do modulo. |
| Setup | Setup | `apps/hub/app/setup`, `apps/hub/lib/setup`, `apps/hub/app/api/setup` | Area operacional de configuracao: usuarios, permissoes e departamentos. |

## Handoff minimo para Zeus/Hefesto

```text
Handoff:

- Assunto:
- Modulo/agente:
- ProtocolId:
- Worktree/branch:
- Commit:
- Ambiente:
- Escopo:
- Arquivos incluidos:
- Arquivos excluidos:
- Validacoes:
- Preview URL/deployment id:
- expectedDeploymentId de homo:
- Rollback:
- Riscos:
- Pendencias:
- Status:
```

## Gates obrigatorios atuais

- `git status --short --branch`
- `git worktree list`
- `git diff --check`
- conferir `docs/operations/panteon-module-boundary-manifest-v1.json`
- `npm.cmd run check-types:hub`
- `npm.cmd run lint:hub`
- `npm.cmd run build --workspace @repo/hub`
- `node scripts/homologation-safety-gate.mjs --manifest <manifesto>` quando houver Preview/Homo
- `npx.cmd vercel inspect <alias>` antes/depois quando houver alias/deploy autorizado

## Fonte viva

- Diario: `docs/operations/engineering-operations.md`
- Homologacao: `docs/operations/releases-homologation.md`
- Producao: `docs/operations/releases-production.md`
- Snapshot atual: `docs/operations/panteon-production-snapshot-2026-05-30.md`
- Plano: `docs/operations/panteon-engineering-restructure-plan.md`
- Protocolos: `docs/operations/panteon-recorte-protocols.md`
- Contrato Athena/Zeus: `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`
- Contrato Athena/Iris Caca: `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`
- Contrato Athena/Hades Copilot: `docs/operations/panteon-athena-hades-copilot-contract-2026-05-30.md`
- Contrato Athena/Chronos Minutes: `docs/operations/panteon-athena-chronos-minutes-contract-2026-05-30.md`
- Contrato Athena/logs seguros: `docs/operations/panteon-athena-logs-payload-safe-contract-2026-05-30.md`

Conclusao:

- A governanca v2 transforma o trabalho multiagente em recortes auditaveis por owner, protocolo e ambiente.
- O impacto pratico e reduzir risco de sobrescrever producao, misturar modulos e publicar de root errado.
- A proxima acao e Lucas aprovar o protocolo documental inicial para Zeus consolidar a base sem mexer em produto.
