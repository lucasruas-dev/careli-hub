-- 0130 · QUEM CANCELOU A RESERVA
--
-- Lucas (04/09/2026): *"da reserva eu tenho dois caminhos, gerar proposta ou cancelar, tem que
-- habilitar esses dois botões quando está na etapa de reserva"*.
--
-- ⚠️ O MOTIVO JÁ EXISTIA (`cancelada_motivo`, migration 0125) e QUEM CANCELOU não. Faltava a
-- metade que a pergunta do mês seguinte precisa: "esta reserva caiu por quê" tem resposta desde
-- ontem; "e quem soltou o lote" não tinha. O histórico da unidade mostra "Reserva criada" com o
-- nome de quem criou — a linha de cancelamento aparecia sem autor nenhum.
--
-- ⚠️ O NOME VEM JUNTO DO ID, e é cópia de propósito: `criado_por_nome` faz o mesmo desde a 0125. A
-- conta do portal pode ser desativada, renomeada ou trocar de dono, e o histórico tem que continuar
-- dizendo quem agiu naquele dia — não quem tem aquele id hoje.

alter table public.hercules_reservas
  add column if not exists cancelada_por      text,
  add column if not exists cancelada_por_nome text;

comment on column public.hercules_reservas.cancelada_por is
  'Id da conta que cancelou (portal comercial ou hub). Par de criado_por.';

comment on column public.hercules_reservas.cancelada_por_nome is
  'O nome de quem cancelou, copiado no ato: o historico precisa dizer quem agiu naquele dia.';
