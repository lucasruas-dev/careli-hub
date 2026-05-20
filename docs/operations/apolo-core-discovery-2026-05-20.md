# Apolo Core - descoberta inicial do CRM central

- Assunto: `[Apolo] Descoberta inicial do CRM central`.
- Nome da squad/agente: `Apolo Core`.
- Data e hora local: 2026-05-20 13:44:56 -03:00.
- Status operacional: `DESCOBERTA DOCUMENTADA`.
- Escopo tecnico: descoberta, modelo operacional e proposta de UX sem migration, sem escrita no legado, sem env, sem deploy e sem integracao externa ativa.
- Bloqueios: banco real, Supabase, Vercel, envs, secrets, tokens, MOSTQI, storage externo, webhook, migration, escrita no C2X e deploy seguem `BLOQUEADO` ate autorizacao expressa do Lucas.

## Fontes consultadas

- Governanca operacional: `AGENTS.md`, `docs/operations/README.md`, `docs/operations/engineering-operations.md`, `docs/operations/releases-homologation.md`, `docs/operations/releases-production.md`.
- Governanca de arquitetura e seguranca: `docs/architecture/agent-operating-model.md`, `docs/architecture/security-governance.md`, `docs/architecture/environment-governance.md`, `docs/architecture/release-and-rollback-policy.md`, `docs/architecture/production-safety-policy.md`, `docs/architecture/secret-management-policy.md`, `docs/architecture/incident-response-policy.md`, `docs/architecture/database-schema.md`, `docs/architecture/design-guidelines.md`.
- C2X/Hades: `packages/database/migrations/0010_c2x_guardian_read_model.sql`, `apps/hub/lib/guardian/read-model.ts`, `apps/hub/lib/guardian/read-model-sync.ts`, `apps/hub/lib/guardian/overview.ts`, `apps/hub/lib/guardian/attendance.ts`, rotas de `apps/hub/app/api/guardian/attendance`.
- Iris/CareDesk: `packages/database/migrations/0011_caredesk_core.sql`, `packages/database/migrations/0024_caredesk_meta_whatsapp_integration.sql`, `packages/database/migrations/0025_iris_inbound_ticket_protocols.sql`, `apps/hub/modules/caredesk/IrisPage.tsx`, `apps/hub/app/api/iris/meta/*`, `apps/hub/app/api/hub/it-tickets/*`.
- Chronos: `packages/database/migrations/0019_chronos_core.sql`, `apps/hub/app/api/chronos/meetings/route.ts`, `apps/hub/lib/chronos/server.ts`.
- Registro de modulos/permissoes: `packages/shared/src/modules/registry.ts`, `packages/shared/src/permissions/types.ts`, `packages/shared/src/permissions/matrix.ts`.
- MOSTQI: documentacao oficial de Enrichment, Authentication, Sync e Async Status.

## C2X conhecido

### Cadastros e pessoas

- O C2X legado ainda e a origem principal para clientes, usuarios, imobiliarias, corretores, colaboradores e demais cadastros.
- A tabela legada `users` concentra mais do que usuarios internos. Ela tambem aparece como base para clientes, imobiliarias, corretores, vinculos comerciais e participantes de contratos.
- Campos ja vistos no diario e em queries Hades/Iris: nome, nome fantasia, razao/social name, CPF, CNPJ, e-mail, telefone, celular, WhatsApp, tipo de pessoa, sexo, data de nascimento, idade, estado civil, regime de bens, profissao, renda/faixa salarial, escolaridade, nacionalidade, naturalidade, nome da mae, endereco completo, cidade, estado, conjuge e dados completos de conjuge.
- Vinculos comerciais aparecem por `vinculed_by_id`, `corretor_id` e participantes de `acquisition_requests`. O Apolo deve modelar esses vinculos sem reduzir tudo a um unico "cliente principal".
- Pessoa juridica deve respeitar razao social, nome fantasia, CNPJ, inscricoes e representantes quando existirem no legado. Pessoa fisica deve respeitar CPF, documentos, contatos, endereco, dados pessoais e requisitos contratuais existentes.

### Empreendimentos e unidades

- Empreendimentos usam codigos/siglas de tres letras ou equivalentes de negocio, com regras de exibicao registradas no diario para nomes agregados, excecoes e ambientes de teste.
- Unidades/lotes usam `unities`/`enterprise_unities`; a exibicao operacional combina empreendimento, quadra/bloco/lote e nome/codigo da unidade.
- O Apolo deve tratar unidades e empreendimentos como vinculos comerciais/operacionais consultaveis por pessoa ou empresa, sem assumir que a pessoa sempre e compradora unica.

### Reserva, venda, proposta e contrato

- O fluxo legado passa por reserva, proposta, contrato, assinatura, faturamento e possiveis cancelamentos/rescisoes.
- `acquisition_requests` concentra o ciclo de venda/proposta/contrato. O diario ja validou `acquisition_requests.acquisition_request_stage_id = 4` como `Faturado` em exportacao C2X de Lagoa Bonita.
- O mapeamento Apolo deve incluir os participantes `client_id`, `client_2_id`, `client_3_id`, `client_4_id` e `client_5_id` quando existirem, alem de corretor, imobiliaria e demais papeis comerciais.
- Assinaturas D4Sign ja existem no ecossistema Hades/Guardian como consulta server-side. O Apolo pode referenciar documentos/assinaturas, mas nao deve persistir links expiraveis nem duplicar provider externo sem desenho proprio.

### Financeiro e cobranca

- Hades/Guardian consome `payments`, `payment_statuses`, `parcel_types`, `acquisition_requests`, unidades e clientes para carteira, inadimplencia, parcelas, recuperacao, contratos criticos e comportamento de pagamento.
- O read model `c2x_*` acelera consultas Hades, mas nao e cadastro mestre completo. Ele deve ser uma fonte de consulta e reconciliacao para o Apolo, nao o schema definitivo do CRM.
- O Apolo deve expor no 360 financeiro: parcelas, status, vencimentos, pagamento, saldo, atraso, acordos/promessas quando existirem, comportamento historico e indicadores usados por Hades.
- Cobranca deve permanecer dominio Hades. O Apolo deve consultar e consolidar historico, sem virar modulo de cobranca.

### Atendimento e comunicacao

- Iris/CareDesk guarda contatos, tickets, protocolos, participantes, mensagens, anexos, eventos e referencias externas de atendimento.
- `caredesk_contacts` ja possui ponte com `c2x_user_id`, documentos, pessoa fisica/juridica, e-mail, telefone, WhatsApp, cidade/estado e payload C2X.
- `caredesk_contact_entities` permite vincular contato a entidades de origem, como unidade, contrato, parcela ou outro objeto externo.
- O Apolo deve consumir Iris como historico de atendimento e contato operacional, mantendo Iris como modulo de atendimento e comunicacao.

### Reunioes e rastreabilidade

- Chronos e o modulo de reunioes formais, atas, participantes, follow-ups, transcricoes e timeline executiva.
- O Apolo deve consultar participacoes e registros Chronos por pessoa/empresa, mas nao deve prometer timeline de reunioes sem mapear participantes, e-mails, usuarios e organizacoes no Chronos.
- Zeus/Operations Center e fonte de protocolos e rastreabilidade operacional. O Apolo deve registrar fonte e origem dos dados quando usar informacoes de Zeus, mas nao deve assumir governanca de release.

## Modelo operacional proposto

Este modelo e conceitual. Nomes fisicos de tabelas e migrations ficam pendentes ate o mapeamento completo e autorizacao do Lucas.

- Identidade mestre: entidade unica para pessoa fisica, pessoa juridica, organizacao ou usuario interno, com nome de exibicao, nome legal, nome fantasia, status cadastral, origem primaria, qualidade do cadastro e controle de revisao humana.
- Perfis: relacionamento muitos-para-muitos para `cliente`, `imobiliaria`, `corretor`, `fornecedor`, `parceiro`, `colaborador`, `usuario_interno` e perfis futuros. Cada perfil pode ter campos obrigatorios proprios, definidos apenas apos mapear o C2X e validar com Lucas.
- Identificadores/documentos: CPF, CNPJ, RG, inscricoes, documentos fiscais e identificadores externos, com normalizacao, mascara de exibicao, origem, data de verificacao, hash/indice para deduplicacao e trilha de auditoria.
- Contatos: e-mail, telefone, celular, WhatsApp e canais externos, com origem, validade, preferencia, permissao de uso e ultimo sync.
- Enderecos: enderecos completos por tipo, origem, validade, padronizacao e divergencias.
- Relacionamentos: vinculos entre pessoas e empresas, representantes, conjuge, corretor, imobiliaria, parceiro, colaborador responsavel, participantes de contrato e outros papeis.
- Vinculos C2X: IDs legados por tabela/entidade, payload minimizado quando necessario, data de sincronizacao, origem do registro, regra de confianca e status de reconciliacao.
- Vinculos comerciais: empreendimentos, unidades, propostas, reservas, contratos, assinaturas, papeis no contrato e historico de status.
- Financeiro consultivo: snapshots e referencias de parcelas, pagamentos, inadimplencia, comportamento e indicadores Hades, sempre preservando Hades como origem operacional de cobranca.
- Atendimento consultivo: tickets, protocolos, mensagens, eventos, anexos e interacoes Iris.
- Reunioes consultivas: participacoes, atas, follow-ups e eventos Chronos quando mapeados.
- Timeline consolidada: eventos normalizados por fonte (`C2X`, `Apolo`, `Iris`, `Hades`, `Chronos`, `Zeus`, integracao externa), tipo, entidade, data, origem, confianca e responsavel.
- Area de documentos/anexos: upload, classificacao, leitura assistida, resultado de extracao, divergencias, revisao humana e aprovacao antes de gravar dados finais.
- Eventos de integracao e auditoria: requests, status, origem, divergencias, decisao humana, idempotency key, correlacao interna e mascaramento de dados sensiveis.

## Deducao e reconciliacao

- Prioridade alta: CPF/CNPJ normalizado, `legacy_id` C2X e identificadores de participante de contrato.
- Prioridade media: e-mail normalizado, telefone/WhatsApp em padrao E.164, nome + data de nascimento, nome + empreendimento/unidade, vinculos comerciais recorrentes.
- Prioridade contextual: corretor/imobiliaria/representante/conjuge/participante de contrato, quando a fonte C2X demonstrar papel claro.
- Fusao automatica destrutiva nao deve existir no V1. A primeira versao deve criar fila de possiveis duplicidades, score de confianca, comparacao campo a campo e aprovacao humana.
- O Apolo deve preservar o nome tecnico legado e a origem de cada campo enquanto Lucas nao autorizar migracao completa.

## MOSTQI

- A integracao deve ser server-side. Nenhum token, chave ou credencial pode ir para browser, log, commit ou resposta de chat.
- A autenticacao MOSTQI usa token temporario para chamadas da API. Credenciais e tokenizacao ficam `BLOQUEADO` ate Lucas autorizar envs/secrets.
- Enrichment pode operar sync ou async; o retorno deve ser tratado pelo contrato unificado `result/datasets`.
- O Apolo deve preparar fluxo de documento com upload, classificacao, leitura automatica, preenchimento assistido e revisao humana antes de gravar cadastro final.
- Pessoa fisica e pessoa juridica precisam de datasets e regras de divergencia separados.
- O armazenamento deve manter evidencia, status de leitura, origem, divergencias e decisao humana, sem expor dados sensiveis em logs ou telas indevidas.

## Primeira tela proposta

- Topo: busca forte por nome, CPF/CNPJ mascarado, telefone, e-mail, unidade, empreendimento, imobiliaria, corretor e identificador legado.
- Lista compacta: nome, tipo, perfis, documento mascarado, contato principal, empreendimento/unidade relevante, status cadastral, origem e alerta de duplicidade/pendencia.
- Detalhe 360: cabecalho com identidade, perfis, origem principal, score de confianca e acoes controladas.
- Abas: `Resumo`, `Cadastro`, `Comercial`, `Financeiro`, `Atendimento`, `Cobranca`, `Reunioes`, `Documentos`, `Relacionamentos`, `Timeline`, `Auditoria`.
- Formulario por perfil: campos exibidos por tipo/perfil, validacao clara, mascaras, pendencias e revisao humana.
- Area de documentos: upload, classificacao, leitura assistida, preview, divergencias e aprovacao.
- Layout: seguir Home do Panteon e sidebar canonico grafite/accent; perfil do usuario fica no topbar; evitar hero, marketing, cards dentro de cards e textos explicativos longos.
- Tooltips: usar `@repo/uix Tooltip` em controles compactos, nunca `title` nativo.

## Lacunas para confirmar com Lucas

- IDs e nomes definitivos de perfis C2X para cliente, imobiliaria, corretor, colaborador, fornecedor, parceiro e usuario interno.
- Campos obrigatorios por perfil e por etapa contratual no C2X.
- Regras de unicidade e tratamento de duplicidade para CPF/CNPJ, e-mail, telefone e participantes de contrato.
- Todos os status/stages de `acquisition_requests`, alem dos ja observados em Hades e no diario.
- Regras de representantes, conjuge, participantes secundarios e pessoa juridica.
- Schema real de split de pagamento e papeis comerciais.
- Origem oficial de anexos/documentos e politica de retencao.
- Se Apolo substitui o modulo planejado `contatos` no registry/permissoes ou se coexistira com outro nome tecnico.
- Datasets MOSTQI liberados, contrato comercial, forma de armazenamento, retencao e autorizacao para envs/secrets.
- Plano de virada para novos cadastros nascerem no Apolo e sincronizarem com C2X com idempotencia e auditoria.

## Fora do escopo desta entrega

- Nenhuma migration foi criada ou aplicada.
- Nenhuma tabela, RLS, Supabase, banco C2X, env, secret, token, dominio, alias, storage, webhook, deploy, producao ou homologacao foi alterado.
- Nenhum codigo de Hades, Iris, Hermes, Chronos, Atlas, Zeus, Setup ou C2X foi alterado.
- Nenhum dado sensivel foi exposto.

## Proximo recorte recomendado

1. Confirmar com Lucas se o primeiro recorte do Apolo sera apenas UI local/read-only ou inventario tecnico mais profundo do C2X.
2. Se autorizado, levantar inventario controlado de schema legado e profile ids sem expor dados sensiveis.
3. Definir se o modulo tecnico sera `/apolo` com permissoes `apolo:view`/`apolo:manage` ou se reaproveita/substitui o planejado `contatos`.
4. Criar desenho V1 read-only de busca + detalhe 360 usando fontes ja espelhadas/consultivas, sem gravar no C2X.
5. Somente depois propor migrations `apolo_*`, RLS, auditoria e trilha de sincronizacao.
