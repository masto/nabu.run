// The preact-cli builds of nabu.run registered a Workbox service worker
// here that precached the whole app. Newer builds don't use a service
// worker, so this replacement clears the old caches, unregisters itself,
// and reloads any open pages so they pick up the current version.
// sw.js is the same thing for browsers that got the non-module build.

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
  })());
});
