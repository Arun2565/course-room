/* local.js — the local-first account. No signup, no server.
 *
 * Everything the reader owns (finished books, notes, highlights, streak,
 * prefs) lives in this browser's localStorage under rr-*, rr: and rr-import:
 * keys. This module is the single place that reads and writes that shared state:
 *   RR.touch()        — record today's visit (call once per page load)
 *   RR.streak()       — {current, total} day counts
 *   RR.bookProgress() — {slug: {file: pct}} from rr-progress:* keys
 *   RR.allMarks()     — every highlight/note, newest storage first
 *   RR.exportData()   — {app, version, exportedAt, data} for download
 *   RR.importData(obj)— restore a backup, returns keys restored
 *   RR.clearData()    — wipe all rr-* keys, returns keys removed
 *   RR.storageBytes() — bytes used by rr-* keys
 *
 * Mark objects (see annotate.js): {uid, q, occ, color, style, note}.
 */
(function () {
  'use strict';

  function store() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayStr(d) {
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function readJSON(key, fallback) {
    var s = store();
    if (!s) return fallback;
    try {
      var v = JSON.parse(s.getItem(key) || 'null');
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }

  /* user marks live under rr: and baked-import marks under rr-import:;
   * everything else (progress, prefs, streak) lives under rr-. */
  function isOurs(k) {
    return k === 'rr-days' || k.indexOf('rr-') === 0 || k.indexOf('rr:') === 0;
  }

  /* ---- streak ---- */

  function getDays() {
    var a = readJSON('rr-days', []);
    return Array.isArray(a) ? a.filter(function (d) { return typeof d === 'string'; }) : [];
  }

  function touch() {
    var s = store();
    if (!s) return;
    var days = getDays(), t = dayStr(new Date());
    if (days.length && days[days.length - 1] === t) return;
    days.push(t);
    if (days.length > 400) days = days.slice(-400);
    try { s.setItem('rr-days', JSON.stringify(days)); } catch (e) {}
  }

  function streak() {
    var seen = {}, total = 0;
    getDays().forEach(function (d) { if (!seen[d]) { seen[d] = 1; total++; } });
    var cur = new Date();
    if (!seen[dayStr(cur)]) cur.setDate(cur.getDate() - 1); // streak alive if visited yesterday
    var n = 0;
    for (;;) {
      if (!seen[dayStr(cur)]) break;
      n++;
      cur.setDate(cur.getDate() - 1);
    }
    return { current: n, total: total };
  }

  /* ---- reading progress: rr-progress:<slug>:<file> -> 0-100 ---- */

  function bookProgress() {
    var s = store(), out = {};
    if (!s) return out;
    for (var i = 0; i < s.length; i++) {
      var k = '';
      try { k = s.key(i) || ''; } catch (e) { continue; }
      if (k.indexOf('rr-progress:') !== 0) continue;
      var rest = k.slice('rr-progress:'.length).split(':');
      if (rest.length < 2) continue;
      var slug = rest[0], file = rest.slice(1).join(':');
      var pct = 0;
      try { pct = Math.min(100, parseInt(s.getItem(k) || '0', 10) || 0); } catch (e) {}
      if (!out[slug]) out[slug] = {};
      out[slug][file] = pct;
    }
    return out;
  }

  /* ---- marks: rr:<book>:<page> (mine) + rr-import:<book>:<page> (imported) ---- */

  function allMarks() {
    var s = store(), out = [];
    if (!s) return out;
    for (var i = 0; i < s.length; i++) {
      var k = '';
      try { k = s.key(i) || ''; } catch (e) { continue; }
      var mine = k.indexOf('rr:') === 0;
      var imp = k.indexOf('rr-import:') === 0;
      var over = k.indexOf('rr-note-over:') === 0;
      if (!mine && !imp && !over) continue;
      if (over) {
        // rr-note-over:<book>:<page>:<uid> -> {q, note, ts}
        var op = k.slice('rr-note-over:'.length).split(':');
        if (op.length < 3) continue;
        var ov = readJSON(k, null);
        if (!ov || typeof ov.note !== 'string' || !ov.note.trim()) continue;
        out.push({
          book: op[0], page: op.slice(1, -1).join(':') || op[1], mine: false,
          over: true, q: String(ov.q || ''), note: ov.note,
          color: '', style: ''
        });
        continue;
      }
      var parts = (mine ? k.slice(3) : k.slice(11)).split(':');
      if (parts.length < 2) continue;
      var book = parts[0], page = parts.slice(1).join(':');
      var list = readJSON(k, []);
      if (!Array.isArray(list)) continue;
      list.forEach(function (m) {
        if (!m || typeof m !== 'object') return;
        out.push({
          book: book, page: page, mine: mine,
          q: String(m.q || ''), note: String(m.note || ''),
          color: String(m.color || ''), style: String(m.style || '')
        });
      });
    }
    return out;
  }

  /* ---- backup ---- */

  function exportData() {
    var s = store(), data = {};
    if (s) {
      for (var i = 0; i < s.length; i++) {
        var k = '';
        try { k = s.key(i) || ''; } catch (e) { continue; }
        if (!isOurs(k)) continue;
        try { data[k] = s.getItem(k); } catch (e) {}
      }
    }
    return { app: 'reading-room', version: 1, exportedAt: new Date().toISOString(), data: data };
  }

  function importData(obj) {
    var s = store();
    if (!s) return 0;
    if (!obj || typeof obj !== 'object' || !obj.data || typeof obj.data !== 'object') {
      throw new Error('Not a Reading Room backup file.');
    }
    var n = 0;
    Object.keys(obj.data).forEach(function (k) {
      if (!isOurs(k)) return;
      if (typeof obj.data[k] !== 'string') return;
      try { s.setItem(k, obj.data[k]); n++; } catch (e) {}
    });
    return n;
  }

  function clearData() {
    var s = store();
    if (!s) return 0;
    var drop = [];
    for (var i = 0; i < s.length; i++) {
      var k = '';
      try { k = s.key(i) || ''; } catch (e) { continue; }
      if (isOurs(k)) drop.push(k);
    }
    drop.forEach(function (k) { try { s.removeItem(k); } catch (e) {} });
    return drop.length;
  }

  function storageBytes() {
    var s = store(), n = 0;
    if (!s) return 0;
    for (var i = 0; i < s.length; i++) {
      var k = '';
      try { k = s.key(i) || ''; } catch (e) { continue; }
      if (!isOurs(k)) continue;
      try { n += (k.length + (s.getItem(k) || '').length) * 2; } catch (e) {}
    }
    return n;
  }

  window.RR = {
    touch: touch,
    streak: streak,
    bookProgress: bookProgress,
    allMarks: allMarks,
    exportData: exportData,
    importData: importData,
    clearData: clearData,
    storageBytes: storageBytes
  };
})();
