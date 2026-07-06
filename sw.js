// Service Worker — Suivi de l'Être
// Gère les notifications en arrière-plan même quand l'appli est fermée

const CACHE = 'suivi-etre-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ─── Stockage des RDV en IndexedDB ───────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('suivi-etre-notifs', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('appointments', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function storeAppointments(appointments) {
  const db = await openDB();
  const tx = db.transaction('appointments', 'readwrite');
  const store = tx.objectStore('appointments');
  store.clear();
  appointments.forEach(a => store.put(a));
  return new Promise(r => { tx.oncomplete = r; });
}

async function getAppointments() {
  const db = await openDB();
  const tx = db.transaction('appointments', 'readonly');
  const req = tx.objectStore('appointments').getAll();
  return new Promise(r => { req.onsuccess = () => r(req.result || []); });
}

// ─── Planification des notifications ─────────────────────────────────────────
let _timeouts = [];

function scheduleTimeouts(appointments) {
  _timeouts.forEach(t => clearTimeout(t));
  _timeouts = [];
  const now = Date.now();
  appointments.forEach(appt => {
    const body = `${appt.heure} · ${appt.type} (${appt.duree} min)${appt.lieu ? '\n📍 ' + appt.lieu : ''}`;
    const d30 = appt.timestamp - 30 * 60 * 1000 - now;
    const d0  = appt.timestamp - now;
    if (d30 > 0) _timeouts.push(setTimeout(() =>
      self.registration.showNotification(`⏰ RDV dans 30 min — ${appt.clientName}`, { body, tag: `rdv-${appt.id}-30`, requireInteraction: true, icon: './icon.png' }), d30));
    if (d0  > 0) _timeouts.push(setTimeout(() =>
      self.registration.showNotification(`🌿 RDV maintenant — ${appt.clientName}`, { body, tag: `rdv-${appt.id}-0`,  requireInteraction: true, icon: './icon.png' }), d0));
  });
}

// Vérification au réveil (periodic sync ou push)
async function checkAndNotify() {
  const appointments = await getAppointments();
  const now = Date.now();
  const window5m = 5 * 60 * 1000;
  for (const appt of appointments) {
    const body = `${appt.heure} · ${appt.type} (${appt.duree} min)${appt.lieu ? '\n📍 ' + appt.lieu : ''}`;
    const t30 = appt.timestamp - 30 * 60 * 1000;
    const t0  = appt.timestamp;
    if (!appt.sent30 && t30 <= now && now < t30 + window5m) {
      await self.registration.showNotification(`⏰ RDV dans 30 min — ${appt.clientName}`, { body, tag: `rdv-${appt.id}-30`, requireInteraction: true });
      appt.sent30 = true;
    }
    if (!appt.sent0 && t0 <= now && now < t0 + window5m) {
      await self.registration.showNotification(`🌿 RDV maintenant — ${appt.clientName}`, { body, tag: `rdv-${appt.id}-0`, requireInteraction: true });
      appt.sent0 = true;
    }
  }
  await storeAppointments(appointments);
}

// ─── Événements ──────────────────────────────────────────────────────────────

// Réception des données depuis l'appli
self.addEventListener('message', async event => {
  if (event.data?.type === 'SCHEDULE') {
    await storeAppointments(event.data.appointments);
    scheduleTimeouts(event.data.appointments);
    event.source?.postMessage({ type: 'SCHEDULED', count: event.data.appointments.length });
  }
});

// Réveil périodique (fonctionne même appli fermée, nécessite PWA installée)
self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-rdv') event.waitUntil(checkAndNotify());
});

// Clic sur une notification → ouvre l'appli
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list => {
      if (list.length > 0) return list[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
