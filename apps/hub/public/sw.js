self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  return;
});

// Web Push do Hermes: entrega a notificacao do SO mesmo com o app fechado/minimizado.
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let payload = {};

      try {
        payload = event.data ? event.data.json() : {};
      } catch {
        payload = {};
      }

      // Se o app ja esta aberto E em foco, deixa a notificacao in-app cuidar (evita
      // duplicar). Para janelas minimizadas/escondidas/fechadas, mostramos o push.
      const windowClients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });
      const hasFocusedClient = windowClients.some(
        (client) =>
          client.focused === true || client.visibilityState === "visible",
      );

      if (hasFocusedClient) {
        return;
      }

      const title = payload.title || "Nova mensagem no Hermes";

      await self.registration.showNotification(title, {
        badge: "/panteon-mark.png",
        body: payload.body || "",
        // Mesma tag da notificacao in-app: o navegador colapsa duplicatas.
        tag: payload.tag || "pulsex-message",
        data: { url: payload.url || "/hermes" },
        // Avatar de quem enviou; fallback na marca do Panteon.
        icon: payload.icon || "/panteon-mark.png",
      });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const targetUrl =
    (event.notification.data && event.notification.data.url) || "/hermes";

  event.waitUntil(
    (async () => {
      const windowClients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });

      for (const client of windowClients) {
        if ("focus" in client) {
          await client.focus();

          if ("navigate" in client) {
            try {
              await client.navigate(targetUrl);
            } catch {
              // Navegacao pode falhar se a origem mudou; foco ja garante a janela.
            }
          }

          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
