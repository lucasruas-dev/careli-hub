# Perguntas em aberto — o domínio da Careli

**Como usar:** escreva a resposta na linha `R:` de cada pergunta e salve. Não precisa formatar nem
responder tudo — uma frase basta, e pode pular as que não interessam agora. Quando quiser, me diga
"li as respostas" (ou só me mande trabalhar no tema) que eu leio o arquivo, levo cada resposta para
o corpo do `dominio-careli.md` com a data, e apago a pergunta daqui.

**"Não sei" e "tanto faz" são respostas úteis.** A primeira me diz para medir em vez de perguntar;
a segunda me diz para decidir sozinho e seguir. O que atrasa é a pergunta sem resposta nenhuma,
porque eu fico sem saber se é esquecimento ou se a resposta é difícil.

⚠️ As perguntas nasceram de uma varredura do código, das migrations, do diário e da memória — são
o que o repositório **não** respondeu. Se alguma parecer óbvia demais, o óbvio provavelmente nunca
foi escrito em lugar nenhum, e é justamente por isso que eu erro nele.

## Primeiro estas — elas travam trabalho em curso
Cada uma destas está parando uma etapa que eu ia construir, ou envolve dinheiro que volta para o cliente. As outras podem esperar.

### P01 · FATURADO significa exatamente "7 dias de arrependimento cumpridos + entrada paga", e mais nada? Em especial: precisa também que os boletos das mensais já estejam emitidos, ou o faturamento é anterior a isso?
<sub>O ciclo da venda</sub>

R: 

### P02 · Se o comprador NÃO paga a entrada dentro do prazo, o que acontece com o card: cancelamento automático, distrato, ou fica parado em Prazo legal esperando decisão humana? E quantos dias de tolerância?
<sub>O ciclo da venda</sub>

R: 

### P03 · RETENÇÃO NO DISTRATO: o percentual é fixo por empreendimento (entraria como um campo em `apolo_enterprise_settings`, ao lado da taxa de cessão), ou varia por contrato conforme a cláusula da minuta que o cliente assinou? Hoje o sistema não calcula nada — é conta à mão.
<sub>Desfazer a venda</sub>

R: 

### P04 · A base da retenção é o total pago pelo cliente incluindo o ato/sinal, ou o ato fica retido integralmente e a retenção percentual incide só sobre as parcelas?
<sub>Desfazer a venda</sub>

R: 

### P05 · CESSÃO — a taxa de cessão fica com a Careli ou é repassada ao loteador? Isso muda se ela entra no cálculo do líquido do loteador.
<sub>Desfazer a venda</sub>

R: 

### P06 · O `public/garden/interno-3634d57f.html`, que está no ar sem login mostrando nome de comprador e preço: posso remover agora que o espelho público existe, ou alguém ainda usa aquele link?
<sub>Empreendimentos e legado</sub>

R: 

---

## O resto, por tema

### QUEM É QUEM, E QUEM PAGA A QUEM
### P07 · A GURGEL é a COORDENADORA DE VENDAS que assina o contrato de corretagem, ou é uma imobiliária que também coordena os lançamentos? (no C2X ela é o usuário id 50 com perfil de imobiliária, mas o portal `/comercial/gurgel` é o 'portal do coordenador')
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P08 · A Gurgel é empresa do mesmo grupo da Careli, ou é parceira de fora? (a conta Asaas é 'GURGEL LANCAMENTOS IMOBILIARIOS' e a Iris trata a fila dela como 'o número do parceiro', mas o diário também a chama de 'filial Gurgel')
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P09 · A coordenadora de vendas é a MESMA em todos os empreendimentos, ou muda de empreendimento para empreendimento? (a 0145 guardou `coordenadora_entity_id` por empreendimento, e hoje nenhum está preenchido)
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P10 · A coordenadora recebe comissão em TODA venda do empreendimento, ou só nas vendas trazidas pelas imobiliárias que ela credenciou?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P11 · Quando a venda é direta, sem imobiliária, o percentual que a 0145 chama de 'comissão da imobiliária' vai inteiro para o corretor autônomo, ou o valor é outro?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P12 · A coordenadora do contrato deve sair de `enterprises.coordenador_id`, que o C2X já preenche por empreendimento (CDV2 no Cidade Jardim), ou vai ser recadastrada à mão no Apolo mesmo?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P13 · O Ato vai 100% para a cadeia de comissão em TODOS os empreendimentos? (o BI dá fator 0 ao Ato e o código trata isso como fato; a sua explicação de 16/01 aplica o percentual à entrada inteira — o total fecha igual, a parcela não, e a carteira é regime de caixa)
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P14 · A Careli recebe comissão de CAPTAÇÃO (perfil Captador, 6% no Recanto) só nos empreendimentos que ela captou, ou isso vale como regra em toda a carteira?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P15 · A Careli tem participação societária em algum empreendimento ou SPE, ou é sempre só prestadora de serviço (gestão de carteira + captação)?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P16 · Cada empreendimento novo nasce com uma SPE própria, ou a SPE pertence ao incorporador e serve vários empreendimentos?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P17 · Quando o filho tem dono diferente do pai (VOC do Cecílio, VOL do Lino), a VENDEDORA do contrato é a empresa do filho ou a do pai? (hoje o código só lê categoria → empreendimento e pula o filho)
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P18 · O incorporador que tem portal é sempre o mesmo que assina como vendedora no contrato, ou existe caso em que o dono do portal é investidor e quem assina é outra empresa?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P19 · Quem cadastra os percentuais da 0145 na aba Política Comercial: o time da Careli, ou o coordenador pelo portal dele? (hoje a rota exige permissão de escrita do Apolo, que o coordenador não tem)
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P20 · O 'Gerente' do split (IMO44 no Cidade Jardim) é sempre uma imobiliária, ou é um papel de pessoa? E o que ele faz que a imobiliária da venda não faz?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P21 · Os 5 cadastros de perfil 'Coordenadora de venda' no C2X são 5 empresas diferentes, ou são usuários da mesma coordenadora?
<sub>Quem é quem, e quem paga a quem</sub>

R: 

### P22 · Nos empreendimentos em que o mensal é 100% do incorporador (Lagoa Bonita LBP, Veredas do Ouro, Rio de Pedras e mais cinco), a Careli não é remunerada mesmo, ou ela cobra por fora da carteira?
<sub>Quem é quem, e quem paga a quem</sub>

R: 


### O CICLO DA VENDA
### P23 · Prazo da RESERVA: qual é o número da casa? Hoje a tela oferece 1/2/3/5/7 dias com padrão 3 e teto de 30, mas isso foi escolha do agente, não regra sua. É um número único para todos os empreendimentos ou é combinado por empreendimento (e, nesse caso, vira campo na Política Comercial)?
<sub>O ciclo da venda</sub>

R: 

### P24 · Validade da PROPOSTA: 7 dias é o certo? Os atalhos hoje são 3/5/7/10 com padrão 7, também escolhidos pelo agente.
<sub>O ciclo da venda</sub>

R: 

### P25 · Quando a reserva vence sem virar proposta, o lote volta para disponível AUTOMATICAMENTE, ou alguém precisa clicar em cancelar? Hoje não existe nenhuma rotina que expire reserva sozinha.
<sub>O ciclo da venda</sub>

R: 

### P26 · O proponente adicional (cônjuge, sócio) também precisa de CAD credenciada própria naquele empreendimento, ou basta a CAD do TITULAR? Hoje o sistema exige só a do titular.
<sub>O ciclo da venda</sub>

R: 

### P27 · O desconto sobre a tabela tem ALÇADA? Por exemplo: acima de X% ou de X reais o coordenador não fecha sozinho e precisa de aprovação? Hoje a proposta congela o desconto (0151) mas nada o limita.
<sub>O ciclo da venda</sub>

R: 

### P28 · O C2X tem DOIS estágios distintos, 4 Faturado e 6 Finalizado. O Panteon deve ter só "Faturado", ou precisa dos dois (por exemplo, Faturado = entrada paga e Finalizado = contrato registrado/arquivado)?
<sub>O ciclo da venda</sub>

R: 

### P29 · Os 7 dias contam da última assinatura do comprador na Clicksign. E quando alguém assina FORA da Clicksign (papel, cartório, contrato antigo): a contagem passa a valer de que data, e quem carimba?
<sub>O ciclo da venda</sub>

R: 

### P30 · A TAXA DE CESSÃO é valor fixo ou percentual? É a mesma para todos os empreendimentos, ou vira cadastro por empreendimento (como a entrada mínima virou na 0128)?
<sub>O ciclo da venda</sub>

R: 

### P31 · Venda que nasce no Panteon não chega ao C2X, então a etapa Prazo legal não enxerga o pagamento da entrada dela. Enquanto o financeiro não migra, o time vai lançar essa entrada à mão no C2X para a Têmis ler, ou a Têmis precisa de um registro de pagamento próprio no Panteon?
<sub>O ciclo da venda</sub>

R: 

### P32 · A reserva pode nascer sem CORRETOR, só no nome da imobiliária, e o sistema aceita isso hoje. Isso é o desejado, ou toda reserva deveria ter um corretor nomeado (para efeito de comissão e de cobrança de andamento)?
<sub>O ciclo da venda</sub>

R: 


### DESFAZER A VENDA
### P33 · A devolução ao cliente sai em parcela única ou parcelada? (O texto de exemplo do assistente de minutas fala em "até 12 parcelas", mas isso é ilustração de cláusula, não regra configurada — preciso saber se o número real é esse.)
<sub>Desfazer a venda</sub>

R: 

### P34 · DESISTÊNCIA DENTRO DOS 7 DIAS DE ARREPENDIMENTO: hoje a regra classificaria como distrato com devolução se o cliente já tiver pago qualquer coisa. Nesse caso a devolução é de 100% sem retenção, e isso deveria ser um quinto caso na classificação — ou o jurídico trata pela apuração manual mesmo?
<sub>Desfazer a venda</sub>

R: 

### P35 · O cancelamento por desistência não passa por assinatura, mas gera um "termo de cancelamento". Esse termo é só arquivado internamente, ou o cliente precisa receber uma via (mesmo sem assinar)?
<sub>Desfazer a venda</sub>

R: 

### P36 · CANCELAMENTO POR CORREÇÃO: quem pode abrir — só o jurídico ao perceber o erro na conferência, ou o coordenador também pode pedir pela tela Venda quando descobre que o contrato saiu com dado errado?
<sub>Desfazer a venda</sub>

R: 

### P37 · No cancelamento por correção, o contrato original é encerrado e um novo é emitido (como na cessão), ou o mesmo contrato é regerado e reenviado para assinatura mantendo a mesma numeração/código?
<sub>Desfazer a venda</sub>

R: 

### P38 · CESSÃO — "nas mesmas condições" mantém o preço original do cedente inclusive os reajustes já aplicados, ou o contrato do cessionário nasce com o saldo a valor de hoje?
<sub>Desfazer a venda</sub>

R: 

### P39 · CESSÃO — o cedente fica desobrigado de tudo ao assinar o termo, ou permanece como devedor solidário de alguma parte?
<sub>Desfazer a venda</sub>

R: 

### P40 · CESSÃO — a trava de inadimplência é "qualquer parcela vencida e não paga" (é como está escrito hoje), ou existe tolerância, tipo só barrar acima de 30 dias de atraso?
<sub>Desfazer a venda</sub>

R: 

### P41 · Depois que o jurídico conclui um cancelamento ou distrato, a unidade deve voltar para `disponivel` AUTOMATICAMENTE quando a última atividade for marcada, ou alguém precisa liberar manualmente na tela do Hércules? (Hoje não acontece nem uma coisa nem outra — a caixinha é marcada e nada muda do lado da venda.)
<sub>Desfazer a venda</sub>

R: 

### P42 · Para os 11 contratos que ainda correm no C2X: quando um deles é distratado lá, você quer que alguém abra um card na Têmis mesmo assim (só para o controle e o documento ficarem de um lado só), ou o Panteon fica fora desses até a migração de dezembro?
<sub>Desfazer a venda</sub>

R: 

### P43 · Os dados bancários para a devolução do distrato: você quer que o sistema colha isso na abertura do pedido (o coordenador pergunta ao cliente na hora), ou é o jurídico que busca depois, já na etapa de apuração de valores?
<sub>Desfazer a venda</sub>

R: 


### EMPREENDIMENTOS E LEGADO
### P44 · A VIRADA já aconteceu? Desde 10/09 o espelho público lê situação só do Panteon, mas a memória de 09/09 diz que até a virada o pai (VLO) tem de ser alimentado pela LEITURA DOS FILHOS, e não pelo C2X. Hoje, 11/09, qual dos dois regimes está valendo para reserva e proposta do Vale do Ouro: o pai já é a origem, ou os filhos ainda mandam?
<sub>Empreendimentos e legado</sub>

R: 

### P45 · O `lib/apolo/espelho-masterplan.ts` (o que copia status do VLO para VOC/VOL dentro do C2X) pode ser APAGADO do repositório, ou você quer que ele fique parado no lugar por precaução? Enquanto existir, alguém pode religá-lo e desfazer 158 vendas.
<sub>Empreendimentos e legado</sub>

R: 

### P46 · A divergência VLO0305 "Reservado" × VOC0305 "Disponível" (a AR 4950, cliente 4928, sinal marcado para 10/09) continua aberta? Devo corrigir o VOC0305 para Reservado, ou o time já resolveu na tela?
<sub>Empreendimentos e legado</sub>

R: 

### P47 · Os 46 lotes bloqueados do VOL que estão com preço R$ 1,00: o time vai cadastrar o preço no C2X, ou eu mudo o BI para usar `sale_blocked` em vez de preço como prova de existência? A segunda opção muda o número dos DOIS painéis de uma vez.
<sub>Empreendimentos e legado</sub>

R: 

### P48 · Os 83 lotes do Lagoa Bonita que existem só no pai (LAB 31) e não estão em gleba nenhuma: eles pertencem a qual filho (LBF, LBP ou LBR), ou são área remanescente que nunca vai ser vendida?
<sub>Empreendimentos e legado</sub>

R: 

### P49 · As vendas NOVAS do Lagoa Bonita passam a nascer todas no PAI (como o Vale do Ouro vai passar a fazer), ou continuam nascendo reserva no pai e proposta no filho?
<sub>Empreendimentos e legado</sub>

R: 

### P50 · O ACP (Aldeia das Cachoeiras das Pedras, 42) está vendendo hoje? Ele tem recepção de CAD ligada e minuta, mas é o único dos 11 que não tem masterplan em lugar nenhum — preciso traçar o dele agora ou pode esperar?
<sub>Empreendimentos e legado</sub>

R: 

### P51 · O RDV (Recanto do Vale, 43) já é produto vivo ou é cadastro novo ainda sem venda? Ele aparece no cadastro do Panteon mas não está na lista dos 11 que recebem CAD.
<sub>Empreendimentos e legado</sub>

R: 

### P52 · Guaimbé, Giant Towers, On Sky e os edifícios Rubi 5 / Jade 4 / Cristal 3 / Esmeralda: são empreendimentos da Careli que nunca entraram no C2X, ou são só CARTEIRAS de terceiros que a Careli administra? Pergunto porque isso decide se eles viram linha em `hercules_empreendimentos` ou ficam só no módulo de boletos.
<sub>Empreendimentos e legado</sub>

R: 

### P53 · O Vale do Sol vai ser cadastrado como empreendimento no Panteon (com unidades, masterplan e espelho), ou continua existindo apenas dentro do LSoft e da emissão de boletos?
<sub>Empreendimentos e legado</sub>

R: 

### P54 · O evento Villa Paris no Prometeu continua sendo o laboratório de teste, ou aquele reset de 03/09 encerrou o uso como ensaio? E o EMPREENDIMENTO Villa Paris (RVP 38) segue vendendo normalmente, certo?
<sub>Empreendimentos e legado</sub>

R: 

### P55 · O ZZ TESTE (TST, 9001) fica no ar indefinidamente como empreendimento de teste em produção, ou tem data para sair? Se fica, quer que ele seja escondido de alguma tela específica além das que já filtram por `recepcao_cad`?
<sub>Empreendimentos e legado</sub>

R: 

### P56 · O Garden: o lote Q02 L18 (265 m², disponível, sem preço) e a quadra 10 renumerada (o C2X está com GDN1001..1013 e o masterplan com 1001..1014) continuam como estão, ou é hora de acertar isso na tela do C2X?
<sub>Empreendimentos e legado</sub>

R: 

### P57 · A fase 2 do JDG (quadras 12 a 29, 173 lotes) continua encerrada, ou já há data de lançamento para eu retomar o desenho dos lotes?
<sub>Empreendimentos e legado</sub>

R: 

### P58 · O `hercules_unidades` é um retrato de 01/09 carregado à mão. Quer que eu ligue um cron para atualizá-lo, ou a decisão é que ele seja congelado de propósito até a virada, com a situação sempre vindo do processo do Panteon?
<sub>Empreendimentos e legado</sub>

R: 

