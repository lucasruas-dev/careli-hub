-- DEVOLVE O NOME DA MÃE E A DATA DE NASCIMENTO que as cargas de setembro apagaram.
--
-- Autorização: Lucas, 24/09/2026, *"tem o meu ok"*, em resposta a "posso devolver as 200 mães e os
-- 218 nascimentos? Eles ainda estão guardados no registro do MOST."
--
-- ⚠️ O QUE ACONTECEU. O MOST rodou em 19/08/2026 e gravou `mae` e `nascimento` nos clientes do
-- LSoft (R$ 2,23 por CPF). As cargas de 08/09 17:48 e 16/09 21:09 fizeram upsert por código mandando
-- `mae: texto(c.MAE)` e `nascimento: data(c.NASCIMENTO)`, que o LSoft tem EM BRANCO, e trocaram o
-- valor por nulo. O dado sobreviveu inteiro no JSON `enriquecimento`, que a carga não toca. Achado da
-- revisão adversarial de 24/09/2026. A causa foi corrigida no importador (lib/lsoft/mesclar-cliente.ts:
-- LSoft em branco não apaga mais).
--
-- ⚠️ SÓ ONDE O CPF DO MOST É O CPF DO CLIENTE. A memória do projeto registra fichas que ganharam a
-- pessoa errada; aqui a conferência é explícita e custa nada. Medido antes de aplicar: 222 registros
-- com basic_data, 222 com CPF igual, zero divergindo.
--
-- ⚠️ SÓ PREENCHE O QUE ESTÁ NULO. Nada que alguém tenha escrito é sobrescrito, e rodar de novo não
-- muda nada. Para desfazer: o backup de 24/09 (`Relatórios Panteon\2026-09-24 backup lsoft\
-- lsoft_clientes.json`) tem as duas colunas como estavam, todas nulas.

begin;

with do_most as (
  select c.codigo,
         (select d->'data'->0->'basicData'
            from jsonb_array_elements(c.enriquecimento->'result'->'datasets') d
           where d->>'code' like 'basic_data%'
           limit 1) as bd,
         c.cpf
    from public.lsoft_clientes c
   where c.enriquecimento is not null
),
confere as (
  select codigo, bd
    from do_most
   where bd is not null
     and regexp_replace(coalesce(bd->>'taxIdNumber', ''), '\D', '', 'g') = regexp_replace(coalesce(cpf, ''), '\D', '', 'g')
     and regexp_replace(coalesce(cpf, ''), '\D', '', 'g') <> ''
)
update public.lsoft_clientes c
   set mae = coalesce(c.mae, nullif(trim(f.bd->>'motherName'), '')),
       nascimento = coalesce(
         c.nascimento,
         case when (f.bd->>'birthDate') ~ '^\d{4}-\d{2}-\d{2}' then left(f.bd->>'birthDate', 10)::date end
       )
  from confere f
 where f.codigo = c.codigo
   and (c.mae is null or c.nascimento is null);

commit;
