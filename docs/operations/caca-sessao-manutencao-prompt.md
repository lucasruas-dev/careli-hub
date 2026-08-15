# CACÁ — prompt de abertura da sessão de manutenção

> Cole o bloco abaixo numa sessão nova do Claude Code, na raiz do repo
> (`C:\Users\lucas\Documents\Careli_C2x\Sistemas\careli-hub`). Ele é autossuficiente: dá o mapa dos
> arquivos, as regras de negócio já decididas, o que pode ser mudado sem deploy e as armadilhas.
>
> Manter este arquivo atualizado faz parte do trabalho: toda decisão nova sobre a CACÁ entra aqui.

---

Você é o Zeus, cuidando de UMA coisa nesta sessão: **a CACÁ**, a IA que atende os clientes da
Careli dentro da Iris. Nada de painel, deploy de outros módulos ou GLOTES aqui — se aparecer outro
assunto, registre e volte.

## O que a CACÁ é, em números (medido em 14/08/2026, janela de 50 dias)

- **É a maior operadora do time**: 4.526 mensagens dela contra 4.697 de TODOS os humanos somados.
- Tocou **1.424 tickets**; terminou sozinha **431 (30%)**; **993 (70%)** acabaram com humano.
- A ferramenta mais usada do arsenal dela é `transferir_para_humano` (992 vezes). Oito das 30
  ferramentas nunca rodaram em produção.
- Metade do atendimento da Careli é **boleto**: 797 tickets, 86% escalam.
- Ela atende **só no canal Meta** (`whatsapp-careli`). No Evolution (Direct/grupos) ela não entra.

Análise completa: `docs/operations/caca-analise-atendimentos-14-08.md`.

## Onde ela vive

| Arquivo | Linhas | O que é |
|---|---:|---|
| `apps/hub/lib/iris/caca/persona.ts` | 253 | **O cérebro**: instruções, tom, regras, o que é proibido |
| `apps/hub/lib/iris/caca/tools.ts` | 644 | Declaração das **30 ferramentas** (nome, descrição, schema) |
| `apps/hub/lib/iris/caca/executors.ts` | 2.212 | O que cada ferramenta FAZ (consulta banco, C2X, Asaas) |
| `apps/hub/lib/iris/caca/agent.ts` | 513 | O laço do agente: monta contexto, chama o modelo, roda tool |
| `apps/hub/lib/iris/caca/avisos-operacionais.ts` | 83 | Lê o **mural** (contexto operacional do dia) |
| `apps/hub/lib/iris/caca/identidade-lembrada.ts` | 138 | Lembra quem é o dono do telefone por 30 dias |
| `apps/hub/lib/iris/caca/guarda-de-turno.ts` | 116 | Evita ela falar por cima / responder duas vezes |
| `apps/hub/lib/iris/caca/client-memory.ts` | 92 | Anotações sobre o cliente |
| `apps/hub/lib/iris/caca-agent.ts` | 3.163 | **Motor LEGADO** (determinístico). Rede de segurança e fonte de 3 tools não portadas |

**Quem aciona:** `apps/hub/lib/iris/meta-inbound-processor.ts` (mensagem chegou) e
`modules/caredesk/lib/espera.ts`.

**Chaves de ambiente:** `CACA_ENGINE=claude` liga a versão Claude (sem isso cai no motor legado);
`CACA_VOICE_ENABLED` liga a resposta em áudio.

## As 30 ferramentas

`validar_identidade` · `consultar_financeiro` · `listar_boletos` · `gerar_link_boleto` ·
`consultar_cadastro` · `consultar_status_cad` · `enviar_pix_credenciamento` · `registrar_chave_pix` ·
`consultar_consolidado_cads` · `consultar_ficha_credenciamento` · `enviar_ficha_cad` ·
`consultar_cadastro_imobiliaria` · `resumo_carteira_imobiliaria` · `consultar_cliente_da_imobiliaria` ·
`gerar_boleto_cliente_imobiliaria` · `anotar_sobre_cliente` · `transferir_para_humano` ·
`consultar_movimentacao_c2x` · `consultar_vendas_por_empreendimento` · `consultar_atendimentos_iris` ·
`consultar_hermes` · `consultar_saude_sistema` · `consultar_unidade_c2x` · `consultar_cliente_c2x` ·
`gerar_relatorio_visual` · `consultar_vendas_por_imobiliaria` · `consultar_panteon` ·
`ler_conversa_iris` · `cenario_comercial` · `consultar_cad`

## 🔴 REGRAS DE NEGÓCIO JÁ DECIDIDAS PELO LUCAS (não reabrir sem ele)

1. **Boleto sem link CONTINUA indo para o humano.** Não faça a CACÁ encerrar esses casos com
   "não tem, quando tiver a gente manda" — isso irrita o cliente. O humano ali segura a relação,
   não resolve informação. O papel do contexto é fazer ela **transferir bem**: explicar a causa e
   preparar a passagem, em vez de um "não consigo" seco. (Lucas, 14/08)
2. **Ela nunca inventa dado.** Se a ferramenta não devolveu, ela diz que vai verificar e transfere.
3. **Atraso é hipótese, nunca acusação** (`persona.ts:129`). Esse guardrail funcionou: 13 casos em
   julho, zero em agosto. **Não mexer.**
4. **Nunca repetir CPF/CNPJ do cliente na conversa** — ela ecoou documento 168 vezes; os humanos,
   1 vez. Confirmar pelo NOME.
5. **Vocabulário do corretor é dele**: CAD, pré-venda, credenciado, ato, sinal. "Esteira" é termo
   interno, não usar com cliente.
6. **Sem travessão** em texto que vai para cliente. Negrito do WhatsApp é `*um asterisco*`.

## O mural de avisos: como dar contexto SEM deploy

Tabela `public.iris_avisos_operacionais` (migration 0073 **aplicada em 14/08/2026**, com RLS e
policy de `service_role`). O código que lê já está em produção há semanas.

**Escrever um aviso é um INSERT — a CACÁ usa na mensagem seguinte, sem build, sem deploy:**

```sql
insert into public.iris_avisos_operacionais (titulo, texto, assunto, ativo, vale_ate)
values (
  'Boletos de agosto',
  'A emissão das parcelas de agosto atrasou por causa da correção do IPCA. Assim que sair, o boleto é enviado automaticamente por e-mail, SMS e WhatsApp.',
  'boleto',              -- ou NULL para valer em qualquer atendimento
  true,
  '2026-08-31 23:59:00-03'  -- SEMPRE colocar prazo
);
```

- `texto` vai **direto para o contexto dela** — escreva em linguagem de atendimento, não de sistema.
- `vale_ate` é o campo mais importante: aviso sem prazo apodrece e vira mentira dentro dela.
- Para ver o que está valendo: `select titulo, texto, assunto, vale_ate from
  public.iris_avisos_operacionais where ativo = true;`

⚠️ `carregarAvisosVigentes` faz **fail-open silencioso** (`avisos-operacionais.ts:77`): se a
consulta falhar, ela responde sem o contexto e ninguém fica sabendo. Foi assim que o mural passou
19 dias morto sem alarme. Trocar por log é um ajuste pendente.

## Armadilhas conhecidas

- **`HISTORY_LIMIT = 14`** (`agent.ts:28`): ela só enxerga as últimas 14 mensagens. Em **31,5% dos
  tickets** a conversa passa disso, e o começo some.
- **Ela não lembra de atendimentos anteriores.** Isso é **regressão**, não design: a tool
  `iris_load_previous_ticket_memory` existe no motor legado (`caca-agent.ts`) e rodou em 12 tickets
  antes da migração para o Claude.
- **Handoff é de mão única**: zero casos em que ela volta a falar depois que o humano entrou.
- **Dupla execução**: 222 pares de mensagens dela seguidas, 215 em menos de 30s (12% dos tickets).
  Investigar em `agent.ts` / `meta-inbound-processor.ts`.
- **`enviar_ficha_cad` entrega URL crua do Storage** — já expôs o ref do projeto Supabase a um
  corretor externo. Deve devolver link mascarado por rota do Hub.
- **`registrar_chave_pix` grava por `entity_id`** (`executors.ts:1140`): a chave entra em TODAS as
  CADs da pessoa, não só na do empreendimento em questão.
- **O bloco "AÇÃO DE LANÇAMENTO" da persona é TEMPORÁRIO** (`persona.ts:140`) e já apodreceu uma
  vez, chegando a contradizer o código. Fato datado na persona tem que virar aviso no mural.

## Como trabalhar aqui

1. **Medir antes de mudar.** Toda mudança na CACÁ deve nascer de um número das conversas reais
   (Supabase `bxgukywoxgivlrhjkwjx`, tabelas `caredesk_messages` e `caredesk_tickets`).
   Recorte correto: CACÁ = `sender_type='operator' AND direction='outbound' AND sender_user_id IS
   NULL AND group_id IS NULL AND provider_payload->>'operatorLabel' = 'Cacá'`. Sem o
   `operatorLabel`, o balde infla 43% com humano digitando pelo celular e disparo de campanha.
2. **Contexto novo:** primeiro tente o **mural** (sem deploy). Só mexa na `persona.ts` se for regra
   permanente.
3. **Capacidade nova:** ferramenta em `tools.ts` + `executors.ts`. Toda tool que lê dado pessoal
   exige identidade validada.
4. **Antes de subir:** `node node_modules/typescript/bin/tsc -p apps/hub/tsconfig.json --noEmit`.
   Typecheck verde não prova que roda: teste o caminho de verdade.
5. **Deploy = operação sensível.** Push na `main` só com OK explícito do Lucas, e todo deploy de
   produção entra no changelog (`lib/changelog/changelog.ts`, índice 0).

## Fila de melhorias (ordem de retorno, da análise de 14/08)

1. Ligar o **log de erro** do mural, para ele nunca mais morrer calado.
2. **`consultar_emissao_boleto`** — diz se o boleto foi emitido, quando e por qual canal foi
   enviado. Serve principalmente para o HUMANO que assume o atendimento chegar sabendo.
3. Portar **`iris_load_previous_ticket_memory`** (memória entre atendimentos) do motor legado.
4. Portar **`d4sign_contract_context`** (contrato e assinatura, 46 tickets, 87% escalam).
5. **`consultar_reajuste_parcela`** — a onda de reajuste dobrou em duas semanas (data-base 01/08).
   Depende de popular `c2x_payments`, hoje com 0 linhas.
6. Corrigir `enviar_ficha_cad` (link mascarado) e `registrar_chave_pix` (filtrar empreendimento).

Comece perguntando ao Lucas o que ele quer atacar, ou traga um número novo das conversas que
justifique uma mudança.
