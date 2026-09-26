-- 0192 · O CADASTRO DO EMPREENDIMENTO GANHA TRILHA, E O BANCO RECUSA O QUE QUEBRA DADO SEM ERRO
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas. O roteiro (conferência antes, aplicação,
-- conferência por objeto, prova viva desfeita e conferência depois) está em
-- apps/hub/scratchpad/pan124-0192-prova-viva.sql, fora do git.
--
-- POR QUE ELA EXISTE. O PAN-124 faz do Panteon o dono do cadastro de empreendimentos
-- (`hercules_empreendimentos`): nome de mercado, sigla, cidade, UF, pai e filho. Antes de existir a
-- tela de editar (F10), o banco precisa de duas coisas que hoje não tem.
--
--   • MEMÓRIA. Uma troca de nome ou de sigla não deixa rastro. Medido em 26/09/2026
--     (pg_stat_statements desde 12/05/2026, pg_stat_user_tables desde 07/05/2026): dois escritores
--     já passaram pelo caminho de UPDATE desta tabela.
--       - um SQL manual, como `postgres`, 1 linha: o acerto do 43 (RDV para PDI) de 24/09/2026,
--         feito com OK do Lucas e registrado no changelog;
--       - o semeador de antes da 0c330778 (25/09/2026), pelo service_role: 37 chamadas de UPSERT
--         (`insert ... on conflict (workspace_id, codigo) do update set ...`), que vira UPDATE
--         quando a sigla já existe.
--     n_tup_upd = 2: um é o SQL manual; o outro não tem dono medido (o candidato é um upsert do
--     semeador que caiu no conflito). Neste branch nenhum fluxo do app faz UPDATE aqui: o "Novo
--     produto" só faz INSERT e desfaz com DELETE (lib/hercules/cadastrar-produto-server.ts:538-566),
--     o semeador só faz INSERT desde a 0c330778, e nenhuma função do banco escreve nesta tabela.
--     Sem trilha, o próximo renome leva junto o nome antigo, e é dele que o link do espelho e o do
--     painel do coordenador precisam para continuar abrindo (F10).
--   • TRAVA. Nada disto dá erro hoje; dá dado errado, calado:
--       - trocar a sigla de um empreendimento com unidades: as de antes ficam com um prefixo e as
--         novas com outro (o caso do 30: LAG, ADT, ACT, com 31 unidades ADT no Panteon);
--       - pôr sob outro pai quem já tem filhos: o terceiro nível que a 0123 proíbe, mas que ela só
--         confere do lado do NOVO pai;
--       - dar o PRIMEIRO filho a um produto com movimento: o catálogo muda de forma, e o JDG 40,
--         com 250 unidades, ganharia uma entrada de grupo;
--       - trocar o `c2x_enterprise_id`, a chave que unidades, propostas, esteira e escopo usam, ou
--         o `workspace_id`, que tira o empreendimento de todas as telas;
--       - gravar sigla fora do formato que o "Novo produto" já exige (produto-novo.ts:102).
--
-- Decisões do Lucas, 26/09/2026, respondendo às três perguntas do plano
-- (docs/apolo/pan-124-plano-do-cadastro.md, "Decisões do Lucas"):
--   1. SIGLA: O PANTEON MANDA. Ela se edita na tela, com a trava de movimento (0 unidades e 0 vendas
--      nos DOIS lados). Por isso a trava daqui é SÓ por movimento, e não "a sigla tem de ser a do
--      C2X". Esta migration cuida do lado Panteon; o lado C2X é conferido pelo app no salvar (F10);
--   2. o ACT (30) entra como FILHO da ACP (42), que tem 120 unidades: primeiro filho de pai com
--      movimento, portanto correção assistida pelo Zeus, com OK (ATENCAO 3);
--   3. loteamento novo nasce no Panteon e é LIGADO ao C2X depois (F12, `hercules_ligar_ao_c2x`): a
--      única troca de `c2x_enterprise_id` prevista, e ela passa pela saída explícita (ATENCAO 3).
-- As regras que ele já tinha escrito, citadas no plano: *"quando o legado e o Panteon discordam,
-- vale o Panteon"* (24/09/2026) e *"tudo tem que ser alimentado pelo Panteon"* (18/09/2026).
--
-- ATENCAO 1: SÓ UPDATE. Nenhum gatilho novo dispara em INSERT ou DELETE, e é isso que protege o
-- "Novo produto": o INSERT dele não gera trilha, então a FK `on delete restrict` da trilha não
-- prende o DELETE de compensação (cadastrar-produto-server.ts:565). Três consequências escritas:
--   • a regra do primeiro filho, no INSERT, continua no app: `paisPossiveisDoOperador`
--     (cadastrar-produto-server.ts:201) só aceita como pai raiz sem id, raiz que já é pai ou raiz do
--     Panteon sem unidade. Na adoção do 30 (F12), a função da 0199 insere o ACT como raiz e a ida
--     para baixo da ACP é um UPDATE, que passa por aqui;
--   • o CHECK de formato (g) vale também para INSERT. É o mesmo regex que o app confere antes de
--     gravar (CODIGO_VALIDO, produto-novo.ts:102), então o "Novo produto" nunca chega a batê-lo;
--   • no INSERT com pai, a função da 0123, refeita em (h), passa a travar a linha do pai
--     (FOR SHARE) antes de ler. A regra e a MENSAGEM são as mesmas, e é pela mensagem que o app a
--     reconhece (cadastrar-produto-server.ts:396). O porquê está na ATENCAO 9.
-- ⚠️ UPSERT É UPDATE. `insert ... on conflict do update` passa pelo carimbo, pela guarda e pela
-- trilha. A versão antiga do semeador (upsert por workspace_id,codigo, sem a trava da carga)
-- continua, medido em 26/09/2026, no checkout principal careli-hub (feat/portal-cecilio-replica) e
-- em 8 worktrees: espelho-celular, hierarquia-anexos, lote-planos, pedido-orfao,
-- planos-como-mmendes, portal-cecilio, status-unico e temis-dados-panteon. Com a 0192 aplicada,
-- rodar essa versão grava trilha 'sql:service_role' para cada nome, cidade ou ordem que diverge, e
-- para no meio, sem desfazer o que já gravou (cada upsert é uma requisição), na primeira linha em
-- que o id do C2X muda, ou em que o pai muda e há movimento. A carga está encerrada desde
-- 21/09/2026: não rode.
--
-- ATENCAO 2: O CARIMBO É DO GATILHO, NÃO DE QUEM ESCREVE. Em toda mudança real, `atualizado_em`
-- vira now() e `atualizado_por` vira `panteon.autor` (set local), ou 'sql:' || current_user sem ele.
--   • now() é a hora da TRANSAÇÃO: o que muda junto fica com a mesma hora, na linha e na trilha;
--   • o que o UPDATE mandar nessas duas colunas é descartado. UPDATE que não muda nada (ou só mexe
--     no carimbo) mantém o carimbo e não grava trilha;
--   • é este carimbo que o cache da F1 confere (count e max(atualizado_em),
--     lib/hercules/cadastro-em-cache.ts) para se renovar sem prazo fixo, inclusive depois de SQL
--     manual;
--   • pelo PostgREST, current_user é `service_role`: 'sql:service_role' na trilha quer dizer que
--     alguém gravou sem passar pela função da tela (0197), que marca autor e origem;
--   • as 38 linhas de hoje ficam com `atualizado_por` NULO. Inventar autor para o passado seria
--     mentir no registro (a mesma decisão da 0170, ATENCAO 8).
--
-- ATENCAO 3: A SAÍDA EXPLÍCITA, PARA CORREÇÃO ASSISTIDA COM OK DO LUCAS. Na MESMA transação:
--     set local panteon.permite_correcao_assistida = 'sim';
--     set local panteon.motivo = '<por quê, com a data do OK>';
--     set local panteon.autor = 'zeus:<quem>';          -- opcional; sem ele, 'sql:<papel>'
--   • LIBERA: a trava de movimento de sigla, pai e tipo; o pai com movimento que recebe o primeiro
--     filho; e a imutabilidade do `c2x_enterprise_id`. Usos já previstos: o ACT (30) sob a ACP (42)
--     e o `hercules_ligar_ao_c2x` da F12 (0199);
--   • NÃO LIBERA a forma da árvore nem a chave: neto, pai de si mesmo, `id` e `workspace_id` são
--     recusados sempre (ATENCAO 5);
--   • EXIGE MOTIVO: com a saída ligada, QUALQUER mudança real sem `panteon.motivo` é recusada,
--     inclusive a que só mexe no nome. A trilha grava origem 'correcao', seja qual for o
--     `panteon.origem`, e o CHECK da trilha garante que 'correcao' nunca fica sem motivo;
--   • ⚠️ `set local` e set_config(..., true) valem até o fim da TRANSAÇÃO, não do bloco nem da
--     função. Nunca `set` de sessão: numa conexão reaproveitada pelo pooler, ele deixaria a porta
--     aberta para a transação seguinte, de outra pessoa;
--   • ⚠️ POR ISSO A FUNÇÃO QUE LIGA A SAÍDA POR DENTRO (o `hercules_ligar_ao_c2x` da 0199) NÃO usa
--     set_config para abrir a porta. Usa a cláusula SET da própria função, que vale só durante a
--     execução dela e devolve o valor anterior na saída, inclusive em erro:
--         create or replace function public.hercules_ligar_ao_c2x(...)
--         ...
--         set search_path = ''
--         set panteon.permite_correcao_assistida = 'sim'
--         set panteon.motivo = ''
--         as $$ ... perform set_config('panteon.motivo', p_motivo, true); ... $$;
--     Com o SET da função para a mesma variável, o set_config de dentro também fica preso à
--     função (o mesmo vale para `panteon.autor` e `panteon.origem`, se ela os marcar). Com
--     set_config solto, um UPDATE seguinte na mesma transação (um begin ... commit maior do Zeus)
--     passaria pela guarda com a porta aberta e sairia na trilha como 'correcao';
--   • o PostgREST não liga a saída (ele não aceita GUC arbitrário do cliente): só SQL direto, ou
--     uma função que a ligue como acima;
--   • SQL manual não passa pelo app, então não confere o C2X: quem troca sigla, pai ou tipo por SQL
--     confere à mão `enterprise_unities` e `acquisition_requests` do id, inclusive canceladas, como
--     a F10 fará no salvar.
--
-- ATENCAO 4: MOVIMENTO É O LADO PANTEON, contado por `hercules_movimento_do_empreendimento`. Os
-- nomes das tabelas e colunas foram medidos no banco em 26/09/2026:
--   • unidades por `enterprise_id` (o id do C2X, texto) E por `segmento_id` (o uuid da divisão);
--   • vendas (`hercules_vendas`, 0 linhas hoje; entra porque a regra fala em vendas);
--   • propostas por `empreendimento_id` E por `empreendimento_codigo`;
--   • reservas e masterplans (uuid); documentos (`empreendimento_codigo`);
--   • envelopes da Têmis por `enterprise_id` igual ao id OU à sigla: 8 dos 24 guardam a sigla no
--     lugar do id (VOC 2, VOL 5, VOR 1), que a F5 corrige;
--   • trabalhos da Têmis e eventos do Prometeu pelo id ou pela sigla; clientes do LSoft pela sigla
--     (`enterprise_c2x_code`).
-- Cada contador conta sozinho, e `total` é a soma: a mesma proposta pode entrar pelo id e pela
-- sigla, então `total` serve para saber se é ZERO, não para exibir. Medido em 26/09/2026: só PDI
-- (43) e RPS (14) dão zero; GDN tem 404 unidades, JDG 250, ACP 120.
-- CAD da esteira, settings, planos e minutas não entram: são chaveados pelo id, que não muda.
-- A função é SECURITY DEFINER para contar TUDO: se um dia quem a chama estiver sob RLS, contar zero
-- por não enxergar abriria a trava. Por isso o REVOKE de public, anon e authenticated (as contagens
-- dizem quanto se vendeu). E conta sem filtrar `workspace_id`: na dúvida, conta a mais, e a trava
-- fecha. A contagem é lida sem trava de linha: ver ATENCAO 9.
--
-- ATENCAO 5: A FORMA DA ÁRVORE E A CHAVE, SEM SAÍDA. A 0123 (`hercules_empreendimento_pai_e_raiz`)
-- confere que o NOVO pai é raiz. Faltava o outro lado: quem já tem filhos não pode ganhar pai. E
-- `pai_id = id` passava pela 0123, porque no momento da conferência a própria linha ainda é raiz.
-- `id` e `workspace_id` também não mudam:
--   • `workspace_id` entra nas duas chaves únicas ((workspace_id, codigo) e
--     (workspace_id, c2x_enterprise_id)) e os leitores filtram workspace_id = 'careli': trocá-lo
--     sumiria com o cadastro, as unidades e as vendas das telas, calado;
--   • `id` é a chave das FKs de propostas, reservas, masterplans, unidades (segmento_id), do pai e
--     da própria trilha.
-- Nenhuma correção prevista precisa de três níveis nem de trocar a chave, então a saída explícita
-- não abre estas portas.
--
-- ATENCAO 6: A TRILHA É GENÉRICA. Uma linha por coluna que mudou, comparando a linha inteira
-- (to_jsonb), menos o carimbo. A `chave_do_grupo` (F4, 0194) e os campos do legado (F9, 0196)
-- entram na trilha sozinhos, sem mexer neste gatilho: coluna nova sem trilha seria o leitor
-- esquecido de sempre. `antes` e `depois` vão em texto. A FK é `on delete restrict`: empreendimento
-- com trilha não se apaga, e não existe excluir empreendimento (desligar é `vendendo = false`).
-- ⚠️ Para quem cria coluna nesta tabela depois (F4, F9): o WHEN dos gatilhos compara a linha inteira
-- (old.* is distinct from new.*), e isso exige operador de igualdade em TODA coluna. `json` não tem:
-- uma coluna `json` faria todo UPDATE falhar. Use `jsonb`.
-- ⚠️ LEITURA EM LOTE SÓ PELA VIEW. O PostgREST corta em 1.000 linhas sem erro (skill
-- migration-supabase, §5; é o caso da 0109). A trilha se lê direto só para UM empreendimento (o
-- histórico da tela, pelo índice). Quem lê de todos lê `hercules_empreendimento_valores_antigos`:
-- uma linha por empreendimento, campo e valor que já valeu. São os leitores já previstos no plano:
-- a sigla antiga no espaço de nomes da sigla (F10), o silêncio do vigia quando o C2X só acompanha
-- o Panteon (F3) e o apelido de nome anterior nos links (F10).
--
-- ATENCAO 7: CHECK NOT VALID + VALIDATE NA MESMA MIGRATION. As 38 linhas passam (medido em
-- 26/09/2026). Se alguém gravar sigla fora do formato entre a medição e a aplicação, o VALIDATE
-- falha e a migration inteira volta, sem nada pela metade.
--
-- ATENCAO 8: ORDEM E MENSAGENS. O Postgres dispara os BEFORE em ordem alfabética: carimbo, guarda,
-- pai_raiz (0123). A ordem não muda o resultado: o carimbo só escreve `atualizado_em` e
-- `atualizado_por`, que a guarda não lê. Toda recusa da 0192 começa com um prefixo estável, para a
-- tela da F10 traduzir: [0192:chave], [0192:pai-de-si], [0192:neto], [0192:motivo],
-- [0192:id-do-c2x], [0192:movimento], [0192:novo-pai]. As de movimento levam as contagens em DETAIL
-- (jsonb). A recusa da 0123 continua com a mensagem dela, sem prefixo.
--
-- ATENCAO 9: CONCORRÊNCIA (READ COMMITTED). As conferências leem o que já está gravado. Sem trava,
-- duas escritas ao mesmo tempo passariam cada uma pela sua conferência e juntas fariam o que a
-- regra proíbe. Exemplo: T1 põe X sob Y (X sem filhos, a guarda passa) enquanto T2 insere Z sob X
-- (a 0123 de T2 vê X raiz); as duas gravam e fica Z sob X sob Y. A FK do pai não segura: o
-- FOR KEY SHARE dela não conflita com o FOR NO KEY UPDATE de um UPDATE que não mexe em coluna de
-- chave única (pai_id não está em índice único).
--   • A FORMA DA ÁRVORE FICA TRAVADA. A função da 0123 é refeita em (h) para travar a linha do pai
--     com FOR SHARE ANTES de ler se ele é raiz. FOR SHARE conflita com o UPDATE da linha do pai, e
--     quem chega depois espera o outro terminar. Se T2 chega antes, o UPDATE de T1 em X espera, e a
--     guarda de T1 já vê o Z. Se T1 chega antes, a 0123 de T2 espera e relê X, agora com pai. O
--     mesmo vale para pôr X sob Y enquanto Y ganha pai. A trava só existe quando há pai e dura até
--     o fim da transação;
--   • ⚠️ a guarda NÃO pode ser declarada stable: como volatile, cada comando dela tira um retrato
--     novo, e é assim que ela enxerga o filho que acabou de ser gravado por quem ela esperou;
--   • O MOVIMENTO NÃO FICA TRAVADO, E O RESÍDUO É ACEITO. As contagens são lidas sem trava, e
--     `hercules_unidades.enterprise_id` é texto sem FK (medido em 26/09/2026): uma unidade gravada
--     no mesmo instante de uma troca de sigla não espera nada. Travar exigiria mexer em todo
--     cadastrador de unidade, para uma edição rara e só de admin. Quem pega o resíduo é o vigia da
--     F3, item (c): o prefixo de hercules_unidades.codigo contra a sigla do cadastro.
--
-- DESFAZER (só com OK; a trilha é apagada junto, então exporte-a antes):
--   drop view if exists public.hercules_empreendimento_valores_antigos;
--   drop trigger if exists hercules_empreendimentos_trilha on public.hercules_empreendimentos;
--   drop trigger if exists hercules_empreendimentos_guarda on public.hercules_empreendimentos;
--   drop trigger if exists hercules_empreendimentos_carimbo on public.hercules_empreendimentos;
--   drop function if exists public.hercules_empreendimento_trilha();
--   drop function if exists public.hercules_empreendimento_guarda();
--   drop function if exists public.hercules_empreendimento_carimbo();
--   drop function if exists public.hercules_movimento_do_empreendimento(uuid);
--   -- a função da 0123 volta ao texto original, sem trava e sem search_path: rode de novo o bloco
--   -- create or replace function de 0123_hercules_empreendimentos_e_masterplans.sql, linhas 73-82
--   -- (o gatilho hercules_empreendimentos_pai_raiz fica como está);
--   alter table public.hercules_empreendimentos
--     drop constraint if exists hercules_empreendimentos_codigo_formato;
--   drop table if exists public.hercules_empreendimento_alteracoes;
--   alter table public.hercules_empreendimentos drop column if exists atualizado_por;

-- ── (a) A TRILHA ──────────────────────────────────────────────────────────────
create table if not exists public.hercules_empreendimento_alteracoes (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      text not null default 'careli',
  empreendimento_id uuid not null
    references public.hercules_empreendimentos (id) on delete restrict,
  -- o nome da coluna de hercules_empreendimentos que mudou (nome, codigo, pai_id, ...)
  campo             text not null,
  -- o valor em texto; nulo = a coluna estava (ou ficou) nula
  antes             text,
  depois            text,
  -- `panteon.motivo` da transação; obrigatório com a saída explícita (ATENCAO 3)
  motivo            text,
  -- `panteon.autor` da transação, ou 'sql:' || current_user (ATENCAO 2)
  autor             text not null,
  origem            text not null default 'sql',
  alterado_em       timestamptz not null default now(),
  constraint hercules_empreendimento_alteracoes_origem
    check (origem in ('tela', 'adocao', 'correcao', 'sql')),
  -- A guarda já recusa a correção sem motivo; o CHECK faz disso um fato da tabela, que vale também
  -- para quem gravar a trilha por fora do gatilho (a adoção da 0199).
  constraint hercules_empreendimento_alteracoes_correcao_tem_motivo
    check (origem <> 'correcao' or motivo is not null)
);

-- A tela lê o histórico de UM empreendimento, do mais novo para o mais velho. O mesmo índice serve
-- à FK: o `restrict` confere a trilha a cada DELETE em hercules_empreendimentos.
create index if not exists hercules_empreendimento_alteracoes_por_empreendimento
  on public.hercules_empreendimento_alteracoes (empreendimento_id, alterado_em desc);

-- RLS ligada e sem policy: só o service role lê e escreve (padrão da casa desde a 0075). E sem
-- privilégio de tabela para anon e authenticated: TRUNCATE não passa por RLS, e trilha não se
-- trunca pela chave pública.
-- ⚠️ O SERVICE ROLE SÓ LÊ E ACRESCENTA, POR GRANT EXPLÍCITO. O gatilho da trilha é SECURITY
-- INVOKER: grava como quem fez o UPDATE, e o app grava como service_role, que precisa de INSERT
-- aqui. Em prod ele o teria pelo default ACL do papel postgres em public (arwdDxtm, medido em
-- pg_default_acl em 26/09/2026), mas isso não vale em todo banco nem para sempre: sem o GRANT, todo
-- UPDATE do app em hercules_empreendimentos falharia com permission denied na trilha. E o mesmo
-- default daria à chave de serviço UPDATE, DELETE e TRUNCATE num registro de auditoria. A FK e o
-- DESFAZER rodam como postgres, o dono, e não dependem disto (mesmo padrão da 0170 na sequence).
alter table public.hercules_empreendimento_alteracoes enable row level security;
revoke all on table public.hercules_empreendimento_alteracoes from anon, authenticated, service_role;
grant select, insert on table public.hercules_empreendimento_alteracoes to service_role;

comment on table public.hercules_empreendimento_alteracoes is
  'Trilha do cadastro de empreendimentos: uma linha por coluna alterada em hercules_empreendimentos, gravada pelo gatilho da 0192 em todo UPDATE, inclusive SQL manual e upsert. INSERT e DELETE não geram trilha (a adoção da F12 grava a sua, origem adocao). Leitura em lote só pela view hercules_empreendimento_valores_antigos (0192, ATENCAO 6). service_role só lê e acrescenta.';
comment on column public.hercules_empreendimento_alteracoes.origem is
  'tela (função da 0197) · adocao (Trazer do C2X, 0199) · correcao (saída explícita da 0192; motivo obrigatório, garantido pelo CHECK hercules_empreendimento_alteracoes_correcao_tem_motivo) · sql (qualquer outro UPDATE, inclusive pelo PostgREST).';
comment on column public.hercules_empreendimento_alteracoes.autor is
  'panteon.autor (set local) da transação; sem ele, sql:<papel do banco>. sql:service_role = gravado pelo app sem a função da tela.';
comment on column public.hercules_empreendimento_alteracoes.campo is
  'Nome da coluna de hercules_empreendimentos. A trilha compara a linha inteira: coluna nova entra sozinha (0192, ATENCAO 6).';

-- A trilha lida em lote (ATENCAO 6): uma linha por valor que já valeu, não uma por alteração.
-- security_invoker: a view respeita a RLS da trilha (padrão da 0148), e anon e authenticated não
-- a enxergam.
create or replace view public.hercules_empreendimento_valores_antigos
with (security_invoker = true) as
select a.workspace_id,
       a.empreendimento_id,
       a.campo,
       a.antes as valor,
       max(a.alterado_em) as deixou_de_valer_em
  from public.hercules_empreendimento_alteracoes a
 where a.antes is not null
 group by a.workspace_id, a.empreendimento_id, a.campo, a.antes;

revoke all on table public.hercules_empreendimento_valores_antigos from anon, authenticated, service_role;
grant select on table public.hercules_empreendimento_valores_antigos to service_role;

comment on view public.hercules_empreendimento_valores_antigos is
  'Valores que já valeram no cadastro de empreendimentos, um por empreendimento, campo e valor, com a última vez que deixaram de valer. É por aqui que se lê a trilha de todos (sigla antiga no espaço de nomes, silêncio do vigia, apelido dos links), nunca a trilha crua em lote: o PostgREST corta em 1.000 linhas sem erro (0192, ATENCAO 6). Um valor pode ter voltado a valer: compare com o cadastro.';

-- ── (b) QUEM MUDOU POR ÚLTIMO ─────────────────────────────────────────────────
alter table public.hercules_empreendimentos
  add column if not exists atualizado_por text;

comment on column public.hercules_empreendimentos.atualizado_por is
  'Quem fez a última mudança real: panteon.autor da transação, ou sql:<papel>. Mantido pelo gatilho da 0192; o valor mandado no UPDATE é descartado. Nulo nas 38 linhas anteriores à 0192.';
comment on column public.hercules_empreendimentos.atualizado_em is
  'Hora (da transação) da última mudança real. Mantido pelo gatilho da 0192, inclusive em SQL manual; é o carimbo que o cache do cadastro confere.';

-- ── (e) O MOVIMENTO DO LADO PANTEON ───────────────────────────────────────────
-- Vem antes da guarda porque a guarda a chama.
create or replace function public.hercules_movimento_do_empreendimento(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_codigo    text;
  v_id_c2x    text;
  v_contagens jsonb;
begin
  select e.codigo, nullif(btrim(e.c2x_enterprise_id), '')
    into v_codigo, v_id_c2x
    from public.hercules_empreendimentos e
   where e.id = p_id;

  if not found then
    return null;
  end if;

  v_contagens := jsonb_build_object(
    'unidades_por_enterprise_id',
      (select count(*) from public.hercules_unidades u
        where v_id_c2x is not null and u.enterprise_id = v_id_c2x),
    'unidades_por_segmento_id',
      (select count(*) from public.hercules_unidades u
        where u.segmento_id = p_id),
    'vendas',
      (select count(*) from public.hercules_vendas v
        where v_id_c2x is not null and v.enterprise_id = v_id_c2x),
    'propostas_por_empreendimento_id',
      (select count(*) from public.hercules_propostas p
        where p.empreendimento_id = p_id),
    'propostas_por_empreendimento_codigo',
      (select count(*) from public.hercules_propostas p
        where p.empreendimento_codigo = v_codigo),
    'reservas',
      (select count(*) from public.hercules_reservas r
        where r.empreendimento_id = p_id),
    'masterplans',
      (select count(*) from public.hercules_masterplans m
        where m.empreendimento_id = p_id),
    'documentos',
      (select count(*) from public.hercules_documentos d
        where d.empreendimento_codigo = v_codigo),
    'envelopes',
      (select count(*) from public.temis_envelopes t
        where t.enterprise_id = v_id_c2x or t.enterprise_id = v_codigo),
    'trabalhos_da_temis',
      (select count(*) from public.temis_trabalhos t
        where t.enterprise_id = v_id_c2x or t.enterprise_codigo = v_codigo),
    'eventos_do_prometeu',
      (select count(*) from public.prometeu_eventos pe
        where pe.enterprise_id = v_id_c2x or pe.enterprise_code = v_codigo),
    'clientes_do_lsoft',
      (select count(*) from public.lsoft_clientes l
        where l.enterprise_c2x_code = v_codigo)
  );

  return v_contagens || jsonb_build_object(
    'total', (select coalesce(sum(c.value::bigint), 0) from jsonb_each_text(v_contagens) c),
    'empreendimento_id', p_id,
    'codigo', v_codigo,
    'c2x_enterprise_id', v_id_c2x,
    'medido_em', now()
  );
end;
$$;

comment on function public.hercules_movimento_do_empreendimento(uuid) is
  'Contagens do lado Panteon de um empreendimento (unidades por id e por segmento, vendas, propostas por id e por sigla, reservas, masterplans, documentos, envelopes, trabalhos da Têmis, eventos do Prometeu, clientes do LSoft). total = soma, pode contar a mesma linha duas vezes: serve para saber se é zero. Nulo = uuid fora do cadastro. Lida sem trava de linha (ATENCAO 9). Só service role (0192, ATENCAO 4).';

-- ⚠️ SÓ O SERVICE ROLE. As contagens dizem quanto se vendeu de cada empreendimento; a função é
-- SECURITY DEFINER e enxerga tudo. O default do schema dá EXECUTE a anon e authenticated.
revoke execute on function public.hercules_movimento_do_empreendimento(uuid) from public;
revoke execute on function public.hercules_movimento_do_empreendimento(uuid) from anon;
revoke execute on function public.hercules_movimento_do_empreendimento(uuid) from authenticated;
grant execute on function public.hercules_movimento_do_empreendimento(uuid) to service_role;

-- ── (c) O CARIMBO ─────────────────────────────────────────────────────────────
create or replace function public.hercules_empreendimento_carimbo()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Só o carimbo mudou (ou nada mudou): o carimbo é do gatilho, fica o de antes (ATENCAO 2).
  if (to_jsonb(new) - 'atualizado_em' - 'atualizado_por')
     = (to_jsonb(old) - 'atualizado_em' - 'atualizado_por') then
    new.atualizado_em := old.atualizado_em;
    new.atualizado_por := old.atualizado_por;
    return new;
  end if;

  new.atualizado_em := now();
  new.atualizado_por := coalesce(
    nullif(btrim(current_setting('panteon.autor', true)), ''),
    'sql:' || current_user
  );
  return new;
end;
$$;

comment on function public.hercules_empreendimento_carimbo() is
  'BEFORE UPDATE em hercules_empreendimentos: mantém atualizado_em (now) e atualizado_por (panteon.autor ou sql:<papel>) em toda mudança real; descarta o carimbo mandado no UPDATE (0192, ATENCAO 2).';

drop trigger if exists hercules_empreendimentos_carimbo on public.hercules_empreendimentos;
create trigger hercules_empreendimentos_carimbo
  before update on public.hercules_empreendimentos
  for each row
  when (old.* is distinct from new.*)
  execute function public.hercules_empreendimento_carimbo();

-- ── (f) A GUARDA ──────────────────────────────────────────────────────────────
-- ⚠️ Fica volatile (o padrão), nunca stable: ATENCAO 9.
create or replace function public.hercules_empreendimento_guarda()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_saida        boolean;
  v_motivo       text;
  v_mudou_codigo boolean;
  v_mudou_pai    boolean;
  v_mudou_tipo   boolean;
  v_mudou_id     boolean;
  v_movimento    jsonb;
begin
  v_saida := coalesce(current_setting('panteon.permite_correcao_assistida', true), '') = 'sim';
  v_motivo := nullif(btrim(current_setting('panteon.motivo', true)), '');
  v_mudou_codigo := new.codigo is distinct from old.codigo;
  v_mudou_pai := new.pai_id is distinct from old.pai_id;
  v_mudou_tipo := new.tipo_produto is distinct from old.tipo_produto;
  v_mudou_id := new.c2x_enterprise_id is distinct from old.c2x_enterprise_id;

  -- A chave: sem saída (ATENCAO 5).
  if new.id is distinct from old.id or new.workspace_id is distinct from old.workspace_id then
    raise exception '[0192:chave] O id e o workspace_id de % não mudam.', old.codigo
      using hint = 'Nem a correção assistida libera: são a chave das FKs e das duas chaves únicas (0192, ATENCAO 5).';
  end if;

  -- A forma da árvore: sem saída (ATENCAO 5).
  if v_mudou_pai and new.pai_id = new.id then
    raise exception '[0192:pai-de-si] O empreendimento % não pode ser pai de si mesmo.', old.codigo;
  end if;

  if v_mudou_pai and new.pai_id is not null and exists (
    select 1 from public.hercules_empreendimentos f where f.pai_id = old.id
  ) then
    raise exception '[0192:neto] O empreendimento % tem filhos e não pode ficar sob outro pai: um nível só.', old.codigo
      using hint = 'Nem a correção assistida libera: a árvore tem um nível só (0123 e 0192).';
  end if;

  -- Com a saída ligada, QUALQUER mudança real exige motivo, não só as travadas (ATENCAO 3). O
  -- carimbo fica de fora da comparação: UPDATE que só mexe nele não muda nada (ATENCAO 2).
  if v_saida and v_motivo is null
     and (to_jsonb(new) - 'atualizado_em' - 'atualizado_por')
         is distinct from (to_jsonb(old) - 'atualizado_em' - 'atualizado_por') then
    raise exception '[0192:motivo] Correção assistida em % sem motivo: marque panteon.motivo na mesma transação.', old.codigo;
  end if;

  if not (v_mudou_codigo or v_mudou_pai or v_mudou_tipo or v_mudou_id) then
    return new;
  end if;

  -- A saída explícita (ATENCAO 3), já com motivo: libera o resto.
  if v_saida then
    return new;
  end if;

  if v_mudou_id then
    raise exception '[0192:id-do-c2x] O c2x_enterprise_id de % não muda (de % para %).',
      old.codigo, coalesce(old.c2x_enterprise_id, 'nulo'), coalesce(new.c2x_enterprise_id, 'nulo')
      using hint = 'Ligar ao C2X é correção assistida (F12), com OK do Lucas.';
  end if;

  -- Sigla, pai e tipo: só com movimento zero no lado Panteon (ATENCAO 4). Lido ANTES do UPDATE:
  -- a função vê a linha como ela está, com a sigla antiga.
  v_movimento := public.hercules_movimento_do_empreendimento(old.id);
  if coalesce((v_movimento ->> 'total')::bigint, 1) > 0 then
    raise exception '[0192:movimento] % tem movimento no Panteon: sigla, pai e tipo só mudam com movimento zero.', old.codigo
      using detail = coalesce(v_movimento::text, ''),
            hint = 'Correção assistida só com OK do Lucas (0192, ATENCAO 3).';
  end if;

  -- O pai que recebe o PRIMEIRO filho também precisa de movimento zero: o catálogo muda de forma.
  if v_mudou_pai and new.pai_id is not null and not exists (
    select 1 from public.hercules_empreendimentos f
     where f.pai_id = new.pai_id and f.id <> old.id
  ) then
    v_movimento := public.hercules_movimento_do_empreendimento(new.pai_id);
    if v_movimento is null then
      raise exception '[0192:novo-pai] O pai % não está no cadastro.', new.pai_id;
    end if;
    if (v_movimento ->> 'total')::bigint > 0 then
      raise exception '[0192:novo-pai] % tem movimento e ainda não tem filhos: o primeiro filho mudaria a forma do catálogo.',
        v_movimento ->> 'codigo'
        using detail = v_movimento::text,
              hint = 'Correção assistida só com OK do Lucas (0192, ATENCAO 3).';
    end if;
  end if;

  return new;
end;
$$;

comment on function public.hercules_empreendimento_guarda() is
  'BEFORE UPDATE em hercules_empreendimentos. Sempre recusa trocar id ou workspace_id, neto e pai de si mesmo. Com a saída explícita (panteon.permite_correcao_assistida = sim), toda mudança real exige panteon.motivo. Sem ela: c2x_enterprise_id não muda; codigo, pai_id e tipo_produto só com movimento zero; pai sem filhos só recebe o primeiro com movimento zero (0192).';

drop trigger if exists hercules_empreendimentos_guarda on public.hercules_empreendimentos;
create trigger hercules_empreendimentos_guarda
  before update on public.hercules_empreendimentos
  for each row
  execute function public.hercules_empreendimento_guarda();

-- ── (d) A TRILHA, LINHA POR CAMPO ─────────────────────────────────────────────
create or replace function public.hercules_empreendimento_trilha()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_antes  jsonb;
  v_depois jsonb;
  v_origem text;
begin
  v_antes := to_jsonb(old) - 'atualizado_em' - 'atualizado_por';
  v_depois := to_jsonb(new) - 'atualizado_em' - 'atualizado_por';

  -- Com a saída ligada é correção, diga o panteon.origem o que disser (ATENCAO 3). O motivo já foi
  -- exigido pela guarda, e o CHECK da trilha confere de novo.
  v_origem := case
    when coalesce(current_setting('panteon.permite_correcao_assistida', true), '') = 'sim' then 'correcao'
    else coalesce(nullif(btrim(current_setting('panteon.origem', true)), ''), 'sql')
  end;

  insert into public.hercules_empreendimento_alteracoes
    (workspace_id, empreendimento_id, campo, antes, depois, motivo, autor, origem, alterado_em)
  select new.workspace_id,
         new.id,
         d.key,
         v_antes ->> d.key,
         v_depois ->> d.key,
         nullif(btrim(current_setting('panteon.motivo', true)), ''),
         coalesce(new.atualizado_por, 'sql:' || current_user),
         v_origem,
         new.atualizado_em
    from jsonb_each(v_depois) d
   where d.value is distinct from (v_antes -> d.key);

  return null;
end;
$$;

comment on function public.hercules_empreendimento_trilha() is
  'AFTER UPDATE em hercules_empreendimentos: grava em hercules_empreendimento_alteracoes uma linha por coluna que mudou, com autor, origem e motivo da transação (0192, ATENCAO 6).';

drop trigger if exists hercules_empreendimentos_trilha on public.hercules_empreendimentos;
create trigger hercules_empreendimentos_trilha
  after update on public.hercules_empreendimentos
  for each row
  when (old.* is distinct from new.*)
  execute function public.hercules_empreendimento_trilha();

-- ── (g) O FORMATO DA SIGLA ────────────────────────────────────────────────────
-- Letra primeiro, depois letras ou números, 2 a 6 no total: o mesmo CODIGO_VALIDO do app
-- (produto-novo.ts:102). Começa com letra porque o código da unidade começa com a sigla.
alter table public.hercules_empreendimentos
  drop constraint if exists hercules_empreendimentos_codigo_formato;

alter table public.hercules_empreendimentos
  add constraint hercules_empreendimentos_codigo_formato
  check (codigo ~ '^[A-Z][A-Z0-9]{1,5}$') not valid;

alter table public.hercules_empreendimentos
  validate constraint hercules_empreendimentos_codigo_formato;

comment on constraint hercules_empreendimentos_codigo_formato on public.hercules_empreendimentos is
  'Sigla no formato do app (produto-novo.ts:102): ^[A-Z][A-Z0-9]{1,5}$. 38 de 38 passavam em 26/09/2026 (0192, ATENCAO 7).';

-- ── (h) A 0123 TRAVA O PAI ANTES DE LER ───────────────────────────────────────
-- A mesma regra e a MESMA mensagem da 0123: o app reconhece a recusa por ela
-- (cadastrar-produto-server.ts:396). Muda só a leitura: trava a linha do pai com FOR SHARE, SEM
-- filtro, e só depois olha se ele é raiz. Com o filtro `pai_id is not null` na consulta que trava,
-- o pai raiz (o caso comum) nem seria travado, e a corrida da ATENCAO 9 continuaria aberta. O
-- gatilho hercules_empreendimentos_pai_raiz (BEFORE INSERT OR UPDATE OF pai_id) fica como está.
-- FOR SHARE pede UPDATE na tabela a quem grava: o service_role tem (medido em 26/09/2026).
create or replace function public.hercules_empreendimento_pai_e_raiz()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_pai_do_pai uuid;
begin
  if new.pai_id is null then
    return new;
  end if;

  select p.pai_id
    into v_pai_do_pai
    from public.hercules_empreendimentos p
   where p.id = new.pai_id
     for share;

  -- Pai que não existe passa daqui e é recusado pela FK, como antes.
  if v_pai_do_pai is not null then
    raise exception 'O pai de um empreendimento precisa ser raiz (um nível só).';
  end if;
  return new;
end;
$$;

comment on function public.hercules_empreendimento_pai_e_raiz() is
  'BEFORE INSERT OR UPDATE OF pai_id em hercules_empreendimentos (0123): o pai tem de ser raiz, um nível só. Desde a 0192 trava a linha do pai (FOR SHARE) antes de ler, para duas escritas simultâneas não criarem o terceiro nível (0192, ATENCAO 9).';
