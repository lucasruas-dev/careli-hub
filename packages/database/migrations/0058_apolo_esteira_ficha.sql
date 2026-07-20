-- A FICHA da CAD (dados do cadastro) passa a morar junto da esteira.
--
-- Duas fontes, um lugar só:
--   1. o que a MOST LEU do documento (nome, nascimento, RG, órgão emissor, filiação)
--   2. o que o OPERADOR digitar na validação (sexo, estado civil, escolaridade, renda,
--      profissão, patrimônio) — campos que NENHUM documento de identidade tem e que só
--      existem se alguém preencher
--
-- POR QUE NÃO EM `apolo_entities.metadata.cadastro`: pelo mesmo motivo da esteira (ver
-- migration 0057). O sync do C2X faz upsert substituindo o metadata inteiro, então tudo que o
-- operador digitasse numa CAD vinda do legado seria apagado na rodada seguinte — e desta vez
-- o prejuízo seria trabalho humano, não dado importado.
--
-- `ficha` guarda SÓ o que o Apolo produz. O que vem do C2X (contato, endereço) continua nas
-- tabelas próprias e é lido de lá; a tela sobrepõe as duas coisas na hora de exibir.

alter table public.apolo_esteira
  add column if not exists ficha jsonb not null default '{}'::jsonb,
  -- Quem editou por último e quando: a validação é trabalho humano e precisa de rastro.
  add column if not exists ficha_editada_em timestamptz,
  add column if not exists ficha_editada_por uuid;

-- Traz o que a leitura já preencheu nas 153 CADs de "Em Cadastro" (hoje em metadata.cadastro).
-- Para elas o metadata é seguro (foram criadas no Apolo, o sync não as conhece), mas manter a
-- ficha em dois lugares diferentes é pedir para divergir.
update public.apolo_esteira es
set ficha = coalesce(e.metadata->'cadastro', '{}'::jsonb)
from public.apolo_entities e
where e.id = es.entity_id
  and e.metadata ? 'cadastro'
  and es.ficha = '{}'::jsonb;
