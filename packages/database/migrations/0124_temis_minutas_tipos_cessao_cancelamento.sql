-- OS DOIS TIPOS DE DOCUMENTO QUE O SETUP DA TÊMIS JÁ OFERECE E O BANCO RECUSAVA.
--
-- Lucas (02/09/2026): *"vamos ter que incluir no setup, a minuta, termo de cessão, termo de distrato
-- por empreendimento"* e *"vamos colocar também um campo para o cancelamento"*. O Setup ganhou as
-- abas Minuta · Termo de cessão · Termo de distrato · Termo de cancelamento, e o código
-- (`lib/temis/documentos-do-empreendimento.ts`) usa os valores `cessao` e `cancelamento` como
-- `temis_minutas.tipo`.
--
-- ⚠️ O CHECK DA 0113 SÓ CONHECIA contrato · pa · aditivo · distrato. Criar um termo de cessão pela
-- tela cairia em "violates check constraint", e o operador leria "não foi possível gravar" sem
-- saber que o banco nunca aceitaria. Achado na revisão de 02/09 (mapa do Hércules interno) antes
-- de alguém tentar.
--
-- `pa` e `aditivo` ficam: existem no CHECK desde a 0113 e podem ter linha gravada.

alter table public.temis_minutas
  drop constraint if exists temis_minutas_tipo;

alter table public.temis_minutas
  add constraint temis_minutas_tipo
  check (tipo in ('contrato', 'pa', 'aditivo', 'distrato', 'cessao', 'cancelamento'));

comment on column public.temis_minutas.tipo is
  'contrato (varia por plano) · cessao · distrato · cancelamento (um por empreendimento) · pa · aditivo. Ver lib/temis/documentos-do-empreendimento.ts.';
