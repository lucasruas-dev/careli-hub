# Environment Governance

Este documento define a politica de ambientes, env registry e gestao operacional de variaveis do Careli Hub.

## Ambientes oficiais

| Ambiente | Uso | Regra |
| --- | --- | --- |
| Local | Desenvolvimento e validacao inicial | Pode usar `.env.local`; nunca commitar valores. |
| Homologacao | Validacao operacional antes de producao | Caminho padrao para recortes com risco operacional. |
| Producao | Operacao real da Careli | Critico; mudancas sensiveis exigem autorizacao explicita do Lucas. |

## Bloqueio padrao

Qualquer operacao envolvendo Vercel, Supabase, banco, dominio, alias, production deployment, migration ou variavel sensivel deve iniciar como `BLOQUEADO` ate autorizacao expressa do Lucas.

Exemplos:

- Criar, editar, remover, renomear ou rotacionar env.
- Copiar chave entre ambientes.
- Adicionar protection bypass ou alterar regra de acesso.
- Alterar alias ou dominio.
- Alterar `POSTGRES_URL`, pooler ou banco alvo.
- Publicar production deployment que dependa de nova env sensivel.

## Env Registry

O registry deve documentar nomes, finalidade, owner e criticidade, nunca valores.

| Nome ou familia | Owner | Finalidade | Criticidade |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_CARELI_APP_ENV` | InfraOps | Identificar ambiente publico do app. | Media |
| `NEXT_PUBLIC_CARELI_APP_URL`, `NEXT_PUBLIC_APP_URL` | InfraOps | URL publica do ambiente. | Media |
| `NEXT_PUBLIC_SUPABASE_URL` | InfraOps/DataOps | URL publica Supabase para browser/build. | Alta |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | InfraOps/DataOps | Chave publica Supabase para browser/Auth. | Alta |
| `SUPABASE_URL` | InfraOps/DataOps | URL Supabase server-side. | Alta |
| `SUPABASE_ANON_KEY`, `SUPABASE_PUBLISHABLE_KEY` | InfraOps/DataOps | Chave publica server-side/compatibilidade. | Alta |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY` | InfraOps/DataOps | Chave privilegiada server-side. | Critica |
| `POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING` | DataOps/InfraOps | Conexao Postgres. | Critica |
| `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` | DataOps/InfraOps | Componentes de conexao Postgres. | Critica |
| `GUARDIAN_DB_*` | InfraOps/Guardian Core | Conexao C2X/Guardian. | Critica |
| `ASAAS_*`, `D4SIGN_*`, `OPENAI_API_KEY`, `GUARDIAN_SYNC_SECRET` | InfraOps/Squad responsavel | Integracoes externas. | Critica |
| `VERCEL_GIT_COMMIT_REF` | ReleaseOps/InfraOps | Rastreabilidade de build/deploy. | Baixa |

## Regras por ambiente

- Local pode usar chaves locais, mas arquivos `.local` permanecem fora do Git.
- Homologacao deve usar Supabase/banco de homologacao quando houver escrita real.
- Homologacao nao deve usar service role de producao.
- Producao nao deve receber chave de homologacao, sandbox ou projeto errado.
- Variaveis `NEXT_PUBLIC_*` sao expostas ao browser e nunca podem carregar segredo.
- Variaveis server-only nao devem ser transformadas em `NEXT_PUBLIC_*`.

## Validacao minima

Antes de liberar uma mudanca de env:

- Confirmar ambiente alvo.
- Confirmar nome da env e owner.
- Confirmar se e publica ou server-only.
- Confirmar que o valor nao foi exibido.
- Rodar healthcheck ou smoke apropriado.
- Registrar resultado no Engineering Operations.

## Registro obrigatorio

Toda alteracao de env precisa registrar:

- Protocolo.
- Ambiente.
- Nome da variavel ou familia.
- Motivo.
- Aprovacao do Lucas.
- Executor/revisor InfraOps.
- Deploy/redeploy necessario.
- Healthcheck e rollback path.
