-- A TROCA DE SENHA OBRIGATÓRIA NO PRIMEIRO ACESSO.
--
-- POR QUE ELA EXISTE. Lucas, 13/09/2026: *"quero que todos amanhã ao logar no panteon possa
-- configurar uma senha nova. isso vai virar padrão, primeiro acesso eu coloco a senha como é hoje,
-- no acesso, o sistema pede para ele cadastrar uma nova senha (...) o único que não precisa mudar é
-- minha senha"*.
--
-- ⚠️ SÃO DOIS SISTEMAS DE SENHA, e por isso são duas colunas em duas tabelas. O hub interno
-- autentica no Supabase Auth (a senha vive em `auth.users` e o Panteon não a enxerga); o portal do
-- incorporador/comercial tem login próprio, com scrypt em
-- `apolo_incorporador_usuarios.senha_hash`. Não existe um lugar só onde marcar isto.
--
-- ⚠️ O PADRÃO É `false` AGORA E `true` DEPOIS, e a ordem importa. Criar a coluna já com
-- `default true` marcaria TODA linha existente no mesmo instante — as 11 contas do hub e as 38 do
-- portal, incluindo 35 de INCORPORADORES, que são donos de loteamento, gente de fora da casa e que
-- o Lucas não pediu para incluir. Então: nasce `false`, o backfill liga só em quem entra no recorte,
-- e só então o default vira `true` para que CONTA NOVA já nasça precisando trocar. É essa última
-- linha que transforma o pedido em padrão, e não em mutirão de uma vez só.
--
-- ⚠️ O RECORTE DO MUTIRÃO, medido em 14/09/2026: 11 contas no hub (7 ativas) e 38 no portal, das
-- quais apenas 3 são da Gurgel (comercial) — as outras 35 são de incorporadores. O pedido diz "o
-- time interno e o time comercial (gurgel)", então o backfill alcança 6 contas internas ativas (o
-- Lucas de fora, por pedido dele) e as 3 da Gurgel. Os 35 incorporadores ficam como estão.
--
-- ⚠️ `senha_trocada_em` NÃO É ENFEITE. Sem a data, "trocar_senha = false" não distingue quem trocou
-- de quem nunca precisou — e no dia em que alguém perguntar "quem ainda está com a senha que eu
-- entreguei?", a resposta seria um encolher de ombros. É também o que permite repetir o mutirão
-- depois sem varrer de novo quem já está em dia.

-- ── O hub interno ───────────────────────────────────────────────────────────
alter table public.hub_users
  add column if not exists trocar_senha boolean not null default false;
alter table public.hub_users
  add column if not exists senha_trocada_em timestamptz;

comment on column public.hub_users.trocar_senha is
  'Bloqueia o hub ate a pessoa cadastrar uma senha nova. Nasce true em conta nova (ver ATENCAO da migration 0160). A senha em si vive no Supabase Auth, nao aqui.';

-- ── O portal do incorporador e do comercial ─────────────────────────────────
alter table public.apolo_incorporador_usuarios
  add column if not exists trocar_senha boolean not null default false;
alter table public.apolo_incorporador_usuarios
  add column if not exists senha_trocada_em timestamptz;

comment on column public.apolo_incorporador_usuarios.trocar_senha is
  'Bloqueia o portal ate a pessoa cadastrar uma senha nova. Nasce true em conta nova.';

-- ── O mutirão: só o time interno e a Gurgel ─────────────────────────────────
-- ⚠️ O LUCAS FICA DE FORA POR PEDIDO DELE, e o e-mail é a chave porque é o que ele nomeou.
update public.hub_users
   set trocar_senha = true, updated_at = now()
 where status::text = 'active'
   and email <> 'lucas.ruas@careli.adm.br';

-- ⚠️ SÓ O `tipo = 'comercial'`. As contas de `incorporador` são de fora da casa.
update public.apolo_incorporador_usuarios u
   set trocar_senha = true, updated_at = now()
  from public.apolo_incorporadores i
 where i.id = u.incorporador_id
   and u.ativo
   and i.tipo = 'comercial';

-- ── E o padrão, daqui em diante ─────────────────────────────────────────────
-- A partir daqui toda conta criada nasce precisando cadastrar a própria senha, que é o padrão que o
-- Lucas descreveu: quem cadastra entrega uma senha inicial e ela morre no primeiro acesso.
alter table public.hub_users alter column trocar_senha set default true;
alter table public.apolo_incorporador_usuarios alter column trocar_senha set default true;
