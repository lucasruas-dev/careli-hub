-- 0143 — O NOME DO PLANO FICA LIVRE.
--
-- Lucas, 08/09/2026, depois de bater na trava ao cadastrar o segundo plano do Veredas do Ouro:
-- *"eu não queria rotular os nomes dos planos, acho que esse rótulo pode e deve ser editável. No
-- Veredas eu tenho dois planos normais: um na tabela SACOC e outro na tabela Price"*.
--
-- ⚠️ O CASO DELE MOSTRA QUE A REGRA ESTAVA ERRADA, e não que ele estava contornando-a. Dois planos
-- chamados "Normal" no mesmo empreendimento são legítimos quando a diferença entre eles é a TABELA
-- de amortização: o cliente escolhe entre pagar parcela fixa (Price) ou amortização pura (SACOC), e
-- os dois são o plano normal da casa. A constraint obrigava a inventar nome — "Normal 2", "Normal
-- Price" — e nome inventado para satisfazer o banco vira nome impresso na proposta do cliente.
--
-- ⚠️ O QUE **NÃO** MUDA, E POR QUÊ. `temis_planos_slot_unico_por_empreendimento` fica de pé. O SLOT
-- (avista/curto/investidor/normal) é outra coisa: ele diz qual plano sai em cada coluna da folha da
-- PA, e dois planos disputando o mesmo slot fariam a folha imprimir um deles por sorteio — o tipo de
-- erro que só aparece no salão de lançamento, com o cliente na frente. Nome é etiqueta; slot é
-- posição. Soltar os dois juntos trocaria uma trava chata por um defeito silencioso.
--
-- ⚠️ E O NOME CONTINUA OBRIGATÓRIO (`not null` na coluna): o que cai é a UNICIDADE, não a exigência.
-- Plano sem nome é plano que ninguém escolhe numa lista.
--
-- CONSEQUÊNCIA PARA QUEM LÊ: nada mais garante que um nome identifique um plano. Todo código que
-- procurar plano por NOME passa a poder achar dois — e o simulador faz exatamente isso hoje
-- (`lerPlanosDoPanteon` nem seleciona o `id`, medido em 08/09/2026). Este é o motivo de o `id` ter
-- de chegar à proposta, e está anotado como o próximo passo da cadeia de contrato.

alter table public.temis_planos
  drop constraint if exists temis_planos_nome_por_empreendimento;

-- Um índice comum no lugar: a busca por nome continua rápida, sem impor unicidade.
create index if not exists temis_planos_nome_por_empreendimento_idx
  on public.temis_planos (workspace_id, enterprise_id, nome);

comment on index public.temis_planos_nome_por_empreendimento_idx is
  'Busca por nome. NÃO é único desde a 0143: dois planos podem se chamar "Normal" quando diferem na tabela de amortização (Price x SACOC).';
