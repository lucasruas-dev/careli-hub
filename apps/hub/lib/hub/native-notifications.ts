"use client";

export type PanteonNativeNotificationPermission =
  | NotificationPermission
  | "unsupported";

export type PanteonNativeNotificationInput = {
  body?: string;
  requireInteraction?: boolean;
  silent?: boolean;
  tag?: string;
  title: string;
  url?: string;
};

const PANTEON_NOTIFICATION_ICON = "/panteon-mark.png";
const PANTEON_HOMOLOG_NOTIFICATION_ICON = "/panteon-mark-homolog.png";

export function getPanteonNativeNotificationPermission():
  | PanteonNativeNotificationPermission {
  if (!supportsPanteonNativeNotifications()) {
    return "unsupported";
  }

  return window.Notification.permission;
}

export function supportsPanteonNativeNotifications() {
  return (
    typeof window !== "undefined" &&
    "Notification" in window &&
    window.isSecureContext
  );
}

export async function requestPanteonNativeNotificationPermission() {
  if (!supportsPanteonNativeNotifications()) {
    return "unsupported" as const;
  }

  if (window.Notification.permission !== "default") {
    return window.Notification.permission;
  }

  return window.Notification.requestPermission();
}

export async function showPanteonNativeNotification({
  body,
  requireInteraction = false,
  silent = false,
  tag,
  title,
  url,
}: PanteonNativeNotificationInput) {
  if (
    !supportsPanteonNativeNotifications() ||
    window.Notification.permission !== "granted"
  ) {
    return false;
  }

  const targetUrl = normalizeNotificationUrl(url);
  const icon = getPanteonNotificationIcon();
  const options: NotificationOptions = {
    badge: icon,
    body,
    data: {
      url: targetUrl,
    },
    icon,
    requireInteraction,
    silent,
    tag,
  };

  const registration = await getReadyServiceWorkerRegistration();

  if (registration?.showNotification) {
    await registration.showNotification(title, options);
    return true;
  }

  const notification = new window.Notification(title, options);

  notification.onclick = () => {
    focusPanteonNotificationTarget(targetUrl);
    notification.close();
  };

  return true;
}

export function getPanteonNativeNotificationSupportLabel(
  permission: PanteonNativeNotificationPermission,
) {
  if (permission === "unsupported") {
    return "Notificacoes do Windows indisponiveis neste navegador.";
  }

  if (permission === "granted") {
    return "Notificacoes do Windows ativas. Clique para enviar um teste.";
  }

  if (permission === "denied") {
    return "Permissao bloqueada. Libere notificacoes nas configuracoes do site/app.";
  }

  return "Ativar notificacoes do Windows.";
}

async function getReadyServiceWorkerRegistration() {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }

  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

function focusPanteonNotificationTarget(targetUrl: string) {
  window.focus();

  if (targetUrl && targetUrl !== window.location.href) {
    window.location.assign(targetUrl);
  }
}

function normalizeNotificationUrl(url: string | undefined) {
  try {
    return new URL(url || "/", window.location.origin).toString();
  } catch {
    return window.location.origin;
  }
}

function getPanteonNotificationIcon() {
  if (typeof window === "undefined") {
    return PANTEON_NOTIFICATION_ICON;
  }

  const hostname = window.location.hostname.toLowerCase();

  return hostname.includes("homo") || hostname.includes("homolog")
    ? PANTEON_HOMOLOG_NOTIFICATION_ICON
    : PANTEON_NOTIFICATION_ICON;
}
