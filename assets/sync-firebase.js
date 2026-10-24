/* sync-firebase.js — cross-device annotation sync via Cloud Firestore.
 *
 * One document per localStorage key (`rr:<book>:<page>`), so every page of
 * every book syncs, not just the one open in this tab. Merge is by mark uid
 * with newest-timestamp-wins.
 *
 * Removals need their own record. A plain union merge cannot carry a
 * deletion: the mark is still in somebody else's copy, so the next pull
 * hands it back and pushes it up again. Every document therefore carries a
 * `deleted: {uid: ts}` map, and a uid only comes back if it returns with a
 * timestamp newer than its tombstone. Devices keep their own copy of the map
 * under `rr-fb-del:<key>` so a removal made offline still travels.
 *
 * No auth: this is a single-owner store, so the Firestore rules must be
 * locked down to your origin.
 *
 * Listens for rr-marks-changed (dispatched by annotate.js on every save) and
 * exposes window.__rrSync for settings.html.
 */
(function () {
  'use strict';

  var LS_ON = 'rr-sync-on';
  var LS_TS = 'rr-sync-ts';
  var LS_DEL = 'rr-fb-del:';
  var LS_SEEN = 'rr-fb-seen:';
  var LIST_PREFIXES = ['rr:', 'rr-import:'];
  var TOMB_TTL = 60 * 24 * 3600 * 1000;

  /* The EPUB reader re-injects this file on every chapter change. Only the
   * newest instance may write, or each one keeps pushing on every change. */
  var GEN = (window.__rrFbSyncGen = (window.__rrFbSyncGen || 0) + 1);
  function stale() { return window.__rrFbSyncGen !== GEN; }

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

  function merge(local, remote, del) {
    var byUid = {};
    (remote || []).concat(local || []).forEach(function (m) {
      if (!m || typeof m.uid !== 'string') return;
      if (!byUid[m.uid] || ts(m) > ts(byUid[m.uid])) byUid[m.uid] = m;
    });
    return Object.keys(byUid).sort(function (a, b) {
      var A = byUid[a], B = byUid[b];
      return (ts(A) - ts(B)) || (A.uid < B.uid ? -1 : 1);
    }).filter(function (u) { return !tombed(del, u, ts(byUid[u])); })
      .map(function (u) { return byUid[u]; });
  }

  /* Firestore ids cannot contain most punctuation: book + page -> id. */
  function docIdFor(key) { return key.replace(/[^A-Za-z0-9]+/g, '__'); }

  /* Order-independent identity of a mark list, so a pull can tell "same
   * marks, different order" from "actually changed". */
  function canon(list) {
    return (list || []).map(function (m) {
      return [m.uid, ts(m), m.q || '', m.note || '', m.color || '', m.style || ''].join('\u0001');
    }).sort().join('\u0002');
  }
  function delGet(key) {
    var d = {};
    try {
      var raw = JSON.parse(localStorage.getItem(LS_DEL + key) || '{}');
      if (raw && typeof raw === 'object') d = raw;
    } catch (e) {}
    var now = Date.now(), dropped = false;
    Object.keys(d).forEach(function (u) { if (now - Number(d[u]) > TOMB_TTL) { delete d[u]; dropped = true; } });
    if (dropped) delSet(key, d);
    return d;
  }
  function delSet(key, d) {
    try { localStorage.setItem(LS_DEL + key, JSON.stringify(d || {})); } catch (e) {}
  }
  /* What this device last had for a key. Without it a pull cannot tell a
   * mark that was deleted here from one this device never had, and the union
   * merge quietly hands the deleted mark back before anything notices. */
  function seenGet(key) {
    try {
      var raw = JSON.parse(localStorage.getItem(LS_SEEN + key) || '{}');
      return (raw && typeof raw === 'object') ? raw : {};
    } catch (e) { return {}; }
  }
  function seenSet(key, marks) {
    var o = {};
    (marks || []).forEach(function (m) {
      if (m && typeof m.uid === 'string') o[m.uid] = ts(m);
    });
    try { localStorage.setItem(LS_SEEN + key, JSON.stringify(o)); } catch (e) {}
  }
  function delMerge(a, b) {
    var out = {}, now = Date.now();
    [a, b].forEach(function (src) {
      Object.keys(src || {}).forEach(function (u) {
        var v = Number(src[u]) || 0;
        if (v && (!out[u] || v > out[u])) out[u] = v;
      });
    });
    Object.keys(out).forEach(function (u) { if (now - out[u] > TOMB_TTL) delete out[u]; });
    return out;
  }
  function tombed(del, uid, when) {
    return !!(del[uid] && (Number(del[uid]) || 0) >= (Number(when) || 0));
  }

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
  /* Read the document we last pulled (or fetch it), work out which uids the
   * remote still holds that this device no longer has, and write those as
   * tombstones alongside the marks. */
  function pushAll(snapshot) {
    var keys = listKeys();
    if (!keys.length) return Promise.resolve(0);
    var col = marks();
    return Promise.all(keys.map(function (k) {
      var list = lsList(k);
      var known = (snapshot && snapshot[k]) || null;
      var body = known ? Promise.resolve(known)
                       : col.doc(docIdFor(k)).get().then(function (s) {
                           return s.exists ? (s.data() || {}) : {};
                         }).catch(function () { return {}; });
      return body.then(function (remote) {
        var del = delMerge(delGet(k), remote.deleted && typeof remote.deleted === 'object' ? remote.deleted : {});
        /* anything the remote still holds that we no longer have is a removal
         * made here; cover the case where this device never pulled since */
        var have = {};
        list.forEach(function (m) { if (m && typeof m.uid === 'string') have[m.uid] = true; });
        var now = Date.now();
        (Array.isArray(remote.marks) ? remote.marks : []).forEach(function (m) {
          if (m && typeof m.uid === 'string' && !have[m.uid] && !del[m.uid]) del[m.uid] = now;
        });
        if (Object.keys(del).length) delSet(k, del);
        seenSet(k, list);
        return col.doc(docIdFor(k))
          .set({ key: k, marks: list, deleted: del, updatedAt: now })
          .catch(function (e) {
            if (window.console) console.warn('[rr-sync] push failed', k, e);
          });
      });
    })).then(function () { return keys.length; });
  }

  function pullAll() {
    var snapshot = {}, got = 0;
    return marks().get().then(function (snap) {
      snap.forEach(function (d) {
        var data = d.data() || {};
        var key = data.key;
        if (!key) return;
        snapshot[key] = data;
        var remote = Array.isArray(data.marks) ? data.marks : [];
        var local = lsList(key);
        var del = delMerge(delGet(key), data.deleted && typeof data.deleted === 'object' ? data.deleted : {});
        /* removals made on this device, worked out before the merge can put
         * them back: known last time, absent now */
        var seen = seenGet(key), have = {}, now = Date.now();
        local.forEach(function (m) { if (m && typeof m.uid === 'string') have[m.uid] = true; });
        Object.keys(seen).forEach(function (u) {
          if (!have[u] && !del[u]) del[u] = now;
        });
        if (Object.keys(del).length) delSet(key, del);
        var merged = merge(local, remote, del);
        /* compare content, not length: one removal plus one new mark keeps
         * the count identical and used to look like "nothing changed". */
        if (canon(merged) !== canon(local)) {
          lsSet(key, merged);
          got++;
        }
        seenSet(key, merged);
      });
      if (got) {
        try {
          document.dispatchEvent(new CustomEvent('rr-marks-changed'));
        } catch (e) {}
      }
      return snapshot;
    });
  }

  /* Full round trip. Always resolves 'ok'/'off'/'unavailable'/'error'. */
  function syncNow() {
    if (!enabled) return Promise.resolve('off');
    if (stale()) return Promise.resolve('off');
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
    if (stale()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { pushTimer = null; if (enabled && !stale()) pushAll(null); }, 900);
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