# 2026-09-21 · A estrutura do produto, o sync que voltou atrás e o fim da carga do legado

> ⚠️ Esta entrada **não está** em `engineering-operations.md` de propósito: aquele arquivo passou de
> 3,6 MB e o hook de pre-commit bloqueia qualquer commit que o traga no stage. A saída combinada é
> escrever o registro num arquivo do dia e não pular o hook por conta própria. A rotação do diário
> continua sendo decisão do Lucas (candidato: cortar por ano, como já se fez com a memória).

Dia longo, cinco frentes. O detalhe de cada release está em `releases-production.md`.

## 1. v1.354.0 — a estrutura do produto ganhou casa (Apolo)

**Setup virou a casa da estrutura**, com as sub-abas Credenciamento, Filho, Categoria e Assinatura
(a ordem é do Lucas). A categoria saiu de dentro de Políticas comerciais e o filho deixou de ser aba
de primeiro nível; o filho novo nasce ali, já pendurado no pai.

**Unidades ganhou Resumo + Cadastro da unidade**: área, valor, matrícula, o filho, a categoria e os
anexos do lote. Os botões da linha viraram só ícone com tooltip (lápis para editar) e o valor de
tabela é escrito como moeda.

**Minutas ganhou o seletor "De quem é esta minuta"**. O banco sempre gravou a minuta no
`enterprise_id` que a tela manda e a cadeia já lia o filho antes do pai desde a 1.353.0 — faltava a
tela deixar escolher, e era isso que o Lucas não achava (*"eu não vi essa marcação"*).

**Mapa e Vendas saíram da ficha**: 871 linhas da VendasTab e o `masterplan-mapa.tsx` apagados.

## 2. O sync de vendas do C2X, que rodou, quebrou no meio e foi revertido

O Lucas rodou `importar-fluxo-de-venda.mjs --gravar` às 16h18. A carga **quebrou no meio**: gravou
as 4.911 propostas e morreu na linha do tempo com erro de socket. O Panteon ficou com metade do
retrato — propostas novas sem nenhuma movimentação de etapa.

O estoque do Vale do Ouro encheu de amarelo e ele mandou voltar.

**A reversão, medida:** apagadas as 43 propostas que a carga criou (38 reservas do VLO, 2 do VOL, 1
do VAL, 1 contrato do LOS, 1 assinatura do VOC) e devolvidas 39 propostas às etapas de 13/09,
reconstruídas pelo histórico de movimentos do legado. As contagens bateram uma a uma com a foto de
antes: cancelado 2.279, faturado 2.012, reservado 112, assinatura 448 (+1, a do JIMMY, preservada
porque o time abriu um card de distrato sobre ela). Backup das 69 linhas em
`backup-propostas-da-carga-21-09.json`, no scratchpad da sessão.

⚠️ **NENHUMA venda movida no Panteon foi atropelada**, e isso foi medido ANTES de reverter: das
4.929 importadas, ZERO tinham movimento nascido aqui, ZERO tinham `etapa_por` e ZERO tinham
`cancelada_em`. Os 7 distratos abertos na Têmis sobre venda importada não foram tocados, e a
integridade do que o time fez aqui desde 13/09 (18 cards, 93 bloqueios, 8 propostas, 11 movimentos,
8 documentos) foi conferida: zero órfãos.

**O que ficou só no legado:** 69 lotes ocupados lá e livres aqui. Cruzados um a um, **67 são eco**
do que o time já fez no Panteon (26 são a mesma venda uma etapa à frente; 38 são reservas no VLO, o
pai, de terrenos já vendidos nos filhos). **Só 2 são exclusivos:** LOS 17 20 (contrato do CLEITON,
lote que o legado cancelou do GLEISSON e revendeu) e VLO 07 10 (reserva do HILDEBRANDO).

Relatório com as 186 ações e quem as fez (Northon 124, Nívea 58, Cinthia 2, Administrador Geral 2)
em `Documentos\Relatórios Panteon\2026-09-21 movimentos do C2X depois de 13-09` (HTML e CSV).

## 3. A carga do legado foi ENCERRADA

Lucas: *"não vou mais fazer isso"*. Os três scripts (`importar-fluxo-de-venda`,
`carregar-unidades-do-c2x`, `importar-eventos-da-proposta`) passaram a **recusar `--gravar`** sem
`--carga-do-legado-autorizada`; o ensaio segue livre, porque é como se mede o quanto o legado andou.
A tarefa agendada `ultimo-sync-unidades-c2x` já estava desabilitada e não dispara nada.

⚠️ **O legado não parou de receber movimento.** O que o time lançar no C2X a partir de agora não
chega mais ao Panteon. Vale o aviso ao Northon e à Nívea.

## 4. Os fantasmas do Vale do Ouro

Lucas: *"pode excluir esses fantasma, hoje a soma dos filhos que tem que ser o retrato do pai"*.

Apagadas **68 propostas vivas do VLO** (56 reservado, 8 faturado, 4 proposta), todas de terrenos já
vendidos no VOC/VOL e criadas no legado entre 03/08 e 10/09. A régua da situação
(`lib/hercules/situacao-da-unidade.ts`) pergunta pelo **terreno** e a **proposta mais recente
manda** — por isso a reserva de setembro no pai ganhava da venda de agosto no filho, e a tela
pintava de amarelo lote que já tinha dono. O Vale do Ouro saiu de **57 reservados para 2**.

Ficou de pé, de propósito, a reserva de **HERVE FROES ZENOBIO** (VLO quadra 03 lote 05): o terreno
está disponível no filho e o negócio dele está **em assinatura no C2X**. Apagar deixaria o lote
livre aqui com contrato andando lá, que é o convite à segunda venda.

## 5. v1.355.0 — o painel de parcelas e a ordem do Setup

`maxHeight: 58vh` virou `max(340px, calc(100dvh - 260px))` nos dois painéis de parcelas do portal
(incorporador e comercial): na casca do Hércules quem rola é o `<main>` (100dvh) e a tabela ainda
tinha rolagem própria de pouco mais da metade da altura, deixando faixa morta embaixo. E a ordem das
sub-abas do Setup virou Credenciamento, Filho, Categoria, Assinatura.

## 6. v1.356.0 — o cancelamento saiu do contrato

Lucas: *"eu queria trazer esse fluxo diferente para o que está em cancelamento, hoje ele aponta para
contrato e polui nossos indicadores"*, *"e um card novo"* e, com o print da ficha do VOC 03 06, *"o
ideal quando cancelado não ter as outras etapas, ela ser a última"*.

`em_cancelamento` nasceu como **situação de tela**, derivada na régua única a partir da marca
`cancelamento_pedido_em` da proposta viva mais recente, e só depois do contrato. **A etapa no banco
não muda** (é ela que segura o lote enquanto o contrato existe), e nenhuma migration foi precisa.

⚠️ **A marca crua mente.** Das 9 vendas marcadas em produção, 1 era resto de pedido indeferido, sem
card vivo na Têmis. A régua passou a peneirar pela `soltarMarcasQueSobraram`, que já existia para o
botão da Venda desde 18/09.

⚠️ **O risco que a varredura dos leitores achou:** `baldeDaEtapa` tem `default: "disponivel"`. Sem um
caso próprio, o lote em cancelamento apareceria como **estoque livre** na tela Produtos. Está travado
por teste. Na mesma varredura nasceu `BALDES_DO_CENARIO`: três lugares montavam o cenário com
`{} as ApoloEnterpriseScenario` e a própria cópia da lista de baldes, então a chave nova existiria no
tipo e faltaria no objeto, sem o typecheck acusar.

Números do dia: 9 vendas, R$ 1.702.143 — 7 contavam como assinatura e 2 como contrato; 8 são distrato.

A subida atravessou a v1.355.1 da outra sessão (o termo de acordo): rebase em cima da main, conflito
só no changelog, typecheck e suíte rodados depois do rebase (7.721 testes em 491 arquivos).
