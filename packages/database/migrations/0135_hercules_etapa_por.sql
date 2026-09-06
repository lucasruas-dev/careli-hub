-- 0135 · QUEM MOVEU A VENDA, NA PRÓPRIA PROPOSTA
--
-- Lucas (06/09/2026), olhando o evento "Enviada para contrato" que a 0134 fez aparecer no histórico
-- do lote: *"faltou a informação de quem"*.
--
-- ⚠️ ELE ESTÁ CERTO, E O ARGUMENTO ANTERIOR ERA MEIA VERDADE. Eu tinha escrito no código que "a
-- etapa guarda QUANDO, não QUEM" — o que era fato, e a resposta certa não era aceitar o fato: era
-- passar a guardar. Reaproveitar `criado_por_nome` continua fora de questão (ele é de quem GEROU a
-- proposta; afirmar que essa pessoa moveu a venda é outra coisa, e o histórico é onde essa frase
-- seria lida como prova), mas a transição sabe quem clicou.
--
-- ⚠️ POR QUE NA PROPOSTA E NÃO SÓ EM `hercules_proposta_etapas`. A linha de movimento também guarda
-- o autor, e ela é a melhor fonte quando existe — traz motivo e observação junto. Só que ela é um
-- `insert` À PARTE que, por decisão nossa, não derruba a transição quando falha: foi exatamente
-- assim que as duas vendas de 05/09 (COD 000005 e 000006) ficaram no histórico sem "por quem".
-- Este carimbo anda na MESMA escrita da etapa — ou os dois vão, ou nenhum vai.

alter table public.hercules_propostas
  add column if not exists etapa_por text;

comment on column public.hercules_propostas.etapa_por is
  'Quem moveu a venda para a etapa atual. Nao confundir com criado_por_nome, que e de quem gerou a proposta.';
