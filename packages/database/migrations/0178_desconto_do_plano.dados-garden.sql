-- 0178 · DADOS · O DESCONTO DOS PLANOS DO GARDEN
--
-- ✅ APLICADO EM PRODUÇÃO em 18/09/2026, com OK do Lucas ("tem o meu ok"), logo depois da 0178 e
-- antes do código da v1.351.0 (o código antigo não lê a coluna, e a observação só aparece na aba
-- de edição de planos do Apolo). Conferido: NORMAL 0, INVESTIDOR PARCELADO 8, INVESTIDOR 12.
--
-- Os planos do Garden (enterprise_id 39) foram gravados em 17/09/2026 com "os mesmos planos do
-- mapa do Garden no portal da MMendes", e o desconto ficou só no texto da observação. Aqui ele vira
-- número, como no mapa da MMendes (`masterplans-internos/garden.html`, `PLANOS`):
--
--   NORMAL                desconto 0%   (fica o default 0 da 0178, nada a fazer)
--   INVESTIDOR PARCELADO  desconto 8%
--   INVESTIDOR            desconto 12%
--
-- Os ids foram lidos por SELECT em produção em 18/09/2026:
--   c25514fe-6d18-47c0-8521-aac7681d4f3c · INVESTIDOR PARCELADO · 84x · entrada 8%
--   c3a15c48-4fb0-40b5-bee3-e3d51c913ce3 · INVESTIDOR           · 36x · entrada 40%
--   2250f8d9-76a7-4859-ac14-c38f84cfd4cb · NORMAL               · 60x · entrada 10% (não muda)
--
-- ATENCAO 1: POR ID, E CONFERINDO NOME E EMPREENDIMENTO NO MESMO WHERE. Se alguém tiver renomeado
-- ou movido o plano entre a leitura e a aplicação, o UPDATE não acha a linha e devolve 0 — melhor
-- do que dar 12% de desconto a um plano que não é o Investidor do Garden.
--
-- ATENCAO 2: A OBSERVAÇÃO É ATUALIZADA JUNTO. Ela diz "aplicar no campo de desconto do simulador",
-- que deixa de ser verdade quando o desconto vira coluna: o simulador aplica sozinho, e a frase
-- antiga mandaria o corretor aplicar de novo (desconto em cima de desconto).
--
-- Conferência depois de aplicar (deve devolver 3 linhas: 0, 8 e 12):
--   select nome, parcelas, desconto_percentual from public.temis_planos
--   where workspace_id = 'careli' and enterprise_id = '39' order by ordem;

begin;

update public.temis_planos
   set desconto_percentual = 8,
       observacao = 'Desconto de 8% sobre o valor de tabela (coluna desconto_percentual, aplicado pelo simulador ao escolher o plano). Mesmos planos do mapa do Garden no portal da MMendes (Lucas, 17/09/2026 e 18/09/2026).',
       atualizado_em = now()
 where id = 'c25514fe-6d18-47c0-8521-aac7681d4f3c'
   and workspace_id = 'careli'
   and enterprise_id = '39'
   and nome = 'INVESTIDOR PARCELADO';

update public.temis_planos
   set desconto_percentual = 12,
       observacao = 'Desconto de 12% sobre o valor de tabela (coluna desconto_percentual, aplicado pelo simulador ao escolher o plano). Sem juros, só IPCA anual. Mesmos planos do mapa do Garden no portal da MMendes (Lucas, 17/09/2026 e 18/09/2026).',
       atualizado_em = now()
 where id = 'c3a15c48-4fb0-40b5-bee3-e3d51c913ce3'
   and workspace_id = 'careli'
   and enterprise_id = '39'
   and nome = 'INVESTIDOR';

commit;
