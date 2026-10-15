/* rr-epub: open any DRM-free EPUB in the browser, read it, annotate it.
 * Static-safe: JSZip (CDN) + IndexedDB. Marks reuse assets/annotate.js,
 * keyed per book/chapter in localStorage, so they persist across sessions. */
(function () {
  'use strict';

  var LIB_KEY = 'rr-epub-lib';
  var DB_NAME = 'rr-epub-db', DB_STORE = 'files';

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function libGet() { try { return JSON.parse(localStorage.getItem(LIB_KEY) || '[]'); } catch (e) { return []; } }
  function libSet(l) { try { localStorage.setItem(LIB_KEY, JSON.stringify(l)); } catch (e) {} }
  function err(msg) { var e = $('epub-err'); if (e) { e.textContent = msg; e.style.display = 'block'; } }
  function clearErr() { var e = $('epub-err'); if (e) e.style.display = 'none'; }

  /* ---------- IndexedDB (file bytes) ---------- */
  function idb() {
    return new Promise(function (res, rej) {
      try {
        var r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = function () { r.result.createObjectStore(DB_STORE); };
        r.onsuccess = function () { res(r.result); };
        r.onerror = function () { rej(r.error || new Error('indexeddb')); };
      } catch (e) { rej(e); }
    });
  }
  function idbPut(key, val) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(val, key);
        tx.oncomplete = function () { res(); };
        tx.onerror = function () { rej(tx.error); };
      });
    });
  }
  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (res, rej) {
        var tx = db.transaction(DB_STORE, 'readonly');
        var q = tx.objectStore(DB_STORE).get(key);
        q.onsuccess = function () { res(q.result); };
        q.onerror = function () { rej(q.error); };
      });
    });
  }
  function idbDel(key) {
    return idb().then(function (db) {
      return new Promise(function (res) {
        try {
          var tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(key);
          tx.oncomplete = function () { res(); };
          tx.onerror = function () { res(); };
        } catch (e) { res(); }
      });
    });
  }

  /* ---------- hash state ---------- */
  function parseHash() {
    var o = {};
    (location.hash || '').replace(/^#/, '').split('&').forEach(function (pair) {
      if (!pair) return;
      var kv = pair.split('=');
      o[kv[0]] = decodeURIComponent(kv[1] || '');
    });
    return o;
  }
  function setHash(b, c, f) {
    location.hash = 'b=' + encodeURIComponent(b) + '&c=' + c + (f ? '&f=' + encodeURIComponent(f) : '');
  }
  var SKIP_HASH = false;

  /* ---------- epub parsing ---------- */
  function dirOf(path) { var i = path.lastIndexOf('/'); return i < 0 ? '' : path.slice(0, i + 1); }
  function resolve(base, rel) {
    if (!rel || /^(https?:|mailto:|data:|blob:|#)/i.test(rel)) return rel || '';
    var parts = (base + rel).split('/'), out = [];
    parts.forEach(function (p) {
      if (p === '' || p === '.') { if (!out.length) out.push(''); return; }
      if (p === '..') {
        // Clamp at the archive root. A ".." with nothing above it is dropped,
        // not applied to the segment below it, so a path like
        // OEBPS/Text/../../OEBPS/Images/x.png resolves to
        // OEBPS/Images/x.png rather than OEBPS/OEBPS/Images/x.png.
        if (out.length > 1 || (out.length === 1 && out[0] !== '')) out.pop();
        return;
      }
      out.push(p);
    });
    return decodeURIComponent(out.join('/').replace(/^\//, ''));
  }
  function xmlDoc(text, type) {
    try {
      var d = new DOMParser().parseFromString(text, type || 'application/xml');
      if (d.querySelector('parsererror')) return null;
      return d;
    } catch (e) { return null; }
  }
  function childText(el, name) {
    if (!el) return '';
    var nodes = el.getElementsByTagName('dc:' + name);
    if (!nodes.length) nodes = el.getElementsByTagName(name);
    return nodes.length ? (nodes[0].textContent || '').trim() : '';
  }
  function samePath(a, b) {
    if (a === b) return true;
    var fa = a.split('/').pop(), fb = b.split('/').pop();
    return fa === fb && fa !== '';
  }

  function mapToc(entries, tocDir, spine) {
    var out = [];
    entries.forEach(function (e) {
      var src = String(e.src || '').split('#')[0];
      if (!src) return;
      var full = resolve(tocDir, src);
      var idx = -1;
      spine.forEach(function (s, k) { if (idx < 0 && samePath(s, full)) idx = k; });
      if (idx >= 0) out.push({ label: e.label || ('Section ' + (out.length + 1)), spine: idx });
    });
    return out;
  }

  function tocFromNavDoc(zip, navHref, navDir, spine, doc) {
    var navs = Array.from(doc.getElementsByTagName('nav'));
    var tocNav = null;
    navs.forEach(function (n) {
      var t = n.getAttributeNS ? (n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '') : '';
      if (/\btoc\b/.test(t || n.getAttribute('epub:type') || '')) tocNav = n;
    });
    if (!tocNav && navs.length) tocNav = navs[0];
    if (!tocNav) return [];
    var entries = [];
    var walk = function (ol) {
      Array.from(ol.children || []).forEach(function (li) {
        if (!li || (li.localName || li.nodeName).toLowerCase() !== 'li') return;
        var a = Array.from(li.children || []).find(function (c) {
          return (c.localName || c.nodeName).toLowerCase() === 'a';
        });
        if (a && a.getAttribute('href')) {
          entries.push({ label: (a.textContent || '').trim(), src: a.getAttribute('href') });
        }
        Array.from(li.children || []).forEach(function (c) {
          if ((c.localName || c.nodeName).toLowerCase() === 'ol') walk(c);
        });
      });
    };
    Array.from(tocNav.children || []).forEach(function (c) {
      if ((c.localName || c.nodeName).toLowerCase() === 'ol') walk(c);
    });
    return mapToc(entries, navDir, spine);
  }

  async function parseEpub(buf, fileName) {
    if (typeof JSZip === 'undefined') throw new Error('JSZip failed to load — this page needs internet access for its CDN libraries.');
    var zip;
    try { zip = await JSZip.loadAsync(buf); }
    catch (e) { throw new Error('Not a readable zip/EPUB file.'); }
    var containerFile = zip.file('META-INF/container.xml');
    if (!containerFile) throw new Error('Not an EPUB (missing META-INF/container.xml).');
    var cdoc = xmlDoc(await containerFile.async('string'));
    var rf = cdoc && cdoc.getElementsByTagName('rootfile')[0];
    var opfPath = rf && rf.getAttribute('full-path');
    if (!opfPath) throw new Error('No rootfile in container.xml.');
    var ofile = zip.file(opfPath);
    if (!ofile) throw new Error('Missing ' + opfPath + '.');
    var odoc = xmlDoc(await ofile.async('string'));
    if (!odoc) throw new Error('Cannot parse ' + opfPath + '.');

    var base = dirOf(opfPath);
    var manifest = {};
    Array.from(odoc.getElementsByTagName('item')).forEach(function (it) {
      var id = it.getAttribute('id');
      if (id) manifest[id] = {
        href: resolve(base, it.getAttribute('href') || ''),
        type: it.getAttribute('media-type') || '',
        props: it.getAttribute('properties') || ''
      };
    });
    var metadata = odoc.getElementsByTagName('metadata')[0];
    var title = childText(metadata, 'title') || String(fileName || 'Book').replace(/\.epub$/i, '');
    var creator = childText(metadata, 'creator');
    var pubType = childText(metadata, 'type');
    var spine = [];
    Array.from(odoc.getElementsByTagName('itemref')).forEach(function (ir) {
      if ((ir.getAttribute('linear') || 'yes') === 'no') return;
      var m = manifest[ir.getAttribute('idref')];
      if (m && m.href) spine.push(m.href);
    });
    if (!spine.length) throw new Error('Empty spine — nothing to read.');

    var toc = [];
    var ncxId = Object.keys(manifest).find(function (k) { return /ncx|dtbncx/i.test(manifest[k].type); });
    if (ncxId) {
      try {
        var npath = manifest[ncxId].href;
        var nfile = zip.file(npath);
        if (nfile) {
          var ndoc = xmlDoc(await nfile.async('string'));
          var navMap = ndoc && ndoc.getElementsByTagName('navMap')[0];
          if (navMap) {
            var pts = [];
            var walk = function (nodes) {
              Array.from(nodes).forEach(function (n) {
                var ln = (n.localName || n.nodeName || '').toLowerCase();
                if (ln === 'navpoint') {
                  var labelEl = n.getElementsByTagName('text')[0];
                  var cEl = n.getElementsByTagName('content')[0];
                  pts.push({
                    label: labelEl ? (labelEl.textContent || '').trim() : '',
                    src: cEl ? (cEl.getAttribute('src') || '') : ''
                  });
                  walk(n.childNodes);
                }
              });
            };
            walk(navMap.childNodes);
            toc = mapToc(pts, dirOf(npath), spine);
          }
        }
      } catch (e) {}
    }
    if (!toc.length) {
      var navId = Object.keys(manifest).find(function (k) {
        return (manifest[k].props || '').split(/\s+/).indexOf('nav') !== -1;
      });
      if (navId) {
        try {
          var vpath = manifest[navId].href;
          var vfile = zip.file(vpath);
          if (vfile) {
            var vdoc = xmlDoc(await vfile.async('string'), 'application/xhtml+xml');
            if (!vdoc) vdoc = new DOMParser().parseFromString(await vfile.async('string'), 'text/html');
            if (vdoc) toc = tocFromNavDoc(zip, vpath, dirOf(vpath), spine, vdoc);
          }
        } catch (e) {}
      }
    }
    return { zip: zip, title: title, creator: creator, spine: spine, toc: toc, pubType: pubType };
  }

  /* ---------- reading settings (font / size / measure / theme / view) ---------- */
  var FSIZES = [['s', 'S'], ['m', 'M'], ['l', 'L']];
  var RFONTS = [['spectral', 'Spectral'], ['newsreader', 'Newsreader'], ['source-serif', 'Source Serif 4'], ['caslon', 'Adobe Caslon Pro'], ['cormorant', 'Cormorant Garamond'], ['atkinson', 'Atkinson Hyperlegible'], ['jetbrains', 'JetBrains Mono']];
  function settingsState() {
    var s = { fsize: 'm', wide: '0', theme: 'light' };
    try {
      s.fsize = localStorage.getItem('rr-epub-fsize') || 'm';
      s.wide = localStorage.getItem('rr-epub-wide') || '0';
      s.theme = localStorage.getItem('rr-theme') || 'light';
    } catch (e) {}
    if (s.fsize !== 's' && s.fsize !== 'l') s.fsize = 'm';
    return s;
  }
  function applySettings() {
    var s = settingsState();
    var rf = 'spectral';
    try { rf = localStorage.getItem('rr-font') || 'spectral'; } catch (e) {}
    if (!RFONTS.some(function (f) { return f[0] === rf; })) rf = 'spectral';
    document.body.dataset.rrFsize = s.fsize;
    document.body.dataset.rrWide = s.wide === '1' ? '1' : '0';
    document.documentElement.dataset.theme = s.theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-rfont', rf);
    var fb = $('epub-font-btn');
    if (fb) {
      var label = 'Spectral';
      RFONTS.forEach(function (f) { if (f[0] === rf) label = f[1]; });
      fb.title = 'Reading font: ' + label + ' (tap to change)';
    }
  }
  function fontStack(key) {
    if (key === 'newsreader') return "'Newsreader',Georgia,serif";
    if (key === 'source-serif') return "'Source Serif 4',Georgia,serif";
    if (key === 'atkinson') return "'Atkinson Hyperlegible',Verdana,sans-serif";
    if (key === 'caslon') return "'Adobe Caslon Pro','Cormorant Garamond',Georgia,serif";
    if (key === 'cormorant') return "'Cormorant Garamond',Georgia,serif";
    if (key === 'jetbrains') return "'JetBrains Mono',ui-monospace,Menlo,monospace";
    return "'Spectral',Georgia,serif";
  }
  function ensureFontMenu() {
    var m = $('epub-font-menu');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'epub-font-menu';
    m.className = 'rr-ui';
    m.setAttribute('role', 'menu');
    m.innerHTML = RFONTS.map(function (f) {
      return '<button data-rr-font="' + f[0] + '" style="font-family:' + fontStack(f[0]) + '">' +
        '<span>' + f[1] + '</span><span class="rr-ff-aa">Ag</span></button>';
    }).join('');
    document.body.appendChild(m);
    m.querySelectorAll('[data-rr-font]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        try { localStorage.setItem('rr-font', b.getAttribute('data-rr-font')); } catch (e) {}
        applySettings();
        hideFontMenu();
      });
    });
    return m;
  }
  function hideFontMenu() {
    var m = $('epub-font-menu');
    if (m) m.classList.remove('show');
  }
  function hidePopups() { hideFontMenu(); hideSettings(); }
  function toggleFontMenu() {
    var m = ensureFontMenu();
    if (m.classList.contains('show')) { hideFontMenu(); return; }
    hideSettings();
    var cur = 'spectral';
    try { cur = localStorage.getItem('rr-font') || 'spectral'; } catch (e) {}
    m.querySelectorAll('[data-rr-font]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-rr-font') === cur);
    });
    var anchor = $('epub-font-btn');
    m.classList.add('show');
    var mw = m.offsetWidth || 240, mh = m.offsetHeight || 150;
    var x = 8, y = 8;
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      x = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - mw - 8));
      y = r.bottom + 8;
      if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 8);
    }
    m.style.left = x + 'px';
    m.style.top = y + 'px';
  }
  /* ---------- settings panel (size / measure / theme / view) ---------- */
  function segRow(label, opts, cur, key) {
    return '<div class="rr-set-row"><span class="rr-set-label">' + label + '</span>' +
      '<span class="rr-seg">' + opts.map(function (o) {
        return '<button data-set="' + key + '" data-val="' + o[0] + '"' +
          (o[0] === cur ? ' class="on"' : '') + '>' + o[1] + '</button>';
      }).join('') + '</span></div>';
  }
  function ensureSettings() {
    var p = $('epub-settings');
    if (p) return p;
    p = document.createElement('div');
    p.id = 'epub-settings';
    p.className = 'rr-ui';
    p.setAttribute('role', 'menu');
    document.body.appendChild(p);
    return p;
  }
  function hideSettings() {
    var p = $('epub-settings');
    if (p) p.classList.remove('show');
  }
  function renderSettings() {
    var p = ensureSettings();
    var s = settingsState();
    p.innerHTML =
      segRow('Text size', FSIZES, s.fsize, 'fsize') +
      segRow('Measure', [['0', 'Narrow'], ['1', 'Wide']], s.wide, 'wide') +
      segRow('Theme', [['light', 'Light'], ['dark', 'Dark']], s.theme, 'theme');
    p.querySelectorAll('[data-set]').forEach(function (b) {
      b.addEventListener('click', function (ev) {
        ev.stopPropagation();
        var k = b.getAttribute('data-set'), v = b.getAttribute('data-val');
        var key = k === 'fsize' ? 'rr-epub-fsize' : (k === 'wide' ? 'rr-epub-wide' : 'rr-theme');
        try { localStorage.setItem(key, v); } catch (e) {}
        applySettings();
        renderSettings();
      });
    });
    return p;
  }
  function toggleSettings() {
    var p = ensureSettings();
    if (p.classList.contains('show')) { hideSettings(); return; }
    hideFontMenu();
    renderSettings();
    var anchor = $('epub-settings-btn');
    p.classList.add('show');
    var mw = p.offsetWidth || 280, mh = p.offsetHeight || 200;
    var x = 8, y = 8;
    if (anchor) {
      var r = anchor.getBoundingClientRect();
      x = Math.min(Math.max(8, r.left), Math.max(8, window.innerWidth - mw - 8));
      y = r.bottom + 8;
      if (y + mh > window.innerHeight - 8) y = Math.max(8, r.top - mh - 8);
    }
    p.style.left = x + 'px';
    p.style.top = y + 'px';
  }
  function wireSettings() {
    var sb = $('epub-settings-btn'), fb = $('epub-font-btn');
    if (sb) sb.onclick = function (ev) {
      if (ev) ev.stopPropagation();
      toggleSettings();
    };
    if (fb) fb.onclick = function (ev) {
      if (ev) ev.stopPropagation();
      toggleFontMenu();
    };
    // wireSettings runs on boot and per chapter: attach these once.
    if (!wireSettings.done) {
      wireSettings.done = true;
      document.addEventListener('mousedown', function (e) {
        var fm = $('epub-font-menu'), sp = $('epub-settings');
        var fmOpen = fm && fm.classList.contains('show');
        var spOpen = sp && sp.classList.contains('show');
        if (!fmOpen && !spOpen) return;
        // clicks on the Aa / Settings buttons toggle via click handlers
        if (e.target && e.target.closest &&
            e.target.closest('#epub-font-btn,#epub-settings-btn')) return;
        if (fmOpen && !fm.contains(e.target)) hideFontMenu();
        if (spOpen && !sp.contains(e.target)) hideSettings();
      });
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hidePopups(); });
      window.addEventListener('scroll', function () { hidePopups(); }, true);
    }
  }

  /* ---------- reader ---------- */
  var BOOK = null;      // {id, meta, parsed}
  var CUR = 0;
  var imgCache = {};

  function chapterEntries(P) {
    if (P.toc && P.toc.length) return P.toc.map(function (t) { return { label: t.label, spine: t.spine }; });
    if (P.spine.length === 1) return [{ label: P.title, spine: 0 }];
    return P.spine.map(function (s, i) {
      var fn = s.split('/').pop().replace(/\.(xhtml|html|htm)$/i, '').replace(/[-_]+/g, ' ').trim();
      return { label: fn || ('Chapter ' + (i + 1)), spine: i };
    });
  }
  // First readable spine index: skips machine TOC files (nav.xhtml sits at
  // spine[0] in ebooklib output) so fresh imports land on content, never nav.
  function firstContentSpine(P) {
    var entries = chapterEntries(P);
    for (var k = 0; k < entries.length; k++) {
      var sp = P.spine[entries[k].spine] || '';
      var base = sp.split('/').pop().toLowerCase();
      var label = (entries[k].label || '').trim().toLowerCase();
      if (base === 'nav.xhtml' || label === 'nav' || label === 'toc' || label === 'cover') continue;
      return entries[k].spine;
    }
    return entries.length ? entries[0].spine : 0;
  }
  function isNavSpine(P, idx) {
    var sp = P.spine[idx] || '';
    return sp.split('/').pop().toLowerCase() === 'nav.xhtml';
  }

  function blobUrl(path) {
    if (imgCache[path]) return Promise.resolve(imgCache[path]);
    var f = BOOK.parsed.zip.file(path) || BOOK.parsed.zip.file(encodeURI(path));
    if (!f) return Promise.resolve(null);
    return f.async('blob').then(function (b) {
      var u = URL.createObjectURL(b);
      imgCache[path] = u;
      return u;
    }).catch(function () { return null; });
  }

  function renderReader() {
    $('epub-library').style.display = 'none';
    $('epub-reader').style.display = 'block';
    document.body.classList.add('epub-reading');
    document.body.classList.toggle('rr-article', !!(BOOK && BOOK.article));
    if (BOOK && BOOK.article) {
      // articles read as one page: no chapters chrome at all
      $('epub-tocwrap').style.display = 'none';
      var P0 = BOOK.parsed;
      $('epub-booktitle').textContent = P0.title;
      $('epub-toc-btn').onclick = function () { toggleEpubToc(); };
      wireSettings();
      return;
    }
    $('epub-tocwrap').style.display = 'block';
    var toc = $('epub-toc');
    if (window.innerWidth <= 900) {
      toc.classList.remove('open');
    } else {
      toc.classList.add('open');
      toc.classList.remove('rr-hidden');
      document.body.classList.remove('epub-toc-hidden');
    }
    var P = BOOK.parsed;
    $('epub-booktitle').textContent = P.title;
    $('epub-toc-btn').onclick = function () { toggleEpubToc(); };
    wireSettings();
    $('epub-toc-close').onclick = function () { toggleEpubToc(); };
    $('epub-toc-overlay').onclick = function () { toggleEpubToc(); };
    $('epub-lib-btn').onclick = function () { location.hash = ''; location.reload(); };
  }

  function toggleEpubToc() {
    var t = $('epub-toc');
    if (window.innerWidth <= 900) {
      t.classList.toggle('open');
      $('epub-toc-overlay').classList.toggle('show', t.classList.contains('open'));
    } else {
      t.classList.toggle('rr-hidden');
      document.body.classList.toggle('epub-toc-hidden', t.classList.contains('rr-hidden'));
    }
  }

  function renderTocNav() {
    var P = BOOK.parsed;
    var entries = chapterEntries(P);
    var nav = $('epub-toc-nav');
    nav.innerHTML = entries.map(function (e, k) {
      return '<div class="toc-chapter-wrap">' +
        '<a href="#b=' + encodeURIComponent(BOOK.id) + '&c=' + e.spine + '" class="toc-chapter' + (k === CUR ? ' active' : '') + '" data-ch="' + k + '">' +
        '<span>' + esc(e.label) + '</span>' +
        '</a></div>';
    }).join('');
    nav.querySelectorAll('a[data-ch]').forEach(function (a) {
      a.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (window.innerWidth <= 900) toggleEpubToc();
        goChapter(parseInt(a.getAttribute('data-ch'), 10));
      });
    });
  }

  function goChapter(i, frag) {
    var P = BOOK.parsed;
    var entries = chapterEntries(P);
    if (i < 0) i = 0;
    if (i >= entries.length) i = entries.length - 1;
    var targetSpine = entries[i].spine;
    var curSpine = entries[CUR] ? entries[CUR].spine : -1;
    if (targetSpine === curSpine && $('epub-content').innerHTML) {
      SKIP_HASH = true;
      setHash(BOOK.id, targetSpine, frag);
      setTimeout(function () { scrollToFrag(frag); flashFrag(frag); }, 30);
      return;
    }
    setHash(BOOK.id, targetSpine, frag);
    location.reload();
  }

  function scrollToFrag(frag) {
    if (!frag) { try { window.scrollTo(0, 0); } catch (e) {} return; }
    var el = document.getElementById(frag);
    if (el) { try { el.scrollIntoView({ block: 'start' }); } catch (e) { el.scrollIntoView(); } }
    else { try { window.scrollTo(0, 0); } catch (e) {} }
  }

  function flashFrag(frag) {
    if (!frag) return;
    var el = document.getElementById(frag);
    if (el) { el.classList.remove('rr-flash'); void el.offsetWidth; el.classList.add('rr-flash'); }
  }

  function ensureHeadingIds(root) {
    var n = 0;
    root.querySelectorAll('h2,h3').forEach(function (h) {
      var t = (h.textContent || '').replace(/\s+/g, ' ').trim();
      if (!t) return;
      if (!h.getAttribute('id')) h.setAttribute('id', 'rr-eh-' + (n++));
      else {
        // count real ids too so generated ids stay in document order
        var m = /^rr-eh-(\d+)$/.exec(h.getAttribute('id'));
        if (m) n = Math.max(n, parseInt(m[1], 10) + 1);
      }
    });
  }

  async function renderChapter(spineIdx) {
    var P = BOOK.parsed;
    var entries = chapterEntries(P);
    var pos = 0;
    entries.forEach(function (e, k) { if (e.spine === spineIdx) pos = k; });
    var path = P.spine[spineIdx];
    if (!path) { err('Chapter not found.'); return; }
    var file = P.zip.file(path);
    if (!file) { err('Missing chapter file: ' + path); return; }
    var text = await file.async('string');
    var doc = xmlDoc(text, 'application/xhtml+xml');
    if (!doc) {
      try { doc = new DOMParser().parseFromString(text, 'text/html'); } catch (e) { doc = null; }
    }
    if (!doc) { err('Cannot parse chapter: ' + path); return; }
    var body = doc.querySelector('body') || doc.documentElement;
    var host = $('epub-content');
    host.innerHTML = '';
    var cdir = dirOf(path);

    body.querySelectorAll('img').forEach(function (img) {
      var src = img.getAttribute('src');
      if (!src || /^(https?:|data:|blob:)/i.test(src)) return;
      var full = resolve(cdir, src.split('#')[0]);
      // Park a blank pixel first: without it the browser fires a junk HTTP
      // request for the zip-relative path the moment the node is inserted,
      // before the blob URL below is ready.
      img.setAttribute('src', 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==');
      blobUrl(full).then(function (u) {
        if (u) img.setAttribute('src', u);
        else img.remove();
      });
    });
    body.querySelectorAll('a[href]').forEach(function (a) {
      var href = a.getAttribute('href') || '';
      if (/^(https?:|mailto:)/i.test(href)) {
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
        return;
      }
      if (href.charAt(0) === '#') return;
      var full = resolve(cdir, href.split('#')[0]);
      var frag = href.split('#')[1] || '';
      var idx = -1;
      P.spine.forEach(function (s, k) { if (idx < 0 && samePath(s, full)) idx = k; });
      if (idx >= 0) {
        a.setAttribute('href', '#b=' + encodeURIComponent(BOOK.id) + '&c=' + idx + (frag ? '&f=' + encodeURIComponent(frag) : ''));
        a.addEventListener('click', function (ev) {
          ev.preventDefault();
          setHash(BOOK.id, idx, frag || '');
          location.reload();
        });
      }
    });
    Array.from(body.childNodes).forEach(function (n) { host.appendChild(document.adoptNode(n)); });
    ensureHeadingIds(host);

    CUR = pos;
    document.title = P.title + ' — ' + entries[pos].label;
    try { window.scrollTo(0, 0); } catch (e) {}
    var hh = parseHash();
    if (hh.f) {
      setTimeout(function () { scrollToFrag(hh.f); flashFrag(hh.f); }, 400);
    }
    highlightCodeBlocks(host);
    buildContentsCard(entries[pos].spine);

    var meta = libGet().find(function (m) { return m.id === BOOK.id; });
    if (meta) { meta.current = spineIdx; libSet(libGet().map(function (m) { return m.id === meta.id ? meta : m; })); }

    injectAnnotate(path.split('/').pop());
  }

  /* ---------- tiny syntax highlighter (no deps, theme-aware via CSS) ---------- */
  var RR_KWSET = {};
  ('break case catch class const continue debugger def del elif else except finally for from ' +
   'function global if import in is lambda let new nonlocal not or pass raise return try while with yield ' +
   'as assert async await typeof instanceof this self super None True False print len range str int float ' +
   'list dict set tuple var null true false undefined').split(' ').forEach(function (w) { RR_KWSET[w] = 1; });
  function rrEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function highlightCodeText(text) {
    var out = '', i = 0, n = text.length;
    while (i < n) {
      var c = text[i], nx = i + 1 < n ? text[i + 1] : '';
      // strings (triple-quoted first so docstrings win)
      if (c === '"' || c === "'" || c === '`') {
        var q1 = c, j = i + 1, triple = false;
        if (nx === c && (i + 2 < n ? text[i + 2] : '') === c) { q1 = c + c + c; j = i + 3; triple = true; }
        var k = j;
        while (k < n) {
          if (text[k] === '\\') { k += 2; continue; }
          if (triple ? text.substr(k, 3) === q1 : text[k] === q1) { k += triple ? 3 : 1; break; }
          if (!triple && text[k] === '\n') break;
          k++;
        }
        out += '<span class="tok-s">' + rrEsc(text.slice(i, k)) + '</span>';
        i = k;
        continue;
      }
      // line comments (#, //)
      if (c === '#' || (c === '/' && nx === '/')) {
        var e = text.indexOf('\n', i);
        if (e < 0) e = n;
        out += '<span class="tok-c">' + rrEsc(text.slice(i, e)) + '</span>';
        i = e;
        continue;
      }
      // block comments (/* */)
      if (c === '/' && nx === '*') {
        var ce = text.indexOf('*/', i + 2);
        ce = ce < 0 ? n : ce + 2;
        out += '<span class="tok-c">' + rrEsc(text.slice(i, ce)) + '</span>';
        i = ce;
        continue;
      }
      // numbers
      if (c >= '0' && c <= '9') {
        var m = /^[\w.]+/.exec(text.slice(i));
        out += '<span class="tok-n">' + rrEsc(m ? m[0] : c) + '</span>';
        i += m ? m[0].length : 1;
        continue;
      }
      // words: keywords or plain
      if (/[A-Za-z_]/.test(c)) {
        var w = /^[A-Za-z_]\w*/.exec(text.slice(i))[0];
        out += RR_KWSET[w] ? '<span class="tok-k">' + rrEsc(w) + '</span>' : rrEsc(w);
        i += w.length;
        continue;
      }
      out += rrEsc(c);
      i++;
    }
    return out;
  }
  function highlightCodeBlocks(host) {
    host.querySelectorAll('pre').forEach(function (pre) {
      if (pre.dataset.rrHl) return;
      pre.dataset.rrHl = '1';
      var target = pre.querySelector('code') || pre;
      if (target.children.length) return; // already structured: leave alone
      var t = target.textContent || '';
      if (!t.trim()) return;
      target.innerHTML = highlightCodeText(t);
      pre.classList.add('rr-hl');
    });
  }

  /* ---------- in-chapter contents card (right gutter + scroll-spy) ---------- */
  function shortHead(h) { return (h.textContent || '').replace(/\s+/g, ' ').trim(); }
  function buildContentsCard(mySpine) {
    if (document.querySelector('.rr-contents')) return;
    var host = $('epub-content');
    if (!host || !BOOK) return;
    var heads = [];
    host.querySelectorAll('h2[id], h3[id]').forEach(function (h) {
      if (h.closest && h.closest('.rr-ui')) return;
      if (shortHead(h)) heads.push(h);
    });
    if (heads.length < 2) return;
    var card = document.createElement('nav');
    card.className = 'rr-contents rr-ui';
    card.setAttribute('aria-label', 'In this chapter');
    var label = document.createElement('div');
    label.className = 'rr-contents-label';
    label.textContent = 'Contents';
    card.appendChild(label);
    var ol = document.createElement('ol');
    var n2 = 0, n3 = 0, links = [];
    heads.forEach(function (h) {
      var t = shortHead(h);
      if (t.length > 90) t = t.slice(0, 87) + '…';
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.href = '#b=' + encodeURIComponent(BOOK.id) + '&c=' + mySpine + '&f=' + encodeURIComponent(h.id);
      a.dataset.frag = h.id;
      if (h.tagName === 'H2') {
        n2++; n3 = 0;
        a.innerHTML = '<span class="rr-contents-num">' + n2 + ' &middot;</span>';
        a.appendChild(document.createTextNode(t));
      } else {
        n3++;
        a.className = 'rr-sub';
        // h3s before any h2 (n2===0) or pre-numbered source headings:
        // never print a bogus "0.N" prefix, just indent.
        a.appendChild(document.createTextNode((n2 > 0 ? n2 + '.' + n3 + ' ' : '') + t));
      }
      li.appendChild(a);
      ol.appendChild(li);
      links.push(a);
    });
    if (!links.length) return;
    card.appendChild(ol);
    host.insertBefore(card, host.firstChild);
    document.body.classList.add('epub-has-contents');
    var items = heads.slice();
    function spyUpdate() {
      var cur = null;
      items.forEach(function (h) {
        try { if (h.getBoundingClientRect().top <= 140) cur = h.id; } catch (e) {}
      });
      links.forEach(function (a) {
        a.classList.toggle('active', !!cur && a.dataset.frag === cur);
      });
    }
    ol.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a || !a.dataset.frag) return;
      e.preventDefault();
      SKIP_HASH = true;
      setHash(BOOK.id, mySpine, a.dataset.frag);
      var frag = a.dataset.frag;
      setTimeout(function () { scrollToFrag(frag); flashFrag(frag); spyUpdate(); }, 30);
    });
    var ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      (window.requestAnimationFrame || function (f) { f(); })(function () {
        ticking = false;
        spyUpdate();
      });
    });
    spyUpdate();
  }

  function injectAnnotate(pageId) {
    var old = $('rr-epub-annotate');
    if (old) old.remove();
    var s = document.createElement('script');
    s.id = 'rr-epub-annotate';
    s.src = 'assets/annotate.js?v=6';
    s.setAttribute('data-rr-book', 'epub-' + BOOK.id);
    s.setAttribute('data-rr-page', pageId);
    s.setAttribute('data-rr-prefix', './');
    document.body.appendChild(s);
  }

  /* ---------- library ---------- */
  function showLibrary() {
    $('epub-reader').style.display = 'none';
    $('epub-tocwrap').style.display = 'none';
    document.body.classList.remove('epub-reading', 'epub-toc-hidden', 'rr-article', 'epub-has-contents');
    $('epub-content').innerHTML = '';
    $('epub-library').style.display = 'block';
    document.title = 'Open EPUB — Reading Room';
    var lib = libGet();
    var list = $('epub-lib-list');
    if (!lib.length) {
      list.innerHTML = '<p class="epub-row-meta">No books yet — add your first EPUB above.</p>';
      return;
    }
    list.innerHTML = lib.map(function (m) {
      var when = '';
      try {
        if (m.added) {
          var d = new Date(m.added);
          if (!isNaN(d)) when = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        }
      } catch (e) {}
      var resume = (m.current | 0) > 0;
      var meta = [m.creator, m.chapters + ' chapters', m.file].filter(Boolean).join(' · ') +
        (when ? ' · ' + when : '');
      return '<div class="epub-row"><div class="epub-row-info">' +
        '<div class="epub-row-title">' + esc(m.title) + '</div>' +
        '<div class="epub-row-meta">' + esc(meta) +
        (resume ? ' · continue ch ' + (m.current + 1) : '') + '</div>' +
        '</div><button data-open="' + esc(m.id) + '">' + (resume ? 'continue' : 'open') + '</button>' +
        '<button class="epub-del" data-del="' + esc(m.id) + '">delete</button></div>';
    }).join('');
    list.querySelectorAll('[data-open]').forEach(function (b) {
      b.addEventListener('click', function () {
        var meta = libGet().find(function (m) { return m.id === b.getAttribute('data-open'); });
        setHash(b.getAttribute('data-open'), (meta && meta.current) || 0);
        location.reload();
      });
    });
    list.querySelectorAll('[data-del]').forEach(function (b) {
      b.addEventListener('click', function () { deleteBook(b.getAttribute('data-del')); });
    });
  }

  function purgeMarks(id) {
    var prefixes = ['rr:epub-' + id + ':', 'rr-import:epub-' + id + ':'];
    var exact = ['rr-hidden:epub-' + id, 'rr-notes-removed:epub-' + id];
    try {
      var drop = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (prefixes.some(function (p) { return k.indexOf(p) === 0; }) || exact.indexOf(k) !== -1) drop.push(k);
      }
      drop.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
  }

  async function deleteBook(id) {
    if (!window.confirm('Remove this book and its stored file from this browser?')) return;
    libSet(libGet().filter(function (m) { return m.id !== id; }));
    try { await idbDel(id); } catch (e) {}
    purgeMarks(id);
    var h = parseHash();
    if (h.b === id) { location.hash = ''; location.reload(); }
    else showLibrary();
  }

  async function handleBytes(buf, name) {
    clearErr();
    var box = $('epub-upload');
    var orig = box.querySelector('.epub-up-title').textContent;
    try {
      box.querySelector('.epub-up-title').textContent = 'Reading…';
      var parsed = await parseEpub(buf, name);
      var id = 'b' + Date.now().toString(36);
      try { await idbPut(id, buf); }
      catch (e) { err('Could not store the file — browser storage is unavailable or full.'); return; }
      var lib = libGet();
      lib.unshift({ id: id, title: parsed.title, creator: parsed.creator, file: name, chapters: parsed.spine.length, added: Date.now(), current: 0 });
      libSet(lib);
      setHash(id, 0);
      location.reload();
    } catch (e) {
      err('Could not open that EPUB (' + (e && e.message ? e.message : e) + ')');
    } finally {
      try { box.querySelector('.epub-up-title').textContent = orig; } catch (e2) {}
    }
  }
  // set by boot() once the reader is ready; used by the paste-a-link form.
  window.rrHandleEpubBytes = handleBytes;

  async function handleFile(file) {
    clearErr();
    if (!file || !/\.epub$/i.test(file.name || '')) { err('Please choose a file ending in .epub'); return; }
    var buf = await file.arrayBuffer();
    return handleBytes(buf, file.name);
  }

  async function openBook(id, chapIdx) {
    var meta = libGet().find(function (m) { return m.id === id; });
    if (!meta) { showLibrary(); return; }
    var buf = null;
    try { buf = await idbGet(id); } catch (e) {}
    if (!buf) { err('The stored file for this book is gone — please add it again.'); showLibrary(); return; }
    var parsed = await parseEpub(buf, meta.file || meta.title);
    BOOK = { id: id, meta: meta, parsed: parsed };
    // pasted articles/blogs (dc:type article) always read as one page.
    BOOK.article = parsed.pubType === 'article';
    imgCache = {};
    renderReader();
    renderTocNav();
    // The hash chapter may name the machine TOC (nav.xhtml sits at spine[0]
    // in ebooklib output) or predate the book's entries: resolve to the
    // first readable content instead of ever painting nav.
    var want = chapIdx || 0;
    var valid = chapterEntries(parsed).some(function (e) { return e.spine === want; });
    await renderChapter((valid && !isNavSpine(parsed, want)) ? want : firstContentSpine(parsed));
  }

  /* ---------- boot ---------- */
  function boot() {
    applySettings();
    wireSettings();
    var up = $('epub-upload'), fi = $('epub-file');
    if (up && fi) {
      up.addEventListener('click', function () { fi.click(); });
      fi.addEventListener('change', function () {
        if (fi.files && fi.files[0]) handleFile(fi.files[0]);
        fi.value = '';
      });
    }
    var h = parseHash();
    if (h.b) {
      openBook(h.b, parseInt(h.c || '0', 10) || 0).catch(function (e) {
        err('Could not open that book (' + (e && e.message ? e.message : e) + ')');
        showLibrary();
      });
    } else {
      showLibrary();
    }
    window.addEventListener('hashchange', function () {
      // back/forward buttons: state is fully derived from the hash.
      // Same-chapter jumps set SKIP_HASH and scroll without reloading.
      if (SKIP_HASH) { SKIP_HASH = false; return; }
      location.reload();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else { boot(); }
})();
