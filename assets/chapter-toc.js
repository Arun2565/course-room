/* chapter-toc.js — in-chapter CONTENTS card + bulletproof TOC toggle.
 *
 * 1. Robust window.toggleTOC: toggles BOTH body.toc-hidden (new site.css)
 *    and panel.rr-hidden (older site.css), so close/open works no matter
 *    which stylesheet version the browser cached.
 * 2. Floating TOC button (#rr-toc-fab, bottom-right, always visible):
 *    the header toggle scrolls away and the skill's fixed top-bar is
 *    hidden, so without this there is no way to close/reopen mid-chapter.
 * 3. In-chapter CONTENTS card (screenshot style): numbered h2/h3 links
 *    with scroll-spy gold highlight, floated right of the chapter text.
 *
 * Styles are injected here (cache-proof) and mirrored in assets/site.css.
 */
(function () {
  'use strict';

  var CSS = [
    '#rr-toc-fab{position:fixed;left:20px;bottom:24px;z-index:150;',
    'background:var(--bg2,#f0ede6);border:1px solid var(--border2,rgba(0,0,0,0.14));',
    'color:var(--text2,#333);font-family:\'DM Mono\',monospace;font-size:0.65rem;',
    'letter-spacing:0.12em;text-transform:uppercase;padding:10px 14px;border-radius:3px;',
    'cursor:pointer;box-shadow:0 3px 12px rgba(0,0,0,0.16);}',
    '#rr-toc-fab:hover{border-color:var(--accent,#8a6820);color:var(--accent,#8a6820);}',
    /* static block above the text by default: never wraps or covers prose */
    '.rr-contents{width:auto;margin:0 0 20px;background:var(--bg2,#f0ede6);',
    'border:1px solid var(--border,rgba(0,0,0,0.07));border-radius:4px;padding:18px 18px 14px;',
    "font-family:'DM Mono',monospace;font-size:0.78rem;}",
    '.rr-contents-label{font-size:0.58rem;letter-spacing:0.18em;text-transform:uppercase;',
    'color:var(--text3,#555);margin-bottom:10px;}',
    '.rr-contents ol{list-style:none;margin:0;padding:0;}',
    '.rr-contents li{margin:0;padding:0;}',
    '.rr-contents a{display:block;font-family:var(--rr-readfont);font-size:0.8rem;',
    'letter-spacing:0;color:var(--text2,#333);text-decoration:none;',
    'padding:6px 9px;border-left:2px solid transparent;line-height:1.45;',
    'border-radius:0 6px 6px 0;transition:color .14s ease,background .14s ease;}',
    '.rr-contents a:hover{color:var(--accent,#8a6820);}',
    '.rr-contents a.active{color:var(--accent,#8a6820);',
    'border-left-color:var(--accent,#8a6820);background:var(--glow,rgba(138,104,32,0.06));}',
    '.rr-contents a.rr-sub{font-size:0.76rem;padding-left:20px;opacity:.92;}',
    '.rr-contents-num{margin-right:6px;}',
    '.reader-content h2[id],.reader-content h3[id]{scroll-margin-top:64px;}',
    '.rr-next{margin:48px 0 8px;padding:22px 4px 0;border-top:1px solid var(--border,rgba(0,0,0,0.07));',
    'display:flex;flex-direction:column;gap:8px;}',
    '.rr-next-label{font-family:\'DM Mono\',monospace;font-size:0.62rem;letter-spacing:0.14em;',
    'text-transform:uppercase;color:var(--text3,#555);}',
    '.rr-next-link{font-family:\'Cormorant Garamond\',Georgia,serif;font-size:1.5rem;font-weight:700;',
    'font-style:italic;color:var(--ink,#000);text-decoration:none;line-height:1.3;}',
    '.rr-next-link:hover{color:var(--accent,#8a6820);}',
    '.rr-next-arrow{color:var(--accent,#8a6820);}',
    '.rr-topbar{position:sticky;top:0;z-index:120;display:flex;align-items:center;gap:12px;',
    'padding:10px 18px;background:var(--bg,#faf7f0);border-bottom:1px solid var(--border,rgba(0,0,0,0.07));}',
    '.rr-back{font-family:\'DM Mono\',monospace;font-size:0.68rem;letter-spacing:0.08em;',
    'color:var(--text2,#333);text-decoration:none;white-space:nowrap;}',
    '.rr-back:hover{color:var(--accent,#8a6820);}',
    '.rr-toptitle{flex:1;text-align:center;font-family:var(--rr-readfont);',
    'font-style:italic;font-size:1.05rem;color:var(--text,#000);white-space:nowrap;',
    'overflow:hidden;text-overflow:ellipsis;min-width:0;}',
    '.rr-topbar .rr-header-actions{display:flex;gap:8px;align-items:center;}',
    '@media (max-width:640px){.rr-toptitle{display:none;}.rr-topbar{padding:8px 12px;}}',
    /* wide screens: reserve a right gutter and pin the card in it, so it
       stays right without ever touching body text */
    '@media (min-width:1280px){',
    'body.rr-chapter{padding-right:270px;}',
    'body.rr-chapter .rr-contents{position:fixed;top:140px;right:16px;width:240px;margin:0;',
    'max-height:calc(100vh - 170px);overflow-y:auto;z-index:5;}',
    'body.rr-chapter .progress-bar{left:260px !important;right:270px !important;}',
    'body.rr-chapter.toc-hidden .progress-bar{left:0 !important;right:270px !important;}}'
  ].join('\n');

  function ensureCSS() {
    if (document.getElementById('rr-chapter-toc-css')) return;
    var st = document.createElement('style');
    st.id = 'rr-chapter-toc-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function isMobile() {
    return window.innerWidth <= 900;
  }

  function panel() {
    return document.getElementById('tocPanel');
  }

  function overlay() {
    return document.getElementById('tocOverlay');
  }

  function headBtn() {
    return document.getElementById('rr-toc-btn');
  }

  function tocHidden() {
    var p = panel();
    if (isMobile()) return !(p && p.classList.contains('open'));
    return document.body.classList.contains('toc-hidden') ||
      !!(p && p.classList.contains('rr-hidden'));
  }

  var fab = null;

  function sync() {
    var hidden = tocHidden();
    var hb = headBtn();
    if (hb) {
      hb.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      hb.innerHTML = hidden ? '&#9776; toc' : '&#10005; toc';
    }
    if (fab) {
      fab.innerHTML = hidden ? '&#9776; Chapters' : '&#10005; Chapters';
      fab.setAttribute('aria-expanded', hidden ? 'false' : 'true');
      fab.title = hidden ? 'Show chapters' : 'Hide chapters';
    }
  }

  // Single owner of window.toggleTOC (chapter pages must NOT override
  // this afterwards — their inline script only installs a fallback when
  // this file failed to load, guarded by window.__rrTocOwned).
  window.__rrTocOwned = true;
  window.toggleTOC = function () {
    var p = panel(), ov = overlay();
    /* The rail is reserved in CSS, so the page should not reflow at all.
     * This is the belt to that braces: if anything does shift (a cached
     * stylesheet, a late webfont), the reader still lands on exactly the
     * line they were on instead of being pushed left. */
    var keepY = window.pageYOffset;
    var toggle = function () {
    if (isMobile()) {
      if (p) p.classList.toggle('open');
      if (ov) ov.classList.toggle('show');
    } else {
      // dual-mode: body class (current CSS) + panel class (older cached CSS)
      document.body.classList.toggle('toc-hidden');
      if (p) {
        if (document.body.classList.contains('toc-hidden')) p.classList.add('rr-hidden');
        else p.classList.remove('rr-hidden');
      }
      if (ov) ov.classList.remove('show');
    }
    };
    toggle();
    if (window.pageYOffset !== keepY) window.scrollTo(0, keepY);
    sync();
    var cur = markCurrent();
    if (cur && !tocHidden()) {
      try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
  };

    /* Aa reading-font switcher, saved as rr-font (shared with the EPUB reader) */
  var RFONTS = [['spectral', 'Spectral'], ['newsreader', 'Newsreader'], ['source-serif', 'Source Serif 4'], ['caslon', 'Adobe Caslon Pro'], ['cormorant', 'Cormorant Garamond'], ['atkinson', 'Atkinson Hyperlegible'], ['jetbrains', 'JetBrains Mono']];
  function currentFont() {
    try { return window.localStorage.getItem('rr-font') || 'spectral'; }
    catch (e) { return 'spectral'; }
  }
  function fontLabel(f) {
    for (var k = 0; k < RFONTS.length; k++) if (RFONTS[k][0] === f) return RFONTS[k][1];
    return 'Spectral';
  }
  function applyFont(f) {
    if (f === 'georgia') { f = 'spectral'; try { window.localStorage.setItem('rr-font', 'spectral'); } catch (e) {} }
    try { document.documentElement.setAttribute('data-rfont', f); } catch (e) {}
    var b = document.getElementById('rr-font-btn');
    if (b) {
      b.setAttribute('aria-label', 'Reading font: ' + fontLabel(f) + ' (tap to change)');
      b.title = 'Font: ' + fontLabel(f) + ' — tap to change';
    }
  }
  window.cycleFont = function () {
    var cur = currentFont(), i = 0;
    for (var k = 0; k < RFONTS.length; k++) if (RFONTS[k][0] === cur) i = k;
    var nx = RFONTS[(i + 1) % RFONTS.length][0];
    try { window.localStorage.setItem('rr-font', nx); } catch (e) {}
    applyFont(nx);
  };
  function fontStack(f) {
    if (f === 'newsreader') return "'Newsreader',Georgia,serif";
    if (f === 'source-serif') return "'Source Serif 4',Georgia,serif";
    if (f === 'atkinson') return "'Atkinson Hyperlegible',Verdana,sans-serif";
    if (f === 'caslon') return "'Adobe Caslon Pro','Cormorant Garamond',Georgia,serif";
    if (f === 'cormorant') return "'Cormorant Garamond',Georgia,serif";
    if (f === 'jetbrains') return "'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace";
    return "'Spectral',Georgia,serif";
  }
  /* Aa font overview menu (same list + look as the EPUB reader's
   * #epub-font-menu, whose styles live in site.css): every option previews
   * in its own typeface, the current one gets a check outline. */
  function ensureFontMenu() {
    var m = document.getElementById('epub-font-menu');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'epub-font-menu';
    m.className = 'rr-ui';
    m.setAttribute('role', 'menu');
    m.innerHTML = RFONTS.map(function (f) {
      return '<button data-rr-font="' + f[0] + '" style="font-family:' + fontStack(f[0]) + '">' +
        '<span>' + f[1] + '</span><span class="rr-ff-aa">Ag</span></button>';
    }).join('');
    Array.prototype.forEach.call(m.querySelectorAll('[data-rr-font]'), function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        try { window.localStorage.setItem('rr-font', b.getAttribute('data-rr-font')); } catch (e) {}
        applyFont(b.getAttribute('data-rr-font'));
        hideFontMenu();
      });
    });
    document.body.appendChild(m);
    return m;
  }
  function hideFontMenu() {
    var m = document.getElementById('epub-font-menu');
    if (m) m.classList.remove('show');
  }
  window.toggleFontMenu = function () {
    var m = ensureFontMenu();
    if (m.classList.contains('show')) { hideFontMenu(); return; }
    var cur = currentFont();
    Array.prototype.forEach.call(m.querySelectorAll('[data-rr-font]'), function (b) {
      if (b.classList && b.classList.toggle) b.classList.toggle('on', b.getAttribute('data-rr-font') === cur);
    });
    m.classList.add('show');
    // #epub-font-menu is position:fixed: anchor with viewport coords only.
    // Adding scroll offsets (as before) pushed it off-screen mid-page.
    var mw = m.offsetWidth || 240, mh = m.offsetHeight || 150;
    var x = 8, y = 8;
    var anchor = document.getElementById('rr-font-btn');
    if (anchor && anchor.getBoundingClientRect) {
      var r = anchor.getBoundingClientRect();
      x = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - mw - 8));
      y = r.bottom + 8;
      if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 8);
    }
    m.style.left = x + 'px';
    m.style.top = y + 'px';
  };
  function ensureFontBtn() {
    var existing = document.getElementById('rr-font-btn');
    if (existing) {
      // older inline buttons blind-cycle; rewire to the overview menu
      existing.onclick = function () { window.toggleFontMenu(); };
      applyFont(currentFont());
      return;
    }
    var host = document.querySelector('.rr-topbar .rr-header-actions') ||
      document.querySelector('.rr-header-actions');
    if (!host || !host.appendChild) { applyFont(currentFont()); return; }
    var b = document.createElement('button');
    b.id = 'rr-font-btn';
    b.textContent = 'Aa';
    b.onclick = function () { window.toggleFontMenu(); };
    host.appendChild(b);
    applyFont(currentFont());
  }

  /* Dark-mode toggle — single owner (like toggleTOC above). The skill's
   * inline scripts don't all define toggleTheme (RAG / DML / agentic pages
   * have none), so the old wrapper that called origTheme() crashed on click.
   * This standalone version toggles data-theme on <html>, persists the
   * choice as rr-theme, and labels the header button. */
  window.__rrThemeOwned = true;
  var SUN_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/>'
    + '<path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22'
    + 'M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  var MOON_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
  function isDarkTheme() {
    try { return document.documentElement.getAttribute('data-theme') === 'dark'; }
    catch (e) { return false; }
  }
  function syncThemeBtn() {
    var b = document.getElementById('rr-theme-btn');
    if (b) b.textContent = isDarkTheme() ? '☀ light' : '☾ dark';
    var fab = document.getElementById('rr-theme-fab');
    if (fab) {
      fab.innerHTML = isDarkTheme() ? SUN_SVG : MOON_SVG;
      var tip = isDarkTheme() ? 'Switch to light mode' : 'Switch to dark mode';
      fab.title = tip; fab.setAttribute('aria-label', tip);
    }
  }
  window.toggleTheme = function () {
    try {
      var root = document.documentElement;
      var wasDark = root.getAttribute('data-theme') === 'dark';
      if (wasDark) root.removeAttribute('data-theme');
      else root.setAttribute('data-theme', 'dark');
      try { window.localStorage.setItem('rr-theme', wasDark ? 'light' : 'dark'); } catch (e) {}
    } catch (e) {}
    syncThemeBtn();
  };
  function ensureTheme() {
    try {
      var saved = window.localStorage ? window.localStorage.getItem('rr-theme') : null;
      if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
      else if (saved === 'light') document.documentElement.removeAttribute('data-theme');
    } catch (e) {}
    syncThemeBtn();
  }
  /* Floating theme pill (course-room parity): some pages (all of
   * build-llm-from-scratch, writing-research-papers, agentic-search) put
   * their theme button in .top-bar, which site.css hides, and their button
   * has no id so buildTopbar can't relocate it. If no theme button made
   * it into the visible sticky bar, add the pill instead. */
  function ensureThemeFab() {
    try {
      if (document.querySelector('.rr-topbar .rr-header-actions #rr-theme-btn')) return;
      var fab = document.getElementById('rr-theme-fab');
      if (!fab) {
        fab = document.createElement('button');
        fab.id = 'rr-theme-fab';
        fab.className = 'rr-ui';
        fab.onclick = function () { window.toggleTheme(); };
        document.body.appendChild(fab);
      }
      syncThemeBtn();
    } catch (e) {}
  }

  /* Slim sticky reader bar (reference look): back link, centered chapter
   * title, action pills. Built by JS from the existing header buttons
   * (nodes are MOVED, so ids/handlers stay unique); the bulky brand
   * header + nav are hidden. No-JS falls back to the old header. */
  function buildTopbar() {
    try {
      if (document.querySelector('.rr-topbar')) return;
      var bar = document.createElement('div');
      bar.className = 'rr-topbar rr-ui';
      var back = document.createElement('a');
      back.className = 'rr-back';
      back.href = '../../index.html';
      back.textContent = '‹ Library';
      var title = document.createElement('div');
      title.className = 'rr-toptitle';
      title.id = 'rr-toptitle';
      var h1 = document.querySelector('.chapter-title h1');
      var name = cleanChapterTitle(h1 ? shortText(h1) : '');
      if (name) title.textContent = name;
      var actions = document.createElement('div');
      actions.className = 'rr-header-actions';
      ['rr-toc-btn', 'rr-font-btn', 'rr-theme-btn'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) actions.appendChild(b);
      });
      bar.appendChild(back);
      bar.appendChild(title);
      bar.appendChild(actions);
      document.body.insertBefore(bar, document.body.firstChild);
      var oldHeader = document.querySelector('.rr-site-header');
      if (oldHeader) oldHeader.style.display = 'none';
      var oldNav = document.querySelector('.rr-site-nav');
      if (oldNav) oldNav.style.display = 'none';
    } catch (e) {}
  }

  function ensureFab() {    if (document.getElementById('rr-toc-fab')) {
      fab = document.getElementById('rr-toc-fab');
    } else {
      fab = document.createElement('button');
      fab.id = 'rr-toc-fab';
      fab.setAttribute('aria-controls', 'tocPanel');
      fab.onclick = function () { window.toggleTOC(); };
      document.body.appendChild(fab);
    }
    sync();
  }

  function shortText(h) {
    return (h.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function buildContents() {
    if (document.querySelector('.rr-contents')) return;
    var main = document.querySelector('main.reader-content, .reader-content');
    if (!main || !main.querySelectorAll) return;
    var heads = main.querySelectorAll('h2[id], h3[id]');
    var flatH1 = false;
    if (!heads || !heads.length) {
      // chapters without h2/h3 (e.g. preface): fall back to h1
      // sections, skipping the chapter title itself
      var h1s = main.querySelectorAll('h1[id]');
      var titleH = main.querySelector('.chapter-title h1');
      var rest = [];
      Array.prototype.forEach.call(h1s, function (h) {
        if (h !== titleH && !(h.closest && h.closest('.rr-ui'))) rest.push(h);
      });
      if (rest.length < 2) return;
      heads = rest;
      flatH1 = true;
    }
    var card = document.createElement('nav');
    card.className = 'rr-contents';
    card.setAttribute('aria-label', 'In this chapter');
    var label = document.createElement('div');
    label.className = 'rr-contents-label';
    label.textContent = 'Contents';
    card.appendChild(label);
    var ol = document.createElement('ol');
    var n2 = 0, n3 = 0, links = [], items = [];
    Array.prototype.forEach.call(heads, function (h) {
      if (h.closest && h.closest('.rr-ui')) return;
      var t = shortText(h);
      if (!t) return;
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#' + h.id;
      if (h.tagName === 'H2' || (flatH1 && h.tagName === 'H1')) {
        n2++; n3 = 0;
        a.innerHTML = '<span class="rr-contents-num">' + n2 + ' &middot;</span>';
        a.appendChild(document.createTextNode(t));
      } else {
        n3++;
        a.className = 'rr-sub';
        a.appendChild(document.createTextNode(n2 + '.' + n3 + ' ' + t));
      }
      li.appendChild(a);
      ol.appendChild(li);
      links.push(a);
      items.push(h);
    });
    if (!links.length) return;
    card.appendChild(ol);
    var title = main.querySelector('.chapter-title');
    if (title && title.parentNode === main && title.nextSibling) {
      main.insertBefore(card, title.nextSibling);
    } else {
      main.insertBefore(card, main.firstChild);
    }
    function onScroll() {
      var cur = null;
      items.forEach(function (h) {
        try {
          if (h.getBoundingClientRect().top <= 140) cur = h.id;
        } catch (e) { /* stub DOM */ }
      });
      links.forEach(function (a) {
        var on = cur && a.getAttribute('href') === '#' + cur;
        if (a.classList && a.classList.toggle) a.classList.toggle('active', !!on);
      });
    }
    ol.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) return;
      var id = (a.getAttribute('href') || '').slice(1);
      var t = document.getElementById(id);
      if (!t) return;
      if (e.preventDefault) e.preventDefault();
      try {
        if (t.scrollIntoView) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else if (t.scrollIntoView === undefined && window.scrollTo) window.scrollTo(0, 0);
      } catch (err) { /* older browsers */ }
      try {
        if (history.replaceState) history.replaceState(null, '', '#' + id);
      } catch (err2) { /* file:// */ }
      onScroll();
    });
    if (window.addEventListener) {
      var ticking = false;
      window.addEventListener('scroll', function () {
        if (ticking) return;
        ticking = true;
        (window.requestAnimationFrame || function (f) { f(); })(function () {
          ticking = false;
          onScroll();
          saveProgress();
          if (typeof updateProgress === 'function') updateProgress();
          if (typeof updateStatus === 'function') updateStatus();
        });
      }, { passive: true });
    }
    onScroll();
  }

  /* Book progress: remember the deepest scroll % per chapter so the
   * library hub can show per-book progress bars. Key: rr-progress:<slug>:<file>
   */
  function progressKey() {
    try {
      var m = String(location.pathname || '').match(/books\/([^\/]+)\/([^\/\#\?]+)/);
      if (!m) return null;
      return 'rr-progress:' + m[1] + ':' + m[2];
    } catch (e) { return null; }
  }
  function saveProgress() {
    try {
      var k = progressKey();
      if (!k || !window.localStorage) return;
      var h = document.documentElement;
      var max = (h ? h.scrollHeight : 0) - window.innerHeight;
      var y = window.scrollY || window.pageYOffset || 0;
      var p = max > 0 ? Math.round(100 * y / max) : 100;
      var prev = parseInt(window.localStorage.getItem(k) || '0', 10) || 0;
      if (p > prev) window.localStorage.setItem(k, String(p));
    } catch (e) {}
  }

  /* Current-chapter reading stats. The read time is baked into the page by
   * the book builders as #readMeta[data-total-min]; the percentage is the
   * live scroll position, shown next to the progress slider in the footer
   * (#rr-toc-foot). Pages with no baked read time get nothing added.
   */
  var statusTotalMin = 0;
  function fmtLeft(m) {
    if (m <= 0) return 'done';
    if (m < 60) return m + ' min left';
    var hrs = Math.floor(m / 60), mins = m % 60;
    return hrs + 'h' + (mins ? ' ' + mins + 'm' : '') + ' left';
  }
  function scrollRatio() {
    var h = document.documentElement;
    var max = (h ? h.scrollHeight : 0) - window.innerHeight;
    var y = window.scrollY || window.pageYOffset || 0;
    return max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;
  }
  function updateStatus() {
    var el = document.getElementById('rr-sb-page');
    if (!el) return;
    var ratio = scrollRatio();
    var pct = Math.round(ratio * 100);
    var txt = '';
    if (statusTotalMin) {
      txt = '~' + statusTotalMin + ' min read · ';
      txt += ratio >= 0.995 ? 'done' : fmtLeft(Math.max(1, Math.ceil(statusTotalMin * (1 - ratio))));
      txt += ' · ';
    }
    txt += pct + '% read';
    el.textContent = txt;
  }
  function buildStatusbar() {
    try {
      var meta = document.getElementById('readMeta');
      statusTotalMin = meta ? parseInt(meta.getAttribute('data-total-min') || '0', 10) || 0 : 0;
      var foot = document.getElementById('rr-toc-foot');
      if (!foot) return;
      var el = document.getElementById('rr-sb-page');
      if (!el) {
        el = document.createElement('span');
        el.id = 'rr-sb-page';
        el.className = 'rr-sb-page';
        foot.appendChild(el);
      }
      updateStatus();
      window.addEventListener('scroll', updateStatus, { passive: true });
      window.addEventListener('resize', updateStatus);
    } catch (e) {}
  }

  /* Next-chapter footer: appended once at the end of the chapter, with
   * "Chapter k of n" for book progress. Last chapter links the library.
   */
  function buildNext() {
    try {
      if (document.querySelector('.rr-next')) return;
      var main = document.querySelector('main.reader-content, .reader-content');
      if (!main || !main.appendChild) return;
      var links = document.querySelectorAll('.toc-nav a.toc-chapter');
      if (!links || !links.length) return;
      var cur = (location.pathname.split('/').pop() || '').split('#')[0];
      var idx = -1;
      Array.prototype.forEach.call(links, function (a, k) {
        if ((a.getAttribute('href') || '').split('#')[0] === cur) idx = k;
      });
      var nav = document.createElement('nav');
      nav.className = 'rr-next rr-ui';
      nav.setAttribute('aria-label', 'Continue reading');
      if (idx !== -1 && idx < links.length - 1) {
        var nx = links[idx + 1];
        var span = nx.querySelector('span');
        var title = span ? (span.textContent || '').trim() : nx.textContent.trim();
        var lab = document.createElement('span');
        lab.className = 'rr-next-label';
        lab.textContent = 'Next · Chapter ' + (idx + 2) + ' of ' + links.length;
        var a = document.createElement('a');
        a.className = 'rr-next-link';
        a.href = nx.getAttribute('href');
        a.textContent = title;
        var arrow = document.createElement('span');
        arrow.className = 'rr-next-arrow';
        arrow.textContent = ' →';
        a.appendChild(arrow);
        nav.appendChild(lab);
        nav.appendChild(a);
      } else {
        var done = document.createElement('span');
        done.className = 'rr-next-label';
        done.textContent = idx === links.length - 1
          ? 'Finished · ' + links.length + ' of ' + links.length + ' chapters'
          : 'End of chapter';
        var back = document.createElement('a');
        back.className = 'rr-next-link';
        back.href = '../../index.html';
        back.textContent = '← Back to Library';
        nav.appendChild(done);
        nav.appendChild(back);
      }
      main.appendChild(nav);
    } catch (e) {}
  }


  /* A book's own H1 is written for print: "2 Working with text data",
   * "Chapter 1. Overview of ...", "appendix AIntroduction to ...". The TOC
   * gets clean names from the build; the sticky top bar reads the heading
   * straight from the page, so it needs the same clean-up here. */
  function cleanChapterTitle(raw) {
    var t = (raw || '').replace(/\s+/g, ' ').trim();
    if (!t) return '';
    t = t.replace(/^appendix\s+([A-Za-z]|[0-9]+)\s*[.:\-\u2013\u2014]?\s*/i, '')
         .replace(/^part\s+([0-9]+|[A-Za-z])\s*[.:\-\u2013\u2014]?\s*/i, '')
         .replace(/^(?:[A-Za-z]{2,}\d{3,}\s*)?(?:lecture|chapter|chap\.?|section)\s*([0-9]+(?:\.[0-9]+)*)\s*[.:\-\u2013\u2014]?\s*/i, '')
         /* a bare number glued to the text: one or two digits only, so
          * "300K Subs" and "The Only 6 Metrics" keep their numbers */
         .replace(/^([0-9]{1,2})[\s\.:\)\-\u2013\u2014]*([A-Za-z].*)$/, '$2');
    return t.trim();
  }

  /* Some books define their own toggleChapter, some do not (and none of
   * them define navigateToChapter any more, since rows now navigate with
   * their own href). One owner, so the arrow always works. */
  if (!window.toggleChapter) {
    window.toggleChapter = function (event, idx) {
      if (event) { event.preventDefault(); event.stopPropagation(); }
      var arrow = document.getElementById('arrow-' + idx);
      var subs = document.getElementById('subs-' + idx);
      if (!subs) return;
      var open = subs.style.display !== 'none';
      subs.style.display = open ? 'none' : 'block';
      if (arrow) arrow.classList.toggle('open', !open);
    };
  }

  ensureCSS();

  /* ============================================================
   * Modern contents: chapter numbers, live filter, current-chapter
   * tracking, reading progress. Built here (not per book) so every
   * book and every future one gets the same panel.
   * ============================================================ */
  function tocRoot() {
    var p = panel();
    return p && p.id !== 'epub-toc' ? p : null;
  }

  function chapterRows() {
    var p = tocRoot();
    if (!p) return [];
    return Array.prototype.slice.call(p.querySelectorAll('.toc-chapter-wrap'));
  }

  function rowTitle(wrap) {
    var a = wrap.querySelector('a.toc-chapter');
    return a ? (a.textContent || '').trim() : '';
  }

  function currentFile() {
    var m = location.pathname.match(/([^/]+_reader\.html)$/);
    return m ? m[1] : location.pathname.split('/').pop();
  }

  function bookLabel() {
    var h = document.querySelector('.chapter-title h1, h1');
    return h ? (h.textContent || '').trim() : document.title;
  }

  function buildHeader() {
    var p = tocRoot();
    if (!p) return;
    var head = p.querySelector('.toc-header');
    if (!head) return;
    var h3 = head.querySelector('h3');
    if (!h3) return;
    h3.textContent = 'Contents';
    var label = bookLabel();
    var book = document.createElement('span');
    book.className = 'rr-toc-book';
    book.textContent = label;
    h3.parentNode.insertBefore(book, h3.nextSibling);
  }

  function buildFilter() {
    var p = tocRoot();
    if (!p) return;
    var nav = p.querySelector('.toc-nav');
    if (!nav) return;
    var rows = chapterRows();
    if (rows.length < 6) return;              /* nothing to filter */
    if (document.getElementById('rr-toc-search')) return;

    var box = document.createElement('div');
    box.className = 'rr-toc-search';
    var input = document.createElement('input');
    input.type = 'search';
    input.id = 'rr-toc-filter';
    input.placeholder = 'Find a chapter';
    input.setAttribute('aria-label', 'Find a chapter');
    box.appendChild(input);

    var empty = document.createElement('div');
    empty.className = 'rr-toc-empty';
    empty.textContent = 'No chapter matches that.';
    empty.id = 'rr-toc-empty';

    nav.parentNode.insertBefore(box, nav);
    nav.parentNode.insertBefore(empty, nav.nextSibling);

    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      var shown = 0;
      rows.forEach(function (w) {
        var hit = !q || rowTitle(w).toLowerCase().indexOf(q) !== -1;
        w.style.display = hit ? '' : 'none';
        if (hit) shown++;
      });
      empty.style.display = shown ? 'none' : 'block';
    });
    /* '/' focuses the filter, the way most reading tools do */
    document.addEventListener('keydown', function (e) {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      var tag = (e.target && e.target.tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (tocHidden()) return;
      e.preventDefault();
      input.focus();
      input.select();
    });
  }

  function buildFooter() {
    var p = tocRoot();
    if (!p) return;
    if (document.getElementById('rr-toc-foot')) return;
    var foot = document.createElement('div');
    foot.className = 'rr-toc-foot';
    foot.id = 'rr-toc-foot';
    foot.innerHTML = '<span class="rr-toc-label"></span>'
      + '<span class="rr-toc-meter"><i></i></span>'
      + '<span class="rr-toc-pct">0%</span>';
    p.appendChild(foot);
    updateProgress();
  }

  function slug() {
    var s = document.querySelector('script[data-rr-book]');
    return s ? s.getAttribute('data-rr-book') : '';
  }

  function updateProgress() {
    var foot = document.getElementById('rr-toc-foot');
    if (!foot) return;
    var rows = chapterRows();
    var all = window.RR && RR.bookProgress ? RR.bookProgress() : {};
    var mine = all[slug()] || {};
    var sum = 0, count = 0;
    rows.forEach(function (w) {
      var a = w.querySelector('a.toc-chapter');
      if (!a) return;
      var href = a.getAttribute('href') || '';
      var pct = 0;
      Object.keys(mine).forEach(function (k) {
        if (href.indexOf(k) !== -1) pct = Math.max(pct, mine[k]);
      });
      sum += pct;
      count++;
      w.classList.toggle('rr-started', pct > 0 && pct < 100);
    });
    var avg = count ? Math.round(sum / count) : 0;
    foot.querySelector('.rr-toc-label').textContent = count + (count === 1 ? ' chapter' : ' chapters');
    foot.querySelector('.rr-toc-pct').textContent = avg + '%';
    foot.querySelector('.rr-toc-meter i').style.width = avg + '%';
    if (typeof updateStatus === 'function') updateStatus();
  }

  /* Badge each row the way the book itself numbers it: chapters get their
   * own number, appendices a letter, front matter nothing at all. The build
   * writes data-kind/data-num so nothing is guessed from list position. */
  function markCurrent() {
    var here = currentFile();
    var rows = chapterRows();
    var current = null, chapterNo = 0;
    rows.forEach(function (w) {
      var a = w.querySelector('a.toc-chapter');
      if (!a) return;
      var title = a.querySelector('.rr-toc-title');
      if (!title && a.firstElementChild) a.firstElementChild.classList.add('rr-toc-title');
      var kind = w.getAttribute('data-kind') || 'chapter';
      var num = w.getAttribute('data-num') || '';
      var numEl = w.querySelector('.rr-toc-num');
      if (kind === 'chapter') chapterNo++;
      var label = '';
      if (kind === 'chapter') label = num || String(chapterNo);
      else if (kind === 'appendix') label = num || '';
      if (label) {
        if (!numEl) {
          numEl = document.createElement('span');
          numEl.className = 'rr-toc-num';
          a.insertBefore(numEl, a.firstChild);
        }
        numEl.textContent = label;
        numEl.classList.toggle('rr-toc-num-letter', kind !== 'chapter');
      } else if (numEl) {
        numEl.parentNode.removeChild(numEl);
      }
      w.classList.toggle('rr-front', kind === 'front');
      var href = (a.getAttribute('href') || '').split('#')[0];
      var hit = here && href && href === here;
      a.classList.toggle('rr-current', !!hit);
      if (hit) current = w;
    });
    if (current) {
      var arrow = current.querySelector('.toc-arrow');
      var subs = current.querySelector('.toc-subs');
      if (subs && subs.style.display === 'none') {
        subs.style.display = 'block';
        if (arrow) arrow.classList.add('open');
      }
    }
    return current;
  }

  /* highlight the sub-heading you are actually looking at */
  function spySubs() {
    var heads = Array.prototype.slice.call(document.querySelectorAll('.toc-panel a.toc-heading'));
    if (!heads.length) return;
    var best = null, bestTop = -Infinity;   /* -Inf, or the first heading can never win */
    heads.forEach(function (a) {
      var id = (a.getAttribute('href') || '').split('#')[1];
      if (!id) return;
      var el = document.getElementById(id);
      if (!el) return;
      var top = el.getBoundingClientRect().top;
      if (top <= 120 && top > bestTop) { bestTop = top; best = a; }
    });
    heads.forEach(function (a) { a.classList.remove('active'); });
    if (best) best.classList.add('active');
  }

  window.__rrSpySubs = spySubs;   /* exposed so the scroll-spy can be tested */

  function enhanceTOC() {
    if (!tocRoot()) return;
    buildHeader();
    buildFilter();
    buildFooter();
    markCurrent();
    var cur = markCurrent();
    if (cur) {
      try { cur.scrollIntoView({ block: 'nearest' }); } catch (e) {}
    }
    if (window.addEventListener) {
      var t = null;
      window.addEventListener('scroll', function () {
        if (t) return;
        t = setTimeout(function () { t = null; spySubs(); }, 120);
      });
      window.addEventListener('load', function () { markCurrent(); spySubs(); updateProgress(); });
    }
  }

  // reading streak: record today's visit (local-only, see assets/local.js)
  try {
    var __d = new Date(), __p = function (n) { return (n < 10 ? '0' : '') + n; };
    var __t = __d.getFullYear() + '-' + __p(__d.getMonth() + 1) + '-' + __p(__d.getDate());
    var __days = [];
    try { __days = JSON.parse(window.localStorage.getItem('rr-days') || '[]') || []; } catch (e2) {}
    if (!Array.isArray(__days)) __days = [];
    if (__days[__days.length - 1] !== __t) {
      __days.push(__t);
      if (__days.length > 400) __days = __days.slice(-400);
      try { window.localStorage.setItem('rr-days', JSON.stringify(__days)); } catch (e3) {}
    }
  } catch (e) {}
  /* Some books load this file from <head>, where document.body does not
   * exist yet. The boot used to throw on that first null and left the
   * contents panel without its filter, chapter badges or top bar. */
  function boot() {
  // marks chapter pages so the wide-screen right gutter rules apply
  // (open-epub / hub pages never get this class)
  if (document.body && document.body.classList) document.body.classList.add('rr-chapter');
  // default: visible on desktop, hidden drawer on mobile
  if (!isMobile() && document.body) {
    document.body.classList.remove('toc-hidden');
    var p0 = panel();
    if (p0) p0.classList.remove('rr-hidden');
  }
  ensureFab();
  buildTopbar();
  ensureFontBtn();
  ensureTheme();
  ensureThemeFab();
  buildContents();
  buildNext();
  saveProgress();
  enhanceTOC();
  buildStatusbar();   /* after enhanceTOC, which creates the footer it lives in */
  if (window.addEventListener) {
    window.addEventListener('resize', sync);
    // click outside the font menu closes it (menu button stops propagation)
    document.addEventListener('click', function (e) {
      var m = document.getElementById('epub-font-menu');
      if (!m || !m.classList.contains('show')) return;
      var t = e.target;
      if (t && t.closest && (t.closest('#epub-font-menu') || t.closest('#rr-font-btn'))) return;
      hideFontMenu();
    });
    // Esc closes an open TOC (both the desktop drawer and mobile overlay)
    window.addEventListener('keydown', function (e) {
      if ((e.key === 'Escape' || e.keyCode === 27)) {
        var fm = document.getElementById('epub-font-menu');
        if (fm && fm.classList.contains('show')) { hideFontMenu(); return; }
        if (!tocHidden()) window.toggleTOC();
      }
    });
  }
  sync();
  }
  /* Only a head-loaded copy has no body yet; scripts at the end of the
   * body can still run at once. */
  if (document.body) {
    boot();
  } else if (document.addEventListener) {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
