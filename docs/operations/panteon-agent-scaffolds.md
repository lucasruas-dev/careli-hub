# Panteon - Scaffolds Operacionais de Agentes

Status: `SCAFFOLD OPERACIONAL / PREVIEW SEGURO`
Owner: `Zeus`
Data: `2026-05-23`

Este documento define os scaffolds padrao para iniciar agentes do Panteon em
worktrees separados. O scaffold nao e deploy, nao e migration, nao e env e nao
e producao. Ele prepara caminho, branch, escopo, bloqueios e prompt de abertura.

## Pacote de scaffold

Cada agente recebe:

- worktree dedicado em `careli-hub-worktrees/<agente>`;
- branch `codex/<agente>/<tema>-<yyyymmdd>`;
- escopo operacional;
- bloqueios sensiveis;
- prompt de startup;
- checklist de validacao;
- formato de handoff para Zeus/Hefesto.

## Comando de preview

Para listar os scaffolds sem criar worktrees:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/panteon-scaffold-agents.ps1 -Theme worktree-pilot
```

Para preparar um agente especifico sem criar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/panteon-new-worktree.ps1 -Agent iris -Theme worktree-pilot
```

Para criar de fato um worktree individual, depois de revisar:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/panteon-new-worktree.ps1 -Agent iris -Theme worktree-pilot -Apply
```

## Scaffolds padrao

| Agente | Worktree | Branch base | Escopo | Bloqueio principal |
| --- | --- | --- | --- | --- |
| `zeus` | `careli-hub-worktrees/zeus` | `codex/zeus/<tema>-<yyyymmdd>` | Operations Center, governanca, comunicacao entre agentes, suporte, dados e infraestrutura em modo protegido | banco, env, secret, Vercel, Supabase, deploy e producao sem autorizacao |
| `hefesto` | `careli-hub-worktrees/hefesto` | `codex/hefesto/<tema>-<yyyymmdd>` | producao, healthchecks finais, rollback e rastreabilidade oficial | pacote misto, producao sem homologacao, alias/env/secret sem autorizacao |
| `iris` | `careli-hub-worktrees/iris` | `codex/iris/<tema>-<yyyymmdd>` | atendimento, templates, filas, comunicacao externa e integracoes aprovadas | envio externo real, Meta/WhatsApp, webhook, env e secret sem autorizacao |
| `hades` | `careli-hub-worktrees/hades` | `codex/hades/<tema>-<yyyymmdd>` | cobrancas, financeiro operacional, contratos, boletos e regras C2X | mudanca financeira destrutiva, banco/env/secret e producao sem autorizacao |
| `ares` | `careli-hub-worktrees/ares` | `codex/ares/<tema>-<yyyymmdd>` | financeiro tatico, disputas, acordos, escalonamentos e demandas financeiras que podem acionar Iris | alteracao financeira real, cobranca externa, dados sensiveis, banco/env/secret e producao sem autorizacao |
| `hermes` | `careli-hub-worktrees/hermes` | `codex/hermes/<tema>-<yyyymmdd>` | comunicacao interna, realtime, mensagens, notificacoes e anexos | Realtime/Supabase mutavel, notificacao externa real, env e secret sem autorizacao |
| `atlas` | `careli-hub-worktrees/atlas` | `codex/atlas/<tema>-<yyyymmdd>` | indicadores, performance, dashboards, auditoria e relatorios | banco real mutavel, consulta destrutiva, env e secret sem autorizacao |
| `chronos` | `careli-hub-worktrees/chronos` | `codex/chronos/<tema>-<yyyymmdd>` | jobs, agenda operacional, rotinas temporais e filas programadas | cron real, job mutavel, fila externa, Vercel/env/secret sem autorizacao |
| `setup` | `careli-hub-worktrees/setup` | `codex/setup/<tema>-<yyyymmdd>` | configuracoes administrativas, permissoes, onboarding e setup central | permissao destrutiva, auth real mutavel, banco/env/secret sem autorizacao |
| `apolo` | `careli-hub-worktrees/apolo` | `codex/apolo/<tema>-<yyyymmdd>` | planejamento operacional, apoio de produto, IA assistida e triagem | IA executando acao sensivel, banco/env/secret e producao sem autorizacao |

## Prompt de startup por agente

Modelo:

```text
Assunto: [<Modulo>] Inicializacao em worktree

Voce e o agente <Modulo> do Panteon.

Antes de qualquer acao, leia:

- AGENTS.md
- docs/operations/README.md
- docs/operations/engineering-operations.md
- docs/operations/panteon-worktree-operating-model.md
- docs/operations/panteon-validation-checklists.md
- docs/operations/panteon-agent-scaffolds.md
- docs/architecture/agent-operating-model.md

Contexto:

- Worktree: C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub-worktrees\<agente>
- Branch: codex/<agente>/<tema>-<yyyymmdd>
- Escopo: <escopo do scaffold>
- Fora de escopo: modulos de outras squads e operacoes sensiveis sem autorizacao.

Primeira acao:

1. Rodar git status --short --branch.
2. Confirmar worktree, branch e ultimo commit.
3. Ler a ultima entrada do diario relacionada ao modulo.
4. Responder com estado, riscos e proximo passo.

Bloqueios:

- Deploy, redeploy, Supabase, banco, migration, env, secret, dominio, alias,
  rollback e producao ficam BLOQUEADOS ate autorizacao explicita do Lucas.
```

## Ordem recomendada de criacao

1. `hefesto`: preparar esteira de producao e rollback, sem publicar nada.
2. `iris`: separar frente ativa de comunicacao/atendimento.
3. `hades`: proteger financeiro e regras C2X.
4. `ares`: isolar disputas, acordos e escalonamentos financeiros.
5. `hermes`: isolar realtime/comunicacao interna.
6. `atlas`: isolar indicadores e auditoria.
7. `chronos`: isolar jobs e rotinas temporais.
8. `setup`: isolar configuracoes administrativas.
9. `apolo`: isolar planejamento/IA assistida.

## Gates

- Scaffold em preview: livre e local.
- Criar worktree: permitido com revisao do comando e `-Apply`.
- Commit: passa por hooks locais.
- Handoff: exige diario canonico atualizado.
- Homologacao: exige autorizacao do Lucas por modulo.
- Producao: exige Hefesto e autorizacao explicita.

## Conclusao

Scaffolds tornam a expansao do Panteon repetivel: cada agente nasce com nome,
caminho, branch, escopo, bloqueios e primeiro protocolo de trabalho claros.
