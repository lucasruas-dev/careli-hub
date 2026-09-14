-- 0163 — O BLOQUEIO DE UNIDADE GANHA AUTOR E DATA
--
-- Lucas (14/09/2026): *"o coordenador pode bloquear as unidades. então vamos ter que ter um botão
-- que bloqueia essa unidade ae ter um campo de justificativa do bloqueio"* e, logo depois, a regra
-- que fecha o portão: *"não pode ter nenhuma proposta, reserva, contrato, o bloqueio aparece
-- somente quando não há nada na unidade"*.
--
-- ⚠️ A JUSTIFICATIVA JÁ EXISTE, E POR ISSO ELA NÃO ESTÁ AQUI. `hercules_unidades.bloqueio_motivo`
-- nasceu com a tabela (0112, linha 59) e está VAZIA em 100% das 5.541 linhas — ninguém nunca
-- escreveu nela, e não há um único leitor no repositório. Criar coluna nova para o mesmo fato seria
-- a duplicação que esta casa vem pagando o dia inteiro.
--
-- ⚠️ O QUE FALTA É O AUTOR E A DATA, e sem eles o bloqueio vira um fato sem dono. Medido: as 1.554
-- unidades hoje `bloqueada` são RETRATO DO C2X de 01/09 — nenhuma decisão tomada no Panteon. A
-- partir do botão novo, a pergunta "quem tirou este lote da venda, e quando?" passa a ter resposta
-- possível, e hoje ela não tem: `atualizado_em` NÃO serve de carimbo, porque as migrations 0161 e
-- 0162 reescreveram esse campo em 710 linhas sem que nada tivesse acontecido com as unidades.
--
-- ⚠️ O QUARTETO É O PADRÃO DA CASA, e está copiado de propósito. `hercules_reservas` tem
-- `cancelada_em`, `cancelada_motivo`, `cancelada_por`, `cancelada_por_nome`; `hercules_propostas`
-- repete. Todo ato que tira algo de circulação carrega os quatro. O bloqueio só tinha o motivo.
--
-- ⚠️ `bloqueado_por_nome` É CÓPIA, E ISSO É DELIBERADO. O nome de quem bloqueou fica gravado no
-- momento do ato, e não resolvido por join depois: a pessoa sai da empresa, o cadastro dela muda, e
-- o histórico tem de continuar dizendo quem foi naquele dia. É a mesma decisão de `cancelada_por_nome`.
--
-- ⚠️ NADA AQUI TRAVA O QUE JÁ EXISTE. As três colunas nascem nulas e nulas continuam nas 1.554
-- linhas que vieram do C2X — elas não foram bloqueadas por ninguém daqui, e inventar um autor para
-- elas seria mentir no registro. Quem lê precisa saber distinguir "bloqueio do legado" (sem autor)
-- de "bloqueio nosso" (com autor), e a ausência é exatamente esse sinal.

alter table public.hercules_unidades
  add column if not exists bloqueado_em timestamptz,
  add column if not exists bloqueado_por uuid,
  add column if not exists bloqueado_por_nome text;

comment on column public.hercules_unidades.bloqueio_motivo is
  'Por que a unidade foi tirada da venda. Preenchido pelo coordenador na tela Venda. Nulo nos 1.554 bloqueios que vieram do retrato do C2X de 01/09.';

comment on column public.hercules_unidades.bloqueado_em is
  'Quando o bloqueio foi feito NO PANTEON. Nulo = bloqueio herdado do C2X, sem autor conhecido.';

comment on column public.hercules_unidades.bloqueado_por is
  'apolo_incorporador_usuarios.id de quem bloqueou. Sem FK: o portal e o cadastro vivem em esquemas que se soltam, e um bloqueio nao pode impedir a remocao de um usuario.';

comment on column public.hercules_unidades.bloqueado_por_nome is
  'Nome de quem bloqueou, COPIADO no ato. Nao resolver por join: o historico tem de dizer quem era naquele dia.';

-- ⚠️ O ÍNDICE É PARA A PERGUNTA QUE VAI EXISTIR. "Quais lotes NÓS bloqueamos?" é a consulta que
-- separa o bloqueio nativo do herdado, e ela é o que a carga do C2X precisa fazer antes de
-- sobrescrever `situacao` — ver o aviso no topo de `scripts/hercules/carregar-unidades-do-c2x.mjs`.
-- Parcial porque só interessa quem tem carimbo: hoje seriam zero linhas de 5.541.
create index if not exists hercules_unidades_bloqueio_nativo
  on public.hercules_unidades (enterprise_id, bloqueado_em)
  where bloqueado_em is not null;
