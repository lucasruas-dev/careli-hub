# Gate de producao por recorte

Este gate existe para impedir que uma publicacao de producao carregue trabalho fora do recorte aprovado.

Regra central:

- producao validada e sempre a base;
- o recorte aprovado e aplicado por cima dessa base;
- qualquer arquivo fora da allowlist do recorte bloqueia o deploy;
- worktree sujo ou pacote misto nunca e origem de producao.

## Quando usar

Use antes de qualquer publicacao em `https://c2x.app.br` ou `https://ops.c2x.app.br`.

O gate e obrigatorio mesmo quando a mudanca parecer pequena. Se Lucas aprovar `Home / Disponibilidade`, caminhos como `apps/hub/app/escritorio-virtual/**`, `apps/hub/app/ares/**`, `apps/hub/modules/ares/**`, Iris, Hades, Hermes, Chronos ou qualquer outro modulo nao listado em `allowedChangedPaths` devem bloquear automaticamente.

## Fluxo seguro

1. Confirmar qual deployment de producao esta valido e qual e o rollback.
2. Criar pacote `base` a partir do estado validado de producao.
3. Criar pacote `candidate` a partir do mesmo `base`.
4. Aplicar no `candidate` somente os arquivos do recorte aprovado.
5. Garantir `git status --short` limpo no worktree de origem.
6. Criar manifesto do gate com `basePackagePath`, `candidatePackagePath`, deployment atual, rollback, commit e `allowedChangedPaths`.
7. Rodar:

```powershell
npm.cmd run deploy:prod:gate -- --manifest docs/operations/<manifesto>.json
```

8. Se o status for `PASS`, seguir para build, validacao e deploy com `--skip-domain`.
9. So depois dos healthchecks, apontar o alias aprovado.
10. Registrar deployment, validacoes, rollback e conclusao no diario operacional.

## Bloqueios absolutos

O gate deve falhar quando encontrar:

- mudanca fora de `allowedChangedPaths`;
- mudanca em `protectedPaths`;
- `.env`, `.git`, `.vercel`, `.next`, `.turbo`, `node_modules`, `dist`, `coverage` ou arquivo `.log` no pacote;
- `sourceWorktreeClean` diferente de `true`;
- deployment atual ou rollback ausente;
- commit candidato ausente;
- pacote base e candidato iguais;
- manifesto sem recorte allowlisted.

## Template rapido

```powershell
npm.cmd run deploy:prod:gate -- --init > docs/operations/production-recorte-safety-gate-<protocolo>.json
```

Preencha o manifesto e rode o gate. Nunca use `npx.cmd vercel --prod` diretamente sem `PASS` deste gate.

## Responsabilidade

- Agente de modulo prepara e valida o recorte isolado.
- Zeus/Hefesto publica producao somente depois do `PASS`.
- Lucas aprova o protocolo e o dominio alvo.

Conclusao:

- O que aconteceu: este processo transforma a regra de recorte em bloqueio tecnico antes do deploy.
- Impacto pratico: um pacote de Disponibilidade nao consegue levar `Escritorio`, Ares, Iris, Hades ou qualquer outro modulo sem aprovacao explicita.
- Precisa de acao agora: toda producao futura deve usar este gate.
- Quem deve agir agora: Zeus/Hefesto devem aplicar o gate; agentes de modulo devem entregar allowlist precisa.
- Proximo passo: manter o manifesto do recorte junto do registro operacional de cada publicacao.
