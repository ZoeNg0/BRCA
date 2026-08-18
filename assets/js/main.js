/* ==========================================================================
   main.js — site chrome: theme, nav, active link, scrollspy, reveal
   No dependencies. Loaded with `defer` on every page.
   ========================================================================== */

(function () {
  'use strict';

  /* ---- Theme -------------------------------------------------------------
     Three states: "light", "dark", or unset (follow the OS). The stored
     choice is stamped on <html data-theme> by the inline script in <head>
     so there is no flash; this only handles the toggle click.
     --------------------------------------------------------------------- */
  var THEME_KEY = 'brca-theme';

  function currentTheme() {
    var stamped = document.documentElement.getAttribute('data-theme');
    if (stamped) return stamped;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* private mode */ }
    document.dispatchEvent(new CustomEvent('themechange', { detail: { theme: theme } }));
  }

  function initTheme() {
    var btn = document.querySelector('[data-theme-toggle]');
    if (!btn) return;
    btn.addEventListener('click', function () {
      setTheme(currentTheme() === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---- Mobile nav ------------------------------------------------------- */
  function initNav() {
    var toggle = document.querySelector('[data-nav-toggle]');
    var nav = document.querySelector('[data-nav]');
    if (!toggle || !nav) return;

    function close() {
      nav.setAttribute('data-open', 'false');
      toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', function () {
      var open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', open ? 'false' : 'true');
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    });

    nav.addEventListener('click', function (e) {
      if (e.target.closest('a')) close();
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') close();
    });
  }

  /* ---- Active nav link ---------------------------------------------------
     Marks the nav item matching the current file so each page does not have
     to hard-code aria-current in its own markup.
     --------------------------------------------------------------------- */
  function initActiveLink() {
    var here = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('.nav__link').forEach(function (link) {
      var target = link.getAttribute('href');
      if (target === here) link.setAttribute('aria-current', 'page');
    });
  }

  /* ---- Table-of-contents scrollspy -------------------------------------- */
  function initScrollspy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
    if (!links.length || !('IntersectionObserver' in window)) return;

    var byId = {};
    var targets = [];
    links.forEach(function (link) {
      var el = document.getElementById(link.getAttribute('href').slice(1));
      if (el) { byId[el.id] = link; targets.push(el); }
    });

    var visible = new Set();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) visible.add(entry.target.id);
        else visible.delete(entry.target.id);
      });
      var first = targets.find(function (t) { return visible.has(t.id); });
      links.forEach(function (l) { l.removeAttribute('aria-current'); });
      if (first && byId[first.id]) byId[first.id].setAttribute('aria-current', 'true');
    }, { rootMargin: '-80px 0px -65% 0px', threshold: 0 });

    targets.forEach(function (t) { observer.observe(t); });
  }

  /* ---- Reveal on scroll -------------------------------------------------- */
  function initReveal() {
    var items = document.querySelectorAll('.reveal');
    if (!items.length) return;

    if (!('IntersectionObserver' in window) ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      items.forEach(function (el) { el.setAttribute('data-visible', 'true'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.setAttribute('data-visible', 'true');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---- Current year in the footer ---------------------------------------- */
  function initYear() {
    var y = String(new Date().getFullYear());
    document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = y; });
  }

  function init() {
    initTheme();
    initNav();
    initActiveLink();
    initScrollspy();
    initReveal();
    initYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
