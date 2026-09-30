-- 0201 · O RETRATO DO C2X QUE O PANTEON JÁ VIU (PAN-124, fatia F3: o vigia do cadastro)
--
-- ⏳ ESCRITA, NÃO APLICADA. Aplicar só com OK do Lucas (skill migration-supabase). Idempotente.
--
-- NUMERAÇÃO. O plano de 26/09/2026 (docs/apolo/pan-124-plano-do-cadastro.md) reservava 0193 a 0199
-- para o PAN-124. Esses números foram usados por outras frentes entre 28 e 30/09 (0193 é o código do
-- corretor autônomo; 0200, os pagamentos conferidos). O retrato da F3 é a 0201, conferido no
-- diretório e em list_migrations em 30/09/2026.
--
-- POR QUE ELA EXISTE. O C2X renomeia empreendimento sem avisar ninguém, e em cascata: sigla, nome e o
-- prefixo das unidades. Medido na auditoria do C2X (`audits`, auditable_type = 'Enterprise', só
-- SELECT) em 30/09/2026:
--   • o 43 foi RDV "RECANTO DO VALE" até 24/09; virou PDI "PORTAL DO IBITURUNA" (auditoria 34214),
--     PLI "PORTAL IBITURUNA" em 28/09 às 11:29 (34709) e PTI às 12:14 (34722). O Panteon ainda diz
--     PDI. O primeiro renome calou o coordenador; os dois seguintes ninguém viu;
--   • o 30 foi LAG, ADT (16/07) e ACT (21/09). O Panteon não tem cadastro dele e guarda 31 unidades
--     com o prefixo ADT; o C2X renomeou as 41 dele para ACT.
-- O vigia (lib/apolo/vigia-do-cadastro*.ts, no sweep de notificações) compara o C2X com o que o
-- Panteon JÁ VIU, e não com o cadastro: o nome de mercado do Panteon difere do C2X de propósito em
-- 18 dos 34 empreendimentos, e comparar os dois daria 18 alarmes eternos. Este retrato é esse "já viu".
--
-- O QUE CADA COLUNA GUARDA.
--   • codigo, nome, cidade, uf: o C2X como o vigia o viu na última conferência daquele id;
--   • nome_aceito: o nome do C2X que o Panteon deu por sabido. Nasce igual ao `nome` (é isso que
--     cala as 18 diferenças intencionais) e só anda quando o C2X passa a dizer o que o cadastro ou a
--     trilha já disseram (o "silêncio": a Nívea acompanhando no legado o que mudou no Panteon), ou
--     pela ação de aceitar da tela (F10). Enquanto o nome do C2X diferir dele, o id tem o motivo
--     "nome" no aviso;
--   • nomes_anteriores, siglas_anteriores: o que o C2X já chamou este id. O primeiro preenchimento
--     vem da auditoria inteira (134 linhas de Enterprise em 30/09/2026); depois, de cada troca que o
--     vigia vê. A F6 usa os nomes para manter os links antigos do painel abrindo;
--   • sigla_divergente_aceita: a decisão 1 do Lucas (26/09/2026, "o Panteon manda na sigla"). Marcada
--     pela ação "aceitar a divergência" (F11), cala o motivo "sigla". Volta a false quando a sigla do
--     C2X muda de novo: aceitar PTI não é aceitar a próxima;
--   • prefixos_divergentes: quantas unidades do Panteon daquele id não começam pela sigla esperada, na
--     última conferência;
--   • ultima_auditoria_id: a última auditoria de Enterprise do C2X que o vigia leu para este id. O
--     max() da tabela é o cursor da leitura por evento;
--   • visto_em: a última conferência deste id. O min() diz se a conferência diária já rodou hoje.
--
-- Aceita ids sem cadastro no Panteon (2, 30 e 34 hoje) e ids de teste: o retrato é do C2X inteiro.
-- Quem ignora teste é o vigia (EXCLUDED_ENTERPRISE_IDS não serve: tem o 31, que não é teste).
-- Nenhuma FK para hercules_empreendimentos: o id do C2X é a chave, e o cadastro pode nem existir.
--
-- O PRIMEIRO PREENCHIMENTO NÃO É DESTA MIGRATION. O Postgres não lê o MySQL do C2X; o vigia preenche
-- a tabela vazia na primeira rodada do sweep depois do deploy (bootstrap), lendo o C2X só com SELECT.
-- Esperado nessa rodada, medido em 30/09/2026: 37 linhas e 2 avisos:
--   • 30: sem cadastro, e 31 de 31 unidades do Panteon com ADT contra ACT no C2X (2 motivos);
--   • 43: sigla PDI no cadastro contra PTI no C2X (1 motivo). Nasceu depois do plano, que esperava
--     só o do 30.
--
-- ⚠️ O CÓDIGO TOLERA A TABELA AUSENTE: sem ela o vigia devolve zero e não faz nada. Dá para subir o
-- código antes da migration, mas o vigia só começa depois dela.
--
-- DESFAZER (roda como postgres; nada mais depende desta tabela):
--   drop table if exists public.hercules_empreendimentos_c2x_retrato;

create table if not exists public.hercules_empreendimentos_c2x_retrato (
  -- o id do C2X (`enterprises.id`), em texto como em hercules_empreendimentos.c2x_enterprise_id
  enterprise_id           text primary key,
  workspace_id            text not null default 'careli',
  codigo                  text not null,
  nome                    text not null,
  nome_aceito             text not null,
  cidade                  text,
  uf                      text,
  nomes_anteriores        text[] not null default '{}',
  siglas_anteriores       text[] not null default '{}',
  sigla_divergente_aceita boolean not null default false,
  prefixos_divergentes    integer not null default 0,
  ultima_auditoria_id     bigint,
  visto_em                timestamptz not null default now(),
  constraint hercules_empreendimentos_c2x_retrato_id_numerico
    check (enterprise_id ~ '^[0-9]{1,18}$'),
  constraint hercules_empreendimentos_c2x_retrato_prefixos
    check (prefixos_divergentes >= 0)
);

-- RLS ligada e sem policy: só o service role lê e escreve (padrão da casa desde a 0075). Sem
-- privilégio de tabela para anon e authenticated, e o do service_role por GRANT explícito, sem
-- depender do default ACL do banco (mesmo raciocínio da 0192, ATENCAO da trilha). O vigia faz
-- upsert: precisa de SELECT, INSERT e UPDATE. DELETE não: id que some do C2X fica no retrato, e é
-- assim que o vigia sabe o que ele era.
alter table public.hercules_empreendimentos_c2x_retrato enable row level security;
revoke all on table public.hercules_empreendimentos_c2x_retrato from anon, authenticated, service_role;
grant select, insert, update on table public.hercules_empreendimentos_c2x_retrato to service_role;

comment on table public.hercules_empreendimentos_c2x_retrato is
  'O C2X como o vigia do cadastro (PAN-124 F3, lib/apolo/vigia-do-cadastro-servidor.ts) o viu por último, um id por linha, com os nomes e siglas que ele já teve. O vigia compara o C2X com isto, e não com o cadastro do Panteon, cujo nome difere de propósito. Preenchido pelo próprio vigia na primeira rodada.';
comment on column public.hercules_empreendimentos_c2x_retrato.nome_aceito is
  'Nome do C2X que o Panteon deu por sabido. Nasce igual a nome; anda pelo silêncio (o C2X passou a dizer o que o cadastro ou a trilha já disseram) ou pela ação de aceitar da tela (F10). Diferente do nome do C2X = motivo "nome" no aviso.';
comment on column public.hercules_empreendimentos_c2x_retrato.sigla_divergente_aceita is
  'Decisão 1 do Lucas (26/09/2026): o Panteon manda na sigla. true = a sigla do C2X diferente da do cadastro é divergência aceita (F11) e não vira aviso. O vigia a volta para false quando a sigla do C2X muda de novo.';
comment on column public.hercules_empreendimentos_c2x_retrato.ultima_auditoria_id is
  'Última auditoria de Enterprise do C2X lida para este id. max() da tabela = cursor da leitura por evento do vigia.';
