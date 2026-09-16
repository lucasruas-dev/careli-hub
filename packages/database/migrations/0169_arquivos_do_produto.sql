-- 0169 · AS FOTOS E OS VÍDEOS DO PRODUTO (a aba Arquivos da ficha)
--
-- ⚠️ NÃO APLICADA. Escrita em 16/09/2026 junto com o código; aplicar só com OK explícito do Lucas.
--
-- Lucas (16/09/2026), sobre o portal da Cecílio Rocha virar a réplica do Hércules: *"vamos subir
-- videos, imagens dos produtos para que eles na hora que estiver negociando com o cliente possa
-- mostrar essas fotos, imagens e videos, o ideal e organizar em miniatura (para que eles possam
-- visualizar antes de abrir) quando abrir ter a opcao de ver em tela cheia, lembrando que nao
-- precisa abrir em nova aba ou algo do tipo, abre como um popup mesmo"*.
--
-- POR QUE A TABELA EXISTE: não há lugar nenhum hoje para a foto de um empreendimento. O
-- `apolo_enterprise_documents` (0050) guarda DOCUMENTO por código (memorial, matrícula), sem
-- miniatura, sem duração, sem saber quem subiu nem de onde; o `hercules_documentos` é da VENDA
-- (unidade + protocolo). Sem esta tabela, a foto da portaria circularia por WhatsApp, e o corretor
-- do Cecílio mostraria ao cliente a versão que estiver no celular dele naquele dia.
--
-- ORDEM DE DEPLOY:
--   1. aplicar ESTA migration (tabela + bucket);
--   2. conferir no painel do Supabase o limite GLOBAL de upload do projeto (Storage > Settings >
--      "Upload file size limit"). O `file_size_limit` do bucket NÃO passa por cima dele: se o global
--      estiver no padrão de 50 MB, o vídeo de 200 MB é recusado pelo Storage com um 413, mesmo com os
--      500 MB escritos aqui;
--   3. publicar o código (rotas /api/incorporador/produto/arquivos e /api/apolo/empreendimentos/arquivos).
--   Código antes da migration não quebra tela: as rotas respondem 503 com mensagem, e a aba mostra o
--   erro no lugar da grade.
--
-- ATENCAO 1: `enterprise_id` É SEMPRE UM ID REAL (a divisão do C2X, "37", "39"), NUNCA
-- "group:Lagoa Bonita" nem "pai:<uuid>". O escopo do portal é conferido por id real
-- (`idsDaSessao` + `expandirIdDoPainel`), e quem tem só a gleba do Fernando não pode ver a foto que
-- foi gravada no grupo inteiro. A rota recusa gravar em id de grupo; a leitura de um produto
-- consolidado junta as divisões que a sessão alcança.
--
-- ATENCAO 2: O ARQUIVO NUNCA PASSA PELA ROTA. O corpo de uma função da Vercel é cortado em 4,5 MB, e
-- vídeo de produto passa disso no primeiro segundo. A rota assina a permissão de gravar
-- (`createSignedUploadUrl`), o navegador grava direto no bucket, e o `registrar` confere o objeto
-- (`.info()`) antes de criar a linha. Por isso `tamanho_bytes` é o tamanho MEDIDO pelo Storage, e não
-- o que o navegador declarou.
--
-- ATENCAO 3: A MINIATURA É GERADA NO NAVEGADOR, antes do envio (imagem: lado maior de 480 px em
-- JPEG; vídeo: um quadro perto de 1 s). O servidor não tem ffmpeg e não vai ter: cada vídeo de
-- 500 MB baixado de volta numa função para tirar um quadro seria tempo de função pago por nada.
-- `miniatura_path` pode ser NULO de verdade (HEIC no Chrome, vídeo HEVC no Windows: o navegador não
-- decodifica), e a tela mostra um ícone no lugar da miniatura. Não é erro de cadastro.
--
-- ATENCAO 4: NADA SE APAGA DE VERDADE. `removido_em` tira o arquivo da grade para todos, mas a
-- linha e os bytes ficam: foto de produto já mostrada a cliente é o que se quer ter quando alguém
-- pergunta "que foto vocês me mostraram?". A limpeza do bucket, se um dia pesar, é um job próprio
-- sobre as linhas removidas há mais de N dias, e não um clique.
--
-- ATENCAO 5: `enviado_origem` e `nome` SÃO NOT NULL SEM DEFAULT, DE PROPÓSITO. Nenhuma escrita
-- aqui é upsert (só insert e update pontual), então a armadilha do upsert não se aplica; e um
-- default 'hub' marcaria em silêncio como da Careli a foto que o time do Cecílio subiu, que é
-- exatamente a pergunta que a coluna existe para responder.

create table if not exists public.apolo_empreendimento_arquivos (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      text not null default 'careli',

  -- O id REAL do empreendimento (ATENCAO 1). Sem FK: o C2X é outro banco, e o empreendimento que só
  -- existe no Panteon guarda o mesmo id em `hercules_empreendimentos.c2x_enterprise_id`.
  enterprise_id     text not null,

  tipo              text not null,
  -- O nome ORIGINAL do arquivo, saneado. Só para exibir: o caminho no bucket é <uuid>.<ext>.
  nome              text not null,
  mime              text,
  -- Medido pelo Storage no registro (ATENCAO 2).
  tamanho_bytes     bigint,

  -- <enterprise_id>/<uuid>.<ext> e <enterprise_id>/<uuid>.thumb.jpg, no bucket `produto-arquivos`.
  storage_path      text not null,
  miniatura_path    text,

  largura           integer,
  altura            integer,
  -- Só vídeo. Numeric porque o navegador mede em fração de segundo (12.48).
  duracao_segundos  numeric(10, 2),

  legenda           text,
  -- Reservada para a ordenação manual. Nula = ordem de chegada (mais novo primeiro).
  ordem             integer,

  enviado_por       text,
  -- COPIADO no ato, como `hercules_posse.registrado_por_nome`: o histórico diz quem era naquele dia.
  enviado_por_nome  text,
  enviado_origem    text not null,

  criado_em         timestamptz not null default now(),
  removido_em       timestamptz,
  removido_por      text,

  constraint apolo_empreendimento_arquivos_tipo check (tipo in ('imagem', 'video')),
  constraint apolo_empreendimento_arquivos_origem check (enviado_origem in ('hub', 'portal')),
  constraint apolo_empreendimento_arquivos_tamanho check (tamanho_bytes is null or tamanho_bytes >= 0),
  constraint apolo_empreendimento_arquivos_dimensoes check (
    (largura is null or largura > 0) and (altura is null or altura > 0)
  ),
  constraint apolo_empreendimento_arquivos_duracao check (
    duracao_segundos is null or duracao_segundos >= 0
  ),
  -- Id de grupo ou de pai não entra (ATENCAO 1). A rota já recusa; o CHECK é a segunda camada.
  constraint apolo_empreendimento_arquivos_id_real check (
    enterprise_id !~ '^(group|pai):'
  )
);

-- Um objeto do bucket, uma linha. Sem isto, um `registrar` repetido (duplo clique, retry de rede)
-- mostraria a mesma foto duas vezes na grade.
create unique index if not exists apolo_empreendimento_arquivos_um_por_objeto
  on public.apolo_empreendimento_arquivos (storage_path);

-- A leitura da aba: os arquivos VIVOS de um conjunto de empreendimentos. Parcial porque o removido
-- nunca é lido pela tela.
create index if not exists apolo_empreendimento_arquivos_vivos
  on public.apolo_empreendimento_arquivos (workspace_id, enterprise_id, criado_em desc)
  where removido_em is null;

-- ⚠️ MESMO DESENHO DAS IRMÃS (0165, 0166): RLS ligada, sem policy, grants revogados. O app fala com
-- esta tabela só pelo service role. A linha carrega o caminho do objeto no bucket privado, e a
-- chave `anon` viaja no bundle que qualquer visitante baixa.
alter table public.apolo_empreendimento_arquivos enable row level security;
revoke all on public.apolo_empreendimento_arquivos from anon, authenticated;

comment on table public.apolo_empreendimento_arquivos is
  'Fotos e videos do produto (aba Arquivos da ficha, portal e Apolo). Bytes no bucket privado produto-arquivos, lidos por URL assinada na hora.';
comment on column public.apolo_empreendimento_arquivos.enterprise_id is
  'Id REAL do empreendimento (divisao do C2X). Nunca group: nem pai:. Produto consolidado le a uniao das divisoes da sessao.';
comment on column public.apolo_empreendimento_arquivos.tamanho_bytes is
  'Tamanho medido pelo Storage (.info()) no registro, nao o declarado pelo navegador.';
comment on column public.apolo_empreendimento_arquivos.miniatura_path is
  'Miniatura JPEG gerada no navegador. Nula quando o navegador nao decodifica o formato (HEIC, HEVC): a tela mostra icone.';
comment on column public.apolo_empreendimento_arquivos.enviado_origem is
  'hub = time da Careli pelo Apolo; portal = time do incorporador/comercial pelo portal.';
comment on column public.apolo_empreendimento_arquivos.removido_em is
  'Remocao logica: some da grade para todos. Linha e bytes ficam.';

-- ── O BUCKET ─────────────────────────────────────────────────────────────────
--
-- PRIVADO, como o `apolo-documents` (0050): sem policy em storage.objects, toda leitura e escrita
-- passa pelas rotas (URL assinada na hora, gravação por token assinado).
--
-- ⚠️ O TETO DO BUCKET É O DO VÍDEO (500 MB). A imagem tem teto menor (25 MB), cobrado na rota: o
-- bucket só conhece um número para todos os tipos. E ver a ORDEM DE DEPLOY, item 2: o limite global
-- do projeto manda em cima deste.
--
-- ⚠️ `on conflict do nothing` NÃO ATUALIZA um bucket que já exista com outros limites. Se alguém
-- criar o bucket pelo painel antes desta migration, conferir `file_size_limit` e
-- `allowed_mime_types` em storage.buckets depois de aplicar.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'produto-arquivos',
  'produto-arquivos',
  false,
  524288000,
  array[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/heic',
    'image/heif',
    'video/mp4',
    'video/quicktime',
    'video/webm'
  ]
)
on conflict (id) do nothing;
