# Panteon - Template de Startup para Agente em Worktree

Status: `TEMPLATE OPERACIONAL`
Owner: `Zeus`

Use este template quando Lucas abrir um novo chat/agente para trabalhar em um
recorte do Panteon usando worktree separado.

## Prompt base

```text
Assunto: [<Modulo>] Inicializacao do agente em worktree

Voce e o agente <Modulo> do Panteon.

Antes de qualquer acao, leia obrigatoriamente:

- AGENTS.md
- docs/operations/README.md
- docs/operations/engineering-operations.md
- docs/operations/panteon-worktree-operating-model.md
- docs/architecture/panteon-architecture-map.md
- docs/architecture/agent-operating-model.md

Se a demanda tocar frontend, leia tambem:

- docs/architecture/design-guidelines.md

Se a demanda tocar ambiente, API externa, Vercel, Supabase, banco, migration,
env, secret, deploy, rollback ou producao, leia tambem:

- docs/architecture/security-governance.md
- docs/architecture/environment-governance.md
- docs/architecture/api-connection-governance.md
- docs/architecture/production-safety-policy.md
- docs/architecture/incident-response-policy.md
- docs/architecture/release-and-rollback-policy.md
- docs/architecture/secret-management-policy.md

Contexto:

- Worktree alvo: <caminho absoluto>
- Branch alvo: codex/<agente>/<tema>-<yyyymmdd>
- Modulo/recorte: <modulo e tema>
- Terminal operacional: PowerShell 7 (`pwsh`); Windows PowerShell 5.1 apenas como fallback.
- Fora de escopo: <modulos, ambientes e operacoes fora do recorte>

Primeira acao:

1. Rodar git status --short --branch.
2. Confirmar caminho do worktree.
3. Confirmar branch e ultimo commit.
4. Ler a ultima entrada do diario relacionada ao modulo/recorte.
5. Responder com resumo curto do estado, riscos e proximo passo.

Bloqueios:

- Nao executar deploy, redeploy, Supabase, banco, migration, env, secret,
  dominio, alias, rollback ou producao sem autorizacao explicita do Lucas.
- Nao misturar recortes de outros modulos.
- Se o worktree estiver misto, bloquear ou separar antes de publicar.
```

## Retorno inicial esperado

```text
Assunto: [<Modulo>] Agente iniciado em worktree

Lucas, confirmei:

- Worktree:
- Branch:
- Ultimo commit:
- Status Git:
- Escopo:
- Fora de escopo:
- Ultima entrada relevante do diario:
- Bloqueios:
- Proximo passo:

Conclusao:
- ...
```

## Checklist do agente

- Li os documentos obrigatorios.
- Confirmei worktree e branch.
- Identifiquei o modulo dono.
- Separei fora de escopo.
- Verifiquei se ha operacao sensivel.
- Sei quais validacoes preciso executar.
- Sei onde registrar o resultado no diario.

## Quando usar `CHAT SATURANDO`

Declarar `CHAT SATURANDO` quando:

- o chat ficou lento ou compactado;
- ha muitas frentes no mesmo fio;
- o agente depende de memoria de conversa antiga;
- existe risco de misturar modulos;
- o proximo passo precisa ser retomado por outro agente.

Registro minimo:

```text
Assunto: [<Modulo>] Checkpoint de continuidade

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

## Conclusao

Este template protege continuidade, evita dependencia de chat antigo e obriga
cada agente a trabalhar com recorte, worktree e branch claros antes de editar.
