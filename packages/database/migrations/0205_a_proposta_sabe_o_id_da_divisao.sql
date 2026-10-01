-- 0205 · A PROPOSTA, O DOCUMENTO E O ENVELOPE SABEM O ID DA DIVISÃO (PAN-124, fatia F5)
--
-- ⏳ ESCRITA, NÃO APLICADA. Aplicar só com OK do Lucas (skill migration-supabase). Idempotente.
-- NÃO ESCREVE EM LINHA NENHUMA: o preenchimento das linhas que já existem é o
-- 0205_a_proposta_sabe_o_id_da_divisao.dados.sql, aplicado DEPOIS do deploy, com OK próprio.
--
-- NUMERAÇÃO. O plano de 26/09/2026 chamava esta de 0195, número que outra frente usou (o contrato
-- mora no Panteon). Conferido em 01/10/2026: 0204 é a última do repositório, em todas as branches.
--
-- POR QUE ELA EXISTE. O portal acha as propostas e os documentos de um empreendimento pela SIGLA
-- gravada (`empreendimento_codigo in (codes)`), e os codes vêm do catálogo do C2X. No próximo renome
-- de sigla no C2X (o 43 teve três em cinco dias), as propostas antigas somem da Mesa sem erro. O id
-- do C2X da divisão não muda com renome; ele precisa estar na própria linha.
--
-- DE ONDE VEM O ID: DA UNIDADE (`hercules_unidades.enterprise_id`). Medido em 01/10/2026, só SELECT:
--   • 4.948 propostas, 57 documentos e 2.260 envelopes, TODOS com unidade_id;
--   • propostas: a sigla gravada bate com o id da unidade em 4.899 de 4.899 com cadastro; as outras
--     49 são de ids sem cadastro (30, 2 e 34), e para elas a unidade é a única fonte;
--   • documentos: 57 de 57 batem;
--   • envelopes: 2.251 com o id certo (0 divergentes da unidade) e 9 com a SIGLA (VOC, VOL, VOR), o
--     último de 29/09: o escritor antigo ainda grava sigla (lib/assinatura/envio-db.ts, consertado na
--     mesma entrega).
--
-- ⚠️ PELA UNIDADE, E NÃO PELO SEGMENTO. O plano dizia "quando a unidade tiver segmento_id, o id é o do
-- segmento". Medido: 366 propostas têm unidade com segmento, e em TODAS o id do segmento difere do da
-- unidade (são unidades do VLO 35 com segmento VOC/VOL, e do LAB 31 com LBF/LBP/LBR), enquanto a sigla
-- gravada aponta para o id da unidade. Seguir o segmento mudaria que sessão do portal enxerga essas 366
-- propostas. Antes da unificação (PAI É A FONTE), o id é o de onde a unidade mora. É a mesma
-- conclusão do vigia (F3, 707 alarmes falsos pelo segmento).
--
-- O QUE ELA FAZ.
--   (a) coluna `enterprise_id text` em hercules_propostas e em hercules_documentos: o id do C2X da
--       DIVISÃO. Não é o uuid do pai, que continua em empreendimento_id;
--   (b) índices (workspace_id, enterprise_id, etapa) nas propostas e (workspace_id, enterprise_id)
--       nos documentos, para os filtros do portal;
--   (c) gatilho BEFORE INSERT OR UPDATE OF unidade_id nas duas tabelas: com enterprise_id nulo (ou a
--       unidade trocada sem enterprise_id novo), preenche pela unidade; na falta dela, pela sigla no
--       cadastro (codigo -> c2x_enterprise_id), só como reserva;
--   (d) gatilho BEFORE INSERT OR UPDATE em temis_envelopes: enterprise_id NÃO NUMÉRICO com unidade_id
--       vira o id da unidade. É o cinto de segurança enquanto um escritor antigo existir.
--
-- CUSTO E EFEITOS, conferidos em 01/10/2026: nenhuma das três tabelas tem gatilho hoje e nenhuma está
-- em publicação de realtime. Os gatilhos novos fazem 1 leitura por chave primária de
-- hercules_unidades por linha gravada.
--
-- O CÓDIGO TOLERA A COLUNA AUSENTE. Sem a 0205, o leitor filtra só pela sigla, como antes; com ela e
-- antes do .dados.sql, filtra por `enterprise_id in (ids) OU (enterprise_id nulo E sigla in codes)`.
--
-- DESFAZER (roda como postgres):
--   drop trigger if exists hercules_propostas_id_da_divisao on public.hercules_propostas;
--   drop trigger if exists hercules_documentos_id_da_divisao on public.hercules_documentos;
--   drop trigger if exists temis_envelopes_id_da_divisao on public.temis_envelopes;
--   drop function if exists public.hercules_id_da_divisao_pela_unidade();
--   drop function if exists public.temis_envelope_id_da_divisao();
--   drop index if exists public.hercules_propostas_enterprise_etapa;
--   drop index if exists public.hercules_documentos_enterprise;
--   alter table public.hercules_propostas drop column if exists enterprise_id;
--   alter table public.hercules_documentos drop column if exists enterprise_id;

-- ── (a) AS COLUNAS ────────────────────────────────────────────────────────────
alter table public.hercules_propostas add column if not exists enterprise_id text;
alter table public.hercules_documentos add column if not exists enterprise_id text;

comment on column public.hercules_propostas.enterprise_id is
  'Id do C2X da DIVISÃO onde a unidade da proposta mora (hercules_unidades.enterprise_id). Não é o uuid do pai (empreendimento_id). Preenchido pelo gatilho da 0205 quando vem nulo. É por ele, e não pela sigla, que o portal filtra (PAN-124 F5).';
comment on column public.hercules_documentos.enterprise_id is
  'Id do C2X da DIVISÃO onde a unidade do documento mora (hercules_unidades.enterprise_id). Preenchido pelo gatilho da 0205 quando vem nulo (PAN-124 F5).';

-- ── (b) ÍNDICES ───────────────────────────────────────────────────────────────
create index if not exists hercules_propostas_enterprise_etapa
  on public.hercules_propostas (workspace_id, enterprise_id, etapa);
create index if not exists hercules_documentos_enterprise
  on public.hercules_documentos (workspace_id, enterprise_id);

-- ── (c) PROPOSTA E DOCUMENTO: O ID PELA UNIDADE ───────────────────────────────
create or replace function public.hercules_id_da_divisao_pela_unidade()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id text;
begin
  -- Quem gravou o id manda. Na troca de unidade sem id novo, o id antigo não vale mais.
  if tg_op = 'UPDATE' then
    if new.unidade_id is not distinct from old.unidade_id then
      return new;
    end if;
    if new.enterprise_id is distinct from old.enterprise_id then
      return new;
    end if;
    new.enterprise_id := null;
  end if;

  if nullif(btrim(new.enterprise_id), '') is not null then
    new.enterprise_id := btrim(new.enterprise_id);
    return new;
  end if;

  if new.unidade_id is not null then
    select nullif(btrim(u.enterprise_id), '')
      into v_id
      from public.hercules_unidades u
     where u.id = new.unidade_id;
  end if;

  -- Reserva: a sigla gravada, pelo cadastro. Só quando a unidade não respondeu.
  if v_id is null and nullif(btrim(new.empreendimento_codigo), '') is not null then
    select nullif(btrim(c.c2x_enterprise_id), '')
      into v_id
      from public.hercules_empreendimentos c
     where c.workspace_id = new.workspace_id
       and upper(c.codigo) = upper(btrim(new.empreendimento_codigo))
     limit 1;
  end if;

  new.enterprise_id := v_id;
  return new;
end;
$$;

comment on function public.hercules_id_da_divisao_pela_unidade() is
  'BEFORE INSERT OR UPDATE OF unidade_id em hercules_propostas e hercules_documentos: enterprise_id nulo vira o id do C2X da unidade (hercules_unidades.enterprise_id), e na falta dela o da sigla no cadastro (0205, PAN-124 F5).';

drop trigger if exists hercules_propostas_id_da_divisao on public.hercules_propostas;
create trigger hercules_propostas_id_da_divisao
  before insert or update of unidade_id on public.hercules_propostas
  for each row
  execute function public.hercules_id_da_divisao_pela_unidade();

drop trigger if exists hercules_documentos_id_da_divisao on public.hercules_documentos;
create trigger hercules_documentos_id_da_divisao
  before insert or update of unidade_id on public.hercules_documentos
  for each row
  execute function public.hercules_id_da_divisao_pela_unidade();

-- ── (d) ENVELOPE: SIGLA NO LUGAR DO ID VIRA O ID DA UNIDADE ───────────────────
create or replace function public.temis_envelope_id_da_divisao()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_id text;
begin
  if new.enterprise_id is null or btrim(new.enterprise_id) ~ '^[0-9]+$' or new.unidade_id is null then
    return new;
  end if;

  select nullif(btrim(u.enterprise_id), '')
    into v_id
    from public.hercules_unidades u
   where u.id = new.unidade_id;

  if v_id is not null then
    new.enterprise_id := v_id;
  end if;
  return new;
end;
$$;

comment on function public.temis_envelope_id_da_divisao() is
  'BEFORE INSERT OR UPDATE em temis_envelopes: enterprise_id não numérico (a sigla que o escritor antigo gravava) com unidade_id vira o id do C2X da unidade (0205, PAN-124 F5).';

drop trigger if exists temis_envelopes_id_da_divisao on public.temis_envelopes;
create trigger temis_envelopes_id_da_divisao
  before insert or update on public.temis_envelopes
  for each row
  execute function public.temis_envelope_id_da_divisao();
