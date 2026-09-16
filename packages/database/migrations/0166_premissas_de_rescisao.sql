-- 0166 · AS PREMISSAS DE RESCISÃO, POR EMPREENDIMENTO
--
-- Lucas (14/09/2026): *"vamos precisar ter esses parâmetros de rescisão nas politicas comerciais,
-- essas aliquotas precisam ser cadastradas para que o sistema puxe isso. então, ler todos os
-- contratos e entenda como podemos montar essa tela de premissas por empreendimentos"*, e depois:
-- *"a ideia é ter as premissas para gente montar isso por empreendimento"*.
--
-- ⚠️ ESTA TABELA EXISTE PORQUE LER O CONTRATO NÃO RESOLVE, e isso foi medido, não suposto. Li os
-- 3.020 contratos com texto do C2X procurando cada rubrica. O resultado, por empreendimento:
--   • cláusula penal ............ 13 de 32
--   • publicidade ................ 6 de 32
--   • corretagem ................ 18 de 32 (valores de 1,5% a 8%)
--   • fruição ................... 26 de 32
-- Um documento que deduz 10% de multa só quando acha a palavra no texto produziria número diferente
-- para dois clientes do mesmo empreendimento. O cadastro é o que faz o papel ser reprodutível.
--
-- ⚠️ E A BASE DE CÁLCULO DIVERGE ENTRE AS MINUTAS, não só o percentual. A mesma cláusula penal
-- incide ora sobre o "valor total do contrato", ora sobre o "valor do imóvel atualizado", ora sobre
-- o "total pago". A base do papel que o comercial usa HOJE — valor de tabela menos a comissão de
-- corretagem — não aparece em contrato nenhum. Por isso a base é campo, e não convenção enterrada
-- no código: quem emite tem de conseguir explicar de onde saiu o número.
--
-- ⚠️ UMA LINHA POR RUBRICA, e não cinco colunas numa linha. A fruição entrou na vida por causa da
-- Lei 13.786/18; a próxima mudança de lei traz outra rubrica. Linha nova é INSERT, coluna nova é
-- migration com deploy.
--
-- ⚠️ A MORA NÃO ESTÁ AQUI, E É DE PROPÓSITO. Juros e multa de parcela vencida JÁ SÃO CADASTRADOS:
-- `commercial_policies.non_compliance_interest` e `.non_compliance_fine` no C2X, preenchidos em 33
-- dos 37 empreendimentos (1,00% e 2,00%, sem uma variação), e a aba Política Comercial do Apolo já
-- os mostra como "Juros por atraso" e "Multa por atraso". Os 4 sem cadastro não têm contrato algum.
-- Repetir isso aqui criaria duas verdades para o mesmo número.
--
-- ⚠️ "MULTA PENAL" TEM MAIS DE UM DONO NO TEXTO, e é o motivo de a alíquota da rescisão não poder
-- ser lida do contrato. `lib/hades/dossie/encargos.ts` casa "multa penal de X%" como multa DE MORA
-- (2%) — e está certo na minuta antiga da Lavra do Ouro, onde é isso mesmo. Mas no Cidade Jardim o
-- contrato 2038 diz *"multa penal de 0,5% ... por dia em que perdurar esbulho"*: terceira coisa,
-- terceiro sentido. Ler o texto para achar a cláusula penal compensatória de 10% devolveria 2% ou
-- 0,5% num papel que ninguém reconfere.
--
-- ⚠️ A LEITURA SEGUE A RÉGUA QUE JÁ EXISTE. `lib/hercules/recorte-da-unidade.ts` resolve
-- categoria → filho → pai, e é ela que a emissão do termo usa: cadastrar só no pai (LBR) vale para
-- os filhos (LBF, LBP); cadastrar no filho ganha do pai. Não há coluna de categoria aqui porque o
-- pedido é por empreendimento e a régua trata "sem categoria" como o caso normal — quando a
-- categoria fizer falta, é um ALTER de uma linha, não um redesenho.

create table if not exists public.hercules_premissas_de_rescisao (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  text not null default 'careli',
  enterprise_id text not null,

  rubrica       text not null,
  -- Desligada continua cadastrada: o histórico de por que aquele empreendimento não cobra
  -- publicidade vale mais do que a linha apagada.
  ativa         boolean not null default true,
  percentual    numeric(6, 3),
  base          text not null,
  periodicidade text not null default 'unica',
  -- O trecho do contrato que justifica a alíquota. Vai impresso no termo.
  clausula      text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  atualizado_por_nome text,

  constraint hercules_premissas_rubrica check (
    rubrica in ('clausula_penal', 'publicidade', 'corretagem', 'tributos', 'fruicao')
  ),
  constraint hercules_premissas_base check (
    base in (
      'valor_de_tabela',
      'valor_de_tabela_menos_comissao',
      'valor_do_contrato',
      'valor_do_contrato_atualizado',
      'total_pago',
      'valor_efetivo'
    )
  ),
  constraint hercules_premissas_periodicidade check (periodicidade in ('unica', 'mensal')),

  -- ⚠️ MENSAL SÓ EXISTE PARA FRUIÇÃO. Uma publicidade "4% ao mês" seria um erro de digitação que
  -- multiplicaria a dedução pelo número de meses de contrato, e ninguém conferiria.
  constraint hercules_premissas_mensal_so_fruicao check (
    periodicidade = 'unica' or rubrica = 'fruicao'
  ),

  -- ⚠️ RUBRICA LIGADA PRECISA DE NÚMERO. A exceção é `valor_efetivo`: a corretagem costuma ser o
  -- valor em reais que saiu do caixa lá atrás, e recalculá-la por percentual hoje daria outro
  -- número se a tabela do lote mudou desde então.
  constraint hercules_premissas_ativa_tem_numero check (
    not ativa or base = 'valor_efetivo' or percentual is not null
  ),
  constraint hercules_premissas_percentual_plausivel check (
    percentual is null or (percentual >= 0 and percentual <= 100)
  )
);

create unique index if not exists hercules_premissas_uma_por_rubrica
  on public.hercules_premissas_de_rescisao (workspace_id, enterprise_id, rubrica);

create index if not exists hercules_premissas_por_empreendimento
  on public.hercules_premissas_de_rescisao (workspace_id, enterprise_id)
  where ativa;

-- ⚠️ MESMO DESENHO DAS IRMÃS: RLS ligada, sem policy, grant do `anon` revogado — 0112, 0123, 0125,
-- 0133, 0136. Quem fala com esta tabela é o service role.
alter table public.hercules_premissas_de_rescisao enable row level security;
revoke all on public.hercules_premissas_de_rescisao from anon;

comment on table public.hercules_premissas_de_rescisao is
  'Aliquotas de rescisao por empreendimento: clausula penal, publicidade, corretagem, tributos e fruicao. Uma linha por rubrica. Leitura com precedencia filho -> pai (lib/hercules/recorte-da-unidade.ts).';
comment on column public.hercules_premissas_de_rescisao.base is
  'Sobre o que o percentual incide. As minutas divergem: contrato, contrato atualizado, imovel, total pago. valor_efetivo = usar o valor em reais do contrato, sem recalcular.';
comment on column public.hercules_premissas_de_rescisao.periodicidade is
  'unica = deduz uma vez. mensal = por mes de ocupacao, so para fruicao (0,75%/mes e a praxe, pro rata die da posse ate a restituicao).';
comment on column public.hercules_premissas_de_rescisao.clausula is
  'O trecho do contrato que justifica a aliquota. Vai impresso no termo de rescisao.';
comment on column public.hercules_premissas_de_rescisao.ativa is
  'Desligada continua cadastrada, com a clausula, para explicar por que aquele empreendimento nao cobra a rubrica.';
