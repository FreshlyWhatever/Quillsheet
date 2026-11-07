'use strict';
/*
 * Offline copy of the site. Only ever fetches Quillsheet's own files, from its own address.
 * Character data is not involved: it lives in localStorage and never passes through here.
 *
 * Online: get the latest file (and refresh the copy). No or slow signal: use the saved copy.
 */
const CACHE = 'quillsheet-v1';
const FILES = [
  './', 'index.html', 'privacy.html', 'manifest.webmanifest', 'icon.svg', 'css/styles.css',
  'js/data.js', 'js/storage.js', 'js/importer.js', 'js/quickbuild.js', 'js/homebrew.js', 'js/app.js',
  'js/srd/srd-2014.js', 'js/srd/srd-2024.js',
  'fonts/OpenDyslexic-Regular.woff2', 'fonts/OpenDyslexic-Bold.woff2',
];
const SLOW_MS = 2500;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('quillsheet-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function respond(request) {
  const cache = await caches.open(CACHE);
  const saved = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  });
  if (!saved) return network.catch(() => (request.mode === 'navigate' ? cache.match('index.html') : Response.error()));
  const slow = new Promise(resolve => { setTimeout(() => resolve(saved), SLOW_MS); });
  return Promise.race([network.catch(() => saved), slow]);
}

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(respond(e.request));
});
