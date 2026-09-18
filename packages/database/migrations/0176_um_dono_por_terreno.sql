-- 0176 — UM DONO POR TERRENO, GARANTIDO PELO BANCO.
--
-- Lucas (18/09/2026): "isso é extremamente critico no nosso negocio, eu não posso vender dois
-- lotes para pessoas diferentes, eu tomo processo por conta disso. revisa bem revisado e nunca
-- permita que isso aconteça".
--
-- O QUE JÁ EXISTE: `hercules_reservas_uma_viva_por_unidade` (0125) impede duas reservas vivas na
-- MESMA LINHA. Mas o mesmo lote tem mais de uma linha nos produtos divididos: a antiga, do pai
-- (VLO0305), e a viva da gleba (VOC0305); às vezes duas glebas (VOC1206 e VOR1206). Duas reservas
-- em linhas diferentes do mesmo chão passam pelo índice da 0125.
--
-- Hoje quem segura isso é a porta única da reserva (`lib/hercules/criar-reserva.ts`), que confere
-- o terreno ANTES e DEPOIS de gravar e desfaz a própria reserva se achar outro dono. Ela fecha
-- toda corrida em que o servidor termina o que começou. O que ela não fecha: o servidor cair entre
-- o INSERT e a segunda conferência, com a outra reserva gravada no mesmo instante. Aí ficariam dois
-- donos, e ninguém para desfazer.
--
-- ESTA MIGRATION FECHA ESSE BURACO NO BANCO. A porta única calcula o terreno (as linhas do mesmo
-- chão, pela família do pai) e grava a chave dele em `terreno_chave`: o menor id entre as linhas do
-- terreno, que é o mesmo para quem reservar por qualquer uma delas. O índice abaixo não deixa
-- existir duas reservas vivas com a mesma chave. A segunda gravação morre no próprio INSERT
-- (23505), dentro da transação do banco, sem depender de o servidor sobreviver a nada.
--
-- As reservas que já existem ficam com a chave nula (nulo não colide no índice): elas continuam
-- protegidas pelas duas conferências da porta única, que olham o terreno inteiro.
--
-- Sem backfill, sem trigger, sem mudança de comportamento para quem lê a tabela.

alter table public.hercules_reservas
  add column if not exists terreno_chave text;

comment on column public.hercules_reservas.terreno_chave is
  'O terreno desta reserva: o menor hercules_unidades.id entre as linhas do mesmo chão (pai e glebas). Gravado pela porta única (lib/hercules/criar-reserva.ts). O índice hercules_reservas_um_dono_por_terreno impede duas reservas vivas no mesmo terreno.';

create unique index if not exists hercules_reservas_um_dono_por_terreno
  on public.hercules_reservas (workspace_id, terreno_chave)
  where situacao in ('ativa', 'proposta') and terreno_chave is not null;
