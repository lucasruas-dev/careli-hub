# Panteon - contrato Athena e Hades Copilot

Assunto: [Athena] contrato Hades Copilot

Status: `VALIDADO_LOCAL / DOCUMENTAL / SEM OPERACAO SENSIVEL`

Protocolo: `AT-20260530-003-ATHENA-HADES-COPILOT`

Base:

- `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`
- `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`
- `docs/architecture/api-connection-governance.md`
- `docs/architecture/environment-governance.md`
- `apps/hub/modules/guardian/intelligence/IntelligencePage.tsx`
- `apps/hub/app/api/ai/chat/route.ts`
- `apps/hub/lib/guardian/read-model.ts`
- `apps/hub/lib/guardian/attendance.ts`
- `apps/hub/lib/guardian/asaas.ts`

## Objetivo

Declarar a fronteira entre Athena e Hades antes de evoluir copilots financeiros, analises de carteira ou assistentes de cobranca.

Este recorte nao altera codigo, prompt runtime, OpenAI, Asaas, D4Sign, banco, env, Supabase, Vercel, alias, dominio, homologacao ou producao.

## Superficie atual reconhecida

O Hades ja possui uma superficie de IA operacional na tela de Inteligencia:

- `HadesIntelligenceAssistant` em `apps/hub/modules/guardian/intelligence/IntelligencePage.tsx`;
- cliente compartilhado `askHubAi` em `apps/hub/lib/hub-ai/client.ts`;
- rota server-side `/api/ai/chat` em `apps/hub/app/api/ai/chat/route.ts`;
- modulo declarado como `guardian`;
- contexto de tela, snapshot financeiro e fila operacional quando disponiveis;
- enriquecimento server-side com read model do Hades quando o modulo e `guardian`.

Essa superficie deve ser tratada como copilot interno de operador, nunca como atendimento automatico ao cliente e nunca como executor de cobranca.

## Papeis

### Hades Core

- E o owner de produto de cobranca, carteira, atendimento financeiro, acordos, Asaas, D4Sign, read model e legado Guardian.
- Aprova qualquer comportamento que altere fila, prioridade, status, acordo, boleto, contrato ou atendimento financeiro.
- Decide quando um insight de IA pode virar acao operacional.

### Athena

- E a camada transversal de IA do Panteon.
- Pode resumir carteira, explicar tendencias, destacar riscos e preparar sugestoes para validacao humana.
- Nao negocia, nao promete desconto, nao envia boleto, nao altera status e nao dispara integracao externa.
- Deve usar apenas contexto autorizado, minimizado e sanitizado.

### Zeus

- Controla risco, recorte, manifesto, fronteira, env names, logs e operacoes sensiveis.
- Mantem OpenAI, Asaas, D4Sign, banco, Supabase, Vercel, alias, dominio, deploy, migration e producao bloqueados sem autorizacao explicita do Lucas.
- Pode auditar nomes, impacto e status, sem expor valores sensiveis.

### Hefesto

- Atua apenas quando houver promocao de release/producao autorizada.
- Bloqueia pacote misto, worktree sujo, mudanca financeira sem homologacao ou recorte sem rollback.

## Contrato de autoridade

| Decisao | Dono |
| --- | --- |
| Regras de cobranca, acordos, carteira e boletos | Hades Core |
| Prompt, resumo, classificacao e explicacao de IA | Athena com Hades Core |
| Env names, logs, fronteira, manifesto e operacoes sensiveis | Zeus |
| Execucao de acao financeira real | Hades Core com aprovacao humana e protocolo |
| Preview/Homo autorizado | Zeus pelo protocolo |
| Producao autorizada | Hefesto/Zeus com aprovacao do Lucas |

## Env names reconhecidos

Os nomes abaixo podem ser citados para governanca, nunca com valores:

- `OPENAI_API_KEY`
- `HUB_AI_MODEL`
- `GUARDIAN_DB_HOST`
- `GUARDIAN_DB_PORT`
- `GUARDIAN_DB_NAME`
- `GUARDIAN_DB_USER`
- `GUARDIAN_DB_PASSWORD`
- `GUARDIAN_DB_SSL`
- `GUARDIAN_SYNC_SECRET`
- `ASAAS_API_KEY`
- `ASAAS_API_BASE_URL`
- `D4SIGN_TOKEN_API`
- `D4SIGN_CRYPT_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `POSTGRES_URL`

Regras:

- Nenhum valor de env deve entrar em docs, logs, chat, payload de browser ou resposta da IA.
- Nenhuma env financeira, banco, OpenAI, Asaas ou D4Sign deve virar `NEXT_PUBLIC_*`.
- OpenAI, Asaas, D4Sign, Guardian DB e Supabase privilegiado sao server-only.
- Falta de env deve produzir erro operacional sanitizado ou fallback sem quebrar a tela principal.

## Dados permitidos para o copilot

Permitido quando minimizado, autorizado e relevante:

- indicadores agregados da carteira;
- distribuicao por risco, atraso, status, empreendimento e prioridade;
- resumo de fila operacional;
- resumo de cliente aberto para operador autenticado;
- status de read model e fonte operacional;
- historico de atendimento em forma resumida, quando houver permissao e necessidade.

## Dados proibidos para IA e logs

Nao enviar, registrar nem repetir:

- secrets, tokens, bearer, API keys, service role ou connection strings;
- SQL livre, stack trace, host, usuario, database ou erro bruto;
- CPF/CNPJ/documento completo;
- telefone completo quando nao for indispensavel;
- payload financeiro completo;
- link assinado D4Sign, documento bruto ou contrato completo;
- boletoUrl, faturaUrl ou link de pagamento para cliente sem ferramenta oficial e confirmacao humana;
- regras internas de negociacao, desconto, margem ou aprovacao que nao estejam liberadas para o operador.

Observacao de risco:

- Qualquer contexto existente que contenha documento completo, boleto, link ou dado financeiro identificavel deve ser tratado como divida tecnica de sanitizacao antes de ampliar o uso de IA do Hades.
- O copilot pode orientar operador interno, mas nao deve transformar dado sensivel em resposta pronta para cliente final sem ferramenta/humano autorizado.

## Limites de resposta

Athena em Hades pode:

- resumir situacao da carteira;
- explicar tendencia de inadimplencia;
- destacar risco por empreendimento, perfil ou prioridade;
- sugerir proxima acao operacional para validacao humana;
- preparar roteiro interno para operador;
- apontar dados ausentes ou inconsistentes.

Athena em Hades nao pode:

- afirmar que reenviou boleto ou contrato;
- gerar, alterar, cancelar ou reenviar boleto;
- prometer desconto, prazo, acordo, baixa, renegociacao ou condicao juridica;
- fazer chamada real para Asaas, D4Sign, banco, Supabase privilegiado ou webhook externo;
- escrever para cliente como se fosse a equipe de cobranca sem revisao humana;
- alterar status, responsavel, workflow, promessa ou acordo.

## Fallback e indisponibilidade

Se OpenAI estiver indisponivel, sem key ou sem modelo configurado:

- a tela de Hades deve continuar utilizavel;
- a IA deve informar indisponibilidade de forma operacional e curta;
- a acao financeira ou atendimento humano nao pode depender de resposta da IA;
- logs devem registrar causa sanitizada, sem prompt bruto sensivel.

Se Hades DB/read model estiver indisponivel:

- Athena deve responder apenas com o contexto de tela disponivel;
- quando faltar dado, deve dizer exatamente o que falta;
- nao deve inventar totais, clientes, valores, parcelas, status ou links.

Se Asaas ou D4Sign estiverem indisponiveis:

- nenhuma acao deve ser simulada;
- operador deve receber erro operacional seguro;
- acao real continua bloqueada ate ferramenta oficial retornar sucesso.

## Gates para mudanca futura

Qualquer mudanca runtime em Hades/Athena deve declarar novo protocolo e validar, no minimo:

- `npm.cmd run check-types:hub`;
- `npm.cmd run lint:hub`;
- `npm.cmd run build --workspace @repo/hub`;
- manifesto de recorte;
- boundary check com `--module hades --allow athena` ou protocolo Zeus equivalente;
- smoke seguro da rota/tela afetada sem expor sessao, token, payload financeiro ou dado pessoal;
- diario operacional atualizado.

Mudancas envolvendo OpenAI, Asaas, D4Sign, Guardian DB, Supabase, env, secret, alias, dominio, migration, homologacao, producao, boleto, acordo, desconto ou envio real comecam `BLOQUEADO` ate autorizacao explicita do Lucas.

## Proximo recorte

Proximo contrato recomendado: `AT-20260530-004-ATHENA-CHRONOS-MINUTES`.

Objetivo esperado:

- declarar limites entre Athena e Chronos para atas, transcricoes e agentes de reuniao;
- proteger transcricoes, participantes, decisoes executivas e follow-ups;
- impedir ata aprovada automaticamente sem revisao humana.

## Conclusao

- O contrato AT-003 formaliza Athena em Hades como copilot interno de operador, nao como executor financeiro.
- O impacto pratico e reduzir risco de IA negociar, prometer, reenviar boleto, expor dado sensivel ou acionar Asaas/D4Sign sem ferramenta e aprovacao.
- Nao ha acao do usuario final agora; a proxima acao tecnica e seguir para o contrato Athena/Chronos antes de evoluir atas e agentes de reuniao.
