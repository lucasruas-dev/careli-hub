"use client";

type IrisNotificationInput = {
  body: string;
  tag?: string;
  title: string;
};

let notificationPermissionRequested = false;

export function registerIrisNotificationPermissionIntent() {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }

  if (
    notificationPermissionRequested ||
    window.Notification.permission !== "default"
  ) {
    return;
  }

  notificationPermissionRequested = true;

  void window.Notification.requestPermission().catch(() => undefined);
}

export function showBrowserIrisNotification({
  body,
  tag,
  title,
}: IrisNotificationInput) {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return;
  }

  if (window.Notification.permission === "granted") {
    const notification = new window.Notification(title, {
      body,
      icon: "/favicon.ico",
      silent: false,
      tag,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };

    return;
  }

  registerIrisNotificationPermissionIntent();
}

export function playIrisInboundSound() {
  if (typeof window === "undefined") {
    return;
  }

  try {
    const browserWindow = window as typeof window & {
      webkitAudioContext?: typeof AudioContext;
    };
    const AudioContextConstructor =
      browserWindow.AudioContext ?? browserWindow.webkitAudioContext;

    if (!AudioContextConstructor) {
      return;
    }

    const audioContext = new AudioContextConstructor();
    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.06, audioContext.currentTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + 0.5);
    gain.connect(audioContext.destination);

    [740, 980].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(
        frequency,
        audioContext.currentTime + index * 0.13,
      );
      oscillator.connect(gain);
      oscillator.start(audioContext.currentTime + index * 0.13);
      oscillator.stop(audioContext.currentTime + index * 0.13 + 0.12);
    });

    window.setTimeout(() => void audioContext.close(), 700);
  } catch {
    // Navegadores podem bloquear audio sem interacao previa; a Iris segue sem quebrar.
  }
}
