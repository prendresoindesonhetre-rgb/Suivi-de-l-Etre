// Service Worker — Suivi de l'Être
const CACHE = 'suivi-etre-v81';
const SB_URL = 'https://issedanlnadbhidlymnc.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlzc2VkYW5sbmFkYmhpZGx5bW5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODExOTAzNjUsImV4cCI6MjA5Njc2NjM2NX0.vTpXYfaMOt1BUAXKgQdq0rWP4AMLMPdnux41SLeSXF4';
const ICON = 'https://suivi.prendresoindesonhetre.fr/icon-notif.png';

const ASSETS = ['/', '/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];

// ─── Modèles de notifications éditables (registre dupliqué depuis index.html,
// à garder en phase — voir NOTIF_TYPES_BUILTIN) ───────────────────────────────
const NOTIF_DEFAULTS = {
  'rdv-30min': { titre: '⏰ RDV dans {minutes} min — {client}', corps: '{heure} · {type} ({duree} min){lieu}{trajet}' },
  'rdv-now': { titre: '🌿 RDV maintenant — {client}', corps: '{heure} · {type} ({duree} min){lieu}{trajet}' },
  'rdv-end': { titre: '📝 Séance terminée — {client}', corps: 'Pensez à remplir la note de séance' },
  'daily-summary': { titre: "📅 {nombre} RDV aujourd'hui", corps: '{liste}' },
  'daily-summary-empty': { titre: '🌿 Journée sans rendez-vous', corps: 'Les notifications reprennent demain matin.' },
  'day-done': { titre: '✅ Journée terminée', corps: 'Toutes vos séances sont terminées. Les notifications reprennent demain matin.' },
  'tomorrow-preview': { titre: '📆 Demain — {nombre} RDV', corps: '{liste}' },
  'tomorrow-preview-empty': { titre: '📆 Demain — aucun rendez-vous', corps: 'Bonne journée libre !' },
  'urssaf': { titre: '🏛️ Déclaration URSSAF à faire', corps: '{montant} € encaissés depuis votre dernière déclaration' },
};

function renderTpl(str, vars) {
  return (str || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : ''));
}

// Fusionne le défaut intégré avec la surcharge éventuelle (titre/corps/actif).
function getTpl(templates, id) {
  const def = NOTIF_DEFAULTS[id] || { titre: '', corps: '' };
  const override = (templates || []).find(t => t.id === id);
  const actif = override ? override.actif !== false : true;
  return {
    titre: (override && override.titre) || def.titre,
    corps: (override && override.corps != null && override.corps !== '') ? override.corps : def.corps,
    actif
  };
}

async function fetchParametres() {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/sync?select=parametres&limit=1`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    if (!res.ok) return {};
    const rows = await res.json();
    return (rows?.length && rows[0].parametres) || {};
  } catch(e) { return {}; }
}

self.addEventListener('install', e => e.waitUntil(
  caches.open(CACHE).then(c =>
    // fetch avec {cache:'reload'} pour ignorer le cache HTTP du navigateur :
    // c.addAll() seul reste soumis au Cache-Control: max-age=600 de GitHub
    // Pages et pouvait donc mettre en cache une version encore périmée.
    Promise.all(ASSETS.map(url => fetch(url, { cache: 'reload' }).then(res => c.put(url, res))))
  ).then(() => self.skipWaiting())
));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request).then(res => {
      if (res && res.status === 200) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
      }
      return res;
    }))
  );
});

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

function getFranceTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d).split('/');
  return `${p[2]}-${p[1]}-${p[0]}`;
}

function getFranceHour() {
  return parseInt(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(new Date()), 10);
}

// ─── Récupération depuis Supabase ─────────────────────────────────────────────
async function fetchDayFromSupabase(date) {
  try {
    const res = await fetch(`${SB_URL}/rest/v1/sync?select=rdvs,clients&limit=1`, {
      headers: { 'apikey': SB_KEY, 'Authorization': `Bearer ${SB_KEY}` }
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!rows?.length) return [];
    const { rdvs = [], clients = [] } = rows[0];
    return rdvs.filter(r => r.date === date && !r.annule).map(r => {
      const c = clients.find(x => x.id == r.clientId);
      const nom = c ? `${c.prenom}${c.nom ? ' ' + c.nom : ''}` : 'Client';
      const lieu = r.lieu || (c && c.adresse) || '';
      const [h, m] = r.heure.split(':').map(Number);
      const rdvTime = new Date(date + 'T' + r.heure + ':00');
      return { id: r.id, timestamp: rdvTime.getTime(), heure: r.heure, type: r.type || 'Séance', lieu, clientName: nom, duree: r.duree || 60, trajet: r.trajetAller || 0 };
    });
  } catch(e) { return []; }
}

async function fetchTodayFromSupabase() {
  return fetchDayFromSupabase(getFranceDate());
}

async function showTomorrowPreview(templates) {
  const appts = await fetchDayFromSupabase(getFranceTomorrow());
  const sorted = appts.sort((a, b) => a.timestamp - b.timestamp);
  if (sorted.length === 0) {
    const tpl = getTpl(templates, 'tomorrow-preview-empty');
    if (!tpl.actif) return;
    await self.registration.showNotification(renderTpl(tpl.titre, {}), {
      body: renderTpl(tpl.corps, {}), icon: ICON, tag: 'tomorrow-preview', requireInteraction: false
    });
  } else {
    const tpl = getTpl(templates, 'tomorrow-preview');
    if (!tpl.actif) return;
    const first = sorted[0];
    const lieu = first.lieu ? ` · 📍 ${first.lieu}` : '';
    const suite = sorted.slice(1).map(a => `${a.heure} · ${a.clientName}`).join('\n');
    const liste = `Premier RDV à ${first.heure} avec ${first.clientName}${lieu}${suite ? '\n' + suite : ''}`;
    const vars = { nombre: sorted.length, liste };
    await self.registration.showNotification(renderTpl(tpl.titre, vars), {
      body: renderTpl(tpl.corps, vars), icon: ICON, tag: 'tomorrow-preview', requireInteraction: false
    });
  }
}

// ─── Planification (appli ouverte) ───────────────────────────────────────────
let _timeouts = [];

function scheduleTimeouts(appointments, templates) {
  _timeouts.forEach(t => clearTimeout(t));
  _timeouts = [];
  const now = Date.now();
  const tpl30 = getTpl(templates, 'rdv-30min');
  const tplNow = getTpl(templates, 'rdv-now');
  const tplEnd = getTpl(templates, 'rdv-end');
  appointments.forEach(appt => {
    const trajet = appt.trajet || 0;
    const alertMin = 30 + trajet;
    const vars = {
      client: appt.clientName, minutes: alertMin, heure: appt.heure, type: appt.type, duree: appt.duree,
      lieu: appt.lieu ? '\n📍 ' + appt.lieu : '', trajet: trajet ? '\n🚗 ' + trajet + ' min de route' : ''
    };
    const d30 = appt.timestamp - alertMin * 60 * 1000 - now;
    const d0  = appt.timestamp - now;
    const dEnd = appt.timestamp + (appt.duree || 60) * 60 * 1000 - now;
    if (d30 > 0 && tpl30.actif) _timeouts.push(setTimeout(() =>
      self.registration.showNotification(renderTpl(tpl30.titre, vars), { body: renderTpl(tpl30.corps, vars), icon: ICON, tag: `rdv-${appt.id}-30`, requireInteraction: true }), d30));
    if (d0 > 0 && tplNow.actif) _timeouts.push(setTimeout(() =>
      self.registration.showNotification(renderTpl(tplNow.titre, vars), { body: renderTpl(tplNow.corps, vars), icon: ICON, tag: `rdv-${appt.id}-0`, requireInteraction: true }), d0));
    if (dEnd > 0 && tplEnd.actif) _timeouts.push(setTimeout(() =>
      self.registration.showNotification(renderTpl(tplEnd.titre, vars), { body: renderTpl(tplEnd.corps, vars), icon: ICON, tag: `rdv-${appt.id}-end`, requireInteraction: true, data: { rdvId: appt.id }, actions: [{ action: 'note', title: '✅ Remplir la note' }, { action: 'absent', title: '❌ Non venu' }] }), dEnd));
  });
}

// ─── Rappel déclaration URSSAF ────────────────────────────────────────────────
// Modèle cumulatif : total encaissé depuis la date de la dernière déclaration,
// tous mois confondus (aligné sur getMontantADeclarer() côté app).
async function checkUrssafDeclaration(p, templates) {
  try {
    const paiements = p.paiements || [];
    const declarations = p.urssafDeclarations || [];

    const versements = [];
    paiements.forEach(raw => {
      if (raw.versements) raw.versements.forEach(v => versements.push({ date: v.date, montant: v.montant || 0 }));
      else versements.push({ date: raw.datePaiement, montant: raw.montant || 0 });
    });

    const derniere = declarations.length
      ? declarations.reduce((a, b) => (a.dateDeclaration > b.dateDeclaration ? a : b))
      : null;
    const limite = derniere ? derniere.dateDeclaration : null;
    const total = versements
      .filter(v => v.date && (!limite || v.date > limite))
      .reduce((s, v) => s + (v.montant || 0), 0);

    const tpl = getTpl(templates, 'urssaf');
    if (total > 0 && tpl.actif) {
      const vars = { montant: total.toFixed(2).replace('.',',') };
      await self.registration.showNotification(renderTpl(tpl.titre, vars), {
        body: renderTpl(tpl.corps, vars), icon: ICON, tag: 'urssaf-declare', requireInteraction: true
      });
    } else {
      const existing = await self.registration.getNotifications({ tag: 'urssaf-declare' });
      existing.forEach(n => n.close());
    }
  } catch(e) {}
}

// ─── Rappels personnalisés (indépendants des RDV/factures) ───────────────────
function withinWindow(nowHHMM, targetHHMM, toleranceMin) {
  if (!targetHHMM) return false;
  const [nh, nm] = nowHHMM.split(':').map(Number);
  const [th, tm] = targetHHMM.split(':').map(Number);
  const nowMin = nh * 60 + nm, targetMin = th * 60 + tm;
  return nowMin >= targetMin && nowMin < targetMin + toleranceMin;
}

function daysBetween(aStr, bStr) {
  const a = new Date(aStr + 'T00:00:00Z');
  const b = new Date(bStr + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}

function isDueIntervalle(anchorStr, todayStr, n, unite) {
  const diffDays = daysBetween(anchorStr, todayStr);
  if (diffDays < 0) return false;
  if (unite === 'jour') return diffDays % n === 0;
  if (unite === 'semaine') return diffDays % (n * 7) === 0;
  const anchor = new Date(anchorStr + 'T00:00:00Z');
  const todayD = new Date(todayStr + 'T00:00:00Z');
  const anchorDay = anchor.getUTCDate();
  const monthsDiff = (todayD.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (todayD.getUTCMonth() - anchor.getUTCMonth());
  const daysInTodayMonth = new Date(Date.UTC(todayD.getUTCFullYear(), todayD.getUTCMonth() + 1, 0)).getUTCDate();
  const dayMatches = todayD.getUTCDate() === anchorDay || (anchorDay > daysInTodayMonth && todayD.getUTCDate() === daysInTodayMonth);
  if (!dayMatches) return false;
  if (unite === 'mois') return monthsDiff % n === 0;
  if (unite === 'an') return monthsDiff % (n * 12) === 0;
  return false;
}

async function checkCustomReminders(templates) {
  const today = getFranceDate();
  const nowHHMM = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
  const customs = (templates || []).filter(t => t.custom && t.actif !== false);
  for (const t of customs) {
    let dueToday = false;
    if (t.frequence === 'unique') dueToday = t.date === today;
    else if (t.frequence === 'intervalle') dueToday = isDueIntervalle(t.date, today, t.intervalleN || 1, t.intervalleUnite || 'semaine');
    if (!dueToday || !withinWindow(nowHHMM, t.heure, 20)) continue;

    const sentKey = `custom-sent-${t.id}-${today}`;
    if (await getMeta(sentKey)) continue;
    await self.registration.showNotification(t.titre || t.nom, {
      body: t.corps || '', icon: ICON, tag: `custom-${t.id}`, requireInteraction: true
    });
    await setMeta(sentKey, true);
  }
}

// ─── Vérification au réveil (push serveur) ───────────────────────────────────
async function checkAndNotify() {
  const today = getFranceDate();
  const hour  = getFranceHour();

  const p = await fetchParametres();
  const templates = p.notifTemplates || [];

  await checkUrssafDeclaration(p, templates);
  await checkCustomReminders(templates);

  // Pause manuelle jusqu'à demain
  const pausedUntil = await getMeta('pausedUntil');
  if (pausedUntil === today) return;

  let appointments = await fetchTodayFromSupabase();
  if (appointments.length) {
    await storeAppointments(appointments);
  } else {
    const cached = await getAppointments();
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    appointments = cached.filter(a => a.timestamp >= todayStart.getTime());
  }

  // Récapitulatif du matin — à partir de 8h (une seule fois par jour)
  if (hour >= 8 && hour < 12) {
    const lastSummary = await getMeta('lastSummaryDate');
    if (lastSummary !== today) {
      const sorted = [...appointments].sort((a, b) => a.timestamp - b.timestamp);
      if (appointments.length > 0) {
        const tplSummary = getTpl(templates, 'daily-summary');
        if (tplSummary.actif) {
          const vars = { nombre: appointments.length, liste: sorted.map(a => `${a.heure} · ${a.clientName}`).join('\n') };
          await self.registration.showNotification(renderTpl(tplSummary.titre, vars), {
            body: renderTpl(tplSummary.corps, vars), icon: ICON, tag: 'daily-summary', requireInteraction: false
          });
        }
      } else {
        const tplEmpty = getTpl(templates, 'daily-summary-empty');
        if (tplEmpty.actif) {
          await self.registration.showNotification(renderTpl(tplEmpty.titre, {}), {
            body: renderTpl(tplEmpty.corps, {}), icon: ICON, tag: 'daily-summary', requireInteraction: false
          });
        }
        await showTomorrowPreview(templates);
        await setMeta('pausedUntil', today);
      }
      await setMeta('lastSummaryDate', today);
    }
  }

  // Notifications individuelles
  const now = Date.now();
  const window5m = 20 * 60 * 1000;
  const tpl30 = getTpl(templates, 'rdv-30min');
  const tplNow = getTpl(templates, 'rdv-now');
  const tplEnd = getTpl(templates, 'rdv-end');
  for (const appt of appointments) {
    const trajet = appt.trajet || 0;
    const alertMin = 30 + trajet;
    const vars = {
      client: appt.clientName, minutes: alertMin, heure: appt.heure, type: appt.type, duree: appt.duree,
      lieu: appt.lieu ? '\n📍 ' + appt.lieu : '', trajet: trajet ? '\n🚗 ' + trajet + ' min de route' : ''
    };
    const t30 = appt.timestamp - alertMin * 60 * 1000;
    if (!appt.sent30 && t30 <= now && now < t30 + window5m) {
      if (tpl30.actif) await self.registration.showNotification(renderTpl(tpl30.titre, vars), { body: renderTpl(tpl30.corps, vars), icon: ICON, tag: `rdv-${appt.id}-30`, requireInteraction: true });
      appt.sent30 = true;
    }
    if (!appt.sent0 && appt.timestamp <= now && now < appt.timestamp + window5m) {
      if (tplNow.actif) await self.registration.showNotification(renderTpl(tplNow.titre, vars), { body: renderTpl(tplNow.corps, vars), icon: ICON, tag: `rdv-${appt.id}-0`, requireInteraction: true });
      appt.sent0 = true;
    }
    const tEnd = appt.timestamp + (appt.duree || 60) * 60 * 1000;
    if (!appt.sentEnd && tEnd <= now && now < tEnd + window5m) {
      if (tplEnd.actif) await self.registration.showNotification(renderTpl(tplEnd.titre, vars), { body: renderTpl(tplEnd.corps, vars), icon: ICON, tag: `rdv-${appt.id}-end`, requireInteraction: true, data: { rdvId: appt.id }, actions: [{ action: 'note', title: '✅ Remplir la note' }, { action: 'absent', title: '❌ Non venu' }] });
      appt.sentEnd = true;
    }
  }
  if (appointments.length) await storeAppointments(appointments);

  // Notification planning du jour — seulement s'il reste des RDV
  const remaining = appointments.filter(a => a.timestamp + (a.duree || 60) * 60 * 1000 > now);
  if (remaining.length > 0) {
    const sorted = [...remaining].sort((a, b) => a.timestamp - b.timestamp);
    const body = sorted.map(a => `${a.heure} · ${a.clientName}`).join('\n');
    await self.registration.showNotification(
      `📅 Planning du jour · ${remaining.length} RDV`,
      { body, icon: ICON, tag: 'today-board', requireInteraction: false }
    );
  } else if (appointments.length > 0 && hour >= 9) {
    // Toutes les séances du jour sont terminées — notif unique avec bouton pause
    const lastDone = await getMeta('lastDoneDate');
    if (lastDone !== today) {
      const tplDone = getTpl(templates, 'day-done');
      if (tplDone.actif) {
        await self.registration.showNotification(renderTpl(tplDone.titre, {}), {
          body: renderTpl(tplDone.corps, {}), icon: ICON, tag: 'day-done', requireInteraction: false
        });
      }
      await showTomorrowPreview(templates);
      await setMeta('lastDoneDate', today);
      await setMeta('pausedUntil', today);
    }
  }
}

// ─── Événements ───────────────────────────────────────────────────────────────
self.addEventListener('message', async event => {
  if (event.data?.type === 'SCHEDULE') {
    await storeAppointments(event.data.appointments);
    scheduleTimeouts(event.data.appointments, event.data.notifTemplates || []);
    event.source?.postMessage({ type: 'SCHEDULED', count: event.data.appointments.length });
  }
  if (event.data?.type === 'CHECK_NOW') {
    await checkAndNotify();
  }
  if (event.data?.type === 'URSSAF_DECLARED') {
    const existing = await self.registration.getNotifications({ tag: 'urssaf-declare' });
    existing.forEach(n => n.close());
  }
});

self.addEventListener('push', event => {
  event.waitUntil(checkAndNotify());
});

self.addEventListener('periodicsync', event => {
  if (event.tag === 'check-rdv') event.waitUntil(checkAndNotify());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'pause-today') {
    event.waitUntil(setMeta('pausedUntil', getFranceDate()));
    return;
  }
  const rdvId = event.notification.data?.rdvId;
  if ((event.action === 'note' || event.action === 'absent') && rdvId) {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(list => {
        if (list.length > 0) {
          list[0].focus();
          list[0].postMessage({ type: 'NOTIF_ACTION', action: event.action, rdvId });
          return;
        }
        return self.clients.openWindow(`./?action=${event.action}&rdvId=${rdvId}`);
      })
    );
    return;
  }
  if (event.notification.tag === 'urssaf-declare') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window' }).then(list => {
        if (list.length > 0) {
          list[0].focus();
          list[0].postMessage({ type: 'NOTIF_ACTION', action: 'urssaf' });
          return;
        }
        return self.clients.openWindow('./?action=urssaf');
      })
    );
    return;
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(list => {
      if (list.length > 0) return list[0].focus();
      return self.clients.openWindow('./');
    })
  );
});
