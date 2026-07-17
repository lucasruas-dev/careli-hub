-- Apolo: 'prospect' vira PAPEL de 1a classe em apolo_entity_profiles.
--
-- Modelo (direcao do Lucas 16/jul): a entidade (PF/PJ) nasce SEMPRE de um papel e ACUMULA
-- papeis -- a mesma entidade pode ser "corretor + prospect" (o corretor que resolve comprar um
-- lote roda o processo de prospect sem deixar de ser corretor). Ate aqui 'prospect' era so um
-- estado derivado (quem nao tem carteira); agora precisa existir como papel explicito, ao lado
-- de imobiliaria/corretor/fornecedor, para poder ser gravado e acumulado.
--
-- Nao aplicar sem autorizacao expressa do Lucas (regra-mae: migration = operacao sensivel).

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
      'prospect'
    )
  );
