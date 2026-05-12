import type {
  FormEvent,
  KeyboardEvent,
  ReactNode,
} from "react";
import {
  Bot,
  Mic,
  Paperclip,
  Send,
  Smile,
} from "lucide-react";

type MessageComposerProps = {
  channelName: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  value: string;
};

export function MessageComposer({
  channelName,
  onChange,
  onSubmit,
  value,
}: MessageComposerProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      onSubmit();
    }
  }

  const isEmpty = value.trim().length === 0;

  return (
    <form
      className="flex min-h-16 items-end gap-1.5 border-t border-[#d9e0ea] bg-white px-3 py-2"
      onSubmit={handleSubmit}
    >
      <ComposerAction ariaLabel="Abrir emojis" icon={<Smile size={18} />} />
      <ComposerAction ariaLabel="Anexar arquivo" icon={<Paperclip size={18} />} />
      <ComposerAction ariaLabel="Acionar IA" icon={<Bot size={18} />} />
      <textarea
        aria-label={`Mensagem para ${channelName}`}
        className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-[#d9e0ea] bg-[#f8fafc] px-3 py-2.5 text-sm leading-5 text-[var(--uix-text-primary)] outline-none transition placeholder:text-[var(--uix-text-muted)] focus:border-[#A07C3B] focus:bg-white"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={`Mensagem para ${channelName}`}
        rows={1}
        value={value}
      />
      <ComposerAction ariaLabel="Gravar audio" icon={<Mic size={18} />} />
      <button
        aria-label="Enviar mensagem"
        className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md bg-[#A07C3B] text-white outline-none transition hover:brightness-110 focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)] disabled:cursor-not-allowed disabled:bg-[#e6ebf2] disabled:text-[#8b98aa]"
        disabled={isEmpty}
        type="submit"
      >
        <Send aria-hidden="true" size={18} />
      </button>
    </form>
  );
}

function ComposerAction({
  ariaLabel,
  icon,
}: {
  ariaLabel: string;
  icon: ReactNode;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className="mb-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-md text-[var(--uix-text-muted)] outline-none transition hover:bg-[#eef2f7] hover:text-[var(--uix-text-primary)] focus-visible:ring-2 focus-visible:ring-[var(--uix-focus-ring)]"
      type="button"
    >
      {icon}
    </button>
  );
}
