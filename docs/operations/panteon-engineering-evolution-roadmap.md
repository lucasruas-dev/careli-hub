# Panteon - Roadmap de Evolucao da Engenharia

Status: `ROADMAP ZEUS / PILOTO OPERACIONAL`
Owner: `Zeus`
Fonte base: `docs/architecture/panteon-architecture-map.md`

Este roadmap organiza as etapas para evoluir a engenharia do Panteon sem
perder o que ja esta em producao.

## Direcao

O Panteon passa a operar com engenharia modular, worktrees separados,
comunicacao estruturada entre agentes, homologacao por modulo e producao
protegida por Hefesto.

## Fases

| Fase | Objetivo | Entrega | Status |
| --- | --- | --- | --- |
| 0 | Registrar arquitetura executiva | Mapa Markdown e board visual SVG | `DOCUMENTADO LOCAL` |
| 1 | Formalizar worktrees separados | Modelo operacional de worktrees por agente | `DOCUMENTADO LOCAL` |
| 2 | Padronizar retomada de agentes | Template de startup e checklist por worktree | `EM EXECUCAO LOCAL` |
| 3 | Tornar Zeus o painel de comando | Aba `Agentes` com governanca de engenharia visivel | `EM EXECUCAO LOCAL` |
| 4 | Padronizar tooling de worktree | Script local de validacao com dependencias compartilhadas | `EM EXECUCAO LOCAL` |
| 5 | Preparar V1 de comunicacao | Desenho revisavel de tabelas `hub_agent_*` e API | `DESENHO LOCAL / MIGRATION BLOQUEADA` |
| 6 | Padronizar gates de validacao | Checklists por tipo de recorte | `DOCUMENTADO LOCAL` |
| 7 | Automatizar criacao de recortes | Scaffolds por agente e script seguro de worktree/branch | `SCAFFOLD OPERACIONAL` |
| 8 | Configurar hooks locais | `pre-commit`, `commit-msg` e `pre-push` | `CONFIGURADO LOCAL` |
| 9 | Integrar release registers | Homologacao/producao por modulo com status reconciliado | `PLANEJADO` |
| 10 | Expandir para agentes de modulo | Iris, Hades, Ares, Hermes, Atlas, Chronos, Apolo e Setup adotam o modelo | `PLANEJADO` |

## Fase 0 - Arquitetura executiva

Entregas:

- `docs/architecture/panteon-architecture-map.md`
- `docs/architecture/panteon-architecture-board.svg`

Criterio de aceite:

- Lucas consegue explicar a estrutura do Panteon por camadas.
- Agentes conseguem localizar worktrees, papeis e gates.
- O mapa nao substitui politicas, apenas orienta a leitura.

## Fase 1 - Worktrees separados

Entrega:

- `docs/operations/panteon-worktree-operating-model.md`

Criterio de aceite:

- Todo agente sabe quando criar worktree.
- Branches seguem `codex/<agente>/<tema>-<yyyymmdd>`.
- Worktree misto vira triagem, nao release.
- Hefesto so recebe pacote limpo para producao.

## Fase 2 - Startup padronizado

Entrega esperada:

- `docs/operations/panteon-agent-worktree-startup-template.md`

Criterio de aceite:

- Novo chat/agente consegue iniciar sem depender de historico antigo.
- O prompt obriga leitura dos documentos certos.
- O agente confirma worktree, branch, ultimo commit, escopo, fora de escopo,
  validacoes e bloqueios sensiveis.

## Fase 3 - Zeus como painel de comando

Entrega esperada:

- Aba `Agentes` do Zeus mostrando sinais de engenharia:
  - comunicacoes derivadas de registros reais;
  - bloqueios;
  - handoffs para Hefesto;
  - worktrees/branches citados;
  - recortes limpos ou pacotes mistos;
  - `CHAT SATURANDO`;
  - operacoes sensiveis bloqueadas.

Criterio de aceite:

- Lucas enxerga qual agente deve agir.
- Zeus diferencia handoff, bloqueio, auditoria e acionamento.
- O painel deixa claro quando algo e `BLOQUEADO`, `SEPARAR` ou
  `PRONTO PARA PRODUCAO`.

## Fase 4 - Tooling de worktree

Antes da V1 de banco, o tooling dos worktrees precisa ficar previsivel.

Entrega esperada:

- `scripts/panteon-validate-worktree.ps1`

Criterio de aceite:

- O worktree consegue rodar validacoes usando dependencias compartilhadas do
  repositorio principal sem instalar pacotes e sem acessar rede.
- `node_modules` compartilhado e criado apenas como junction local e somente
  com flag explicita.
- Build de worktree usa fallback `next build --webpack` por padrao quando
  houver junction, evitando panic interno do Turbopack.
- O script bloqueia se houver `node_modules` real no worktree para nao
  sobrescrever estado local.

## Fase 5 - V1 de comunicacao entre agentes

Status: `DESENHO LOCAL / MIGRATION BLOQUEADA`.

Entrega local:

- `docs/operations/panteon-agent-messaging-v1-design.md`

O desenho detalha:

- `hub_agent_threads`;
- `hub_agent_messages`;
- `hub_agent_message_links`;
- `hub_agent_message_events`;
- API futura `POST /api/zeus/agent-messages`;
- status, tipos de mensagem, seguranca, RLS futura e ordem segura de
  implementacao.

Gate:

- Lucas precisa autorizar migration, banco real e API mutavel.
- Primeiro alvo deve ser homologacao.
- Producao continua fora ate Hefesto e Lucas aprovarem.

## Fase 6 - Gates de validacao

Entrega local:

- `docs/operations/panteon-validation-checklists.md`

Criterio:

- Cada agente sabe qual validacao minima usar para docs, frontend, API,
  banco, Supabase, Vercel, homologacao, producao e incidente.
- Operacoes sensiveis continuam bloqueadas ate autorizacao explicita.
- Handoffs passam a registrar status, riscos, bloqueios e proxima squad no
  mesmo formato.

## Fase 7 - Scaffold de worktree

Entrega local:

- `docs/operations/panteon-agent-scaffolds.md`
- `scripts/panteon-scaffold-agents.ps1`
- `scripts/panteon-new-worktree.ps1`

Regras:

- O script nao deve executar deploy.
- O script nao deve tocar env, secret, banco ou Vercel.
- Scripts rodam em preview por padrao e nao criam branch nem worktree sem
  `-Apply` no comando individual de agente.
- Se executar `git worktree add`, deve pedir confirmacao humana antes quando
  houver risco de sobrescrever caminho existente.

## Fase 8 - Hooks Git locais

Entrega local:

- `.githooks/pre-commit`
- `.githooks/commit-msg`
- `.githooks/pre-push`
- `scripts/panteon-hook-runner.ps1`
- `scripts/panteon-install-hooks.ps1`
- `docs/operations/panteon-git-hooks.md`

Criterio:

- Hooks rodam localmente sem rede, deploy, Supabase, Vercel, banco, env,
  secret, dominio, alias, migration, rollback ou producao.
- `pre-commit` bloqueia whitespace invalido, paths sensiveis e padroes de
  segredo no staged diff.
- `commit-msg` exige conventional commit e bloqueia possivel segredo na
  mensagem.
- `pre-push` chama o validador de worktree com gate rapido proporcional ao
  recorte.

## Fase 9 - Release registers integrados

Entrega futura:

- Zeus e Hefesto reconciliam:
  - `docs/operations/releases-homologation.md`;
  - `docs/operations/releases-production.md`;
  - diario canonico;
  - Git/worktree;
  - registros estruturados do Operations Center.

Criterio:

- Produção nunca depende de recado solto.
- Todo handoff para Hefesto aponta modulo, pacote, commit/deploy, validacoes,
  riscos e status.

## Fase 10 - Expansao para squads

Ordem recomendada:

1. Zeus piloto.
2. Hefesto producao.
3. Iris.
4. Hades.
5. Ares.
6. Hermes.
7. Atlas.
8. Chronos, Apolo e Setup.

Cada agente deve receber:

- worktree proprio;
- branch pesquisavel;
- script de startup;
- regra de checkpoint;
- checklist de validacao;
- handoff para Zeus/Hefesto.

## Bloqueios permanentes

Continuam bloqueados sem autorizacao explicita do Lucas:

- banco real;
- migrations;
- Supabase;
- Vercel;
- envs;
- secrets;
- aliases;
- dominios;
- deploy;
- rollback;
- producao.

## Conclusao

Este roadmap permite evoluir a engenharia do Panteon em etapas, com velocidade
e protecao operacional.

O foco imediato e concluir o piloto Zeus local: documentos, templates e tela
`Agentes` com leitura executiva de worktrees, bloqueios e handoffs.
