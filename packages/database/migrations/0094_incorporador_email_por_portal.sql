-- 0094 · O MESMO E-MAIL PODE ACESSAR VÁRIOS PORTAIS DE INCORPORADOR
--
-- Regra do Lucas (17/08/2026): *"deixa o meu e-mail padrão acessar todos, só muda a URL"*.
--
-- HOJE: `apolo_incorporador_usuarios_email_uk` é único em `lower(email)` no sistema INTEIRO, ou
-- seja, um e-mail pertence a UM incorporador. Foi por isso que o lucas.ruas@careli.adm.br, já
-- cadastrado no Cecílio Rocha, não pôde entrar no portal do Bill e precisou do apelido `+bill`.
--
-- DEPOIS: o e-mail passa a ser único DENTRO de cada portal. A mesma pessoa tem uma linha por
-- incorporador, com senha própria em cada, e o portal que ela acessa é decidido pela URL.
--
-- ⚠️ O LOGIN MUDA JUNTO, e sem essa parte a troca QUEBRA os dois lados: `autenticarUsuario-
-- Incorporador` buscava o usuário só pelo e-mail com `maybeSingle()`, que estoura quando há mais
-- de uma linha. O código que acompanha esta migration passa o SLUG da URL e busca por
-- (incorporador, e-mail). Aplicar a migration sem o código deixa o login de quem tiver e-mail
-- repetido caindo em erro; aplicar o código sem a migration mantém o cadastro impossível.
--
-- O índice novo continua barrando o duplicado de verdade: a mesma pessoa duas vezes NO MESMO
-- portal.

drop index if exists apolo_incorporador_usuarios_email_uk;

create unique index if not exists apolo_incorporador_usuarios_portal_email_uk
  on public.apolo_incorporador_usuarios (incorporador_id, lower(email));

comment on index public.apolo_incorporador_usuarios_portal_email_uk is
  'E-mail unico POR PORTAL: a mesma pessoa pode acessar varios incorporadores, e a URL decide '
  'qual. Ver migration 0094 e autenticarUsuarioIncorporador.';
