# 2026-09-29 · O Garden validado sai da LSoft Integração e entra no Financeiro (v1.397.0)

Pedido do Lucas, com a planilha `OBSERVAÇÕES DO GARDEN S.xlsx` (exportada da própria LSoft
Integração, aba "OBS. LUCAS"): *"agora eu quero subir as carteiras que estão validadas pelo time
adm (...) as que estiverem com ok (...) vai deixar de existir no lsoft e agora vai para carteira do
garden, as que tiverem algum observação deixar ainda na tela de integração"*. Depois: *"esquece o
c2x, cecilio não tem nenhum vinculo com o legado c2x"* e *"é só copiar e colar na carteira"*.

Autorização: *"tem o meus oks"* (29/09/2026) para migration, gravação e deploy.

## O caminho simples, e por que não o longo

Um projeto técnico completo (carteira nova no banco, casador do Asaas, baixa manual nova, 12 fatias)
foi escrito e começou a ser implementado. O Lucas cortou: *"estou achando muito longo"*, *"uma coisa
simples, que já está validado"*. O projeto ficou em `docs/operations/2026-09-29-carteira-do-garden-no-panteon.md`
e o código dele na branch `wip/carteira-panteon-longa` (commit `77434d07`). Não retomar sem pedido.

O que entrou:
- **Migration 0199** `lsoft_clientes.empreendimentos_na_carteira text[] not null default '{}'`:
  por (cliente, empreendimento), porque 11 dos 106 também têm Giant Towers, patrimônio e outras
  carteiras, que continuam na integração.
- **Sem cópia de dado:** o Financeiro lê do espelho (`lsoft_parcelas` categoria 124 e a view 0107)
  as parcelas do Garden desses clientes, no lote NOVO do boleto (CPF em `boletos_documentos`).
  Clicar no cliente abre a ficha do LSoft (Cadastro, Parcelas, Documentos, Histórico), onde a baixa
  já existe, com trilha.
- **A integração tira o par** (cliente, Garden): some do recorte Garden e, em "Todos", o Garden é
  descontado do total do cliente. A prontidão de boletos continua contando todos.
- **Ficam para depois:** baixa automática pelo Asaas, Indicadores e líquido do Garden (a política de
  gestão de carteira do 39 está nula; a tela diz "não apurado").

## Números (ensaio de 29/09/2026, só leitura)

- Sobem **106 clientes**, 9.868 parcelas (872 pagas, 8.996 em aberto, 24 vencidas).
- Em aberto **R$ 30.556.722,22**, vencido R$ 77.958,98, recebido R$ 4.484.836,13.
- View 0107 = soma das parcelas em 106 de 106; nenhuma marca de Caixa no Garden.
- Status: 95 viram "validado"; os 11 com outra carteira ficam com o status que têm (só a observação).
- **Ficam na integração 35:** 24 com observação na planilha, 10 com OK e pendência (00000440,
  00000487, 00000548, 00000599 sem lote pelo boleto; 00000524 e 00000538 com CPF cruzado entre
  boletos; 00000086 cronograma nunca lançado; 00000587 contrato dividido entre dois pagadores;
  00000560 anuais idênticas às do 00000059; 00000179 permuta, decisão do Lucas) e 1 fora da
  planilha (00000558).

## Deploy

- Migration 0199 aplicada em `bxgukywoxgivlrhjkwjx` (número conferido livre no registro e na main;
  a 0198 é de outra frente). Conferida: `text[]`, not null, default `'{}'`, RLS ligada, 0 marcados.
- Push na main `473404d2..1fd7d9ea` (suíte do pré-push: 724 arquivos, 10.843 testes). A primeira
  tentativa foi recusada por estouro de tempo em 7 testes alheios com a máquina carregada por um
  jogo aberto; sozinhos, os 7 passaram (62 testes em 13 s). Com o jogo fechado, passou inteira.
- Deployment `dpl_HLhREfNdmRb8Kk3L5eiZAuW5M83Y`. Rollback: `dpl_JCxCAN4a1Z3eDetgMPCwT6627qjw`
  (commit `473404d2`, v1.396.0). A marcação se desfaz com
  `node scripts/carteira/subir-garden-para-carteira.mjs --desfazer` (devolve status, carimbo e
  observação pela trilha).

## Gravação e conferência (29/09/2026, depois do deploy)

- `v1.397.0` no ar (`/api/version`), `c2x.app.br` 200, `/api/incorporador/carteira` e
  `/api/incorporador/lsoft` 401 sem sessão.
- `subir-garden-para-carteira.mjs --gravar`: 106 gravados, conferência 106 de 106.
- Conferido no banco, por conta própria: 106 com o Garden na carteira, 95 `validado`, 35 clientes do
  Garden na integração (de 141), 9.868 parcelas e R$ 30.556.722,22 em aberto no Financeiro, 497
  linhas de trilha do script, nenhuma marca estranha.
- O que o Financeiro mostra para o Garden, calculado pela mesma função da rota (só leitura): 106
  unidades, Carteira total R$ 35.041.558,35, Recebido R$ 4.484.836,13, A receber R$ 30.478.763,24,
  Vencido R$ 77.958,98 (24 parcelas, 13 clientes), inadimplência 1,67% (vencido sobre o previsto até
  hoje, a régua do Financeiro), 14 unidades com aviso (outro lote ou lote em conferência), nenhuma
  sem lote.

## 30/09/2026 · Uma linha por lote e a baixa pelo boleto do hub (v1.398.0)

Lucas, olhando o Financeiro em 29/09: *"se ele tem dois lotes, tem que ter duas linhas"*, *"subiu os
valores de setembro que foi emitido por nos?"* e *"a partir de setembro, quem alimenta a carteira é o
hub"*. Autorização de 30/09: *"pode seguir"*, em resposta a "posso publicar em produção? a publicação
já liga a baixa automática".

- **Uma linha por lote:** `lib/lsoft/lotes-do-garden.ts` (mapa conferido de lote antigo para novo, 143
  lotes) e `dividirPorLote` em `lib/lsoft/carteira-no-financeiro.ts`. 106 clientes, 111 linhas (5
  clientes com 2 lotes). Em 4 deles o LSoft tem uma parcela só para os dois lotes e o hub emite um
  boleto por lote: a parcela é repartida meio a meio, com aviso na linha. As somas não mudam.
- **Baixa pelo hub:** `lib/lsoft/baixa-do-hub.ts`. Boleto pago em `boletos_pagamentos` (Garden,
  competência de 2026-09 em diante) casa com a parcela por unidade, lote antigo, CPF e mês de
  vencimento, nunca por valor. Grava por `salvarParcelaDoLsoft`, autor "Hub · boleto Asaas <id>".
  Parcela reaberta à mão não é baixada de novo. Roda na rota `/api/boletos/pagamentos/sincronizar`
  (cron de hora em hora, minuto 10), que passa a reler competências anteriores do Garden com boleto
  em aberto (até 2 listagens a mais por hora no Asaas).
- **Setembro, gravado em 30/09 às 07h35** (`scripts/carteira/baixar-pelo-hub.mjs --competencia 2026-09
  --gravar`): 7 parcelas baixadas por 11 pagamentos, R$ 26.479,89, 21 linhas de trilha. O ensaio
  seguinte deu 0 baixa nova e 102 já pagas (não baixa em dobro).
- **Financeiro do Garden depois da baixa** (mesma função da rota, só leitura): 111 linhas, carteira
  R$ 35.042.609,64, recebido R$ 4.511.316,02, a receber R$ 30.478.763,24, vencido R$ 52.530,38 (18
  parcelas, 9 clientes), inadimplência 1,12%.
- **Para o time adm conferir:** 00000290 (parcela de setembro baixada na ficha em 24/08 com
  R$ 2.209,59 e boleto de setembro pago no Asaas em 16/09 com R$ 2.223,07: possível pagamento em
  dobro); 00000612 (boleto Q13 L10, lote antigo 382 pelo mapa, e as parcelas estão no 383 no LSoft);
  26 boletos pagos de clientes que ainda estão na integração seguem com baixa manual; 12 boletos de
  setembro vencidos (8 de clientes do Financeiro).
- Deploy: push `1fd7d9ea..ad33e8d0` (pré-push: 726 arquivos, 10.939 testes). Rollback: o deployment
  da v1.397.0 (commit `1fd7d9ea`). As baixas do hub se identificam por `editada_por like 'Hub · boleto
  Asaas%'` e se desfazem reabrindo a parcela na ficha.
- ⚠️ Pendências: os avisos da baixa automática (estorno depois de baixa, valor diferente, lote que
  não casa) vão só para o log do servidor; a rota de sincronização aceita qualquer usuário com leitura
  do Apolo, e agora a mesma chamada dá baixa (o que é baixado não depende de quem chama).
