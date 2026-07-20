# Serasa Experian — APIs de Crédito: levantamento e desenho da integração

> Levantado em 21/jul/2026 por um estudo multi-agente (29 agentes) com verificação adversarial:
> cada afirmação foi conferida contra a fonte por um segundo agente, e o que não se sustentou
> está marcado como lacuna. Complementado por leitura manual do portal no navegador.
>
> ⚠️ O portal `developer.serasaexperian.com.br` é uma SPA: `fetch` simples devolve só o título.
> Os arquivos CRUS são legíveis e foram a fonte principal:
> `.../data/<slug>/index.md` e `.../data/<slug>/swagger.yaml`.
>
> **[DOC]** = lido na documentação oficial · **[SUPOSIÇÃO]** = desenho, não é fonte.

ry": "Estuda a API de crÃ©dito do Serasa Experian e mapeia a integraÃ§Ã£o com a esteira do Apolo",
  "agentCount": 29,
  "logs": [
    "24 afirmaÃ§Ãµes; 4 confirmadas na fonte"
  ],
  "result": {
    "confirmados": 4,
    "desenho": "# IntegraÃ§Ã£o Serasa Experian (APIs de CrÃ©dito) na esteira do Apolo

Documento de desenho. Tudo que estÃ¡ marcado **[DOC]** foi lido na documentaÃ§Ã£o oficial com a URL ao lado. Tudo marcado **[SUPOSIÃÃO]** Ã© desenho meu, nÃ£o Ã© fonte. Onde a documentaÃ§Ã£o nÃ£o respondeu, estÃ¡ escrito **NÃO ENCONTRADO NA DOCUMENTAÃÃO**.

---

## 1. O que ficou claro da API (sÃ³ o confirmado)

### 1.1 AutenticaÃ§Ã£o (2 passos, nÃ£o Ã© OAuth2 client_credentials padrÃ£o)

**[DOC]** `https://developer.serasaexperian.com.br/data/faq---perguntas-frequentes/index.md`

- `POST` em `/security/iam/v1/client-identities/login`
- Headers: `Authorization: Basic <base64 de clientId:clientSecret>` e `Content-Type: application/json`
- Resposta traz o campo **`accessToken`** (camelCase)
- **Hosts distintos por ambiente:**
  - HomologaÃ§Ã£o: `https://uat-api.serasaexperian.com.br/security/iam/v1/client-identities/login`
  - ProduÃ§Ã£o: `https://api.serasaexperian.com.br/security/iam/v1/client-identities/login`
- Token vale **60 minutos**. A doc recomenda explicitamente implementar reuso/cache do token, nÃ£o gerar um por consulta (`.../data/onboarding-apis--credito/index.md`).

**Ã aqui, e sÃ³ aqui, que entram o clientId/clientSecret de homologaÃ§Ã£o.** Nas chamadas de relatÃ³rio vai apenas o `Bearer <accessToken>`.

**Conflito real dentro da prÃ³pria documentaÃ§Ã£o, nÃ£o resolvido:** no mesmo bloco do FAQ, o exemplo em Python usa `/security/iam/v1/client-identities/login`, mas o exemplo em cURL usa `/security/iam/v1/user-identities/login?clientId={clientId}`. Os dois caminhos estÃ£o publicados. Isso precisa ser testado contra homologaÃ§Ã£o antes de virar cÃ³digo.

**Terceiro conflito:** os arquivos `swagger.yaml` dos relatÃ³rios declaram `securitySchemes: OauthSecurityClient`, tipo `oauth2`, flow `clientCredentials`, com `tokenUrl: https://sandbox-api.serasaexperian.com.br/security/iam/v1/client-identities/login`. Ou seja, existe um terceiro host (`sandbox-api`) citado no swagger, diferente do `uat-api` citado no FAQ. NÃ£o sei qual Ã© o correto para nossa credencial.

### 1.2 Endpoints de consulta: PF e PJ sÃ£o serviÃ§os diferentes

**[DOC]** `https://developer.serasaexperian.com.br/data/onboarding-apis--credito/index.md`

| | HomologaÃ§Ã£o | ProduÃ§Ã£o |
|---|---|---|
| **PF** | `https://uat-api.serasaexperian.com.br/credit-services/person-information-report/v1/creditreport` | `https://api.serasaexperian.com.br/credit-services/person-information-report/v1/creditreport` |
| **PJ** | `https://uat-api.serasaexperian.com.br/credit-services/business-information-report/v1/reports` | `https://api.serasaexperian.com.br/credit-services/business-information-report/v1/reports` |

NÃ£o dÃ¡ para reaproveitar a mesma URL trocando sÃ³ o `reportName`: **PF e PJ tÃªm paths diferentes**. JÃ¡ bÃ¡sico e avanÃ§ado **dentro do mesmo tipo** sÃ£o a mesma rota (confirmado nos swaggers: `relatorio-basico-pf/swagger.yaml` e `relatorio-avancado-pf/swagger.yaml` sÃ£o praticamente idÃªnticos, mesmo path `/creditreport`, mesmo tÃ­tulo de spec `CS-Person-Information-Report-BR`). O que muda Ã© o `reportName`.

### 1.3 MÃ©todo e formato: GET, sem body JSON

**[DOC]** `.../data/relatorio-basico-pf/swagger.yaml` (openapi 3.0.1) e `.../data/onboarding-apis--credito/index.md`

- MÃ©todo **GET**. NÃ£o hÃ¡ corpo de requisiÃ§Ã£o.
- Path Ãºnico por serviÃ§o (`/creditreport` no PF, `/reports` no PJ), verbo Ãºnico `get`.
- **Zero webhooks, zero callbacks, zero endpoint de status.** Ã 100% sÃ­ncrono: a resposta 200 jÃ¡ traz o relatÃ³rio em JSON (`PersonInformationReportResponse`, com array `reports[]` no PF).
- CÃ³digos de resposta declarados no swagger PF: 200, 400, 401, 403, 404, 412, 429, 500. Todos `application/json`.

### 1.4 Onde vai cada dado

**Headers** (**[DOC]** `.../data/relatorio-basico-pf/index.md` e `.../data/relatorio-basico-pj/index.md`):

| Header | Tam. | O que Ã© |
|---|---|---|
| `Authorization` | | `Bearer <accessToken>` |
| `X-Document-Id` | 11 (PF) / 14 (PJ) | **o documento CONSULTADO** (CPF ou CNPJ) |
| `X-Retailer-Document-Id` | 14 | CNPJ do **cliente consultante**. Na doc de PJ: se nÃ£o informado, "a contabilizaÃ§Ã£o serÃ¡ direcionada para o cliente distribuidor" |
| `X-Cost-Center` | 12 | opcional, cÃ³digo numÃ©rico de centro de custo para contabilizaÃ§Ã£o interna |

Ponto crÃ­tico de leitura: **`X-Document-Id` Ã© quem estÃ¡ sendo consultado; `X-Retailer-Document-Id` Ã© quem consulta.** Confundir os dois joga a cobranÃ§a no lugar errado.

**Query string** (**[DOC]** onboarding + swagger):
- `reportName` â o nome do relatÃ³rio
- `optionalFeatures` â concatenados por vÃ­rgula **sem espaÃ§o** (ex.: `QSA_COMPLETO,PARTICIPACOES`)
- `reportParameters` â valor em **Base64**
- `federalUnit` â obrigatÃ³rio para certos relatÃ³rios PF. Quais exatamente: **NÃO ENCONTRADO NA DOCUMENTAÃÃO**

O CPF nunca vai na URL. Isso Ã© bom e casa com a nossa regra de nÃ£o colocar dado pessoal em query string (nÃ£o vaza em log de proxy/CDN).

### 1.5 reportNames

Os nomes `RELATORIO_BASICO_PF_PME` e `RELATORIO_AVANCADO_TOP_SCORE_PF_PME` aparecem na tabela "OFERTA PME V7 PF/PJ" da pÃ¡gina de onboarding **[DOC]**, batendo com o e-mail do Serasa. Os dois de PJ (`RELATORIO_BASICO_PJ_PME`, `RELATORIO_AVANCADO_PJ_PME`) eu **nÃ£o confirmei com esse nome exato** na pÃ¡gina; vi `RELATORIO_BASICO_PJ` e `RELATORIO_DADOS_AVULSOS_PJ`. Confirmar antes de codar.

### 1.6 RestriÃ§Ãµes operacionais de homologaÃ§Ã£o (importantes para o prazo de 01/08)

**[DOC]** `.../data/onboarding-apis--credito/index.md` e `.../data/faq---perguntas-frequentes/index.md`

- **Limite de 200 chamadas/dia por IP em UAT.** Estourou, o IP de origem Ã© bloqueado.
- **UAT tem downtime das 20:00 Ã s 08:00 e nos finais de semana.**
- A api key de UAT tem vigÃªncia de **90 dias Ãºteis**.
- Credencial de produÃ§Ã£o se pede por `implantacao@experian.com` / `migracaoscoreapi@experian.com`.

Os 122 CADs **nÃ£o cabem em homologaÃ§Ã£o** se cada um gerar mais de uma chamada. E como saÃ­mos da Vercel/Lightsail com IP compartilhado, um bloqueio de IP em UAT pode derrubar outras coisas.

### 1.7 O que NÃO estÃ¡ confirmado (e circulou como se estivesse)

Coisas que vi afirmadas e que a fonte **nÃ£o sustenta**, entÃ£o nÃ£o podem virar cÃ³digo:

- Nomes dos demais campos da resposta do token (`tokenType`, `expiresIn`, `scope`). SÃ³ `accessToken` estÃ¡ confirmado. NÃ£o assuma PascalCase nem snake_case; leia o campo real da primeira resposta.
- Host de produÃ§Ã£o derivado por analogia (trocar `sandbox-api` por `api`). Existe conflito entre `uat-api`, `sandbox-api` e `api` na prÃ³pria doc.
- Estrutura interna do JSON de resposta (nomes dos campos de score, negativaÃ§Ã£o, etc.). NÃ£o abri o schema completo. **NÃO ENCONTRADO NA DOCUMENTAÃÃO** neste levantamento.
- `relatorio-avancado-pj/swagger.yaml` nÃ£o foi aberto por ninguÃ©m. Ã a Ãºnica das 4 rotas sem verificaÃ§Ã£o direta.

---

## 2. O que falta saber: perguntas objetivas para o Serasa

Mandar por e-mail para o contato de implantaÃ§Ã£o, numeradas, pedindo resposta escrita:

1. **Qual Ã© o endpoint de token correto?** A documentaÃ§Ã£o publica dois: `/security/iam/v1/client-identities/login` (exemplo Python) e `/security/iam/v1/user-identities/login?clientId=...` (exemplo cURL). Qual vale para nossa credencial de API de CrÃ©dito?
2. **Qual host de homologaÃ§Ã£o usar com a credencial que recebemos:** `uat-api.serasaexperian.com.br` (FAQ) ou `sandbox-api.serasaexperian.com.br` (swagger)?
3. **Qual Ã© o host de produÃ§Ã£o** dos relatÃ³rios PF e PJ, e a credencial de produÃ§Ã£o Ã© a mesma ou precisa ser emitida Ã  parte?
4. **Confirmar os 4 `reportName` exatos** contratados para nosso CNPJ, com a grafia literal.
5. **`federalUnit` Ã© obrigatÃ³rio em qual dos relatÃ³rios PF?** Que formato (sigla de 2 letras)? Qual UF usar quando o cliente Ã© de outro estado do empreendimento?
6. **`reportParameters`:** que parÃ¢metros existem para os nossos relatÃ³rios, e qual o JSON exato que deve ser codificado em Base64?
7. **`optionalFeatures`:** quais estÃ£o habilitados no nosso contrato e **quais sÃ£o cobrados Ã  parte**?
8. **PreÃ§o unitÃ¡rio** de cada um dos 4 relatÃ³rios, com e sem optionalFeatures. Existe franquia mensal, mÃ­nimo contratado ou degrau de volume?
9. **Consulta repetida do mesmo CPF dentro de X dias Ã© cobrada de novo?** Existe janela de cache comercial?
10. **Consultas em homologaÃ§Ã£o (UAT) sÃ£o cobradas?** (assumo que nÃ£o, mas preciso por escrito).
11. **Retorno vazio / CPF nÃ£o encontrado (404) Ã© cobrado?**
12. **Limites de produÃ§Ã£o:** chamadas por segundo, por dia, e polÃ­tica de 429.
13. **Schema completo da resposta** dos 4 relatÃ³rios (arquivo swagger/OpenAPI ou coleÃ§Ã£o Postman). Precisamos dos nomes de campo de score, faixa de risco e negativaÃ§Ã£o.
14. **Qual Ã© o range do score** e a interpretaÃ§Ã£o oficial das faixas?
15. **Requisitos de LGPD do lado de vocÃªs:** exigem registro de finalidade, consentimento, retenÃ§Ã£o mÃ¡xima do relatÃ³rio, e hÃ¡ clÃ¡usula de operador/controlador no contrato?
16. **Podemos armazenar o JSON bruto do relatÃ³rio?** Por quanto tempo?
17. **Whitelist de IP:** o UAT bloqueia IP acima de 200 chamadas/dia. Nosso trÃ¡fego sai de IP compartilhado de cloud. DÃ¡ para liberar por IP fixo? (temos um IP fixo no Lightsail)

---

## 3. Desenho proposto

**[SUPOSIÃÃO daqui em diante, salvo onde marcado.]**

### 3.1 Onde entra na esteira

A esteira hoje: validaÃ§Ã£o â **anÃ¡lise de crÃ©dito** â prÃ©-venda (PIX R$1000) â credenciado.

A consulta Serasa entra **na entrada da etapa "AnÃ¡lise de crÃ©dito"**, disparada pelo analista, nÃ£o automaticamente na mudanÃ§a de etapa. Motivo: consulta paga nÃ£o pode ser efeito colateral de arrastar um card.

Fluxo:
1. CAD chega na etapa AnÃ¡lise de crÃ©dito (122 hoje).
2. Analista abre a ficha, aba **CrÃ©dito**.
3. VÃª o CPF/CNPJ, o custo estimado e o botÃ£o "Consultar Serasa".
4. Modal de confirmaÃ§Ã£o com o valor. Confirmou, dispara.
5. Resposta sÃ­ncrona (segundos). Card mostra score + resumo.
6. Analista decide: aprova, recusa ou pede documento complementar. **A decisÃ£o continua humana.** Nada de auto-aprovar por score na primeira versÃ£o.

Quem consulta: **o proponente sempre**. CÃ´njuge e PJ (imobiliÃ¡ria) ficam como consulta separada, disparada Ã  parte, porque cada uma custa. AtenÃ§Ã£o Ã  armadilha jÃ¡ conhecida das fichas com pessoa trocada: **nÃ£o disparar consulta em lote antes de fechar aquela correÃ§Ã£o**, senÃ£o paga-se consulta de CPF errado.

### 3.2 Banco: tabelas novas

Regra do projeto jÃ¡ aprendida na marra: **nada de estado operacional em `apolo_entities.metadata`**, porque o sync do C2X substitui o metadata inteiro. Tudo em tabela prÃ³pria.

**`serasa_consultas`** (uma linha por chamada feita, inclusive as que falharam):
- `id`
- `apolo_entity_id` (a quem se refere)
- `esteira_id` (opcional, liga ao CAD/etapa)
- `documento` (CPF/CNPJ consultado, normalizado)
- `tipo_pessoa` (PF/PJ)
- `report_name`
- `ambiente` (uat/prod) â separar Ã© obrigatÃ³rio, senÃ£o ninguÃ©m sabe se aquele score Ã© de teste
- `status` (pendente / sucesso / erro)
- `http_status`
- `payload_response` (jsonb, o relatÃ³rio bruto)
- `score` (numÃ©rico extraÃ­do, denormalizado para listar/ordenar)
- `resumo` (jsonb pequeno: score, faixa, qtd negativaÃ§Ãµes, total em aberto)
- `custo_estimado_centavos`
- `cost_center` (o valor enviado em `X-Cost-Center`)
- `solicitado_por` (user id do analista)
- `finalidade` (texto, para LGPD)
- `created_at`

**`serasa_token_cache`** (ou Redis/KV, se preferir): um registro com o token e o `expires_at`. Renovar aos **55 minutos** por seguranÃ§a, jÃ¡ que o nome do campo de expiraÃ§Ã£o da resposta nÃ£o estÃ¡ confirmado. **[DOC]** o token vale 60 min e a doc pede reuso.

Ãndices: `(apolo_entity_id, created_at desc)` e `(documento, created_at desc)` â o segundo Ã© o que permite bloquear re-consulta duplicada.

**NÃ£o criar** tabela de fila/worker agora. Ã sÃ­ncrono, nÃ£o precisa.

### 3.3 CÃ³digo

- `lib/serasa/auth.ts` â token com cache, host por env.
- `lib/serasa/client.ts` â duas funÃ§Ãµes distintas, `consultarPF` e `consultarPJ`, porque os paths sÃ£o diferentes. Nada de uma funÃ§Ã£o genÃ©rica.
- Env vars, todas server-side: `SERASA_CLIENT_ID`, `SERASA_CLIENT_SECRET`, `SERASA_AUTH_URL`, `SERASA_PF_BASE_URL`, `SERASA_PJ_BASE_URL`, `SERASA_AMBIENTE`, `SERASA_RETAILER_DOCUMENT_ID`. **Host nunca hardcoded**, dado o conflito uat-api/sandbox-api/api.
- Route handler `/api/apolo/serasa/consultar` â valida permissÃ£o, valida orÃ§amento, grava a linha, chama, grava a resposta.

`X-Cost-Center` tem sÃ³ 12 caracteres numÃ©ricos, entÃ£o **nÃ£o cabe UUID**. Usar um cÃ³digo curto, por exemplo id numÃ©rico do empreendimento + sequencial. Ã o gancho natural para o rateio de custo por lanÃ§amento.

### 3.4 Como aparece na ficha

Nova aba **CrÃ©dito** no cockpit do Apolo (padrÃ£o das outras abas):
- Card do topo: score grande, faixa de risco colorida, data da consulta, quem consultou.
- Lista de restriÃ§Ãµes/negativaÃ§Ãµes, se houver.
- HistÃ³rico de consultas daquele CPF (com o ambiente marcado, para ninguÃ©m confundir teste com real).
- BotÃ£o "Nova consulta" com o aviso de custo e a data da Ãºltima.
- Link para o JSON bruto (sÃ³ para admin).

E um chip na Timeline: "Consulta Serasa realizada, score X, por Fulano". A Timeline Ã© a ficha corrida, isso pertence a ela.

---

## 4. Custo

**O que a documentaÃ§Ã£o diz:** **NADA sobre preÃ§o.** NÃ£o hÃ¡ tabela de preÃ§os, nem preÃ§o por relatÃ³rio, nem franquia. **NÃO ENCONTRADO NA DOCUMENTAÃÃO.** Ã contrato comercial, vem por e-mail.

O que a doc entrega sobre custo Ã© apenas **infraestrutura de rastreio**: `X-Cost-Center` (12 posiÃ§Ãµes, para contabilizaÃ§Ã£o interna) e `X-Retailer-Document-Id` (define para qual cliente a consulta Ã© contabilizada; sem ele, vai para o distribuidor).

**AplicaÃ§Ã£o da regra do projeto (mesma da MOST):**

1. **Nenhuma consulta sai sem preÃ§o cadastrado.** Criar uma constante/config `SERASA_PRECOS` com o valor de cada `reportName`. Enquanto o Serasa nÃ£o responder a pergunta 8, o valor fica `null` e o botÃ£o de consulta em produÃ§Ã£o fica **desabilitado**.
2. **OrÃ§amento antes.** Antes de qualquer lote, calcular: nÂº de CADs Ã preÃ§o unitÃ¡rio = total, e levar para o Lucas aprovar por escrito. Para os 122 CADs, isso Ã© uma linha sÃ³: "122 consultas Ã R$ X = R$ Y, confirma?".
3. **ConfirmaÃ§Ã£o explÃ­cita por consulta avulsa.** Modal mostrando o valor. Sem modal, sem chamada.
4. **Trava de duplicidade.** Se existe consulta do mesmo documento nos Ãºltimos N dias (sugiro 30, ajustar conforme resposta da pergunta 9), o sistema **bloqueia** e oferece reaproveitar o resultado guardado. SÃ³ um segundo clique explÃ­cito, com aviso "isso vai gerar nova cobranÃ§a", libera.
5. **Painel de gasto.** Soma de `custo_estimado_centavos` por dia/empreendimento, visÃ­vel. Foi assim que o custo da MOST ficou controlÃ¡vel.
6. **Escolher o relatÃ³rio mais barato que resolve.** HipÃ³tese a validar: talvez o **bÃ¡sico** jÃ¡ baste para triagem e o **avanÃ§ado** sÃ³ seja disparado nos casos de dÃºvida. Isso pode reduzir muito o custo do lote. Depende dos preÃ§os e do conteÃºdo do bÃ¡sico.

**Ponto que pode economizar bastante:** jÃ¡ temos o `pf_gold` da MOST, que traz score e negativaÃ§Ã£o. Antes de comprar 122 consultas Serasa, vale comparar: em quantos casos o `pf_gold` jÃ¡ responde? A Serasa pode ficar sÃ³ para os casos onde o crÃ©dito Ã© limÃ­trofe ou o valor Ã© alto. Isso Ã© decisÃ£o do Lucas, nÃ£o minha.

---

## 5. LGPD

**A documentaÃ§Ã£o lida nÃ£o trata de LGPD.** **NÃO ENCONTRADO NA DOCUMENTAÃÃO.** O que segue Ã© o mÃ­nimo jurÃ­dico/operacional que eu recomendo, **[SUPOSIÃÃO]**, e que deve ser validado com quem cuida do jurÃ­dico da Careli.

1. **Base legal.** Consulta de crÃ©dito para anÃ¡lise de proposta de venda normalmente se apoia em *execuÃ§Ã£o de contrato / procedimentos preliminares* (art. 7Âº, V) ou *legÃ­timo interesse* (art. 7Âº, IX). NÃ£o depender de consentimento avulso: consentimento pode ser revogado e derruba o processo. Mas isso precisa ser decidido pelo jurÃ­dico e **registrado**.
2. **ClÃ¡usula no CAD.** O formulÃ¡rio de credenciamento (o CAD que vem do Asana) deve conter, de forma legÃ­vel, autorizaÃ§Ã£o/ciÃªncia de consulta a birÃ´s de crÃ©dito. Verificar se o texto atual jÃ¡ tem. Se nÃ£o tiver, **incluir antes de rodar o lote dos 122**, porque parte deles preencheu sem isso.
3. **Registro de finalidade por consulta.** Campo `finalidade` obrigatÃ³rio na `serasa_consultas`. Sem finalidade registrada, a consulta nÃ£o Ã© feita. Isso Ã© o que responde uma eventual fiscalizaÃ§Ã£o ou pedido do titular.
4. **Rastreabilidade de quem consultou.** `solicitado_por` obrigatÃ³rio. Consulta de CPF por sistema anÃ´nimo Ã© problema.
5. **Controle de acesso.** O relatÃ³rio de crÃ©dito Ã© dado sensÃ­vel na prÃ¡tica. SÃ³ perfis internos autorizados podem ver a aba CrÃ©dito. **ImobiliÃ¡ria e corretor NÃO podem ver.** Isso casa com a direÃ§Ã£o jÃ¡ fechada: a restriÃ§Ã£o Ã© por papel do usuÃ¡rio logado.
6. **RetenÃ§Ã£o.** Definir prazo para o `payload_response` bruto (sugiro 12 meses, depois manter sÃ³ o `resumo`). Perguntar ao Serasa se o contrato impÃµe prazo.
7. **Nunca em query string, nunca em log.** CPF sÃ³ em header. O logger tem que mascarar `X-Document-Id`.
8. **Direito do titular.** Precisamos conseguir responder "quais consultas foram feitas sobre mim e por quÃª". A tabela `serasa_consultas` jÃ¡ resolve isso se for bem preenchida.
9. **Contrato Serasa.** Verificar se hÃ¡ termo de tratamento de dados / clÃ¡usula controlador-operador assinado. Se nÃ£o houver, pedir.

---

## 6. Riscos e o que NÃO fazer

**Riscos:**

- **Bloqueio de IP em homologaÃ§Ã£o.** 200 chamadas/dia por IP. Um teste em loop mal feito queima o dia e possivelmente o IP compartilhado.
- **Janela de teste curta.** UAT cai das 20:00 Ã s 08:00 e nos finais de semana. Faltam ~11 dias para 01/08. Efetivamente restam poucas janelas Ãºteis.
- **Host errado.** Existem trÃªs hosts citados na documentaÃ§Ã£o (`uat-api`, `sandbox-api`, `api`). Chutar errado significa, no melhor caso, 401; no pior caso, **disparar consulta paga em produÃ§Ã£o achando que estÃ¡ em sandbox**.
- **Path de token errado.** A prÃ³pria doc publica dois caminhos diferentes.
- **Schema da resposta desconhecido.** Vamos gravar o JSON bruto, mas o parse de score pode quebrar. Por isso o `payload_response` inteiro Ã© gravado: dÃ¡ para reprocessar sem pagar de novo.
- **Fichas com pessoa trocada.** ~19 das 270 tÃªm dados do cÃ´njuge no lugar do proponente. Consultar essas = pagar por consulta do CPF errado e reprovar quem nÃ£o devia.
- **Custo desconhecido.** NÃ£o sabemos o preÃ§o. 122 consultas com preÃ§o errado na cabeÃ§a pode virar uma conta desagradÃ¡vel.

**O que NÃO fazer:**

- NÃ£o rodar o lote dos 122 em homologaÃ§Ã£o (estoura o limite de 200/dia e o resultado nem serve).
- NÃ£o deduzir o host de produÃ§Ã£o trocando `sandbox-api` por `api`.
- NÃ£o escrever uma funÃ§Ã£o Ãºnica para PF e PJ. SÃ£o serviÃ§os diferentes.
- NÃ£o montar POST com body JSON. Ã GET.
- NÃ£o colocar CPF em query string.
- NÃ£o gerar token por consulta.
- NÃ£o gravar nada operacional em `apolo_entities.metadata`.
- NÃ£o disparar consulta automaticamente na mudanÃ§a de etapa.
- NÃ£o auto-aprovar ou auto-reprovar CAD por score na v1.
- NÃ£o ir para produÃ§Ã£o antes de ter preÃ§o confirmado por escrito.
- NÃ£o deixar imobiliÃ¡ria/corretor ver a aba CrÃ©dito.

---

## 7. Primeiro passo concreto

**Objetivo do recorte:** provar que conseguimos autenticar e trazer um relatÃ³rio real em homologaÃ§Ã£o. Nada alÃ©m disso.

**Escopo: 1 CPF, 1 relatÃ³rio, 1 script. Zero UI, zero tabela, zero deploy.**

Passos, nesta ordem:

1. **Antes de escrever cÃ³digo, mandar o e-mail** com as 17 perguntas da seÃ§Ã£o 2. Elas destravam o resto e a resposta demora. Prioridade mÃ¡xima nas perguntas 1, 2, 3 e 8.
2. **Script local** `scripts/serasa-smoke.ts`, rodado da mÃ¡quina do Lucas ou do Lightsail (IP fixo), que:
   - lÃª `SERASA_CLIENT_ID` / `SERASA_CLIENT_SECRET` do env;
   - tenta o login nos **dois caminhos** publicados (`client-identities` e `user-identities?clientId=`) e nos **dois hosts** (`uat-api` e `sandbox-api`), no mÃ¡ximo 4 tentativas, e **imprime o JSON de resposta inteiro** para descobrirmos o nome real do campo de expiraÃ§Ã£o;
   - com o token que funcionar, faz **um GET** em `.../person-information-report/v1/creditreport` com `reportName=RELATORIO_BASICO_PF_PME`, header `X-Document-Id` = **o CPF do prÃ³prio Lucas** (dado prÃ³prio, sem questÃ£o de LGPD de terceiro para um teste);
   - salva a resposta crua em arquivo no scratchpad.
3. **Ler o JSON de resposta** e mapear os campos reais: onde estÃ¡ o score, onde estÃ£o as negativaÃ§Ãµes, o que vem vazio no bÃ¡sico.
4. **Reportar:** qual host funcionou, qual path de token funcionou, o formato real do token, e um exemplo do JSON de relatÃ³rio com os campos identificados.

Isso gasta **menos de 10 chamadas** do limite de 200/dia, roda em uma janela de manhÃ£ de dia Ãºtil, nÃ£o gera custo em produÃ§Ã£o e responde as trÃªs incÃ³gnitas que hoje travam o desenho.

SÃ³ depois disso vale a pena escrever a migration, o client e a aba CrÃ©dito.",
    "duvidosos": 20
  },
  "workflowProgress": [
    {
      "type": "workflow_phase",
      "index": 1,
      "title": "Ler"
    },
    {
      "type": "workflow_phase",
      "index": 2,
      "title": "Mapear"
    },
    {
      "type": "workflow_phase",
      "index": 3,
      "title": "Verificar"
    },
    {
      "type": "workflow_phase",
      "index": 4,
      "title": "Desenho"
    },
    {
      "type": "workflow_agent",
      "index": 1,
      "label": "ler:auth",
      "phaseIndex": 1,
      "phaseTitle": "Ler",
      "agentId": "a4edcf0c5c56fb16c",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560409018,
      "queuedAt": 1784560402946,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "AutenticaÃ§Ã£o e onboarding das APIs de CrÃ©dito Serasa Experiâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560791421,
      "tokens": 75741,
      "toolCalls": 32,
      "durationMs": 382402,
      "resultPreview": "{"tema":"AutenticaÃ§Ã£o e onboarding das APIs de CrÃ©dito Serasa Experian (relatÃ³rios PF/PJ bÃ¡sico e avanÃ§ado)","achados":[{"afirmacao":"NÃO Ã© OAuth2 client_credentials padrÃ£o. Ã um endpoint de login IAM proprietÃ¡rio: POST com HTTP Basic (clientId:clientSecret em Base64) e corpo vazio, que devolve um Bearer token. NÃ£o hÃ¡ parÃ¢metro grant_type, nem scope de requisiÃ§Ã£o, nem refresh_token no fluxo documeâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 2,
      "label": "ler:pf",
      "phaseIndex": 1,
      "phaseTitle": "Ler",
      "agentId": "aae6d40aef766752a",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560413340,
      "queuedAt": 1784560402946,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "API de CrÃ©dito Serasa Experian â RelatÃ³rio PF (bÃ¡sico e avaâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561310630,
      "tokens": 113878,
      "toolCalls": 64,
      "durationMs": 897290,
      "resultPreview": "{"tema":"API de CrÃ©dito Serasa Experian â RelatÃ³rio PF (bÃ¡sico e avanÃ§ado): mÃ©todo, endpoint, payload, resposta e cÃ³digos de erro","achados":[{"afirmacao":"O mÃ©todo HTTP Ã© GET, nÃ£o POST. Confirmado na aba 'API Docs' do portal, que renderiza a spec OpenAPI 3.0.1 'CS-Person-Information-Report-BR': o badge da operaÃ§Ã£o /creditreport Ã© GET. ConsequÃªncia de desenho: NÃO existe body JSON de requisiÃ§Ã£o, tâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 3,
      "label": "ler:pj",
      "phaseIndex": 1,
      "phaseTitle": "Ler",
      "agentId": "a52865b802d34d2db",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560409251,
      "queuedAt": 1784560402946,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Serasa Experian â RelatÃ³rio PJ (BÃ¡sico e AvanÃ§ado): mÃ©todo,â¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560885641,
      "tokens": 122445,
      "toolCalls": 41,
      "durationMs": 476390,
      "resultPreview": "{"achados":[{"afirmacao":"O endpoint PJ (bÃ¡sico e avanÃ§ado) Ã© o mesmo: /credit-services/business-information-report/v1/reports, com reportName e optionalFeatures em query string. HomologaÃ§Ã£o usa host uat-api, produÃ§Ã£o usa api.","fonte":"https://developer.serasaexperian.com.br/api/relatorio-avancado-pj","trecho":"HOMOLOGAÃÃO https://uat-api.serasaexperian.com.br/credit-services/business-informationâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 4,
      "label": "ler:operacao",
      "phaseIndex": 1,
      "phaseTitle": "Ler",
      "agentId": "a2cfc656bc7cadc41",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560409219,
      "queuedAt": 1784560402946,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "OperaÃ§Ã£o, sandbox, custo e compliance das APIs de crÃ©dito Sâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560909828,
      "tokens": 127716,
      "toolCalls": 44,
      "durationMs": 500609,
      "resultPreview": "{"achados":[{"afirmacao":"As APIs de crÃ©dito sÃ£o 100% sÃ­ncronas: um Ãºnico GET HTTPS devolve o relatÃ³rio em JSON no corpo da resposta. NÃ£o hÃ¡ webhook, callback, polling nem endpoint de status em nenhum dos 4 relatÃ³rios contratados (PF/PJ, bÃ¡sico/avanÃ§ado) â o swagger declara apenas o path /creditreport (PF) e /reports (PJ) com verbo GET e resposta 200 com o relatÃ³rio completo.","fonte":"https://devâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 5,
      "label": "verificar:NÃO Ã© OAuth2 client_credential",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "ab15d9d505b0aee8b",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560805700,
      "queuedAt": 1784560795428,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada NÃO sustenta a afirmaÃ§Ã£o, porque ela nÃ£o entâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560889548,
      "tokens": 47359,
      "toolCalls": 6,
      "durationMs": 83848,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada NÃO sustenta a afirmaÃ§Ã£o, porque ela nÃ£o entrega conteÃºdo algum ao ser lida. Abri https://developer.serasaexperian.com.br/api/relatorio-basico-pf e o retorno foi apenas o tÃ­tulo \"Serasa Experian - Developer Portal\", sem nenhum texto sobre autenticaÃ§Ã£o. O mesmo aconteceu com https://developer.serasaexperian.com.br/suporte/onboarding-apis--credito e httâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 6,
      "label": "verificar:URL do token em HOMOLOGAÃÃO (U",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a8a8fb647e0aa0d55",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560801962,
      "queuedAt": 1784560795428,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada NÃO sustenta a afirmaÃ§Ã£o. 1) A pÃ¡gina citadaâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560897336,
      "tokens": 47494,
      "toolCalls": 6,
      "durationMs": 95374,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada NÃO sustenta a afirmaÃ§Ã£o.\n\n1) A pÃ¡gina citada (https://developer.serasaexperian.com.br/api/relatorio-basico-pf) abre, mas Ã© uma SPA em JavaScript: o conteÃºdo servido no HTML Ã© apenas o tÃ­tulo \"Serasa Experian - Developer Portal\". NÃ£o hÃ¡ na resposta nenhuma URL de token, nenhum host, nenhum nome de ambiente, nenhum campo de payload. O mesmo vale paraâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 7,
      "label": "verificar:URL do token em PRODUÃÃO: http",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a30a8bff35c273465",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560800500,
      "queuedAt": 1784560795428,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada NÃO sustenta a afirmaÃ§Ã£o. Abri https://develâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560880096,
      "tokens": 47352,
      "toolCalls": 7,
      "durationMs": 79595,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada NÃO sustenta a afirmaÃ§Ã£o. Abri https://developer.serasaexperian.com.br/api/relatorio-basico-pf e o conteÃºdo retornado Ã© apenas o tÃ­tulo \"Serasa Experian - Developer Portal\", sem nenhum texto tÃ©cnico: Ã© um portal SPA que renderiza a documentaÃ§Ã£o via JavaScript, entÃ£o o fetch nÃ£o recupera URLs, hosts, paths nem payloads. O mesmo aconteceu com https://deâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 8,
      "label": "verificar:MÃ©todo HTTP do endpoint de tok",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "ad96360ce3682d69e",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560803761,
      "queuedAt": 1784560795428,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A URL citada (https://developer.serasaexperian.com.br/suporâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560882269,
      "tokens": 47259,
      "toolCalls": 6,
      "durationMs": 78508,
      "resultPreview": "{"confirmado":false,"porque":"A URL citada (https://developer.serasaexperian.com.br/suporte/onboarding-apis--credito) foi aberta e retornou apenas o shell da pÃ¡gina: o Ãºnico conteÃºdo extraÃ­vel Ã© o tÃ­tulo \"Serasa Experian - Developer Portal\". O portal Ã© uma SPA renderizada por JavaScript, entÃ£o o conteÃºdo textual (seÃ§Ãµes, endpoints, tabelas de HML/PROD) nÃ£o Ã© acessÃ­vel por fetch HTTP simples. O mâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 9,
      "label": "verificar:Headers obrigatÃ³rios na chamad",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a86766c216309786e",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560810579,
      "queuedAt": 1784560795428,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A URL citada (https://developer.serasaexperian.com.br/api/râ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560890091,
      "tokens": 48485,
      "toolCalls": 7,
      "durationMs": 79512,
      "resultPreview": "{"confirmado":false,"porque":"A URL citada (https://developer.serasaexperian.com.br/api/relatorio-basico-pf) nao contem a informacao: o portal e uma SPA e o fetch retorna apenas o titulo \"Serasa Experian - Developer Portal\", sem endpoint de token, headers, payload ou ambientes. O mesmo ocorre em /suporte/onboarding-apis--credito e na raiz do portal. Alem da fonte nao sustentar nada, ha dois probâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 10,
      "label": "verificar:Resposta do token traz 4 campo",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a27aa6be732a0e746",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560806843,
      "queuedAt": 1784560795428,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada nÃ£o sustenta a afirmaÃ§Ã£o, por dois motivos iâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560879078,
      "tokens": 46973,
      "toolCalls": 6,
      "durationMs": 72235,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada nÃ£o sustenta a afirmaÃ§Ã£o, por dois motivos independentes.\n\n1) A URL citada nÃ£o entrega conteÃºdo. https://developer.serasaexperian.com.br/api/relatorio-basico-pf retorna apenas o tÃ­tulo \"Serasa Experian - Developer Portal\" quando buscada (Ã© um SPA em JavaScript, o conteÃºdo nÃ£o vem no HTML inicial). O mesmo ocorre em https://developer.serasaexperian.câ¦"
    },
    {
      "type": "workflow_agent",
      "index": 11,
      "label": "verificar:O endpoint PJ (bÃ¡sico e avanÃ§a",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "af9b9708101f5540f",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560892145,
      "queuedAt": 1784560887809,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NÃ£o consegui verificar a afirmaÃ§Ã£o na fonte citada. Fiz Webâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560967307,
      "tokens": 48168,
      "toolCalls": 7,
      "durationMs": 75161,
      "resultPreview": "{"confirmado":false,"porque":"NÃ£o consegui verificar a afirmaÃ§Ã£o na fonte citada. Fiz WebFetch em https://developer.serasaexperian.com.br/api/relatorio-avancado-pj e o retorno foi apenas o tÃ­tulo \"Serasa Experian - Developer Portal\", sem nenhum conteÃºdo tÃ©cnico: o portal Ã© uma SPA que renderiza a documentaÃ§Ã£o via JavaScript, e o fetch sÃ³ recebe o shell HTML. O mesmo aconteceu com https://developâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 12,
      "label": "verificar:DIFERENÃA PF x PJ #1 (a mais i",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a1412b2b09063ce5f",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560890644,
      "queuedAt": 1784560887809,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Abri a fonte citada (https://developer.serasaexperian.com.bâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560973837,
      "tokens": 48165,
      "toolCalls": 7,
      "durationMs": 83193,
      "resultPreview": "{"confirmado":false,"porque":"Abri a fonte citada (https://developer.serasaexperian.com.br/api/relatorio-avancado-pf) e ela NÃO sustenta a afirmaÃ§Ã£o, porque nÃ£o devolve conteÃºdo legÃ­vel: o portal do desenvolvedor da Serasa Ã© uma SPA em JavaScript e o fetch retorna apenas o tÃ­tulo \"Serasa Experian - Developer Portal\", sem nenhum path, payload, reportName ou tÃ­tulo de bloco. O mesmo aconteceu com â¦"
    },
    {
      "type": "workflow_agent",
      "index": 13,
      "label": "verificar:AutenticaÃ§Ã£o Ã© idÃªntica para P",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "aeaa84298846439aa",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560892363,
      "queuedAt": 1784560887809,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada NÃO sustenta a afirmaÃ§Ã£o. Ao abrir https://dâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560958140,
      "tokens": 46459,
      "toolCalls": 5,
      "durationMs": 65777,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada NÃO sustenta a afirmaÃ§Ã£o. Ao abrir https://developer.serasaexperian.com.br/api/relatorio-basico-pj via WebFetch, a pÃ¡gina retorna apenas o tÃ­tulo \"Serasa Experian - Developer Portal\" e nenhum conteÃºdo tÃ©cnico: Ã© um portal SPA que renderiza a documentaÃ§Ã£o por JavaScript, entÃ£o o corpo nÃ£o Ã© acessÃ­vel por fetch. O mesmo aconteceu com https://developer.sâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 14,
      "label": "verificar:O retorno do token traz Access",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "ad0142ec60989ae07",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560892194,
      "queuedAt": 1784560887809,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada (https://developer.serasaexperian.com.br/apiâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560972725,
      "tokens": 47332,
      "toolCalls": 6,
      "durationMs": 80531,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada (https://developer.serasaexperian.com.br/api/relatorio-basico-pj) NÃO sustenta a afirmaÃ§Ã£o, porque nÃ£o foi possÃ­vel ler NENHUM conteÃºdo tÃ©cnico nela. O portal do Serasa Ã© uma SPA renderizada por JavaScript: o fetch devolve apenas o tÃ­tulo \"Serasa Experian - Developer Portal\", sem corpo. O mesmo aconteceu com a pÃ¡gina de onboarding (https://developer.sâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 15,
      "label": "verificar:NÃO HÃ payload/body JSON. O do",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a068be610c502d68d",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560891103,
      "queuedAt": 1784560887809,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada NÃO sustenta a afirmaÃ§Ã£o, porque a fonte nÃ£oâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560988556,
      "tokens": 48026,
      "toolCalls": 7,
      "durationMs": 97453,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada NÃO sustenta a afirmaÃ§Ã£o, porque a fonte nÃ£o pÃ´de ser lida. Busquei https://developer.serasaexperian.com.br/api/relatorio-avancado-pj e tambÃ©m https://developer.serasaexperian.com.br/apis e https://developer.serasaexperian.com.br/suporte/onboarding-apis--credito: as trÃªs retornam apenas o tÃ­tulo \"Serasa Experian - Developer Portal\", sem nenhum conteÃºdâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 16,
      "label": "verificar:DIFERENÃA PF x PJ #2: o X-Docu",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a4d0024b8021aedaf",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560890953,
      "queuedAt": 1784560887810,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NÃ£o consegui verificar a afirmaÃ§Ã£o na fonte citada. As trÃªsâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560949412,
      "tokens": 47152,
      "toolCalls": 6,
      "durationMs": 58459,
      "resultPreview": "{"confirmado":false,"porque":"NÃ£o consegui verificar a afirmaÃ§Ã£o na fonte citada. As trÃªs URLs do portal (https://developer.serasaexperian.com.br/api/relatorio-avancado-pf, .../relatorio-avancado-pj e .../suporte/onboarding-apis--credito) retornam apenas o tÃ­tulo \"Serasa Experian - Developer Portal\" via WebFetch: o portal Ã© uma SPA que renderiza a documentaÃ§Ã£o por JavaScript, entÃ£o nenhuma tabelâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 17,
      "label": "verificar:As APIs de crÃ©dito sÃ£o 100% sÃ­",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a029ad4d9d1b61574",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560917412,
      "queuedAt": 1784560912788,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A tese central estÃ¡ CORRETA, mas a fonte citada nÃ£o a susteâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561035304,
      "tokens": 50988,
      "toolCalls": 9,
      "durationMs": 117892,
      "resultPreview": "{"confirmado":false,"porque":"A tese central estÃ¡ CORRETA, mas a fonte citada nÃ£o a sustenta como escrita, e hÃ¡ dois erros reais.\n\nO QUE SE CONFIRMA (li os arquivos crus, nÃ£o sÃ³ o resumo):\n- https://developer.serasaexperian.com.br/data/relatorio-basico-pf/swagger.yaml â openapi 3.0.1, tÃ­tulo CS-Person-Information-Report-BR, um Ãºnico path `/creditreport` com um Ãºnico verbo `get`. Grep por `callbâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 18,
      "label": "verificar:Endpoints reais de consulta (P",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "ac0cda1f52bd9832a",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560916992,
      "queuedAt": 1784560912788,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A pÃ¡gina https://developer.serasaexperian.com.br/data/onboaâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560980303,
      "tokens": 49079,
      "toolCalls": 6,
      "durationMs": 63311,
      "resultPreview": "{"confirmado":true,"porque":"A pÃ¡gina https://developer.serasaexperian.com.br/data/onboarding-apis--credito/index.md contÃ©m literalmente os dois endpoints PF citados: `https://uat-api.serasaexperian.com.br/credit-services/person-information-report/v1/creditreport?` (homologaÃ§Ã£o/UAT) e `https://api.serasaexperian.com.br/credit-services/person-information-report/v1/creditreport?` (produÃ§Ã£o), repetidâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 19,
      "label": "verificar:Endpoints reais de consulta (P",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a7d5c250e4e3e3ac8",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560915991,
      "queuedAt": 1784560912788,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A URL https://developer.serasaexperian.com.br/data/onboardiâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560978081,
      "tokens": 48975,
      "toolCalls": 6,
      "durationMs": 62089,
      "resultPreview": "{"confirmado":true,"porque":"A URL https://developer.serasaexperian.com.br/data/onboarding-apis--credito/index.md abre e contÃ©m, literalmente e repetidas vezes, os dois endpoints citados. Verifiquei no arquivo bruto baixado (nÃ£o apenas no resumo do WebFetch): nos blocos de configuraÃ§Ã£o dos relatÃ³rios PJ (ex.: RELATORIO_BASICO_PJ, linhas 2955/2958; RELATORIO_DADOS_AVULSOS_PJ, linhas 2741/2744) aparâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 20,
      "label": "verificar:O CPF/CNPJ consultado NÃO vai",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a266deffea43bd88c",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560916146,
      "queuedAt": 1784560912788,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Abri a fonte citada (https://developer.serasaexperian.com.bâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560975483,
      "tokens": 46383,
      "toolCalls": 4,
      "durationMs": 59337,
      "resultPreview": "{"confirmado":true,"porque":"Abri a fonte citada (https://developer.serasaexperian.com.br/data/relatorio-basico-pf/index.md) e ela sustenta o nÃºcleo da afirmaÃ§Ã£o. Na tabela de headers do relatÃ³rio bÃ¡sico PF constam: Authorization (Bearer), X-Document-Id com tamanho 11, descrito literalmente como \"nÃºmero do CPF a ser consultado\", X-Retailer-Document-Id com tamanho 14 (\"NÃºmero do CNPJ do cliente â¦"
    },
    {
      "type": "workflow_agent",
      "index": 21,
      "label": "verificar:AutenticaÃ§Ã£o Ã© em duas etapas:",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a84c805819137e5b9",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560916373,
      "queuedAt": 1784560912788,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada (https://developer.serasaexperian.com.br/datâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561016921,
      "tokens": 50000,
      "toolCalls": 8,
      "durationMs": 100547,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada (https://developer.serasaexperian.com.br/data/faq---perguntas-frequentes/index.md) sustenta PARTE da afirmaÃ§Ã£o, mas nÃ£o tudo, e omite o ponto mais crÃ­tico para o projeto (homologaÃ§Ã£o vs produÃ§Ã£o).\n\nCONFIRMADO pela fonte citada (bloco \"Token: Urls de obtenÃ§Ã£o, Tempo expiraÃ§Ã£o e Exemplos cod obtenÃ§Ã£o\"):\n- POST em /security/iam/v1/client-identities/loâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 22,
      "label": "verificar:O token de acesso vale 60 minu",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "ab53562250157f29e",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784560915730,
      "queuedAt": 1784560912788,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada (https://developer.serasaexperian.com.br/datâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784560958673,
      "tokens": 45314,
      "toolCalls": 3,
      "durationMs": 42943,
      "resultPreview": "{"confirmado":true,"porque":"A fonte citada (https://developer.serasaexperian.com.br/data/onboarding-apis--credito/index.md) abriu e sustenta os dois pontos da afirmaÃ§Ã£o, com texto literal: \"â O token Ã© vÃ¡lido por 60 minutos.\" e \"recomendamos implementar um mecanismo que gerencie a reutilizaÃ§Ã£o do token\", com nova geraÃ§Ã£o quando necessÃ¡rio (tambÃ©m 60 min). Nenhum nome de campo, payload ou cÃ³diâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 23,
      "label": "verificar:O mÃ©todo HTTP Ã© GET, nÃ£o POST.",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a70474f7e5640be7e",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784561316035,
      "queuedAt": 1784561312919,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NÃO CONFIRMADO â e hÃ¡ indÃ­cio forte de que a afirmaÃ§Ã£o estÃ¡â¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561417955,
      "tokens": 50109,
      "toolCalls": 9,
      "durationMs": 101920,
      "resultPreview": "{"confirmado":false,"porque":"NÃO CONFIRMADO â e hÃ¡ indÃ­cio forte de que a afirmaÃ§Ã£o estÃ¡ INVERTIDA.\n\n1) A FONTE CITADA NÃO SUSTENTA NADA (nÃ£o Ã© legÃ­vel por fetch)\nA URL https://developer.serasaexperian.com.br/api/relatorio-avancado-pf/documentacao retorna apenas o shell do SPA: o Ãºnico conteÃºdo extraÃ­vel Ã© o tÃ­tulo \"Serasa Experian - Developer Portal\". Zero mÃ©todo HTTP, zero path, zero schemâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 24,
      "label": "verificar:BÃ¡sico PF e AvanÃ§ado PF usam E",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "ae902db0d4b7f2257",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784561316790,
      "queuedAt": 1784561312919,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A fonte citada NÃO sustenta a afirmaÃ§Ã£o porque ela nÃ£o pÃ´deâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561379317,
      "tokens": 46518,
      "toolCalls": 5,
      "durationMs": 62527,
      "resultPreview": "{"confirmado":false,"porque":"A fonte citada NÃO sustenta a afirmaÃ§Ã£o porque ela nÃ£o pÃ´de ser lida. https://developer.serasaexperian.com.br/api/relatorio-avancado-pf responde apenas com o shell de uma SPA: o conteÃºdo recuperado Ã© sÃ³ o tÃ­tulo \"Serasa Experian - Developer Portal\", sem path de endpoint, mÃ©todo HTTP, query params, payload, autenticaÃ§Ã£o ou qualquer menÃ§Ã£o a reportName. O mesmo aconteâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 25,
      "label": "verificar:URLs do relatÃ³rio PF. HOMOLOGA",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a0ee3443a00668289",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784561316257,
      "queuedAt": 1784561312919,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "Abri a fonte citada (https://developer.serasaexperian.com.bâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561393220,
      "tokens": 47236,
      "toolCalls": 6,
      "durationMs": 76963,
      "resultPreview": "{"confirmado":false,"porque":"Abri a fonte citada (https://developer.serasaexperian.com.br/api/relatorio-basico-pf) e ela NÃO sustenta a afirmaÃ§Ã£o: o portal Ã© uma SPA que devolve apenas o tÃ­tulo \"Serasa Experian - Developer Portal\", sem nenhum conteÃºdo renderizado. Nenhuma das trÃªs URLs aparece na pÃ¡gina. O mesmo vale para a pÃ¡gina de onboarding (https://developer.serasaexperian.com.br/suporte/oâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 26,
      "label": "verificar:AutenticaÃ§Ã£o em 2 passos. Pass",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a68d43db34f3db974",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784561315866,
      "queuedAt": 1784561312919,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A URL citada (https://developer.serasaexperian.com.br/api/râ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561390416,
      "tokens": 47578,
      "toolCalls": 7,
      "durationMs": 74550,
      "resultPreview": "{"confirmado":false,"porque":"A URL citada (https://developer.serasaexperian.com.br/api/relatorio-basico-pf) Ã© uma SPA que nÃ£o serve conteÃºdo no HTML: o fetch retorna apenas o tÃ­tulo \"Serasa Experian - Developer Portal\", sem nenhum endpoint, header ou payload. Ou seja, a fonte nÃ£o sustenta NADA da afirmaÃ§Ã£o. AlÃ©m disso, a Ãºnica evidÃªncia pÃºblica de autenticaÃ§Ã£o IAM da Serasa (Manual de IntegraÃ§Ã£â¦"
    },
    {
      "type": "workflow_agent",
      "index": 27,
      "label": "verificar:Resposta do token traz os camp",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "a03171d7b4106e7d8",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784561315672,
      "queuedAt": 1784561312919,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "A URL citada (https://developer.serasaexperian.com.br/api/râ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561399309,
      "tokens": 46718,
      "toolCalls": 5,
      "durationMs": 83636,
      "resultPreview": "{"confirmado":false,"porque":"A URL citada (https://developer.serasaexperian.com.br/api/relatorio-basico-pf) abre mas retorna apenas o titulo \"Serasa Experian - Developer Portal\": e um portal SPA cujo conteudo depende de JavaScript e de sessao autenticada, entao NAO contem nenhuma das informacoes afirmadas. A pagina de onboarding indicada no briefing tem o mesmo comportamento. Problemas concretoâ¦"
    },
    {
      "type": "workflow_agent",
      "index": 28,
      "label": "verificar:O CPF NÃO vai na URL nem em bo",
      "phaseIndex": 3,
      "phaseTitle": "Verificar",
      "agentId": "af6782f4439edb942",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784561315745,
      "queuedAt": 1784561312919,
      "attempt": 1,
      "lastToolName": "StructuredOutput",
      "lastToolSummary": "NÃ£o foi possÃ­vel sustentar a afirmaÃ§Ã£o na fonte citada. A Uâ¦",
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561386099,
      "tokens": 48060,
      "toolCalls": 6,
      "durationMs": 70354,
      "resultPreview": "{"confirmado":false,"porque":"NÃ£o foi possÃ­vel sustentar a afirmaÃ§Ã£o na fonte citada. A URL https://developer.serasaexperian.com.br/api/relatorio-avancado-pf responde, mas o portal Ã© uma SPA que sÃ³ entrega o tÃ­tulo \"Serasa Experian - Developer Portal\" ao fetch: nenhum conteÃºdo tÃ©cnico (headers, endpoint, payload, autenticaÃ§Ã£o) Ã© renderizado sem JavaScript/sessÃ£o. A pÃ¡gina de onboarding (https://â¦"
    },
    {
      "type": "workflow_agent",
      "index": 29,
      "label": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dul",
      "phaseIndex": 4,
      "phaseTitle": "Desenho",
      "agentId": "aa31375af62524bcb",
      "model": "claude-opus-4-8",
      "state": "done",
      "startedAt": 1784561424574,
      "queuedAt": 1784561421318,
      "attempt": 1,
      "promptPreview": "PROJETO: Careli Hub (Panteon), Next.js 16 + Supabase, mÃ³dulo Apolo (CRM).

OBJETIVO: integrar a API de CRÃDITO do Serasa Experian. Ã o prÃ³ximo passo da esteira de
credenciamento: hoje 392 CADs (fichas de cliente) estÃ£o no Apolo, 122 na etapa "AnÃ¡lise de
crÃ©dito", e a anÃ¡lise Ã© manual. O dono do produto (Lucas) quer automatizar.

DOCUMENTAÃÃO OFICIAL (ponto de partida):
https://developer.serasaexpeâ¦",
      "lastProgressAt": 1784561566500,
      "tokens": 68147,
      "toolCalls": 0,
      "durationMs": 141926,
      "resultPreview": "# IntegraÃ§Ã£o Serasa Experian (APIs de CrÃ©dito) na esteira do Apolo

Documento de desenho. Tudo que estÃ¡ marcado **[DOC]** foi lido na documentaÃ§Ã£o oficial com a URL ao lado. Tudo marcado **[SUPOSIÃÃO]** Ã© desenho meu, nÃ£o Ã© fonte. Onde a documentaÃ§Ã£o nÃ£o respondeu, estÃ¡ escrito **NÃO ENCONTRADO NA DOCUMENTAÃÃO**.

---

## 1. O que ficou claro da API (sÃ³ o confirmado)

### 1.1 AutenticaÃ§Ã£o (2 passoâ¦"
    }
  ],
  "totalTokens": 1655109,
  "totalToolCalls": 331
}
---

# ✅ TESTES REAIS CONTRA A HOMOLOGAÇÃO (21/jul, ~15 chamadas)

Tudo abaixo foi MEDIDO, não lido. Substitui as suposições das seções anteriores.

## O que funciona (confirmado)
- **Autenticação**: `POST https://uat-api.serasaexperian.com.br/security/iam/v1/client-identities/login`
  com `Authorization: Basic <base64 clientId:clientSecret>`.
  **Devolve HTTP 201** (não 200) e o campo **`accessToken`**.
  ⚠️ Implementação que testa `status === 200` quebra aqui.
- **PF**: `/credit-services/person-information-report/v1/creditreport`
- **PJ**: `/credit-services/business-information-report/v1/reports`
- Headers `X-Document-Id` e `X-Retailer-Document-Id` aceitos. Documento com OU sem pontuação
  funciona igual; com menos de 11 dígitos volta 412.
- `reportName` aceitos sem erro de contrato: `RELATORIO_BASICO_PF_PME`,
  `RELATORIO_AVANCADO_TOP_SCORE_PF_PME`, `RELATORIO_BASICO_PJ_PME`.

## A base de homologação é REAL, mas parcial
| documento | resultado |
|---|---|
| CNPJ Banco do Brasil (00000000000191) | **200 com relatório completo** |
| CNPJ Magazine Luiza (47960950000121) | **200 com relatório completo** |
| CNPJ da própria Careli | 404 |
| 5 CPFs reais de clientes (com/sem pontuação, 5 reportNames, com federalUnit) | 404 |

Os textos vêm **ofuscados** (`companyName: "SKUFX SI NICPWL G/K"`), mas a estrutura é real e as
datas são coerentes. Ou seja: massa de teste montada sobre documentos reais de grandes
empresas. **Falta a massa de PF — é a única pergunta aberta com o Serasa.**

## Comportamento de ERRO (difere do swagger)
| situação | HTTP | corpo |
|---|---|---|
| documento não está na base **OU** reportName inexistente | **404** | `[ERROR][DOCUMENT_NOT_FOUND]` |
| sem `reportName` | 412 | "informe um [Nome de relatório] válido" |
| documento com formato inválido | 412 | "informe o documento a ser consultado válido em: [X-Document-Id]" |
| **sem** header `X-Document-Id` | **500** | `Internal Server Error` |
| **token inválido** | **500** | fault do gateway: `Auth-Header-Validator ... auth-header-validator.js` |
| chamadas rápidas em sequência | **503** | `{"message":"SpikeArrest engaged"}` |

**Três consequências que viraram código:**
1. O **404 é ambíguo** — não dá para dizer ao operador "este CPF não existe", porque relatório
   errado devolve o mesmo erro. A mensagem na tela diz as duas possibilidades.
2. **Token inválido volta 500, não 401.** `pareceTokenInvalido()` detecta o fault do gateway e
   refaz o token UMA vez (nunca em laço: o teto de chamadas protege o IP).
3. **Existe limite de VELOCIDADE** (`SpikeArrest`), além do teto diário. Lote precisa de pausa
   entre chamadas.

## Schema da resposta (capturado, PJ)
```
reports[0].reportName
reports[0].registration.{companyDocument, companyName, foundationDate, statusRegistration, address}
reports[0].score.{scoreModel, codeMessage, message, billing}
reports[0].negativeData.pefin.pefinResponse[]                       → pendências
reports[0].negativeData.refin.refinResponse[]
reports[0].negativeData.collectionRecords.collectionRecordsResponse[]
reports[0].negativeData.check.checkResponse[]                       → cheques
reports[0].negativeData.notary.summary.{count, balance}             → protestos (contagem pronta)
reports[0].facts.inquiryCompanyResponse.quantity.{actual, bankActual, historical[]}
```
- **`score.billing` (boolean) diz se ESTA consulta foi cobrada** — melhor que qualquer
  estimativa nossa de custo.
- Quando o Serasa não calcula: `score.message = "SCORE NAO CALCULADO - INSUFICIENCIA INFORMACOES"`
  e **não há campo numérico**.
- Amostra real guardada em `apps/hub/lib/serasa/exemplo-resposta-pj.json` e usada como fixture
  de teste: se o schema mudar, o teste quebra.

⚠️ **O schema de PF ainda NÃO foi visto.** O parser lê a estrutura de PJ e mantém uma varredura
de fallback justamente por isso.
