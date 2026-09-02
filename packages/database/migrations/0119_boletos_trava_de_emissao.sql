-- A TRAVA QUE IMPEDE COBRAR DUAS VEZES.
--
-- Incidente em 02/09/2026, durante o teste: o Lucas clicou em "gerar boleto", a chamada demorou,
-- ele clicou de novo — e o Asaas criou DUAS cobranças para a mesma parcela.
--
-- A rota já consultava o Asaas antes de criar ("consulta antes de criar, sempre"), e essa consulta
-- resolve o caso sequencial: recarregar a página e clicar de novo. Ela não resolve o simultâneo.
-- Dois cliques em segundos são duas requisições em voo ao mesmo tempo: as duas perguntam "já
-- existe?", as duas ouvem "não", e as duas criam. É corrida, e corrida não se conserta com mais
-- consulta — só com algo que o banco serialize.
--
-- `UPDATE ... WHERE emissao_iniciada_em IS NULL` é atômico no Postgres: das duas requisições, uma
-- afeta a linha e a outra afeta zero. Quem afetou zero não emite.
--
-- ⚠️ A MARCA PRECISA EXPIRAR. Se o processo morrer entre marcar e criar, a parcela ficaria travada
-- para sempre e ninguém emitiria — pior do que o problema original. Quem lê a trava trata como
-- livre o que está marcado há mais de 5 minutos: uma emissão nunca demora isso, e uma marca velha
-- é sinal de processo morto, não de emissão em curso.
alter table public.boletos_parcelas
  add column if not exists emissao_iniciada_em timestamptz;

comment on column public.boletos_parcelas.emissao_iniciada_em is
  'Trava contra emissão simultânea. Marcada logo antes de criar no Asaas e limpa ao terminar; considerada livre depois de 5 minutos.';
