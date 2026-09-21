-- QUEM ALTERA O CONTRATO A MAO: uma lista nominal, e nao um papel.
--
-- Lucas, 21/09/2026: "quem pode editar é a Nivea Careli e Northon Nascimento".
--
-- ATENCAO 1: EDITAR E MAIS ESTREITO QUE EMITIR, e ate hoje eram a MESMA regua. Quem reescreve uma
-- clausula escreve o que o cliente vai assinar no cartorio; quem emite so imprime o texto que ja
-- foi escrito. A porta da edicao (PUT e DELETE de /api/temis/contrato/edicao) usava
-- `autorizarEmissaoDeContrato` = admin + leader, o que hoje, medido, sao 7 pessoas ativas.
--
-- ATENCAO 2: PAPEL NAO RECORTA ESSAS DUAS PESSOAS, e por isso a lista e nominal. Medido em
-- 21/09/2026 em hub_users ativos: a Nivea e `admin` (CEO) e o Northon e `leader` (Analista de
-- Contratos). "So admin" deixaria o Northon de fora e traria a Raiane junto; "admin + leader" e a
-- regua larga que se quer fechar. O mecanismo de permissao concedida ja existe e ja roda em
-- producao: foi assim que a 0164 deu `setup-usuarios` a Raiane, e e assim que entra e sai gente
-- desta lista sem deploy.
--
-- ATENCAO 3: `scope = 'hub'` E `module_id` NULO, de proposito. Nao existe modulo 'temis' em
-- hub_modules (10 linhas, medido) e a FK hub_permissions_module_id_fkey recusaria a insercao. Criar
-- o modulo so para pendurar esta permissao acrescentaria uma linha nova nas telas que listam
-- modulos e departamentos, por um efeito que ninguem pediu. As duas permissoes de escopo `hub`
-- (hub-manage, hub-view) ja vivem assim.
--
-- ATENCAO 4: NAO CRIAR POLICY EM hub_user_permissions. Ela tem RLS ligada e ZERO policies desde a
-- 0001: so o service_role le e escreve, e e exatamente assim que tem de ficar. A leitura acontece
-- pelo adminClient (`lib/temis/autorizacao.ts`, mesmo padrao de `lib/ares/server.ts`). Uma policy
-- de leitura aqui abriria a lista de quem pode o que para todo mundo.
--
-- ATENCAO 5: NAO HA TELA PARA CONCEDER. Medido em 21/09/2026: a aba "Permissoes" do Setup e um
-- DataGrid somente-leitura do CATALOGO (hub_permissions) e nem sequer le hub_user_permissions; nao
-- existe nenhum INSERT nessa tabela em todo o aplicativo. Conceder e revogar e SQL, como abaixo.

-- 1. O catalogo. Estreita de proposito: e so a alteracao manual do texto do contrato, e nao
--    "gerenciar a Temis" -- que abarcaria minutas, assinatura, cards e o resto.
insert into public.hub_permissions (id, key, scope, module_id, description)
values (
  'temis-contrato-editar',
  'temis:contrato-editar',
  'hub',
  null,
  'Alterar o contrato a mao na previa da Temis (reescrever clausula antes de emitir).'
)
on conflict (id) do nothing;

-- 2. As concessoes. Idempotente: rodar de novo nao duplica nem ressuscita concessao revogada
--    (o `revoked_at is null` no not exists garante que so existe UMA viva por vez).
insert into public.hub_user_permissions (user_id, permission_id, granted_by_user_id)
select
  alvo.id,
  'temis-contrato-editar',
  quem_concede.id
from public.hub_users as alvo
left join public.hub_users as quem_concede
  on quem_concede.email = 'lucas.ruas@careli.adm.br'
where alvo.email in ('nivea.careli@careli.adm.br', 'northon.nascimento@careli.adm.br')
  and not exists (
    select 1
    from public.hub_user_permissions ja
    where ja.user_id = alvo.id
      and ja.permission_id = 'temis-contrato-editar'
      and ja.revoked_at is null
  );

-- COMO CONCEDER A MAIS ALGUEM (trocando o e-mail):
--   insert into public.hub_user_permissions (user_id, permission_id, granted_by_user_id)
--   select alvo.id, 'temis-contrato-editar', quem.id
--     from public.hub_users alvo
--     left join public.hub_users quem on quem.email = 'lucas.ruas@careli.adm.br'
--    where alvo.email = 'fulano@careli.adm.br'
--      and not exists (select 1 from public.hub_user_permissions ja
--                       where ja.user_id = alvo.id
--                         and ja.permission_id = 'temis-contrato-editar'
--                         and ja.revoked_at is null);
--
-- COMO REVOGAR (nao apagar a linha -- o historico de quem teve acesso vale):
--   update public.hub_user_permissions
--      set revoked_at = now()
--    where permission_id = 'temis-contrato-editar'
--      and user_id = (select id from public.hub_users where email = 'fulano@careli.adm.br')
--      and revoked_at is null;
--
-- QUEM ESTA NA LISTA AGORA:
--   select u.display_name, u.email, p.created_at
--     from public.hub_user_permissions p
--     join public.hub_users u on u.id = p.user_id
--    where p.permission_id = 'temis-contrato-editar' and p.revoked_at is null;
