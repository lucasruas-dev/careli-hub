-- 0099 · DOCUMENTOS DO CLIENTE DO LSOFT
--
-- Pedido do Lucas (19/08/2026): "deixar aba para subir documentação" e, depois, "kd a parte de
-- subir documentação".
--
-- PARA QUE SERVE. A base do LSoft veio de um Access sem nenhum anexo: o que existe de documento
-- desses 237 clientes está em papel ou na máquina de alguém do CER. Como são eles que vão validar
-- a base antes de ela subir para o C2X e o Apolo ("são eles que vão atualizar essa base para depois
-- a gente subir"), o lugar de juntar o documento é a mesma ficha onde o dado está sendo corrigido.
--
-- ⚠️ O ARQUIVO NÃO MORA AQUI. Os bytes vão para o bucket PRIVADO `apolo-documents`, o mesmo do
-- Apolo, e esta tabela guarda só o caminho e os metadados. Bucket novo significaria política de
-- acesso nova, backup novo e mais um lugar para vazar; o que já existe é privado e tem o caminho de
-- URL assinada pronto (lib/apolo/documentos.ts).
--
-- ⚠️ O UPLOAD É DIRETO PARA O STORAGE, e é por isso que o `storage_path` é a coluna central: o
-- arquivo sobe do navegador para o Supabase com URL assinada, e só o CAMINHO volta para o servidor.
-- Mandar o binário em base64 dentro do JSON estoura o limite de 4,5MB da Vercel e devolve 413 sem
-- explicação — foi o que aconteceu com o CAD (>3,3MB) e não se repete aqui.
--
-- ⚠️ REMOÇÃO DEIXA RASTRO, MAS APAGA O BINÁRIO. A linha fica com `removido_em`/`removido_por`, para
-- a trilha responder "quem tirou e quando"; o objeto sai do bucket de verdade. Documento de pessoa
-- física guardado "por via das dúvidas" depois de removido é passivo, não é histórico.

create table if not exists public.lsoft_documentos (
  id uuid primary key default gen_random_uuid(),

  -- O código do LSoft, mesma chave natural das parcelas. `cascade`: se o cliente sair da base, os
  -- documentos dele saem junto.
  cliente_codigo text not null
    references public.lsoft_clientes (codigo) on delete cascade,

  -- Livre de propósito. A tela sugere as categorias comuns (RG, CPF, comprovante de endereço,
  -- contrato, comprovante de renda), mas o CER está organizando uma base antiga e vai aparecer
  -- coisa que não cabe numa lista fechada.
  categoria text,
  observacao text,

  nome_arquivo text not null,
  mime_type text,
  tamanho_bytes bigint,

  -- Bucket na coluna, e não cravado no código: o dia em que um documento precisar de outro bucket,
  -- a linha antiga continua sabendo onde o arquivo dela está.
  storage_bucket text not null default 'apolo-documents',
  storage_path text not null,

  -- QUEM SUBIU. `origem` separa quem é da Careli de quem é do cliente, igual à trilha de edição:
  -- 'interno' (tela /lsoft) ou 'incorporador' (portal do CER).
  enviado_por text not null,
  enviado_origem text not null default 'interno',
  criado_em timestamptz not null default now(),

  removido_em timestamptz,
  removido_por text
);

-- A ficha lista os documentos de UM cliente, e sempre só os vivos.
create index if not exists lsoft_documentos_cliente_idx
  on public.lsoft_documentos (cliente_codigo, criado_em desc)
  where removido_em is null;

-- O caminho no bucket é único: duas linhas apontando para o mesmo objeto fariam a remoção de uma
-- apagar o arquivo da outra.
create unique index if not exists lsoft_documentos_storage_path_idx
  on public.lsoft_documentos (storage_path);

-- ⚠️ RLS DENY-ALL, igual às outras tabelas do LSoft. Nada aqui é lido pelo cliente anônimo: todo
-- acesso passa pelo servidor com service role, que já confere sessão e portal antes.
alter table public.lsoft_documentos enable row level security;
