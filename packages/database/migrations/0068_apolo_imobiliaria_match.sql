-- Apolo: DE-PARA das imobiliárias das CADs -> entidade do Apolo.
--
-- A imobiliária das CADs vive como TEXTO (apolo_esteira.imobiliaria e apolo_relationships.label),
-- e o related_entity_id do vínculo comercial está NULO: a imobiliária nunca foi ligada à entidade
-- dela (que existe no Apolo, vinda do C2X). Esta tabela guarda o casamento MANUAL que o operador
-- faz na tela de vínculo (nome de texto -> entity_id da imobiliária). Depois um passo de "match"
-- propaga esse vínculo para a esteira e para os relacionamentos.
--
-- Chave por nome NORMALIZADO (sem acento, minúsculo, espaço colapsado): o mesmo nome vem com
-- grafias ligeiramente diferentes do Asana/C2X, e queremos um vínculo por imobiliária, não por
-- variação de escrita.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

create table if not exists public.apolo_imobiliaria_match (
  id uuid primary key default gen_random_uuid(),
  -- Nome como aparece na CAD (o mais frequente), só para exibir.
  nome_texto text not null,
  -- Chave de casamento: nome normalizado. Único — uma imobiliária, um vínculo.
  nome_normalizado text not null unique,
  -- A entidade escolhida (imobiliária no Apolo). Null enquanto pendente.
  entity_id uuid references public.apolo_entities(id) on delete set null,
  vinculado_por uuid,
  vinculado_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.apolo_imobiliaria_match is
  'De-para MANUAL do nome-texto da imobiliaria das CADs para a entidade do Apolo. Fonte do vinculo por entidade.';
