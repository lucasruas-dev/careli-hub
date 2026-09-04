-- 0129 · O CÓDIGO DA VENDA — nasce na reserva e acompanha até o contrato
--
-- Lucas (04/09/2026): *"uma outra coisa que senti falta foi dos protocolos, eu gosto muito de
-- protocolo"* e, precisando o desenho: *"código de reserva, que vira depois código de proposta, que
-- vira depois código de contrato"*.
--
-- ⚠️ É UM NÚMERO SÓ, E ELE NÃO MUDA. `000123` na reserva é `000123` no contrato assinado seis meses
-- depois. A primeira versão trocava o prefixo por fase (RS → PR → CT) e o Lucas desfez na hora:
-- *"eu não gosto do RS, acho que tem que ser um código somente, aí ele vai existir unicamente
-- independente do estágio"*. Um código que muda de cara não é o mesmo código — e a fase quem diz é
-- a tela, que já mostra a etapa ao lado.
--
-- ⚠️ A COLUNA GUARDA O NÚMERO CRU, e a forma (`000123`) sai de `codigoDaVenda`, num lugar só, para
-- tela e mensagem não divergirem.
--
-- ⚠️ O MECANISMO É O DA IRIS (0025, `next_caredesk_ticket_protocol`): sequência + lpad 6. Quem
-- atende já lê "AT-000123" o dia inteiro; um segundo formato na mesma casa seria uma regra a mais
-- para dizer a mesma coisa.
--
-- ⚠️ SEQUÊNCIA, E NÃO `count(*) + 1`: no salão são dezenas de tablets na mesma tela, e a contagem
-- repete número em duas reservas simultâneas. `nextval` é atômico. O buraco na numeração quando uma
-- transação é desfeita é o preço, e é barato — protocolo serve para ACHAR, não para contar.

create sequence if not exists public.hercules_protocolo_seq;

comment on sequence public.hercules_protocolo_seq is
  'O numero do COD da venda: nasce na reserva e segue o mesmo na proposta, no contrato e na assinatura.';

grant usage, select on sequence public.hercules_protocolo_seq to service_role;

alter table public.hercules_reservas
  add column if not exists protocolo_numero bigint default nextval('public.hercules_protocolo_seq');

-- As que já existem ganham o seu: reserva sem número seria justamente a que alguém procuraria.
update public.hercules_reservas
   set protocolo_numero = nextval('public.hercules_protocolo_seq')
 where protocolo_numero is null;

alter table public.hercules_reservas
  alter column protocolo_numero set not null;

create unique index if not exists hercules_reservas_protocolo_uidx
  on public.hercules_reservas (protocolo_numero);

comment on column public.hercules_reservas.protocolo_numero is
  'O numero cru (123). O COD que aparece na tela sai de codigoDaVenda(numero): 000123, o MESMO em toda fase da venda.';
