-- 0199 · Qual carteira do cliente do LSoft já é lida pelo Financeiro do portal.
--
-- ⚠️ NÚMERO CONFERIDO NA HORA DE APLICAR. O 0198 foi usado em produção em 29/09/2026 por outra
-- frente (`0198_a_origem_faturamento_na_passagem`) e não está neste branch. Se, na hora de aplicar,
-- o 0199 também já existir no registro ou no repo, renumere ESTE arquivo (nunca o do outro).
--
-- O pedido do Lucas (29/09/2026): os clientes do Garden que o time adm validou com OK na planilha
-- saem da tela LSoft Integração e aparecem na carteira do Financeiro do portal cecilio-rocha; os
-- com observação ficam na integração. Nas palavras dele: *"é só copiar e colar na carteira"*, e
-- *"esquece o c2x, cecilio não tem nenhum vinculo com o legado c2x"*.
--
-- Sem esta coluna não há como dizer "este cliente já saiu da integração": a tela LSoft continuaria
-- mostrando os 106 do Garden validados, o Financeiro não saberia quais ler, e o mesmo dinheiro
-- apareceria nas duas telas (ou em nenhuma).
--
-- ATENCAO 1: É POR (CLIENTE, EMPREENDIMENTO), E NÃO UM SIM/NÃO DO CLIENTE. Medido em 29/09/2026:
-- 11 dos 106 também têm carteira no Giant Towers, On Sky, Guaimbé, Vale do Ouro ou "A classificar",
-- e essas continuam na integração para validar. Um booleano tiraria o cliente inteiro da tela.
--
-- ATENCAO 2: NÃO DUPLICA DINHEIRO. As parcelas continuam em `lsoft_parcelas` (o espelho): o
-- Financeiro lê de lá as parcelas do empreendimento listado aqui, e a baixa continua sendo dada na
-- ficha do LSoft, com trilha. Uma tabela de carteira nova seria uma segunda verdade financeira.
--
-- ATENCAO 3: NOT NULL COM DEFAULT '{}'. Sem default, todo upsert em `lsoft_clientes` que não
-- mande a coluna quebraria (o INSERT do upsert é validado antes do conflito), e a carga do LSoft
-- faz exatamente isso. Vazio = nenhuma carteira no Financeiro, que é o estado de hoje.
--
-- ATENCAO 4: A TABELA JÁ TEM RLS LIGADA E NENHUMA POLICY (conferido em 29/09/2026): só a service
-- role lê e escreve. Nada muda nisso aqui.
--
-- Quem escreve: `scripts/carteira/subir-garden-para-carteira.mjs --gravar` (e `--desfazer`).

alter table public.lsoft_clientes
  add column if not exists empreendimentos_na_carteira text[] not null default '{}';

comment on column public.lsoft_clientes.empreendimentos_na_carteira is
  'Empreendimentos cuja carteira deste cliente ja e lida pelo Financeiro do portal e saiu da tela LSoft Integracao. Por (cliente, empreendimento): as outras carteiras do cliente seguem na integracao. As parcelas continuam em lsoft_parcelas (nao ha copia) e a baixa segue na ficha do LSoft. Pedido do Lucas, 29/09/2026: "e so copiar e colar na carteira".';
