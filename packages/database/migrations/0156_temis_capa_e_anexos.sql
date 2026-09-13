-- A CAPA E OS ANEXOS: o contrato deixa de ser só o corpo.
--
-- POR QUE ELA EXISTE. Lucas, 13/09/2026: *"eu não vi onde vamos subir os anexos, a capa dos
-- contratos, acho que isso não foi construído"*. Estava certo: o vocabulário existe desde 07/09
-- (variaveisDeAnexo, o bloco pronto "anexos", acharVariavel resolvendo anexo_N), mas nada segurava
-- ARQUIVO. O catálogo em lib/temis/variaveis.ts chega a nomear a coluna que faltava — "capa_path em
-- temis_minutas" — e ela nunca foi criada. Registrado como PAN-071 no roadmap.
--
-- O desenho é o de 07/09/2026: *"muita peça do contrato são PDF prontos"* e *"estamos fazendo
-- nossas capas no canvas"*.
--
--     CAPA     cadastro da MINUTA      uma por minuta
--     CORPO    o editor da Têmis       a única peça que já existia
--     ANEXOS   unidade, categoria ou empreendimento
--
-- ATENCAO 1: O ANEXO É ARQUIVO, E A VARIÁVEL MARCA UM LUGAR. Esta é a diferença entre o grupo de
-- anexo e as outras ~280 variáveis do catálogo. [anexo_1] no meio de uma cláusula NÃO vira texto:
-- ele diz ao montador onde quebrar o PDF do corpo e costurar as páginas daquele arquivo. Ausente do
-- texto, o arquivo entra no fim pelo curinga [anexos_do_contrato]. Um motor que não souber disso
-- imprime o caminho do arquivo no papel.
--
-- ATENCAO 2: A POSIÇÃO É ESCOLHIDA NO CADASTRO, NUNCA PELA ORDEM DE UPLOAD. Decisão do Lucas em
-- 07/09/2026, depois de recusar três desenhos meus: *"à medida que eu vou importando os anexos vai
-- fazendo essa conta"*. Se a posição viesse da ordem em que os arquivos subiram, anexar uma peça
-- nova empurraria as outras — e toda minuta JÁ PUBLICADA que diga [anexo_2] passaria a imprimir a
-- peça errada, sem erro nenhum, sem log e sem ninguém perceber. Por isso `posicao` é uma coluna que
-- o operador preenche, e não um `row_number()` da data de criação.
--
-- ATENCAO 3: OS TRÊS NÍVEIS COMPARTILHAM A NUMERAÇÃO, E O MAIS ESPECÍFICO VENCE — unidade, depois
-- categoria, depois empreendimento. É o que permite "planta é do lote, convenção é de todos" sem
-- cadastrar a convenção 400 vezes.
--
--   ⚠️ E É POR ISSO QUE O BANCO NÃO GARANTE A UNICIDADE ENTRE NÍVEIS, só DENTRO de cada um. Uma
--   trava global na posição proibiria exatamente o que o desenho quer: a unidade ocupar a posição 2
--   que a categoria também ocupa, para sobrescrevê-la. Quem resolve a precedência é o código, do
--   mesmo jeito que já faz em minuta, vendedora e entrada mínima. Ver PAN-070, que é a dívida de
--   fazer isso valer nas cinco cadeias de uma vez.
--
-- ATENCAO 4: EXATAMENTE UM ALCANCE POR LINHA. Uma linha com unidade E categoria preenchidas não tem
-- leitura única — o mais específico venceria a si mesmo. O `num_nonnulls` recusa no ato de gravar,
-- que é o único lugar onde isso pega antes de virar um contrato impresso errado.
--
-- ATENCAO 5: O ARQUIVO NÃO MORA AQUI. `storage_path` aponta para o bucket PRIVADO
-- `apolo-documents`, o mesmo caminho que a mídia do editor de minutas já usa desde 02/09 (prefixo
-- temis-minutas/). Guardar base64 em coluna foi o que já obrigou a backfill do anexo do Hub IT
-- (0045); não repetir.
--
-- ATENCAO 6: APAGAR A CATEGORIA OU A UNIDADE LEVA O ANEXO JUNTO (`on delete cascade`), porque um
-- anexo órfão de alcance não é alcançável por contrato nenhum — vira lixo que ninguém encontra para
-- limpar. O empreendimento é `text` e sem FK, como em todas as tabelas da Têmis (é o id do C2X).
--
-- Autorização do Lucas, 13/09/2026: *"tem o meu ok"*.

-- ── A CAPA, na minuta ───────────────────────────────────────────────────────
alter table public.temis_minutas add column if not exists capa_path text;
alter table public.temis_minutas add column if not exists capa_nome text;

comment on column public.temis_minutas.capa_path is
  'Caminho da capa no bucket apolo-documents. É a fonte da variável capa_contrato. A capa é desenhada fora (Canva) e entra como PDF ou imagem.';

-- ── OS ANEXOS ───────────────────────────────────────────────────────────────
create table if not exists public.temis_anexos (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',

  -- O ALCANCE: exatamente um dos três. Ver ATENCAO 3 e 4.
  enterprise_id text,
  categoria_id uuid references public.temis_categorias (id) on delete cascade,
  unidade_id uuid references public.hercules_unidades (id) on delete cascade,

  -- A posição que o texto cita: [anexo_1], [anexo_2]. Do CADASTRO, ver ATENCAO 2.
  posicao integer not null,

  -- O nome vira a variável [anexo_N_nome], que escreve o título da linha sozinho. Trocar o arquivo
  -- não deixa o contrato anunciando o nome do anterior.
  nome text not null,

  storage_path text not null,
  arquivo_nome text,
  arquivo_mime text,
  arquivo_bytes bigint,

  ativo boolean not null default true,
  observacao text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por uuid,
  criado_por_nome text,

  constraint temis_anexos_um_alcance
    check (num_nonnulls(enterprise_id, categoria_id, unidade_id) = 1),
  -- 99 é sanidade de FORMATO, não teto de negócio: é o que acharVariavel consegue ler de volta.
  constraint temis_anexos_posicao check (posicao >= 1 and posicao <= 99),
  constraint temis_anexos_nome_preenchido check (length(btrim(nome)) > 0),
  constraint temis_anexos_caminho_preenchido check (length(btrim(storage_path)) > 0),
  constraint temis_anexos_bytes check (arquivo_bytes is null or arquivo_bytes > 0)
);

comment on table public.temis_anexos is
  'PDFs prontos que entram no contrato montado. A variável [anexo_N] marca o LUGAR no corpo; o curinga [anexos_do_contrato] traz os que o texto não posicionou.';
comment on column public.temis_anexos.posicao is
  'Escolhida no cadastro, NUNCA pela ordem de upload. Ver ATENCAO 2 da migration 0156.';

-- ⚠️ UMA POSIÇÃO POR ALCANCE, e três índices em vez de um. Um índice único sobre
-- (enterprise_id, categoria_id, unidade_id, posicao) NÃO serviria: em Postgres, nulo não é igual a
-- nulo, então duas linhas de categoria com a mesma posição passariam batido — as colunas de
-- alcance vazias fazem cada linha parecer única. Por isso cada nível ganha o seu, filtrado.
create unique index if not exists temis_anexos_posicao_por_empreendimento
  on public.temis_anexos (workspace_id, enterprise_id, posicao)
  where ativo and enterprise_id is not null;

create unique index if not exists temis_anexos_posicao_por_categoria
  on public.temis_anexos (categoria_id, posicao)
  where ativo and categoria_id is not null;

create unique index if not exists temis_anexos_posicao_por_unidade
  on public.temis_anexos (unidade_id, posicao)
  where ativo and unidade_id is not null;

-- A leitura do montador: junta os três alcances de uma venda e ordena.
create index if not exists temis_anexos_por_alcance
  on public.temis_anexos (workspace_id, enterprise_id, categoria_id, unidade_id, posicao)
  where ativo;

-- RLS ligada e sem policy: o padrão da casa desde a 0075. Acesso só por service role.
alter table public.temis_anexos enable row level security;
