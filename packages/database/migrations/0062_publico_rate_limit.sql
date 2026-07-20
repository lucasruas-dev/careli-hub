-- ⚠️ NÃO APLICADA. Aguarda OK explícito do Lucas (operação sensível de banco).
--
-- TETO DE USO das rotas públicas do CAD do corretor.
--
-- POR QUE PRECISA EXISTIR: não há rate limit nenhum no repositório e não há Redis/KV. O único
-- anti-abuso de rota pública hoje é um teto de tamanho de texto (`MAX_TTS_TEXT` na voz do
-- Prometeu, público justamente por ser pago). O formulário do corretor abre para a internet
-- duas torneiras caras (OCR da MOST a ~R$ 0,50/imagem, enriquecimento de CRECI a ~R$ 1,60) e
-- um oráculo de enumeração ("esse CNPJ é parceiro da Careli?"), com a base de CNPJs do Brasil
-- sendo pública.
--
-- ⚠️ ENQUANTO ESTA MIGRATION NÃO FOR APLICADA, `lib/publico/cad/rate-limit.ts` degrada e
-- DEIXA PASSAR (a tabela ausente não pode derrubar o formulário). Ou seja: aplicar isto é
-- pré-requisito para DIVULGAR O LINK, não item de acabamento.
--
-- O IP vai HASHEADO: IP é dado pessoal e guardar em claro não se justifica para contar.
-- Janela FIXA e não deslizante: uma linha por chave/balde/janela, sem histórico de acessos —
-- o que importa é o volume, e guardar timestamp por tentativa seria acumular rastro de
-- navegação de gente que nem é cliente.

create table if not exists public.publico_rate_limit (
  -- 'identificacao' | 'imobiliaria' | 'creci' | 'ocr' | 'enviar' | 'assistente'
  balde text not null,
  -- sha256 de 'publico-cad:<ip>'. Nunca o IP.
  chave_hash text not null,
  janela_inicio timestamptz not null,
  contador integer not null default 0,
  visto_em timestamptz not null default now(),

  primary key (balde, chave_hash, janela_inicio)
);

-- Varredura de limpeza: as janelas velhas não servem para nada depois que expiram.
create index if not exists publico_rate_limit_janela_idx
  on public.publico_rate_limit (janela_inicio);

alter table public.publico_rate_limit enable row level security;

-- Sem policy de leitura de propósito: só o service role (as rotas públicas) toca esta tabela.
-- Nenhuma tela do hub precisa ler contador de tentativa, e o conteúdo é rastro de acesso.

-- LIMPEZA (rodar por cron ou à mão; NÃO faz parte da migration porque apagar linha é escrita
-- em produção e passa pelo mesmo rito de confirmação):
--
-- delete from public.publico_rate_limit where janela_inicio < now() - interval '7 days';
