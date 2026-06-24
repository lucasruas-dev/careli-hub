type HermesNotificationInput = {
  body: string;
  icon?: string;
  onClickPath?: string;
  tag?: string;
  title: string;
};

type HermesIncomingMessageSoundInput = {
  mentioned?: boolean;
  messageId?: string;
};

// Janela longa (10 min) para garantir 1 som por mensagem mesmo quando dois
// notificadores (provider global + workspace) disparam para o mesmo id com
// minutos de intervalo (ex.: usuario abre o Hermes tempos depois do 1o som).
const PULSEX_MESSAGE_SOUND_DEDUPE_MS = 600_000;
const HERMES_CALL_SOUND_SRC = "/sounds/hermes-call-ringtone.mp3";
const PANTEON_NOTIFICATION_SOUND_SRC = "/sounds/panteon-notification.mp3";
const playedMessageSoundAtById = new Map<string, number>();
let hermesCallRingtoneAudio: HTMLAudioElement | null = null;

export function playHermesMessageSound() {
  playAudioAsset(PANTEON_NOTIFICATION_SOUND_SRC, 0.82);
}

export function playHermesMentionSound() {
  playAudioAsset(PANTEON_NOTIFICATION_SOUND_SRC, 0.9);
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

export function playHermesCallSound() {
  playAudioAsset(HERMES_CALL_SOUND_SRC, 0.92);
}

export function playHermesOutgoingCallSound() {
  playAudioAsset(HERMES_CALL_SOUND_SRC, 0.64);
}

export function startHermesCallRingtone(volume = 0.92) {
  try {
    if (typeof window === "undefined") {
      return;
    }

    const normalizedVolume = Math.min(Math.max(volume, 0), 1);

    if (hermesCallRingtoneAudio) {
      hermesCallRingtoneAudio.volume = normalizedVolume;
      hermesCallRingtoneAudio.loop = true;

      if (hermesCallRingtoneAudio.paused) {
        hermesCallRingtoneAudio.currentTime = 0;
        void hermesCallRingtoneAudio.play().catch(() => undefined);
      }

      return;
    }

    const audio = new Audio(HERMES_CALL_SOUND_SRC);

    audio.loop = true;
    audio.preload = "auto";
    audio.volume = normalizedVolume;
    hermesCallRingtoneAudio = audio;

    void audio.play().catch(() => undefined);
  } catch {
    // Browser can block audio before the user interacts with the page.
  }
}

export function startHermesOutgoingCallRingtone() {
  startHermesCallRingtone(0.64);
}

export function stopHermesCallRingtone() {
  const audio = hermesCallRingtoneAudio;

  if (!audio) {
    return;
  }

  hermesCallRingtoneAudio = null;
  audio.pause();
  audio.currentTime = 0;
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
  icon,
  onClickPath,
  tag,
  title,
}: HermesNotificationInput) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }

  const notify = () => {
    const notification = new Notification(title, {
      badge: "/panteon-mark.png",
      body,
      // Avatar de quem enviou; fallback na marca do Panteon quando nao houver.
      icon: icon || "/panteon-mark.png",
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

function playAudioAsset(src: string, volume: number) {
  try {
    if (typeof window === "undefined") {
      return;
    }

    const audio = new Audio(src);

    audio.preload = "auto";
    audio.volume = Math.min(Math.max(volume, 0), 1);
    void audio.play().catch(() => undefined);
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
