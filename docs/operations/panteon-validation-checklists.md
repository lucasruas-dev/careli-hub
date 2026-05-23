# Panteon - Checklists de Validacao por Recorte

Status: `PADRAO OPERACIONAL / ZEUS`
Owner: `Zeus`
Fonte base: `docs/operations/panteon-worktree-operating-model.md`
Data: `2026-05-23`

Este documento define os gates minimos de validacao por tipo de recorte no
Panteon. Ele existe para evitar dois problemas: publicar pacote misto e aceitar
mudanca sem evidencia proporcional ao risco.

## Regra central

Todo recorte precisa declarar:

- dono;
- worktree;
- branch;
- modulo;
- arquivos afetados;
- validacoes executadas;
- riscos;
- status final;
- proxima squad.

Se qualquer item sensivel entrar no recorte, o status comeca `BLOQUEADO` ate
autorizacao explicita do Lucas.

## Comandos base

Para qualquer recorte:

```powershell
pwsh --version
git status --short --branch
git diff --check
```

Em Windows, PowerShell 7 (`pwsh`) e o terminal operacional padrao. Use
`powershell.exe` apenas como fallback quando `pwsh` nao iniciar na sessao atual
e mantenha `npm.cmd`/`npx.cmd` para Node.

Quando hooks locais estiverem instalados, `pre-commit`, `commit-msg` e
`pre-push` executam parte desses gates automaticamente. Eles complementam, mas
nao substituem, a validacao completa exigida por handoff, homologacao ou
producao.

Para recorte Hub em worktree separado:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-validate-worktree.ps1 -Scope hub -PrepareSharedNodeModules
```

Para recorte apenas documental:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/panteon-validate-worktree.ps1 -Scope docs
```

## Recorte documental

Use quando a mudanca altera apenas `docs/` ou registros operacionais.

Obrigatorio:

- confirmar que a entrada pertence ao diario canonico quando houver decisao;
- manter docs append-only quando o arquivo exigir historico;
- validar links internos por busca local;
- rodar `git diff --check`;
- rodar `panteon-validate-worktree.ps1 -Scope docs` quando o script existir.

Nao precisa:

- build do Hub, se nenhum codigo foi alterado neste passo;
- validacao visual, salvo quando o documento for um artefato visual.

Bloquear se:

- o documento pedir aplicacao de migration, deploy, env, secret ou producao sem
  autorizacao explicita;
- houver valor sensivel em exemplo, log ou payload.

## Recorte frontend

Use quando a mudanca toca React, layout, sidebar, topbar, tela de modulo,
identidade visual, componente visual ou UX.

Obrigatorio:

- ler `docs/architecture/design-guidelines.md`;
- preservar o padrao visual da Home e do sidebar principal;
- rodar `check-types`;
- rodar `lint`;
- rodar build do Hub quando a mudanca afetar rota, componente compartilhado ou
  app shell;
- validar a rota local com dev server quando aplicavel;
- fazer validacao visual em desktop e, quando relevante, mobile.

Evidencia minima no diario:

- rota validada;
- comando executado;
- resultado;
- limitacao de sessao autenticada, se existir.

Bloquear se:

- o recorte misturar outro modulo fora do escopo;
- a UI depender de mock quando Lucas pediu comportamento real e ja existe fonte
  real;
- a validacao visual autenticada for indispensavel e nao houver sessao.

## Recorte API ou server-side

Use quando a mudanca toca route handler, server action, integracao interna,
validador, parser, job ou regra server-side.

Obrigatorio:

- rodar `check-types`;
- rodar `lint`;
- rodar teste focado ou smoke local da rota quando existir;
- validar sanitizacao de entrada e saida;
- registrar se a rota e somente leitura ou mutavel;
- garantir que logs nao exponham payload sensivel.

Bloquear se:

- a rota escrever em banco real sem autorizacao especifica;
- houver dependencia de env nova ou secret sem registro de nome/impacto;
- a alteracao envolver API externa real sem seguir a governanca de conexoes.

## Recorte banco, migration ou schema

Use somente quando Lucas autorizar explicitamente o objetivo e o ambiente.

Antes da autorizacao:

- permitido desenhar proposta;
- permitido criar documento revisavel;
- permitido criar migration em arquivo somente se Lucas autorizar essa etapa;
- proibido aplicar migration real;
- proibido tocar banco real, Supabase ou service role.

Depois de autorizado:

- alvo inicial deve ser homologacao;
- registrar rollback ou plano de reversao;
- validar RLS, indices e impacto de dados;
- nunca registrar valor de conexao, token ou chave;
- registrar resultado no diario e release register aplicavel.

Bloquear se:

- houver producao sem homologacao previa;
- houver schema destrutivo sem plano de rollback;
- o recorte misturar migration com UI nao validada ou outro modulo.

## Recorte Supabase, Auth ou storage

Use quando a mudanca toca Auth, RLS, Storage, Realtime, Edge Function,
policies ou projeto Supabase.

Obrigatorio:

- iniciar como `BLOQUEADO` ate autorizacao explicita;
- registrar nomes de recursos e impacto, nunca valores sensiveis;
- separar auditoria de alteracao;
- validar em homologacao antes de qualquer producao;
- registrar evidencias sem payload sensivel.

Bloquear se:

- envolver service role fora de server-side;
- exigir rotacao, criacao ou exposicao de chave;
- depender de acesso externo nao autorizado.

## Recorte Vercel, dominio, alias ou deploy

Use quando a mudanca toca deploy, redeploy, preview, alias, dominio,
promocao, rollback ou env na Vercel.

Obrigatorio:

- iniciar como `BLOQUEADO` ate autorizacao explicita;
- separar homologacao de producao;
- publicar apenas recorte limpo;
- registrar deployment, commit, branch, validacoes e riscos;
- verificar aliases exigidos pela politica antes e depois, quando autorizado.

Bloquear se:

- o worktree estiver misto;
- houver env/secret novo ou alterado sem aprovacao;
- producao for solicitada sem handoff homologado para Hefesto.

## Recorte de homologacao

Use quando Lucas autorizar o agente de modulo a publicar o proprio recorte em
homologacao.

Obrigatorio:

- confirmar modulo dono;
- confirmar pacote limpo;
- rodar validacoes proporcionais;
- registrar em `docs/operations/releases-homologation.md` quando aplicavel;
- registrar no diario canonico;
- sinalizar Zeus/Operations Center com status e riscos.

Bloquear se:

- o pacote incluir arquivos de outra squad;
- depender de migration, env, secret ou banco ainda nao autorizado;
- nao houver evidencia minima de validacao.

## Recorte de producao

Use somente para Hefesto ou fluxo explicitamente autorizado por Lucas.

Obrigatorio:

- comparar diario canonico, Git e release registers;
- confirmar que o recorte foi homologado ou formalmente aprovado;
- separar por modulo;
- bloquear pendencias de outra squad;
- executar healthchecks finais;
- registrar rollback;
- registrar em `docs/operations/releases-production.md` e diario.

Bloquear se:

- houver divergencia entre homologacao e pacote de producao;
- o commit misturar aprovado e nao aprovado;
- envolver alias, dominio, env ou secret sem aprovacao explicita.

## Recorte de incidente ou rollback

Use quando ha indisponibilidade, regressao, falha critica, risco financeiro,
auth quebrado, build/deploy quebrado ou dado operacional ameaçado.

Obrigatorio:

- registrar severidade e impacto;
- isolar ambiente afetado;
- nao fazer acao destrutiva sem aprovacao;
- preferir mitigacao reversivel;
- registrar linha do tempo no diario;
- acionar Hefesto quando envolver producao.

Bloquear se:

- o diagnostico exigir secret, banco real, service role, alias ou rollback sem
  autorizacao;
- nao houver plano de reversao para uma acao mutavel.

## Saida padrao para handoff

Todo handoff deve responder:

```text
Assunto: [Modulo] Handoff do recorte

Worktree:
Branch:
Modulo:
Arquivos:
Validacoes:
Status:
Riscos:
Bloqueios:
Proxima squad:

Conclusao:
- O que aconteceu:
- Impacto pratico:
- Precisa de acao agora:
- Quem deve agir:
- Proximo passo:
```

## Conclusao

Estes checklists tornam a validacao previsivel: cada agente sabe o minimo
necessario para provar o recorte, bloquear riscos e entregar para Lucas, Zeus
ou Hefesto sem transformar governanca em improviso.
