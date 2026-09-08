-- 0144 — A CARTEIRA DO VALE DO OURO ENTRA NO ESPELHO DO LSOFT.
--
-- Lucas, 08/09/2026: *"precisamos criar os boletos do vale do ouro desses clientes, ae quero que
-- suba igual temos as outras carteiras"*. E, sobre o nome: *"coloca como Vale do Ouro - 2, por
-- enquanto"*.
--
-- ⚠️ O NOME TEM O "- 2" DE PROPÓSITO, e é o Lucas quem o escolheu. "Vale do Ouro" já é o nome de
-- uma carteira que existe do outro lado (o VLO do C2X, hoje dividido em VOC e VOL): duas coisas
-- diferentes com o mesmo nome numa tela de cobrança é o caminho curto para alguém emitir o boleto
-- da carteira errada. O "por enquanto" fica registrado aqui — quando a organização das carteiras do
-- Vale do Ouro se resolver, este nome é um dos que muda.
--
-- ⚠️ A TRAVA CONTINUA EXISTINDO, e é por isso que ela é recriada em vez de removida. Sem CHECK,
-- uma importação com "vale do ouro" minúsculo, "VDO" ou um espaço a mais cria uma carteira FANTASMA:
-- as parcelas entram, ninguém erra, e a tela — que casa pelo nome exato — não mostra nenhuma delas.
-- O erro só aparece no mês seguinte, quando o cliente liga perguntando do boleto que não chegou.
--
-- ⚠️ E NENHUMA LINHA EXISTENTE É TOCADA: as 13.212 do Garden e as 6.776 do Vale do Sol seguem
-- válidas pela mesma regra. O que muda é só o conjunto de nomes aceitos.
--
-- DE ONDE VEM A CARTEIRA. No LSoft ela é a CATEGORIA 69, cadastrada como "Loteamento José Lino" —
-- o nome antigo do loteamento. Foi por isso que ninguém a achou antes: a documentação apontava a
-- 129 (que tem outro uso) e a extração de agosto filtrava por classe 16.3 como no Garden, enquanto
-- aqui as parcelas estão na classe 17 com subclasse vazia. São 11 clientes e 619 parcelas, e o lote
-- e a quadra saem do texto livre de `OBSERVACOES` em 100% delas.

alter table public.lsoft_parcelas
  drop constraint if exists lsoft_parcelas_empreendimento_check;

alter table public.lsoft_parcelas
  add constraint lsoft_parcelas_empreendimento_check
  check (empreendimento in ('Garden', 'Vale do Sol', 'Vale do Ouro - 2'));
