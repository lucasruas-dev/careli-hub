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

      // So suprime o push se alguma janela do hub estiver com FOCO real (o usuario
      // esta olhando o app agora — o alerta in-app cuida). "visibilityState === visible"
      // NAO serve de criterio: no Windows, janela atras de outro programa ou em outro
      // monitor continua "visible" — era isso que engolia as notificacoes do time.
      const windowClients = await self.clients.matchAll({
        includeUncontrolled: true,
        type: "window",
      });
      const hasFocusedClient = windowClients.some(
        (client) => client.focused === true,
      );

      if (hasFocusedClient) {
        return;
      }

      const title = payload.title || "Nova mensagem no Hermes";

      await self.registration.showNotification(title, {
        badge: "/panteon-mark.png",
        body: payload.body || "",
        // Fica na tela ate o usuario interagir (clique/X) — sem sumir sozinha
        // em segundos. O SO ainda pode dispensa-la ao abrir o app (plataforma).
        requireInteraction: true,
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

          // Navegacao DENTRO do app (rota SPA via postMessage -> router.push).
          // client.navigate() recarregava o Panteon inteiro (boot completo) e era
          // o delay de ~8s entre o clique e a mensagem aparecer.
          client.postMessage({ type: "panteon:navigate", url: targetUrl });

          return;
        }
      }

      if (self.clients.openWindow) {
        await self.clients.openWindow(targetUrl);
      }
    })(),
  );
});
