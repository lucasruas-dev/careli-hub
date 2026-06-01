# Panteon - contrato Athena e Chronos Minutes

Assunto: [Athena] contrato Chronos Minutes

Status: `VALIDADO_LOCAL / DOCUMENTAL / SEM OPERACAO SENSIVEL`

Protocolo: `AT-20260530-004-ATHENA-CHRONOS-MINUTES`

Base:

- `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`
- `docs/operations/chronos-homologation-handoff-2026-05-28.md`
- `docs/architecture/api-connection-governance.md`
- `docs/architecture/environment-governance.md`
- `apps/hub/app/api/chronos/meetings/agent/route.ts`
- `apps/hub/lib/chronos/minutes.ts`
- `apps/hub/lib/chronos/client.ts`
- `apps/hub/lib/chronos/server.ts`

## Objetivo

Declarar a fronteira entre Athena e Chronos para transcricao, rascunho de ata e agentes de reuniao.

Este recorte nao altera codigo, prompt runtime, OpenAI, Google Agenda, Drive, Storage, banco, env, Supabase, Vercel, alias, dominio, homologacao ou producao.

## Superficie atual reconhecida

O Chronos ja possui uma rota de agente em `apps/hub/app/api/chronos/meetings/agent/route.ts`.

Acoes reconhecidas:

- `transcribe_recording`: recebe arquivo de audio/video, transcreve via OpenAI e salva transcricao;
- `transcribe_existing_recording`: busca gravacao disponivel, transcreve e salva transcricao;
- `draft_minutes`: gera rascunho de ata com base em reuniao, transcricao, chat, timeline, follow-ups e evidencias.

Modelos reconhecidos:

- transcricao: `HUB_CHRONOS_TRANSCRIPTION_MODEL`, com fallback para `HUB_IT_TICKET_TRANSCRIPTION_MODEL` e default runtime;
- ata: `HUB_CHRONOS_MINUTES_MODEL`, com fallback para `HUB_AI_MODEL` e default runtime.

Essa superficie deve ser tratada como agente de apoio executivo e rascunho revisavel, nunca como aprovador automatico de ata.

## Papeis

### Chronos Core

- E o owner de produto de agenda, salas, reunioes, participantes, gravacoes, transcricoes, Drive, Google Agenda e atas.
- Aprova qualquer comportamento que altere reuniao, ata, transcricao, follow-up, sala, agenda ou visibilidade.
- Decide quando um rascunho Athena pode virar ata final.

### Athena

- E a camada transversal de IA do Panteon.
- Pode transcrever, resumir e gerar rascunho de ata com base em evidencias autorizadas.
- Nao aprova ata, nao cria decisao, nao inventa participante, prazo, responsavel, fala ou follow-up.
- Deve sinalizar falta de contexto e preservar revisao humana.

### Zeus

- Controla risco, recorte, manifesto, fronteira, env names, logs e operacoes sensiveis.
- Mantem OpenAI, Google, Drive, Storage, banco, Supabase, Vercel, alias, dominio, deploy, migration e producao bloqueados sem autorizacao explicita do Lucas.
- Pode auditar nomes, impacto e status, sem expor valores sensiveis.

### Hefesto

- Atua apenas quando houver promocao de release/producao autorizada.
- Bloqueia pacote misto, worktree sujo, migration pendente, env sensivel ou mudanca de agenda/ata sem homologacao.

## Contrato de autoridade

| Decisao | Dono |
| --- | --- |
| Reunioes, agenda, salas, Drive, gravacoes e atas | Chronos Core |
| Prompt, rascunho, transcricao e fallback de IA | Athena com Chronos Core |
| Env names, logs, fronteira, manifesto e operacoes sensiveis | Zeus |
| Publicacao Preview/Homo autorizada | Zeus pelo protocolo |
| Producao autorizada | Hefesto/Zeus com aprovacao do Lucas |

## Env names reconhecidos

Os nomes abaixo podem ser citados para governanca, nunca com valores:

- `OPENAI_API_KEY`
- `HUB_AI_MODEL`
- `HUB_CHRONOS_MINUTES_MODEL`
- `HUB_CHRONOS_TRANSCRIPTION_MODEL`
- `HUB_IT_TICKET_TRANSCRIPTION_MODEL`
- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `GOOGLE_CALENDAR_SCOPES`
- `GOOGLE_CALENDAR_PRIMARY_CALENDAR_ID`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`

Regras:

- Nenhum valor de env deve entrar em docs, logs, chat, payload de browser ou resposta da IA.
- Nenhuma env OpenAI, Google, Supabase privilegiada ou Storage deve virar `NEXT_PUBLIC_*`.
- OpenAI, Google OAuth e Supabase privilegiado sao server-only.
- Falta de env deve produzir erro operacional sanitizado ou fallback sem quebrar a tela principal.

## Dados permitidos para Athena

Permitido quando autorizado e necessario:

- titulo, protocolo, tipo, objetivo e sala da reuniao;
- inicio programado, fim real, duracao e fuso operacional;
- participantes com check-in, papel e organizacao;
- transcricao salva;
- chat da reuniao em janela limitada;
- timeline operacional;
- follow-ups existentes;
- evidencias de gravacao como metadados, sem analisar conteudo visual bruto fora de pipeline homologado.

## Dados proibidos para IA e logs

Nao enviar, registrar nem repetir:

- secrets, tokens, bearer, API keys, service role ou connection strings;
- authorization code, refresh token, access token ou payload OAuth Google;
- downloadUrl, playbackUrl, link assinado ou URL temporaria sensivel;
- arquivo bruto, audio/video completo em log ou docs;
- dados de participante sem necessidade operacional;
- conversa privada fora da reuniao;
- stack trace, erro bruto, host, usuario, database ou SQL;
- prompt bruto sensivel em log tecnico.

## Limites de resposta

Athena em Chronos pode:

- transcrever literalmente uma gravacao autorizada;
- gerar rascunho de ata para revisao humana;
- resumir decisoes e pendencias que estejam no contexto;
- montar plano de acao quando houver atividade, responsavel e prazo;
- apontar trechos inaudiveis, ausentes ou incertos;
- usar prazo padrao apenas quando o prompt operacional permitir e deixar claro que e padrao.

Athena em Chronos nao pode:

- aprovar ata automaticamente;
- inventar decisao, fala, responsavel, prazo, participante ou conclusao;
- alterar agenda, convidados, Google Calendar, Drive, Storage ou reuniao externa sem acao explicita e autorizada;
- analisar conteudo visual de video se isso nao estiver em transcricao, chat, timeline ou metadados;
- expor link assinado, download de gravacao ou token;
- transformar rascunho em documento final sem revisao humana.

## Fallback e indisponibilidade

Se OpenAI estiver indisponivel, sem key ou sem modelo configurado:

- a tela do Chronos deve continuar utilizavel;
- transcricao/ata pode retornar erro operacional seguro ou fallback de rascunho local quando existir;
- o rascunho deve deixar claro que e preliminar e sujeito a revisao humana;
- logs devem registrar causa sanitizada, sem prompt bruto sensivel.

Se Google Agenda/Drive/Storage estiver indisponivel:

- Athena nao deve simular sincronizacao, arquivo, convite ou evento;
- deve responder somente com os dados disponiveis no Chronos;
- qualquer sync real continua bloqueado por protocolo e autorizacao.

## Gates para mudanca futura

Qualquer mudanca runtime em Chronos/Athena deve declarar novo protocolo e validar, no minimo:

- `npm.cmd run check-types:hub`;
- `npm.cmd run lint:hub`;
- `npm.cmd run build --workspace @repo/hub`;
- manifesto de recorte;
- boundary check com `--module chronos --allow athena` ou protocolo Zeus equivalente;
- smoke seguro da rota/tela afetada sem expor sessao, token, arquivo, payload sensivel ou link assinado;
- diario operacional atualizado.

Mudancas envolvendo OpenAI, Google Agenda, Drive, Storage, Supabase, env, secret, alias, dominio, migration, homologacao, producao, gravacao real, transcricao real ou sync real comecam `BLOQUEADO` ate autorizacao explicita do Lucas.

## Proximo recorte

Proximo contrato recomendado: `AT-20260530-005-ATHENA-LOGS-PAYLOAD-SAFE`.

Objetivo esperado:

- consolidar regra transversal de logs sem payload sensivel;
- declarar sanitizacao minima para Athena, OpenAI, Meta, Hades, Chronos e Hermes;
- preparar gate futuro de scan seguro antes de Preview/Homo.

## Conclusao

- O contrato AT-004 formaliza Athena em Chronos como agente de transcricao e rascunho revisavel, nao aprovador automatico.
- O impacto pratico e proteger decisoes executivas, participantes, gravacoes, links e integrações contra exposicao ou automacao indevida.
- Nao ha acao do usuario final agora; a proxima acao tecnica e fechar a regra transversal de logs sem payload sensivel.
