/* course-theme.js — course-room chrome: theme toggle + default font.
 * Runs last (injected before </body>), after chapter-toc.js and settings'
 * inline scripts. Theme persists as rr-course-theme (dark default).
 * Reading font defaults to JetBrains Mono (rr-font key) so the Aa button
 * offers it first and the label matches what is shown. Adds a body class
 * for the scoped CSS and a floating icon toggle pill. Rewires the settings
 * page's own #theme-btn so both controls stay in sync. */
(function () {
  'use strict';
  var THEME_KEY = 'rr-course-theme';
  var FONT_KEY = 'rr-font';

  var SUN = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/>'
    + '<path d="M12 2v2.5M12 19.5V22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M2 12h2.5M19.5 12H22'
    + 'M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  var MOON = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"'
    + ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
    + '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  function getTheme() {
    try { return window.localStorage.getItem(THEME_KEY) || 'dark'; }
    catch (e) { return 'dark'; }
  }
  function paint() {
    var t = getTheme(), root = document.documentElement;
    if (t === 'light') root.setAttribute('data-theme', 'light');
    else root.setAttribute('data-theme', 'dark');
    var icon = t === 'dark' ? SUN : MOON;
    var tip = t === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    var fab = document.getElementById('course-theme-fab');
    if (fab) { fab.innerHTML = icon; fab.title = tip; fab.setAttribute('aria-label', tip); }
    var sb = document.getElementById('theme-btn');
    if (sb) { sb.innerHTML = icon; sb.title = tip; sb.setAttribute('aria-label', tip); }
  }
  function toggleTheme() {
    var next = getTheme() === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(THEME_KEY, next); } catch (e) {}
    paint();
  }

  var isReader = !!document.querySelector('.reader-content');
  var isSettings = !!document.getElementById('btn-export');
  if (isReader) document.body.classList.add('course-room');
  if (isSettings) document.body.classList.add('course-settings');

  /* default reading font: JetBrains Mono (Aa offers the rest) */
  if (isReader) {
    var hasFont = false;
    try { hasFont = !!window.localStorage.getItem(FONT_KEY); } catch (e) {}
    if (!hasFont) {
      try { window.localStorage.setItem(FONT_KEY, 'jetbrains'); } catch (e) {}
      try { document.documentElement.setAttribute('data-rfont', 'jetbrains'); } catch (e) {}
      var ab = document.getElementById('rr-font-btn');
      if (ab) {
        ab.setAttribute('aria-label', 'Reading font: JetBrains Mono (tap to change)');
        ab.title = 'Font: JetBrains Mono \u2014 tap to change';
      }
    }
  }

  var fab = document.createElement('button');
  fab.id = 'course-theme-fab';
  fab.onclick = toggleTheme;
  document.body.appendChild(fab);

  var sb = document.getElementById('theme-btn');
  if (sb) {
    sb.removeAttribute('onclick');
    sb.onclick = function () { toggleTheme(); };
  }

  paint();
  window.__courseTheme = { toggle: toggleTheme };
})();
