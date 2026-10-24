/* Copy button for code blocks.
 *
 * Shared by every book on the site, so a book published tomorrow gets the
 * buttons without anyone remembering to add them: the exporter only has to
 * ship this file and reference it from the reader header.
 *
 * Loaded on reader pages (static, so scan once) and on the EPUB reader, which
 * swaps whole chapters in and out, hence the MutationObserver. */
(function () {
  'use strict';

  var STYLE_ID = 'rr-code-copy-style';
  var CSS = [
    'pre.rr-copiable{position:relative}',
    '.rr-copy-btn{position:absolute;top:8px;right:8px;z-index:4;',
    'font:500 11px/1.2 ui-sans-serif,-apple-system,system-ui,sans-serif;letter-spacing:.03em;',
    'color:var(--text2,#8a8a8a);background:var(--bg2,#f4f2ec);',
    'border:1px solid var(--border2,rgba(0,0,0,.14));border-radius:6px;',
    'padding:5px 8px;cursor:pointer;transition:color .15s ease,border-color .15s ease}',
    /* always visible: the button belongs to the block, it is not a hover secret */
    '.rr-copy-btn:hover{color:var(--text,#111);border-color:var(--accent,#8a6820)}',
    '.rr-copy-btn:focus-visible{outline:2px solid var(--accent,#8a6820);outline-offset:2px}',
    '.rr-copy-btn.rr-copied{color:var(--accent,#8a6820);border-color:var(--accent,#8a6820)}',
    '@media print{.rr-copy-btn{display:none}}'
  ].join('');

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  /* The text a reader expects on the clipboard: the code itself, never the
   * line-number gutter Prism injects, never our own button. */
  function codeText(pre) {
    var code = pre.querySelector('code');
    var src = code || pre;
    var clone = src.cloneNode(true);
    var junk = clone.querySelectorAll('.line-numbers-rows, .line-numbers, .rr-copy-btn');
    for (var i = 0; i < junk.length; i++) junk[i].parentNode.removeChild(junk[i]);
    return clone.textContent.replace(/^\n+/, '').replace(/\s+$/, '');
  }

  function writeClipboard(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    /* file:// and plain http have no async clipboard; this still works */
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
      ok ? resolve() : reject(new Error('copy command rejected'));
    });
  }

  function enhance(pre) {
    if (!pre || pre.nodeType !== 1 || pre.dataset.rrCopy) return;
    if (pre.closest('script, style, textarea')) return;
    pre.dataset.rrCopy = '1';
    pre.classList.add('rr-copiable');

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rr-copy-btn';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code to clipboard');
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      writeClipboard(codeText(pre)).then(function () {
        btn.textContent = 'Copied';
        btn.classList.add('rr-copied');
      }, function () {
        btn.textContent = 'Press Ctrl+C';
      });
      clearTimeout(btn._t);
      btn._t = setTimeout(function () {
        btn.textContent = 'Copy';
        btn.classList.remove('rr-copied');
      }, 1600);
    });
    pre.appendChild(btn);
  }

  function scan(root) {
    ensureStyle();
    var scope = root || document;
    var found = scope.querySelectorAll ? scope.querySelectorAll('pre') : [];
    for (var i = 0; i < found.length; i++) enhance(found[i]);
    if (scope.tagName === 'PRE') enhance(scope);
  }

  /* chapters arrive later in the EPUB reader */
  if (window.MutationObserver && document.body) {
    var queued = false;
    var observer = new MutationObserver(function (records) {
      var hit = false;
      for (var i = 0; i < records.length && !hit; i++) {
        for (var j = 0; j < records[i].addedNodes.length; j++) {
          var n = records[i].addedNodes[j];
          if (n.nodeType === 1 && (n.tagName === 'PRE' || n.querySelector('pre'))) { hit = true; break; }
        }
      }
      if (!hit) return;
      if (queued) return;
      queued = true;
      setTimeout(function () { queued = false; scan(); }, 60);
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.RRCodeCopy = { scan: scan, text: codeText };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { scan(); });
  } else {
    scan();
  }
})();
