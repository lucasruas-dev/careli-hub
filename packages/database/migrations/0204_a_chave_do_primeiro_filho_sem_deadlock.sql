-- 0204 · A CHAVE DO PRIMEIRO FILHO SEM DEADLOCK (PAN-124, pendência da F4)
--
-- ⏳ ESCRITA, NÃO APLICADA. Aplicar só com OK do Lucas (skill migration-supabase). Idempotente. Não
-- escreve em linha nenhuma: troca uma função e um gatilho.
--
-- O DEFEITO DA 0203 (apontado pela sessão Publicação ao publicar a 1.403.0, 01/10/2026, e conferido
-- em pg_trigger e pg_get_functiondef no mesmo dia). Num INSERT de filho (ou UPDATE de pai_id):
--   1. BEFORE: hercules_empreendimentos_pai_raiz (0123, refeita na 0192) lê o pai FOR SHARE;
--   2. AFTER: hercules_empreendimentos_chave_no_primeiro_filho (0203) lia o pai FOR UPDATE, SEMPRE,
--      antes de olhar se ele já tinha chave.
-- Duas transações cadastrando filhos do MESMO pai ao mesmo tempo seguram as duas o FOR SHARE do passo
-- 1, e cada uma espera a outra soltá-lo para subir ao FOR UPDATE do passo 2: deadlock, e o Postgres
-- aborta uma delas. Valia para qualquer pai, inclusive os 5 grupos que já têm chave.
--
-- A CORREÇÃO.
--   • O gatilho vira BEFORE e roda ANTES do pai_raiz (o Postgres dispara os gatilhos do mesmo momento
--     em ordem alfabética: "chave_no_primeiro_filho" < "guarda" < "pai_raiz");
--   • lê a chave do pai SEM trava. Pai que já tem chave (o caso de quase todo cadastro): sai na hora,
--     sem travar nada além do que o pai_raiz já trava;
--   • pai sem chave: o UPDATE `where chave_do_grupo is null` é a PRIMEIRA trava da transação no pai.
--     A segunda transação, que ainda não segura nada nele, só espera a primeira terminar; quando
--     acorda, o Postgres reconfere o `where`, a chave já existe, e o UPDATE não mexe em nada. Sem
--     ciclo de espera, sem deadlock;
--   • se o INSERT ou o UPDATE do filho for recusado depois (pai que não é raiz, guarda da 0192, FK), a
--     instrução inteira é desfeita, e a chave do pai junto.
-- O resto é o mesmo da 0203: a chave nasce com o nome do pai no dia, nome igual à chave de outro
-- grupo é recusado com [0203:chave-repetida] (o "Novo produto" traduz desde a mesma entrega), e a
-- linha que é pai de si mesma fica para a guarda da 0192 recusar.
--
-- DESFAZER (volta ao gatilho da 0203, com o deadlock):
--   rode de novo a seção (e) de 0203_a_chave_do_grupo_nao_e_o_nome.sql.

create or replace function public.hercules_empreendimento_chave_no_primeiro_filho()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pai record;
begin
  if new.pai_id is null or new.pai_id = new.id then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.pai_id is not distinct from old.pai_id then
    return new;
  end if;

  -- SEM TRAVA: só para decidir se há o que fazer.
  select p.id, p.workspace_id, p.codigo, p.nome, p.chave_do_grupo
    into v_pai
    from public.hercules_empreendimentos p
   where p.id = new.pai_id;

  if not found or v_pai.chave_do_grupo is not null then
    return new;
  end if;

  if exists (
    select 1 from public.hercules_empreendimentos o
     where o.workspace_id = v_pai.workspace_id
       and o.id <> v_pai.id
       and lower(o.chave_do_grupo) = lower(btrim(v_pai.nome))
  ) then
    raise exception '[0203:chave-repetida] O pai % se chama "%", que já é a chave de outro grupo.',
      v_pai.codigo, btrim(v_pai.nome)
      using hint = 'Dê ao pai um nome que não seja o de outro grupo antes de pôr o primeiro filho sob ele (0203, ATENCAO 3).';
  end if;

  -- A primeira trava no pai. Quem chegar junto espera aqui e, ao acordar, não acha mais chave nula.
  update public.hercules_empreendimentos
     set chave_do_grupo = btrim(nome)
   where id = v_pai.id
     and chave_do_grupo is null;

  return new;
end;
$$;

comment on function public.hercules_empreendimento_chave_no_primeiro_filho() is
  'BEFORE INSERT OR UPDATE OF pai_id em hercules_empreendimentos, antes do pai_raiz: o pai que ainda não tem chave_do_grupo a recebe com o nome que tem no dia do primeiro filho. Lê sem trava e só trava o pai para gravar a chave, como primeira trava da transação (0203, refeita na 0204 contra o deadlock).';

drop trigger if exists hercules_empreendimentos_chave_no_primeiro_filho on public.hercules_empreendimentos;
create trigger hercules_empreendimentos_chave_no_primeiro_filho
  before insert or update of pai_id on public.hercules_empreendimentos
  for each row
  execute function public.hercules_empreendimento_chave_no_primeiro_filho();
