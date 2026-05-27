self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationData = event.notification.data || {};
  const targetUrl = new URL(
    notificationData.url || "/",
    self.location.origin,
  ).href;

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });

      for (const client of clientList) {
        const targetClient =
          "navigate" in client && client.url !== targetUrl
            ? await client.navigate(targetUrl)
            : client;

        if (targetClient && "focus" in targetClient) {
          return targetClient.focus();
        }
      }

      return self.clients.openWindow(targetUrl);
    })(),
  );
});

self.addEventListener("fetch", () => {
  return;
});
