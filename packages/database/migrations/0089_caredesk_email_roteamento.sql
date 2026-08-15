-- IRIS: conserta o roteamento de e-mail que a 0088 deixou INERTE.
--
-- ⚠️ O QUE EU ERREI NA 0088: preenchi `config.ingestMailbox` com o endereço de cada caixa,
-- achando que era o campo de roteamento. Não é.
--
--   `external_account_id`  = o ENDEREÇO que o canal representa. É POR ELE que o roteador
--                            casa o destinatário do e-mail (`gmail-inbound.ts:203`,
--                            `.in("external_account_id", recipients)`).
--   `config.ingestMailbox` = a CAIXA GMAIL de onde a gente lê (sempre caca@, a única com
--                            OAuth). Só serve de desempate entre "canal de grupo" e
--                            "caixa robô" (`gmail-inbound.ts:218`).
--
-- Com `external_account_id` NULO nos 7 canais novos, nenhum deles bate com destinatário
-- nenhum: todo e-mail continua caindo no canal antigo, na fila Atendimento. Os canais
-- existem, aparecem no Setup, e não recebem nada. Medido: 7 canais com 0 tickets.
--
-- ⏳ É o mesmo padrão de [[reference_regra_nova_nao_alcanca_o_passado]] ao contrário: a
-- regra nova não alcançou nem o presente, porque foi escrita no campo errado.
--
-- ✅ APLICADA EM PRODUCAO em 15/08/2026, com autorizacao do Lucas. As 3 travas passaram.
-- Conferido simulando o `findEmailChannel` contra os 9 cenarios de destinatario: cobranca@,
-- financeiro@, juridico@ e antecipacao@ vao para a Central de Atendimento (com a CACA
-- ligada); contato@, rh@ e compras@ vao para a de Relacionamento; e-mail so para caca@ e
-- e-mail de caixa NAO mapeada (testado com ouvidoria@) caem em 'E-mail (outros)', que e a
-- rede de seguranca. Corte de go-live: epoch 1786808146 (15/08/2026).

-- ── 1. CADA CANAL PASSA A RESPONDER PELO SEU ENDEREÇO ────────────────────────
--
-- ⚠️ `ingestSinceEpoch` = AGORA, e isto NÃO é detalhe. Sem esse corte o canal não filtra por
-- data nenhuma (`gmail-inbound.ts:151` só filtra quando o campo existe). Como esses 7
-- endereços hoje caem em `skipped` por não bater com canal nenhum, ligá-los sem corte faria
-- TODO e-mail não lido desde 13/07/2026 (o corte do canal antigo, ~1 mês) virar ticket de
-- uma vez só, em cima de filas que ainda nem têm gente vinculada. O corte é o mesmo padrão
-- que o canal antigo já usa: cada canal vale do seu go-live pra frente.
update public.caredesk_channels ch
   set external_account_id = v.caixa,
       -- A caixa de LEITURA é a caca@ em todos: é a conta que tem o OAuth e recebe cópia
       -- de todos os grupos de e-mail. Era isto que o campo sempre quis dizer.
       config = coalesce(ch.config, '{}'::jsonb)
                || jsonb_build_object('ingestMailbox', 'caca@careli.adm.br',
                                      'representa', v.caixa,
                                      'ingestSinceEpoch',
                                      floor(extract(epoch from now()))::bigint)
  from (values
    ('email-contato-caixa', 'contato@careli.adm.br'),
    ('email-rh',            'rh@careli.adm.br'),
    ('email-compras',       'compras@careli.adm.br'),
    ('email-cobranca',      'cobranca@careli.adm.br'),
    ('email-financeiro',    'financeiro@careli.adm.br'),
    ('email-juridico',      'juridico@careli.adm.br'),
    ('email-antecipacao',   'antecipacao@careli.adm.br')
  ) as v(slug, caixa)
 where ch.slug = v.slug;

-- ── 2. A CAIXA ROBÔ VOLTA A SER A CAIXA ROBÔ ─────────────────────────────────
-- `email-contato` está com external_account_id = contato@ desde antes: ele ERA o canal do
-- contato@. Agora que existe um canal dedicado ao contato@, este passa a representar a
-- própria caca@ e vira o que a 0088 já dizia que ele era: rede de segurança.
--
-- Isso também acerta o desempate do `gmail-inbound.ts:218`: com external = ingest = caca@,
-- ele deixa de ser tratado como "canal de grupo" e cede a prioridade ao canal da caixa
-- que o cliente realmente escreveu.
update public.caredesk_channels
   set external_account_id = 'caca@careli.adm.br'
 where slug = 'email-contato';

-- ── 3. CONFERÊNCIA ───────────────────────────────────────────────────────────
-- Duas travas: nenhum canal de e-mail pode ficar sem endereço (voltaria a ser inerte), e
-- dois canais não podem responder pelo mesmo endereço (o roteador pegaria um ao acaso).
do $$
declare
  sem_endereco text;
  duplicados   text;
  sem_corte    text;
begin
  select string_agg(slug, ', ') into sem_endereco
    from public.caredesk_channels
   where kind = 'email' and status = 'active' and external_account_id is null;

  if sem_endereco is not null then
    raise exception 'Canal de e-mail sem external_account_id (nunca receberia e-mail): %',
      sem_endereco;
  end if;

  -- Canal ativo sem corte ingere e-mail antigo em massa. Vale para qualquer canal futuro.
  select string_agg(slug, ', ') into sem_corte
    from public.caredesk_channels
   where kind = 'email' and status = 'active'
     and (config->>'ingestSinceEpoch') is null;

  if sem_corte is not null then
    raise exception 'Canal de e-mail sem ingestSinceEpoch (ingeriria a caixa inteira): %',
      sem_corte;
  end if;

  select string_agg(endereco, ', ') into duplicados
    from (
      select lower(trim(external_account_id)) as endereco
        from public.caredesk_channels
       where kind = 'email' and status = 'active'
       group by 1
      having count(*) > 1
    ) d;

  if duplicados is not null then
    raise exception 'Dois canais de e-mail respondem pelo mesmo endereco: %', duplicados;
  end if;
end $$;
