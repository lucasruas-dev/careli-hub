-- 0195 · O CONTRATO MORA NO PANTEON: quem assinou, quando, de que documento, e o envelope da D4Sign
-- ao lado do da Clicksign, num registro só.
--
-- ⏳ ESCRITA EM 28/09/2026, NÃO APLICADA. Aplicar só com OK do Lucas (CLAUDE.md, bloqueio operacional).
-- ⚠️ NÚMERO: docs/apolo/pan-124-plano-do-cadastro.md reserva 0195 para a F5 do PAN-124. Quem for
-- aplicado primeiro fica com o número; o outro renumera o PRÓPRIO arquivo.
--
-- POR QUE ELA EXISTE. Lucas, 28/09/2026: "já cansei de falar que informações de venda, contrato,
-- assinatura tem que morar em um local e ele alimentar tudo" e "pode seguir, faz tudo morar no
-- Panteon". Medido no mesmo dia, sem ela:
--   • o Panteon não guarda QUEM assinou (o dado existe só no payload cru do webhook, que também traz
--     CPF em 201 de 226 eventos);
--   • a D4Sign não tem onde morar: o status vive num Map em memória de cada instância da Vercel;
--   • o estado regride (13 'signature_started' depois de um 'sign', 5 documentos);
--   • o envelope não sabe se é contrato, distrato ou cessão: os três usam o proposta_id da venda.
--
-- O QUE ELA FAZ:
--   1. temis_envelopes ganha origem, finalidade, trabalho_id, c2x_contract_signature_id,
--      conferido_em e tentado_em; finalidade dos 26 existentes preenchida (medido: 8 contrato, 18 acordo);
--   2. unicidade de (provedor, provedor_documento_id) SEM predicado; o índice antigo parcial sai;
--   3. a função temis_envelope_registrar_assinaturas: a ÚNICA escrita de quadro, marca e estado
--      proposto por provedor;
--   4. índice de temis_assinatura_eventos pela chave que todo leitor usa;
--   5. a origem 'espelho_d4sign' (e a 'conclusao' da 0177) na passagem de etapa do card;
--   6. a linha de estado do espelho da D4Sign (vez da rodada, última rodada boa, pausa por cota);
--   7. duas views de leitura, security_invoker, só para o service_role.
--
-- O QUE ELA NÃO FAZ: não corrige a sigla de temis_envelopes.enterprise_id (PAN-124); não preenche
-- assinado_em (scripts/temis/reprocessar-eventos-clicksign.mjs); não cria linha da D4Sign (espelho,
-- F3); não preenche envelope_id dos eventos (0195_*.dados.sql, depois do deploy da F1).
--
-- ATENCAO 1: SÓ O ESPELHO ESCREVE origem = 'c2x'. O Panteon não envia, não cancela e não troca
--   signatário nessas linhas. Os CHECKs impedem 'c2x' com outro provedor.
--
-- ATENCAO 2: A UNICIDADE DO DOCUMENTO É SEM PREDICADO DE PROPÓSITO (o PostgREST não usa índice
--   parcial como alvo de on_conflict). NULLS DISTINCT: rascunhos sem documento continuam podendo ser
--   vários. E c2x_contract_signature_id NÃO é único: se o C2X trocar o uuidDoc de um mesmo envio, o
--   documento novo é OUTRA linha (o velho continua com o último estado que a D4Sign deu a ele).
--
-- ATENCAO 3: A MARCA POR PESSOA É MONOTÔNICA, ATÔMICA E CASADA PELA CHAVE. assinado_em e
--   recusado_em nunca voltam a nulo, a PRIMEIRA data vence; convite_falhou_em e convite_entregue_em
--   ficam com a MAIS RECENTE (um reenvio pode consertar o convite). Linha travada (FOR UPDATE) antes
--   do merge. A marca casa pelo `chave`; o e-mail só vale quando a chave da marca não existe no
--   quadro E o e-mail é único no quadro (casar por e-mail sem consumir o par pinta N linhas com uma
--   marca: lib/guardian/d4sign-consulta.ts:150-155). A data guardada é o TEXTO que o chamador
--   mandou, já em -03:00 (lib/assinatura/instante.ts); o cast só valida e ordena. Presença se testa
--   por valor (nullif(item->>'x','') is not null), nunca pelo operador ?, que só testa a chave.
--
-- ATENCAO 4: O ESTADO NÃO REGRIDE. Ordem: rascunho 0 < desconhecido 1 < aguardando 2 < parcial 3 <
--   terminais 4. Só entra estado proposto de ordem ESTRITAMENTE maior; 'desconhecido' proposto nunca
--   entra (é só da inserção). Terminal não muda mais. "parcial" é derivado: alguém com assinado_em e
--   o estado dizendo que ninguém assinou vira "parcial".
--
-- ATENCAO 5: fechado_em NUNCA É "AGORA". É a data que o provedor deu (p_fechado_em) ou, no
--   assinado com todos marcados, a última assinatura. Sem nenhuma das duas fica NULO e é
--   recalculado a cada chamada enquanto nulo. (A v1 gravava now() e congelava a hora do cron como
--   data da assinatura, que ia para data_assinatura e para a minuta de distrato.) Os cancelamentos
--   feitos PELO PANTEON continuam carimbando a hora do próprio ato, fora daqui.
--
-- ATENCAO 6: O DOCUMENTO E A VERSÃO. p_documento: linha sem provedor_documento_id adota o do evento;
--   linha com OUTRO documento recusa (o evento do documento 1 não pinta o documento 2 do reenvio).
--   p_quadro_de: a troca de signatário manda o atualizado_em que leu; se mudou, recusa e ela relê.
--
-- ATENCAO 7: FUNÇÃO NOVA NASCE ABERTA NO SUPABASE ("revoke from public" não alcança anon nem
--   authenticated, 0194). Os três revogados; só service_role executa. SECURITY INVOKER. Conferir
--   role_routine_grants depois de aplicar.
--
-- ATENCAO 8: AS VIEWS SÃO security_invoker E FECHADAS. A de contratos ignora SÓ a proposta DA CARGA
--   pendurada na linha-sombra do pai (a regra de situacao-da-unidade.ts:573-581); nativa no pai vale.
--   A de envelopes só traz finalidade 'contrato'.
--
-- ATENCAO 9: O CHECK DA PASSAGEM LEVA 'conclusao' JUNTO (a 0177 não está em produção). Não aplicar
--   a 0177 depois desta: ela redefine o mesmo CHECK sem 'espelho_d4sign'.
--
-- ATENCAO 10: RLS ligada e sem policy em temis_envelopes, temis_assinatura_eventos e na tabela nova.
--
-- DESFAZER (se preciso, com OK):
--   drop view if exists public.temis_envelopes_de_contrato;
--   drop view if exists public.temis_contratos_do_panteon;
--   drop function if exists public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz);
--   drop table if exists public.temis_espelho_d4sign;
--   drop index if exists public.temis_assinatura_eventos_documento_idx;
--   drop index if exists public.temis_envelopes_rodizio_idx;
--   drop index if exists public.temis_envelopes_c2x_envio_idx;
--   drop index if exists public.temis_envelopes_provedor_documento_unico;
--   create index if not exists temis_envelopes_provedor_documento_idx on public.temis_envelopes
--     (provedor, provedor_documento_id) where provedor_documento_id is not null;
--   alter table public.temis_envelopes drop constraint if exists temis_envelopes_c2x_so_d4sign,
--     drop constraint if exists temis_envelopes_origem_valida, drop constraint if exists temis_envelopes_finalidade_valida;
--   alter table public.temis_envelopes drop column if exists tentado_em, drop column if exists conferido_em,
--     drop column if exists c2x_contract_signature_id, drop column if exists trabalho_id,
--     drop column if exists finalidade, drop column if exists origem;
--   (o check da passagem volta ao texto da 0153)
--   ⚠️ Depois de o espelho gravar, antes apagar as linhas dele (provedor 'd4sign' e origem 'c2x').

begin;

-- 1. AS COLUNAS ─────────────────────────────────────────────────────────────────────────────
alter table public.temis_envelopes
  add column if not exists origem text not null default 'panteon',
  add column if not exists finalidade text,
  add column if not exists trabalho_id uuid references public.temis_trabalhos(id) on delete set null,
  add column if not exists c2x_contract_signature_id bigint,
  add column if not exists conferido_em timestamptz,
  add column if not exists tentado_em timestamptz;

alter table public.temis_envelopes drop constraint if exists temis_envelopes_origem_valida;
alter table public.temis_envelopes
  add constraint temis_envelopes_origem_valida check (origem in ('panteon', 'c2x'));

alter table public.temis_envelopes drop constraint if exists temis_envelopes_c2x_so_d4sign;
alter table public.temis_envelopes
  add constraint temis_envelopes_c2x_so_d4sign check (origem = 'panteon' or provedor = 'd4sign');

alter table public.temis_envelopes drop constraint if exists temis_envelopes_finalidade_valida;
alter table public.temis_envelopes
  add constraint temis_envelopes_finalidade_valida check (finalidade is null or finalidade in
    ('contrato', 'distrato', 'cessao', 'cancelamento_correcao', 'acordo'));

-- Os 26 de hoje (medido em 28/09: 18 acordos; 8 com proposta, todos com documento tipo 'contrato'
-- gerado da minuta do modelo do empreendimento). Idempotente.
update public.temis_envelopes set finalidade = 'acordo'
 where finalidade is null and compromisso_id is not null;
update public.temis_envelopes e set finalidade = 'contrato'
  from public.hercules_documentos d
 where e.finalidade is null and e.proposta_id is not null
   and d.id = e.documento_id and d.tipo = 'contrato';

comment on column public.temis_envelopes.origem is
  'Quem mandou este envelope: panteon (a Têmis/o Hades) ou c2x (o C2X mandou para a D4Sign; escrita SÓ pelo espelho). 0195, ATENCAO 1.';
comment on column public.temis_envelopes.finalidade is
  'O que este envelope assina: contrato (da venda), distrato, cessao, cancelamento_correcao ou acordo (Hades). Nulo = não se sabe (tipo do C2X não mapeado): não entra na leitura única nem move card. Só contrato move o card de contrato e grava data_assinatura.';
comment on column public.temis_envelopes.trabalho_id is
  'O card da Têmis que mandou o envelope (nulo nas linhas do C2X e nas antigas).';
comment on column public.temis_envelopes.c2x_contract_signature_id is
  'contract_signatures.id do C2X nas linhas de origem c2x (o envioId das telas). NÃO é único (ATENCAO 2).';
comment on column public.temis_envelopes.conferido_em is
  'Última conferência BEM-SUCEDIDA com o provedor (webhook aplicado ou /list do espelho).';
comment on column public.temis_envelopes.tentado_em is
  'Última TENTATIVA do espelho de conferir por pessoa, com sucesso ou não. É a régua do rodízio: documento que sempre falha não trava a fila.';
comment on column public.temis_envelopes.signatarios is
  'O quadro: [{chave, ordem, papel, nome, email, perfil?, assinado_em?, recusado_em?, convite_falhou_em?, convite_entregue_em?}]. chave única no quadro. Marcas escritas SÓ por temis_envelope_registrar_assinaturas. E-mail é dado interno: não vai a navegador nenhum. Finalidade da cópia (D4Sign): mostrar quem falta assinar; retenção: a do contrato.';

-- 2. A UNICIDADE ────────────────────────────────────────────────────────────────────────────
create unique index if not exists temis_envelopes_provedor_documento_unico
  on public.temis_envelopes (provedor, provedor_documento_id);
drop index if exists public.temis_envelopes_provedor_documento_idx;  -- redundante com o de cima

create index if not exists temis_envelopes_c2x_envio_idx
  on public.temis_envelopes (c2x_contract_signature_id)
  where c2x_contract_signature_id is not null;

-- O rodízio do espelho: o que ainda se move, da tentativa mais antiga para a mais recente.
create index if not exists temis_envelopes_rodizio_idx
  on public.temis_envelopes (provedor, tentado_em nulls first)
  where estado in ('aguardando', 'parcial', 'desconhecido');

-- 3. OS EVENTOS PELA CHAVE QUE TODO LEITOR USA ──────────────────────────────────────────────
create index if not exists temis_assinatura_eventos_documento_idx
  on public.temis_assinatura_eventos (provedor_documento_id, recebido_em desc)
  where provedor_documento_id is not null;

-- 4. A ÚNICA ESCRITA DE QUADRO, MARCA E ESTADO PROPOSTO ─────────────────────────────────────
create or replace function public.temis_envelope_registrar_assinaturas(
  p_envelope     uuid,
  p_marcas       jsonb       default '[]'::jsonb,
  p_estado       text        default null,
  p_estado_cru   text        default null,
  p_quadro       jsonb       default null,
  p_conferido_em timestamptz default null,
  p_fechado_em   timestamptz default null,
  p_documento    text        default null,
  p_quadro_de    timestamptz default null
)
returns table (
  recusa        text,
  estado_antes  text,
  estado_depois text,
  mudou_estado  boolean,
  assinaram     integer,
  total         integer,
  fechado       timestamptz,
  quadro        jsonb
)
language plpgsql
security invoker
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_linha     public.temis_envelopes%rowtype;
  v_antigo    jsonb;
  v_quadro    jsonb;
  v_marcas    jsonb;
  v_doc       text;
  v_estado    text;
  v_cru       text;
  v_fechado   timestamptz;
  v_assinaram integer;
  v_total     integer;
begin
  if p_estado is not null and p_estado not in
     ('rascunho', 'aguardando', 'parcial', 'assinado', 'recusado', 'cancelado', 'expirado', 'desconhecido') then
    raise exception 'estado fora da língua da casa: %', p_estado using errcode = '22023';
  end if;

  select * into v_linha from public.temis_envelopes t where t.id = p_envelope for update;
  if not found then
    return;  -- zero linhas: "não achei o envelope"
  end if;

  -- (0) ATENCAO 6: o documento e a versão.
  v_doc := v_linha.provedor_documento_id;
  if p_documento is not null then
    if v_doc is null then
      v_doc := p_documento;
    elsif v_doc <> p_documento then
      return query select 'documento_diferente'::text, v_linha.estado, v_linha.estado, false,
                          null::integer, null::integer, v_linha.fechado_em, null::jsonb;
      return;
    end if;
  end if;
  if p_quadro is not null and p_quadro_de is not null
     and v_linha.atualizado_em is distinct from p_quadro_de then
    return query select 'quadro_mudou'::text, v_linha.estado, v_linha.estado, false,
                        null::integer, null::integer, v_linha.fechado_em, null::jsonb;
    return;
  end if;

  v_antigo := coalesce(v_linha.signatarios, '[]'::jsonb);
  v_quadro := v_antigo;

  -- (a) Quadro novo: o novo manda na lista; quem continua nela leva as marcas que já tinha. Casa
  -- pela chave; sem chave igual, pelo e-mail ÚNICO no quadro antigo. Nunca "limit 1" sem ordem.
  if p_quadro is not null then
    if jsonb_typeof(p_quadro) <> 'array' then
      raise exception 'p_quadro precisa ser uma lista' using errcode = '22023';
    end if;
    select coalesce(jsonb_agg(
             jsonb_strip_nulls(novo.item)
             || coalesce((select jsonb_object_agg(k.chave, antigo.item -> k.chave)
                            from unnest(array['assinado_em', 'recusado_em', 'convite_falhou_em',
                                              'convite_entregue_em']) as k(chave)
                           where nullif(antigo.item ->> k.chave, '') is not null), '{}'::jsonb)
             order by novo.posicao), '[]'::jsonb)
      into v_quadro
      from jsonb_array_elements(p_quadro) with ordinality as novo(item, posicao)
      left join lateral (
        select velho.item
          from jsonb_array_elements(v_antigo) with ordinality as velho(item, pos)
         where (nullif(novo.item ->> 'chave', '') is not null
                and velho.item ->> 'chave' = novo.item ->> 'chave')
            or (not exists (select 1 from jsonb_array_elements(v_antigo) o
                             where nullif(novo.item ->> 'chave', '') is not null
                               and o ->> 'chave' = novo.item ->> 'chave')
                and nullif(lower(velho.item ->> 'email'), '') = lower(novo.item ->> 'email')
                and (select count(*) from jsonb_array_elements(v_antigo) o
                      where lower(o ->> 'email') = lower(novo.item ->> 'email')) = 1)
         order by (velho.item ->> 'chave' = novo.item ->> 'chave') desc nulls last, velho.pos
         limit 1
      ) as antigo on true;
  end if;

  -- (b) As marcas (ATENCAO 3).
  if p_marcas is not null and jsonb_typeof(p_marcas) = 'array' and jsonb_array_length(p_marcas) > 0 then
    select coalesce(jsonb_agg(jsonb_strip_nulls(x)), '[]'::jsonb) into v_marcas
      from jsonb_array_elements(p_marcas) as x;

    select coalesce(jsonb_agg(
             q.item
             || case when nullif(q.item ->> 'assinado_em', '') is null and m.assinado_em is not null
                     then jsonb_build_object('assinado_em', m.assinado_em) else '{}'::jsonb end
             || case when nullif(q.item ->> 'recusado_em', '') is null and m.recusado_em is not null
                     then jsonb_build_object('recusado_em', m.recusado_em) else '{}'::jsonb end
             || case when m.falhou is not null
                      and (nullif(q.item ->> 'convite_falhou_em', '') is null
                           or m.falhou::timestamptz > (q.item ->> 'convite_falhou_em')::timestamptz)
                     then jsonb_build_object('convite_falhou_em', m.falhou) else '{}'::jsonb end
             || case when m.entregue is not null
                      and (nullif(q.item ->> 'convite_entregue_em', '') is null
                           or m.entregue::timestamptz > (q.item ->> 'convite_entregue_em')::timestamptz)
                     then jsonb_build_object('convite_entregue_em', m.entregue) else '{}'::jsonb end
             order by q.posicao), '[]'::jsonb)
      into v_quadro
      from jsonb_array_elements(v_quadro) with ordinality as q(item, posicao)
      left join lateral (
        select
          (array_agg(x.marca ->> 'assinado_em' order by (x.marca ->> 'assinado_em')::timestamptz)
             filter (where nullif(x.marca ->> 'assinado_em', '') is not null))[1] as assinado_em,
          (array_agg(x.marca ->> 'recusado_em' order by (x.marca ->> 'recusado_em')::timestamptz)
             filter (where nullif(x.marca ->> 'recusado_em', '') is not null))[1] as recusado_em,
          (array_agg(x.marca ->> 'convite_falhou_em' order by (x.marca ->> 'convite_falhou_em')::timestamptz desc)
             filter (where nullif(x.marca ->> 'convite_falhou_em', '') is not null))[1] as falhou,
          (array_agg(x.marca ->> 'convite_entregue_em' order by (x.marca ->> 'convite_entregue_em')::timestamptz desc)
             filter (where nullif(x.marca ->> 'convite_entregue_em', '') is not null))[1] as entregue
          from jsonb_array_elements(v_marcas) as x(marca)
         where (nullif(x.marca ->> 'chave', '') is not null and x.marca ->> 'chave' = q.item ->> 'chave')
            or (not exists (select 1 from jsonb_array_elements(v_quadro) o
                             where nullif(x.marca ->> 'chave', '') is not null
                               and o ->> 'chave' = x.marca ->> 'chave')
                and nullif(lower(x.marca ->> 'email'), '') = lower(q.item ->> 'email')
                and (select count(*) from jsonb_array_elements(v_quadro) o
                      where lower(o ->> 'email') = lower(q.item ->> 'email')) = 1)
      ) as m on true;
  end if;

  select count(*) filter (where nullif(q.item ->> 'assinado_em', '') is not null), count(*)
    into v_assinaram, v_total
    from jsonb_array_elements(v_quadro) as q(item);

  -- (c) O estado, monotônico (ATENCAO 4).
  v_estado := v_linha.estado;
  v_cru    := v_linha.estado_cru;
  if v_linha.estado not in ('assinado', 'recusado', 'cancelado', 'expirado') then
    if p_estado is not null and p_estado <> 'desconhecido'
       and (case p_estado when 'rascunho' then 0 when 'desconhecido' then 1 when 'aguardando' then 2
                          when 'parcial' then 3 else 4 end)
         > (case v_linha.estado when 'rascunho' then 0 when 'desconhecido' then 1 when 'aguardando' then 2
                                when 'parcial' then 3 else 4 end) then
      v_estado := p_estado;
      v_cru    := coalesce(p_estado_cru, v_cru);
    end if;
    if v_assinaram > 0 and v_estado in ('rascunho', 'desconhecido', 'aguardando') then
      v_estado := 'parcial';
    end if;
  end if;

  -- (d) O fechamento (ATENCAO 5): nunca "agora".
  v_fechado := v_linha.fechado_em;
  if v_estado in ('assinado', 'recusado', 'cancelado', 'expirado') and v_fechado is null then
    v_fechado := coalesce(
      p_fechado_em,
      case when v_estado = 'assinado' and v_total > 0 and v_assinaram = v_total then
        (select max((q.item ->> 'assinado_em')::timestamptz)
           from jsonb_array_elements(v_quadro) as q(item)
          where nullif(q.item ->> 'assinado_em', '') is not null)
      end);
  end if;

  update public.temis_envelopes t
     set signatarios           = v_quadro,
         estado                = v_estado,
         estado_cru            = v_cru,
         fechado_em            = v_fechado,
         provedor_documento_id = v_doc,
         conferido_em  = case when p_conferido_em is null then t.conferido_em
                              else greatest(coalesce(t.conferido_em, p_conferido_em), p_conferido_em) end,
         atualizado_em = case when v_quadro is distinct from t.signatarios
                                or v_estado is distinct from t.estado
                                or v_doc is distinct from t.provedor_documento_id
                                or v_fechado is distinct from t.fechado_em
                              then now() else t.atualizado_em end
   where t.id = p_envelope;

  return query
    select null::text, v_linha.estado, v_estado, (v_estado is distinct from v_linha.estado),
           v_assinaram, v_total, v_fechado, v_quadro;
end;
$$;

comment on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) is
  'A única escrita de quadro, marca por pessoa e estado proposto por provedor (0195). Trava a linha, confere documento e versão, mescla o quadro (p_quadro, pela chave) e as marcas (p_marcas, pela chave; e-mail só se único) sem apagar marca, move o estado só para a frente e nunca inventa fechado_em. Devolve o antes, o depois, a contagem e o quadro mesclado. Só service_role.';

revoke execute on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) from public;
revoke execute on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) from anon;
revoke execute on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) from authenticated;
grant execute on function public.temis_envelope_registrar_assinaturas(uuid, jsonb, text, text, jsonb, timestamptz, timestamptz, text, timestamptz) to service_role;

-- 5. A ORIGEM DO ESPELHO NA PASSAGEM DO CARD (ATENCAO 9) ────────────────────────────────────
alter table public.temis_trabalho_etapas drop constraint if exists temis_trabalho_etapas_origem_valida;
alter table public.temis_trabalho_etapas
  add constraint temis_trabalho_etapas_origem_valida
    check (origem in (
      'abertura', 'atividade', 'conclusao', 'contrato_gerado', 'envio_assinatura',
      'espelho_d4sign', 'webhook_assinatura', 'indeferimento', 'retorno_para_correcao'
    ));
comment on column public.temis_trabalho_etapas.origem is
  'O que fez o card andar: abertura, atividade, conclusao, contrato_gerado, envio_assinatura, espelho_d4sign (o espelho da D4Sign viu o contrato enviado ou assinado pelo C2X), webhook_assinatura, indeferimento, retorno_para_correcao.';

-- 6. O ESTADO DO ESPELHO (uma linha só) ─────────────────────────────────────────────────────
create table if not exists public.temis_espelho_d4sign (
  id                  smallint primary key default 1 check (id = 1),
  em_curso_ate        timestamptz,  -- a vez da rodada: só uma rodada por vez (cron, retry, POST)
  ultima_rodada_ok_em timestamptz,  -- a campainha do "conferência atrasada"
  d4sign_pausada_ate  timestamptz,  -- HTTP 429: ninguém chama a D4Sign até aqui
  relatorio           jsonb,        -- só contagens e ids, nunca nome nem e-mail
  atualizado_em       timestamptz not null default now()
);
insert into public.temis_espelho_d4sign (id) values (1) on conflict (id) do nothing;
alter table public.temis_espelho_d4sign enable row level security;
revoke all on table public.temis_espelho_d4sign from anon, authenticated;
comment on table public.temis_espelho_d4sign is
  'Estado do espelho da D4Sign (0195): a vez da rodada, a última rodada boa, a pausa por cota e o último relatório (só contagens). Só service_role.';

-- 7. AS VIEWS DA LEITURA ÚNICA (ATENCAO 8) ──────────────────────────────────────────────────
create or replace view public.temis_contratos_do_panteon
with (security_invoker = true) as
select
  p.id                  as proposta_id,
  p.workspace_id,
  p.origem,
  p.origem_c2x_id       as ar_c2x_id,
  p.etapa,
  p.etapa_desde,
  p.criado_em,
  p.cliente_nome,
  p.imobiliaria_nome,
  p.valor,
  p.preco_tabela,
  p.data_assinatura,
  p.data_ato,
  p.data_faturamento,
  p.cancelamento_pedido_em,
  u.id                  as unidade_id,
  u.espelho_de,
  u.codigo              as unidade_codigo,
  u.quadra,
  u.lote,
  u.enterprise_id,
  u.origem_c2x_id       as unidade_c2x_id,
  u.preco_tabela        as unidade_preco_tabela,
  coalesce(he.codigo, p.empreendimento_codigo) as empreendimento_codigo,
  (select min(pe.quando)
     from public.hercules_proposta_etapas pe
    where pe.proposta_id = p.id
      and pe.para = 'contrato') as gerado_em
from public.hercules_propostas p
join public.hercules_unidades u on u.id = p.unidade_id
left join lateral (
  select e.codigo
    from public.hercules_empreendimentos e
   where e.workspace_id = u.workspace_id
     and e.c2x_enterprise_id = u.enterprise_id
   order by e.codigo
   limit 1
) he on true
where p.etapa in ('contrato', 'assinatura', 'faturado')
  and p.aberta is not false
  and p.cancelada_em is null
  and not (u.espelho_de is not null and p.origem = 'c2x');

comment on view public.temis_contratos_do_panteon is
  'Uma linha por venda viva com contrato (contrato, assinatura ou faturado), das duas origens. Fica de fora só a proposta DA CARGA pendurada na linha-sombra do pai (a regra de situacao-da-unidade.ts). Sem CPF nem contato. O terreno sai da união da régua, em TS. Só service_role (0195, ATENCAO 8).';
revoke all on table public.temis_contratos_do_panteon from anon, authenticated, service_role;
grant select on table public.temis_contratos_do_panteon to service_role;

create or replace view public.temis_envelopes_de_contrato
with (security_invoker = true) as
select
  e.id, e.workspace_id, e.provedor, e.origem, e.envelope_id, e.provedor_documento_id,
  e.c2x_contract_signature_id, e.proposta_id, e.documento_id, e.trabalho_id, e.unidade_id,
  e.estado, e.estado_cru, e.falha, e.signatarios, e.ordenada,
  e.enviado_em, e.fechado_em, e.conferido_em, e.criado_em, e.atualizado_em
from public.temis_envelopes e
where e.finalidade = 'contrato';

comment on view public.temis_envelopes_de_contrato is
  'Envelopes de CONTRATO de venda (finalidade contrato), dos dois provedores. signatarios traz e-mail: nunca atravessa para navegador. Só service_role (0195, ATENCAO 8).';
revoke all on table public.temis_envelopes_de_contrato from anon, authenticated, service_role;
grant select on table public.temis_envelopes_de_contrato to service_role;

-- 8. RLS (ATENCAO 10) ────────────────────────────────────────────────────────────────────────
alter table public.temis_envelopes enable row level security;
alter table public.temis_assinatura_eventos enable row level security;

commit;
