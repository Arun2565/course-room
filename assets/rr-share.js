/* rr-share — take your annotations with you.
 *
 * A reader marks up an article in a browser; the marks live in that
 * browser's localStorage. This turns them into something portable:
 *   - text   : Markdown (quote + note) to paste into any notes app
 *   - a file : JSON with the full mark objects, so the same file can be
 *              imported later and re-anchored onto the article by quote
 *              plus surrounding context — the same way the reader
 *              re-anchors its own marks when the text shifts.
 * Sharing uses the Web Share API where the phone has it, with copy and
 * download as fallbacks.
 *
 * Public API (window.RRShare):
 *   marks(scope)       -> array of mark objects
 *   markdown(marks)    -> string
 *   json(marks)        -> string
 *   share(marks)       -> Promise ('shared' | 'copied' | 'cancelled')
 *   copy(text)         -> Promise<boolean>
 *   download(name,text)-> void
 *   importJSON(text)   -> {applied, skipped}
 *
 * Markup is written by this file, so it works on any page that loads
 * it: the reader drawer (marks on this page) and the settings page.
 */
(function () {
  'use strict';

  var FONT_KEY = 'rr-article-font';
  var DEFAULT_FONT = 'source-serif';

  function store() {
    try { return window.localStorage || null; } catch (e) { return null; }
  }
  function readJSON(k, fallback) {
    var s = store();
    if (!s) return fallback;
    try {
      var v = JSON.parse(s.getItem(k) || 'null');
      return (v === null || v === undefined) ? fallback : v;
    } catch (e) { return fallback; }
  }
  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function pretty(slug) {
    return String(slug || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, function (c) {
      return c.toUpperCase();
    });
  }

  /* ---- which page am I on ------------------------------------------- */
  function currentBook() {
    var tag = document.querySelector('script[data-rr-book]');
    var book = tag ? (tag.getAttribute('data-rr-book') || '') : '';
    var page = '';
    if (tag) page = tag.getAttribute('data-rr-page') || '';
    if (!page) page = (location.pathname.split('/').pop() || '');
    return { book: book, page: page };
  }

  /* ---- collect marks ------------------------------------------------ */
  function pack(book, page, a, mine) {
    return {
      book: book, page: page, q: String(a.q || ''),
      nq: String(a.nq || ''),
      occ: (a.occ == null ? null : a.occ),
      ctx: (a.ctx && typeof a.ctx === 'object') ? a.ctx : null,
      color: String(a.color || ''), style: String(a.style || ''),
      note: String(a.note || ''), ts: Number(a.ts) || 0,
      mine: !!mine, baked: !!a.baked
    };
  }

  function collect(scope) {
    var s = store();
    if (!s) return [];
    var cur = currentBook();
    var onThisPage = function (b, p) {
      return !scope || scope === 'all' || (b === cur.book && p === cur.page);
    };
    var out = [], i, k, list, parts, rest, book, page;
    for (i = 0; i < s.length; i++) {
      k = s.key(i) || '';
      if (k.indexOf('rr:') === 0) {
        rest = k.slice(3).split(':');
        book = rest[0]; page = rest.slice(1).join(':');
        if (!onThisPage(book, page)) continue;
        list = readJSON(k, []);
        if (!Array.isArray(list)) continue;
        list.forEach(function (a) {
          if (a && a.q) out.push(pack(book, page, a, true));
        });
      } else if (k.indexOf('rr-import:') === 0) {
        rest = k.slice(10).split(':');
        book = rest[0]; page = rest.slice(1).join(':');
        if (!onThisPage(book, page)) continue;
        list = readJSON(k, []);
        if (!Array.isArray(list)) continue;
        list.forEach(function (a) {
          if (a && a.q) out.push(pack(book, page, a, false));
        });
      } else if (k.indexOf('rr-note-over:') === 0) {
        parts = k.slice('rr-note-over:'.length).split(':');
        if (parts.length < 3) continue;
        var ov = readJSON(k, null);
        if (!ov || !ov.q) continue;
        book = parts[0]; page = parts.slice(1, -1).join(':') || parts[1];
        if (!onThisPage(book, page)) continue;
        out.push({
          book: book, page: page, q: String(ov.q || ''), nq: '',
          occ: null, ctx: null, color: '', style: 'note',
          note: String(ov.note || ''), ts: Number(ov.ts) || 0,
          mine: true, baked: true
        });
      }
    }
    return out;
  }

  /* ---- render -------------------------------------------------------- */
  function groupBy(marks) {
    var order = [], groups = {};
    marks.forEach(function (m) {
      var key = m.book + '\u0000' + m.page;
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(m);
    });
    return order.map(function (k) {
      var p = k.split('\u0000');
      return { book: p[0], page: p[1], marks: groups[k] };
    });
  }

  function markdown(marks) {
    if (!marks || !marks.length) return '';
    var out = [], g = groupBy(marks);
    g.forEach(function (grp) {
      out.push('## ' + pretty(grp.book) + ' \u2014 ' + pretty(grp.page));
      out.push('');
      grp.marks.forEach(function (m) {
        var q = m.q.replace(/\s+/g, ' ').trim();
        out.push('> ' + q);
        if (m.note) {
          out.push('');
          out.push('Note: ' + m.note.replace(/\s+/g, ' ').trim());
        }
        out.push('');
      });
    });
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  function json(marks) {
    return JSON.stringify({
      app: 'reading-room',
      kind: 'rr-marks',
      version: 1,
      exportedAt: new Date().toISOString(),
      source: location.href,
      marks: marks || []
    }, null, 2);
  }

  /* ---- output channels ---------------------------------------------- */
  function fileName(ext) {
    var d = new Date(), p = function (x) { return (x < 10 ? '0' : '') + x; };
    return 'article-room-marks-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.' + ext;
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; },
        function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      var ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) { return false; }
  }

  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/octet-stream' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function share(marks) {
    var md = markdown(marks);
    var name = fileName('json');
    var file = null;
    try {
      file = new File([json(marks)], name, { type: 'application/json' });
    } catch (e) { file = null; }
    if (navigator.share) {
      var payload = { title: 'Article Room annotations', text: md };
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) payload.files = [file];
      return navigator.share(payload).then(function () { return 'shared'; },
        function (e) {
          if (e && e.name === 'AbortError') return 'cancelled';
          return copy(md).then(function (ok) { return ok ? 'copied' : 'failed'; });
        });
    }
    return copy(md).then(function (ok) { return ok ? 'copied' : 'failed'; });
  }

  /* ---- import -------------------------------------------------------- */
  function attachOverlay(book, page, q, note) {
    /* a note pinned onto a mark that is already in the page: find the
     * span with the same words and write the overlay key for it. */
    var spans = document.querySelectorAll('span.ann-hl, span.ann-note, span.ann-ul');
    var target = null, nq = norm(q);
    for (var i = 0; i < spans.length; i++) {
      if (norm(spans[i].textContent) === nq) { target = spans[i]; break; }
    }
    if (!target) return false;
    if (!target.dataset.rrId) target.dataset.rrId = 'b-' + i;
    var key = 'rr-note-over:' + book + ':' + page + ':' + target.dataset.rrId;
    try {
      localStorage.setItem(key, JSON.stringify({ q: q, note: note, ts: Date.now() }));
    } catch (e) { return false; }
    return true;
  }

  function importJSON(text) {
    var data;
    try { data = JSON.parse(text); } catch (e) { return { applied: 0, skipped: 0, error: 'That file is not a Reading Room marks file.' }; }
    if (!data || data.kind !== 'rr-marks' || !Array.isArray(data.marks)) {
      return { applied: 0, skipped: 0, error: 'That file is not a Reading Room marks file.' };
    }
    var applied = 0, skipped = 0, s = store();
    if (!s) return { applied: 0, skipped: 0, error: 'This browser will not let the page save anything.' };
    data.marks.forEach(function (m) {
      if (!m || !m.q || !m.book) { skipped++; return; }
      if (m.baked) {
        /* a note on a mark that already lives in the page */
        if (attachOverlay(m.book, m.page, m.q, m.note || '')) applied++;
        else skipped++;
        return;
      }
      var key = 'rr-import:' + m.book + ':' + m.page;
      var list = readJSON(key, []);
      if (!Array.isArray(list)) list = [];
      var dupe = list.some(function (x) {
        return x && norm(x.q) === norm(m.q) && norm(x.note) === norm(m.note);
      });
      if (dupe) { skipped++; return; }
      list.push({
        uid: 'imp-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
        q: m.q, nq: m.nq || norm(m.q),
        occ: (m.occ == null ? null : m.occ), ctx: m.ctx || null,
        color: m.color || '', style: m.style || '',
        note: m.note || '', ts: Number(m.ts) || Date.now(), mine: false
      });
      try { s.setItem(key, JSON.stringify(list)); applied++; } catch (e) { skipped++; }
    });
    try { window.dispatchEvent(new CustomEvent('rr-marks-changed')); } catch (e) {}
    try {
      if (window.__rrAnnotate && window.__rrAnnotate.reapply) window.__rrAnnotate.reapply();
    } catch (e) {}
    return { applied: applied, skipped: skipped };
  }

  /* ---- reader drawer ------------------------------------------------ */
  function buildDrawerFoot(drawer) {
    if (!drawer || document.getElementById('rr-share-foot')) return;
    var foot = document.createElement('div');
    foot.className = 'rr-share-foot';
    foot.id = 'rr-share-foot';
    foot.innerHTML =
      '<div class="rr-share-title">Take these with you</div>' +
      '<div class="rr-share-scope">' +
      '<label><input type="radio" name="rr-share-scope" value="page" checked> This page</label>' +
      '<label><input type="radio" name="rr-share-scope" value="all"> Everything</label>' +
      '</div>' +
      '<div class="rr-share-actions">' +
      '<button type="button" id="rr-share-copy">Copy as text</button>' +
      '<button type="button" id="rr-share-sys">Share\u2026</button>' +
      '<button type="button" id="rr-share-json">Save JSON</button>' +
      '</div>' +
      '<div class="rr-share-status" id="rr-share-status"></div>';
    drawer.appendChild(foot);

    var status = document.getElementById('rr-share-status');
    function say(msg) { status.textContent = msg; }
    function scope() {
      var r = foot.querySelector('input[name="rr-share-scope"]:checked');
      return r ? r.value : 'page';
    }
    function marks() { return collect(scope()); }

    document.getElementById('rr-share-copy').onclick = function () {
      var m = marks();
      if (!m.length) { say('No annotations on this page yet.'); return; }
      copy(markdown(m)).then(function (ok) {
        say(ok ? 'Copied ' + m.length + ' annotation' + (m.length === 1 ? '' : 's') + '.'
                : 'Could not reach the clipboard.');
      });
    };
    document.getElementById('rr-share-sys').onclick = function () {
      var m = marks();
      if (!m.length) { say('No annotations on this page yet.'); return; }
      share(m).then(function (r) {
        if (r === 'shared') say('Shared ' + m.length + ' annotation' + (m.length === 1 ? '' : 's') + '.');
        else if (r === 'copied') say('Copied to the clipboard.');
        else if (r === 'cancelled') say('');
        else say('Sharing is not available here \u2014 use Save JSON.');
      });
    };
    document.getElementById('rr-share-json').onclick = function () {
      var m = marks();
      if (!m.length) { say('No annotations on this page yet.'); return; }
      download(fileName('json'), json(m), 'application/json');
      say('Saved ' + m.length + ' annotation' + (m.length === 1 ? '' : 's') + '.');
    };
  }

  function wireDrawer() {
    var drawer = document.getElementById('rr-drawer');
    if (!drawer) return;
    buildDrawerFoot(drawer);
    /* the drawer is rebuilt by annotate.js on some pages: re-attach */
    var list = document.getElementById('rr-draw-list');
    if (list && !list.parentNode) return;
  }

  /* ---- settings page ------------------------------------------------ */
  function wireSettings() {
    var host = document.getElementById('backup-status');
    var exportBtn = document.getElementById('btn-export');
    if (!exportBtn || document.getElementById('btn-share-marks')) return;
    var row = exportBtn.parentNode;
    if (!row) return;

    var shareBtn = document.createElement('button');
    shareBtn.className = 'btn';
    shareBtn.id = 'btn-share-marks';
    shareBtn.textContent = 'Share marks';
    var importBtn = document.createElement('button');
    importBtn.className = 'btn';
    importBtn.id = 'btn-import-marks';
    importBtn.textContent = 'Import marks';
    var fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json,.json';
    fileInput.id = 'file-import-marks';
    fileInput.hidden = true;

    row.appendChild(shareBtn);
    row.appendChild(importBtn);
    row.appendChild(fileInput);

    function say(msg) { if (host) host.textContent = msg; }

    shareBtn.onclick = function () {
      var m = collect('all');
      if (!m.length) { say('No annotations yet \u2014 read something first.'); return; }
      share(m).then(function (r) {
        if (r === 'shared') say('Shared ' + m.length + ' annotation' + (m.length === 1 ? '' : 's') + '.');
        else if (r === 'copied') say('Copied ' + m.length + ' annotation' + (m.length === 1 ? '' : 's') + ' to the clipboard.');
        else if (r === 'cancelled') say('');
        else say('Sharing is not available in this browser.');
      });
    };
    importBtn.onclick = function () { fileInput.click(); };
    fileInput.onchange = function (ev) {
      var f = ev.target.files && ev.target.files[0];
      if (!f) return;
      var rd = new FileReader();
      rd.onload = function () {
        var res = importJSON(String(rd.result || ''));
        if (res.error) { say(res.error); }
        else {
          say('Restored ' + res.applied + ' annotation' + (res.applied === 1 ? '' : 's') +
              (res.skipped ? ', skipped ' + res.skipped + ' already there' : '') + '.');
        }
      };
      rd.readAsText(f);
      ev.target.value = '';
    };
  }

  /* ---- boot ---------------------------------------------------------- */
  function boot() {
    wireDrawer();
    wireSettings();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
  /* the drawer is created by annotate.js on DOMContentLoaded, which may
   * run after ours: look again once the page is fully up. */
  window.setTimeout(boot, 0);
  window.setTimeout(boot, 400);

  window.RRShare = {
    marks: collect,
    markdown: markdown,
    json: json,
    share: share,
    copy: copy,
    download: download,
    importJSON: importJSON,
    fileName: fileName
  };
})();
