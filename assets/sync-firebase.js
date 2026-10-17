/* sync-firebase.js — cross-device annotation sync via Cloud Firestore.
 *
 * One document per localStorage key (`rr:<book>:<page>`), so every page of
 * every book syncs, not just the one open in this tab. Merge is by mark uid
 * with newest-timestamp-wins; removals propagate because the merged array
 * replaces the stored one. No auth: this is a single-owner store, so the
 * Firestore rules must be locked down to your origin.
 *
 * Listens for rr-marks-changed (dispatched by annotate.js on every save) and
 * exposes window.__rrSync for settings.html.
 */
(function () {
  'use strict';

  var LS_ON = 'rr-sync-on';
  var LS_TS = 'rr-sync-ts';
  var LIST_PREFIXES = ['rr:', 'rr-import:'];

  /* ---- placeholder guard ------------------------------------------- */
  if (!window.RR_FIREBASE_CONFIG ||
      window.RR_FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
    window.__rrSync = {
      enabled: function () { return false; },
      available: function () { return false; },
      status: function () { return 'not configured (fill assets/firebase-config.js)'; },
      setEnabled: function () { return false; },
      now: function () { return Promise.resolve('unavailable'); }
    };
    return;
  }

  /* ---- local helpers ------------------------------------------------ */
  function on() {
    try { return localStorage.getItem(LS_ON) === '1'; } catch (e) { return false; }
  }
  function setOn(b) {
    try { localStorage.setItem(LS_ON, b ? '1' : '0'); } catch (e) {}
    enabled = !!b;
    return enabled;
  }
  function listKeys() {
    var out = [];
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i) || '';
        for (var j = 0; j < LIST_PREFIXES.length; j++) {
          if (k.indexOf(LIST_PREFIXES[j]) === 0) { out.push(k); break; }
        }
      }
    } catch (e) {}
    return out;
  }
  function lsList(k) {
    try {
      var a = JSON.parse(localStorage.getItem(k) || '[]');
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function lsSet(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function ts(m) { return (m && typeof m.ts === 'number' && m.ts) || 0; }

  function merge(local, remote) {
    var byUid = {};
    (remote || []).concat(local || []).forEach(function (m) {
      if (!m || typeof m.uid !== 'string') return;
      if (!byUid[m.uid] || ts(m) > ts(byUid[m.uid])) byUid[m.uid] = m;
    });
    return Object.keys(byUid).sort(function (a, b) {
      var A = byUid[a], B = byUid[b];
      return (ts(A) - ts(B)) || (A.uid < B.uid ? -1 : 1);
    }).map(function (u) { return byUid[u]; });
  }

  /* Firestore ids cannot contain most punctuation: book + page -> id. */
  function docIdFor(key) { return key.replace(/[^A-Za-z0-9]+/g, '__'); }

  /* ---- firebase boot ------------------------------------------------ */
  var FS_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js';
  var APP_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js';
  var db = null, booted = null, enabled = false, lastSync = 0, pushTimer = null;
  var lastError = '';

  function loadScript(src) {
    return new Promise(function (res, rej) {
      var hit = document.querySelector('script[data-rr-src="' + src + '"]');
      if (hit) return res();
      var s = document.createElement('script');
      s.src = src; s.setAttribute('data-rr-src', src);
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }

  function boot() {
    if (booted) return booted;
    booted = loadScript(APP_URL)
      .then(function () { return loadScript(FS_URL); })
      .then(function () {
        if (!firebase.apps.length) firebase.initializeApp(window.RR_FIREBASE_CONFIG);
        db = firebase.firestore();
        try { db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
        return db;
      });
    return booted;
  }

  function marks() { return db.collection('marks'); }

  /* ---- push / pull -------------------------------------------------- */
  function pushAll() {
    var keys = listKeys();
    if (!keys.length) return Promise.resolve(0);
    var col = marks();
    return Promise.all(keys.map(function (k) {
      var list = lsList(k);
      return col.doc(docIdFor(k))
        .set({ key: k, marks: list, updatedAt: Date.now() })
        .catch(function (e) {
          if (window.console) console.warn('[rr-sync] push failed', k, e);
        });
    })).then(function () { return keys.length; });
  }

  function pullAll() {
    var got = 0;
    return marks().get().then(function (snap) {
      snap.forEach(function (d) {
        var data = d.data() || {};
        var key = data.key;
        if (!key) return;
        var remote = Array.isArray(data.marks) ? data.marks : [];
        var local = lsList(key);
        var merged = merge(local, remote);
        if (merged.length !== local.length) { lsSet(key, merged); got++; }
      });
      if (got) {
        try {
          document.dispatchEvent(new CustomEvent('rr-marks-changed'));
        } catch (e) {}
      }
      return got;
    });
  }

  /* Full round trip. Always resolves 'ok'/'off'/'unavailable'/'error'. */
  function syncNow() {
    if (!enabled) return Promise.resolve('off');
    return boot()
      .then(pullAll)
      .then(pushAll)
      .then(function () {
        lastSync = Date.now(); lastError = '';
        try { localStorage.setItem(LS_TS, String(lastSync)); } catch (e) {}
        return 'ok';
      })
      .catch(function (e) {
        lastError = (e && (e.code || e.name)) ? (e.code || e.name) : 'error';
        if (window.console) console.warn('[rr-sync] sync failed', lastError, e);
        return 'error:' + lastError;
      });
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; if (enabled) pushAll(); }, 900);
  }

  /* ---- public surface ------------------------------------------------ */
  window.__rrSync = {
    enabled: function () { return enabled; },
    available: function () { return true; },
    status: function () {
      if (!enabled) return 'off';
      if (!lastSync) return 'firebase sync on, not synced yet';
      if (lastError) return 'firebase sync on, last attempt failed (' + lastError + ')';
      var mins = Math.max(0, Math.round((Date.now() - lastSync) / 60000));
      return 'firebase sync on, synced ' + (mins < 1 ? 'just now' : mins + ' min ago');
    },
    setEnabled: function (b) {
      var on2 = setOn(b);
      if (on2) syncNow();
      return on2;
    },
    now: syncNow
  };

  enabled = on();
  try { lastSync = parseInt(localStorage.getItem(LS_TS) || '0', 10) || 0; } catch (e) {}

  document.addEventListener('rr-marks-changed', function () {
    if (enabled) schedulePush();
  });
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && enabled) syncNow();
  });

  if (enabled) syncNow();
})();