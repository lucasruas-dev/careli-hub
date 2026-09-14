-- Permissao de GERIR PESSOAS no Setup do Hub, sem virar admin.
--
-- Pedido do Lucas (14/09/2026): a Raiane cuida do RH da empresa e precisa cadastrar usuarios
-- "em qualquer setor ou departamento". Ate aqui o Setup so conhecia dois estados: admin (pode
-- tudo) e o resto (nao entra) — e admin destrava outras 43 verificacoes espalhadas pelo app,
-- incluindo as 14 filas da Iris e os syncs do C2X. Era muito mais do que foi pedido.
--
-- ⚠️ ESTA MIGRATION NAO DA PODER DE ADMIN, E ISSO E O PONTO. Quem recebe esta permissao passa
-- a abrir o Setup de usuarios e a cadastrar gente, mas o codigo recusa, no servidor, que um
-- nao-admin: conceda o perfil 'adm'; toque na linha de quem JA e admin (inclusive trocando o
-- e-mail, que e tomada de conta sem mexer em papel nenhum); edite o proprio cadastro; ou
-- desative o ultimo admin ativo. A regra vive em apps/hub/lib/hub/gestao-de-pessoas.ts, com
-- teste, e e a MESMA funcao usada pela rota e pela tela.
--
-- ⚠️ NAO CRIAR POLICY EM hub_user_permissions. Ela ja tem RLS ligada e ZERO policies desde a
-- 0001: so o service_role le e escreve, e e exatamente assim que tem que ficar. A leitura da
-- permissao acontece pelo adminClient (o mesmo padrao que lib/ares/server.ts:1220 ja usa em
-- producao). Uma policy de leitura aqui abriria a lista de quem pode o que para todo mundo.

-- 1. O catalogo. As duas permissoes de Setup que existem (`setup-manage` e `setup-view`) sao
--    largas demais: "gerenciar Setup Central" abarca departamentos, integracoes e o resto das
--    abas. Esta e estreita de proposito — so pessoas — para nao crescer sozinha depois.
insert into public.hub_permissions (id, key, scope, module_id, description)
values (
  'setup-usuarios',
  'setup:usuarios',
  'module',
  'setup',
  'Cadastrar e editar pessoas no Setup, em qualquer departamento, sem poder de administrador.'
)
on conflict (id) do nothing;

-- 2. A concessao. Idempotente: rodar de novo nao duplica nem ressuscita concessao revogada
--    por engano (o `revoked_at is null` no where garante que so existe UMA viva por vez).
insert into public.hub_user_permissions (user_id, permission_id, granted_by_user_id)
select
  alvo.id,
  'setup-usuarios',
  quem_concede.id
from public.hub_users as alvo
left join public.hub_users as quem_concede
  on quem_concede.email = 'lucas.ruas@careli.adm.br'
where alvo.email = 'raiane.oliveira@careli.adm.br'
  and not exists (
    select 1
    from public.hub_user_permissions ja
    where ja.user_id = alvo.id
      and ja.permission_id = 'setup-usuarios'
      and ja.revoked_at is null
  );

-- COMO REVOGAR, se um dia precisar (nao apagar a linha — o historico de quem teve acesso vale):
--   update public.hub_user_permissions
--      set revoked_at = now()
--    where permission_id = 'setup-usuarios'
--      and user_id = (select id from public.hub_users where email = 'raiane.oliveira@careli.adm.br')
--      and revoked_at is null;
