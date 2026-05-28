# API Connection Governance

Este documento ensina os agentes do Panteon a analisar, diagnosticar e registrar conexoes de APIs, bancos e servicos externos sem expor secrets.

## Regra central

Documente nomes, finalidade, owner, ambiente, escopo de autorizacao e healthchecks. Nunca documente valores.

Qualquer acao que crie, altere, remova, copie, rotacione ou exponha chave, token, secret, env, service role, `POSTGRES_URL`, dominio, alias, migration ou banco real comeca `BLOQUEADO` ate autorizacao explicita do Lucas.

## Como analisar uma conexao

1. Identifique o modulo dono: Zeus, Iris, Hades, Hermes, Atlas, Chronos, Apolo, Setup ou Hefesto.
2. Identifique o tipo de conexao: browser publica, server-only, banco, webhook, provider externo, AI, deploy ou sync operacional.
3. Liste apenas os nomes das envs envolvidas.
4. Classifique cada env:
   - publica/browser;
   - server-only;
   - privilegiada;
   - identificador sem segredo;
   - configuracao operacional.
5. Confirme o ambiente alvo: local, homologacao ou producao.
6. Localize o ponto de uso no codigo antes de concluir causa:
   - rota API;
   - helper server-side;
   - componente browser;
   - script operacional;
   - middleware/proxy;
   - provider.
7. Valide presenca/ausencia sem imprimir valor.
8. Rode smoke seguro:
   - rota publica esperada retorna `200`;
   - rota protegida sem sessao retorna `401`;
   - webhook sem handshake valido retorna `403`;
   - healthcheck sem env retorna erro operacional sem segredo;
   - logs nao exibem token, bearer, senha ou payload sensivel.
9. Registre no diario canonico:
   - nome da conexao;
   - envs por nome;
   - ambiente;
   - o que esta autorizado;
   - o que esta bloqueado;
   - validacoes;
   - riscos;
   - proxima acao.

## O que pode ser registrado

Permitido:

- nome da env;
- ambiente;
- modulo owner;
- se esta presente ou ausente;
- se e publica, server-only ou privilegiada;
- endpoint/rota sem token;
- status HTTP;
- deployment id;
- alias;
- erro sanitizado;
- contagens agregadas sem PII.

Proibido:

- valor de token, chave, senha, secret, service role ou bearer;
- prefixo/sufixo suficiente para reuso;
- connection string;
- URL com senha;
- JWT;
- payload bruto de webhook;
- numero de telefone completo quando nao for necessario;
- conteudo de mensagem de cliente em log tecnico;
- print de dashboard com secret visivel.

## Mapa de conexoes oficiais

### Panteon runtime e Vercel

Relacao com o Hub: define ambiente, URL publica, manifest/PWA, branding de homologacao/producao e rastreabilidade de build.

Env names:

- `NEXT_PUBLIC_CARELI_APP_ENV`
- `NEXT_PUBLIC_CARELI_APP_URL`
- `NEXT_PUBLIC_APP_URL`
- `NEXT_PUBLIC_CARELI_ENABLE_MOCKS`
- `VERCEL_ENV`
- `VERCEL_GIT_COMMIT_REF`

O que autoriza:

- Nao autoriza acesso a dados.
- Controla comportamento visual/runtime e identificacao de ambiente.
- `VERCEL_GIT_COMMIT_REF` ajuda a rastrear branch/deploy.

Regras:

- `NEXT_PUBLIC_*` aparece no browser; nunca colocar segredo ali.
- Divergencia de URL/env pode fazer homologacao parecer producao ou producao parecer homologacao.
- Alias e dominio continuam operacao sensivel.

Smokes seguros:

- `GET /`
- `GET /login`
- `GET /api/pwa/manifest`
- `vercel inspect <alias>` sem imprimir env values.

### Supabase Hub

Relacao com o Hub: Auth, usuarios, permissoes, Setup, Iris tickets, Hermes realtime/persistencia, Zeus Operations Center, releases, logs operacionais e tabelas `hub_*`.

Env names:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `NEXT_PUBLIC_SUPABASE_WORKSPACE_ID`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `HOMOLOG_SUPABASE_URL`
- `HOMOLOG_SUPABASE_SERVICE_ROLE_KEY`
- `HOMOLOG_SUPABASE_SECRET_KEY`

O que autoriza:

- `NEXT_PUBLIC_SUPABASE_URL`: identifica o projeto Supabase usado pelo browser.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: permite Auth/REST/Realtime no browser sob RLS. Nao e admin.
- `SUPABASE_URL`: URL server-side quando o runtime nao deve depender do nome publico.
- `SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY`: acesso server-side sem privilegio administrativo, ainda sob RLS quando aplicavel.
- `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY`: chave privilegiada server-only que ignora RLS em operacoes administrativas. Critica.
- `HOMOLOG_*`: chaves/URLs de homologacao para runners, scripts e runtime especifico.

Regras:

- Service role nunca vai para browser, `NEXT_PUBLIC_*`, logs ou docs.
- Homologacao nao deve usar service role de producao para escrita sem autorizacao explicita.
- Confirmar sempre se a URL/chave aponta para o projeto esperado.
- RLS/grants/migrations sao responsabilidade bloqueada ate autorizacao.

Smokes seguros:

- Auth health com anon key, sem imprimir chave.
- Rota protegida sem sessao deve retornar `401`.
- REST com anon key deve respeitar RLS.
- Realtime health pode retornar `403` esperado sem sessao.
- Para service role, validar apenas presenca/ausencia e efeito indireto em rota protegida.

### Postgres direto do Hub

Relacao com o Hub: migrations, verificacoes de schema, scripts de sync, reparos controlados e operacoes DataOps/Zeus.

Env names:

- `POSTGRES_URL`
- `POSTGRES_PRISMA_URL`
- `POSTGRES_URL_NON_POOLING`
- `DATABASE_URL`
- `HOMOLOG_POSTGRES_URL`
- `POSTGRES_USER`
- `POSTGRES_HOST`
- `POSTGRES_PASSWORD`
- `POSTGRES_DATABASE`

O que autoriza:

- Connection strings ou componentes permitem conexao direta ao banco.
- Podem executar DDL/DML conforme permissao do usuario configurado.

Regras:

- Sempre tratar como critica.
- Nunca imprimir, copiar para chat ou registrar em Markdown.
- Antes de qualquer `apply`, rodar dry-run quando possivel.
- Confirmar ambiente alvo antes de rodar script.
- Nao usar producao como atalho para homologacao.

Smokes seguros:

- `node --check` em scripts.
- Dry-run sem mostrar valores.
- Consulta de metadados agregados sem PII.
- Validar schema/RLS/grants sem despejar dados sensiveis.

### C2X legado e Hades DB

Relacao com o Hub: fonte operacional para Hades, filas, cobranca, carteira, contratos, leitura de clientes/unidades e fallback controlado do Apolo em desenvolvimento.

Env names:

- `GUARDIAN_DB_HOST`
- `GUARDIAN_DB_PORT`
- `GUARDIAN_DB_NAME`
- `GUARDIAN_DB_USER`
- `GUARDIAN_DB_PASSWORD`
- `GUARDIAN_DB_SSL`
- `GUARDIAN_SYNC_SECRET`

O que autoriza:

- `GUARDIAN_DB_*`: conexao MySQL server-side ao C2X/Hades.
- `GUARDIAN_SYNC_SECRET`: autoriza rotas de sincronizacao protegidas quando usadas.

Regras:

- Server-only.
- Homologacao deve preferir replica/homologacao; se usar producao para leitura, registrar autorizacao e impedir escrita.
- Nao aumentar limites pesados sem avaliar performance.
- Sanitizar erros para nao expor host, usuario, database ou SQL sensivel.

Smokes seguros:

- `/api/guardian/db/health`.
- `/api/guardian/attendance/queue?limit=20`.
- Verificar `503 unconfigured` por nomes ausentes sem valores.

### Hades Asaas

Relacao com o Hub: operacoes de cobranca, consulta de pagamentos, boletos e acoes financeiras no Hades.

Env names:

- `ASAAS_API_KEY`
- `ASAAS_API_BASE_URL`

O que autoriza:

- `ASAAS_API_KEY`: autentica chamadas Asaas.
- `ASAAS_API_BASE_URL`: define ambiente/base URL, como sandbox ou producao.

Regras:

- Critica, server-only.
- Homologacao deve usar sandbox ou acao real bloqueada.
- Qualquer disparo financeiro, envio de boleto ou acao externa real exige autorizacao explicita.
- Nao registrar payload financeiro completo.

Smokes seguros:

- Health/read-only quando existir.
- Validar ausencia com erro operacional claro.
- Logs sem `Authorization` ou dados financeiros sensiveis.

### Hades D4Sign

Relacao com o Hub: gera links frescos de documentos/contratos usados pelo Hades.

Env names:

- `D4SIGN_TOKEN_API`
- `D4SIGN_CRYPT_KEY`

O que autoriza:

- `D4SIGN_TOKEN_API`: autentica API D4Sign.
- `D4SIGN_CRYPT_KEY`: compoe autorizacao/criptografia exigida para acessar documento.

Regras:

- Critica, server-only.
- Nao chamar D4Sign automaticamente em lote sem recorte.
- Rotas devem falhar fechado se env ausente.
- Nao registrar link assinado quando tiver validade/acesso sensivel.

Smokes seguros:

- Rota sem sessao deve retornar `401`.
- Documento inexistente deve retornar erro sanitizado.
- Logs sem token/crypt key.

### Iris Meta WhatsApp

Relacao com o Hub: webhook inbound, status de mensagens, envio outbound pela Iris, criacao de eventos/tickets e rastreabilidade Meta.

Env names:

- `META_WHATSAPP_APP_ID`
- `META_WHATSAPP_APP_SECRET`
- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`
- `META_WHATSAPP_GRAPH_VERSION`

O que autoriza:

- `META_WHATSAPP_APP_ID`: identifica o app Meta. Nao basta para enviar.
- `META_WHATSAPP_APP_SECRET`: valida assinatura HMAC do webhook. Critica.
- `META_WHATSAPP_ACCESS_TOKEN`: autoriza chamadas Graph API, envio e leituras permitidas ao usuario/sistema configurado. Critica.
- `META_WHATSAPP_BUSINESS_ACCOUNT_ID`: escopo da conta WhatsApp Business.
- `META_WHATSAPP_PHONE_NUMBER_ID`: define o numero remetente/telefone operacional usado no endpoint Graph.
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`: valida handshake inicial do webhook. Critica.
- `META_WHATSAPP_GRAPH_VERSION`: fixa a versao da Graph API.

Pronto para inbound:

- `META_WHATSAPP_APP_SECRET`
- `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN`

Pronto para outbound:

- `META_WHATSAPP_ACCESS_TOKEN`
- `META_WHATSAPP_BUSINESS_ACCOUNT_ID`
- `META_WHATSAPP_PHONE_NUMBER_ID`
- `META_WHATSAPP_GRAPH_VERSION`

Regras:

- Todas sao server-only, exceto nenhuma deve virar `NEXT_PUBLIC_*`.
- Webhook pode ser publico, mas validado por assinatura/verify token.
- Nunca registrar payload bruto de mensagens.
- Nao publicar Preview generico se ele nao carregar env branch-specific da Meta.
- Diferenciar erro de env ausente, destinatario nao permitido, numero nao registrado e falha real da UI.

Smokes seguros:

- `GET /api/iris/meta/webhook` sem challenge deve retornar `403`.
- `POST /api/iris/meta/messages` sem sessao deve retornar `401`.
- `GET /iris` deve retornar `200`.
- Logs sem payload bruto e sem token.
- Teste outbound real somente com autorizacao e usuario autenticado.

### Asana

Relacao com o Hub: Home/Panteon performance e leitura operacional de tarefas/projetos quando configurado.

Env names:

- `ASANA_ACCESS_TOKEN`
- `ASANA_WORKSPACE_MODE`
- `ASANA_WORKSPACE_GID`
- `ASANA_WORKSPACE_GIDS`
- `ASANA_TASK_WINDOW_DAYS`
- `ASANA_TASK_LIMIT_PER_USER`

O que autoriza:

- `ASANA_ACCESS_TOKEN`: autentica API Asana. Critica.
- `ASANA_WORKSPACE_MODE`: controla leitura ampla ou filtrada.
- `ASANA_WORKSPACE_GID` / `ASANA_WORKSPACE_GIDS`: restringe workspace(s).
- `ASANA_TASK_WINDOW_DAYS`: limita janela temporal.
- `ASANA_TASK_LIMIT_PER_USER`: limita volume por usuario.

Regras:

- Token e server-only.
- Sempre limitar volume para evitar lentidao.
- Nao registrar nomes/detalhes sensiveis de tarefas quando nao necessario.
- Se o modo for filtrado, confirmar GIDs presentes por nome de env, sem valores.

Smokes seguros:

- Rota de performance com auth adequada.
- Validar erro de token ausente como configuracao pendente.
- Logs sem bearer.

### Chronos Google Agenda

Relacao com o Hub: preparar leitura/sincronizacao de compromissos formais do Chronos com Google Agenda, preservando horario, local e convidados cadastrados na origem.

Env names:

- `GOOGLE_CALENDAR_CLIENT_ID`
- `GOOGLE_CALENDAR_CLIENT_SECRET`
- `GOOGLE_CALENDAR_REDIRECT_URI`
- `GOOGLE_CALENDAR_SCOPES`
- `GOOGLE_CALENDAR_PRIMARY_CALENDAR_ID`

O que autoriza:

- `GOOGLE_CALENDAR_CLIENT_ID`: identifica o app OAuth Google. Nao basta para acessar agenda.
- `GOOGLE_CALENDAR_CLIENT_SECRET`: autentica o app OAuth server-side. Critica.
- `GOOGLE_CALENDAR_REDIRECT_URI`: define a URL autorizada para callback OAuth.
- `GOOGLE_CALENDAR_SCOPES`: restringe escopos de leitura/escrita, quando configurado.
- `GOOGLE_CALENDAR_PRIMARY_CALENDAR_ID`: calendario padrao operacional, quando houver.

Regras:

- Nenhuma env Google deve ser `NEXT_PUBLIC_*`.
- OAuth real exige aprovacao explicita do Lucas, consentimento, escopos revisados e storage seguro de state/tokens.
- Rotas sem configuracao devem falhar fechado e sem imprimir valores.
- Integracao deve preservar dados do Google conforme origem: titulo, horario, local e convidados.
- Sincronizacao bidirecional deve entrar em recorte proprio com auditoria e rollback.

Smokes seguros:

- `GET /api/chronos/google-calendar/status` sem sessao deve retornar `401`.
- `GET /api/chronos/google-calendar/status` com sessao deve listar apenas nomes de envs ausentes/presentes, nunca valores.
- `GET /api/chronos/google-calendar/authorize` sem env obrigatoria deve retornar erro operacional seguro.
- Logs sem client secret, bearer, refresh token, authorization code ou payload de agenda sensivel.

### OpenAI e AI do Panteon

Relacao com o Hub: Athena, PO AI, analise de evidencias, copilots e respostas estruturadas.

Env names:

- `OPENAI_API_KEY`
- `HUB_AI_MODEL`
- `HUB_CHRONOS_MINUTES_MODEL`
- `HUB_CHRONOS_TRANSCRIPTION_MODEL`
- `HUB_IT_TICKET_TRANSCRIPTION_MODEL`

O que autoriza:

- `OPENAI_API_KEY`: autoriza chamadas de AI. Critica.
- `HUB_AI_MODEL`: escolhe modelo padrao.
- `HUB_CHRONOS_MINUTES_MODEL`: escolhe modelo do agente de rascunho de ata do Chronos, quando configurado.
- `HUB_CHRONOS_TRANSCRIPTION_MODEL`: escolhe modelo de transcricao do Chronos, quando configurado.
- `HUB_IT_TICKET_TRANSCRIPTION_MODEL`: escolhe modelo/rota de transcricao de evidencias quando aplicavel.

Regras:

- API key server-only.
- Nao enviar secrets, tokens ou payloads sensiveis para analise.
- Ao analisar evidencias/tickets, minimizar PII e registrar apenas resultado operacional.
- Se faltar key, UI deve indicar AI indisponivel sem quebrar fluxo principal.

Smokes seguros:

- Rota sem sessao deve bloquear.
- Rota com env ausente deve responder erro operacional sem stack sensivel.
- Logs sem prompt bruto sensivel.

### Atlas fonte separada e Hub Atlas

Relacao com o Hub: leitura/migracao controlada de dados Atlas e posterior consumo por tabelas `atlas_*` no Supabase Hub.

Env names:

- `ATLAS_SUPABASE_URL`
- `ATLAS_SUPABASE_ANON_KEY`
- `ATLAS_SUPABASE_PUBLISHABLE_KEY`
- `ATLAS_SUPABASE_SERVICE_ROLE_KEY`
- `SOURCE_SUPABASE_SERVICE_ROLE_KEY`
- `TARGET_SUPABASE_SERVICE_ROLE_KEY`

O que autoriza:

- `ATLAS_SUPABASE_URL`: identifica projeto Atlas origem.
- `ATLAS_SUPABASE_ANON_KEY` / `ATLAS_SUPABASE_PUBLISHABLE_KEY`: leitura controlada quando RLS permitir.
- `ATLAS_SUPABASE_SERVICE_ROLE_KEY`: leitura/admin origem em scripts autorizados. Critica.
- `SOURCE_*` e `TARGET_*`: copias Hub-to-Hub em scripts controlados. Criticas.

Regras:

- A tela Atlas atual deve priorizar Supabase Hub quando o dado ja foi migrado.
- Service role so em script autorizado, nunca em browser.
- Nao copiar dados entre projetos sem confirmar origem/destino.
- Remover arquivos temporarios de env apos uso.

Smokes seguros:

- `GET /atlas`.
- `GET /api/atlas/snapshot`.
- Scripts com `--dry-run` quando existirem.
- Contagens agregadas, sem dump de linhas sensiveis.

### Apolo cadastro mestre

Relacao com o Hub: cadastro mestre, CRM, relacoes C2X -> Supabase Hub e fonte futura para Hades/Iris/Chronos/Zeus.

Env names:

- `HOMOLOG_SUPABASE_URL`
- `HOMOLOG_SUPABASE_SERVICE_ROLE_KEY`
- `HOMOLOG_SUPABASE_SECRET_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_SECRET_KEY`
- `POSTGRES_URL`
- `POSTGRES_URL_NON_POOLING`
- `POSTGRES_PRISMA_URL`
- `DATABASE_URL`
- `HOMOLOG_POSTGRES_URL`
- `GUARDIAN_DB_*`

O que autoriza:

- Supabase service/secret: escrita nas tabelas `apolo_*` quando script autorizado.
- Postgres URL: schema/migration/verificacao direta.
- `GUARDIAN_DB_*`: leitura inicial do C2X para sync.

Regras:

- Sync C2X -> Apolo escreve em Supabase; exige autorizacao explicita do alvo.
- Nao usar fallback C2X em homologacao/producao como fonte oficial se `apolo_*` deve ser fonte central.
- Registrar contagens agregadas, nunca PII bruta.
- Confirmar deduplicacao/idempotencia antes de upsert.

Smokes seguros:

- `GET /apolo`.
- `GET /api/apolo/relationships`.
- Verificar `source=apolo` em homologacao quando tabelas estiverem alimentadas.
- `node --check` nos scripts antes de executar.

### Zeus Operations Center e sync local

Relacao com o Hub: diario vivo, registros estruturados, releases, alertas, protocolos e sync local/remoto.

Env names:

- `SQUADOPS_SYNC_ENDPOINT`
- `SQUADOPS_SYNC_BEARER`
- `SQUADOPS_ADMIN_BEARER`
- `SQUADOPS_SYNC_INTERVAL_MS`

O que autoriza:

- `SQUADOPS_SYNC_ENDPOINT`: define destino do sync.
- `SQUADOPS_SYNC_BEARER` / `SQUADOPS_ADMIN_BEARER`: autoriza sync remoto estruturado. Critica.
- `SQUADOPS_SYNC_INTERVAL_MS`: cadencia local.

Regras:

- Endpoint local e o padrao para arquivo local em edicao.
- Endpoint remoto exige bearer.
- Nao registrar bearer nem conteudo sensivel do diario.
- Sync deve ser idempotente e reconciliar protocolos sem sobrescrever registros vivos incorretamente.

Smokes seguros:

- Dry-run do script.
- `GET /api/zeus/operations` ou rota estruturada sem sessao deve bloquear quando esperado.
- Registro de contagens agregadas.

### Hermes Realtime e chamadas

Relacao com o Hub: mensagens, presenca, notificacoes, chamadas WebRTC e broadcast via Supabase Realtime.

Env names:

- `NEXT_PUBLIC_PULSEX_TURN_URLS`
- `NEXT_PUBLIC_PULSEX_TURN_USERNAME`
- `NEXT_PUBLIC_PULSEX_TURN_CREDENTIAL`
- Supabase public envs do Hub.

O que autoriza:

- Supabase public envs: Realtime/Auth sob RLS.
- `NEXT_PUBLIC_PULSEX_TURN_*`: configura ICE/TURN no browser para chamadas. Por ser `NEXT_PUBLIC`, fica exposto ao cliente.

Regras:

- TURN em `NEXT_PUBLIC_*` deve ser tratado como credencial operacional exposta; preferir credenciais temporarias/escopadas quando possivel.
- Teste de chamada exige dois usuarios/duas sessoes.
- Dominio OPS pode desabilitar chamadas para evitar ruido operacional.

Smokes seguros:

- `GET /hermes`.
- API de mensagens sem sessao deve retornar `401`.
- Validar subscribe/broadcast sem expor payload sensivel.
- Teste real de chamada apenas em cenario controlado.

## Diagnostico por sintoma

### `401 Unauthorized`

Verificar:

- rota exige sessao?
- token bearer ausente?
- Preview protegido por Vercel/SSO?
- cookie/session expirado?
- RLS bloqueando usuario?

Registro permitido: rota, ambiente, status, se havia sessao ou nao.

### `403 Forbidden`

Verificar:

- webhook sem verify token/challenge?
- assinatura HMAC invalida?
- RLS nega role?
- protection bypass ausente?

Para Iris Meta, `GET /api/iris/meta/webhook` sem challenge retornar `403` e esperado.

### `503 unconfigured`

Verificar:

- env ausente;
- env carregada no ambiente errado;
- deployment Preview generico sem branch-specific env;
- nome alternativo aceito pelo resolver;
- server-only lido no browser por engano.

Registro permitido: nomes ausentes, ambiente e rota.

### Dados sumiram

Verificar:

- alias aponta para deployment correto?
- build publicado contem a rota?
- registry/modulo esta ativo?
- permissoes do usuario liberam o modulo?
- banco alvo e o mesmo ambiente esperado?
- cache/browser/session antiga?
- fallback local foi usado indevidamente em homologacao?

## Checklist para agentes antes de mexer em API

- Li `AGENTS.md`, `docs/operations/README.md` e diario canonico?
- O pedido e diagnostico, implementacao, env, banco, deploy ou producao?
- Existe autorizacao explicita do Lucas para acao sensivel?
- Sei o ambiente alvo?
- Sei o modulo dono?
- Listei env names sem valores?
- Confirmei se algo e `NEXT_PUBLIC_*`?
- Confirmei se algo e service role, bearer, token ou connection string?
- Tenho smoke seguro?
- Tenho rollback ou caminho de restauracao?
- Registrei no diario sem segredo?
