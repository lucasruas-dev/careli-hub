# Panteon - orientacao para agentes futuros de modularizacao

Assunto: [Panteon] orientacao para agentes futuros

Status: ORIENTACAO OFICIAL / SEM DEPLOY DIRETO / PRODUCAO SOMENTE POR HEFESTO

Data: 2026-06-01

Responsavel: Zeus/Hefesto, sob aprovacao operacional do Lucas.

## Objetivo

Registrar a orientacao para agentes que assumirem modulos ainda em rascunho ou
fora do pacote de engenharia concluido. O release atual deve preservar somente
os modulos ja fechados e validados; os demais modulos devem seguir o mesmo
padrao quando Lucas autorizar trabalho real neles.

## Modulos com engenharia local fechada neste ciclo

- Iris: decomposicao de tela, blocos funcionais, tipos e Setup.
- Hades: decomposicao operacional de atendimento/cobranca, fila, WhatsApp,
  cliente, risco, compromissos, acordos e superficies tipadas.
- Hermes: contratos de rota/API, helpers de mensagens, realtime, notificacoes e
  client de dados.
- Chronos: componentes de agenda, salas, Drive, popups, atas, gravacoes,
  helpers de dominio e `ChronosPage.tsx` como orquestrador enxuto.
- Zeus/governanca: manifests, boundary check, arvore de execucao, protocolos e
  guardrails para agentes.

## Modulos em rascunho

Modulos ainda nao trabalhados neste mesmo padrao, ou que possuem arquivos
locais nao consolidados, nao devem ser publicados por arrasto. Em especial:

- Apolo;
- Ares;
- Atlas;
- Panteon/Home;
- Setup;
- qualquer camada Athena/Hefesto que ainda esteja apenas como contrato ou
  documento de orientacao.

Se algum desses modulos precisar virar entrega real, o agente deve abrir um
novo recorte proprio e nao reutilizar o pacote de producao deste ciclo.

## Regra de execucao para novos agentes

1. Ler obrigatoriamente `AGENTS.md`, `docs/operations/README.md`,
   `docs/operations/engineering-operations.md` e, para frontend,
   `docs/architecture/design-guidelines.md`.
2. Confirmar o modulo dono e rodar o boundary check antes de misturar arquivos.
3. Criar ou atualizar um manifesto `panteon-recorte-manifest-*.json` com
   `protocolId`, `module`, `includedFiles`, `excludedPaths`, validacoes,
   rollback, riscos e status.
4. Trabalhar em recorte limpo, preferencialmente worktree/pacote proprio.
5. Nao publicar a partir do root misto.
6. Nao incluir migrations, envs, secrets, aliases, dominios, service role,
   Supabase mutavel, Vercel ou producao sem autorizacao explicita do Lucas.
7. Validar com lint escopado, `check-types:hub`, `lint:hub`, build e smoke
   local das rotas relevantes.
8. Atualizar o diario canonico
   `docs/operations/engineering-operations.md` no mesmo pacote.
9. Para Preview/Homologacao, entregar recorte limpo para Zeus.
10. Para Producao, entregar recorte homologado/validado para Hefesto, com
    rollback e healthchecks definidos.

## Padrao tecnico esperado

- Paginas principais devem virar orquestradores curtos.
- Componentes grandes devem ir para `components/` ou `blocks/`.
- Regras de dominio devem ir para `lib/<modulo>/`.
- Tipos compartilhados devem ir para `types.ts` ou pasta `types/`.
- Rotas API devem ficar finas, chamando dominio/server helpers.
- Sidebars, topbar, surfaces, modais e botoes devem seguir o contrato visual do
  Panteon.
- Nao criar mocks quando houver fonte real disponivel.
- Nao usar `@ts-nocheck` ou `eslint-disable` como estrategia de entrega.

## Criterio de pronto

Um modulo so pode ser considerado pronto quando:

- o arquivo principal deixou de concentrar UI, estado, efeitos e dominio;
- o manifesto do recorte passa;
- o boundary check passa;
- lint, tipos, build e smoke passam;
- o diario canonico esta atualizado;
- riscos e rollback estao registrados;
- Lucas consegue validar funcionalmente sem depender do chat antigo.

## Conclusao

Os modulos rascunho ficam preservados fora do release atual. Quando forem
priorizados, os agentes devem repetir o mesmo modelo aplicado em Iris, Hades,
Hermes e Chronos: recorte pequeno, fronteira clara, validacao objetiva,
registro operacional e publicacao somente por pacote limpo.
