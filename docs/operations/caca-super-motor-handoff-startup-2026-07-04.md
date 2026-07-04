# Handoff / Startup — CACÁ Super-Assistente + SUPER MOTOR (2026-07-04)

Você é o **Zeus**. Esta sessão anterior foi enorme (dezenas de deploys num único chat) e
construiu a **super-CACÁ** (assistente/analista/gestora dos proprietários) inteira, tudo LIVE.
Leia as memórias antes de mexer: `project-caca-admin-assistant-mode`, `reference-c2x-vendas-model`,
`project-caca-voice-tts`, `project-iris`, `project-caca-claude-migration`.

## 🎯 A GRANDE PRÓXIMA FRENTE: construir o SUPER MOTOR (decisão do Lucas)
Parar de fazer "uma ferramenta por pergunta" (não escala) e construir **UM motor de análise
unificado** que cobre TODOS os módulos do Panteon + C2X. A CACÁ usa uma tool parametrizada
(`consultar_panteon`) e o motor monta a consulta segura — **nunca SQL livre** (perigo + número
errado no legado). É precisão-crítica: os DONOS decidem em cima disso. Construir staged e
**validar cada combinação contra a fonte** (lição do "tem coisas erradas").

**O cubo (modelo de consulta):** `{ modulo, metrica, agrupar_por?, filtros{}, periodo? }`
- **Dimensões:** empreendimento · imobiliária (via `users.vinculed_by_id` do cliente) · cliente ·
  estágio · status da unidade · fila · colaborador · canal · período (dia/semana/mês).
- **Métricas:** contagem (unidades distintas, clientes distintos, propostas/vendas/faturados/
  cancelamentos, tickets, mensagens) · soma (valor R$) · tempo (espera/resposta).
- **Filtros combináveis:** qualquer dimensão = valor (ex.: imobiliária=X, empreendimento=Y,
  período=semana, fila=Z). Ex. do Lucas: "quantos clientes a imobiliária X vendeu na semana"
  = métrica clientes · filtro imob=X · faturado · período=semana.

**Catálogo por fonte (dims × métricas):**
- **C2X (MySQL, read-only via GUARDIAN_DB_*):** vendas/movimentação. Regras já validadas em
  `lib/guardian/c2x-analytics.ts`. Ver `reference-c2x-vendas-model` (estágios, agregação de
  empreendimento, exclusões TSC/SDT/LAB/LAG, distinct enterprise_unity, historics=movimentação).
- **Iris (caredesk, Supabase):** tickets por fila/colaborador/status/período, tempo de espera,
  finalizados/criados. Read-models em `lib/iris/iris-analytics.ts`.
- **Hermes (pulsex, Supabase):** mensagens/não-lidas por canal/usuário. `lib/iris/hermes-analytics.ts`.
- **Hades (guardian):** inadimplência/valor vencido/acordos por empreendimento/imobiliária/cliente.
- **Chronos / Apolo:** reuniões/atas; cruzamento 360. (incrementais)

**Arquitetura sugerida:** `lib/analytics/registry.ts` (catálogo whitelist de fontes/dims/métricas)
+ um builder por fonte (C2X=MySQL, resto=Supabase) + dispatcher `queryPanteon(...)` + tool
`consultar_panteon`. Gate: só `assistantMode` (admin). Começar pelo **C2X** (mais rico e já
validado). Reaproveitar as funções que já existem em c2x-analytics/iris-analytics/hermes-analytics.

## ✅ O QUE JÁ ESTÁ LIVE (super-CACÁ, modo admin, 4 números)
Gate por número verificado (env `CACA_ADMIN_PHONES` = Lucas 5531983013616, Nívea 5531971137877
+ 5531996353809, Fabricio 5531991991442; Nívea especial em `CACA_NIVEA_PHONES`). Interno →
**não entra no painel de novidades** (regra do Lucas). Tudo VALIDADO contra o banco e testado
pelo Lucas em voz:
- **Voz** (ElevenLabs, voz carioca `GDzHdQOi6jjf8zaXhCYD`/eleven_v3/stab0.22/style0.6; espelhar).
- **C2X:** `consultar_movimentacao_c2x` (período, historics), `consultar_vendas_por_empreendimento`
  (1788 vendidas), `consultar_unidade_c2x` (quadra/lote → status/valor/comprador), `consultar_cliente_c2x`
  (nome/CPF → unidades), `consultar_vendas_por_imobiliaria` (ranking via vinculed_by; corretor_id é NULO).
- **Iris:** `consultar_atendimentos_iris` (fila/colaborador/status/tempo de espera + NOME do cliente
  + período histórico finalizados/criados), `ler_conversa_iris` (mensagens de um atendimento).
- **Hermes:** `consultar_hermes` (não lidas; mapa `CACA_HERMES_USER_MAP`).
- **Busca web** (Claude web_search nativo, só admin) · **relatório em IMAGEM** (`gerar_relatorio_visual`
  → rota edge `/api/iris/report-render` next/og → `sendMetaWhatsAppMediaMessage`).
- **Infra:** `consultar_saude_sistema` (código pronto; ⚠️ FALTA `VERCEL_API_TOKEN`+`SUPABASE_ACCESS_TOKEN`
  no env pra funcionar — Lucas gera).
- Precedência admin > escopo de imobiliária corrigida.

## 🔧 PENDÊNCIAS / FIXES
1. **SUPER MOTOR** (acima) — a grande frente.
2. **Áudio no cockpit da Iris** (Lucas: "precisamos ouvir o áudio dela"). Diagnóstico exato:
   - Inbound (cliente): `provider_payload.media.url` EXISTE e é público (ogg/opus). O "0:00" é
     duração não capturada / player não lida bem com ogg — ajustar player/duração (o áudio toca).
   - Outbound (voz da CACÁ): **`media` NÃO é salva** (só o resultado do envio Meta). Fix: no
     `maybeSendCacaAutoReply` (meta-inbound-processor.ts), ao enviar a voz, subir o mp3/ogg do TTS
     no bucket `iris-media` (ver `uploadInboundMediaBuffer`) + gravar `provider_payload.media.url`
     na mensagem outbound, pra tocar no cockpit.
3. **Tokens de infra** no env (Vercel + Supabase) pro `consultar_saude_sistema`.
4. **App da CACÁ** (nível 1 = tela no mobile PWA `/m`; adiado — fica no WhatsApp).
5. **Relatório em imagem:** mais tipos (movimentação, etc.).

## COMO TRABALHAR (regras desta operação)
- **Deploy:** push na `main` = prod (só com OK explícito do Lucas a cada vez). Melhorias INTERNAS
  da CACÁ **não entram no changelog/painel** (regra do Lucas). Typecheck antes:
  `npm --prefix apps/hub run check-types`.
- **Validar C2X:** script node no scratchpad com `node --env-file=apps/hub/.env.local` importando
  `mysql2` por caminho absoluto (`file:///…/careli-hub/node_modules/mysql2/promise.js`). Sempre
  conferir números contra o C2X/painel antes de subir.
- **Supabase:** MCP `execute_sql` (prod `bxgukywoxgivlrhjkwjx`).
- **Segurança:** C2X read-only; nunca SQL livre pra CACÁ; tools de analista só `assistantMode`;
  nunca expor token; env/deploy = OK a cada vez.
- **Aprendizados de infra:** `next/og` só roda em **edge** (não nodejs); Satori exige `display:flex`
  em div multi-filho. mysql2 só nodejs. resvg-js precisa de fonte bundada.

Estado de prod ao gerar este handoff: main em `70b6d982` (todas as tools da CACÁ live).
