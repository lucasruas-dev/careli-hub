"use client";

import { CornerUpLeft } from "lucide-react";

import type { HermesMessageTag } from "@/lib/pulsex";
import {
  HERMES_REACTION_EMOJIS,
  HERMES_TAG_OPTIONS,
} from "@/modules/mobile/lib/hermes-tags";

// Folha de ações da mensagem (toque na mensagem): reagir, marcar (tags) e
// responder (abre a thread). Aceita mensagem OU resposta (só usa body/tags);
// showReply=false esconde "Responder" (respostas não abrem sub-thread).
export function HermesMessageActions({
  message,
  onClose,
  onReact,
  onReply,
  onToggleTag,
  showReply = true,
}: {
  message: { body: string; tags?: readonly HermesMessageTag[] };
  onClose: () => void;
  onReact: (emoji: string) => void;
  onReply: () => void;
  onToggleTag: (tag: HermesMessageTag) => void;
  showReply?: boolean;
}) {
  const activeTags = new Set(message.tags ?? []);

  return (
    <div
      className="absolute inset-0 z-30 flex flex-col justify-end bg-[#080c12]/45"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="rounded-t-[20px] bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="m-0 mb-3 line-clamp-2 rounded-lg bg-[#f5f6f8] px-3 py-2 text-[13px] text-[#526078]">
          {message.body || "Mensagem"}
        </p>

        <div className="flex justify-around">
          {HERMES_REACTION_EMOJIS.map((emoji) => (
            <button
              className="grid h-11 w-11 place-items-center rounded-full text-2xl outline-none transition active:scale-90"
              key={emoji}
              onClick={() => onReact(emoji)}
              type="button"
            >
              {emoji}
            </button>
          ))}
        </div>

        <p className="mb-1.5 mt-4 text-[11px] font-medium text-[#9aa6b5]">
          Marcar
        </p>
        <div className="flex flex-wrap gap-2">
          {HERMES_TAG_OPTIONS.map((tag) => {
            const active = activeTags.has(tag.key);

            return (
              <button
                className={`rounded-full px-3 py-1.5 text-xs font-medium outline-none transition active:scale-95 ${
                  active ? tag.chip : "bg-[#f0f2f6] text-[#526078]"
                }`}
                key={tag.key}
                onClick={() => onToggleTag(tag.key)}
                type="button"
              >
                {tag.label}
              </button>
            );
          })}
        </div>

        {showReply ? (
          <button
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-[#101820] py-3 text-sm font-medium text-white outline-none transition active:scale-[0.99]"
            onClick={onReply}
            type="button"
          >
            <CornerUpLeft aria-hidden="true" size={16} />
            Responder
          </button>
        ) : null}
      </div>
    </div>
  );
}
