import { Download, FileText } from "lucide-react";

import type { HermesMessageAttachment } from "@/lib/pulsex";

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Anexo de uma mensagem/resposta do Hermes: imagem aparece inline (toca pra
// abrir/baixar); arquivo/áudio/vídeo viram um chip clicável (abre/baixa).
// stopPropagation pra não abrir a folha de ações da mensagem ao tocar no anexo.
export function HermesAttachment({
  attachment,
}: {
  attachment: HermesMessageAttachment;
}) {
  const url = attachment.url;
  const size = formatBytes(attachment.sizeBytes);

  if (attachment.type === "image" && url) {
    return (
      <a
        className="block w-fit overflow-hidden rounded-lg"
        href={url}
        onClick={(event) => event.stopPropagation()}
        rel="noreferrer"
        target="_blank"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- anexo remoto, sem otimização */}
        <img
          alt={attachment.label || "Imagem"}
          className="max-h-64 max-w-[240px] rounded-lg object-cover"
          loading="lazy"
          src={url}
        />
      </a>
    );
  }

  return (
    <a
      className="flex w-fit max-w-full items-center gap-2 rounded-lg bg-black/5 px-2.5 py-2 text-xs font-medium text-[#3a4657] outline-none"
      href={url ?? "#"}
      onClick={(event) => event.stopPropagation()}
      rel="noreferrer"
      target="_blank"
    >
      <FileText aria-hidden="true" className="shrink-0 text-[#A07C3B]" size={16} />
      <span className="min-w-0 flex-1 truncate">
        {attachment.label || "Arquivo"}
      </span>
      {size ? <span className="shrink-0 text-[#9aa6b5]">{size}</span> : null}
      {url ? (
        <Download aria-hidden="true" className="shrink-0 text-[#526078]" size={14} />
      ) : null}
    </a>
  );
}
