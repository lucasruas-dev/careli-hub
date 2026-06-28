# Handoff — Hades cobrança consolidado + go-live pendente (2026-06-27)

> Chat saturado. Este doc é o ponto de partida do próximo Zeus. Próxima frente: **Iris go-live na segunda** — muito do Hades será reaproveitado.

## Estado em uma frase
Toda a frente de **cobrança (Hades)** + adjacências (Athena, CACÁ automática, módulo Meu dia, Home bento, timeline) foi **consolidada no commit `36ecb75c` (main, LOCAL — não pushado)** e **ESTÁ NO AR EM PRODUÇÃO desde 28/jun** (alias `c2x.app.br` → `d2ph65a67`; verificado c2x=200, ops=307).

## GO-LIVE FEITO (28/jun) — v1.7.0
- Prod `c2x.app.br` = `careli-hub-hub-i2bs-f3wn2oc9c` (**v1.7.0**, com painel de Novidades + avatar corrigido). **Rollback** = `careli-hub-hub-i2bs-jur4gvue9` (v1.6.3). (Builds intermediários da mesma release: `d2ph65a67`, `lt09r87jc`.)
- Changelog: entrada **v1.7.0** no `PANTEON_CHANGELOG`; `lib/build-info.ts` agora DERIVA a versão/buildTag do changelog (fonte única — atualizar o Novidades já atualiza o avatar). Regra: sempre atualizar o painel a cada release (memórias `feedback-deploy-team-message`).
- Commits na main local: `36ecb75c` (trabalho) · docs/handoff · `b82126a` (changelog v1.7.0) · build-info fix.
- **Dados de teste limpos** em prod (5 compromissos AC-/PR- apagados; 0 restantes).
- **Fila mantida ABERTA** (`validEnterpriseWhere` = `e.id is not null`) — Lucas precisa do **SDT liberado pro treinamento de segunda**. NÃO re-travar.
- ⚠️ **CACÁ automática ATIVA** — monitorar o 1º "Receber boleto" real.
- Cron da régua segue **OFF** (falta o template Meta novo).
- `main` local nos commits `36ecb75c` + `b613807` (handoff) — **não pushado** (considerar push; Git desconectado do auto-deploy).

## Go-live (FALTA — precisa do OK explícito do Lucas, nomeando o alias)
- **Build a subir:** `careli-hub-hub-i2bs-d2ph65a67-lucasruas-devs-projects.vercel.app`
- **Comando:**
  ```
  npx vercel alias set careli-hub-hub-i2bs-d2ph65a67-lucasruas-devs-projects.vercel.app c2x.app.br --scope lucasruas-devs-projects
  ```
  (env `VERCEL_ORG_ID=team_0AsY43vvHN2fwEkcN8u5LKXX`, `VERCEL_PROJECT_ID=prj_7pgq969nAKwdNKSY3YoMFlxU6qdK`)
- **Verificar pós-alias:** `c2x.app.br` → 200; `ops.c2x.app.br` → 307 (**NÃO TOCAR ops**).
- **Rollback:** alias atual = `careli-hub-hub-i2bs-jur4gvue9-...` (v1.6.3). Pra reverter: `vercel alias set careli-hub-hub-i2bs-jur4gvue9-lucasruas-devs-projects.vercel.app c2x.app.br`.

## O que vai ao ar (validado por Lucas em previews, peça a peça)
- Cockpit de atendimento do Hades (3 zonas) + Athena (escrita/atalhos/selecionar msg/áudio/contrato D4Sign) + Central de Propostas (aprovação/chat) + registrar acordo/promessa inline.
- **CACÁ automática** ("Receber boleto" → manda boleto sem operador). **ATIVA em produção no go-live** — ⚠️ **monitorar o 1º inbound real** (autônoma, não testável em preview).
- Módulo **Meu dia** (agenda/tarefas/retornos + reuniões Chronos + ponte Asana read-only); Home **bento**; botões Retorno/Tarefa do composer vinculam o protocolo.
- Timeline (cliente + cockpit) reorganizada (agrupada/tipada/origem; form popup central + filtro macro); Tooltip do uix via **portal** (não corta mais).
- Migrations **0037** (aprovação compromissos) e **0038** (hub_agenda_items) **já em prod** (Supabase bxguky).

## Pós-go-live (precisa OK do Lucas — regra Supabase)
- **Limpar dados de teste** (compromissos AC-/PR- em `guardian_compromissos`/parcelas/lembretes/comments no Supabase PROD) — Lucas criou ~vários testando previews contra o prod.
- **Re-travar a fila** (`validEnterpriseWhere` em `lib/guardian/attendance.ts`, hoje = `e.id is not null`; allowlist original em comentário) — ou manter aberta.
- **NÃO ligar o cron da régua** até criar o template Meta novo (régua D-3/2/1/0).
- Considerar **push** do `36ecb75c` (Git desconectado do auto-deploy = `git push` liberado, mas confirmar a blindagem antes).

## Backlog Hades (memória `project_hades_pendentes`)
Visão geral estratégica (a maior) · etapa do workflow no detalhe · unificar timeline do cockpit (refletir a do cliente) · ligar cron/régua (falta template) · quitação na timeline · template do valor total (Iris).

## Próxima frente: Iris (go-live SEGUNDA)
A Iris já tem CACÁ + atendimento **LIVE desde 25/jun** (ver `project_iris`). Reaproveitar do Hades: cockpit/contexto, Athena, motor de compromissos, timeline, composer Retorno/Tarefa, ponte Asana. Memórias-chave: `project_cobranca_motor_ui`, `project_caca_automatica_cobranca`, `project_modulo_agenda_meudia`, `project_iris`, `project_hades_pendentes`.
