-- 0132 · ATÉ QUANDO A PROPOSTA VALE
--
-- Lucas (05/09/2026): *"vamos fazer igual a reserva, colocar os dias de prazo, 3 - 5 - 7 - 10"*.
--
-- ⚠️ PREÇO TEM PRAZO. A tabela sobe, o lote é vendido para outro, o crédito vence — uma proposta
-- sem validade é uma promessa que o comercial não consegue cumprir seis meses depois, com o papel
-- na mão do cliente. O PDF já imprimia "os valores acima valem até…" desde o mockup; o que faltava
-- era a data existir no banco em vez de ser calculada de novo a cada leitura.
--
-- ⚠️ OS PRAZOS SÃO MAIORES QUE OS DA RESERVA (1 a 7 dias), e a diferença é do negócio: a reserva
-- segura o lote e por isso é curta; a proposta espera o cliente decidir, conversar em casa e o
-- crédito andar. A lista vive em `PRAZOS_DA_PROPOSTA`, não aqui — o banco guarda a data escolhida,
-- não a régua que a escolheu.
--
-- ⚠️ NULO NAS 4.857 IMPORTADAS, e fica assim: o C2X não tem validade de proposta, e inventar uma
-- data para venda antiga faria a tela vencer sozinha o que já virou contrato.

alter table public.hercules_propostas
  add column if not exists validade_em timestamptz;

comment on column public.hercules_propostas.validade_em is
  'Ate quando a proposta vale. Nulo nas importadas do C2X, que nao tem prazo. Vence no fim do dia, como a reserva.';

-- Para a varredura que um dia vai marcar as vencidas: só as nativas vivas interessam.
create index if not exists hercules_propostas_validade
  on public.hercules_propostas (validade_em)
  where origem = 'panteon' and validade_em is not null and etapa = 'proposta';
