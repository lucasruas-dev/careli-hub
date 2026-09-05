-- 0131 · A PROPOSTA QUE NASCE NO PANTEON
--
-- Lucas (04/09/2026): *"primeiro é qualificar o cliente (...) depois que qualificar o cliente ou os
-- clientes, vamos montar a proposta, aí é abrir o simulador mesmo, escolheu o plano proposta
-- cadastrada"*.
--
-- ⚠️ POR QUE `hercules_propostas` E NÃO `hercules_vendas`. A tabela de vendas (0112) exige
-- `plano_id NOT NULL` contra `temis_planos` e `comprador_entity_id NOT NULL` — e nenhum dos dois
-- existe no momento em que a proposta é gerada: o comprador pode não ter entidade no Apolo e o
-- plano vem do C2X, que não tem id no Panteon. `hercules_propostas` já é a tabela que a tela Venda
-- LÊ (funil, grade, mapa, lista): a proposta nativa entra no fluxo pelo mesmo caminho das 4.857
-- importadas, sem ensinar cada peça da tela a conhecer uma segunda fonte.
--
-- ⚠️ `origem` COM DEFAULT 'c2x' É A BLINDAGEM CONTRA A LIÇÃO DO LSOFT (onde uma recarga apagou
-- classificação feita à mão): a partir daqui, todo delete de recarga precisa dizer
-- `where origem = 'c2x'`, e o que nasceu aqui sobrevive.
--
-- ⚠️ O COD É COPIADO DA RESERVA, NUNCA UM `nextval` NOVO. É a regra da 0129: `000123` na reserva é
-- `000123` no contrato assinado seis meses depois. Um código novo na proposta quebraria a única
-- coisa que amarra a venda de ponta a ponta.
--
-- ⚠️ TRÊS COLUNAS QUE O LUCAS PEDIU JÁ EXISTIAM e não são criadas de novo: `primeiro_sinal`
-- (a data da primeira parcela da entrada), `parcelas_sinal` (em quantas vezes) e `dia_vencimento`.
--
-- ⚠️ CINCO COLUNAS DESTA TABELA NÃO ESTÃO EM MIGRATION NENHUMA (`plano_parcelas`,
-- `contrato_parcelas`, `plano_correcao`, `plano_juros`, `plano_personalizado`): foram criadas fora
-- do versionamento. Ficam registradas aqui para quem for reconstruir o schema do zero não se perder.

alter table public.hercules_propostas
  add column if not exists origem                text not null default 'c2x',
  add column if not exists reserva_id            uuid references public.hercules_reservas (id) on delete set null,
  add column if not exists protocolo_numero      bigint,
  add column if not exists condicoes             jsonb,
  add column if not exists cliente_entity_id     uuid,
  add column if not exists imobiliaria_entity_id uuid,
  add column if not exists corretor_entity_id    uuid,
  add column if not exists criado_por            text,
  add column if not exists criado_por_nome       text,
  add column if not exists cancelada_em          timestamptz,
  add column if not exists cancelada_motivo      text,
  add column if not exists cancelada_por         text,
  add column if not exists cancelada_por_nome    text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hercules_propostas_origem'
  ) then
    alter table public.hercules_propostas
      add constraint hercules_propostas_origem check (origem in ('c2x', 'panteon'));
  end if;
end $$;

-- O COD é único quando existe. As 4.857 importadas ficam com nulo — o legado não tem código, e
-- inventar um daria número novo para venda antiga a cada carga.
create unique index if not exists hercules_propostas_protocolo_uidx
  on public.hercules_propostas (protocolo_numero)
  where protocolo_numero is not null;

-- ⚠️ UMA PROPOSTA NATIVA VIVA POR UNIDADE, e o recorte `origem = 'panteon'` é deliberado: a carga
-- do C2X entra em lotes e um 23505 mataria o lote inteiro. Esta trava existe para o clique duplo do
-- coordenador, não para policiar o legado.
create unique index if not exists hercules_propostas_uma_viva_por_unidade
  on public.hercules_propostas (unidade_id)
  where origem = 'panteon' and etapa in ('reservado', 'proposta', 'contrato', 'assinatura');

create index if not exists hercules_propostas_por_reserva
  on public.hercules_propostas (reserva_id)
  where reserva_id is not null;

comment on column public.hercules_propostas.origem is
  'c2x = veio da carga do legado; panteon = nasceu aqui. Todo delete de recarga filtra por origem = c2x.';

comment on column public.hercules_propostas.protocolo_numero is
  'O numero cru do COD, COPIADO da reserva. A forma (000123) sai de codigoDaVenda, num lugar so.';

comment on column public.hercules_propostas.condicoes is
  'O cronograma inteiro no ato da geracao: entrada datada, anuais, mensais e faixas de reajuste. E o que o PDF imprimiu.';
