import { APOLO_DOCS_BUCKET } from "@/lib/apolo/documentos";
import { createApoloAdminClient } from "@/lib/apolo/server";

import { type DocumentoDoLsoft, LSOFT_DOC_MAX_BYTES, LSOFT_DOC_MAX_LABEL } from "./documentos-tipos";

// DOCUMENTOS DO CLIENTE DO LSOFT.
//
// Pedido do Lucas (19/08/2026): "deixar aba para subir documentação".
//
// A base do LSoft veio de um Access sem anexo nenhum: o que existe de documento desses 237 clientes
// está em papel ou na máquina de alguém do CER. Como são eles que validam a base antes de ela subir
// para o C2X e o Apolo, o lugar de juntar o documento é a mesma ficha onde o dado está sendo
// corrigido.
//
// ⚠️ O UPLOAD É DIRETO DO NAVEGADOR PARA O STORAGE, em duas etapas: o servidor assina a permissão
// de gravar UM caminho (requisição pequena, sem bytes), o navegador manda o arquivo para o Supabase
// e devolve só o CAMINHO, que o servidor registra. Mandar o binário em base64 dentro do JSON
// estoura o limite de 4,5MB da Vercel e devolve 413 sem explicação nenhuma — foi o que aconteceu
// com o CAD e não se repete aqui.
//
// ⚠️ O CAMINHO QUE VOLTA DO NAVEGADOR NÃO É CONFIÁVEL. Ele é conferido contra o prefixo do próprio
// cliente antes de virar linha: sem isso, um caminho forjado registraria como documento do cliente
// A um arquivo que está na pasta do cliente B, e a abertura (que confere pela LINHA) entregaria o
// documento errado com toda a aparência de estar certo.
//
// ⚠️ REMOVER APAGA O BINÁRIO E GUARDA O RASTRO. A linha fica com quem removeu e quando; o objeto
// sai do bucket. Documento de pessoa física mantido "por via das dúvidas" depois de removido é
// passivo, não é histórico.

/** Bucket compartilhado com o Apolo: privado, com URL assinada, backup e política já resolvidos. */
const BUCKET = APOLO_DOCS_BUCKET;

/** Validade da URL de leitura. Curta de propósito: o link abre o documento de uma pessoa física. */
const URL_TTL = 60 * 10; // 10 min

// As constantes e o tipo vivem no arquivo IRMÃO, sem import nenhum, porque a tela precisa deles e
// este módulo carrega a service role do Supabase. Reexportados aqui para quem já importa daqui.
export {
  CATEGORIAS_SUGERIDAS,
  type DocumentoDoLsoft,
  LSOFT_DOC_MAX_BYTES,
  LSOFT_DOC_MAX_LABEL,
} from "./documentos-tipos";

type LinhaDoBanco = {
  categoria: null | string;
  criado_em: string;
  enviado_origem: null | string;
  enviado_por: null | string;
  id: string;
  mime_type: null | string;
  nome_arquivo: string;
  observacao: null | string;
  tamanho_bytes: null | number;
};

function mapear(linha: LinhaDoBanco): DocumentoDoLsoft {
  return {
    categoria: linha.categoria,
    criadoEm: linha.criado_em,
    enviadoOrigem: linha.enviado_origem ?? "interno",
    enviadoPor: linha.enviado_por ?? "",
    id: linha.id,
    mimeType: linha.mime_type,
    nomeArquivo: linha.nome_arquivo,
    observacao: linha.observacao,
    tamanhoBytes: linha.tamanho_bytes === null ? null : Number(linha.tamanho_bytes),
  };
}

/**
 * O nome, seguro para virar caminho no bucket.
 *
 * O acento sai por `\p{Diacritic}`, e não por uma faixa de caracteres combinantes escrita à mão:
 * aqueles caracteres são invisíveis no editor, e um deles perdido numa cópia viraria um regex
 * silenciosamente diferente. O passo importa: sem ele "coração.pdf" viraria "cora-a-o.pdf" na
 * linha seguinte, em vez de "coracao.pdf".
 */
function sanitizar(nome: string): string {
  return (
    String(nome)
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "")
      .replace(/[^a-zA-Z0-9._-]/g, "-")
      // Ponto duplo colapsa: sem isto, "../.." sobrevive à troca de barras como "..-.." e continua
      // carregando o `..` que a validação de caminho procura. Melhor não deixá-lo nascer.
      .replace(/\.{2,}/g, ".")
      .replace(/-+/g, "-")
      .slice(0, 120) || "arquivo"
  );
}

/**
 * A pasta deste cliente dentro do bucket.
 *
 * O código do LSoft entra sanitizado: ele é chave natural vinda de um Access de 1990 e não há
 * garantia de que seja sempre `00000521`. Um código com `..` viraria caminho para fora da pasta.
 */
function prefixoDoCliente(codigo: string): string {
  return `lsoft/${sanitizar(codigo)}/`;
}

/** O caminho que o navegador devolveu é mesmo um caminho DESTE cliente? */
export function caminhoDoClienteValido(caminho: string, codigo: string): boolean {
  const limpo = String(caminho ?? "").trim();
  if (!limpo || limpo.includes("..")) return false;
  return limpo.startsWith(prefixoDoCliente(codigo));
}

/** Os documentos vivos deste cliente, do mais novo para o mais antigo. */
export async function listarDocumentosDoLsoft(
  codigo: string,
): Promise<{ documentos: DocumentoDoLsoft[]; ok: true } | { erro: string; ok: false }> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  const { data, error } = await admin
    .from("lsoft_documentos")
    .select(
      "id, categoria, observacao, nome_arquivo, mime_type, tamanho_bytes, enviado_por, enviado_origem, criado_em",
    )
    .eq("cliente_codigo", codigo)
    .is("removido_em", null)
    .order("criado_em", { ascending: false });

  if (error) return { erro: error.message, ok: false };

  return { documentos: ((data ?? []) as LinhaDoBanco[]).map(mapear), ok: true };
}

/**
 * Etapa 1 do envio: assina a permissão de gravar UM arquivo na pasta deste cliente.
 *
 * Não recebe bytes — é uma requisição pequena, que passa longe do limite de corpo da Vercel.
 */
export async function prepararUploadDoLsoft(args: {
  codigo: string;
  nomeArquivo: string;
  /** O tamanho que o navegador diz ter. Ver a checagem abaixo. */
  tamanhoBytes?: null | number;
}): Promise<
  { bucket: string; caminho: string; ok: true; token: string } | { erro: string; ok: false }
> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  // ⚠️ O TAMANHO É CONFERIDO AQUI, ANTES DE ASSINAR. O bucket `apolo-documents` não tem teto
  // próprio (conferido em 19/08/2026: `file_size_limit: null`), então sem esta linha um arquivo
  // grande subiria inteiro e só seria recusado no REGISTRO — e o objeto ficaria no bucket sem
  // nenhuma ficha apontando para ele. Recusar antes da assinatura é o que evita o órfão.
  //
  // O número vem do navegador e pode ser mentira; por isso o registro confere de novo. Esta
  // checagem resolve o caso honesto (a pessoa escolheu um arquivo grande demais), que é o que
  // acontece de verdade.
  if (args.tamanhoBytes != null && args.tamanhoBytes > LSOFT_DOC_MAX_BYTES) {
    return { erro: `Cada documento pode ter até ${LSOFT_DOC_MAX_LABEL}.`, ok: false };
  }

  // O cliente precisa existir: assinar upload para um código inventado encheria o bucket de
  // arquivo órfão que nenhuma ficha mostra.
  const { data: cliente, error: erroCliente } = await admin
    .from("lsoft_clientes")
    .select("codigo")
    .eq("codigo", args.codigo)
    .maybeSingle();

  if (erroCliente) return { erro: erroCliente.message, ok: false };
  if (!cliente) return { erro: "Cliente não encontrado.", ok: false };

  const caminho = `${prefixoDoCliente(args.codigo)}${crypto.randomUUID()}-${sanitizar(args.nomeArquivo)}`;
  const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(caminho);

  if (error || !data) {
    return { erro: error?.message ?? "Não foi possível preparar o envio.", ok: false };
  }

  // O bucket volta junto porque quem grava é o NAVEGADOR, e ele não pode importar a constante:
  // ela mora em `lib/apolo/documentos.ts`, que carrega o cliente admin do Supabase.
  return { bucket: BUCKET, caminho: data.path, ok: true, token: data.token };
}

/**
 * Etapa 2 do envio: o arquivo já está no bucket, registra a linha.
 *
 * ⚠️ CONFERE O CAMINHO ANTES DE GRAVAR. É a única defesa contra um caminho forjado apontando para a
 * pasta de outro cliente — a abertura confia na linha, então quem mente aqui é quem manda depois.
 */
export async function registrarDocumentoDoLsoft(args: {
  autor: string;
  autorOrigem?: "incorporador" | "interno";
  caminho: string;
  categoria?: null | string;
  codigo: string;
  mimeType?: null | string;
  nomeArquivo: string;
  observacao?: null | string;
  tamanhoBytes?: null | number;
}): Promise<{ documento: DocumentoDoLsoft; ok: true } | { erro: string; ok: false }> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  if (!caminhoDoClienteValido(args.caminho, args.codigo)) {
    return { erro: "Caminho do arquivo inválido.", ok: false };
  }

  if (args.tamanhoBytes != null && args.tamanhoBytes > LSOFT_DOC_MAX_BYTES) {
    return { erro: `Cada documento pode ter até ${LSOFT_DOC_MAX_LABEL}.`, ok: false };
  }

  const { data, error } = await admin
    .from("lsoft_documentos")
    .insert({
      categoria: args.categoria?.trim() || null,
      cliente_codigo: args.codigo,
      enviado_origem: args.autorOrigem ?? "interno",
      enviado_por: args.autor,
      mime_type: args.mimeType ?? null,
      nome_arquivo: args.nomeArquivo,
      observacao: args.observacao?.trim() || null,
      storage_bucket: BUCKET,
      storage_path: args.caminho,
      tamanho_bytes: args.tamanhoBytes ?? null,
    })
    .select(
      "id, categoria, observacao, nome_arquivo, mime_type, tamanho_bytes, enviado_por, enviado_origem, criado_em",
    )
    .maybeSingle();

  if (error) return { erro: error.message, ok: false };
  if (!data) return { erro: "Não foi possível registrar o documento.", ok: false };

  return { documento: mapear(data as LinhaDoBanco), ok: true };
}

/**
 * URL assinada para abrir um documento.
 *
 * ⚠️ O CÓDIGO DO CLIENTE É EXIGIDO E CONFERIDO. Quem chama já provou que pode ver AQUELE cliente;
 * sem esta conferência, um id de documento de outro cliente abriria normalmente, porque a permissão
 * foi dada para a ficha e não para o arquivo.
 */
export async function abrirDocumentoDoLsoft(args: {
  codigo: string;
  id: string;
}): Promise<{ nome: string; ok: true; url: string } | { erro: string; ok: false }> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  const { data, error } = await admin
    .from("lsoft_documentos")
    .select("nome_arquivo, storage_bucket, storage_path, cliente_codigo, removido_em")
    .eq("id", args.id)
    .eq("cliente_codigo", args.codigo)
    .is("removido_em", null)
    .maybeSingle();

  if (error) return { erro: error.message, ok: false };
  if (!data) return { erro: "Documento não encontrado.", ok: false };

  const linha = data as {
    nome_arquivo: string;
    storage_bucket: null | string;
    storage_path: string;
  };

  const assinada = await admin.storage
    .from(linha.storage_bucket ?? BUCKET)
    .createSignedUrl(linha.storage_path, URL_TTL);

  if (assinada.error || !assinada.data) {
    return { erro: assinada.error?.message ?? "Não foi possível abrir o documento.", ok: false };
  }

  return { nome: linha.nome_arquivo, ok: true, url: assinada.data.signedUrl };
}

/** Marca o documento como removido e apaga o arquivo do bucket. */
export async function removerDocumentoDoLsoft(args: {
  autor: string;
  codigo: string;
  id: string;
}): Promise<{ ok: true } | { erro: string; ok: false }> {
  const admin = createApoloAdminClient();
  if (!admin) return { erro: "Supabase indisponível.", ok: false };

  const { data, error } = await admin
    .from("lsoft_documentos")
    .select("storage_bucket, storage_path")
    .eq("id", args.id)
    .eq("cliente_codigo", args.codigo)
    .is("removido_em", null)
    .maybeSingle();

  if (error) return { erro: error.message, ok: false };
  if (!data) return { erro: "Documento não encontrado.", ok: false };

  const linha = data as { storage_bucket: null | string; storage_path: string };

  // A LINHA PRIMEIRO. Se o storage falhar depois, sobra um objeto órfão que ninguém alcança; na
  // ordem inversa, o arquivo sumiria com a ficha ainda oferecendo o botão de abrir.
  const { error: erroMarca } = await admin
    .from("lsoft_documentos")
    .update({ removido_em: new Date().toISOString(), removido_por: args.autor })
    .eq("id", args.id);

  if (erroMarca) return { erro: erroMarca.message, ok: false };

  await admin.storage.from(linha.storage_bucket ?? BUCKET).remove([linha.storage_path]);

  return { ok: true };
}
