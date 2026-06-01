# Panteon - contrato Athena logs sem payload sensivel

Assunto: [Athena] logs sem payload sensivel

Status: `VALIDADO_LOCAL / DOCUMENTAL / SEM OPERACAO SENSIVEL`

Protocolo: `AT-20260530-005-ATHENA-LOGS-PAYLOAD-SAFE`

Base:

- `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`
- `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`
- `docs/operations/panteon-athena-hades-copilot-contract-2026-05-30.md`
- `docs/operations/panteon-athena-chronos-minutes-contract-2026-05-30.md`
- `docs/architecture/security-governance.md`
- `docs/architecture/secret-management-policy.md`
- `docs/architecture/api-connection-governance.md`

## Objetivo

Consolidar a regra transversal de logs seguros para Athena, OpenAI, agentes de modulo e integracoes sensiveis.

Este recorte nao altera codigo, logging runtime, OpenAI, Meta, Asaas, D4Sign, Google, banco, env, Supabase, Vercel, alias, dominio, homologacao ou producao.

## Regra central

Logs, traces, timelines, registros operacionais, docs e mensagens de erro devem registrar causa, impacto, status e proxima acao, nunca payload sensivel.

Qualquer log que precise de dado sensivel para diagnostico deve virar protocolo bloqueado para Zeus, com aprovacao explicita do Lucas antes de coletar, exportar, compartilhar ou publicar evidencia.

## Aplicacao

Este contrato vale para:

- Athena transversal;
- Zeus PO AI;
- Iris Caca e Meta/WhatsApp;
- Hades Copilot, Asaas, D4Sign e Guardian DB;
- Chronos Minutes, transcricao, Google Agenda, Drive e Storage;
- Hermes/PulseX, chamadas, realtime, TURN e mensagens;
- futuros agentes OpenAI, copilots, transcritores, summarizers e analisadores de evidencia.

## Pode registrar

Permitido em log/diario quando necessario:

- protocolo;
- modulo e owner;
- status operacional;
- ambiente;
- nome da rota ou integracao;
- nome da env, sem valor;
- presenca/ausencia de configuracao;
- codigo HTTP;
- contagem agregada;
- erro sanitizado;
- source tecnico sem token;
- id interno quando nao for secret nem dado pessoal sensivel;
- decisao, risco, validacao e proxima acao.

## Nunca registrar

Proibido em log/diario/chat/print/screenshot:

- valor de env, secret, token, bearer, API key, service role, connection string ou senha;
- prefixo/sufixo suficiente para reuso de credencial;
- `POSTGRES_URL`, URL com senha ou DSN;
- payload bruto de webhook Meta, Google, Asaas, D4Sign, Supabase, Vercel ou OpenAI;
- prompt bruto com PII, financeiro, contrato, boleto, ata sigilosa ou mensagem privada;
- resposta bruta de modelo quando contiver dado sensivel;
- CPF/CNPJ/documento completo;
- telefone completo quando nao for indispensavel;
- link assinado, downloadUrl, playbackUrl, boletoUrl, faturaUrl ou URL temporaria sensivel;
- arquivo bruto, audio, video, anexo ou binario;
- stack trace com header, Authorization, cookie, token, host, usuario, database, SQL ou payload.

## Mascaramento minimo

Quando o dado for permitido, mas ainda exigir cuidado:

- email: mascarar parte local quando nao for necessario identificar a pessoa;
- telefone: manter apenas final quando houver necessidade operacional;
- documento: preferir hash, ultimos digitos ou marcador `documento_validado`;
- link: registrar tipo e fonte, nunca URL sensivel;
- arquivo: registrar nome generico, tipo, tamanho aproximado e status, nunca conteudo;
- erro externo: registrar provider, codigo e mensagem sanitizada;
- prompt: registrar template id, feature, modelo e status, nunca o prompt completo sensivel;
- payload: registrar schema/contagem/campos permitidos, nunca JSON bruto.

## Modelo de log seguro

Formato recomendado:

```text
module=<modulo>
feature=<capacidade>
protocolId=<protocolo>
status=<ok|erro|bloqueado|fallback>
source=<provider|runtime|route>
reason=<mensagem-sanitizada>
impact=<baixo|medio|alto|critico>
nextAction=<acao-operacional>
```

Campos proibidos nesse formato:

- `authorization`;
- `cookie`;
- `apiKey`;
- `token`;
- `secret`;
- `password`;
- `connectionString`;
- `rawPayload`;
- `rawPrompt`;
- `rawResponse`;
- `fileContent`;
- `signedUrl`.

## Contrato por modulo

| Modulo/camada | Regra de log |
| --- | --- |
| Zeus | Logs operacionais podem mostrar protocolo, status, rota e risco; nunca env value, bearer, service role ou payload bruto. |
| Iris/Caca | Timeline pode mostrar resumo sanitizado; nunca payload Meta bruto, token, telefone completo, documento completo ou prompt bruto. |
| Hades | Logs podem mostrar erro sanitizado e agregados; nunca SQL, Guardian DB config, boleto/link, CPF/CNPJ completo, Asaas/D4Sign payload ou dado financeiro bruto. |
| Chronos | Logs podem mostrar status de transcricao/ata; nunca gravação bruta, link assinado, OAuth token, prompt completo, ata sigilosa bruta ou participantes fora do necessario. |
| Hermes | Logs podem mostrar canal/estado agregado; nunca TURN secret, payload realtime sensivel, conteudo privado desnecessario ou token. |
| Athena | Logs podem mostrar modelo escolhido por nome, feature, fallback e status; nunca prompt bruto sensivel, resposta bruta sensivel ou chave OpenAI. |

## Fallback e incidente

Se um log ou registro expuser dado sensivel:

- parar a operacao;
- marcar incidente como `BLOQUEADO`;
- avisar Lucas;
- acionar Zeus/Security;
- remover exposicao futura sem apagar evidencia critica de auditoria sem orientacao;
- rotacionar secret apenas com autorizacao explicita;
- registrar causa e mitigacao sem repetir o dado exposto.

## Gates para mudanca futura

Qualquer mudanca runtime que adicione logs/traces/timelines de IA deve declarar novo protocolo e validar:

- manifesto de recorte;
- boundary check do modulo com `--allow athena` quando aplicavel;
- busca por `console.`, `logger`, `Authorization`, `Bearer`, `rawPayload`, `rawPrompt`, `payload`, `token`, `secret` no diff;
- `git diff --check`;
- `npm.cmd run check-types:hub`, `npm.cmd run lint:hub` e `npm.cmd run build --workspace @repo/hub` quando houver codigo;
- diario operacional atualizado.

Operacoes envolvendo exportacao de logs, leitura de logs de producao, incidentes, envs, secrets, tokens, banco, Supabase, Vercel, alias, dominio, OpenAI, Meta, Asaas, D4Sign, Google ou Storage comecam `BLOQUEADO` ate autorizacao explicita do Lucas.

## Proximo recorte

Proximo recorte recomendado: `MD-20260530-001-IRIS-DECOMPOSITION-MAP`.

Objetivo esperado:

- iniciar a decomposicao segura da Iris por mapa/fronteira antes de mover codigo;
- separar fila, conversa, tickets, Meta/WhatsApp, templates e Caca;
- preservar o contrato Athena/Iris e as regras de logs seguros.

## Conclusao

- O contrato AT-005 fecha a trilha Athena Contracts com uma regra transversal de logs sem payload sensivel.
- O impacto pratico e criar uma trava operacional antes de ampliar agentes IA, evidencias, transcricoes, tickets, cobranca e comunicacao.
- Nao ha acao do usuario final agora; a proxima acao tecnica e iniciar o mapa de decomposicao da Iris.
