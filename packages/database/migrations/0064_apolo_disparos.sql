-- Apolo: DISPAROS de reprovação de crédito (com devolutiva de entrega).
--
-- Quando o crédito reprova, o hub avisa o COORDENADOR do empreendimento (sempre) e o CORRETOR
-- (se tiver telefone), pela Iris (WhatsApp, número 4143), com a CAD anexa. Esta tabela guarda
-- CADA envio: quem recebeu, por qual template, quando, e o STATUS DE ENTREGA que o webhook da
-- Meta devolve depois (enviado -> entregue -> lido / falhou).
--
-- Por que uma tabela própria, e não caredesk_messages: o disparo sai FORA do fluxo de tickets da
-- Iris (não há conversa aberta, é uma notificação seca ao coordenador). O webhook da Meta casa o
-- status por wa_message_id; o meta-inbound-processor passa a atualizar TAMBÉM esta tabela por
-- esse id, além das mensagens de ticket.
--
-- O histórico "humano" da ficha continua em apolo_audit_events (append-only). Esta tabela é o
-- estado MUTÁVEL da entrega, que o webhook atualiza — por isso separada da auditoria.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

create table if not exists public.apolo_disparos (
  id uuid primary key default gen_random_uuid(),
  entity_id uuid not null,
  -- 'coordenador' | 'corretor'
  tipo text not null,
  destinatario text,
  telefone text,
  template text,
  -- Origem do envio: 'automatico' (gatilho da reprovação) | 'reenvio' (botão do admin no Board).
  origem text not null default 'automatico',
  -- ID da mensagem na Meta (wamid). Chave para o webhook casar a devolutiva de entrega.
  wa_message_id text,
  -- 'enviado' | 'entregue' | 'lido' | 'falhou'
  status text not null default 'enviado',
  erro text,
  actor_user_id uuid,
  sent_at timestamptz not null default now(),
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.apolo_disparos is
  'Envios do aviso de reprovacao de credito (coordenador/corretor) com status de entrega da Meta.';

-- O webhook da Meta atualiza por wa_message_id; a tela lê os disparos por ficha.
create index if not exists apolo_disparos_wa_message_id_idx
  on public.apolo_disparos (wa_message_id);
create index if not exists apolo_disparos_entity_id_idx
  on public.apolo_disparos (entity_id, created_at desc);
