# F9 · Todo indicador de venda conta pelo Panteon

## PLANO VIGENTE (revisão de 28/09/2026)

> 28/09/2026, fim da tarde · arquiteto (subagente do Zeus) · worktree `assinatura-fonte-unica`.
> Esta seção MANDA. Tudo o que vem depois dela (o desenho original, o "Ataque paridade", o "Ataque
> regressao", as respostas do Lucas e a correção da resposta 2) fica como histórico e só vale no que
> esta seção não mudou. Medições novas desta revisão: SELECT em `bxgukywoxgivlrhjkwjx`, sem dado
> pessoal; o C2X não foi consultado (lido só o código que fala com ele e o espelho dele no Supabase,
> `apolo_commercial_links`, que cobre ~924 pedidos). Nada aplicado, commitado nem publicado. Migration,
> deploy, cron, `--gravar` e mudança de sync exigem OK do Lucas, a cada vez.
>
> **Segunda revisão (28/09, noite).** Conferidos os 27 achados do "Ataque custo-acesso" (A1 a A13) e
> do "Ataque duplicidade" (D1 a D14), no código deste worktree e por SELECT em `bxgukywoxgivlrhjkwjx`.
> Todos entram (tabela V1b); o que o crítico deu como alternativa e eu não escolhi tem uma linha de
> porquê. As seções V2.3, V3.2 a V3.11, V4 e V5 abaixo já estão reescritas com eles.

### V0. O que mudou, em cinco linhas

1. **"Vendido" é só faturado**, em toda tela. Contrato e assinatura são "Em negociação". A palavra
   "Venda" como indicador (a antiga D5) morre.
2. **O que as telas leem hoje do C2X é GRAVADO no Panteon sozinho** (correção da resposta 2): nasce a
   **F10, o espelho de vendas do C2X**, que só CRIA o que falta, LIGA a redigitação à venda nativa e
   só ANDA a venda da carga que o Panteon nunca tocou. Não é a carga de 21/09: não regrava nada.
3. **Garden** fica visível só no portal da Cecílio: trava em toda sessão do portal comercial (a
   Gurgel). Como as vendas dele entram é a V5.2 (a F10 só se o C2X tiver pedidos do Garden).
4. **Perfil do comprador sai** das telas, do BI público e da CACÁ até a ficha do Apolo ter o dado.
5. Os 27 ataques (P1 a P15, R1 a R12) foram conferidos: 25 aceitos inteiros, 2 aceitos em parte; a
   tabela V1 diz onde cada um entrou.
6. **Segunda revisão (V1b)**: a F10 passa a ser um escritor que respeita "um dono por lote" como a
   porta da reserva (guarda completa do terreno, índice de uma viva por linha, grava-relê-desfaz),
   tem MEMÓRIA por pedido (não ressuscita venda que o time encerrou), casa o pedido pela nativa VIVA,
   não cria reserva do C2X, solta o lote quando o C2X cancela, e cria e anda na mesma subida. O
   Garden não tem pedido no C2X até 16/09 (0 propostas da carga): entra na F10 só se o ensaio `--so
   GDN` mostrar pedidos. A trava do Garden vale só para o portal comercial e nasce onde o escopo
   nasce; o portal `mmendes` (que só tem o Garden) não muda sem resposta (V5.1).

### V1. Os ataques: aceito ou rejeitado, e onde entrou

| # | Decisão | Onde entrou |
|---|---|---|
| P1 escopo por tela | aceito | F9a ganha a quarta peça `escopoDosIndicadores({ sessao, pedido })`, lida só do cadastro (`pai_id`, `c2x_enterprise_id`, marca "fora dos indicadores" para TST, SDT e TSC) e com a trava do produto operado (V3.9: GDN só para a sessão do operador). Listas fixas (`ENTERPRISE_MIRRORS`, `CARTEIRAS_VIVAS`, `EXCLUDED_ENTERPRISE_*`, `catalogoDeEmpreendimentos`) entram na varredura. A linha do ACT nasce no cadastro antes da F9b (PAN-124). |
| P2 linhas do pai | aceito | `linhas` só com `espelho_de is null`; o pai vira os filhos dentro do resolvedor; teste `I([35]) = I([36,37,41])`. F9a e F9b. |
| P3 três "vendido" | aceito, e resolvido pela resposta 1 | `ROTULO_DO_INDICADOR` com um rótulo por definição; "Vendido" = D6 (V2.1). A pergunta 4 que o ataque propunha morreu: o Lucas já respondeu (a regra do BI de 10/08 sai). |
| P4 estado da unidade como estado da pessoa | aceito, com chave nova | Em tela por pessoa ou por pedido a chave é a PROPOSTA. Pedido do C2X: `origem_c2x_id` (carga) ou **`c2x_pedido_id`** (redigitação ligada pela F10, V3.5). O "casar pelo cliente da proposta que decide" do ataque sai: a F10 grava a ligação. F9e, F9f, F9h, F9j. |
| P5 janela | aceito | `Janela` com dia; janela padrão calculada no servidor, em Brasília; o número mostra a janela; `ONDE_APARECE` declara a janela. F9a. |
| P6 fuso no SQL | aceito | A 0201 expõe `*_mes` (texto) e `*_dia` (date) calculados `at time zone 'America/Sao_Paulo'`; nenhuma conta agrega fora deles. |
| P7 contas fora de I | aceito | Segunda view `hercules_reserva_fatos` (reservas do Hércules e do salão, fora os cupons convertidos); I ganha `reservas`, `contratosGerados`, `naoLancadas`; varredura proíbe `.filter(` sobre `FatoDaVenda` fora de `lib/hercules/indicadores/`. F9a. |
| P8 não lançada | aceito | `estoque.naoLancadas` (preço ≤ R$ 1) fora do total comercial em TODA tela. Hoje: VOL 46, VOC 26, **GDN 165**, ids 19, 28, 38. F9a, F9b, F9g. |
| P9 pai = soma quebra distinto | aceito | O pai é UMA chamada sobre a união dos filhos; `definicoes.ts` marca o campo aditivo; teste "pai = I(filhos)". |
| P10 cache e instante | aceito em parte | Aceitos: nada de cache por instância, `lidoEm` em toda tela, paginação por chave (`gt('proposta_id', último)`). **Rejeitado**: descartar e reler a resposta se `max(quando)` mudou entre E e F. A escrita de venda é de dezenas por dia; a releitura dobra o custo da tela quente (R5) para cobrir uma janela de milissegundos, e o `lidoEm` já diz ao leitor de quando é o número. |
| P11 rodapé e lista por sigla | aceito | F9c tira `propostasNoPeriodo`/`totais.propostas` (ou lê de I) e a lista passa a `unidade_id in (linhas vivas do escopo)`. |
| P12 "Faturados" e "Assinatura" | aceito | Card Faturados lê I ("N no escopo · M com contrato no Panteon"); o passo da faixa vira "Em assinatura ou assinado" até a F8 esvaziar a etapa. F9a, F9c. |
| P13 CAD no funil | aceito | `contarCads` único em `lib/apolo`, ordem determinística, paginado. F9c. |
| P14 predicados por acaso | aceito | `ehSombra` exportado e usado pela view e pela régua; `workspace_id = 'careli'`; `aberta` na lista proibida da varredura; pessoa = entidade, 5 documentos à fila de fusão. |
| P15 paridade no montador | aceito | Registro com `rota`, `escopo` e `janela`; o teste chama o handler da rota no banco em memória com `agora` fixo (23h30 do dia 30 em Brasília); conferência pelo PostgREST. |
| R1 F8 despeja 415 vendas | aceito | Passagem em lote com a data do FATO (nunca `now()`), marcada "F8 retroativa"; ensaio da F8 por mês de destino; F9i e F9j só depois da F8. A F10 reduz o problema: a venda da carga que o C2X já faturou anda pela F10 com a data do histórico (hoje 4: ACP 3, VOC 1), e a F8 fica com o resto. |
| R2 C2X à frente do Panteon | aceito, com outra saída | A lista vira TRABALHO DA F10, não pedido de redigitação: os pedidos novos são redigitação ligada (V3.5), a carga intocada anda (V3.7), a carga mexida fica listada. A saída "levar os 2 cancelados ao pedido de cancelamento com decisão do Lucas" sai: o JDG anda sozinho (intocada); o RVP foi mexido no Panteon e fica na lista de divergência. |
| R3 recorte financeiro | aceito | Transição "viva no Panteon OU com parcela em aberto no C2X", divergência vira lista. A junção por pedido deixa de perder a nativa: `c2x_pedido_id` (V3.5) liga a nativa ao pedido que gera o boleto; a unidade fica como reserva. F9h e F8. |
| R4 id de unidade do Hades | aceito | F9h resolve por (empreendimento, quadra, lote) ou corrige o id em `read-model-sync.ts` antes; teste com dois lotes e um id. |
| R5 custo da régua | aceito | `situacoes?` repassada por quem já leu; `lerSituacaoDoTerreno(unidadeIds)` antes da F9h e da F9i; Central do Prometeu em rota à parte, 60 s, com pausa. |
| R6 relógio da GLotes | aceito | F9j estreita: `lotes.status` e `vendas.situacao` pela régua (casada por pedido); relógio = maior entre o de hoje e a data do fato; o resto como está. |
| R7 valor da carga = tabela | aceito | "Negociado" e "desconto" da carga continuam da soma das parcelas (financeiro); D4 e 0.5 dizem que o valor da carga é a tabela do dia da carga. A F10 grava o mesmo `valor` que a carga (preço da unidade), pela mesma razão. |
| R8 leitura do C2X que sobra | aceito | Seção 4 ganha o bloco "cadastro que ainda vem do C2X" e o bloco "espelho de vendas (F10): lido para GRAVAR"; `query-panteon.ts` na F9i; `unidadeNoEscopo` por `hercules_unidades.origem_c2x_id` na F9d; varredura transitiva por importação. |
| R9 números que mudam | aceito, menos o perfil | A tabela vai ao Lucas antes de cada deploy. **Rejeitada** a sugestão de manter o perfil agregado no BI público (resposta 3). Linha nova: o Garden sai de "0" para as vendas que a F10 criar. |
| R10 preço e universo de 01/09 | aceito | Conferência "cadastro do Panteon ≠ C2X" antes da F9b. O GDN é mantido pela Cecílio desde 16/09 (D2): lá a diferença é esperada e não se corrige pelo C2X. |
| R11 teste e glebas | aceito | TST fora pela marca de P1 (nativas reais: 16); 43 pares de gleba contados na conferência; "todos" é uma chamada sobre a união. |
| R12 dado pessoal | aceito | `indicadoresParaOPortal` em toda rota `/api/incorporador/*`; `indicadoresParaOPublico` nas rotas públicas com teste que falha com uuid ou nome; Central cruza por `entity_id`. |

### V1b. Segunda revisão: "Ataque custo-acesso" (A) e "Ataque duplicidade" (D)

Conferido por mim (SELECT e código, 28/09 noite): o 39 está no portal `cecilio-rocha` (operador, 10
contas ativas) e no `mmendes` (portal só com o 39, 2 contas); na `gurgel` (comercial) 1 conta ativa tem
o 39 por vínculo próprio e é de domínio `@careli.adm.br`. Escopo vazio derruba a sessão
(`sessao/route.ts:170-172`). 0 linha com duas propostas vivas; 2.463 vivas da carga fora do pai, 2.453
em linha `vendida`. `hercules_propostas_uma_viva_por_unidade` só cobre `origem = 'panteon'` e etapas
até `assinatura`. 0 proposta no GDN; linhas do GDN criadas em 01/09. VOC0306: nativa cancelada (16/09 a
21/09) e nativa viva (21/09) do MESMO comprador; VOL1106: a viva é de OUTRO comprador. 1.195 linhas
`bloqueada` fora do pai, 97 com `bloqueado_em`; 6 cupons `reservada`; 20 reservas vivas com validade
vencida; 0 trigger em `hercules_propostas`; FK: passagens e eventos em cascata, card, envelope,
documento e conversa em `set null`; 10 da carga editadas depois da importação, todas com marca. As
contagens de rotas do A2 variam com o critério (eu contei 20 `route.ts` com `idsDaSessao(` e 15 com
`codigosDaSessao(`), o achado não muda.

| # | Decisão | Onde entrou |
|---|---|---|
| A1 trava fecha o `mmendes` | aceito | V2.3, V3.9: trava em toda sessão `tipo = 'comercial'` (inclusive a do admin da Careli no `/gurgel`, V5.1b); portal de incorporador não muda até a V5.1a; nenhuma trava deixa escopo vazio calado (teste). O pedido operacional "tirar o 39 da conta da Gurgel" sai: é de admin da Careli, vira pergunta |
| A2 trava não cobre o portal | aceito | V3.9: a trava mora em `escopoDoUsuario` (puro) com `operados` lido por `escopoDaConta`; `gravarVinculosDaConta` recusa; varredura de `sessao.enterpriseIds`; F10e sobe e é provada ANTES de qualquer gravação da F10 (V3.11, V4) |
| A3 carga viva de outro pedido | aceito | V3.3: dono vivo = uma definição só (a do D1); rodada anda antes de criar |
| A4 cron sem filtro do GDN | aceito | V3.8: `CRIAR_EM` por id do C2X no código, lida pelo cron e pelo script; o 39 entra em deploy próprio |
| A5 F9d antes da F8 | aceito, na primeira forma | V4: F9d em duas (F9d1 estoque, mapa, pipeline, imobiliárias; F9d2 BI depois da F8). A categoria "faturada no financeiro" fica rejeitada como padrão: é uma segunda fonte de Faturado na tela, o que a F9 quer matar |
| A6 criar sem andar | aceito | V3.11, V4: um OK sobre o ensaio cobre criar, ligar e andar; F10b grava os três |
| A7 números por passo | aceito | V3.11: tabela "Diferença visível" da F10, com as linhas do GDN condicionadas ao ensaio (D8) |
| A8 custo 4 vezes | aceito | V3.8, V3.10: RPC de leitura `hercules_espelho_o_que_falta`; nova estimativa |
| A9 candidatos eternos | aceito | V3.1, V3.8: comparação por `ETAPA[etapa_c2x]`; impressão digital do contexto na tabela de decisões (D3); teto por rodada. A alternativa "gravar `etapa_c2x` quando a etapa é a mesma" fica rejeitada: é escrita a mais sem efeito em tela |
| A10 `FORA_DO_PANTEON` por sigla | aceito | V3.2: `FORA_DO_PANTEON_IDS` = 2, 30, 31, 34, 35 e a linha-sombra; teste com sigla trocada. Conferido: o "ADT" da carga é o id 30, renomeado ACT em 21/09 (a lista por sigla já estava furada); o 30 volta pelo `CRIAR_EM` quando o PAN-124 fizer o ACT filho da ACP |
| A11 valor do GDN | aceito | V3.2: produto com `operado_por` grava `valor = preco_tabela` da linha |
| A12 frescor | aceito | V3.8: aviso de fonte parada da F10 em 45 min; F9d1 declara "atualiza a cada 30 min" |
| A13 horário | aceito | V3.11: medir na prova; mudar só com OK |
| D1 guarda não conhece todos os donos | aceito | V3.3, V3.10: guarda = `outrosDonosDoLote` + irmã com cadastro de dono + `bloqueada` com irmã viva; RPC recebe `p_linhas`; índice `uma_viva_por_linha` para toda origem (0 conflitos hoje), depois de varrer todo `insert` em `hercules_propostas` |
| D2 corrida com a reserva | aceito | V3.3, V3.10: grava, commita, relê com `outrosDonosDoLote`, desfaz a PRÓPRIA linha por RPC guardada. Alternativa `pg_advisory_xact_lock` rejeitada: obriga a porta da reserva a virar RPC, mexendo num fluxo vivo sem ganho de garantia |
| D3 sem memória | aceito | V3.3, V3.10: `hercules_espelho_c2x_pedidos`; só cria o que era criável na primeira vez; `obsoletoPeloPanteon` na primeira rodada |
| D4 liga à cancelada | aceito | V3.5: modo `pedido` em `casar-pedido-do-c2x.ts` (a nativa VIVA do mesmo comprador vence); só estágio 2 a 6 e 9; `nativaJaLigada`; troca só da ligação feita pela F10 |
| D5 troca de lote | aceito | V3.3: `trocouDeLote` alarme; destino vira `conflitoDeDono` |
| D6 cancelado não solta | aceito | V3.2, V3.7: `soltarLoteDaVendaDesfeita` depois de andar para cancelado ou distrato (regra do Lucas de 24/09) |
| D7 reserva do C2X | aceito | V3.3: estágio 1 vivo não cria; `reservaSoNoC2x` |
| D8 Garden sem pedido | aceito | V3.6: 140 a 160 retirado; ensaio `--so GDN` primeiro; pergunta V5.2 nova |
| D9 troca de comprador | aceito | V3.1, V3.4: `ar.client_id` na lista leve; `compradorMudou` não anda |
| D10 outra gleba | aceito | V3.3: `mesmaVendaEmOutraGleba` não cria |
| D11 pai com outro comprador | aceito | V3.3: alarme `noPaiComOutroComprador` |
| D12 rollback apaga trabalho | aceito | V3.10: rollback só do intocado, contado antes |
| D13 marca de "mexida" | aceito | V3.4: sétimo critério `atualizado_em > greatest(importado_em, espelhado_em) + 1 s`; reserva viva = `ativa`/`proposta` sem olhar validade |
| D14 pedido em duas colunas | aceito | V3.10: CHECK e índice único do `coalesce`; POST e script tomam a vez |

### V2. As respostas do Lucas, aplicadas

**V2.1 Vendido = só faturado.** Mudam as definições da seção 2.3:

| Antes | Agora |
|---|---|
| D5 "Venda" = contrato, assinatura, faturado, vendida | **Sai como indicador.** Contrato e assinatura contam em "Em negociação" (balde da régua). "Vendas fechadas" do Prometeu, "vendas" da CACÁ e "Unidades vendidas" do CRM passam a D6. |
| D6 "Vendido" = balde vendido | **Igual, e é o único "Vendido"**: unidade em `faturado`; a `vendida` do cadastro sem proposta entra no mesmo balde com a categoria "vendido sem venda no Panteon" na conferência (0 linhas vivas hoje, medido pelo Ataque regressao). |
| D17 Comprador = titular de proposta que decide unidade em Venda (D5) | Titular de proposta **faturada** (por proposta, P4). Quem está em contrato ou assinatura é "em negociação" no CRM. |
| BI do Vale do Ouro: regra de 10/08 | Sai. O % vendido do BI público cai (VOL 90,5% → 61,0%, VOC 65,6% → 54,8% com o denominador sem "não lançadas"; o numerador cai também). Vai ao Lucas na "Diferença visível" da F9g. |

Consequência já escrita no R1: até a F8, o CDJ (375) e as demais em `assinatura` ficam fora de Vendido.

**V2.2 Perfil do comprador.** Sai de: TelaVendas (linha 29), BI público do Vale do Ouro (seis blocos,
linha 60), CACÁ modo direção (dimensões de perfil, linha 77). `perfil-comprador.ts` deixa de ser
chamado (Zeus apaga depois). A volta é pela ficha do Apolo (pergunta V5.3); nenhuma tela lê atributo
de pessoa do `users` do C2X.

**V2.3 Garden só no portal da Cecílio.** Medido hoje: o GDN (c2x 39) tem `operado_por` =
incorporador `cecilio-rocha`; o 39 está no vínculo de dois incorporadores (`cecilio-rocha` e
`mmendes`, 2 usuários ativos) e no vínculo de usuário de **1 usuário ativo do `gurgel`** (tipo
comercial). Corrigido na segunda revisão (A1): essa conta da Gurgel é de admin da Careli (domínio
`@careli.adm.br`), não de coordenador; **hoje nenhum coordenador da Gurgel vê o GDN**, e o `mmendes`
tem só o 39 no portal (tirar o GDN dele derruba o login das 2 contas). A trava (V3.9) fecha o risco de
amanhã no portal comercial; o `mmendes` e o admin ficam como estão até a V5.1.

**V2.4 Correção da resposta 2.** Vira a F10 inteira (V3). A lista "vendas que existem só no C2X" da
resposta 2 deixa de ser trabalho do time: é o relatório do ensaio da F10.

### V3. F10 · ESPELHO DE VENDAS DO C2X

**Objetivo.** Toda venda que uma tela mostra hoje lendo o C2X passa a existir em `hercules_propostas`,
gravada sozinha, sem ninguém redigitar, para que as telas da F9 leiam só o Panteon e os números
batam. Três gestos, e só três: **criar** o que falta; **ligar** o pedido redigitado à venda nativa;
**andar** a venda da carga que o Panteon nunca tocou. Nunca recua etapa, nunca escreve em venda que
o time mexeu, nunca cria card, envelope, reserva, entidade nem unidade. Duas exceções escritas (V1b):
depois de andar para cancelado ou distrato, SOLTA o lote pela porta do Panteon
(`soltarLoteDaVendaDesfeita`, D6); e, se perder a corrida com a porta da reserva, APAGA a própria
linha que acabou de criar, e só ela (D2). Fora isso, nunca apaga.

**Por que não é a carga encerrada.** A carga de 21/09 fazia `upsert ... merge-duplicates` por
`origem_c2x_id`: regravava a etapa (e todas as colunas) de quem já existia, e por isso foi travada
(`importar-fluxo-de-venda.mjs`, memória `feedback_carga_do_legado_encerrada`). A F10 só faz `insert ...
on conflict do nothing`; o único `update` é o avanço guardado por RPC (V3.7) e o preenchimento de uma
coluna NULA (V3.5). Os três scripts da carga continuam travados; a F10 não os usa para gravar.

#### V3.1 O que ela lê do C2X (só SELECT)

Uma conexão do pool de `lib/guardian/db.ts`, `START TRANSACTION READ ONLY`, timeout de 20 s por
consulta, `COMMIT` e `release` no fim: as funções `abrirLeituraDoC2x`/`fecharLeituraDoC2x` que a F3 já
criou em `lib/assinatura/espelho-d4sign/c2x.ts` (mover para `lib/c2x/leitura.ts` se a F3 já estiver no
ar; senão importar de lá). Datas do C2X saem como TEXTO (`date_format`) e viram ISO -03:00 por
`instanteDeBrasilia` (a carga usava `new Date(v).toISOString()` sobre o driver em UTC, que desloca o
horário de Brasília em 3 h; a F10 não repete).

```sql
-- (1) a lista leve, toda rodada (~5 mil linhas, < 1 s): é ela que substitui cursor
select ar.id as ar_id, ar.enterprise_unity_id as unidade_c2x_id,
       ar.acquisition_request_stage_id as etapa_c2x, ar.open as aberta,
       ar.client_id as cliente_c2x_id,   -- id, não dado pessoal (D9: troca de comprador)
       date_format(ar.created_at, '%Y-%m-%d %H:%i:%s') as criado_em_brasilia,
       date_format(ar.updated_at, '%Y-%m-%d %H:%i:%s') as atualizado_em_brasilia,
       u.enterprise_id as enterprise_c2x_id, e.code as enterprise_code
  from acquisition_requests ar
  left join enterprise_unities u on u.id = ar.enterprise_unity_id
  left join enterprises e on e.id = u.enterprise_id
 order by ar.id;

-- (2) o detalhe, SÓ para os pedidos que a rodada vai criar: a consulta da carga
--     (importar-fluxo-de-venda.mjs:228-254) com `where ar.id in (?)` em lotes de 500,
--     created_at/updated_at/sign_date/act_date/billing_date por date_format, e os
--     compradores 2..5 pela consulta de users da mesma carga (:267-268), também por IN.

-- (3) o histórico, SÓ para os pedidos a criar ou a andar (carga :273-279 com `where
--     h.acquisition_request_id in (?)`, created_at por date_format)

-- (4) o documento do comprador, SÓ para os candidatos a redigitação (V3.5):
--     SQL_DOS_COMPRADORES da F3, em memória, nunca gravado, logado nem devolvido
```

Por que a lista leve e não um cursor (`audits`, `updated_at`): o Apolo já sofre com cursor (trava de
sobreposição, `limit 5000`, primeira rodada que só registra a cabeça). A diferença entre a lista e o
Panteon É o trabalho: pedido sem proposta = criar; **`ETAPA[etapa_c2x]` diferente da etapa gravada**
(não o número cru: 4 e 6, 7 e 8, 10 e 11, 2 e 9 são a mesma etapa, A9) = candidato a andar;
`cliente_c2x_id` diferente do gravado = `compradorMudou` (D9); terreno da unidade atual diferente do
da proposta = `trocouDeLote` (D5). A DETECÇÃO roda sem estado e se conserta sozinha depois de uma
rodada perdida; a DECISÃO sobre um pedido já visto é lembrada (V3.3, tabela de decisões, D3).

A montagem sai de `scripts/hercules/importar-fluxo-de-venda.mjs` (`ETAPA`, `texto`, `numero`, a
montagem das linhas 378-464 e das passagens 568-589) para um módulo puro
`apps/hub/lib/hercules/espelho-c2x/montagem.ts`, com as mesmas regras (valor da unidade;
imobiliária por `users.vinculed_by_id`; `data_faturamento` só no estágio 4; `etapa_c2x` cru;
corretor nulo), com uma diferença: em produto com `operado_por` (GDN) o `valor` é o `preco_tabela`
da linha do Panteon, não o preço do C2X (A11), e o relatório conta quantos divergem. O script da carga
não muda (continua travado).

#### V3.2 O que ela grava no Panteon

| Tabela | Como | Chave de idempotência |
|---|---|---|
| `hercules_propostas` (venda nova) | `origem = 'c2x'`, `origem_c2x_id = ar.id`, as colunas da montagem da carga, `importado_em = now()`, `criado_por = 'espelho-c2x'`, `criado_por_nome = 'Espelho do C2X'`, `etapa_por` NULO, `cancelada_em` NULO. `cliente_c2x_id` e `imobiliaria_c2x_id` preenchidos; `cliente_entity_id`/`imobiliaria_entity_id` NULOS, como na carga: a view `hercules_venda_fatos` resolve a entidade por `apolo_source_links` (c2x/users, chave única), e o sync incremental do Apolo (5 min) já cria a entidade do cliente de todo pedido mexido (lê `audits` de `AcquisitionRequest` e chama `persistApoloEntityBatch`). Pedido cuja entidade ainda não existe conta em `semEntidade` e resolve na rodada seguinte, sem regravar nada. | `hercules_propostas_origem_c2x_id_key` (existe, única); insert com `on conflict (origem_c2x_id) do nothing` |
| `hercules_propostas` (redigitação) | SÓ `c2x_pedido_id = ar.id` na nativa, se nulo (V3.5) | índice único novo em `c2x_pedido_id` |
| `hercules_proposta_etapas` | uma linha por `acquisition_request_historics`, como a carga (`de`, `para`, `de_c2x`, `para_c2x`, `quando` = instante de Brasília, `autor_c2x_id`, `autor_nome`, motivo, observação). Só para venda criada pela F10 e para a carga intocada que anda (V3.7). Passagem em que `ETAPA[de] = ETAPA[para]` (ex.: 4 → 6, Faturado → Finalizado) NÃO entra no avanço: mudaria o mês da faturada já contada (D7 usa a última). | `hercules_proposta_etapas_origem_c2x_id_key` (existe, única); `on conflict do nothing` |
| `hercules_espelho_c2x` (nova, uma linha) | a vez da rodada e o relatório | `id = 1` |
| `hercules_espelho_c2x_pedidos` (nova, D3) | uma linha por pedido já decidido: `ar_id`, `decisao`, `motivo`, `impressao` (hash dos ids e etapas das propostas do terreno e do estágio do pedido, sem documento, A9), `primeira_vez`, `ultima_vez`. Só ids e códigos | `ar_id` |
| `hercules_propostas.espelhado_em` (coluna nova, D13) | a F10 grava `espelhado_em` e `atualizado_em` iguais em toda escrita dela | |
| `hercules_unidades` (EXCEÇÃO, D6) | só por `soltarLoteDaVendaDesfeita`, depois de `andou` para cancelado ou distrato: a porta do Panteon confere todos os donos do terreno, nunca desbloqueia, leitura que falha não solta. Nenhum SQL da F10 escreve em unidade | |
| `hercules_propostas` (EXCEÇÃO, D2) | `delete` da linha que a MESMA rodada criou e que perdeu a corrida (id devolvido, `criado_por = 'espelho-c2x'`, sem `etapa_por`, card, passagem sem origem, envelope, documento, conversa), pela RPC `hercules_espelho_desfazer_criacao`; falha grita no log com os ids | |

Não grava: card da Têmis, envelope (é da F3), reserva, entidade do Apolo, unidade (fora a exceção
D6), `cancelada_em`, `etapa_por`, nada em linha-sombra do pai, nada de TST, nada em produto
`FORA_DO_PANTEON`, agora **por id e não por sigla** (A10): `FORA_DO_PANTEON_IDS = {2 SDT, 31 LAB, 34
TSC, 35 VLO, 30 ACT}`, constante exportada da montagem, com teste de sigla trocada; o pai também sai
pela linha-sombra (`espelho_de`). Conferido: o "ADT" da lista da carga é o id 30, renomeado ACT em
21/09 (changelog do PAN-124), ou seja, a lista por sigla da carga já estava furada no dia em que foi
escrita (prova do A10). O 30 fica fora como a carga queria até a fatia do PAN-124 que faz o ACT filho
da ACP subir; aí entra pelo `CRIAR_EM` (V3.8), num deploy próprio. As propostas que a carga já trouxe
desses ids (SDT 16, LAB 156, TSC 2, ACT 31) não são tocadas.

#### V3.3 A regra de SÓ CRIAR, caso a caso

**Ordem da rodada (A3): primeiro ANDA, depois LIGA, depois CRIA.** Assim a revenda de um lote que o
C2X cancelou entra na mesma rodada em que a venda antiga cai (e solta o lote, D6).

**Dono vivo, uma definição só (D1 + A3)**, no TS e na RPC: `outrosDonosDoLote` (`trava-do-lote.ts`,
a mesma função da porta da reserva, leitura fresca) sobre as linhas do terreno pela união de
`lib/hercules/terreno.ts`, ou seja, proposta viva de QUALQUER origem (fora a carga pendurada na
linha-sombra do pai, como a régua), reserva `ativa`/`proposta` SEM olhar `validade_em` (20 vivas
vencidas hoje seguram o lote e continuam segurando, D13), cupom do salão não absorvido, `bloqueado_em`,
MAIS a irmã com cadastro `vendida`/`reservada` sem processo e a linha `bloqueada` (sem carimbo) cuja
irmã tem venda viva (4 terrenos VOC/VOR hoje; 1.195 linhas `bloqueada`, só 97 com carimbo).

Para cada pedido da lista (1), na ordem (a primeira linha que casa decide):

| Caso | O que a F10 faz | Conta no relatório |
|---|---|---|
| empreendimento em `FORA_DO_PANTEON_IDS` (por id, A10) | nada | `foraDoPanteon` |
| unidade sem linha em `hercules_unidades` (por `origem_c2x_id`) | nada | `semUnidade` |
| unidade é linha-sombra do pai | nada (Lucas 22/09) | `noPai`; `vivaSoNoPai` e `noPaiComOutroComprador` (documento em memória, D11) viram ALARME no card do Zeus |
| já existe proposta com `coalesce(origem_c2x_id, c2x_pedido_id) = ar.id` | não cria. Se o terreno da unidade atual do pedido difere do terreno da proposta: `trocouDeLote`, alarme, nada movido, e o terreno de destino fica em `conflitoDeDono` para qualquer criação (D5). Se `cliente_c2x_id` mudou: `compradorMudou`, não anda (D9). Senão vai para V3.7 | `jaExiste`, `trocouDeLote`, `compradorMudou` |
| pedido já tem decisão na `hercules_espelho_c2x_pedidos` diferente de `criavel` (D3) | nada; só um POST de admin com `so` e motivo, registrado, o tira daí. Reavalia só se a `impressao` do contexto mudou (A9), e para no máximo N candidatos por rodada | a decisão guardada |
| empreendimento fora de `CRIAR_EM` (ids liberados, A4) | nada | `foraDaLiberacao` por empreendimento |
| pedido VIVO em estágio 1 (reserva do C2X, D7) | nada: reserva nasce no Hércules (Lucas 18/09). Se o lote está livre aqui, alarme de dono | `reservaSoNoC2x` |
| casamento de pedido (V3.5, modo `pedido`) acha a nativa | LIGA; se ela já tem outro pedido: `nativaJaLigada`, nunca cria | `ligadas` por regra, `nativaJaLigada` |
| o terreno tem nativa que NÃO casa (comprador diferente) | nada | `candidatas` com o motivo |
| mesma venda em outra gleba: mesmo documento, mesma quadra e lote, em par de empreendimentos declarado no cadastro (LBR+ACT, RDP+RPC, SDT+TSC: 43 pares vivos hoje, D10) | nada | `mesmaVendaEmOutraGleba` |
| primeira vez que o pedido é visto E o Panteon registrou fato no terreno DEPOIS de `ar.created_at` (nativa criada ou cancelada, reserva criada ou cancelada, `bloqueado_em`, `cancelada_em` da carga) (D3) | nada | `obsoletoPeloPanteon`, na lista do Zeus |
| dono vivo no terreno (definição acima) | nada | `conflitoDeDono` |
| nenhum dos anteriores, e o pedido era criável na PRIMEIRA vez que foi visto (D3) | CRIA a venda com as passagens, pela RPC; em seguida RELÊ `outrosDonosDoLote` e, se apareceu outro dono, DESFAZ a própria linha (D2) | `criadas` por empreendimento e etapa; `desfeitasNaCorrida` |

Toda decisão é gravada em `hercules_espelho_c2x_pedidos` (primeira e última vez). Pedido criado em
etapa terminal (cancelado, distrato) também é criado: é histórico (D8/D9 do desenho) e não segura lote.

**Guarda de corrida (D2).** A RPC `hercules_espelho_criar_venda` recebe `p_linhas uuid[]` (as linhas do
terreno que o TS resolveu) e confere em SQL o que dá para conferir (proposta viva de qualquer origem
fora da carga no pai, reserva `ativa`/`proposta`, cupom não absorvido, `bloqueado_em`); o índice
`hercules_propostas_uma_viva_por_linha` (V3.10) recusa a segunda viva na MESMA linha e o 23505 vira
`conflitoDeDono`. Conferir e gravar na mesma transação NÃO fecha a corrida com
`criar-reserva.ts` (os dois leem antes de o outro commitar); o que fecha é o padrão da porta da
reserva: os DOIS gravam antes de reler, então pelo menos um vê o outro. Por isso a F10 grava,
commita, relê com leitura nova e desfaz se preciso. Teste com as quatro intercalações: em nenhuma
sobram dois donos. Depois de cada rodada: "linha com duas vivas" = 0 e "terreno com duas vivas fora da
sombra" = 0, no relatório.

#### V3.4 Venda da carga que o Panteon nunca mexeu x mexeu

"Mexida" = qualquer um destes, na leitura E de novo dentro da RPC:

- `etapa_por` preenchido (o time moveu na tela; 7 hoje);
- `cancelada_em` preenchido (o Panteon encerrou; 9);
- `cancelamento_pedido_em` preenchido (pedido de cancelamento aberto; 8);
- passagem em `hercules_proposta_etapas` com `origem_c2x_id` nulo (nascida no Panteon, inclusive a
  "F8 retroativa"; 0 hoje);
- card em `temis_trabalhos` por `proposta_id` ou `venda_id` (8);
- linha-sombra do pai (366: nunca tocada, é reflexo);
- **sétimo (D13)**: `atualizado_em > greatest(importado_em, espelhado_em) + 1 s`. Pega o fluxo novo
  que edita a venda sem mexer na etapa (preço, compradores, CAD). Medido hoje: 10 da carga com
  `atualizado_em` depois da importação, todas já com marca (0 sem marca); 0 trigger na tabela. A F10
  grava `espelhado_em` = `atualizado_em` em toda escrita dela, então o próprio avanço não a marca.

Além dos sete: `cliente_c2x_id` do pedido diferente do gravado (cessão no C2X) não é "mexida", mas não
anda (`compradorMudou`, D9, lista `divergentes`).

Medido hoje: das 4.924 da carga, **4.914 intocadas** (10 mexidas pela união dos critérios). Envelope
da F3 ligado à proposta da carga NÃO conta como mexida (é espelho, não trabalho do time).

| Proposta | O que a F10 faz |
|---|---|
| Carga intocada | Pode ANDAR (V3.7). |
| Carga mexida | Nada. Se a etapa do C2X diverge, vai para a lista `divergentes` (hoje o RVP: cancelado no C2X, em assinatura aqui, mexido). |
| Nativa (com ou sem `c2x_pedido_id`) | Nunca muda etapa, valor nem nada: o Panteon é o dono. Se o C2X está à frente (VOL 5010, 5012, 5016 faturados lá, nativas em assinatura aqui), vai para `nativaAtrasada`: é trabalho da F8 (7 dias + entrada paga), que passa a achar a entrada pelo `c2x_pedido_id`. |
| Criada pela F10 | Tratada como carga: intocada até o time mexer. |

#### V3.5 A regra de NÃO DUPLICAR a venda redigitada

O processo de hoje (memória `reference_venda_redigitada_no_c2x_para_boleto`): a venda nasce no
Hércules e é redigitada no C2X para gerar boleto, em dois passos: reserva no PAI (VLO, 0 parcelas,
órfã) e venda no FILHO (VOC/VOL/VOR, com as parcelas).

- O passo 1 nunca entra (V3.3, linha "pai").
- O passo 2 casa por uma REGRA DE PEDIDO, separada da regra de envelope (D4). O núcleo de
  `casarEnvioComAVenda` (`lib/assinatura/espelho-d4sign/casamento.ts`) é extraído para
  `lib/hercules/casar-pedido-do-c2x.ts` (puro), com dois modos: `envio` (a regra 3 da seção 3 da fonte
  única, que a F3 segue usando: a nativa de pé NO INSTANTE do envio, porque o contrato é daquele
  instante) e `pedido` (a F10: o pedido é a venda continuando no financeiro). Modo `pedido`, unidade →
  terreno pela união da régua → na ordem:
  1. a nativa **VIVA** do terreno **com o mesmo comprador** (dígitos do documento do cliente do pedido,
     consulta 4, contra `cliente_documento`, em memória), a mais recente, qualquer que seja a data de
     criação;
  2. senão, a nativa de pé no instante do pedido (`cancelada_em` nula ou posterior a `ar.created_at`),
     do mesmo comprador;
  3. senão, candidata.
  Medido (D4, conferido por mim): no VOC0306 há uma nativa cancelada (16/09 a 21/09) e uma viva (21/09)
  do MESMO comprador, e a redigitação é de 18/09: a regra de envelope ligaria à cancelada, a de pedido
  liga à viva.
- Só liga pedido em proposta ou adiante e não cancelado (estágios 2 a 6 e 9). Pedido em estágio 1 ou
  cancelado não liga (dois pedidos para a mesma nativa: o de reserva ou o duplicado perdem).
- Casou: `update hercules_propostas set c2x_pedido_id = ar.id where id = <nativa> and origem =
  'panteon' and c2x_pedido_id is null` e nenhuma outra proposta tem aquele pedido (RPC
  `hercules_espelho_ligar_redigitada`, e o índice do `coalesce` da V3.10). Não toca etapa, valor,
  datas, comprador. A F10 só TROCA uma ligação que ELA fez, de um pedido que depois foi cancelado para o
  pedido vivo do mesmo comprador, com a troca no relatório; ligação feita à mão nunca.
- Ligar devolveu `false` porque a nativa já tem pedido: decisão `nativaJaLigada`, nunca criação
  (teste).
- Não casou: candidata, nada gravado. `ligadaACanceladaComPedidoVivo` e "pedido vivo no C2X de outro
  comprador com venda viva aqui" (o padrão do VOL1106, onde a viva é de OUTRO comprador) vão ao card do
  Zeus como alarme de dois donos entre sistemas.

**Por que coluna nova e não `origem_c2x_id` na nativa** (o brief pedia "ligar `origem_c2x_id` à
nativa, se isso não sobrescrever nada"): a coluna está nula na nativa, então a escrita em si não
sobrescreve dado; mas ela sobrescreve SENTIDO. Pelo menos quatro leitores tratam `origem_c2x_id`
preenchido como "veio da carga": a régua (`situacao-da-unidade.ts:537-540`, proposta "importada no
pai" é ignorada), a trava do lote (`trava-do-lote.ts:121-125`, idem), a saída de `vendida`
(`venda/proposta/route.ts:2385-2387`, `veioDaCargaDoC2x` libera o que só a carga pode) e os dados do
contrato (`dados-do-contrato.ts:443`). Uma nativa redigitada passaria a ser "carga" nesses quatro, e a
F10 passaria a tratá-la como intocada e a andá-la pelo C2X. `c2x_pedido_id` é a ligação sem mudar a
natureza da venda. Leitores que precisam do pedido (carteira da venda, F8 "entrada paga", casamento
da F3, Hades) leem `coalesce(origem_c2x_id, c2x_pedido_id)`.

Medido hoje no espelho do Supabase: os **8 pedidos posteriores à carga** que ele enxerga (5010, 5012,
5013, 5016, 5018, 5020, 5021, 5032: VOL 3, VAL 2, VOC 1, REP 1, VOR 1) têm TODOS uma nativa viva na
mesma unidade, criada antes (16/09 a 22/09). Comprador confirmado pelo `document_hash` das entidades
em 3 (5010, 5016, 5032); nos outros 5 a entidade do espelho não tem hash, e quem decide é o ensaio
(consulta 4). Ou seja: **o que o R2 chamou de "6 pedidos novos sem proposta" e "3 faturados sem par"
é redigitação: a F10 LIGA os 8 e cria 0.**

Efeito na F3 (coordenar com quem implementa): a regra 1 `ar_da_carga` passa a casar também
`c2x_pedido_id = ar.id`, e o envelope D4Sign da redigitação liga à nativa sem precisar do documento.

#### V3.6 O Garden

Hoje: 404 unidades no GDN (320 bloqueadas, 165 delas a R$ 1 ou menos; 84 disponíveis), 404 com
`origem_c2x_id`, só 2 com `bloqueado_em`; **0 propostas, 0 reservas, 0 cards, 0 envelopes**.

**Corrigido na segunda revisão (D8, conferido):** as linhas do GDN existem desde 01/09 16:17, a carga
rodou de 03/09 a 22/09 lendo todo `acquisition_requests` e o GDN não estava na lista de fora, e ela
gravou **0 proposta no GDN**. Até 16/09 o C2X não tinha pedido no Garden. O Garden "vendido" de hoje
é o cadastro (320 `bloqueada`) mais a planilha da Cecílio e o LSoft (`boletos_parcelas`, 143
unidades), que não são o C2X. A estimativa "140 a 160 vendas pela F10" sai do plano.

- **F10a roda `--so GDN` primeiro** e o número vai ao Lucas. O 39 fica FORA de `CRIAR_EM` (V3.8) até
  a resposta da V5.2.
- Se o ensaio achar pedidos no GDN: a F10 os cria como qualquer outro (V3.3), casando a unidade por
  `origem_c2x_id`, com a conferência de (quadra, lote) do C2X contra a linha do Panteon (o Garden foi
  renumerado, memória `reference_garden_lote_renumerado`), `valor` = `preco_tabela` da linha (A11), e
  o 39 entra em `CRIAR_EM` num deploy próprio, depois da trava da V3.9 provada.
- Se der perto de zero: o Garden sai da F10 e vira decisão própria (V5.2). Qualquer caminho que venha
  (a planilha da Cecílio, o cadastro dela pelo portal) grava pela MESMA RPC de criação (guarda do
  terreno, índice por linha) com a origem marcada; se o time dela passar a redigitar no C2X para gerar
  boleto, o casamento de pedido (V3.5, a nativa viva do mesmo comprador vence a data) LIGA o pedido,
  não duplica.
- As 2 unidades com `bloqueado_em` ficam sem venda (`conflitoDeDono`). A proposta sobre linha
  `bloqueada` sem carimbo vale (a régua dá a venda da própria linha, `situacao-da-unidade.ts:90-106`),
  e entra na "Diferença visível" da F9b.
- Visível só no portal da Cecílio (V3.9).

#### V3.7 Os estados que ela PODE atualizar sem sobrescrever

Decisão: a F10 anda a venda da CARGA INTOCADA (V3.4) quando o C2X anda, **só para a frente**, com a
data do fato do histórico. Justificativa: essas vendas nunca foram operadas no Panteon; quem as opera
de fato é o C2X (é lá que o time fatura e cancela o que é do legado). Se o Panteon não acompanha, a
venda fica congelada em 22/09 e os indicadores nunca batem (o problema inteiro da F9). E não há
trabalho do time a desfazer: o critério de "mexida" é o mesmo da peneira da carga (`etapa_por`,
`cancelada_em`) ampliado (pedido, card, passagem nascida aqui), conferido de novo dentro da RPC.

| Etapa no Panteon | Etapa nova no C2X | Anda? |
|---|---|---|
| reservado, proposta, contrato, assinatura | proposta, contrato, assinatura, faturado (ordem maior) | sim, se o terreno não tem OUTRO dono vivo pela definição única da V3.3 (senão `conflitoDeDono`) |
| qualquer viva | cancelado (7, 8) | sim, e em seguida SOLTA o lote pela porta do Panteon (abaixo, D6). NÃO grava `cancelada_em`: essa coluna quer dizer "o Panteon encerrou" |
| qualquer viva, faturado | distrato (10, 11) | sim, idem |
| faturado | cancelado (7, 8) | sim ("quem cancelou depois não vendeu", D7) |
| qualquer | etapa MENOR (correção no C2X que volta assinatura para proposta, cancelado que reabre) | **não**: `recuos` no relatório. Recuar é desfazer, e reabrir venda cancelada pode dar dois donos |
| faturado | faturado de novo (4 → 6) | não muda nada (V3.2) |

O avanço grava, na MESMA RPC (`hercules_espelho_avancar_da_carga`): `etapa`, `etapa_c2x`,
`etapa_desde` (instante da passagem que chegou lá), `aberta`, `atualizado_em_c2x`, e as passagens que
faltam. Com `update ... where id = ? and etapa = <lida> and etapa_por is null and cancelada_em is null
and cancelamento_pedido_em is null and origem = 'c2x'` + `not exists` card e passagem sem origem:
se o time mexeu entre a leitura e a escrita, nada acontece (`perdeuACorrida`). Não mexe em valor,
comprador, plano, datas de ato e assinatura (a carga congelou isso; mudar é outra decisão).
`data_faturamento` também não: a view não a usa (é previsão, 0.7).

Medido hoje (só a parte que o espelho do Supabase vê, pedidos atualizados depois de 22/09): andariam
**4 para faturado (ACP 3, VOC 1)** e **1 para cancelado (JDG)**; o RVP fica em `divergentes`
(mexido). Universo que pode andar: 437 vivas intocadas (414 em assinatura, 12 em contrato, 2 em
proposta, 9 reservadas) e 2.025 faturadas intocadas (só para cancelado ou distrato). O resto sai do
ensaio.

**Soltar o lote (D6, conferido).** Andar a venda para cancelado não libera o lote sozinho: a régua
volta ao cadastro quando não há proposta viva, e **2.453 das 2.463 vivas da carga fora do pai estão em
linha `vendida`**. Sem soltar, o lote do JDG cancelado apareceria "Vendido" e a porta da reserva o
recusaria, contra a regra do Lucas de 24/09 (*"quando tem cancelamento a unidade tem que ficar
disponivel"*). Depois de `andou` para cancelado ou distrato, o orquestrador chama
`soltarLoteDaVendaDesfeita` (`cancelar-reserva-server.ts:262`) com os aceitos da venda da carga
(`reservada`, `vendida`), a mesma porta que o Panteon usa quando ele cancela: confere todos os donos do
terreno (o cupom do salão segura o lote), nunca desbloqueia, leitura que falha não solta. Se o C2X
depois reabrir o pedido, o `recuos` vira ALARME de dois donos entre sistemas (o lote pode ter sido
revendido aqui).

Relação com a F8: a F10 anda o que o C2X faturou; a F8 anda pelo critério do Panteon (7 dias + entrada)
o que sobrar em assinatura, com passagem retroativa (R1). A passagem da F8 tem `origem_c2x_id` nulo:
depois dela a venda é "mexida" e a F10 não a toca mais. Sem corrida entre as duas.

#### V3.8 Frequência, custo, rota e autenticação

- **Rota própria**, não dentro do cron da D4Sign: `apps/hub/app/api/hercules/espelho-c2x/route.ts`,
  `maxDuration = 120`, orçamento de 90 s. **Cron `2,32 * * * *`** (a cada 30 min, 5 min antes do
  `7,37` da D4Sign, para a F3 achar a venda do Garden e a redigitação já ligadas). Separada porque sobe
  e desliga sem mexer na F3 (que outros agentes estão implementando), e porque uma não trava a outra.
- **Custo por rodada** (corrigido pelo A8: a leitura estreita que estava aqui dá ~2 MB por rodada,
  ~100 MB/dia, não 25): a RPC de leitura `hercules_espelho_o_que_falta(p_pedidos jsonb)` recebe a lista
  leve do C2X (~5 mil quádruplas `ar_id, etapa_c2x, unidade_c2x_id, cliente_c2x_id`, ~120 KB) e devolve
  só o que dá trabalho: pedido sem proposta, etapa do Panteon diferente de `ETAPA[etapa_c2x]` (A9),
  comprador ou terreno diferente, e a decisão guardada de cada um. Uma ida, sem paginação; unidades,
  terreno, cards e passagens só dos que voltam. Esperado: dezenas de linhas, < 0,2 MB por rodada, < 10
  MB/dia. C2X: a lista leve (< 1 s) e o detalhe, o histórico e o documento só dos que voltam.
  Candidata e conflito só reavaliam quando a `impressao` do contexto mudou (A9), com teto por rodada
  (como o `tetoDeListas` da F3). ~10 s de função por rodada; nenhuma tela chama. O relatório mantém
  `lidosPorTabela`.
- **Autenticação**: GET só com `Authorization: Bearer <CRON_SECRET>` comparado por `cronPeloSegredo`
  (`lib/apolo/autorizar-sync.ts`, `timingSafeEqual`, segredo vazio → 503). `x-vercel-cron` NÃO vale
  (memória `reference_cron_x_vercel_cron_spoofavel`). POST: admin do Hub, ensaio por padrão,
  `?gravar=1` para valer, `so` com até 50 pedidos, registra quem disparou. Fora de
  `PUBLIC_API_PREFIXES`; `proxy.ts` não muda. Antes de ligar, conferir no log de UMA rodada que a
  Vercel chegou com o Bearer.
- **A vez**: `hercules_espelho_c2x.em_curso_ate` (o mesmo desenho da F3): rodada sem a vez sai sem
  fazer nada. **Cron, POST e script tomam a mesma vez** (D14).
- **Chaves no código**: `CRIAR_VENDAS`, `LIGAR_REDIGITADAS`, `ANDAR_CARGA`, todas `false` até a prova
  (V3.11), e **`CRIAR_EM: ReadonlySet<number>`** com os ids do C2X liberados para criação (nunca
  sigla), lida pelo cron E pelo script (A4). Sai sem o 39 (GDN) e sem o 30 (ACT); cada um entra num
  deploy próprio (V3.6, V3.2). O relatório conta `foraDaLiberacao` por empreendimento.
- **Campainha**: `ultima_rodada_ok_em`; o card do Zeus (F9k) confere e recebe os ALARMES de dois
  donos entre sistemas (`trocouDeLote`, `ligadaACanceladaComPedidoVivo`, `noPaiComOutroComprador`,
  `vivaSoNoPai`, `reservaSoNoC2x` com lote livre, `recuos`, `obsoletoPeloPanteon`). Tela que lê venda
  mostra o aviso genérico de atualização com a F10 parada há mais de **45 min** (uma rodada perdida,
  A12), não 2 h.
- **Horário (A13)**: `:02/:32` cai perto do Hades (`*/15`) e do incremental do Apolo (`*/5`). Nada
  agora; na prova da F10c anotar a duração das rodadas numa manhã; se passar de 30 s, mover F10 para
  `:12/:42` e F3 para `:17/:47`, com OK.

#### V3.9 O Garden só no portal da Cecílio

Reescrita na segunda revisão (A1, A2). A regra do Lucas é *"ele não precisa estar para os
coordenadores da gurgel"*: a trava vale para sessão de portal **`tipo = 'comercial'`**. Portal de
incorporador (Cecílio, `mmendes`) não muda até a V5.1.

- **Onde o escopo nasce, não nas pontas.** `escopoDaConta` (`lib/apolo/incorporador/dados.ts:150`) lê
  o `operado_por` do cadastro e passa `operados: Map<enterpriseId, incorporadorId>` a
  `escopoDoUsuario` (puro, `escopo-do-usuario.ts:45`), que tira da sessão comercial todo id operado
  por um incorporador. O cookie deixa de carregar o 39; o GET da sessão roda a cada carga de tela e
  reassina o cookie, então vale na hora, sem esperar o TTL de 12 h. Assim `codigosDaSessao`,
  `idsDaSessao`, `unidadeNoEscopo`, as 3 rotas que leem o cookie direto (`produtos`, `masterplan`,
  `contratos`), `linhasSoDoPanteon` e o futuro `escopoDosIndicadores` (P1) herdam o recorte sem regra
  própria. Teste no puro e no GET.
- **Na gravação:** `gravarVinculosDaConta` (`gestao.ts:734`) recusa produto operado em conta de portal
  comercial, com a frase na tela.
- **Nunca escopo vazio calado:** conta cujo único id é operado por outro incorporador é avisada na tela
  de gestão antes de salvar; teste "o deploy nunca derruba login" (escopo vazio recusa o login e apaga
  o cookie, `sessao/route.ts:170-172`).
- **Varredura:** `sessao.enterpriseIds` só em `sessao.ts`, `escopo.ts` e `escopo-do-usuario.ts`; as
  demais passam por `empreendimentosPermitidos` já recortado.
- Hoje o efeito em dado é pequeno: a única conta comercial com o 39 é de admin da Careli (V2.3). O que
  a trava fecha é o risco de amanhã (o vínculo que a tela de gestão grava). **Nenhum pedido
  operacional de limpeza de vínculo** sem a resposta da V5.1.
- **Ordem escrita:** deploy da trava → prova (GET da sessão comercial sem o 39; Produtos sem o card
  GDN) → só então qualquer `--gravar` da F10.

#### V3.10 A migration (provisória 0202; conferir o diretório na hora)

Escrita no plano, NÃO aplicada. Esqueleto:

- `alter table hercules_propostas add column c2x_pedido_id bigint, add column espelhado_em
  timestamptz`; comentário em `c2x_pedido_id`: "pedido do C2X que REDIGITA esta venda nativa para
  gerar boleto (F10). Não é origem: a venda nasceu no Panteon".
- **Um pedido, uma linha (D14):** `check (origem_c2x_id is null or c2x_pedido_id is null)` e índice
  único `on hercules_propostas ((coalesce(origem_c2x_id, c2x_pedido_id))) where coalesce(...) is not
  null`. O banco recusa o segundo, venha de onde vier (cron, POST, script).
- **Uma viva por linha, toda origem (D1):** `create unique index hercules_propostas_uma_viva_por_linha
  on hercules_propostas (unidade_id) where etapa in ('reservado','proposta','contrato','assinatura',
  'faturado')`. Medido hoje: 0 linha com duas vivas, pai incluído; nasce sem conflito. Não segura o
  terreno (duas linhas), segura a revenda na mesma linha e a F10 contra ela mesma. **Antes de escrever
  a migration**, varrer todo `insert` e toda troca de etapa em `hercules_propostas` no Hércules, na
  Têmis e nos scripts (troca de unidade, correção, reflexo, retomada de distrato) e provar que nenhum
  precisa de duas vivas na mesma linha por um instante (o caso do VOC0306 cancelou a primeira antes de
  criar a segunda). Se algum precisar, o índice fica só para `origem = 'c2x'` e o resto da guarda
  segura. `hercules_propostas_uma_viva_por_unidade` (0131) fica como está.
- `create table hercules_espelho_c2x (id smallint primary key check (id = 1), em_curso_ate
  timestamptz, ultima_rodada_ok_em timestamptz, relatorio jsonb)` e `create table
  hercules_espelho_c2x_pedidos (ar_id bigint primary key, decisao text not null, motivo text, impressao
  text, primeira_vez timestamptz not null, ultima_vez timestamptz not null)`, as duas com RLS ligada e
  sem política (só o service_role), só ids e códigos.
- Funções `security invoker`, cada uma com as guardas dela:
  - `hercules_espelho_o_que_falta(p_pedidos jsonb)` (leitura, A8);
  - `hercules_espelho_criar_venda(p_proposta jsonb, p_passagens jsonb, p_linhas uuid[]) returns uuid`
    (insert `on conflict do nothing`; recusa se o pedido já está em qualquer das duas colunas de alguém
    ou se há dono vivo em `p_linhas` pela parte SQL da definição da V3.3; grava `espelhado_em =
    atualizado_em = now()`);
  - `hercules_espelho_desfazer_criacao(p_proposta uuid) returns boolean` (D2: só `criado_por =
    'espelho-c2x'`, criada há menos de 10 min, sem `etapa_por`, `cancelada_em`, card, passagem sem
    origem, envelope, documento, conversa);
  - `hercules_espelho_ligar_redigitada(p_proposta uuid, p_pedido bigint) returns boolean`, e a troca da
    ligação que a própria F10 fez (V3.5);
  - `hercules_espelho_avancar_da_carga(...) returns text` (devolve `andou`, `mexida`,
    `perdeu_a_corrida`, `dono_vivo`; confere os SETE critérios de "mexida").
- `revoke all on function ... from public, anon, authenticated; grant execute ... to service_role`
  e conferir `role_routine_grants` depois (memória: revogar de `public` não alcança `anon`).
- **Desfazer a migration** (com OK): `drop function` das funções; `drop table` das duas; `drop index`
  dos dois índices; `drop constraint` do CHECK; `drop column` das duas colunas.
- **Rollback de dado (D12)**, só com OK: FK conferida em `pg_constraint` (passagens e eventos em
  CASCADE; card, envelope, documento e conversa em SET NULL). Apaga SÓ a venda criada pela F10 que
  ninguém tocou (os sete critérios de "mexida" mais documento, conversa e envelope ligados), com a
  contagem ANTES; a que o time tocou é listada e decidida à mão. Nunca o `delete` puro por
  `criado_por = 'espelho-c2x'`. A ligação se desfaz zerando `c2x_pedido_id` só onde a tabela de
  decisões registra que a ligação foi da F10.

#### V3.11 Arquivos, testes e ordem interna

| Ação | Caminho |
|---|---|
| criar | `apps/hub/lib/hercules/espelho-c2x/montagem.ts` (puro: `ETAPA`, `FORA_DO_PANTEON_IDS`, `CRIAR_EM`, `montarVendaDoPedido` com o valor do produto operado, `montarPassagens`, `etapaMaior(a, b)`) |
| criar | `apps/hub/lib/hercules/espelho-c2x/c2x.ts` (as consultas 1 a 4; só `select`) |
| criar | `apps/hub/lib/hercules/casar-pedido-do-c2x.ts` (puro, modos `envio` e `pedido`, extraído de `casamento.ts` da F3, que passa a delegar no modo `envio`) |
| criar | `apps/hub/lib/hercules/espelho-c2x/decidir.ts` (puro: pedido + estado do Panteon + decisão guardada → `andar` / `ligar` / `criar` / nada, com o motivo, na ordem da V3.3) |
| criar | `apps/hub/lib/hercules/espelho-c2x/espelho.ts` (orquestrador: anda, solta o lote, liga, cria, relê, desfaz; cron e script) |
| criar | `apps/hub/app/api/hercules/espelho-c2x/route.ts` |
| criar | `scripts/hercules/espelhar-vendas-do-c2x.mjs` (jiti; ENSAIO sem flag; `--gravar` grava criar, ligar e andar juntos; `--so`, `--exceto`; toma a vez) |
| criar | `packages/database/migrations/0202_o_espelho_de_vendas_do_c2x.sql` |
| alterar | `apps/hub/lib/apolo/carteira-da-venda.ts:193-234` (`coalesce(origem_c2x_id, c2x_pedido_id)`) |
| alterar | `apps/hub/lib/assinatura/espelho-d4sign/casamento.ts` (regra 1 também por `c2x_pedido_id`; núcleo em modo `envio`) |
| alterar | `apps/hub/lib/apolo/incorporador/escopo-do-usuario.ts`, `dados.ts` (`operados`), `gestao.ts` (recusa na gravação): a trava da V3.9 |
| alterar | `vercel.json` (`{ "path": "/api/hercules/espelho-c2x", "schedule": "2,32 * * * *" }`, só com OK) |

Testes vitest: `montagem.test.ts` (as mesmas saídas da carga numa fixture anonimizada; datas de
Brasília: 23:30 vira 02:30Z do dia seguinte; `data_faturamento` só no estágio 4; GDN com `valor` da
linha; `FORA_DO_PANTEON_IDS` com a sigla trocada); `decidir.test.ts` (cada linha das tabelas V3.3, V3.4
e V3.7, e os casos da segunda revisão: revenda com a carga antiga viva não cria, e cria depois de a
carga andar para cancelado; reserva velha na sombra do pai não bloqueia o filho; cupom do salão
bloqueia; irmã `vendida` bloqueia; linha `bloqueada` sem carimbo com irmã viva não cria; os 4 terrenos
de duas glebas como fixture; candidata e conflito não viram criação quando a nativa cai, a reserva vence
ou o bloqueio sai; `obsoletoPeloPanteon`; estágio 1 vivo não cria; `trocouDeLote` não move e bloqueia o
destino; `compradorMudou` não anda; `mesmaVendaEmOutraGleba`; `nativaJaLigada` nunca cria; mudança só
de estágio dentro da mesma etapa não é trabalho; carga mexida por cada um dos SETE critérios não anda;
recuo não anda; 4 → 6 não mexe no mês); `casar-pedido-do-c2x.test.ts` (modo `envio` = os casos da seção
3 da fonte única; modo `pedido`: VOC0306 liga à viva, pedido em estágio 1 ou cancelado não liga, dois
pedidos para a mesma nativa); `espelho.test.ts` (portas falsas: nenhum `delete` fora da RPC de
desfazer; nenhum `upsert` com merge; nenhuma escrita em `etapa_por`/`cancelada_em`; soltar o lote
depois de andar para cancelado ou distrato; as QUATRO intercalações com `criar-reserva.ts` sem dois
donos; a vez para cron, POST e script; rodada repetida não cria nada; o relatório e o console sem `@`
nem 11 dígitos seguidos); `c2x.test.ts` (só `select`; READ ONLY); `route.test.ts` (sem Bearer 401; só
`x-vercel-cron` 401; segredo vazio 503; POST não admin 403); `escopo-do-usuario.test.ts` (sessão
comercial com o 39 não o recebe; portal de incorporador não muda; nenhum escopo vazio calado).

Ordem interna, cada passo com OK (A6: criar, ligar e andar sobem JUNTOS, com um OK sobre o ensaio):

1. **F10a · ensaio** (script, sem gravar), **primeiro `--so GDN`**, depois o resto. Imprime por
   empreendimento: `criadas` por etapa, `ligadas` por regra e se o comprador bateu, `nativaJaLigada`,
   `candidatas`, `conflitoDeDono`, `obsoletoPeloPanteon`, `reservaSoNoC2x`,
   `mesmaVendaEmOutraGleba`, `trocouDeLote`, `compradorMudou`, `semUnidade`, `noPai`, `vivaSoNoPai`,
   `noPaiComOutroComprador`, `andariam` por etapa de destino e MÊS do fato, `lotesQueSoltariam`,
   `recuos`, `divergentes`, `nativaAtrasada`, `semEntidade`, `foraDaLiberacao`, e para o GDN a
   conferência de quadra e lote e a divergência de valor. Vai ao Lucas com a "Diferença visível"
   abaixo.
2. **F10e · trava do Garden** (deploy da V3.9) e prova. Vem ANTES de qualquer gravação (A2).
3. **F10b · migration 0202 + `--gravar`** (cria, liga e anda, fora do 39 e do 30). Prova por SELECT.
4. **F10c · cron** com as três chaves ligadas; prova de uma rodada (Bearer, duração, A13).
5. **F10f · o 39 em `CRIAR_EM`**, só se o ensaio `--so GDN` achou pedidos e depois da V5.2; o 30
   quando o PAN-124 fizer o ACT filho da ACP. Cada um num deploy.

Prova em produção (SELECT), depois de cada passo:

```sql
select origem, criado_por, etapa, count(*) from hercules_propostas group by 1,2,3 order by 1,2,3;
select count(*) from hercules_propostas where c2x_pedido_id is not null;                 -- ligadas
select count(*) from hercules_propostas p join hercules_unidades u on u.id = p.unidade_id
 where p.criado_por = 'espelho-c2x' and u.espelho_de is not null;                         -- 0 (nada no pai)
select count(*) from hercules_propostas where criado_por = 'espelho-c2x' and (etapa_por is not null
    or cancelada_em is not null);                                                          -- 0
-- nenhuma venda mexida mudou: o mesmo SELECT das 10 mexidas antes e depois, etapa por etapa
select id, etapa, etapa_desde from hercules_propostas where origem = 'c2x' and (etapa_por is not null
    or cancelada_em is not null or cancelamento_pedido_em is not null) order by id;
-- linha com duas vivas: 0
select count(*) from (select unidade_id from hercules_propostas where etapa in ('reservado',
  'proposta','contrato','assinatura','faturado') group by 1 having count(*) > 1) x;
-- terreno com duas vivas fora da sombra do pai: 0 (a união de terreno.ts refeita em SQL)
select ultima_rodada_ok_em, relatorio from hercules_espelho_c2x;
```

**Diferença visível da F10 (A7, corrigida pelo D8)**, para o Lucas antes de cada passo; "N" só o
ensaio dá:

| Passo | Tela e quem vê | Hoje | Depois |
|---|---|---|---|
| F10e | Hércules da Gurgel, a conta de admin com o 39 | card GDN em Produtos; "todos" com +404 unidades | some (a trava vale para toda sessão comercial), salvo se a V5.1 disser que admin da Careli vê |
| F10b (ligar) | Têmis › análise do trabalho das nativas redigitadas | sem carteira | parcelas do C2X |
| F10b (andar) | ACP (portal e 4 coordenadores) e VOC | 3 e 1 em assinatura | +3 e +1 Faturadas no mês do fato; os 4 titulares entram na porta "compra sem CAD" |
| F10b (andar) | JDG (portal e 5 coordenadores) | 1 em assinatura, lote ocupado | cancelada, lote SOLTO (Disponível e vendável), salvo se um cupom do salão o segura |
| F10b (criar) | Venda, Produtos, portal de cada empreendimento em `CRIAR_EM` | sem as vendas novas do C2X que não são redigitação | N (o espelho do Supabase vê 0: os 8 pedidos posteriores são redigitação) |
| F10f (GDN) | Produtos, ficha, espelho, Venda do GDN, portal Cecílio | 0 venda; Bloqueado 320 | N; só se houver pedidos |

**Rollback**: tirar o cron e desligar as três chaves; o que foi criado fica parado (as telas leem como
carga). Apagar só com OK e só o intocado (V3.10).

**Pedido de OK do C2X**: ler `acquisition_requests` (lista e detalhe, com `client_id`),
`acquisition_request_historics`, `users` (nome, social, vínculo da imobiliária, documento do titular e
dos compradores 2..5 como a carga gravava em `cliente_documento`/`compradores`, e o documento do
comprador em memória para a redigitação, a outra gleba e o pai), `enterprise_unities` (preço e
quadra/lote), `commercial_plans`, `due_days`, `payments.total_parcels` (o que a carga já lia). Só
SELECT, uma conexão, READ ONLY.

### V4. Ordem de subida, com a F1 a F8 da fonte única

| Ordem | Fatia | Por quê aqui |
|---|---|---|
| 1 | F0, F1, F2 (fonte única) | como no plano deles |
| 2 | **F10a** (ensaio, primeiro `--so GDN`) | só lê; roda em paralelo à F3 e dá os números que o Lucas precisa, inclusive se o Garden tem pedido no C2X (D8) |
| 3 | F3 (espelho da D4Sign) | em implementação; a regra 1 ganha `c2x_pedido_id` e o núcleo do casamento vira o modo `envio` |
| 4 | **F10e** (trava do Garden no portal comercial, onde o escopo nasce) | deploy e prova ANTES de qualquer gravação da F10 (A2); não depende de migration |
| 5 | **F10b + F10c** (migration 0202; cria, liga e ANDA juntos, com a soltura do lote; cron), sem o 39 e o 30 | um OK sobre o ensaio (A6). Antes da carga inicial da F3, de preferência: o envelope da redigitação já acha a venda. Não bloqueia a F3 |
| 6 | F4 (leitura única de contratos) | |
| 7 | F9a (a fonte, view 0201, `escopoDosIndicadores` herdando o recorte da sessão, `hercules_reserva_fatos`) | depende de `lerContratosDoPanteon` (F4) |
| 8 | **F10f** (o 39 em `CRIAR_EM`), se o ensaio achou pedidos no GDN e a V5.2 respondeu | antes da F9b, para o estoque do Garden já sair certo; se não houver pedidos, o Garden segue a V5.2 |
| 9 | F9b (estoque) | carga andando e Garden decidido; conferência R10 antes |
| 10 | F9c (Venda), **F9d1** (portal: estoque, mapa, pipeline, imobiliárias, declarando "atualiza a cada 30 min"), F9e (pessoas, sem perfil), F9f (carteira) | dependem da F10 no ar |
| 11 | F6, depois F8 (Faturado anda, passagem retroativa R1; entrada paga da nativa por `coalesce(origem_c2x_id, c2x_pedido_id)`) | R1 |
| 12 | **F9d2** (BI do portal: Faturadas, Canceladas, %, gráfico, tempo médio), F9g (Prometeu, BI do Vale do Ouro sem perfil) | depois da F8 (A5): antes dela a nativa redigitada que o C2X faturou sairia de Faturadas |
| 13 | F9h (Hades, Iris, CACÁ com o cliente) | só depois da correção R4 e de `lerSituacaoDoTerreno` (R5) |
| 14 | F9i (CACÁ direção), F9j (GLotes) | só depois da F8 (R1) |
| 15 | F9k (guarda, com os alarmes da F10), F5, F7 | fecho |

### V5. Perguntas de negócio restantes (só as que mudam o que se faz)

1. **Quem vê o Garden além da Cecílio?** (reescrita com o fato, A1) (a) O portal `mmendes` tem SÓ o
   Garden: tirar o GDN dele fecha o portal das 2 contas. Mantém como está (padrão) ou fecha? (b) A
   única conta da Gurgel com o 39 é de admin da Careli: com a trava, ela deixa de ver o Garden pelo
   `/gurgel` (padrão; 6 das 10 contas da Cecílio também existem no Hub, e o admin veria pelo portal da
   Cecílio). Ou admin da Careli continua vendo pelo `/gurgel`?
2. **Garden: de onde vêm as vendas?** (nova, D8) A carga provou 0 pedido do Garden no C2X até 16/09; o
   vendido de hoje é a planilha da Cecílio e o LSoft (143 unidades com boleto) e o cadastro bloqueado.
   Se o ensaio `--so GDN` achar pedidos, eles entram pela F10 (padrão; e, se o lote do C2X não bater
   com o da linha renumerada, a linha do Panteon casada por `origem_c2x_id` ganha). Se achar perto de
   zero, as vendas do Garden nascem (a) da planilha e do LSoft que já estão no Panteon, gravadas
   automaticamente pela mesma RPC, ou (b) pelo cadastro da Cecílio no portal dela?
3. **Perfil do comprador na ficha do Apolo**: gravar os atributos (sexo, nascimento, estado civil,
   renda, profissão) pelo sync do Apolo que já lê `users` do C2X a cada 5 min, automático como a
   correção da resposta 2 (padrão), ou só pelo cadastro manual da ficha? Muda se a volta do perfil é uma
   fatia pequena (F11) ou espera o time preencher.

Decidido sem pergunta, com o porquê acima: redigitação liga por coluna nova e pela nativa VIVA (V3.5);
carga intocada anda para a frente, inclusive cancelamento, e solta o lote (V3.7, regra do Lucas de
24/09); reserva do C2X não vira venda (Lucas 18/09); nada no pai; nativa nunca é mexida pela F10; recuo
nunca anda; a F10 lembra o que decidiu; trava do Garden no portal comercial (pedido do Lucas); BI do
portal espera a F8; P10 sem releitura.

---

# Histórico (desenho de 28/09, ataques e respostas; vale só no que o PLANO VIGENTE não mudou)

> 28/09/2026 · arquiteto (subagente do Zeus) · worktree `assinatura-fonte-unica`.
> Base: três varreduras de 28/09 (Hércules e portal; Apolo, CRM, Hades, Prometeu, BI; CACÁ, Iris,
> GLotes, Zeus), deduplicadas e conferidas no código deste worktree, e medições minhas no banco de
> produção `bxgukywoxgivlrhjkwjx` (só SELECT, sem dado pessoal). O C2X não foi consultado.
> Nada foi aplicado, commitado nem publicado. Nenhum arquivo de código foi editado: outros agentes
> implementam F1 a F6 neste worktree. Migration, deploy, cron e mudança de sync exigem OK do Lucas, a
> cada vez.
> Complementa `docs/assinatura/fonte-unica-do-contrato.md` (F1 a F8), que faz o contrato e a
> assinatura morarem no Panteon. Esta F9 faz o mesmo com os NÚMEROS de venda.

Lucas, 28/09/2026: *"eu já solicitei que tudo tem que está dentro do panteon se não os indicadores
nunca vai bater"*. Antes: *"informações de venda, contrato, assinatura tem que morar em um local e ele
alimentar tudo"*. Regras que valem aqui:

- venda lê SÓ o Panteon (21/09);
- o C2X fica só no FINANCEIRO: pagamento, boleto, carteira (*"pagamento de venda será alimentado
  temporariamente pelo c2x, igual temos hoje na carteira do apolo"*);
- a D4Sign entra lendo o C2X só para achar o documento (28/09);
- a carga do C2X está encerrada desde 21/09;
- 21/09: *"valor sempre será o que está na proposta"* e *"o disponivel sempre será o que está no
  cadastro"* (comentário de `lib/hercules/fluxo-de-venda.ts`, na montagem da faixa).

---

## 0. O que as varreduras acharam, conferido

| # | Achado | Origem da medida |
|---|---|---|
| 0.1 | **Pelo menos 12 definições de "vendido/faturado"** nas rotas: etapa do Panteon; estágio 4 do histórico do C2X (BI da TelaVendas, coluna Faturado da carteira); `billing_date`, que é previsão (card Faturados do Resumo de Contratos, "Faturado em" dos popups, mês da Venda); `sale_status_id` do cadastro do C2X (BI do Vale do Ouro, CACÁ); estágio 6 (overview do Hades); "unidade só na carteira vira Faturado" (CRM do portal); "última AR em 4/6 com pagamento" (CRM 360). | varreduras 1 e 2, conferidas nos arquivos citados na tabela da seção 1 |
| 0.2 | **A conversão da tela Venda conta reserva caída como venda perdida.** `agregarFluxo` soma em `canceladas` toda proposta em `cancelado`, e 1.702 das 2.293 passagens para `cancelado` saem de `reservado`. VOC: a tela diz 44,6%; com a cancelada contada só depois de proposta, 68,8%. VOL 45,7% → 71,1%; LBR 43,1% → 79,0%; VDO 26,5% → 65,8%. | SELECT em `hercules_proposta_etapas` (`de`), 28/09 |
| 0.3 | **"Em andamento" do Panorama soma os DISPONÍVEIS e os em cancelamento.** `TelaVenda.tsx:3643-3645` soma todo passo de `dados.fluxo` menos `faturado`, e a faixa (`ETAPAS_DA_FAIXA`, `fluxo-de-venda.ts:92-98`) começa em `disponivel` e termina em `em_cancelamento`. | código |
| 0.4 | **Ticket médio e Conversão misturam total e janela.** `TelaVenda.tsx:3641-3649` divide `vgvFaturado` (só da janela) por `faturadas` tirado da faixa (total, sem janela), e soma perdas da janela com faturadas totais. `faturadasNoPeriodo` (`fluxo-de-venda.ts:1073`), feito para isso, não é lido por nenhum componente (grep). | código |
| 0.5 | **O VGV não segue a regra de 21/09 em todas as telas.** A faixa da Venda soma `hercules_propostas.valor`; os cards de Produtos, Apolo Empreendimentos e o portal somam o preço de tabela (`contarEstoque`, `estoque-da-situacao.ts:117-138`, e `enterprise_unities.price` do C2X na TelaVendas). Na carga as duas contas batem; na nativa com desconto, não. `hercules_propostas.preco_tabela` é nulo em 4.924 de 4.924 propostas da carga. | código + SELECT |
| 0.6 | **A faixa da Venda conta PROPOSTAS e a legenda conta UNIDADES pela régua**: no VOC, 5 propostas que mudaram de gleba abriam a diferença 83 × 85 (comentário em `fluxo-de-venda.ts`, `terrenoDe`). O remendo existe; a regra "o estado é da régua" ainda não é de todas as telas. | código |
| 0.7 | **Datas que não são o fato.** O mês da faturada é `data_faturamento` (previsão): 369 de 2.037 caem em mês diferente da passagem para `faturado`, 206 não têm a data. A "Data da assinatura" das nativas é o envio (`dataDaEtapa`, `fluxo-de-venda.ts:590-593`). | varreduras 1 e 2 |
| 0.8 | **Dois espelhos persistidos do C2X continuam sendo escritos no Supabase**: `apolo_commercial_links.stage_label` e `metadata.contractStatus` (cron `/api/apolo/sync/c2x`, 5 min e 6 h; 43 de 924 pedidos casáveis divergem da etapa do Panteon) e `c2x_guardian_attendance_queue.metadata.units[]` (cron do Hades, 15 min; `statusVenda` = "-" em 285 de 285 unidades da fila atual). | varredura 3 |
| 0.9 | **Todo fato de venda já tem, no Panteon, a data do fato, o valor, o cliente e a imobiliária como ENTIDADE.** Ensaio da view da seção 2 (SELECT): 4.946 propostas (4.924 da carga, 22 nativas); 0 faturada, 0 cancelada e 0 distrato sem data do fato; 0 proposta sem valor; 0 sem entidade de cliente e 0 sem entidade de imobiliária. A carga resolve pela `apolo_source_links` (c2x/users, chave única): 178 de 178 imobiliárias com faturada e 1.972 de 1.972 clientes vivos. | SELECT, 28/09 |
| 0.10 | **Sombra do pai: 366 propostas da carga** penduradas em linha-sombra (VLO 210, LAB 156: 215 canceladas, 12 faturadas, 135 reservadas, 4 propostas), todas `origem = 'c2x'`. As 12 faturadas têm gêmea no filho. | SELECT |
| 0.11 | **A carga parou**: última passagem de etapa em 22/09 02:20; eventos de assinatura e pagamento em 03/09. O Garden (GDN) tem 404 unidades e 0 propostas. JDG, LAB, LBP, LBR, RVP e VDO não têm nenhuma venda nativa: venda feita direto no C2X depois de 22/09 não existe aqui. | varreduras 1 a 3 |
| 0.12 | **O perfil demográfico do comprador não mora no Panteon.** Das entidades dos compradores faturados da carga, 1.657 têm só `responsibleName` e `profileNames` no `metadata`; 16 têm cadastro. Sexo, idade, estado civil, renda e profissão só existem no `users` do C2X. | SELECT de chaves do `metadata`, sem valores |
| 0.13 | **A Central do Prometeu não lê mais o C2X** (desde 29/08, `prometeu_reservas`); toda unidade sai "Reservado", e as linhas Propostas, Em contrato e Finalizadas do funil dão 0 por construção. É indicador morto, não divergente. | varredura 2, `lib/prometeu/reservas-do-panteon.ts:114-140` |
| 0.14 | **Propostas contadas por registro ou por unidade dão números diferentes.** VOC: 129 propostas em 95 unidades; canceladas 37 em 23 unidades. O BI do portal conta por unidade; a Venda conta por proposta. | SELECT |
| 0.15 | **As nativas não gravam passagem de nascimento nem de cancelamento** (0 de 22); a data vem de `criado_em` e `cancelada_em`. As passagens do reflexo da Têmis existem (34 linhas). | SELECT |

Conclusão: com F1 a F8 o contrato, a assinatura e o Faturado passam a morar no Panteon, mas os números
continuam saindo de ~40 contas espalhadas, várias no C2X. A F9 cria UMA fonte de indicadores de venda
(uma view, uma função pura, uma leitura) e troca as telas para ela, com um teste que prova que duas
telas que mostram o mesmo indicador mostram o mesmo número.

---

## 1. Todos os indicadores

Legenda da fonte nova: **E** = estado pela régua (`lerSituacaoDasUnidades`, `baldeDaSituacao`,
`rotuloDaSituacao`), **F** = fatos da view `hercules_venda_fatos` (seção 2), **I** =
`montarIndicadoresDeVenda` (E + F, seção 2), **C** = leitura única de contratos
`lerContratosDoPanteon` (F4 do plano da assinatura). "Fin." = financeiro, fica no C2X.

### 1.1 Hércules

| # | Tela | Indicador | Fonte hoje | Fin. | Fonte nova no Panteon | Fatia |
|---|---|---|---|---|---|---|
| 1 | Produtos (lista, casca comercial, Cecílio) e cabeçalho da ficha | Cards Total, Disponível, Reservado, Em negociação, Vendido, Em cancelamento, Bloqueado (un e VGV), por pai e filhos; coluna VGV | Régua + `hercules_unidades.preco_tabela` (`produtos/painel/route.ts:73-100`, `lerEstoquePelaRegua`) | não | I.estoque; VGV pela regra de 21/09 (valor da proposta que decide; tabela sem proposta) | F9b |
| 2 | Ficha › Resumo | Reservas, Propostas, Em contrato ("X gerados · Y em assinatura"), Vendidas | Régua (`produto/resumo/route.ts:168-205`) | não | I.estoque.porSituacao | F9b |
| 3 | Ficha › Unidades e Apolo › Empreendimento › Unidades | Coluna "Status da venda" e contagens do filtro | Régua sobre o universo do C2X | não | E (já); universo = `hercules_unidades` | F9b |
| 4 | Ficha › Unidades e Apolo › Unidades | "Última movimentação" (cliente, imobiliária, estágio) | C2X: última AR da unidade (`lib/apolo/empreendimentos.ts:899-960, 1240-1275`) | não | Proposta que decide a régua + F (nomes) + `rotuloDaSituacao` | F9d |
| 5 | Ficha › Imobiliárias | Coluna Vendas por imobiliária | C2X, salvo TST e GDN (`imobiliarias-do-produto.ts:133`) | não | I.porImobiliaria (entidade) | F9d |
| 6 | Venda › faixa do fluxo | Disponível, Reservado, Proposta, Contrato, Assinatura, Faturado, Em cancelamento (quantidade e VGV) | Propostas por etapa (`agregarFluxo`); Disponível pela régua | não | I.estoque.porSituacao (unidades pela régua; VGV da proposta que decide) | F9c |
| 7 | Venda › grade e legenda do estoque | Cor do lote e contagem por cor | Régua | não | E (já) | F9c (só paridade) |
| 8 | Venda › lista e ficha lateral | Data do contrato, da assinatura, do faturamento, do cancelamento | `etapa_desde`, `data_assinatura`, `data_faturamento` (previsão) | não | F: `contrato_em`, `faturado_em`, `cancelado_em`, `distrato_em`; assinatura pela F4b (C) | F9c |
| 9 | Venda › Painel (Panorama) | VGV faturado, Ticket médio, Em andamento, Conversão, Canceladas (N distratos), VGV perdido | Propostas; mês por `data_faturamento`; cálculo no componente (`TelaVenda.tsx:3641-3649`) com os defeitos 0.2 a 0.4 | não | I.desempenho(janela) | F9c |
| 10 | Venda › Painel › O funil | CADs, Credenciados, Reservado, Proposta, Contrato, Assinatura, Faturado | `apolo_esteira` (CAD) + propostas | não | CAD fica em `apolo_esteira`; etapas = I.estoque.porSituacao | F9c |
| 11 | Venda › Painel › Quem está vendendo | Imobiliária, Propostas, Vendidas, VGV (top 10) | `imobiliaria_nome` (texto) | não | I.porImobiliaria (entidade, janela) | F9c |
| 12 | Venda › Painel › Mês a mês | Faturadas e canceladas por mês | `data_faturamento` (previsão) e `etapa_desde` | não | I.serieMensal (data do fato, Brasília) | F9c |
| 13 | Venda › Painel › Cancelamentos por motivo | Motivos e "de N que caíram, M têm motivo" | `hercules_propostas.motivo` | não | F.motivo = `coalesce(cancelada_motivo, motivo)` | F9c |
| 14 | Venda › Histórico da unidade | Pílulas Tudo, Assinaturas, Pagamentos | `hercules_proposta_eventos` da carga, parados em 03/09 | Pagamentos: sim | Assinaturas: `temis_envelopes.signatarios[].assinado_em` (F1, F3); Pagamentos: carteira do C2X | F9g |
| 15 | Venda › Pedido de cancelamento | "Vai como distrato / cancelamento" pela pergunta "assinou?" | `temis_envelopes` sem filtro + eventos parados | não | F1, F2, F3 do plano da assinatura | F2/F3 |
| 16 | Venda › Pedido de cancelamento | O mesmo selo pela pergunta "houve pagamento?" | Eventos parados + `data_ato` + `data_faturamento` (previsão conta como pagamento) | **sim** | Leitura da carteira do C2X, a mesma da "entrada paga" da F8 | F8 |
| 17 | Contratos › Board (e Cecílio, Têmis interna) | Colunas por estágio, selo x/y, convite não entregue | `temis_trabalhos` + payload Clicksign | não | F3, F6, F8 do plano | F3/F6/F8 |
| 18 | Contratos › Resumo e Por empreendimento | Contratos, Assinados, Em assinatura, Aguardando emissão, Tempo médio (geração à última assinatura) | C2X + D4Sign ao vivo | não | C (F4) | F4 |
| 19 | Contratos › Resumo | **Faturados** | `billing_date` preenchido (previsão); a F4 mantém `data_faturamento` | não | Proposta em `faturado` (F), a mesma de I | F9a |
| 20 | Contratos › Assinatura e pílula Contratos da TelaVendas | Blocos Comprador, Geral, Prazo 7 dias, Emissão, taxa por perfil, fila, quadro por assinante | C2X + D4Sign | não | C (F4) | F4 |
| 21 | Popups do contrato (Hércules, TelaVendas, Apolo) | "Faturado em", "Gerado em" | `billing_date`; histórico do C2X | não | F: `faturado_em`, `contrato_em` | F9a |

### 1.2 Portal do incorporador (TelaVendas, CRM, Mapa, Carteira)

| # | Tela | Indicador | Fonte hoje | Fin. | Fonte nova no Panteon | Fatia |
|---|---|---|---|---|---|---|
| 22 | Vendas › Resumo | Vendido (R$), Do VGV total (%), Unidades vendidas, VGV do empreendimento | Régua + universo e `u.price` do C2X (`lib/apolo/vendas.ts:316-515`, `vendas-resumo.ts:112-160`) | não | I.estoque (balde vendido; VGV pela regra de 21/09) | F9d |
| 23 | Vendas › Resumo | Clientes únicos | C2X: cliente da última AR viva | não | I.pessoas.clientesUnicos | F9d |
| 24 | Vendas › Resumo (BI) | Propostas, Faturadas, Canceladas (un e R$), Cancelamento %, Proposta → venda (dias) | C2X `acquisition_request_historics` (`vendas-bi.ts:140-275`) | não | I.desempenho(janela) | F9d |
| 25 | Vendas › Resumo | Gráfico mensal (Propostas, Canceladas, Faturadas, UN e R$) | C2X, 12 meses | não | I.serieMensal | F9d |
| 26 | Vendas › Resumo | Ranking de imobiliárias | Régua + nome do C2X | não | I.porImobiliaria | F9d |
| 27 | Vendas › Resumo | Composição do estoque e pílulas por balde | Régua sobre universo e preço do C2X | não | I.estoque | F9d |
| 28 | Vendas › Resumo | Ritmo de vendas (por mês, média, anteriores, sem data) | Régua + `stage_since` do C2X só quando o estágio bate | não | I.serieMensal.faturadas + `semDataDoFato` | F9d |
| 29 | Vendas › Resumo | Perfil do comprador (sexo, idade, estado civil, renda, profissões, cidades) | C2X `users` | não | Conjunto: I.pessoas.compradores (entidades); atributos: pergunta 3 | F9e |
| 30 | Vendas › Pipeline e tabela | Colunas por etapa com contagem e VGV; comprador, imobiliária e "há N dias" no card | Coluna pela régua; o resto do C2X | não | I.estoque.porSituacao; card pela proposta que decide (F: nomes, data do fato da etapa) | F9d |
| 31 | Vendas › Pipeline | Chips Disponíveis, Bloqueadas | Régua | não | I.estoque | F9d |
| 32 | Vendas › Pipeline | Chips Propostas canceladas, Distratos e lista de perdas | C2X estágios 7/8 e 10/11 (`vendas.ts:378-437`) | não | I.desempenho.canceladas/distratos (F) | F9d |
| 33 | Vendas | Movimentação (40 últimas transições) | C2X historics (`vendas.ts:390-410`) | não | `hercules_proposta_etapas` + nascimento e cancelamento das nativas (F) | F9d |
| 34 | Vendas › popup da proposta | Valor de tabela, negociado, desconto, plano, "Venda faturada em" | C2X `acquisition_requests`, `commercial_plans` | não | `hercules_propostas` (valor, plano, condições) + F.faturado_em | F9d |
| 35 | Vendas › popup da proposta | Parcelas, entrada paga, financiamento | C2X `payments` | **sim** | Fica no C2X | fica |
| 36 | TelaProdutos (só-produtos) | Card com estoque | Régua (produto do Panteon) | não | I.estoque | F9b |
| 37 | Mapa (TelaMasterplan) | Cor do lote; comprador e preço no painel do lote | Cor pela régua; comprador e `u.price` do C2X (`masterplan-estado.ts:90-150`) | não | E + proposta que decide (nome) + `hercules_unidades.preco_tabela` | F9d |
| 38 | CRM › Compradores | Lista e contagem, estágio de cada unidade, "Faturado" para quem só está na carteira | C2X (AR viva + carteira) + régua (`crm.ts:187-284`, linha 272) | não | I.pessoas.compradores por entidade; carteira só para valores | F9e |
| 39 | CRM › Imobiliárias e ficha | "N unidades · N compradores · VGV", Unidades vendidas (hoje soma qualquer etapa viva), Ranking por VGV | C2X (`crm.ts:313-395`) | não | I.porImobiliaria (vendidas = balde vendido; em andamento à parte) | F9e |
| 40 | CRM › ficha › Histórico | Marcos da venda | C2X historics (`historico.ts:61-105`) | não | `hercules_proposta_etapas` + F | F9e |
| 41 | CRM › ficha › Cenário financeiro | Contratado, Pago, A receber, Vencido, Maior atraso, em dia/em atraso | C2X `payments` | **sim** | Fica | fica |
| 42 | CRM › Documentos, Carteira › "Abrir contrato assinado" | Existência e PDF do contrato | C2X `uuidDoc` + D4Sign | não | C: envelope vigente por `contratoId` (F4) | F9f |
| 43 | Carteira (TelaCarteira) e Apolo › Empreendimento › Carteira | Coluna "Faturado" (data) | C2X, último estágio 4 (`carteira.ts:282-284`) | não | F.faturado_em pela unidade | F9f |
| 44 | Carteira, Financeiro, Parcelas, Boletos | Carteira total, Recebido, A receber, Vencido, Inadimplência, Recuperação, Clientes, Inadimplentes, Ato e sinal, Líquido, VGV da linha | C2X `payments` | **sim** | Fica | fica |

### 1.3 Apolo interno

| # | Tela | Indicador | Fonte hoje | Fin. | Fonte nova no Panteon | Fatia |
|---|---|---|---|---|---|---|
| 45 | Empreendimentos (lista) e ficha › Resumo | Cards por balde, coluna VGV, "% vendido", VGV total, Vendido, Disponível, Em negociação | Régua + universo e `u.price` do C2X (`empreendimentos.ts:218, 284-383`) | não | I.estoque | F9b |
| 46 | Contratos (`/apolo/assinaturas`) | Aguardando emissão, Em assinatura, Concluídos, taxas, quadro | C2X + D4Sign | não | C (F5) | F5 |
| 47 | Painel clássico, `/publico/assinaturas`, aba Assinatura do painel público | Blocos por pessoa, prazo 7 dias | C2X cru | não | Desligados por decisão de 28/09 | F5 |
| 48 | Dashboard e CRM 360 | Compradores / não compradores, chip Comprador/Prospect, "Unidades adquiridas" | C2X ao vivo: última AR em 4/6 com pagamento (`server.ts:1093-1180, 2911-3010`) | parte | Comprador = I.pessoas.compradores; "com pagamento", adimplente e "unidades em carteira" continuam da carteira | F9e |
| 49 | CRM 360 › ficha, vínculos comerciais | Status do contrato, estágio, faturados por pessoa, link do contrato | C2X ao vivo + espelho `apolo_commercial_links.stage_label`/`metadata.contractStatus` | não | E + F por entidade; contrato por C | F9e |
| 50 | CRM 360 › Linha do tempo e grafo da imobiliária | Marcos da venda; "onde vendeu" | C2X historics e estágio 4/6 (`timeline.ts`, `server.ts:1569-1600`) | não | `hercules_proposta_etapas` + F.imobiliaria_entity_id | F9e |
| 51 | Painel público do coordenador › Sinal | Gerado, Quitado, A vencer, Atrasado, 7 dias, Sem boleto | C2X `payments` (inclui venda cancelada) | **sim** | Fica; o recorte "venda viva" passa a vir de E | F9h |
| 52 | Painel público › CAD e Imobiliárias; relatório diário das imobiliárias | CADs por etapa, habilitadas | Panteon (pré-venda) | não | Já é Panteon | nada |
| 53 | Rotas sem tela: `/api/apolo/empreendimentos/vendas`, `/vendas/proposta` | Funil e popup internos | C2X + régua | não | As mesmas funções da F9d, ou sair (sem chamador em `modules/`) | F9d |

### 1.4 Têmis, Prometeu, BI e públicos

| # | Tela | Indicador | Fonte hoje | Fin. | Fonte nova no Panteon | Fatia |
|---|---|---|---|---|---|---|
| 54 | Têmis › tela de trabalho | "N de M assinaram", prazo de arrependimento | Payload Clicksign | não | F1, F2, F3 | F1-F3 |
| 55 | Têmis › Pré-faturamento | "A entrada" | Não existe (promete o C2X) | **sim** | Carteira do C2X, usada pela F8 | F8 |
| 56 | Prometeu › Central (hub e aba Lançamento) | "Vendas fechadas" (unidades · clientes), UN por mesa, chips por cliente | `prometeu_reservas` (etapa sempre Reservado); sem ela, credenciados | não | E das unidades do evento: Venda = contrato, assinatura, faturado, vendida (D5) | F9g |
| 57 | Prometeu › Central › Funil | Reservas, Propostas, Em contrato, Finalizadas | Morto (0.13) | não | E das unidades do evento | F9g |
| 58 | Prometeu › Central, Gestão, Reserva touch | Conversão do salão (concluídos ÷ presentes), mini dash | `prometeu_credenciados`, `prometeu_reservas` | não | Fica (é o fluxo do salão, não a venda); "Vendas fechadas" do mobile passa a E | F9g |
| 59 | Prometeu › Atendente e ficha do cliente | Jornada por unidade | C2X historics por CPF (`reservas-c2x.ts:240-275`) | não | `hercules_reservas` + `hercules_proposta_etapas` + F por entidade | F9g |
| 60 | BI público Vale do Ouro e relatório comercial do lançamento | Unidades vendidas, VGV, ticket, reservas, estoque, vendas de hoje, ranking, planos, perfil, contratos gerados, vigia de coerência | C2X `sale_status_id` e AR 3/4/5/6/9 (`bi-vale-do-ouro.ts`) | não | I (estoque, desempenho, porImobiliaria); contratos gerados = F.contrato_em; o vigia sai (a régua é única) | F9g |
| 61 | BI público Vale do Ouro | Cobrança da entrada (vendas com cobrança, gerada, liquidado) | C2X `payments` | **sim** | Fica; recorte "venda viva" de E | F9g |
| 62 | Espelho público, telão, masterplan do evento, espelho do produto | Cor e selo do lote | Régua | não | E (já) | F9b (só paridade) |

### 1.5 Hades, CACÁ, Iris, GLotes, Zeus

| # | Tela | Indicador | Fonte hoje | Fin. | Fonte nova no Panteon | Fatia |
|---|---|---|---|---|---|---|
| 63 | Hades › Atendimento (fila, ficha, cartão, IA do atendente) | `statusVenda` (morto) e `signedContractStatus` por unidade | Espelho em `c2x_guardian_attendance_queue.metadata.units[]` (`read-model-sync.ts:295-313`) | não | E (`rotuloDaSituacao`) + C (envelope vigente) lidos na hora pela unidade | F9h |
| 64 | Hades › ficha (botão Contrato) e acordos (`contractDocumentId`) | Link do contrato | `uuidDoc` da primeira unidade com documento | não | C pela unidade do acordo | F9h |
| 65 | Hades › fila e snapshot (push das 12h) | Recorte "contrato vivo" de cobrança; clientes vencidos, contratos críticos | C2X: estágio fora de 7/8/10/11 (fila) e sem filtro (snapshot: 232 × 230) | parte | Parcelas ficam; o recorte "venda viva" vem de E | F9h |
| 66 | `/api/hades/overview`, `/api/guardian/overview` (sem tela) | total, abertas, em assinatura, finalizadas, stages, pendingSignatures | C2X cru (`overview.ts:586-640, 760-835`) | não | Sai do payload (nenhum componente lê) | F9h |
| 67 | Hades › Dossiê do cliente | Situação da venda, data da venda, do ato, da assinatura | C2X (`dossie/dados.ts:180-200`) | não | E + F + `data_ato`, `data_assinatura` (F2) | F9h |
| 68 | Hades › Inteligência, Propostas de acordo | Carteira, inadimplência, recuperação, acordos | C2X `payments` + envelopes de acordo | **sim** | Fica | fica |
| 69 | Iris Athena, contexto do ticket, cockpit | "Tem contrato assinado", PDF, etapa e situação | C2X `uuidDoc` qualquer status; `commercialLinks` | não | E + C pela unidade | F9h |
| 70 | CACÁ com o cliente (motor determinístico) | "contrato <status>", "documento assinado", D4Sign disponível | C2X (`caca-agent.ts:2150-2154, 2386-2396`) | não | E + C | F9h |
| 71 | CACÁ (identificação do contato) | Perfil "Usuario comprador" / "em jornada comercial" | `apolo_commercial_links.stage_label` (espelho do C2X) | não | I.pessoas por entidade | F9e |
| 72 | CACÁ direção: `consultar_movimentacao_c2x` | Propostas, Vendas, Faturado, Cancelamentos, Distratos, Reservas no período | C2X historics (`c2x-analytics.ts:388-555`) | não | I.desempenho(janela) + fatos listados | F9i |
| 73 | CACÁ direção: `consultar_vendas_por_empreendimento` e imagem enviada no WhatsApp | Vendidas, disponíveis, total | C2X `sale_status_id = 4` | não | I.estoque | F9i |
| 74 | CACÁ direção: `consultar_vendas_por_imobiliaria` | Ranking por faturadas | C2X estágio 4 | não | I.porImobiliaria | F9i |
| 75 | CACÁ direção: `consultar_unidade_c2x`, `consultar_cliente_c2x` | Situação, estágio, comprador, corretor; unidades do cliente | C2X | não | E + F (nomes) por unidade e por entidade | F9i |
| 76 | CACÁ direção: `consultar_panteon` (módulo "c2x") e `cenario_comercial` | propostas, vendas, faturamentos, cancelamentos, reservas, clientes_faturados, valor_faturado, unidades_vendidas/disponíveis/total/faturadas | C2X inteiro (`lib/analytics/c2x-builder.ts`), apesar do nome | não | Módulo novo "panteon" em `lib/analytics` sobre I | F9i |
| 77 | CACÁ direção: dimensões de perfil | Faturados por faixa etária, sexo, estado civil, renda, escolaridade | C2X `users` | não | Pergunta 3 | F9i |
| 78 | CACÁ: métricas de inadimplência, `consultar_financeiro`, boletos | inadimplentes, vencidas, valor vencido, links | C2X `payments`, Asaas | **sim** | Fica (recorte "venda viva" de E) | fica |
| 79 | CACÁ com a imobiliária | "Clientes com contrato: N" | C2X, qualquer AR (conta reserva e cancelada) | não | I.pessoas.compradores da imobiliária | F9i |
| 80 | GLotes `lotes` (LOS, LOU) | status do lote | C2X `sale_statuses` | não | `rotuloDoBalde(baldeDaSituacao(E))`, no vocabulário do contrato OpenAPI | F9j |
| 81 | GLotes `vendas` | situacao, data_venda, valor_venda, codigo_venda, atualizado_em | C2X (`consultas.ts:774-900`) | não | F + `codigo-da-venda.ts` para a nativa; `atualizado_em` = maior data de fato | F9j |
| 82 | GLotes `vendas` (parcelas) e `recebimentos` | parcelas, sinal, 1º vencimento, pagos | C2X `payments` | **sim** | Fica | fica |
| 83 | GLotes `clientes`, `loteamentos` | Cadastro | C2X `users`, `enterprises` | não (cadastro) | Apolo e `hercules_empreendimentos` | F9j |
| 84 | Extrato do cliente, evolução da parcela, reajuste | Parcelas, IPCA, aniversário | C2X | **sim** | Fica | fica |
| 85 | Zeus › health board | D4Sign responde; Clicksign e frescor dos syncs não existem | API ao vivo | não | `temis_espelho_d4sign.ultima_rodada_ok_em`, último `temis_assinatura_eventos.recebido_em`, "Indicadores lidos em" da F9 | F9k |
| 86 | Relatório gerencial 18h30, avisos da reserva e da proposta, recibo do sinal | Filas, mensagens | Panteon | não | Já é Panteon | nada |

---

## 2. A fonte de indicadores de venda

### 2.1 Desenho

Três peças, e nenhuma tela calcula número de venda fora delas:

1. **A régua única** (`lib/hercules/situacao-da-unidade.ts`) responde o ESTADO de cada unidade agora.
   Muda uma coisa só: além da situação, ela devolve **qual proposta decidiu** (`propostaQueDecide:
   { id, valor } | null`). Hoje `situacaoDoTerreno` já escolhe `maisRecente` e joga a escolha fora;
   quem precisa do VGV negociado, do comprador ou da imobiliária daquela unidade refaz a escolha por
   conta própria (é a origem de 0.5 e 0.6). Sem mudança de comportamento: `situacaoDoTerreno`
   continua devolvendo a situação; nasce `decidirOTerreno(sinais): { situacao, propostaId }` e a
   primeira passa a ser `decidirOTerreno(...).situacao`.
2. **A view `hercules_venda_fatos`** (migration abaixo) responde os FATOS no tempo: uma linha por
   proposta, com a data de cada fato já escolhida pela regra desta seção, o valor, e cliente e
   imobiliária como entidade do Apolo. É SQL de propósito: a CACÁ (módulo "panteon"), os scripts de
   conferência e o ensaio de paridade leem a mesma definição.
3. **A montagem pura** `montarIndicadoresDeVenda` junta os dois e devolve `IndicadoresDeVenda`. As
   rotas chamam `lerIndicadoresDeVenda` (servidor) e entregam à tela o objeto pronto ou um recorte
   dele. A tela só formata.

Reuso: a régua (estado), `soltarMarcasQueSobraram` (peneira do pedido de cancelamento, já dentro da
régua), `lerContratosDoPanteon` (F4) para tudo que for contrato e assinatura, `codigo-da-venda.ts`
para o código da venda nativa. Nada do C2X.

```ts
// apps/hub/lib/hercules/indicadores/definicoes.ts (PURO: as definições da seção 2.3 como código)
export type FatoDaVenda = {
  cancelado_em: null | string; cliente_entity_id: null | string; cliente_nome: null | string;
  contrato_em: null | string; distrato_em: null | string; eh_proposta: boolean;
  empreendimento_codigo: string; enterprise_id: string; etapa: string; faturado_em: null | string;
  imobiliaria_entity_id: null | string; imobiliaria_nome: null | string; motivo: null | string;
  origem: "c2x" | "panteon"; proposta_em: null | string; proposta_id: string;
  reserva_caida: boolean; sombra_do_pai: boolean; unidade_id: string; valor: number;
};
export type Janela = { ate?: string; de?: string }; // "YYYY-MM", inclusive
export function mesEmBrasilia(iso: string): string; // Intl, timeZone 'America/Sao_Paulo'
export function entraNaConta(f: FatoDaVenda): boolean; // !sombra_do_pai
export function naJanela(iso: null | string, janela?: Janela): boolean;
export const SITUACOES_DE_VENDA: ReadonlySet<SituacaoDaUnidade>; // contrato, assinatura, faturado, vendida
export function valorDaUnidade(u: { propostaQueDecide: null | { valor: number }; precoTabela: number }): number;

// apps/hub/lib/hercules/indicadores/indicadores-de-venda.ts (PURO)
export type Contagem = { unidades: number; vgv: number };
export type IndicadoresDeVenda = {
  estoque: {
    porBalde: Record<BaldeDaSituacao, Contagem>; porSituacao: Record<SituacaoDaUnidade, Contagem>;
    total: Contagem; vendas: Contagem; // SITUACOES_DE_VENDA
  };
  desempenho: {
    canceladas: Contagem; distratos: Contagem; faturadas: Contagem; propostas: Contagem;
    reservasCaidas: number; semDataDoFato: number;
    cancelamentoPct: null | number; conversaoPct: null | number; // 0 a 100
    emAndamento: Contagem; ticketMedio: null | number; tempoMedioPropostaVendaDias: null | number;
    vgvPerdido: number;
  };
  janela: Janela; lidoEm: string;
  motivos: Array<{ motivo: string; n: number }>;
  pessoas: { clientesUnicos: number; compradores: number; compradoresIds: string[] }; // ids: só servidor
  porImobiliaria: Array<{ entityId: string; nome: string; propostas: number; vendidas: number; vgv: number }>;
  serieMensal: Array<{ canceladas: Contagem; faturadas: Contagem; mes: string; propostas: Contagem }>;
};
export function montarIndicadoresDeVenda(entrada: {
  agora: Date; fatos: readonly FatoDaVenda[]; janela?: Janela;
  linhas: readonly LinhaDoEstoque[]; // hercules_unidades (id, enterprise_id, preco_tabela)
  situacoes: SituacaoDasUnidades;   // da régua, com propostaQueDecide
}): IndicadoresDeVenda;
export function indicadoresParaOPortal(i: IndicadoresDeVenda): IndicadoresDoPortal; // allowlist, sem ids

// apps/hub/lib/hercules/indicadores/indicadores-de-venda-server.ts
export async function lerFatosDaVenda(client: SupabaseClient, enterpriseIds: readonly string[]): Promise<FatoDaVenda[]>;
// .in('enterprise_id', lotes de 100) + .order('proposta_id') + .range paginado (teto de 1.000 do PostgREST)
export async function lerIndicadoresDeVenda(client: SupabaseClient, entrada: {
  enterpriseIds: readonly string[]; janela?: Janela;
}): Promise<{ indicadores: IndicadoresDeVenda; ok: true } | { erro: string; ok: false }>;
// UMA chamada à régua para todos os ids (como lerEstoquePelaRegua); falha = ok:false (503), nunca zero
```

### 2.2 A migration (escrita no plano, NÃO aplicada)

Número: a 0195 é deste plano (`0195_o_contrato_mora_no_panteon.sql`, já no diretório) e o
`docs/apolo/pan-124-plano-do-cadastro.md` reserva a faixa seguinte para as F5 a F12 do PAN-124 (hoje
escritas como 0195 a 0199, que andam um). Por isso o número provisório é **0201**; conferir
`ls packages/database/migrations | tail` na hora de criar o arquivo (skill `migration-supabase`).

```sql
-- 0201 · OS INDICADORES DE VENDA MORAM NO PANTEON: uma linha por proposta, com a data de cada fato.
--
-- ⏳ ESCRITA EM 28/09/2026, NÃO APLICADA. Aplicar só com OK do Lucas.
-- ⚠️ NÚMERO PROVISÓRIO: a faixa depois da 0195 está reservada ao PAN-124. Conferir o diretório.
--
-- POR QUE ELA EXISTE. Lucas, 28/09/2026: "eu já solicitei que tudo tem que está dentro do panteon se
-- não os indicadores nunca vai bater". Medido no mesmo dia: 12 definições de vendido/faturado nas
-- rotas; a conversão da tela Venda contando reserva caída como venda perdida (VOC 44,6% contra 68,8%);
-- o mês da faturada pela data PREVISTA do legado (369 de 2.037 em outro mês).
--
-- O QUE ELA FAZ: uma view de leitura, security_invoker, só para o service_role. Não escreve nada.
--
-- ATENCAO 1: A DATA É A DO FATO, NUNCA etapa_desde. Faturada: a ÚLTIMA passagem para 'faturado' (a
--   que vale hoje; 14 propostas têm duas). Cancelada e distrato: a última passagem, e na nativa
--   cancelada_em (a nativa não grava passagem de cancelamento). Proposta: na nativa criado_em (não
--   grava passagem de nascimento); na carga a PRIMEIRA saída para proposta, contrato, assinatura ou
--   faturado, e criado_em_c2x só quando não há passagem. Sem data do fato, a coluna fica NULA e a
--   tela conta em "sem data": etapa_desde muda com qualquer correção e mente o mês.
--
-- ATENCAO 2: data_faturamento NÃO ENTRA. É billing_date do C2X, a data PREVISTA (0.7 do plano F9).
--
-- ATENCAO 3: RESERVA CAÍDA NÃO É PROPOSTA CANCELADA. A carga guarda a reserva do C2X como proposta em
--   'reservado'; 1.702 das 2.293 passagens para 'cancelado' saem de 'reservado'. eh_proposta é falso
--   para elas, e reserva_caida marca o caso (regra do BI do Lucas: estágio 7 com old_stage <> 1).
--
-- ATENCAO 4: A SOMBRA DO PAI É REFLEXO (Lucas, 22/09/2026: "VLO é reflexo"). Proposta DA CARGA em
--   linha-sombra (espelho_de preenchido) sai com sombra_do_pai = true e nenhuma conta a usa: 366
--   linhas (VLO 210, LAB 156). Proposta NATIVA no pai vale, a mesma regra de situacao-da-unidade.ts.
--
-- ATENCAO 5: O EMPREENDIMENTO É O DA UNIDADE (enterprise_id, o id), não a sigla gravada na proposta:
--   a sigla quebra no renome. empreendimento_codigo é só para exibir.
--
-- ATENCAO 6: SEM CPF. Cliente e imobiliária saem como ENTIDADE do Apolo: a da proposta (nativa) ou a
--   do vínculo c2x/users em apolo_source_links (carga; chave única, 178 de 178 imobiliárias e 1.972 de
--   1.972 clientes resolvem em 28/09). cliente_documento não atravessa a view.
--
-- ATENCAO 7: VIEW NASCE ABERTA NO SUPABASE. Revogar de anon, authenticated e service_role e dar só
--   SELECT ao service_role (mesmo padrão da 0195). Conferir role_table_grants depois de aplicar.
--
-- DESFAZER (com OK): drop view if exists public.hercules_venda_fatos;

begin;

create or replace view public.hercules_venda_fatos
with (security_invoker = true) as
select
  p.id                                             as proposta_id,
  p.workspace_id,
  p.origem,
  p.etapa,
  p.unidade_id,
  u.enterprise_id,
  coalesce(he.codigo, p.empreendimento_codigo)     as empreendimento_codigo,
  (u.espelho_de is not null and p.origem = 'c2x')  as sombra_do_pai,
  coalesce(p.valor, 0)::numeric                    as valor,
  (p.etapa <> 'reservado'
    and (p.origem = 'panteon'
         or p.etapa in ('proposta', 'contrato', 'assinatura', 'faturado', 'distrato')
         or pas.virou_proposta_em is not null
         or (p.etapa = 'cancelado' and pas.cancelou_fora_da_reserva)))
                                                   as eh_proposta,
  (p.etapa = 'cancelado' and p.origem = 'c2x'
    and pas.virou_proposta_em is null
    and not pas.cancelou_fora_da_reserva)          as reserva_caida,
  case when p.origem = 'panteon' then p.criado_em
       else coalesce(pas.virou_proposta_em, p.criado_em_c2x) end
                                                   as proposta_em,
  pas.contrato_em,
  case when p.etapa = 'faturado' then pas.faturado_em end
                                                   as faturado_em,
  case when p.etapa = 'cancelado' then coalesce(pas.cancelado_em, p.cancelada_em) end
                                                   as cancelado_em,
  case when p.etapa = 'distrato' then coalesce(pas.distrato_em, p.cancelada_em) end
                                                   as distrato_em,
  nullif(trim(coalesce(p.cancelada_motivo, p.motivo)), '')
                                                   as motivo,
  coalesce(p.cliente_entity_id, cli.entity_id)     as cliente_entity_id,
  p.cliente_nome,
  coalesce(p.imobiliaria_entity_id, imob.entity_id) as imobiliaria_entity_id,
  p.imobiliaria_nome
from public.hercules_propostas p
join public.hercules_unidades u on u.id = p.unidade_id
left join lateral (
  select
    min(e.quando) filter (where e.para in ('proposta', 'contrato', 'assinatura', 'faturado')) as virou_proposta_em,
    min(e.quando) filter (where e.para = 'contrato')  as contrato_em,
    max(e.quando) filter (where e.para = 'faturado')  as faturado_em,
    max(e.quando) filter (where e.para = 'cancelado') as cancelado_em,
    max(e.quando) filter (where e.para = 'distrato')  as distrato_em,
    coalesce(bool_or(e.para = 'cancelado' and e.de is distinct from 'reservado'), false)
                                                      as cancelou_fora_da_reserva
  from public.hercules_proposta_etapas e
  where e.proposta_id = p.id
) pas on true
left join lateral (
  select e.codigo
    from public.hercules_empreendimentos e
   where e.workspace_id = u.workspace_id
     and e.c2x_enterprise_id = u.enterprise_id
   order by e.codigo
   limit 1
) he on true
left join public.apolo_source_links cli
  on cli.source_system = 'c2x' and cli.source_table = 'users'
 and cli.source_id = p.cliente_c2x_id::text
left join public.apolo_source_links imob
  on imob.source_system = 'c2x' and imob.source_table = 'users'
 and imob.source_id = p.imobiliaria_c2x_id::text;

comment on view public.hercules_venda_fatos is
  'Uma linha por proposta (carga e nativa) com a data de cada FATO: proposta_em, contrato_em, faturado_em (última passagem), cancelado_em, distrato_em. Nunca etapa_desde nem data_faturamento (previsão). eh_proposta exclui reserva caída; sombra_do_pai marca a carga pendurada no pai (reflexo, fora de toda conta). Cliente e imobiliária como entidade do Apolo; sem CPF. O ESTADO da unidade é da régua (situacao-da-unidade.ts), não desta view. Só service_role (0201).';
revoke all on table public.hercules_venda_fatos from anon, authenticated, service_role;
grant select on table public.hercules_venda_fatos to service_role;

commit;
```

Índices: nenhum novo. A lateral usa `hercules_proposta_etapas_por_proposta (proposta_id, quando)`;
o vínculo usa a chave única `(source_system, source_table, source_id)` de `apolo_source_links`.
Ensaio já rodado como SELECT (0.9): 4.946 linhas, 0 fato sem data, 0 sem entidade.

### 2.3 As definições (uma vez, escritas)

Toda conta abaixo ignora a proposta com `sombra_do_pai`. A janela é por mês em Brasília (`Intl`,
`America/Sao_Paulo`), `de` e `ate` inclusive; sem janela, o histórico inteiro. Fato sem data conta
no total do histórico, nunca numa janela nem num mês, e sai em `semDataDoFato` (hoje 0).

| # | Nome | Definição | Data que conta | Contado por |
|---|---|---|---|---|
| D1 | **Proposta** | Linha de `hercules_propostas` com `eh_proposta`: toda nativa fora de `reservado`; da carga, a que passou de `reservado` para proposta, contrato, assinatura ou faturado, ou foi cancelada fora da reserva. | `proposta_em` | proposta (pergunta 1) |
| D2 | **Reserva caída** | Da carga, cancelada direto de `reservado` (`reserva_caida`); a reserva do Hércules cancelada em `hercules_reservas`. Não é proposta nem cancelamento de venda. | `cancelado_em` | proposta/reserva |
| D3 | **Estado da unidade** | A régua: `situacaoDoTerreno` pela linha viva, com o terreno (pai, filho, glebas de mesma quadra e lote). Os seis baldes de `baldeDaSituacao`. Sem janela: é a fotografia de agora. | agora | unidade viva |
| D4 | **VGV da unidade** | Unidade decidida por proposta: `valor` da proposta que decide (Lucas 21/09, *"valor sempre será o que está na proposta"*). Sem proposta (disponível, bloqueada, reservada do cadastro, vendida sem proposta): `hercules_unidades.preco_tabela`. VGV do empreendimento = soma de todas as unidades por essa regra; "% do VGV vendido" = VGV do balde vendido ÷ VGV do empreendimento. | agora | unidade viva |
| D5 | **Venda** (substantivo) | Unidade em situação `contrato`, `assinatura`, `faturado` ou `vendida`. `em_cancelamento` fica fora: é o balde próprio que tira a venda que está saindo dos números (Lucas 21/09, *"polui nossos indicadores"*). É o "Vendas fechadas" do Prometeu e o "vendas" da CACÁ. | agora | unidade viva |
| D6 | **Vendido** | Balde `vendido`: `faturado` e `vendida` sem proposta. É o único "vendido" de card, BI, CACÁ e GLotes. | agora | unidade viva |
| D7 | **Faturada** (fato) | Proposta hoje em `faturado`. A que faturou e depois cancelou não é faturada (regra do BI do Lucas, *"quem cancelou depois não vendeu"*). A nativa só vira faturada pela F8 (7 dias da última assinatura do comprador + entrada paga). Em cancelamento ainda é faturada até o jurídico concluir. | `faturado_em` = última passagem para `faturado` | proposta |
| D8 | **Cancelada** | Proposta em `cancelado` com `eh_proposta`. Reserva caída não entra (D2). | `cancelado_em` | proposta |
| D9 | **Distrato** | Proposta em `distrato`. | `distrato_em` | proposta |
| D10 | **% cancelamento** | Canceladas ÷ propostas, as duas na mesma janela, cada uma pela sua data (é a conta do BI do portal; coortes diferentes, declarado). Nulo sem proposta. | as de D1 e D8 | proposta |
| D11 | **Conversão proposta → venda** | Faturadas ÷ (faturadas + canceladas + distratos) na janela: das propostas que se decidiram, quantas viraram venda. Nulo sem decidida. | as de D7, D8, D9 | proposta |
| D12 | **VGV faturado, ticket, VGV perdido** | Soma de `valor` das faturadas na janela; ticket = VGV faturado ÷ faturadas DA MESMA janela; perdido = soma de `valor` de canceladas e distratos na janela. | D7, D8, D9 | proposta |
| D13 | **Em andamento** | Unidades em `reservado`, `reservada`, `proposta`, `contrato`, `assinatura` (baldes reservado e negociação). Nunca disponível nem em cancelamento (conserta 0.3). | agora | unidade viva |
| D14 | **Tempo médio proposta → venda** | Média de (`faturado_em` − `proposta_em`) em dias, nas faturadas da janela com `faturado_em` ≥ `proposta_em`. Medido no histórico: VOC 27, VOL 26, VAL 21, ACP 15 dias. O portal hoje usa a ÚLTIMA proposta antes do faturamento; aqui é o nascimento da proposta (a correção que volta a venda para proposta não zera o relógio). | D1, D7 | proposta |
| D15 | **Tempo médio do contrato** (Contratos) | Da geração (`contrato_em`) à última assinatura do envelope vigente. É da F4 (C), não desta view. | F4 | contrato |
| D16 | **Clientes únicos** | Entidades distintas (`cliente_entity_id`) das propostas que decidem unidades em proposta, contrato, assinatura ou faturado. Titular só (co-comprador não conta). | agora | pessoa |
| D17 | **Comprador** | Entidade titular de proposta que decide unidade em Venda (D5). "Comprador com pagamento", adimplente e "unidades em carteira" são a interseção com a carteira do C2X, e essa parte é financeira. | agora | pessoa |
| D18 | **Imobiliária da venda** | `imobiliaria_entity_id` (nativa, ou a entidade do vínculo c2x/users da carga). O nome é o da entidade; o texto da carga só de reserva. Ranking: propostas (D1) e vendidas (D7) na janela, VGV das vendidas. | D1, D7 | proposta |
| D19 | **Série mensal** | Propostas por `proposta_em`, faturadas por `faturado_em`, canceladas por `cancelado_em`, no mês de Brasília. | cada uma a sua | proposta |
| D20 | **Movimentação** | `hercules_proposta_etapas` (de, para, quando) mais o nascimento (`criado_em`) e o cancelamento (`cancelada_em`) das nativas. | `quando` | passagem |

Como cada caso é tratado:

- **Venda nativa**: nasce em `criado_em` (D1); anda pelo reflexo da Têmis, que grava passagem
  (medido: 34 passagens `origem_c2x_id` nulo); cancela em `cancelada_em`; fatura só pela F8, que
  grava a passagem para `faturado`. Nenhuma tela precisa saber que a venda é nativa.
- **Venda da carga**: congelada em 22/09. Os fatos dela valem pelas passagens importadas. O que o
  C2X fez depois não existe aqui (pergunta 2). A F8 move as 415 em `assinatura` e grava a passagem.
- **Sombra do pai (VLO, LAB)**: fora de toda conta (fatos e estado). O pai mostra a SOMA dos filhos
  (memória "pai = soma dos filhos"): a tela do pai pede à fonte os ids dos filhos e soma; ninguém
  lê as linhas do pai como venda. Das 215 canceladas no pai, 130 não têm gêmea no filho (VLO 57, LAB 73;
  histórico de antes da divisão): ficam fora e entram contadas no ensaio de paridade.
- **Glebas**: o ESTADO é do terreno (a régua junta pai, filho e glebas de mesma quadra e lote; a
  linha bloqueada não herda a venda da irmã). O FATO conta no empreendimento da unidade em que a
  proposta está pendurada. A mesma venda em duas glebas (LBR+ACT 29, RDP+RPC 13, SDT+TSC 1, plano
  0.30) conta nas duas, sem deduplicar por palpite, e é categoria do ensaio.
- **Garden e produto sem proposta**: estado pela régua (hoje 0 vendido no GDN), fatos vazios. A
  pergunta 2 decide se isso muda.

---

## 3. As fatias

Ordem: depois da F4 do plano da assinatura (ela cria `lib/hercules/terreno.ts` e
`lerContratosDoPanteon`, e mexe em `fluxo-de-venda.ts`/`TelaVenda.tsx` na F4b). A F8 é independente:
quando ela subir, a faturada nativa aparece em todas as telas sem mudar código da F9 (a fonte lê a
passagem). Cada fatia é uma versão no changelog e deixa o sistema coerente sozinha.

### A prova de paridade (vale para todas as fatias)

1. **O registro de onde cada indicador aparece**: `apps/hub/lib/hercules/indicadores/onde-aparece.ts`
   exporta `ONDE_APARECE: Array<{ indicador: ChaveDoIndicador; tela: string; ler: (f: FonteDeTeste) => number | null }>`.
   Cada `ler` chama o MONTADOR PURO da própria tela (`montarPainelDeProdutos`, o montador do
   Panorama, `resumoDeVendas`, o resumo do produto, o builder "panteon" da CACÁ, o montador do BI do
   Vale do Ouro, o mapeamento da GLotes...) sobre a mesma `FonteDeTeste`, e extrai o número que a tela
   mostra. Quem entra numa fatia entra no registro na mesma fatia.
2. **O teste de paridade**: `apps/hub/lib/hercules/indicadores/paridade.test.ts` monta a
   `FonteDeTeste` a partir da fixture `__fixtures__/terreno-completo.ts` (anonimizada, no
   `banco-em-memoria.para-teste.ts`), com: venda nativa em cada etapa; carga faturada com duas
   passagens; carga cancelada de `reservado` e de `proposta`; faturada que cancelou depois; distrato;
   proposta da carga na sombra do pai com gêmea no filho e sem gêmea; lote em duas glebas (uma
   bloqueada); pedido de cancelamento com card vivo e marca órfã; nativa com desconto (valor ≠
   tabela); unidade vendida sem proposta; fato sem data. Para cada `indicador`, TODAS as telas do
   registro devolvem o mesmo número, e ele é igual a `montarIndicadoresDeVenda`. Um caso por
   indicador falha com o nome das telas que divergem.
3. **A lista de pendência**: `paridade.test.ts` também confere que toda linha da seção 1 com fatia
   já entregue está em `ONDE_APARECE` (uma lista `TELAS_MIGRADAS` que cada fatia acrescenta).
4. **A varredura sem C2X**: `apps/hub/lib/hercules/indicadores/sem-c2x-na-venda.varredura.test.ts`
   (padrão `*.varredura.test.ts` da casa) lê o texto dos arquivos migrados e falha se algum importa
   `@/lib/guardian/db`, `getHadesDbPool`, `idsDoC2xDasSiglasAoVivo` ou cita `acquisition_request`,
   `enterprise_unities`, `sale_status`. Cada fatia acrescenta os seus arquivos.
5. **A conferência em produção** (só leitura, com o `.env.local`):
   `scripts/hercules/conferir-indicadores.mjs` roda a mesma conta em SQL puro sobre
   `hercules_venda_fatos` e compara com `lerIndicadoresDeVenda` por empreendimento; e, por tela
   migrada, chama a rota nova e compara o número com o da fonte. Saída anonimizada (ids e contagens),
   que vira fixture. Critério: diferença = 0 entre telas; a diferença para o número ANTIGO de cada tela
   é listada por categoria (reserva caída, sombra do pai, data do fato, VGV negociado, venda fora do
   Panteon) e vai ao Lucas antes do deploy.

### F9a · A fonte

| Ação | Caminho |
|---|---|
| criar | `packages/database/migrations/0201_os_indicadores_de_venda_moram_no_panteon.sql` (a da seção 2.2) |
| alterar | `apps/hub/lib/hercules/situacao-da-unidade.ts`: `decidirOTerreno` devolve `{ situacao, propostaId }`; `propostasVivas` levam `id` e `valor`; `lerSituacaoDasUnidades` lê `valor` e preenche `UnidadeComSituacao.propostaQueDecide` (sem mudar nenhuma situação) |
| criar | `apps/hub/lib/hercules/indicadores/definicoes.ts`, `indicadores-de-venda.ts`, `indicadores-de-venda-server.ts`, `onde-aparece.ts` |
| alterar | `apps/hub/lib/assinatura/contratos-do-panteon.ts` (da F4): `proposta.faturadoEm` = `faturado_em` da view; `dataFaturamento` sai da saída; o card "Faturados" do Resumo conta proposta em `faturado` (linha 19) e os popups mostram `faturado_em` e `contrato_em` (linha 21) |
| alterar | `apps/hub/modules/incorporador/hercules/AssinaturasDoProduto.tsx:2234-2252` (`totaisDe`: faturados pela etapa) |

Testes: `situacao-da-unidade.test.ts` (toda situação igual à de antes na fixture da régua; a
`propostaQueDecide` é a mais recente, ignora a da carga no pai, respeita a linha bloqueada);
`definicoes.test.ts` (D1 a D20, um caso cada: reserva caída não é proposta nem cancelada; faturada
com duas passagens usa a última; nativa usa `criado_em`/`cancelada_em`; mês às 23:30 de Brasília do
dia 30 cai no mês certo; fato sem data fora da janela e dentro do total); `indicadores-de-venda.test.ts`
(ticket e conversão com janela: numerador e denominador da mesma janela; Em andamento sem
disponível; VGV negociado da nativa com desconto); `paridade.test.ts` e a varredura, vazios de telas
mas com o harness.
Prova (SELECT): a view por empreendimento contra a tabela de 0.2 e 0.14.
OK do Lucas: aplicar a 0201; deploy.

### F9b · O estoque é um só (Produtos, ficha, Apolo, TelaProdutos, espelho)

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/lib/hercules/estoque-da-situacao.ts:117-138` (`contarEstoque` soma VGV por D4: valor da proposta que decide, tabela sem proposta) |
| alterar | `apps/hub/app/api/incorporador/produtos/painel/route.ts`, `apps/hub/app/api/incorporador/produtos/route.ts`, `apps/hub/lib/apolo/incorporador/painel-de-produtos.ts` (sem mudança de contagem; VGV novo) |
| alterar | `apps/hub/app/api/incorporador/produto/resumo/route.ts:168-205`, `apps/hub/lib/apolo/incorporador/resumo-do-produto.ts:206-270` (I.estoque.porSituacao) |
| alterar | `apps/hub/lib/apolo/empreendimentos.ts:218, 284-383` e `apps/hub/app/api/apolo/empreendimentos/route.ts` (universo e preço de `hercules_unidades`, `lerEstoquePelaRegua`; sai `u.price`) |
| alterar | `apps/hub/app/api/incorporador/produto/unidades/route.ts`, `apps/hub/app/api/apolo/empreendimentos/unidades/route.ts` (universo de `hercules_unidades`) |

Testes: `estoque-da-situacao.test.ts` (VGV por D4; unidade fora do mapa continua bloqueada);
paridade: Total, cada balde (un e VGV) iguais em Produtos, ficha, Resumo do produto, Apolo
Empreendimentos, TelaProdutos e legenda do espelho.
Diferença visível: o VGV de Vendido e Negociação passa a ser o negociado (nativa com desconto: 2 em
contrato e 1 cancelada hoje têm valor ≠ tabela).

### F9c · Hércules › Venda

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/app/api/incorporador/venda/route.ts:250-270, 330, 375-412, 540` (devolve `indicadores` de `lerIndicadoresDeVenda` com a janela do painel) |
| alterar | `apps/hub/lib/hercules/fluxo-de-venda.ts` (`agregarFluxo`: a faixa vem de I.estoque.porSituacao; saem `mesDe` por `data_faturamento`, `naJanela` própria, o ranking por texto e a série; `dataDaEtapa` usa os fatos: contrato, faturado, cancelado; assinatura fica com a F4b) |
| alterar | `apps/hub/modules/incorporador/hercules/TelaVenda.tsx:3636-3975` (Panorama, funil, Quem está vendendo, Mês a mês, motivos só formatam I; sai o cálculo de `faturadas`, `emAndamento`, `conversao`, `ticket` do componente) |

Testes: `fluxo-de-venda.test.ts` (faixa = régua; a proposta que mudou de gleba conta uma vez);
teste do Panorama com janela (defeitos 0.2, 0.3, 0.4, cada um com o caso que o reproduz);
`data-faturamento-e-previsao.test.ts` estendido (o mês nunca sai de `data_faturamento`); paridade:
Faturado, Contrato, Assinatura, Em cancelamento da faixa = legenda = Produtos (F9b); Canceladas e
Conversão = BI do portal (entra na F9d).
Diferença visível ao Lucas, antes do deploy: Conversão VOC 44,6% → 68,8%, VOL 45,7% → 71,1%;
Canceladas VOC 105 → 37 (histórico inteiro, por proposta); "Em andamento" perde os disponíveis.

### F9d · Portal do incorporador sem C2X de venda (TelaVendas, Mapa, Imobiliárias, Última movimentação)

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/app/api/incorporador/vendas/route.ts:105-170` (lê `lerIndicadoresDeVenda` + régua; sai o C2X) |
| alterar | `apps/hub/lib/apolo/vendas.ts:316-515, 680-758` (universo de `hercules_unidades`; comprador, imobiliária, "há N dias" pela proposta que decide e pela data do fato da etapa; perdas e movimentação por F e passagens) |
| substituir | `apps/hub/lib/apolo/incorporador/vendas-bi.ts` (os KPIs do BI viram I.desempenho e I.serieMensal; `lerEventosDeVendas` sai) |
| alterar | `apps/hub/lib/apolo/incorporador/vendas-resumo.ts:112-240, 291-320` (Resumo, Ritmo e unidades por I) |
| alterar | `apps/hub/lib/apolo/incorporador/venda-proposta.ts:201-310` (valores e datas de `hercules_propostas` e F; parcelas ficam do C2X) |
| alterar | `apps/hub/lib/apolo/incorporador/masterplan-estado.ts:90-150` (comprador da proposta que decide, preço de `hercules_unidades`) |
| alterar | `apps/hub/lib/apolo/incorporador/imobiliarias-do-produto.ts:133` e `app/api/incorporador/produto/imobiliarias/route.ts` (I.porImobiliaria para todo produto) |
| alterar | `apps/hub/lib/apolo/empreendimentos.ts:899-960, 1240-1275` (Última movimentação pela proposta que decide) |
| alterar ou apagar (Zeus apaga) | `app/api/apolo/empreendimentos/vendas/route.ts`, `.../vendas/proposta/route.ts` (sem chamador em `modules/`) |

Testes: `vendas-resumo.test.ts`, teste da rota com `indicadoresParaOPortal` (allowlist: sem ids de
entidade, sem "C2X"); paridade: Vendido, Unidades vendidas, Propostas, Faturadas, Canceladas, %
cancelamento, Conversão, Ranking do portal = Venda do Hércules = Resumo do produto; Coluna Vendas da
ficha Imobiliárias = Quem está vendendo; varredura sem C2X em todos os arquivos desta tabela.

### F9e · Pessoas: CRM do portal, CRM 360, Dashboard do Apolo, perfil

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/lib/apolo/incorporador/crm.ts:187-395, 851-943` e `app/api/incorporador/crm/route.ts` (compradores e imobiliárias por entidade, I.pessoas e I.porImobiliaria; "Unidades vendidas" = D6; a unidade só na carteira deixa de virar "Faturado") |
| alterar | `apps/hub/lib/apolo/incorporador/historico.ts:61-105, 190-225` (marcos por passagens e F) |
| alterar | `apps/hub/lib/apolo/server.ts:1093-1180, 2033-2130, 2911-3010, 4690-4720, 4947-4965` (Comprador = D17; "com pagamento" e adimplência continuam da carteira; estágio e contrato por E e C) |
| alterar | `apps/hub/lib/apolo/timeline.ts:67, 250-270` |
| alterar | `apps/hub/lib/iris/caca-agent.ts:1586-1650` (perfil comprador por I.pessoas, não por `stage_label`) |
| alterar | `apps/hub/lib/apolo/incorporador/perfil-comprador.ts` (o conjunto de compradores vem de I; os atributos conforme a pergunta 3) |

Pedido operacional (com OK): o cron `/api/apolo/sync/c2x` deixa de gravar `stage_label` e
`metadata.contractStatus`/`contractDocumentId` em `apolo_commercial_links` depois que nenhum leitor
os usar (grep na fatia); até lá é espelho morto que diverge em 43 de 924.
Testes: `crm.test.ts` (compradores da nativa aparecem sem redigitação; carteira não cria comprador);
paridade: Compradores do CRM = CRM 360 = Clientes únicos/Compradores do portal (mesmo recorte).

### F9f · Datas de venda na carteira e o contrato assinado

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/lib/apolo/carteira.ts:276-289, 359-362`, `app/api/incorporador/carteira/route.ts:134, 263` (coluna Faturado = F.faturado_em pela unidade; os valores seguem do C2X) |
| alterar | `apps/hub/lib/apolo/incorporador/documentos.ts:109-127` e `modules/incorporador/TelaCarteira.tsx` (botão pelo `contratoId` da F4; a Clicksign continua sem PDF guardado) |

Paridade: a data Faturado da carteira = "Faturado em" do popup = mês da série.

### F9g · Prometeu, BI do Vale do Ouro, relatório comercial, histórico da unidade

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/modules/prometeu/blocks/central/central-view.tsx:152-178, 1310-1345`, `app/api/prometeu/reservas/route.ts`, `lib/prometeu/reservas-do-panteon.ts:114-140` (Vendas fechadas = D5; funil pela régua das unidades do evento) |
| alterar | `apps/hub/lib/prometeu/jornada-unidades.ts`, `app/api/prometeu/jornada/route.ts` (sai `historicoDeUnidadesDoC2x`) |
| alterar | `apps/hub/lib/prometeu/bi-vale-do-ouro.ts:80-360` (estoque e vendido por I; ranking, planos por `hercules_propostas`; contratos gerados por `contrato_em`; o vigia de coerência sai; cobrança da entrada continua do C2X, com o recorte de E) |
| alterar | `apps/hub/app/api/incorporador/venda/historico/route.ts:90-154` (Assinaturas por `temis_envelopes` via C; Pagamentos pela carteira) |

Paridade: Vendido e VGV do BI do Vale do Ouro = Produtos (VOC, VOL); Vendas fechadas do Prometeu = D5
do Hércules para as unidades do evento.

### F9h · Hades, Iris, Athena, CACÁ com o cliente

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/lib/guardian/read-model-sync.ts:295-313`, `read-model.ts:505-514`, `attendance.ts:143-157, 320-348, 1460` (status de venda e contrato lidos na hora por E e C pela unidade; o recorte "contrato vivo" por E; o espelho em `metadata.units[]` deixa de ser lido e depois de ser gravado) |
| alterar | `apps/hub/modules/guardian/attendance/components/AiCopilotDrawer.tsx:955-975`, `ClientDetailPanel.tsx:1704-1725`, `PropostasPanel.tsx:1179-1192` |
| alterar | `apps/hub/lib/guardian/overview.ts:586-640, 760-835, 884-906` (sai o bloco de venda e assinatura do payload) |
| alterar | `apps/hub/lib/hades/dossie/dados.ts:180-200, 360` |
| alterar | `apps/hub/app/api/iris/athena/route.ts:70-96`, `lib/guardian/contract-reader.ts`, `lib/iris/caca-agent.ts:2150-2396, 2747-2762`, `modules/caredesk/blocks/conversation/iris-cobranca-context.tsx:616-760` |
| alterar | `apps/hub/lib/apolo/painel-sinal.ts` (recorte de venda viva por E) |

Testes: a IA recebe "Faturado" e "Assinado" da mesma unidade que o Hércules mostra; a Athena não
chama de assinado um envelope em aguardando; paridade: situação por unidade na fila do Hades = régua.

### F9i · CACÁ modo direção: o "motor do Panteon" passa a ser do Panteon

| Ação | Caminho |
|---|---|
| criar | `apps/hub/lib/analytics/panteon-builder.ts` (métricas e dimensões sobre I e `hercules_venda_fatos`) |
| alterar | `apps/hub/lib/analytics/registry.ts:13-250` (módulo "panteon"; o "c2x" fica só com as métricas financeiras) |
| alterar | `apps/hub/lib/guardian/c2x-analytics.ts:388-970` e `apps/hub/lib/iris/caca/executors.ts:257-458, 544-650, 1283-1350, 1666-1707` (movimentação, vendas por empreendimento e imobiliária, unidade, cliente, cenário comercial, "clientes com contrato") |

Testes: `executors.test.ts` (as respostas numéricas vêm de I); paridade: `consultar_panteon`
propostas/vendas/faturamentos/cancelamentos = Venda do Hércules na mesma janela; imagem "Vendas por
empreendimento" = Produtos.

### F9j · GLotes (LOS e LOU)

| Ação | Caminho |
|---|---|
| alterar | `apps/hub/lib/integrations/glotes/consultas.ts:668-735` (lotes pela régua, mapeados para o vocabulário do contrato OpenAPI) e `:774-900` (vendas por F: situação pelo rótulo, `data_venda` = `data_ato`, `valor_venda` = valor, `codigo_venda` da carga `VEN-<origem_c2x_id>` e da nativa por `codigo-da-venda.ts`; `atualizado_em` = maior data de fato) |

Testes: contrato OpenAPI (mesmo esquema; LOS 267 + 1, LOU 206 conferem com a medida de 25/09, 474
vendas abertas). É API para fora: a GLotes é avisada da troca de fonte (pedido operacional).

### F9k · Guarda

- `sem-c2x-na-venda.varredura.test.ts` com a lista completa das fatias.
- Zeus: card "Indicadores de venda" com o frescor (`lidoEm`), `temis_espelho_d4sign.ultima_rodada_ok_em`
  e o último `temis_assinatura_eventos.recebido_em` (`lib/operations/data-sources.ts`).

---

## 4. O que continua no C2X por ser financeiro

Lido do C2X, e só isto:

- **pagamentos e parcelas** (`payments`): carteira total, recebido, a receber, vencido,
  inadimplência, recuperação, aging, composição Ato/Sinal/Parcela, valor líquido do loteador, ato e
  sinal, parcelas do coordenador, cenário financeiro do comprador, extrato, evolução da parcela e
  reajuste;
- **boletos** e links de pagamento (C2X e Asaas), aba Sinal do painel público, cobrança da entrada do
  BI do Vale do Ouro, `recebimentos` e campos de parcela da GLotes;
- **a entrada paga** que a F8 usa para mover a venda a Faturado, e o "houve pagamento?" do pedido de
  cancelamento (mesma leitura da carteira);
- **Hades**: snapshot financeiro, push diário, Inteligência, propostas de acordo e seus envelopes;
- **CACÁ**: `consultar_financeiro`, boletos, métricas `inadimplentes`, `parcelas_vencidas`,
  `valor_vencido`, `valor_carteira_vendida`;
- **o documento da D4Sign**: o espelho da F3 lê o C2X só para achar o envio, a unidade e o rol.

Regra que a F9 acrescenta ao financeiro: **o recorte "venda viva" de qualquer indicador financeiro
sai do Panteon** (E), não do estágio do C2X. Hoje a fila do Hades filtra os estágios 7, 8, 10 e 11, o
snapshot não filtra (232 × 230 clientes) e a aba Sinal inclui venda cancelada: três recortes para o
mesmo universo.

Não é financeiro e não fica: data do faturamento (é fato de venda), "Faturado" da carteira, status do
contrato, comprador, imobiliária, VGV negociado.

---

## 5. Perguntas de negócio (só as que mudam o que se faz)

1. **Contar por proposta ou por unidade?** A Venda do Hércules conta cada proposta; o BI do portal
   conta a unidade uma vez (*"quantas unidades tiveram proposta"*). Histórico do VOC: 129 propostas em
   95 unidades, 37 canceladas em 23 unidades; VOL 128 × 94. Conversão, % cancelamento e o gráfico
   mudam conforme a resposta, e todas as telas passam a usar a mesma. **Padrão do plano: por
   proposta** (a proposta é o fato; a unidade que caiu e revendeu teve duas tentativas, e é o que o
   coordenador precisa ver).
2. **Venda que não nasce no Panteon.** Desde 22/09 nada do C2X entra; o Garden tem 0 propostas; JDG,
   LAB, LBP, LBR, RVP e VDO não têm venda nativa. Se esses produtos ainda vendem direto no C2X, os
   indicadores deles ficam parados no dia 22/09 e nunca batem. **(a)** toda venda passa a nascer no
   Hércules a partir de uma data (o que o C2X tiver de novo é redigitação, como hoje); **(b)** uma carga
   pontual traz o que falta (reabre a carga encerrada, com OK); **(c)** os indicadores desses produtos
   saem da tela com o aviso "venda fora do Panteon". **Padrão: (a), com (b) uma vez para o Garden** e a
   lista medida pelo ensaio.
3. **Perfil do comprador** (sexo, idade, estado civil, renda, profissão; TelaVendas e CACÁ). O
   Panteon sabe QUEM comprou (1.972 de 1.972 clientes da carga como entidade), mas os atributos só
   existem no cadastro do C2X (0.12). **(a)** trazer esses campos para a ficha do Apolo (o Apolo
   cadastra; carga de cadastro, com OK); **(b)** o conjunto vem do Panteon e os atributos são lidos do
   cadastro do C2X por id, como exceção declarada; **(c)** o perfil sai até a ficha ter o dado.
   **Padrão: (a)**; até ela, (c).

---

## Ataque paridade

> 28/09/2026 · crítico adversarial (subagente do Zeus). Pergunta única: depois da F9, existe alguma
> tela em que o mesmo indicador ainda pode dar número diferente de outra tela? Conferido no código
> deste worktree e no banco `bxgukywoxgivlrhjkwjx` (só SELECT, sem dado pessoal; C2X não consultado).
> Nenhum arquivo de código editado. Números de hoje, 28/09.

Resposta curta: **sim, em pelo menos 15 pontos.** A F9 unifica a CONTA (régua, view, montador), mas
deixa com cada tela quatro coisas que também decidem o número: **quais empreendimentos entram**,
**quais linhas de unidade entram**, **a janela e o fuso**, e **o nome do indicador**. É ali que as
divergências de hoje vão sobreviver, e o teste de paridade proposto não chega lá (P15).

| # | Gravidade | Onde o número ainda diverge | O plano muda? |
|---|---|---|---|
| P1 | alta | Escopo: cada tela resolve os ids por conta própria | sim: resolvedor único dentro da fonte |
| P2 | alta | Linhas do pai entram no estoque e os fatos do pai não | sim: só linha viva; pai vira filhos |
| P3 | alta | Três "vendido" (D5, D6 e a regra do BI de 10/08) | sim: um nome por definição + pergunta 4 |
| P4 | alta | Estado da UNIDADE usado como estado da PESSOA e do PEDIDO | sim: chave é a proposta |
| P5 | média | Janela: mês UTC no navegador, dia na CACÁ, padrões diferentes | sim: janela no servidor, com dia |
| P6 | média | Mês calculado em SQL depende do fuso da sessão | sim: colunas de mês e dia na view |
| P7 | média | Contas que I não tem (reservas, contratos gerados) viram contas locais | sim: I e a view crescem |
| P8 | média | "Não lançada" (preço ≤ R$ 1) só existe no BI do Vale do Ouro | sim: vira campo de I |
| P9 | média | "Pai = soma dos filhos" quebra contagem distinta | sim: pai é uma chamada sobre a união |
| P10 | média | Caches de 60 s a 10 min e leituras em instantes diferentes | sim: sem cache por instância; `lidoEm` |
| P11 | média | Rodapé do Panorama e lista da Venda por SIGLA ficam fora da F9c | sim: F9c |
| P12 | média | Contratos: "Faturados" em outro universo; "Assinatura" com dois sentidos | sim: F9a e F9c |
| P13 | baixa | CAD no topo do funil com cinco contas e leitura sem paginar | sim, pequeno |
| P14 | baixa | Predicados que hoje batem por acaso (sombra, workspace, `aberta`, pessoa) | sim, pequeno |
| P15 | baixa | O teste de paridade testa o montador puro, não a rota | sim: seção "A prova de paridade" |

### P1 · alta · O escopo continua com cada tela

**Evidência.** `lerIndicadoresDeVenda(client, { enterpriseIds })` recebe os ids prontos; quem os
resolve é o chamador. Hoje há pelo menos oito resolvedores diferentes, contados por arquivo fora de
teste: `expandirIdDoPainel`/`alcanceDoPai` (15 arquivos), `comIdsDoGrupo` (15), `idsDoC2xDasSiglas`
(22), `idsDoC2xDasSiglasAoVivo` (19), `espelhosADescartar` (4, só a Venda), `ENTERPRISE_MIRRORS` (9,
lista fixa só com o VLO), `EXCLUDED_ENTERPRISE_IDS = [2, 31, 34]` (lista fixa) e
`CARTEIRAS_VIVAS = [VOL, VOC]` do BI do Vale do Ouro (`bi-vale-do-ouro.ts:21-23`). E o escopo da
sessão passa por `catalogoDeEmpreendimentos`, que **lê o C2X** (`getHadesDbPool`) com cache de
10 min por instância. Medido:

- **ACT (id 30)**: 31 unidades, 31 propostas (26 em assinatura, 2 contrato, 2 faturadas) e **nenhuma
  linha em `hercules_empreendimentos`**. Fica fora de todo escopo resolvido pelo cadastro (Produtos,
  pai do ACP) e dentro de todo escopo resolvido pelo catálogo (Venda, portal, CACÁ).
- **LAB (31)**: além das 412 linhas-sombra, **83 linhas vivas bloqueadas, R$ 40.108.860 de tabela**.
  Entram em qualquer conta que peça o 31 sem a lista fixa.
- **SDT (2)** com 5 unidades e 16 propostas, **TSC (34)** com 1 e 2: fora só pela lista fixa. A view
  não carrega exclusão nenhuma; a CACÁ ou a conferência que lerem a view inteira contam os dois.
- **BI do Vale do Ouro soma VOC + VOL e deixa o VOR fora** (4 unidades, 2 faturadas); Produtos soma os três.
- **C2X fora do ar**: o painel de Produtos degrada para "só o cadastro" (`avisoDaFonte`) e a Venda
  responde 503. Durante a queda, "todos" tem dois totais.

**Conserto.** Quarta peça da seção 2.1: `escopoDosIndicadores({ sessao, pedido })` em
`lib/hercules/indicadores/`, lido só do cadastro do Panteon: `pai_id`, `c2x_enterprise_id` e uma
marca "fora dos indicadores" para teste, SDT e TSC, no lugar das listas fixas. Três regras:
(1) `lerIndicadoresDeVenda` recebe sessão e pedido, nunca ids soltos; (2) a CACÁ, o BI, a GLotes e o
script de conferência chamam o mesmo resolvedor; (3) `catalogoDeEmpreendimentos`,
`ENTERPRISE_MIRRORS`, `CARTEIRAS_VIVAS` e `EXCLUDED_ENTERPRISE_*` entram na lista da varredura
`sem-c2x-na-venda`. Antes da F9b, a linha do ACT nasce no cadastro, como filho do ACP (decisão do
PAN-124 de 26/09).

### P2 · alta · Linhas do pai no estoque, fatos do pai fora

**Evidência.** `montarIndicadoresDeVenda` recebe `linhas: LinhaDoEstoque[]`, e o leitor que existe
(`lerLinhasDoEstoque`, `estoque-da-situacao.ts:142-157`) **não filtra `espelho_de`**. O comentário
de `contarEstoque` diz que quem não soma pai e filhos é o `montarPainelDeProdutos`, mas o Apolo lista
o VLO como linha própria (`ENTERPRISE_MIRRORS`, `empreendimentos.ts:8`). Resultado dentro de um
mesmo objeto I:

- Pedido com o 35: o estoque conta as 298 linhas-sombra, cada uma com a situação da viva. Os fatos
  do 35 são todos sombra, logo Faturadas = 0. Card diz "Vendido N", Panorama diz "0 faturadas".
- Pedido 35 + 36 + 37 + 41: são 600 linhas, com cada lote duas vezes.
- VLO pelas linhas do pai: 298 un e R$ 34.565.152. Pela soma dos filhos: 302 un e R$ 35.255.512.
  São 4 lotes do VOR sem linha no pai e 4 preços diferentes entre pai e viva.
- LAB pelo 31: 495 linhas (412 sombra + 83 bloqueadas). Soma dos filhos: 412.

**Conserto.** `linhas` só com `espelho_de is null`. O pedido do pai vira os filhos dentro do
resolvedor de P1: o pai nunca é id de contagem. Teste novo, com as mesmas contagens em todos os campos:
`I([35]) = I([36, 37, 41])` e `I([35, 36, 37, 41]) = I([36, 37, 41])`. Na F9b, a linha VLO do Apolo
passa a ser a soma dos filhos, como em Produtos.

### P3 · alta · Três "vendido"

**Evidência.** D5 ("Venda": contrato, assinatura, faturado, vendida) e D6 ("Vendido": faturado e
vendida) diferem hoje em **445 propostas vivas: 422 em assinatura e 23 em contrato, R$ 124,2 mi**. O
plano chama D5 de "o 'vendas' da CACÁ" e D6 de "o 'vendido' de card, BI, CACÁ e GLotes", e a F9i pede
"imagem Vendas por empreendimento = Produtos" (Produtos mostra D6). A mesma pergunta à CACÁ pode sair
com 445 de diferença conforme a palavra. E há uma terceira definição, regra do Lucas no BI do Vale do
Ouro (`bi-vale-do-ouro.ts:72-99`, 09 e 10/08): *"tudo que estiver em proposta, contrato gerado e
assinatura, vamos contar como vendido"*, ou seja negociação + vendido. A F9g manda "Vendido do BI =
Produtos": o número do BI público cai sem que ninguém pergunte.

**Conserto.**
- `definicoes.ts` exporta `ROTULO_DO_INDICADOR`, um rótulo por definição e nunca dois: "Vendido" só
  para D6; D5 vira "Vendas em contrato ou além"; o do BI vira "Vendido (regra do BI)" ou morre.
- `ONDE_APARECE` registra a chave D, e o teste falha se duas chaves diferentes usarem o mesmo rótulo.
- A CACÁ responde com o nome da definição.
- Pergunta 4 ao Lucas, na seção 5: *o BI do Vale do Ouro mantém a regra de 10/08 (negociação conta
  como vendido) ou passa a D6?*

### P4 · alta · Estado da unidade usado como estado da pessoa e do pedido

**Evidência.** A régua responde por UNIDADE. A F9e ("E + F por entidade" no CRM 360) e a F9h ("E + C
lidos na hora pela unidade" no Hades, Iris e Dossiê) leem a régua pela unidade. A F9f também ("coluna
Faturado = F.faturado_em pela unidade", e a carteira é por PEDIDO) e a F9j ("situacao pelo rótulo",
com `incluirCanceladas` na GLotes). Medido: **947 unidades vivas têm proposta morta e proposta viva**.
**684 clientes com proposta ou reserva cancelada estão em 912 unidades que hoje têm venda viva de outro
cliente.** A ficha do comprador antigo mostraria "Faturado" (a venda do dono novo), enquanto a lista
da Venda mostra a dele "Cancelado".

**Conserto.** Em toda tela por pessoa ou por pedido, a chave é a PROPOSTA:
- pedido da carga: `hercules_propostas.origem_c2x_id`;
- venda nativa redigitada no C2X (sem origem): a proposta que decide a unidade, e só se o cliente for
  o mesmo.

A situação da venda é a etapa dessa proposta mais a marca de cancelamento. A régua só entra quando
`propostaQueDecide.id === proposta.id`. D17 passa a dizer "por proposta", e F9e, F9f, F9h e F9j trocam
"pela unidade" por "pela proposta".

### P5 · média · A janela

**Evidência.**
- **O mês UTC do navegador.** `TelaVenda.tsx:468` (`competenciaDe`) usa `getUTCMonth`. Das 21h às
  23h59 do último dia do mês, o "12m" da Venda já termina no mês seguinte, enquanto o BI do portal
  (`janelaDeMeses`, São Paulo) ainda está no atual.
- **O dia da CACÁ.** A CACÁ pergunta por `hoje`, `esta_semana`, `dia`, `semana` e
  `data_inicio`/`data_fim` por dia (`lib/analytics/registry.ts:83, 303-305`), e o BI do Vale do Ouro
  tem "vendas de hoje". A `Janela` do plano é só `"YYYY-MM"`: essas telas vão filtrar os fatos por
  conta própria.
- **Os padrões.** A Venda abre em 12m, o BI do portal em 12 meses, o Contratos no histórico inteiro.
  O mesmo "Faturadas" sai com três números no mesmo dia.

**Conserto.**
- `Janela` aceita dia (`{ de: 'YYYY-MM-DD', ate }`), com o mês como atalho.
- A janela padrão é calculada no SERVIDOR, em Brasília (`janelaPadrao(agora, id)`). O cliente manda
  só o id ("12m").
- Todo número com janela mostra a janela escrita ao lado.
- `ONDE_APARECE` declara a janela de cada tela, e a paridade compara pela mesma janela.

### P6 · média · Mês em SQL depende do fuso da sessão

**Evidência.** O PostgREST roda com `TimeZone=America/Sao_Paulo` (configuração do `authenticator`); o
MCP e uma conexão `pg` direta rodam em UTC. Medido em `hercules_proposta_etapas`: **5 passagens para
faturado, 15 para cancelado e 12 de nascimento de proposta mudam de mês conforme o fuso**. A
"conferência em SQL puro" (item 5 da prova) e o builder "panteon" da CACÁ, se usarem `date_trunc`
sem fuso explícito, dão outro número que a tela. O risco é "consertar" a tela para bater com a
conferência errada.

**Conserto.** A 0201 expõe `proposta_mes`, `faturado_mes`, `cancelado_mes` e `distrato_mes` (texto
`YYYY-MM`) e os `*_dia` (date), calculados com `at time zone 'America/Sao_Paulo'`. Nenhuma conta
agrega fora dessas colunas. `mesEmBrasilia` fica só para o `agora`.

### P7 · média · Contas que I não tem viram contas locais

**Evidência.** `IndicadoresDeVenda` não tem reservas feitas no período (CACÁ #72, BI #60), contratos
gerados no período (BI #60), vendas do dia (BI), nem não lançadas (P8). Cada uma vai virar um
`.filter` sobre `FatoDaVenda` na tela, ou seja uma segunda definição. E a D2 manda contar a reserva
caída do Hércules (`hercules_reservas` cancelada: 10 hoje) e do salão (`prometeu_reservas` cancelada:
7), mas `FatoDaVenda` só lê `hercules_propostas`: `reservasCaidas` sai só com a da carga.

**Conserto.** As reservas entram nos fatos: ou numa `union` na view (reservas do Hércules e do salão,
fora os cupons já convertidos, com `reserva_em` e `reserva_caida_em`), ou numa segunda view
`hercules_reserva_fatos`. I ganha `reservas`, `contratosGerados` e `naoLancadas`, e a varredura
proíbe `.filter(` sobre `FatoDaVenda` fora de `lib/hercules/indicadores/`.

### P8 · média · "Não lançada" só no BI

**Evidência.** O BI do Vale do Ouro tira do estoque `price <= 1` (`UNIDADE_COMERCIAL`), com as "não
lançadas" à parte. Hoje as linhas vivas a R$ 1 ou menos, todas bloqueadas, são VOL 46, VOC 26, GDN
165, id 19 com 99, id 28 com 47, id 38 com 27. Produtos conta todas no Total e no Bloqueado. Total do
VOC: **Produtos 157, BI 131**.

**Conserto.** `naoLancada` vira sinal da régua ou campo `estoque.naoLancadas: Contagem`, fora do total
comercial, e toda tela mostra o Total do mesmo jeito. Entra nas D3 e D4 e nas fatias F9b e F9g.

### P9 · média · "Pai = soma dos filhos" quebra contagem distinta

**Evidência.** O plano diz que "a tela do pai pede à fonte os ids dos filhos e soma". Clientes únicos,
Compradores e número de imobiliárias não somam. Medido, clientes com venda viva em dois filhos do
mesmo pai: **RDX 12, PDX 7, VLO 6, LAB 4, LOX 3**. E a mesma venda em duas glebas (LBR+ACT 29,
RDP+RPC 13, mesmo cliente e mesma quadra e lote) entra duas vezes em Vendas e uma vez em Clientes.

**Conserto.** O pai é UMA chamada a `montarIndicadoresDeVenda` sobre a união dos ids dos filhos,
nunca a soma de objetos I. `definicoes.ts` marca, campo a campo, o que é aditivo. Teste de paridade:
"pai = I(filhos)" para os campos distintos.

### P10 · média · Cache e instante de leitura

**Evidência.** Telas que o plano leva à fonte têm caches diferentes:

| Leitura | Cache |
|---|---|
| BI do Vale do Ouro público | `s-maxage=60, stale-while-revalidate=120`, até 3 min |
| `painel-sinal`, `painel-coordenador`, `painel-assinatura`, `painel-contratos` | 5 min em memória, por instância |
| `cad-source` da CACÁ | 120 s |
| espelho | 60 s, privado |
| catálogo | 10 min |
| Venda e Produtos | `no-store` |

O cache em memória por instância faz o mesmo painel mudar de número entre duas recargas. Além
disso, a régua (E) e a view (F) são lidas em consultas separadas na mesma resposta, e
`lerFatosDaVenda` pagina por `.range` (deslocamento). Uma escrita no meio desloca a página, e uma
venda pode estar em E e ainda não em F.

**Conserto.**
- I não se guarda em memória de instância. Se houver cache, é um só, no CDN, igual para todas as
  telas.
- Toda tela mostra `lidoEm`, e a conferência compara pelo mesmo `lidoEm`.
- A view pagina por chave (`gt('proposta_id', último)`).
- A resposta é descartada e relida se `max(quando)` das passagens mudou entre as leituras de E e F.

### P11 · média · Rodapé do Panorama e lista por sigla ficam fora da F9c

**Evidência.** `TelaVenda.tsx:3810-3812` escreve `periodo.propostasNoPeriodo` e `totais.propostas`
de `agregarFluxo`. As duas contam toda linha da lista, incluindo a reserva do Hércules convertida em
linha e a reserva caída da carga. Ao lado do KPI Propostas (D1), o cartão teria dois números
chamados "propostas". E a lista da Venda filtra por SIGLA (`.in("empreendimento_codigo", codes)`,
`venda/route.ts:254`), enquanto a view filtra por id. Medido: **49 propostas cuja unidade é de
empreendimento sem linha no cadastro** (ACT 31, SDT 16, TSC 2). Depois de um renome, a lista perde
linhas que os indicadores continuam contando.

**Conserto.** A F9c tira `propostasNoPeriodo` e `totais.propostas`, ou os lê de I. A leitura da lista
passa a `unidade_id in (linhas vivas do escopo)`.

### P12 · média · Contratos: outro universo para "Faturados"; "Assinatura" com dois sentidos

**Evidência.** A F9a troca o card para "proposta em faturado", mas `totaisDe`
(`AssinaturasDoProduto.tsx:2234-2252`) conta dentro das linhas de contrato (C). A venda da carga
faturada sem documento achado pelo espelho da D4Sign fica fora; `I.desempenho.faturadas` conta
todas. E o passo "Assinatura" da faixa da Venda (a etapa: 422 hoje, muitas já assinadas e
esperando o Faturado) convive com "Em assinatura" e "Assinados" do Contratos (o envelope): a mesma
palavra, duas contas, no mesmo módulo.

**Conserto.** O card Faturados lê I, no mesmo escopo, e diz "N no escopo · M com contrato no Panteon".
Até a F8 esvaziar a etapa, o passo da faixa vira "Em assinatura ou assinado", ou se quebra por C.

### P13 · baixa · CAD no topo do funil

**Evidência.** A F9 deixa o CAD "em `apolo_esteira`", mas no mesmo funil ele tem cinco contas:

| Onde | Como conta |
|---|---|
| Venda (`venda/route.ts:393-411`) | por pessoa, com a última linha vencendo e sem `order`: 41 pessoas com duas linhas ganham etapa ao acaso |
| Resumo do produto (`resumo-do-produto.ts:243`) | por linha, sem deduplicar |
| Painel público (`cads-publico-resumo.ts`) | por nome do empreendimento (`ilike`) |
| Relatório das imobiliárias | por ficha |
| CACÁ | `cad-source`, com cache de 120 s |

A leitura usa `.limit(5000)` (`crm.ts:483, 632`), que o PostgREST corta em 1.000 sem erro. Hoje cabe
(843 linhas na esteira, 693 do VLO; 612 vínculos). Passou de 1.000, o corte é calado.

**Conserto.** `contarCads` único em `lib/apolo`, com ordem determinística (a etapa mais avançada) e
paginado. O funil da Venda e o Resumo leem dele. Na tabela da seção 1, a linha 10 ganha a nota.

### P14 · baixa · Predicados que hoje batem por acaso

- **Sombra.** A view usa `origem = 'c2x'` e a régua usa `origem_c2x_id is not null`. Hoje há 0
  divergências em 4.946.
- **Workspace.** A régua filtra `careli` e a view não. Hoje só existe `careli`.
- **`aberta`.** Vale `true` em 7 canceladas e 15 distratos. A GLotes "vendas abertas" (474 hoje, que
  bate com LOS 268 + LOU 206 vivas pela etapa) não pode ler a coluna.
- **Pessoa.** Entre os clientes, 5 documentos estão espalhados em 22 entidades a mais. "Clientes
  únicos" por entidade fica 22 acima da conta por documento.

**Conserto.**
- Um predicado exportado (`ehSombra`) usado pela view e pela régua.
- `lerFatosDaVenda` com `.eq('workspace_id', 'careli')`.
- `aberta` entra na lista proibida da varredura, e a GLotes define "aberta" como etapa em
  `ETAPAS_DO_FLUXO`.
- A chave da pessoa é a entidade (decidido), e os 5 documentos vão para a fila de fusão.

### P15 · baixa · O teste de paridade não alcança onde a divergência nasce

**Evidência.** `ONDE_APARECE.ler(f)` chama o montador PURO de cada tela sobre a mesma `FonteDeTeste`.
Os pontos P1, P2, P5, P6, P10 e P11 vivem na rota: escopo, linhas, janela, fuso, cache e filtro por
sigla. Todos passariam verdes.

**Conserto.**
- O registro declara, por tela, a `rota`, o `escopo` e a `janela`.
- O teste chama o handler da rota com o banco em memória, sessão fixa e `agora` fixo. O caso
  obrigatório é 23h30 do dia 30 em Brasília.
- A conferência em produção roda pelo PostgREST (fuso de São Paulo), nunca por conexão direta.

### O que conferi e não é problema

| O que | Medida |
|---|---|
| Custo da view | `EXPLAIN ANALYZE` do corpo inteiro com ordem e deslocamento de 4.000: 61 ms para 4.946 linhas; o limite do `authenticator` é 8 s |
| Teto de 500 do Contratos | a F4 já calcula os totais antes do teto |
| Dados da proposta | 0 com valor nulo ou zero; 0 sem unidade; 0 viva com `cancelada_em` |
| Nativas | 0 penduradas em linha do pai; todas as 18 em contrato ou assinatura têm passagem para `contrato` |
| Gleba | 0 lote hoje em que a linha viva NÃO bloqueada herda a venda da irmã (o risco de atribuir o fato a outra gleba fica latente, coberto por P2) |
| Faturadas | uma por unidade em todos os empreendimentos; nenhuma faturada com marca de cancelamento hoje (só 2 marcas, em contrato ou assinatura) |

---

## Ataque regressao

> 28/09/2026 · crítico adversarial (subagente do Zeus). Lente: o que o usuário PERDE ou vê MUDAR
> (número que sobe ou cai, e por quê), o custo de consulta nas telas quentes, a leitura do C2X que
> sobra sem ser financeira e o dado pessoal que sai. Conferido no código deste worktree e no banco
> `bxgukywoxgivlrhjkwjx` (só SELECT e EXPLAIN, sem dado pessoal; C2X não consultado: o que o C2X faz
> hoje foi medido pelo espelho dele que o cron grava no Supabase, `apolo_commercial_links`).
> Nenhum arquivo de código editado. O que o "Ataque paridade" já cobre está citado pelo número (P1 a
> P15) e não se repete.

| # | Gravidade | Achado | O plano muda? |
|---|---|---|---|
| R1 | **crítica** | A F8 move 415 vendas antigas de uma vez: se a passagem gravar a data de hoje, o mês da F8 ganha 415 faturadas e R$ 118,7 mi | sim: passagem retroativa com a data do fato; F9i só depois da F8 |
| R2 | alta | Venda que o C2X já andou e o Panteon não: sai do BI do portal na F9d | sim: duas categorias novas no ensaio e o que fazer com cada caso |
| R3 | alta | O recorte "venda viva" do financeiro pelo Panteon pode tirar da cobrança contrato vivo | sim: regra de transição na seção 4 |
| R4 | alta | O id de unidade do Hades aponta para OUTRO lote em 57 de 299 entradas | sim: F9h resolve a unidade por quadra e lote |
| R5 | média | A régua lê o banco inteiro a cada chamada; a F9 põe a régua em telas com polling e em cada mensagem da CACÁ | sim: reuso, caminho por unidade, pausa da Central |
| R6 | média | GLotes: o relógio `atualizado_em` da F9j quebra o incremental documentado | sim: F9j mais estreita |
| R7 | média | O `valor` da carga é o preço de tabela: o popup do portal perde o negociado e o desconto reais | sim: linha 34 e texto de 0.5 |
| R8 | média | Leitura do C2X não financeira que sobra fora do plano, e a varredura não a enxerga | sim: seção 4 e varredura transitiva |
| R9 | média | Os números que mudam, medidos, para o Lucas ver antes de cada deploy | sim: "Diferença visível" por fatia |
| R10 | média | Preço de tabela e universo congelados em 01/09 para 20 empreendimentos (F9b) | sim: medir antes da F9b |
| R11 | média | Teste e glebas entram nos totais "todos" (complemento de P1 e P9) | sim: números da F9b corrigidos |
| R12 | baixa | Dado pessoal: ids para o navegador, rota pública sem allowlist, Central por CPF | sim, pequeno |

### R1 · crítica · A F8 despeja 415 vendas antigas no mês em que rodar

**Evidência.** A view escolhe `faturado_em = max(quando)` das passagens para `faturado` (seção 2.2), e
a seção 2.3 diz "A F8 move as 415 em `assinatura` e grava a passagem", sem dizer com que data.
Medido hoje (SELECT, `hercules_propostas` da carga em `assinatura`):

| Empreendimento | Vendas | Ano da `data_assinatura` | VGV |
|---|---|---|---|
| CDJ | 375 | 374 em 2025, 1 sem data | R$ 105.240.136 |
| id 30 (ACT) | 26 | 3 em 2025, 23 em 2026 | R$ 10.385.500 |
| ACP | 7 | 2026 | R$ 1.776.250 |
| VOC, VOL, VDO, JDG, RVP | 7 | 2026 | R$ 1.272.716 |
| **Total** | **415** | | **R$ 118.674.601** |

Se a passagem sair com `now()`, o mês da F8 recebe 415 faturadas e R$ 118,7 mi de VGV faturado, a
Conversão desse mês explode, o Ticket médio vira média de 2025 com 2026, e o Tempo médio proposta →
venda (D14) soma mais de um ano para 374 vendas do CDJ. E some o dado de 2025: o CDJ continua com zero
faturada nos meses em que vendeu. Até a F8 rodar, o CDJ aparece com **~0 Vendido e 375 em
negociação** em toda tela pela régua; o cadastro (retrato do C2X de 01/09) diz 376 vendidas. A CACÁ
(`consultar_vendas_por_empreendimento`, hoje `sale_status_id = 4` do C2X) passa a dizer "0 vendidas no
Cidade Jardim" no dia em que a F9i subir, se subir antes da F8.

**Conserto.**
- Regra escrita na F8 e na D7: passagem para `faturado` feita em lote tem `quando` = data do FATO
  (a maior entre "última assinatura do comprador + 7 dias" e "data em que a entrada ficou paga"),
  nunca a hora da execução; `autor_nome` e `observacao` marcam "F8 retroativa". Sem uma das duas
  datas, a venda não anda (vai para a lista do ensaio).
- Caso novo em `paridade.test.ts` e `definicoes.test.ts`: "faturada pela F8 em lote cai no mês do
  fato, e o Tempo médio usa esse fato".
- O ensaio da F8 lista, por empreendimento e por MÊS de destino, quantas andariam e o VGV. O Lucas vê
  a série antes.
- Ordem: F9i (CACÁ) e F9j (GLotes) só depois da F8, ou com o rótulo "em assinatura desde <ano>" ao
  lado do Vendido do CDJ.

### R2 · alta · Venda que o C2X já andou e o Panteon não

**Evidência.** O BI do portal (`vendas-bi.ts`, #24 e #25) lê o histórico do C2X AO VIVO; depois da
F9d lê o Panteon, parado em 22/09 para a carga. Casando o espelho do C2X no Supabase
(`apolo_commercial_links.metadata.acquisitionRequestId`, gravado pelo cron e atualizado em 28/09) com
`hercules_propostas.origem_c2x_id`:

| No C2X hoje | No Panteon | Casos | Efeito depois da F9d |
|---|---|---|---|
| Faturado | assinatura (carga) | 4 (ACP 3, VOC 1) | saem das Faturadas do mês |
| Faturado | sem par (redigitação da nativa, pedidos 5010 a 5016) | 3 (VOL) | idem; nenhuma nativa está em `faturado` (as do VOL: 5 em assinatura, 1 cancelada) |
| Em assinatura ou Contrato gerado | sem proposta (pedidos 4841 e 5013 a 5032) | 6 (VAL 2, VOC 2, REP 1, VOR 1) | somem das Propostas do mês |
| Cancelado | assinatura (carga) | 2 (JDG, RVP) | seguem como Venda (D5) e seguram o lote |

⚠️ O mesmo espelho mostra mais 23 "vivo no C2X × cancelado no Panteon", mas com `updated_at` entre
01/08 e 09/09: é o espelho que parou de atualizar essas linhas, não o C2X. Não serve de fonte (e é
mais um motivo para a F9e desligar a gravação do `stage_label`).

**Conserto.**
- O item 5 da prova de paridade ganha duas categorias com lista: "C2X à frente do Panteon" (os 7
  faturados e os 6 pedidos sem proposta) e "cancelada no C2X, viva no Panteon" (os 2).
- Para cada uma, uma saída escrita antes do deploy: a F8 resolve os faturados; os 2 cancelados vão ao
  pedido de cancelamento do Hércules, com decisão do Lucas; os pedidos novos são redigitação (se a
  nativa existe) ou venda fora do Panteon (pergunta 2).

### R3 · alta · O recorte financeiro pelo Panteon pode tirar contrato vivo da cobrança

**Evidência.** A seção 4 manda o recorte "venda viva" de todo indicador financeiro (fila do Hades,
snapshot, aba Sinal, cobrança da entrada do BI) sair da régua. Mas:
- a nativa redigitada no C2X não tem ligação com o pedido de lá: `origem_c2x_id` é nulo e
  `carteira-da-venda.ts` responde `nativa` sem ler parcela nenhuma. O cruzamento por PEDIDO perde
  todas as redigitadas (5009 a 5021 e as que vierem);
- os 2 casos de R2 (cancelados no C2X, vivos no Panteon) passariam a entrar na cobrança; e qualquer
  venda viva no C2X que o Panteon tenha como cancelada sairia dela.

**Conserto.**
- A regra da seção 4 ganha a transição: enquanto o boleto nascer no C2X, o recorte é "viva no Panteon
  OU com parcela em aberto no C2X", e a divergência vira lista para o time, nunca exclusão calada da
  cobrança.
- A junção é pela UNIDADE (unidade do pedido do C2X → `hercules_unidades.origem_c2x_id` → régua),
  nunca pelo pedido. A mesma regra vale para a "entrada paga" da F8.

### R4 · alta · O id de unidade do Hades aponta para outro lote

**Evidência.** A F9h troca o espelho `metadata.units[]` da fila por "E e C lidos na hora pela
unidade". A unidade da fila é `c2x-unit-N`. Medido em `c2x_guardian_attendance_queue`: 299 pares
(unidade, lote) distintos, com só **242 ids**; **38 ids aparecem em dois ou mais lotes diferentes**, e
**57 das 299 entradas (19%)** trazem um N cuja linha em `hercules_unidades` (por `origem_c2x_id`) tem
outra quadra e lote. Exemplo sem pessoa: o mesmo `c2x-unit-104` para "Q18 · Lote 22" e "Q18 · Lote 23".
Lida pela régua com esse id, a ficha do atendente e a IA do Hades mostram a situação e o contrato de
OUTRO lote do mesmo cliente.

**Conserto.** A F9h resolve a unidade por (empreendimento, quadra, lote) do próprio item, ou corrige
antes o id em `read-model-sync.ts`. Teste com o caso anonimizado (dois lotes, um id). Até lá, a F9h
não entra.

### R5 · média · Custo: a régua lê o banco inteiro, e a F9 multiplica quem a chama

**Evidência.**
- A view é barata. `EXPLAIN ANALYZE` do corpo da 0201 com filtro VOC + VOL: **11,6 ms**, 392 linhas,
  todos os acessos por índice (`hercules_unidades_por_empreendimento`,
  `hercules_propostas_por_unidade`, `hercules_proposta_etapas_por_proposta`, chave única de
  `apolo_source_links`). O custo não está nela.
- Está na régua. `lerSituacaoDasUnidades` lê, a CADA chamada e qualquer que seja o empreendimento
  pedido, todas as propostas vivas do banco (2.633 linhas, **670 kB** de JSON) e todas as linhas-sombra
  (710, **180 kB**), em páginas sequenciais; pedindo "todos", mais **1,2 MB** de unidades.
- Telas com polling que já pagam isso: telão do Prometeu (20 s, `no-store`), telão do espelho (60 s),
  espelho público (60 s). A F9a acrescenta `valor` à leitura (cerca de 4% a mais), aceitável.
- Chamadores NOVOS que a F9 cria:
  - Central do Prometeu (F9g): `/api/prometeu/reservas` é chamada a cada **20 s e sem pausa com a
    aba escondida** (`central-view.tsx:1631`; o timer de 10 s da fila pausa, este não). Com a régua
    dentro: ~0,85 MB a cada 20 s, **~150 MB por hora por aba aberta**, contra 2 consultas pequenas hoje;
  - Venda do Hércules (F9c): a rota já lê a régua (`venda/route.ts:330`); `lerIndicadoresDeVenda`
    leria de novo, e cada troca de janela no Painel refaz as duas;
  - CACÁ com o cliente (F9h): uma régua inteira por mensagem de WhatsApp, meio segundo a um segundo a
    mais na resposta;
  - CACÁ direção (F9i): régua de todos os empreendimentos mais os fatos de todos, com nomes (~2 MB),
    ~4 MB por pergunta;
  - Iris, Athena e Dossiê (F9h): uma régua inteira por ticket aberto.

**Conserto.**
- `lerIndicadoresDeVenda(client, { enterpriseIds, janela, situacoes? })`: quem já leu a régua passa
  o resultado (Venda, Produtos, Resumo).
- Antes da F9h e da F9i, um caminho por unidade: `lerSituacaoDoTerreno(client, unidadeIds)`, que lê
  só as linhas do terreno dessas unidades e as propostas delas. Mesma função pura de decisão, teste de
  igualdade com a leitura inteira na fixture.
- F9g: a Central calcula "Vendas fechadas" numa rota à parte, a cada 60 s, com pausa quando a aba não
  está visível (e o timer de 20 s ganha a mesma pausa).
- `lerFatosDaVenda` recebe a lista de colunas; nomes só para quem lista pessoas.

### R6 · média · GLotes: o relógio novo quebra o incremental prometido

**Evidência.** O contrato publicado (`docs/integrations/glotes-openapi.yaml`, versão 2.0.0 de 25/09)
diz que o `atualizado_em` de `vendas` é "a alteração mais recente entre o contrato, as parcelas de
sinal e de mensalidade dele e a unidade", e o parceiro repassa o maior valor em `alterado_desde`
(comparação `>=`). A F9j troca o relógio por "maior data de fato". Três efeitos:
1. mudança de parcela deixa de mover o relógio, mas `data_sinal`, `valor_sinal` e `qtd_parcelas`
   continuam na linha: o incremental deixa de trazê-las;
2. o relógio novo da carga para em 22/09, abaixo da marca que o GLotes já guardou (até 28/09): a
   linha não volta mais em incremental nenhum;
3. a troca de titular acontece na carteira do C2X e continua mudando `recebimentos`; a venda congelada
   no Panteon manda o titular antigo em `vendas.codigo_cliente`. As duas pontas do mesmo contrato
   divergem para quem está fora da Careli.

LOS e LOU não têm nenhuma venda nativa (320 e 254 propostas, todas da carga): trocar a fonte de
`vendas` não traz dado novo para esse cliente, só risco.

**Conserto.** A F9j fica estreita: `lotes.status` e `bloqueado_para_venda` pela régua (era a
pendência de 21/09) e `vendas.situacao` pela régua, casada por pedido (`origem_c2x_id`). Relógio =
maior entre o relógio de hoje e a data do fato. `codigo_cliente`, parcelas e valores seguem como
estão. Se algum campo mudar de sentido, a versão do contrato sobe e o GLotes é avisado antes.

### R7 · média · O `valor` da carga é o preço de tabela

**Evidência.** `scripts/hercules/importar-fluxo-de-venda.mjs:16-17, 235`: *"O VALOR VEM DA UNIDADE"*,
`u.price as valor`. Medido: das 2.463 propostas vivas da carga (fora do pai), 2.462 têm `valor` igual
a `hercules_unidades.preco_tabela` (a única diferença é de R$ 7.000, em assinatura). É por isso que "na
carga as duas contas batem" (0.5): é o mesmo número, por construção. Hoje o popup do portal calcula o
negociado pela soma das parcelas do C2X e o desconto como tabela menos negociado
(`venda-proposta.ts:18-28, 156-162`). A linha 34 manda o popup ler `hercules_propostas`: toda venda da
carga passa a mostrar desconto zero.

**Conserto.** Na linha 34, "negociado" e "desconto" da carga continuam da soma das parcelas (é conta
financeira, e o próprio arquivo já a trata assim); só a nativa usa `valor` e `condicoes`. O texto de
0.5 e a D4 dizem que o "valor da proposta" da carga é a tabela do dia da carga.

### R8 · média · Leitura do C2X não financeira que sobra, e a varredura não vê

**Evidência.** Dos 59 arquivos que importam `getHadesDbPool` ou `@/lib/guardian/db`, estes leem
venda ou cadastro, não estão em nenhuma fatia e não estão na seção 4:
- `lib/analytics/query-panteon.ts:85`: é o executor do `consultar_panteon` da CACÁ, e vai ao MySQL. A
  F9i cria o builder "panteon" mas não altera o executor.
- `lib/apolo/incorporador/escopo.ts:377-381` (`unidadeNoEscopo`): confere o dono de id numérico
  lendo `enterprise_unities`. É importado por `vendas-resumo.ts` e `venda-proposta.ts`, arquivos da
  F9d. A varredura `sem-c2x-na-venda.varredura.test.ts` lê o TEXTO de cada arquivo: passa verde
  enquanto o C2X continua sendo lido pela importação.
- `lib/prometeu/reservas-evento.ts:176-189` (`quadrasDoEvento`, rota `reserva-touch`): o totem monta
  as quadras pelo `enterprise_unities`. Lote que nascer no Panteon (PAN-124) não aparece no totem.
- `catalogo-empreendimentos.ts` (P1), `incorporador/gestao.ts:136`, `planos-comerciais-c2x.ts` e
  `politica-comercial.ts`, e a GLotes `clientes` e `loteamentos` (a linha 83 diz "Apolo", mas a F9j
  não os altera).

A frase da seção 4, "Lido do C2X, e só isto", não é verdade hoje nem depois da F9.

**Conserto.**
- A seção 4 ganha um segundo bloco: "cadastro que ainda vem do C2X (PAN-124)", com a lista acima.
- `query-panteon.ts` entra na tabela da F9i.
- `unidadeNoEscopo` passa a ler `hercules_unidades.origem_c2x_id` na F9d.
- A varredura segue as importações (grafo transitivo a partir dos arquivos migrados), não só o texto.

### R9 · média · Os números que mudam, medidos

Para ir ao Lucas antes de cada deploy, junto da "Diferença visível" de cada fatia (histórico
inteiro, por proposta, hoje):

| Indicador | Muda assim | Por quê |
|---|---|---|
| Canceladas | RDP 394 → 115 · VDO 385 → 61 · LBR 279 → 56 · CDJ 190 → 51 · PVS 106 → 33 · VOC 105 → 37 · VOL 101 → 34 · PDV 101 → 43 · REP 81 → 17 · LOU 48 → 7 | reserva caída sai (D2, D8) |
| Canceladas do pai | VLO 107 → 0 · LAB 108 → 0 | sombra do pai |
| Em andamento (Panorama) | JDG ~234 → 1 · REP ~118 → 1 · ACP ~109 → 8 · VDO ~96 → 3 · GDN 84 → 0 · VAL ~59 → 2 · VOC ~9 → 4 | disponível sai (D13) |
| Série mensal | 25 propostas que faturaram e depois cancelaram saem do mês em que faturaram; o mês passado muda quando alguém cancela hoje | D7 ("quem cancelou depois não vendeu") |
| Série mensal | 14 faturadas com duas passagens; 8 mudam de mês por valer a última | D7 |
| Vendido do CDJ | 376 (cadastro, retrato do C2X) → ~0 até a F8 | R1 |
| % vendido do BI público | VOL 86 de 95 comerciais (90,5%) → 86 de 141 (61,0%); VOC 86 de 131 (65,6%) → 86 de 157 (54,8%) | denominador sem "não lançadas" (P8); pela regra do BI de 10/08 o numerador também muda (P3) |
| Perfil do comprador | seis blocos do BI público (sexo, idade, estado civil, faixa salarial, profissões, cidades) e o perfil da TelaVendas somem | pergunta 3, padrão (c) até (a) |

Sobre o perfil: o BI público circula com a diretoria e parceiros e só leva agregados. Tirar seis
blocos dele sem aviso é a perda mais visível da F9 para quem está fora do hub. Sugestão para a
pergunta 3: no BI público, (b) como exceção declarada até (a), porque só sai contagem; nas telas
internas, a escolha do Lucas.

### R10 · média · Preço e universo congelados em 01/09 (F9b)

**Evidência.** A F9b tira `u.price` e o universo do C2X do Apolo Empreendimentos e passa a ler
`hercules_unidades`. Medido: em **20 empreendimentos** todas as linhas têm `atualizado_em` de
01/09/2026 (retrato carregado à mão; CDJ, RDP, LOS, LOU, HDP, PDV, VDP, PVS, MDS, EDL, MDB, VBL, MLN,
RPC, SOU, MLC, PRI e os ids 2, 30, 34). Reajuste de tabela ou unidade nova no C2X depois de 01/09 some
do VGV de Disponível e do Total. É coerente com a regra de 21/09 ("o disponível sempre será o que está
no cadastro"), mas é número que muda sem ninguém mexer, e não dá para medir sem o C2X.

**Conserto.** Antes da F9b, o script de conferência (item 5) compara, por empreendimento, o preço e a
contagem de unidades da tela antiga com `hercules_unidades` e lista a diferença como categoria
"cadastro do Panteon ≠ C2X". O Lucas decide se o cadastro é corrigido antes (PAN-124) ou se o número
muda.

### R11 · média · Teste e glebas nos totais "todos"

Complemento de P1 e P9, com o número:
- **Teste.** O TST (id 9001, "ZZ TESTE") tem **6 das 22 nativas** (5 em contrato, 1 em proposta).
  Nativas reais: 16. Uma das "2 nativas em contrato com valor ≠ tabela" da F9b é do TST: o certo é **1
  em contrato e 1 cancelada**. A 0.9 e a F9b corrigem o texto; a marca "fora dos indicadores" de P1
  cobre o TST.
- **Glebas.** Mesma venda (mesmo cliente, quadra e lote) viva em dois empreendimentos: **43 pares**
  (LBR+ACT 29, RDP+RPC 13, SDT+TSC 1), **R$ 13.762.552** de VGV e **15 faturadas** (RDP+RPC 13,
  LBR+ACT 2) contados duas vezes em qualquer soma "todos" (Apolo, CACÁ `cenario_comercial`, Zeus).
  Já é assim no C2X, então não é regressão; mas a F9 é quando se decide. O total "todos" é UMA chamada
  sobre a união (P9) e a categoria aparece na conferência.

### R12 · baixa · Dado pessoal

Conferido e sem problema: a view não tem CPF; 0 entidades com dois ou mais usuários do C2X ligados;
0 entidades com dois CPFs diferentes nas propostas; 0 propostas sem entidade de cliente. A CACÁ já
manda nome de cliente ao modelo hoje (`c2x-analytics.ts`, movimentação); a F9i não amplia isso.

O que sobra:
- **F9c devolve I inteiro** pela `/api/incorporador/venda`, que atende o coordenador na casca do
  portal: `pessoas.compradoresIds` e `porImobiliaria[].entityId` chegam ao navegador, contra o "ids: só
  servidor" do próprio desenho. Toda rota em `/api/incorporador/*` passa por `indicadoresParaOPortal`.
- **Rotas públicas sem allowlist.** `/api/publico/bi/vale-do-ouro` e `/api/publico/prometeu/relatorio`
  não têm login. Se a F9g as alimentar de I ou da view, precisam de um `indicadoresParaOPublico`:
  só contagens e nome de imobiliária, sem id de entidade, sem nome de cliente, sem código de unidade
  ligado a pessoa. Teste de rota que falha se aparecer uuid ou nome de pessoa no corpo.
- **Central do Prometeu por CPF.** A rota de hoje devolve `unidadesPorCpf`. Para ligar a "Venda" da
  régua ao credenciado, a F9g cruza por `prometeu_credenciados.entity_id` (675 de 679 preenchidos) com
  `cliente_entity_id` da view, nunca lendo `cliente_documento` fora dela.

### O que conferi e não é problema

| O que | Medida |
|---|---|
| Custo da view | 11,6 ms com filtro VOC + VOL (392 linhas), só índice; sem filtro, dezenas de ms (o Ataque paridade mediu 61 ms com deslocamento de 4.000) |
| Unidade vendida sem proposta | 0 linhas vivas em `vendida` sem proposta viva: nenhum comprador some por falta de proposta |
| `valor` nulo | 0 propostas vivas sem valor; 0 unidades com proposta viva e tabela nula |
| Nome e entidade | 1.972 clientes e 178 imobiliárias resolvem pela chave única de `apolo_source_links`, sem fusão de pessoa (ver acima) |

---

## ✅ RESPOSTAS DO LUCAS (28/09/2026, ~15:00) — valem sobre o texto acima

1. **"Vendido" = SÓ FATURADO**, em toda tela (Produtos, Venda, portal, BI do Vale do Ouro, CRM,
   Prometeu, CACÁ, GLotes). Proposta, contrato e assinatura são "Em negociação" (a régua do lote).
   A regra do BI do Vale do Ouro de 10/08 (desde a proposta) sai. Consequência: com a F8 atrasada, o
   CDJ e as 415 da carga em assinatura aparecem fora de Vendido até o Faturado andar (R1: a passagem
   em lote leva a DATA DO FATO, nunca o dia em que a F8 rodar).
2. **Vendas que não estão no Panteon: NENHUMA CARGA do C2X.** Lucas: *"o garden tem que está no hub,
   vinculado ao portal da cecilio, ele não precisa estar para os coordenadores da gurgel. Então, no
   Hub ele tem que ser registrado. Não quero fazer nenhuma carga no c2x, o que temos hoje tem que está
   gravando no hub. é o hub que deve alimentar as telas. C2x somente o financeiro"*. Portanto:
   - o que não está no Hub não conta; a saída é o time REGISTRAR no Hub (Cecílio pelo portal dela,
     no caso do Garden), não uma carga;
   - entregar ao Lucas a LISTA das vendas que existem só no C2X depois de 21/09 (R2: 7 faturadas, 6
     pedidos novos, 2 canceladas lá e vivas aqui), para o time registrar;
   - o Garden é visível SÓ no portal da Cecílio; conferir se alguma sessão dos coordenadores da
     Gurgel enxerga o GDN hoje e fechar.
3. **Perfil do comprador (sexo, idade, renda, profissão): vai para a ficha do Apolo; até lá SAI das
   telas e do BI** (a sugestão R9 de manter os agregados no BI público como exceção fica rejeitada).

### ⚠️ CORREÇÃO DA RESPOSTA 2 (Lucas, 28/09/2026, ~15:10) — vale sobre a resposta 2 acima

Eu (Zeus) tinha lido "não quero fazer nenhuma carga no c2x" como "nada entra do C2X, o time
registra à mão". O Lucas corrigiu: *"o que eu quis dizer é que hoje temos alguns dados que estão
sendo lido no c2x, esses dados tem que ser gravados no panteon. eu não preciso inputar os dados que
já conseguimos visualizar no panteon"*, e confirmou por pergunta: **"Isso, gravar automático no
Panteon"**. Portanto:
- o que as telas mostram hoje lendo o C2X (vendas do Garden, vendas feitas no C2X depois de 21/09,
  contratos da D4Sign) é GRAVADO no Panteon automaticamente, por espelho, sem ninguém redigitar;
- o espelho SÓ CRIA o que não existe no Panteon (venda, unidade, contrato), com a origem marcada, e
  NUNCA sobrescreve o que o time já mexeu aqui (o motivo de a carga antiga ter sido encerrada em
  21/09: ela regravava a etapa com a do C2X e desfazia o trabalho);
- depois disso as telas leem só o Panteon; o C2X fica só no financeiro;
- o Garden continua visível só no portal da Cecílio, não para os coordenadores da Gurgel.

---

## Ataque custo-acesso (revisão)

> 28/09/2026 · crítico adversarial (subagente do Zeus). Alvo: o PLANO VIGENTE (V0 a V5, sobretudo a
> F10 e a ordem da V4). Lente: custo do cron (C2X e Supabase), o Garden vazando para sessões da
> Gurgel, os números que mudam antes de cada deploy e se a ordem de subida deixa alguma tela pior no
> meio do caminho. Conferido no código deste worktree e em `bxgukywoxgivlrhjkwjx` (só SELECT; na
> resposta só contagens, papéis e datas, nenhum nome, e-mail ou documento). O C2X não foi consultado.
> Nenhum arquivo de código editado.

| # | Gravidade | Achado | Conserto em uma linha |
|---|---|---|---|
| A1 | **alta** | A trava do Garden como está em V3.9 fecha o portal `mmendes` inteiro e tira o GDN dos admins da Careli; a "conta da Gurgel com o 39" é um admin da Careli, não coordenador | trava só para sessão `tipo = 'comercial'`; `mmendes` só com a resposta da V5.1 |
| A2 | **alta** | A trava em `codigosDaSessao` e `escopoDosIndicadores` não cobre o portal: 26 rotas passam por `idsDaSessao`, 4 por `unidadeNoEscopo`, 3 leem o escopo do cookie direto, e com o C2X fora o cadastro devolve o GDN | cortar onde o escopo nasce (o 39 não entra no cookie), trava na gravação do vínculo, varredura |
| A3 | **alta** | A F10 cria venda em terreno com proposta VIVA DA CARGA de outro pedido: dois donos no lote (hoje 0 unidades com duas vivas) | "dono vivo" = qualquer proposta viva do terreno pela régua; na rodada, andar antes de criar |
| A4 | **alta** | O cron (F10c) não tem o `--exceto GDN` do script: liga a criação do Garden sem a resposta da V5.2 (lote renumerado) | lista de empreendimentos liberados, por id, no código |
| A5 | média | F9d antes da F8: o BI do portal perde as faturadas de nativa redigitada (VOL 5010, 5012, 5016) até uma F8 que ainda não foi desenhada | BI do portal depois da F8, ou categoria à parte |
| A6 | média | F10d três passos depois da F10c: o Panteon fica com as vendas novas do C2X e sem as mudanças das antigas | criar e andar sobem juntos, com um OK só sobre o ensaio |
| A7 | média | A F10 não tem "Diferença visível" por passo | tabela abaixo, medida hoje |
| A8 | baixa | Custo no Supabase 4 vezes o escrito (~2 MB por rodada, ~100 MB/dia, não 25) | RPC de diferença ou leitura só do que falta |
| A9 | baixa | Candidatos eternos: pedido que muda de estágio sem mudar de etapa (4→6, 7→8, 10→11, 2↔9) e candidata de redigitação releem histórico e CPF 48 vezes por dia | comparar pela etapa; impressão digital do contexto |
| A10 | baixa | `FORA_DO_PANTEON` pela sigla do C2X: um renome faz a F10 criar venda nas 83 linhas vivas do LAB | por id |
| A11 | baixa | O valor da venda do GDN sai do preço do C2X, contra o D2 (a Cecílio mantém o preço no Panteon) | produto com `operado_por`: valor = `preco_tabela` da linha |
| A12 | baixa | Frescor: depois da F9d o portal perde o C2X ao vivo, a venda nova chega em até 30 min, o aviso só depois de 2 h | declarar; aviso da F10 em 45 min |
| A13 | baixa | `:02/:32` cai junto de outros dois leitores do C2X | medir na prova da F10c |

### A1 · alta · A trava do Garden fecha o `mmendes` e não acha coordenador nenhum

**Evidência.** Quem tem o 39 (GDN) na sessão hoje, por SELECT em `apolo_incorporador_empreendimentos`,
`apolo_incorporador_usuario_empreendimentos`, `apolo_incorporador_usuarios` e `hub_users` (só
contagens e papéis):

| Portal | Como o 39 entra | Contas ativas com o 39 | O que é |
|---|---|---|---|
| `cecilio-rocha` (incorporador; portal com 37, 39, 41) | vínculo do portal; nenhuma conta tem vínculo próprio | 10 | o operador: `hercules_empreendimentos.operado_por` do GDN é este incorporador |
| `mmendes` (incorporador) | vínculo do portal, e **o portal só tem o 39** | 2 (último login 23/09) | não é o operador; `apps/hub/public/garden/` guarda `logo-mmendes.png` ao lado das logos do Garden e da Cecílio |
| `gurgel` (comercial) | vínculo próprio da conta | 1 | **conta de domínio `@careli.adm.br`, admin no Hub, com 37 vínculos** (todos os empreendimentos). As outras 5 contas ativas da Gurgel não têm o 39, e 4 delas nem existem no Hub |

- V3.9 manda tirar do escopo "todo produto com `operado_por` cuja sessão não seja do incorporador
  operador", e V5.1 põe "Gurgel e `mmendes` saem" como padrão. No `mmendes` o escopo fica VAZIO:
  escopo vazio é recusado no login (`escopo-do-usuario.ts:13-17`, 403 "Seu acesso ainda não tem
  empreendimento liberado"), a revalidação apaga o cookie (`app/api/incorporador/sessao/route.ts`,
  GET: `escopoFresco.enterpriseIds.length === 0` → cookie com `maxAge: 0`) e `lerSessaoIncorporador`
  recusa sessão sem empreendimento (`sessao.ts:123-127`). O portal inteiro sai do ar para as 2 contas
  no deploy da F10e, antes de o Lucas responder a V5.1.
- A "sessão da Gurgel com o 39" de V2.3 é de um admin da Careli. Não existe "Hércules interno" com
  papel do Hub: o Hércules é o `/comercial/gurgel` (`app/comercial/[slug]`), e o cookie do portal não
  carrega papel do Hub (`SessaoIncorporador`, `sessao.ts:31-50`). A regra "a do Hércules interno só
  com papel admin da Careli" não tem como ser escrita sem campo novo, e o pedido operacional "tirar o
  39 do vínculo do usuário ativo da `gurgel`" tira o Garden de um admin, não fecha vazamento. **Hoje
  nenhum coordenador da Gurgel vê o GDN.** O risco é o de amanhã: a tela de gestão grava o vínculo
  que a pessoa marcar (A2).

**Conserto.**
- Padrão sem pergunta: a trava vale só para sessão `tipo = 'comercial'`, que é o pedido do Lucas
  ("ele não precisa estar para os coordenadores da gurgel"). Portal de incorporador fica como está até
  a V5.1.
- V5.1 reescrita com o fato: *"o `mmendes` só tem o Garden; tirar o GDN dele fecha o portal das 2
  contas. Mantém?"* e *"os 2 admins da Careli na Gurgel (um com o 39) veem o Garden pelo Hércules, ou
  só pela conta deles no portal da Cecílio?"* (6 das 10 contas ativas da Cecílio também existem no
  Hub).
- Nenhuma trava pode deixar escopo vazio calado: teste "conta cujo único id é operado por outro
  incorporador" → a tela de gestão avisa antes de salvar; o deploy nunca derruba login.

### A2 · alta · A trava onde o plano a põe não cobre o portal

**Evidência.** V3.9 põe a trava em `escopoDosIndicadores` (que só nasce na F9a, passo 6 da V4) e em
`codigosDaSessao`. Das 79 rotas de `app/api/incorporador`:
- 18 chamam `codigosDaSessao`; **26 chamam `idsDaSessao`**, que não passa por ela, entre elas
  `produtos/painel/route.ts:72` (lê a régua do GDN para o card de Produtos) e as da ficha por
  `propriosDoPortal`;
- 4 rotas e 10 libs conferem unidade por `unidadeNoEscopo` → `alcanceDaSessao(catalogo,
  empreendimentosPermitidos(sessao))` (`escopo.ts:314-333`): a unidade do GDN abre para quem tem o 39;
- 3 rotas leem o escopo do cookie sem passar pelos tradutores: `produtos/route.ts:101`,
  `masterplan/route.ts:173`, `contratos/route.ts:115`; e `lib/hercules/expandir-id-do-painel.ts:130`
  evita `codigosDaSessao` de propósito;
- `lidosDoPanteon` diz em comentário que "a Gurgel olhando o Garden lê do mesmo lugar que a Cecílio"
  (`proprios-do-portal.ts:104-106`);
- com o C2X fora (catálogo vazio), `linhasSoDoPanteon` responde pelo cadastro por todos os ids da
  sessão (`escopo.ts:157-161`): o GDN volta pelo cadastro mesmo com a trava no caminho do catálogo. A
  F9 (P1) quer tirar o catálogo, e aí todo o escopo passa por esse caminho;
- "F10e junto da F10b, na mesma versão" (V3.11 item 5): a F10b é migration e `--gravar` de script, a
  F10e é deploy. Sem ordem escrita, o script grava antes de a trava estar no ar.

**Conserto.**
- A trava mora onde o escopo nasce: `escopoDaConta` (`lib/apolo/incorporador/dados.ts`) lê o
  `operado_por` do cadastro, e `escopoDoUsuario` (puro) recebe `operados: Map<enterpriseId,
  incorporadorId>` e tira da sessão `tipo = 'comercial'` todo id operado (A1). O cookie deixa de
  carregar o 39; como o GET da sessão roda a cada carga de tela e reassina o cookie, o efeito não
  espera o TTL de 12 h. Teste no puro e no GET.
- Trava na gravação: `gravarVinculosDaConta` (`gestao.ts:733`) recusa produto operado em conta de
  portal comercial, com a frase na tela.
- Varredura: `sessao.enterpriseIds` só em `sessao.ts`, `escopo.ts` e `escopo-do-usuario.ts`; as 3 rotas
  acima passam por `empreendimentosPermitidos` já recortado.
- `escopoDosIndicadores` (P1) herda o mesmo recorte da sessão, sem regra própria.
- Ordem escrita: deploy da trava → prova (GET da sessão sem o 39 para quem o Lucas decidir; Produtos
  sem o card GDN) → só então o `--gravar` da F10b.

### A3 · alta · Criar venda com a carga viva de outro pedido no terreno

**Evidência.** V3.3 cria quando não há `bloqueado_em`, nativa viva nem reserva viva, e a guarda da RPC
repete a lista ("sem nativa viva, sem reserva viva e sem `bloqueado_em`"). Proposta viva DA CARGA de
outro pedido no mesmo terreno não é conflito. Acontece quando:
- o C2X cancelou o pedido antigo e revendeu o lote depois de 22/09: o antigo segue vivo aqui até a
  F10d andar (passo 7 da V4, três passos depois da F10c) e para sempre se for "mexido" (V3.4 não o
  anda);
- R2 já mediu 2 cancelados no C2X que seguem vivos aqui (JDG, RVP); o RVP é mexido e nunca anda.

Hoje há **0 unidades fora do pai com duas propostas vivas** (SELECT em `hercules_propostas` ×
`hercules_unidades`): "um dono por lote" (memória `project_situacao_unica_e_um_dono_por_lote`) vale
hoje, e a F10 é a primeira escrita automática que pode quebrá-la. A régua pega a mais recente
(`situacaoDoTerreno`, `situacao-da-unidade.ts:80-120`), a faixa da Venda conta as duas e a trava do
lote vê dois donos.
E V3.10 diz outra coisa ("recusa se há dono vivo na unidade ou no par por `espelho_de`"): se "dono
vivo" incluir a carga pendurada no pai, toda venda nova do VOC/VOL/VOR com reserva velha na sombra do
VLO (135 reservadas, 0.10) vira `conflitoDeDono`.

**Conserto.** Uma definição só, no TS e na RPC: dono vivo = proposta viva de qualquer origem no terreno
(união de `terreno.ts`), com a mesma exclusão da régua (carga pendurada na linha-sombra do pai não
conta), mais reserva viva e `bloqueado_em`. Na rodada, "andar" roda antes de "criar", para a revenda do
lote cancelado no C2X entrar na mesma rodada em que o antigo cai. Casos em `decidir.test.ts`: revenda
com a carga antiga viva não cria; revenda depois de a carga andar para cancelado cria; reserva velha no
pai não bloqueia o filho. Na prova de cada passo, o SELECT de "unidade com duas vivas" = 0.

### A4 · alta · O cron liga o Garden sem o filtro do script

**Evidência.** V3.6 e V5.2 seguram o `--gravar` do GDN até o Lucas ver a conferência de quadra e lote
(Garden renumerado), com `--so GDN` e `--exceto GDN` só no script (V3.11). O cron da F10c só tem
`CRIAR_VENDAS`, que vale para todo empreendimento. Se o `--gravar` rodar `--exceto GDN` e o cron for
ligado antes da resposta da V5.2, a primeira rodada cria o Garden inteiro sem a conferência, e venda
pendurada no lote errado aparece na ficha, no masterplan e no espelho da Cecílio.

**Conserto.** `CRIAR_EM: ReadonlySet<string>` com ids do C2X (nunca sigla) no código, lido pelo cron e
pelo script; o 39 entra num deploy próprio, depois da V5.2. O relatório conta `foraDaLiberacao` por
empreendimento.

### A5 · média · F9d antes da F8 piora o BI do portal

**Evidência.** A V4 põe a F9d (portal) no passo 9 e a F8 no passo 10, e a F8 está "DESENHAR DEPOIS DA
F6" no plano da fonte única (seção 1): o intervalo não tem fim marcado. Hoje o BI do portal
(`vendas-bi.ts`, linhas 24 e 25 da seção 1) lê o histórico do C2X ao vivo e conta como faturadas as
redigitadas que o C2X faturou (VOL 5010, 5012, 5016, a `nativaAtrasada` de V3.4). Depois da F9d elas
saem de Faturadas, do gráfico e do "Proposta → venda" do portal `valedoouro` (6 contas ativas), e toda
nativa nova faturada no C2X some do mesmo jeito, até a F8 existir. É o argumento que a própria V4 usa
para pôr a F9g depois da F8. (O "Vendido" pela régua já mostra essas nativas em negociação hoje; piora
só o bloco do BI.)

**Conserto.** A F9d sobe em duas: estoque, mapa, pipeline e imobiliárias no passo 9; o BI (Faturadas,
Canceladas, %, gráfico, tempo médio) depois da F8. Ou, se o Lucas preferir não esperar, a categoria
"faturada no financeiro, aguardando o Panteon" ao lado de Faturadas, contada pela `nativaAtrasada` do
relatório da F10.

### A6 · média · Criar sem andar deixa o Panteon com metade do C2X

**Evidência.** V4: F10b e F10c no passo 4; F10d no passo 7, depois da F4 e da F9a. Nesse intervalo o
Panteon ganha toda venda nova do C2X e não as mudanças das antigas: ACP 3 e VOC 1 faturadas no C2X
seguem em assinatura aqui; o JDG cancelado no C2X segue segurando o lote; a revenda desses lotes é
dono duplo (A3) ou `conflitoDeDono` (com o conserto do A3). O motivo da espera, o Lucas ver quem anda
e para qual mês, já é saída do ensaio F10a (V3.11 item 1 imprime `andariam` por etapa e MÊS).

**Conserto.** Um OK sobre o ensaio F10a cobre criar, ligar e andar; a F10b grava os três (`--gravar
--ligar --andar`) e a F10c liga as três chaves juntas. Se o Lucas quiser separar, a F10d vem logo
depois da F10c, antes da F4, e não depois da F9a.

### A7 · média · Os números que mudam em cada passo da F10

Para o Lucas antes de cada deploy, junto do relatório do ensaio. Medido hoje (SELECT); "N" é o que só
o ensaio F10a dá (nenhum espelho do C2X no Supabase vê o Garden).

| Passo | Tela e quem vê | Hoje | Depois | Por quê |
|---|---|---|---|---|
| F10b (GDN) | Produtos e ficha do GDN, portal `cecilio-rocha` (10 contas) | Total 404: Disponível 84 (R$ 36,09 mi de tabela); Bloqueado 320 (155 acima de R$ 1, R$ 51,83 mi; 165 a R$ 1 ou menos) | ~140 a 160 do Bloqueado passam a Vendido, Negociação ou Reservado; Bloqueado cai para ~165 mais as 2 com `bloqueado_em` | a proposta da própria linha vence o bloqueio do cadastro |
| F10b (GDN) | Venda do Hércules, GDN: faixa, Panorama, Canceladas, Conversão | tudo 0 | N; as desfeitas históricas entram e, até a F9c, Canceladas conta reserva caída (0.2) e a Conversão sai baixa | pedido terminal também é criado (V3.3) |
| F10b (GDN) | Ficha › Imobiliárias do GDN (`imobiliarias-do-produto.ts:133` já lê o Panteon para o GDN) | 0 | N | idem |
| F10b (GDN) | Espelho, telão e masterplan do GDN | cores de bloqueado e disponível | cores de venda | régua |
| F10b (GDN) | Porta "comprador da carteira compra sem CAD" (`lib/hercules/compra-ativa.ts`, v1.385.0) | 0 no GDN | titulares e co-compradores das faturadas do GDN compram de novo no GDN sem CAD | faturado no Panteon é contrato ativo |
| F10b (ligar) | Têmis › análise do trabalho (`analise-do-trabalho.ts:181`) das 8 nativas redigitadas | sem carteira ("nativa") | parcelas do C2X | `carteira-da-venda.ts:193-234` com `coalesce(origem_c2x_id, c2x_pedido_id)` |
| F10d | ACP (portal `aldeiadacachoeira` e 4 coordenadores) e VOC (Cecílio) | 3 e 1 em assinatura | +3 e +1 Faturadas no mês do fato; os 4 titulares entram na porta sem CAD | o C2X faturou |
| F10d | JDG (portal `jardimdasgerais` e 5 coordenadores) | 1 em assinatura, lote ocupado | cancelada; o lote volta a Disponível e fica vendável no Hércules | o C2X cancelou. É lote solto sem ninguém clicar no Panteon: o Lucas precisa ver |
| trava (A1, A2) | Hércules da Gurgel, admin com o 39 | card GDN em Produtos; "todos" com +404 unidades e +R$ 87,9 mi de tabela acima de R$ 1 | some, se o Lucas decidir | trava |
| trava como escrita em V3.9 | portal `mmendes` | 2 contas entram | login recusado | escopo vazio (A1) |

### A8 · baixa · O custo no Supabase é 4 vezes o escrito

**Evidência.** V3.8 estima ~0,5 MB por rodada e ~25 MB/dia. Medido em JSON (o que o PostgREST
devolve): as chaves de `hercules_propostas` pedidas em V3.8 dão **1,16 MB** (4.946 linhas, ainda sem
`c2x_pedido_id`), e `hercules_unidades` com `id, origem_c2x_id, enterprise_id, espelho_de, bloqueado_em`
dá **0,72 MB** (0,99 MB com quadra, lote e situação para o terreno): **~2 MB por rodada, 11 páginas
sequenciais pelo teto de 1.000, ~100 MB/dia, ~3 GB/mês.** Não assusta, mas cresce com cada venda e
roda de madrugada sem ninguém olhando.

**Conserto.** Uma RPC de leitura `hercules_espelho_o_que_falta(p_pedidos jsonb)` (security invoker, só
service_role, grants conferidos em `role_routine_grants`): recebe a lista leve do C2X (~5 mil trios
`ar_id, etapa_c2x, unidade_c2x_id`, ~100 KB) e devolve só os pedidos sem proposta e os que mudaram de
etapa (dezenas de linhas). Uma ida, sem paginação; unidades e terreno só dos pedidos que voltam. O
relatório mantém `lidosPorTabela`.

### A9 · baixa · Candidatos eternos: histórico e CPF relidos 48 vezes por dia

**Evidência.**
- O que dispara trabalho é "`etapa_c2x` diferente da gravada" (V3.1). Estágios diferentes com a mesma
  etapa (`ETAPA` em `scripts/hercules/importar-fluxo-de-venda.mjs:144`: 4 e 6 faturado, 7 e 8
  cancelado, 10 e 11 distrato, 2 e 9 proposta) "não mudam nada" (V3.2, V3.7), e a F10 não grava o
  `etapa_c2x` novo. Hoje as 2.037 faturadas da carga estão todas em `etapa_c2x = 4` (SELECT): cada
  uma que o C2X levar a 6 vira candidata para sempre e relê histórico (consulta 3) e cards toda
  rodada. O mesmo vale para `recuos`, `divergentes` e `conflitoDeDono`.
- `candidatas` de redigitação são "reavaliadas toda rodada" (V3.3): a consulta 4 (CPF do comprador no
  C2X) roda 48 vezes por dia para o mesmo pedido sem nada ter mudado.

**Conserto.**
- A comparação é pela etapa do Panteon (`ETAPA[etapa_c2x]`), não pelo número; ou a RPC grava só
  `etapa_c2x` e `atualizado_em_c2x` quando a etapa é a mesma, com a mesma guarda de "mexida".
- `hercules_espelho_c2x.relatorio` guarda, por candidata, uma impressão digital do contexto (hash dos
  ids e etapas das propostas do terreno e do estágio do pedido, sem documento); a consulta 4 só roda de
  novo quando ela muda.
- Teto de candidatos reavaliados por rodada, como o `tetoDeListas` da F3.

### A10 · baixa · `FORA_DO_PANTEON` pela sigla

**Evidência.** A lista vem da carga por SIGLA (`importar-fluxo-de-venda.mjs:91`: ADT, LAB, SDT, TSC,
VLO), e a lista leve traz `e.code` do C2X (V3.1). A memória `reference_c2x_pela_sigla_quebra_no_renome`
e o próprio `escopo.ts:152-156` já trocaram essa trava para id. O LAB (31) tem 83 linhas vivas
bloqueadas fora da sombra (P1): um renome no C2X faz a F10 criar venda nelas, e o LAB volta a ser
contado junto com as glebas.

**Conserto.** Por id: `EXCLUDED_ENTERPRISE_IDS` (2, 31, 34), o pai pelo `pai_id` do cadastro e o id do
ADT; teste com a sigla trocada.

### A11 · baixa · O valor da venda do Garden sai do C2X

**Evidência.** A F10 grava `valor` = preço da unidade no C2X (V3.1, como a carga); o GDN é mantido pela
Cecílio no Panteon desde 16/09 (D2, R10), e a F9b passa o VGV da unidade vendida para o valor da
proposta (D4). Hoje só 2 linhas do GDN foram editadas depois de 16/09 (SELECT), então a diferença é
pequena, mas cresce a cada correção dela e contraria o "lá a diferença é esperada e não se corrige
pelo C2X" do R10.

**Conserto.** Para produto com `operado_por`, a montagem grava `valor = hercules_unidades.preco_tabela`
da linha casada e anota no relatório quantas divergem do C2X.

### A12 · baixa · Frescor do portal depois da F9d

**Evidência.** Hoje o BI e a movimentação do portal leem o C2X ao vivo. Depois da F9d a venda feita no
C2X chega pela F10 a cada 30 min (e o contrato da D4Sign 5 min depois), e o aviso de fonte parada só
aparece depois de 2 h (V3.8). No Garden, onde o time da Cecílio vende pelo C2X, a venda recém-feita
some da tela por até meia hora, e uma rodada perdida passa sem aviso.

**Conserto.** Declarar na "Diferença visível" da F9d ("atualiza a cada 30 min", com `lidoEm` na tela);
aviso de fonte parada da F10 em 45 min (uma rodada perdida), não 2 h.

### A13 · baixa · O horário do cron

**Evidência.** `vercel.json`: o sync do Hades (`*/15`) e o incremental do Apolo (`*/5`, até 300 s,
trava de 10 min) caem em :00 e :30; a F10 fica em :02/:32 e a F3 em :07/:37. Cada função abre o seu
pool de até 5 conexões (`lib/guardian/db.ts:109`) no mesmo MySQL. A lista leve é barata; o risco é só
fila no RDS nos minutos cheios.

**Conserto.** Nada agora. Na prova da F10c, anotar a duração das rodadas entre :30 e :40 numa manhã;
se passar de 30 s, mover a F10 para :12/:42 e a F3 para :17/:47 (com OK).

### O que conferi e não é problema

| O que | Medida |
|---|---|
| A F3 mexer na venda do Garden criada pela F10 | `aplicarEnvelopeNaVenda` só move venda NATIVA (fonte única, seção 7), e envelope ligado à proposta da carga não a torna "mexida" (V3.4) |
| Entidade do comprador do Garden | o sync completo do Apolo (`20 */6`, `syncApoloFromC2x`, `server.ts:512-554`) lê todos os `users` sem filtro de empreendimento; o incremental pega o cliente do pedido novo em 5 min. `semEntidade` fecha sozinho |
| O 39 entrando por grupo | 0 vínculos `group:` em portal ou conta; o 39 só entra por id |
| Página pública do Garden | `public/garden/interno-3634d57f.html` é estática e não chama API: a F10 não muda o que ela mostra |
| Custo no C2X | a lista leve é um SELECT de ~5 mil linhas a cada 30 min, menor que a leitura de `audits` que o incremental do Apolo já faz a cada 5 min |
| Régua mais cara com o Garden | ~150 vivas a mais sobre 2.633 (~6%) na leitura que a régua já faz (R5) |

---

## Ataque duplicidade (revisão)

> 28/09/2026 · crítico adversarial (subagente do Zeus). Alvo: a F10 (V3) do PLANO VIGENTE. Lente:
> duplicidade e sobrescrita. A F10 pode criar uma SEGUNDA venda para o mesmo lote, sobrescrever o que
> o time fez no Panteon (etapa, cancelamento, card da Têmis, reserva do Hércules) ou furar a trava de
> um dono por terreno (0176, `lib/hercules/criar-reserva.ts`, `trava-do-lote.ts`,
> `situacaoDoTerreno`)? Conferido no código deste worktree e em `bxgukywoxgivlrhjkwjx` (só SELECT;
> documento de comprador só comparado dentro do SQL, nunca devolvido; a união do terreno refeita em
> SQL com a regra de `terreno.ts`). O C2X não foi consultado: o que ele faz foi medido pela carga
> (`hercules_propostas` de origem `c2x`, pedidos até o 5008, criados até 16/09 21:55) e pelo espelho
> `apolo_commercial_links`. Nenhum arquivo de código editado. O A3 e o A6 do "Ataque custo-acesso"
> (carga viva de outro pedido no terreno; criar sem andar) valem e não se repetem: os achados abaixo
> são o que eles não cobrem.

**Resposta curta.** Hoje o invariante vale: **0 linha de `hercules_unidades` com duas propostas vivas,
de qualquer origem (pai incluído), e 0 terreno com duas vivas fora da sombra do pai.** A F10 é o
primeiro escritor automático que pode quebrá-lo, e o desenho tem três buracos que o quebram mesmo com o
A3 consertado: a guarda não enxerga todos os donos que a trava enxerga (D1), confere e grava sem fechar
a corrida com a porta da reserva (D2) e não lembra o que já decidiu, então ressuscita venda que o time
encerrou (D3). E dois efeitos contradizem o próprio plano: a ligação da redigitação escolhe a venda
errada num caso medido (D4) e o "cancelado" que a F10 anda não solta o lote (D6).

| # | Gravidade | Achado | Conserto em uma linha |
|---|---|---|---|
| D1 | **crítica** | A guarda de criação ignora 3 tipos de dono que a trava conhece; nenhum índice do banco segura venda de origem `c2x` | a guarda é `outrosDonosDoLote` + irmã com cadastro de dono; índice "uma viva por linha" para toda origem |
| D2 | **crítica** | Conferir e gravar na mesma transação não fecha a corrida com `criar-reserva.ts`: os dois ficam vivos | gravar, commitar, reler os donos e desfazer a própria linha (o padrão da porta da reserva) |
| D3 | **alta** | Decisão sem memória: candidata e conflito viram criação no dia em que a nativa cai, a reserva vence ou o bloqueio sai | tabela de decisões por pedido; não cria o que o Panteon tocou depois de o pedido nascer |
| D4 | **alta** | A ligação da redigitação escolhe a nativa CANCELADA no VOC0306 (medido) e não se religa | para pedido, a nativa VIVA do mesmo comprador vence; só pedido em proposta ou adiante liga |
| D5 | **alta** | O C2X muda o pedido de lote (7 medidos) e a F10 só olha "já existe": o lote novo fica livre aqui | `trocouDeLote` como alarme; o terreno de destino entra em conflito |
| D6 | **alta** | O cancelado que a F10 anda não solta o lote: 2.454 das 2.463 vivas da carga estão em linha `vendida` | chamar `soltarLoteDaVendaDesfeita` depois de andar para cancelado ou distrato |
| D7 | média | A F10 cria reserva do C2X (estágio 1) como venda viva sem validade, e o espelho que mediu "cria 0" não vê reserva | pedido vivo em estágio 1 não cria; lista `reservaSoNoC2x` |
| D8 | média | Garden: a carga prova 0 pedido no GDN até 16/09; o "140 a 160" não se sustenta, e o caminho que vier depois duplica | ensaio do GDN antes de tudo; qualquer carga do Garden pela mesma RPC e chave |
| D9 | média | Troca de comprador no mesmo pedido (cessão no C2X): a F10 anda a venda com o titular antigo | `ar.client_id` na lista leve; diferente = não anda, `compradorMudou` |
| D10 | média | Mesma venda em outra gleba fora do terreno da régua (LBR+ACT 29, RDP+RPC 13): a F10 cria as duas | `mesmaVendaEmOutraGleba` não cria |
| D11 | média | Reserva do C2X no PAI com outro comprador fica invisível (1 hoje, o padrão do VLO0710) | alarme `noPaiComOutroComprador`, sem criar nada |
| D12 | média | O rollback `delete ... criado_por = 'espelho-c2x'` apaga passagens e solta card, envelope, documento e conversa do time | rollback só do que ninguém tocou, contado antes |
| D13 | baixa | "Mexida" depende de cada escritor carimbar; "reserva viva" sem definição de validade | sétimo critério por `atualizado_em`; viva = `ativa`/`proposta`, sem olhar `validade_em` |
| D14 | baixa | O mesmo pedido pode morar em `origem_c2x_id` de uma linha e em `c2x_pedido_id` de outra | índice único sobre `coalesce(origem_c2x_id, c2x_pedido_id)` + CHECK |

### D1 · crítica · A guarda de criação não conhece todos os donos

**Evidência.**
- A guarda da V3.3 e da RPC (V3.10) é "`bloqueado_em` na unidade e no par por `espelho_de`, nativa
  viva, `hercules_reservas` viva", com as glebas irmãs "no TS logo antes". A trava do lote, que é a
  regra do Lucas de 18/09, conta mais donos (`trava-do-lote.ts:27-35`, `outrosDonosDoLote` em
  `:72-182`), e três deles ficam de fora mesmo com o A3 (proposta viva de qualquer origem):
  - **cupom do salão sem reserva do Hércules** (`prometeu_reservas.situacao = 'reservada'`): **6
    hoje** (JDG1006, JDG1010, JDG1013, JDG1110, JDG3204, JDG3205), todos em linha com venda viva da
    carga. Quando a F10 andar essa venda para cancelado e o C2X revender o lote, a guarda cria a venda
    nova por cima do cupom;
  - **irmã com cadastro de dono** (`vendida`/`reservada` sem processo, a regra de
    `situacao-da-unidade.ts:628-643`);
  - **linha bloqueada sem carimbo com a irmã vendida**: **4 terrenos** têm hoje duas linhas vivas (VOC
    e VOR), todos com uma linha `bloqueada` SEM `bloqueado_em` e a irmã com venda viva. Pedido novo na
    linha bloqueada passa pela guarda (sem carimbo, sem nativa, sem reserva) e a régua dá à linha a
    proposta dela (`situacao-da-unidade.ts:90-106`): dois donos no mesmo chão. No banco inteiro são
    **1.195 linhas vivas `bloqueada`, só 97 com `bloqueado_em`**.
- Nenhum índice segura a F10. `hercules_propostas_uma_viva_por_unidade` (0131) cobre só
  `origem = 'panteon'` e só de `reservado` a `assinatura`, e o comentário da 0131 diz por quê: *"a
  carga do C2X entra em lotes e um 23505 mataria o lote inteiro"*. A F10 grava linha a linha por RPC:
  o motivo não vale para ela. A 0176 só vê `hercules_reservas`.

**Conserto.**
- A guarda do TS é `outrosDonosDoLote(client, situacoes, linhaId, {})` (a mesma função, leitura
  fresca), mais a irmã com cadastro `vendida`/`reservada` e a linha `bloqueada` com irmã viva. A RPC
  repete em SQL o que dá para repetir (proposta viva de qualquer origem fora da carga no pai, reserva
  `ativa`/`proposta`, cupom não absorvido) sobre a lista de linhas do terreno que o TS passa
  (`p_linhas uuid[]`, da união de `terreno.ts`), e não só sobre a unidade e o par.
- Índice novo na 0202: `create unique index hercules_propostas_uma_viva_por_linha on
  hercules_propostas (unidade_id) where etapa in ('reservado','proposta','contrato','assinatura',
  'faturado')`, toda origem. **Medido: 0 linha com duas vivas hoje, pai incluído**; nasce sem conflito.
  Não segura o terreno (duas linhas), mas segura a revenda na mesma linha e a F10 contra ela mesma; o
  23505 vira `conflitoDeDono`. Conferir antes que nenhum fluxo do Hércules precise de duas vivas na
  mesma linha por um instante (a correção do VOC0306 cancelou a primeira antes de criar a segunda:
  medido, D4).
- Casos em `decidir.test.ts`: cupom do salão bloqueia; irmã `vendida` bloqueia; pedido na linha
  bloqueada sem carimbo com a irmã viva não cria; os 4 terrenos de duas glebas como fixture anonimizada.

### D2 · crítica · A corrida com a porta da reserva continua aberta

**Evidência.** V3.3: a RPC "confere de novo, na mesma transação" e grava. Em `READ COMMITTED` (o padrão
do Postgres) isso não serializa contra quem não pega a mesma trava, e `criar-reserva.ts` não pega
nenhuma que a F10 pegue (o índice da 0176 é de `hercules_reservas`). A ordem que deixa dois donos:
1. a RPC da F10 confere: nenhuma reserva viva no terreno;
2. o coordenador reserva: o passo 2 (`criar-reserva.ts:98-104`) não vê a venda (a transação da F10 não
   commitou) e o INSERT da reserva commita;
3. o passo 4 (`criar-reserva.ts:160-187`) relê o terreno e ainda não vê a venda;
4. a RPC grava e commita.

A porta da reserva só fecha a corrida porque OS DOIS lados gravam antes de reler
(`trava-do-lote.ts:24`: *"no pior caso os DOIS desistem"*). A RPC da F10 relê antes de gravar.

**Conserto.** O padrão da porta da reserva: a RPC grava, commita e devolve o id; o orquestrador chama
`outrosDonosDoLote` com leitura nova; se aparecer outro dono, desfaz a PRÓPRIA linha. Como a F10 e a
reserva gravam antes de reler, pelo menos uma vê a outra. O desfazer é um `delete` só da linha que a
mesma rodada acabou de criar (`id` devolvido, `criado_por = 'espelho-c2x'`, sem `etapa_por`, sem card,
sem passagem sem origem), numa RPC própria com essas guardas: exceção escrita ao "nunca apaga", porque
marcar `cancelado` deixaria uma proposta cancelada falsa nos indicadores (D8 do desenho). Falha no
desfazer grita no log com os ids, como `criar-reserva.ts:177-185`. Teste com as quatro intercalações:
em nenhuma sobram dois donos. (Alternativa mais cara: as duas portas pegam `pg_advisory_xact_lock` da
chave do terreno, o que obriga a reserva a virar RPC.)

### D3 · alta · Sem memória, a F10 ressuscita venda que o time encerrou

**Evidência.** A V3.1 escolhe de propósito "sem estado": toda rodada decide de novo pela lista leve.
Mas `candidatas` e `conflitoDeDono` só valem ENQUANTO o dono do Panteon está vivo (a linha da V3.3 é
"nativa viva que NÃO casa"). No dia em que:
- o time cancela a nativa (a redigitação no C2X é acertada depois, à mão; a carga já registrava isso em
  `importar-fluxo-de-venda.mjs:498-503`),
- a reserva do Hércules vence ou é cancelada,
- ou alguém tira o `bloqueado_em`,

o mesmo pedido cai em "nenhum dos anteriores" e é CRIADO: o lote que o time soltou volta ocupado por
uma cópia da venda que ele desfez, e a porta da reserva passa a recusar a revenda ("Este lote já tem
dono"). Basta o casamento falhar por documento (titular do C2X é o co-comprador, CNPJ contra CPF, CPF
digitado errado) para a redigitação da própria venda cancelada ser esse caso. Medido hoje: 1 das 22
nativas tem co-comprador; o documento só foi conferível em 3 dos 8 pedidos que o espelho vê (V3.5); 1
terreno tem nativa cancelada e nenhum dono vivo; 2 têm reserva do Hércules cancelada e nenhum dono. As
9 da carga que o Panteon encerrou (`cancelada_em`) não correm esse risco: o pedido delas já existe aqui.

**Conserto.**
- Tabela `hercules_espelho_c2x_pedidos (ar_id bigint primary key, decisao text, motivo text,
  primeira_vez timestamptz, ultima_vez timestamptz)`, só ids e códigos, RLS ligada sem política.
- Regra: só é criado sozinho o pedido que era criável na PRIMEIRA vez que foi visto. O que já foi
  `candidata`, `conflitoDeDono`, `noPai`, bloqueado ou `trocouDeLote` (D5) não vira criação sem um POST
  com `so` e motivo, registrado.
- Na primeira rodada (sem memória), a regra do fato mais novo: não cria se o Panteon registrou fato no
  terreno DEPOIS de `ar.created_at` (nativa criada ou cancelada, reserva criada ou cancelada,
  `bloqueado_em`, `cancelada_em` da carga): `obsoletoPeloPanteon`, na lista do Zeus.
- Casos: nativa cancelada depois do pedido, com comprador diferente, não cria; reserva vencida não
  libera pedido antigo; desbloqueio não libera pedido que nasceu com o lote bloqueado.

### D4 · alta · A redigitação liga à venda errada, e para sempre

**Evidência.** A V3.5 reusa a regra 3 do envelope: a nativa "não cancelada no instante em que o pedido
foi criado" e "criada antes do pedido". Para envelope faz sentido (o contrato é daquele instante); para
pedido, que é a venda continuando no financeiro, não. Medido:
- **VOC0306**: nativa 1 criada em 16/09 e cancelada em 21/09; nativa 2 criada em 21/09, viva, **mesmo
  comprador** (comparado no SQL). A redigitação do VOC0306 é de 18/09 (memória
  `reference_venda_redigitada_no_c2x_para_boleto`, pedidos 5009 a 5021; o ensaio confirma a data). A
  regra liga o pedido à nativa 1, CANCELADA, e a viva fica sem pedido. Efeitos: a F8 não acha a
  "entrada paga" da nativa viva (V3.4 manda achar pelo `c2x_pedido_id`), a carteira da venda
  (`carteira-da-venda.ts` com o `coalesce`) mostra as parcelas na cancelada, e a transição do R3 ("viva
  no Panteon OU parcela aberta no C2X") vira divergência. "Uma vez ligada, não se religa sozinha."
- **Dois pedidos para a mesma nativa** (a reserva digitada no filho em vez do pai, ou pedido duplicado
  e depois cancelado no C2X): o de menor id é lido primeiro e ganha, mesmo em estágio 1 e com 0
  parcelas.
- **Ligar falhou porque a nativa já tem pedido**: a RPC devolve `false` (`c2x_pedido_id is null` na
  escrita), e a V3.3 não diz para onde o pedido vai. Se o `decidir` seguir a tabela até "nenhum dos
  anteriores", cria a duplicata.
- **VOL1106**: nativa 1 cancelada em 21/09 com um comprador, nativa 2 viva (24/09) com OUTRO. Se o C2X
  tiver pedido vivo do primeiro, a regra liga certo (à cancelada), mas é o lote prometido a duas
  pessoas entre os dois sistemas, e a V3.4 só lista "nativa atrasada".

**Conserto.**
- Regra do PEDIDO, separada da do envelope: (1) a nativa VIVA do mesmo comprador no terreno, a mais
  recente, qualquer que seja a data de criação; (2) senão, a de pé no instante do pedido, do mesmo
  comprador; (3) senão, candidata. `casar-pedido-do-c2x.ts` ganha o modo `pedido`; a F3 segue no modo
  `envio`.
- Só liga pedido em proposta ou adiante (estágios 2 a 6 e 9) e não cancelado. A F10 pode trocar a
  ligação que ELA fez (nunca uma feita à mão) de um pedido cancelado ou em estágio 1 para o pedido vivo
  do mesmo comprador, com a troca no relatório.
- "Ligar falhou" é decisão própria (`nativaJaLigada`), nunca criação; teste.
- `ligadaACanceladaComPedidoVivo` e "pedido vivo no C2X de outro comprador com venda viva aqui" vão ao
  card do Zeus como alarme de dois donos entre sistemas, não como número do relatório.

### D5 · alta · O C2X troca o pedido de lote e a F10 não vê

**Evidência.** No C2X o mesmo `ar.id` muda de `enterprise_unity_id`. Medido pelo espelho: **7
pedidos** cuja unidade em `apolo_commercial_links` é do VLO e cuja proposta da carga está no VOC ou no
VOL (a troca da divisão de 01/08); a carga pede isso por escrito (*"até alguém mover o pedido para o
filho no C2X"*, `importar-fluxo-de-venda.mjs:368`). E o `origem_c2x_id` de uma linha pode mudar pela
tela de vínculo (0181; 0 trocas hoje). A V3.3 põe todo pedido existente em "já existe → andar ou nada":
depois de uma troca de lote no C2X, a venda fica no lote velho aqui, e o lote novo aparece LIVRE no
Hércules enquanto o C2X o cobra de alguém. É a venda dupla que a 0176 existe para impedir. O caso
inverso também: reserva do pai (ignorada) movida para o filho vira "pedido novo no filho" e cai na
regra de criação.

**Conserto.** A lista leve já traz `unidade_c2x_id`. Para todo pedido que já tem proposta, o `decidir`
compara o terreno da proposta com o terreno da unidade atual do pedido (pela união de `terreno.ts`;
VLO para VOC do mesmo lote é o mesmo terreno e não conta). Diferente: `trocouDeLote`, alarme no card do
Zeus, nada movido sozinho (mover é sobrescrever), e o terreno de destino entra como `conflitoDeDono`
para qualquer criação até alguém decidir. Teste com a fixture da troca.

### D6 · alta · O cancelado que a F10 anda não solta o lote

**Evidência.** V3.7: "qualquer viva → cancelado (7, 8): sim (libera o lote)". Não libera. A régua volta
ao cadastro quando não há proposta viva (`situacao-da-unidade.ts:121-137`), e **2.454 das 2.463 vendas
vivas da carga fora do pai estão em linha com cadastro `vendida`** (as outras 9, em `reservada`).
Depois do cancelamento pela F10 o lote aparece "Vendido" (balde vendido), a porta da reserva recusa
(não está `disponivel`), e a categoria "vendido sem venda no Panteon" da V2.1 ("0 hoje") cresce a cada
cancelamento do C2X. Os 6 cupons do salão do D1 prendem os lotes do JDG do mesmo jeito. O Panteon já
resolve isso quando é ele que cancela: `soltarLoteDaVendaDesfeita` (`cancelar-reserva-server.ts:262`),
com `cadastrosDeOndeOLoteVolta(true)` aceitando `vendida` para venda da carga
(`venda/proposta/route.ts:2386-2408`). Lucas, 24/09: *"quando tem cancelamento a unidade tem que ficar
disponivel, tem que ter esse reflexo"*.

**Conserto.** Depois de `andou` para cancelado ou distrato, o orquestrador chama
`soltarLoteDaVendaDesfeita` (a mesma porta: confere todos os donos do terreno, nunca desbloqueia,
leitura que falha não solta). É escrita em unidade, exceção escrita à V3.2, feita pela porta do Panteon
e não por SQL da F10. Se o C2X depois reabrir o pedido (recuo, V3.7), `recuos` vira alarme de dois
donos entre sistemas: o lote já pode ter sido revendido aqui.

### D7 · média · A F10 cria reserva do C2X como venda viva

**Evidência.** Estágio 1 vira `reservado` (`importar-fluxo-de-venda.mjs:144-156`), e a V3.3 cria todo
pedido vivo. No C2X a reserva é quase metade do fluxo e cai rápido: na carga, dos pedidos no filho
criados em junho, 31 de 58 caíram da reserva (mediana de 3,8 dias); em julho, 21 de 50 (5,7 dias). A
venda que a F10 cria em `reservado` não tem `validade_em` (a reserva do Hércules tem) e prende o lote
até o C2X andar, e sem a F10d (A6) para sempre. E o espelho que sustenta o "a F10 LIGA os 8 e cria 0"
da V3.5 **não vê reserva**: dos 924 pedidos em `apolo_commercial_links`, 0 estão em "Reservado" (848
Faturado, 32 Cancelado, 24 Em assinatura, 19 Contrato gerado, 1 Proposta realizada). A memória da carga
registra 38 reservas do Vale do Ouro nascidas no C2X entre 13 e 21/09.

**Conserto.** Pedido vivo em estágio 1 não cria venda (reserva nasce no Hércules, Lucas 18/09); vai
para `reservaSoNoC2x`, com o alarme de dono se o lote estiver livre aqui. Cria quando o C2X o levar a
proposta ou adiante, ou como histórico se já morreu. O ensaio F10a conta a lista.

### D8 · média · Garden: a premissa não se sustenta, e o que vier depois duplica

**Evidência.** As 404 linhas do GDN existem desde **01/09 16:17**, com `origem_c2x_id` de 5811 a 6214.
A carga rodou de 03/09 a 22/09 (`importado_em`), lê TODOS os `acquisition_requests` e só corta
`FORA_DO_PANTEON` (ADT, LAB, SDT, TSC, VLO; o GDN não está), com pedidos criados até 16/09 21:55. Ela
gravou **0 proposta do GDN** e **0 proposta sem unidade**: até 16/09 o C2X não tinha pedido no Garden.
O `apolo_commercial_links` e a fila do Hades também não têm o GDN. O Garden vendido hoje é o cadastro
(320 `bloqueada`) mais a planilha e o LSoft (`boletos_parcelas`, 143 unidades). A V3.6 ("140 a 160
vendas vivas"), a tabela do A7 e o "onde o time da Cecílio vende pelo C2X" do A12 partem de um número
que o C2X não mostrou até 16/09.
O risco de duplicidade é o passo seguinte: se o Garden entrar por outro caminho (carga da planilha,
cadastro pela Cecílio no portal) e o time dela passar a digitar o Garden no C2X para gerar boleto, a
F10 cria por cima: a venda da planilha não tem `c2x_pedido_id` e, se nasceu depois do pedido, não casa
pela regra de hoje (D4).

**Conserto.** O F10a roda `--so GDN` primeiro, e o número vai ao Lucas antes da V5.2. Se der perto de
zero, o Garden sai da F10 e vira decisão própria; qualquer carga do Garden grava pela MESMA RPC de
criação (a guarda do D1, o índice por linha) com a origem marcada, e o casamento de pedido do D4 (a
nativa viva do mesmo comprador vence a data) liga o pedido que vier depois.

### D9 · média · Troca de comprador no mesmo pedido

**Evidência.** A F10 "não mexe em comprador" (V3.7), e a lista leve não traz o cliente. Se a cessão no
C2X troca o `client_id` do mesmo pedido, a F10 anda a venda até faturado com o titular antigo: D17
(comprador), clientes únicos e a CACÁ passam a dizer que a pessoa errada comprou. A cessão feita no
Panteon abre card `cessao` na Têmis (`trabalho-servico.ts:418-424`) e a venda já fica "mexida"; a do
C2X não deixa marca nenhuma aqui.

**Conserto.** `ar.client_id` na lista leve (id, não dado pessoal). Diferente de `cliente_c2x_id`: não
anda, vai para `divergentes` como `compradorMudou`. Na ligada, a mesma conferência contra o comprador
da nativa, por documento em memória, só para as ligadas.

### D10 · média · A mesma venda em outra gleba, fora do terreno da régua

**Evidência.** Vendas vivas com o MESMO documento, a mesma quadra e o mesmo lote em dois
empreendimentos: **LBR+ACT 29** (criadas de 20/11 a 14/12/2025, todas com uma faturada), **RDP+RPC
13**, **SDT+TSC 1**. A régua não as junta (não há linha de pai ligando), e por isso "terreno com duas
vivas" dá 0. Pedido novo nesse padrão passa por toda guarda e a F10 cria as duas: VGV e Vendas contados
duas vezes, e a soma "todos" do R11 cresce sozinha.

**Conserto.** Categoria `mesmaVendaEmOutraGleba` no `decidir` (mesmo documento, mesma quadra e lote, em
par de empreendimentos declarado no cadastro): não cria, lista. O ACT se resolve no PAN-124 (filho do
ACP).

### D11 · média · Reserva no pai com outro comprador

**Evidência.** No C2X o masterplan e a reserva moram no PAI (memória
`reference_venda_redigitada_no_c2x_para_boleto`), e a F10 ignora o pai inteiro (Lucas, 22/09). Das
**151 propostas vivas da carga na sombra do pai, 150 são do mesmo comprador da venda viva do filho e 1
é de OUTRO** (o padrão do VLO0710: reserva de uma pessoa no pai contra a de outra no filho). Reserva
nova no pai para outra pessoa, num lote livre aqui, é o C2X prometendo o lote que o Hércules pode
vender. A V3.3 só conta `vivaSoNoPai`.

**Conserto.** Sem criar nada (a regra do pai fica): `noPaiComOutroComprador` (documento em memória) e
`vivaSoNoPai` vão ao card do Zeus como alarme de dono, não como número do relatório.

### D12 · média · O rollback apaga trabalho do time

**Evidência.** V3.10: "Apagar venda criada pela F10 só com OK: `delete from hercules_propostas where
criado_por = 'espelho-c2x'` (as passagens caem pela FK, conferir `on delete`)". Conferido em
`pg_constraint`: `hercules_proposta_etapas` e `hercules_proposta_eventos` são `ON DELETE CASCADE`;
`temis_trabalhos`, `temis_envelopes`, `hercules_documentos` e `hercules_conversas` são `SET NULL`.
Depois que o time mexer numa venda criada pela F10 (card de cancelamento, envelope da F3 ligado,
documento, conversa, passagem do reflexo ou da F8), o rollback apaga as passagens do time e deixa card,
envelope, documento e conversa órfãos, calado.

**Conserto.** O rollback apaga só a venda criada pela F10 que ninguém tocou (os critérios de "mexida"
da V3.4, mais documento, conversa e envelope ligados), com a contagem ANTES; o resto é listado e
decidido à mão.

### D13 · baixa · "Mexida" depende de cada escritor carimbar

**Evidência.** Os seis critérios da V3.4 são marcas que cada fluxo precisa lembrar de gravar. Medido:
as 10 vendas da carga editadas depois da importação têm todas marca (0 editada sem marca hoje), mas um
fluxo novo que edite a venda da carga sem mexer na etapa (preço, compradores, CAD) não deixa nenhuma
delas, e a tabela não tem gatilho que carimbe (0 triggers em `hercules_propostas`). E a V3.3 fala em
"`hercules_reservas` viva" sem dizer o que é: hoje **19 reservas em `proposta` e 1 `ativa` estão com
`validade_em` vencida** e seguram o lote pela trava; uma guarda que filtre por validade as solta.

**Conserto.** Sétimo critério, na leitura e na RPC: `atualizado_em > greatest(importado_em,
espelhado_em) + 1 s`, com a F10 gravando `espelhado_em` (coluna nova) e `atualizado_em` iguais em toda
escrita dela. Reserva viva = `situacao in ('ativa','proposta')`, sem olhar `validade_em`, como
`trava-do-lote.ts:89`.

### D14 · baixa · O mesmo pedido em duas colunas

**Evidência.** `origem_c2x_id` tem o índice único da carga e `c2x_pedido_id` terá o dele (V3.10): são
índices separados. Uma rodada ligando o pedido P à nativa e outra criando P (o POST com `?gravar=1`, o
script `--gravar` e o cron; "a vez" só está escrita para o cron) deixam P nas duas colunas, em duas
linhas. A guarda "sem nativa viva" não pega quando a nativa ligada está cancelada.

**Conserto.** Na 0202: `check (origem_c2x_id is null or c2x_pedido_id is null)` e índice único sobre
`(coalesce(origem_c2x_id, c2x_pedido_id))`; o banco recusa o segundo. POST e script também tomam a vez.

### O que conferi e não é problema

| O que | Medida |
|---|---|
| Duas vivas na mesma linha ou no mesmo terreno hoje | 0 linha com duas vivas (qualquer origem, pai incluído); 0 terreno com duas vivas fora da sombra; 151 terrenos com a sombra do pai viva e a venda no filho, que a régua já ignora |
| Nativa viva com carga viva no terreno | 0 das 19 nativas vivas; 3 têm só a reserva da carga na sombra do VLO (os casos VOC, VOL e VOR da F3) |
| Os 8 pedidos posteriores que o espelho vê | 8 unidades distintas, cada uma com 1 nativa viva e 0 carga viva; pela ordem dos ids e pela memória de 24/09 (5009 a 5021 em 18 e 23/09), as nativas de 21 e 22/09 são anteriores aos pedidos 5016, 5018, 5021 e 5032 |
| A F3 disputar a etapa da carga com a F10 | `aplicarEnvelopeNaVenda` recusa venda da carga (`envelope-na-venda.ts:150`); o reflexo da Têmis grava passagem sem origem, que a V3.4 já conta como "mexida" |
| Bloqueio do Hércules com carga viva | 97 linhas com `bloqueado_em`, 0 com venda viva |
| Reserva do Hércules com carga viva no terreno | 0 (as 7 `ativa` estão sozinhas no terreno) |
| `origem_c2x_id` repetido em duas linhas | 0; e 0 vínculo trocado pela tela (0181) |

### Onde cada conserto entra no plano

| Seção | Muda |
|---|---|
| V3.2 | exceções escritas ao "não grava": soltar o lote pela porta do Panteon (D6) e desfazer a própria linha na corrida (D2) |
| V3.3 | ordem nova: pai → já existe (com `trocouDeLote`, D5) → decisão memorizada (D3) → estágio 1 não cria (D7) → casamento de pedido (D4) → mesma venda em outra gleba (D10) → guarda completa do terreno (D1, com o A3) → cria, relê e desfaz se preciso (D2) |
| V3.4 | sétimo critério de "mexida" (D13); `compradorMudou` (D9) |
| V3.5 | regra de pedido separada da regra de envelope; só estágio 2 adiante; `nativaJaLigada` (D4) |
| V3.6 | o GDN condicionado ao `--so GDN` do ensaio (D8) |
| V3.7 | depois de cancelado ou distrato, `soltarLoteDaVendaDesfeita`; `recuos` como alarme (D6) |
| V3.10 | índice `uma_viva_por_linha`, CHECK e índice do `coalesce`, tabela de decisões, RPC de desfazer, rollback só do intocado (D1, D3, D12, D14) |
| V3.11 | os casos de cada achado em `decidir.test.ts` e `espelho.test.ts`; na prova de cada passo, "linha com duas vivas" = 0 e "terreno com duas vivas fora da sombra" = 0 |
| Card do Zeus (F9k) | alarmes de dois donos entre sistemas: `trocouDeLote`, `ligadaACanceladaComPedidoVivo`, `noPaiComOutroComprador`, `vivaSoNoPai`, `reservaSoNoC2x` com lote livre, `recuos` |

### ✅ RESPOSTAS DO LUCAS ÀS PERGUNTAS DO PLANO VIGENTE (28/09/2026, ~16:00)

1. **Quem vê o Garden:** "Cecílio e mmendes; sai do /gurgel". O portal mmendes continua; o Garden
   sai de TODA conta do portal da Gurgel, inclusive a de admin da Careli (a Careli vê pelo interno).
2. **De onde vêm as vendas do Garden:** "A Cecílio cadastra no portal dela". Não há gravação
   automática das vendas do Garden a partir da planilha/LSoft; se o ensaio achar pedido do Garden no
   C2X, ele entra pela F10 como qualquer outro; o resto nasce pelo cadastro da Cecílio no portal.
3. **Perfil do comprador na ficha do Apolo:** "tem que ser os dois, temos que gravar o que temos
   hoje, depois disso somente pelo processo que temos hoje". Ou seja: UMA gravação inicial automática
   do que o C2X tem hoje (sem sobrescrever o que alguém já preencheu no Apolo), e daí em diante só pelo
   processo atual do Panteon (CAD/ficha). NÃO é sync contínuo.
4. **Ensaio da F10 (só leitura do C2X):** "Pode rodar o ensaio". Autorizado em 28/09/2026.
