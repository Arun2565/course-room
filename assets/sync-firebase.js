/* sync-firebase.js — cross-device mark sync via Firebase Firestore. */
(function () {
  'use strict';
  if (!window.RR_FIREBASE_CONFIG || window.RR_FIREBASE_CONFIG.apiKey === 'YOUR_API_KEY') {
    // Not configured; expose a no-op status for Settings.
    window.__rrSync = { enabled: function(){return false;}, available: function(){return false;},
      status: function(){return 'not configured (fill assets/firebase-config.js)';},
      setEnabled: function(){return false;}, now: function(){} };
    return;
  }
  // Lazy-load Firebase compat SDK if not present.
  function loadScript(src) { return new Promise(function (res, rej) {
    if (document.querySelector('script[src="' + src + '"]')) return res();
    var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  }); }
  var APP_SRC = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js';
  var FS_SRC = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore-compat.js';

  var LS_ON = 'rr-sync-on';
  var enabled = false;
  try { enabled = localStorage.getItem(LS_ON) === '1'; } catch (e) {}

  var app, db, unsub = null, book, page, docRef;

  function init() {
    return loadScript(APP_SRC).then(function () { return loadScript(FS_SRC); }).then(function () {
      if (!firebase.apps.length) firebase.initializeApp(window.RR_FIREBASE_CONFIG);
      app = firebase.app();
      db = firebase.firestore();
      try { db.enablePersistence({ synchronizeTabs: true }); } catch (e) {}
      var el = document.querySelector('[data-rr-book]');
      book = el ? el.getAttribute('data-rr-book') : 'unknown';
      page = el ? el.getAttribute('data-rr-page') : 'unknown';
      docRef = db.collection('marks').doc(book + '__' + page);
    });
  }

  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function mergeMarks(local, remote) {
    var byUid = {};
    (remote || []).concat(local || []).forEach(function (m) {
      if (!m || typeof m.uid !== 'string') return;
      if (!byUid[m.uid] || (m.ts || 0) > (byUid[m.uid].ts || 0)) byUid[m.uid] = m;
    });
    return Object.keys(byUid).map(function (u) { return byUid[u]; });
  }

  function pull() {
    if (!enabled || !docRef) return;
    docRef.get().then(function (snap) {
      var remote = snap.exists ? (snap.data().marks || []) : [];
      var key = 'rr:' + book + ':' + page;
      var local = lsGet(key);
      var merged = mergeMarks(local, remote);
      lsSet(key, merged);
      try { document.dispatchEvent(new CustomEvent('rr-marks-changed')); } catch (e) {}
    }).catch(function () {});
  }

  function push() {
    if (!enabled || !docRef) return;
    var key = 'rr:' + book + ':' + page;
    var marks = lsGet(key);
    docRef.set({ marks: marks, updatedAt: Date.now() }, { merge: true }).catch(function () {});
  }

  function setEnabled(b) {
    enabled = !!b;
    try { localStorage.setItem(LS_ON, enabled ? '1' : '0'); } catch (e) {}
    if (enabled) { init().then(function(){ pull(); }).catch(function(){}); }
    return enabled;
  }

  window.__rrSync = {
    enabled: function () { return enabled; },
    available: function () { return true; },
    status: function () { return enabled ? 'firebase sync on' : 'off'; },
    setEnabled: setEnabled,
    now: function () { if (enabled) { init().then(pull).catch(function(){}); } }
  };

  // Auto-init if enabled.
  if (enabled) {
    init().then(function () { pull(); }).catch(function () {});
  }

  // Push on local changes.
  document.addEventListener('rr-marks-changed', function () {
    if (enabled) push();
  });
})();
