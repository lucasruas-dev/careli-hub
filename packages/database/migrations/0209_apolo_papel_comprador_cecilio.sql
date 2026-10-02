-- 0209 · O PAPEL "COMPRADOR CECÍLIO" NO APOLO
--
-- ⛔ NÃO APLICADA. Escrita em 02/10/2026 e PARADA de propósito: aplicar migration exige OK explícito
-- do Lucas, a cada vez (regra-mãe do CLAUDE.md).
--
-- O NÚMERO: nasceu 0206 e foi renumerada para 0209 no mesmo dia, porque a frente pan-124-completo já usa
-- 0206 a 0208 (e a da certidão de nascimento, 0208). Quem integrar confere de novo antes de aplicar.
--
-- POR QUE ELA EXISTE. Lucas, 02/10/2026: *"vamos criar dentro do apolo um perfil comprador cecilio e
-- vamos cria-los com os dados que temos. segue a mesma estrutura, só que não vamos ter todos os dados.
-- O principal objetivo é o time conseguir fazer contato para realizar cobrança."*
--
-- Sem ela, a carga dos clientes da Cecílio (scripts/apolo/importar-compradores-cecilio.mjs) recusa na
-- primeira linha de `apolo_entity_profiles`: o CHECK só aceita os 11 papéis abaixo, e o papel novo não
-- está entre eles. Medido em 02/10/2026 em produção (bxgukywoxgivlrhjkwjx): a definição viva é a da
-- migration 0051, com exatamente esses 11 valores.
--
-- ATENCAO 1: É UM PAPEL GRAVADO, E NÃO O "COMPRADOR" DO APOLO. O "Comprador" e o "Prospect" do CRM não
-- existem no banco: são calculados da carteira do C2X (`buyerStatusLabel` exige o papel 'usuario' e a
-- carteira do legado). A Cecílio não tem vínculo nenhum com o C2X (Lucas, 29/09/2026: *"esquece o c2x,
-- cecilio não tem nenhum vinculo com o legado c2x"*). Reaproveitar 'usuario' faria o cliente aparecer
-- como Prospect e, forçado a Comprador, ganhar o selo verde "Adimplente" estando em atraso, porque o
-- financeiro do C2X chega zerado para ele.
--
-- ATENCAO 2: ORDEM DE ENTREGA LIVRE ENTRE ESTA MIGRATION E O CÓDIGO. Nenhum caminho do app grava o papel
-- novo; só a carga grava. O código no ar sem a migration apenas não encontra ninguém no filtro
-- "Comprador Cecílio"; a migration sem o código deixa o papel aceito e sem uso. O que NÃO pode é a
-- CARGA rodar antes das duas: a trava da Cacá (cliente da Cecílio vai direto para um analista) mora no
-- código, e sem ela a Cacá responderia "sem carteira" para quem está devendo.
--
-- ATENCAO 3: IDEMPOTENTE. `drop constraint if exists` antes do `add`, como a 0051. Rodar duas vezes deixa
-- o mesmo CHECK. Nenhuma linha existente é tocada, e todas continuam válidas (o conjunto só cresceu).

alter table public.apolo_entity_profiles
  drop constraint if exists apolo_entity_profiles_profile_check;

alter table public.apolo_entity_profiles
  add constraint apolo_entity_profiles_profile_check check (
    profile in (
      'usuario',
      'incorporador',
      'imobiliaria',
      'corretor',
      'fornecedor',
      'parceiro',
      'colaborador',
      'acesso_incorporador',
      'pessoa_fisica',
      'pessoa_juridica',
      'prospect',
      'comprador_cecilio'
    )
  );

comment on constraint apolo_entity_profiles_profile_check on public.apolo_entity_profiles is
  'Papeis aceitos. comprador_cecilio (0209, 02/10/2026) = cliente da carteira Cecilio Rocha, carregado do LSoft e dos boletos; papel GRAVADO, sem vinculo com o C2X e sem o Comprador calculado da carteira do legado.';
