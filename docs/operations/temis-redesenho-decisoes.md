# Têmis · o redesenho do quadro — decisões do Lucas

> Mockup aprovado: [`docs/mockups/temis-quadro-e-tela-de-trabalho.html`](../mockups/temis-quadro-e-tela-de-trabalho.html)
> (desenhado em 09/09/2026, salvo no repo em 10/09 — ele vivia num diretório temporário do Claude).
>
> As cinco perguntas que o mockup deixou em aberto foram respondidas pelo Lucas em **10/09/2026**.
> Este arquivo é o registro delas: o que decidiu, e o que isso obriga a construir.

---

## 1. Pagamento da entrada — RESOLVIDO em 09/09

Vem do C2X, pelo painel de sinal que o Apolo já usa (`lib/apolo/painel-sinal.ts`), pelo elo
`hercules_propostas.origem_c2x_id → acquisition_requests.id`. Não há botão de "confirmar
pagamento" na Têmis: ela LÊ.

⚠️ **Fio solto declarado no mockup:** venda que nasce no Panteon não chega ao C2X (o endpoint de
reserva do legado nunca foi entregue, e `hercules_vendas` está vazia). Então a etapa Prazo legal só
enxerga pagamento de venda que passou pelo legado. Não é defeito do redesenho — é o limite dele.

---

## 2. Indeferimento — é uma FRENTE, não um botão

Lucas (10/09/2026): *"credito? não tem credito na temis"* — corrigindo a leitura errada de que o
botão vermelho do mockup seria reprova de crédito. Crédito é do Apolo (esteira de CAD + Serasa);
a Têmis indefere o **trabalho**, não o comprador.

E: *"Temos que ter uma sessão de Indeferimento, o deferimento tem que chegar no corretor -
imobiliaria - coordenador. Ae temos que ter os motivos e tal"*.

**O que isso obriga:**

| peça | decisão |
|---|---|
| motivo | **lista pronta + observação livre**. O catálogo permite contar qual motivo mais repete; a observação diz o caso. |
| coordenador | avisado **dentro do Panteon** (notificação) |
| corretor e imobiliária | avisados pela **central de Relacionamento** |

⚠️ **A CENTRAL É A DE RELACIONAMENTO, E ISSO É REGRA DA CASA** — não escolha deste desenho.
Imobiliária e corretor falam pela Relacionamento; cliente fala pela Atendimento
(`[[project_apolo_disparo_por_central]]`). Mandar pela central errada põe a conversa na caixa de
quem atende comprador.

---

## 3. Os 7 dias de arrependimento — da ÚLTIMA assinatura do comprador

Só começa a contar quando **todos os compradores** assinaram. A **vendedora não entra na conta** —
ela não se arrepende.

⚠️ Isso torna a contagem dependente de saber **quem é comprador** dentro do envelope. Os
signatários ficam congelados em `temis_envelopes.signatarios` com papel; é de lá que sai a
distinção, e não da ordem de assinatura.

---

## 4. Cessão, distrato e cancelamento — CAMINHO PRÓPRIO, mais curto

Não passam pelas cinco etapas do contrato: não têm prazo de arrependimento nem entrada a pagar.
O caminho deles é o que faz sentido para um documento que se assina e se arquiva.

A casa já tem as réguas puras e testadas: `lib/temis/cessao.ts` (travas de entrada) e
`lib/temis/cancelamento.ts` (`classificarCancelamento` decide cancelamento × distrato pelas duas
perguntas: assinou? pagou?).

---

## 5. Excluir signatário depois do PDF gerado — SÓ SAI DO ENVELOPE

O PDF fica como está; a pessoa apenas não é convidada a assinar.

⚠️ **RISCO ACEITO, E QUE A TELA TEM DE MOSTRAR:** o contrato impresso continua citando quem não
assinou. A decisão é do Lucas (10/09/2026); o que cabe ao desenho é não esconder — o signatário
removido aparece com o aviso ao lado, e não some da tela.

---

## O que isso obriga no banco

O `check` de `temis_trabalhos.estagio` aceita hoje **quatro** valores
(`entrada`, `confeccao`, `assinatura`, `finalizado`) e **recusa** os nomes do mockup. Migration
necessária, com tradução das linhas existentes:

| hoje | vira |
|---|---|
| `entrada` | `analise` |
| `confeccao` | `contrato` |
| `assinatura` | `assinatura` |
| `finalizado` | `faturado` |

Mais: `prazo_legal` (etapa 4, nova) e `indeferido`.

⚠️ **`estagio_desde` É A BASE DE TODOS OS PRAZOS e não pode andar para trás** — a regra já está
escrita em `lib/assinatura/estado-db.ts`. Uma tradução de nome não é um avanço de etapa: o
carimbo fica como está.

E colunas novas para o indeferimento: quando, quem, motivo (código do catálogo) e observação.
