export const pulsexCallSoundOptions = [
  { id: "careli-signature", label: "Assinatura Careli" },
  { id: "aurora", label: "Aurora" },
  { id: "crystal", label: "Cristal" },
  { id: "focus", label: "Focus" },
] as const;

export type HermesCallSoundId = (typeof pulsexCallSoundOptions)[number]["id"];

type ToneSpec = {
  duration: number;
  frequency: number | readonly number[];
  gain: number;
  start: number;
  type: OscillatorType;
};

type HermesNotificationInput = {
  body: string;
  onClickPath?: string;
  tag?: string;
  title: string;
};

type HermesIncomingMessageSoundInput = {
  mentioned?: boolean;
  messageId?: string;
};

const PULSEX_MESSAGE_SOUND_DEDUPE_MS = 12_000;
const playedMessageSoundAtById = new Map<string, number>();

export function isHermesCallSoundId(value: unknown): value is HermesCallSoundId {
  return (
    typeof value === "string" &&
    pulsexCallSoundOptions.some((option) => option.id === value)
  );
}

export function playHermesMessageSound() {
  playToneSequence([
    {
      duration: 0.09,
      frequency: [587.33, 880],
      gain: 0.085,
      start: 0,
      type: "sine",
    },
    {
      duration: 0.12,
      frequency: [739.99, 1174.66],
      gain: 0.078,
      start: 0.08,
      type: "triangle",
    },
    {
      duration: 0.2,
      frequency: 987.77,
      gain: 0.04,
      start: 0.19,
      type: "sine",
    },
  ]);
}

export function playHermesMentionSound() {
  playToneSequence([
    {
      duration: 0.12,
      frequency: [392, 523.25],
      gain: 0.09,
      start: 0,
      type: "triangle",
    },
    {
      duration: 0.13,
      frequency: [659.25, 987.77],
      gain: 0.102,
      start: 0.12,
      type: "sine",
    },
    {
      duration: 0.18,
      frequency: [783.99, 1318.51],
      gain: 0.095,
      start: 0.28,
      type: "triangle",
    },
  ]);
}

export function playHermesIncomingMessageSound({
  mentioned = false,
  messageId,
}: HermesIncomingMessageSoundInput = {}) {
  if (messageId && shouldSkipRepeatedMessageSound(messageId)) {
    return;
  }

  if (mentioned) {
    playHermesMentionSound();
    return;
  }

  playHermesMessageSound();
}

export function playHermesCallSound(soundId: HermesCallSoundId) {
  const soundMap = {
    aurora: [
      {
        duration: 0.32,
        frequency: [440, 554.37],
        gain: 0.075,
        start: 0,
        type: "sine",
      },
      {
        duration: 0.38,
        frequency: [493.88, 659.25],
        gain: 0.068,
        start: 0.38,
        type: "triangle",
      },
      {
        duration: 0.34,
        frequency: [554.37, 739.99],
        gain: 0.052,
        start: 0.86,
        type: "sine",
      },
    ],
    "careli-signature": [
      {
        duration: 0.24,
        frequency: [523.25, 659.25],
        gain: 0.082,
        start: 0,
        type: "sine",
      },
      {
        duration: 0.26,
        frequency: [587.33, 739.99],
        gain: 0.074,
        start: 0.28,
        type: "triangle",
      },
      {
        duration: 0.36,
        frequency: [659.25, 783.99],
        gain: 0.058,
        start: 0.72,
        type: "sine",
      },
    ],
    crystal: [
      {
        duration: 0.16,
        frequency: [880, 1174.66],
        gain: 0.078,
        start: 0,
        type: "sine",
      },
      {
        duration: 0.22,
        frequency: [987.77, 1318.51],
        gain: 0.068,
        start: 0.2,
        type: "triangle",
      },
      {
        duration: 0.28,
        frequency: [783.99, 1046.5],
        gain: 0.058,
        start: 0.55,
        type: "sine",
      },
    ],
    focus: [
      {
        duration: 0.42,
        frequency: [392, 493.88],
        gain: 0.068,
        start: 0,
        type: "sine",
      },
      {
        duration: 0.34,
        frequency: [440, 587.33],
        gain: 0.062,
        start: 0.52,
        type: "triangle",
      },
    ],
  } as const satisfies Record<HermesCallSoundId, readonly ToneSpec[]>;

  playToneSequence(soundMap[soundId]);
}

export function playHermesOutgoingCallSound() {
  playToneSequence([
    {
      duration: 0.28,
      frequency: [440, 554.37],
      gain: 0.082,
      start: 0,
      type: "sine",
    },
    {
      duration: 0.3,
      frequency: [493.88, 622.25],
      gain: 0.074,
      start: 0.36,
      type: "triangle",
    },
    {
      duration: 0.18,
      frequency: 880,
      gain: 0.052,
      start: 0.84,
      type: "sine",
    },
  ]);
}

export function registerHermesNotificationPermissionIntent() {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "default"
  ) {
    return () => undefined;
  }

  const requestPermission = () => {
    void Notification.requestPermission();
    cleanup();
  };
  const cleanup = () => {
    window.removeEventListener("keydown", requestPermission);
    window.removeEventListener("pointerdown", requestPermission);
  };

  window.addEventListener("keydown", requestPermission, { once: true });
  window.addEventListener("pointerdown", requestPermission, { once: true });

  return cleanup;
}

export function showBrowserHermesNotification({
  body,
  onClickPath,
  tag,
  title,
}: HermesNotificationInput) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }

  const notify = () => {
    const notification = new Notification(title, {
      badge: "/logoc.png",
      body,
      icon: "/logo-careli-c2x.png",
      tag,
    });

    notification.onclick = () => {
      window.focus();

      if (onClickPath) {
        window.location.assign(onClickPath);
      }

      notification.close();
    };
  };

  if (Notification.permission === "granted") {
    notify();
    return;
  }

  if (Notification.permission === "default") {
    Notification.requestPermission().then((permission) => {
      if (permission === "granted") {
        notify();
      }
    });
  }
}

function playToneSequence(notes: readonly ToneSpec[]) {
  try {
    if (typeof window === "undefined") {
      return;
    }

    const AudioContextConstructor =
      window.AudioContext ||
      (window as typeof window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    const audioContext = new AudioContextConstructor();
    const masterGain = audioContext.createGain();
    const longestNoteEnd = notes.reduce(
      (maxEnd, note) => Math.max(maxEnd, note.start + note.duration),
      0,
    );

    masterGain.gain.setValueAtTime(0.82, audioContext.currentTime);
    masterGain.connect(audioContext.destination);

    notes.forEach((note) => {
      const noteGain = audioContext.createGain();
      const startAt = audioContext.currentTime + note.start;
      const endAt = startAt + note.duration;
      const frequencies = Array.isArray(note.frequency)
        ? note.frequency
        : [note.frequency];

      noteGain.gain.setValueAtTime(0.0001, startAt);
      noteGain.gain.exponentialRampToValueAtTime(note.gain, startAt + 0.03);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, endAt);
      noteGain.connect(masterGain);

      frequencies.forEach((frequency) => {
        const chordOscillator = audioContext.createOscillator();

        chordOscillator.type = note.type;
        chordOscillator.frequency.setValueAtTime(frequency, startAt);
        chordOscillator.connect(noteGain);
        chordOscillator.start(startAt);
        chordOscillator.stop(endAt + 0.03);
      });
    });

    window.setTimeout(() => {
      void audioContext.close();
    }, Math.ceil((longestNoteEnd + 0.22) * 1_000));
  } catch {
    // Browser can block audio before the user interacts with the page.
  }
}

function shouldSkipRepeatedMessageSound(messageId: string) {
  const now = Date.now();
  const playedAt = playedMessageSoundAtById.get(messageId);

  prunePlayedMessageSoundIds(now);

  if (playedAt && now - playedAt < PULSEX_MESSAGE_SOUND_DEDUPE_MS) {
    return true;
  }

  playedMessageSoundAtById.set(messageId, now);
  return false;
}

function prunePlayedMessageSoundIds(now: number) {
  for (const [messageId, playedAt] of playedMessageSoundAtById) {
    if (now - playedAt > PULSEX_MESSAGE_SOUND_DEDUPE_MS) {
      playedMessageSoundAtById.delete(messageId);
    }
  }
}
