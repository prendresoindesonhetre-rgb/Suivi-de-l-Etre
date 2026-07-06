// Service Worker — Suivi de l'Être
const CACHE = 'suivi-etre-v1';
const SB_URL = 'https://issedanlnadbhidlymnc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlzc2VkYW5sbmFkYmhpZGx5bW5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExOTAzNjUsImV4cCI6MjA5Njc2NjM2NX0.vTpXYfaMOt1BUAXKgQdq0rWP4AMLMPdnux41SLeSXF4';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ─── IndexedDB ────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('suivi-etre-notifs', 2);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('appointments')) db.createObjectStore('appointments', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
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

async function getMeta(key) {
  const db = await openDB();
  const tx = db.transaction('meta', 'readonly');
  const req = tx.objectStore('meta').get(key);
  return new Promise(r => { req.onsuccess = () => r(req.result?.value); });
}

async function setMeta(key, value) {
  const db = await openDB();
  const tx = db.transaction('meta', 'readwrite');
  tx.objectStore('meta').put({ key, value });
  return new Promise(r => { tx.oncomplete = r; });
}

// ─── Utilitaires France ───────────────────────────────────────────────────────
function getFranceDate() {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('/');
  return `${p[2]}-${p[1]}-${p[0]}`;
}

function getFranceHour() {
  return parseInt(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date()), 10);
}

// ─── Récupération depuis Supabase ─────────────────────────────────────────────
async function fetchTodayFromSupabase() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/sync?select=rdvs,clients&limit=1`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!rows?.length) return [];
    const { rdvs = [], clients = [] } = rows[0];
    const today = getFranceDate();
    return rdvs.filter(r => r.date === today && !r.annule).map(r => {
      const c = clients.find(x => x.id == r.clientId);
      const nom = c ? `${c.prenom}${c.nom ? ' ' + c.nom : ''}` : 'Client';
      const lieu = r.lieu || (c && c.adresse) || '';
      const [h, m] = r.heure.split(':').map(Number);
      const rdvTime = new Date(); rdvTime.setHours(h, m, 0, 0);
      return { id: r.id, timestamp: rdvTime.getTime(), heure: r.heure, type: r.type || 'Séance', lieu, clientName: nom, duree: r.duree || 60, trajet: r.trajetAller || 0 };
    });
  } catch(e) { return []; }
}

// ─── Planification (appli ouverte) ───────────────────────────────────────────
let _timeouts = [];

function scheduleTimeouts(appointments) {
  _timeouts.forEach(t => clearTimeout(t));
  _timeouts = [];
  const now = Date.now();
  appointments.forEach(appt => {
    const trajet = appt.trajet || 0;
    const alertMin = 30 + trajet;
    const body = `${appt.heure} · ${appt.type} (${appt.duree} min)${appt.lieu ? '\n📍 ' + appt.lieu : ''}${trajet ? '\n🚗 ' + trajet + ' min de route' : ''}`;
    const d30 = appt.timestamp - alertMin * 60 * 1000 - now;
    const d0  = appt.timestamp - now;
    const dEnd = appt.timestamp + (appt.duree || 60) * 60 * 1000 - now;
    if (d30 > 0) _timeouts.push(setTimeout(() =>
      self.registration.showNotification(`⏰ RDV dans ${alertMin} min — ${appt.clientName}`, { body, tag: `rdv-${appt.id}-30`, requireInteraction: true }), d30));
    if (d0 > 0) _timeouts.push(setTimeout(() =>
      self.registration.showNotification(`🌿 RDV maintenant — ${appt.clientName}`, { body, tag: `rdv-${appt.id}-0`, requireInteraction: true }), d0));
    if (dEnd > 0) _timeouts.push(setTimeout(() =>
      self.registration.showNotification(`📝 Séance terminée — ${appt.clientName}`, { body: 'Pensez à remplir la note de séance', tag: `rdv-${appt.id}-end`, requireInteraction: true }), dEnd));
  });
}

// ─── Vérification au réveil (push serveur) ───────────────────────────────────
async function checkAndNotify() {
  const today = getFranceDate();
  const hour  = getFranceHour();

  // Toujours récupérer les données fraîches depuis Supabase
  let appointments = await fetchTodayFromSupabase();
  if (appointments.length) {
    await storeAppointments(appointments);
  } else {
    // Fallback sur IndexedDB si Supabase inaccessible
    const cached = await getAppointments();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    appointments = cached.filter(a => a.timestamp >= todayStart.getTime());
  }

  // Récapitulatif du matin entre 8h et 9h (une seule fois par jour)
  if (hour >= 8 && hour < 9 && appointments.length > 0) {
    const lastSummary = await getMeta('lastSummaryDate');
    if (lastSummary !== today) {
      const sorted = [...appointments].sort((a, b) => a.timestamp - b.timestamp);
      const body = sorted.map(a => `${a.heure} · ${a.clientName}`).join('\n');
      await self.registration.showNotification(
        `📅 ${appointments.length} RDV aujourd'hui`,
        { body, tag: 'daily-summary', requireInteraction: false }
      );
      await setMeta('lastSummaryDate', today);
    }
  }

  // Notifications individuelles
  const now = Date.now();
  const window5m = 5 * 60 * 1000;
  for (const appt of appointments) {
    const trajet = appt.trajet || 0;
    const alertMin = 30 + trajet;
    const body = `${appt.heure} · ${appt.type} (${appt.duree} min)${appt.lieu ? '\n📍 ' + appt.lieu : ''}${trajet ? '\n🚗 ' + trajet + ' min de route' : ''}`;
    const t30 = appt.timestamp - alertMin * 60 * 1000;
    if (!appt.sent30 && t30 <= now && now < t30 + window5m) {
      await self.registration.showNotification(`⏰ RDV dans ${alertMin} min — ${appt.clientName}`, { body, tag: `rdv-${appt.id}-30`, requireInteraction: true });
      appt.sent30 = true;
    }
    if (!appt.sent0 && appt.timestamp <= now && now < appt.timestamp + window5m) {
      await self.registration.showNotification(`🌿 RDV maintenant — ${appt.clientName}`, { body, tag: `rdv-${appt.id}-0`, requireInteraction: true });
      appt.sent0 = true;
    }
    const tEnd = appt.timestamp + (appt.duree || 60) * 60 * 1000;
    if (!appt.sentEnd && tEnd <= now && now < tEnd + window5m) {
      await self.registration.showNotification(`📝 Séance terminée — ${appt.clientName}`, { body: 'Pensez à remplir la note de séance', tag: `rdv-${appt.id}-end`, requireInteraction: true });
      appt.sentEnd = true;
    }
  }
  if (appointments.length) await storeAppointments(appointments);

  // Notification planning du jour — toujours visible quand un push arrive
  const remaining = appointments.filter(a => a.timestamp + (a.duree || 60) * 60 * 1000 > now);
  if (remaining.length > 0) {
    const sorted = [...remaining].sort((a, b) => a.timestamp - b.timestamp);
    const body = sorted.map(a => `${a.heure} · ${a.clientName}`).join('\n');
    await self.registration.showNotification(
      `📅 Planning du jour · ${remaining.length} RDV`,
      { body, tag: 'today-board', requireInteraction: false }
    );
  } else {
    await self.registration.showNotification(
      `📅 Planning du jour`,
      { body: 'Aucun RDV restant aujourd\'hui', tag: 'today-board', requireInteraction: false }
    );
  }
}

// ─── Événements ───────────────────────────────────────────────────────────────
self.addEventListener('message', async event => {
  if (event.data?.type === 'SCHEDULE') {
    await storeAppointments(event.data.appointments);
    scheduleTimeouts(event.data.appointments);
    event.source?.postMessage({ type: 'SCHEDULED', count: event.data.appointments.length });
  }
});

self.addEventListener('push', event => {
  event.waitUntil(
    self.registration.showNotification('🔔 Push reçu', {
      body: new Date().toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }),
      tag: 'push-diag',
      requireInteraction: false
    }).then(() => checkAndNotify())
  );
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-rdv') event.waitUntil(checkAndNotify());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list => {
      if (list.length > 0) return list[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
