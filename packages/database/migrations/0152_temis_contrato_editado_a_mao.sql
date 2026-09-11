-- 0152 — O CONTRATO ALTERADO A MAO: onde mora a excecao deste caso.
--
-- Lucas, 10/09/2026: *"quando eu clicar no abrir contrato, esse contrato tem que me permitir fazer
-- alteracao manual, salvar, fechar contrato"*.
--
-- POR QUE UMA TABELA, SE A MINUTA JA MONTA O CONTRATO: porque contrato de caso concreto tem
-- excecao — a clausula que este comprador negociou, o paragrafo reescrito para uma venda com dois
-- titulares, o dado confirmado por telefone que o cadastro nao tem. A minuta e o texto de TODAS as
-- vendas; a excecao e desta. Sem lugar para ela dentro do sistema, ela acontece FORA: alguem baixa
-- o PDF, ajusta no Word e manda assinar — e o papel que foi para o cartorio deixa de ser o papel
-- que o Panteon conhece.
--
-- ATENCAO 1: UMA LINHA POR PROPOSTA (`proposta_id` e a chave primaria), e nao um historico de
-- rascunhos. O que se guarda aqui e o texto VIGENTE, ainda nao emitido — o historico de verdade e
-- `hercules_documentos`, onde cada geracao vira uma versao que nao se apaga (regra da 0136). Duas
-- gavetas de historico para o mesmo documento produziriam a pergunta "qual das duas vale?" no unico
-- lugar onde ela nao pode existir.
--
-- ATENCAO 2: `base_impressao` E O QUE IMPEDE A EDICAO DE ENVELHECER CALADA. O texto editado e uma
-- FOTO do contrato montado naquele instante. Se depois disso alguem corrigir o CPF no Apolo, trocar
-- a minuta publicada ou mudar o valor da proposta, o rascunho continua com o dado ANTIGO — e o
-- contrato sai errado sem ninguem ter feito nada errado. Guardando o sha-256 do HTML que serviu de
-- base, a tela compara com o de hoje e avisa. Sem esta coluna nao ha como saber.
--
-- ATENCAO 3: O HTML AQUI JA VEM FAXINADO (`lib/temis/contrato-editado.ts`), e a faxina e do
-- SERVIDOR. O texto chega do `contenteditable` do navegador, e o gesto comum — colar um paragrafo
-- de outro contrato ou de uma pagina — traz junto script, rastreador e `onerror=`. Nada disso pode
-- chegar ao Chromium que gera o PDF.
--
-- ATENCAO 4: NAO HA FK PARA `hercules_propostas`. E a mesma decisao de `temis_envelopes`: a
-- proposta e do Hercules e tem carga do C2X; uma FK aqui faria a limpeza de uma proposta importada
-- derrubar a edicao de um contrato que ja foi para assinatura. O elo e por id, como no resto da
-- Temis, e a leitura sempre passa por quem ja provou o direito.

create table if not exists public.temis_contrato_edicoes (
  -- A proposta E a chave: uma edicao vigente por venda. Ver ATENCAO 1.
  proposta_id  uuid primary key,
  workspace_id text not null default 'careli',

  -- O contrato como a pessoa deixou. Ja faxinado — ver ATENCAO 3.
  html         text not null,

  -- ── A BASE SOBRE A QUAL SE EDITOU ───────────────────────────────────────────
  -- sha-256 do HTML que a minuta montou no instante da edicao. Ver ATENCAO 2.
  base_impressao text,
  -- Qual minuta serviu de base. Uma minuta nova publicada depois muda o contrato inteiro, e este id
  -- e o que permite dizer isso em portugues em vez de so "o texto mudou".
  minuta_id    uuid,

  -- ── QUEM MEXEU ──────────────────────────────────────────────────────────────
  -- Alteracao manual em contrato e ato juridico: sem autor e hora, a pergunta "quem escreveu esta
  -- clausula?" nao tem resposta no sistema — e ela sempre e feita depois, nunca antes.
  editado_por      uuid,
  editado_por_nome text,

  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- A fila de quem esta com contrato em edicao aberta, do mais recente para o mais antigo.
create index if not exists temis_contrato_edicoes_recentes_idx
  on public.temis_contrato_edicoes (workspace_id, atualizado_em desc);

alter table public.temis_contrato_edicoes enable row level security;

comment on table public.temis_contrato_edicoes is
  'O contrato alterado a mao e ainda nao emitido: uma linha por proposta. O historico e hercules_documentos, onde cada geracao vira versao.';
comment on column public.temis_contrato_edicoes.base_impressao is
  'sha-256 do HTML montado pela minuta quando a edicao comecou: e o que permite avisar que o cadastro mudou depois.';
comment on column public.temis_contrato_edicoes.html is
  'HTML ja faxinado no servidor (lib/temis/contrato-editado.ts). Nunca gravar aqui o texto cru que veio do navegador.';
