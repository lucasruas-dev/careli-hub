-- 0203 · PROVA VIVA (PAN-124 F4). NÃO É MIGRATION: é o roteiro de conferência da 0203.
--
-- REESCRITA em 01/10/2026, depois da aplicação. A versão anterior falhou em duas coisas, apontadas
-- pela sessão Publicação:
--   • dava o resultado por RAISE NOTICE, que não aparece pelo MCP do Supabase;
--   • inseria linhas de teste, que gastam números da sequence de id do Panteon (0170) mesmo desfeitas.
-- Esta versão devolve UMA tabela (n, checagem, resultado, detalhe) no SELECT final e não insere nada.
-- O que escreve (os UPDATEs de prova) roda dentro de um sub-bloco: a recusa esperada desfaz o
-- sub-bloco sozinha, e o renome de prova termina com uma exceção de propósito, que também o desfaz.
-- O resultado sobrevive em variáveis. A única coisa criada é uma tabela TEMPORÁRIA, que some com a
-- sessão.
--
-- O gatilho do primeiro filho (seção (e), refeito na 0204) não é exercitado aqui: prová-lo exige um
-- INSERT. A 0204 tem a conferência dele pelo catálogo (0204_...conferencia.sql).
--
-- Esperado: 5 linhas, todas "OK".

drop table if exists pg_temp.prova_0203;
create temp table prova_0203 (n int, checagem text, resultado text, detalhe text);

-- 1. As 5 chaves, iguais ao nome, e só em pai com filhos.
insert into pg_temp.prova_0203
select 1, 'as 5 chaves, iguais ao nome do pai',
       case when count(*) = 5 and count(*) filter (where chave_do_grupo <> btrim(nome) or pai_id is not null
                  or not exists (select 1 from public.hercules_empreendimentos f where f.pai_id = e.id)) = 0
            then 'OK' else 'FALHOU' end,
       string_agg(codigo || '=' || chave_do_grupo, ', ' order by codigo)
  from public.hercules_empreendimentos e
 where chave_do_grupo is not null;

-- 2. A trilha da 0192 registrou o preenchimento.
insert into pg_temp.prova_0203
select 2, 'trilha do preenchimento (campo chave_do_grupo, autor migration:0203)',
       case when count(*) = 5 then 'OK' else 'FALHOU' end,
       count(*)::text || ' linhas'
  from public.hercules_empreendimento_alteracoes
 where campo = 'chave_do_grupo' and antes is null and autor = 'migration:0203';

-- 3 e 4. Trocar e apagar a chave são recusados.
do $$
declare v_detalhe text;
begin
  begin
    update public.hercules_empreendimentos set chave_do_grupo = 'Outra' where codigo = 'LAB' and workspace_id = 'careli';
    v_detalhe := 'passou';
  exception when others then
    v_detalhe := sqlerrm;
  end;
  insert into pg_temp.prova_0203 values (3, 'trocar a chave do LAB é recusado',
    case when v_detalhe like '[0203:chave-do-grupo]%' then 'OK' else 'FALHOU' end, v_detalhe);

  begin
    update public.hercules_empreendimentos set chave_do_grupo = null where codigo = 'VLO' and workspace_id = 'careli';
    v_detalhe := 'passou';
  exception when others then
    v_detalhe := sqlerrm;
  end;
  insert into pg_temp.prova_0203 values (4, 'apagar a chave do VLO é recusado',
    case when v_detalhe like '[0203:chave-do-grupo]%' then 'OK' else 'FALHOU' end, v_detalhe);
end $$;

-- 5. Renomear o pai passa, e a chave fica a de antes (é o caso que a F4 protege). Desfeito.
do $$
declare v_chave text; v_nome text; v_detalhe text;
begin
  begin
    update public.hercules_empreendimentos set nome = 'Lagoa Bonita Residencial' where codigo = 'LAB' and workspace_id = 'careli';
    select chave_do_grupo, nome into v_chave, v_nome from public.hercules_empreendimentos where codigo = 'LAB' and workspace_id = 'careli';
    v_detalhe := format('nome %s, chave %s', v_nome, v_chave);
    raise exception using errcode = 'P0099', message = 'desfazer o renome de prova';
  exception when sqlstate 'P0099' then
    null; -- desfeito; v_detalhe, v_nome e v_chave ficam
  end;
  insert into pg_temp.prova_0203 values (5, 'renomear o pai mantém a chave (desfeito)',
    case when v_nome = 'Lagoa Bonita Residencial' and v_chave = 'Lagoa Bonita' then 'OK' else 'FALHOU' end, v_detalhe);
end $$;

select n, checagem, resultado, detalhe from pg_temp.prova_0203 order by n;
