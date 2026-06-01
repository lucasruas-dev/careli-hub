# Panteon - mapa modulo-agente

Assunto: [Zeus] mapa oficial de modulos, agentes e camadas operacionais

Status: `ATIVO COMO BASE DOCUMENTAL / AGUARDANDO AUTOMACAO`

Base:

- `docs/operations/panteon-production-snapshot-2026-05-30.md`
- `docs/operations/panteon-agent-governance-v2.md`
- diagnostico legado do Zeus consolidado em 2026-05-30

## Regra central

Cada modulo do Hub tem um agente construtor dono do recorte. Zeus e o modulo/agente master que controla a engenharia, Data, Infra, homologacao, producao, riscos, recortes, worktrees, Safety Gate e handoff. Hefesto auxilia Zeus em release/producao. Athena e a central dos agentes de IA conectados a OpenAI e atua dentro dos modulos por contrato.

Contrato inicial Athena/Zeus: `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`.
Contrato Athena/Iris Caca: `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`.
Contrato Athena/Hades Copilot: `docs/operations/panteon-athena-hades-copilot-contract-2026-05-30.md`.
Contrato Athena/Chronos Minutes: `docs/operations/panteon-athena-chronos-minutes-contract-2026-05-30.md`.
Contrato Athena/logs seguros: `docs/operations/panteon-athena-logs-payload-safe-contract-2026-05-30.md`.
Mapa de decomposicao Iris: `docs/operations/panteon-iris-decomposition-map-2026-05-30.md`.

## Modulos oficiais do Hub

| Modulo do Hub | Agente dono         | Tipo                   | Dominio principal                                                             | Regra                                                                    |
| ------------- | ------------------- | ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Panteon       | Panteon Core / Zeus | Modulo                 | Home, shell, launcher, cockpit principal                                      | Mudancas de shell/topbar/sidebar passam por Zeus e design guidelines.    |
| Zeus          | Zeus                | Modulo + agente master | `ops.c2x.app.br/zeus`, Operations Center, Data, Infra, SupportOps, governanca | Controla tudo, mas nao implementa produto de outro modulo sem protocolo. |
| Apolo         | Apolo Core          | Modulo construtor      | Cadastro mestre, CRM, relacoes C2X                                            | Construtor do cadastro central e fonte de identidade operacional.        |
| Ares          | Ares Core           | Modulo construtor      | Pessoas, dimensoes, bases financeiras e estrutura                             | Construtor de estrutura operacional e bases.                             |
| Atlas         | Atlas Core          | Modulo construtor      | Indicadores, FPE, desempenho, ocorrencias                                     | Construtor de indicadores e gestao.                                      |
| Chronos       | Chronos Core        | Modulo construtor      | Agenda, salas, Drive, Google Agenda, gravacoes, atas                          | Construtor de tempo, agenda e reunioes.                                  |
| Hades         | Hades Core          | Modulo construtor      | Cobranca, atendimento financeiro, acordos, Asaas, D4Sign, legado Guardian     | Construtor financeiro operacional.                                       |
| Hermes        | Hermes Core         | Modulo construtor      | Comunicacao, mensagens, threads, realtime, chamadas                           | Construtor de comunicacao interna.                                       |
| Iris          | Iris Core           | Modulo construtor      | Atendimento, tickets, WhatsApp/Meta, Caca/Athena no atendimento               | Construtor de atendimento externo.                                       |

## Camadas e agentes que nao substituem modulo

| Camada/agente | Papel                                                                                                      | Regra                                                                                                                      |
| ------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Zeus          | Braco direito do Lucas, Data, Infra, SupportOps, Safety Gate, incidentes, homologacao/producao controladas | Pode bloquear, auditar, coordenar e publicar quando autorizado; nao deve virar dono silencioso de feature de outro modulo. |
| Hefesto       | Auxiliar de Zeus para producao, release, healthchecks finais e rollback                                    | Promove somente protocolo homologado/validado/autorizado; bloqueia pacote misto.                                           |
| Athena        | Central dos agentes de IA conectados a OpenAI                                                              | Atua em prompts, copilots, transcricao, analise, agentes e evidencia; quando tocar produto, segue o owner do modulo.       |
| Setup         | Area operacional de configuracao                                                                           | Governada por Zeus, mas tratada como configuracao/permissao, nao como modulo de produto do sidebar principal.              |

## Contrato Athena/Zeus

Protocolo: `AT-20260530-001-ATHENA-ZEUS-CONTRACT`

Fonte: `docs/operations/panteon-athena-zeus-contract-2026-05-30.md`

Regras resumidas:

- Athena e camada transversal de IA, nao owner de produto.
- Zeus governa risco, env names, logs, recortes e operacoes sensiveis.
- Cada modulo consumidor deve declarar contrato Athena proprio antes de mexer em IA.
- OpenAI, envs, chaves, payloads sensiveis, banco, Supabase, Vercel, alias e producao continuam bloqueados sem autorizacao explicita do Lucas.

## Contrato Athena/Iris Caca

Protocolo: `AT-20260530-002-ATHENA-IRIS-CACA`

Fonte: `docs/operations/panteon-athena-iris-caca-contract-2026-05-30.md`

Regras resumidas:

- Caca e agente customer-facing da Iris, nao Athena e nao suporte interno.
- Athena governa IA, prompt, sanitizacao e fallback sem assumir o atendimento externo.
- Iris Core continua owner de tickets, conversa, Meta/WhatsApp, handoff humano e experiencia do cliente.
- OpenAI, Meta, envs, payloads sensiveis, banco, Supabase, Vercel, alias e producao continuam bloqueados sem autorizacao explicita do Lucas.

## Mapa de decomposicao Iris

Protocolo: `MD-20260530-001-IRIS-DECOMPOSITION-MAP`

Fonte: `docs/operations/panteon-iris-decomposition-map-2026-05-30.md`

Regras resumidas:

- Iris entra na nova engenharia por decomposicao incremental, nao por reescrita.
- Primeiro recorte tecnico executado: `MD-20260530-002-IRIS-SHARED-UI`.
- Segundo recorte tecnico executado: `MD-20260530-003-IRIS-SHELL`.
- Terceiro recorte tecnico executado: `MD-20260530-004-IRIS-BOARD`.
- Quarto recorte tecnico executado: `MD-20260530-005-IRIS-BOARD-QUEUE`.
- Quinto recorte tecnico executado: `MD-20260530-006-IRIS-HISTORY`.
- Sexto recorte tecnico executado: `MD-20260530-007-IRIS-START-ATTENDANCE`.
- Setimo recorte tecnico executado: `MD-20260530-008-IRIS-CONVERSATION-READONLY`.
- Oitavo recorte tecnico executado: `MD-20260530-009-IRIS-COMPOSER-ACTIONS`.
- Nono recorte tecnico executado: `MD-20260530-010-IRIS-CACA-PANEL`.
- Decimo recorte tecnico executado: `MD-20260530-011-IRIS-META-BROADCASTS`.
- Decimo primeiro recorte tecnico executado: `MD-20260530-012-IRIS-SETUP-TEMPLATES`.
- Decimo segundo recorte tecnico executado: `MD-20260530-013-IRIS-REPORTS`.
- Decimo terceiro recorte tecnico executado: `MD-20260530-014-IRIS-DATA-CLIENT`.
- A fila tecnica Iris mapeada esta fechada localmente; novos movimentos devem abrir novo protocolo especifico.
- Realtime, Meta real, Caca runtime novo, OpenAI, env, banco, Supabase admin, Vercel e producao ficam fora sem autorizacao expressa.
- `IrisPage.tsx` continua como composicao raiz validada localmente, com `6.667` linhas aferidas neste checkout.

## Contrato Athena/Hades Copilot

Protocolo: `AT-20260530-003-ATHENA-HADES-COPILOT`

Fonte: `docs/operations/panteon-athena-hades-copilot-contract-2026-05-30.md`

Regras resumidas:

- Athena em Hades e copilot interno de operador, nao executor financeiro.
- Hades Core continua owner de cobranca, carteira, acordos, boletos, Asaas, D4Sign e legado Guardian.
- IA pode resumir, explicar risco e sugerir acao para validacao humana, mas nao promete desconto, acordo, boleto ou envio.
- OpenAI, Asaas, D4Sign, Guardian DB, envs, payloads sensiveis, Supabase, Vercel, alias e producao continuam bloqueados sem autorizacao explicita do Lucas.

## Contrato Athena/Chronos Minutes

Protocolo: `AT-20260530-004-ATHENA-CHRONOS-MINUTES`

Fonte: `docs/operations/panteon-athena-chronos-minutes-contract-2026-05-30.md`

Regras resumidas:

- Athena em Chronos e agente de transcricao e rascunho revisavel, nao aprovador automatico de ata.
- Chronos Core continua owner de agenda, salas, reunioes, participantes, gravacoes, Drive, Google Agenda e atas.
- IA pode transcrever, resumir e preparar rascunho com evidencias autorizadas, mas nao inventa decisao, participante, fala, prazo ou follow-up.
- OpenAI, Google, Drive, Storage, Supabase, envs, payloads sensiveis, Vercel, alias e producao continuam bloqueados sem autorizacao explicita do Lucas.

## Contrato Athena/logs seguros

Protocolo: `AT-20260530-005-ATHENA-LOGS-PAYLOAD-SAFE`

Fonte: `docs/operations/panteon-athena-logs-payload-safe-contract-2026-05-30.md`

Regras resumidas:

- Logs registram causa, status, impacto e proxima acao, nunca payload sensivel.
- Prompt bruto, resposta bruta, webhook bruto, token, secret, bearer, connection string e link assinado sao proibidos em logs/docs/chat.
- Qualquer exposicao de dado sensivel vira incidente `BLOQUEADO` para Zeus/Security.
- Futuras mudancas de IA devem incluir busca segura no diff antes de Preview/Homo.

## Modelo operacional por agente

1. Lucas define demanda, prioridade e autorizacoes sensiveis.
2. Zeus classifica ambiente, modulo, risco, fronteira e protocolo.
3. Agente construtor implementa apenas o modulo/bloco autorizado.
4. Athena pode apoiar IA somente dentro da fronteira declarada.
5. Agente construtor valida localmente e registra diario/protocolo.
6. Zeus revisa fronteira, diff, Safety Gate, Preview/Homo quando autorizado.
7. Hefesto auxilia/promove producao quando o protocolo estiver homologado e Lucas autorizar.
8. Zeus monitora producao, logs, rollback e status no modulo Zeus/OPS.

## Zeus como cockpit vivo

O modulo Zeus deve evoluir para mostrar, sem expor segredos:

- producao atual: commit, deployment, aliases, rollback e healthchecks;
- homologacao: commit, deployment, protocolos em teste e riscos;
- worktrees abertas: agente, branch, arquivos tocados, status e conflito;
- recortes: protocolo, modulo, blocos, validacoes, aprovacao do Lucas e status;
- banco/migrations: nomes e status, nunca connection strings ou valores sensiveis;
- envs esperadas: nomes e presenca/ausencia, nunca valores;
- incidentes: sintoma, impacto, causa confirmada, proxima acao e dono.

## Arquitetura reconhecida

O Panteon e um monorepo com monolito modular em Next.js:

```text
careli-hub/
  apps/hub/
    app/
    modules/
    lib/
    providers/
    layouts/
  packages/
  docs/
  scripts/
```

Nao e microservicos neste momento. A direcao correta e transformar o monolito modular em um monolito modular de verdade, com blocos internos claros, fronteiras declaradas e deploy sempre partindo da fotografia atual de producao.

## Estrutura alvo por modulo

```text
apps/hub/modules/<modulo>/
  <ModuloPage>.tsx
  blocks/
    <tela-ou-capacidade>/
      components/
      hooks/
      state/
      view.tsx
  shared/
    components/
    formatters/
    constants/

apps/hub/lib/<modulo>/
  domain/
  application/
  repositories/
  integrations/
  contracts/
```

## Regras de execucao

- Cada recorte declara modulo e blocos antes de editar.
- Nenhum agente publica de root misto.
- Nenhum deploy sai de worktree antiga sem compare contra producao atual.
- Zeus valida fronteira, diff, pacote e deploy.
- Hefesto fica como auxiliar/reserva de producao.
- Athena mexe em IA com fronteira explicita, por exemplo `lib/chronos/minutes` ou `app/api/chronos/meetings/agent`, nunca a tela inteira sem coordenacao.
- Operacao sensivel continua `BLOQUEADO` ate autorizacao expressa do Lucas.

Conclusao:

- Este mapa define quem constroi, quem controla, quem auxilia release e quem centraliza IA.
- O impacto pratico e transformar o diagnostico Zeus em regra de trabalho multiagente.
- A proxima acao e usar `docs/operations/panteon-module-boundary-manifest-v1.json` como base para o primeiro check automatico de fronteira.
