-- ⚠️ NÃO APLICADA. Aguarda OK explícito do Lucas (operação sensível de banco).
-- Depende de 0060 estar aplicada antes (ordem de numeração, não de conteúdo).
--
-- VÍNCULO DA CAD: corretor + imobiliária + empreendimento por ID, não por texto.
--
-- POR QUÊ: a regra do Lucas é "toda CAD vinculada a corretor + imobiliária + empreendimento,
-- SEM EXCEÇÃO". Hoje `apolo_esteira` guarda os três como TEXTO (colunas `corretor`,
-- `imobiliaria`, `empreendimento`), e texto não é vínculo: o próprio comentário da 0060
-- documenta que o nome não desempata dois Henriques de imobiliárias diferentes.
--
-- POR QUE AQUI E NÃO EM apolo_entities.metadata: o sync do C2X faz upsert SUBSTITUINDO o
-- metadata inteiro (incidente 20/jul, 122 CADs perderam etapa e analista). `apolo_esteira`
-- existe exatamente por isso (0057) e é imune por construção.
--
-- POR QUE NÃO EM apolo_esteira.ficha: `ficha` é "o que o operador digitou", e
-- app/api/apolo/board/[id]/route.ts a grava inteira com o que a tela mandar. A tela não
-- conhece estas chaves e as apagaria no primeiro save. Mesmo raciocínio da 0060.
--
-- SEGURANÇA: aditiva. Colunas nullable, sem default, sem backfill. As colunas de texto da
-- 0057 continuam existindo e sendo preenchidas: o Board lê texto, a integridade lê id.

alter table public.apolo_esteira
  add column if not exists corretor_entity_id uuid
    references public.apolo_entities (id) on delete set null,
  add column if not exists imobiliaria_entity_id uuid
    references public.apolo_entities (id) on delete set null,
  -- Id do empreendimento no C2X (legado, numérico como texto). Empreendimento NÃO é entidade
  -- Apolo, então não há FK a fazer aqui.
  add column if not exists enterprise_id text;

create index if not exists apolo_esteira_corretor_idx
  on public.apolo_esteira (corretor_entity_id);
create index if not exists apolo_esteira_enterprise_idx
  on public.apolo_esteira (enterprise_id);

-- NÃO EXISTE CAD PÚBLICA SEM VÍNCULO. Esta é a trava de BANCO: se o código esquecer, o INSERT
-- falha. É a terceira das três travas empilhadas (as outras duas são o servidor derivar os ids
-- só do token e a escrita da esteira não ser best-effort).
--
-- Escopada por origem: as linhas legadas (origem 'asana'/'apolo'/null) passam intactas, e
-- nenhuma linha existente é reescrita.
alter table public.apolo_esteira
  drop constraint if exists apolo_esteira_vinculo_publico_check;
alter table public.apolo_esteira
  add constraint apolo_esteira_vinculo_publico_check check (
    origem is distinct from 'publico-cad'
    or (
      corretor_entity_id is not null
      and imobiliaria_entity_id is not null
      and nullif(enterprise_id, '') is not null
    )
  );
