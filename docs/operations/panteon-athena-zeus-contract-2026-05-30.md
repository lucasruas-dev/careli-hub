# Panteon - contrato Athena e Zeus

Assunto: [Athena] contrato operacional com Zeus

Status: `VALIDADO_LOCAL / SEM OPERACAO SENSIVEL`

Protocolo: `AT-20260530-001-ATHENA-ZEUS-CONTRACT`

## Objetivo

Formalizar Athena como central dos agentes de IA do Panteon, conectada conceitualmente a OpenAI e aos copilots dos modulos, sem alterar chaves, envs, APIs externas, banco, Supabase, Vercel, deploy ou producao.

Este contrato define quem decide, quem executa, quem bloqueia e como cada modulo consome IA sem perder ownership de produto.

## Regra central

Athena e a camada transversal de IA. Zeus e o controle operacional, Data, Infra, SupportOps, seguranca, recortes e rastreabilidade.

Athena nao substitui o agente construtor do modulo. Quando IA tocar produto, o owner do modulo continua responsavel pelo comportamento funcional.

## Autoridade

| Tema | Responsavel | Regra |
| --- | --- | --- |
| Prioridade e liberacao sensivel | Lucas | Autoridade humana final. |
| Controle operacional | Zeus | Classifica risco, bloqueia operacao sensivel, registra protocolo e valida fronteira. |
| IA transversal | Athena | Define contrato de prompts, copilots, analises, transcricoes, evidencias e respostas estruturadas. |
| Produto do modulo | Agente do modulo | Implementa comportamento do proprio modulo com contrato Athena declarado. |
| Producao | Hefesto | Promove somente protocolo homologado, validado e autorizado. |

## Fronteira Athena

Athena pode atuar em:

- prompts e respostas estruturadas;
- leitura tecnica de evidencias;
- copilots internos;
- transcricao e resumo;
- rascunhos de atas;
- analise operacional assistida;
- organizacao de contexto para agentes de modulo;
- mensagens de fallback quando IA estiver indisponivel.

Athena nao pode atuar em:

- alterar produto sem owner do modulo;
- executar comandos;
- aplicar migrations;
- publicar Preview, homologacao ou producao;
- alterar alias, dominio, Vercel, Supabase, banco ou env;
- registrar valor de chave, token, bearer, service role, connection string ou payload sensivel;
- prometer acao automatica que nao foi executada e registrada.

## Fronteira Zeus

Zeus controla:

- classificacao de risco;
- Safety Gate e boundary check;
- manifestos de recorte;
- diario canonico;
- incidentes, Data, Infra e SupportOps;
- nomes de env sem valores;
- autorizacao operacional antes de qualquer chamada ou mudanca sensivel;
- handoff para Hefesto quando houver release.

Zeus nao deve virar dono silencioso de feature de Hades, Iris, Hermes, Chronos, Atlas, Apolo, Ares ou Panteon Core.

## OpenAI e envs

Env names reconhecidos, sem valores:

- `OPENAI_API_KEY`
- `HUB_AI_MODEL`
- `HUB_CHRONOS_MINUTES_MODEL`
- `HUB_CHRONOS_TRANSCRIPTION_MODEL`
- `HUB_IT_TICKET_TRANSCRIPTION_MODEL`

Regras:

- `OPENAI_API_KEY` e critica e server-only.
- Nenhum agente registra valor, prefixo, sufixo, print ou payload que permita reuso.
- Falta de key deve degradar o fluxo com erro operacional seguro, sem quebrar a operacao principal.
- Qualquer criacao, alteracao, remocao, rotacao ou exposicao de env/chave comeca `BLOQUEADO` ate autorizacao explicita do Lucas.
- Este recorte nao valida presenca de env e nao executa chamadas OpenAI.

## Contratos por modulo

| Contrato | Owner produto | Athena atua em | Zeus controla | Status |
| --- | --- | --- | --- | --- |
| Zeus PO AI | Zeus | leitura operacional, prompts para agentes, resumo de riscos e proximos passos | endpoint, diario, monitoramento, logs sem segredo | `VALIDADO_LOCAL` |
| Iris Caca/Athena | Iris Core | atendimento assistido, leitura de contexto e handoff humano | fronteira Iris, Meta/OpenAI bloqueadas sem autorizacao | `PENDENTE` |
| Hades copilot | Hades Core | apoio a cobranca/atendimento financeiro e explicacao operacional | Asaas, D4Sign, dados financeiros e C2X protegidos | `PENDENTE` |
| Chronos atas/agente | Chronos Core | transcricao, resumo e rascunho de ata revisavel | Google Agenda, Drive, OpenAI e Storage protegidos | `PENDENTE` |
| Hermes comunicacao | Hermes Core | resumo, apoio de resposta e contexto de chamadas/mensagens | realtime, midia e payload de comunicacao minimizados | `PENDENTE` |
| HelpDesk/evidencias | Zeus | leitura tecnica de prints, audio, video e anexos | PII minimizada, tickets TI e logs sanitizados | `VALIDADO_LOCAL` |

## Padrão minimo de contrato por IA

Todo contrato Athena por modulo deve declarar:

- modulo dono;
- agente owner;
- rota, componente ou bloco de IA;
- fonte de contexto;
- dados permitidos;
- dados proibidos;
- env names envolvidos, sem valores;
- fallback sem IA;
- logs permitidos;
- logs proibidos;
- validacoes locais;
- responsavel por homologacao;
- rollback.

## Dados e logs

Permitido registrar:

- status operacional;
- modulo;
- protocolo;
- rota sem token;
- nome de env;
- se IA esta configurada ou indisponivel;
- erro sanitizado;
- contagens agregadas;
- resultado operacional resumido.

Proibido registrar:

- segredo, token, bearer, service role ou connection string;
- prompt bruto com PII desnecessaria;
- payload completo de cliente;
- telefone completo quando nao for necessario;
- conteudo financeiro sensivel;
- anexo bruto ou transcricao sensivel em log tecnico;
- stack contendo chave ou Authorization.

## Fallback obrigatorio

Quando Athena nao puder chamar IA:

- manter o fluxo principal disponivel;
- informar indisponibilidade com linguagem operacional;
- orientar proxima acao humana;
- nao inventar dados;
- nao travar ticket, atendimento, ata ou registro;
- registrar apenas erro sanitizado.

## Gates para proximo contrato

Antes de executar `AT-20260530-002-ATHENA-IRIS-CACA`, Zeus deve exigir:

- owner Iris declarado;
- arquivos de IA e produto separados;
- env names OpenAI/Meta apenas por nome;
- fallback sem IA preservado;
- logs sanitizados;
- manifesto com `allowedLayers: ["athena"]`;
- boundary check com modulo Iris e camada Athena;
- diario atualizado.

## Fora do escopo deste recorte

- Nenhum codigo de produto.
- Nenhuma chamada OpenAI.
- Nenhum teste de key.
- Nenhuma leitura de valor de env.
- Nenhum deploy.
- Nenhum Supabase, banco, migration, Vercel, alias, dominio ou producao.

## Conclusao

- Athena passa a ter contrato operacional explicito com Zeus.
- O impacto pratico e separar IA transversal de ownership de produto, reduzindo risco de agente alterar modulo errado ou expor dado sensivel.
- Nao precisa acao do usuario final agora.
- O proximo passo tecnico e `AT-20260530-002-ATHENA-IRIS-CACA`.
