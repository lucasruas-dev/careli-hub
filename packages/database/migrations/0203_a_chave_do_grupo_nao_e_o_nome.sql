-- 0203 · A CHAVE DO GRUPO NÃO É O NOME (PAN-124, fatia F4)
--
-- ⏳ ESCRITA, NÃO APLICADA. Aplicar só com OK do Lucas (skill migration-supabase). Idempotente.
-- Inclui ESCRITA em 5 linhas de hercules_empreendimentos (o preenchimento da chave dos 5 pais).
--
-- NUMERAÇÃO. O plano de 26/09/2026 chamava esta de 0194. Os números de 0193 a 0200 foram usados por
-- outras frentes, a 0201 é o retrato do vigia (F3) e a 0202 é a conferência da corretagem. Conferido
-- no diretório, em todas as branches e em list_migrations em 01/10/2026.
--
-- POR QUE ELA EXISTE. Um empreendimento com divisões (o pai e os filhos do cadastro) é identificado
-- em vários lugares pelo texto `group:<Nome>`, e o nome é o do PAI. Esse texto está GRAVADO: medido
-- em 01/10/2026, só com SELECT, nas colunas de texto de todas as tabelas apolo_, temis_, hercules_,
-- prometeu_, lsoft_, boletos_ e incorporador_, há 33 ocorrências, TODAS `group:Lagoa Bonita`:
--   • apolo_relationships.metadata 12; apolo_audit_events.metadata 6; apolo_esteira.enterprise_id 4;
--   • apolo_documents.metadata 4; apolo_source_links.source_id 4 e .metadata 2;
--   • apolo_enterprise_settings.enterprise_id 1.
-- (O plano de 26/09 contava também `group:Vale do Ouro`, em settings e no log de erros da CAD; não
-- está mais gravado em lugar nenhum.)
-- O Panteon é o dono do cadastro e o nome do pai vai ser editável na tela (F10). Renomear "Lagoa
-- Bonita" faria o código montar `group:<nome novo>`, e as 33 linhas gravadas com o nome velho
-- deixariam de casar: a CAD some do contrato, a imobiliária some da habilitação. A chave precisa ser
-- um valor CONGELADO, separado do nome.
--
-- O QUE ELA FAZ.
--   (a) coluna `chave_do_grupo` em hercules_empreendimentos;
--   (b) preenche a chave dos 5 pais que têm filhos com o NOME de hoje, que é idêntico ao
--       ENTERPRISE_GROUPS.display (lib/guardian/c2x-analytics.ts) e às strings gravadas:
--       LAB 'Lagoa Bonita', VLO 'Vale do Ouro', LOX 'Lavra do Ouro', PDX 'Portal dos Vales' e
--       RDX 'Rio de Pedras'. É um UPDATE, então passa pelo carimbo, pela guarda (a chave não é campo
--       travado) e pela trilha da 0192: 5 linhas de trilha, campo chave_do_grupo, de nulo para o nome;
--   (c) índice único por workspace, sem diferença de caixa: duas famílias com a mesma chave fariam
--       `group:<chave>` apontar para as duas;
--   (d) gatilho de guarda: preenchida, a chave não muda nem volta a nulo, salvo a saída explícita da
--       0192 (panteon.permite_correcao_assistida = 'sim', com panteon.motivo, que a guarda da 0192 já
--       exige para qualquer mudança com a saída ligada);
--   (e) gatilho do primeiro filho: quando uma linha ganha pai (INSERT com pai ou UPDATE de pai_id), o
--       pai que ainda não tem chave recebe a chave com o nome que tem NAQUELE DIA. O plano punha isto
--       dentro da função da tela (F10, que ainda não existe); como gatilho, vale também para o "Novo
--       produto" e para SQL manual.
--
-- O CÓDIGO TOLERA A COLUNA AUSENTE. Sem ela, a régua usa o nome do pai como chave, como hoje
-- (lib/hercules/regua-do-cadastro.ts). Enquanto ninguém renomear um pai, os dois são iguais.
--
-- ⚠️ ATENCAO 1: A CHAVE NÃO É O NOME, E NÃO SE MOSTRA. Tela mostra `nome` (ou o nome de mercado); a
-- chave só serve para montar e casar `group:<chave>`. Renomear o pai muda a tela e não muda a chave.
--
-- ⚠️ ATENCAO 2: O GATILHO DO PRIMEIRO FILHO ESCREVE NO PAI. É um UPDATE em outra linha, que passa pelo
-- carimbo, pela guarda e pela trilha do pai (a linha de trilha do pai segura um DELETE dele pela FK
-- restrict, o que é o certo: pai com filho não se apaga). A compensação do "Novo produto" apaga o
-- FILHO que inseriu, nunca o pai (lib/hercules/cadastrar-produto-server.ts); a chave do pai fica, e
-- não faz mal: o próximo filho a encontra pronta.
--
-- ⚠️ ATENCAO 3: NOME DE PAI REPETIDO. Se o pai que recebe o primeiro filho tiver o mesmo nome (sem
-- caixa) da chave de outra família, o índice único recusa, e com ele o INSERT ou UPDATE do filho. O
-- gatilho levanta antes uma mensagem legível. Hoje os 5 nomes são distintos.
--
-- DESFAZER (roda como postgres; a trilha das 5 linhas fica, como toda trilha):
--   drop trigger if exists hercules_empreendimentos_chave_no_primeiro_filho on public.hercules_empreendimentos;
--   drop trigger if exists hercules_empreendimentos_chave_imutavel on public.hercules_empreendimentos;
--   drop function if exists public.hercules_empreendimento_chave_no_primeiro_filho();
--   drop function if exists public.hercules_empreendimento_chave_imutavel();
--   drop index if exists public.hercules_empreendimentos_chave_do_grupo_unica;
--   alter table public.hercules_empreendimentos drop column if exists chave_do_grupo;
--   -- (o drop column é um ALTER, não um UPDATE: não passa pela trilha)

-- ── (a) A COLUNA ──────────────────────────────────────────────────────────────
alter table public.hercules_empreendimentos
  add column if not exists chave_do_grupo text;

comment on column public.hercules_empreendimentos.chave_do_grupo is
  'NÃO É O NOME. A chave congelada do grupo (pai com filhos): é ela que forma o id group:<chave> gravado em vínculos, esteira, documentos e settings. Nasce com o nome do pai no dia do primeiro filho e não muda depois, salvo correção assistida (0203). Nula em quem não é pai de grupo.';

-- ── (c) ÚNICA POR WORKSPACE, SEM CAIXA ────────────────────────────────────────
create unique index if not exists hercules_empreendimentos_chave_do_grupo_unica
  on public.hercules_empreendimentos (workspace_id, lower(chave_do_grupo))
  where chave_do_grupo is not null;

-- ── (d) A CHAVE NÃO MUDA ──────────────────────────────────────────────────────
create or replace function public.hercules_empreendimento_chave_imutavel()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.chave_do_grupo is not null
     and new.chave_do_grupo is distinct from old.chave_do_grupo
     and coalesce(current_setting('panteon.permite_correcao_assistida', true), '') <> 'sim' then
    raise exception '[0203:chave-do-grupo] A chave do grupo de % não muda (de % para %).',
      old.codigo, old.chave_do_grupo, coalesce(new.chave_do_grupo, 'nulo')
      using hint = 'A chave forma o id group:<chave> gravado em vínculos e esteira; renomear o pai é mudar o nome, não a chave. Correção assistida só com OK do Lucas (0192, ATENCAO 3).';
  end if;

  return new;
end;
$$;

comment on function public.hercules_empreendimento_chave_imutavel() is
  'BEFORE UPDATE em hercules_empreendimentos: preenchida, chave_do_grupo não muda nem volta a nulo, salvo a saída explícita da 0192 (0203).';

drop trigger if exists hercules_empreendimentos_chave_imutavel on public.hercules_empreendimentos;
create trigger hercules_empreendimentos_chave_imutavel
  before update of chave_do_grupo on public.hercules_empreendimentos
  for each row
  execute function public.hercules_empreendimento_chave_imutavel();

-- ── (e) O PRIMEIRO FILHO DÁ A CHAVE AO PAI ────────────────────────────────────
create or replace function public.hercules_empreendimento_chave_no_primeiro_filho()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pai record;
begin
  if new.pai_id is null then
    return null;
  end if;

  if tg_op = 'UPDATE' and new.pai_id is not distinct from old.pai_id then
    return null;
  end if;

  select p.id, p.workspace_id, p.codigo, p.nome, p.chave_do_grupo
    into v_pai
    from public.hercules_empreendimentos p
   where p.id = new.pai_id
   for update;

  if not found or v_pai.chave_do_grupo is not null then
    return null;
  end if;

  if exists (
    select 1 from public.hercules_empreendimentos o
     where o.workspace_id = v_pai.workspace_id
       and o.id <> v_pai.id
       and lower(o.chave_do_grupo) = lower(btrim(v_pai.nome))
  ) then
    raise exception '[0203:chave-repetida] O pai % se chama "%", que já é a chave de outro grupo.',
      v_pai.codigo, btrim(v_pai.nome)
      using hint = 'Dê ao pai um nome que não seja o de outro grupo antes de pôr o primeiro filho sob ele (0203, ATENCAO 3).';
  end if;

  update public.hercules_empreendimentos
     set chave_do_grupo = btrim(v_pai.nome)
   where id = v_pai.id;

  return null;
end;
$$;

comment on function public.hercules_empreendimento_chave_no_primeiro_filho() is
  'AFTER INSERT OR UPDATE OF pai_id em hercules_empreendimentos: o pai que ainda não tem chave_do_grupo a recebe com o nome que tem no dia do primeiro filho (0203).';

drop trigger if exists hercules_empreendimentos_chave_no_primeiro_filho on public.hercules_empreendimentos;
create trigger hercules_empreendimentos_chave_no_primeiro_filho
  after insert or update of pai_id on public.hercules_empreendimentos
  for each row
  execute function public.hercules_empreendimento_chave_no_primeiro_filho();

-- ── (b) AS CHAVES DOS 5 PAIS DE HOJE ──────────────────────────────────────────
-- Pelo id (uuid) do pai e conferindo o nome: se alguém tiver renomeado um deles antes desta migration
-- rodar, a linha não casa e fica sem chave, e a conferência pós-aplicação acusa (5 esperadas).
-- O autor e o motivo vão para a trilha da 0192.
select set_config('panteon.autor', 'migration:0203', true);
select set_config('panteon.motivo', 'PAN-124 F4: a chave do grupo nasce com o nome de hoje do pai, que é o texto gravado em group:<Nome>.', true);

update public.hercules_empreendimentos p
   set chave_do_grupo = btrim(p.nome)
 where p.workspace_id = 'careli'
   and p.pai_id is null
   and p.chave_do_grupo is null
   and p.codigo in ('LAB', 'VLO', 'LOX', 'PDX', 'RDX')
   and btrim(p.nome) in ('Lagoa Bonita', 'Vale do Ouro', 'Lavra do Ouro', 'Portal dos Vales', 'Rio de Pedras')
   and exists (select 1 from public.hercules_empreendimentos f where f.pai_id = p.id);
