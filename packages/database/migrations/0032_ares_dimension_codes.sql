-- Ares - codigos sequenciais para setup financeiro.
-- Preenche cadastros existentes sem codigo e mantem a geracao futura no backend.

begin;

with max_existing_code as (
  select coalesce(max(code::integer), 0) as value
  from public.ares_financial_dimensions
  where code is not null
    and code ~ '^[0-9]+$'
),
missing_codes as (
  select
    id,
    row_number() over (order by created_at, id) as sequence_number
  from public.ares_financial_dimensions
  where code is null
)
update public.ares_financial_dimensions dimension
set
  code = lpad(
    (max_existing_code.value + missing_codes.sequence_number)::text,
    5,
    '0'
  ),
  updated_at = now()
from missing_codes, max_existing_code
where dimension.id = missing_codes.id;

commit;
