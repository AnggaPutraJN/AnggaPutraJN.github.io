// sw.js
// =========================================================
// SERVICE WORKER PWA KEUANGAN - BACKGROUND NOTIFICATION
// Versi ini memperbaiki:
// 1. Notifikasi Pengingat Input Harian
// 2. Notifikasi Limit Jajan Harian
// 3. Notifikasi Utang
// 4. Notifikasi Reminder Tagihan dan Utang
// Catatan: Service Worker hanya berjalan di HTTPS/GitHub Pages/localhost, bukan file://
// =========================================================

const CACHE_NAME = 'keuangan-pwa-v3.3.0';
const DB_NAME = 'keuangan-notification-db';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const STATE_KEY = 'finance-notification-state';

const APP_SHELL = [
  './',
  './keuangan.html',
  './manifest.json',
  './icon-192x192.png',
  './icon-512x512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames.map((cacheName) => cacheName !== CACHE_NAME ? caches.delete(cacheName) : null)
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Jangan cache endpoint Google Apps Script dan file Google.
  if (url.hostname.includes('script.google.com') || url.hostname.includes('googleusercontent.com')) return;
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type !== 'opaque') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || caches.match('./keuangan.html')))
  );
});

// =========================================================
// IndexedDB kecil di Service Worker
// Jadwal dan data notifikasi tetap tersimpan walau app ditutup.
// =========================================================

function openNotifyDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getNotifyState() {
  try {
    const db = await openNotifyDb();

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(STATE_KEY);

      req.onsuccess = () => resolve(req.result || {});
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Gagal membaca state notifikasi:', err);
    return {};
  }
}

async function saveNotifyState(state) {
  try {
    const db = await openNotifyDb();

    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(state || {}, STATE_KEY);

      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn('Gagal menyimpan state notifikasi:', err);
    return false;
  }
}

// =========================================================
// Helper waktu Asia/Jakarta
// =========================================================

function jakartaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(date);

  const map = {};
  parts.forEach((p) => {
    if (p.type !== 'literal') map[p.type] = p.value;
  });

  return map;
}

function todayKeyJakarta() {
  const p = jakartaParts();
  return `${p.year}-${p.month}-${p.day}`;
}

function currentMinutesJakarta() {
  const p = jakartaParts();
  return parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
}

function timeToMinutes(timeValue, fallback = '19:00') {
  const [h, m] = String(timeValue || fallback).split(':').map((v) => parseInt(v, 10));
  return (Number.isFinite(h) ? h : 19) * 60 + (Number.isFinite(m) ? m : 0);
}

function dateKeyFromRaw(raw) {
  if (!raw) return '';

  const str = String(raw).trim();

  // yyyy-mm-dd
  let match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (match) return `${match[1]}-${match[2]}-${match[3]}`;

  // dd/mm/yyyy atau dd-mm-yyyy
  match = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (match) {
    return `${match[3]}-${String(match[2]).padStart(2, '0')}-${String(match[1]).padStart(2, '0')}`;
  }

  const d = new Date(str);
  if (!Number.isNaN(d.getTime())) {
    const p = jakartaParts(d);
    return `${p.year}-${p.month}-${p.day}`;
  }

  return '';
}

function dateFromKey(key) {
  return new Date(`${key}T00:00:00+07:00`);
}

function diffDaysFromToday(rawDate) {
  const key = dateKeyFromRaw(rawDate);
  if (!key) return null;

  const today = dateFromKey(todayKeyJakarta());
  const due = dateFromKey(key);

  return Math.ceil((due.getTime() - today.getTime()) / 86400000);
}

function rupiah(value) {
  const n = Number(value || 0);
  return 'Rp ' + n.toLocaleString('id-ID');
}

function pruneOldNotified(notified) {
  const today = todayKeyJakarta();
  const clean = {};

  Object.keys(notified || {}).forEach((key) => {
    if (key.includes(today)) clean[key] = notified[key];
  });

  return clean;
}

async function showFinanceNotification(title, options = {}) {
  return self.registration.showNotification(title, Object.assign({
    icon: './icon-192x192.png',
    badge: './icon-192x192.png',
    data: { url: './keuangan.html' },
    renotify: true
  }, options));
}

// =========================================================
// Cek semua jenis notifikasi
// =========================================================

async function checkFinanceNotifications(source = 'manual') {
  const state = await getNotifyState();
  const todayKey = todayKeyJakarta();
  const nowMinutes = currentMinutesJakarta();

  state.notified = pruneOldNotified(state.notified || {});

  // 1. Pengingat Input Harian
  const daily = state.dailyReminder || {};
  if (daily.enabled) {
    const remindAt = timeToMinutes(daily.time || '19:00');
    const alreadyInputToday = state.lastInputDate === todayKey;
    const notifyKey = `daily-input:${todayKey}`;

    if (!alreadyInputToday && nowMinutes >= remindAt && !state.notified[notifyKey]) {
      await showFinanceNotification('Pengingat Keuangan Harian', {
        body: 'Apakah anda sudah menginput keuangan hari ini?',
        tag: 'finance-daily-reminder',
        actions: [{ action: 'open', title: 'Input Sekarang' }]
      });

      state.notified[notifyKey] = new Date().toISOString();
    }
  }

  // 2. Limit Jajan Harian
  const jajan = state.jajan || {};
  const limit = Number(jajan.limit || 0);
  const todayJajanTotal = Number(jajan.todayTotal || 0);
  const overLimit = todayJajanTotal - limit;
  const jajanKey = `jajan-limit:${todayKey}`;

  if (limit > 0 && todayJajanTotal > limit && !state.notified[jajanKey]) {
    await showFinanceNotification('Batas Jajan Harian Terlewati', {
      body: `Anda sudah melewati batas jajan harian. Total jajan hari ini ${rupiah(todayJajanTotal)}, melewati limit ${rupiah(overLimit)}.`,
      tag: 'finance-jajan-limit'
    });

    state.notified[jajanKey] = new Date().toISOString();
  }

  // 3. Reminder Tagihan dan Utang
  const billDebt = state.billDebtReminder || {};
  if (billDebt.enabled) {
    const daysBefore = Math.max(0, Number(billDebt.daysBefore || 3));
    const items = [];

    (state.bills || []).forEach((bill) => {
      const diff = diffDaysFromToday(bill.dueDate || bill.jatuhTempo);
      if (diff === null) return;
      if (diff >= 0 && diff <= daysBefore) {
        items.push({
          type: 'Tagihan',
          name: bill.name || bill.billName || 'Tagihan',
          amount: Number(bill.amount || bill.nominal || 0),
          dueDate: bill.dueDate || bill.jatuhTempo,
          diff
        });
      }
    });

    (state.debts || []).forEach((debt) => {
      if (String(debt.status || '').toLowerCase() === 'lunas') return;

      const diff = diffDaysFromToday(debt.jatuhTempo || debt.dueDate);
      const amount = Number(debt.sisaUtang || debt.remaining || debt.pokokAwal || 0);

      if (diff === null) return;
      if (diff >= 0 && diff <= daysBefore && amount > 0) {
        items.push({
          type: 'Utang',
          name: debt.target || debt.nama || 'Utang',
          amount,
          dueDate: debt.jatuhTempo || debt.dueDate,
          diff
        });
      }
    });

    items.sort((a, b) => a.diff - b.diff);

    const itemKey = items.map((x) => `${x.type}:${x.name}:${x.dueDate}`).join('|') || 'empty';
    const notifyKey = `bill-debt:${todayKey}:${itemKey}`;

    if (items.length && !state.notified[notifyKey]) {
      const body = items.slice(0, 5).map((item) => {
        const dueLabel = item.diff === 0 ? 'hari ini' : `H-${item.diff}`;
        return `${item.type}: ${item.name} (${dueLabel}) ${rupiah(item.amount)}`;
      }).join('\n');

      await showFinanceNotification('Reminder Tagihan & Utang', {
        body,
        tag: 'finance-bill-debt-reminder',
        actions: [{ action: 'open', title: 'Cek Sekarang' }]
      });

      state.notified[notifyKey] = new Date().toISOString();
    }
  }

  state.lastCheckedAt = new Date().toISOString();
  state.lastCheckedSource = source;

  await saveNotifyState(state);
}

// =========================================================
// Terima data terbaru dari halaman HTML
// =========================================================

self.addEventListener('message', (event) => {
  const data = event.data || {};

  if (data.type === 'SYNC_FINANCE_NOTIFICATION_DATA') {
    event.waitUntil((async () => {
      const oldState = await getNotifyState();
      const newState = Object.assign({}, oldState, data.payload || {});

      newState.notified = oldState.notified || {};
      newState.updatedAt = new Date().toISOString();

      await saveNotifyState(newState);
      await checkFinanceNotifications('message-sync');
    })());
  }

  if (data.type === 'FORCE_CHECK_FINANCE_NOTIFICATIONS') {
    event.waitUntil(checkFinanceNotifications('force-check'));
  }

  // Kompatibilitas dengan kode lama.
  if (data.type === 'SHOW_DAILY_REMINDER') {
    event.waitUntil(showFinanceNotification('Pengingat Keuangan Harian', {
      body: 'Apakah anda sudah menginput keuangan hari ini?',
      tag: 'finance-daily-reminder',
      actions: [{ action: 'open', title: 'Input Sekarang' }]
    }));
  }

  if (data.type === 'SHOW_BILL_DEBT_REMINDER') {
    event.waitUntil(showFinanceNotification('Reminder Tagihan & Utang', {
      body: data.body || 'Ada tagihan/utang yang mendekati jatuh tempo.',
      tag: 'finance-bill-debt-reminder',
      actions: [{ action: 'open', title: 'Cek Sekarang' }]
    }));
  }
});

// Periodic Background Sync.
// Catatan: Tidak semua browser mendukung. Jika tidak mendukung, app tetap memakai fallback saat app dibuka.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'finance-reminder-check') {
    event.waitUntil(checkFinanceNotifications('periodicsync'));
  }
});

// One-off Background Sync sebagai cadangan.
self.addEventListener('sync', (event) => {
  if (event.tag === 'finance-reminder-check') {
    event.waitUntil(checkFinanceNotifications('sync'));
  }
});

// Saat notifikasi diklik, buka/fokuskan aplikasi.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = (event.notification.data && event.notification.data.url) || './keuangan.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsArr) => {
      for (const client of clientsArr) {
        if ('focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }

      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
