-- Fila de ESCRITA Apolo -> C2X (integração de write-back, 28/jul).
--
-- O Apolo passa a alimentar o C2X: cada entidade que precisa existir no legado (o proponente,
-- a imobiliária, o incorporador) é enviada por POST à API de escrita
-- (https://teste.careli.adm.br/api/v1/users). Esta tabela é a FILA e o LIVRO-RAZÃO desse envio.
--
-- POR QUE TABELA SEPARADA, e não um campo no metadata da entidade: o SYNC do C2X faz
-- `upsert(apolo_entities, onConflict:id)`, que SUBSTITUI o metadata inteiro a cada rodada (foi o
-- incidente da migration 0057, que apagou a esteira de 122 CADs). Qualquer estado operacional que
-- o Apolo escreva no metadata de uma entidade sincronizada tem prazo de validade. A fila do C2X
-- é estado operacional, então mora aqui, com `entity_id` como chave.
--
-- IDEMPOTÊNCIA: uma linha por entidade. `document` (CPF/CNPJ) é a chave natural de reconciliação,
-- porque a API dedup por documento ("CPF já cadastrado") e devolve `token`, não `id` — o `id` do
-- C2X é lido depois no banco de produção, pelo documento. Retry não duplica: quem já está
-- `resolvido` não é reenviado.

create table if not exists public.apolo_c2x_sync (
  -- Uma linha por entidade do Apolo que vai (ou foi) para o C2X.
  entity_id uuid primary key
    references public.apolo_entities (id) on delete cascade,

  -- Qual papel foi enviado: 'cliente' | 'imobiliaria' | 'incorporador'. O corretor NÃO entra
  -- (decisão do Lucas 28/jul: corretor mora só no Apolo).
  perfil text not null,

  -- Chave natural de reconciliação: CPF (PF) ou CNPJ (PJ), só dígitos. É por ela que lemos o
  -- `c2x_user_id` no banco de produção depois de criar, e é o que a API usa para deduplicar.
  documento text,

  -- Ciclo do envio:
  --   pendente   -> na fila, ainda não enviado
  --   enviado    -> POST deu status:success (temos o token), mas ainda não resolvemos o id
  --   resolvido  -> já lemos o c2x_user_id no banco; a identidade está casada, é o estado final
  --   duplicado  -> a API respondeu "documento já cadastrado"; resolvemos pelo id existente
  --   erro       -> status:failed por validação/transporte; ver `erro`
  status text not null default 'pendente',

  -- O id do usuário no C2X (users.id), lido no banco de produção pelo documento depois de criar.
  -- Nulo até resolver. É o que casa a identidade Apolo <-> C2X e alimenta o `vinculed_by_id` de
  -- quem for vinculado a esta entidade (ex.: o cliente aponta para o id da imobiliária).
  c2x_user_id bigint,

  -- O token que o POST devolve no sucesso. Guardado por rastreabilidade; a chave de casamento é o
  -- id (resolvido pelo documento), não o token.
  c2x_token text,

  -- Payload enviado (SEM a senha) e a resposta crua da API, para auditoria e reenvio.
  requisicao jsonb,
  resposta jsonb,

  -- Última mensagem de erro (errors_message da API ou falha de transporte).
  erro text,

  -- Quantas vezes tentamos. Um teto no orquestrador evita martelar a API num erro permanente.
  tentativas integer not null default 0,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  enviado_em timestamptz
);

-- Fila de trabalho: quem ainda precisa ser enviado/reenviado, mais antigo primeiro.
create index if not exists apolo_c2x_sync_status_idx
  on public.apolo_c2x_sync (status, atualizado_em);

-- Reconciliação pelo documento (achar/casar por CPF/CNPJ).
create index if not exists apolo_c2x_sync_documento_idx
  on public.apolo_c2x_sync (documento);
