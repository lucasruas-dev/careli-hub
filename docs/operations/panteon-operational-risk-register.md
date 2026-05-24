# Panteon - registro operacional de riscos e gargalos

Este documento transforma diagnosticos soltos em backlog operacional rastreavel para o Zeus.

Ele nao substitui o diario canonico, `releases-homologation.md`, `releases-production.md` ou o Operations Center. A funcao aqui e manter uma lista objetiva das pontas soltas que podem virar gargalo de engenharia, release, banco, governanca ou coordenacao entre agentes.

## Regras

- Toda acao de Vercel, Supabase, banco, env, secret, dominio, alias, migration aplicada, rollback ou producao continua `BLOQUEADO` ate autorizacao explicita do Lucas.
- Este registro pode documentar plano, risco, dono e gate; ele nao autoriza execucao sensivel por si so.
- Quando um item virar decisao, deploy, migration, rollback, incidente ou handoff, registrar tambem no diario canonico.
- Quando um item estiver pronto para producao, ele deve ter recorte limpo, validacao e handoff para Hefesto.

## Status

| Status | Uso |
| --- | --- |
| `CONTROLADO` | Risco conhecido com mitigacao atual suficiente. |
| `MONITORADO` | Nao bloqueia agora, mas exige acompanhamento. |
| `PENDENTE` | Precisa de decisao, documentacao ou recorte futuro. |
| `BLOQUEADO` | Depende de autorizacao, migration, env, banco, alias, producao ou outro gate sensivel. |
| `PRONTO PARA RECORTE` | Pode virar pacote pequeno e validavel. |

## Registro

| ID | Tema | Status | Dono | Evidencia atual | Proxima acao segura |
| --- | --- | --- | --- | --- | --- |
| `OR-001` | Status Chronos `0019` aparece de forma historica em review antigo | `MONITORADO` | Zeus / Chronos | Diario atual registra `0019_chronos_core.sql` aplicada e validada em homologacao/producao com atencao; review antigo de 2026-05-18 ainda descreve bloqueio anterior. | Manter nota de supersessao no review antigo e exigir smoke autenticado Chronos antes de novo release amplo. |
| `OR-002` | Duas migrations com prefixo `0003` | `CONTROLADO` | Zeus / DataOps | `0003_setup_beta_policies.sql` e `0003_setup_operational_access.sql` coexistem e ja estao reconhecidas no plano de homologacao. | Nao renomear historico; usar auditoria read-only e exigir runner por nome completo/ordem controlada. Recorte futuro decide normalizacao sem quebrar historico. |
| `OR-003` | Regra canonica `AT -> OP` ainda nao aplicada na geracao real | `BLOQUEADO` | Zeus / DataOps | `squadops-center-process.md` reserva `AT` para Iris e define `OP` para atividades Zeus, mas registra que o banco ainda gera `AT` ate migration autorizada. | Preparar plano/migration em recorte separado quando Lucas autorizar; ate la, registrar divergencia como conhecida. |
| `OR-004` | Discovery Ares precisa estar na fonte canonica do recorte ativo | `PENDENTE` | Ares / Zeus | O repositorio principal tem indicio de discovery Ares local, mas o worktree Zeus nao deve assumir conteudo de outro recorte sem propagacao limpa. | Ares deve registrar/commitir sua discovery no proprio worktree; Zeus referencia somente depois que estiver na fonte oficial. |
| `OR-005` | Sync diario -> banco depende de watcher local | `MONITORADO` | Zeus | `squadops-sync-operations-watch.mjs` e task local reduzem atrito, mas dependem de processo em maquina local. | Adicionar indicador de ultima sincronizacao no Zeus em recorte futuro e manter auditoria read-only para detectar dependencia. |
| `OR-006` | Paridade homologacao/producao ainda e manual | `MONITORADO` | Hefesto / Zeus | Politicas exigem reconciliar `homo.c2x.app.br` apos producao; alias `c2x.app.br` e `ops.c2x.app.br` compartilham deployment. | Usar checklist de Hefesto e auditoria de aliases antes/depois de producao; automatizar relatorio antes de automatizar alteracao. |
| `OR-007` | Apolo vira fonte de cadastro mestre e aumenta impacto transversal | `MONITORADO` | Apolo / Zeus | Diario registra carga real Apolo e dependencias futuras de Hades, Iris, Chronos e Zeus. | Planejar sync incremental, RLS/read access e consumo por modulo em recortes pequenos. |
| `OR-008` | Cockpit Zeus em producao depende de gate final | `PENDENTE` | Zeus / Hefesto | Recorte Zeus passou em validacao local e Preview, mas validacao visual autenticada ainda aparece como pendente no registro de homologacao. | Lucas valida a aba autenticada ou autoriza aceite de risco; depois Hefesto/Zeus promove com healthchecks e rollback path. |

## Politica para nao criar gargalo

1. Todo risco novo entra neste registro com dono, evidencia e proxima acao pequena.
2. Todo item `BLOQUEADO` precisa dizer exatamente qual autorizacao falta.
3. Todo item que virar codigo precisa sair em worktree/branch do agente dono.
4. Toda mudanca sensivel precisa ter rollback path antes do deploy.
5. Toda divergencia entre documento antigo e estado atual deve ser resolvida por nota nova, sem apagar historico.
6. Nenhum pacote misto deve chegar em producao.

## Auditoria local

Rodar:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-operational-audit.ps1
```

Modo estrito para CI ou gate manual:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-operational-audit.ps1 -Strict
```

O script e read-only: nao executa deploy, nao altera alias, nao aplica migration, nao chama Supabase e nao le valores de env.
