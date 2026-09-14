-- A MARCACAO DO ESPELHO VIRA FUNCAO, para a carga reaplicar sozinha.
--
-- A migration 0161 marcou as 710 linhas de uma vez. Esta funcao e a MESMA regra, chamavel: a carga
-- do C2X (scripts/hercules/carregar-unidades-do-c2x.mjs) a chama no fim, porque e ela quem cria a
-- duplicidade -- le enterprise_unities sem nocao de que pai e filho descrevem o mesmo terreno.
--
-- ATENCAO 1: IDEMPOTENTE. So escreve onde a marca esta ausente ou diferente (`is distinct from`),
-- entao rodar dez vezes tem o mesmo efeito de rodar uma. E devolve QUANTAS mudou, para quem chamou
-- poder dizer o numero em vez de "ok".
--
-- ATENCAO 2: O DESEMPATE E O NAO-BLOQUEADO, e ele existe porque ja errou. Quatro terrenos do Vale
-- do Ouro sao reivindicados por DOIS filhos: a linha do VOC ficou `bloqueada` quando o lote passou
-- para a carteira de extras (VOR), que e quem vende. Sem ordenar, o join escolhia por acaso -- e
-- escolheu a linha BLOQUEADA em 3 dos 4 casos, o que faria o espelho anunciar bloqueado um lote
-- vendido.
--
-- ATENCAO 3: SO PAI -> FILHO, NUNCA O CONTRARIO. A clausula `where p.enterprise_id in ('31','35')`
-- e o que impede a cadeia: a linha viva nunca recebe marca, entao `espelho_de` sempre aponta para
-- uma linha que responde por si. Um salto basta, e `lib/hercules/unidade-viva.ts` conta com isso.
--
-- ATENCAO 4: A LISTA DE PAIS E FILHOS ESTA AQUI, LITERAL, e isso e divida conhecida. O certo e ela
-- vir de `hercules_empreendimentos.pai_id` -- que ja guarda esse parentesco. Nao troquei junto
-- porque a coluna `enterprise_id` de `hercules_unidades` e o id do C2X (texto) e o pai_id e uuid, e
-- costurar os dois no meio desta entrega e mudanca de outro tamanho. Ver
-- docs/architecture/fronteira-dos-modulos.md: o parentesco e cadastro, e cadastro e do Apolo.
--
-- Autorizacao do Lucas, 14/09/2026: "tem o meu ok".

create or replace function public.marcar_espelhos_de_unidade()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  mudou integer;
begin
  with escolha as (
    select p.id as pai_id, f.id as filho_id,
           row_number() over (
             partition by p.id
             order by (f.situacao = 'bloqueada')::int, f.atualizado_em desc
           ) as posto
      from public.hercules_unidades p
      join public.hercules_unidades f
        on trim(f.quadra) = trim(p.quadra)
       and trim(f.lote) = trim(p.lote)
       and ((p.enterprise_id = '31' and f.enterprise_id in ('27','32','33'))
         or (p.enterprise_id = '35' and f.enterprise_id in ('36','37','41')))
     where p.enterprise_id in ('31','35')
  ), aplicado as (
    update public.hercules_unidades u
       set espelho_de = escolha.filho_id, atualizado_em = now()
      from escolha
     where u.id = escolha.pai_id
       and escolha.posto = 1
       and u.espelho_de is distinct from escolha.filho_id
    returning 1
  )
  select count(*) into mudou from aplicado;

  return mudou;
end;
$$;

comment on function public.marcar_espelhos_de_unidade() is
  'Reaplica a marca espelho_de nas linhas do empreendimento PAI que tem gemeo numa gleba filha. Idempotente; devolve quantas linhas mudou. Chamada pela carga do C2X. Ver ATENCAO da migration 0162.';

-- ⚠️ SO O SERVICE ROLE. A funcao e `security definer` e reescreve 710 linhas de cadastro: deixar
-- `anon` ou `authenticated` chamarem daria a qualquer visitante do espelho publico um botao para
-- remarcar unidade. A carga roda com a chave de servico.
revoke execute on function public.marcar_espelhos_de_unidade() from public;
revoke execute on function public.marcar_espelhos_de_unidade() from anon;
revoke execute on function public.marcar_espelhos_de_unidade() from authenticated;
