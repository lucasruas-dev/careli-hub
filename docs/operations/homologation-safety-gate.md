# Homologation Safety Gate

Status: `ATIVO / OBRIGATORIO PARA HOMOLOGACAO`

Este documento define a trava operacional para impedir que um agente substitua, sem perceber, o estado vigente de `https://homo.c2x.app.br` ao publicar um recorte de modulo.

## Objetivo

- Preservar o que ja esta em homologacao.
- Bloquear deploy de pacote misto ou worktree sujo.
- Garantir que o alias de homologacao nao mudou entre o preflight e a publicacao.
- Dar ao Zeus e ao Hefesto rastreabilidade objetiva de base, pacote, inclusoes, exclusoes, validacoes e rollback.

## Regra central

`homo.c2x.app.br` e um alias unico apontando para snapshots imutaveis da Vercel. Todo agente deve tratar esse alias como recurso compartilhado.

Antes de publicar ou reapontar homologacao, o agente precisa provar que:

- conhece o deployment atual que sera substituido;
- esta publicando um pacote limpo baseado no estado vigente aprovado;
- incluiu somente arquivos do recorte autorizado;
- excluiu recortes incompletos, rotas nao homologadas, envs, secrets, migrations, banco, dominio e producao;
- executou validacoes proporcionais ao risco;
- tem rollback imediato registrado.

Se qualquer item nao estiver claro, o estado deve ser `BLOQUEADO`.

## Fluxo obrigatorio

1. Confirmar worktree e branch.

```powershell
git status --short --branch
git worktree list
```

2. Inspecionar o alias de homologacao antes de montar o pacote.

```powershell
npx.cmd vercel inspect https://homo.c2x.app.br
```

3. Registrar o deployment atual como `expectedDeploymentId`.

4. Montar pacote limpo fora do worktree sujo, preservando a base homologada e aplicando overlay somente do modulo autorizado.

5. Declarar o manifesto do gate com:

- `module`;
- `alias`;
- `expectedDeploymentId`;
- `packagePath`;
- `includedFiles`;
- `excludedPaths`;
- `validations`;
- `rollbackDeploymentId`;
- `approvedBy`.

6. Rodar o gate antes de qualquer deploy ou alias.

```powershell
node scripts/homologation-safety-gate.mjs --manifest .codex-deploy/<pacote>/homologation-safety-gate.json
```

7. Publicar o Preview somente se o gate passar.

8. Rodar o gate novamente antes de `vercel alias set`. Se `homo.c2x.app.br` mudou desde o preflight, bloquear e reconciliar com Lucas.

9. Depois do alias, executar healthchecks, registrar deploy/rollback e atualizar `docs/operations/releases-homologation.md` e `docs/operations/engineering-operations.md`.

## Manifesto minimo

```json
{
  "module": "iris",
  "alias": "https://homo.c2x.app.br",
  "expectedDeploymentId": "dpl_atual_antes_do_deploy",
  "packagePath": ".codex-deploy/iris-homolog-YYYYMMDD-HHMMSS/workspace",
  "includedFiles": [
    "apps/hub/modules/caredesk/IrisPage.tsx",
    "apps/hub/app/api/iris/meta/templates/route.ts",
    "apps/hub/lib/iris/meta-whatsapp.ts",
    "turbo.json"
  ],
  "excludedPaths": [
    "apps/hub/app/api/iris/attendant",
    "apps/hub/app/api/iris/meta/templates/media",
    ".env.local"
  ],
  "validations": [
    "npm.cmd run check-types:hub",
    "npm.cmd run lint:hub",
    "npm.cmd run build --workspace @repo/hub"
  ],
  "rollbackDeploymentId": "dpl_rollback_conhecido",
  "approvedBy": "Lucas"
}
```

## Condicoes de bloqueio

O gate deve bloquear quando:

- `expectedDeploymentId` nao bate com o deployment atual do alias;
- o pacote contem `.git`;
- `packagePath` aponta para o proprio worktree principal;
- um arquivo declarado em `includedFiles` nao existe no pacote;
- um caminho declarado em `excludedPaths` existe no pacote;
- o manifesto inclui `.env`, `.vercel`, `node_modules`, `.next`, `.turbo`, migrations, banco ou secrets sem autorizacao explicita;
- o pacote contem `.env.local` ou outro arquivo real de env; arquivos terminados em `.example`, `.sample` ou `.template` sao permitidos;
- `.vercel` pode existir apenas como link tecnico de projeto; nao deve conter nem registrar valores sensiveis;
- o deploy depender de alteracao sensivel nao autorizada;
- o agente nao consegue declarar rollback.

## Papeis

- Agente de modulo: monta recorte limpo, roda o gate, publica homologacao quando Lucas autorizar e registra o resultado.
- Zeus: audita divergencias, protege alias, bloqueia pacote misto e coordena reconciliacao.
- Hefesto: usa os registros homologados para promover producao, sem assumir recorte nao validado.
- Lucas: autoridade humana para liberar operacoes sensiveis e decidir conflito entre recortes.

## Uso em correcoes emergenciais

Quando Zeus precisar corrigir algo pequeno em homologacao, ele tambem deve usar o gate. A correcao so pode substituir o alias se o pacote preservar o deployment vigente e excluir explicitamente os recortes de outros agentes que nao foram aprovados.

## Saida esperada

O script `scripts/homologation-safety-gate.mjs` deve retornar:

- `PASS` quando o pacote esta pronto para seguir;
- `BLOQUEADO` quando existe divergencia, mistura ou risco;
- avisos quando o risco nao bloqueia, mas precisa ser registrado no handoff.

Conclusao:

- O Safety Gate transforma homologacao em uma etapa controlada, nao em uma corrida de aliases.
- O impacto pratico e impedir que uma correcao de Zeus apague uma melhoria da Iris ou que um modulo publique item de outro agente por acidente.
- A proxima acao de qualquer agente antes de homologacao e montar manifesto, rodar o gate e registrar o resultado.
