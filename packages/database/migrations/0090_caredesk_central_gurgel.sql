-- IRIS: Gurgel vira a TERCEIRA central.
--
-- Pedido do Lucas (15/08/2026): "aproveita e cria uma nova central, o telefone da gurgel, vai
-- virar uma central, Gurgel. Vai ficar Atendimento - Relacionamento - Gurgel".
--
-- A 0087 tinha posto a fila `gurgel` dentro do Relacionamento, com a justificativa de que quem
-- fala naquele número é a equipe do parceiro e não o cliente final. Continua verdade, mas a
-- operação é separada o bastante para ter subtela própria: número próprio (`whatsapp-gurgel`),
-- fila própria e time próprio, que não precisa enxergar o resto do Relacionamento.
--
-- Estado antes: fila `gurgel` = 30 tickets (4 abertos), canal `whatsapp-gurgel` = 31. O ticket
-- a mais é o AT-000039, de 29/06, fechado, que ficou na fila Atendimento; é histórico e fica
-- como está — remanejar ticket fechado só para arredondar número reescreveria o passado.
--
-- ✅ APLICADA EM PRODUCAO em 15/08/2026, com autorizacao do Lucas. As 2 travas passaram.
-- Resultado: Atendimento 9 filas / 89 abertos / 1.700 em 30d · Relacionamento 6 / 60 / 636 ·
-- Gurgel 1 / 3 / 21. A Gurgel ja tem vinculo de acesso, entao nasce visivel para o time dela
-- (nao repete o caso das 4 filas de e-mail, que sem vinculo so o admin enxerga).

-- ── 1. A FILA MUDA DE CENTRAL ────────────────────────────────────────────────
update public.caredesk_queues
   set metadata = coalesce(metadata, '{}'::jsonb)
                  || jsonb_build_object('central', 'gurgel')
 where slug = 'gurgel';

-- ── 2. O CANAL GANHA A MESMA MARCA ───────────────────────────────────────────
-- Só rótulo, para quem abrir o canal no Setup ver a que central ele pertence. Quem manda no
-- recorte da tela é a FILA (é o que `recortarDadosPorCentral` lê).
update public.caredesk_channels
   set metadata = coalesce(metadata, '{}'::jsonb)
                  || jsonb_build_object('central', 'gurgel')
 where slug = 'whatsapp-gurgel';

-- ── 3. CONFERÊNCIA ───────────────────────────────────────────────────────────
-- Duas travas. A primeira é a da 0087 (nenhuma fila órfã). A SEGUNDA é nova e cobre um buraco
-- que a 0087 deixou: ela só olhava se `central` era nula, então um valor escrito errado
-- ('gurguel', 'Gurgel') passava batido e a fila sumia de todas as subtelas, porque a tela casa
-- o valor exato. Agora a lista de centrais válidas mora aqui também.
do $$
declare
  orfas    text;
  invalida text;
begin
  select string_agg(slug, ', ') into orfas
    from public.caredesk_queues where metadata->>'central' is null;
  if orfas is not null then
    raise exception 'Filas sem central: %', orfas;
  end if;

  select string_agg(slug || ' -> ' || (metadata->>'central'), ', ') into invalida
    from public.caredesk_queues
   where metadata->>'central' not in ('atendimento', 'relacionamento', 'gurgel');
  if invalida is not null then
    raise exception 'Fila com central invalida (sumiria de todas as subtelas): %', invalida;
  end if;
end $$;
