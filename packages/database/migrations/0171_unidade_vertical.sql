-- 0171 · A UNIDADE DE PRÉDIO GANHA COLUNAS PRÓPRIAS: TORRE, ANDAR, APARTAMENTO, TIPOLOGIA, VAGAS
--
-- ⚠️ ESCRITA E NÃO APLICADA. Espera OK explícito do Lucas.
--
-- ⚠️ ORDEM DE DEPLOY: DEPOIS DA 0170 E ANTES DO CÓDIGO QUE GRAVA UNIDADE VERTICAL.
--   • O SQL não depende da 0170, mas é o `tipo_produto = 'vertical'` dela que faz a tela pedir estas
--     colunas; sem ela não existe produto vertical para receber unidade.
--   • Unidade de LOTEAMENTO não depende desta migration: `linhaDaUnidadeNova`
--     (apps/hub/lib/hercules/unidade-nova.ts) não manda as colunas novas para lote, então cadastrar
--     lote funciona com ou sem a 0171.
--   • Unidade VERTICAL sem a 0171 responde 503 (`ehColunaDaUnidadeVerticalAusente`, no mesmo
--     arquivo): gravar o apartamento sem as colunas deixaria uma unidade sem nome nenhum.
--   • Aplicar antes do código é inofensivo: colunas nulas, nenhuma CHECK que as 5.541 linhas de hoje
--     possam violar, e o índice único é parcial sobre `apartamento`, nulo em todas elas.
--
-- Decisão do Lucas (16/09/2026) para o portal da Cecílio Rocha, que tem sete prédios a cadastrar
-- (Ed. Jade, Ed. Rubi, Ed. Cristal, Ed. Esmeralda, On Sky, Guaimbê, Giant Towers): prédio é coluna
-- própria na unidade mais o tipo do produto, e apartamento NUNCA é encaixado em quadra/lote.
--
-- ATENCAO 1: POR QUE NÃO USAR QUADRA E LOTE. Eles não são só colunas, são texto que circula:
-- `nomeDaUnidade` (apps/hub/lib/hercules/nome-da-unidade.ts) escreve "Quadra 03 · Lote 04" no
-- WhatsApp da reserva, no WhatsApp da proposta e no PDF; `variaveis.ts` da Têmis preenche
-- `numero_quadra` e `numero_lote` no contrato; o fluxo de venda agrupa o mapa pela quadra. O
-- apartamento 304 da torre A gravado como quadra A lote 304 sairia "Quadra A · Lote 304" no contrato
-- de um apartamento. E o CÓDIGO da unidade vertical usa hífen (JAD-A-304) justamente para não casar
-- com o padrão `^[A-Za-z]{2,4}\d{2}\d{2}$` que essas mesmas leituras usam para decompor JDG0617.
--
-- ATENCAO 2: NÃO EXISTE `area_privativa`, E ISSO É DECISÃO. No prédio, a coluna `area` que já existe
-- guarda a ÁREA PRIVATIVA. Ela é a área com que apartamento se vende e se calcula R$/m², que é
-- exatamente o papel de `area` no lote; assim todo leitor de hoje (VGV, preço por m², a CHECK
-- `area > 0`, `area_extenso`) continua certo sem um `if` por tipo. Uma coluna `area_privativa` ao
-- lado de `area` seria o mesmo fato em dois lugares, e os dois discordariam no primeiro cadastro
-- (a lição da 0163 com `bloqueio_motivo`). O que NÃO cabe em `area` (área comum, área total, fração
-- ideal do terreno, que a qualificação do imóvel na incorporação pede) fica para quando existir a
-- minuta vertical: hoje não há um único leitor para esses números.
--
-- ATENCAO 3: `andar` É INTEIRO E SEM CHECK DE FAIXA. Térreo é 0 e subsolo (garden, loja, garagem)
-- é negativo; uma faixa inventada aqui recusaria o primeiro prédio diferente. `vagas` tem CHECK
-- `>= 0` porque vaga negativa não existe em prédio nenhum. As duas CHECKs valem para as linhas
-- existentes sem varredura de risco: as colunas nascem nulas.
--
-- ATENCAO 4: O ÍNDICE ÚNICO GUARDA O FATO, NÃO A GRAFIA. O único de `codigo` (0112) já barra o mesmo
-- código duas vezes, mas código é texto: "JAD-A-304" gravado por uma tela e "JADA304" digitado por
-- outra seriam duas unidades para o mesmo apartamento, e a segunda só apareceria quando alguém
-- fosse vender. O índice sobre (empreendimento, torre, apartamento) fecha isso. Parcial em
-- `apartamento is not null`: zero linhas hoje, e loteamento nunca entra nele. `coalesce(torre, '')`
-- porque prédio de torre única grava torre nula, e nulo não colide com nulo num índice único.
-- `upper` porque "a" e "A" são a mesma torre. Zero à esquerda ("0304" × "304") é normalizado pela
-- aplicação (`validarUnidade`) antes de gravar.
--
-- ATENCAO 5: NENHUMA CHECK CRUZA O TIPO DO PRODUTO. A unidade não sabe o tipo: ele mora em
-- `hercules_empreendimentos.tipo_produto`, ligado por `enterprise_id` texto, sem FK. CHECK não lê
-- outra tabela, e um trigger que lesse travaria a carga do C2X (`carregar-unidades-do-c2x.mjs`),
-- que grava em lote. Quem garante "lote tem quadra e lote, apartamento tem andar e apartamento" é
-- `validarUnidade`, na aplicação, onde a mensagem de erro pode ser útil.

alter table public.hercules_unidades
  add column if not exists torre text,
  add column if not exists andar integer,
  add column if not exists apartamento text,
  add column if not exists tipologia text,
  add column if not exists vagas integer;

alter table public.hercules_unidades
  drop constraint if exists hercules_unidades_vagas_nao_negativas;

alter table public.hercules_unidades
  add constraint hercules_unidades_vagas_nao_negativas
  check (vagas is null or vagas >= 0);

create unique index if not exists hercules_unidades_apartamento_unico
  on public.hercules_unidades (workspace_id, enterprise_id, upper(coalesce(torre, '')), upper(apartamento))
  where apartamento is not null;

comment on column public.hercules_unidades.area is
  'Metro quadrado da área principal da unidade: a área do LOTE no loteamento, a área PRIVATIVA no prédio (tipo_produto vertical, migration 0171). Não existe coluna area_privativa de propósito.';

comment on column public.hercules_unidades.torre is
  'Torre (ou bloco) do apartamento. Nulo em prédio de torre única e em todo loteamento. Gravada sem o prefixo "Torre" (A, B, NORTE).';

comment on column public.hercules_unidades.andar is
  'Andar do apartamento. 0 = térreo, negativo = subsolo. Nulo em loteamento.';

comment on column public.hercules_unidades.apartamento is
  'Número do apartamento como se fala ("304", "1203A"), sem zero à esquerda. Preenchido = unidade de prédio; nesse caso quadra e lote ficam NULOS.';

comment on column public.hercules_unidades.tipologia is
  'Planta comercial do apartamento, texto livre ("2 quartos, 1 suíte", "Studio"). Nulo em loteamento.';

comment on column public.hercules_unidades.vagas is
  'Vagas de garagem vinculadas ao apartamento. Nulo = não informado (diferente de 0 = sem vaga).';
