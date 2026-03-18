// Push notification handler for the service worker.
// This file is imported by the VitePWA-generated service worker.
// It receives push events from the proxy and shows native notifications.

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch {
    data = { title: "Porta", body: event.data.text() };
  }

  const title = data.title || "Porta";
  const options = {
    body: data.body || "",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: "porta-push-" + Date.now(),
    data: { url: "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Open the app when the notification is tapped
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        // Focus existing window if any
        for (const client of clients) {
          if (client.url.includes(self.location.origin)) {
            return client.focus();
          }
        }
        // Otherwise open a new window
        return self.clients.openWindow(url);
      }),
  );
});
