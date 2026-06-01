# Panteon - Worktree Operating Model

Status: `PROPOSTA OPERACIONAL / PILOTO ZEUS + HEFESTO`

Este documento define a frente de evolucao para separar os trabalhos por agente/modulo usando Git worktrees, reduzir recortes misturados e dar ao Hefesto uma esteira mais inteligente para promocao de producao.

## Objetivo

- Isolar o trabalho de cada agente em uma arvore propria.
- Evitar commits, deploys e validacoes misturando modulos.
- Dar rastreabilidade clara entre demanda, modulo, branch, commit, homologacao e producao.
- Preservar a seguranca dos ambientes `homo.c2x.app.br`, `c2x.app.br` e `ops.c2x.app.br`.
- Ajudar Lucas a conduzir evolucoes grandes sem perder controle operacional.

## Fora de escopo neste piloto

- Nao muda runtime do Panteon.
- Nao muda rotas, aliases, dominios, Vercel, Supabase, banco, migrations, envs ou secrets.
- Nao reescreve historico Git.
- Nao renomeia caminhos tecnicos existentes.
- Nao substitui homologacao, diario vivo, registros de release ou autorizacao humana.

## Principios

- Lucas continua sendo a autoridade final.
- Cada agente trabalha no proprio recorte.
- Cada worktree deve ter branch, status e modulo evidentes.
- Producao continua centralizada em Hefesto, exceto quando Lucas autorizar Zeus a publicar diretamente seu proprio recorte OPS.
- Qualquer operacao sensivel continua `BLOQUEADO` ate autorizacao explicita do Lucas.
- Worktree sujo ou pacote misto bloqueia deploy ate separar recorte limpo.

## Mapa de papeis

- `Lucas`: autoridade de negocio, aprovacao final e liberacao de operacoes sensiveis.
- `Zeus`: Operations Center, SupportOps, DataOps, InfraOps, diagnostico, saude, incidentes e governanca operacional.
- `Hefesto`: promocao para producao, healthchecks finais, rollback, aliases e rastreabilidade oficial de producao.
- `Iris Core`: atendimento, tickets, Meta/WhatsApp e experiencia do solicitante.
- `Hermes Core`: comunicacao interna, canais, mensagens e colaboracao operacional.
- `Hades Core`: cobranca, financeiro operacional e protocolos `CB`.
- `Ares Core`: pessoas, cadastros de perfis, estrutura organizacional e entidades operacionais quando autorizado.
- `Apolo Core`: modulo em construcao; escopo deve ser registrado antes do primeiro recorte real.
- `Atlas Core`: indicadores, desempenho e rotinas de gestao ja preservadas.
- `Chronos Core`: agenda, tempo, eventos e rotinas temporais ja preservadas.
- `Athena`: intake assistido, leitura tecnica de tickets e apoio de regras de negocio.

## Estrutura proposta de worktrees

Raiz de referencia:

```text
careli-hub/
```

Worktrees operacionais sugeridas:

```text
careli-hub-worktrees/
  zeus/
  hefesto-release/
  iris/
  hermes/
  hades/
  ares/
  apolo/
  atlas/
  chronos/
```

Padrao de branch:

```text
codex/<agente>/<tema-curto>
```

Exemplos:

```text
codex/zeus/helpdesk-performance
codex/iris/meta-template-media
codex/hefestos/prod-2026-05-22
codex/ares/profile-registry
```

## Comandos base para o piloto

Executar somente depois de confirmar que o diretorio atual esta correto e que nao ha recorte misto a publicar.

```powershell
git status --short --branch
git worktree list
```

Criacao de uma worktree Zeus para piloto:

```powershell
git worktree add ..\careli-hub-worktrees\zeus -b codex/zeus/<tema-curto> homolog
```

Criacao de uma worktree Hefesto para promocao:

```powershell
git worktree add ..\careli-hub-worktrees\hefesto-release -b codex/hefestos/<tema-curto> homolog
```

Atualizacao segura dentro de cada worktree:

```powershell
git status --short --branch
npm.cmd run check-types:hub
npm.cmd run lint:hub
npm.cmd run build --workspace @repo/hub
git diff --check
```

## Esteira operacional

1. Intake
   - Lucas pede demanda, correcao, diagnostico ou evolucao.
   - Zeus ou agente responsavel classifica modulo, risco e ambiente.

2. Classificacao
   - Definir se e produto, suporte, dados, infra, release, visual ou governanca.
   - Definir se toca env, secret, banco, migration, Vercel, alias ou producao.
   - Se tocar item sensivel, status inicial `BLOQUEADO`.

3. Escolha da worktree
   - Usar worktree do modulo responsavel.
   - Se envolver shared, registrar impacto e validar todos os consumidores afetados.
   - Se envolver varios modulos, dividir em pacotes menores sempre que possivel.

4. Implementacao
   - Alterar apenas arquivos do recorte.
   - Evitar refatoracao ampla sem pedido explicito.
   - Preservar padrao visual e regras de negocio oficiais.

5. Validacao local
   - Rodar validacoes proporcionais ao risco.
   - Para Hub: `check-types:hub`, `lint:hub`, `build --workspace @repo/hub`, smoke e `git diff --check` quando aplicavel.
   - Registrar bloqueios reais quando validacao global falhar por outro modulo.

6. Homologacao por agente
   - Agente do modulo gera somente o proprio Preview Vercel quando Lucas autorizar.
   - `localhost` e validacao local e nao substitui Preview.
   - Preview Vercel e deployment publico/imutavel para validacao tecnica ou visual.
   - O alias compartilhado `https://homo.c2x.app.br` e movimentado por Zeus apos Safety Gate; agentes de modulo nao executam `vercel alias set ... homo.c2x.app.br` como rotina.
   - Registrar em `docs/operations/releases-homologation.md`.
   - Registrar resumo no diario canonico.
   - Sinalizar status `EM HOMOLOGACAO`, `HOMOLOGADO`, `PRONTO PARA PRODUCAO`, `BLOQUEADO` ou `NECESSITA CORRECAO`.

7. Handoff para Hefesto
   - Handoff deve informar modulo, pacote, atividades/protocolos, commit, Preview URL, Preview deployment id, expectedDeploymentId atual de homo, deployment de homologacao quando Zeus mover o alias, validacoes, riscos, pendencias e status.
   - Hefesto compara Git, diario, releases de homologacao e releases de producao.

8. Producao
   - Hefesto promove apenas recorte homologado, validado e autorizado.
   - Inspecionar `https://c2x.app.br` e `https://ops.c2x.app.br` antes e depois quando compartilharem deployment.
   - Registrar em `docs/operations/releases-production.md` e no diario canonico.
   - Definir rollback.

9. Pos-release
   - Executar healthchecks.
   - Verificar logs.
   - Reconciliar protocolos no Operations Center quando aplicavel.
   - Fechar status real.

## Regra de recorte limpo

Um recorte e limpo quando:

- pertence a um modulo principal;
- nao carrega mudancas pendentes de outro agente;
- nao altera env, secret, migration, dominio, alias ou banco sem autorizacao;
- tem validacoes registradas;
- tem status e proxima acao claros.

Um recorte deve bloquear quando:

- o worktree mistura modulos nao relacionados;
- ha alteracao sensivel sem autorizacao;
- a origem dos dados reais esta incerta;
- a homologacao ou producao apontam para ambiente inesperado;
- o deploy colocaria `c2x.app.br` ou `ops.c2x.app.br` em estado divergente sem justificativa.

## Regras para arquivos compartilhados

Arquivos compartilhados exigem classificacao explicita:

- `packages/shared/*`: validar consumidores afetados.
- `apps/hub/components/*`: validar telas que usam o componente.
- `apps/hub/lib/*`: validar rotas e modulos consumidores.
- `docs/operations/*`: preferir append-only e identificar qual agente esta registrando.
- `docs/architecture/*`: alterar somente quando a regra operacional ou visual mudar de fato.

## Padrao de ambientes para agentes

- `localhost`: usado para desenvolvimento e smoke local; nao deve ser chamado de Preview nem registrado como homologacao.
- `Preview Vercel`: URL tecnica de deployment candidato, gerada de pacote limpo, com deployment id, projeto Vercel esperado e status `Ready`.
- `homo.c2x.app.br`: alias unico e compartilhado de homologacao, movido por Zeus apos Safety Gate e reconciliacao do deployment base.
- `c2x.app.br` e `ops.c2x.app.br`: aliases de producao, movidos por Hefesto conforme politica de producao.

Se Lucas quiser validar antes de mexer em `homo`, o agente/Zeus deve entregar a URL do Preview. Se o Preview estiver protegido pela Vercel e Lucas nao conseguir abrir, Zeus pode mover `homo` somente depois do Safety Gate pre-alias e da confirmacao de que o deployment alvo pertence ao projeto correto e nao e `workspace-*`.

## Modelo de handoff para Hefesto

```text
Handoff para producao:

- Modulo/agente:
- Branch:
- Commit:
- Ambiente de homologacao:
- Deployment/alias de homologacao:
- Protocolos/atividades:
- Escopo:
- Arquivos principais:
- Validacoes:
- Healthchecks:
- Riscos:
- Pendencias:
- Status:
- Rollback sugerido:
```

## Piloto recomendado

Fase 1 - Fundacao documental:

- criar este documento;
- registrar decisao no diario canonico;
- manter sem alteracao runtime.

Fase 2 - Worktree Zeus:

- criar `..\careli-hub-worktrees\zeus`;
- escolher um recorte pequeno de Zeus;
- validar se o fluxo elimina mistura com Iris/Hermes/Hades/Ares.

Fase 3 - Worktree Hefesto:

- criar `..\careli-hub-worktrees\hefesto-release`;
- simular leitura de homologacao e producao sem publicar;
- definir checklist de promocao.

Fase 4 - Primeiro recorte real:

- executar um ajuste pequeno em Zeus;
- validar local;
- registrar homologacao se Lucas autorizar;
- entregar handoff para Hefesto.

Fase 5 - Expansao:

- replicar para Iris, Hermes, Hades, Ares, Apolo, Atlas e Chronos;
- padronizar prompts de inicializacao por agente;
- reforcar no Operations Center a visao por modulo/pacote.

## Piloto iniciado em 2026-05-22

Primeiras worktrees fisicas criadas:

```text
C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub-worktrees\zeus
C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub-worktrees\hefesto-release
```

Branches:

```text
codex/zeus/worktree-pilot-20260522
codex/hefestos/worktree-pilot-20260522
```

Base:

```text
homolog @ 4843ffa docs(zeus): register asana label production release
```

Uso recomendado:

- `zeus`: diagnosticos, governanca operacional, OPS, saude, performance, Supabase/Vercel em modo bloqueado e recortes Zeus.
- `hefesto-release`: leitura de homologacao/producao, montagem de pacote de promocao, healthchecks finais e rollback quando autorizado.
- O worktree principal deve continuar como referencia e nao como local padrao para todos os agentes editarem ao mesmo tempo.

Validacao inicial:

- `git worktree list`: caminhos Zeus e Hefesto listados.
- `git -C ...\careli-hub-worktrees\zeus status --short --branch`: branch `codex/zeus/worktree-pilot-20260522`, sem alteracoes locais.
- `git -C ...\careli-hub-worktrees\hefesto-release status --short --branch`: branch `codex/hefestos/worktree-pilot-20260522`, sem alteracoes locais.
- `safe.directory` configurado apenas para os dois caminhos novos, necessario pelo isolamento de usuario do Codex no Windows.

## Riscos conhecidos

- Confusao de diretorio ativo ao alternar worktrees.
- Duplicidade de dependencias ou caches locais.
- Conflito em arquivos compartilhados e documentos operacionais.
- Agente publicar a partir do worktree errado.
- Handoff incompleto dificultar promocao pelo Hefesto.

## Mitigacoes

- Todo agente deve iniciar com `git status --short --branch` e `git worktree list`.
- Todo pacote deve informar `cwd`, branch, modulo e status.
- Todo Preview candidato a homologacao deve informar URL tecnica, deployment id, projeto Vercel esperado, expectedDeploymentId atual de `homo`, rollback e validacoes.
- O alias `homo.c2x.app.br` deve ser movimentado por Zeus, nao por agentes de modulo em paralelo.
- O diario canonico continua sendo a memoria consolidada.
- Registros de homologacao e producao continuam separados.
- Deploy sensivel permanece bloqueado ate autorizacao explicita.

## Criterio de sucesso

- Lucas consegue saber onde cada agente esta trabalhando.
- Hefesto consegue promover producao por modulo, nao por pacote confuso.
- Zeus consegue auditar risco de ambiente, banco, Vercel e aliases sem depender do chat antigo.
- Um recorte homologado informa exatamente o que subiu, em qual commit, com qual validacao e qual rollback.
- O worktree raiz deixa de ser o lugar padrao para todo mundo trabalhar ao mesmo tempo.
