-- 0195 (ensaio) · A FUNÇÃO temis_envelope_registrar_assinaturas PROVADA NO BANCO DE VERDADE.
--
-- ⏳ ESCRITO EM 28/09/2026, NÃO RODADO. Roda só com OK do Lucas: num branch do Supabase (tem custo)
-- ou em produção DEPOIS de a 0195 aplicada. Tudo dentro de BEGIN … ROLLBACK: as linhas de ensaio
-- nascem e morrem na transação, nada fica gravado. Cada bloco levanta exceção se o resultado não é
-- o esperado (a transação inteira cai, o que também é rollback).
--
-- ⚠️ POR QUE EXISTE (plano, seção 10, "Regressão I8"): a regra monotônica tem UMA cópia só, no SQL.
-- Os testes do vitest usam um dublê que só imita o lado de fora; quem prova a regra é este arquivo.
-- Sem dado pessoal: e-mails e nomes de ensaio (@ensaio.test).

begin;

do $$
declare
  v_id   uuid;
  r      record;
  v_item jsonb;
begin
  -- ── 1. `sign` seguido de `signature_started` NÃO regride (bug 8.1) ─────────────────────────
  insert into public.temis_envelopes (nome, provedor, estado, provedor_documento_id, signatarios)
  values ('ENSAIO 0195 · 1', 'clicksign', 'aguardando', 'ensaio-doc-1',
          '[{"chave":"k-a","email":"a@ensaio.test","nome":"A","ordem":1,"papel":"comprador"},
            {"chave":"k-b","email":"b@ensaio.test","nome":"B","ordem":2,"papel":"vendedora"}]')
  returning id into v_id;

  select * into r from public.temis_envelope_registrar_assinaturas(
    v_id, '[{"chave":"k-a","email":"a@ensaio.test","assinado_em":"2026-09-26T10:00:00.000-03:00"}]',
    'parcial', 'clicksign:sign');
  if r.estado_depois <> 'parcial' or r.assinaram <> 1 then
    raise exception 'ensaio 1a: esperado parcial com 1 assinatura, veio % com %', r.estado_depois, r.assinaram;
  end if;

  select * into r from public.temis_envelope_registrar_assinaturas(v_id, '[]', 'aguardando', 'clicksign:signature_started');
  if r.estado_depois <> 'parcial' or r.mudou_estado then
    raise exception 'ensaio 1b: signature_started regrediu para %', r.estado_depois;
  end if;

  -- ── 2. `add_signer` com o histórico: a marca entra mesmo sem estado proposto ───────────────
  insert into public.temis_envelopes (nome, provedor, estado, provedor_documento_id, signatarios)
  values ('ENSAIO 0195 · 2', 'clicksign', 'aguardando', 'ensaio-doc-2',
          '[{"chave":"k-a","email":"a@ensaio.test","nome":"A","ordem":1,"papel":"comprador"}]')
  returning id into v_id;
  select * into r from public.temis_envelope_registrar_assinaturas(
    v_id, '[{"chave":"k-a","assinado_em":"2026-09-26T10:00:00.000-03:00"}]', null, 'clicksign:add_signer');
  if r.estado_depois <> 'parcial' then
    raise exception 'ensaio 2: esperado parcial derivado da marca, veio %', r.estado_depois;
  end if;

  -- ── 3. A troca de signatário preserva a marca de quem continua, e a versão recusa ──────────
  insert into public.temis_envelopes (nome, provedor, estado, provedor_documento_id, signatarios)
  values ('ENSAIO 0195 · 3', 'clicksign', 'parcial', 'ensaio-doc-3',
          '[{"chave":"k-a","email":"a@ensaio.test","nome":"A","ordem":1,"papel":"comprador","assinado_em":"2026-09-26T10:00:00.000-03:00"},
            {"chave":"k-b","email":"b-errado@ensaio.test","nome":"B","ordem":1,"papel":"conjuge"}]')
  returning id into v_id;

  select * into r from public.temis_envelope_registrar_assinaturas(
    v_id, '[]', null, null,
    '[{"chave":"k-a","email":"a@ensaio.test","nome":"A","ordem":1,"papel":"comprador"},
      {"chave":"k-novo","email":"b@ensaio.test","nome":"B","ordem":1,"papel":"conjuge"}]',
    null, null, null, '2000-01-01T00:00:00Z');
  if r.recusa is distinct from 'quadro_mudou' then
    raise exception 'ensaio 3a: versão velha deveria recusar com quadro_mudou, veio %', r.recusa;
  end if;

  select * into r from public.temis_envelope_registrar_assinaturas(
    v_id, '[]', null, null,
    '[{"chave":"k-a","email":"a@ensaio.test","nome":"A","ordem":1,"papel":"comprador"},
      {"chave":"k-novo","email":"b@ensaio.test","nome":"B","ordem":1,"papel":"conjuge"}]',
    null, null, null, (select atualizado_em from public.temis_envelopes where id = v_id));
  select item into v_item from jsonb_array_elements(r.quadro) as q(item) where item ->> 'chave' = 'k-a';
  if r.recusa is not null or nullif(v_item ->> 'assinado_em', '') is null then
    raise exception 'ensaio 3b: a troca perdeu a assinatura de quem continuou (recusa %)', r.recusa;
  end if;
  if jsonb_array_length(r.quadro) <> 2 then
    raise exception 'ensaio 3c: o quadro novo deveria ter 2 pessoas';
  end if;

  -- ── 4. Item com "assinado_em": null não conta como assinado (o operador ? mentiria) ────────
  insert into public.temis_envelopes (nome, provedor, estado, provedor_documento_id, signatarios)
  values ('ENSAIO 0195 · 4', 'clicksign', 'aguardando', 'ensaio-doc-4',
          '[{"chave":"k-a","email":"a@ensaio.test","nome":"A","ordem":1,"papel":"comprador","assinado_em":null}]')
  returning id into v_id;
  select * into r from public.temis_envelope_registrar_assinaturas(v_id, '[]', null, null);
  if r.assinaram <> 0 or r.estado_depois <> 'aguardando' then
    raise exception 'ensaio 4: assinado_em nulo contou como assinado (% / %)', r.assinaram, r.estado_depois;
  end if;

  -- ── 5. Dois itens com o MESMO e-mail e uma marca sem chave do quadro: ninguém é pintado ────
  --      (o e-mail só casa quando é único); com a chave, só aquele é assinado.
  insert into public.temis_envelopes (nome, provedor, estado, provedor_documento_id, signatarios)
  values ('ENSAIO 0195 · 5', 'clicksign', 'aguardando', 'ensaio-doc-5',
          '[{"chave":"c2x:1","email":"mesmo@ensaio.test","nome":"A","ordem":1,"papel":"comprador"},
            {"chave":"c2x:2","email":"mesmo@ensaio.test","nome":"B","ordem":1,"papel":"conjuge"}]')
  returning id into v_id;
  select * into r from public.temis_envelope_registrar_assinaturas(
    v_id, '[{"email":"mesmo@ensaio.test","assinado_em":"2026-09-26T10:00:00.000-03:00"}]', null, null);
  if r.assinaram <> 0 then
    raise exception 'ensaio 5a: e-mail repetido pintou % linhas com uma marca', r.assinaram;
  end if;
  select * into r from public.temis_envelope_registrar_assinaturas(
    v_id, '[{"chave":"c2x:2","email":"mesmo@ensaio.test","assinado_em":"2026-09-26T10:00:00.000-03:00"}]', null, null);
  if r.assinaram <> 1 then
    raise exception 'ensaio 5b: a marca com chave deveria assinar 1, assinou %', r.assinaram;
  end if;

  -- ── 6. Marca de OUTRO documento: recusa, nada aplicado (bug 8.9) ───────────────────────────
  select * into r from public.temis_envelope_registrar_assinaturas(
    v_id, '[{"chave":"c2x:1","assinado_em":"2026-09-26T10:00:00.000-03:00"}]', 'parcial', null,
    null, null, null, 'ensaio-doc-OUTRO');
  if r.recusa is distinct from 'documento_diferente' then
    raise exception 'ensaio 6: documento diferente deveria recusar, veio %', r.recusa;
  end if;

  -- ── 7. Assinado sem data nenhuma: fechado_em fica NULO (nunca "agora") ─────────────────────
  insert into public.temis_envelopes (nome, provedor, estado, provedor_documento_id, signatarios)
  values ('ENSAIO 0195 · 7', 'clicksign', 'aguardando', 'ensaio-doc-7',
          '[{"chave":"k-a","email":"a@ensaio.test","nome":"A","ordem":1,"papel":"comprador"}]')
  returning id into v_id;
  select * into r from public.temis_envelope_registrar_assinaturas(v_id, '[]', 'assinado', 'clicksign:close');
  if r.estado_depois <> 'assinado' or r.fechado is not null then
    raise exception 'ensaio 7: fechado_em deveria ficar nulo, veio %', r.fechado;
  end if;
  -- E terminal não muda mais.
  select * into r from public.temis_envelope_registrar_assinaturas(v_id, '[]', 'aguardando', 'clicksign:signature_started');
  if r.estado_depois <> 'assinado' then
    raise exception 'ensaio 7b: terminal mudou para %', r.estado_depois;
  end if;

  -- ── 8. 23:30-03:00 é guardado COMO VEIO (o texto é o do chamador) ──────────────────────────
  insert into public.temis_envelopes (nome, provedor, estado, provedor_documento_id, signatarios)
  values ('ENSAIO 0195 · 8', 'clicksign', 'aguardando', 'ensaio-doc-8',
          '[{"chave":"k-a","email":"a@ensaio.test","nome":"A","ordem":1,"papel":"comprador"}]')
  returning id into v_id;
  select * into r from public.temis_envelope_registrar_assinaturas(
    v_id, '[{"chave":"k-a","assinado_em":"2026-09-11T23:30:00.000-03:00"}]', null, null);
  if (r.quadro -> 0 ->> 'assinado_em') <> '2026-09-11T23:30:00.000-03:00' then
    raise exception 'ensaio 8: o texto guardado mudou para %', r.quadro -> 0 ->> 'assinado_em';
  end if;

  raise notice 'ENSAIO 0195: os 8 casos passaram.';
end $$;

rollback;
