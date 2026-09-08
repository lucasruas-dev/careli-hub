-- 0142 — A ORDEM DE ASSINATURA: quem assina primeiro, e quem espera.
--
-- Lucas, 07/09/2026: *"eu uso bastante a ordem de assinatura, ou seja, temos que ter isso tambem —
-- de ter ou nao a ordem; se ter, eu apontar essa ordem. (nao sei onde isso ia existir) se e na
-- geracao, ou deixa fixo por empreendimento. So sei que isso hoje traz um trabalho enorme para
-- gente, pois fazemos isso de forma manual."*
--
-- O TRABALHO MANUAL NAO E DIGITAR, E LEMBRAR. Hoje alguem abre o D4Sign a cada contrato e numera os
-- signatarios um por um. Errar a ordem nao trava nada: o contrato sai, o cliente assina antes da
-- vendedora, e so se descobre quando o juridico confere.
--
-- ── ONDE A REGRA MORA ────────────────────────────────────────────────────────
--
-- Na CATEGORIA, com queda para o empreendimento — a MESMA cadeia da minuta (0140) e da vendedora
-- (0141), e isso e de proposito: sao tres decisoes do mesmo recorte, e um recorte que assina com
-- outra vendedora costuma assinar em outra ordem.
--
--     unidade -> categoria -> regra de ordem            o recorte que assina diferente
--              \ sem categoria -> o empreendimento      o caso de todo dia
--
-- ATENCAO 1: POR QUE NAO NA GERACAO, que foi a outra hipotese do Lucas. Porque na geracao a pergunta
-- volta a cada contrato, e e exatamente ai que se erra por pressa. A ordem de assinatura de um
-- produto nao muda de venda para venda: ela muda quando o incorporador muda de politica — e ai muda
-- para todos os contratos daquele produto de uma vez, que e o comportamento certo.
--
-- ATENCAO 2: A REGRA E POR PAPEL, NAO POR PESSOA. Quem assina muda a cada venda (outro comprador,
-- outro conjuge, as vezes tres compradores); o que NAO muda e "a vendedora assina depois dos
-- compradores". Uma lista de pessoas envelheceria no primeiro contrato; uma de papeis vale para a
-- carteira inteira. Os papeis validos vivem em `lib/assinatura/tipos.ts` (PAPEIS) — o banco guarda
-- os nomes, e `lerRegraDeOrdem` descarta o que o codigo nao conhece mais em vez de recusar a regra.
--
-- ATENCAO 3: `assinatura_ordenada` NASCE FALSA, e isso e uma decisao, nao um default preguicoso.
-- Ligar a ordem na carteira inteira mudaria o comportamento de contratos que hoje saem em paralelo,
-- sem ninguem ter pedido — e o sintoma seria contrato "parado" esperando alguem que antes assinava
-- a qualquer hora. Quem quiser ordem liga por empreendimento, olhando.
--
-- ATENCAO 4: `assinatura_ordem` NULA E O ESTADO NORMAL. Nula = usa a ordem padrao da casa
-- (comprador -> conjuge -> vendedora -> coordenadora -> corretor -> testemunha -> interveniente),
-- que e a que o Lucas faz hoje na mao. So quem precisa de ordem DIFERENTE grava alguma coisa.

-- ── A regra do recorte ───────────────────────────────────────────────────────
alter table public.temis_categorias
  add column if not exists assinatura_ordenada boolean not null default false,
  add column if not exists assinatura_ordem    jsonb;

comment on column public.temis_categorias.assinatura_ordenada is
  'true = os signatarios assinam em ordem; false = todos ao mesmo tempo (o padrao de hoje).';

comment on column public.temis_categorias.assinatura_ordem is
  'Lista de papeis do primeiro ao ultimo, ex.: ["comprador","conjuge","vendedora","testemunha"]. Nula = ordem padrao da casa. Papel ausente da lista assina por ultimo.';

-- ── A regra padrao do empreendimento ─────────────────────────────────────────
-- `apolo_enterprise_settings` e onde as outras configuracoes por empreendimento ja vivem
-- (gestao_carteira_percentual, taxa_cessao, vendedor_entity_id, os portoes de recepcao).
alter table public.apolo_enterprise_settings
  add column if not exists assinatura_ordenada boolean not null default false,
  add column if not exists assinatura_ordem    jsonb;

comment on column public.apolo_enterprise_settings.assinatura_ordenada is
  'true = os signatarios assinam em ordem; false = todos ao mesmo tempo. A categoria pode sobrepor.';

comment on column public.apolo_enterprise_settings.assinatura_ordem is
  'Lista de papeis do primeiro ao ultimo. Nula = ordem padrao da casa. A categoria pode sobrepor.';
