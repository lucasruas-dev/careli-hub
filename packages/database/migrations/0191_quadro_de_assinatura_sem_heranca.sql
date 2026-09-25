-- 0191 · O QUADRO DE ASSINATURA PASSA A SER A ÚNICA FONTE DE QUEM ASSINA O CONTRATO
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas.
--
-- POR QUE ELA EXISTE. Até aqui o quadro (`temis_assinantes`) mostrava e mandava assinar uma linha
-- que NÃO estava nele: o representante legal da empresa vendedora (`vendedor_entity_id`) e o da
-- coordenadora de vendas (`coordenadora_entity_id`, com queda em `coordenador_entity_id`), lidos na
-- hora da ficha do Apolo (`apolo_relationships` representante_legal + `apolo_entities` + o primeiro
-- e-mail de `apolo_contacts`). A tela mostrava essa linha com cadeado, sem lixeira, e as duas pontas
-- herdavam por regras diferentes:
--   • a TELA herdava quando a LINHA 1 do papel estava vazia (`lerQuadroDeAssinatura`);
--   • o ENVIO herdava só quando NÃO HAVIA NINGUÉM no papel (`assinantesDoQuadro`).
-- No VOR (41) a Nívea gravou coordenadores nas linhas 2 e 3: a tela mostrava o FABRICIO herdado na
-- linha 1 e o contrato saía sem ele. Lucas, 25/09/2026: *"o fabricio não aparece para assinar"*.
--
-- Decisões do Lucas (25/09/2026), literais:
--   • *"todas assinaturas eu tenho que conseguir excluir e editar, esse cadeado esta errado"*;
--   • *"nao tem que ter mais sync com c2x referente a contrato"* (as fichas das pessoas nasceram da
--     sincronização do C2X; o contrato não pode depender delas);
--   • *"troca para mim o e-mail da coordenadora de vendas em vez do diretoria, contrato"* e *"No VOC
--     esta certo, no VOR esta errado"*: o Fabricio assina pela coordenadora com o e-mail da EMPRESA
--     (contrato@fgurgel.com.br), e não com o e-mail pessoal da ficha dele.
--
-- O código que acompanha esta migration (branch fix/quadro-de-assinatura-editavel) tira a herança
-- das duas pontas: o quadro passa a ser o que está GRAVADO, e toda linha se edita e se exclui. Esta
-- migration grava, como linha normal, exatamente a pessoa que HOJE a tela e o envio herdam, para
-- ninguém perder assinante na virada.
--
-- ATENCAO 1: APLICAR ANTES DO DEPLOY DO CÓDIGO. Se o código subir primeiro, os empreendimentos que
-- hoje dependem da herança (13 medidos em 25/09/2026, todos com o Fabricio como coordenador, entre
-- eles VLO, JDG, GDN, ACP e as Lagoas Bonitas) mandam contrato sem ninguém no papel coordenadora, e
-- o envio só AVISA, não trava. O contrário é seguro: com a migration aplicada e o código velho no
-- ar, a linha gravada ocupa a posição 1, a tela para de herdar (a linha 1 não está mais vazia) e o
-- envio também (o papel não está mais vazio). O e-mail já passa a ser o contrato@.
--
-- ATENCAO 2: A MESMA REGRA DO ENVIO, E NÃO A DA TELA. Grava só onde o papel está VAZIO (nenhuma
-- linha ativa naquele papel), que é quando o envio herda hoje. Onde o papel tem gente mas a linha 1
-- está livre (o VOR: Nívea 2, Huber 3, Fabricio 4, medido em 25/09/2026), só a TELA herdava, e o
-- que ela mostrava a mais era uma duplicata que o envelope nunca levou. Gravar ali poria o Fabricio
-- duas vezes no contrato. O deploy do código é o que acerta a tela do VOR.
--
-- ATENCAO 3: O FABRICIO COMO COORDENADOR ENTRA COM contrato@fgurgel.com.br. É o representante legal
-- da FABRICIO GURGEL NEGOCIOS IMOBILIARIOS LTDA (empresa 9e860967-9ac3-59d3-b9a0-a6713f0c8b53) e o
-- e-mail é o da empresa em `apolo_contacts`, o mesmo que a Nívea já digitou no VOC, no VOL e no VOR.
-- A troca vale só para o papel coordenador daquela empresa; qualquer outra pessoa herdada entra com o
-- e-mail da própria ficha, em minúsculas (como `conferirAssinante` grava).
--
-- ATENCAO 4: A VENDEDORA ENTRA PELA MESMA REGRA, E HOJE NÃO GRAVA NADA. Medido em 25/09/2026: zero
-- das 35 incorporadoras com `vendedor_entity_id` tem representante legal. A regra fica escrita
-- assim mesmo: se alguém cadastrar um representante antes da aplicação, a pessoa que o envio levaria
-- é a que fica gravada.
--
-- ATENCAO 5: `termos_vendedora` NÃO PRECISA DE BACKFILL. O termo de acordo escolhe: apontado para
-- termos → vendedora do quadro → (até hoje) representante legal herdado. O último degrau era a
-- vendedora herdada, e ela é coberta pela ATENCAO 4, porque o acordo lê a vendedora do próprio
-- quadro. Medido em 25/09/2026: o último degrau nunca disparou (zero vendedoras com representante).
--
-- ATENCAO 6: A ORDEM FICA FIXADA. As duas leituras antigas pegavam o vínculo e o e-mail com
-- `limit 1` SEM ordem; aqui a ordem é (created_at, id). Medido em 25/09/2026: nenhum caso com mais
-- de um vínculo ou mais de um e-mail, então o resultado é o mesmo que a tela mostrava. Se alguém
-- cadastrar um segundo representante antes da aplicação, vale o mais antigo.
--
-- ATENCAO 7: `entity_id` FICA NULO DE PROPÓSITO. A 0157 descreve a coluna como "a ficha do Apolo,
-- e o nome vem de lá". Preenchê-la convidaria uma sincronização com a ficha, que é exatamente o que
-- o Lucas tirou do contrato. A origem da linha fica em `origem` e em `observacao`.
--
-- ATENCAO 8: EMPREENDIMENTOS DE TESTE ENTRAM. O 9001 (ZZ TESTE) e o 38 (Villa Paris) herdam hoje e
-- por isso recebem a linha. É inofensivo e mantém o teste igual à produção.
--
-- ATENCAO 9: A AUTORIA DO EDITAR. O quadro ganha o botão de editar, e quem edita precisa ficar na
-- linha, como quem desativa já fica (`desativado_por_nome`, 0173). `atualizado_por_nome` nasce
-- aqui. Sem ela o código grava assim mesmo (`gravarComAutoria` refaz sem a coluna e loga), então a
-- ordem da ATENCAO 1 é a única que importa.
--
-- ATENCAO 10: IDEMPOTENTE. `add column if not exists`; o insert só grava onde o papel continua vazio
-- (`not exists`) e ainda se protege do índice único parcial da posição (`on conflict ... do
-- nothing`). Rodar de novo não grava nada.
--
-- Para desfazer só o backfill:
--   update public.temis_assinantes set ativo = false, desativado_por_nome = 'Zeus (desfaz 0191)'
--    where origem = 'backfill_heranca_0191' and ativo;

begin;

alter table public.temis_assinantes add column if not exists atualizado_por_nome text;

comment on column public.temis_assinantes.atualizado_por_nome is
  'Quem editou a linha por último (nome, CPF, e-mail, linha ou ordem), com a origem no nome quando foi o portal ("Nome (portal do incorporador)"). Nulo = nunca editada depois da 0191. Migration 0191.';

comment on column public.temis_assinantes.origem is
  'De onde a linha veio: nulo = digitada no quadro; "backfill_heranca_0191" = gravada pela migration 0191 a partir do representante legal que o quadro herdava da ficha até 25/09/2026. Depois disso nada é herdado: vale o que está gravado aqui.';

with empresas as (
  select s.enterprise_id, 'vendedora'::text as papel, s.vendedor_entity_id as empresa
    from public.apolo_enterprise_settings s
   where s.vendedor_entity_id is not null
  union all
  select s.enterprise_id, 'coordenador'::text as papel,
         coalesce(s.coordenadora_entity_id, s.coordenador_entity_id) as empresa
    from public.apolo_enterprise_settings s
   where coalesce(s.coordenadora_entity_id, s.coordenador_entity_id) is not null
),
herdado as (
  select e.enterprise_id,
         e.papel,
         e.empresa,
         btrim(p.display_name) as nome,
         regexp_replace(coalesce(p.document_masked, ''), '\D', '', 'g') as cpf_digitos,
         lower(btrim(mail.value)) as email_da_ficha
    from empresas e
    join lateral (
      select r.related_entity_id
        from public.apolo_relationships r
       where r.entity_id = e.empresa
         and r.relationship_type = 'representante_legal'
       order by r.created_at, r.id
       limit 1
    ) rep on rep.related_entity_id is not null
    join public.apolo_entities p on p.id = rep.related_entity_id
    left join lateral (
      select c.value
        from public.apolo_contacts c
       where c.entity_id = rep.related_entity_id
         and c.contact_type = 'email'
       order by c.created_at, c.id
       limit 1
    ) mail on true
   where coalesce(btrim(p.display_name), '') <> ''
)
insert into public.temis_assinantes (
  workspace_id, enterprise_id, papel, posicao, ordem_assinatura,
  nome, cpf, email, origem, criado_por_nome, observacao
)
select 'careli',
       h.enterprise_id,
       h.papel,
       1,
       null,
       h.nome,
       -- O formato do quadro (`formatarDocumento`): 000.000.000-00, e só com os 11 dígitos.
       case when length(h.cpf_digitos) = 11
         then regexp_replace(h.cpf_digitos, '^(\d{3})(\d{3})(\d{3})(\d{2})$', '\1.\2.\3-\4')
       end,
       -- ATENCAO 3.
       case
         when h.papel = 'coordenador'
          and h.empresa = '9e860967-9ac3-59d3-b9a0-a6713f0c8b53'::uuid
           then 'contrato@fgurgel.com.br'
         else nullif(h.email_da_ficha, '')
       end,
       'backfill_heranca_0191',
       'Zeus (backfill 0191)',
       'Era herdada do representante legal da empresa na ficha do Apolo até 25/09/2026. Desde a 0191 vale o que está gravado nesta linha: edite ou exclua pelo quadro.'
  from herdado h
 where not exists (
   select 1
     from public.temis_assinantes t
    where t.workspace_id = 'careli'
      and t.enterprise_id = h.enterprise_id
      and t.papel = h.papel
      and t.ativo
 )
on conflict (workspace_id, enterprise_id, papel, posicao) where ativo do nothing;

commit;
