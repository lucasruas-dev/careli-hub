-- 0205 · DADOS: O ID DA DIVISÃO NAS PROPOSTAS, DOCUMENTOS E ENVELOPES QUE JÁ EXISTEM (PAN-124 F5)
--
-- ⏳ NÃO APLICADO. Escrita em produção: OK próprio do Lucas. Aplicar DEPOIS da 0205 e DEPOIS do deploy
-- que conserta o escritor dos envelopes (lib/assinatura/envio-db.ts) e põe os leitores no OR.
--
-- Escreve, medido em 01/10/2026 (recontar na hora): 4.948 propostas, 57 documentos e 9 envelopes.
-- Nenhuma das três tabelas tem gatilho de efeito colateral nem está no realtime; o gatilho da 0205 só
-- age em UPDATE de unidade_id, que este arquivo não faz. `atualizado_em` NÃO é tocado: a ordem das
-- telas não muda.
--
-- Roda numa transação. As três checagens do fim levantam erro, e desfazem tudo, se algo não bater.

begin;

-- ANTES (para o registro): quantas linhas vão ser escritas.
select 'antes' as momento,
       (select count(*) from public.hercules_propostas where enterprise_id is null) as propostas_sem_id,
       (select count(*) from public.hercules_documentos where enterprise_id is null) as documentos_sem_id,
       (select count(*) from public.temis_envelopes where enterprise_id !~ '^[0-9]+$') as envelopes_com_sigla;

-- 1. Pela unidade.
update public.hercules_propostas p
   set enterprise_id = nullif(btrim(u.enterprise_id), '')
  from public.hercules_unidades u
 where u.id = p.unidade_id
   and p.enterprise_id is null;

update public.hercules_documentos d
   set enterprise_id = nullif(btrim(u.enterprise_id), '')
  from public.hercules_unidades u
 where u.id = d.unidade_id
   and d.enterprise_id is null;

update public.temis_envelopes e
   set enterprise_id = nullif(btrim(u.enterprise_id), '')
  from public.hercules_unidades u
 where u.id = e.unidade_id
   and e.enterprise_id !~ '^[0-9]+$'
   and nullif(btrim(u.enterprise_id), '') is not null;

-- 2. Reserva: a sigla gravada, pelo cadastro (esperado: 0 linhas, todas têm unidade).
update public.hercules_propostas p
   set enterprise_id = c.c2x_enterprise_id
  from public.hercules_empreendimentos c
 where p.enterprise_id is null
   and c.workspace_id = p.workspace_id
   and upper(c.codigo) = upper(btrim(p.empreendimento_codigo))
   and c.c2x_enterprise_id is not null;

update public.hercules_documentos d
   set enterprise_id = c.c2x_enterprise_id
  from public.hercules_empreendimentos c
 where d.enterprise_id is null
   and c.workspace_id = d.workspace_id
   and upper(c.codigo) = upper(btrim(d.empreendimento_codigo))
   and c.c2x_enterprise_id is not null;

-- 3. As checagens. Qualquer uma que falhar desfaz a transação inteira.
do $$
declare
  v_nulos int;
  v_siglas int;
  v_diverge int;
begin
  select (select count(*) from public.hercules_propostas where enterprise_id is null)
       + (select count(*) from public.hercules_documentos where enterprise_id is null)
    into v_nulos;
  if v_nulos > 0 then
    raise exception '[0205-dados] % linhas ficaram sem enterprise_id.', v_nulos;
  end if;

  select count(*) into v_siglas from public.temis_envelopes where enterprise_id !~ '^[0-9]+$';
  if v_siglas > 0 then
    raise exception '[0205-dados] % envelopes continuam com sigla.', v_siglas;
  end if;

  -- O id gravado é o da unidade em toda linha (0 divergências).
  select (select count(*) from public.hercules_propostas p join public.hercules_unidades u on u.id = p.unidade_id
           where p.enterprise_id is distinct from nullif(btrim(u.enterprise_id), ''))
       + (select count(*) from public.hercules_documentos d join public.hercules_unidades u on u.id = d.unidade_id
           where d.enterprise_id is distinct from nullif(btrim(u.enterprise_id), ''))
    into v_diverge;
  if v_diverge > 0 then
    raise exception '[0205-dados] % linhas com id diferente do da unidade.', v_diverge;
  end if;
end $$;

-- DEPOIS (para o registro): a contagem por id, para comparar com a contagem pela sigla.
select 'depois' as momento, enterprise_id, count(*) as propostas
  from public.hercules_propostas
 group by enterprise_id
 order by count(*) desc;

commit;
