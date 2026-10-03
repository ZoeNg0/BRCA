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

  /* ---- Table-of-contents scrollspy --------------------------------------
     Position-based rather than IntersectionObserver-based, because the
     observer version got two things wrong:

       · a target that WRAPPED the other targets intersected for the whole
         page, so the first entry stayed highlighted no matter how far the
         reader scrolled;
       · the last section is often too short to ever reach an observer band
         near the top of the viewport, so the final entry could never become
         current — the page simply ran out of scroll first.

     Taking the last heading that has passed the reading line fixes the first.
     Pinning the final entry once the page bottom is reached fixes the second.
     ---------------------------------------------------------------------- */
  function initScrollspy() {
    var links = Array.prototype.slice.call(document.querySelectorAll('.toc a[href^="#"]'));
    if (!links.length) return;

    var entries = [];
    links.forEach(function (link) {
      var el = document.getElementById(link.getAttribute('href').slice(1));
      if (el) entries.push({ link: link, el: el });
    });
    if (!entries.length) return;

    var current = null;

    function readingLine() {
      var h = parseFloat(getComputedStyle(document.documentElement)
                .getPropertyValue('--header-h'));
      return (isNaN(h) ? 64 : h) + 24;
    }

    function update() {
      var line = readingLine();
      var pick = entries[0];
      entries.forEach(function (e) {
        if (e.el.getBoundingClientRect().top <= line) pick = e;
      });

      /* No scroll left to bring the last section up to the line, so name it. */
      var doc = document.documentElement;
      if (window.innerHeight + window.scrollY >= doc.scrollHeight - 2) {
        pick = entries[entries.length - 1];
      }

      if (pick === current) return;
      current = pick;
      entries.forEach(function (e) {
        if (e === pick) e.link.setAttribute('aria-current', 'true');
        else e.link.removeAttribute('aria-current');
      });
    }

    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () { ticking = false; update(); });
    }

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    update();
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

  /* ---- Counting the stat tiles up ----------------------------------------
     The big numbers roll from zero to their value the first time they are
     scrolled into view, and once only. Three things keep it honest:

       · the real value is in the DOM from the start, in a visually-hidden
         span, so a screen reader never reads a half-counted number and the
         page is correct if the animation never runs;
       · a value is parsed rather than assumed, so "+0.56 to +1.34" counts
         both of its numbers and keeps the words between them, and "1,570"
         keeps its thousands separator on every frame;
       · requestAnimationFrame is paused by the browser in a background tab,
         so a tile opened in a tab nobody is looking at waits its turn.
     --------------------------------------------------------------------- */

  var NUMBER = /-?\d[\d,]*(?:\.\d+)?/g;

  /* [{lit: "..."} | {value, decimals, grouped}] covering the whole string. */
  function parseValue(text) {
    var parts = [], last = 0, m;
    NUMBER.lastIndex = 0;
    while ((m = NUMBER.exec(text)) !== null) {
      if (m.index > last) parts.push({ lit: text.slice(last, m.index) });
      var clean = m[0].replace(/,/g, '');
      var dot = clean.indexOf('.');
      parts.push({
        value: parseFloat(clean),
        decimals: dot === -1 ? 0 : clean.length - dot - 1,
        grouped: m[0].indexOf(',') !== -1
      });
      last = m.index + m[0].length;
    }
    if (last < text.length) parts.push({ lit: text.slice(last) });
    return parts;
  }

  function formatPart(part, value) {
    var out = value.toFixed(part.decimals);
    if (part.grouped) {
      var seg = out.split('.');
      seg[0] = seg[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      out = seg.join('.');
    }
    return out;
  }

  function countUp(el, parts, finalText) {
    var DURATION = 900;
    var started = null;

    function frame(now) {
      if (started === null) started = now;
      var t = Math.min(1, (now - started) / DURATION);
      var eased = 1 - Math.pow(1 - t, 3);   /* fast first, settles at the end */
      var out = '';
      for (var i = 0; i < parts.length; i++) {
        out += parts[i].lit !== undefined
          ? parts[i].lit
          : formatPart(parts[i], parts[i].value * eased);
      }
      el.textContent = t < 1 ? out : finalText;
      if (t < 1) window.requestAnimationFrame(frame);
    }

    window.requestAnimationFrame(frame);
  }

  function initTally() {
    var tiles = document.querySelectorAll('.tile__value');
    if (!tiles.length) return;

    /* No observer, no rAF, or motion turned down: the numbers simply stand
       there already correct. */
    if (!('IntersectionObserver' in window) ||
        !window.requestAnimationFrame ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.unobserve(entry.target);
        var el = entry.target.querySelector('[data-tally]');
        if (el) countUp(el, parseValue(el.textContent), el.textContent);
      });
    }, { threshold: 0.4 });

    tiles.forEach(function (tile) {
      var text = tile.textContent.trim();
      var parts = parseValue(text);
      var hasNumber = parts.some(function (p) { return p.lit === undefined; });
      if (!hasNumber) return;

      var spoken = document.createElement('span');
      spoken.className = 'visually-hidden';
      spoken.textContent = text;

      var shown = document.createElement('span');
      shown.setAttribute('data-tally', '');
      shown.setAttribute('aria-hidden', 'true');
      shown.textContent = text;

      tile.textContent = '';
      tile.appendChild(spoken);
      tile.appendChild(shown);
      observer.observe(tile);
    });
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
    initTally();
    initYear();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
