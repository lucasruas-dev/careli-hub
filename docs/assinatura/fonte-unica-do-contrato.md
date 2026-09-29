# Fonte única do contrato e da assinatura: plano de implementação

> 28/09/2026 · arquiteto (subagente do Zeus) · worktree `assinatura-fonte-unica`, branch `fix/assinatura-fonte-unica`.
> **Revisão 2 (28/09, tarde):** o plano v1 foi atacado por três críticos (integridade e concorrência;
> segurança, LGPD e custo; regressão e completude). Cada ataque foi conferido no código e no banco; o
> que procede entrou nas fatias, e o que não procede está na seção 10 com o porquê. A v1 está guardada
> no scratchpad da sessão (`fonte-unica-do-contrato.v1.md`).
> Base: o brief do Zeus, o mapa medido de 28/09, as decisões do Lucas de 28/09 (~11:20) e as medições
> da seção 0 (só SELECT em `bxgukywoxgivlrhjkwjx`, sem dado pessoal; o C2X não foi consultado, só o
> código que fala com ele). Nada foi aplicado, commitado nem publicado. Migration, deploy, cron novo,
> env e `--gravar` de script exigem OK do Lucas, a cada vez.

Lucas, 28/09/2026: *"já cansei de falar que informações de venda, contrato, assinatura tem que morar
em um local e ele alimentar tudo"*, *"a tela é do hercules"*, *"pode seguir, faz tudo morar no
Panteon"*. Decisão do mesmo dia (memória `project_assinatura_mora_no_panteon`): o C2X é lido só para
achar o documento da D4Sign; o status e quem assinou vêm da API da D4Sign; as telas leem só o Panteon;
o time pode continuar enviando pelo C2X.

**Decisões do Lucas sobre as perguntas da v1 (28/09, ~11:20):**
1. Links públicos (`/publico/assinaturas`, painel clássico que o alimenta, e `/publico/painel?aba=assinatura`):
   *"não precisa mais alimentar esses BI, o time está vendo tudo pelo portal"*. Saem do escopo: não
   migram para a fonte nova. Desligar os links é decisão separada, oferecida ao Lucas, fora desta entrega.
2. Venda nativa assinada pela D4Sign do C2X: *"Sim, anda sozinho"*. O card da Têmis anda (Análise →
   Em assinatura → Pré-faturamento, 7 dias) e a data de assinatura é gravada na venda.

---

## 0. O que foi medido, e o que isso corrige

| # | Medida (28/09, prod) | Consequência no plano |
|---|---|---|
| 0.1 | Nenhum `0195_*` existe em worktree nenhum (conferido de novo na revisão 2). `docs/apolo/pan-124-plano-do-cadastro.md` **reserva 0195 para a F5 do PAN-124**. | F0: quem for aplicado primeiro fica com 0195; o outro renumera o próprio arquivo. Este plano não corrige a sigla em `temis_envelopes.enterprise_id` (é do PAN-124). |
| 0.2 | O CHECK `temis_trabalho_etapas_origem_valida` em produção **não tem `conclusao`**: a 0177 não foi aplicada. | A 0195 redefine o CHECK com `conclusao` e `espelho_d4sign`. |
| 0.3 | 226 eventos da Clicksign (25 `sign`); 13 `signature_started` aplicados depois de um `sign` em 5 documentos (regressão parcial → aguardando). | Conserto na F1. |
| 0.4 | 0 de 226 payloads têm o signatário em `raiz.signer`/`event.signer`/`data.signer`; 55 têm em `event.data.signer`. `lerEventoDoWebhook` (`clicksign/webhook.ts:197`) não olha `event.data`. | Conserto na F1. |
| 0.5 | `document.events[]` do último payload: 25 `sign` em 10 documentos, 25 com e-mail, 25 com `key`, 25 com `occurred_at`; 25 de 25 casam com `temis_envelopes.signatarios`. Nenhum `close`/`auto_close`/`document_closed` chegou. 0 e-mails repetidos dentro de um mesmo quadro (26 de 26). | Backfill seguro. A chave de casamento passa a ser a `chave` (`signer.key`), não o e-mail (seção 10, B1 da integridade). |
| 0.6 | 0 duplicatas em `(provedor, provedor_documento_id)` e em `(provedor, envelope_id)`. | O índice único novo nasce sem conciliar nada. |
| 0.7 | `temis_assinatura_eventos` não tem índice por `provedor_documento_id`. **Existe `temis_envelopes_provedor_documento_idx` (não único, parcial)**, que o índice único novo torna redundante. | Índice novo nos eventos; a 0195 apaga o antigo dos envelopes. |
| 0.8 | `hercules_unidades.origem_c2x_id` único por workspace, 5.529 de 5.541 preenchidos. 710 linhas-sombra do pai (VLO 298, LAB 412). | A chave unidade C2X → Panteon é confiável. O **terreno** sai da MESMA união da régua (`situacao-da-unidade.ts:456-484`: pai + filho + glebas de mesma quadra e lote), não de `coalesce(espelho_de, id)`. |
| 0.9 | 12 propostas da carga vivas numa linha-sombra do pai com duplicata viva no filho (8 VLO, 4 LAB, `faturado`). 0 nativas em linha-sombra. | A leitura ignora só a proposta **da carga** pendurada no pai, a mesma regra da régua (`situacao-da-unidade.ts:573-581`); nativa no pai vale. |
| 0.10 | `hercules_propostas.data_assinatura` é **DATE**. | Grava-se o dia em Brasília, calculado com `Intl` e `timeZone: 'America/Sao_Paulo'`, nunca por `slice(0,10)`. |
| 0.11 | Nenhum gatilho em `temis_*`, `hercules_propostas`, `hercules_proposta_etapas`, `hercules_unidades`. Mover card e refletir na venda só escrevem no banco (sem WhatsApp, notificação ou fila `c2x_sync`). | Mover card pelo espelho não tem efeito fora do banco. |
| 0.12 | Das propostas vivas com contrato, 18 de 18 nativas e 395 de 2.464 da carga têm a passagem para `contrato`. | `geradoEm` da carga fica nulo na maioria (diferença aceita no "tempo médio"). |
| 0.13 | `lerFatosDoContrato` (`fatos-do-contrato-server.ts:56`) já lê `temis_envelopes.estado = 'assinado'` sem filtro de provedor nem de finalidade. | Um envelope de distrato assinado, ou um D4Sign ligado à venda errada, viraria "contrato assinado". Por isso a coluna `finalidade` e o casamento com o mesmo comprador (F1, F3). |
| 0.14 | `gravarTrocaNoRegistro` (`trocar-signatario.ts:700`) reescreve o jsonb inteiro, sem trava. | Pela RPC, com versão (F1). |
| 0.15 | Diário, troca e reenvio leem o envelope mais recente da proposta sem filtro de provedor (`diario-do-envelope-db.ts:206-225`, `trocar-signatario.ts:557` e `:640-647`, `assinatura-servico.ts:77`). | Filtro `provedor = 'clicksign'` em toda ação da Clicksign, pré-requisito da F3. |
| 0.16 | Os links públicos devolvem e-mail; `/publico/painel` aceita qualquer `?emp=` e só `/api` é protegido pelo proxy. | Fora do escopo por decisão do Lucas (não migram). Oferta separada: desligar os links. |
| 0.17 | Ensaio das views (SELECT): 2.470 vendas vivas com contrato fora da sombra (18 nativas), 8 envelopes de contrato. ACT (30), SDT (2), TSC (1) sem linha no cadastro com o id. | A view cai na sigla da proposta como reserva; a rota resolve o id também pelo catálogo, que vira opcional (F4). |
| 0.18 | **Garden (GDN, c2x 39, `operado_por` preenchido, vendendo): 404 unidades e 0 propostas** (a carga e o semeador pulam `operado_por`). A rota do portal lê o GDN nas duas fontes (`app/api/incorporador/vendas/assinaturas/route.ts:35-40, 95-120`). | Ler só o Panteon apagaria todo o legado do Garden. Pergunta 1 e trava da F4. |
| 0.19 | Produtos vendendo **sem nenhuma proposta nativa**: JDG, LAB, LBP, LBR, RVP, VDO (e GDN). A carga criou linhas só em 03/09 (4.793), 13/09 (24), 21/09 (1) e 22/09 (106). | Venda feita direto no C2X depois de 22/09 não existe no Panteon. A F4 só sobe com o ensaio de paridade medindo isso por empreendimento (trava). |
| 0.20 | Nativas canceladas antes da viva no mesmo terreno: VOC0306 (cancelada criada 16/09, cancelada 21/09; viva criada 21/09 21:35) e VOL1106 (cancelada 15/09; viva 24/09). `cliente_documento` preenchido em 22 de 22 nativas e 4.924 de 4.924 da carga; `cliente_c2x_id` nulo em 22 de 22 nativas. | A regra 3 do casamento exige nativa não cancelada no instante do envio E o mesmo comprador (documento do C2X comparado em memória). |
| 0.21 | LBF: a proposta nativa está em `contrato`, com `cancelamento_pedido_tipo = 'cancelamento'` e cards `contrato:analise` e `cancelamento:analise`, sem envelope. TST tem outra nativa com pedido (distrato), sem card. | O espelho nunca move venda com pedido de cancelamento aberto; entra no relatório. |
| 0.22 | `temis_envelopes.documento_id` → `hercules_documentos.tipo`: os 8 com proposta são `contrato` (minuta do modelo VOC/VOL/VOR); os 18 sem documento são acordo. Cards: contrato 16, distrato 8, cancelamento 6. Cessão, distrato e cancelamento por correção **também vão para assinatura com o `proposta_id` da venda** (`envio-db.ts:116-123`). | Coluna `finalidade` (e `trabalho_id`) no envelope: só envelope de CONTRATO entra na leitura, move card e grava `data_assinatura`. |
| 0.23 | Payload guardado pelo webhook: **201 de 226 eventos com `documentation` (CPF) e `birthday`, 39 com latitude/longitude**. O maior payload legítimo tem 29 KB. O evento que não passa no HMAC também grava o payload inteiro (`route.ts:116-124`). | F1 grava payload reduzido por allowlist; evento não conferido grava só o esqueleto; corpo acima de 128 KB é recusado. Limpeza das 226 linhas depois do backfill (com OK). |
| 0.24 | 83 dos 226 eventos são de acordo do Hades. | Backfill só de contrato; prova antes e depois dos 18 acordos. |
| 0.25 | Escritores de `estado`/`signatarios` por fora da RPC: `carimbarSucesso` (`envio-db.ts:861-876`) e o do Hades (`hades/acordo/envio-db.ts:778-790`) gravam `aguardando` e o quadro inteiro sem condição; `carimbarFalha` (`envio-db.ts:933-945`, Hades `:837`); `carimbarCancelamento` (`retorno-para-correcao.ts:777-791`); cancelamento do Hades (`hades/acordo/envio-db.ts:1086-1094`) e a corrida do Hades (`:606`). | Carimbo grava só ids e `enviado_em`; estado e quadro pela RPC; todo update direto de estado ganha guarda de terminal (F1). |
| 0.26 | `moverCardDaTemis` faz `update ... .in('id', alvos)` sem comparar o estágio (`estado-db.ts:231-237`); ficar no mesmo estágio é permitido e regrava `estagio_desde`. `concluirAssinaturaDoCard` também não compara (`:510-515`). | Comparar-e-trocar por card e efeito só na borda (F2). |
| 0.27 | Documentação pública da D4Sign (docapi.d4sign.com.br): *"Você terá um limite de 10 requisições por hora"*, aumento pelo comercial. Na prática a conta já aguentou mais (os scripts de 18/08 fizeram 185 envios com `/list` numa rodada, e as telas fazem 8 + 20 chamadas por instância fria). O token do Panteon enxerga o acervo do C2X (3.923 documentos): é a mesma conta com que o C2X envia. `d4sign-consulta.ts:554` e `:601` tratam 429 como falha comum. | A cota contratada é confirmada com a D4Sign antes de qualquer `--gravar` e do cron (pedido operacional). 429 encerra a rodada e pausa 1 h. Carga inicial com vazão fixa e `/list` só do que importa. |
| 0.28 | O proxy deixa passar qualquer `/api` com `Bearer` (`proxy.ts:155`); o cron de boletos autentica só por Bearer e não está em `PUBLIC_API_PREFIXES`. | A rota do espelho não entra em `PUBLIC_API_PREFIXES`; `proxy.ts` não muda. |
| 0.29 | `lib/guardian/db.ts:106-126`: pool comum do C2X, sem transação read-only e sem timeout de consulta, `connectionLimit 5`. | O espelho abre UMA conexão, `START TRANSACTION READ ONLY` e `timeout` de 20 s por consulta. |
| 0.30 | Mesma venda viva em duas glebas (mesmo documento, mesma quadra e lote, empreendimentos diferentes): LBR+ACT 29, RDP+RPC 13, SDT+TSC 1, todas da carga. | Duplicata da carga que já aparece hoje (o C2X tem os dois pedidos). Não se deduplica por palpite na leitura: vira categoria contada no ensaio de paridade (seção 10). |

---

## 1. As fatias, em ordem

Ordem de subida: F0 → F1 → F2 → F3 (ensaio, carga inicial, cron, e só depois `--mover-vendas`) →
F4 (com trava de paridade) → F5 (baixa prioridade) → F6 → F7. Cada fatia é uma versão no changelog e
deixa o sistema coerente sozinha. **Nenhuma tela troca de fonte antes de o espelho estar carregado e
provado (F3) e de o ensaio de paridade dar "inexplicado = 0" (F4).**

### F0 · Coordenação (sem código)

- Conferir `ls packages/database/migrations | tail` e o plano do PAN-124 no momento de aplicar. Se a
  F5 do PAN-124 não existir como arquivo, esta fica 0195 e o Zeus atualiza a tabela de números do
  PAN-124 (F5 → 0196, e as seguintes andam um).
- Combinar com a F5 do PAN-124 (escritor de `temis_envelopes.enterprise_id`, `envio-db.ts:258`,
  `:811-832`). O espelho D4Sign nasce gravando o **id** do C2X em `enterprise_id`.
- Antes da F3: o Lucas confirma com a D4Sign a cota da conta (e se vale por conta ou por token).

### F1 · Quem assinou mora no Panteon, e ninguém mais escreve estado por fora (migration 0195)

**Objetivo.** Cada item de `temis_envelopes.signatarios` passa a ter `chave` única e as marcas
`assinado_em`/`recusado_em` (e `convite_falhou_em`/`convite_entregue_em`), escritas só por uma função
SQL monotônica e atômica. O envelope ganha `finalidade`. O webhook da Clicksign alimenta por pessoa,
não regride estado, não fecha contrato sem todos, não aplica marca de outro documento, grava
`envelope_id` no evento e guarda o payload sem CPF, nascimento nem geolocalização. Todo escritor de
estado passa pela função ou pela guarda de terminal. Backfill das 25 marcas dos 8 contratos.

**Arquivos**

| Ação | Caminho |
|---|---|
| criar | `packages/database/migrations/0195_o_contrato_mora_no_panteon.sql` (SQL completo abaixo) |
| criar | `packages/database/migrations/0195_o_contrato_mora_no_panteon.dados.sql` (`envelope_id` dos eventos; depois do deploy da F1) |
| criar | `apps/hub/lib/assinatura/marcas.ts` (folha pura, **sem nenhum import**, para o script carregar pelo `jiti`) |
| criar | `apps/hub/lib/assinatura/instante.ts` (folha pura: `emBrasilia(iso)` devolve ISO com `-03:00`; `diaEmBrasilia(iso)` com `Intl`, `timeZone 'America/Sao_Paulo'`) |
| criar | `apps/hub/lib/assinatura/registro-db.ts` (a única porta de escrita por pessoa: chama a RPC) |
| alterar | `apps/hub/lib/assinatura/clicksign/webhook.ts:185-229` (ler `event.data.signer`) |
| alterar | `apps/hub/lib/assinatura/estado-db.ts:61-173` (aplicar, `acharEnvelope` com adoção do documento), `:462-552` (concluir), `:560-620` (última do comprador), `:633-657` (registrar evento reduzido), logs só com `code` e `message` (`:102`, `:656`) |
| alterar | `apps/hub/app/api/publico/clicksign/webhook/route.ts` (teto de 128 KB, payload reduzido, esqueleto no não conferido, `maxDuration = 60`) |
| alterar | `apps/hub/lib/assinatura/envio-db.ts:811-832` (`abrirRegistro` grava `finalidade` e `trabalho_id`), `:850-887` (`carimbarSucesso`: ids por update, quadro e estado pela RPC, preenche `envelope_id` dos eventos já chegados), `:925-945` (`carimbarFalha`: estado pela RPC) |
| alterar | `apps/hub/lib/hades/acordo/envio-db.ts:600-612`, `:770-790`, `:830-850`, `:1080-1098` (a mesma regra: `finalidade 'acordo'`, carimbo pela RPC, guarda de terminal nos updates de `cancelado`) |
| alterar | `apps/hub/lib/temis/retorno-para-correcao.ts:768-795` (`carimbarCancelamento` com guarda de terminal) |
| alterar | `app/api/temis/assinatura/enviar/route.ts`, `app/api/incorporador/temis/assinatura/enviar/route.ts` e `lib/temis/assinatura-servico.ts:125` (`enviarContratoDoAtor`) passam o `trabalhoId` que `organizacao-da-assinatura.tsx:165` e `:293` já conhece |
| alterar | `apps/hub/lib/temis/trocar-signatario.ts:557` e `:640-647` (filtra `provedor = 'clicksign'`; frase certa por provedor) e `:689-720` (grava pela RPC com `p_quadro` e `p_quadro_de`) |
| alterar | `apps/hub/lib/assinatura/diario-do-envelope.ts` (importa de `marcas.ts` os leitores de payload: um parser só) |
| criar | `scripts/temis/reprocessar-eventos-clicksign.mjs` (ensaio por padrão, `--gravar` grava; só contrato) |
| criar | `scripts/temis/reduzir-payloads-clicksign.mjs` (ensaio por padrão; `--gravar` troca o payload das 226 linhas antigas pelo reduzido; só depois do backfill, com OK) |

**Funções e assinaturas**

```ts
// apps/hub/lib/assinatura/marcas.ts  (folha: nenhum import)
export type MarcaDeAssinatura = {
  /** ISO com -03:00 (já passado por emBrasilia). Nulo = esta marca não afirma assinatura. */
  assinadoEm: null | string;
  /** Id da pessoa NO PROVEDOR, igual ao `chave` do item do quadro: signer.key (Clicksign) ou c2x:<ss.id> (D4Sign, depois do pareamento). */
  chave: null | string;
  /** Minúsculo. Só vale como reserva: quando a marca não tem chave que exista no quadro E o e-mail é único no quadro. */
  email: null | string;
  recusadoEm: null | string;
  conviteFalhouEm?: null | string;   // bounce/dropped da notificação (diario-do-envelope.ts:183-230)
  conviteEntregueEm?: null | string; // "delivered"
};
/** Lê document.events[] (o histórico INTEIRO vem em todo payload): sign, refusal e as notificações. */
export function marcasDoPayloadDaClicksign(payload: unknown): MarcaDeAssinatura[];
/** document.status 'closed' E todo document.signers[] com 'sign'. null = payload sem lista de signatários. */
export function fechouComTodosNoPayload(payload: unknown): boolean | null;
/** O estado que o evento PODE propor, já com a regra do fechamento (seção 8, 8.7). */
export function estadoPropostoPeloEvento(evento: string, payload: unknown): EstadoDaAssinatura | null;
/** ALLOWLIST do que se guarda do corpo: nomes, datas, chaves, e-mails, status e metadata nossa. Nunca documentation, birthday, geolocalização, ip, user_agent, telefone. */
export function payloadReduzidoDaClicksign(payload: unknown): unknown;
/** Esqueleto do evento que não passou no HMAC: evento, chaves de primeiro nível e tamanho. */
export function esqueletoDoPayload(payload: unknown, tamanho: number): unknown;
// e os leitores de payload que hoje moram em diario-do-envelope.ts, exportados daqui.

// apps/hub/lib/assinatura/registro-db.ts
export type ItemDoQuadro = {
  chave: string;          // OBRIGATÓRIA e única no quadro: signer.key (Clicksign) | c2x:<ss.id> (D4Sign) | tmp:<posição> antes do carimbo
  email: string; nome: string; ordem: number;
  papel: null | string;   // vocabulário da casa (PapelNoContrato) quando se sabe
  perfil?: string;        // rótulo de tela, só D4Sign
  assinado_em?: string; recusado_em?: string; convite_falhou_em?: string; convite_entregue_em?: string;
};
export type EntradaDoRegistro = {
  conferidoEm?: null | string;
  documento?: null | string;             // o provedor_documento_id do evento: adota se a linha não tem; recusa se é outro
  estado?: EstadoDaAssinatura | null;    // o PROPOSTO; a função decide se vale
  estadoCru?: null | string;
  fechadoEm?: null | string;             // só data REAL do provedor; nunca "agora"
  marcas?: readonly MarcaDeAssinatura[];
  quadro?: readonly ItemDoQuadro[] | null;
  quadroDe?: null | string;              // o atualizado_em lido antes da troca (versão)
};
export type RegistroDasAssinaturas = {
  recusa: null | "documento_diferente" | "quadro_mudou";
  assinaram: number; estadoAntes: EstadoDaAssinatura; estadoDepois: EstadoDaAssinatura;
  fechadoEm: null | string; mudouEstado: boolean; total: number;
  signatarios: ItemDoQuadro[];           // o quadro JÁ MESCLADO: é dele que sai a data do comprador
};
/** NUNCA LANÇA. null = linha inexistente ou RPC falhou (log só com code e message). */
export async function registrarAssinaturas(
  sb: SupabaseClient, envelopeRegistroId: string, entrada: EntradaDoRegistro,
): Promise<RegistroDasAssinaturas | null>;
```

⚠️ **Sem caminho antigo de reserva.** A v1 previa cair num update em TS se a 0195 faltasse. Sai:
são três cópias da regra monotônica (SQL, TS, dublê do teste) e só a do banco é testável de verdade.
A F1 só sobe depois da 0195 aplicada; sem a função (42883/PGRST202) o webhook registra o evento e
não aplica nada (o histórico inteiro chega no próximo payload).

**O fluxo novo do webhook (conferido):**
1. Corpo acima de 128 KB → 413, só log (sem gravar).
2. HMAC não confere → grava `esqueletoDoPayload` (sem payload), como hoje responde 401/200.
3. Conferido → `acharEnvelope` para **todo** evento (todo payload traz o histórico inteiro):
   por `provedor_documento_id`, depois `envelope_id`; pelo `metadata` (proposta ou compromisso) **só
   se a linha achada tem `provedor_documento_id` nulo**, e a RPC adota o documento na mesma UPDATE
   (`p_documento`). Linha com outro documento → `recusa: documento_diferente`, nada aplicado, log.
4. `registrarAssinaturas(sb, linha.id, { documento, marcas: marcasDoPayloadDaClicksign(payload),
   estado: estadoPropostoPeloEvento(evento, payload), estadoCru: 'clicksign:<evento>', conferidoEm:
   recebidoEm, fechadoEm: document.finished_at ?? occurred_at do evento de fechamento })`.
5. `mudouEstado && estadoDepois === 'assinado'` → `aplicarEnvelopeNaVenda` (F2; até a F2 subir,
   `concluirAssinaturaDoCard` com o quadro devolvido pela RPC). Se o `after()` morrer aqui, a
   reconciliação da F3 refaz (seção 7).
6. `registrarEventoDeAssinatura` com `envelopeIdDoRegistro = linha.envelope_id` e
   `payloadReduzidoDaClicksign(payload)`.

**SQL completo da 0195**

```sql
-- 0195 · O CONTRATO MORA NO PANTEON: quem assinou, quando, de que documento, e o envelope da D4Sign
-- ao lado do da Clicksign, num registro só.
--
-- ⏳ ESCRITA EM 28/09/2026, NÃO APLICADA. Aplicar só com OK do Lucas (CLAUDE.md, bloqueio operacional).
-- ⚠️ NÚMERO: docs/apolo/pan-124-plano-do-cadastro.md reserva 0195 para a F5 do PAN-124. Quem for
-- aplicado primeiro fica com o número; o outro renumera o PRÓPRIO arquivo.
--
-- POR QUE ELA EXISTE. Lucas, 28/09/2026: "já cansei de falar que informações de venda, contrato,
-- assinatura tem que morar em um local e ele alimentar tudo" e "pode seguir, faz tudo morar no
-- Panteon". Medido no mesmo dia, sem ela:
--   • o Panteon não guarda QUEM assinou (o dado existe só no payload cru do webhook, que também traz
--     CPF em 201 de 226 eventos);
--   • a D4Sign não tem onde morar: o status vive num Map em memória de cada instância da Vercel;
--   • o estado regride (13 'signature_started' depois de um 'sign', 5 documentos);
--   • o envelope não sabe se é contrato, distrato ou cessão: os três usam o proposta_id da venda.
--
-- O QUE ELA FAZ:
--   1. temis_envelopes ganha origem, finalidade, trabalho_id, c2x_contract_signature_id,
--      conferido_em e tentado_em; finalidade dos 26 existentes preenchida (medido: 8 contrato, 18 acordo);
--   2. unicidade de (provedor, provedor_documento_id) SEM predicado; o índice antigo parcial sai;
--   3. a função temis_envelope_registrar_assinaturas: a ÚNICA escrita de quadro, marca e estado
--      proposto por provedor;
--   4. índice de temis_assinatura_eventos pela chave que todo leitor usa;
--   5. a origem 'espelho_d4sign' (e a 'conclusao' da 0177) na passagem de etapa do card;
--   6. a linha de estado do espelho da D4Sign (vez da rodada, última rodada boa, pausa por cota);
--   7. duas views de leitura, security_invoker, só para o service_role.
--
-- O QUE ELA NÃO FAZ: não corrige a sigla de temis_envelopes.enterprise_id (PAN-124); não preenche
-- assinado_em (scripts/temis/reprocessar-eventos-clicksign.mjs); não cria linha da D4Sign (espelho,
-- F3); não preenche envelope_id dos eventos (0195_*.dados.sql, depois do deploy da F1).
--
-- ATENCAO 1: SÓ O ESPELHO ESCREVE origem = 'c2x'. O Panteon não envia, não cancela e não troca
--   signatário nessas linhas. Os CHECKs impedem 'c2x' com outro provedor.
--
-- ATENCAO 2: A UNICIDADE DO DOCUMENTO É SEM PREDICADO DE PROPÓSITO (o PostgREST não usa índice
--   parcial como alvo de on_conflict). NULLS DISTINCT: rascunhos sem documento continuam podendo ser
--   vários. E c2x_contract_signature_id NÃO é único: se o C2X trocar o uuidDoc de um mesmo envio, o
--   documento novo é OUTRA linha (o velho continua com o último estado que a D4Sign deu a ele).
--
-- ATENCAO 3: A MARCA POR PESSOA É MONOTÔNICA, ATÔMICA E CASADA PELA CHAVE. assinado_em e
--   recusado_em nunca voltam a nulo, a PRIMEIRA data vence; convite_falhou_em e convite_entregue_em
--   ficam com a MAIS RECENTE (um reenvio pode consertar o convite). Linha travada (FOR UPDATE) antes
--   do merge. A marca casa pelo `chave`; o e-mail só vale quando a chave da marca não existe no
--   quadro E o e-mail é único no quadro (casar por e-mail sem consumir o par pinta N linhas com uma
--   marca: lib/guardian/d4sign-consulta.ts:150-155). A data guardada é o TEXTO que o chamador
--   mandou, já em -03:00 (lib/assinatura/instante.ts); o cast só valida e ordena. Presença se testa
--   por valor (nullif(item->>'x','') is not null), nunca pelo operador ?, que só testa a chave.
--
-- ATENCAO 4: O ESTADO NÃO REGRIDE. Ordem: rascunho 0 < desconhecido 1 < aguardando 2 < parcial 3 <
--   terminais 4. Só entra estado proposto de ordem ESTRITAMENTE maior; 'desconhecido' proposto nunca
--   entra (é só da inserção). Terminal não muda mais. "parcial" é derivado: alguém com assinado_em e
--   o estado dizendo que ninguém assinou vira "parcial".
--
-- ATENCAO 5: fechado_em NUNCA É "AGORA". É a data que o provedor deu (p_fechado_em) ou, no
--   assinado com todos marcados, a última assinatura. Sem nenhuma das duas fica NULO e é
--   recalculado a cada chamada enquanto nulo. (A v1 gravava now() e congelava a hora do cron como
--   data da assinatura, que ia para data_assinatura e para a minuta de distrato.) Os cancelamentos
--   feitos PELO PANTEON continuam carimbando a hora do próprio ato, fora daqui.
--
-- ATENCAO 6: O DOCUMENTO E A VERSÃO. p_documento: linha sem provedor_documento_id adota o do evento;
--   linha com OUTRO documento recusa (o evento do documento 1 não pinta o documento 2 do reenvio).
--   p_quadro_de: a troca de signatário manda o atualizado_em que leu; se mudou, recusa e ela relê.
--
-- ATENCAO 7: FUNÇÃO NOVA NASCE ABERTA NO SUPABASE ("revoke from public" não alcança anon nem
--   authenticated, 0194). Os três revogados; só service_role executa. SECURITY INVOKER. Conferir
--   role_routine_grants depois de aplicar.
--
-- ATENCAO 8: AS VIEWS SÃO security_invoker E FECHADAS. A de contratos ignora SÓ a proposta DA CARGA
--   pendurada na linha-sombra do pai (a regra de situacao-da-unidade.ts:573-581); nativa no pai vale.
--   A de envelopes só traz finalidade 'contrato'.
--
-- ATENCAO 9: O CHECK DA PASSAGEM LEVA 'conclusao' JUNTO (a 0177 não está em produção). Não aplicar
--   a 0177 depois desta: ela redefine o mesmo CHECK sem 'espelho_d4sign'.
--
-- ATENCAO 10: RLS ligada e sem policy em temis_envelopes, temis_assinatura_eventos e na tabela nova.
--
-- DESFAZER (se preciso, com OK):
--   drop view if exists public.temis_envelopes_de_contrato;
--   drop view if exists public.temis_contratos_do_panteon;
--   drop function if exists public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz);
--   drop table if exists public.temis_espelho_d4sign;
--   drop index if exists public.temis_assinatura_eventos_documento_idx;
--   drop index if exists public.temis_envelopes_rodizio_idx;
--   drop index if exists public.temis_envelopes_c2x_envio_idx;
--   drop index if exists public.temis_envelopes_provedor_documento_unico;
--   create index if not exists temis_envelopes_provedor_documento_idx on public.temis_envelopes
--     (provedor, provedor_documento_id) where provedor_documento_id is not null;
--   alter table public.temis_envelopes drop constraint if exists temis_envelopes_c2x_so_d4sign,
--     drop constraint if exists temis_envelopes_origem_valida, drop constraint if exists temis_envelopes_finalidade_valida;
--   alter table public.temis_envelopes drop column if exists tentado_em, drop column if exists conferido_em,
--     drop column if exists c2x_contract_signature_id, drop column if exists trabalho_id,
--     drop column if exists finalidade, drop column if exists origem;
--   (o check da passagem volta ao texto da 0153)
--   ⚠️ Depois de o espelho gravar, antes apagar as linhas dele (provedor 'd4sign' e origem 'c2x').

begin;

-- 1. AS COLUNAS ─────────────────────────────────────────────────────────────────────────────
alter table public.temis_envelopes
  add column if not exists origem text not null default 'panteon',
  add column if not exists finalidade text,
  add column if not exists trabalho_id uuid references public.temis_trabalhos(id) on delete set null,
  add column if not exists c2x_contract_signature_id bigint,
  add column if not exists conferido_em timestamptz,
  add column if not exists tentado_em timestamptz;

alter table public.temis_envelopes drop constraint if exists temis_envelopes_origem_valida;
alter table public.temis_envelopes
  add constraint temis_envelopes_origem_valida check (origem in ('panteon', 'c2x'));

alter table public.temis_envelopes drop constraint if exists temis_envelopes_c2x_so_d4sign;
alter table public.temis_envelopes
  add constraint temis_envelopes_c2x_so_d4sign check (origem = 'panteon' or provedor = 'd4sign');

alter table public.temis_envelopes drop constraint if exists temis_envelopes_finalidade_valida;
alter table public.temis_envelopes
  add constraint temis_envelopes_finalidade_valida check (finalidade is null or finalidade in
    ('contrato', 'distrato', 'cessao', 'cancelamento_correcao', 'acordo'));

-- Os 26 de hoje (medido em 28/09: 18 acordos; 8 com proposta, todos com documento tipo 'contrato'
-- gerado da minuta do modelo do empreendimento). Idempotente.
update public.temis_envelopes set finalidade = 'acordo'
 where finalidade is null and compromisso_id is not null;
update public.temis_envelopes e set finalidade = 'contrato'
  from public.hercules_documentos d
 where e.finalidade is null and e.proposta_id is not null
   and d.id = e.documento_id and d.tipo = 'contrato';

comment on column public.temis_envelopes.origem is
  'Quem mandou este envelope: panteon (a Têmis/o Hades) ou c2x (o C2X mandou para a D4Sign; escrita SÓ pelo espelho). 0195, ATENCAO 1.';
comment on column public.temis_envelopes.finalidade is
  'O que este envelope assina: contrato (da venda), distrato, cessao, cancelamento_correcao ou acordo (Hades). Nulo = não se sabe (tipo do C2X não mapeado): não entra na leitura única nem move card. Só contrato move o card de contrato e grava data_assinatura.';
comment on column public.temis_envelopes.trabalho_id is
  'O card da Têmis que mandou o envelope (nulo nas linhas do C2X e nas antigas).';
comment on column public.temis_envelopes.c2x_contract_signature_id is
  'contract_signatures.id do C2X nas linhas de origem c2x (o envioId das telas). NÃO é único (ATENCAO 2).';
comment on column public.temis_envelopes.conferido_em is
  'Última conferência BEM-SUCEDIDA com o provedor (webhook aplicado ou /list do espelho).';
comment on column public.temis_envelopes.tentado_em is
  'Última TENTATIVA do espelho de conferir por pessoa, com sucesso ou não. É a régua do rodízio: documento que sempre falha não trava a fila.';
comment on column public.temis_envelopes.signatarios is
  'O quadro: [{chave, ordem, papel, nome, email, perfil?, assinado_em?, recusado_em?, convite_falhou_em?, convite_entregue_em?}]. chave única no quadro. Marcas escritas SÓ por temis_envelope_registrar_assinaturas. E-mail é dado interno: não vai a navegador nenhum. Finalidade da cópia (D4Sign): mostrar quem falta assinar; retenção: a do contrato.';

-- 2. A UNICIDADE ────────────────────────────────────────────────────────────────────────────
create unique index if not exists temis_envelopes_provedor_documento_unico
  on public.temis_envelopes (provedor, provedor_documento_id);
drop index if exists public.temis_envelopes_provedor_documento_idx;  -- redundante com o de cima

create index if not exists temis_envelopes_c2x_envio_idx
  on public.temis_envelopes (c2x_contract_signature_id)
  where c2x_contract_signature_id is not null;

-- O rodízio do espelho: o que ainda se move, da tentativa mais antiga para a mais recente.
create index if not exists temis_envelopes_rodizio_idx
  on public.temis_envelopes (provedor, tentado_em nulls first)
  where estado in ('aguardando', 'parcial', 'desconhecido');

-- 3. OS EVENTOS PELA CHAVE QUE TODO LEITOR USA ──────────────────────────────────────────────
create index if not exists temis_assinatura_eventos_documento_idx
  on public.temis_assinatura_eventos (provedor_documento_id, recebido_em desc)
  where provedor_documento_id is not null;

-- 4. A ÚNICA ESCRITA DE QUADRO, MARCA E ESTADO PROPOSTO ─────────────────────────────────────
create or replace function public.temis_envelope_registrar_assinaturas(
  p_envelope     uuid,
  p_marcas       jsonb       default '[]'::jsonb,
  p_estado       text        default null,
  p_estado_cru   text        default null,
  p_quadro       jsonb       default null,
  p_conferido_em timestamptz default null,
  p_fechado_em   timestamptz default null,
  p_documento    text        default null,
  p_quadro_de    timestamptz default null
)
returns table (
  recusa        text,
  estado_antes  text,
  estado_depois text,
  mudou_estado  boolean,
  assinaram     integer,
  total         integer,
  fechado       timestamptz,
  quadro        jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_linha     public.temis_envelopes%rowtype;
  v_antigo    jsonb;
  v_quadro    jsonb;
  v_marcas    jsonb;
  v_doc       text;
  v_estado    text;
  v_cru       text;
  v_fechado   timestamptz;
  v_assinaram integer;
  v_total     integer;
begin
  if p_estado is not null and p_estado not in
     ('rascunho', 'aguardando', 'parcial', 'assinado', 'recusado', 'cancelado', 'expirado', 'desconhecido') then
    raise exception 'estado fora da língua da casa: %', p_estado using errcode = '22023';
  end if;

  select * into v_linha from public.temis_envelopes t where t.id = p_envelope for update;
  if not found then
    return;  -- zero linhas: "não achei o envelope"
  end if;

  -- (0) ATENCAO 6: o documento e a versão.
  v_doc := v_linha.provedor_documento_id;
  if p_documento is not null then
    if v_doc is null then
      v_doc := p_documento;
    elsif v_doc <> p_documento then
      return query select 'documento_diferente'::text, v_linha.estado, v_linha.estado, false,
                          null::integer, null::integer, v_linha.fechado_em, null::jsonb;
      return;
    end if;
  end if;
  if p_quadro is not null and p_quadro_de is not null
     and v_linha.atualizado_em is distinct from p_quadro_de then
    return query select 'quadro_mudou'::text, v_linha.estado, v_linha.estado, false,
                        null::integer, null::integer, v_linha.fechado_em, null::jsonb;
    return;
  end if;

  v_antigo := coalesce(v_linha.signatarios, '[]'::jsonb);
  v_quadro := v_antigo;

  -- (a) Quadro novo: o novo manda na lista; quem continua nela leva as marcas que já tinha. Casa
  -- pela chave; sem chave igual, pelo e-mail ÚNICO no quadro antigo. Nunca "limit 1" sem ordem.
  if p_quadro is not null then
    if jsonb_typeof(p_quadro) <> 'array' then
      raise exception 'p_quadro precisa ser uma lista' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(
             jsonb_strip_nulls(novo.item)
             || coalesce((select jsonb_object_agg(k.chave, antigo.item -> k.chave)
                            from unnest(array['assinado_em', 'recusado_em', 'convite_falhou_em',
                                              'convite_entregue_em']) as k(chave)
                           where nullif(antigo.item ->> k.chave, '') is not null), '{}'::jsonb)
             order by novo.posicao), '[]'::jsonb)
      into v_quadro
      from jsonb_array_elements(p_quadro) with ordinality as novo(item, posicao)
      left join lateral (
        select velho.item
          from jsonb_array_elements(v_antigo) with ordinality as velho(item, pos)
         where (nullif(novo.item ->> 'chave', '') is not null
                and velho.item ->> 'chave' = novo.item ->> 'chave')
            or (not exists (select 1 from jsonb_array_elements(v_antigo) o
                             where nullif(novo.item ->> 'chave', '') is not null
                               and o ->> 'chave' = novo.item ->> 'chave')
                and nullif(lower(velho.item ->> 'email'), '') = lower(novo.item ->> 'email')
                and (select count(*) from jsonb_array_elements(v_antigo) o
                      where lower(o ->> 'email') = lower(novo.item ->> 'email')) = 1)
         order by (velho.item ->> 'chave' = novo.item ->> 'chave') desc nulls last, velho.pos
         limit 1
      ) as antigo on true;
  end if;

  -- (b) As marcas (ATENCAO 3).
  if p_marcas is not null and jsonb_typeof(p_marcas) = 'array' and jsonb_array_length(p_marcas) > 0 then
    select coalesce(jsonb_agg(jsonb_strip_nulls(x)), '[]'::jsonb) into v_marcas
      from jsonb_array_elements(p_marcas) as x;

    select coalesce(jsonb_agg(
             q.item
             || case when nullif(q.item ->> 'assinado_em', '') is null and m.assinado_em is not null
                     then jsonb_build_object('assinado_em', m.assinado_em) else '{}'::jsonb end
             || case when nullif(q.item ->> 'recusado_em', '') is null and m.recusado_em is not null
                     then jsonb_build_object('recusado_em', m.recusado_em) else '{}'::jsonb end
             || case when m.falhou is not null
                      and (nullif(q.item ->> 'convite_falhou_em', '') is null
                           or m.falhou::timestamptz > (q.item ->> 'convite_falhou_em')::timestamptz)
                     then jsonb_build_object('convite_falhou_em', m.falhou) else '{}'::jsonb end
             || case when m.entregue is not null
                      and (nullif(q.item ->> 'convite_entregue_em', '') is null
                           or m.entregue::timestamptz > (q.item ->> 'convite_entregue_em')::timestamptz)
                     then jsonb_build_object('convite_entregue_em', m.entregue) else '{}'::jsonb end
             order by q.posicao), '[]'::jsonb)
      into v_quadro
      from jsonb_array_elements(v_quadro) with ordinality as q(item, posicao)
      left join lateral (
        select
          (array_agg(x.marca ->> 'assinado_em' order by (x.marca ->> 'assinado_em')::timestamptz)
             filter (where nullif(x.marca ->> 'assinado_em', '') is not null))[1] as assinado_em,
          (array_agg(x.marca ->> 'recusado_em' order by (x.marca ->> 'recusado_em')::timestamptz)
             filter (where nullif(x.marca ->> 'recusado_em', '') is not null))[1] as recusado_em,
          (array_agg(x.marca ->> 'convite_falhou_em' order by (x.marca ->> 'convite_falhou_em')::timestamptz desc)
             filter (where nullif(x.marca ->> 'convite_falhou_em', '') is not null))[1] as falhou,
          (array_agg(x.marca ->> 'convite_entregue_em' order by (x.marca ->> 'convite_entregue_em')::timestamptz desc)
             filter (where nullif(x.marca ->> 'convite_entregue_em', '') is not null))[1] as entregue
          from jsonb_array_elements(v_marcas) as x(marca)
         where (nullif(x.marca ->> 'chave', '') is not null and x.marca ->> 'chave' = q.item ->> 'chave')
            or (not exists (select 1 from jsonb_array_elements(v_quadro) o
                             where nullif(x.marca ->> 'chave', '') is not null
                               and o ->> 'chave' = x.marca ->> 'chave')
                and nullif(lower(x.marca ->> 'email'), '') = lower(q.item ->> 'email')
                and (select count(*) from jsonb_array_elements(v_quadro) o
                      where lower(o ->> 'email') = lower(q.item ->> 'email')) = 1)
      ) as m on true;
  end if;

  select count(*) filter (where nullif(q.item ->> 'assinado_em', '') is not null), count(*)
    into v_assinaram, v_total
    from jsonb_array_elements(v_quadro) as q(item);

  -- (c) O estado, monotônico (ATENCAO 4).
  v_estado := v_linha.estado;
  v_cru    := v_linha.estado_cru;
  if v_linha.estado not in ('assinado', 'recusado', 'cancelado', 'expirado') then
    if p_estado is not null and p_estado <> 'desconhecido'
       and (case p_estado when 'rascunho' then 0 when 'desconhecido' then 1 when 'aguardando' then 2
                          when 'parcial' then 3 else 4 end)
         > (case v_linha.estado when 'rascunho' then 0 when 'desconhecido' then 1 when 'aguardando' then 2
                                when 'parcial' then 3 else 4 end) then
      v_estado := p_estado;
      v_cru    := coalesce(p_estado_cru, v_cru);
    end if;
    if v_assinaram > 0 and v_estado in ('rascunho', 'desconhecido', 'aguardando') then
      v_estado := 'parcial';
    end if;
  end if;

  -- (d) O fechamento (ATENCAO 5): nunca "agora".
  v_fechado := v_linha.fechado_em;
  if v_estado in ('assinado', 'recusado', 'cancelado', 'expirado') and v_fechado is null then
    v_fechado := coalesce(
      p_fechado_em,
      case when v_estado = 'assinado' and v_total > 0 and v_assinaram = v_total then
        (select max((q.item ->> 'assinado_em')::timestamptz)
           from jsonb_array_elements(v_quadro) as q(item)
          where nullif(q.item ->> 'assinado_em', '') is not null)
      end);
  end if;

  update public.temis_envelopes t
     set signatarios           = v_quadro,
         estado                = v_estado,
         estado_cru            = v_cru,
         fechado_em            = v_fechado,
         provedor_documento_id = v_doc,
         conferido_em  = case when p_conferido_em is null then t.conferido_em
                              else greatest(coalesce(t.conferido_em, p_conferido_em), p_conferido_em) end,
         atualizado_em = case when v_quadro is distinct from t.signatarios
                                or v_estado is distinct from t.estado
                                or v_doc is distinct from t.provedor_documento_id
                                or v_fechado is distinct from t.fechado_em
                              then now() else t.atualizado_em end
   where t.id = p_envelope;

  return query
    select null::text, v_linha.estado, v_estado, (v_estado is distinct from v_linha.estado),
           v_assinaram, v_total, v_fechado, v_quadro;
end;
$$;

comment on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) is
  'A única escrita de quadro, marca por pessoa e estado proposto por provedor (0195). Trava a linha, confere documento e versão, mescla o quadro (p_quadro, pela chave) e as marcas (p_marcas, pela chave; e-mail só se único) sem apagar marca, move o estado só para a frente e nunca inventa fechado_em. Devolve o antes, o depois, a contagem e o quadro mesclado. Só service_role.';

revoke execute on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) from public;
revoke execute on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) from anon;
revoke execute on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) from authenticated;
grant execute on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) to service_role;

-- 5. A ORIGEM DO ESPELHO NA PASSAGEM DO CARD (ATENCAO 9) ────────────────────────────────────
alter table public.temis_trabalho_etapas drop constraint if exists temis_trabalho_etapas_origem_valida;
alter table public.temis_trabalho_etapas
  add constraint temis_trabalho_etapas_origem_valida
    check (origem in (
      'abertura', 'atividade', 'conclusao', 'contrato_gerado', 'envio_assinatura',
      'espelho_d4sign', 'webhook_assinatura', 'indeferimento', 'retorno_para_correcao'
    ));
comment on column public.temis_trabalho_etapas.origem is
  'O que fez o card andar: abertura, atividade, conclusao, contrato_gerado, envio_assinatura, espelho_d4sign (o espelho da D4Sign viu o contrato enviado ou assinado pelo C2X), webhook_assinatura, indeferimento, retorno_para_correcao.';

-- 6. O ESTADO DO ESPELHO (uma linha só) ─────────────────────────────────────────────────────
create table if not exists public.temis_espelho_d4sign (
  id                  smallint primary key default 1 check (id = 1),
  em_curso_ate        timestamptz,  -- a vez da rodada: só uma rodada por vez (cron, retry, POST)
  ultima_rodada_ok_em timestamptz,  -- a campainha do "conferência atrasada"
  d4sign_pausada_ate  timestamptz,  -- HTTP 429: ninguém chama a D4Sign até aqui
  relatorio           jsonb,        -- só contagens e ids, nunca nome nem e-mail
  atualizado_em       timestamptz not null default now()
);
insert into public.temis_espelho_d4sign (id) values (1) on conflict (id) do nothing;
alter table public.temis_espelho_d4sign enable row level security;
revoke all on table public.temis_espelho_d4sign from anon, authenticated;
comment on table public.temis_espelho_d4sign is
  'Estado do espelho da D4Sign (0195): a vez da rodada, a última rodada boa, a pausa por cota e o último relatório (só contagens). Só service_role.';

-- 7. AS VIEWS DA LEITURA ÚNICA (ATENCAO 8) ──────────────────────────────────────────────────
create or replace view public.temis_contratos_do_panteon
with (security_invoker = true) as
select
  p.id                  as proposta_id,
  p.workspace_id,
  p.origem,
  p.origem_c2x_id       as ar_c2x_id,
  p.etapa,
  p.etapa_desde,
  p.criado_em,
  p.cliente_nome,
  p.imobiliaria_nome,
  p.valor,
  p.preco_tabela,
  p.data_assinatura,
  p.data_ato,
  p.data_faturamento,
  p.cancelamento_pedido_em,
  u.id                  as unidade_id,
  u.espelho_de,
  u.codigo              as unidade_codigo,
  u.quadra,
  u.lote,
  u.enterprise_id,
  u.origem_c2x_id       as unidade_c2x_id,
  u.preco_tabela        as unidade_preco_tabela,
  coalesce(he.codigo, p.empreendimento_codigo) as empreendimento_codigo,
  (select min(pe.quando)
     from public.hercules_proposta_etapas pe
    where pe.proposta_id = p.id
      and pe.para = 'contrato') as gerado_em
from public.hercules_propostas p
join public.hercules_unidades u on u.id = p.unidade_id
left join lateral (
  select e.codigo
    from public.hercules_empreendimentos e
   where e.workspace_id = u.workspace_id
     and e.c2x_enterprise_id = u.enterprise_id
   order by e.codigo
   limit 1
) he on true
where p.etapa in ('contrato', 'assinatura', 'faturado')
  and p.aberta is not false
  and p.cancelada_em is null
  and not (u.espelho_de is not null and p.origem = 'c2x');

comment on view public.temis_contratos_do_panteon is
  'Uma linha por venda viva com contrato (contrato, assinatura ou faturado), das duas origens. Fica de fora só a proposta DA CARGA pendurada na linha-sombra do pai (a regra de situacao-da-unidade.ts). Sem CPF nem contato. O terreno sai da união da régua, em TS. Só service_role (0195, ATENCAO 8).';
revoke all on table public.temis_contratos_do_panteon from anon, authenticated, service_role;
grant select on table public.temis_contratos_do_panteon to service_role;

create or replace view public.temis_envelopes_de_contrato
with (security_invoker = true) as
select
  e.id, e.workspace_id, e.provedor, e.origem, e.envelope_id, e.provedor_documento_id,
  e.c2x_contract_signature_id, e.proposta_id, e.documento_id, e.trabalho_id, e.unidade_id,
  e.estado, e.estado_cru, e.falha, e.signatarios, e.ordenada,
  e.enviado_em, e.fechado_em, e.conferido_em, e.criado_em, e.atualizado_em
from public.temis_envelopes e
where e.finalidade = 'contrato';

comment on view public.temis_envelopes_de_contrato is
  'Envelopes de CONTRATO de venda (finalidade contrato), dos dois provedores. signatarios traz e-mail: nunca atravessa para navegador. Só service_role (0195, ATENCAO 8).';
revoke all on table public.temis_envelopes_de_contrato from anon, authenticated, service_role;
grant select on table public.temis_envelopes_de_contrato to service_role;

-- 8. RLS (ATENCAO 10) ────────────────────────────────────────────────────────────────────────
alter table public.temis_envelopes enable row level security;
alter table public.temis_assinatura_eventos enable row level security;

commit;
```

**`0195_o_contrato_mora_no_panteon.dados.sql`** (depois do deploy da F1, com OK)

```sql
-- 0195 (dados) · OS EVENTOS DO WEBHOOK GANHAM O envelope_id QUE SEMPRE FALTOU.
-- Medido em 28/09/2026: 226 de 226 com envelope_id nulo. Depois da F1 o registro grava o da linha
-- achada e o carimbo do envio preenche os eventos que chegaram antes dele; isto conserta o passado.
-- Idempotente: só toca evento sem envelope_id; casamento único pela unicidade da 0195.
begin;
update public.temis_assinatura_eventos ev
   set envelope_id = e.envelope_id
  from public.temis_envelopes e
 where ev.envelope_id is null
   and ev.provedor_documento_id is not null
   and ev.assinatura_conferida
   and e.provedor = ev.provedor
   and e.provedor_documento_id = ev.provedor_documento_id
   and e.envelope_id is not null;
commit;
-- Conferência: select count(*), count(envelope_id) from temis_assinatura_eventos;
```

**Escritores (todos, depois da F1).** Só a RPC escreve `signatarios`, as marcas e o estado proposto
por provedor. Updates diretos que continuam, todos com `.not('estado','in','(assinado,recusado,cancelado,expirado)')`:
`carimbarCancelamento` (Têmis), o cancelamento e a corrida do Hades, e os ids/`enviado_em`/`falha`
dos carimbos. O carimbo de sucesso vira: (1) update de `envelope_id`, `provedor_documento_id`,
`enviado_em`; (2) RPC com `p_quadro = congelarSignatarios(...)` (a chave da Clicksign) e
`p_estado = 'aguardando'` (não regride um `parcial` que chegou antes: 26 de 26 uploads chegaram
antes do carimbo, pelo mapa); (3) `update temis_assinatura_eventos set envelope_id = <id> where
provedor_documento_id = <doc> and envelope_id is null`. A inserção (`abrirRegistro`, os dois)
grava `chave = 'tmp:<posição>'`, `finalidade` e `trabalho_id` (sem `trabalhoId` no pedido: se a
proposta tem um único card e ele é de contrato, `contrato`; senão nulo e log).

**Script `scripts/temis/reprocessar-eventos-clicksign.mjs`.** Carrega `marcas.ts` e `instante.ts`
pelo `jiti` (padrão de `scripts/lsoft/reconciliar-trilha.mjs`). Só envelopes com `finalidade =
'contrato'` (os 18 acordos não são tocados). Para cada um: TODOS os payloads conferidos
(`assinatura_conferida = true`) do documento, paginados com ordem, e a UNIÃO das marcas (medido:
último payload = união em 10 de 10). Sem `--gravar` imprime `envelope · assinaram antes → depois ·
total`; com `--gravar` chama a RPC. Esperado (28/09): 8 envelopes de contrato, as marcas deles.

**Testes vitest (rodar de dentro de `apps/hub`; conferir também a linha de "Errors" do vitest)**

- `lib/assinatura/marcas.test.ts`: fixture `__fixtures__/clicksign-sign-com-bounce.json` → marcas com
  `chave`, e-mail minúsculo e `occurred_at` em -03:00; `refusal` → `recusadoEm`; bounce →
  `conviteFalhouEm`; `sign` sem `occurred_at` não vira marca; `fechouComTodosNoPayload`;
  `estadoPropostoPeloEvento`: `sign` da última pessoa com `closed` + todos → `assinado`; `close` com
  todos → `assinado`; `close` sem todos → `expirado`; `close` sem lista de signatários → null;
  `payloadReduzidoDaClicksign` sobre a fixture não contém `documentation`, `birthday`, `latitude`,
  `longitude`, `ip`, `user_agent` nem 11 dígitos seguidos, e o diário e o contador leem dele o mesmo
  que leem do payload cheio.
- `lib/assinatura/instante.test.ts`: `23:30-03:00` → dia do próprio dia; `02:30Z` → dia anterior.
- `lib/assinatura/clicksign/webhook.test.ts`: v1 com `event.data.signer.email` preenche `signatarioEmail`.
- `lib/assinatura/estado-db.test.ts`: `add_signer` com `sign` no histórico chama a RPC com as marcas;
  evento pelo metadata só aplica em linha sem documento; `registrarEventoDeAssinatura` grava
  `envelopeIdDoRegistro` e o payload reduzido; `ultimaAssinaturaDoComprador` ignora coordenadora e
  testemunha; ponta a ponta: fechamento com `sign` do comprador no histórico chega em
  `arrependimento_inicio` com a data dele (pelo quadro devolvido pela RPC, não injetado).
- `app/api/publico/clicksign/webhook/route.test.ts`: corpo de 200 KB → 413 sem gravar; HMAC errado
  grava só o esqueleto.
- `lib/temis/trocar-signatario.test.ts`: a troca manda `p_quadro` + `p_quadro_de` e preserva
  `assinado_em`; `quadro_mudou` → relê e tenta uma vez; `lerEnvelope` filtra `provedor = 'clicksign'`.
- `lib/assinatura/envio-db.test.ts`: o carimbo não grava `estado` nem `signatarios` por update direto.
- **Ensaio SQL da função** (`packages/database/migrations/0195_o_contrato_mora_no_panteon.ensaio.sql`,
  `BEGIN … ROLLBACK`, num branch do Supabase ou em prod depois de aplicada, com OK): `sign` seguido de
  `signature_started`; `add_signer` com histórico; troca preservando marca; item com
  `"assinado_em": null`; dois itens com o mesmo e-mail e uma marca → um assinado; marca com chave;
  marca de outro documento; `fechado_em` sem data → nulo; 23:30-03:00 guardado como veio.

**Prova em produção, só SELECT (depois de aplicar e do script)**

```sql
-- a) objetos e grants
select column_name, data_type, is_nullable from information_schema.columns
 where table_schema='public' and table_name='temis_envelopes'
   and column_name in ('origem','finalidade','trabalho_id','c2x_contract_signature_id','conferido_em','tentado_em');
select grantee from information_schema.role_routine_grants
 where routine_schema='public' and routine_name='temis_envelope_registrar_assinaturas'; -- só postgres e service_role
select finalidade, count(*) from temis_envelopes group by 1; -- contrato 8, acordo 18
select indexname from pg_indexes where tablename='temis_envelopes'; -- sem temis_envelopes_provedor_documento_idx
-- b) os 18 acordos NÃO mudaram (rodar antes e depois, comparar)
select id, estado, estado_cru, fechado_em, jsonb_array_length(signatarios) from temis_envelopes
 where compromisso_id is not null order by id;
-- c) quem assinou, por contrato: bate com os 'sign' do histórico (28/09: 25)
select e.id, e.estado, jsonb_array_length(e.signatarios) total,
       (select count(*) from jsonb_array_elements(e.signatarios) s where nullif(s->>'assinado_em','') is not null) assinaram
  from temis_envelopes e where e.finalidade = 'contrato' order by 1;
-- d) nenhum dado sensível guardado depois do deploy
select count(*) from temis_assinatura_eventos
 where recebido_em > '<hora do deploy>' and payload::text ~ '"(documentation|birthday|latitude|longitude)"'; -- 0
-- d2) nenhuma credencial da Vercel nos cabeçalhos (depois do deploy; e em TODAS depois do reduzir --gravar)
select count(*) from temis_assinatura_eventos
 where headers::text ~* 'oidc-token|sc-headers|proxy-signature'; -- 0
-- e) nenhuma regressão depois do deploy
select count(*) from temis_envelopes e where e.estado = 'aguardando'
   and exists (select 1 from jsonb_array_elements(e.signatarios) s where nullif(s->>'assinado_em','') is not null); -- 0
```

**Rollback:** revert do código. As colunas e a função ficam sem uso; o payload reduzido não volta a
ser cheio (é o objetivo).

### F2 · Uma régua de envelope vigente e o caminho envelope → card → venda sem provedor

**Objetivo.** Uma função decide "qual envelope vale" e "qual segura o envio"; um caminho leva o fato
do envelope ao card e à venda, venha de onde vier, **só para envelope de contrato, só na borda, com
comparar-e-trocar, e só com data real**. Detalhe nas seções 4 e 7.

| Ação | Caminho |
|---|---|
| criar | `apps/hub/lib/assinatura/envelope-vigente.ts` (puro; recebe `ESTADOS_QUE_LIBERAM_REENVIO`, `seguraOEnvio`, `envelopeQueSegura` de `envio-db.ts:572-612`, que passa a reexportar) |
| criar | `apps/hub/lib/assinatura/envelope-na-venda.ts` (`aplicarEnvelopeNaVenda`, `reconciliarVendasAssinadas`, `inicioDoArrependimento`, `diaDaAssinatura`) |
| alterar | `apps/hub/lib/assinatura/estado-db.ts:220-260` (`moverCardDaTemis`: `origem?`, `somenteSeAndar?`, e o update por card com `.eq('estagio', lido)`), `:462-552` (`concluirAssinaturaDoCard(sb, propostaId, envelope)` com `.eq('estagio','assinatura')`) |
| alterar | `apps/hub/lib/temis/passagem-de-etapa-db.ts:38-60` (`OrigemDaPassagem` + `'espelho_d4sign'`) |
| alterar | `apps/hub/lib/hercules/reflexo-da-temis-server.ts` (`motivoDoReflexo(de, para, origem?)`; o cabeçalho passa a dizer que `data_assinatura` é gravada por `aplicarEnvelopeNaVenda`, decisão do Lucas de 28/09) |
| alterar | `apps/hub/lib/hercules/fatos-do-contrato-server.ts:56` (lê só `finalidade = 'contrato'`) e `fatos-do-contrato.ts:111-121` (frase com o provedor) |
| alterar | frases de recusa para envelope da D4Sign: `envio-db.ts:705-793`, `retorno-para-correcao.ts:266-273`, `concluir-cancelamento-server.ts:664-670`, **`indeferimento-na-venda-server.ts:444-455`** ("cancele na D4Sign pelo C2X; o Panteon libera em até 30 minutos") |
| alterar | `apps/hub/lib/apolo/incorporador/assinaturas.ts:1176-1206` (importa o `envelopeVigente` novo; some na F4) |
| alterar | `apps/hub/lib/temis/trabalho-servico.ts:1000-1031` (`envelopeVivoDaProposta` devolve `provedor` e `doisContratosVivos`) |

```ts
// apps/hub/lib/assinatura/envelope-vigente.ts (puro)
export type EnvelopeParaEscolher = {
  criado_em: string; enviado_em?: null | string; envelope_id: null | string;
  estado: string; falha: null | string; id: string; provedor: string;
};
export const ESTADOS_QUE_LIBERAM_REENVIO: ReadonlySet<string>; // cancelado, expirado, recusado
export function seguraOEnvio(linha: Pick<EnvelopeParaEscolher, "envelope_id" | "estado" | "falha">): boolean;
export function envelopeQueSegura<L extends EnvelopeParaEscolher>(linhas: L[]): L | null;
export type VigenciaDoContrato<L> = { vigente: L | null; vivos: L[]; doisContratosVivos: boolean; envioEmCurso: boolean };
export function envelopeVigente<L extends EnvelopeParaEscolher>(linhas: readonly L[]): VigenciaDoContrato<L>;

// apps/hub/lib/assinatura/envelope-na-venda.ts
export type MudancaDoEnvelope = {
  envelope: { fechadoEm: null | string; finalidade: null | string; id: string; origem: "c2x" | "panteon";
              propostaId: null | string; provedor: Provedor; signatarios: ItemDoQuadro[] };
  estadoAntes: EstadoDaAssinatura | "novo";
  estadoDepois: EstadoDaAssinatura;
};
export type EfeitoNaVenda = {
  card: "andou" | "ja_estava" | "nada" | "recusado";
  dataDeAssinatura: "falhou" | "gravada" | "ja_tinha" | "nao_se_aplica" | "sem_data_real";
  motivo: string; // ids e regra, nunca nome
};
export type OpcoesDoEfeito = { moverVendas: boolean };   // constante no código; o script liga com --mover-vendas
export async function aplicarEnvelopeNaVenda(sb: SupabaseClient, mudanca: MudancaDoEnvelope, opcoes: OpcoesDoEfeito): Promise<EfeitoNaVenda>;
/** Idempotente: contrato assinado de venda nativa viva cujo card ainda não chegou ou cuja data falta. */
export async function reconciliarVendasAssinadas(sb: SupabaseClient, opcoes: OpcoesDoEfeito & { limite: number }): Promise<{ refeitas: number; puladas: Record<string, number> }>;
/** Puro. Clicksign: a última assinatura de comprador/cônjuge do quadro, senão fechadoEm. D4Sign: fechadoEm (a última de todos). */
export function inicioDoArrependimento(provedor: Provedor, signatarios: readonly ItemDoQuadro[], fechadoEm: null | string): null | string;
/** Puro: o dia (YYYY-MM-DD) em Brasília de um instante, por diaEmBrasilia. */
export function diaDaAssinatura(instante: null | string): null | string;
```

**Testes vitest**

- `envelope-vigente.test.ts`: assinado vence um vivo mais novo (`doisContratosVivos`); o vivo enviado
  mais recente; rascunho sem `envelope_id` segura mas não é vigente; Clicksign `parcial` + D4Sign
  `aguardando` → `doisContratosVivos`; `envio-db.test.ts` verde pela reexportação.
- `envelope-na-venda.test.ts`: D4Sign `novo → parcial` com card em Análise → card para `assinatura`
  (origem `espelho_d4sign`) e venda `contrato → assinatura`; `aguardando → parcial` → nada (não é
  borda); card já em `assinatura` → nada, sem regravar `estagio_desde`; comparar-e-trocar: o card que
  andou entre a leitura e o update não volta; `finalidade` distrato → nada; proposta da carga →
  nada; venda desfeita → `recusado`; **venda com `cancelamento_pedido_em` → nada, com motivo**;
  `moverVendas = false` → nada; `assinado` sem `fechadoEm` nem data do comprador → `sem_data_real`;
  `assinado` D4Sign → `arrependimento_inicio = fechadoEm`; Clicksign → última de comprador/cônjuge;
  `data_assinatura` só se nula e só em nativa; 23:30-03:00 → o próprio dia.
- `reconciliar.test.ts`: o efeito que falhou depois da RPC é refeito na rodada seguinte, uma vez.
- `fatos-do-contrato.test.ts`: frase com "na D4Sign" e "na Clicksign"; envelope de distrato assinado
  não vira "contrato assinado".

**Prova (SELECT):** quando o primeiro contrato fechar, `select id, etapa, data_assinatura from
hercules_propostas where id = '<proposta>'` e `select de, para, origem, quando from
temis_trabalho_etapas where proposta_id = '<proposta>' order by quando` (uma passagem por borda, sem
repetição).

### F3 · O espelho da D4Sign (ensaio, carga inicial, cron, e só então o movimento das vendas)

**Objetivo.** `temis_envelopes` passa a ter uma linha `provedor = 'd4sign', origem = 'c2x'` por
documento que o C2X mandou para a D4Sign, de unidade que o Panteon tem, com estado do catálogo, quem
assinou do `/list` e a finalidade pelo tipo do C2X, ligada à venda pelo casamento da seção 3. As
telas deixam de chamar a D4Sign. Detalhe na seção 6.

**Pré-requisitos (na mesma fatia, antes de qualquer `--gravar`):**
- toda ação da Clicksign lê com `.eq('provedor', 'clicksign')`: `trocar-signatario.ts:557` e a
  conferência de `:640-647` (já na F1), `assinatura-servico.ts:77`, `diario-do-envelope-db.ts:211`
  (o diário da tela de trabalho é o da Clicksign; a presença de D4Sign aparece pela linha de estado de
  `envelopeVivoDaProposta`);
- o selo "x/y" do card (`trabalhos-db.ts:493-588`) passa a contar `assinado_em` do quadro do
  envelope que segura, dos dois provedores (sai da F6: sem isso o card da D4Sign levado a Em
  assinatura mostraria "0/N" até a F6);
- a cota da D4Sign confirmada pelo Lucas (F0).

| Ação | Caminho |
|---|---|
| criar | `apps/hub/lib/assinatura/espelho-d4sign/c2x.ts` (as três consultas, só SELECT, uma conexão, `START TRANSACTION READ ONLY`, `timeout` 20 s) |
| criar | `apps/hub/lib/assinatura/espelho-d4sign/casamento.ts` (puro, seção 3) |
| criar | `apps/hub/lib/assinatura/espelho-d4sign/quadro.ts` (puro: quadro do C2X com `chave = c2x:<ss.id>`, papel, marcas da D4Sign já com a chave do item pareado) |
| criar | `apps/hub/lib/assinatura/espelho-d4sign/finalidade.ts` (puro: `FINALIDADE_POR_TIPO_DO_C2X`, escrita depois de o ensaio listar os `contract_type` encontrados; tipo fora da lista → `null`) |
| criar | `apps/hub/lib/assinatura/parear-pessoas.ts` (puro: pareamento 1-para-1 e-mail → nome sem acento → sobra única, extraído de `casarAssinantes`, `d4sign-assinaturas.ts:228`, que passa a delegar) |
| criar | `apps/hub/lib/hercules/terreno.ts` (puro: a união pai + filho + glebas de `situacao-da-unidade.ts:456-484`, extraída; a régua passa a importar, sem mudar comportamento, com os testes dela verdes) |
| criar | `apps/hub/lib/assinatura/espelho-d4sign/espelho.ts` (o orquestrador, cron e script) |
| criar | `apps/hub/app/api/assinatura/d4sign/espelho/route.ts` |
| criar | `apps/hub/lib/apolo/autorizar-sync.ts` (move `authorizeApoloSyncRequest` de `app/api/apolo/sync/c2x/route.ts:80` e cria `cronPeloSegredo`: `timingSafeEqual`, segredo vazio recusa) |
| alterar | `apps/hub/lib/guardian/d4sign-consulta.ts` (exporta `disjuntorD4SignAberto()`; 429 vira `motivo: "cota"` e não conta como falha comum) |
| alterar | `vercel.json` (`{ "path": "/api/assinatura/d4sign/espelho", "schedule": "7,37 * * * *" }`, só com OK) |
| criar | `scripts/temis/espelhar-d4sign.mjs` (carrega `espelho.ts` pelo `jiti` com `alias: { "@": <abs>/apps/hub }`; reserva `npx tsx --tsconfig apps/hub/tsconfig.json`) |
| **não muda** | `apps/hub/proxy.ts` (o proxy já deixa passar `/api` com Bearer; a rota autentica por dentro) |

```ts
// espelho-d4sign/c2x.ts
export type EnvioDoC2x = {
  arId: number; contractType: null | string; csId: number; criadoEm: string /* ISO com -03:00 */;
  enterpriseCode: string; enterpriseId: string; ordenada: boolean; statusC2x: null | number;
  unidadeC2xId: number; uuidDoc: string;
};
export type PessoaDoC2x = {
  csId: number; email: null | string; linhaId: number; nome: string; papelNoEmpreendimento: null | string;
  perfilC2x: null | string; posicao: number; usuarioC2xId: null | number;
};
export async function lerEnviosDoC2x(conexao: PoolConnection): Promise<EnvioDoC2x[]>;
export async function lerPessoasDosEnvios(conexao: PoolConnection, csIds: readonly number[]): Promise<Map<number, PessoaDoC2x[]>>; // IN em lotes de 500
/** SÓ para os envios candidatos às regras 2 e 3: ar.id → dígitos do documento do comprador. Em memória; nunca gravado, logado nem devolvido. */
export async function documentosDosCompradores(conexao: PoolConnection, arIds: readonly number[]): Promise<Map<number, string>>;
export function instanteDeBrasilia(texto: null | string): null | string;

// espelho-d4sign/casamento.ts (seção 3)
export type PropostaCandidata = {
  canceladaEm: null | string; criadoEm: string; documentoDoComprador: string /* só dígitos, em memória */;
  etapa: string; id: string; origem: "c2x" | "panteon"; origemC2xId: null | number; unidadeId: string;
};
export type CasamentoDoEnvio =
  | { propostaId: string; regra: "ar_da_carga" | "ar_da_carga_no_pai" | "nativa_do_mesmo_comprador"; unidadeId: string }
  | { candidata: null | { propostaId: string; motivo: "nativa_depois_do_envio" | "comprador_diferente" | "ar_da_carga_com_nativa_viva" };
      propostaId: null; regra: "sem_venda"; unidadeId: string }
  | { propostaId: null; regra: "sem_unidade"; unidadeId: null };
export function casarEnvioComAVenda(
  envio: Pick<EnvioDoC2x, "arId" | "criadoEm">,
  contexto: { documentoDoCompradorNoC2x: null | string; propostaDoAr: null | PropostaCandidata;
              propostasDoTerreno: readonly PropostaCandidata[]; unidade: null | { espelhoDe: null | string; id: string } },
): CasamentoDoEnvio;

// espelho-d4sign/espelho.ts
export type OpcoesDoEspelho = {
  concorrencia: number;       // cron 3; script 1 (vazão fixa)
  intervaloMs: number;        // cron 0; script 2_000 entre chamadas à D4Sign
  gravar: boolean;            // cron true; script só com --gravar; POST só com ?gravar=1
  moverVendas: boolean;       // cron: constante MOVER_VENDAS no código (false até a prova da F3); script: --mover-vendas
  orcamentoMs: number;        // cron 240_000 (maxDuration 300); script Infinity
  tetoDeListas: number;       // cron 20; script: o recorte da carga inicial (seção 6)
  refazer?: boolean;          // só script
  so?: readonly number[];     // cs ids, até 50, para ensaiar um envio
};
export type RelatorioDoEspelho = {
  casamentos: Record<string, number>; candidatasNaoLigadas: number; comCancelamentoAberto: number;
  d4signFora: boolean; doisContratosVivos: number; duracaoMs: number; enviosNoC2x: number;
  estadosMudaram: number; falhas: string[] /* ids e códigos, nunca nome ou e-mail */;
  finalidadeNaoMapeada: Record<string, number>; gravou: boolean; inseridos: number;
  lidosPorTabela: Record<string, number>; naoPareados: number; pausadoPorCota: boolean;
  reconciliadas: number; restamEmMovimento: number; semUnidade: number; semUuid: number;
  status6: number; tiposDoC2x: Record<string, number>; vendasMovidas: number;
};
export async function espelharD4Sign(entrada: {
  admin: SupabaseClient; d4sign?: PortaDaD4Sign; opcoes: OpcoesDoEspelho; pool: Pool;
}): Promise<RelatorioDoEspelho>;

// app/api/assinatura/d4sign/espelho/route.ts
export const dynamic = "force-dynamic"; export const runtime = "nodejs"; export const maxDuration = 300;
export async function GET(request: NextRequest): Promise<NextResponse>;  // SÓ Bearer CRON_SECRET, timingSafeEqual
export async function POST(request: NextRequest): Promise<NextResponse>; // admin do Hub; ensaio salvo ?gravar=1; recusa refazer e teto infinito; so = até 50 inteiros; loga quem disparou (id)
```

**Testes vitest**

- `casamento.test.ts`: todas as regras e casos da seção 3, incluindo VOC0306/VOL1106 (nativa
  cancelada antes do envio não casa), comprador diferente não casa, nativa do filho aceita na regra 2
  (as 3 nativas VOC/VOL/VOR com reserva da carga na sombra do VLO), nativa criada depois do envio vira
  candidata e não liga, terreno pela união da régua (gleba irmã).
- `quadro.test.ts`: `perfilDeTela` (Huber 2544 → Coordenadora de venda); `chave = c2x:<ss.id>`;
  pareamento e-mail → nome → sobra; **dois itens com o mesmo e-mail e um assinado na D4Sign dão UMA
  marca, com a chave do item pareado**; e-mail vazio pareado pelo nome recebe a marca; as chaves de
  saída das marcas são só `chave`, `email`, `assinadoEm`, `recusadoEm`.
- `c2x.test.ts`: `instanteDeBrasilia` (23:30 de Brasília = 02:30Z do dia seguinte); o arquivo só
  contém `select` (sem `for update`, `insert`, `update`, `delete`); transação READ ONLY aberta.
- `espelho.test.ts` (portas falsas): rodízio por `tentado_em` asc com nulos antes, e falha também
  grava `tentado_em`; recuo por idade; teto; documento que o catálogo dá como finalizado **e está
  ligado a venda nativa** só vira `assinado` junto com o `/list` (se o `/list` falhar, o estado não
  muda nesta rodada); 429 → para a rodada, grava `d4sign_pausada_ate` e relata; status 6 do C2X →
  `cancelado` (salvo finalizado na D4Sign); documento que sumiu do catálogo não vira cancelado;
  `sem_unidade` não é inserido; inserção por linha (um 23505 não derruba as outras); a vez da
  rodada: duas rodadas juntas, a segunda sai sem fazer nada; `moverVendas = false` não chama
  `aplicarEnvelopeNaVenda`; o efeito da inserção vale só para linhas que o insert devolveu; nenhuma
  chamada de `delete`; o relatório e o console não contêm `tokenAPI`, `cryptKey`, `@` nem 11 dígitos
  seguidos; leitura do Panteon paginada com ordem e `.in()` em lotes de 100 (teste com 2.500 ids).
- `route.test.ts`: sem Bearer → 401; só `x-vercel-cron` → 401; Bearer errado → 401; `CRON_SECRET`
  vazio → 503; Bearer certo → roda; POST com `refazer` → 400.

**Prova em produção (SELECT), depois do `--gravar` e antes do cron**

```sql
select provedor, origem, finalidade, estado, count(*) n, count(proposta_id) com_proposta,
       count(fechado_em) com_fechamento, min(conferido_em)::timestamp(0) de, max(conferido_em)::timestamp(0) ate
  from temis_envelopes group by 1,2,3,4 order by 1,2,3,4;
select count(*) from temis_envelopes where provedor='d4sign' and unidade_id is null;  -- 0 (sem_unidade não entra)
select count(*) from temis_envelopes e, jsonb_array_elements(e.signatarios) s
 where s ?| array['cpf','documento','user_document','sign_info','ip','geo','latitude']; -- 0
-- as nativas ligadas, com a regra que ligou (o relatório do ensaio traz a regra e se o comprador bateu)
select p.empreendimento_codigo, p.etapa, e.estado, e.finalidade
  from hercules_propostas p join temis_envelopes e on e.proposta_id = p.id
 where p.origem = 'panteon' and e.provedor = 'd4sign';
-- dois contratos vivos para a mesma venda
select proposta_id, array_agg(provedor), count(*) from temis_envelopes
 where proposta_id is not null and finalidade = 'contrato'
   and estado in ('aguardando','parcial','desconhecido','rascunho') group by 1 having count(*) > 1;
-- assinado ligado a nativa sem data real: 0
select count(*) from temis_envelopes e join hercules_propostas p on p.id = e.proposta_id
 where p.origem = 'panteon' and e.estado = 'assinado' and e.fechado_em is null;
-- depois do cron: a campainha
select ultima_rodada_ok_em, d4sign_pausada_ate, relatorio from temis_espelho_d4sign;
```

**Ordem:** ensaio → OK → `--gravar` (sem mover vendas) → prova → OK → cron → prova de uma rodada
(chegou com Bearer) → OK → `--mover-vendas` (e `MOVER_VENDAS = true` num deploy) → prova da F2.

**Rollback:** tirar o cron; `MOVER_VENDAS = false`; as linhas ficam paradas (nenhuma tela lê antes da
F4). Apagar só com OK: `delete from temis_envelopes where provedor = 'd4sign' and origem = 'c2x'`.

### F4 · A leitura única, no Hércules e no portal

**Objetivo.** `/api/incorporador/vendas/assinaturas` (sub-abas Assinatura e Resumo da TelaContratos,
`AssinaturasDoProduto`, pílula Contratos da `TelaVendas`) e `/api/incorporador/vendas/contratos`
passam a ler `lerContratosDoPanteon`. Sai o C2X (salvo a exceção da pergunta 1), sai a D4Sign ao vivo,
sai o `after(aquecer...)`. O payload continua `QuadroDeAssinaturas`.

**Trava da F4 (antes do deploy):** `scripts/temis/comparar-leitura-de-assinaturas.mjs` (só leitura:
o leitor antigo contra o C2X e o novo contra o Panteon), por empreendimento e por categoria, com a
saída anonimizada virando fixture de um vitest. Categorias: venda viva no C2X (estágios 3/4/5/6) sem
proposta no Panteon (0.19); produto sem venda no Panteon (GDN, 0.18); envio de venda desfeita; status
6; envio sem `uuidDoc`; tipo do C2X não mapeado; `temContrato`; degrau e perfil; mesma venda em duas
glebas (0.30); nativa ligada. **Critério: "inexplicado = 0"** e cada categoria explicada com a regra
ou a resposta do Lucas.

| Ação | Caminho |
|---|---|
| criar | `apps/hub/lib/assinatura/contratos-do-panteon.ts` (leitura das duas views e das unidades do terreno, `.in()` em lotes de 100, paginada com ORDER) |
| criar | `apps/hub/lib/assinatura/contratos-do-panteon-montagem.ts` (puro: monta e adapta para o quadro) |
| alterar | `apps/hub/app/api/incorporador/vendas/assinaturas/route.ts:94-166` (leitura única; a exceção da pergunta 1 por lista explícita de códigos, se o Lucas mantiver) |
| alterar | `apps/hub/app/api/incorporador/vendas/contratos/route.ts` (usa `contratosDoPortal`) |
| alterar | `apps/hub/lib/apolo/incorporador/escopo.ts` (`idsDosCodigosNoCadastro(cadastro, catalogo, codes, idsDaSessao)`: o id pelo cadastro; o catálogo do C2X só de reserva para ACT, SDT e TSC; **catálogo fora do ar não derruba a tela**: segue com o cadastro e esses três ficam de fora com aviso interno) |
| alterar | `apps/hub/lib/apolo/incorporador/contrato.ts:40-60` e a rota do PDF (aceita `contratoId` = id do envelope do Panteon; confere o escopo pela unidade e baixa exatamente aquele `provedor_documento_id`; sem C2X) |
| alterar | `apps/hub/lib/apolo/d4sign-assinaturas.ts:66` (`FonteDaAssinatura` + `"panteon"`) |
| alterar | `AssinaturasDoProduto.tsx:2234-2252` (a sub-aba Resumo lê os totais que o servidor calcula antes do teto de 500, e não `unidades.length`) |

```ts
// apps/hub/lib/assinatura/contratos-do-panteon.ts
export type EscopoDosContratos =
  | { enterpriseIds: readonly string[] } | { propostaIds: readonly string[] } | { unidadeIds: readonly string[] };
export type LeituraDosContratos = { contratos: ContratoDoPanteon[]; lidoEm: string; ok: true; ultimaRodadaOkEm: null | string } | { erro: string; ok: false };
export async function lerContratosDoPanteon(entrada: {
  admin: SupabaseClient; escopo: EscopoDosContratos; workspaceId?: string;
}): Promise<LeituraDosContratos>; // falha de leitura = ok:false (503), nunca lista vazia

// apps/hub/lib/assinatura/contratos-do-panteon-montagem.ts (puro)
export type PessoaDoContrato = {
  assinadoEm: null | string; degrau: number /* 0 = sem ordem */; nome: string;
  papel: null | PapelNoContrato; perfil: string; recusadoEm: null | string;
}; // SEM e-mail: o perfil é resolvido no servidor antes
export type EnvelopeDoContrato = {
  c2xContractSignatureId: null | number; conferidoEm: null | string; enviadoEm: null | string;
  estado: EstadoDaAssinatura; fechadoEm: null | string; id: string; origem: "c2x" | "panteon";
  pessoas: PessoaDoContrato[]; provedor: Provedor; provedorDocumentoId: null | string;
};
export type ContratoDoPanteon = {
  avisos: Array<"conferencia_atrasada" | "dois_contratos_vivos" | "envelope_sem_venda" | "contrato_de_venda_desfeita">; // INTERNO
  envelope: EnvelopeDoContrato | null; outrosVivos: EnvelopeDoContrato[]; // INTERNO
  proposta: null | { arC2xId: null | number; clienteNome: null | string; dataAssinatura: null | string;
    dataAto: null | string; dataFaturamento: null | string; etapa: string; geradoEm: null | string;
    id: string; imobiliariaNome: null | string; origem: "c2x" | "panteon"; precoTabela: number };
  situacao: SituacaoDaAssinatura;
  unidade: { c2xId: null | number; codigo: string; empreendimento: string; enterpriseId: string;
             id: string; lote: null | string; quadra: null | string; terrenoId: string };
};
export function montarContratosDoPanteon(linhas: {...}, agora: Date): ContratoDoPanteon[];
export function quadroDosContratos(contratos: readonly ContratoDoPanteon[], opcoes: { agora?: Date; interno: boolean }): QuadroDoPanteon;
export function contratosDoPortal(contratos: readonly ContratoDoPanteon[]): ContratosDoPortal;
export function quadroParaOPortal(quadro: QuadroDoPanteon): QuadroDoPortal; // ALLOWLIST (seção 5)
export function chaveNumerica(uuid: string): number; // negativa, 48 bits do uuid; não colide com cs.id nem ar.id
export function perfilDaPessoa(item: { email?: null | string; papel?: null | string; perfil?: null | string; origem: "c2x" | "panteon" }): string;
```

**Testes vitest**

- `contratos-do-panteon-montagem.test.ts`: as 8 vendas da Clicksign (anonimizadas) saem
  `em-assinatura` com as marcas por pessoa; VOC0306 sai `aguardando-emissao`; D4Sign `assinado` sem
  data por pessoa → todos assinados com `assinadoEm` nulo; degrau cru por provedor, sem ordem = 0;
  fila de recorte misto (Clicksign + D4Sign); na linha da Têmis o papel vence o e-mail da casa (a
  coordenadora continua "Coordenadora de venda"); `envioId` estável; unidade = `hercules_unidades.codigo`;
  proposta da carga no pai não aparece e nativa no pai aparece; `temContrato` = D4Sign vigente com
  documento, em qualquer estado (como hoje); envelope sem venda só com `interno: true`; contrato de
  venda desfeita conforme a pergunta 2.
- `route.test.ts` do portal: o JSON não contém `email`, `provedor`, `fonte`, `aviso` de linha,
  `documentoId`, `avisos`, `outrosVivos`, `contratoId` fora da linha, nem "C2X", "D4Sign", "Clicksign".
- a fixture do ensaio de paridade: as categorias explicadas.

**Prova (SELECT):** a contagem por empreendimento e etapa da view contra o cabeçalho da tela; os
casos do Lucas (VOC, VOL, VOR, ACP, LBF, REP, VAL) com o provedor e o estado. Validação visual pelo
Lucas **só nas telas de leitura** no dev server do worktree: o `.env.local` aponta para produção e
nenhuma ação da Têmis é clicada no worktree antes do OK.

**Rollback:** revert da rota (volta ao C2X + D4Sign; as funções antigas só saem na F7).

**Pedido de deploy da F4 (revisão de 28/09, depois da implementação):**
- a fixture `apps/hub/lib/assinatura/__fixtures__/paridade-das-leituras.json`, gerada com
  `comparar-leitura-de-assinaturas.mjs --fixture`, tem de estar COMMITADA, e a suíte roda com
  `PARIDADE_EXIGIDA=1` (sem a fixture o teste falha, em vez de ser pulado). Suíte verde sem a fixture
  não é a trava cumprida. O script só grava a fixture sem falha e sem corte no teto antigo;
- o ensaio roda com `--emp` em lotes pequenos até a cota da D4Sign estar confirmada: o primeiro 429
  para o laço, e o fim imprime quantas chamadas à D4Sign ele fez;
- diferença declarada e MEDIDA, para o Lucas: na venda da carga, "gerado em" passa a ser a primeira
  passagem para `contrato` (a carga só tem essa passagem em 395 de 2.464 vendas vivas com contrato).
  O ensaio conta `geradoEmPerdido` por empreendimento e o `tempoMedio` dos dois lados por código;
- a linha sem venda vale o envelope vivo MAIS RECENTE da unidade (e não "o assinado vence"): unidade
  revendida mostra o contrato do comprador atual; o do anterior fica interno. A venda "aguardando
  emissão" só sai do portal para o envelope do terreno quando o envio é DEPOIS da criação da venda;
- a F4b (a ficha da venda: data do envio e "N de M assinaram") NÃO foi feita nesta fatia: a v1.389.0
  cobre só o rótulo "Enviado para assinatura". O Zeus decide com o Lucas se fica assim ou entra.

**⚠️ A MAIN ANDOU (28/09/2026, 14:43): v1.389.0, correção rápida já NO AR** (branch
`fix/assinatura-hercules-rapida`, commit `795e60c3`). Ela fez, no caminho ANTIGO, parte do que a F4
faz: a rota lê `lerAssinaturasDoPanteon` em todo código; `unirComOPanteon` (assinaturas.ts) casa o
legado com o Panteon por `hercules_unidades.codigo` e tira UMA linha aguardando por venda; as linhas
do Panteon têm quem assinou pelo último payload conferido (`assinaturasDoPayload`) e a vez pelo menor
degrau; `perfilNaLista` alinha "Coordenadora de venda"/"Corretor"; a ficha diz "Enviado para
assinatura" (fluxo-de-venda `dataDaEtapa`), o que JÁ cobre a F4b. O contador x/y do Board do
comercial NÃO subiu (902 kB por carga medidos): continua na F6. A F4 tem de partir dessa versão
(merge da main no branch antes de mexer na rota) e substituí-la pela leitura única, mantendo os
testes novos de `unirComOPanteon` e de pessoa a pessoa como critério de paridade.

**F4b · A ficha da venda (Hércules › Venda) diz a data certa.** Lucas, 28/09/2026, com o print da
VOL 11 06 (venda nativa, Clicksign enviada em 25/09, 2 de 11 assinaram): a ficha lateral diz "Data
da assinatura 25/09/2026", que é a data do ENVIO. Causa: `dataDaEtapa`
(`apps/hub/lib/hercules/fluxo-de-venda.ts:590-593`) cai em `etapa_desde` quando `data_assinatura` é
nula, e o rótulo vem de `TelaVenda.tsx:492`. Conserto nesta fatia:
- em `assinatura`, a data mostrada é a do fato: com contrato assinado, `data_assinatura` (ou o
  `fechado_em` do envelope vigente); sem, a linha vira "Enviado para assinatura" com o `enviado_em`
  do envelope vigente e o progresso "N de M assinaram" (da mesma leitura única, sem e-mail);
- nunca `etapa_desde` com o rótulo "Data da assinatura";
- teste vitest com a VOL 11 06 anonimizada (envelope parcial 2/11 → "Enviado para assinatura",
  25/09, "2 de 11").
E a aba Assinatura do Hércules, recorte Vale do Ouro, tem que listar a VOL 11 06 (hoje "0 de 185"
para "1106"): é o critério de aceite visual da F4, junto dos outros 7 contratos da Clicksign.

### F8 · O Faturado anda sozinho (a regra do Lucas de 09/09, executada) — DESENHAR DEPOIS DA F6

Medido em 28/09 (SELECT): 415 vendas da carga estão em `etapa = 'assinatura'` no Panteon, 414 com
`data_assinatura` (CDJ 375, ACT 26, ACP 7, VOL 2, VOC 2, VDO 1, JDG 1, RVP 1). No Vale do Ouro são 4
(VOC0305, VOC0522, VOL0221, VOL0303, assinadas entre 29/08 e 21/09) que a grade pinta de "Assinatura"
ao lado das 7 nativas de fato em assinatura. E nada leva venda nativa assinada a Faturado. A regra
já está escrita (`docs/operations/temis-redesenho-decisoes.md:28-33`, memória
`reference_temis_regra_de_faturamento`): 7 dias da última assinatura de comprador E entrada paga →
Faturado; "pagamento de venda será alimentado temporariamente pelo c2x, igual temos hoje na carteira
do apolo". Esta fatia: a data da assinatura sai do envelope (F1/F3), a entrada paga sai da carteira
(leitura financeira do C2X, a mesma do Apolo), e a venda (nativa pelo card da Têmis; da carga direto
na etapa, com passagem registrada) anda de `assinatura` para `faturado`. Antes de mover qualquer
venda: ensaio com a lista de quantas andariam por empreendimento, para o Lucas conferir.

### F5 · Apolo Contratos interno (baixa prioridade)

Por decisão do Lucas o painel clássico, o BI público `/publico/assinaturas` e o painel público do
coordenador **não migram** (continuam como estão até alguém decidir desligá-los). Fica só o Apolo
Contratos interno, que o time pouco usa:

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/lib/apolo/assinaturas/painel-contratos.ts:189-470` (lista de empreendimentos do cadastro, com o mesmo fallback de `idsDosCodigosNoCadastro` para ACT, SDT e TSC; contagem pela view; `quadroDosContratos(..., { interno: true })`) |
| alterar | `apps/hub/app/api/apolo/painel-contratos/route.ts` (sai o `after(aquecer...)`) |
| alterar | `apps/hub/modules/apolo/blocks/assinaturas/painel-contratos.tsx:870, 1217, 1404-1414` (mostra o `aviso` da linha; **a coluna de e-mail sai**: a regra do brief vale também para a tela interna, e o perfil já vem resolvido do servidor) |

Diferença esperada: a tela interna deixa de mostrar e-mail (hoje mostra). Testes: `painel-contratos.test.ts`
e `nucleo.test.ts` com o adaptador novo e sem e-mail no payload.

### F6 · Board do comercial e diário

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/lib/temis/trabalhos-db.ts:600-700` (`historicoDosEnvelopes` deixa de ler payload no Board: "convite não entregue" sai de `convite_falhou_em > convite_entregue_em` do quadro) |
| alterar | `apps/hub/app/api/incorporador/contratos/route.ts:126` (`comAssinaturas: true`: o Board do comercial ganha o "x/y", sem ler payload) |
| alterar | `apps/hub/lib/assinatura/diario-do-envelope-db.ts:347-390` (`juntarComOsCongelados` prefere o `assinado_em` gravado; payload só `assinatura_conferida = true`) |
| alterar | `modules/temis/blocks/trabalho/tela-de-trabalho.tsx` (aviso "dois contratos em assinatura para a mesma venda") |

Custo medido (crítica): hoje o Board baixa ~2,2 MB de payload a cada 60 s por aba aberta
(`temis-kanban.tsx:279`). Depois da F6, nenhum Board lê payload. Prova: o selo contra
`select proposta_id, estado, (select count(*) from jsonb_array_elements(signatarios) s where
nullif(s->>'assinado_em','') is not null) from temis_envelopes where finalidade = 'contrato'`.

### F7 · Limpeza

Depois de F4 no ar e de uma semana sem "conferência atrasada": apagar do caminho das telas
`lerAssinaturasDoPortal`, `lerAssinaturasDoPanteon`, `linhasDeAssinaturaDoPanteon`,
`somarAssinaturasDoPanteon`, `montarQuadroComD4Sign`, `aquecerD4SignEmSegundoPlano` e o laço de
`conciliando`; `lerContratosVivos`/`lerContratosDoPortal` só se nenhum outro leitor os usar (grep:
os links públicos fora do escopo ainda usam). `consultarDocumentoD4Sign` e `carregarCatalogoD4Sign`
ficam (espelho). Apagar arquivo é do Zeus. Junto de `linhasDeAssinaturaDoPanteon` sai o teste dela
"a data de assinatura da proposta também conta" (assinaturas-do-panteon.test.ts): a leitura única diz
o contrário de propósito (a linha é o envelope), travado em contratos-do-panteon-montagem.test.ts.

---

## 2. Os leitores, um a um

| # | Leitor | Onde entra | O que muda, ou por que fica |
|---|---|---|---|
| 1 | Hércules › Contratos › sub-aba ASSINATURA | **F4** | Troca de fonte; é a tela do caso. |
| 2 | Hércules › Contratos › sub-aba RESUMO | **F4** | Mesmo payload; totais calculados antes do teto. |
| 3 | Hércules › Contratos › BOARD | **F3 + F6** | F3 move o card das nativas da D4Sign e conta o selo por `assinado_em`; F6 dá o "x/y" ao Board do comercial sem payload. |
| 4 | Portal › Vendas › pílula CONTRATOS (TelaVendas) | **F4** | Mesma rota da 1. |
| 5 | Vendas › RESUMO e PIPELINE | depois (ganha com F3) | A coluna do funil é a régua; comprador, BI de faturadas e "Faturado em" são leitura de VENDA do C2X. |
| 6 | Hércules › VENDA (trilha, VGV, histórico) | depois (ganha com F3) | Etapa pelo reflexo. |
| 7 | Ficha do produto › RESUMO | depois (ganha com F3) | Régua única. |
| 8 | Hércules › PRODUTOS | depois (ganha com F3) | "Vendido" depende do Faturado (Fora). |
| 9 | Pedido de cancelamento (cancelamento × distrato) | **F2 + F3** | `lerFatosDoContrato` passa a ler só finalidade contrato; F3 liga a D4Sign pela venda certa; F2 grava `data_assinatura`. |
| 10 | Carteira e Financeiro: Faturado e "Abrir contrato assinado" | depois | Financeiro; PDF da Clicksign não guardado. |
| 11 | CRM › Documentos e estágio | depois | Idem. |
| 12 | Apolo interno › CONTRATOS | **F5** (baixa) | Troca de fonte, sem e-mail. |
| 13 | Painel clássico + BI público `/publico/assinaturas` | **fora** | Decisão do Lucas: não migra. Oferta: desligar. |
| 14 | Painel público do coordenador | **fora** | Idem. |
| 15 | Têmis interna + board do Cecílio | **F3 + F6** | Card anda pela D4Sign; contador dos dois provedores; aviso de dois contratos. |
| 16 | Hades › ficha do cliente | depois | Frente do Hades. |
| 17 | Apolo CRM 360 e Empreendimento › Carteira | depois | Mesmo motivo da 10. |
| 18 | CACÁ | depois | Voltada para fora. |
| 19 | Prometeu (central e jornada) | depois | Situação de VENDA pelo C2X. |
| 20 | BI público do Vale do Ouro | depois | Idem 19. |
| 21 | GLotes | depois | Só LOS/LOU. |
| 22 | Espelho público, masterplan, Unidades | depois (ganha com F3) | Régua única. |
| 23 | Hades › Visão geral (overview) | depois | Sem tela hoje. |
| 24 | `c2x_guardian_attendance_queue.metadata.units[].signedContractStatus` (`read-model-sync.ts:310`, `read-model.ts:510`, `AiCopilotDrawer.tsx:963, 974`: a IA do atendente, PropostasPanel, ClientDetailPanel) | depois | Espelho persistido do status do C2X, alimentado pelo cron do Hades. Trocar pela leitura única é da frente do Hades. |
| 25 | Iris Athena (`app/api/iris/athena/route.ts`, `lib/guardian/contract-reader.ts`) | depois | Responde sobre contrato D4Sign pelo C2X. |
| 26 | `lib/apolo/server.ts:2109, 2268` (`contractStatus`) | depois | CRM 360. |
| 27 | Indeferimento da venda (`indeferimento-na-venda-server.ts:428-455`) | **F2** | Frase por provedor e leitura só de contrato. |
| + | `/api/incorporador/vendas/contratos` (sem tela) | **F4** | `contratosDoPortal`. |

---

## 3. Casamento envelope D4Sign → unidade → proposta

**Passo 1, a unidade.** `ar.enterprise_unity_id` → `hercules_unidades.origem_c2x_id`. Sem unidade no
Panteon → **não é inserido** (conta em `semUnidade` no relatório; nenhuma tela o mostraria e é cópia
de dado pessoal sem finalidade).

**Passo 2, o terreno.** A união da régua (`lib/hercules/terreno.ts`, extraída de
`situacao-da-unidade.ts:456-484`): pai + filho + glebas com a mesma quadra e lote. A reserva no pai
(VLO) e a venda no filho (VOC/VOL) caem no mesmo terreno.

**Passo 3, a proposta, nesta ordem (a primeira que casa vence):**

1. `ar_da_carga`: proposta com `origem_c2x_id = ar.id` (qualquer etapa, inclusive cancelada ou
   distrato: aquele envio é daquela venda).
2. `ar_da_carga_no_pai`: se a proposta do passo 1 está numa linha-sombra do pai e o terreno tem venda
   viva com contrato no filho (da carga **ou nativa**) **do mesmo comprador**, liga à do filho.
3. `nativa_do_mesmo_comprador`: a proposta NATIVA do terreno, **não cancelada no instante do envio**
   (`cancelada_em` nula ou posterior ao envio), criada antes do envio, **com o mesmo comprador**
   (dígitos do documento do cliente do pedido no C2X = dígitos de `cliente_documento`, comparados em
   memória e descartados), a mais recente entre as que casam.
4. `sem_venda`: `proposta_id` nulo. Se houver uma candidata que não passou (nativa criada DEPOIS do
   envio, comprador diferente, ou `ar_da_carga` com nativa viva no mesmo terreno), ela vai para o
   relatório como `candidata`, **nunca ligada sozinha**. Reavaliado a cada rodada.

O documento do comprador no C2X só é lido para os envios que chegam às regras 2 e 3 (consulta 3 da
seção 6, poucos por rodada), nunca é gravado, logado nem devolvido. **Uma vez ligado, não se religa
sozinho**: troca de vínculo é correção assistida. O ensaio lista cada ligação com a regra usada e se
o comprador bateu.

**Casos de borda (todos viram teste em `casamento.test.ts`)**

| Caso | Resultado |
|---|---|
| Reserva no pai (VLO0306) e venda no filho (VOC0306) com envio da D4Sign | Mesmo terreno; regra 3 acha a nativa viva do mesmo comprador. |
| VOC0306 e VOL1106: nativa cancelada (criada 16/09 e 15/09, cancelada 21/09) e nativa viva (21/09, 24/09) | Envio depois de 21/09: a cancelada está fora (cancelada antes do envio) e liga à viva se o comprador bate. Envio entre a criação e o cancelamento da primeira: liga à primeira se o comprador bate (é a venda daquele contrato). |
| Contrato antigo de venda cancelada | Regra 1 liga à proposta morta. Não é vigente de linha viva; o que a tela faz com ele é a pergunta 2. |
| Venda redigitada (nativa + pedido novo no C2X depois de 21/09) | Regra 3. |
| Pedido redigitado antes de 21/09 que a carga importou (duplicata da nativa) | Medido 0 (0.9). O ensaio conta `ar_da_carga_com_nativa_viva`; se aparecer, o Zeus decide antes do `--gravar`. |
| Reserva da carga na sombra do VLO + nativa viva no filho (VOC, VOL, VOR: 3 casos medidos pela crítica) | Regra 2 aceita a nativa do filho, se o comprador bate. |
| Nativa criada depois do envio | `sem_venda` com candidata `nativa_depois_do_envio`; a venda mostra "aguardando emissão" até correção assistida. |
| Envio sem `uuidDoc` | Não é espelhado (sem documento na D4Sign). Contado em `semUuid`; diferença declarada (seção 5). |
| O mesmo `cs.id` com `uuidDoc` novo | Linha nova (a unicidade é do documento); a velha fica com o último estado da D4Sign. |
| Status 6 do C2X | `cancelado` com `estado_cru 'c2x:6'`, salvo se a D4Sign disser finalizado. |
| Unidade que o Panteon não tem | Não inserido (`semUnidade`). |

---

## 4. O envelope vigente por proposta, e o aviso de dois contratos vivos

**Uma régua só** (`lib/assinatura/envelope-vigente.ts`, F2), com `seguraOEnvio` como base e só entre
envelopes de `finalidade = 'contrato'` (a view já filtra):

1. Ordena por `criado_em` desc (nas linhas do espelho, `criado_em` = envio no C2X).
2. Existe `assinado` → o vigente é o assinado mais recente.
3. Senão, o mais recente que segura e foi enviado (`envelope_id` ou `enviado_em`).
4. Rascunho que segura sem `envelope_id`: não é vigente; `envioEmCurso = true`.
5. `doisContratosVivos` = assinado + outro vivo, ou dois vivos, de qualquer provedor.

Diferença aceita: o rascunho com `envelope_id` conta como "em assinatura" (é o que a guarda diz).

**Quem usa:** a leitura única, a volta para correção, a conclusão do cancelamento, o indeferimento,
o contador do card e `envelopeVivoDaProposta`. A guarda do envio (`impedimentoDeEnvelopeVivo`)
continua sem filtro de provedor: com a D4Sign ligada à venda nativa (pelo mesmo comprador), a Têmis
recusa mandar pela Clicksign um contrato que já está vivo na D4Sign, e a frase diz o caminho.
Consequência da decisão "anda sozinho": o contrato da D4Sign é o contrato daquela venda.

**O aviso "dois contratos em assinatura para a mesma venda"** aparece na tela de trabalho da Têmis,
no Apolo Contratos e no relatório do espelho (só ids). Nunca no portal.

---

## 5. O formato de saída para as telas

**Reuso.** A leitura monta as mesmas entradas de `montarQuadroDeAssinaturas` (`assinaturas.ts:350`).
`UnidadeDeAssinatura`, `KpisDeAssinatura` e `QuadroDeAssinaturas` não mudam de forma.

| Campo | De onde sai |
|---|---|
| `unidade` | `hercules_unidades.codigo` ("VOC0306"); nunca `unidade_nome`. |
| `empreendimento` | código do cadastro para o `enterprise_id` da unidade. |
| `envioId` | D4Sign: `c2x_contract_signature_id`. Clicksign: `chaveNumerica(id)`. 0 = sem envio. |
| `arPorEnvio` / `ContratoVivo.arId` | carga: `ar_c2x_id`; nativa: `chaveNumerica(proposta_id)`. |
| `enviadoEm`, `diasDesdeEnvio` | `enviado_em`, dia por `diaEmBrasilia`. |
| esquema por pessoa | `assinou = assinado_em preenchido OU envelope assinado`; `assinadoEm` = `diaEmBrasilia` (nulo se o provedor fechou e a data da pessoa não veio). |
| `degrau` | **a ordem crua do provedor**: Clicksign a `ordem` da Têmis (ligada ao papel: coordenadora 1, comprador/corretor 2, cônjuge/testemunha 3, vendedora 4/5, medido em 8 de 8), D4Sign o `after_position` do C2X. Sem ordem (Clicksign `ordenada = false` ou D4Sign sem posição) = **0**, como a tela já trata (`AssinaturasDoProduto.tsx:1549-1550, 1776`). Sem renumerar: renumerar misturava papéis no mesmo degrau quando faltava um passo. Num recorte misto, o degrau N quer dizer coisas diferentes em cada provedor (diferença declarada). |
| `perfil` | `perfilDaPessoa`: na linha da **Têmis o papel vence** (comprador/cônjuge → Comprador, vendedora → Incorporador, coordenadora → Coordenadora de venda, corretor → Imobiliária, testemunha → Testemunha, careli → Backoffice); na linha da **D4Sign**, o `perfil` gravado pela régua `perfilDeTela` (e-mail `@careli.adm.br` → Backoffice). |
| `contrato.temContrato` / PDF | **igual a hoje**: D4Sign vigente com documento, em qualquer estado. O botão leva `contratoId` (id do envelope do Panteon) e a rota baixa exatamente aquele documento, conferindo o escopo pela unidade. Clicksign: false (PDF não guardado; Fora). |
| `contrato.faturadoEm` | `data_faturamento` (previsão, paridade). |
| `contrato.geradoEm` | primeira passagem para `contrato`. |
| `fonte` | `"panteon"`. |
| `avisoDaFonte` | "conferência atrasada" quando `temis_espelho_d4sign.ultima_rodada_ok_em` tem mais de 2 h e o recorte tem linha da D4Sign (a campainha é a rodada, não cada envelope: o rodízio com recuo leva mais que 2 h por construção). No portal, o texto genérico (`AVISO_DE_ATUALIZACAO`). |
| `conciliando` | sempre `false`. |

**Diferenças esperadas (o ensaio de paridade conta cada uma):** (a) as 8 vendas da Clicksign saem de
"aguardando emissão" (7 para "em assinatura"; VOC0306 continua, pelo motivo certo); (b) as nativas
da D4Sign (ACP, LBF, REP, VAL×2) aparecem pela venda nativa, sem duplicar com o pedido redigitado;
(c) venda da carga desfeita no C2X depois de 21/09 continua viva ("venda lê só o Panteon"); (d) um
vigente por venda; (e) o tempo médio perde amostra antiga (0.12); (f) envio sem `uuidDoc` deixa de
aparecer como contrato (hoje aparece com o aviso `semDocumento`); (g) envio de tipo do C2X não
mapeado (se houver) sai; (h) degrau cru em recorte misto; (i) contrato de venda desfeita conforme a
pergunta 2; (j) produtos sem venda no Panteon conforme a pergunta 1.

**O que nunca atravessa para o portal.** A saída é uma ALLOWLIST (`quadroParaOPortal`):
- linha: `assinadas, comprador, concluida, contrato{contratoId, faturadoEm, geradoEm, imobiliaria,
  temContrato, unitId, valorTabela}, empreendimento, enviadoEm, envioId, esquema[{assinadoEm,
  degrau, nome, perfil, situacao}], grupos, naVez, perfisNaVez, situacao, total, unidade`;
- quadro: `assinantes[{aguardandoAnteriores, assinou, naVez, nome, papel}], aviso` (teto),
  `avisoDaFonte` (texto genérico), `avisoDosAssinantes: null, fila, filtro, kpis, taxas, totais, unidades`.
- Nunca: e-mail, CPF, telefone, `provedor`, `fonte`, `aviso` de linha, `avisos`, `outrosVivos`,
  `documentoId`, `uuidDoc`, `provedorDocumentoId`, `estadoCru`, `conferidoEm`, e as palavras "C2X",
  "D4Sign", "Clicksign", "espelho" (Lucas, 18/08).
- Linha de envelope sem venda: **só na tela interna**, nunca no portal (não infla "Assinados").
- A tela interna do Apolo recebe provedor, aviso e `documentoId`, **sem e-mail** (F5).

---

## 6. O espelho da D4Sign

**As consultas ao C2X** (só SELECT, UMA conexão do pool de `lib/guardian/db.ts`, dentro de
`START TRANSACTION READ ONLY` e com `timeout` de 20 s por consulta, `COMMIT` e `release` no fim;
copiadas de `assinaturas.ts:920-964` e `contratos.ts:290-343`, sem `ss.signed`/`date_signed`):

```sql
-- (1) os envios, uma linha por envio (~4 mil linhas, < 1 s)
select cs.id                                   as cs_id,
       nullif(trim(cs.uuidDoc), '')            as uuid_doc,
       cs.contract_signature_status_id         as status_c2x,
       cs.contract_type                        as tipo_c2x,
       date_format(cs.created_at, '%Y-%m-%d %H:%i:%s') as criado_em_brasilia,
       arc.acquisition_request_id              as ar_id,
       coalesce(arc.is_to_use_position_to_sign, 0) as ordenada,
       ar.enterprise_unity_id                  as unidade_c2x_id,
       u.enterprise_id                         as enterprise_c2x_id,
       e.code                                  as enterprise_code
  from contract_signatures cs
  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
  join acquisition_requests ar on ar.id = arc.acquisition_request_id
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id
 where cs.send_document_signature = 1
   and e.id not in (?)            -- EXCLUDED_ENTERPRISE_IDS de lib/apolo/c2x-pelo-id.ts
 order by cs.id;
-- (sem o filtro de uuid: o envio sem documento é CONTADO em semUuid, e não espelhado)

-- (2) quem estava no envio: só para os envios NOVOS e para os em movimento cujo rol mudou
-- (contagem do /list diferente do quadro, ou estado cru "aguardando signatários"); IN em lotes de 500
select ss.contract_signature_id as cs_id, ss.id as linha_id,
       ss.user_name as nome, ss.email, ss.after_position as posicao,
       pf.name as perfil_c2x, usr.id as usuario_c2x_id,
       case
         when usr.id is not null and usr.id = e.coordenador_id then 'coordenador'
         when usr.id is not null and usr.id = e.manager_id then 'gerente'
         when usr.id is not null and usr.id = e.captivator_id then 'captador'
         else null
       end as papel_no_empreendimento
  from contract_signature_signers ss
  join contract_signatures cs on cs.id = ss.contract_signature_id
  join acquisition_request_contracts arc on arc.id = cs.acquisition_request_contract_id
  join acquisition_requests ar on ar.id = arc.acquisition_request_id
  join enterprise_unities u on u.id = ar.enterprise_unity_id
  join enterprises e on e.id = u.enterprise_id
  left join contract_signers csg on csg.id = ss.contract_signer_id
  left join signers sg on sg.id = csg.signer_id
  left join users usr on usr.id = sg.user_id
  left join profiles pf on pf.id = usr.profile_id
 where ss.contract_signature_id in (?)
 order by ss.contract_signature_id, ss.after_position, ss.id;

-- (3) o comprador, SÓ para os candidatos das regras 2 e 3 (poucos por rodada), em memória
select ar.id as ar_id, client.cpf as documento
  from acquisition_requests ar
  join users client on client.id = ar.client_id
 where ar.id in (?);
```

Por que o rol vem do C2X (e não só do `/list`): a D4Sign não devolve ordem nem perfil ("não existe
`order`, `sequence` nem `priority`", `d4sign-assinaturas.ts:212-230`), e sem eles não há "na vez",
"Parado com" nem taxa por perfil. É o registro do próprio envio ("achar o documento"); **quem
assinou e quando vem só da D4Sign**. Consta do pedido de OK do espelho (seção 9).

`created_at` do C2X é Brasília sem fuso e o pool fala UTC: sai como texto e vira ISO `-03:00` em
`instanteDeBrasilia`. Nunca `new Date` do driver.

**Uma rodada (cron e script usam o mesmo `espelharD4Sign`):**

0. **A vez.** `update temis_espelho_d4sign set em_curso_ate = now() + 5 min where id = 1 and
   (em_curso_ate is null or em_curso_ate < now())` com `.select()`: sem linha devolvida, outra rodada
   está no ar e esta sai (retry da Vercel, POST manual e cron juntos). `d4sign_pausada_ate` no futuro
   → só os passos que não chamam a D4Sign.
1. **Descobre** (C2X, consulta 1) e lê do Panteon as linhas `provedor = 'd4sign'` só com `id,
   provedor_documento_id, c2x_contract_signature_id, estado, estado_cru, proposta_id, unidade_id,
   conferido_em, tentado_em, criado_em` (paginado, ordem por `id`; o jsonb só dos que vão ao
   `/list`). Leituras do Panteon para o casamento (unidades por `origem_c2x_id`, propostas do terreno)
   em lotes de 100 com ordem e paginação; o relatório diz quantas linhas leu por tabela.
2. **Envio novo com unidade** → consulta 2, casamento (seção 3, com consulta 3 só para os candidatos),
   finalidade pelo `tipo_c2x` (`FINALIDADE_POR_TIPO_DO_C2X`; fora da lista → `null`, contado) e
   **insert por linha** (um erro não derruba os outros): `provedor 'd4sign', origem 'c2x',
   envelope_id = provedor_documento_id = uuidDoc, c2x_contract_signature_id, finalidade, nome =
   "Contrato <código da unidade> (D4Sign, envio <cs_id>)", unidade_id, proposta_id, enterprise_id =
   id do C2X, ordenada, signatarios = quadroDoEnvio(...) com chave c2x:<ss.id>, enviado_em =
   criado_em = criadoEm, estado inicial = 'desconhecido'`. Conflito no documento (outra rodada
   inseriu) → ignora. O efeito na venda desta inserção vale só para as linhas que o insert devolveu.
3. **Status.** Primeiro o C2X: status 6 → `cancelado` (`c2x:6`), salvo finalizado no catálogo. Depois
   o catálogo (`carregarCatalogoD4Sign`, 8 páginas, ~3 s): aguardando assinaturas → aguardando (a RPC
   deriva parcial das marcas); aguardando signatários → aguardando; cancelado → cancelado.
   **Finalizado**: se a linha está ligada a venda nativa, só entra junto com o `/list` do passo 4 (na
   mesma chamada da RPC, com `p_fechado_em = max(date_signed)`); se o `/list` falhar, o estado não
   muda nesta rodada e o documento fica no topo da próxima. Sem venda nativa, entra como `assinado`
   com `fechado_em` nulo até o `/list` trazer as datas. Documento que sumiu do catálogo não muda.
4. **Por pessoa pelo `/list`**, até o teto (cron 20): primeiro os finalizados ligados a venda
   nativa, depois os em movimento por `tentado_em asc nulls first`, com recuo por idade (envio sem
   mudança há mais de 30 dias: no máximo 1 vez por dia; há mais de 180 dias: 1 vez por semana).
   `tentado_em` é gravado em toda tentativa; `conferido_em` só no sucesso. `marcasDaD4Sign` pareia
   1-para-1 e manda à RPC a **chave do item pareado** com a data em -03:00 (`date_signed_atom` já vem
   assim). Rol diferente do quadro → consulta 2 e `p_quadro` casado pela chave. HTTP 429 → para o
   passo, grava `d4sign_pausada_ate = now() + 1 h`, relata `pausadoPorCota`.
5. **Efeito na venda** (seção 7): só com `moverVendas`, só na borda.
6. **Reconciliação** (seção 7): `reconciliarVendasAssinadas` com limite de 20 por rodada.
7. **Rede da Clicksign** (barata, rara): envelope da Clicksign `parcial` com todos os itens assinados
   e sem mudança há mais de 30 min → `consultarEnvelope` e, se `closed`, RPC com `assinado`.
8. **Fecha a vez**: `ultima_rodada_ok_em = now()` se os passos 1 a 3 deram certo, `em_curso_ate =
   null`, `relatorio` (só contagens e ids).

**Guardas**

- Nunca grava CPF, IP, geolocalização, user-agent nem `sign_info`; o documento do comprador da
  consulta 3 vive só em memória. Credencial da D4Sign só na query string de `d4sign-consulta.ts`.
- Logs e relatório só com ids, códigos e contagens (`code` e `message` dos erros do Supabase, nunca o
  objeto inteiro: o "Failing row contains (...)" traz o jsonb).
- Disjuntor (3 falhas → 60 s) interrompe o passo 4; catálogo nulo → nenhum estado da D4Sign na rodada.
- Orçamento: 240 s num `maxDuration` de 300 s; cada passo confere o que sobra e para com 20 s de folga.
- Falha não apaga: nenhum `delete`; estado só pela RPC; `proposta_id` preenchido não é trocado.

**Autenticação.** GET aceita só `Authorization: Bearer <CRON_SECRET>` comparado com
`timingSafeEqual`; `CRON_SECRET` vazio → 503. `x-vercel-cron` não vale. POST exige admin do Hub e é
ensaio salvo `?gravar=1`; recusa `refazer` e teto infinito (são do script); `so` só inteiros, até 50;
registra quem disparou. O `proxy.ts` não muda (0.28). Antes de ligar, conferir no log de UMA rodada
que a chamada da Vercel chegou com o Bearer.

**Frequência e custo.** A cada 30 min (`7,37 * * * *`). Por rodada: 1 a 3 consultas ao C2X (< 1 s),
8 páginas do catálogo e até 20 `/list`: **28 chamadas por rodada, ~1.350 por dia**, abaixo do que as
telas fazem hoje (8 + 20 por instância fria, várias vezes ao dia) e que a F4 tira. Com a cota
confirmada, o teto pode subir. Vercel: ≈ 0,3 GB-h/dia. Supabase: leitura estreita (sem jsonb do
acervo).

**Carga inicial por script** (`scripts/temis/espelhar-d4sign.mjs`, da raiz, de madrugada):

```
node scripts/temis/espelhar-d4sign.mjs                      # ENSAIO: lê C2X, catálogo e Panteon; /list numa amostra de 10; não grava
node scripts/temis/espelhar-d4sign.mjs --so 3806            # ensaio de um envio
node scripts/temis/espelhar-d4sign.mjs --gravar             # grava; 1 chamada a cada 2 s; NÃO move venda
node scripts/temis/espelhar-d4sign.mjs --gravar --mover-vendas   # depois da prova e do OK
node scripts/temis/espelhar-d4sign.mjs --gravar --refazer   # refaz o /list de quem já tem conferido_em
```

O `/list` da carga inicial vai só para: os em movimento; os finalizados ligados a venda nativa; os
finalizados de venda viva em contrato/assinatura; os envios dos últimos 120 dias. O resto do acervo
(terminal antigo) entra sem data por pessoa ("assinado sem data", já previsto). Estimativa: algumas
centenas de `/list` a 1 por 2 s, 10 a 20 min. Retomável (sem `--refazer`, pula quem já tem
`conferido_em`); 429 para o script. O ensaio imprime: envios no C2X, novos, `semUnidade`, `semUuid`,
status 6, **os `contract_type` encontrados** (para escrever `FINALIDADE_POR_TIPO_DO_C2X`), estados do
catálogo, casamentos por regra com "comprador bateu", candidatas não ligadas, pareamento, nativas com
cancelamento aberto (LBF), efeitos planejados na venda e dois contratos vivos.

---

## 7. Envelope → card da Têmis → etapa da venda, sem provedor

**Depois (F2), uma porta só: `aplicarEnvelopeNaVenda(sb, mudanca, opcoes)`.** Antes de tudo ela
confere, e qualquer "não" devolve `nada` com o motivo (só ids):
`opcoes.moverVendas`; `finalidade = 'contrato'`; proposta **nativa**; venda lida AGORA e viva (etapa
fora de `VENDA_DESFEITA`, `cancelada_em` nula); **`cancelamento_pedido_em` nulo** (a LBF, 0.21, fica
parada e vai ao relatório).

| Mudança | Regra |
|---|---|
| D4Sign, borda de entrada (antes `novo`, `rascunho` ou `desconhecido`; depois `aguardando`/`parcial`) e card de contrato antes de `assinatura` | `moverCardDaTemis(sb, propostaId, 'assinatura', null, null, 'espelho_d4sign', { somenteSeAndar: true })`: cada card com `.eq('estagio', lido)`; o reflexo leva a venda `contrato → assinatura`. Card já em `assinatura` ou adiante: nada (não regrava `estagio_desde`). |
| D4Sign `aguardando → parcial`, ou qualquer mudança que não seja borda | nada. |
| Clicksign `aguardando`/`parcial` | nada: o envio já moveu. |
| qualquer provedor → `assinado`, **com data real** (`fechado_em`, ou na Clicksign a data do comprador) | card antes de `assinatura` (D4Sign) vai para `assinatura` (comparar-e-trocar); depois `concluirAssinaturaDoCard(sb, propostaId, envelope)` com `.eq('estagio','assinatura')`: `prazo_legal`, `arrependimento_inicio = inicioDoArrependimento(provedor, quadro, fechado_em)`, passagem `webhook_assinatura` ou `espelho_d4sign`. Depois `data_assinatura = diaDaAssinatura(o mesmo instante)` com `.eq('origem','panteon').is('data_assinatura', null)`. |
| `assinado` sem data real | nada; `sem_data_real` no relatório; a reconciliação pega quando a data chegar. |
| `cancelado`/`expirado`/`recusado` | nada no card. |

**O prazo de 7 dias.** Clicksign: a última assinatura de comprador/cônjuge do quadro (o papel nunca é
nulo lá, medido), senão o fechamento. **D4Sign: o fechamento (a última assinatura de todos)**: lá só
o perfil "Cliente" vira Comprador, comprador sem usuário vira "Sem perfil" e corretor que compra vira
"Imobiliária", então escolher "o último comprador" pode começar o prazo cedo demais; começar no
fechamento nunca encurta um prazo que é do cliente.

**Reconciliação (toda rodada do espelho).** `reconciliarVendasAssinadas`: contrato `assinado` com
`fechado_em`, de venda nativa viva sem pedido de cancelamento, cujo card de contrato ainda está antes
de `prazo_legal` ou cuja `data_assinatura` está nula → reaplica o efeito (idempotente pelo
comparar-e-trocar e pelo `.is('data_assinatura', null)`). É o que cobre o `after()` do webhook que
morreu depois da RPC e o orçamento do cron que cortou entre a RPC e o efeito. O webhook sobe para
`maxDuration = 60`.

**Efeitos colaterais de mover o card (0.11):** só banco. Nenhuma notificação, WhatsApp, chamada ao
C2X ou gatilho.

**`data_assinatura`.** Decisão do Lucas (28/09): gravada na venda nativa quando o contrato fecha. Só
se nula, só nativa, dia em Brasília do instante real.

---

## 8. Os bugs do webhook, com o conserto (F1)

| # | Bug (medido) | Conserto |
|---|---|---|
| 8.1 | Regressão: `signature_started` depois de `sign` leva parcial → aguardando (13 eventos, 5 documentos). | Estado pela RPC, ordem estrita no banco; parcial derivado das marcas. E nenhum escritor por fora (0.25). |
| 8.2 | `envelope_id` nulo em 226 de 226 eventos. | Registro grava o da linha achada; carimbo preenche os que chegaram antes; `.dados.sql` conserta o passado. |
| 8.3 | `ultimaAssinaturaDeComprador` busca por `envelope_id` (sempre vazio) e trata como comprador quem não é vendedora. | `inicioDoArrependimento` sobre o quadro que a RPC devolve (seção 7). |
| 8.4 | `lerEventoDoWebhook` não lê `event.data.signer`. | `primeiroObjeto(raiz.signer, evento.signer, objeto(evento.data).signer, dados.signer)`. |
| 8.5 | `acharEnvelope` só roda para evento que move estado. | Roda para todo evento conferido; pelo metadata só adota linha sem documento. |
| 8.6 | `gravarTrocaNoRegistro` reescreve o jsonb sem trava. | RPC com `p_quadro` e `p_quadro_de`. |
| 8.7 | **Novo (crítica):** `close`/`auto_close` viram `assinado` direto (`traduzir.ts:104-106`), embora `closed` sem todos seja expirado (`traduzir.ts:53`); e na fórmula da v1 o `sign` da última pessoa virava `parcial` antes de o fechamento do payload ser testado. | `estadoPropostoPeloEvento`: `fechouComTodosNoPayload = true` → `assinado`; evento de fechamento com `false` → `expirado`; com `null` → não aplica terminal, loga, e a rede da Clicksign do cron confere. Senão, o estado do evento. |
| 8.8 | **Novo:** o payload guardado traz CPF (201 de 226), nascimento (201) e geolocalização (39); o não conferido também grava tudo; sem teto de tamanho. | Payload reduzido por allowlist; esqueleto no não conferido; 413 acima de 128 KB; limpeza das antigas com OK. |
| 8.9 | **Novo:** o fallback por metadata pega o envelope mais recente da proposta e aplicaria marcas de outro documento (reenvio depois de carimbo falho). | `p_documento` na RPC: adota só linha sem documento; documento diferente recusa. |

---

## 9. Riscos, perguntas e pedidos

### Riscos

1. **O contrato nunca vira "assinado" na Clicksign.** Nenhum fechamento chegou ainda. Mitigação: 8.7
   e a rede da Clicksign no cron. Pedido: conferir no painel da Clicksign os eventos assinados pelo
   webhook antes do primeiro fechamento.
2. **Cota da D4Sign na mesma conta do C2X.** A doc pública fala em 10 por hora; a conta já aguentou
   mais, mas a cota contratada não está escrita. Mitigação: confirmação antes da F3, 429 pausa 1 h,
   carga com vazão fixa e recorte, cron com teto 20.
3. **Ligar a D4Sign à venda nativa muda a Têmis** (recusa do envio pela Clicksign, da volta e da
   conclusão do cancelamento com D4Sign vivo). Mitigação: casamento só com o mesmo comprador e
   não cancelada no envio; frases com o caminho; `--mover-vendas` separado.
4. **Trocar a fonte antes do espelho cheio** faria o D4Sign aparecer como "aguardando emissão": a F4
   só sobe depois da prova da F3 e do "inexplicado = 0".
5. **Venda feita só no C2X** (Garden e o que o ensaio achar, 0.18 e 0.19): pergunta 1.
6. **Pareamento D4Sign × C2X por nome** (658 de 1.487 no Vale do Ouro, 18/08): homônimo no mesmo
   contrato pode trocar a marca de duas pessoas; o estado do documento não é afetado.
7. **Colisão da 0195 com o PAN-124** e **0177 não aplicada**: não aplicar a 0177 depois da 0195.
8. **Crescimento de `temis_envelopes`**: de 26 para até ~4 mil linhas (menos as `sem_unidade`, que
   não entram). Todos os leitores filtram por chave; a leitura única vai pelas views paginadas.
9. **O cron parado vira tela velha em silêncio**: a campainha é `ultima_rodada_ok_em`; o health board
   do Zeus deve conferir a mesma linha.
10. **Validar no worktree escreve em produção**: só telas de leitura antes do OK.

### Perguntas de negócio (só as que mudam o que se faz)

1. **Produtos cuja venda não está no Panteon.** O Garden (GDN) tem 404 unidades e nenhuma venda no
   Panteon (a carga pulou produto com dono), e JDG, LAB, LBP, LBR, RVP e VDO não têm nenhuma venda
   nativa: o que foi vendido direto no C2X depois de 22/09 não existe aqui. Na tela de assinatura do
   portal, esses contratos: **(a)** continuam vindo do C2X por uma lista explícita de exceção, até a
   venda passar a nascer no Panteon; **(b)** as vendas do Garden (e as que o ensaio achar) são
   trazidas para o Panteon numa carga pontual (reabre a carga encerrada, precisa de OK); ou **(c)**
   somem da tela? Padrão do plano: (a), com a lista medida pelo ensaio de paridade e data de saída.
2. **Contrato de venda desfeita.** Hoje o portal mostra o envio de venda cancelada ou distratada (até
   o C2X cancelar o envio), e ele conta nas taxas e totais: são até 351 vendas da carga desfeitas com
   `data_assinatura` (336 canceladas, 15 em distrato), mais os envios pendentes. Com a fonte nova:
   **(a)** somem do portal e ficam só na tela interna, com o aviso quando o documento ainda está vivo
   na D4Sign; ou **(b)** continuam aparecendo como hoje? Padrão do plano: (a) ("venda lê só o
   Panteon"; a linha é a venda viva).

**Oferta (não bloqueia):** desligar os dois links públicos que saíram do escopo (o BI de assinatura
devolve nome e e-mail sem token, e o painel do coordenador abre qualquer empreendimento pelo `?emp=`).

Decidido e justificado no plano, sem pergunta: a data de assinatura (decisão do Lucas, seção 7); o
prazo de 7 dias da D4Sign pelo fechamento (lado seguro, seção 7); a Têmis recusa enviar pela
Clicksign contrato vivo na D4Sign da mesma venda (seção 4); venda com pedido de cancelamento não é
movida pelo espelho; a carga não tem a etapa movida; o Apolo Contratos sem e-mail (regra do brief).

### ✅ RESPOSTAS DO LUCAS (28/09/2026, depois da revisão) — valem sobre o texto acima

1. **Pergunta 1 (venda que não está no Panteon): "Aparecem pelo envelope, sem ler o C2X".** Não existe
   exceção que lê o C2X na tela. O envelope da D4Sign que o espelho grava ligado à UNIDADE, sem
   proposta (regra `sem_venda`), vira LINHA também no PORTAL: a unidade pelo código, o comprador pelos
   signatários de perfil Comprador, o estado e o esquema por pessoa do envelope. No portal a linha não
   diz por que não tem venda (sem vocabulário interno); na tela interna (Apolo, F5) ela leva o aviso
   `envelope_sem_venda` ("venda fora do Panteon", para o time corrigir). Sai do plano a lista
   explícita de exceção da F4. O ensaio de paridade passa a exigir que essas vendas apareçam pelo
   envelope (categoria "produto sem venda no Panteon" explicada = presente pelo envelope).
2. **Pergunta 2 (contrato de venda desfeita): não perguntada; vale o padrão (a)**, some do portal e fica
   na tela interna com o aviso `contrato_de_venda_desfeita`. Diferença visível que o Zeus reporta ao Lucas.
3. **Oferta dos links públicos: "Desliga os dois".** Nesta entrega (junto da F5):
   - `/publico/assinaturas` (página) e `/api/publico/bi/assinaturas` (rota) deixam de devolver dado: a
     página mostra só "O acompanhamento das assinaturas agora está no portal" e a rota responde 410
     sem corpo de dado;
   - no painel público do coordenador (`/publico/painel`) a ABA ASSINATURA sai (a navegação não a
     oferece e `?aba=assinatura` cai na aba padrão com o mesmo aviso). As abas CAD, Imobiliárias e
     Sinal NÃO foram objeto da decisão e ficam como estão; o `?emp=` aberto nelas é assunto separado,
     que o Zeus leva ao Lucas;
   - `carregarPainelAssinatura` deixa de ser chamado por rota pública (grep); a aba interna "painel
     clássico" do Apolo fica como está.
4. **Card da Têmis pela D4Sign: "Sim, anda sozinho"** (já no plano, seção 7).
5. **D4Sign entra lendo o C2X só para achar o documento** (já no plano).

### Pedidos operacionais (OK a cada vez)

- confirmar com a D4Sign (comercial) a cota da conta e se ela vale por conta ou por token; se der,
  token separado para o Panteon (env nova);
- aplicar a 0195; rodar o ensaio SQL da função (branch do Supabase, com custo, ou `BEGIN … ROLLBACK`
  em prod depois de aplicada); depois do deploy da F1, o `.dados.sql`;
- `scripts/temis/reprocessar-eventos-clicksign.mjs --gravar`, depois
  `scripts/temis/reduzir-payloads-clicksign.mjs --gravar` (reescreve as 226 linhas antigas sem CPF);
- o espelho: OK para ler no C2X o envio, a unidade, o rol de convidados (nome, e-mail, ordem, perfil)
  e, só dos candidatos, o documento do comprador em memória; `espelhar-d4sign.mjs --gravar`; depois
  `--mover-vendas` (e `MOVER_VENDAS = true` num deploy);
- o cron novo no `vercel.json`;
- deploy de cada fatia (F1 a F7), com changelog;
- conferir no painel da Clicksign quais eventos o webhook assina (risco 1).

### Fora desta entrega (próximos)

Carteira, CRM, Hades, CACÁ, Iris Athena e o espelho `signedContractStatus` da fila do Hades (leitores
24 a 26); Prometeu, BI do Vale do Ouro, overview do Hades e GLotes; PDF assinado da Clicksign
guardado no Panteon; "Faturado" que nunca anda; histórico "Assinaturas" da unidade; a unificação da
unidade no pai; a guarda do envio por finalidade (hoje o card de distrato e o de contrato dividem a
guarda por proposta); a mesma venda em duas glebas (0.30), que é da frente do cadastro (PAN-124).

---

## 10. Os ataques dos críticos (28/09): o que entrou e o que foi rejeitado

### Aceitos, e onde entraram

| Ataque | Onde |
|---|---|
| Integridade B1 (marca por e-mail, não 1-para-1) | `chave` obrigatória e única; RPC casa pela chave, e-mail só se único (F1, ATENCAO 3); teste de dois itens com o mesmo e-mail. |
| Integridade B2 / Regressão I6 (fechamento da D4Sign com a hora do cron) | RPC nunca usa `now()` (ATENCAO 5); finalizado de venda nativa só com o `/list` na mesma chamada (seção 6, passo 3); efeito só com data real (seção 7). |
| Integridade B3 (regra 3 liga venda cancelada ou de outro cliente) | Não cancelada no envio + mesmo comprador, também na regra 2; `aplicarEnvelopeNaVenda` lê a venda antes; ensaio lista regra e comprador (seção 3, 7). |
| Integridade I1 (precedência do fechamento no webhook) | 8.7. |
| Integridade I2 / Regressão M7 (escritores por fora) | Carimbos pela RPC, guarda de terminal nos updates diretos, lista de escritores (F1). |
| Integridade I3 (fallback por metadata) | `p_documento` (8.9). |
| Integridade I4 (card sem comparar-e-trocar, movimento repetido) | Comparar-e-trocar por card, efeito só na borda, ordem estrita, `desconhecido` nunca entra, efeito da inserção só nas linhas devolvidas, a vez da rodada numa linha (a trava de sessão não serve, veja abaixo). |
| Integridade I5 / Segurança 9 (transição única que se perde) | `reconciliarVendasAssinadas` em toda rodada; webhook `maxDuration = 60`. |
| Integridade I6 (fuso das marcas) | Texto em -03:00 guardado como veio; `diaEmBrasilia` com `Intl`; testes 23:30-03:00 e 02:30Z. |
| Integridade I7 / Regressão I7 (operador `?`) | `nullif(item->>'x','') is not null` em todo ponto; `jsonb_strip_nulls` na entrada. |
| Integridade I8 (view corta nativa no pai; terreno ≠ régua) | Filtro só da carga no pai; terreno pela união extraída da régua (`lib/hercules/terreno.ts`). |
| Integridade I10 / Regressão I1 (status 6) | `cancelado` com `c2x:6`, salvo finalizado. |
| Integridade I11 (quadro da D4Sign congelado) | Releitura do rol quando muda, `p_quadro` pela chave (seção 6, passo 4). |
| Integridade I12 (prazo de 7 dias na D4Sign) | Fechamento (seção 7). |
| Integridade I13 (acordos do Hades) | Backfill só de contrato; prova antes e depois dos 18. O webhook continua aplicando nos acordos (mesma tabela): a ordem monotônica só impede regressão, e as marcas não são lidas pelo Hades. |
| Integridade I14 (o "mais recente" na Têmis) | Filtro de provedor no diário, na troca (inclusive `:640-647`) e no reenvio; frase por provedor. |
| Integridade I15 (paginação do Panteon no espelho) | Lotes de 100 com ordem; teste com 2.500 ids; linhas lidas no relatório. |
| Integridade I16 / Segurança 14 (rodízio e aviso) | `tentado_em` gravado também na falha; recuo por idade; aviso pela última rodada boa. |
| Integridade M1 | Backfill com `assinatura_conferida = true` e união das marcas. |
| Integridade M2 | Carimbo preenche o `envelope_id` dos eventos que chegaram antes. |
| Integridade M4 | Envelope sem venda só na tela interna. |
| Integridade M5 | Candidata `nativa_depois_do_envio`, nunca ligada sozinha. |
| Integridade M6 | A 0195 apaga `temis_envelopes_provedor_documento_idx`. |
| Segurança 1 (cota da D4Sign) | Confirmação antes da F3, 429 pausa, vazão fixa, recorte do `/list`, teto 20 (a premissa "10 por hora vale para esta conta" está na lista de rejeitados). |
| Segurança 3 (efeitos de negócio) | `--mover-vendas` separado e `MOVER_VENDAS` no código; venda com pedido de cancelamento nunca movida (LBF). |
| Segurança 5 (CPF no payload) | 8.8. |
| Segurança 6 (tabela de eventos aberta, sem teto) | Esqueleto no não conferido; 413 acima de 128 KB. |
| Segurança 7 (custo do Board) | Contagem por `assinado_em` na F3; convite como marca; Board sem payload (F6). |
| Segurança 8 (distrato/cessão viram "contrato assinado") | Colunas `finalidade` e `trabalho_id`; `contract_type` do C2X mapeado depois do ensaio; view e efeitos só com `contrato`. |
| Segurança 10 (e-mail na tela interna) | Apolo Contratos sem e-mail (F5). |
| Segurança 11 (proxy) | `proxy.ts` não muda; `timingSafeEqual`; segredo vazio recusa. |
| Segurança 12 (C2X não é read-only) | Uma conexão, transação READ ONLY, timeout 20 s, teste só `select`. |
| Segurança 13 (log com dado pessoal) | Só `code` e `message`; relatório só com ids; teste de `@` e 11 dígitos. |
| Segurança 15 / Regressão I3 (PDF) | `temContrato` igual a hoje; botão com `contratoId`; rota baixa aquele documento. |
| Segurança 16 | Leitura estreita, jsonb só dos que vão ao `/list`. |
| Segurança 17 | POST sem `refazer` nem teto infinito, `so` validado, quem disparou registrado. |
| Segurança 18 | Só telas de leitura no worktree. |
| Segurança 19 | `sem_unidade` não entra; finalidade e retenção no comentário da coluna. |
| Regressão B1 (Garden) e B3 (venda só no C2X) | Pergunta 1 e trava de paridade da F4. |
| Regressão B2 (contrato de venda desfeita; contradição da v1) | Pergunta 2; a frase contraditória da v1 saiu (seções 3 e 9). |
| Regressão I2 (envio sem `uuidDoc`) | Contado e declarado (seção 5, f). |
| Regressão I4 b/c (degrau denso) | Ordem crua por provedor, 0 = sem ordem, teste de recorte misto. |
| Regressão I5 (prazo sem o quadro) | A RPC devolve o quadro mesclado; teste de ponta a ponta. |
| Regressão I8 (regra monotônica sem teste real) | Ensaio SQL da função (com OK) e fim do caminho antigo em TS. |
| Regressão I9 (leitores sem destino) | Linhas 24 a 27 da seção 2; indeferimento na F2. |
| Regressão I10 (LBF) | Venda com pedido de cancelamento nunca movida; listada no ensaio. |
| Regressão I11 (paridade tautológica) | Ensaio por categoria e empreendimento, "inexplicado = 0", fixture. |
| Regressão M1 | Totais do Resumo do servidor, antes do teto. |
| Regressão M2 | Na linha da Têmis o papel vence o e-mail. |
| Regressão M3 | Selo por `assinado_em` na F3. |
| Regressão M5 | Fallback de ACT, SDT e TSC no Apolo Contratos. |
| Regressão M6 | Regra 2 aceita a nativa do filho; caso no teste. |
| Regressão M8 | Catálogo do C2X opcional na rota nova. |

### Ataques rejeitados

- **Segurança 2 (e-mail dos compradores nos links públicos):** não se aplica mais; o Lucas tirou os links públicos do escopo (não migram). Fica a oferta de desligá-los.
- **Segurança 3, na parte "perguntar de novo `data_assinatura` e o card":** o Lucas já respondeu "Sim, anda sozinho" (28/09, ~11:20), com a data gravada na venda; a recusa da Clicksign com D4Sign vivo decorre disso.
- **Segurança 4 como pergunta de negócio (quadro vindo do C2X):** o rol do envio é parte de "achar o documento" e a D4Sign não devolve ordem nem perfil; entra como item explícito do pedido de OK do espelho, lido só para envios novos ou com rol mudado.
- **Segurança 1, a premissa de que a cota desta conta é 10 por hora:** a conta já fez 185+ `/list` numa rodada (18/08) e as telas fazem 28 chamadas por instância fria; os consertos entraram, a premissa não.
- **Integridade I4, "advisory lock":** trava de sessão não sobrevive ao pool do PostgREST entre chamadas; a vez da rodada é uma linha com `em_curso_ate`, que faz o mesmo papel.
- **Integridade I9 (deduplicar a mesma venda em duas glebas):** é duplicata da carga que já aparece hoje (o C2X tem os dois pedidos) e deduplicar "ficando com a mais recente" esconde venda por palpite; vira categoria contada no ensaio (LBR+ACT 29, RDP+RPC 13, SDT+TSC 1) e vai para a frente do cadastro.
- **Integridade I12, "máximo de todos que não forem positivamente internos":** trocado pelo fechamento (máximo de todos), mais simples e também do lado seguro.
- **Integridade I17, conserto "atualizar os ids no 23505":** trocado por índice NÃO único em `c2x_contract_signature_id` e uma linha por documento; atualizar os ids apagaria o histórico do documento velho e esbarraria no terminal.
- **Integridade M3, "troca como delta":** trocado por versão (`p_quadro_de`) com releitura; mesma proteção com menos SQL.
- **Regressão I4a (rótulos fixos dos painéis clássico e público):** não se aplica; esses painéis saíram do escopo e não leem a fonte nova.
- **Regressão M4 (VOR fora do escopo fixo do BI):** não se aplica, pelo mesmo motivo.
