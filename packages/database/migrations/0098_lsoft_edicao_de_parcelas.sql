-- 0098 · EDIÇÃO DE PARCELAS DO LSOFT, COM TRILHA
--
-- Pedido do Lucas (19/08/2026): "na parcela deixa editável também, data de vencimento, se foi pago
-- ou não e alterar o valor. (lembrando que tudo tem que ficar registrado o que mudou, quem mudou)".
--
-- ⚠️ ISSO SÓ É SEGURO PORQUE A CARGA FOI ÚNICA. Enquanto havia sincronismo previsto, editar valor
-- de parcela criaria uma segunda verdade financeira que o próximo import apagaria. Com a decisão
-- de não recarregar ("não terá nova carga da LSoft, vai ser somente essa"), este banco passou a
-- ser a fonte — e corrigir aqui é a única forma de arrumar o que veio errado do Access.
--
-- ⚠️ A TRILHA É A MESMA DO CLIENTE, de propósito. Uma tabela separada para parcelas obrigaria a
-- ficha a juntar dois históricos para contar uma história só ("mudaram o vencimento e depois o
-- cadastro"). Aqui a linha de parcela apenas aponta para qual parcela era.

alter table public.lsoft_clientes_edicoes
  -- Nulo quando a edição foi no cadastro do cliente; preenchido quando foi numa parcela.
  add column if not exists parcela_id uuid references public.lsoft_parcelas (id) on delete cascade,
  -- O rótulo humano da parcela ("007/084 · 10/08/2026"), congelado no momento da edição. A parcela
  -- pode ser editada depois, e o histórico precisa dizer o que ela ERA quando a mudança aconteceu.
  add column if not exists parcela_rotulo text;

create index if not exists lsoft_edicoes_parcela_idx
  on public.lsoft_clientes_edicoes (parcela_id)
  where parcela_id is not null;

-- Quem mexeu na parcela e quando — para a lista mostrar a marca de "ajustada à mão" sem precisar
-- consultar a trilha em toda carga.
alter table public.lsoft_parcelas
  add column if not exists editada_em timestamptz,
  add column if not exists editada_por text;
