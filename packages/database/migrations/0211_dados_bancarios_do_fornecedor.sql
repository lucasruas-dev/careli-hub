-- 0211 · OS DADOS BANCÁRIOS E O PIX DO FORNECEDOR (cadastro de fornecedor no Apolo)
--
-- ⛔ NÃO APLICADA. Escrita em 02/10/2026 junto com o código; aplicar só com OK explícito do Lucas.
-- ⚠️ O NÚMERO É PROVISÓRIO: a 0209 está reservada na branch do comprador Cecílio, e quem publica
-- confere o próximo número livre na hora de integrar.
--
-- POR QUE ELA EXISTE. Lucas (02/10/2026), ao habilitar o cadastro de fornecedor: o cadastro guarda
-- dados bancários e PIX "já nesta entrega", e é obrigatório ter UMA forma de pagar — a conta completa
-- (banco, agência, conta) ou uma chave PIX. A regra mora em apps/hub/lib/apolo/dados-bancarios.ts.
--
-- ⚠️ TABELA PRÓPRIA, E NÃO `apolo_entities.metadata`, por dois motivos:
--   1. o sync do C2X substitui o jsonb INTEIRO (mesmo motivo da 0072, da 0183 e da 0193). O fornecedor
--      não sobe para o C2X, mas a MESMA PESSOA pode ser cliente vindo de lá, e o próximo sync apagaria
--      a conta dela sem aviso;
--   2. `metadata.cadastro` trafega na lista e na busca do CRM para todo leitor do Apolo. Conta e chave
--      PIX ficam fora disso: só a ficha as lê, por rota própria do servidor.
--
-- ⚠️ SÓ O SERVICE ROLE LÊ E GRAVA. RLS ligado e nenhuma política: `anon` e `authenticated` não chegam
-- aqui nem por engano. Quem lê é /api/apolo/entidades/[entityId]/dados-bancarios, depois de conferir o
-- acesso ao Apolo; quem grava é o salvar do cadastro (lib/apolo/cadastro-salvar.ts).
--
-- ⚠️ O QUE ACONTECE ENQUANTO ELA NÃO RODA, dito inteiro:
--   • NA ESCRITA: o cadastro de FORNECEDOR recusa com frase clara (503) ANTES de gravar qualquer coisa,
--     em vez de criar a ficha e perder a conta. Os outros cadastros (cliente, imobiliária, corretor) não
--     encostam nesta tabela e seguem normais.
--   • NA LEITURA: a ficha mostra "dados bancários indisponíveis" na seção do fornecedor. Nada mais quebra.
-- ORDEM DE ENTREGA: livre. O app funciona antes e depois.
--
-- UMA LINHA POR CONTA, e não uma por ficha: o fornecedor pode trocar de banco, e a conta antiga fica
-- `archived` para o histórico de pagamentos dizer para onde o dinheiro foi. Hoje o cadastro grava uma
-- e a ficha mostra as ativas.

create table if not exists public.apolo_entity_bank_accounts (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.apolo_entities(id) on delete cascade,

  -- A CONTA. Os três obrigatórios andam juntos (ver o CHECK `conta_inteira`).
  bank_code       text,
  bank_name       text,
  agency          text,
  account_number  text,
  account_type    text,

  -- O PIX.
  pix_key_type    text,
  pix_key         text,

  -- O titular, quando NÃO é o próprio fornecedor (nulo = a conta é dele).
  holder_name     text,
  holder_document text,

  status          text not null default 'active',
  -- `hub_users.id` de quem cadastrou. Sem FK, como `apolo_entities.owner_user_id`.
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint apolo_entity_bank_accounts_status check (status in ('active', 'archived')),
  constraint apolo_entity_bank_accounts_account_type check (
    account_type is null or account_type in ('corrente', 'poupanca', 'pagamento')
  ),
  constraint apolo_entity_bank_accounts_pix_type check (
    pix_key_type is null or pix_key_type in ('cpf', 'cnpj', 'email', 'telefone', 'aleatoria')
  ),
  -- Conta pela metade não paga ninguém: banco, agência e conta vêm os três, ou nenhum.
  constraint apolo_entity_bank_accounts_conta_inteira check (
    (bank_name is null and agency is null and account_number is null)
    or (
      btrim(coalesce(bank_name, '')) <> ''
      and btrim(coalesce(agency, '')) <> ''
      and btrim(coalesce(account_number, '')) <> ''
    )
  ),
  -- Tipo e chave do PIX andam juntos.
  constraint apolo_entity_bank_accounts_pix_inteiro check (
    (pix_key_type is null) = (pix_key is null)
  ),
  -- Ao menos uma forma de pagar (a regra do Lucas). A aplicação já recusa; o CHECK é a segunda camada.
  constraint apolo_entity_bank_accounts_uma_forma check (
    account_number is not null or pix_key is not null
  )
);

create index if not exists apolo_entity_bank_accounts_entity_idx
  on public.apolo_entity_bank_accounts (entity_id)
  where status = 'active';

alter table public.apolo_entity_bank_accounts enable row level security;
revoke all on public.apolo_entity_bank_accounts from anon, authenticated;

comment on table public.apolo_entity_bank_accounts is
  'Dados bancarios e PIX de uma entidade do Apolo (hoje: o fornecedor). So o service role le e grava; a ficha le por rota propria.';
comment on column public.apolo_entity_bank_accounts.holder_name is
  'Titular quando a conta NAO e do proprio fornecedor. Nulo = a conta e da entidade.';
comment on column public.apolo_entity_bank_accounts.pix_key is
  'Chave PIX normalizada: CPF/CNPJ so digitos, e-mail minusculo, celular +55DDDNUMERO, aleatoria UUID minusculo.';
comment on column public.apolo_entity_bank_accounts.status is
  'active = conta em uso; archived = conta antiga, guardada para o historico de pagamentos.';
