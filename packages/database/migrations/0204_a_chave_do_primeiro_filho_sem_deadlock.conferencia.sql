-- 0204 · CONFERÊNCIA (PAN-124, pendência da F4). NÃO É MIGRATION: só SELECT no catálogo, não escreve
-- nada e não gasta sequence. Rodar logo depois de aplicar a 0204. Esperado: 4 linhas, todas "OK".
--
-- Antes da 0204 (medido em 01/10/2026, com a 0203 aplicada) as linhas 1, 3 e 4 dão "FALHOU": o
-- gatilho é AFTER e a função lê o pai com FOR UPDATE.

with gatilhos as (
  select t.tgname,
         (t.tgtype & 2) = 2 as antes,
         (t.tgtype & 4) = 4 as no_insert,
         (t.tgtype & 16) = 16 as no_update
    from pg_trigger t
   where t.tgrelid = 'public.hercules_empreendimentos'::regclass
     and not t.tgisinternal
),
funcao as (
  select pg_get_functiondef('public.hercules_empreendimento_chave_no_primeiro_filho'::regproc) as def
)
select 1 as n, 'o gatilho do primeiro filho é BEFORE, no INSERT e no UPDATE' as checagem,
       case when exists (select 1 from gatilhos where tgname = 'hercules_empreendimentos_chave_no_primeiro_filho'
                           and antes and no_insert and no_update) then 'OK' else 'FALHOU' end as resultado
union all
select 2, 'o pai_raiz continua BEFORE (é ele que trava o pai FOR SHARE)',
       case when exists (select 1 from gatilhos where tgname = 'hercules_empreendimentos_pai_raiz' and antes)
            then 'OK' else 'FALHOU' end
union all
select 3, 'o gatilho do primeiro filho dispara ANTES do pai_raiz (ordem alfabética dos BEFORE)',
       case when (select bool_and(antes) from gatilhos
                   where tgname in ('hercules_empreendimentos_chave_no_primeiro_filho', 'hercules_empreendimentos_pai_raiz'))
             and 'hercules_empreendimentos_chave_no_primeiro_filho' < 'hercules_empreendimentos_pai_raiz'
            then 'OK' else 'FALHOU' end
union all
select 4, 'a função não lê o pai FOR UPDATE, e só grava a chave onde ela é nula',
       case when (select def from funcao) !~* 'for\s+update'
             and (select def from funcao) ~* 'chave_do_grupo\s+is\s+null'
            then 'OK' else 'FALHOU' end
order by 1;
