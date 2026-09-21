-- 0181 — QUEM VINCULOU A UNIDADE À DIVISÃO E À CATEGORIA, QUANDO E POR ONDE
--
-- ✅ APLICADA EM PRODUÇÃO em 21/09/2026, com OK do Lucas ("tem o meu ok"), antes do código.
-- Conferida depois no schema: colunas, CHECK, FK e índices.
--
-- Lucas (21/09/2026): *"eu preciso também vincular as unidades no filho, categoria (quando
-- existir), ou seja, eu ainda não tenho esse fluxo pronto e preciso"*. E em 15/09/2026, sobre as
-- formas: *"vai ocorrer das duas formas, normalmente vamos subir em massa essa configuração na
-- importação de unidades, mas teremos cenários que precisamos cadastrar uma unidade nova e apontar
-- essa estrutura, ou até mesmo atualizar"*.
--
-- ⚠️ O VÍNCULO EM SI JÁ EXISTE, E POR ISSO NÃO ESTÁ AQUI. `hercules_unidades.categoria_id` nasceu na
-- 0139 (FK para `temis_categorias`, ON DELETE SET NULL) e `enterprise_id` É o vínculo com a divisão
-- desde a 0112. Medido em 21/09/2026: 907 unidades já apontam para categoria e 5.504 das 5.541 já
-- apontam para a divisão certa. Coluna nova para a mesma informação seria a duplicação que a 0161
-- existe para acabar.
--
-- ⚠️ O QUE FALTA É O CARIMBO. Até hoje as 907 linhas com categoria foram preenchidas por UPDATE cru
-- no banco: não há como responder "quem carimbou este lote de Condomínio, e quando?". A partir dos
-- três caminhos novos (planilha, ficha da unidade, seleção em massa) essa pergunta passa a ter
-- resposta possível — e `atualizado_em` NÃO serve de carimbo, porque as migrations 0161 e 0162
-- reescreveram esse campo em 710 linhas sem que nada tivesse acontecido com as unidades.
--
-- ⚠️ O QUARTETO É O PADRÃO DA CASA, copiado de propósito da 0163 (o bloqueio de unidade): quando,
-- quem (uuid), o nome COPIADO no ato e — a diferença aqui — POR ONDE. A origem existe porque os três
-- caminhos erram de jeitos diferentes: uma planilha carimba 400 lotes de uma vez e um acento errado
-- no nome da categoria vira um estrago em massa; a ficha carimba um. Saber por onde entrou é o que
-- permite desfazer o lote certo.
--
-- ⚠️ `vinculo_por_nome` É CÓPIA, E ISSO É DELIBERADO. A pessoa sai da empresa, o cadastro dela muda,
-- e o histórico tem de continuar dizendo quem foi naquele dia. É a mesma decisão de
-- `bloqueado_por_nome` (0163) e de `cancelada_por_nome` (`hercules_reservas`).
--
-- ⚠️ O CARIMBO GUARDA O ÚLTIMO ATO, NÃO A SÉRIE. É o que a casa faz hoje para unidade (o bloqueio
-- tem um carimbo, não um log). Histórico com N atos por lote pede tabela própria, e não é decisão
-- para tomar de passagem: `hercules_proposta_eventos` existe para a proposta justamente porque lá a
-- transição É o produto. Se o Lucas quiser a série para a unidade, o caminho é uma
-- `hercules_unidade_eventos` alimentada por esta mesma porta.
--
-- ⚠️ NADA AQUI TRAVA O QUE JÁ EXISTE. As quatro colunas nascem nulas e nulas continuam nas 5.541
-- linhas de hoje — inclusive nas 907 com categoria, que ninguém daqui carimbou. Quem lê precisa
-- saber distinguir "vínculo do UPDATE cru" (sem autor) de "vínculo nosso" (com autor), e a ausência
-- é exatamente esse sinal.
--
-- ⚠️ E O CÓDIGO RODA SEM ELA. `lib/apolo/vinculo-de-unidades-servidor.ts` tenta gravar com o carimbo
-- e repete sem ele quando o Postgres responde 42703/PGRST204 (coluna ausente) ou 23514 (o CHECK
-- abaixo recusando um valor de origem que uma versão futura da tela invente). O vínculo é o que não
-- pode faltar; o carimbo é o detalhe.

alter table public.hercules_unidades
  add column if not exists vinculo_em timestamptz,
  add column if not exists vinculo_por uuid,
  add column if not exists vinculo_por_nome text,
  add column if not exists vinculo_origem text;

comment on column public.hercules_unidades.vinculo_em is
  'Quando a divisao ou a categoria desta unidade foi definida NO PANTEON. Nulo = vinculo anterior a 0181 (as 907 linhas carimbadas por UPDATE cru), sem autor conhecido.';

comment on column public.hercules_unidades.vinculo_por is
  'apolo_incorporador_usuarios.id (portal) ou o usuario do hub que vinculou. Sem FK, pelo mesmo motivo de bloqueado_por (0163): o portal e o cadastro vivem em esquemas que se soltam.';

comment on column public.hercules_unidades.vinculo_por_nome is
  'Nome de quem vinculou, COPIADO no ato. Nao resolver por join: o historico tem de dizer quem era naquele dia.';

comment on column public.hercules_unidades.vinculo_origem is
  'Por onde o vinculo entrou: planilha (importacao de vinculo), ficha (a unidade, uma a uma) ou massa (selecao por quadra, faixa de lotes ou filtro).';

-- ⚠️ O CHECK ACEITA NULO, porque nulo é o estado das 5.541 linhas de hoje e continuará sendo o de
-- toda unidade que ninguém tocar. Ele só impede que um quarto nome apareça sem decisão: origem é
-- vocabulário, e vocabulário que cresce sozinho vira relatório que ninguém consegue somar.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hercules_unidades_vinculo_origem_valida'
  ) then
    alter table public.hercules_unidades
      add constraint hercules_unidades_vinculo_origem_valida
      check (vinculo_origem is null or vinculo_origem in ('ficha', 'massa', 'planilha'));
  end if;
end $$;

-- ⚠️ O ÍNDICE É PARA A PERGUNTA QUE VAI EXISTIR: "o que NÓS vinculamos neste empreendimento, e
-- quando?" — a consulta que separa o carimbo nosso do vínculo herdado do UPDATE cru. Parcial porque
-- só interessa quem tem carimbo: hoje seriam zero linhas de 5.541.
create index if not exists hercules_unidades_vinculo_carimbado
  on public.hercules_unidades (enterprise_id, vinculo_em)
  where vinculo_em is not null;

-- RLS: nada a fazer. `hercules_unidades` já tem a política da 0112 e estas colunas entram na mesma
-- linha; não há tabela nova, não há grant novo, e toda escrita continua passando pelo service role
-- das rotas (o anon nunca escreveu aqui).
