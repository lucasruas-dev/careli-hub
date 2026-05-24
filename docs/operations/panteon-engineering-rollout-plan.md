# Panteon - Plano Executivo de Rollout da Engenharia

Status: `PILOTO ZEUS MONTADO LOCALMENTE`
Owner: `Zeus`
Ambiente: `worktrees locais`

Este plano organiza a nova engenharia operacional do Panteon em uma esteira
executavel por agentes, sem depender do historico de chat e sem misturar
recortes de modulo.

## Objetivo

Evoluir o Panteon para uma engenharia modular com:

- worktree separado por agente;
- branch pesquisavel por recorte;
- diario canonico como fonte viva;
- release registers separados por ambiente;
- Zeus como command center;
- Hefesto como gate de producao;
- V1 `hub_agent_*` preparada, mas bloqueada ate autorizacao de migration/API.

## Estado atual

| Frente | Status | Evidencia |
| --- | --- | --- |
| Arquitetura executiva | `DOCUMENTADO LOCAL` | `docs/architecture/panteon-architecture-map.md` e board SVG |
| Worktrees por agente | `CRIADO LOCALMENTE` | `careli-hub-worktrees/<agente>` com branches `codex/*` |
| Startup de agentes | `DOCUMENTADO LOCAL` | template oficial em `panteon-agent-worktree-startup-template.md` |
| Hooks Git locais | `CONFIGURADO LOCAL` | `.githooks/` e instalador local |
| Validacao de worktree | `CONFIGURADO LOCAL` | `scripts/panteon-validate-worktree.ps1` |
| Scaffolds | `CONFIGURADO LOCAL` | `panteon-scaffold-agents.ps1` e `panteon-new-worktree.ps1` |
| Zeus command center | `EM HOMOLOGACAO TECNICA` | aba `Agentes` publicada em Vercel Preview |
| Release registers | `INTEGRADO AO ZEUS` | leitura de homologacao/producao no cockpit |
| V1 `hub_agent_*` | `DESENHO PRONTO / BLOQUEADO` | migration, banco e API mutavel dependem de autorizacao |

## Matriz de agentes

| Agente | Worktree | Papel | Gate principal |
| --- | --- | --- | --- |
| Zeus | `careli-hub-worktrees/zeus` | agente master e guardiao operacional | diario, Operations Center e governanca |
| Hefesto | `careli-hub-worktrees/hefesto` | producao, rollback e rastreabilidade | release register, healthchecks e rollback |
| Iris | `careli-hub-worktrees/iris` | atendimento e comunicacao externa | validacao funcional e handoff por modulo |
| Hades | `careli-hub-worktrees/hades` | cobrancas e inadimplencia | regra C2X preservada |
| Ares | `careli-hub-worktrees/ares` | financeiro tatico e escalonamentos | recorte financeiro sem misturar Hades |
| Hermes | `careli-hub-worktrees/hermes` | comunicacao interna e evidencias | UX de suporte validada |
| Atlas | `careli-hub-worktrees/atlas` | indicadores e performance | metrica com dado real |
| Chronos | `careli-hub-worktrees/chronos` | rotinas e agenda | execucao temporal rastreavel |
| Setup | `careli-hub-worktrees/setup` | configuracoes e permissoes | sem env/secret exposto |
| Apolo | `careli-hub-worktrees/apolo` | CRM e carteira | legado C2X preservado |

## Fluxo operacional

1. Lucas demanda o agente correto ou demanda Zeus quando houver duvida.
2. O agente abre no proprio worktree e confirma branch, status e escopo.
3. O agente implementa somente o recorte do modulo.
4. O agente valida com checklist proporcional ao risco.
5. O agente registra a decisao no diario canonico.
6. Se houver homologacao autorizada, o proprio agente publica o recorte do
   modulo e registra em `releases-homologation.md`.
7. Se ficar `PRONTO PARA PRODUCAO`, Hefesto recebe o pacote homologado,
   compara diario, release register e Git, e promove somente o recorte aprovado.
8. Zeus mantem a visao executiva da malha, bloqueios, handoffs e sinais de
   comunicacao entre agentes.

## Gates obrigatorios

- Recorte misto vira `SEPARAR` ou `BLOQUEADO`.
- Operacao com env, secret, Supabase, banco, Vercel, dominio, alias, migration,
  rollback ou producao fica `BLOQUEADO` ate autorizacao explicita.
- Producao exige homologacao previa, registro por ambiente e aprovacao humana.
- Worktree sujo nao e evidencia suficiente para publicar.
- Chat saturando exige checkpoint no diario e retomada pelo repositorio.

## Proximas etapas seguras

| Ordem | Entrega | Status |
| --- | --- | --- |
| 1 | Validar cockpit Zeus local com check-types/lint/build e publicar Preview | `CONCLUIDO` |
| 2 | Abrir primeiro ciclo real por agente prioritario | `PENDENTE` |
| 3 | Criar registros de handoff reais conforme demanda Lucas | `PENDENTE` |
| 4 | Revisar desenho V1 `hub_agent_*` antes de migration | `BLOQUEADO` |
| 5 | Autorizar migration/API em homologacao, se Lucas aprovar | `BLOQUEADO` |

## Conclusao

A nova engenharia do Panteon deixa de ser apenas combinada em chat e passa a ter
malha local rastreavel: worktrees, branches, hooks, validacoes, roadmap,
release registers e cockpit Zeus. A evolucao sensivel de banco/API permanece
protegida por gate explicito.
