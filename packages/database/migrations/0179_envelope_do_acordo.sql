-- 0179 — O ENVELOPE DO TERMO DE ACORDO: o elo que faltava entre `temis_envelopes` e o Hades.
--
-- ✅ APLICADA EM PRODUÇÃO em 20/09/2026, com OK do Lucas ("tem o meu ok"). Conferido depois: a coluna
-- existe com a FK para guardian_compromissos, e os dois índices estão valendo (o parcial por
-- compromisso e o único que impede dois envelopes vivos do mesmo acordo).
--
-- Lucas (20/09/2026): *"vamos precisar encaminhar esse acordo para assinatura, ou seja, vamos levar
-- esse documento para ser assinado na click. quem vai, o comprador, o incorporador e a nivea
-- careli"*, e *"nesse caso vamos ter que criar alguma tela ou aproveitar alguma que temos hoje para
-- monitorar essas assinaturas"*.
--
-- O caminho de assinatura inteiro (`lib/assinatura/*`, a Clicksign, o webhook) serve ao acordo sem
-- uma linha de mudança: nada lá sabe o que é uma proposta, e o webhook casa o evento por
-- `provedor_documento_id`. O que NÃO serve é a CHAVE: `temis_envelopes.proposta_id` tem FK para
-- `hercules_propostas`, e um acordo do Hades não é uma proposta — ele vive em
-- `guardian_compromissos`. Enfiar o uuid do compromisso ali seria violar a FK; deixar nulo faria o
-- envelope ficar invisível para TODAS as leituras, que filtram por `proposta_id`
-- (`diario-do-envelope-db.ts`, `envio-db.ts`, `incorporador/assinaturas.ts`).
--
-- Por isso: UMA coluna.
--
-- ATENÇÃO 1: SEM ESTA COLUNA, NÃO EXISTE GUARDA CONTRA O SEGUNDO ENVELOPE DO MESMO ACORDO, e a
-- conta da Clicksign é de PRODUÇÃO (Lucas, 08/09/2026: *"o sandbox esta com problemas, vamos de prod
-- mesmo"*): cada envelope custa e, depois de ativado, NÃO se apaga — só se cancela, e o cancelado
-- fica na lista para sempre. É por isso que o código NÃO envia enquanto a coluna não existir: ele
-- reconhece o 42703/PGRST204, recusa com a frase "a migration 0179 ainda não foi aplicada" e não
-- toca na API. Enviar sem poder registrar o elo seria criar um envelope pago, permanente e invisível
-- para o Panteon — exatamente o que a ATENÇÃO 1 da 0149 existe para evitar.
--
-- ATENÇÃO 2: NÃO HÁ COLUNA `tipo`, E A AUSÊNCIA É DELIBERADA. `compromisso_id is not null` já
-- responde "este envelope é de um termo de acordo?" sem uma segunda fonte de verdade que pudesse
-- discordar dela. Uma coluna `tipo` com default `'contrato'` só passaria a valer a pena se aparecer
-- um terceiro documento assinável que também nasça sem proposta — e aí ela nasce com a medida certa,
-- em vez de com um palpite de hoje.
--
-- ATENÇÃO 3: `on delete set null`, COMO OS OUTROS TRÊS ELOS DA TABELA. Se o compromisso for apagado,
-- o envelope NÃO pode ir junto: ele existe na Clicksign, pago, com gente tendo assinado do outro
-- lado. A linha órfã é o registro de que aquilo aconteceu — apagá-la seria perder a única prova que
-- temos deste lado.
--
-- ATENÇÃO 4: RLS JÁ ESTÁ LIGADA em `temis_envelopes` (0149), com ZERO policies: quem escreve e lê é
-- o service role, pelas rotas do hub. Coluna nova não muda isso, e o `enable row level security`
-- abaixo é idempotente — está aqui para quem ler esta migration sozinha não precisar abrir a 0149
-- para saber que a tabela é fechada.
--
-- Só acrescenta coluna e índices: sem backfill, sem mudança para quem já lê a tabela.

begin;

alter table public.temis_envelopes
  add column if not exists compromisso_id uuid
    references public.guardian_compromissos (id) on delete set null;

-- ⚠️ PARCIAL, e por dois motivos. O nulo é o estado NORMAL (todo envelope de contrato tem
-- `compromisso_id` nulo, e eram 100% deles até hoje), então indexar os nulos seria indexar a tabela
-- inteira por nada. E `criado_em desc` está no índice porque TODA leitura do acordo pede o envelope
-- MAIS RECENTE dele: um acordo pode ter mais de um ao longo da vida (um recusado e um reenviado), e
-- o diário do envelope velho contaria uma história que já não vale.
create index if not exists temis_envelopes_compromisso_idx
  on public.temis_envelopes (compromisso_id, criado_em desc)
  where compromisso_id is not null;

-- ATENÇÃO 5: O ÍNDICE ÚNICO É A ÚNICA TRAVA QUE VALE ENTRE DUAS FUNÇÕES QUE NUNCA SE FALAM.
--
-- A guarda contra o segundo envelope do mesmo acordo é, no código, um `select` seguido de um
-- `insert` (`lib/hades/acordo/envio-db.ts`), e entre os dois cabe um envio inteiro: a montagem do
-- PDF abre o C2X, e a rota reserva 120s. Duas abas, dois operadores, o F5 no meio ou um retry da
-- Vercel depois do timeout passam os DOIS pela guarda e criam DOIS envelopes. Cada um custa e, depois
-- de ativado, não se apaga. O botão da tela se desabilita, mas isso protege uma aba, não a conta.
--
-- ⚠️ SÓ OS ESTADOS QUE SEGURAM ENTRAM, e a lista é a mesma régua de `envelopeQueSegura`: `cancelado`,
-- `expirado` e `recusado` LIBERAM o reenvio, e um índice que os incluísse travaria para sempre o
-- reenvio legítimo de um acordo cujo envelope foi cancelado. Os cinco de baixo são o complemento
-- exato daqueles três em `EstadoDaAssinatura`.
--
-- ⚠️ E ELE É O MOMENTO MAIS BARATO DE NASCER: medido em 20/09/2026, `temis_envelopes` tem ZERO
-- linhas em produção e nenhuma delas tem `compromisso_id` (a coluna nasce nesta migration). Não há o
-- que conciliar antes de criar a unicidade.
create unique index if not exists temis_envelopes_um_envio_vivo_por_acordo_idx
  on public.temis_envelopes (compromisso_id)
  where compromisso_id is not null
    and estado in ('rascunho', 'aguardando', 'parcial', 'assinado', 'desconhecido');

comment on column public.temis_envelopes.compromisso_id is
  'O acordo do Hades (guardian_compromissos) deste envelope. Nulo = envelope de CONTRATO, que se liga pela proposta_id.';

alter table public.temis_envelopes enable row level security;

commit;
