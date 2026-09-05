-- 0133 · FECHAR A PORTA DA TABELA DE PROPOSTAS
--
-- ⚠️ ISTO NÃO É MELHORIA, É VAZAMENTO ABERTO HOJE. Medido em produção antes de escrever esta
-- migration, com `set local role anon`:
--
--     select count(*), count(cliente_documento) from public.hercules_propostas;
--     -> 4857 | 4857
--
-- O papel `anon` lê as 4.857 propostas com nome e CPF, e a chave que veste esse papel é
-- NEXT_PUBLIC (apps/hub/lib/supabase/client.ts) — ela vai no bundle que qualquer visitante do
-- Panteon baixa. Os grants são SELECT, INSERT, UPDATE **e DELETE**.
--
-- ⚠️ É UM LAPSO DA 0126/0127, NÃO UMA DECISÃO. Toda irmã da mesma família fechou na hora em que
-- nasceu: `hercules_unidades` e `hercules_vendas` na 0112, `hercules_empreendimentos` e
-- `hercules_masterplans` na 0123, `hercules_reservas` na 0125. As três tabelas de proposta são as
-- únicas que ficaram de fora, e ficaram caladas porque PostgREST não avisa: ele responde 200.
--
-- ⚠️ E A ENTREGA DE HOJE PIORA O QUE ESTÁ EXPOSTO. Até agora a tabela era espelho do legado; a
-- partir do "Gerar proposta" ela passa a gravar `compradores` jsonb com nome, CPF **e telefone** de
-- cada proponente (o único lugar do sistema onde o contato do segundo comprador existe) e
-- `condicoes` com o desconto fechado de cada venda. Uma imobiliária lendo o valor negociado da
-- concorrente é o cenário óbvio; apagar a proposta de outro corretor é o que mais dói.
--
-- ⚠️ SEM POLICY, DE PROPÓSITO — é o mesmo desenho das irmãs. O app inteiro fala com estas tabelas
-- pelo service role (`createApoloAdminClient`), que passa por cima de RLS. Ligar RLS sem policy
-- fecha para o mundo e não muda uma linha do que a aplicação faz. Se um dia alguma tela precisar
-- ler direto do navegador, a policy se escreve então, com o recorte que a tela pedir.

alter table public.hercules_propostas        enable row level security;
alter table public.hercules_proposta_etapas  enable row level security;
alter table public.hercules_proposta_eventos enable row level security;

-- ⚠️ RLS SOZINHA JÁ BASTA, MAS O GRANT DE ESCRITA NÃO TEM POR QUE FICAR. Revogar é o cinto: se
-- alguém um dia criar uma policy permissiva para leitura, o INSERT/UPDATE/DELETE não vem junto de
-- carona. Leitura fica revogada também — quem lê é o service role.
revoke all on public.hercules_propostas        from anon;
revoke all on public.hercules_proposta_etapas  from anon;
revoke all on public.hercules_proposta_eventos from anon;

comment on table public.hercules_propostas is
  'Proposta/venda da unidade: importada do C2X (origem=c2x) ou nascida aqui (origem=panteon). RLS ligada e sem policy: so o service role entra. Guarda CPF e telefone dos compradores.';
