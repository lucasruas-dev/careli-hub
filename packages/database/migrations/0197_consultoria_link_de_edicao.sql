-- O LINK DE EDIÇÃO DA CONSULTORIA.
--
-- Lucas, 29/09/2026, ao abrir a tela em produção e cair em "Sua sessão do Panteon expirou": "não
-- precisa ter esse acesso ao panteon" e "não precisa de login". A edição, que exigia a sessão do
-- hub, passa a entrar por um link secreto do consultor (/consultoria/<slug>?e=<token_edicao>), no
-- mesmo desenho do link de leitura do cliente (token_leitura).
--
-- ATENCAO 1: nulo = projeto sem link de edição, ninguém edita. O código nasce fora daqui (gerado e
-- gravado na criação do projeto), para não ficar escrito em arquivo de migration.
-- ATENCAO 2: quem tem este link APAGA e REESCREVE o projeto inteiro. Trocar o valor no banco
-- derruba o link antigo na hora.

alter table public.consultoria_projetos add column if not exists token_edicao text;

create unique index if not exists consultoria_projetos_token_edicao_key
  on public.consultoria_projetos (token_edicao) where token_edicao is not null;

comment on column public.consultoria_projetos.token_edicao is
  'Segredo do link de EDICAO do consultor (/consultoria/<slug>?e=). Le e reescreve o documento inteiro. Nulo = ninguem edita.';
