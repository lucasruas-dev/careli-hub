-- Apolo: separa a RECEPCAO DE CAD da RECEPCAO DE IMOBILIARIA no empreendimento.
--
-- Motivo (Lucas, 26/08): o CAD e a habilitacao de imobiliaria acontecem em MOMENTOS DIFERENTES.
-- Caso real: o Recanto do Vale ja esta habilitando imobiliarias, mas so vai receber CAD depois
-- da convencao de vendas. Com um flag unico (`credenciamento_ativo`), ligar o portal das
-- imobiliarias abria junto o formulario publico de CAD — e nao ha como abrir um sem o outro.
--
-- Desenho:
--   * `credenciamento_ativo` CONTINUA sendo o master "na ativa" (consumidores internos — board,
--     credenciamento interno, Prometeu — seguem usando SO ele; a semantica deles nao muda).
--   * portao publico de CAD          = credenciamento_ativo AND recepcao_cad
--   * portao publico de imobiliaria  = credenciamento_ativo AND recepcao_imobiliaria
--
-- DEFAULT TRUE nas duas colunas de proposito: todo empreendimento existente preserva o
-- comportamento de hoje (master ligado = os dois formularios abertos). O caso novo (Recanto do
-- Vale) e ligado desligando `recepcao_cad` na tela Apolo > Empreendimentos.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

alter table public.apolo_enterprise_settings
  add column if not exists recepcao_cad boolean not null default true;

alter table public.apolo_enterprise_settings
  add column if not exists recepcao_imobiliaria boolean not null default true;

comment on column public.apolo_enterprise_settings.recepcao_cad is
  'Portao publico de CAD: com o master credenciamento_ativo ligado, o formulario publico de CAD so oferece o empreendimento se este flag estiver ligado. Default true = comportamento anterior.';

comment on column public.apolo_enterprise_settings.recepcao_imobiliaria is
  'Portao publico de credenciamento de imobiliaria: com o master credenciamento_ativo ligado, o formulario publico de imobiliaria so oferece o empreendimento se este flag estiver ligado. Default true = comportamento anterior.';
