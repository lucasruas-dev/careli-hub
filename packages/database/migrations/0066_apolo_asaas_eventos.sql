-- Apolo/pré-venda: EVENTOS do webhook do Asaas (bancada de teste + base da pré-venda).
--
-- Registra CADA notificação que o Asaas manda (PAYMENT_CREATED, PAYMENT_RECEIVED, etc). Serve pra:
--  (1) na bancada, VER ao vivo o que o Asaas envia ao pagar — em especial se o payload traz a HORA
--      do pagamento (achado 21/jul: paymentDate é só 'date', sem hora, o que empataria a fila);
--  (2) na pré-venda de verdade, `recebido_em` (carimbo NOSSO, com hora) é o desempate da ordem da
--      fila do Prometeu quando o paymentDate do Asaas não basta.
--
-- payload/headers guardados crus pra auditoria e pra descobrir o desenho (a doc do Asaas não
-- detalha a autenticação do webhook). recebido_em usa clock_timestamp() = instante real do insert.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

create table if not exists public.apolo_asaas_eventos (
  id uuid primary key default gen_random_uuid(),
  -- Tipo do evento (event do payload): PAYMENT_CREATED | PAYMENT_RECEIVED | PAYMENT_CONFIRMED | ...
  evento text,
  asaas_payment_id text,
  asaas_customer_id text,
  external_reference text,
  status text,
  billing_type text,
  value numeric,
  -- A "data" do pagamento COMO O ASAAS MANDA (pra evidenciar a falta de hora).
  payment_date text,
  -- dateCreated da RAIZ do payload (tem hora; candidato a desempate secundário).
  date_created_raiz text,
  payload jsonb,
  headers jsonb,
  -- Carimbo NOSSO, com hora — o desempate autoritativo da ordem da fila.
  recebido_em timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default now()
);

create index if not exists apolo_asaas_eventos_payment_idx
  on public.apolo_asaas_eventos (asaas_payment_id, recebido_em desc);
create index if not exists apolo_asaas_eventos_recebido_idx
  on public.apolo_asaas_eventos (recebido_em desc);

comment on table public.apolo_asaas_eventos is
  'Eventos do webhook do Asaas (pré-venda). recebido_em (com hora) e o desempate da fila; payload cru guardado.';
