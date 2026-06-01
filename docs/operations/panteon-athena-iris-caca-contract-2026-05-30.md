# Panteon - contrato Athena e Iris Caca

Assunto: [Athena] contrato Iris Caca

Status: `VALIDADO_LOCAL / DOCUMENTAL / SEM OPERACAO SENSIVEL`

Protocolo: `AT-20260530-002-ATHENA-IRIS-CACA`

Base:

- `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`
- `docs/operations/iris-ai-attendant-agent-operating-contract.md`
- `docs/architecture/api-connection-governance.md`
- `apps/hub/lib/iris/caca-agent.ts`
- `apps/hub/app/api/iris/attendant/route.ts`
- `apps/hub/modules/caredesk/IrisPage.tsx`

## Objetivo

Declarar a fronteira entre Athena, Iris e Caca antes de qualquer novo ajuste de IA no atendimento externo.

Este recorte nao altera codigo, prompt runtime, webhook Meta, OpenAI, modelo, env, banco, Supabase, Vercel, alias, dominio, homologacao ou producao.

## Papeis

### Iris Core

- E o owner de produto do atendimento externo.
- Controla tickets, conversa, filas, Meta/WhatsApp, templates, protocolo, handoff humano e UI da Iris.
- Deve aprovar qualquer mudanca que altere comportamento customer-facing da Caca.

### Caca

- E o agente customer-facing da Iris para primeiro atendimento.
- Fala com cliente final em portugues do Brasil, de forma curta, humana e operacional.
- Pode usar OpenAI somente server-side e dentro do contrato operacional da Iris.
- Nao e Athena, nao e suporte interno, nao e agente de bordo do operador e nao substitui humano em cobranca sensivel.

### Athena

- E a camada transversal de IA do Panteon.
- Governa padroes de prompt, sanitizacao, analise, fallback, evidencias, logs e evolucao tecnica dos agentes conectados a OpenAI.
- Apoia a Caca sem assumir o atendimento externo e sem alterar produto fora de protocolo Iris.
- Deve manter cada mudanca de IA vinculada ao owner do modulo consumidor.

### Zeus

- Controla risco, recorte, manifesto, fronteira, env names, logs e operacoes sensiveis.
- Mantem OpenAI, Meta/WhatsApp, banco, Supabase, Vercel, alias, dominio, deploy, migration e producao bloqueados sem autorizacao explicita do Lucas.
- Pode auditar nomes, impacto e status, mas nao deve expor valores sensiveis.

## Contrato de autoridade

| Decisao | Dono |
| --- | --- |
| Experiencia de atendimento externo | Iris Core |
| Prompt, sanitizacao e fallback de IA | Athena com Iris Core |
| Risco, env names, logs e gates | Zeus |
| Handoff humano e fila operacional | Iris Core |
| Publicacao Preview/Homo autorizada | Zeus pelo protocolo |
| Producao autorizada | Hefesto/Zeus com aprovacao do Lucas |

## Env names reconhecidos

Os nomes abaixo podem ser citados para governanca, nunca com valores:

- `OPENAI_API_KEY`
- `HUB_IRIS_ATTENDANT_MODEL`
- `HUB_AI_MODEL`
- `META_WHATSAPP_APP_ID`
- `META_WHATSAPP_APP_SECRET`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `META_WHATSAPP_GRAPH_VERSION`

Regras:

- Nenhum valor de env deve entrar em docs, logs, chat, payload de browser ou resposta da IA.
- Nenhuma env Meta/OpenAI deve virar `NEXT_PUBLIC_*`.
- OpenAI e Meta sao server-only.
- Falta de env deve produzir erro operacional sanitizado ou fallback sem quebrar o fluxo principal.

## Dados permitidos para IA

A Caca pode receber apenas contexto minimizado e autorizado, por exemplo:

- resumo do ticket e mensagens recentes sanitizadas;
- protocolo do atendimento;
- nome exibivel quando necessario para atendimento;
- status operacional seguro;
- resumo financeiro agregado ja autorizado por ferramenta server-side;
- metadados seguros de contrato/unidade quando existirem;
- resultado de ferramenta controlada, nunca payload bruto.

## Dados proibidos para IA e logs

Nao enviar nem registrar:

- secrets, tokens, bearer, API keys ou connection strings;
- payload bruto da Meta;
- SQL livre, nomes de tabelas como resposta ao cliente ou stack trace;
- CPF/CNPJ/documento completo persistido em estado, prompt ou trace;
- telefone completo quando nao for indispensavel;
- link privado, link assinado D4Sign ou URL temporaria sensivel;
- boleto, valor, parcela ou contrato fora de ferramenta oficial autorizada;
- arquivo bruto, midia binaria ou anexo sem pipeline homologado de sanitizacao.

## Separacao Caca e Athena

Regras obrigatorias:

- Caca nunca deve dizer ao cliente que e Athena.
- Caca nunca deve agir como suporte interno, copiloto do operador ou agente de engenharia.
- Athena nunca deve responder cliente final diretamente pela Iris sem contrato customer-facing explicito.
- Athena pode gerar analise, resumo e melhoria de prompt para Iris, desde que o produto final continue sob Iris Core.
- Quando houver risco financeiro, identidade conflitante, documento, contrato, boleto, negociacao, desconto ou dado sensivel, a Caca deve usar ferramenta server-side ou handoff humano.

## Fallback e indisponibilidade

Se OpenAI estiver indisponivel, sem key ou sem modelo configurado:

- a UI/fluxo principal da Iris nao pode quebrar;
- Caca deve usar fallback deterministico seguro quando existir;
- quando o fallback nao resolver com seguranca, transferir para humano com resumo;
- logs devem registrar causa operacional sanitizada, sem prompt bruto sensivel e sem stack trace para cliente.

Se Meta/WhatsApp estiver indisponivel:

- inbound/outbound deve falhar fechado conforme governanca;
- erro deve diferenciar env ausente, destinatario nao permitido, numero nao registrado e falha operacional;
- nenhum token ou payload bruto deve aparecer em log.

## Gates para mudanca futura

Qualquer mudanca runtime em Caca/Athena/Iris deve declarar novo protocolo e validar, no minimo:

- `npm.cmd run check-types:hub`;
- `npm.cmd run lint:hub`;
- `npm.cmd run build --workspace @repo/hub`;
- manifesto de recorte;
- boundary check com `--module iris --allow athena` ou protocolo Zeus equivalente;
- smoke seguro da rota/tela afetada sem expor sessao, token ou payload sensivel;
- diario operacional atualizado.

Quando envolver OpenAI, Meta, banco, Supabase, Vercel, env, secret, alias, dominio, migration, homologacao ou producao, o status inicial e `BLOQUEADO` ate autorizacao explicita do Lucas.

## Proximo recorte

Proximo contrato recomendado: `AT-20260530-003-ATHENA-HADES-COPILOT`.

Objetivo esperado:

- declarar o limite entre Athena e Hades antes de copilots financeiros;
- preservar regras de cobranca, acordos, Asaas, D4Sign e dados financeiros;
- impedir que IA negocie, prometa desconto ou exponha dado financeiro sem ferramenta/humano autorizado.

## Conclusao

- O contrato AT-002 formaliza que Caca e agente externo da Iris, enquanto Athena e camada transversal de IA.
- O impacto pratico e proteger o atendimento ao cliente contra ownership confuso, prompt inseguro, vazamento de dados e operacao sensivel sem autorizacao.
- Nao ha acao do usuario final agora; a proxima acao tecnica e seguir para o contrato Athena/Hades antes de qualquer copilot financeiro.
