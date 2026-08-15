# CACÁ: diagnóstico de operação (medido em 15/08/2026)

**Janela:** 01/08 a 15/08/2026 (14 dias) · **Fonte:** Supabase `bxgukywoxgivlrhjkwjx` (`caredesk_messages`, `caredesk_tickets`, `caredesk_channels`, `iris_avisos_operacionais`) + código em `apps/hub/lib/iris/caca/`, `apps/hub/lib/iris/meta-inbound-processor.ts`, `apps/hub/lib/ai/`.

Este documento é a releitura da análise de 14/08 contra o estado de hoje. Onde os dois divergem, o número desta página é o reapurado, e a divergência está explicada.

**Recorte usado (o mesmo do doc anterior):** CACÁ = `sender_type='operator' AND direction='outbound' AND sender_user_id IS NULL AND group_id IS NULL AND provider_payload->>'operatorLabel' = 'Cacá'`.

---

## 1. Como ela funciona de fato (o laço, lido no código)

Mensagem chega pelo webhook da Meta e cai em `maybeSendCacaAutoReply` (`meta-inbound-processor.ts:2162`). O caminho tem quatro portas antes do modelo:

1. **`shouldCacaAutomationRun`** (`:2427`) responde não se: o ticket está fechado/resolvido; **o ticket tem dono (`assigned_to_user_id`)**; o estado já tem **`handoffRequired`**; ou é contato ativo que não é cobrança.
2. **Guarda de turno, primeira passada** (`guarda-de-turno.ts`): se o cliente já mandou outra mensagem depois desta (rajada), ou se alguém já respondeu (corrida), esta execução desiste antes de gastar token.
3. **O turno** (`caca/agent.ts:292`): `runClaudeAgent` com **modelo tier `heavy`**, `thinking: adaptive`, `effort: "high"`, `maxTokens: 1024`, `maxToolIterations: 6`, **histórico de 14 mensagens** (`HISTORY_LIMIT`), 30 ferramentas declaradas, system prompt com `cache_control` efêmero.
4. **Guarda de turno, segunda passada**: reconsulta imediatamente antes de gravar e enviar; se alguém falou nesse meio-tempo, a resposta já gerada é descartada.

Três consequências que vale enxergar como decisão de arquitetura, não como bug:

- **O handoff é definitivo por construção.** `handoffRequired` entra no metadata do ticket e a porta 1 nunca mais abre naquele atendimento. Não é falta de contexto: é o gate.
- **Ticket com dono cala a CACÁ, inclusive quando o dono não está.** Vale de madrugada, no fim de semana e no feriado.
- **Ela só existe no canal Meta.** Confirmado de novo: 484 tickets dela em 14 dias, 484 em `whatsapp-careli`, zero nos demais.

---

## 2. Os números de agosto

### 2.1 Volume e desfecho

| Indicador | 01/08 a 15/08 |
|---|---:|
| Mensagens dela | **1.420** |
| Mensagens de humano com login | 1.596 |
| Tickets que ela tocou | **484** |
| Terminaram em transferência | **382 (78,9%)** |
| Ela fechou sozinha | **102 (21,1%)** |
| Rodaram no motor Claude | **484 de 484 (100%)** |
| Caíram no motor legado | **0** |
| Handoffs registrados no período | 412 |

### 2.2 A curva que importa: ela está resolvendo cada vez menos

| Semana | Tickets dela | Resolveu sozinha |
|---|---:|---:|
| 29/06 | 110 | 51,8% |
| 06/07 | 136 | 36,0% |
| 13/07 | 159 | 18,9% |
| 20/07 | 325 | 36,9% |
| 27/07 | 217 | 33,2% |
| 03/08 | 205 | **19,0%** |
| 10/08 | 268 | **21,6%** |

A média de 30,3% do doc de 14/08 é a média de uma série em queda. As duas últimas semanas estão em ~20%.

**A causa é mix, não regressão dela.** O assunto em que ela tem dado de ponta a ponta encolheu, e o assunto em que ela não tem ferramenta dominou:

| Semana | Tickets | Falam de boleto | Falam de CAD/PIX | Falam de reajuste |
|---|---:|---:|---:|---:|
| 29/06 | 110 | 38 (34,6%) | 3 | 2 |
| 20/07 | 325 | 155 (47,7%) | **34** | 4 |
| 03/08 | 205 | 123 (60,0%) | 11 | 6 |
| 10/08 | 268 | **159 (59,3%)** | 9 | 9 |

A ação de lançamento acabou e levou junto a única frente onde ela era resolutiva. Sobrou boleto.

### 2.3 Escalação por assunto (14 dias)

| Assunto | Tickets | Escalam | % |
|---|---:|---:|---:|
| Boleto / 2ª via / carnê | 279 | 249 | **89,2%** |
| Outros | 124 | 67 | 54,0% |
| Contrato / assinatura | 32 | 25 | 78,1% |
| CAD / PIX | 20 | 12 | 60,0% |
| Reajuste | 17 | 17 | **100%** |
| Quitação / antecipação | 7 | 7 | **100%** |
| Comissão | 5 | 5 | **100%** |

### 2.4 O motivo declarado das 412 transferências

201 (48,8%) citam boleto. **189 (45,9%) citam link indisponível ou "não consigo".** Contrato 43, negociação 19, reajuste 15, comissão 7, pedido explícito de humano 30. **Falha técnica: zero.**

### 2.5 A onda de reajuste continua subindo

Mensagens de cliente citando reajuste/IPCA/índice, por semana: 8, 1, 3, 4, 14, 22, **38** (semana de 10/08, com 18 tickets). Escala em 100% dos casos. O crescimento do doc anterior se confirmou.

---

## 3. O que está funcionando bem (não mexer)

| O que | Evidência de agosto |
|---|---|
| **Velocidade** | Mediana de **8,7s** entre a mensagem do cliente e a resposta dela; p90 de 24s; **zero** respostas acima de 2 minutos, em 1.420 casos |
| **Estabilidade** | 484 de 484 turnos no motor Claude, **zero fallback** e **zero handoff por falha técnica** |
| **A duplicação acabou** | O doc de 14/08 apontava 222 pares CACÁ→CACÁ, 215 em menos de 30s. Nos últimos 14 dias: **0 pares**. A guarda de turno resolveu. O item "investigar dupla execução" pode sair da fila |
| **Ela não promete o que não pode** | **0** mensagens do tipo "te retorno depois" em 14 dias |
| **Recusa de mídia** | Com regex estrito ("não consigo ouvir/abrir esse áudio/arquivo/anexo"): **9 casos em 8 semanas e nenhum desde 03/08**. Ver a divergência na seção 5 |

---

## 4. O que está quebrado hoje

### 4.1 Ela fala no presente de uma data que já passou (134 vezes, 69 tickets)

134 mensagens em 14 dias dizem **"vence em DD/MM/AAAA" com a data anterior ao dia em que ela escreveu**. Exemplo real, 14/08 às 22:15, ticket `0afc4874`: *"parcela 23/144, que vence em 20/07/2026, no valor de R$ 638,32"*. Vinte e cinco dias depois do vencimento, escrito como se fosse futuro.

Não é dado inventado: a parcela existe e está em aberto. É tempo verbal errado somado à ausência de qualquer sinal de "esta parcela foi reemitida". Para o cliente que já recebeu uma cobrança nova, com outro valor, ela parece desatualizada, e no mês do reajuste ela **é** desatualizada.

### 4.2 A mensagem de transferência engordou

Média geral dela: **375 caracteres** (era 271 no doc anterior). As **457 mensagens que citam "analista" (32,2% de tudo que ela escreve) têm 613 caracteres de média**. Um terço do que ela escreve é uma despedida longa.

### 4.3 O eco de documento continua

**32 mensagens em 14 dias** repetem um CPF/CNPJ no corpo do texto. A regra de não ecoar documento está decidida e não está sendo cumprida, porque não existe barreira: é só instrução de persona.

### 4.4 O e-mail continua sem dono

Canal `email-contato`: **59 tickets em 14 dias, zero resposta de humano e zero da CACÁ**. Buraco literal, igual ao doc anterior. Some a isso `whatsapp-gurgel`: 13 tickets, 10 sem resposta de ninguém.

### 4.5 O corte de histórico morde um quarto dos atendimentos

**141 de 567 tickets (24,9%) passam de 14 mensagens**, que é o `HISTORY_LIMIT`. Nesses, o começo da conversa some da vista dela.

### 4.6 O silêncio de fim de semana é do gate, não dela

Hoje, 15/08 (sábado), entre 04h31 e 06h53, cinco mensagens de cliente chegaram no `whatsapp-careli`. **Nenhuma teve resposta de ninguém.** Todas em tickets com dono, então a porta 1 fechou. Duas delas eram cliente informando a chave PIX para devolução (`"Chave Pix, 379…"`, `"A chave pix é meu CPF"`), que é exatamente o que a tool `registrar_chave_pix` faz sozinha.

O gate "ticket com dono" foi escrito para ela não falar por cima do humano. Fora do horário, ele vira mudez: o humano não está, e ela está proibida.

---

## 5. Divergências com o relatório de 14/08

| Item | Doc de 14/08 | Medição de 15/08 | Leitura |
|---|---|---|---|
| Recusa de mídia | 51 casos, "facilidade máxima, duas linhas de prompt" | **9 em 8 semanas**, nenhum desde 03/08 | O regex do doc era largo e pegou "não consigo abrir **o cadastro**", que é outra coisa. O trecho de persona continua barato e correto, mas **não é prioridade** |
| Dupla execução | 222 pares, 12% dos tickets | **0 em 14 dias** | Resolvido pela guarda de turno |
| Mural inerte | "migration nunca aplicada" | Migration aplicada, tabela existe, **0 avisos escritos** | O bloqueio mudou de lugar: agora é conteúdo, não schema |
| `activeCobranca` não portado | 40 tickets com `metadata.cobranca` | **1 ticket em 30 dias** | O caminho existe mas o volume evaporou. Baixa prioridade |
| Ferramenta mais usada | "uso medido em produção, por ticket" | Ver 6.3 | A telemetria mede só o **último turno** de cada ticket, então a lista está enviesada para a última ação |

---

## 6. O que descobri agora e não estava no doc anterior

### 6.1 Ela roda no modelo mais caro da casa, em todo turno

`caca/agent.ts:290` usa `resolveClaudeModel("heavy")`. Em `lib/ai/claude.ts:11-15`, `heavy` = **Opus 4.8**, e o comentário do próprio arquivo diz o que cada tier é para:

> `default` = Sonnet 5 → workhorse dos atendimentos (alto volume, bom custo/latência)
> `heavy` = Opus 4.8 → turnos difíceis/escalados (gestão de crise, leitura de contrato)

Ou seja: o atendimento de alto volume está rodando no tier que o próprio design reservou para o turno difícil, com `thinking` adaptativo e `effort: "high"` ligados, em "bom dia" e "obrigada" também. O system prompt tem prompt caching (`claude-agent.ts:77`), o que segura parte do custo, mas o thinking e o output não são cacheáveis.

Isso não é para mexer no susto: Opus é parte da razão de o tom e a precisão estarem bons. É uma decisão de custo que precisa ser tomada com número na mão, e hoje não existe número, pelo item seguinte.

### 6.2 Não existe telemetria de custo. Nenhuma.

`runClaudeAgent` nunca lê `response.usage`. Não há um único registro de tokens de entrada, saída, cache ou custo por atendimento em lugar nenhum do Panteon. **Não dá para responder "quanto custa um atendimento da CACÁ" sem abrir o console da Anthropic**, e não dá para comparar Opus com Sonnet sem instrumentar antes.

### 6.3 A telemetria de ferramenta mede só o último turno

`updateTicketAfterCacaReply` (`meta-inbound-processor.ts:2686`) **sobrescreve** `metadata.cacaAutomation.toolsUsed` a cada turno, e guarda só os 10 últimos passos do trace. Toda contagem de "ferramenta mais usada" (a minha e a do doc anterior) é, na verdade, "ferramenta usada no último turno do ticket". É por isso que `transferir_para_humano` lidera com folga: ela é sempre a última.

Consequência prática: **não sabemos o uso real das 30 ferramentas.** O que sabemos, dos últimos 21 dias, é como os tickets terminam: `transferir_para_humano` 562, `listar_boletos` 373, `gerar_link_boleto` 202, `consultar_financeiro` 62, `validar_identidade` 61, e o resto em dois dígitos ou menos.

### 6.4 O mural existe e está vazio

`iris_avisos_operacionais` existe no banco, com as colunas certas (`titulo`, `texto`, `assunto`, `ativo`, `vale_ate`). **Zero linhas.** O código lê (`agent.ts:269`), a persona tem o bloco de renderização (`persona.ts:232-240`), e o bloco nunca renderizou porque ninguém escreveu um aviso. Continua valendo o alerta do `carregarAvisosVigentes`: fail-open silencioso, então uma falha de leitura seria indistinguível de "não há aviso".

### 6.5 O risco de dado pessoal está exatamente onde o doc apontou

Confirmei no código: `consultar_status_cad` (`executors.ts:657`), `consultar_ficha_credenciamento` (`:778`), `enviar_ficha_cad` (`:1001`), `enviar_pix_credenciamento` (`:1043`) e `registrar_chave_pix` (`:1140`, escrita) usam `createApoloAdminClient()`, que ignora RLS, e **exigem apenas um CPF de 11 dígitos**. Não há verificação de vínculo entre o telefone que está falando e a pessoa do CPF. A ficha em PDF (CPF, RG, nome da mãe, renda) sai por link assinado do Storage. **A única barreira é uma frase da persona.**

### 6.6 Os handoffs órfãos diminuíram

35 dos 412 handoffs (8,5%) não tiveram mensagem humana depois, e em 6 deles o cliente continuou escrevendo (era 11,4% e 57 no doc anterior). Mediana até o humano assumir: **23,4 minutos**; média 109,5, puxada pela cauda. E, confirmando o gate: **em 0 dos 412 a CACÁ voltou a falar.**

---

## 7. Leitura final

A CACÁ não está piorando: ela está sendo empurrada para o único assunto que não sabe resolver. Em junho, quando o mix tinha CAD, ela fechava metade dos atendimentos sozinha. Hoje, com 6 de cada 10 tickets falando de boleto, ela fecha 1 em 5. **Enquanto boleto for a metade do atendimento e ela não tiver o que dizer sobre emissão, a taxa de resolução dela é uma função do mix, não do prompt.**

O que ela faz bem, faz muito bem: 8,7 segundos de mediana, zero falha, zero duplicata, zero promessa falsa, tom aprovado. O que falta não é qualidade de escrita, é **matéria-prima**: saber por que o boleto não saiu, saber quando sai, e poder dizer isso.

E há duas dívidas que não são da CACÁ, são minhas enquanto responsável pelos agentes: **não medimos custo** e **não medimos uso de ferramenta**. Enquanto isso não existir, qualquer decisão sobre modelo, tier ou arsenal é opinião.

---

## 8. O que eu faria, nesta ordem

1. **Instrumentar antes de otimizar.** Gravar `usage` (input, output, cache, iterações, modelo) por turno e acumular `toolsUsed` em vez de sobrescrever. É a base para decidir Opus x Sonnet e para saber quais das 30 ferramentas estão mortas de verdade. Custo: pequeno. Sem isso, o resto é chute.
2. **Escrever o primeiro aviso no mural.** A tabela está pronta e vazia; um INSERT com prazo já muda a resposta dela no próximo atendimento, sem deploy. Depende de uma decisão sua: qual é o prazo de emissão que a Careli assume.
3. **Corrigir o tempo verbal do vencimento** e a prolixidade da transferência na persona (dois trechos, os 4.3 e 4.6 do doc de 14/08, o segundo já validado por número novo: 613 contra 375 caracteres).
4. **Decidir o gate de fim de semana**: ticket com dono, fora do horário de atendimento, deveria continuar calando a CACÁ? Hoje cala, e é o caso das chaves PIX de hoje de manhã.
5. **Barreira de código nas quatro tools de CAD**, exigindo vínculo do telefone com a CAD ou com o corretor responsável. É o único item da lista que é risco, não eficiência.
6. **`consultar_emissao_boleto`**, que é a matéria-prima que falta, e que serve tanto para ela quanto para o humano que assume.
7. **Reajuste**: o trecho de persona segura o susto, mas 100% ainda vai escalar até existir a tool, que depende de popular `c2x_payments` (0 linhas até hoje).
