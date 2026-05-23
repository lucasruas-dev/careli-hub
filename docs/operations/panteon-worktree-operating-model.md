# Panteon - Modelo Operacional de Worktrees

Status: `PADRAO PILOTO / ZEUS`
Owner: `Zeus`
Fonte complementar: `docs/architecture/panteon-architecture-map.md`

Este documento transforma o acordo de engenharia do Panteon em um procedimento
operacional para trabalhar com worktrees separados por agente, modulo e recorte.

O objetivo e impedir que o repositório principal vire um pacote misto,
impublicavel e dificil de validar.

## Principio central

Cada frente relevante deve trabalhar em um recorte isolado, com dono, branch,
worktree, validacao, riscos e handoff claros.

Worktree misto nao e release. Worktree misto e triagem.

## Topologia recomendada

```text
C:\Users\lucas\Documents\Careli_C2x\Sistemas\
  careli-hub\
    repositorio principal
  careli-hub-worktrees\
    zeus\
    hefesto\
    iris\
    hades\
    ares\
    hermes\
    atlas\
    chronos\
    setup\
```

Regras:

- O diretorio `careli-hub-worktrees` fica fora do repositorio principal.
- Nao criar worktrees dentro de `careli-hub`.
- Nao usar `.codex-worktrees` dentro do app, porque pode interferir em dev
  server, scans, watchers e validacoes.
- O worktree principal pode continuar existindo como area de referencia, mas
  nao deve ser usado para deploy amplo se estiver misto.

## Nome de branch

Padrao:

```text
codex/<agente>/<tema>-<yyyymmdd>
```

Exemplos:

```text
codex/zeus/worktree-pilot-20260522
codex/iris/meta-outbound-fix-20260522
codex/hades/billing-contracts-20260522
codex/ares/financial-escalations-20260522
codex/hermes/realtime-stickers-20260522
codex/hefesto/prod-release-atlas-20260522
```

Regras:

- Usar `codex/` como prefixo.
- Usar o agente ou modulo como segundo segmento.
- Usar tema curto, pesquisavel e sem acento.
- Evitar branch generica como `fix`, `dev`, `new`, `test` ou `changes`.

## Criacao de worktree

Antes de executar manualmente, o agente pode gerar um preview seguro:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/panteon-new-worktree.ps1 -Agent <agente> -Theme <tema>
```

O preview nao cria branch nem worktree. Para executar de fato, o operador deve
revisar o caminho e rodar explicitamente com `-Apply`.

Para listar scaffolds padrao de todos os agentes:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/panteon-scaffold-agents.ps1 -Theme worktree-pilot
```

Modelo para branch nova:

```powershell
git worktree add ..\careli-hub-worktrees\<agente> -b codex/<agente>/<tema>-<yyyymmdd>
```

Modelo para branch existente:

```powershell
git worktree add ..\careli-hub-worktrees\<agente> codex/<agente>/<tema>-<yyyymmdd>
```

Primeira acao obrigatoria dentro do worktree:

```powershell
git status --short --branch
```

O agente deve confirmar:

- caminho absoluto do worktree;
- branch atual;
- ultimo commit;
- se existem alteracoes locais;
- qual recorte vai trabalhar;
- o que esta fora de escopo.

## Quando criar um worktree novo

Criar worktree separado quando:

- o recorte pertence a um modulo ou agente especifico;
- o worktree principal esta misto;
- existe risco de deploy, homologacao ou producao futura;
- a tarefa exige validacao propria;
- outro agente esta trabalhando em paralelo;
- o chat anterior foi marcado como `CHAT SATURANDO`;
- o pacote precisa virar commit, homologacao ou handoff para Hefesto.

Nao precisa criar worktree novo quando:

- a acao e apenas leitura;
- a duvida e conceitual;
- a mudanca documental e minima e ja esta no worktree correto;
- Lucas pediu apenas analise sem implementacao.

## Matriz de decisao

| Situacao | Acao correta | Status |
| --- | --- | --- |
| Worktree limpo e recorte unico | Trabalhar no worktree atual | `OK` |
| Worktree sujo com outro modulo | Criar worktree separado ou bloquear | `SEPARAR` |
| Worktree mistura produto, banco e release | Bloquear ate separar recortes | `BLOQUEADO` |
| Commit mistura aprovados e nao aprovados | Recriar pacote limpo antes de producao | `BLOQUEADO` |
| Recorte homologado por modulo | Handoff para Hefesto | `PRONTO PARA PRODUCAO` |
| Operacao envolve env, secret, banco, Vercel, alias ou producao | Exigir autorizacao explicita do Lucas | `BLOQUEADO` |

## Ciclo do agente de modulo

1. Ler `AGENTS.md`, `docs/operations/README.md`, diario canonico e politicas
   aplicaveis.
2. Rodar `git status --short --branch`.
3. Confirmar worktree, branch e recorte.
4. Implementar apenas o modulo autorizado.
5. Validar proporcionalmente ao risco.
6. Registrar decisao, arquivos, validacoes, riscos e proximo passo no diario.
7. Se Lucas autorizar homologacao, publicar somente o proprio recorte.
8. Registrar homologacao em `docs/operations/releases-homologation.md` quando
   aplicavel.
9. Sinalizar no Zeus/Operations Center quando estiver `PRONTO PARA PRODUCAO`.

## Ciclo do Zeus

Zeus usa worktree separado para:

- Operations Center;
- comunicacao entre agentes;
- governanca, mapas e processos;
- diagnostico nao destrutivo;
- suporte, infraestrutura e dados em modo protegido;
- incidentes e bloqueios transversais.

Zeus nao deve:

- assumir feature de modulo sem pedido;
- aplicar migration real sem autorizacao;
- alterar env, secret, banco, alias, dominio ou producao sem autorizacao;
- transformar diagnostico em deploy sem handoff e registro.

## Ciclo do Hefesto

Hefesto deve usar worktree ou pacote limpo para producao.

Antes de publicar, Hefesto precisa:

- ler diario canonico, releases de homologacao e releases de producao;
- comparar Git, branch, commit e arquivos;
- separar recortes por modulo;
- bloquear pacote misto;
- validar build/checks do recorte;
- definir rollback;
- inspecionar aliases de producao quando aplicavel;
- registrar deployment, healthchecks e status final.

Hefesto nao deve publicar o worktree principal se ele estiver misto.

## Checkpoint de continuidade

Todo agente deve declarar `CHAT SATURANDO` quando houver:

- compactacao de contexto;
- lentidao por excesso de historico;
- risco de misturar modulos;
- muitas frentes abertas;
- dependencia de memoria de chat antigo;
- necessidade de retomar por outro agente ou novo chat.

Registro minimo:

```text
Assunto: [Modulo] Checkpoint de continuidade

Status: CHAT SATURANDO
Worktree:
Branch:
Ultimo commit:
Arquivos alterados:
Validacoes:
Riscos:
Proximo passo:
Operacoes sensiveis:
```

Operacoes sensiveis ficam bloqueadas ate o novo chat reler os documentos e
confirmar escopo.

## Checklist antes de editar

- Li os documentos obrigatorios?
- Estou no worktree correto?
- A branch tem nome pesquisavel?
- O recorte pertence a um unico modulo/agente?
- Existe alguma alteracao local que nao e minha?
- A tarefa toca frontend e exige `docs/architecture/design-guidelines.md`?
- A tarefa toca env, secret, banco, API externa, Vercel, Supabase ou producao?
- O que fica explicitamente fora de escopo?

## Checklist antes de commit ou handoff

Use tambem `docs/operations/panteon-validation-checklists.md` para escolher o
gate por tipo de recorte.

- `git status --short --branch` revisado.
- `git diff --check` executado no recorte.
- `check-types`, `lint`, `build` ou validacao focada executada quando
  aplicavel.
- Validacao funcional ou visual feita quando a mudanca toca fluxo de usuario.
- Diario canonico atualizado.
- Release register atualizado quando houve homologacao ou producao.
- Riscos e pendencias escritos sem valores sensiveis.
- Proxima squad recomendada definida.

## Validacao padrao de worktree

Quando o worktree estiver fora do repositorio principal, ele pode nao possuir
`node_modules` proprio. Nesse caso, o tooling de `turbo`, `eslint`,
`typescript` e configs `@repo/*` pode falhar mesmo quando o recorte esta
correto.

O fluxo padrao para validar um worktree e:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/panteon-validate-worktree.ps1 -Scope hub -PrepareSharedNodeModules
```

O script:

- resolve o root Git do worktree;
- localiza o repositorio principal `careli-hub`;
- cria um junction local `node_modules` apontando para o `node_modules` do
  repositorio principal somente quando `-PrepareSharedNodeModules` for
  informado;
- roda `git status --short --branch`;
- roda `git diff --check`;
- roda `check-types:hub`, `lint:hub` e build do Hub, salvo quando o agente
  usar flags de skip.
- por padrao usa `next build --webpack`, porque o Turbopack pode rejeitar
  junction de `node_modules` apontando para fora da raiz do worktree.

Flags uteis:

```powershell
-SkipTypes
-SkipLint
-SkipBuild
-BuildMode webpack
-BuildMode default
-MainRepoPath <caminho absoluto do careli-hub principal>
```

Regras:

- O script nao instala dependencias.
- O script nao acessa Vercel, Supabase, banco, env, secret, alias ou producao.
- O script nao substitui healthcheck funcional ou validacao visual quando o
  recorte exigir.
- Se `node_modules` ja existir no worktree e nao for junction, o script
  bloqueia para evitar sobrescrever estado local.
- `-BuildMode default` usa o build padrao do pacote e pode acionar Turbopack;
  em worktree com junction, preferir `-BuildMode webpack`.

## Politica de bloqueio

Bloquear quando:

- nao ha recorte claro;
- o worktree esta misto e nao existe pacote limpo;
- a alteracao depende de env, secret, banco, migration, Vercel, Supabase,
  dominio, alias ou producao;
- o modulo dono nao esta claro;
- a validacao exigida falhou;
- o commit/handoff mistura itens aprovados e nao aprovados.

O bloqueio deve explicar causa, impacto, quem deve agir e proximo passo.

## Registro no diario

Toda decisao relevante de worktree deve registrar:

- assunto;
- agente;
- data e hora local;
- worktree;
- branch;
- ultimo commit ou base;
- tipo de alteracao;
- arquivos afetados;
- validacoes;
- riscos;
- status;
- proxima squad.

## Conclusao

O modelo de worktrees torna a engenharia do Panteon mais previsivel:

- cada agente trabalha sem atropelar outro;
- cada recorte fica publicavel ou bloqueado por motivo claro;
- Zeus enxerga o estado operacional;
- Hefesto recebe pacotes limpos para producao;
- Lucas decide com menos ruido e mais rastreabilidade.
