-- 0140 · O MESMO PLANO EM VÁRIAS CATEGORIAS
--
-- Lucas (07/09/2026): *"lembrando que eu posso vincular o mesmo plano em várias categorias, blz?"*.
--
-- ⚠️ ATÉ AQUI ERA UM PARA UM. `temis_planos.categoria_id` (0111) dá ao plano UMA categoria, e a
-- consequência prática é retrabalho de cadastro: um "NORMAL 120x" que vale para o Condomínio A e
-- para o Condomínio B teria de ser cadastrado duas vezes, com os mesmos juros, a mesma entrada e o
-- mesmo índice — e no dia em que a taxa mudasse, alguém teria de lembrar de mudar nos dois.
--
-- ⚠️ NADA A MIGRAR: medido agora, são 4 planos em produção e NENHUM tem categoria preenchida. O
-- modelo pode mudar limpo, e é por isso que esta migration acontece hoje e não daqui a seis meses.
--
-- ⚠️ A COLUNA ANTIGA FICA, e não é indecisão. Ela é o que a tela de planos lê hoje para agrupar, e
-- derrubá-la junto com a criação da tabela nova quebraria a listagem no mesmo deploy. O caminho é:
-- a tabela passa a ser a verdade, a tela migra, e a coluna sai depois — com a base já sem uso dela.

-- ── ONDE A MINUTA MORA ──────────────────────────────────────────────────────
--
-- Lucas (07/09/2026), fechando o modelo: *"eu posso ter 1 plano para varias categorias, posso ter
-- planos por categorias e consequentemente minutas por plano ou minutas por categoria"*.
--
-- ⚠️ SAO DOIS NIVEIS, E O DE CIMA E O DE TODO DIA. Se a minuta morasse SO no vinculo, uma categoria
-- com seis planos obrigaria a repetir a mesma minuta seis vezes — e a manter as seis em dia. A
-- categoria carrega a minuta do recorte ("lotes caucionados assinam a minuta de caucao"), e o
-- vinculo sobrescreve so onde ha excecao de verdade (o plano a vista daquele recorte, que assina
-- outra coisa).
--
-- ⚠️ E A COLUNA DO PLANO SAI DE CENA. `temis_planos.minuta_id` (0111) amarrava as duas perguntas
-- num campo so: "quanto o cliente paga" e "o que ele assina". Separa-las e o que permite plano
-- especifico sem minuta nova, e minuta nova sem plano duplicado. A coluna fica ate a base nao usar
-- mais — derruba-la junto quebraria a tela de planos no mesmo deploy.
alter table public.temis_categorias
  add column if not exists minuta_id uuid
    references public.temis_minutas (id) on delete set null;

comment on column public.temis_categorias.minuta_id is
  'A minuta que este recorte assina. O vinculo plano-categoria sobrescreve quando ha excecao.';

create table if not exists public.temis_plano_categorias (
  plano_id      uuid not null references public.temis_planos (id)     on delete cascade,
  categoria_id  uuid not null references public.temis_categorias (id) on delete cascade,
  -- A EXCECAO: quando ESTE plano, NESTA categoria, assina outra coisa. Nulo = herda a da categoria.
  minuta_id     uuid references public.temis_minutas (id) on delete set null,
  criado_em     timestamptz not null default now(),

  -- O par é a identidade: o mesmo plano não entra duas vezes na mesma categoria.
  primary key (plano_id, categoria_id)
);

-- Os dois sentidos da pergunta: "quais categorias este plano atende?" e, o mais usado,
-- "quais planos valem para esta categoria?" — que é o que a venda faz ao abrir a proposta.
create index if not exists temis_plano_categorias_por_categoria
  on public.temis_plano_categorias (categoria_id);

comment on table public.temis_plano_categorias is
  'Quais categorias cada plano atende. O mesmo plano pode servir varias — ver a 0140.';

-- ⚠️ RLS LIGADA E SEM POLICY, como as irmãs da família. O app fala por service role; ligar sem
-- policy fecha a tabela para a chave pública, que viaja no bundle do navegador.
alter table public.temis_plano_categorias enable row level security;
