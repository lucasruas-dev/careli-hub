# Production Safety Policy

Este documento define a politica de protecao de producao do Panteon.

## Regra principal

Producao e ambiente critico. Nenhuma alteracao destrutiva, migration real, troca de chave, troca de banco, alteracao de dominio, alias, Vercel Production deployment ou env critica pode ser executada diretamente em producao sem:

- autorizacao explicita do Lucas;
- validacao previa em homologacao quando houver risco operacional;
- plano de rollback;
- healthchecks definidos;
- registro no Engineering Operations.

## O que bloqueia producao

Manter `BLOQUEADO` quando houver:

- chave ausente, invalida, vencida ou de ambiente errado;
- divergencia entre Preview/Homologacao e Production;
- `POSTGRES_URL` apontando para banco inesperado;
- service role de producao em ambiente de homologacao;
- migration sem autorizacao do Lucas;
- deploy com recorte misturado ou worktree sujo sem isolamento;
- dominio/alias sem confirmacao do ambiente alvo;
- healthcheck critico falhando.

## Homologacao antes de producao

Homologacao e obrigatoria quando o recorte envolve:

- autenticao, Supabase, Realtime, RLS ou banco;
- envs, secrets, service role ou `POSTGRES_URL`;
- rotas server-side sensiveis;
- workflow financeiro, boleto, assinatura, envio ou integracao externa;
- dominio, alias, protection bypass ou production deployment.

## Safe Mode em producao

Quando o runtime detectar env critica ausente, invalida ou cruzada:

- bloquear escrita e acoes destrutivas;
- retornar erro operacional claro;
- nunca revelar valor da env;
- manter leitura segura quando possivel;
- impedir fallback automatico para banco de producao quando o ambiente for homologacao;
- orientar handoff para Zeus/Zeus.

## Healthchecks minimos

Para deploy sensivel:

- `/` deve responder.
- Rotas protegidas sem sessao devem responder `401` ou `403`, nao `503` de env.
- Healthcheck de banco deve responder apenas no ambiente autorizado.
- Logs recentes nao devem conter erro critico.
- Validacoes especificas do modulo devem ser registradas.

## Criterio de conclusao

Uma mudanca sensivel so pode sair de `BLOQUEADO` quando:

- Lucas autorizou;
- homologacao passou ou houve justificativa registrada;
- o Zeus publicou recorte limpo;
- Zeus validou ambiente;
- Zeus/Zeus foram acionados quando necessario;
- rollback path esta registrado.
