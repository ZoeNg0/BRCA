/* ==========================================================================
   codeviewer.js — read-only source viewer with R syntax highlighting
   --------------------------------------------------------------------------
   Progressive enhancement, deliberately. The page ships the real source
   inside <pre> so it is readable, selectable and searchable with JavaScript
   switched off; this file re-renders that same text as numbered, coloured
   lines. It never makes anything editable and never fetches anything.

   No highlighting library is used, for the same reason the charts use none:
   one dependency-free file is easier to audit than a bundle, and R needs a
   small grammar.

   There is no copy button, no wrap toggle and no jump control: this is a
   viewer, and the browser's own selection, find and scrolling do that work.

   Markup:  <div class="codepane" data-codepane data-lang="r">
              <div class="codepane__body"><div class="codepane__code">
                <pre>...escaped source...</pre>
              </div></div>
            </div>
   ========================================================================== */

(function () {
  'use strict';

  /* Control flow and declarations. Constants are listed separately because
     they are values, not syntax, and get their own colour. */
  var KEYWORDS = ('if else repeat while function for in next break return ' +
                  'switch invisible on.exit').split(' ');
  var CONSTANTS = ('TRUE FALSE T F NULL NA NA_integer_ NA_real_ NA_character_ ' +
                   'Inf NaN').split(' ');

  function has(list, word) { return list.indexOf(word) !== -1; }

  /* Longest first, so <<- is never read as < followed by <-. */
  var OPERATORS = ['%in%', '%/%', '%o%', '%*%', '%%', '<<-', '->>', '<-', '->',
                   '<=', '>=', '==', '!=', '&&', '||', ':::', '::', '...',
                   '$', '@', '~', '?', ':', '=', '+', '-', '*', '/', '^',
                   '!', '&', '|', '<', '>'];

  function isIdentStart(c) { return /[A-Za-z._]/.test(c); }
  function isIdentChar(c)  { return /[A-Za-z0-9._]/.test(c); }

  /* Returns a flat [{t: type, v: text}] list covering every character, so the
     rendered output is always exactly the input — nothing can be dropped. */
  function tokenizeR(src) {
    var out = [], i = 0, n = src.length, depth = 0;

    function peekAfterSpaces(from) {
      var j = from;
      while (j < n && (src[j] === ' ' || src[j] === '\t')) j++;
      return j;
    }

    while (i < n) {
      var c = src[i];

      if (c === '\n' || c === ' ' || c === '\t' || c === '\r') {
        var w = i;
        while (i < n && /[\s]/.test(src[i])) i++;
        out.push({ t: 'ws', v: src.slice(w, i) });
        continue;
      }

      if (c === '#') {
        var e = src.indexOf('\n', i);
        if (e === -1) e = n;
        out.push({ t: 'comment', v: src.slice(i, e) });
        i = e;
        continue;
      }

      if (c === '"' || c === "'" || c === '`') {
        var q = c, s = i;
        i++;
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === q) { i++; break; }
          i++;
        }
        out.push({ t: q === '`' ? 'ident' : 'string', v: src.slice(s, i) });
        continue;
      }

      if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
        var ns = i;
        while (i < n && /[0-9.]/.test(src[i])) i++;
        if (src[i] === 'e' || src[i] === 'E') {
          i++;
          if (src[i] === '+' || src[i] === '-') i++;
          while (i < n && /[0-9]/.test(src[i])) i++;
        }
        if (src[i] === 'L' || src[i] === 'i') i++;
        out.push({ t: 'number', v: src.slice(ns, i) });
        continue;
      }

      if (isIdentStart(c)) {
        var is = i;
        while (i < n && isIdentChar(src[i])) i++;
        var word = src.slice(is, i);
        var j = peekAfterSpaces(i);
        var next = src[j] || '', after = src[j + 1] || '';

        var type = 'ident';
        if (has(KEYWORDS, word)) type = 'keyword';
        else if (has(CONSTANTS, word)) type = 'const';
        else if (next === ':' && after === ':') type = 'ns';
        else if (next === '(') type = 'func';
        /* A bare name followed by a single = inside a call is an argument
           name, which is worth its own colour: half of this script's lines
           are calls with named arguments. */
        else if (depth > 0 && next === '=' && after !== '=') type = 'param';

        out.push({ t: type, v: word });
        continue;
      }

      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth = Math.max(0, depth - 1);
      if ('()[]{},;'.indexOf(c) !== -1) {
        out.push({ t: 'punct', v: c });
        i++;
        continue;
      }

      var matched = null;
      for (var k = 0; k < OPERATORS.length; k++) {
        if (src.startsWith(OPERATORS[k], i)) { matched = OPERATORS[k]; break; }
      }
      if (matched) {
        out.push({ t: 'op', v: matched });
        i += matched.length;
        continue;
      }

      out.push({ t: 'plain', v: c });
      i++;
    }
    return out;
  }

  function span(cls, text) {
    var el = document.createElement('span');
    if (cls) el.className = 'tok-' + cls;
    el.textContent = text;
    return el;
  }

  /* Tokens can straddle a newline (whitespace runs do), so each token is split
     on \n and the pieces are dealt out to the lines they belong to. */
  function render(source) {
    var frag = document.createDocumentFragment();
    var lineNo = 0, current = null, text = null;

    function newLine() {
      lineNo++;
      current = document.createElement('div');
      current.className = 'code-line';
      /* Addressable, so prose can point at a line and a URL can carry one. */
      current.id = 'L' + lineNo;
      current.setAttribute('data-line', lineNo);
      var gutter = document.createElement('span');
      gutter.className = 'code-ln';
      gutter.setAttribute('aria-hidden', 'true');
      gutter.textContent = lineNo;
      text = document.createElement('span');
      text.className = 'code-text';
      current.appendChild(gutter);
      current.appendChild(text);
      frag.appendChild(current);
    }

    newLine();
    tokenizeR(source).forEach(function (tok) {
      var parts = tok.v.split('\n');
      parts.forEach(function (part, k) {
        if (k > 0) newLine();
        if (!part) return;
        if (tok.t === 'ws' || tok.t === 'plain' || tok.t === 'ident') {
          text.appendChild(document.createTextNode(part));
        } else {
          text.appendChild(span(tok.t, part));
        }
      });
    });

    /* A file ending in a newline would otherwise show one empty line. */
    if (current && !text.childNodes.length && lineNo > 1) {
      frag.removeChild(current);
      lineNo--;
    }
    return { frag: frag, lines: lineNo };
  }

  function mount(pane) {
    var host = pane.querySelector('.codepane__code');
    var body = pane.querySelector('.codepane__body');
    var raw = host && host.querySelector('pre');
    if (!host || !raw) return;

    var source = raw.textContent.replace(/^\n/, '').replace(/\s+$/, '');
    var out = render(source);
    host.textContent = '';
    host.appendChild(out.frag);

    /* The pane scrolls, so it must be reachable and operable by keyboard. */
    if (body) {
      body.tabIndex = 0;
      body.setAttribute('role', 'region');
      body.setAttribute('aria-label',
        (pane.getAttribute('data-file') || 'Source code') + ', read only');
    }

    var count = pane.querySelector('[data-code-lines]');
    if (count) count.textContent = out.lines + ' lines';
  }

  /* ======================================================================
     JUMPING TO A LINE

     Prose elsewhere on the page quotes lines of this source. Each quote
     carries data-code-jump with the text to look for, and is upgraded here
     into a button that scrolls the pane to that line and lights it.

     The quotes ship as plain <code> chips, so with JavaScript off the page
     still reads correctly — it simply does not jump.
     ====================================================================== */

  function squash(str) { return str.replace(/\s+/g, ' ').trim(); }

  /* First line containing the needle. Whitespace is squashed on both sides
     so a quote can be typed the way it reads rather than the way it is
     indented in the file. */
  function findLine(pane, needle) {
    var lines = pane.querySelectorAll('.code-line');
    var want = squash(needle);
    if (/^\d+$/.test(want)) return pane.querySelector('#L' + want);
    for (var i = 0; i < lines.length; i++) {
      var text = lines[i].querySelector('.code-text');
      if (text && squash(text.textContent).indexOf(want) !== -1) return lines[i];
    }
    return null;
  }

  function jumpTo(pane, line) {
    var body = pane.querySelector('.codepane__body');
    var lit = pane.querySelectorAll('.code-line.is-target');
    for (var i = 0; i < lit.length; i++) lit[i].classList.remove('is-target');
    line.classList.add('is-target');

    var smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* The pane scrolls first and instantly, so the line is already in place
       by the time the page finishes travelling. Measured from rects rather
       than offsetTop, which is relative to whichever ancestor happens to be
       positioned. A single smooth scrollIntoView would animate both
       scrollers at once, and the inner one loses that race. */
    if (body) {
      var bRect = body.getBoundingClientRect();
      var lRect = line.getBoundingClientRect();
      var top = body.scrollTop + (lRect.top - bRect.top)
                - (body.clientHeight - lRect.height) / 2;
      body.scrollTop = Math.max(0, top);
    }

    /* Then the page, but only if the pane is not already fully in view —
       a jump from a card just below the pane should not move the page at all. */
    var pRect = pane.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (pRect.top < 0 || pRect.bottom > vh) {
      pane.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'center' });
    }

    /* Land the keyboard in the pane — the reader's next arrow key should
       scroll the source — without a focus scroll undoing the centring. */
    if (body) {
      try { body.focus({ preventScroll: true }); } catch (e) { /* older Safari */ }
    }
    try { history.replaceState(null, '', '#' + line.id); } catch (e) { /* file:// */ }
  }

  function upgradeJumps(pane) {
    document.querySelectorAll('[data-code-jump]').forEach(function (chip) {
      var needle = chip.getAttribute('data-code-jump');
      var line = findLine(pane, needle);

      /* A quote that no longer matches the source stays a plain chip rather
         than becoming a button that does nothing. */
      if (!line) return;

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'code-jump';
      btn.textContent = chip.textContent;
      btn.title = 'Jump to this line in the source above';
      btn.setAttribute('aria-label',
        'Jump to line ' + line.getAttribute('data-line') + ' in the source: ' +
        squash(chip.textContent));
      btn.addEventListener('click', function () { jumpTo(pane, line); });
      chip.parentNode.replaceChild(btn, chip);
    });

    /* A URL carrying #L42 opens on that line. */
    var hash = window.location.hash;
    if (/^#L\d+$/.test(hash)) {
      var target = pane.querySelector(hash);
      if (target) jumpTo(pane, target);
    }
  }

  function init() {
    var panes = document.querySelectorAll('[data-codepane]');
    panes.forEach(mount);
    if (panes.length) upgradeJumps(panes[0]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
