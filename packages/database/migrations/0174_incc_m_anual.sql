-- 0174 — O INCC-M ANUAL ENTRA NA LISTA DE ÍNDICES DE CORREÇÃO.
--
-- Pedido do Lucas (16/09/2026), olhando a aba Planos comerciais do Lagoa Bonita: *"coloca o INCC
-- anual por favor nesses indices de correções"*. A lista tinha o INCC-M e o INCC-DI só na aplicação
-- mensal; IPCA e IGP-M já existiam também na anual.
--
-- ⚠️ É O INCC-M, E NÃO A FAMÍLIA "INCC". A casa cadastra a VARIANTE (ver `INDICES` em
-- apps/hub/lib/apolo/planos-comerciais.ts): M e DI têm a mesma cesta e janelas de coleta diferentes,
-- e em agosto de 2026 deram 0,85% e 0,66%. O INCC-M é o padrão de loteamento e o que o C2X usa.
-- Mesma série do mensal (SGS 7456, variação mensal); o que muda é a APLICAÇÃO, uma vez por ano no
-- aniversário, acumulando os 12 meses, como `IGPM_ANUAL` faz com a série 189.
--
-- ⚠️ ORDEM DE DEPLOY: o CÓDIGO primeiro (a união `IndiceCorrecao` e o rótulo em `INDICES`), a
-- migration depois. Com a linha antes do código, a tela do Apolo já ofereceria a opção (ela lê esta
-- tabela) e o plano salvo com `INCC_M_ANUAL` sairia sem rótulo na proposta.
--
-- `ordem = 19` põe a anual logo antes da mensal (20), como IPCA (10/11) e IGP-M (30/31).

insert into public.temis_indices
  (codigo, sigla, nome, publicador, periodicidade, aplicacao, fonte, fonte_codigo, exige_parametro, ordem, observacao)
values
  ('INCC_M_ANUAL', 'INCC-M', 'Índice Nacional de Custo da Construção — Mercado', 'FGV/IBRE', 'mensal', 'anual', 'bcb_sgs', '7456', false, 19,
   'Mesma série do INCC-M mensal (SGS 7456), aplicada uma vez por ano no aniversário, acumulando os 12 meses.')
on conflict (workspace_id, codigo) do nothing;
