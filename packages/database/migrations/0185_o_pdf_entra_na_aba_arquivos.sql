-- O PDF ENTRA NA ABA ARQUIVOS DO PRODUTO.
--
-- Lucas (22/09/2026), com a apresentação do Garden Resort na mão: *"tem uma apresentação também
-- sobe ela"* e, escolhendo a forma, *"um arquivo só: o PDF"*. A aba nasceu (0169) para foto e
-- vídeo, que é o que o corretor mostra na frente do cliente; a apresentação comercial é a terceira
-- peça dessa mesma conversa, e hoje ela vive no WhatsApp de cada um.
--
-- ATENCAO 1: `documento` É UM TIPO NOVO, E NÃO UM "OUTRO". O `tipo` decide o que a tela desenha
-- (grade, selo, visualizador) e o que o `registrar` confere. Um balde genérico obrigaria cada
-- leitor a perguntar "mas documento de quê?" pela extensão, que é exatamente a pergunta que o
-- `tipo` existe para não fazer.
--
-- ATENCAO 2: A LISTA DE MIMES DO BUCKET É A MESMA RÉGUA, e precisa andar junto. Ela é a segunda
-- camada: o `preparar` recusa pelo código, e o Storage recusa de novo na hora de gravar. Sem
-- acrescentar `application/pdf` ali, a permissão assinada sairia e a gravação falharia com um erro
-- que não diz nada a quem está na tela.
--
-- ATENCAO 3: O TETO DE TAMANHO NÃO MUDA. O bucket já aceita 500 MB por objeto (0169), e o limite de
-- cada tipo mora no código (`LIMITE_EM_BYTES`), onde a mensagem de recusa é escrita em português.
-- A apresentação que motivou isto tem 124 MB, com 70 páginas de render.
--
-- ATENCAO 4: A MINIATURA DO PDF É A PRIMEIRA PÁGINA, gerada por quem envia (o navegador, ou o
-- script da carga). A coluna já existe e é opcional: sem ela a grade mostra o selo do tipo, como já
-- faz com o HEIC que o Chrome não desenha.

alter table public.apolo_empreendimento_arquivos
  drop constraint if exists apolo_empreendimento_arquivos_tipo;

alter table public.apolo_empreendimento_arquivos
  add constraint apolo_empreendimento_arquivos_tipo
  check (tipo in ('documento', 'imagem', 'video'));

comment on column public.apolo_empreendimento_arquivos.tipo is
  'imagem | video | documento. Decide o que a tela desenha e como o visualizador abre. `documento` '
  'entrou em 22/09/2026 para a apresentacao comercial em PDF.';

-- A segunda camada: o Storage tambem precisa deixar passar.
update storage.buckets
   set allowed_mime_types = array(
     select distinct unnest(coalesce(allowed_mime_types, array[]::text[]) || array['application/pdf'])
   )
 where id = 'produto-arquivos'
   and not ('application/pdf' = any(coalesce(allowed_mime_types, array[]::text[])));
