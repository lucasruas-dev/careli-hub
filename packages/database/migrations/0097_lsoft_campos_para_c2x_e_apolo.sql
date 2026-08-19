-- 0097 · CAMPOS PARA LEVAR A CARTEIRA DO LSOFT AO C2X E AO APOLO
--
-- Pedido do Lucas (19/08/2026): "quero deixar todos os campos necessários para gente importar para
-- dentro do C2X, quero criar esses campos... rodar todos os clientes na MOST para enriquecer essa
-- base, falta muita coisa... os usuários do empreendimento CER vão atualizar e validar os dados".
--
-- DE ONDE SAI A LISTA: `montarClienteIntegracao` em lib/apolo/c2x-integracao.ts — o payload que o
-- C2X aceita em POST /api/v1/integrations/panteon/users. O LSoft (Access da Cecílio) traz nome,
-- CPF, RG, endereço sem número, contatos e filiação; TODO O RESTO abaixo não existe lá.
--
-- ⚠️ TRÊS ORIGENS, E A TELA PRECISA DIFERENCIAR:
--   1. LSOFT      — veio do Access, é o que já tínhamos.
--   2. MOST       — enriquecimento por CPF (basic_data, phones, emails, financial_data).
--   3. VALIDAÇÃO  — pessoa do CER conferindo/completando o que nenhuma base entrega.
-- Sem saber a origem, ninguém decide se confia no dado — e o C2X recusa cadastro incompleto.
--
-- ⚠️ ESTADO CIVIL É SEMPRE HUMANO. Medido em 10/jul (memória do enriquecimento): o `basic_data` do
-- MOST NÃO devolve estado civil nem nome do pai. Como o C2X exige `property_regime_id` quando
-- casado, esse par só se fecha na validação — é o principal motivo de a tela do CER existir.

-- ── OS CAMPOS QUE O C2X PEDE ────────────────────────────────────────────────
alter table public.lsoft_clientes
  -- Identificação que o MOST completa
  add column if not exists sexo text,
  add column if not exists nome_pai text,

  -- Só pessoa: nenhuma base pública entrega
  add column if not exists estado_civil text,
  add column if not exists regime_bens text,
  add column if not exists escolaridade text,
  add column if not exists profissao text,
  add column if not exists naturalidade text,
  add column if not exists nacionalidade text default 'Brasileira',

  -- Renda: o MOST estima em `financial_data`; a validação confirma
  add column if not exists faixa_renda text,
  add column if not exists renda_estimada numeric(14, 2),

  -- ⚠️ O ENDEREÇO DO LSOFT NÃO TEM NÚMERO. Vem "RUA FERNANDO OTAVIO" e para por aí; o C2X exige o
  -- número. Por isso número e complemento são campos próprios, e não um remendo no `endereco`.
  add column if not exists numero text,
  add column if not exists complemento text,

  -- O par que dá visibilidade comercial no C2X: quem vinculou o cliente e em qual empreendimento.
  -- Sem eles o cadastro entra órfão e não aparece para ninguém.
  add column if not exists imobiliaria_documento text,
  add column if not exists enterprise_c2x_code text,

  -- ── ENRIQUECIMENTO ────────────────────────────────────────────────────────
  add column if not exists enriquecido_em timestamptz,
  -- A resposta crua do MOST, para conferir de onde veio cada campo sem consultar de novo (cada
  -- consulta é cobrada em reais, por dataset).
  add column if not exists enriquecimento jsonb,
  add column if not exists enriquecimento_erro text,

  -- ── VALIDAÇÃO PELO CER ────────────────────────────────────────────────────
  -- `pendente` (nada conferido) · `em_analise` (alguém mexeu, falta campo) · `validado` (pronto
  -- para importar) · `dispensado` (não vai para o C2X, com motivo).
  add column if not exists status_validacao text not null default 'pendente',
  add column if not exists validado_por text,
  add column if not exists validado_em timestamptz,
  add column if not exists observacao_validacao text;

alter table public.lsoft_clientes
  drop constraint if exists lsoft_clientes_status_validacao_check;

alter table public.lsoft_clientes
  add constraint lsoft_clientes_status_validacao_check
  check (status_validacao in ('pendente', 'em_analise', 'validado', 'dispensado'));

create index if not exists lsoft_clientes_status_idx on public.lsoft_clientes (status_validacao);

-- ── TRILHA DE EDIÇÃO ────────────────────────────────────────────────────────
--
-- ⚠️ QUEM VAI EDITAR É GENTE DE FORA DA CARELI (usuários do portal do CER). Toda alteração fica
-- registrada com autor, valor anterior e valor novo: sem isso, um dado que mudar sozinho vira
-- discussão sem prova, e não há como desfazer uma correção errada.
create table if not exists public.lsoft_clientes_edicoes (
  id uuid primary key default gen_random_uuid(),
  cliente_codigo text not null references public.lsoft_clientes (codigo) on delete cascade,
  campo text not null,
  valor_anterior text,
  valor_novo text,
  autor text not null,
  -- 'careli' (time interno pelo /lsoft) ou 'incorporador' (portal do CER).
  autor_origem text not null default 'careli',
  criado_em timestamptz not null default now()
);

create index if not exists lsoft_edicoes_cliente_idx
  on public.lsoft_clientes_edicoes (cliente_codigo, criado_em desc);

alter table public.lsoft_clientes_edicoes enable row level security;

-- ── O RESUMO GANHA O STATUS ─────────────────────────────────────────────────
-- A tela precisa listar "quem falta validar", que é o trabalho do CER. Recriada porque view no
-- Postgres não aceita coluna nova em `create or replace` fora da ordem original.
drop view if exists public.lsoft_carteira_por_cliente;

create view public.lsoft_carteira_por_cliente as
select
  c.codigo,
  c.nome,
  c.cpf,
  c.cpf_formatado,
  c.celular,
  c.telefone,
  c.email,
  c.cidade,
  c.empreendimentos,
  c.status_validacao,
  c.enriquecido_em,
  -- Quantos dos campos que o C2X exige já estão preenchidos, de 9. É o "quanto falta" que a tela
  -- mostra como barra, e o que separa quem está pronto para importar de quem ainda não está.
  (case when c.sexo is not null then 1 else 0 end
   + case when c.estado_civil is not null then 1 else 0 end
   + case when c.escolaridade is not null then 1 else 0 end
   + case when c.profissao is not null then 1 else 0 end
   + case when c.faixa_renda is not null then 1 else 0 end
   + case when c.naturalidade is not null then 1 else 0 end
   + case when c.numero is not null then 1 else 0 end
   + case when c.nascimento is not null then 1 else 0 end
   + case when c.mae is not null then 1 else 0 end) as campos_c2x_preenchidos,
  9 as campos_c2x_total,
  count(p.id) as parcelas,
  count(p.id) filter (where p.paga) as parcelas_pagas,
  count(p.id) filter (where not p.paga) as parcelas_abertas,
  count(p.id) filter (where not p.paga and p.vencimento < current_date) as parcelas_vencidas,
  coalesce(sum(p.valor) filter (where not p.paga), 0) as saldo_aberto,
  coalesce(sum(p.valor) filter (where not p.paga and p.vencimento < current_date), 0) as saldo_vencido,
  coalesce(sum(p.valor_recebido) filter (where p.paga), 0) as total_recebido,
  min(p.vencimento) filter (where not p.paga) as proximo_vencimento,
  array_remove(array_agg(distinct
    case when p.quadra is not null or p.lote is not null
         then concat_ws(' ', nullif('Q' || p.quadra, 'Q'), nullif('L' || p.lote, 'L'))
    end), null) as unidades
from public.lsoft_clientes c
left join public.lsoft_parcelas p on p.cliente_codigo = c.codigo
group by c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
         c.empreendimentos, c.status_validacao, c.enriquecido_em, c.sexo, c.estado_civil,
         c.escolaridade, c.profissao, c.faixa_renda, c.naturalidade, c.numero, c.nascimento, c.mae;
