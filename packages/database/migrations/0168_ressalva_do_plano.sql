-- 0168 · A RESSALVA DE DISPONIBILIDADE DO PLANO
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas. O código sobe ANTES dela e tolera a
-- coluna ausente (ver ATENCAO 3): a tela de planos e as rotas continuam de pé sem esta migration.
--
-- Lucas (16/09/2026), fechando o portal da Cecílio Rocha como réplica do Hércules: os planos de
-- pagamento aparecem dentro de Produtos e continuam cadastrados pela Careli no Apolo, e ele quer
-- manter *"essa escrita no plano investidor da disponibilidade do plano"*.
--
-- A ESCRITA JÁ EXISTE, SÓ QUE CRAVADA NUM HTML. É o masterplan interno do Garden
-- (`apps/hub/masterplans-internos/garden.html`), no plano "Investidor Parcelado":
-- `ressalva:'válido para as próximas 16 unidades'`, desenhada como etiqueta âmbar ao lado do nome
-- (CSS `.of-res`). O HTML diz o motivo da cor: "chama atenção sem gritar, porque é condição de
-- validade e não erro". Fora dali, `temis_planos` não tem onde guardar essa frase, e o portal que o
-- time da Cecílio vai operar sozinho, sem o administrativo da Careli ao lado, perderia a condição
-- que decide se o plano ainda pode ser oferecido.
--
-- ATENCAO 1: É TEXTO LIVRE E NÃO UM CONTADOR. "Próximas 16 unidades" parece pedir um número que
-- desce a cada venda, mas a condição real é do comercial e muda de forma: "até 30/10", "só para
-- lotes de esquina", "enquanto durar o lançamento". Um contador automático afirmaria uma contagem
-- que ninguém conferiu, e a frase errada no portal vira venda num plano que já acabou. Quem mantém a
-- frase em dia é a Careli, no mesmo formulário em que mantém o plano.
--
-- ATENCAO 2: O LIMITE DE 80 CARACTERES É PORQUE ISTO É UMA ETIQUETA, e não uma observação. Ela
-- aparece ao lado do NOME do plano, na lista do Apolo e na ficha do produto no portal. A frase do
-- Garden tem 36 caracteres; 80 cabe uma condição com data e recorte. Texto maior que isso é
-- explicação, e explicação já tem `observacao` (que é interna e NÃO vai ao portal). O CHECK também
-- recusa a string só de espaços: etiqueta vazia desenharia um chip âmbar sem nada dentro. A rota
-- (`conferirPlano`, em `apps/hub/lib/temis/planos.ts`) apara e troca vazio por nulo antes de gravar,
-- com a mesma régua de 80, para o operador ler a mensagem em português e não o nome da constraint.
--
-- ATENCAO 3: NULO É "SEM RESSALVA", o caso de quase todo plano. Sem default e sem backfill: não há
-- frase a inventar para os planos que já existem. Enquanto esta migration não roda, as leituras
-- (`/api/temis/planos` e `/api/incorporador/produto/politicas`) repetem a consulta sem a coluna ao
-- receber 42703 ou PGRST204 citando `ressalva`, e a escrita só recusa quando alguém tenta GRAVAR uma
-- ressalva (salvar plano sem ela continua funcionando).

alter table public.temis_planos
  add column if not exists ressalva text;

alter table public.temis_planos
  drop constraint if exists temis_planos_ressalva_etiqueta;

alter table public.temis_planos
  add constraint temis_planos_ressalva_etiqueta check (
    ressalva is null
    or (char_length(ressalva) <= 80 and btrim(ressalva) <> '')
  );

comment on column public.temis_planos.ressalva is
  'Condicao de disponibilidade do plano, exibida como etiqueta ambar ao lado do nome (ex.: "valido para as proximas 16 unidades"). Texto livre mantido pela Careli, ate 80 caracteres. NULO = sem ressalva. Vai ao portal do incorporador; a observacao nao vai.';
