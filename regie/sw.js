// Régie de l'Être — fonctionne sans internet (salle sans réseau).
// Réseau d'abord (on a toujours la dernière version quand internet est là),
// la copie gardée sinon. Ne touche qu'aux fichiers de /regie/ ; la
// synchronisation (Supabase) passe directement, sans cache.
const CACHE = 'regie-etre-v3';
const FICHIERS = ['./', './index.html', './manifest.json', './logo.png', './icone-192.png', './icone-512.png'];

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE)
    .then(c => Promise.all(FICHIERS.map(f => fetch(f, { cache: 'reload' }).then(r => r.ok && c.put(f, r)).catch(() => {}))))
    .then(() => self.skipWaiting())
));

self.addEventListener('activate', e => e.waitUntil(
  caches.keys()
    .then(k => Promise.all(k.filter(x => x.startsWith('regie-etre-') && x !== CACHE).map(x => caches.delete(x))))
    .then(() => self.clients.claim())
));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Polices d'écriture : gardées une fois pour toutes (lisibles même hors ligne).
  if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.open(CACHE).then(c => c.match(req).then(g => g || fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin || !url.pathname.startsWith('/regie/')) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cle = req.mode === 'navigate' ? './index.html' : req;
    try {
      // Réseau lent dans une salle : au-delà de 4 s, on prend la copie gardée.
      const rep = await Promise.race([fetch(req, { cache: 'no-cache' }), new Promise((_, non) => setTimeout(() => non(new Error('lent')), 4000))]);
      if (rep && rep.ok) cache.put(cle, rep.clone());
      return rep;
    } catch (err) {
      const garde = await cache.match(cle);
      if (garde) return garde;
      throw err;
    }
  })());
});
