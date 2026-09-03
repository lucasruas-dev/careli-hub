"use client";

import * as React from "react";

import { toast } from "sonner";

import { getApoloAccessToken } from "@/modules/apolo/data/apolo-operations";
import { getHubSupabaseClient } from "@/lib/supabase/client";
import {
  ehTipoAceitoMidia,
  getMinutaAtualParaUpload,
  LIMITE_MIDIA_BYTES,
  LIMITE_MIDIA_ROTULO,
  type MidiaConfirmada,
  type PedidoDeUploadMidia,
  type UrlAssinadaDeUpload,
} from "@/lib/temis/upload-midia";

// Upload de mídia do editor de minutas (Têmis). REESCRITO por cima do `use-upload-file` que o
// registro do Plate gera junto com `media-placeholder-node` (aquele usa UploadThing e, em erro,
// SIMULAVA o upload com `URL.createObjectURL` — a mídia "subia" e o nó ficava com uma URL de
// blob que morre ao recarregar a página).
//
// Mesmo contrato que o `media-placeholder-node.tsx` (de `components/ui`, que não editamos) espera:
//   useUploadFile({ onUploadComplete?, onUploadError?, onUploadBegin?, onUploadProgress? })
//     → { isUploading, progress, uploadedFile, uploadingFile, uploadFile }
//
// Caminho dos bytes (3 passos, o arquivo NUNCA passa pela function da Vercel — teto de ~4,5MB):
//   1. POST /api/temis/minutas/upload  (Bearer) → { bucket, path, token }   URL assinada de upload
//   2. storage.uploadToSignedUrl(path, token, file)                          bytes direto no Storage
//   3. PATCH /api/temis/minutas/upload (Bearer) { path } → { url, ... }     confere tamanho, assina leitura
// A `url` devolvida é a que fica gravada no nó do documento (signed URL de leitura com TTL longo).
//
// ⚠️ O SDK do Supabase não reporta progresso do `uploadToSignedUrl`: a barra vai 0 → 90 (ao pedir
// a URL) → 100 (ao confirmar). É honesto o suficiente para o usuário saber que está andando.

export type UploadedFile = {
  key: string;
  name: string;
  size: number;
  type: string;
  url: string;
};

type UseUploadFileProps = {
  onUploadBegin?: (fileName: string) => void;
  onUploadComplete?: (file: UploadedFile) => void;
  onUploadError?: (error: unknown) => void;
  onUploadProgress?: (progress: { file: File; progress: number }) => void;
};

const ROTA = "/api/temis/minutas/upload";

export function useUploadFile({
  onUploadBegin,
  onUploadComplete,
  onUploadError,
  onUploadProgress,
}: UseUploadFileProps = {}) {
  const [uploadedFile, setUploadedFile] = React.useState<UploadedFile>();
  const [uploadingFile, setUploadingFile] = React.useState<File>();
  const [progress, setProgress] = React.useState<number>(0);
  const [isUploading, setIsUploading] = React.useState(false);

  async function uploadFile(file: File): Promise<UploadedFile | undefined> {
    setIsUploading(true);
    setUploadingFile(file);
    setProgress(0);

    const avancar = (valor: number) => {
      setProgress(valor);
      onUploadProgress?.({ file, progress: valor });
    };

    try {
      const minutaId = getMinutaAtualParaUpload();
      if (!minutaId) {
        throw new Error("Abra uma minuta antes de enviar mídia.");
      }
      const contentType = (file.type || "application/octet-stream").toLowerCase();
      if (!ehTipoAceitoMidia(contentType)) {
        throw new Error("Tipo de arquivo não aceito na minuta (imagem, vídeo, áudio, PDF ou .docx).");
      }
      if (file.size > LIMITE_MIDIA_BYTES) {
        throw new Error(`Cada mídia pode ter até ${LIMITE_MIDIA_ROTULO}. Envie um arquivo menor.`);
      }

      onUploadBegin?.(file.name);

      const token = await getApoloAccessToken();
      const cabecalhos = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };

      // 1. URL assinada de upload (o servidor escolhe o caminho).
      const pedido: PedidoDeUploadMidia = {
        contentType,
        fileName: file.name,
        minutaId,
        size: file.size,
      };
      const assinar = await fetch(ROTA, {
        body: JSON.stringify(pedido),
        cache: "no-store",
        headers: cabecalhos,
        method: "POST",
      });
      if (!assinar.ok) {
        throw new Error(await mensagemDoErro(assinar, "Não foi possível preparar o envio da mídia."));
      }
      const assinada = (await assinar.json()) as UrlAssinadaDeUpload;
      avancar(10);

      // 2. Bytes direto no Storage.
      const client = getHubSupabaseClient();
      if (!client) {
        throw new Error("Sessão do Panteon ausente.");
      }
      const upload = await client.storage
        .from(assinada.bucket)
        .uploadToSignedUrl(assinada.path, assinada.token, file, { contentType });
      if (upload.error) {
        throw new Error(`Falha ao enviar o arquivo: ${upload.error.message}`);
      }
      avancar(90);

      // 3. Confirmação: o servidor confere o tamanho real e assina a leitura.
      const confirmar = await fetch(ROTA, {
        body: JSON.stringify({ path: assinada.path }),
        cache: "no-store",
        headers: cabecalhos,
        method: "PATCH",
      });
      if (!confirmar.ok) {
        throw new Error(await mensagemDoErro(confirmar, "A mídia subiu, mas não foi possível confirmá-la."));
      }
      const confirmada = (await confirmar.json()) as MidiaConfirmada;
      avancar(100);

      const resultado: UploadedFile = {
        key: confirmada.path,
        name: confirmada.name || file.name,
        size: confirmada.size,
        type: confirmada.type || contentType,
        url: confirmada.url,
      };

      setUploadedFile(resultado);
      onUploadComplete?.(resultado);

      return resultado;
    } catch (error) {
      // ⚠️ NÃO simular o upload em erro (o hook original fazia isso). Sem arquivo no bucket, sem nó.
      toast.error(getErrorMessage(error));
      onUploadError?.(error);

      return undefined;
    } finally {
      setProgress(0);
      setIsUploading(false);
      setUploadingFile(undefined);
    }
  }

  return {
    isUploading,
    progress,
    uploadedFile,
    uploadFile,
    uploadingFile,
  };
}

async function mensagemDoErro(resposta: Response, padrao: string): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { error?: unknown };
    if (typeof corpo?.error === "string" && corpo.error.trim()) return corpo.error;
  } catch {
    // corpo não é JSON (ex.: 413 cru da Vercel)
  }
  return `${padrao} (HTTP ${resposta.status})`;
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return "Algo deu errado ao enviar a mídia. Tente de novo.";
}

export function showErrorToast(err: unknown) {
  return toast.error(getErrorMessage(err));
}
