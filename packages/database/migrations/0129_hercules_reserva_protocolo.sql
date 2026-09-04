-- 0129 · O PROTOCOLO DA VENDA — nasce na reserva e acompanha até o contrato
--
-- Lucas (04/09/2026): *"uma outra coisa que senti falta foi dos protocolos, eu gosto muito de
-- protocolo"* e, precisando o desenho: *"código de reserva, que vira depois código de proposta, que
-- vira depois código de contrato"*.
--
-- ⚠️ É UM NÚMERO SÓ, E O PREFIXO É QUE MUDA. RS-000123 vira PR-000123 e depois CT-000123: a mesma
-- venda, o mesmo número, do primeiro telefonema até a assinatura. Três protocolos independentes
-- fariam o corretor ter três números para a mesma negociação — e, na hora de procurar, ninguém
-- lembraria qual deles anotou.
--
-- ⚠️ POR ISSO A COLUNA GUARDA O NÚMERO, e não o texto. Gravar "RS-000123" obrigaria a reescrever a
-- linha a cada etapa (e a errar quando alguém voltasse atrás); com o número, o prefixo é derivado
-- de onde a venda ESTÁ, na hora de mostrar — uma verdade só, em `protocoloDaVenda`.
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
  'O numero do protocolo da venda: nasce na reserva (RS-), segue na proposta (PR-) e no contrato (CT-).';

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
  'O numero cru (123). O texto que aparece na tela sai de protocoloDaVenda(numero, etapa): RS-000123 na reserva, PR-000123 na proposta, CT-000123 do contrato em diante.';
