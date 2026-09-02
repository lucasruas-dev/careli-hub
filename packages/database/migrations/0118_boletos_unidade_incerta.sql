-- A UNIDADE QUE NÃO PODE SER DITA AO CLIENTE.
--
-- O Garden foi renumerado, e as duas fontes de conversão do lote antigo para o novo discordam em
-- nove casos: na quadra 7 são cinco clientes deslocados um lote na mesma direção. O lote usado é o
-- do masterplan (decisão do Lucas, 02/09/2026), mas nesses nove não dá para afirmar qual é.
--
-- Marcada a parcela, o boleto sai como "Garden - Competência 09/2026", sem o lote. A unidade
-- continua sendo a chave da tabela e da referência da cobrança: o que muda é só o que o cliente lê.
-- Dizer o lote errado no boleto é pior do que não dizer lote nenhum, porque é por ele que o cliente
-- confere se a cobrança é dele.
alter table public.boletos_parcelas
  add column if not exists unidade_incerta boolean not null default false;

comment on column public.boletos_parcelas.unidade_incerta is
  'Quando true, a descrição do boleto omite a unidade — usado onde a conversão de lote é ambígua.';
