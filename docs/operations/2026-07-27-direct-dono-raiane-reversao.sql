-- REVERSAO do backfill de 27/07/2026: Direct com dono padrao (Raiane Oliveira).
--
-- Contexto: a fila Direct (relacionamento-direct) recebeu 106 tickets desde que nasceu e os
-- 106 ficaram sem dono. Em 27/07 a fila passou a nascer com responsavel e os 23 abertos na
-- data foram atribuidos de uma vez. Este arquivo existe para desfazer exatamente aqueles 23,
-- sem tocar em nenhum ticket que tenha sido atribuido depois por gente.
--
-- Rodar SO' se o Lucas pedir para voltar atras. Nao roda sozinho, nao esta' em cron.

-- 1) Solta os 23 tickets que o backfill pegou (a lista e' fechada, capturada antes do UPDATE).
update caredesk_tickets
   set assigned_to_user_id = null,
       updated_at = now()
 where id in (
   'ca8faac7-12fb-443b-8a5a-efe07564492b','9cf4e850-1bd4-4421-9521-7543a15b6133',
   '3de122dd-c285-460e-9d34-1f76d0d870d8','4b5703bd-c858-4cc5-b603-36ea49aee516',
   'f006fd9b-cc41-4b3a-af89-cb09dc110621','772ced3b-d9c7-438b-af63-fa0932b1bc95',
   'f5b04dea-9590-4e6b-93b6-77ff2759660e','a9480215-fab1-4450-a5ed-596bbff68e7c',
   '2eebadb0-a622-46f7-9a3b-29a14f7b6cb5','a79449dc-5d95-4c4f-8907-18702361d7c2',
   '49bafab3-1a9e-4126-8dd6-1abd07b599d2','b3e73069-3248-41b3-be6b-4d7c09db7ae4',
   '15764426-216b-4161-8243-f040d9db6f64','92e64433-8074-45f4-a613-0827db8b9f06',
   'b1038755-9eb4-42a4-9510-b900b09cff73','dbc562bc-b395-4d26-b160-b28cf0bc160c',
   'cb5d2c9c-3fcf-49c7-a75f-9451f8f8b385','742e753f-45cf-4047-862b-3a55b37d572b',
   'b7be9af6-f128-4dd6-81d7-392d4dbf3aaa','41ec4088-e209-4525-a54c-ce9a6ba94931',
   'ee671164-665a-4d40-840f-17b3011fc595','0ef470c7-e85d-4fc7-91ad-00eabfac866c',
   '1ec2b7fe-50d3-4142-94f0-1487a772e9e1'
 )
   -- Trava: se alguem transferiu o ticket pra si depois do backfill, esse trabalho fica de pe.
   and assigned_to_user_id = 'd69188cb-934e-4f32-8c7e-33e70eb31d48';

-- 2) Desliga a regra para os PROXIMOS (opcional — o item 1 so' desfaz o passado).
--    Sem a chave no metadata, o ticket Direct volta a nascer orfao, como era antes.
-- update caredesk_queues
--    set metadata = metadata - 'defaultAssigneeUserId'
--  where slug = 'relacionamento-direct';
