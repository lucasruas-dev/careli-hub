"use client";

// Upload DIRETO de documento do cadastro para o Supabase Storage.
//
// POR QUE EXISTE: o wizard manda os documentos em base64 DENTRO do JSON de /salvar e a Vercel
// corta o corpo da requisição em ~4,5MB ANTES de a rota rodar (o base64 ainda infla o arquivo em
// ~33%). Documento PEQUENO continua indo assim, sem mudar nada; documento GRANDE pede uma URL
// assinada (requisição minúscula, só o nome do arquivo), grava os bytes direto no Storage e manda
// no JSON apenas o caminho do arquivo já gravado.
//
// Quem autoriza a gravação é o TOKEN assinado pelo servidor, não o login do usuário — por isso o
// portal público anônimo também funciona. Mesmo padrão de lib/hub-it-tickets/attachment-upload.ts
// e da PA do Prometeu, que já rodam em produção.
import { getHubSupabaseClient } from "@/lib/supabase/client";

export type AssinaturaUpload = { bucket: string; path: string; token: string };

export type DocumentoNoStorage = { sizeBytes: number; storagePath: string };

// Base64 (com ou sem prefixo data:) de volta para bytes. O wizard já guarda o arquivo em base64
// desde a captura, então não precisamos segurar o File original em memória.
export function base64ParaBlob(valor: string, mimeType: string): Blob {
  const cru = valor.startsWith("data:") ? valor.slice(valor.indexOf(",") + 1) : valor;
  const binario = atob(cru);
  const bytes = new Uint8Array(binario.length);
  for (let index = 0; index < binario.length; index += 1) {
    bytes[index] = binario.charCodeAt(index);
  }
  return new Blob([bytes], { type: mimeType || "application/octet-stream" });
}

// Tamanho REAL do arquivo (bytes), a partir do base64. É o número que a tela mostra e o que o
// servidor confere: medir o length do base64 contaria 33% a mais e assustaria o operador à toa.
export function bytesDoBase64(valor: string | null | undefined): number {
  const cru = valor ?? "";
  if (!cru) return 0;
  const dados = cru.startsWith("data:") ? cru.length - cru.indexOf(",") - 1 : cru.length;
  return Math.max(0, Math.floor((dados * 3) / 4));
}

// Sobe UM documento e devolve o caminho gravado. Lança em falha: o documento não pode sumir em
// silêncio (a trava de obrigatórios do servidor recusaria a CAD depois, sem explicação).
export async function subirDocumentoDireto(input: {
  assinarUpload: (fileName: string) => Promise<AssinaturaUpload>;
  fileBase64: string;
  fileName: string;
  mimeType: string;
}): Promise<DocumentoNoStorage> {
  const client = getHubSupabaseClient();
  if (!client) {
    throw new Error("Envio de arquivos indisponível agora. Tente novamente em alguns instantes.");
  }

  const assinatura = await input.assinarUpload(input.fileName);
  if (!assinatura?.bucket || !assinatura?.path || !assinatura?.token) {
    throw new Error("Não foi possível preparar o envio do documento. Tente de novo.");
  }

  const blob = base64ParaBlob(input.fileBase64, input.mimeType);
  const upload = await client.storage
    .from(assinatura.bucket)
    .uploadToSignedUrl(assinatura.path, assinatura.token, blob, {
      contentType: blob.type,
    });

  if (upload.error) {
    throw new Error(
      `Não foi possível enviar o arquivo "${input.fileName}". Confira a conexão e tente de novo.`,
    );
  }

  return { sizeBytes: blob.size, storagePath: assinatura.path };
}
