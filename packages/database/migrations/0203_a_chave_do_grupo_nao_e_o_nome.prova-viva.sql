-- 0203 · PROVA VIVA (PAN-124 F4). NÃO É MIGRATION: é o roteiro de conferência para rodar LOGO DEPOIS
-- de aplicar a 0203, com o mesmo OK do Lucas. Tudo dentro de begin ... rollback: nada fica gravado.
-- Cada bloco levanta NOTICE com "OK" ou "FALHOU"; qualquer FALHOU é motivo para desfazer a 0203 (o
-- SQL de desfazer está no cabeçalho dela).
--
-- Esperado, medido em 01/10/2026: 5 chaves (LAB, LOX, PDX, RDX, VLO), cada uma igual ao nome do pai;
-- 5 linhas de trilha da 0192 com campo chave_do_grupo e autor migration:0203.

begin;

-- 1. As 5 chaves, iguais ao nome, e só nos pais com filhos.
do $$
declare v int; v_errado int;
begin
  select count(*) into v from public.hercules_empreendimentos where chave_do_grupo is not null;
  select count(*) into v_errado from public.hercules_empreendimentos
   where chave_do_grupo is not null and (chave_do_grupo <> btrim(nome) or pai_id is not null);
  raise notice '1. chaves: % (esperado 5), diferentes do nome ou fora de pai: % (esperado 0) -> %',
    v, v_errado, case when v = 5 and v_errado = 0 then 'OK' else 'FALHOU' end;
end $$;

-- 2. A trilha da 0192 registrou o preenchimento.
do $$
declare v int;
begin
  select count(*) into v from public.hercules_empreendimento_alteracoes
   where campo = 'chave_do_grupo' and antes is null and autor = 'migration:0203';
  raise notice '2. trilha do preenchimento: % (esperado 5) -> %', v, case when v = 5 then 'OK' else 'FALHOU' end;
end $$;

-- 3. Trocar a chave do LAB é recusado.
do $$
begin
  update public.hercules_empreendimentos set chave_do_grupo = 'Outra' where codigo = 'LAB' and workspace_id = 'careli';
  raise notice '3. trocar a chave do LAB -> FALHOU (passou)';
exception when others then
  raise notice '3. trocar a chave do LAB recusado (%) -> %', sqlerrm,
    case when sqlerrm like '[0203:chave-do-grupo]%' then 'OK' else 'FALHOU' end;
end $$;

-- 4. Apagar a chave também é recusado.
do $$
begin
  update public.hercules_empreendimentos set chave_do_grupo = null where codigo = 'VLO' and workspace_id = 'careli';
  raise notice '4. apagar a chave do VLO -> FALHOU (passou)';
exception when others then
  raise notice '4. apagar a chave do VLO recusado -> %',
    case when sqlerrm like '[0203:chave-do-grupo]%' then 'OK' else 'FALHOU' end;
end $$;

-- 5. Renomear o pai passa, e a chave fica a de antes (é o caso que a F4 protege).
savepoint antes_do_renome;
update public.hercules_empreendimentos set nome = 'Lagoa Bonita Residencial' where codigo = 'LAB' and workspace_id = 'careli';
do $$
declare v_chave text; v_nome text;
begin
  select chave_do_grupo, nome into v_chave, v_nome from public.hercules_empreendimentos where codigo = 'LAB' and workspace_id = 'careli';
  raise notice '5. LAB renomeado: nome %, chave % -> %', v_nome, v_chave,
    case when v_nome = 'Lagoa Bonita Residencial' and v_chave = 'Lagoa Bonita' then 'OK' else 'FALHOU' end;
end $$;
rollback to savepoint antes_do_renome;

-- 6. Grupo NOVO: o primeiro filho dá a chave ao pai, com o nome que ele tem no dia.
savepoint antes_do_grupo_novo;
insert into public.hercules_empreendimentos (workspace_id, codigo, nome, cidade, uf, vendendo, ordem)
values ('careli', 'ZZP', 'ZZ Prova F4', 'Goiania', 'GO', false, 998);
insert into public.hercules_empreendimentos (workspace_id, codigo, nome, cidade, uf, vendendo, ordem, pai_id)
select 'careli', 'ZZQ', 'ZZ Prova F4 · ZZQ', 'Goiania', 'GO', false, 0, id
  from public.hercules_empreendimentos where codigo = 'ZZP' and workspace_id = 'careli';
do $$
declare v_chave text;
begin
  select chave_do_grupo into v_chave from public.hercules_empreendimentos where codigo = 'ZZP' and workspace_id = 'careli';
  raise notice '6. pai novo ganhou a chave no primeiro filho: % -> %', v_chave,
    case when v_chave = 'ZZ Prova F4' then 'OK' else 'FALHOU' end;
end $$;
rollback to savepoint antes_do_grupo_novo;

-- 7. Pai novo com o nome de um grupo que já existe: o primeiro filho é recusado com mensagem legível.
savepoint antes_do_repetido;
insert into public.hercules_empreendimentos (workspace_id, codigo, nome, cidade, uf, vendendo, ordem)
values ('careli', 'ZZR', 'lagoa bonita', 'Goiania', 'GO', false, 997);
do $$
begin
  insert into public.hercules_empreendimentos (workspace_id, codigo, nome, cidade, uf, vendendo, ordem, pai_id)
  select 'careli', 'ZZS', 'lagoa bonita · ZZS', 'Goiania', 'GO', false, 0, id
    from public.hercules_empreendimentos where codigo = 'ZZR' and workspace_id = 'careli';
  raise notice '7. primeiro filho de pai com nome repetido -> FALHOU (passou)';
exception when others then
  raise notice '7. primeiro filho de pai com nome repetido recusado -> %',
    case when sqlerrm like '[0203:chave-repetida]%' then 'OK' else 'FALHOU (' || sqlerrm || ')' end;
end $$;
rollback to savepoint antes_do_repetido;

rollback;
-- Depois do rollback: as 5 chaves seguem gravadas (são da migration), nada da prova ficou.
