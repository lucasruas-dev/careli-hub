-- AS TESTEMUNHAS DO CONTRATO: o único papel que se digita.
--
-- POR QUE ELA EXISTE. Lucas, 13/09/2026, fechando o desenho dos sete papéis: *"comprador vem do
-- sistema, conjuge também, vendedora vem do panteon (incorporadora), coordenadora vem do panteon,
-- corretor/imobiliaria vem do panteon, testemunha que podemos cadastrar manualmente, eu clico e
-- cadastro as testemunha"*. E, logo depois: *"mesmo desligado, eu tenho que cadastrar as
-- testemunha"*.
--
-- ATENCAO 1: O CADASTRO NÃO PERTENCE À ORDEM DE ASSINATURA, e essa frase do Lucas é a razão desta
-- tabela existir separada. O card "Assinam em ordem" decide se um papel espera o anterior; quando
-- ele está DESLIGADO — que é como os contratos saem hoje — a lista inteira fica apagada na tela. A
-- testemunha, porém, precisa existir dos dois jeitos: sem ela o contrato é impresso com a linha de
-- assinatura vazia, e o cartório devolve. Pendurar o cadastro dentro daquele card faria o campo
-- sumir exatamente na configuração que está em uso.
--
-- ATENCAO 2: ESTE É O ÚNICO PAPEL QUE SE DIGITA, E ISSO É SEGURO — mas só aqui. A regra da casa em
-- `lib/assinatura/signatarios.ts` é dura: *"isto não é um formulário"*, porque digitar o COMPRADOR
-- abriria a porta para o contrato dizer "Henrique Sales do Vale, CPF 999.999.004-53" e o envelope
-- ir para outra pessoa — defeito que só apareceria meses depois, comparando o PDF assinado com o
-- cadastro. A testemunha é diferente em espécie: ela NÃO é qualificada no corpo do contrato, só
-- assina. Não há um segundo lugar com o nome dela para divergir do envelope.
--
-- ATENCAO 3: POR EMPREENDIMENTO, como a faixa de prazo (0155) e a coordenadora (0145). Testemunha
-- costuma ser gente da casa e repete contrato após contrato; um cadastro global obrigaria o mesmo
-- par a assinar loteamento que não acompanham, e um cadastro por CONTRATO faria alguém digitar os
-- mesmos dois nomes em toda venda. A cópia entre empreendimentos é da tela, não herança do banco —
-- mesma decisão da faixa.
--
-- ATENCAO 4: A POSIÇÃO EXISTE PORQUE O CONTRATO NUMERA. A minuta imprime a linha de cada
-- testemunha, e é a posição que amarra a linha impressa à pessoa que assina. Ela NÃO nasce da ordem
-- de cadastro pelo mesmo motivo do anexo (0156): cadastrar uma terceira testemunha não pode
-- reordenar as duas que as minutas publicadas já citam.
--
-- ATENCAO 5: `entity_id` É OPCIONAL, E ISSO É PROPOSITAL. Quando a testemunha já existe no Apolo, a
-- coluna aponta a ficha e o nome vem de lá — é a regra da casa de não abrir uma segunda verdade
-- sobre a mesma pessoa. Quando ela não existe, os campos digitados bastam: exigir uma CAD para quem
-- só assina como testemunha travaria o cadastro por um processo que não tem nada a ver com isso.
-- Sem FK, pelo mesmo motivo da 0145: `apolo_entities` recebe merge e arquivamento, e uma FK rígida
-- transformaria limpeza de cadastro em erro de gravação numa tela que não tem relação com isso.
--
-- ATENCAO 6: SEM CPF NÃO SE ASSINA, mas o banco aceita. A Clicksign exige CPF formatado no
-- signatário e `conferirSignatarios` recusa quem não tem e-mail — as duas travas vivem no envio,
-- onde a mensagem pode dizer de QUEM é a falta. Recusar aqui impediria o operador de deixar o
-- cadastro meio pronto enquanto corre atrás do documento da pessoa.
--
-- Autorização do Lucas: PENDENTE — escrita, esperando o OK para aplicar.

create table if not exists public.temis_testemunhas (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null default 'careli',
  -- Texto porque é assim que o resto da Têmis guarda (o id do C2X como string).
  enterprise_id text not null,

  -- A posição que a minuta cita e que numera a linha impressa. Ver ATENCAO 4.
  posicao integer not null,

  -- ⚠️ QUANDO ELA ASSINA — E ISSO NÃO É A POSIÇÃO. Lucas, 13/09/2026: *"dentro das testemunha eu
  -- posso colocar uma testemunha assina na ordem 1 e outra na ordem 4"*. São duas perguntas
  -- diferentes sobre a mesma pessoa: `posicao` diz QUAL LINHA do contrato é dela (ANEXO/TESTEMUNHA
  -- 1, 2), e `ordem_assinatura` diz QUANDO ela recebe o convite. A testemunha que assina primeiro
  -- pode perfeitamente ser a que aparece embaixo no papel.
  --
  -- ⚠️ NULO = SEGUE O PAPEL. Sem número próprio, ela entra na ordem cadastrada para "testemunha" no
  -- empreendimento. É o caso comum, e obrigar um número por pessoa faria o operador decidir uma
  -- coisa que ele não tem opinião sobre.
  --
  -- ⚠️ E O NÚMERO É CRU, não compactado. Quem fecha os buracos é `ordenarSignatarios`, na hora do
  -- envio: cadastrar 1 e 4 sai como 1 e 2 se não houver ninguém no meio. Compactar aqui perderia a
  -- folga que o operador deixou de propósito para encaixar alguém depois.
  ordem_assinatura integer,

  nome text not null,
  cpf text,
  email text,
  telefone text,

  -- A ficha do Apolo, quando a pessoa já existe lá. Ver ATENCAO 5.
  entity_id uuid,

  ativo boolean not null default true,
  observacao text,

  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  criado_por uuid,
  criado_por_nome text,

  constraint temis_testemunhas_posicao check (posicao >= 1 and posicao <= 9),
  -- O mesmo teto de `ORDEM_MAXIMA` em lib/assinatura/ordem.ts: fila de assinatura não tem 100 degraus.
  constraint temis_testemunhas_ordem check (
    ordem_assinatura is null or (ordem_assinatura >= 1 and ordem_assinatura <= 20)
  ),
  constraint temis_testemunhas_nome_preenchido check (length(btrim(nome)) > 0)
);

comment on table public.temis_testemunhas is
  'Testemunhas do contrato, por empreendimento. Único papel da assinatura que se digita: ela não e qualificada no corpo do contrato, so assina. Ver ATENCAO 2 da migration 0157.';
comment on column public.temis_testemunhas.posicao is
  'Numera a linha impressa no contrato. Escolhida no cadastro, NUNCA pela ordem de criacao.';
comment on column public.temis_testemunhas.entity_id is
  'A ficha do Apolo quando a pessoa ja existe la. Opcional de proposito, e sem FK (ver ATENCAO 5).';

create unique index if not exists temis_testemunhas_posicao_por_empreendimento
  on public.temis_testemunhas (workspace_id, enterprise_id, posicao)
  where ativo;

create index if not exists temis_testemunhas_por_empreendimento
  on public.temis_testemunhas (workspace_id, enterprise_id, posicao)
  where ativo;

-- RLS ligada e sem policy: o padrão da casa desde a 0075. Acesso só por service role.
alter table public.temis_testemunhas enable row level security;
