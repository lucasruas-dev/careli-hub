-- Apolo: a marca do incorporador tem DUAS versoes, nao uma.
--
-- A logo do cliente costuma ser colorida com texto escuro (a do Cecilio tem o predio azul e o
-- nome quase preto). Ela vive bem no tema claro e SOME no escuro. A versao em negativo nao e'
-- luxo: e' a diferenca entre a marca dele aparecer ou virar um borrao no dark mode.
--
-- Uma coluna a mais em vez de convencao de nome de arquivo ("mesmo caminho + sufixo") de
-- proposito: convencao de path ja' mordeu neste repo (a logo do empreendimento vive assim e nao
-- da' pra consultar, filtrar nem auditar). Nulo = so' existe a versao clara, e a tela usa ela nos
-- dois temas.
--
-- ⚠️ Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

alter table public.apolo_incorporadores
  add column if not exists logo_escura_path text;

comment on column public.apolo_incorporadores.logo_escura_path is
  'Versao em negativo (branca) da marca, para o tema escuro. Nulo = usa a clara nos dois temas.';
