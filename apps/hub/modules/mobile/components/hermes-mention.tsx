"use client";

import type {
  HermesMessageMention,
  HermesPresenceUser,
} from "@/lib/pulsex";
import { MobileAvatar } from "@/modules/mobile/components/mobile-ui";

// @menção no compositor mobile — mesmo padrão do desktop (message-composer):
// detecta "@fragmento" antes do cursor, sugere membros e insere o nome no texto,
// registrando {displayName, trigger, userId} pra ir no createHermesMessage.

export type ActiveMention = {
  end: number;
  query: string;
  start: number;
  trigger: string;
};

export function getActiveMentionQuery(
  value: string,
  caretIndex: number,
): ActiveMention | null {
  const beforeCaret = value.slice(0, caretIndex);
  const match = beforeCaret.match(/(^|\s)@([^\s@]*)$/);

  if (!match || typeof match.index !== "number") {
    return null;
  }

  const prefix = match[1] ?? "";
  const query = match[2] ?? "";
  const triggerStart = match.index + prefix.length;

  return {
    end: caretIndex,
    query,
    start: triggerStart,
    trigger: `@${query}`,
  };
}

function normalizeMentionText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function filterMentionOptions(
  users: readonly HermesPresenceUser[],
  query: string,
): HermesPresenceUser[] {
  const normalized = normalizeMentionText(query);

  return users
    .filter((user) => {
      if (!normalized) {
        return true;
      }

      return [user.label, ...user.label.split(" "), user.email, user.username]
        .filter((value): value is string => Boolean(value))
        .some((value) => normalizeMentionText(value).startsWith(normalized));
    })
    .slice(0, 6);
}

/** Aplica a menção no texto: troca o "@frag" pelo nome + espaço. */
export function applyMentionToDraft(input: {
  active: ActiveMention;
  draft: string;
  mentions: readonly HermesMessageMention[];
  user: HermesPresenceUser;
}): { caret: number; draft: string; mentions: HermesMessageMention[] } {
  const insertedText = `${input.user.label} `;
  const draft = `${input.draft.slice(0, input.active.start)}${insertedText}${input.draft.slice(input.active.end)}`;
  const mention: HermesMessageMention = {
    displayName: input.user.label,
    trigger: input.active.trigger,
    userId: input.user.id,
  };

  return {
    caret: input.active.start + insertedText.length,
    draft,
    mentions: [
      ...input.mentions.filter((item) => item.userId !== input.user.id),
      mention,
    ],
  };
}

/** Mantém só as menções cujo nome ainda está no texto (usuário apagou = sai). */
export function pruneMentions(
  draft: string,
  mentions: readonly HermesMessageMention[],
): HermesMessageMention[] {
  return mentions.filter((mention) => draft.includes(mention.displayName));
}

/** Lista de sugestões acima do compositor. */
export function MentionSuggestions({
  onSelect,
  options,
}: {
  onSelect: (user: HermesPresenceUser) => void;
  options: readonly HermesPresenceUser[];
}) {
  if (!options.length) {
    return null;
  }

  return (
    <div className="max-h-56 overflow-y-auto border-t border-[#e4e9f0] bg-white">
      {options.map((user) => (
        <button
          className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left outline-none transition active:bg-[#f5f6f8]"
          key={user.id}
          onClick={() => onSelect(user)}
          type="button"
        >
          <MobileAvatar label={user.label} size={30} url={user.avatarUrl} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-[#101820]">
              {user.label}
            </span>
            <span className="block truncate text-[11px] text-[#9aa6b5]">
              {user.role || user.email || ""}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
