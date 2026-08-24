-- 0102 · Proponentes da reserva (Lucas, 24/08: "na hora da reserva eu tenho que ter a opção
-- de colocar mais de um proponente, e caso isso aconteça eu tenho que definir a % de
-- participação, no c2x o limite é de 5 proponentes").
--
-- Array de {credenciadoId, nome, documento, percentual} gravado IGUAL em todas as linhas do
-- grupo (as unidades do mesmo cupom compartilham os proponentes). O 1º é o titular
-- (credenciado_id da linha); a soma dos percentuais fecha 100.

alter table public.prometeu_reservas
  add column if not exists proponentes jsonb not null default '[]'::jsonb;
