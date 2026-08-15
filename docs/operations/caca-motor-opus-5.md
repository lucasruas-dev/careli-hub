# CACÁ: troca de motor para Opus 5 + conserto do harness

**Data:** 15/08/2026 · **Estado: EM PRODUÇÃO** (v1.137.0)

| Deploy | |
|---|---|
| Commit | `ee7fa0b4` |
| Deployment | `dpl_DKGTKFsUUvN7YXvQgtJLWK4DS94k` (READY, 15/08 ~11:18 BRT) |
| **Rollback** | `dpl_E8zJ6R6PLFnAUoBZmayt8YXdYBfb` (commit `8c923b31`, migration 0086) |
| Verificado | `c2x.app.br` → 200 · webhook da Meta → 403 sem token (correto) |
| Autorização | Lucas, 15/08: "pode subir de uma vez, não precisa de validação" |

**Pendência de verificação:** a chamada real ao `claude-opus-5` só acontece no primeiro atendimento depois do deploy (o último turno anterior foi 09:36, ainda no Opus 4.8). Para confirmar que o modelo novo assumiu, e de quebra estrear a telemetria:

```sql
select left(id::text,8) as ticket,
  metadata->'cacaAutomation'->>'lastModel' as modelo,
  metadata->'cacaAutomation'->'lastUsage' as consumo
from public.caredesk_tickets
where (metadata->'cacaAutomation'->>'lastAutoReplyAt')::timestamptz >= now() - interval '2 hours'
order by (metadata->'cacaAutomation'->>'lastAutoReplyAt')::timestamptz desc limit 5;
```

Se `modelo` vier `claude-opus-4-8` com o `lastUsage` preenchido, o fallback entrou em ação: o id não está liberado na conta, e o atendimento seguiu normal no modelo anterior. Nesse caso, procurar no log da Vercel por `modelo frontier indisponível`.

---

**Histórico:** implementado em 15/08, revisado por 37 agentes, subiu no mesmo dia.
**Origem:** decisão do Lucas ("quero para a CACÁ o melhor motor, quero um agente bem inteligente mesmo")
**Diagnóstico que motivou:** `docs/operations/caca-diagnostico-15-08.md`

---

## 1. A decisão de modelo

A CACÁ passa a rodar em **`claude-opus-5`**, através de um tier novo `frontier` em `apps/hub/lib/ai/claude.ts`.

**Por que um tier novo, e não trocar o `heavy`.** O tier `heavy` (Opus 4.8) é compartilhado por 6 outros consumidores: Athena da Iris, copiloto do Zeus, ata e pauta do Chronos, análise de evidência do HelpDesk e o autor de template. Todos pedem entre 900 e 2.200 tokens de saída e **nenhum manda `thinking`**. Como no Opus 5 o raciocínio vem ligado por padrão e o `max_tokens` passa a ser teto de raciocínio **mais** resposta, apontar o `heavy` para o modelo novo truncaria os seis de uma vez. Cada um sobe quando o `max_tokens` dele for revisto.

Preço por token é o mesmo do Opus 4.8, então a troca em si não muda a fatura.

**Rede de segurança:** se o `claude-opus-5` não estiver liberado para a conta, `runCacaClaudeTurn` detecta (404, ou 400 citando `model`) e **refaz o turno no tier `heavy`**, registrando o erro no log. Sem isso, um id não reconhecido viraria "tive um problema técnico" em todo atendimento.

## 2. Harness: o que quebraria sem conserto

| Item | Onde | O que era |
|---|---|---|
| `maxTokens` 1024 → **4000** | `caca/agent.ts` | Era teto de raciocínio + resposta, com 30 ferramentas e ~9k tokens de prompt fixo. Estrangulava o pensamento e podia devolver texto vazio |
| Chamada final sem `thinking`/`effort` | `ai/claude-agent.ts` | A chamada de fechamento (quando estoura o cap de ferramentas) não repassava os parâmetros. No Opus 5, omitir = raciocínio ligado no esforço máximo, dentro do mesmo teto. Pior lugar possível pra truncar |
| `thinking: false` não desligava | `ai/claude-agent.ts` | O campo era omitido, e omitir não desliga mais. Agora manda `{ type: "disabled" }` |
| `stop_reason` descartado | `caca/agent.ts` | `refusal` (HTTP 200, conteúdo vazio) virava a frase genérica "Me dá só mais um detalhe". Como recusa é determinística, o cliente responderia e ela recusaria de novo, girando o ticket. Agora **transfere** |
| Iterações 6 → **8** | `caca/agent.ts` | O contador é de turnos do modelo, não de chamadas de ferramenta. A cadeia validar CPF → achar cadastro → listar parcelas → gerar boleto → enviar → confirmar já consome 6 |
| Histórico 14 → **24** | `caca/agent.ts` | 24,9% dos tickets passavam de 14 mensagens e perdiam o começo do atendimento |
| Ordenação instável | `caca/agent.ts` | Faltava desempate por `id`: rajada no mesmo segundo podia voltar em ordem diferente entre turnos |
| `web_search` 2025-03 → **2026-02** | `caca/agent.ts` | Versão nova filtra os resultados antes de entrarem no contexto. Só modo admin |
| Cliente Anthropic sem limites | `ai/claude.ts` | Default do SDK é 2 retries e **10 minutos** de timeout, que multiplicava com o retry da Iris. Agora 1 retry, 120s |

## 3. Cache do prompt

O prompt era um bloco único com um `cache_control` no fim, e com o nome do cliente, a saudação, o horário e os avisos do mural interpolados **no meio**. Como o cache casa prefixo, trocar de atendimento invalidava tudo, inclusive as ferramentas.

A persona foi dividida em duas funções:

- `buildCacaPersonaEstavel` — igual byte a byte para todo atendimento, vai no bloco cacheado com TTL de 1h;
- `buildCacaContextoDoTurno` — nome de quem fala, perfil, imobiliária, identidade, horário, avisos do mural, notas do cliente, modo voz e modo assistente. Vai num bloco separado, **depois**, sem cache.

Medido:

| Parte | Tokens (aprox.) |
|---|---:|
| Persona estável (cacheada) | 5.807 |
| Ferramentas (cacheadas junto) | 3.011 |
| Contexto do turno (fora do cache) | 325 |
| **Prefixo reaproveitável** | **8.818 de 9.143 = 96%** |

As 16 ferramentas base são fixas para qualquer cliente (as 14 de analista só entram no modo admin), então o prefixo é idêntico entre atendimentos diferentes. TTL de 1h em vez dos 5 min padrão porque os atendimentos chegam espaçados ao longo do dia.

`persona-cache.test.ts` (7 testes) trava essa separação: o bloco estável tem que ser idêntico entre dois contextos completamente diferentes, e não pode conter nome de cliente, saudação, aviso ou bloco de modo.

## 4. Telemetria (a dívida que impedia decidir)

`runClaudeAgent` agora acumula `usage` de todas as iterações (entrada, saída, leitura e escrita de cache, número de chamadas) e a CACÁ persiste em `metadata.cacaAutomation.lastUsage`, junto com latência e `stop_reason`. Sem migration.

Consulta:

```sql
select
  metadata->'cacaAutomation'->'lastUsage'->>'inputTokens' as entrada,
  metadata->'cacaAutomation'->'lastUsage'->>'cacheReadTokens' as cache_lido,
  metadata->'cacaAutomation'->'lastUsage'->>'outputTokens' as saida,
  metadata->'cacaAutomation'->'lastUsage'->>'latencyMs' as ms,
  metadata->'cacaAutomation'->'lastUsage'->>'stopReason' as parou_por
from public.caredesk_tickets
where metadata->'cacaAutomation' ? 'lastUsage'
order by updated_at desc limit 50;
```

**Limitação conhecida, não resolvida:** `toolsUsed` e `lastUsage` guardam só o **último turno** de cada ticket, porque `updateTicketAfterCacaReply` sobrescreve. Toda contagem de "ferramenta mais usada" é enviesada para a última ação (por isso `transferir_para_humano` lidera). Acumular por turno é o próximo passo.

## 5. Risco operacional corrigido

- **Ticket travado por envio recusado.** A linha outbound é inserida antes do envio. Se a Meta recusava, a linha ficava como `failed` e a guarda de turno passava a enxergar "já respondido" **para sempre**: cliente escrevia e ninguém respondia, nem a CACÁ nem o humano, porque o handoff só era gravado depois do envio dar certo. Agora o catch marca handoff. Uma flag `entregouAoCliente` garante que isso só vale para falha **antes** de a mensagem sair.
- **Corte de 4.096 caracteres.** A Meta recusa o envio inteiro acima disso (não trunca). Corte em 3.900, na última quebra de linha, com aviso de continuação.
- **`maxDuration = 300`** no webhook. A CACÁ responde dentro da requisição e o 200 para a Meta só sai depois do turno inteiro. Função cortada = linha órfã + reentrega da Meta = resposta dobrada.
- **Retry classificado.** Repetir o turno só para 429, 5xx e erro de rede. Erro de requisição (400/401/403/404/413) vai direto ao humano, porque a repetição refaz o turno do zero e **reexecuta ferramentas que já rodaram**, inclusive as que enviam PIX, ficha e relatório.
- **TTS com timeout de 20s** (a função aceitava `signal` e ninguém passava) e correção do `message_type` quando o áudio falha e a resposta sai em texto.

## 6. Persona

- Teto de tamanho na resposta escrita (2 a 4 frases) e na transferência (3 frases). O bloco de voz já tinha "seja concisa"; o de texto não tinha nada, e a mensagem de transferência estava em 613 caracteres contra 375 da média.
- Bloco novo de **escopo e correção**: responder o que foi perguntado, corrigir sem narrar a correção, uma consulta por dúvida. O Opus 5 escreve mais longo por padrão e narra correções em excesso.
- Instrução de auto-verificação convertida em condicional: o modelo já confere sozinho, e mandar conferir gasta iteração.
- **Fato datado corrigido:** a persona afirmava que o envio de CAD é feito pelo time via Asana. O import do Asana foi descontinuado em 04/08. A linha agora manda buscar o processo no mural ou no time, sem descrever caminho de memória.
- **"O PIX já foi enviado para todos"** virou instrução de consultar a ficha da pessoa, que é o que a ferramenta responde de verdade.

## 7. Higiene

- `temperature` removido de `completeWithClaude`: ninguém passava, e nos modelos novos qualquer valor fora do default é 400. Deixar na assinatura era convite para quebrar um agente meses depois.
- `CLAUDE_MODEL_FRONTIER` declarado no `turbo.json`.

## 8. Verificação

| O que | Resultado |
|---|---|
| Typecheck (`tsc --noEmit`) | limpo |
| Testes (`npm --prefix apps/hub test`) | **734 passando, 65 arquivos** (7 testes novos) |
| Lint nos arquivos tocados | 0 problemas |
| Tipos do SDK 0.106 | `cache_control.ttl`, `thinking disabled`, `effort xhigh`, `web_search_20260209` e os campos de `usage` conferidos no `.d.ts` |
| Regras da persona | comparação automática: **nenhuma das 94 regras anteriores sumiu** |

**O que NÃO foi verificado:** a chamada real ao `claude-opus-5`. A `ANTHROPIC_API_KEY` só existe na Vercel (marcada como Sensitive) e não está no `.env.local`, então não deu para exercitar o caminho de verdade daqui. É exatamente por isso que existe o fallback automático para o tier `heavy` descrito na seção 1.

## 9. A revisão adversarial (e o que ela pegou)

O diff passou por uma revisão de 37 agentes: quatro lentes independentes (correção, prompt, contrato da API, risco operacional) e, para cada achado, céticos tentando **refutar** com o código na mão. **11 achados sobreviveram, 22 foram derrubados.** Todos os 11 foram corrigidos ou registrados abaixo.

**Três eram defeitos introduzidos por esta mudança:**

1. **O corte de 3.900 caracteres pegava TODO envio de texto, inclusive do operador humano.** Um acordo de cobrança de 4.200 caracteres colado no cockpit sairia truncado, com a frase "(continua: me chama que eu sigo daqui)" logo abaixo do nome do operador, como se ele tivesse escrito. Corrigido: o corte saiu do envio genérico e agora vale só para o texto gerado pela CACÁ.
2. **O banco guardava mais texto do que o cliente recebia.** Como é esse histórico que ela relê no turno seguinte, ela concluiria que já explicou algo que a pessoa nunca leu. Corrigido: o corte acontece **antes** de gravar, então banco e WhatsApp têm o mesmo texto.
3. **`pause_turn` não era tratado.** Quando a busca web do modo admin estoura o limite do servidor, a API pausa o turno e devolve resposta pela metade; o código tratava como final. Corrigido: reenvia o parcial e pede a continuação.

**Dois eram débito pré-existente que a mudança tornou mais visível:**

4. **A CACÁ afirmava que o PIX do credenciamento já tinha sido enviado, sem checar.** Eu tinha corrigido a persona, mas a raiz estava no executor: `consultar_status_cad` retornava literalmente *"o PIX do credenciamento já foi emitido e enviado"* para quem estivesse na etapa `prevenda`. E `prevenda` só prova **crédito aprovado**: o disparo em lote busca exatamente quem está nessa etapa sem pagamento, e o envio pode ter falhado (número sem WhatsApp, e-mail errado). O corretor saía da conversa achando que o cliente recebeu, com a CAD parada. Corrigido no executor, nos rótulos de etapa e na persona. É o mesmo padrão de sempre: **regra nova não alcança o resíduo antigo.**
5. **`montarTurnoDeFalha` lia `readCacaAutomationState(ticket)` em vez de `ticket.metadata`**, e gravava estado vazio: o cliente que já tinha validado identidade precisava validar tudo de novo. Uma palavra.

**Um era limitação da minha própria correção:**

6. **O retry classificado fechava a porta errada.** Filtrar por status resolvia 4xx, mas 429 e 5xx são justamente os erros que acontecem **no meio** do turno, depois de ferramentas já terem rodado. Agora o erro carrega o trace parcial (`ClaudeAgentTurnError`) e o turno não é repetido se alguma ferramenta com efeito colateral já executou (`enviar_pix_credenciamento`, `enviar_ficha_cad`, `gerar_relatorio_visual`, `registrar_chave_pix`, `anotar_sobre_cliente`).

**Um era ganho que eu tinha deixado na mesa:** o bloco do modo assistente (~2.300 tokens) é texto fixo, sem dado de ninguém, mas estava fora do cache. Movido para o bloco estável: a direção passa de 0 para **95% de prefixo cacheado**, com teste garantindo que ele não vaza para o atendimento de cliente.

**Reduzido, não eliminado:** o `maxDuration = 300` não cobre o pior caso teórico (API degradada, várias chamadas longas). O timeout do cliente Anthropic caiu para 90s, o que limita o pior caso por chamada a 180s. A garantia real exigiria processar o webhook de forma assíncrona, o que é outra mudança.

Entre os 22 refutados, os mais instrutivos: "o handoff no catch cobre falha depois do envio bem-sucedido" (não cobre, existe a flag `entregouAoCliente`), "o teto de 2 a 4 frases estrangula o modo assistente" (não estrangula, o bloco da direção pede resposta executiva e vem depois) e "o corte pode partir um par surrogate e gerar JSON inválido" (o corte cai em quebra de linha, e `JSON.stringify` escapa surrogate solto).

## 10. Fora de escopo (decisão pendente)

- **Os outros 6 consumidores do tier `heavy`** continuam no Opus 4.8. Subir cada um exige revisar o `max_tokens` dele.
- **Migrar o contexto datado da persona para o mural** (ação de lançamento, regras do PIX, fila do evento): tira condição comercial do caminho de deploy, mas o texto precisa ser aprovado pela operação.
- **`fallbacks: "default"`** (roteamento automático de recusa para outro modelo, via header beta): não ativado. O modo de falha de um header beta errado é 400 em toda chamada, e não dá para verificar sem a chave.
- **Trava de concorrência real na guarda de turno** (índice único parcial em `caredesk_messages`): exige migration.
- **Acumular `toolsUsed` por turno** em vez de sobrescrever.
