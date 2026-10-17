/* sync.js — cross-device mark sync for the private book-room.
 *
 * Pulls/pushes annotation state through /api/sync (Vercel function +
 * Upstash Redis; see api/sync.js). Single-user merge: union by mark uid,
 * newest timestamp wins, deletions propagate as tombstones.
 *
 * Only this page's origin participates; localhost and file:// have no
 * /api/sync, so the module silently stays off there (Export/Import in
 * settings remains the way to move marks). Syncs highlights, underlines,
 * notes and removals. Streak, progress, theme and font stay per-device.
 *
 * Listens to the rr-marks-changed event annotate.js already dispatches
 * after every save/remove, and exposes window.__rrSync for settings.
 */
(function () {
  'use strict';

  var EP = '/api/sync';
  var LS_ON = 'rr-sync-on';
  var LS_REV = 'rr-sync-rev';
  var LS_TS = 'rr-sync-ts';
  var LS_SNAP = 'rr-sync-snap';
  var LS_TOMB = 'rr-sync-tomb';
  var LS_RL = 'rr-sync-rl';
  var TOMB_TTL = 30 * 24 * 3600 * 1000;

  var alive = null;      // null = unprobed, true/false after first attempt
  var lastPushed = '';
  var pendingReload = false;
  var pushTimer = null;

  function store() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function on() {
    try { return (window.localStorage && window.localStorage.getItem(LS_ON)) === '1'; }
    catch (e) { return false; }
  }
  function num(k) {
    try { var v = parseInt((window.localStorage && window.localStorage.getItem(k)) || '0', 10); return v || 0; }
    catch (e) { return 0; }
  }
  function readJSON(k, fb) {
    try {
      var v = window.localStorage ? window.localStorage.getItem(k) : null;
      if (v === null || v === undefined) return fb;
      return JSON.parse(v);
    } catch (e) { return fb; }
  }
  function write(k, v) {
    try { if (window.localStorage) window.localStorage.setItem(k, v); } catch (e) {}
  }

  function syncableKey(k) {
    return typeof k === 'string' && (
      k.indexOf('rr:') === 0 ||
      k.indexOf('rr-import:') === 0 ||
      k.indexOf('rr-note-over:') === 0 ||
      k.indexOf('rr-hidden:') === 0 ||
      k.indexOf('rr-notes-removed:') === 0
    );
  }
  function isListKey(k) {
    return k.indexOf('rr:') === 0 || k.indexOf('rr-import:') === 0;
  }

  /* All annotation state on this device, raw strings. */
  function collect() {
    var s = store(), out = {};
    if (!s) return out;
    try {
      for (var i = 0; i < s.length; i++) {
        var k = '';
        try { k = s.key(i) || ''; } catch (e) { continue; }
        if (!syncableKey(k)) continue;
        try { out[k] = s.getItem(k); } catch (e2) {}
      }
    } catch (e) {}
    return out;
  }
  function asList(str) {
    try { var a = JSON.parse(str || '[]'); return Array.isArray(a) ? a : []; }
    catch (e) { return []; }
  }
  function asSet(str) {
    var a = asList(str), out = [];
    a.forEach(function (x) { if (typeof x === 'string') out.push(x); });
    return out;
  }
  function markTs(m) {
    return (m && typeof m.ts === 'number' && m.ts) || 0;
  }

  function getTombs() {
    var t = readJSON(LS_TOMB, {});
    return (t && typeof t === 'object') ? t : {};
  }
  function setTombs(t) {
    try { write(LS_TOMB, JSON.stringify(t)); } catch (e) {}
  }

  /* Snapshot of what we last synced, to tell a local delete apart from
   * "this device never had it". {key: {uid: ts}} for lists/overlays. */
  function getSnap() {
    var s = readJSON(LS_SNAP, {});
    return (s && typeof s === 'object') ? s : {};
  }
  function snapOf(keys) {
    var snap = {};
    Object.keys(keys).forEach(function (k) {
      if (isListKey(k)) {
        var m = {};
        asList(keys[k]).forEach(function (x) {
          if (x && typeof x.uid === 'string') m[x.uid] = markTs(x);
        });
        snap[k] = m;
      } else if (k.indexOf('rr-note-over:') === 0) {
        try {
          var o = JSON.parse(keys[k] || 'null');
          snap[k] = (o && typeof o.ts === 'number') ? o.ts : 0;
        } catch (e) { snap[k] = 0; }
      }
    });
    return snap;
  }
  function recordDeletions(current) {
    // uids in the snapshot but gone locally were deleted here: tombstone them.
    var snap = getSnap(), tombs = getTombs(), changed = false;
    var now = Date.now();
    Object.keys(snap).forEach(function (k) {
      var s = snap[k];
      if (s && typeof s === 'object' && !Array.isArray(s)) {
        var cur = {};
        asList(current[k]).forEach(function (x) {
          if (x && typeof x.uid === 'string') cur[x.uid] = 1;
        });
        Object.keys(s).forEach(function (uid) {
          if (!cur[uid]) {
            tombs[k] = tombs[k] || {};
            if (!tombs[k][uid]) { tombs[k][uid] = now; changed = true; }
          }
        });
      } else if (typeof s === 'number') {
        if (current[k] === undefined) {
          var uid = k.split(':').pop();
          tombs[k] = tombs[k] || {};
          if (!tombs[k][uid]) { tombs[k][uid] = now; changed = true; }
        }
      }
    });
    if (changed) setTombs(tombs);
    return tombs;
  }

  function mergeTombs(a, b) {
    var out = {};
    [a, b].forEach(function (t) {
      Object.keys(t || {}).forEach(function (k) {
        out[k] = out[k] || {};
        Object.keys(t[k] || {}).forEach(function (uid) {
          var v = Number((t[k] || {})[uid]) || 0;
          if (!out[k][uid] || v > out[k][uid]) out[k][uid] = v;
        });
      });
    });
    return out;
  }
  function tombed(tombs, k, uid, ts) {
    var t = tombs && tombs[k] && tombs[k][uid];
    return t ? (Number(t) || 0) >= (Number(ts) || 0) : false;
  }

  /* Merge one key. Returns the merged raw string (or null to delete). */
  function mergeKey(k, localStr, remoteStr, tombs) {
    if (isListKey(k)) {
      var byUid = {};
      asList(remoteStr).concat(asList(localStr)).forEach(function (m) {
        if (!m || typeof m.uid !== 'string') return;
        if (!byUid[m.uid] || markTs(m) > markTs(byUid[m.uid])) byUid[m.uid] = m;
      });
      var arr = Object.keys(byUid).map(function (u) { return byUid[u]; })
        .filter(function (m) { return !tombed(tombs, k, m.uid, markTs(m)); });
      arr.sort(function (a, b) { return (markTs(a) - markTs(b)) || (a.uid < b.uid ? -1 : 1); });
      // drop tomb entries for marks that came back with a newer timestamp
      var live = {};
      arr.forEach(function (m) { live[m.uid] = 1; });
      return JSON.stringify(arr);
    }
    if (k.indexOf('rr-note-over:') === 0) {
      var lo = null, ro = null;
      try { lo = JSON.parse(localStr || 'null'); } catch (e) {}
      try { ro = JSON.parse(remoteStr || 'null'); } catch (e) {}
      var pick = null;
      if (lo && ro) pick = ((lo.ts || 0) >= (ro.ts || 0)) ? lo : ro;
      else pick = lo || ro;
      if (!pick) return null;
      var kuid = k.split(':').pop();
      if (tombed(tombs, k, kuid, pick.ts || 0)) return null;
      return JSON.stringify(pick);
    }
    // hidden-baked and removed-note sets: union only (the UI never shrinks them).
    var set = {};
    asSet(remoteStr).concat(asSet(localStr)).forEach(function (x) { set[x] = 1; });
    return JSON.stringify(Object.keys(set).sort());
  }

  /* Canonical payload for compare + POST: sorted keys. */
  function payload(keys, tombs) {
    var out = {};
    Object.keys(keys).sort().forEach(function (k) { out[k] = keys[k]; });
    if (tombs && Object.keys(tombs).length) out._tomb = JSON.stringify(tombs);
    return out;
  }

  function writeLocal(merged) {
    var s = store(), changed = false;
    if (!s) return false;
    Object.keys(merged).forEach(function (k) {
      if (k === '_tomb') return;
      var nv = merged[k];
      var cur = null;
      try { cur = s.getItem(k); } catch (e) {}
      if (nv === null || nv === undefined) {
        if (cur !== null) { try { s.removeItem(k); changed = true; } catch (e) {} }
      } else if (cur !== nv) {
        try { s.setItem(k, nv); changed = true; } catch (e) {}
      }
    });
    return changed;
  }

  async function api(method, body) {
    var opt = { method: method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opt.body = JSON.stringify(body);
    var r = await fetch(EP, opt);
    if (r.status === 404) { var e = new Error('no endpoint'); e.code = 404; throw e; }
    var j = await r.json().catch(() => null);
    if (!r.ok && r.status !== 409) throw new Error('sync failed (' + r.status + ')');
    return { status: r.status, json: j || {} };
  }

  function isReader() {
    try { return !!document.querySelector('.reader-content'); } catch (e) { return false; }
  }
  function chromeBusy() {
    try {
      var c = document.getElementById('rr-tb-compose');
      if (c && c.style.display === 'block') return true;
      var p = document.getElementById('rr-popup');
      if (p && p.style.display === 'block') return true;
      var a = document.activeElement;
      if (a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT')) return true;
    } catch (e) {}
    return false;
  }
  function liveReapply() {
    // Paint incoming marks in place: no reload, no scroll jump. Falls back
    // to false on ancient cached annotate.js (caller reloads instead).
    try {
      var A = window.__rrAnnotate;
      if (A && typeof A.reapply === 'function') { A.reapply(); return true; }
    } catch (e) {}
    return false;
  }
  function clair() {
    // no reload storms: at most one sync-driven reload per 30s.
    try {
      var last = parseInt(window.localStorage.getItem(LS_RL) || '0', 10) || 0;
      if (Date.now() - last < 30000) return false;
      window.localStorage.setItem(LS_RL, String(Date.now()));
      return true;
    } catch (e) { return true; }
  }

  async function cycle(reason) {
    if (!on()) return 'off';
    if (alive === false && reason !== 'manual') return 'unavailable';
    var remote;
    try {
      var g = await api('GET');
      remote = g.json;
      if (!remote || typeof remote !== 'object' || !remote.keys) throw new Error('bad response');
      alive = true;
    } catch (e) {
      if (e && e.code === 404) alive = false;
      else if (alive === null) alive = false;
      return 'unavailable';
    }
    try {
      var local = collect();
      var tombs = mergeTombs(getTombs(), remote.keys._tomb ? JSON.parse(remote.keys._tomb) : {});
      recordDeletions(local);
      tombs = mergeTombs(getTombs(), remote.keys._tomb ? JSON.parse(remote.keys._tomb) : {});
      // prune tombs for marks long gone everywhere
      var now = Date.now(), pruned = false;
      Object.keys(tombs).forEach(function (k) {
        Object.keys(tombs[k]).forEach(function (uid) {
          if (now - tombs[k][uid] > TOMB_TTL) { delete tombs[k][uid]; pruned = true; }
        });
        if (!Object.keys(tombs[k]).length) delete tombs[k];
      });
      if (pruned) setTombs(tombs);
      var rkeys = {}, rk = remote.keys || {};
      Object.keys(rk).forEach(function (k) { if (k !== '_tomb') rkeys[k] = rk[k]; });
      var all = {};
      Object.keys(local).concat(Object.keys(rkeys)).forEach(function (k) { all[k] = 1; });
      var merged = {};
      Object.keys(all).forEach(function (k) {
        merged[k] = mergeKey(k, local[k], rkeys[k], tombs);
      });
      var wrote = writeLocal(merged);
      if (wrote) setTombs(tombs);
      try { write(LS_SNAP, JSON.stringify(snapOf(merged))); } catch (e) {}
      var canon = payload(merged, tombs);
      var rcanon = payload(rkeys, remote.keys._tomb ? JSON.parse(remote.keys._tomb || '{}') : {});
      var rev = Number(remote.rev) || 0;
      if (JSON.stringify(canon) !== JSON.stringify(rcanon)) {
        var p = await api('POST', { baseRev: rev, keys: canon });
        if (p.status === 409 && p.json.keys) {
          // someone else wrote first: take their state, re-merge, retry once.
          var c2 = p.json, rk2 = {};
          Object.keys(c2.keys || {}).forEach(function (k) { if (k !== '_tomb') rk2[k] = c2.keys[k]; });
          var t2 = mergeTombs(tombs, c2.keys._tomb ? JSON.parse(c2.keys._tomb) : {});
          var all2 = {};
          Object.keys(merged).concat(Object.keys(rk2)).forEach(function (k) { all2[k] = 1; });
          var m2 = {};
          Object.keys(all2).forEach(function (k) { m2[k] = mergeKey(k, merged[k], rk2[k], t2); });
          writeLocal(m2);
          setTombs(t2);
          try { write(LS_SNAP, JSON.stringify(snapOf(m2))); } catch (e) {}
          var canon2 = payload(m2, t2);
          var p2 = await api('POST', { baseRev: Number(c2.rev) || 0, keys: canon2 });
          rev = (p2.json && p2.json.rev) || rev;
          lastPushed = JSON.stringify(canon2);
        } else {
          rev = (p.json && p.json.rev) || rev;
          lastPushed = JSON.stringify(canon);
        }
      } else {
        lastPushed = JSON.stringify(canon);
      }
      write(LS_REV, String(rev));
      try { write(LS_TS, String(Date.now())); } catch (e) {}
      if (wrote) {
        if (isReader() && !chromeBusy() && liveReapply()) {
          // painted in place — nothing more to do
        } else if (isReader() && !chromeBusy() && clair()) {
          try { location.reload(); } catch (e) {}
        } else {
          pendingReload = true;
        }
      }
      return 'ok';
    } catch (e) {
      return 'error';
    }
  }

  function schedulePush() {
    if (!on() || alive === false) return;
    if (pushTimer) return;
    pushTimer = setTimeout(function () {
      pushTimer = null;
      cycle('change');
    }, 1000);
  }

  function status() {
    if (!on()) return 'off';
    if (alive === false) return 'unavailable here (needs the hosted site)';
    var ts = num(LS_TS);
    if (!ts) return 'on, not synced yet';
    var mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
    return 'synced ' + (mins < 1 ? 'just now' : mins + ' min ago');
  }

  window.__rrSync = {
    enabled: on,
    available: function () { return alive; },
    status: status,
    setEnabled: function (b) {
      write(LS_ON, b ? '1' : '0');
      if (b) { alive = null; cycle('manual'); }
      return on();
    },
    now: function () { alive = null; return cycle('manual'); },
  };

  try {
    document.addEventListener('rr-marks-changed', schedulePush);
  } catch (e) {}
  try {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) return;
      if (pendingReload && isReader() && !chromeBusy()) {
        pendingReload = false;
        if (!liveReapply() && clair()) {
          try { location.reload(); return; } catch (e) {}
        }
      }
      cycle('visible');
    });
  } catch (e) {}
  /* Adaptive poll: ~15s while the tab is visible (near-instant feel),
   * 60s when hidden. ~5.8k cmds/day per active device — inside the free
   * Upstash (500k/mo) and Vercel function (1M/mo) budgets for two devices. */
  var pollTimer = null;
  function pollLoop() {
    try {
      if (!document.hidden) cycle('poll');
    } catch (e) {}
    try {
      if (pollTimer) clearTimeout(pollTimer);
      pollTimer = setTimeout(pollLoop, document.hidden ? 60000 : 15000);
    } catch (e) {}
  }
  try { pollTimer = setTimeout(pollLoop, 15000); } catch (e) {}
  try {
    window.addEventListener('pagehide', function () {
      if (!on() || alive === false) return;
      try {
        var local = collect();
        var tombs = getTombs();
        var body = JSON.stringify({ baseRev: num(LS_REV), keys: payload(local, tombs) });
        fetch(EP, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: body, keepalive: true,
        }).catch(function () {});
      } catch (e) {}
    });
  } catch (e) {}
  try {
    setTimeout(function () { cycle('load'); }, 2500);
  } catch (e) {}
})();
