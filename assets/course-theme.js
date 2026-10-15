/* course-theme.js — single owner of the course-room light/dark toggle.
 * Runs last (injected before </body>), after chapter-toc.js and settings'
 * inline scripts. Persists as rr-course-theme (dark default). Adds a body
 * class for the scoped CSS and a floating toggle pill. Also rewires the
 * settings page's own #theme-btn so both controls stay in sync. */
(function () {
  'use strict';
  var KEY = 'rr-course-theme';

  function get() {
    try { return window.localStorage.getItem(KEY) || 'dark'; }
    catch (e) { return 'dark'; }
  }
  function label(t) { return t === 'dark' ? '\u2600 light' : '\u263e dark'; }
  function paint() {
    var t = get(), root = document.documentElement;
    if (t === 'light') root.setAttribute('data-theme', 'light');
    else root.setAttribute('data-theme', 'dark');
    var fab = document.getElementById('course-theme-fab');
    if (fab) fab.textContent = label(t);
    var sb = document.getElementById('theme-btn');
    if (sb) sb.textContent = label(t);
  }
  function toggle() {
    var next = get() === 'dark' ? 'light' : 'dark';
    try { window.localStorage.setItem(KEY, next); } catch (e) {}
    paint();
  }

  var isReader = !!document.querySelector('.reader-content');
  var isSettings = !!document.getElementById('btn-export');
  if (isReader) document.body.classList.add('course-room');
  if (isSettings) document.body.classList.add('course-settings');

  var fab = document.createElement('button');
  fab.id = 'course-theme-fab';
  fab.title = 'Toggle light / dark';
  fab.onclick = toggle;
  document.body.appendChild(fab);

  var sb = document.getElementById('theme-btn');
  if (sb) {
    sb.removeAttribute('onclick');
    sb.onclick = function () { toggle(); };
  }

  paint();
  window.__courseTheme = { get: get, toggle: toggle };
})();
