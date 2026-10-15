/* rr-annotate: highlight / underline / note layer for annotated-reader pages.
 * Static-safe: no build, no server. User marks persist in localStorage per page.
 * Coexists with the page's own scripts (progress bar, TOC, theme, Prism). */
(function () {
  'use strict';

  var scriptTag = document.currentScript;
  var BOOK = scriptTag.getAttribute('data-rr-book') || 'book';
  var PAGE = scriptTag.getAttribute('data-rr-page') || location.pathname.split('/').pop();
  var PREFIX = scriptTag.getAttribute('data-rr-prefix') || '../';
  var LS_USER = 'rr:' + BOOK + ':' + PAGE;
  var LS_IMPORT = 'rr-import:' + BOOK + ':' + PAGE;

  // Underline is always bright red: one tap, no palette step. Highlights
  // get four options — red stays reserved for underlines.
  var UNDERLINE_COLOR = '#FF3B30';
  var HL_PALETTE = ['#FFE600', '#FF9E40', '#8AB8FF', '#7AE8A8'];
  var HL_NAMES = { '#FFE600': 'yellow', '#FF9E40': 'orange', '#8AB8FF': 'blue', '#7AE8A8': 'green' };

  function norm(s) {
    return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
  }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch (e) { return []; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function cssEsc(s) {
    try {
      if (window.CSS && window.CSS.escape) return window.cssEsc(s);
    } catch (e) {}
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  /* ---------- baked-in (skill) marks ---------- */
  var bakedNotes = {};
  try {
    var nj = document.getElementById('rr-notes');
    if (nj) bakedNotes = JSON.parse(nj.textContent || '{}');
  } catch (e) {}

  function hiddenBaked() {
    try { return new Set(JSON.parse(localStorage.getItem('rr-hidden:' + BOOK) || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveHiddenBaked(set) {
    try { localStorage.setItem('rr-hidden:' + BOOK, JSON.stringify(Array.from(set))); } catch (e) {}
  }

  /* Unwrap a mark span but keep its words: children move up into the
   * parent, render-time sidenote numbers are dropped. Removing an
   * annotation must never delete text — only the styling goes. */
  function unwrapSpan(sp) {
    try {
      var parent = sp.parentNode;
      if (!parent) return;
      sp.querySelectorAll('.rr-nref').forEach(function (n) { n.remove(); });
      while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
      parent.removeChild(sp);
    } catch (e) {}
  }
  function removedNotes() {
    try { return new Set(JSON.parse(localStorage.getItem('rr-notes-removed:' + BOOK) || '[]')); }
    catch (e) { return new Set(); }
  }
  function saveRemovedNotes(set) {
    try { localStorage.setItem('rr-notes-removed:' + BOOK, JSON.stringify(Array.from(set))); } catch (e) {}
  }

  /* User notes pinned onto baked / imported marks. Baked HTML cannot be
   * rewritten from the browser, so a note added onto a baked mark lives
   * here instead of as a new (unrenderable, overlapping) mark.
   * Key: rr-note-over:<book>:<page>:<uid> -> {q, note, ts} */
  function overKey(uid) {
    return 'rr-note-over:' + BOOK + ':' + PAGE + ':' + uid;
  }
  function getOverlay(uid) {
    try {
      var o = JSON.parse(localStorage.getItem(overKey(uid)) || 'null');
      if (o && typeof o === 'object' && typeof o.note === 'string' && o.note.trim()) return o;
    } catch (e) {}
    return null;
  }
  function setOverlay(uid, q, note) {
    try {
      if (!note || !note.trim()) localStorage.removeItem(overKey(uid));
      else localStorage.setItem(overKey(uid), JSON.stringify({ q: q || '', note: note, ts: Date.now() }));
    } catch (e) {}
  }
  function bakedMarks() {
    var hidden = hiddenBaked();
    var rn = removedNotes();
    var out = [];
    document.querySelectorAll('span.ann-hl, span.ann-note, span.ann-ul').forEach(function (sp, i) {
      if (!sp.dataset.rrId) sp.dataset.rrId = 'b-' + i;
      // strip sidenote reference numbers: they are render-time only and
      // must not pollute quote matching or note lookup
      var q;
      try {
        var clone = sp.cloneNode(true);
        clone.querySelectorAll('.rr-nref').forEach(function (n) { n.remove(); });
        q = clone.textContent;
      } catch (e) { q = sp.textContent; }
      if (hidden.has(norm(q))) { unwrapSpan(sp); return; }
      var note = bakedNotes[norm(q)] || '';
      if (rn.has(norm(q))) note = '';
      // a user note pinned onto this baked mark wins over its baked note
      try {
        var ov = getOverlay(sp.dataset.rrId);
        if (ov) note = ov.note;
      } catch (e2) {}
      out.push({
        uid: sp.dataset.rrId, q: q, note: note,
        color: cssColor(sp), style: sp.classList.contains('ann-note') ? 'note-highlight' : (sp.classList.contains('ann-ul') ? 'underline' : 'highlight'),
        baked: true, el: sp
      });
    });
    return out;
  }
  function cssColor(sp) {
    var st = sp.style;
    var bg = st.background || st.backgroundColor || '';
    var m = bg.match(/#[0-9a-fA-F]{6}/) || (st.borderBottom || st.border || '').match(/#[0-9a-fA-F]{6}/) || (st.textDecorationColor || '').match(/#[0-9a-fA-F]{3,6}/);
    return m ? m[0] : '#FFE066';
  }

  /* ---------- user marks ---------- */
  function userMarks() { return lsGet(LS_USER); }
  function importMarks() { return lsGet(LS_IMPORT); }
  function saveUser(list) { lsSet(LS_USER, list); }

  function removeMark(uid, a) {
    try { localStorage.removeItem(overKey(uid)); } catch (e0) {}
    var list = userMarks(), i = list.findIndex(function (x) { return x.uid === uid; });
    if (i !== -1) { list.splice(i, 1); saveUser(list); return; }
    var imp = importMarks(); i = imp.findIndex(function (x) { return x.uid === uid; });
    if (i !== -1) { imp.splice(i, 1); lsSet(LS_IMPORT, imp); return; }
    var q = (a && a.q) || '';
    if (!q) {
      var el0 = document.querySelector('[data-rr-id="' + cssEsc(uid) + '"]');
      if (el0) q = el0.textContent;
    }
    if (q) {
      var hidden = hiddenBaked();
      hidden.add(norm(q));
      saveHiddenBaked(hidden);
    }
    var el = document.querySelector('[data-rr-id="' + cssEsc(uid) + '"]');
    if (el) unwrapSpan(el);
  }

  function removeNote(uid, a) {
    try { localStorage.removeItem(overKey(uid)); } catch (e0) {}
    var list = userMarks(), i = list.findIndex(function (x) { return x.uid === uid; });
    if (i !== -1) { list[i].note = ''; saveUser(list); return; }
    var imp = importMarks(); i = imp.findIndex(function (x) { return x.uid === uid; });
    if (i !== -1) { imp[i].note = ''; lsSet(LS_IMPORT, imp); return; }
    var q = (a && a.q) || '';
    if (!q) {
      var el0 = document.querySelector('[data-rr-id="' + cssEsc(uid) + '"]');
      if (el0) q = el0.textContent;
    }
    if (q) {
      var rn = removedNotes();
      rn.add(norm(q));
      saveRemovedNotes(rn);
    }
    var el = document.querySelector('[data-rr-id="' + cssEsc(uid) + '"]');
    if (el) el.removeAttribute('title');
  }

  /* ---------- text index (skips code, existing marks, rr UI) ---------- */
  function indexDoc() {
    var seq = [];
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        var p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        var tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        if (p.closest && p.closest('pre, code, .ann-hl, .ann-note, .ann-ul, .rr-u, .rr-ui, .rr-sticky')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    var nodes = [], n;
    while ((n = walker.nextNode())) nodes.push(n);
    var lastSpace = true;
    nodes.forEach(function (node) {
      var t = node.nodeValue;
      for (var i = 0; i < t.length; i++) {
        var c = t[i];
        if (/\s/.test(c)) {
          if (!lastSpace) { seq.push({ ch: ' ', node: node, off: i }); lastSpace = true; }
        } else { seq.push({ ch: c.toLowerCase(), node: node, off: i }); lastSpace = false; }
      }
    });
    if (seq.length && seq[0].ch === ' ') seq.shift();
    return seq;
  }

  function occurrences(text, quote) {
    var out = [], i = text.indexOf(quote);
    while (i !== -1) { out.push(i); i = text.indexOf(quote, i + 1); }
    return out;
  }

  function wrapRange(node, start, end, ann) {
    if (!node || start >= end) return null;
    var len = (node.nodeValue != null) ? node.nodeValue.length : -1;
    if (len < 0 || start < 0 || end > len) return null;
    var range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, end);
    var span = document.createElement('span');
    span.className = 'rr-u rr-u-' + (ann.style === 'underline' ? 'ul' : 'hl') + (ann.note ? ' rr-has-note' : '');
    span.dataset.rrUid = ann.uid;
    if (ann.style === 'underline') {
      // text-decoration (not border-bottom): a border only paints under the
      // LAST line of a multi-line mark, making most underlines invisible.
      // skip-ink:none keeps one continuous line (no gaps at descenders).
      span.style.textDecoration = 'underline';
      span.style.textDecorationColor = ann.color;
      span.style.textDecorationThickness = '2px';
      span.style.textUnderlineOffset = '3px';
      span.style.textDecorationSkipInk = 'none';
    } else {
      span.style.background = ann.color;
      span.style.background = 'color-mix(in srgb, ' + ann.color + ' 38%, transparent)';
    }
    if (ann.note) span.title = String(ann.note).slice(0, 160);
    try { range.surroundContents(span); }
    catch (e) {
      try {
        var frag = range.extractContents();
        span.appendChild(frag);
        range.insertNode(span);
      } catch (e2) { return null; }
    }
    return span;
  }

  function applyAnn(seq, text, ann) {
    var nq = norm(ann.q);
    if (!nq) return 0;
    var occs = occurrences(text, nq);
    if (!occs.length) return 0;
    var targets = (ann.occ == null) ? occs.map(function (_, k) { return k; }) : [ann.occ];
    // Reverse order: wrapping a range splits its text nodes, which would
    // invalidate the (node, offset) references of ranges before it.
    // Wrapping back-to-front keeps every earlier reference intact.
    targets.sort(function (a, b) { return (b || 0) - (a || 0); });
    var applied = 0, skipped = 0;
    targets.forEach(function (k) {
      if (k == null || k >= occs.length) return;
      var slice = seq.slice(occs[k], occs[k] + nq.length);
      var groups = [], cur = null;
      slice.forEach(function (s) {
        if (!cur || cur.node !== s.node || s.off !== cur.end) {
          cur = { node: s.node, start: s.off, end: s.off + 1 };
          groups.push(cur);
        } else { cur.end = s.off + 1; }
      });
      groups.sort(function (a, b) { return b.start - a.start; });
      groups.forEach(function (g) {
        if (wrapRange(g.node, g.start, g.end, ann)) applied++;
        else skipped++;
      });
    });
    if (skipped && !applied) {
      try { console.warn('[rr-annotate] could not place mark, skipped groups:', skipped); } catch (e) {}
    }
    return applied;
  }

  function clearUserMarks() {
    document.querySelectorAll('.rr-u').forEach(function (sp) {
      var parent = sp.parentNode;
      while (sp.firstChild) parent.insertBefore(sp.firstChild, sp);
      parent.removeChild(sp);
    });
    // sidenote reference numbers are render-time only: drop them so they
    // never accumulate on baked marks or pollute quote matching
    document.querySelectorAll('.rr-nref').forEach(function (sp) {
      if (sp.parentNode) sp.parentNode.removeChild(sp);
    });
  }

  function applyAll() {
    clearUserMarks();
    var seq = indexDoc();
    var text = seq.map(function (s) { return s.ch; }).join('');
    userMarks().concat(importMarks()).forEach(function (a) { applyAnn(seq, text, a); });
    bindMarkClicks();
    renderStickies();
    refreshDrawer();
  }

  /* ---------- selection toolbar ---------- */
  var pending = null, pendingStyle = 'highlight', pendingColor = HL_PALETTE[0];

  function marksOverlapping(range) {
    var found = [], seen = {};
    document.querySelectorAll('.rr-u, span.ann-hl, span.ann-note, span.ann-ul').forEach(function (sp) {
      if (sp.style.display === 'none') return;
      var uid = sp.dataset.rrUid || sp.dataset.rrId;
      if (!uid || seen[uid]) return;
      try {
        if (range.intersectsNode(sp)) { seen[uid] = 1; found.push(uid); }
      } catch (e) {}
    });
    return found;
  }

  function ensureToolbar() {
    var tb = document.getElementById('rr-toolbar');
    if (tb) return tb;
    tb = document.createElement('div');
    tb.id = 'rr-toolbar';
    tb.className = 'rr-ui';
    tb.setAttribute('role', 'toolbar');
    tb.setAttribute('aria-label', 'Mark the selected text');
    // Three zones read left to right: mark it, ink it, write on it. Tapping a
    // swatch highlights instantly in that color. Underline is one tap, red.
    tb.innerHTML =
      '<button class="rr-underline" data-rr-style="underline" title="Underline in red" aria-label="Underline in red">' +
        '<span class="rr-rule" aria-hidden="true"></span><span>Underline</span></button>' +
      '<span class="rr-div" aria-hidden="true"></span>' +
      '<div class="rr-tray">' +
        HL_PALETTE.map(function (c) {
          return '<button class="rr-sw" data-rr-color="' + c + '" style="background:' + c + '" title="Highlight ' + HL_NAMES[c] + '" aria-label="Highlight ' + HL_NAMES[c] + '"></button>';
        }).join('') +
      '</div>' +
      '<span class="rr-div" aria-hidden="true"></span>' +
      '<button id="rr-tb-note" title="Write a note on the selected text">Note</button>' +
      '<button id="rr-tb-remove" style="display:none">Remove</button>' +
      '<div id="rr-tb-compose" style="display:none">' +
        '<div id="rr-tb-quote"></div>' +
        '<textarea id="rr-tb-text" rows="2" placeholder="Write a note on this passage…"></textarea>' +
        '<div class="rr-tb-actions"><button id="rr-tb-save">Save note</button>' +
        '<button id="rr-tb-cancel">Cancel</button></div>' +
      '</div>';
    document.body.appendChild(tb);
    tb.querySelector('[data-rr-style]').addEventListener('mousedown', function (e) {
      e.preventDefault();
      pendingStyle = 'underline';
      pendingColor = UNDERLINE_COLOR;
      paintSwatches();
    });
    tb.querySelector('[data-rr-style]').addEventListener('click', function () { savePending(false); });
    tb.querySelectorAll('.rr-sw').forEach(function (s) {
      s.addEventListener('mousedown', function (e) { e.preventDefault(); });
      s.addEventListener('click', function () {
        pendingStyle = 'highlight';
        pendingColor = s.dataset.rrColor;
        paintSwatches();
        savePending(false);
      });
    });
    document.getElementById('rr-tb-note').addEventListener('mousedown', function (e) { e.preventDefault(); });
    document.getElementById('rr-tb-note').addEventListener('click', function () { toggleComposer(); });
    document.getElementById('rr-tb-save').addEventListener('mousedown', function (e) { e.preventDefault(); });
    document.getElementById('rr-tb-save').addEventListener('click', function () { saveComposer(); });
    document.getElementById('rr-tb-cancel').addEventListener('mousedown', function (e) { e.preventDefault(); });
    document.getElementById('rr-tb-cancel').addEventListener('click', function () { closeComposer(); });
    document.getElementById('rr-tb-remove').addEventListener('mousedown', function (e) { e.preventDefault(); });
    document.getElementById('rr-tb-remove').addEventListener('click', function () { removePending(); });
    paintSwatches();
    return tb;
  }
  function paintSwatches() {
    document.querySelectorAll('#rr-toolbar .rr-sw').forEach(function (s) {
      s.classList.toggle('on', pendingStyle === 'highlight' && s.dataset.rrColor === pendingColor);
    });
    document.querySelectorAll('#rr-toolbar [data-rr-style]').forEach(function (b) {
      b.classList.toggle('on', b.dataset.rrStyle === pendingStyle);
    });
  }
  function hideToolbar() {
    var tb = document.getElementById('rr-toolbar');
    if (tb) tb.style.display = 'none';
    pending = null;
    closeComposer();
  }
  function toolbarError(msg) {
    try { console.error('[rr-annotate] ' + msg); } catch (e2) {}
    var tb = ensureToolbar();
    var e = document.getElementById('rr-tb-err');
    if (!e) {
      e = document.createElement('span');
      e.id = 'rr-tb-err';
      e.className = 'rr-ui';
      tb.appendChild(e);
    }
    e.textContent = '⚠ ' + msg;
    tb.style.display = 'flex';
  }
  var lastRect = null;
  function showToolbar(rect, overlapping) {
    hideUnmark();
    closeComposer();
    var tb = ensureToolbar();
    tb.style.display = 'flex';
    var eb = document.getElementById('rr-tb-err');
    if (eb) eb.textContent = '';
    paintSwatches();
    var rmBtn = document.getElementById('rr-tb-remove');
    if (rmBtn) {
      rmBtn.style.display = (overlapping && overlapping.length) ? '' : 'none';
      rmBtn.title = (overlapping && overlapping.length > 1)
        ? 'Remove ' + overlapping.length + ' annotations'
        : 'Remove this annotation';
    }
    var tw = tb.offsetWidth || 300, th = tb.offsetHeight || 38;
    lastRect = rect;
    placeToolbar(rect, tw, th);
  }
  function placeToolbar(rect, tw, th) {
    var tb = ensureToolbar();
    tw = tw || tb.offsetWidth || 300;
    th = th || tb.offsetHeight || 38;
    var x = Math.min(Math.max(8, rect.left + rect.width / 2 - tw / 2), Math.max(8, window.innerWidth - tw - 8));
    var y = rect.bottom + 8;
    if (y + th + 8 > window.innerHeight) y = rect.top - th - 8;
    y = Math.min(Math.max(8, y), Math.max(8, window.innerHeight - th - 8));
    tb.style.left = x + 'px';
    tb.style.top = y + 'px';
  }

  document.addEventListener('mouseup', function (e) {
    // writing or clicking inside the bar itself must not restart selection
    try {
      var tb0 = document.getElementById('rr-toolbar');
      if (tb0 && e && e.target && (tb0 === e.target || tb0.contains(e.target))) return;
    } catch (e2) {}
    setTimeout(function () {
      var sel = window.getSelection();
      if (!sel.rangeCount) return;
      var r = sel.getRangeAt(0);
      if (r.collapsed || !norm(r.toString())) return;
      var node = r.commonAncestorContainer;
      var el = node.nodeType === 1 ? node : node.parentElement;
      if (el && el.closest && el.closest('pre, code, .rr-ui')) return;
      var rects = r.getClientRects();
      if (!rects.length) return;
      pending = { range: r.cloneRange(), quote: r.toString(), overlap: marksOverlapping(r) };
      showToolbar(rects[0], pending.overlap);
    }, 30);
  });
  document.addEventListener('mousedown', function (e) {
    var tb = document.getElementById('rr-toolbar');
    if (tb && (tb === e.target || tb.contains(e.target))) return;
    if (e.target.closest && e.target.closest('.rr-ui')) return;
    hideToolbar();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideToolbar(); hidePopup(); } });

  function savePending(withNoteUI) {
    try {
      savePendingInner(withNoteUI);
    } catch (err) {
      toolbarError('could not save (' + ((err && err.message) || err) + ')');
    }
  }
  function savePendingInner(withNoteUI) {
    if (!pending || !pending.range) return;
    var range = pending.range, quote = pending.quote;
    if (!norm(quote)) return;
    var seq = indexDoc();
    var text = seq.map(function (s) { return s.ch; }).join('');
    var nq = norm(quote);
    var occs = occurrences(text, nq);
    var occ = 0;
    if (occs.length > 1) {
      for (var k = 0; k < occs.length; k++) {
        var s0 = seq[occs[k]], s1 = seq[occs[k] + nq.length - 1];
        try {
          var cand = document.createRange();
          cand.setStart(s0.node, s0.off); cand.setEnd(s1.node, s1.off + 1);
          if (range.compareBoundaryPoints(Range.START_TO_END, cand) < 0 &&
              range.compareBoundaryPoints(Range.END_TO_START, cand) > 0) { occ = k; break; }
        } catch (e) {}
      }
    }
    var ann = {
      uid: 'u-' + Date.now().toString(36), q: quote.replace(/\s+/g, ' ').trim(),
      occ: occ, color: pendingColor, style: pendingStyle,
      note: pendingNoteText || '', ts: Date.now(), mine: true
    };
    var list = userMarks();
    list.push(ann);
    saveUser(list);
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    hideToolbar();
    applyAll();
    if (withNoteUI) openPopup(ann.uid, true);
    else flashUid(ann.uid);
  }

  function removePending() {
    if (!pending || !pending.overlap || !pending.overlap.length) return;
    pending.overlap.forEach(function (uid) {
      removeMark(uid, findAnn(uid));
    });
    try { window.getSelection().removeAllRanges(); } catch (e) {}
    hideToolbar();
    applyAll();
  }

  /* ---------- inline note composer (write the note in the bar itself) ---------- */
  var composeEditUid = null;
  var composeBakedUid = null;
  var pendingNoteText = '';
  function closeComposer() {
    var c = document.getElementById('rr-tb-compose');
    if (c) c.style.display = 'none';
    var t = document.getElementById('rr-tb-text');
    if (t) t.value = '';
    var nb = document.getElementById('rr-tb-note');
    if (nb) nb.classList.remove('on');
    composeEditUid = null;
    composeBakedUid = null;
  }
  function toggleComposer() {
    var c = document.getElementById('rr-tb-compose');
    if (!c || !pending) return;
    if (c.style.display !== 'none') { closeComposer(); return; }
    // editing path: exactly one overlapping mark. The reader's own marks
    // are edited in place; a note on a baked / imported mark is pinned
    // onto it as an overlay (see overKey) instead of a new overlapping
    // mark, which could never re-render over wrapped text.
    composeEditUid = null;
    composeBakedUid = null;
    var pre = '';
    if (pending.overlap && pending.overlap.length === 1) {
      var a = findAnn(pending.overlap[0]);
      if (a) {
        if (a.mine) composeEditUid = a.uid;
        else composeBakedUid = a.uid;
        pre = a.note || '';
      }
    }
    var q0 = document.getElementById('rr-tb-quote');
    if (q0) q0.textContent = '\u201C' + String(pending.quote).replace(/\s+/g, ' ').trim().slice(0, 140) + '\u201D';
    var tx = document.getElementById('rr-tb-text');
    if (tx) tx.value = pre;
    c.style.display = 'block';
    var nb = document.getElementById('rr-tb-note');
    if (nb) nb.classList.add('on');
    // the bar grew: move it back into view against the same anchor
    setTimeout(function () {
      var t2 = document.getElementById('rr-tb-text');
      if (t2) t2.focus();
      if (lastRect) placeToolbar(lastRect);
    }, 40);
  }
  function saveComposer() {
    var tx = document.getElementById('rr-tb-text');
    var text = tx ? tx.value.trim() : '';
    if (composeEditUid) {
      var list = userMarks();
      var it = list.find(function (x) { return x.uid === composeEditUid; });
      if (it) {
        it.note = text; it.ts = Date.now();
        saveUser(list);
        try { window.getSelection().removeAllRanges(); } catch (e) {}
        var uid = composeEditUid;
        hideToolbar();
        applyAll();
        flashUid(uid);
        return;
      }
      composeEditUid = null;
    }
    if (composeBakedUid) {
      var bq = pending && pending.quote ? pending.quote : '';
      setOverlay(composeBakedUid, bq, text);
      try { window.getSelection().removeAllRanges(); } catch (e2) {}
      var buid = composeBakedUid;
      hideToolbar();
      applyAll();
      flashUid(buid);
      return;
    }
    if (!pending || !pending.range) { closeComposer(); return; }
    // empty text = plain mark in the picked style/color; anything typed
    // becomes the mark's note in one step, no popup hop
    pendingNoteText = text;
    try {
      savePendingInner(false);
    } finally {
      pendingNoteText = '';
    }
  }

  /* ---------- popup (view / edit note) ---------- */
  function findAnn(uid) {
    var all = bakedMarks().concat(importMarks()).concat(userMarks());
    for (var i = 0; i < all.length; i++) if (all[i].uid === uid) return all[i];
    return null;
  }
  function ensurePopup() {
    var p = document.getElementById('rr-popup');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'rr-popup';
    p.className = 'rr-ui';
    document.body.appendChild(p);
    return p;
  }
  function hidePopup() {
    var p = document.getElementById('rr-popup');
    if (p) p.style.display = 'none';
  }
  function openPopup(uid, focusNote) {
    try {
      openPopupInner(uid, focusNote);
    } catch (err) {
      toolbarError('could not open note (' + ((err && err.message) || err) + ')');
    }
  }
  function openPopupInner(uid, focusNote) {
    hideUnmark();
    var a = findAnn(uid);
    if (!a) {
      toolbarError('note not found (storage may be blocked)');
      return;
    }
    var p = ensurePopup();
    var html = '<div class="rr-pop-quote">' + esc(String(a.q || '').slice(0, 220)) + '</div>';
    if (a.mine) {
      html += '<textarea id="rr-pop-note" placeholder="Write a note…">' + esc(a.note || '') + '</textarea>' +
        '<div class="rr-pop-row"><button id="rr-pop-save">Save</button>' +
        (a.note ? '<button id="rr-pop-rmnote">Remove note</button>'
                : '<button id="rr-pop-remove">Remove</button>') +
        '<button id="rr-pop-close">Close</button></div>';
    } else {
      html += (a.note ? '<div class="rr-pop-note">' + esc(a.note).replace(/\n/g, '<br>') + '</div>'
                      : '') +
        '<div class="rr-pop-row">' +
        (a.note ? '<button id="rr-pop-rmnote">Remove note</button>'
                : '<button id="rr-pop-remove">Remove</button>') +
        '<button id="rr-pop-close">Close</button></div>';
    }
    p.innerHTML = html;
    p.style.display = 'block';
    p.style.position = 'absolute';
    var pw = p.offsetWidth || 300, ph = p.offsetHeight || 220;
    var anchor = document.querySelector('[data-rr-uid="' + cssEsc(uid) + '"], [data-rr-id="' + cssEsc(uid) + '"]');
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      var x = Math.min(Math.max(8, r.left + window.scrollX),
                       Math.max(8, window.scrollX + window.innerWidth - pw - 8));
      var top = r.bottom + window.scrollY + 8;
      if (top + ph > window.scrollY + window.innerHeight - 8) {
        top = r.top + window.scrollY - ph - 8;
      }
      top = Math.max(window.scrollY + 8, top);
      p.style.left = x + 'px';
      p.style.top = top + 'px';
    } else {
      p.style.position = 'fixed';
      p.style.right = '16px'; p.style.bottom = '52px'; p.style.left = 'auto'; p.style.top = 'auto';
    }
    document.getElementById('rr-pop-close').addEventListener('click', hidePopup);
    var save = document.getElementById('rr-pop-save');
    if (save) save.addEventListener('click', function () {
      var list = userMarks();
      var it = list.find(function (x) { return x.uid === uid; });
      if (it) {
        it.note = document.getElementById('rr-pop-note').value.trim();
        it.ts = Date.now();
        saveUser(list); applyAll(); hidePopup();
      }
    });
    var remove = document.getElementById('rr-pop-remove');
    if (remove) remove.addEventListener('click', function () {
      removeMark(uid, a);
      applyAll();
      hidePopup();
    });
    var rmnote = document.getElementById('rr-pop-rmnote');
    if (rmnote) rmnote.addEventListener('click', function () {
      removeNote(uid, a);
      applyAll();
      hidePopup();
    });
    if (focusNote) setTimeout(function () {
      var t = document.getElementById('rr-pop-note');
      if (t) t.focus();
    }, 60);
  }

  function bindMarkClicks() {
    document.querySelectorAll('.rr-u, span.ann-hl, span.ann-note, span.ann-ul').forEach(function (sp) {
      if (sp.__rrBound) return;
      sp.__rrBound = true;
      sp.style.cursor = 'pointer';
      sp.addEventListener('click', function (e) {
        e.stopPropagation();
        var uid = sp.dataset.rrUid || sp.dataset.rrId;
        if (uid) openPopup(uid, false);
      });
    });
  }

  function flashUid(uid) {
    var el = document.querySelector('[data-rr-uid="' + cssEsc(uid) + '"]');
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el.classList.remove('rr-flash'); void el.offsetWidth; el.classList.add('rr-flash');
    }
  }

  /* ---------- hover quick-remove badge (one-click unmark) ---------- */
  var unmarkTimer = null;
  function ensureUnmark() {
    var b = document.getElementById('rr-unmark');
    if (b) return b;
    b = document.createElement('button');
    b.id = 'rr-unmark';
    b.className = 'rr-ui';
    b.title = 'Remove this annotation';
    b.textContent = '✕';
    b.style.display = 'none';
    document.body.appendChild(b);
    b.addEventListener('mouseenter', function () { b.__hover = true; });
    b.addEventListener('mouseleave', function () { b.__hover = false; scheduleHideUnmark(); });
    b.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var uid = b.dataset.rrUid;
      if (uid) { removeMark(uid, findAnn(uid)); applyAll(); hidePopup(); }
      hideUnmark();
    });
    return b;
  }
  function scheduleHideUnmark() {
    clearTimeout(unmarkTimer);
    unmarkTimer = setTimeout(function () {
      var b = document.getElementById('rr-unmark');
      if (b && !b.__hover) b.style.display = 'none';
    }, 200);
  }
  function hideUnmark() {
    clearTimeout(unmarkTimer);
    var b = document.getElementById('rr-unmark');
    if (b) { b.__hover = false; b.style.display = 'none'; }
  }
  document.addEventListener('mouseover', function (e) {
    var t = (e.target && e.target.closest)
      ? e.target.closest('.rr-u, span.ann-hl, span.ann-note, span.ann-ul') : null;
    if (!t || t.style.display === 'none' || !t.isConnected) { scheduleHideUnmark(); return; }
    var uid = t.dataset.rrUid || t.dataset.rrId;
    if (!uid) { scheduleHideUnmark(); return; }
    var pop = document.getElementById('rr-popup');
    if (pop && pop.style.display === 'block') { scheduleHideUnmark(); return; }
    var tb = document.getElementById('rr-toolbar');
    if (tb && tb.style.display === 'flex') { scheduleHideUnmark(); return; }
    clearTimeout(unmarkTimer);
    var b = ensureUnmark();
    b.dataset.rrUid = uid;
    b.style.display = 'block';
    var r = t.getBoundingClientRect();
    b.style.position = 'absolute';
    b.style.left = Math.max(4, Math.min(window.innerWidth - 30, r.right - 10 + window.scrollX)) + 'px';
    b.style.top = Math.max(4, r.top + window.scrollY - 13) + 'px';
  });
  document.addEventListener('scroll', function () { hideUnmark(); }, true);

  /* ---------- marks drawer ---------- */
  function ensureChrome() {
    var bar = document.querySelector('.rr-tool-group') || document.querySelector('.rr-header-actions') || document.querySelector('.top-bar');
    var themed = !!document.querySelector('.rr-site-header');
    if (bar && !document.getElementById('rr-marks-btn')) {
      if (!themed) {
        var home = document.createElement('a');
        home.id = 'rr-home-link';
        home.href = PREFIX + 'index.html';
        home.textContent = '← reading room';
        home.className = 'rr-ui';
        bar.insertBefore(home, bar.firstChild);
      }
      var btn = document.createElement('button');
      btn.id = 'rr-marks-btn';
      btn.className = 'rr-ui';
      btn.title = 'Your marks on this page';
      btn.innerHTML = '✎ <span id="rr-marks-n"></span>';
      btn.addEventListener('click', toggleDrawer);
      bar.appendChild(btn);
    }
    var drawer = document.getElementById('rr-drawer');
    if (!drawer) {
      drawer = document.createElement('div');
      drawer.id = 'rr-drawer';
      drawer.className = 'rr-ui';
      drawer.innerHTML =
        '<div class="rr-draw-head"><b>Marks on this page</b>' +
        '<span><button id="rr-draw-close">✕</button></span></div>' +
        '<div id="rr-draw-list"></div>';
      document.body.appendChild(drawer);
      document.getElementById('rr-draw-close').addEventListener('click', toggleDrawer);
    }
  }
  function toggleDrawer() {
    var d = document.getElementById('rr-drawer');
    d.classList.toggle('open');
  }
  function refreshDrawer() {
    var n = document.getElementById('rr-marks-n');
    var list = document.getElementById('rr-draw-list');
    if (!n || !list) return;
    var baked = bakedMarks(), mine = userMarks(), imp = importMarks();
    n.textContent = '(' + (baked.length + mine.length + imp.length) + ')';
    function row(a) {
      return '<div class="rr-row" data-rr-uid="' + esc(a.uid) + '">' +
        '<span class="rr-dot" style="background:' + esc(a.color || '#FFE066') + '"></span>' +
        '<span class="rr-row-q">' + esc(String(a.q || '').slice(0, 120)) + '</span>' +
        (a.note ? '<span class="rr-row-n">✎</span>' : '') +
        '<button class="rr-row-x" title="remove this annotation">✕</button></div>';
    }
    list.innerHTML =
      mine.map(function (a) { return row(a); }).join('') +
      imp.map(function (a) { return row(a); }).join('') +
      baked.map(function (a) { return row(a); }).join('') +
      ((baked.length + mine.length + imp.length) === 0 ? '<p class="rr-dim">No marks yet — select text to add one.</p>' : '');
    list.querySelectorAll('.rr-row').forEach(function (el) {
      el.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.rr-row-x')) {
          var uid0 = el.dataset.rrUid;
          removeMark(uid0, findAnn(uid0));
          applyAll();
          hidePopup();
          return;
        }
        var uid = el.dataset.rrUid;
        // real mark spans only — never the drawer's own rows, which share
        // the same data-rr-uid values (see lastMarkEl)
        var target = lastMarkEl(uid);
        if (target) {
          // one click: jump to the passage (drawer closes so it is visible)
          var dw = document.getElementById('rr-drawer');
          if (dw) dw.classList.remove('open');
          target.scrollIntoView({ block: 'center' });
          target.classList.remove('rr-flash'); void target.offsetWidth; target.classList.add('rr-flash');
        } else {
          setTimeout(function () { openPopup(uid, false); }, 450);
        }
      });
    });
    try { document.dispatchEvent(new CustomEvent('rr-marks-changed')); } catch (e) {}
  }

  /* ---------- sticky notes: each note shown beside its marked text ---------- */
  function lastMarkEl(uid) {
    // only real mark spans — never drawer rows (which share data-rr-uid)
    var best = null;
    document.querySelectorAll('.rr-u, span.ann-hl, span.ann-note, span.ann-ul').forEach(function (sp) {
      if ((sp.dataset.rrUid || sp.dataset.rrId) !== uid) return;
      if (sp.style.display === 'none') return;
      best = sp;
    });
    return best;
  }
  function contentBox() {
    return document.getElementById('epub-content') || document.querySelector('.reader-content');
  }
  function marginalOK() {
    var cont = contentBox();
    if (!cont) { document.body.classList.remove('rr-marginals'); return false; }
    document.body.classList.remove('rr-marginals');
    var r = cont.getBoundingClientRect();
    var space = document.documentElement.clientWidth - r.right;
    var isEpub = !!document.getElementById('epub-content');
    var need = 0, on = space >= 230;
    if (!isEpub && !on && space >= 110) {
      need = Math.min(120, 230 - space);
      on = true;
    }
    var ps = getComputedStyle(cont.parentNode);
    var box = cont.parentNode.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
    var ml = Math.max(0, (box - cont.clientWidth) / 2 - need);
    try { document.body.style.setProperty('--rr-shift', ml + 'px'); } catch (e) {}
    document.body.classList.toggle('rr-marginals', !!on);
    return !!on;
  }
  function makeSticky(a, anchor, n) {
    var st = document.createElement('span');
    st.className = 'rr-sticky rr-ui';
    st.dataset.rrSticky = a.uid;
    st.title = 'Edit note';
    if (n) {
      var num = document.createElement('span');
      num.className = 'rr-nref-side';
      num.textContent = n;
      st.appendChild(num);
      st.appendChild(document.createTextNode(' '));
    }
    st.appendChild(document.createTextNode(a.note));
    st.addEventListener('click', function (e) {
      e.stopPropagation();
      anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
      anchor.classList.remove('rr-flash'); void anchor.offsetWidth; anchor.classList.add('rr-flash');
      setTimeout(function () { openPopup(a.uid, false); }, 450);
    });
    return st;
  }
  function addRef(mark, n) {
    // superscript reference number on the marked text (click bubbles to
    // the mark's own popup, so the number opens the note editor)
    try {
      var sup = document.createElement('sup');
      sup.className = 'rr-nref';
      sup.textContent = n;
      mark.appendChild(sup);
    } catch (e) {}
  }
  function renderStickies() {
    document.querySelectorAll('.rr-sticky').forEach(function (sp) {
      if (sp.parentNode) sp.parentNode.removeChild(sp);
    });
    // renderStickies also runs standalone (resize/load/fonts): clear
    // reference numbers here too, or baked marks would collect duplicates
    document.querySelectorAll('.rr-nref').forEach(function (sp) {
      if (sp.parentNode) sp.parentNode.removeChild(sp);
    });
    var cont = contentBox();
    if (cont) cont.style.paddingBottom = '';
    var mg = false;
    var notes = bakedMarks().concat(importMarks()).concat(userMarks()).filter(function (a) {
      return a.note && String(a.note).trim();
    });
    if (!notes.length) {
      document.body.classList.remove('rr-marginals');
      try { document.body.classList.remove('rr-notes-margin'); } catch (e) {}
    } else {
      mg = marginalOK();
    }
    if (mg && cont) {
      // margin notes own the right gutter on this render: the floating
      // in-chapter CONTENTS card would sit on top of them (it is fixed
      // while notes scroll). Drop it back to a static block above the
      // text — the left Table of Contents panel still navigates.
      try { document.body.classList.add('rr-notes-margin'); } catch (e) {}
      var items = [];
      var cr0 = cont.getBoundingClientRect();
      notes.forEach(function (a) {
        var mark = lastMarkEl(a.uid);
        if (!mark) return;
        items.push({ a: a, mark: mark,
                     top: mark.getBoundingClientRect().top - cr0.top - 6 });
      });
      items.sort(function (x, y) { return x.top - y.top; });
      // keep margin notes clear of the pinned CONTENTS card (wide screens):
      // nothing may start above the card's bottom edge
      var minTop = 0;
      try {
        var cc = document.querySelector('.rr-contents');
        if (cc && window.getComputedStyle(cc).position === 'fixed') {
          minTop = cc.getBoundingClientRect().bottom - cr0.top + 12;
        }
      } catch (e) {}
      var left = cont.clientWidth + 20, bottom = 0;
      items.forEach(function (it, k) {
        var n = k + 1;
        var st = makeSticky(it.a, it.mark, n);
        cont.appendChild(st);
        addRef(it.mark, n);
        var top = Math.max(it.top, bottom + 10, minTop);
        if (top < 0) top = 0;
        it.st = st;
        st.style.left = left + 'px';
        st.style.top = top + 'px';
        bottom = top + (st.offsetHeight || 60);
      });
      if (bottom > cont.clientHeight) {
        cont.style.paddingBottom = Math.ceil(bottom - cont.clientHeight + 60) + 'px';
      }
    } else {
      try { document.body.classList.remove('rr-notes-margin'); } catch (e) {}
      notes.forEach(function (a, k) {
        var anchor = lastMarkEl(a.uid);
        if (!anchor || !anchor.parentNode) return;
        anchor.parentNode.insertBefore(makeSticky(a, anchor, k + 1), anchor.nextSibling);
        addRef(anchor, k + 1);
      });
    }
  }

  /* ---------- boot ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
  function init() {
    ensureChrome();
    applyAll();
    var rsT = null;
    window.addEventListener('resize', function () {
      clearTimeout(rsT);
      rsT = setTimeout(function () { renderStickies(); }, 250);
    });
    window.addEventListener('load', function () { renderStickies(); });
    try {
      if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(function () { renderStickies(); });
      }
    } catch (e) {}
  }
})();
