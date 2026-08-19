-- 0096 · CARTEIRA DO LSOFT (Garden e Vale do Sol)
--
-- Pedido do Lucas (19/08/2026): "vamos criar uma tela separada para gente organizar isso? eu
-- preciso ver esses dados cadastrais, preciso ver as parcelas, se foi pago se não, quero montar um
-- POC para trabalhar nessa integração com Apolo e C2X".
--
-- DE ONDE VEM: LSoft SGC 6.13, o sistema da Cecílio Rocha — um Access ANTERIOR ao Access 2000, em
-- `\\SERVIDOR\Sistema\sgc\dados.mdb`, dentro da rede local deles. Ver
-- scripts/lsoft/extrair-garden-vale-do-sol.ps1.
--
-- ⚠️ POR QUE ESPELHAR EM VEZ DE CONSULTAR AO VIVO. O banco está numa rede local que a Vercel não
-- alcança, e é um arquivo Access aberto o dia inteiro pelos usuários — não há como (nem se deve)
-- consultá-lo de dentro do app. A carga roda da máquina que enxerga o `\\SERVIDOR` e escreve aqui.
-- Consequência que a tela precisa dizer ao usuário: o dado é do ÚLTIMO SINCRONISMO, não de agora.
--
-- ⚠️ O CENTRO DE CUSTO É A CHAVE DO RECORTE. No LSoft o "centro de custo" é a tripla
-- CATEGORIA.CLASSE.SUBCLASSE, e a CATEGORIA é o EMPREENDIMENTO: 124 = Condomínio Garden,
-- 102 = Vale do Sol; 16.3 = Receita / Aptos Vendidos. "Aptos Vendidos" se repete em dezenas de
-- categorias, então filtrar só por 16.3 traria obra de todo mundo.

-- ── CLIENTES ────────────────────────────────────────────────────────────────
create table if not exists public.lsoft_clientes (
  -- O código do LSoft (string zero-preenchida, ex. "00000521") é a chave natural e o que amarra
  -- as parcelas. Mantido como veio: virar número perderia os zeros e quebraria o casamento.
  codigo text primary key,

  nome text not null,
  -- Só dígitos, para casar com Apolo e C2X sem sofrer com máscara divergente.
  cpf text,
  cpf_formatado text,
  rg text,
  nascimento date,

  telefone text,
  celular text,
  email text,

  endereco text,
  bairro text,
  cidade text,
  estado text,
  cep text,

  conjuge text,
  pai text,
  mae text,

  data_cadastro date,
  vendedor text,
  bloqueado boolean not null default false,

  -- Em quais empreendimentos essa pessoa tem parcela: {"Garden"}, {"Vale do Sol"} ou os dois.
  empreendimentos text[] not null default '{}',

  sincronizado_em timestamptz not null default now()
);

create index if not exists lsoft_clientes_cpf_idx on public.lsoft_clientes (cpf);
create index if not exists lsoft_clientes_nome_idx on public.lsoft_clientes (nome);

-- ── PARCELAS ────────────────────────────────────────────────────────────────
--
-- ⚠️ UMA TABELA SÓ PARA "A RECEBER" E "RECEBIDO", de propósito. No LSoft são duas tabelas
-- separadas (RECEBER e RECEBIDOS) e a parcela MUDA DE TABELA quando é paga. A tela precisa
-- responder "foi pago ou não" numa lista só, e manter a divisão aqui obrigaria toda consulta a um
-- UNION e todo indicador a somar dois lugares.
create table if not exists public.lsoft_parcelas (
  id uuid primary key default gen_random_uuid(),

  -- A origem no LSoft: de qual tabela veio e qual era o id lá. É o que permite reconhecer a mesma
  -- parcela em cargas seguintes, inclusive depois de ela migrar de RECEBER para RECEBIDOS.
  origem text not null check (origem in ('receber', 'recebido')),
  lsoft_id integer,

  cliente_codigo text not null references public.lsoft_clientes (codigo) on delete cascade,
  empreendimento text not null check (empreendimento in ('Garden', 'Vale do Sol')),

  -- Como o LSoft escreve: "007/084". O número e o total saem daqui já separados, para ordenar e
  -- para mostrar "7 de 84" sem parse na tela.
  parcela text,
  parcela_numero integer,
  parcela_total integer,

  vencimento date,
  valor numeric(14, 2) not null default 0,
  valor_recebido numeric(14, 2) not null default 0,
  data_recebido date,

  paga boolean not null default false,

  -- ⚠️ A UNIDADE VIVE EM TEXTO LIVRE. O LSoft não tem campo de lote/quadra: vem tudo em
  -- OBSERVACOES, e o formato varia ("LOTE: 109 QUADRA: 08", "LOTE 3 QUADRA 8 70.000 PERMUTA",
  -- e lançamentos antigos com "APARTAMENTO 302- 1 VAGA"). O texto original fica guardado inteiro
  -- porque o parse não acerta tudo — e é dele que sai a conferência quando o número não bater.
  observacoes text,
  lote text,
  quadra text,

  nro_nota text,
  boleto text,
  situacao text,

  sincronizado_em timestamptz not null default now()
);

create index if not exists lsoft_parcelas_cliente_idx on public.lsoft_parcelas (cliente_codigo);
create index if not exists lsoft_parcelas_empreendimento_idx on public.lsoft_parcelas (empreendimento);
create index if not exists lsoft_parcelas_vencimento_idx on public.lsoft_parcelas (vencimento);
create index if not exists lsoft_parcelas_paga_idx on public.lsoft_parcelas (paga);

-- A mesma parcela não pode entrar duas vezes numa recarga.
create unique index if not exists lsoft_parcelas_origem_id_idx
  on public.lsoft_parcelas (origem, lsoft_id)
  where lsoft_id is not null;

-- ── CONTROLE DA CARGA ───────────────────────────────────────────────────────
-- Quando rodou, quantas linhas vieram e se deu certo. É o que a tela usa para dizer "dados de
-- 19/08 às 16h", em vez de deixar o usuário achar que está vendo o LSoft ao vivo.
create table if not exists public.lsoft_sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  iniciado_em timestamptz not null default now(),
  concluido_em timestamptz,
  clientes integer not null default 0,
  parcelas integer not null default 0,
  ok boolean not null default false,
  erro text
);

-- ── RLS ─────────────────────────────────────────────────────────────────────
-- Deny-all, como o resto do projeto: quem lê é o servidor com a service role. Sem policy, o
-- anon/authenticated não enxerga nada — e aqui há CPF, RG, filiação e endereço de 237 pessoas.
alter table public.lsoft_clientes enable row level security;
alter table public.lsoft_parcelas enable row level security;
alter table public.lsoft_sincronizacoes enable row level security;

-- ── RESUMO POR CLIENTE ──────────────────────────────────────────────────────
--
-- A lista da tela precisa de "quanto falta, quanto pagou, quanto venceu" por pessoa. Somar isso no
-- servidor a cada carga significaria trazer as ~20 mil parcelas para a memória do Next só para
-- fechar 237 linhas. A view resolve no banco, que é onde esse tipo de conta pertence.
--
-- ⚠️ VENCIDO É O QUE PASSOU E NÃO FOI PAGO. A régua da data é `current_date` no servidor: parcela
-- de hoje ainda não está vencida.
create or replace view public.lsoft_carteira_por_cliente as
select
  c.codigo,
  c.nome,
  c.cpf,
  c.cpf_formatado,
  c.celular,
  c.telefone,
  c.email,
  c.cidade,
  c.empreendimentos,
  count(p.id) as parcelas,
  count(p.id) filter (where p.paga) as parcelas_pagas,
  count(p.id) filter (where not p.paga) as parcelas_abertas,
  count(p.id) filter (where not p.paga and p.vencimento < current_date) as parcelas_vencidas,
  coalesce(sum(p.valor) filter (where not p.paga), 0) as saldo_aberto,
  coalesce(sum(p.valor) filter (where not p.paga and p.vencimento < current_date), 0) as saldo_vencido,
  coalesce(sum(p.valor_recebido) filter (where p.paga), 0) as total_recebido,
  min(p.vencimento) filter (where not p.paga) as proximo_vencimento,
  -- As unidades da pessoa, como "Q08 L109". Vem do parse das observações, então pode faltar.
  array_remove(array_agg(distinct
    case when p.quadra is not null or p.lote is not null
         then concat_ws(' ', nullif('Q' || p.quadra, 'Q'), nullif('L' || p.lote, 'L'))
    end), null) as unidades
from public.lsoft_clientes c
left join public.lsoft_parcelas p on p.cliente_codigo = c.codigo
group by c.codigo, c.nome, c.cpf, c.cpf_formatado, c.celular, c.telefone, c.email, c.cidade,
         c.empreendimentos;
