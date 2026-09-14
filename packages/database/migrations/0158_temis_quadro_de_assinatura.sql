-- O QUADRO DE ASSINATURA DO EMPREENDIMENTO: uma lista de pessoas por papel.
--
-- POR QUE ELA EXISTE. Lucas, 13/09/2026, fechando o desenho: *"a vendedora eu posso ter mais de um
-- assinante, então vamos ter que liberar para vendedora também a inclusão das assinaturas igual a
-- testemunha (...) Testemunha a mesma coisa, e coordenador de vendas a mesma coisa, eu posso ter
-- mais de um como coordenador"*.
--
-- ⚠️ ISTO ERA `temis_testemunhas`, E ESTAVA ERRADO POR UM PAPEL. A tabela nasceu duas horas antes
-- (0157) resolvendo só a testemunha, porque naquele momento ela era o único papel que se digitava.
-- Quando o Lucas descreveu o resto, ficou claro que vendedora, coordenador e testemunha são A MESMA
-- COISA: uma lista de pessoas que assinam por alguém, presa ao empreendimento. Três tabelas com a
-- mesma forma seriam três telas, três rotas e três regras de posição que envelheceriam separadas.
--
-- ⚠️ RENOMEIA, NÃO APAGA. A 0157 já está aplicada em produção; um `drop` sumiria com ela do
-- histórico e faria o registro de migrations mentir sobre o que rodou. `rename` preserva os dois
-- fatos: que a 0157 existiu, e que ela virou outra coisa. A tabela tem ZERO linhas (medido em
-- 13/09/2026 antes desta migration), então nada se perde no caminho.
--
-- ATENCAO 1: TRÊS PAPÉIS, E SÓ TRÊS. Comprador e cônjuge saem da PROPOSTA e nunca daqui — digitar o
-- comprador abriria a porta para o contrato dizer uma pessoa e o envelope ir para outra. O comprador
-- PJ terá o seu caminho próprio, na etapa de VALIDAÇÃO, apontando entre os sócios já cadastrados
-- quem assina pela empresa (decisão do Lucas: *"vamos criar (não agora depois)"*). O captador NÃO
-- entra: *"Captador não entra no quadro de assinatura"*.
--
-- ATENCAO 2: A VENDEDORA JÁ VEM PREENCHIDA, E ESTA TABELA É O QUE PERMITE ACRESCENTAR. O
-- representante legal cadastrado na PJ da vendedora (`apolo_relationships`) continua sendo a fonte
-- do primeiro assinante; as linhas daqui SOMAM a ele. Por isso `origem`: uma linha que veio do
-- cadastro da empresa é diferente de uma que alguém digitou, e apagar a primeira não pode significar
-- "esta empresa não tem representante".
--
-- ATENCAO 3: `posicao` E `ordem_assinatura` SÃO PERGUNTAS DIFERENTES, e continuam sendo.
-- `posicao` diz QUAL LINHA do contrato é daquela pessoa; `ordem_assinatura` diz QUANDO ela recebe o
-- convite. Lucas: *"dentro das testemunha eu posso colocar uma testemunha assina na ordem 1 e outra
-- na ordem 4"*. A que assina primeiro pode ser a que aparece embaixo no papel.
--
-- ATENCAO 4: A POSIÇÃO É ÚNICA DENTRO DO PAPEL, não do empreendimento. Vendedora 1 e testemunha 1
-- convivem: são linhas diferentes do contrato. Um índice único sem o papel faria a segunda
-- testemunha brigar com a primeira vendedora, e o operador veria "posição ocupada" sem entender.
--
-- ATENCAO 5: "COORDENADOR DE VENDAS" É A PESSOA; "COORDENAÇÃO DE VENDAS" É A EMPRESA. O vocabulário
-- estava trocado no Panteon e custou caro: o cadastro apontava como coordenadora a entidade certa,
-- mas pendurava nela como representante o FABRÍCIO — que no C2X é o CAPTADOR, campo diferente
-- (`captivator_id`), não o coordenador (`manager_id`, que no Villa Paris é o Matheus Guedes
-- Imóveis). Um contrato gerado assim mandaria assinar a pessoa errada, com a tela toda dizendo que
-- estava certo.
--
-- Autorização do Lucas: PENDENTE — escrita, esperando o OK para aplicar.

alter table if exists public.temis_testemunhas rename to temis_assinantes;

-- ⚠️ DEFAULT 'testemunha' NO ALTER, e sem default depois. As linhas que existissem seriam todas
-- testemunha (era o que a tabela guardava); linha nova tem de DIZER o papel, porque errar aqui põe
-- a pessoa no lugar errado do contrato.
alter table public.temis_assinantes
  add column if not exists papel text not null default 'testemunha';
alter table public.temis_assinantes alter column papel drop default;

alter table public.temis_assinantes
  add column if not exists origem text;

alter table public.temis_assinantes drop constraint if exists temis_assinantes_papel;
alter table public.temis_assinantes
  add constraint temis_assinantes_papel
  check (papel in ('coordenador', 'testemunha', 'vendedora'));

comment on table public.temis_assinantes is
  'O quadro de assinatura do empreendimento: as pessoas que assinam como vendedora, coordenador de vendas ou testemunha. Comprador e conjuge NAO moram aqui - eles saem da proposta.';
comment on column public.temis_assinantes.papel is
  'vendedora | coordenador | testemunha. Ver ATENCAO 1 e 5 da migration 0158.';
comment on column public.temis_assinantes.origem is
  'De onde a linha veio: nulo = digitada no quadro; "representante" = herdada do cadastro da PJ.';

-- A posicao e unica DENTRO do papel (ATENCAO 4).
drop index if exists public.temis_testemunhas_posicao_por_empreendimento;
drop index if exists public.temis_testemunhas_por_empreendimento;

create unique index if not exists temis_assinantes_posicao_por_papel
  on public.temis_assinantes (workspace_id, enterprise_id, papel, posicao)
  where ativo;

create index if not exists temis_assinantes_por_empreendimento
  on public.temis_assinantes (workspace_id, enterprise_id, papel, posicao)
  where ativo;

-- A RLS acompanha a tabela no rename, mas repetir e barato e o dia em que alguem recriar isto na
-- mao, a linha esta aqui.
alter table public.temis_assinantes enable row level security;
