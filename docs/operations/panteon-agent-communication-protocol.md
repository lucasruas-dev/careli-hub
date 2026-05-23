# Panteon - Protocolo de Comunicacao entre Agentes

Status: `PILOTO V0 / AGENTE MASTER ZEUS`

Este documento define como os agentes do Panteon devem se comunicar sem virar conversa solta, sem perder rastreabilidade e sem arriscar producao.

## Objetivo

- Transformar handoffs, bloqueios, duvidas, pedidos de deploy e incidentes em mensagens estruturadas.
- Dar ao Zeus uma visao de comando dos agentes.
- Dar ao Hefesto uma fila objetiva do que esta pronto para producao.
- Permitir que Iris, Hades, Hermes, Ares, Apolo, Atlas e Chronos peçam ou recebam acoes sem depender do chat antigo.
- Preservar o que ja esta em producao.

## Principio central

Agente nao conversa livremente com agente. Agente registra uma comunicacao operacional com origem, destino, modulo, protocolo, status, prioridade, decisao esperada e evidencias.

Comunicação sem estrutura vira ruído. Comunicação estruturada vira gestão.

## Papel do Zeus como agente master

Zeus passa a ser o coordenador operacional dos sinais entre agentes.

Responsabilidades:

- manter a visao consolidada de comunicacoes;
- identificar mensagens sem dono;
- priorizar bloqueios e incidentes;
- encaminhar producao para Hefesto;
- encaminhar comunicacao externa para Iris;
- manter banco, Vercel, Supabase, envs, APIs, saude e incidentes em modo protegido;
- registrar no Operations Center e no diario canonico quando a comunicacao virar decisao.

Zeus nao substitui os agentes de modulo. Ele organiza o trafego.

## Formato minimo da mensagem

Toda comunicacao entre agentes deve ter:

- protocolo da mensagem;
- agente origem;
- agente destino;
- modulo afetado;
- tipo;
- prioridade;
- status;
- protocolo relacionado, quando existir;
- resumo objetivo;
- decisao esperada;
- evidencias ou links;
- data/hora;
- operador/agente responsavel.

## Tipos permitidos

- `handoff`: passagem de bastao entre agentes.
- `bloqueio`: algo impede avancar.
- `duvida`: decisao ou regra precisa de confirmacao.
- `incidente`: erro, regressao, indisponibilidade ou risco real.
- `validacao`: pedido ou retorno de validacao.
- `pronto_para_homologacao`: recorte local validado aguardando homologacao autorizada.
- `pronto_para_producao`: recorte homologado aguardando Hefesto.
- `rollback`: reversao necessaria ou preparada.
- `auditoria`: revisao, saude, rotina ou conformidade.
- `contexto`: decisao de produto, regra de negocio ou aprendizado.

## Status permitidos

- `ABERTA`
- `EM ANALISE`
- `AGUARDANDO_ORIGEM`
- `AGUARDANDO_DESTINO`
- `BLOQUEADA`
- `RESPONDIDA`
- `ENCAMINHADA`
- `RESOLVIDA`
- `CANCELADA`

## Prioridades

- `critica`: producao, auth, banco, env, secret, Vercel, Supabase, alias, fluxo financeiro, Meta/WhatsApp real ou indisponibilidade.
- `alta`: bloqueio de release, erro relevante, perda de workflow ou risco operacional.
- `media`: handoff, validacao, melhoria com impacto operacional.
- `baixa`: contexto, ajuste documental, refinamento sem risco.

## Matriz de roteamento

| Origem | Destino padrao | Quando usar |
| --- | --- | --- |
| Qualquer agente | Zeus | incidente, bloqueio tecnico, Supabase, Vercel, banco, env, API, performance, logs ou seguranca |
| Qualquer agente | Hefesto | recorte homologado e pronto para producao |
| Hades | Iris | cobranca que precisa comunicacao externa ou protocolo `AT` |
| Ares | Iris | financeiro que precisa comunicacao externa |
| Apolo | Iris | relacionamento ou cadastro que exige contato externo |
| Iris | Agente do modulo | ticket externo que virou demanda interna |
| Hermes | Zeus | falha em comunicacao interna, realtime, mensagens ou anexos |
| Atlas/Chronos | Zeus | rotinas, dados, saude, auditoria ou performance |

## Protocolos relacionados

- `AT`: atendimento externo pela Iris.
- `CB`: cobranca/Hades.
- `TI`: HelpDesk tecnico.
- `OP`: operacao interna Zeus.
- `DP`: deploy/publicacao.
- `AL`: alerta.
- `LO`: log operacional.
- `AG`: comunicacao entre agentes.

Regra: um `AG` pode apontar para `AT`, `CB`, `TI`, `OP`, `AL`, `DP` ou `LO`, mas nao substitui o protocolo de negocio original.

## V0 implementada

A V0 nao cria tabela nova ainda. Ela usa dados reais existentes:

- `hub_engineering_operation_records`;
- diario estruturado do Operations Center;
- campos `squad`, `module`, `next_squad`, `status`, `risks`, `raw_content`;
- registros de release quando apontam para Hefesto.

Tela inicial:

- modulo `Zeus`;
- aba `Agentes`;
- fila por agente destino;
- destaque para bloqueios, handoffs para Hefesto e agentes ativos;
- clique no item abre o registro operacional original.

Limite da V0:

- a comunicacao ainda e derivada de registros existentes;
- nao existe thread viva entre agentes;
- nao existe resposta estruturada independente;
- nao existe protocolo `AG` sequencial real no banco.

## Checkpoint de continuidade

Todo agente deve avisar Lucas quando o chat estiver ficando saturado antes que a continuidade fique fragil.

Gatilhos de alerta:

- o contexto foi compactado uma ou mais vezes;
- o agente passou a depender de resumo de conversa para continuar;
- ha muitas frentes abertas no mesmo chat;
- o trabalho ficou lento por excesso de historico;
- decisoes recentes comecam a ficar dificeis de localizar;
- existe risco de misturar modulo, ambiente, deploy, banco ou recorte.

Quando um gatilho aparecer, o agente deve declarar status `CHAT SATURANDO` e executar o checkpoint:

- registrar no diario canonico a decisao, estado do worktree, branch, arquivos alterados, validacoes, riscos e proximo passo;
- criar ou atualizar um arquivo operacional em `docs/operations/` quando houver script/prompt de retomada;
- entregar para Lucas um resumo curto para abrir o proximo chat;
- bloquear deploy, banco, Vercel, Supabase, env, secret, migration ou producao ate o novo chat reler o diario e confirmar escopo;
- nao depender do historico do chat antigo para continuar.

Formato minimo do alerta:

```text
Assunto: [Modulo] Checkpoint de continuidade

Status: CHAT SATURANDO
Motivo:
- ...

Estado preservado:
- branch/worktree:
- arquivos:
- validacoes:
- pendencias:
- proximo passo:
```

Regra: a troca de chat nao e falha. E uma manobra operacional para preservar velocidade, rastreabilidade e qualidade.

## V1 proposta para banco

Nao aplicar sem autorizacao explicita do Lucas.

Tabelas futuras:

```text
hub_agent_threads
hub_agent_messages
hub_agent_message_links
hub_agent_message_events
```

`hub_agent_threads`:

- `id`
- `protocol` no formato `AG-000001`
- `subject`
- `module`
- `status`
- `priority`
- `created_by_agent`
- `assigned_to_agent`
- `opened_at`
- `closed_at`
- `metadata`

`hub_agent_messages`:

- `id`
- `thread_id`
- `from_agent`
- `to_agent`
- `message_type`
- `body`
- `decision_expected`
- `created_by_user_id`
- `created_at`
- `metadata`

`hub_agent_message_links`:

- `id`
- `thread_id`
- `linked_protocol`
- `linked_type`
- `url`
- `commit_sha`
- `deployment_id`
- `operation_record_id`
- `release_protocol_id`

`hub_agent_message_events`:

- `id`
- `thread_id`
- `event_type`
- `from_status`
- `to_status`
- `actor_agent`
- `actor_user_id`
- `created_at`
- `metadata`

## Regras de seguranca

- Nao registrar secrets, tokens, senhas, service role, `POSTGRES_URL`, JWT ou valores sensiveis.
- Mensagens sobre envs registram nomes e impacto, nunca valor.
- Mensagens sobre clientes usam somente o minimo operacional necessario.
- Comunicacao que envolver banco, migration, Vercel, Supabase, env, secret, dominio, alias ou producao comeca `BLOQUEADA`.
- Escrita real no banco exige autorizacao explicita do Lucas.

## Criterio de sucesso

- Lucas enxerga quem pediu o que, para quem, por que e em qual status.
- Hefesto recebe uma fila limpa de producao.
- Zeus identifica pontas soltas antes de virarem incidente.
- Agentes de modulo nao dependem de memoria de chat para continuar.
- Producao continua preservada.

## Roadmap

1. V0: aba `Agentes` no Zeus usando registros reais ja existentes.
2. V1: migration autorizada para tabelas `hub_agent_*`.
3. V2: API `POST /api/zeus/agent-messages` para criar mensagens reais.
4. V3: cada modulo cria handoff direto para Zeus/Hefesto/Iris.
5. V4: notificacoes e SLA por comunicacao.
6. V5: PO AI/Athena sugerem destino e prioridade, mas nao executam acao sensivel sem Lucas.
