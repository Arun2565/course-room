/* library.js — Apple Books-style progress on the hub grid.
 *
 * Each .bk-lib card carries data-book + data-chapters. Per-chapter scroll
 * depth is stored by chapter-toc.js as rr-progress:<slug>:<file> (0-100).
 * Here we average it into a progress bar + label, and point the card at
 * the first unfinished chapter (Continue where you left off).
 */
(function () {
  'use strict';

  function pct(slug, file) {
    try {
      return parseInt(window.localStorage.getItem('rr-progress:' + slug + ':' + file) || '0', 10) || 0;
    } catch (e) { return 0; }
  }

  function upgrade(card) {
    var slug = card.getAttribute('data-book');
    var files = (card.getAttribute('data-chapters') || '').split(',').filter(Boolean);
    if (!slug || !files.length) return;
    var sum = 0, target = files[0];
    for (var i = 0; i < files.length; i++) {
      sum += Math.min(100, pct(slug, files[i]));
    }
    /* First unfinished chapter, found in its own pass: breaking out of the
     * sum above used to under-report progress by every chapter after it. */
    for (var j = 0; j < files.length; j++) {
      if (Math.min(100, pct(slug, files[j])) < 90) { target = files[j]; break; }
    }
    var avg = Math.round(sum / files.length);
    var fill = card.querySelector('.bk-prog-fill');
    if (fill) fill.style.width = avg + '%';
    var lab = card.querySelector('.bk-prog-label');
    if (lab) {
      var done = 0;
      for (var d = 0; d < files.length; d++) {
        if (Math.min(100, pct(slug, files[d])) >= 90) done++;
      }
      if (avg >= 100) lab.textContent = 'Finished';
      else if (avg <= 0) lab.textContent = 'Not started';
      /* A 21 chapter book sitting at 7% says nothing useful; count the
       * chapters instead once there are more than a handful of them. */
      else if (files.length > 6) lab.textContent = done + ' of ' + files.length + ' ch';
      else lab.textContent = avg + '% · Continue';
    }
    card.setAttribute('href', 'books/' + slug + '/' + target);
  }

  function init() {
    try { if (window.RR && window.RR.touch) window.RR.touch(); } catch (e) {}
    document.querySelectorAll('.bk-lib').forEach(upgrade);
    try {
      var pill = document.getElementById('rr-streak');
      if (pill && window.RR && window.RR.streak) {
        var st = window.RR.streak();
        pill.textContent = st.current > 0
          ? '\uD83D\uDD25 ' + st.current + '-day streak'
          : (st.total > 0 ? 'Streak starts today' : 'Day 1 starts today');
      }
    } catch (e) {}
    initSearch();
  }

  /* ---- ⌘K library search: books, guides, blogs ---- */
  function txt(card, sel) {
    var el = card.querySelector(sel);
    return el ? (el.textContent || '') : '';
  }
  function shelfKind(card) {
    try {
      var grid = card.closest('.bk-grid, .rail');
      var head = grid && grid.previousElementSibling;
      var t = head ? (head.textContent || '') : '';
      if (/guide/i.test(t)) return 'Guide';
      if (/blog/i.test(t)) return 'Blog';
    } catch (e) {}
    return card.classList.contains('ar-card') ? 'Blog' : 'Book';
  }
  function collectEntries() {
    var out = [];
    document.querySelectorAll('.bk-lib').forEach(function (c) {
      var a = c.getAttribute('href');
      if (!a) return;
      out.push({ href: a, target: c.getAttribute('target') || '',
                 title: txt(c, '.bk-lib-title'), sub: txt(c, '.bk-lib-author'),
                 kind: shelfKind(c) });
    });
    document.querySelectorAll('.ar-card').forEach(function (c) {
      var a = c.getAttribute('href');
      if (!a) return;
      out.push({ href: a, target: c.getAttribute('target') || '',
                 title: txt(c, '.ar-card-title'), sub: txt(c, '.ar-card-kicker'),
                 kind: 'Blog' });
    });
    return out;
  }
  function escHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function initSearch() {
    var overlay = document.getElementById('rr-search');
    var input = document.getElementById('rr-search-input');
    var list = document.getElementById('rr-search-list');
    var btn = document.getElementById('rr-search-btn');
    if (!overlay || !input || !list) return;
    var data = collectEntries();
    var sel = 0, shown = [];
    function open() {
      data = collectEntries();
      overlay.classList.add('open');
      input.value = '';
      render('');
      setTimeout(function () { input.focus(); }, 30);
    }
    function close() { overlay.classList.remove('open'); }
    function go(entry) {
      if (!entry) return;
      close();
      if (entry.target === '_blank') window.open(entry.href, '_blank', 'noopener');
      else window.location.href = entry.href;
    }
    function render(q) {
      q = (q || '').toLowerCase().replace(/\s+/g, ' ').trim();
      shown = q ? data.filter(function (e) {
        return ((e.title || '') + ' ' + (e.sub || '')).toLowerCase().indexOf(q) !== -1;
      }) : data.slice(0, 12);
      sel = 0;
      if (!shown.length) {
        list.innerHTML = '<div id="rr-search-empty">Nothing matches — try another word.</div>';
        return;
      }
      list.innerHTML = shown.map(function (e, i) {
        return '<a href="' + escHtml(e.href) + '" data-i="' + i + '"' +
          (i === 0 ? ' class="sel"' : '') + '>' +
          '<span class="rr-search-kind">' + escHtml(e.kind) + '</span>' +
          escHtml(e.title) +
          (e.sub ? ' <span style="opacity:0.55">· ' + escHtml(e.sub.slice(0, 60)) + '</span>' : '') +
          '</a>';
      }).join('');
      list.querySelectorAll('a').forEach(function (a) {
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          go(shown[parseInt(a.getAttribute('data-i'), 10)]);
        });
        a.addEventListener('mousemove', function () {
          sel = parseInt(a.getAttribute('data-i'), 10);
          paintSel();
        });
      });
    }
    function paintSel() {
      list.querySelectorAll('a').forEach(function (a, i) {
        if (i === sel) a.classList.add('sel');
        else a.classList.remove('sel');
      });
    }
    input.addEventListener('input', function () { render(input.value); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); paintSel(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(0, sel - 1); paintSel(); }
      else if (e.key === 'Enter') { e.preventDefault(); go(shown[sel]); }
      else if (e.key === 'Escape') close();
    });
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); open(); });
    document.addEventListener('keydown', function (e) {
      var mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); open(); }
      else if (e.key === 'Escape') close();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})();
