// A cada alteração nos arquivos abaixo, publique uma nova versão deste cache.
const VERSION = '1.2.0';
const ROOT = new URL(self.registration.scope);
const PREFIX = `loja-gigi-pwa:${ROOT.href}:`;
const CACHE = `${PREFIX}${VERSION}`;
const ASSETS = [
  ['./', 'text/html'],
  ['style.css', 'text/css'],
  ['script.js', 'javascript'],
  ['finance.js', 'javascript'],
  ['pwa.js', 'javascript'],
  ['manifest.webmanifest', 'application/manifest+json'],
  ['icons/icon-192.png', 'image/png'],
  ['icons/icon-512.png', 'image/png'],
  ['icons/icon-maskable-512.png', 'image/png'],
  ['icons/apple-touch-icon.png', 'image/png']
].map(([path, type]) => ({ url: new URL(path, ROOT).href, type }));
const URLS = new Set(ASSETS.map(asset => asset.url));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll(ASSETS.map(asset => new Request(asset.url, { cache: 'reload' })));
      for (const asset of ASSETS) {
        const response = await cache.match(asset.url);
        if (!response?.headers.get('Content-Type')?.includes(asset.type)) {
          throw Error(`Tipo de arquivo inesperado: ${asset.url}`);
        }
      }
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
  // A atualização espera que todas as páginas da versão anterior sejam fechadas.
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter(name => name.startsWith(PREFIX) && name !== CACHE)
      .map(name => caches.delete(name)));
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== ROOT.origin) return;
  url.search = '';
  url.hash = '';
  if (event.request.mode === 'navigate' && url.href === new URL('index.html', ROOT).href) {
    url.href = ROOT.href;
  }
  if (!URLS.has(url.href)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return (await cache.match(url.href)) || fetch(event.request);
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE' || !event.ports[0]) return;
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      const entries = await Promise.all(ASSETS.map(asset => cache.match(asset.url)));
      event.ports[0].postMessage({ ready: entries.every(Boolean) });
    } catch {
      event.ports[0].postMessage({ ready: false });
    }
  })());
});
