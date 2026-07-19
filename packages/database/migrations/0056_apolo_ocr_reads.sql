-- Registro das leituras PAGAS na MOST (iOCR e enriquecimento).
--
-- Hoje não existe NADA disso: sem log, sem cache, sem dedup. Reenviar o mesmo documento cobra
-- de novo, sempre, e não há como saber quanto já foi gasto. Para ler 1 cadastro à mão isso é
-- irrelevante; para importar dezenas de CADs em lote é dinheiro saindo sem rastro.
--
-- A chave é o SHA-256 do BYTE BAIXADO — não o nome do arquivo nem a URL:
--   * o mesmo documento aparece com nomes diferentes ("rg.jpg", "RG frente.jpg")
--   * a URL do Asana é assinada e muda a cada listagem
--   * e já sabemos que há CAD repetida: 5 pessoas têm 2 CADs cada no Vale do Ouro, o que
--     significa o MESMO documento anexado duas vezes = duas cobranças pela mesma leitura
--
-- Guarda o resultado inclusive quando a extração vem ruim: leitura ruim TAMBÉM foi cobrada, e
-- registrar evita repagar a mesma foto ilegível numa reimportação.

create table if not exists public.apolo_ocr_reads (
  id uuid primary key default gen_random_uuid(),

  -- Identidade do arquivo lido. É o que impede a segunda cobrança.
  file_sha256 text not null unique,
  file_name text,
  size_bytes integer,

  -- De onde veio (asana/upload/...) e a referência externa, para auditoria.
  source_system text not null default 'asana',
  source_id text,

  provider text not null default 'mostqi',
  -- 'iocr' (leitura de documento) ou 'enrichment' (consulta a bases).
  tipo text not null default 'iocr',

  -- Quantas IMAGENS foram faturadas: RG frente+verso conta 2, PDF conta por página.
  paginas integer not null default 1,
  custo_brl numeric,

  -- confiancaDocumento (o MIN dos scores) — o porteiro real, não a média.
  confianca numeric,
  -- Resultado completo, para reaproveitar sem nova consulta.
  extracao jsonb not null default '{}'::jsonb,

  entity_id uuid,
  lido_por uuid,
  created_at timestamptz not null default now()
);

create index if not exists apolo_ocr_reads_source_idx
  on public.apolo_ocr_reads (source_system, source_id);
create index if not exists apolo_ocr_reads_entity_idx
  on public.apolo_ocr_reads (entity_id);
-- Para somar o gasto do mês contra o teto contratual (10.000 páginas/mês).
create index if not exists apolo_ocr_reads_periodo_idx
  on public.apolo_ocr_reads (created_at desc, tipo);

alter table public.apolo_ocr_reads enable row level security;

drop policy if exists apolo_ocr_reads_read on public.apolo_ocr_reads;
create policy apolo_ocr_reads_read
  on public.apolo_ocr_reads for select to authenticated using (true);
