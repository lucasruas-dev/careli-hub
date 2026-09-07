-- 0137 · QUEM ESCREVEU A MINUTA, E QUEM MEXEU POR ÚLTIMO
--
-- Lucas (07/09/2026), olhando a lista de minutas do JDG: *"temos que ter o botão de editar,
-- excluir e trazer quem foi a pessoa que editou, criou por último"*.
--
-- ⚠️ A LISTA SÓ DIZIA "alterada em 07/09/2026, 10:00". Numa minuta — o documento que o comprador
-- assina — a data sozinha não responde a pergunta que se faz quando algo sai errado: QUEM mudou.
-- E a resposta existia pela metade no banco: `criado_por` e `publicada_por` guardam um uuid desde a
-- 0113, ninguém nunca os preencheu, e uuid não é nome.
--
-- ⚠️ POR ISSO O CAMPO GUARDA O NOME, e não uma chave estrangeira. É o padrão que o Hércules já usa
-- (`criado_por_nome`, `cancelada_por_nome`, `etapa_por`) e a razão é a mesma: a linha precisa
-- responder sozinha, anos depois, mesmo que a pessoa saia da empresa e o cadastro dela mude de
-- nome ou desapareça. Um join que não encontra ninguém transforma a autoria em traço.
--
-- ⚠️ E SÃO DOIS CAMPOS, NÃO UM. Quem CRIOU a minuta e quem a alterou por ÚLTIMO costumam ser
-- pessoas diferentes — é exatamente o caso da minuta que o jurídico redige e o coordenador ajusta.
-- Guardar só o último apagaria a origem do documento a cada salvamento.

alter table public.temis_minutas
  add column if not exists criado_por_nome     text,
  add column if not exists atualizado_por_nome text;

comment on column public.temis_minutas.criado_por_nome is
  'Quem criou a minuta. Nome, e nao FK: a linha responde sozinha anos depois.';
comment on column public.temis_minutas.atualizado_por_nome is
  'Quem salvou por ultimo. Diferente de criado_por_nome: o juridico redige, o coordenador ajusta.';
