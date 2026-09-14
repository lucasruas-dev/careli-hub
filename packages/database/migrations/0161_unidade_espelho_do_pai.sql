-- O MESMO TERRENO ESTAVA CADASTRADO DUAS VEZES, E AS DUAS LINHAS JÁ DISCORDAVAM.
--
-- POR QUE ELA EXISTE. Lucas, 14/09/2026: *"estamos com tabelas fazendo a mesma coisa alimentando a
-- mesma informação, aí as alterações podem ocorrer em uma e nas outras não, aí eu vou ter a quebra
-- da informação: em um local eu vejo um valor e em outro eu vejo outro valor. isso não pode
-- acontecer"*. A varredura de 14/09 achou o caso mais caro disso, e ele é dentro de UMA tabela.
--
-- ⚠️ O QUE FOI MEDIDO, em produção, em 14/09/2026:
--   • 714 terrenos têm DUAS linhas em `hercules_unidades`: uma no empreendimento PAI (LAB=31,
--     VLO=35) e outra no FILHO, a gleba que vende (LBR=27, LBP=32, LBF=33, VOL=36, VOC=37, VOR=41).
--     A chave do terreno é quadra+lote; o código não serve, porque o pai grava LABC0101 e o filho
--     LBRC0101 para o MESMO lote.
--   • 330 pares da Lagoa Bonita e 62 do Vale do Ouro JÁ tinham situação diferente; 346 e 4 tinham
--     PREÇO diferente. Exemplo real: o mesmo lote "bloqueada" a R$ 545.864,00 na linha do pai e
--     "vendida" a R$ 519.573,00 na do filho — R$ 26.291,00 de diferença e dois estados incompatíveis.
--   • Não existe trigger, cron ou job que ligue as duas. As rotas de reserva e de proposta escrevem
--     com `.eq("id", unidade.id)`: mexer pelo filho NUNCA toca a linha do pai.
--
-- ⚠️ QUAL DAS DUAS É A VERDADE: A DO FILHO, e quem responde isso é o dinheiro. Medido no C2X:
--   Lagoa Bonita pai = 495 unidades, ZERO parcelas, R$ 0,00 · filhos = 412 unidades, 2.726 parcelas,
--   R$ 12.143.347,67. Vale do Ouro pai = 298 unidades, ZERO parcelas, R$ 0,00 · filhos = 302
--   unidades, 26.972 parcelas, R$ 25.590.272,07.
--   E o padrão das propostas explica o resto: o MESMO cliente, com o MESMO CPF, aparece "reservado"
--   na linha do pai e "faturado" na do filho. Não são duas vendas — é uma venda que começou como
--   reserva no registro antigo, antes da divisão em glebas, e foi concluída no registro novo. A
--   linha do pai é história parada no meio do caminho.
--
-- ATENCAO 1: MARCA, NÃO APAGA — e três números proíbem apagar.
--   331 propostas apontam para linhas do pai (ficariam órfãs); 116 das 118 propostas VIVAS do pai
--   colidiriam com a proposta viva do filho se fossem repontadas (o índice `uma_viva_por_unidade`
--   recusaria); e 83 lotes da Lagoa Bonita existem SÓ no pai — não têm gêmeo, são lotes reais sem
--   gleba, e sumiriam. `espelho_de` é aditivo e se desfaz com um update.
--
-- ATENCAO 2: A COLUNA APONTA PARA A LINHA VIVA, e não é um booleano. Um `bool espelho` diria que a
--   linha não vale, e deixaria cada leitor procurar sozinho quem vale — que é exatamente o defeito
--   que esta migration existe para acabar. Com o ponteiro, a pergunta "qual é a situação deste
--   terreno" tem UMA resposta e um caminho para chegar nela.
--
-- ATENCAO 3: OS 83 SEM GÊMEO FICAM COM `espelho_de` NULO, de propósito. Eles não são duplicata: são
--   lote de verdade que nenhuma gleba assumiu. Marcá-los junto os esconderia, e esconder lote é
--   perder venda. Eles são uma PERGUNTA de cadastro para o Lucas, não um dado a corrigir aqui.
--
-- ATENCAO 4: MARCAR NÃO BASTA, E ISSO PRECISA ESTAR ESCRITO. Enquanto os leitores não consultarem
--   a coluna, nada muda na tela. Hoje a regra existe espalhada e incompleta — `situacao-publica.ts`
--   inventou uma precedência só para o espelho público e `painel-de-produtos.ts` marca o pai como
--   "consumido" só para os cards; as outras 23 telas que leem `hercules_unidades` não sabem de nada.
--   O leitor canônico vem junto desta entrega.
--
-- ATENCAO 5: A CARGA PRECISA PRESERVAR A MARCA. `scripts/hercules/carregar-unidades-do-c2x.mjs` faz
--   upsert por `origem_c2x_id` e não menciona esta coluna — como o upsert só escreve as colunas que
--   ele lista, `espelho_de` sobrevive. Se um dia alguém trocar aquele upsert por um que substitua a
--   linha inteira, a marca some em silêncio e a divergência volta.
--
-- Autorização do Lucas, 14/09/2026: *"tem o meu ok"*.

alter table public.hercules_unidades
  add column if not exists espelho_de uuid references public.hercules_unidades (id) on delete set null;

comment on column public.hercules_unidades.espelho_de is
  'Quando preenchido, ESTA linha e o registro ANTIGO do mesmo terreno (o do empreendimento pai, de antes da divisao em glebas) e aponta para a linha VIVA, a da gleba que vende. Situacao e preco valem os da linha apontada. Ver ATENCAO 2 e 4 da migration 0161.';

create index if not exists hercules_unidades_espelho_de
  on public.hercules_unidades (espelho_de)
  where espelho_de is not null;

-- ── A marcacao: pai -> filho, casando por quadra+lote ───────────────────────
-- ⚠️ `trim` NOS DOIS LADOS: a carga trouxe quadra e lote do legado como texto, e o espaco a mais de
-- um lado faria o par nao casar -- o terreno ficaria sem marca e continuaria divergindo, calado.
with par as (
  select p.id as pai_id, f.id as filho_id
    from public.hercules_unidades p
    join public.hercules_unidades f
      on trim(f.quadra) = trim(p.quadra)
     and trim(f.lote) = trim(p.lote)
     and ((p.enterprise_id = '31' and f.enterprise_id in ('27','32','33'))
       or (p.enterprise_id = '35' and f.enterprise_id in ('36','37','41')))
   where p.enterprise_id in ('31','35')
)
update public.hercules_unidades u
   set espelho_de = par.filho_id, atualizado_em = now()
  from par
 where u.id = par.pai_id;
