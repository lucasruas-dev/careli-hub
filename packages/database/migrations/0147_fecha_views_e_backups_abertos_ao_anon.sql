-- 0147 — FECHA O QUE ESTAVA ABERTO NA INTERNET, SEM LOGIN NENHUM.
--
-- ⚠️ 248 CLIENTES COM CPF COMPLETO RESPONDIAM A QUEM SÓ TINHA A CHAVE PÚBLICA DO SITE.
-- Provado por HTTP em 09/09/2026, com a `sb_publishable_` que vai no bundle do navegador, sem
-- sessão, sem conta, sem confirmar e-mail:
--
--   GET /rest/v1/lsoft_carteira_por_cliente                → 200, 248 linhas
--   GET /rest/v1/lsoft_carteira_por_cliente_empreendimento → 200, 251 linhas
--   GET /rest/v1/apolo_financeiro_por_entidade             → 200, 4.761 linhas
--   GET /rest/v1/apolo_bkp_email_20260801                  → 200, 5 linhas
--   GET /rest/v1/prometeu_reset_bkp_20260801_cred          → 200, 7 linhas
--
-- A primeira linha da primeira view já veio com nome, CPF sem máscara, celular, e-mail e cidade
-- de um cliente do Garden. Das 248: 233 com CPF completo, 120 com e-mail, 62 com telefone.
--
-- ⚠️ A CAUSA É O TIPO DO OBJETO, NÃO UMA POLICY ESQUECIDA. O Supabase concede
-- `all on all tables in public` para `anon` e `authenticated` por padrão, e quem segura é a RLS.
-- VIEW NÃO TEM RLS — as três rodavam com os direitos do dono. E as cinco tabelas `_bkp_`
-- nasceram com RLS desligada. Conferido no mesmo dia: `apolo_entities` e `hub_users`, que são
-- tabelas com RLS ligada, responderam `[]` ao mesmo teste. A proteção do resto funciona; o furo
-- eram exatamente estes oito objetos, que é o inventário completo do schema (3 de 3 views,
-- 5 de 5 tabelas sem RLS).
--
-- ⚠️ E `anon` TINHA DELETE NAS CINCO TABELAS DE BACKUP. Medido: `has_table_privilege('anon',
-- ..., 'DELETE')` = true nas cinco. Não testei escrever — testar seria destruir.
--
-- NINGUÉM PERDE ACESSO: os três consumidores das views usam o client de SERVICE ROLE, que passa
-- por cima de grant e de RLS. Conferido um a um antes de escrever isto:
--   • lib/lsoft/carteira.ts:285   → `createApoloAdminClient()`
--   • lib/iris/meta-server.ts:35  → `createIrisMetaAdminClient()` (usado no phone-match)
-- As tabelas `_bkp_` não têm leitor nenhum no código: são cópias manuais de 01/08.

begin;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- AS TRÊS VIEWS
--
-- `security_invoker = true` é o conserto de raiz: a view passa a ser avaliada com os direitos de
-- QUEM CONSULTA, então ela volta a respeitar a RLS das tabelas de base em vez de contorná-la
-- pelos direitos do dono. O `revoke` logo abaixo já bastaria hoje; os dois juntos garantem que um
-- `grant` distraído no futuro não reabra o buraco inteiro de novo.
alter view public.lsoft_carteira_por_cliente set (security_invoker = true);
alter view public.lsoft_carteira_por_cliente_empreendimento set (security_invoker = true);
alter view public.apolo_financeiro_por_entidade set (security_invoker = true);

revoke all on public.lsoft_carteira_por_cliente from anon, authenticated;
revoke all on public.lsoft_carteira_por_cliente_empreendimento from anon, authenticated;
revoke all on public.apolo_financeiro_por_entidade from anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- AS CINCO TABELAS DE BACKUP
--
-- Ligar RLS SEM criar policy nenhuma é o fechamento total: sem policy, ninguém passa — e o
-- `service_role` continua entrando porque faz bypass. É de propósito que não se apaga nada aqui:
-- são backups de 01/08, e destruir dado para resolver exposição é troca ruim. Se forem lixo,
-- o DROP é outra decisão, com outro OK.
alter table public.apolo_bkp_email_20260801 enable row level security;
alter table public.prometeu_bkp_mesas_20260801 enable row level security;
alter table public.prometeu_reset_bkp_20260801_chamadas enable row level security;
alter table public.prometeu_reset_bkp_20260801_cred enable row level security;
alter table public.prometeu_reset_bkp_20260801_mesas enable row level security;

commit;

-- ─────────────────────────────────────────────────────────────────────────────────────────────
-- COMO VOLTAR, se algo quebrar:
--   alter view public.<view> set (security_invoker = false);
--   grant select on public.<view> to anon, authenticated;
--   alter table public.<tabela> disable row level security;
-- O sintoma de erro seria uma tela dizendo "não foi possível carregar" na carteira do LSoft ou
-- no card do Board da Iris. Nenhuma das duas deve acontecer: as duas leem por service role.
