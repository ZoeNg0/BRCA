/* ==========================================================================
   charts.js — dependency-free SVG chart renderers
   --------------------------------------------------------------------------
   Every figure in the site is a <figure class="figure" data-chart="NAME">.
   This file finds them, renders the matching chart into .figure__plot, and
   wires up the legend, the hover tooltip and the "Table" view toggle.

   Charts re-render on container resize and on theme change, so colours are
   always read live from the CSS custom properties in tokens.css — never
   hard-coded here.

   A figure may also carry data-source="ppp4.cox" to name which block of
   window.BRCA_DATA it should read; that block arrives as ctx.source. This is
   what lets one renderer (box, forest, scatter, corrbar) serve several
   figures without duplicating code.

   Adding a chart:  RENDERERS['my-chart'] = function (ctx) { ... }
   A renderer receives { width, height, data, source, svg, tip } and returns
   { legend: [...], table: { columns: [...], rows: [[...]] } }.
   ========================================================================== */

(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  /* ---- Small helpers ----------------------------------------------------- */

  function svgEl(name, attrs, parent) {
    var node = document.createElementNS(NS, name);
    if (attrs) {
      for (var k in attrs) {
        if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  function token(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function series(slot) { return token('--series-' + slot); }

  /* Deterministic jitter in [-0.5, 0.5] from an index — same figure on every
     reload, no Math.random. It must actually scatter: an earlier version used
     (k * 40503) % 100, and since 40503 mod 100 is 3 that stepped by a constant
     0.03 and drew sorted outliers as a diagonal streak. This mixes the bits
     instead, so consecutive indices land far apart. */
  function jitter(k) {
    var h = Math.imul(k + 1, 2654435761);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;          /* >>> 0: XOR yields a SIGNED int32,
                                            and a negative here would push the
                                            offset outside [-0.5, 0.5]. */
    return (h % 1000) / 1000 - 0.5;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function fmt(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString(undefined, {
      minimumFractionDigits: digits || 0,
      maximumFractionDigits: digits === undefined ? 0 : digits
    });
  }

  function sci(n) {
    if (n === 0) return '0';
    if (n >= 0.001) return n.toPrecision(2);
    var exp = Math.floor(Math.log10(n));
    var mant = (n / Math.pow(10, exp)).toFixed(1);
    return mant + '×10' + supers(exp);
  }

  /* Underflowed p-values are floored at the smallest double by the export.
     Printing "2.2×10⁻³⁰⁸" would read as a point estimate, which it is not. */
  function sciP(p) {
    return p <= 2.3e-308 ? '< 10⁻³⁰⁸' : sci(p);
  }

  function pText(p) {
    return p <= 2.3e-308 ? 'p < 10⁻³⁰⁸' : 'p = ' + sci(p);
  }

  function supers(n) {
    var map = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³',
                4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
    return String(n).split('').map(function (c) { return map[c] || c; }).join('');
  }

  function niceTicks(min, max, count) {
    var span = max - min;
    if (span <= 0) span = 1;
    var raw = span / (count || 5);
    var step = Math.pow(10, Math.floor(Math.log10(raw)));
    var err = raw / step;
    if (err >= 7.5) step *= 10;
    else if (err >= 3) step *= 5;
    else if (err >= 1.5) step *= 2;
    var out = [];
    for (var v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) {
      out.push(Math.abs(v) < step * 1e-6 ? 0 : v);
    }
    return out;
  }

  /* Bar with a 4px rounded data-end and a square baseline end. */
  function barPath(x, y, w, h, r, dir) {
    r = Math.min(r, w / 2, h / 2);
    if (dir === 'right') {
      return 'M' + x + ',' + y +
             'H' + (x + w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
             'V' + (y + h - r) + 'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r +
             'H' + x + 'Z';
    }
    /* dir === 'up' */
    return 'M' + x + ',' + (y + h) +
           'V' + (y + r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) +
           'H' + (x + w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
           'V' + (y + h) + 'Z';
  }

  /* ---- Tooltip ------------------------------------------------------------ */

  function makeTip(plot) {
    var node = document.createElement('div');
    node.className = 'chart-tip';
    node.setAttribute('role', 'status');
    plot.appendChild(node);
    return {
      show: function (html, x, y) {
        node.innerHTML = html;
        var pad = 10;
        var w = node.offsetWidth;
        var left = Math.max(w / 2 + 2, Math.min(plot.clientWidth - w / 2 - 2, x));
        node.style.left = left + 'px';
        node.style.top = Math.max(node.offsetHeight + 4, y - pad) + 'px';
        node.setAttribute('data-show', 'true');
      },
      hide: function () { node.setAttribute('data-show', 'false'); }
    };
  }

  function tipRow(color, label, value) {
    return '<div class="chart-tip__row">' +
      (color ? '<span class="chart-tip__key" style="background:' + color + '"></span>' : '') +
      '<span>' + escapeHtml(label) + '</span>' +
      (value !== undefined ? '<span>' + escapeHtml(value) + '</span>' : '') +
      '</div>';
  }

  /* ======================================================================
     RENDERERS
     ====================================================================== */

  var RENDERERS = {};

  /* ---- Volcano plot ------------------------------------------------------
     Diverging encoding: down-regulated (green) · not significant (stone) ·
     up-regulated (rose). Stone is the diverging midpoint, not a series colour.
     ---------------------------------------------------------------------- */
  RENDERERS.volcano = function (ctx) {
    var svg = ctx.svg, data = ctx.source || ctx.data.de, W = ctx.width, H = ctx.height;
    /* A thinned export needs headroom for the line saying how much was cut. */
    var M = { t: data.nSignificant ? 30 : 14, r: 18, b: 46, l: 54 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    var LFC_CUT = 1, P_CUT = 0.05;
    var pts = data.rows.map(function (d) {
      /* No ceiling on significance. An earlier version clamped padj at 1e-50,
         which was harmless for synthetic data but collapsed every genuinely
         significant gene in a real DE result onto one flat line at y = 50.
         Real padj values reach the smallest representable double, so the only
         guard needed is against zero, which -log10 cannot take. */
      var y = -Math.log10(d.padj > 0 ? d.padj : 2.2250738585072e-308);
      var sig = d.padj < P_CUT && Math.abs(d.lfc) > LFC_CUT;
      return { gene: d.gene, lfc: d.lfc, padj: d.padj, y: y,
               dir: !sig ? 'ns' : (d.lfc > 0 ? 'up' : 'down') };
    });

    var xMax = Math.max(4, Math.ceil(Math.max.apply(null, pts.map(function (p) { return Math.abs(p.lfc); }))));
    var yTop = Math.max.apply(null, pts.map(function (p) { return p.y; }));
    var yStep = yTop > 200 ? 50 : yTop > 60 ? 10 : 5;
    var yMax = Math.ceil(yTop / yStep) * yStep;

    var x = function (v) { return M.l + (v + xMax) / (2 * xMax) * iw; };
    var y = function (v) { return M.t + ih - (v / yMax) * ih; };

    var colors = {
      up:   token('--diverge-high'),
      down: token('--diverge-low'),
      ns:   token('--diverge-mid')
    };

    var g = svgEl('g', {}, svg);

    /* Gridlines + y axis */
    niceTicks(0, yMax, 5).forEach(function (t) {
      svgEl('line', { class: 'grid-line', x1: M.l, x2: M.l + iw, y1: y(t), y2: y(t) }, g);
      svgEl('text', { class: 'axis-label', x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, g)
        .textContent = t;
    });
    /* x axis */
    niceTicks(-xMax, xMax, 6).forEach(function (t) {
      svgEl('text', { class: 'axis-label', x: x(t), y: M.t + ih + 18, 'text-anchor': 'middle' }, g)
        .textContent = t;
    });
    svgEl('line', { class: 'axis-line', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, g);

    /* Threshold annotations (not gridlines — dashed marks them as cutoffs). */
    [-LFC_CUT, LFC_CUT].forEach(function (t) {
      svgEl('line', {
        x1: x(t), x2: x(t), y1: M.t, y2: M.t + ih,
        stroke: token('--axis'), 'stroke-width': 1, 'stroke-dasharray': '3 3'
      }, g);
    });
    var pLine = -Math.log10(P_CUT);
    svgEl('line', {
      x1: M.l, x2: M.l + iw, y1: y(pLine), y2: y(pLine),
      stroke: token('--axis'), 'stroke-width': 1, 'stroke-dasharray': '3 3'
    }, g);
    svgEl('text', { class: 'axis-label', x: M.l + iw, y: y(pLine) - 6, 'text-anchor': 'end' }, g)
      .textContent = 'padj = 0.05';

    /* Honesty line: the significant wings are truncated by the export. */
    if (data.nSignificant) {
      var shown = pts.filter(function (p) { return p.dir !== 'ns'; }).length;
      svgEl('text', { class: 'data-label', x: M.l, y: 14 }, g).textContent =
        fmt(shown) + ' of ' + fmt(data.nSignificant) + ' significant genes shown, from ' +
        fmt(data.nTested) + ' tested';
    }

    /* Points — non-significant first so hits sit on top. */
    var order = pts.slice().sort(function (a, b) {
      return (a.dir === 'ns' ? 0 : 1) - (b.dir === 'ns' ? 0 : 1);
    });
    var dots = svgEl('g', {}, g);
    order.forEach(function (p) {
      p.cx = x(Math.max(-xMax, Math.min(xMax, p.lfc)));
      p.cy = y(Math.min(yMax, p.y));
      svgEl('circle', {
        cx: p.cx, cy: p.cy, r: p.dir === 'ns' ? 2.2 : 3.2,
        fill: colors[p.dir], opacity: p.dir === 'ns' ? 0.42 : 0.82
      }, dots);
    });

    /* Direct labels on the six strongest hits (selective, never all), plus any
       gene the figure explicitly asks for. On a volcano about one target, the
       target has to be named even when it is not among the top six by effect
       size — otherwise the reader cannot find the point the page is about. */
    var labelled = pts.filter(function (p) { return p.dir !== 'ns'; })
      .sort(function (a, b) { return (b.y * Math.abs(b.lfc)) - (a.y * Math.abs(a.lfc)); })
      .slice(0, 6);
    (data.highlight || []).forEach(function (name) {
      var hit = pts.filter(function (p) { return p.gene === name; })[0];
      if (hit && labelled.indexOf(hit) === -1) { hit.pinned = true; labelled.push(hit); }
    });
    /* The top hits cluster in the same corner, so labels have to be placed,
       not just positioned: try a few offsets per gene and take the first that
       hits neither a placed label nor the plot edge. A gene that cannot be
       placed loses its label rather than printing on top of another one —
       except a pinned gene, which is always drawn because the page refers
       to it by name. */
    var placed = [];
    function labelBox(x, y, w, anchor) {
      var x0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x;
      return { x1: x0, y1: y - 11, x2: x0 + w, y2: y + 4 };
    }
    function free(b) {
      if (b.x1 < M.l || b.x2 > M.l + iw || b.y1 < M.t || b.y2 > M.t + ih) return false;
      return !placed.some(function (q) {
        return b.x1 < q.x2 && b.x2 > q.x1 && b.y1 < q.y2 && b.y2 > q.y1;
      });
    }

    labelled.forEach(function (p) {
      var right = p.lfc > 0;
      var gap = p.pinned ? 12 : 8;
      /* Preferred side first (outward, away from the centre of the plot). */
      var tries = right
        ? [[-gap, -8, 'end'], [gap, -8, 'start'], [-gap, 16, 'end'],
           [gap, 16, 'start'], [0, -17, 'middle'], [0, 22, 'middle']]
        : [[gap, -8, 'start'], [-gap, -8, 'end'], [gap, 16, 'start'],
           [-gap, 16, 'end'], [0, -17, 'middle'], [0, 22, 'middle']];
      var w = p.gene.length * 6.4 + 4;
      var spot = null;
      for (var i = 0; i < tries.length; i++) {
        var b = labelBox(p.cx + tries[i][0], p.cy + tries[i][1], w, tries[i][2]);
        if (free(b)) { spot = tries[i]; placed.push(b); break; }
      }
      if (!spot) {
        if (!p.pinned) return;
        spot = tries[0];
        placed.push(labelBox(p.cx + spot[0], p.cy + spot[1], w, spot[2]));
      }

      svgEl('circle', {
        cx: p.cx, cy: p.cy, r: p.pinned ? 5 : 4, fill: colors[p.dir],
        class: 'mark-ring'
      }, g);
      /* A pinned gene gets a second ring so it reads as deliberate. */
      if (p.pinned) {
        svgEl('circle', {
          cx: p.cx, cy: p.cy, r: 8, fill: 'none',
          stroke: token('--text-primary'), 'stroke-width': 1.2, opacity: 0.75
        }, g);
      }
      svgEl('text', {
        class: 'data-label', x: p.cx + spot[0], y: p.cy + spot[1],
        'text-anchor': spot[2]
      }, g).textContent = p.gene;
    });

    /* Axis titles */
    svgEl('text', {
      class: 'axis-title', x: M.l + iw / 2, y: H - 8, 'text-anchor': 'middle'
    }, g).textContent = 'log₂ fold change  →';
    svgEl('text', {
      class: 'axis-title', x: 14, y: M.t + ih / 2,
      'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (M.t + ih / 2) + ')'
    }, g).textContent = '−log₁₀ adjusted p';

    /* Hover: nearest point within 14px. */
    var hit = svgEl('rect', {
      x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent'
    }, g);
    var focus = svgEl('circle', { r: 6, fill: 'none', stroke: token('--text-primary'),
      'stroke-width': 1.5, opacity: 0 }, g);

    hit.addEventListener('mousemove', function (e) {
      var pt = ctx.local(e);
      var best = null, bestD = 14 * 14;
      for (var i = 0; i < pts.length; i++) {
        var dx = pts[i].cx - pt.x, dy = pts[i].cy - pt.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = pts[i]; }
      }
      if (!best) { ctx.tip.hide(); focus.setAttribute('opacity', 0); return; }
      focus.setAttribute('cx', best.cx);
      focus.setAttribute('cy', best.cy);
      focus.setAttribute('opacity', 0.8);
      ctx.tip.show(
        '<div class="chart-tip__title">' + escapeHtml(best.gene) + '</div>' +
        tipRow(colors[best.dir], 'log2 FC', best.lfc.toFixed(2)) +
        tipRow(null, 'padj', sciP(best.padj)),
        best.cx, best.cy
      );
    });
    hit.addEventListener('mouseleave', function () {
      ctx.tip.hide(); focus.setAttribute('opacity', 0);
    });

    /* Excludes only the synthetic GENE123 placeholders — real symbols such as
       HLA-DRA or NKX2-1 contain hyphens and must not be filtered out. */
    var top = pts.filter(function (p) { return p.dir !== 'ns' && !/^GENE\d+$/.test(p.gene); })
      .sort(function (a, b) { return a.padj - b.padj; }).slice(0, 18);

    return {
      legend: [
        { label: data.lowLabel || 'Down', color: colors.down, type: 'dot' },
        { label: 'Not significant', color: colors.ns, type: 'dot' },
        { label: data.highLabel || 'Up', color: colors.up, type: 'dot' }
      ],
      table: {
        columns: ['Gene', 'log2 FC', 'Adjusted p', 'Direction'],
        align: ['', 'num', 'num', ''],
        rows: top.map(function (p) {
          return [p.gene, p.lfc.toFixed(2), sciP(p.padj),
                  p.dir === 'up' ? (data.highLabel || 'Up') : (data.lowLabel || 'Down')];
        })
      }
    };
  };

  /* ---- Kaplan–Meier ------------------------------------------------------- */
  RENDERERS.survival = function (ctx) {
    var svg = ctx.svg, data = ctx.source || ctx.data.survival, W = ctx.width, H = ctx.height;
    var M = { t: 14, r: 48, b: 104, l: 54 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    /* Follow-up window comes from the data. A curve administratively censored
       at 5 years must not be drawn on a 10-year axis: the flat tail after the
       last event would read as follow-up that does not exist. */
    var tMax = data.maxTime || 120;
    var x = function (v) { return M.l + (v / tMax) * iw; };
    var y = function (v) { return M.t + ih - v * ih; };

    var g = svgEl('g', {}, svg);

    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      svgEl('line', { class: 'grid-line', x1: M.l, x2: M.l + iw, y1: y(t), y2: y(t) }, g);
      svgEl('text', { class: 'axis-label', x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, g)
        .textContent = (t * 100).toFixed(0) + '%';
    });

    var tickEvery = tMax <= 24 ? 6 : tMax <= 72 ? 12 : 24;
    var xTicks = [];
    for (var tt = 0; tt <= tMax; tt += tickEvery) xTicks.push(tt);
    xTicks.forEach(function (t) {
      svgEl('text', { class: 'axis-label', x: x(t), y: M.t + ih + 18, 'text-anchor': 'middle' }, g)
        .textContent = t;
    });
    svgEl('line', { class: 'axis-line', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, g);
    svgEl('text', { class: 'axis-title', x: M.l + iw / 2, y: M.t + ih + 34, 'text-anchor': 'middle' }, g)
      .textContent = 'Months since diagnosis';
    svgEl('text', {
      class: 'axis-title', x: 14, y: M.t + ih / 2,
      'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (M.t + ih / 2) + ')'
    }, g).textContent = 'Overall survival';

    /* Tick weight is set once from the busiest curve, so both are drawn alike. */
    var maxCens = Math.max.apply(null, data.groups.map(function (grp) {
      return grp.points.filter(function (p) { return p.censored; }).length;
    }));
    var dense = maxCens > 120;
    var tickH = dense ? 2.5 : 4, tickW = dense ? 1 : 1.5, tickO = dense ? 0.45 : 1;

    var groups = data.groups.map(function (grp) {
      return { name: grp.name, n: grp.n, points: grp.points, color: series(grp.slot) };
    });

    groups.forEach(function (grp) {
      /* Step path */
      var d = '';
      grp.points.forEach(function (p, i) {
        if (i === 0) { d = 'M' + x(p.t) + ',' + y(p.s); return; }
        d += 'H' + x(p.t) + 'V' + y(p.s);
      });
      var last = grp.points[grp.points.length - 1];
      d += 'H' + x(tMax);

      /* Confidence band, drawn ONLY from real interval bounds on each point.
         An earlier version synthesised a band from an invented standard error,
         which is fine for a layout prototype and indefensible on real results.
         If the export carries no lo/hi, no band is drawn — an absent band is
         honest, a decorative one is not. */
      if (grp.points.every(function (p) {
            return typeof p.lo === 'number' && typeof p.hi === 'number';
          })) {
        var lo = [], hi = [];
        grp.points.forEach(function (p) {
          lo.push([x(p.t), y(Math.max(0, p.lo))]);
          hi.push([x(p.t), y(Math.min(1, p.hi))]);
        });
        var band = 'M' + hi.map(function (pt) { return pt[0] + ',' + pt[1]; }).join('L') +
                   'L' + lo.reverse().map(function (pt) { return pt[0] + ',' + pt[1]; }).join('L') + 'Z';
        svgEl('path', { d: band, fill: grp.color, opacity: 0.10 }, g);
      }

      svgEl('path', {
        d: d, fill: 'none', stroke: grp.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }, g);

      /* Censoring ticks */
      grp.points.forEach(function (p) {
        if (!p.censored) return;
        /* Censoring ticks scale with how many there are. With 99 deaths and
           ~600 censorings the default weight turns both curves into a hatched
           band and hides the steps, which are the thing being read. Heavy
           censoring gets short faint ticks; light censoring keeps the usual
           prominent ones. */
        svgEl('line', {
          x1: x(p.t), x2: x(p.t),
          y1: y(p.s) - tickH, y2: y(p.s) + tickH,
          stroke: grp.color, 'stroke-width': tickW, opacity: tickO
        }, g);
      });

      /* End label — the two curves separate at the right edge, so direct
         labels are safe here (no leader lines needed). */
      svgEl('text', {
        class: 'data-label', x: x(tMax) + 7, y: y(last.s) + 4, 'text-anchor': 'start'
      }, g).textContent = (last.s * 100).toFixed(0) + '%';
    });

    /* Numbers at risk */
    var riskTop = M.t + ih + 60;
    svgEl('text', { class: 'axis-title', x: M.l, y: riskTop - 4 }, g).textContent = 'Number at risk';
    groups.forEach(function (grp, gi) {
      var row = riskTop + 14 + gi * 15;
      svgEl('circle', { cx: M.l - 40, cy: row - 4, r: 4, fill: grp.color }, g);
      xTicks.forEach(function (t) {
        var pt = grp.points.reduce(function (acc, p) {
          return p.t <= t && (!acc || p.t > acc.t) ? p : acc;
        }, null) || grp.points[0];
        svgEl('text', { class: 'axis-label', x: x(t), y: row, 'text-anchor': 'middle' }, g)
          .textContent = pt.atRisk;
      });
    });

    /* Statistics annotation — text tokens, never the series colour. */
    /* Sits low-left, where no curve runs, so it never overlaps the data. */
    var stat = svgEl('text', { class: 'data-label', x: M.l + 10, y: M.t + ih - 12 }, g);
    stat.textContent = 'log-rank ' + pText(data.pValue) + '   ·   HR ' + data.hazardRatio +
      ' (95% CI ' + data.hrCI[0].toFixed(2) + '–' + data.hrCI[1].toFixed(2) + ')';

    /* Crosshair + tooltip */
    var cross = svgEl('line', {
      y1: M.t, y2: M.t + ih, stroke: token('--text-muted'), 'stroke-width': 1, opacity: 0
    }, g);
    var hit = svgEl('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent' }, g);

    hit.addEventListener('mousemove', function (e) {
      var pt = ctx.local(e);
      var t = Math.max(0, Math.min(tMax, (pt.x - M.l) / iw * tMax));
      cross.setAttribute('x1', x(t));
      cross.setAttribute('x2', x(t));
      cross.setAttribute('opacity', 0.5);
      var html = '<div class="chart-tip__title">' + Math.round(t) + ' months</div>';
      groups.forEach(function (grp) {
        var p = grp.points.reduce(function (acc, q) {
          return q.t <= t && (!acc || q.t > acc.t) ? q : acc;
        }, null) || grp.points[0];
        html += tipRow(grp.color, grp.name, (p.s * 100).toFixed(1) + '%');
      });
      ctx.tip.show(html, x(t), M.t + 30);
    });
    hit.addEventListener('mouseleave', function () {
      ctx.tip.hide(); cross.setAttribute('opacity', 0);
    });

    var marks = [12, 36, 60, 120];
    return {
      legend: groups.map(function (grp) {
        return { label: grp.name + ' (n = ' + grp.n + ')', color: grp.color, type: 'line' };
      }),
      table: {
        columns: ['Group'].concat(marks.map(function (m) { return m + ' mo'; })),
        align: [''].concat(marks.map(function () { return 'num'; })),
        rows: groups.map(function (grp) {
          return [grp.name].concat(marks.map(function (m) {
            var p = grp.points.reduce(function (acc, q) {
              return q.t <= m && (!acc || q.t > acc.t) ? q : acc;
            }, null) || grp.points[0];
            return (p.s * 100).toFixed(1) + '%';
          }));
        })
      }
    };
  };

  /* ---- Horizontal bars: PAM50 subtype composition ------------------------- */
  RENDERERS.subtypes = function (ctx) {
    var svg = ctx.svg, data = ctx.source || ctx.data.subtypes, W = ctx.width;
    var items = data.items;
    var M = { t: 8, r: 56, b: 46, l: 108 };
    var rowH = 38, barH = 22;
    var ih = items.length * rowH;
    var H = M.t + ih + M.b;
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var iw = W - M.l - M.r;

    var max = Math.max.apply(null, items.map(function (d) { return d.value; }));
    var ticks = niceTicks(0, max, 4);
    var scaleMax = Math.max(max, ticks[ticks.length - 1]);
    var x = function (v) { return (v / scaleMax) * iw; };

    var g = svgEl('g', {}, svg);

    ticks.forEach(function (t) {
      svgEl('line', {
        class: 'grid-line', x1: M.l + x(t), x2: M.l + x(t), y1: M.t, y2: M.t + ih
      }, g);
      svgEl('text', {
        class: 'axis-label', x: M.l + x(t), y: M.t + ih + 18, 'text-anchor': 'middle'
      }, g).textContent = fmt(t);
    });
    svgEl('line', { class: 'axis-line', x1: M.l, x2: M.l, y1: M.t, y2: M.t + ih }, g);

    items.forEach(function (d, i) {
      var color = series(d.slot);
      var yTop = M.t + i * rowH + (rowH - barH) / 2;
      var w = Math.max(x(d.value), 3);

      svgEl('text', {
        class: 'axis-label', x: M.l - 10, y: yTop + barH / 2 + 4, 'text-anchor': 'end'
      }, g).textContent = d.label;

      var bar = svgEl('path', {
        d: barPath(M.l, yTop, w, barH, 4, 'right'), fill: color
      }, g);

      /* Value at the tip — this is also the relief that low-contrast hues
         (teal, gold, pink) require on the light surface. */
      svgEl('text', {
        class: 'data-label', x: M.l + w + 8, y: yTop + barH / 2 + 4, 'text-anchor': 'start'
      }, g).textContent = fmt(d.value);

      var hit = svgEl('rect', {
        x: M.l, y: M.t + i * rowH, width: iw, height: rowH, fill: 'transparent'
      }, g);
      hit.addEventListener('mouseenter', function () { bar.setAttribute('opacity', 0.82); });
      hit.addEventListener('mousemove', function (e) {
        var pt = ctx.local(e);
        ctx.tip.show(
          '<div class="chart-tip__title">' + escapeHtml(d.label) + '</div>' +
          tipRow(color, 'Samples', fmt(d.value)) +
          tipRow(null, 'Share', (d.value / data.total * 100).toFixed(1) + '%'),
          pt.x, yTop
        );
      });
      hit.addEventListener('mouseleave', function () {
        bar.setAttribute('opacity', 1); ctx.tip.hide();
      });
    });

    svgEl('text', {
      class: 'axis-title', x: M.l + iw / 2, y: H - 6, 'text-anchor': 'middle'
    }, g).textContent = 'Number of tumour samples';

    return {
      legend: items.map(function (d) {
        return { label: d.label, color: series(d.slot), type: 'swatch' };
      }),
      table: {
        columns: ['Subtype', 'Samples', 'Share'],
        align: ['', 'num', 'num'],
        rows: items.map(function (d) {
          return [d.label, fmt(d.value), (d.value / data.total * 100).toFixed(1) + '%'];
        })
      }
    };
  };

  /* ---- Horizontal log bars: gene-set enrichment among the hub genes -------
     Fold enrichment against a reference at 1, one row per tested set, grouped
     by theme. Three rules this renderer exists to keep, because the finding it
     draws is partly a negative one:

       · every tested set is drawn, passing or not. Filtering to FDR < 0.05
         would delete the actual result, which is that motility is largely
         absent from the hub genes. Non-significant rows are faded instead.
       · a set with no hub genes in it carries no `fold` and gets NO bar. On a
         log axis a clamped small value would draw a long leftward bar, which
         reads as strong depletion when the truth is no overlap at all.
       · fold below 1 is drawn leftward, as the depletion it is. GO wound
         healing sits at 0.45×, and that is a result rather than a rounding
         artefact.
     ---------------------------------------------------------------------- */
  RENDERERS.enrichment = function (ctx) {
    var svg = ctx.svg, data = ctx.source || ctx.data.hubEnrichment, W = ctx.width;
    var rows = data.rows;
    var refV = data.axis.reference;

    function hasFold(r) { return r.fold !== undefined && r.fold !== null; }

    /* Set names are long. Give them room, but never more than 42% of a narrow
       screen — anything that still does not fit is cut, and the full name is
       in the tooltip and the table. */
    var labelW = Math.max(116, Math.min(250, Math.round(W * 0.42)));
    /* On a phone the full sentences below do not fit the viewBox, and SVG text
       neither wraps nor clips — it just runs off the side. Shorten instead. */
    var narrow = W < 560;
    var M = { t: 36, r: 62, b: 44, l: labelW };
    var rowH = 22, barH = 12, headH = 26;

    var groups = data.themes.map(function (t) {
      return {
        label: t.label, slot: t.slot,
        rows: rows.filter(function (r) { return r.theme === t.label; })
      };
    }).filter(function (gp) { return gp.rows.length; });

    var ih = groups.reduce(function (acc, gp) {
      return acc + headH + gp.rows.length * rowH;
    }, 0);
    var H = M.t + ih + M.b;
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var iw = W - M.l - M.r;

    var folds = rows.filter(hasFold).map(function (r) { return r.fold; });
    var lo = Math.min(refV / 2, Math.min.apply(null, folds) * 0.8);
    var hi = Math.max.apply(null, folds) * 1.35;
    function x(v) {
      return M.l + (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) * iw;
    }

    var g = svgEl('g', {}, svg);

    /* Honesty line: say up front that the failing sets are still on the plot. */
    svgEl('text', { class: 'data-label', x: 0, y: 13 }, g).textContent = narrow
      ? data.summary.significant + ' of ' + data.summary.sets + ' sets pass FDR < ' +
        data.thresholds.padj + '; all are drawn'
      : data.summary.significant + ' of ' + data.summary.sets + ' sets reach FDR < ' +
        data.thresholds.padj + ' — all ' + data.summary.sets + ' are drawn, and ' +
        data.summary.zeroOverlapSets + ' contain no hub gene at all';

    /* Log ticks, only the decade-and-half steps that fall inside the domain. */
    [0.25, 0.5, 1, 2, 5, 10, 20, 50].forEach(function (t) {
      if (t < lo || t > hi) return;
      svgEl('line', { class: 'grid-line', x1: x(t), x2: x(t), y1: M.t, y2: M.t + ih }, g);
      svgEl('text', {
        class: 'axis-label', x: x(t), y: M.t + ih + 17, 'text-anchor': 'middle'
      }, g).textContent = t < 1 ? String(t) : fmt(t) + '×';
    });

    /* The reference is a cutoff, not a gridline, so it is dashed like the
       thresholds on the volcano. */
    svgEl('line', {
      x1: x(refV), x2: x(refV), y1: M.t, y2: M.t + ih,
      stroke: token('--axis'), 'stroke-width': 1, 'stroke-dasharray': '3 3'
    }, g);
    svgEl('text', {
      class: 'axis-label', x: x(refV), y: M.t - 8, 'text-anchor': 'middle'
    }, g).textContent = data.axis.referenceLabel;

    function fitText(s, px) {
      var max = Math.floor(px / 6.05);
      return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)).replace(/[\s-]+$/, '') + '…';
    }

    /* barPath rounds the data end; mirror it for a bar that runs leftward. */
    function leftBarPath(x0, x1v, y, h) {
      var r = Math.min(4, (x1v - x0) / 2, h / 2);
      return 'M' + x1v + ',' + y +
             'H' + (x0 + r) + 'a' + r + ',' + r + ' 0 0 0 ' + (-r) + ',' + r +
             'V' + (y + h - r) + 'a' + r + ',' + r + ' 0 0 0 ' + r + ',' + r +
             'H' + x1v + 'Z';
    }

    var y = M.t;
    groups.forEach(function (gp) {
      var color = series(gp.slot);
      var nSig = gp.rows.filter(function (r) { return r.significant; }).length;

      svgEl('rect', { x: 0, y: y + headH - 17, width: 9, height: 9, rx: 2, fill: color }, g);
      svgEl('text', { class: 'axis-title', x: 14, y: y + headH - 9 }, g).textContent =
        gp.label + ' — ' + gp.rows.length + ' sets, ' + nSig + ' significant';
      y += headH;

      gp.rows.forEach(function (r) {
        var rowTop = y;
        var barTop = rowTop + (rowH - barH) / 2;
        var dim = r.significant ? 1 : 0.38;

        var label = svgEl('text', {
          class: 'axis-label', x: M.l - 10, y: barTop + barH - 2,
          'text-anchor': 'end', opacity: dim
        }, g);
        label.textContent = fitText(r.set, M.l - 16);

        var bar = null, tipX = x(refV);
        if (hasFold(r)) {
          var x0 = Math.min(x(refV), x(r.fold));
          var x1v = Math.max(x(refV), x(r.fold));
          if (x1v - x0 < 2) x1v = x0 + 2;
          bar = svgEl('path', {
            d: r.fold >= refV ? barPath(x0, barTop, x1v - x0, barH, 4, 'right')
                              : leftBarPath(x0, x1v, barTop, barH),
            fill: color, opacity: dim
          }, g);
          tipX = r.fold >= refV ? x1v : x0;
        }

        /* Value sits right of the reference whichever way the bar ran, so a
           depleted bar never prints its number under the row label. */
        var valX = hasFold(r) ? Math.max(x(r.fold), x(refV)) + 7 : x(refV) + 7;
        var val = svgEl('text', {
          class: hasFold(r) ? 'data-label' : 'axis-label',
          x: valX, y: barTop + barH - 2, 'text-anchor': 'start', opacity: dim
        }, g);
        val.textContent = hasFold(r) ? r.fold.toFixed(2) + '×' : 'no hub genes';

        var hit = svgEl('rect', {
          x: 0, y: rowTop, width: W, height: rowH, fill: 'transparent'
        }, g);
        hit.addEventListener('mouseenter', function () {
          /* A faded row comes up to full strength on hover — otherwise the
             non-significant sets, which are the point, are the hardest to read. */
          label.setAttribute('opacity', 1);
          val.setAttribute('opacity', 1);
          if (bar) bar.setAttribute('opacity', Math.max(0.7, dim));
        });
        hit.addEventListener('mousemove', function () {
          var shown = r.genes.slice(0, 6).join(', ');
          var rest = r.genes.length - 6;
          ctx.tip.show(
            '<div class="chart-tip__title">' + escapeHtml(r.set) + '</div>' +
            tipRow(color, 'Hub genes in set', r.overlap + ' of ' + data.test.query) +
            tipRow(null, 'Expected by chance', r.expected.toFixed(2)) +
            tipRow(null, 'Fold enrichment',
                   hasFold(r) ? r.fold.toFixed(2) + '×' + (r.depleted ? ' (depleted)' : '') : 'no overlap') +
            tipRow(null, 'FDR', sci(r.padj) + (r.significant ? '' : '  ns')) +
            tipRow(null, 'Set', r.source + ' · ' + fmt(r.setSize) + ' genes expressed') +
            (r.genes.length
              ? '<div class="chart-tip__row"><span>' + escapeHtml(shown) +
                (rest > 0 ? ' +' + rest + ' more' : '') + '</span></div>'
              : ''),
            tipX, barTop
          );
        });
        hit.addEventListener('mouseleave', function () {
          label.setAttribute('opacity', dim);
          val.setAttribute('opacity', dim);
          if (bar) bar.setAttribute('opacity', dim);
          ctx.tip.hide();
        });

        y += rowH;
      });
    });

    svgEl('line', {
      class: 'axis-line', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih
    }, g);
    svgEl('text', {
      class: 'axis-title', x: M.l + iw / 2, y: H - 6, 'text-anchor': 'middle'
    }, g).textContent = narrow
      ? 'Fold enrichment, log scale  →'
      : 'Fold enrichment among the ' + data.test.query + ' hub genes, log scale  →';

    return {
      legend: data.themes.map(function (t) {
        return { label: t.label, color: series(t.slot), type: 'swatch' };
      }).concat([
        { label: 'Faded: FDR ≥ ' + data.thresholds.padj + ', kept on the plot',
          color: token('--text-muted'), type: 'swatch' }
      ]),
      table: {
        columns: ['Gene set', 'Source', 'Theme', 'Hub genes', 'Expected', 'Fold', 'FDR'],
        align: ['', '', '', 'num', 'num', 'num', 'num'],
        rows: rows.map(function (r) {
          return [
            r.set, r.source, r.theme,
            r.overlap + ' / ' + data.test.query,
            r.expected.toFixed(2),
            hasFold(r) ? r.fold.toFixed(2) + '×' : '—',
            sci(r.padj) + (r.significant ? '' : ' (ns)')
          ];
        })
      }
    };
  };

  /* ---- Heatmap: marker expression by subtype ------------------------------ */
  RENDERERS.heatmap = function (ctx) {
    var svg = ctx.svg, data = ctx.source || ctx.data.heatmap, W = ctx.width;
    var M = { t: 34, r: 12, b: 12, l: 76 };
    var cellH = 30, gap = 2;
    var ih = data.rows.length * cellH;
    var H = M.t + ih + M.b;
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var iw = W - M.l - M.r;
    var cellW = iw / data.cols.length;

    var ramp = ['--seq-100', '--seq-200', '--seq-300', '--seq-400',
                '--seq-500', '--seq-600', '--seq-700'].map(token);
    function rampColor(v) {
      var i = Math.min(ramp.length - 1, Math.max(0, Math.round(v * (ramp.length - 1))));
      return ramp[i];
    }

    var g = svgEl('g', {}, svg);

    data.cols.forEach(function (c, i) {
      svgEl('text', {
        class: 'axis-label', x: M.l + i * cellW + cellW / 2, y: M.t - 12, 'text-anchor': 'middle'
      }, g).textContent = c;
    });

    data.rows.forEach(function (r, i) {
      svgEl('text', {
        class: 'axis-label', x: M.l - 10, y: M.t + i * cellH + cellH / 2 + 4, 'text-anchor': 'end'
      }, g).textContent = r;
    });

    data.cells.forEach(function (cell) {
      var color = rampColor(cell.value);
      var rect = svgEl('rect', {
        x: M.l + cell.c * cellW + gap / 2,
        y: M.t + cell.r * cellH + gap / 2,
        width: cellW - gap,
        height: cellH - gap,
        rx: 3,
        fill: color
      }, g);
      rect.addEventListener('mousemove', function (e) {
        var pt = ctx.local(e);
        rect.setAttribute('stroke', token('--text-primary'));
        rect.setAttribute('stroke-width', 1.5);
        ctx.tip.show(
          '<div class="chart-tip__title">' + escapeHtml(cell.row) + ' · ' + escapeHtml(cell.col) + '</div>' +
          tipRow(color, 'Scaled expression', cell.value.toFixed(2)),
          pt.x, M.t + cell.r * cellH
        );
      });
      rect.addEventListener('mouseleave', function () {
        rect.removeAttribute('stroke'); ctx.tip.hide();
      });
    });

    return {
      legend: null,
      ramp: { low: 'low', high: 'high' },
      table: {
        columns: ['Gene'].concat(data.cols),
        align: [''].concat(data.cols.map(function () { return 'num'; })),
        rows: data.rows.map(function (r) {
          return [r].concat(data.cols.map(function (c) {
            var cell = data.cells.find(function (x) { return x.row === r && x.col === c; });
            return cell ? cell.value.toFixed(2) : '—';
          }));
        })
      }
    };
  };

  /* ---- Small-multiple box panels -----------------------------------------
     One panel per cohort, each with its OWN y-axis in its OWN native unit.
     The cohorts sit on four platforms with four normalisations, so heights
     are NOT comparable between panels and nothing here is standardised to
     make them look comparable — the unit printed under each title is the
     warning. What each panel shows independently is the same thing: that
     cohort's tumours against that cohort's normals.

     data-height is the height of ONE ROW. The renderer picks a column count
     from the available width and grows the SVG to fit however many rows that
     needs, so the grid reflows from 5-across to stacked without the page
     having to know how many cohorts there are.
     ---------------------------------------------------------------------- */
  RENDERERS.boxpanels = function (ctx) {
    var svg = ctx.svg, data = ctx.source, W = ctx.width;
    if (!data || !data.cohorts || !data.cohorts.length) return {};
    var cohorts = data.cohorts;

    var cols = Math.min(cohorts.length, W >= 780 ? 5 : W >= 560 ? 3 : W >= 380 ? 2 : 1);
    var rows = Math.ceil(cohorts.length / cols);
    var panelW = W / cols;
    var panelH = ctx.height;
    var H = rows * panelH;

    /* The harness sized the SVG for a single row; a wrapped grid needs more. */
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);

    var root = svgEl('g', {}, svg);

    cohorts.forEach(function (co, idx) {
      var ox = (idx % cols) * panelW;
      var oy = Math.floor(idx / cols) * panelH;
      var g = svgEl('g', { transform: 'translate(' + ox + ',' + oy + ')' }, root);

      var M = { t: 72, r: 14, b: 42, l: 40 };
      var iw = panelW - M.l - M.r, ih = panelH - M.t - M.b;

      /* Panel header, one fact per line. These were previously two columns —
         effect on the left, p on the right — which collided as soon as a panel
         got narrow, so they are stacked instead. */
      svgEl('text', { class: 'panel-title', x: 4, y: 16 }, g).textContent = co.title;
      svgEl('text', { class: 'panel-sub', x: 4, y: 30 }, g).textContent = co.unit;
      svgEl('text', { class: 'panel-sub', x: 4, y: 44 }, g).textContent = co.test.effect;
      svgEl('text', { class: 'panel-sub', x: 4, y: 58 }, g).textContent = pText(co.test.p);

      /* Each panel scales to its own data — never to a shared domain. */
      var all = [];
      co.groups.forEach(function (grp) {
        all = all.concat(grp.points, grp.outliers || [], [grp.min, grp.max]);
      });
      var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
      var pad = (hi - lo) * 0.08 || 0.5;
      var yMin = lo - pad, yMax = hi + pad;
      var y = function (v) { return M.t + ih - (v - yMin) / (yMax - yMin) * ih; };

      niceTicks(yMin, yMax, 3).forEach(function (t) {
        svgEl('line', { class: 'grid-line', x1: M.l, x2: M.l + iw, y1: y(t), y2: y(t) }, g);
        svgEl('text', { class: 'axis-label', x: M.l - 6, y: y(t) + 4, 'text-anchor': 'end' }, g)
          .textContent = t.toFixed(1);
      });
      svgEl('line', { class: 'axis-line', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, g);

      var slotW = iw / co.groups.length;
      var boxW = Math.min(34, slotW * 0.5);

      co.groups.forEach(function (grp, i) {
        var cx = M.l + slotW * i + slotW / 2;
        var color = series(grp.slot);

        var dots = svgEl('g', { opacity: 0.34 }, g);
        grp.points.forEach(function (v, k) {
          svgEl('circle', { cx: cx + jitter(k) * boxW * 1.4, cy: y(v), r: 1.5, fill: color }, dots);
        });

        svgEl('line', {
          x1: cx, x2: cx, y1: y(grp.min), y2: y(grp.max), stroke: color, 'stroke-width': 1.4
        }, g);
        [grp.min, grp.max].forEach(function (v) {
          svgEl('line', {
            x1: cx - boxW / 4, x2: cx + boxW / 4, y1: y(v), y2: y(v),
            stroke: color, 'stroke-width': 1.4
          }, g);
        });

        var box = svgEl('rect', {
          x: cx - boxW / 2, y: y(grp.q3), width: boxW,
          height: Math.max(2, y(grp.q1) - y(grp.q3)),
          rx: 2.5, fill: color, 'fill-opacity': 0.22, stroke: color, 'stroke-width': 1.4
        }, g);

        svgEl('line', {
          x1: cx - boxW / 2, x2: cx + boxW / 2, y1: y(grp.median), y2: y(grp.median),
          stroke: color, 'stroke-width': 2.4
        }, g);

        (grp.outliers || []).forEach(function (v, k) {
          svgEl('circle', {
            cx: cx + jitter(k) * boxW * 0.8, cy: y(v), r: 2,
            fill: 'none', stroke: color, 'stroke-width': 1.1
          }, g);
        });

        svgEl('text', {
          class: 'axis-label', x: cx, y: M.t + ih + 17, 'text-anchor': 'middle'
        }, g).textContent = grp.label;
        svgEl('text', {
          class: 'axis-label', x: cx, y: M.t + ih + 31, 'text-anchor': 'middle', opacity: 0.75
        }, g).textContent = 'n = ' + fmt(grp.n);

        var hit = svgEl('rect', {
          x: cx - slotW / 2, y: M.t, width: slotW, height: ih, fill: 'transparent'
        }, g);
        hit.addEventListener('mouseenter', function () { box.setAttribute('fill-opacity', 0.34); });
        hit.addEventListener('mousemove', function () {
          ctx.tip.show(
            '<div class="chart-tip__title">' + escapeHtml(co.title + ' · ' + grp.label) + '</div>' +
            tipRow(color, 'Median', grp.median.toFixed(2) + ' ' + co.unit) +
            tipRow(null, 'IQR', grp.q1.toFixed(2) + ' – ' + grp.q3.toFixed(2)) +
            tipRow(null, 'n', fmt(grp.n)) +
            tipRow(null, co.test.name, pText(co.test.p)),
            ox + cx, oy + y(grp.median)
          );
        });
        hit.addEventListener('mouseleave', function () {
          box.setAttribute('fill-opacity', 0.22); ctx.tip.hide();
        });
      });
    });

    var tableRows = [];
    cohorts.forEach(function (co) {
      co.groups.forEach(function (grp) {
        tableRows.push([
          co.title, grp.label, fmt(grp.n), grp.median.toFixed(2),
          grp.q1.toFixed(2), grp.q3.toFixed(2), grp.mean.toFixed(2), co.unit
        ]);
      });
    });

    return {
      legend: cohorts[0].groups.map(function (grp) {
        return { label: grp.label, color: series(grp.slot), type: 'swatch' };
      }),
      table: {
        columns: ['Cohort', 'Group', 'n', 'Median', 'Q1', 'Q3', 'Mean', 'Unit'],
        align: ['', '', 'num', 'num', 'num', 'num', 'num', ''],
        rows: tableRows
      }
    };
  };

  /* ---- Paired slope graph -------------------------------------------------
     One line per patient, joining that patient's own normal sample to their
     own tumour. This is the figure an unpaired box plot cannot draw: it shows
     whether the shift holds WITHIN individuals, not just between group
     medians, so the handful of patients who move the other way stay visible
     instead of being averaged away.

     Lines are coloured by direction rather than by group, because direction
     is the thing being read.
     ---------------------------------------------------------------------- */
  RENDERERS.paired = function (ctx) {
    var svg = ctx.svg, data = ctx.source, W = ctx.width, H = ctx.height;
    if (!data || !data.pairs) return {};

    var M = { t: 30, r: 20, b: 52, l: 60 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    var vals = [];
    data.pairs.forEach(function (p) { vals.push(p.normal, p.tumour); });
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    var pad = (hi - lo) * 0.08 || 0.5;
    var yMin = lo - pad, yMax = hi + pad;
    var y = function (v) { return M.t + ih - (v - yMin) / (yMax - yMin) * ih; };

    /* Two fixed columns, inset so the slopes read as slopes and not as noise. */
    var xN = M.l + iw * 0.28, xT = M.l + iw * 0.72;
    var upColor = token('--diverge-high'), downColor = token('--diverge-low');

    var g = svgEl('g', {}, svg);

    niceTicks(yMin, yMax, 5).forEach(function (t) {
      svgEl('line', { class: 'grid-line', x1: M.l, x2: M.l + iw, y1: y(t), y2: y(t) }, g);
      svgEl('text', { class: 'axis-label', x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, g)
        .textContent = t.toFixed(1);
    });
    svgEl('line', { class: 'axis-line', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, g);

    svgEl('text', {
      class: 'axis-title', x: 14, y: M.t + ih / 2,
      'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (M.t + ih / 2) + ')'
    }, g).textContent = data.unit || 'expression';

    /* One line per patient. Kept in an array so hover can thicken just one. */
    var lines = svgEl('g', {}, g);
    var marks = [];
    data.pairs.forEach(function (pr) {
      var color = pr.delta >= 0 ? upColor : downColor;
      var line = svgEl('line', {
        x1: xN, y1: y(pr.normal), x2: xT, y2: y(pr.tumour),
        stroke: color, 'stroke-width': 1, opacity: pr.delta >= 0 ? 0.3 : 0.85
      }, lines);
      marks.push({ pair: pr, line: line, color: color,
                   x1: xN, y1: y(pr.normal), x2: xT, y2: y(pr.tumour) });
    });

    /* Endpoints in the group colours, so the two columns stay identifiable. */
    var ends = svgEl('g', {}, g);
    var slotOf = {};
    (data.groups || []).forEach(function (gr) { slotOf[gr.label] = gr.slot; });
    /* Normal takes the volcano's green rather than slot 3's teal. */
    var nColor = downColor, tColor = series(slotOf.Tumour || 8);
    data.pairs.forEach(function (pr) {
      svgEl('circle', { cx: xN, cy: y(pr.normal), r: 2, fill: nColor, opacity: 0.62 }, ends);
      svgEl('circle', { cx: xT, cy: y(pr.tumour), r: 2, fill: tColor, opacity: 0.62 }, ends);
    });

    /* Group medians — the summary the slopes are evidence for. */
    function median(arr) {
      var a = arr.slice().sort(function (p, q) { return p - q; });
      var m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
    }
    var medN = median(data.pairs.map(function (p) { return p.normal; }));
    var medT = median(data.pairs.map(function (p) { return p.tumour; }));
    [[xN, medN, nColor], [xT, medT, tColor]].forEach(function (d) {
      svgEl('line', {
        x1: d[0] - 34, x2: d[0] + 34, y1: y(d[1]), y2: y(d[1]),
        stroke: d[2], 'stroke-width': 3
      }, g);
    });

    [[xN, 'Normal', medN], [xT, 'Tumour', medT]].forEach(function (d) {
      svgEl('text', {
        class: 'axis-label', x: d[0], y: M.t + ih + 18, 'text-anchor': 'middle'
      }, g).textContent = d[1];
      svgEl('text', {
        class: 'axis-label', x: d[0], y: M.t + ih + 32, 'text-anchor': 'middle', opacity: 0.75
      }, g).textContent = 'median ' + d[2].toFixed(2);
    });

    if (data.test) {
      svgEl('text', { class: 'data-label', x: M.l, y: 14 }, g).textContent =
        data.test.name + ' ' + pText(data.test.p) +
        (data.test.effect ? '   ·   ' + data.test.effect : '');
    }

    /* Hover picks the nearest endpoint, then lifts that patient's whole line. */
    var hit = svgEl('rect', { x: 0, y: 0, width: W, height: H, fill: 'transparent' }, g);
    hit.addEventListener('mousemove', function (e) {
      var pt = ctx.local(e);
      var best = null, bestD = 18 * 18;
      marks.forEach(function (m) {
        [[m.x1, m.y1], [m.x2, m.y2]].forEach(function (c) {
          var dx = c[0] - pt.x, dy = c[1] - pt.y, d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = m; }
        });
      });
      marks.forEach(function (m) {
        m.line.setAttribute('stroke-width', m === best ? 2.6 : 1);
        m.line.setAttribute('opacity', m === best ? 1 : (m.pair.delta >= 0 ? 0.3 : 0.85));
      });
      if (!best) { ctx.tip.hide(); return; }
      var pr = best.pair;
      ctx.tip.show(
        '<div class="chart-tip__title">' + escapeHtml(pr.id) + '</div>' +
        tipRow(nColor, 'Normal', pr.normal.toFixed(2)) +
        tipRow(tColor, 'Tumour', pr.tumour.toFixed(2)) +
        tipRow(best.color, 'Change', (pr.delta >= 0 ? '+' : '') + pr.delta.toFixed(2)),
        (best.x1 + best.x2) / 2, Math.min(best.y1, best.y2)
      );
    });
    hit.addEventListener('mouseleave', function () {
      marks.forEach(function (m) {
        m.line.setAttribute('stroke-width', 1);
        m.line.setAttribute('opacity', m.pair.delta >= 0 ? 0.3 : 0.85);
      });
      ctx.tip.hide();
    });

    var s = data.summary || {};
    var sorted = data.pairs.slice().sort(function (a, b) { return b.delta - a.delta; });

    return {
      legend: [
        { label: 'Higher in tumour' + (s.up !== undefined ? ' (' + s.up + ')' : ''),
          color: upColor, type: 'dot' },
        { label: 'Lower in tumour' + (s.down !== undefined ? ' (' + s.down + ')' : ''),
          color: downColor, type: 'dot' }
      ],
      table: {
        columns: ['Patient', 'Normal', 'Tumour', 'Change'],
        align: ['', 'num', 'num', 'num'],
        rows: sorted.map(function (pr) {
          return [pr.id, pr.normal.toFixed(2), pr.tumour.toFixed(2),
                  (pr.delta >= 0 ? '+' : '') + pr.delta.toFixed(2)];
        })
      }
    };
  };

  /* ---- Box plot with jittered points --------------------------------------
     Used twice: PPP4C in tumour vs normal, and PPP4C across the five PAM50
     subtypes. Reads whichever block the figure names in data-source, so one
     renderer serves both. Boxes show the five-number summary; the dots behind
     them are a thinned sample of the underlying values, because a box alone
     hides how many tumours are actually in each group.
     ---------------------------------------------------------------------- */
  RENDERERS.box = function (ctx) {
    var svg = ctx.svg, data = ctx.source, W = ctx.width, H = ctx.height;
    if (!data || !data.groups) return {};

    var groups = data.groups;
    /* Roughly 7px per character at the axis-label size; if a label cannot fit
       its slot horizontally it gets tilted, which needs a deeper footer. */
    var widest = Math.max.apply(null, data.groups.map(function (d) {
      return d.label.length;
    }));
    var tilt = (W - 76) / data.groups.length < widest * 7 + 12;
    var M = { t: 26, r: 18, b: tilt ? 74 : 54, l: 58 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    /* Scale spans every drawn value, outliers included, so nothing clips. */
    var all = [];
    groups.forEach(function (g) {
      all = all.concat(g.points, g.outliers || [], [g.min, g.max]);
    });
    /* A reference line is part of the reading, so keep it inside the scale. */
    if (data.refLine) all.push(data.refLine.value);
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    var pad = (hi - lo) * 0.08;
    var yMin = lo - pad, yMax = hi + pad;
    var y = function (v) { return M.t + ih - (v - yMin) / (yMax - yMin) * ih; };

    var slotW = iw / groups.length;
    var boxW = Math.min(64, slotW * 0.44);

    var g = svgEl('g', {}, svg);

    niceTicks(yMin, yMax, 5).forEach(function (t) {
      svgEl('line', { class: 'grid-line', x1: M.l, x2: M.l + iw, y1: y(t), y2: y(t) }, g);
      svgEl('text', { class: 'axis-label', x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, g)
        .textContent = t.toFixed(1);
    });
    svgEl('line', { class: 'axis-line', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, g);

    svgEl('text', {
      class: 'axis-title', x: 14, y: M.t + ih / 2,
      'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (M.t + ih / 2) + ')'
    }, g).textContent = data.unit || 'expression';

    /* Optional reference line — drawn before the groups so the boxes sit on
       top of it. Only meaningful when the unit has a fixed zero (a fold-change
       against a baseline); figures in absolute units simply omit refLine. */
    if (data.refLine) {
      svgEl('line', {
        x1: M.l, x2: M.l + iw, y1: y(data.refLine.value), y2: y(data.refLine.value),
        stroke: token('--text-primary'), 'stroke-width': 1.5,
        'stroke-dasharray': '5 3', opacity: 0.7
      }, g);
      if (data.refLine.label) {
        svgEl('text', {
          class: 'data-label', x: M.l + iw - 2, y: y(data.refLine.value) - 6,
          'text-anchor': 'end', opacity: 0.7
        }, g).textContent = data.refLine.label;
      }
    }

    groups.forEach(function (grp, i) {
      var cx = M.l + slotW * i + slotW / 2;
      var color = series(grp.slot);

      /* Jittered raw values behind the box. The offset is derived from the
         index, not Math.random, so the figure is identical on every reload. */
      var dots = svgEl('g', { opacity: 0.35 }, g);
      grp.points.forEach(function (v, k) {
        svgEl('circle', { cx: cx + jitter(k) * boxW * 1.5, cy: y(v), r: 1.8, fill: color }, dots);
      });

      /* Whiskers */
      svgEl('line', {
        x1: cx, x2: cx, y1: y(grp.min), y2: y(grp.max),
        stroke: color, 'stroke-width': 1.5
      }, g);
      [grp.min, grp.max].forEach(function (v) {
        svgEl('line', {
          x1: cx - boxW / 4, x2: cx + boxW / 4, y1: y(v), y2: y(v),
          stroke: color, 'stroke-width': 1.5
        }, g);
      });

      /* Interquartile box, filled at low opacity so the dots stay visible. */
      var box = svgEl('rect', {
        x: cx - boxW / 2, y: y(grp.q3), width: boxW, height: Math.max(2, y(grp.q1) - y(grp.q3)),
        rx: 3, fill: color, 'fill-opacity': 0.22, stroke: color, 'stroke-width': 1.5
      }, g);

      /* Median — the one line a reader actually compares between groups. */
      svgEl('line', {
        x1: cx - boxW / 2, x2: cx + boxW / 2, y1: y(grp.median), y2: y(grp.median),
        stroke: color, 'stroke-width': 2.5
      }, g);

      (grp.outliers || []).forEach(function (v, k) {
        svgEl('circle', {
          cx: cx + jitter(k) * boxW * 0.8, cy: y(v), r: 2.2,
          fill: 'none', stroke: color, 'stroke-width': 1.2
        }, g);
      });

      /* Group label and n, below the axis. Narrow slots cannot hold a
         horizontal label without the groups colliding, so tilt instead. */
      if (tilt) {
        svgEl('text', {
          class: 'axis-label', x: cx, y: M.t + ih + 16, 'text-anchor': 'end',
          transform: 'rotate(-35 ' + cx + ' ' + (M.t + ih + 16) + ')'
        }, g).textContent = grp.label + ' (n = ' + fmt(grp.n) + ')';
      } else {
        svgEl('text', {
          class: 'axis-label', x: cx, y: M.t + ih + 18, 'text-anchor': 'middle'
        }, g).textContent = grp.label;
        svgEl('text', {
          class: 'axis-label', x: cx, y: M.t + ih + 32, 'text-anchor': 'middle', opacity: 0.75
        }, g).textContent = 'n = ' + fmt(grp.n);
      }

      var hit = svgEl('rect', {
        x: cx - slotW / 2, y: M.t, width: slotW, height: ih, fill: 'transparent'
      }, g);
      hit.addEventListener('mouseenter', function () { box.setAttribute('fill-opacity', 0.34); });
      hit.addEventListener('mousemove', function () {
        ctx.tip.show(
          '<div class="chart-tip__title">' + escapeHtml(grp.label) + '</div>' +
          tipRow(color, 'Median', grp.median.toFixed(2)) +
          tipRow(null, 'IQR', grp.q1.toFixed(2) + ' – ' + grp.q3.toFixed(2)) +
          tipRow(null, 'n', fmt(grp.n)),
          cx, y(grp.median)
        );
      });
      hit.addEventListener('mouseleave', function () {
        box.setAttribute('fill-opacity', 0.22); ctx.tip.hide();
      });
    });

    /* Test statistic, top-left where no box reaches. */
    if (data.test) {
      svgEl('text', { class: 'data-label', x: M.l + 4, y: M.t - 10 }, g)
        .textContent = data.test.name + ' p = ' + sci(data.test.p) +
                       (data.test.effect ? '   ·   ' + data.test.effect : '');
    }

    return {
      legend: groups.map(function (grp) {
        return { label: grp.label, color: series(grp.slot), type: 'swatch' };
      }),
      table: {
        columns: ['Group', 'n', 'Median', 'Q1', 'Q3', 'Mean'],
        align: ['', 'num', 'num', 'num', 'num', 'num'],
        rows: groups.map(function (grp) {
          return [grp.label, fmt(grp.n), grp.median.toFixed(2),
                  grp.q1.toFixed(2), grp.q3.toFixed(2), grp.mean.toFixed(2)];
        })
      }
    };
  };

  /* ---- Forest plot: multivariable Cox model -------------------------------
     Hazard ratios on a log axis, because a ratio of 2 and a ratio of 0.5 are
     the same size of effect in opposite directions and should look it. The
     dashed line at 1 is the null; a confidence interval crossing it is the
     visual definition of "not significant".
     ---------------------------------------------------------------------- */
  RENDERERS.forest = function (ctx) {
    var svg = ctx.svg, data = ctx.source, W = ctx.width;
    if (!data || !data.rows) return {};

    var rows = data.rows;
    /* Below roughly 560px there is no width left for a label column beside a
       readable axis, so the term moves above its own interval instead. */
    var narrow = W < 560;
    var M = narrow
      ? { t: 30, r: 16, b: 44, l: 16 }
      : { t: 30,
          r: Math.min(150, Math.max(96, W * 0.24)),
          b: 44,
          l: Math.min(210, Math.max(120, W * 0.30)) };
    var rowH = narrow ? 54 : 34;
    var ih = rows.length * rowH;
    var H = M.t + ih + M.b;
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var iw = W - M.l - M.r;

    var lows = rows.map(function (d) { return d.lo; });
    var highs = rows.map(function (d) { return d.hi; });
    var min = Math.min(0.5, Math.min.apply(null, lows) * 0.9);
    var max = Math.max(2, Math.max.apply(null, highs) * 1.1);
    var lmin = Math.log(min), lmax = Math.log(max);
    var x = function (v) { return M.l + (Math.log(v) - lmin) / (lmax - lmin) * iw; };

    var g = svgEl('g', {}, svg);

    [0.5, 1, 2, 4].filter(function (t) { return t >= min && t <= max; }).forEach(function (t) {
      svgEl('line', {
        class: 'grid-line', x1: x(t), x2: x(t), y1: M.t, y2: M.t + ih
      }, g);
      svgEl('text', {
        class: 'axis-label', x: x(t), y: M.t + ih + 18, 'text-anchor': 'middle'
      }, g).textContent = t;
    });

    /* The null line is an annotation, not a gridline — dashed marks it out. */
    svgEl('line', {
      x1: x(1), x2: x(1), y1: M.t, y2: M.t + ih,
      stroke: token('--axis'), 'stroke-width': 1.5, 'stroke-dasharray': '4 3'
    }, g);

    svgEl('text', { class: 'axis-label', x: M.l, y: M.t - 12, 'text-anchor': 'start' }, g)
      .textContent = '← lower risk';
    svgEl('text', { class: 'axis-label', x: M.l + iw, y: M.t - 12, 'text-anchor': 'end' }, g)
      .textContent = 'higher risk →';

    rows.forEach(function (d, i) {
      var top = M.t + i * rowH;
      var cy = narrow ? top + rowH - 16 : top + rowH / 2;
      var sig = d.lo > 1 || d.hi < 1;
      /* Highlight the target gene; everything else is a covariate the model
         is adjusting for, so it is drawn in the neutral text colour. */
      var color = d.highlight ? series(8) : token('--text-secondary');

      svgEl('text', {
        class: 'axis-label',
        x: narrow ? M.l : M.l - 12,
        y: narrow ? top + 14 : cy + 4,
        'text-anchor': narrow ? 'start' : 'end',
        'font-weight': d.highlight ? 650 : 400
      }, g).textContent = d.term;

      svgEl('line', {
        x1: x(d.lo), x2: x(d.hi), y1: cy, y2: cy,
        stroke: color, 'stroke-width': 1.5, opacity: sig ? 1 : 0.6
      }, g);
      [d.lo, d.hi].forEach(function (v) {
        svgEl('line', {
          x1: x(v), x2: x(v), y1: cy - 4, y2: cy + 4,
          stroke: color, 'stroke-width': 1.5, opacity: sig ? 1 : 0.6
        }, g);
      });

      var s = d.highlight ? 6 : 5;
      var mark = svgEl('rect', {
        x: x(d.hr) - s / 2, y: cy - s / 2, width: s, height: s,
        fill: color, class: 'mark-ring', opacity: sig ? 1 : 0.7
      }, g);

      svgEl('text', {
        class: 'data-label',
        x: narrow ? M.l + iw : M.l + iw + 10,
        y: narrow ? top + 14 : cy + 4,
        'text-anchor': narrow ? 'end' : 'start'
      }, g).textContent = d.hr.toFixed(2) + ' (' + d.lo.toFixed(2) + '–' + d.hi.toFixed(2) + ')';

      var hit = svgEl('rect', {
        x: M.l, y: top, width: iw, height: rowH, fill: 'transparent'
      }, g);
      hit.addEventListener('mousemove', function () {
        mark.setAttribute('opacity', 0.75);
        ctx.tip.show(
          '<div class="chart-tip__title">' + escapeHtml(d.term) + '</div>' +
          tipRow(color, 'Hazard ratio', d.hr.toFixed(2)) +
          tipRow(null, '95% CI', d.lo.toFixed(2) + ' – ' + d.hi.toFixed(2)) +
          tipRow(null, 'p', sci(d.p)),
          x(d.hr), cy
        );
      });
      hit.addEventListener('mouseleave', function () {
        mark.setAttribute('opacity', sig ? 1 : 0.7); ctx.tip.hide();
      });
    });

    svgEl('text', {
      class: 'axis-title', x: M.l + iw / 2, y: H - 8, 'text-anchor': 'middle'
    }, g).textContent = 'Hazard ratio (log scale)';

    return {
      legend: null,
      table: {
        columns: ['Covariate', 'HR', '95% CI', 'p'],
        align: ['', 'num', 'num', 'num'],
        rows: rows.map(function (d) {
          return [d.term, d.hr.toFixed(2), d.lo.toFixed(2) + '–' + d.hi.toFixed(2), sci(d.p)];
        })
      }
    };
  };

  /* ---- Scatter: co-expression of two genes --------------------------------
     One point per tumour. The fitted line is ordinary least squares, drawn
     only to make the trend legible — the reported statistic is the rank
     correlation above it, which does not assume the line.
     ---------------------------------------------------------------------- */
  RENDERERS.scatter = function (ctx) {
    var svg = ctx.svg, data = ctx.source, W = ctx.width, H = ctx.height;
    if (!data || !data.points) return {};

    var pts = data.points;
    var M = { t: 26, r: 18, b: 48, l: 56 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    var xs = pts.map(function (p) { return p.x; });
    var ys = pts.map(function (p) { return p.y; });
    function span(arr) {
      var lo = Math.min.apply(null, arr), hi = Math.max.apply(null, arr);
      var pad = (hi - lo) * 0.06;
      return [lo - pad, hi + pad];
    }
    var xr = span(xs), yr = span(ys);
    var x = function (v) { return M.l + (v - xr[0]) / (xr[1] - xr[0]) * iw; };
    var y = function (v) { return M.t + ih - (v - yr[0]) / (yr[1] - yr[0]) * ih; };

    var color = series(1);
    var g = svgEl('g', {}, svg);

    niceTicks(yr[0], yr[1], 5).forEach(function (t) {
      svgEl('line', { class: 'grid-line', x1: M.l, x2: M.l + iw, y1: y(t), y2: y(t) }, g);
      svgEl('text', { class: 'axis-label', x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, g)
        .textContent = t.toFixed(1);
    });
    niceTicks(xr[0], xr[1], 5).forEach(function (t) {
      svgEl('text', { class: 'axis-label', x: x(t), y: M.t + ih + 18, 'text-anchor': 'middle' }, g)
        .textContent = t.toFixed(1);
    });
    svgEl('line', { class: 'axis-line', x1: M.l, x2: M.l + iw, y1: M.t + ih, y2: M.t + ih }, g);

    var dots = svgEl('g', {}, g);
    pts.forEach(function (p) {
      p.cx = x(p.x); p.cy = y(p.y);
      svgEl('circle', { cx: p.cx, cy: p.cy, r: 2.6, fill: color, opacity: 0.42 }, dots);
    });

    /* Least-squares fit. */
    var n = pts.length;
    var mx = xs.reduce(function (a, b) { return a + b; }, 0) / n;
    var my = ys.reduce(function (a, b) { return a + b; }, 0) / n;
    var num = 0, den = 0;
    for (var i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) * (xs[i] - mx);
    }
    var slope = den ? num / den : 0;
    var intercept = my - slope * mx;
    svgEl('line', {
      x1: x(xr[0]), y1: y(intercept + slope * xr[0]),
      x2: x(xr[1]), y2: y(intercept + slope * xr[1]),
      stroke: token('--text-primary'), 'stroke-width': 1.5, 'stroke-dasharray': '5 3', opacity: 0.7
    }, g);

    svgEl('text', {
      class: 'axis-title', x: M.l + iw / 2, y: H - 8, 'text-anchor': 'middle'
    }, g).textContent = data.xGene + '  ' + (data.unit || '');
    svgEl('text', {
      class: 'axis-title', x: 14, y: M.t + ih / 2,
      'text-anchor': 'middle', transform: 'rotate(-90 14 ' + (M.t + ih / 2) + ')'
    }, g).textContent = data.yGene + '  ' + (data.unit || '');

    svgEl('text', { class: 'data-label', x: M.l + 4, y: M.t - 10 }, g)
      .textContent = (data.method || 'Spearman') + ' r = ' + data.r.toFixed(2) +
                     '   ·   p = ' + sci(data.p) + '   ·   n = ' + fmt(n);

    var hit = svgEl('rect', { x: M.l, y: M.t, width: iw, height: ih, fill: 'transparent' }, g);
    var focus = svgEl('circle', {
      r: 5.5, fill: 'none', stroke: token('--text-primary'), 'stroke-width': 1.5, opacity: 0
    }, g);
    hit.addEventListener('mousemove', function (e) {
      var pt = ctx.local(e);
      var best = null, bestD = 14 * 14;
      for (var k = 0; k < pts.length; k++) {
        var dx = pts[k].cx - pt.x, dy = pts[k].cy - pt.y;
        var d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = pts[k]; }
      }
      if (!best) { ctx.tip.hide(); focus.setAttribute('opacity', 0); return; }
      focus.setAttribute('cx', best.cx);
      focus.setAttribute('cy', best.cy);
      focus.setAttribute('opacity', 0.8);
      ctx.tip.show(
        '<div class="chart-tip__title">One tumour</div>' +
        tipRow(color, data.xGene, best.x.toFixed(2)) +
        tipRow(color, data.yGene, best.y.toFixed(2)),
        best.cx, best.cy
      );
    });
    hit.addEventListener('mouseleave', function () {
      ctx.tip.hide(); focus.setAttribute('opacity', 0);
    });

    return {
      legend: [{ label: 'One point per tumour (n = ' + fmt(n) + ')', color: color, type: 'dot' }],
      table: {
        columns: ['Statistic', 'Value'],
        align: ['', 'num'],
        rows: [
          ['Correlation method', data.method || 'Spearman'],
          ['r', data.r.toFixed(2)],
          ['p', sci(data.p)],
          ['Samples', fmt(n)],
          ['Fitted slope', slope.toFixed(2)]
        ]
      }
    };
  };

  /* ---- Diverging bars: genes correlated with the target -------------------
     Bars run left and right from a shared zero, so sign is read from
     direction rather than from colour alone.
     ---------------------------------------------------------------------- */
  RENDERERS.corrbar = function (ctx) {
    var svg = ctx.svg, data = ctx.source, W = ctx.width;
    if (!data || !data.items) return {};

    var items = data.items.slice().sort(function (a, b) { return b.r - a.r; });
    var M = { t: 10, r: 56, b: 46, l: 84 };
    var rowH = 26, barH = 15;
    var ih = items.length * rowH;
    var H = M.t + ih + M.b;
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    var iw = W - M.l - M.r;

    var bound = Math.max(0.2, Math.ceil(Math.max.apply(null, items.map(function (d) {
      return Math.abs(d.r);
    })) * 10) / 10);
    var mid = M.l + iw / 2;
    var x = function (v) { return mid + (v / bound) * (iw / 2); };

    var up = token('--diverge-high'), down = token('--diverge-low');
    var g = svgEl('g', {}, svg);

    niceTicks(-bound, bound, 4).forEach(function (t) {
      svgEl('line', { class: 'grid-line', x1: x(t), x2: x(t), y1: M.t, y2: M.t + ih }, g);
      svgEl('text', {
        class: 'axis-label', x: x(t), y: M.t + ih + 18, 'text-anchor': 'middle'
      }, g).textContent = t.toFixed(1);
    });
    svgEl('line', { class: 'axis-line', x1: mid, x2: mid, y1: M.t, y2: M.t + ih }, g);

    items.forEach(function (d, i) {
      var pos = d.r >= 0;
      var color = pos ? up : down;
      var yTop = M.t + i * rowH + (rowH - barH) / 2;
      var w = Math.max(Math.abs(x(d.r) - mid), 2);
      var bx = pos ? mid : mid - w;

      /* barPath's rounded end always sits on the right, so mirror the bar
         for negative values instead of drawing a differently-shaped path. */
      var bar = svgEl('path', {
        d: barPath(bx, yTop, w, barH, 4, 'right'), fill: color,
        transform: pos ? null : 'rotate(180 ' + (bx + w / 2) + ' ' + (yTop + barH / 2) + ')'
      }, g);

      svgEl('text', {
        class: 'axis-label', x: M.l - 10, y: yTop + barH / 2 + 4, 'text-anchor': 'end'
      }, g).textContent = d.gene;

      svgEl('text', {
        class: 'data-label',
        x: pos ? mid + w + 8 : mid - w - 8,
        y: yTop + barH / 2 + 4,
        'text-anchor': pos ? 'start' : 'end'
      }, g).textContent = d.r.toFixed(2);

      var hit = svgEl('rect', {
        x: M.l, y: M.t + i * rowH, width: iw, height: rowH, fill: 'transparent'
      }, g);
      hit.addEventListener('mousemove', function () {
        bar.setAttribute('opacity', 0.82);
        ctx.tip.show(
          '<div class="chart-tip__title">' + escapeHtml(d.gene) + '</div>' +
          tipRow(color, 'r with ' + (data.gene || 'target'), d.r.toFixed(2)),
          x(d.r), yTop
        );
      });
      hit.addEventListener('mouseleave', function () {
        bar.setAttribute('opacity', 1); ctx.tip.hide();
      });
    });

    svgEl('text', {
      class: 'axis-title', x: mid, y: H - 6, 'text-anchor': 'middle'
    }, g).textContent = 'Correlation with ' + (data.gene || 'target gene');

    return {
      legend: [
        { label: 'Falls with ' + (data.gene || 'target'), color: down, type: 'swatch' },
        { label: 'Rises with ' + (data.gene || 'target'), color: up, type: 'swatch' }
      ],
      table: {
        columns: ['Gene', 'r', 'Direction'],
        align: ['', 'num', ''],
        rows: items.map(function (d) {
          return [d.gene, d.r.toFixed(2), d.r >= 0 ? 'Positive' : 'Negative'];
        })
      }
    };
  };

  /* ======================================================================
     FIGURE CONTROLLER
     ====================================================================== */

  function buildLegend(host, entries) {
    host.innerHTML = '';
    if (!entries || !entries.length) { host.hidden = true; return; }
    host.hidden = false;
    entries.forEach(function (e) {
      var li = document.createElement('li');
      var key = document.createElement('span');
      key.className = e.type === 'line' ? 'legend__line' : 'legend__swatch';
      if (e.type === 'dot') key.style.borderRadius = '50%';
      key.style.background = e.color;
      li.appendChild(key);
      li.appendChild(document.createTextNode(e.label));
      host.appendChild(li);
    });
  }

  function buildTable(host, spec, caption) {
    host.innerHTML = '';
    if (!spec) return;
    var table = document.createElement('table');
    if (caption) {
      var cap = document.createElement('caption');
      cap.textContent = caption;
      table.appendChild(cap);
    }
    var thead = document.createElement('thead');
    var tr = document.createElement('tr');
    spec.columns.forEach(function (c, i) {
      var th = document.createElement('th');
      th.scope = 'col';
      th.textContent = c;
      if (spec.align && spec.align[i] === 'num') th.className = 'num';
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    spec.rows.forEach(function (row) {
      var trb = document.createElement('tr');
      row.forEach(function (cell, i) {
        var td = document.createElement(i === 0 ? 'th' : 'td');
        if (i === 0) td.scope = 'row';
        td.textContent = cell;
        if (spec.align && spec.align[i] === 'num') td.className = 'num';
        trb.appendChild(td);
      });
      tbody.appendChild(trb);
    });
    table.appendChild(tbody);
    host.appendChild(table);
  }

  /* Resolve a dotted data-source path ("ppp4.cox") against BRCA_DATA, so a
     figure names its own data block in the HTML instead of the renderer
     hard-coding one. Charts with no data-source read ctx.data directly. */
  function resolve(root, path) {
    if (!path) return null;
    return path.split('.').reduce(function (acc, key) {
      return acc ? acc[key] : undefined;
    }, root);
  }

  function mountFigure(root) {
    var name = root.getAttribute('data-chart');
    var renderer = RENDERERS[name];
    var plot = root.querySelector('.figure__plot');
    if (!renderer || !plot) return;

    var legendHost = root.querySelector('.legend');
    var rampHost = root.querySelector('.ramp-key');
    var tableHost = root.querySelector('.figure__table');
    var toggle = root.querySelector('[data-table-toggle]');
    var tip = makeTip(plot);
    var height = parseInt(root.getAttribute('data-height') || '380', 10);

    function local(e) {
      var rect = plot.getBoundingClientRect();
      var svg = plot.querySelector('svg');
      var scale = svg ? (svg.viewBox.baseVal.width || rect.width) / rect.width : 1;
      return { x: (e.clientX - rect.left) * scale, y: (e.clientY - rect.top) * scale };
    }

    function render() {
      var width = Math.max(320, Math.round(plot.clientWidth));
      var old = plot.querySelector('svg');
      if (old) old.remove();

      var svg = svgEl('svg', {
        viewBox: '0 0 ' + width + ' ' + height,
        width: width,
        height: height,
        role: 'img',
        'aria-label': root.getAttribute('data-alt') || ''
      });
      svg.style.fontFamily = getComputedStyle(root).fontFamily;
      plot.insertBefore(svg, plot.firstChild);

      var out = renderer({
        svg: svg, width: width, height: height,
        data: window.BRCA_DATA,
        source: resolve(window.BRCA_DATA, root.getAttribute('data-source')),
        tip: tip, local: local
      }) || {};

      if (legendHost) buildLegend(legendHost, out.legend);
      if (rampHost) rampHost.hidden = !out.ramp;
      if (tableHost) buildTable(tableHost, out.table, root.getAttribute('data-table-caption'));
    }

    if (toggle && tableHost) {
      toggle.addEventListener('click', function () {
        var open = !tableHost.hidden;
        tableHost.hidden = open;
        toggle.setAttribute('aria-expanded', String(!open));
        toggle.textContent = open ? 'Table' : 'Hide table';
      });
    }

    render();

    /* Re-render on width change and on theme change. */
    var lastW = plot.clientWidth;
    if ('ResizeObserver' in window) {
      var timer;
      new ResizeObserver(function () {
        if (Math.abs(plot.clientWidth - lastW) < 3) return;
        lastW = plot.clientWidth;
        clearTimeout(timer);
        timer = setTimeout(render, 120);
      }).observe(plot);
    }
    document.addEventListener('themechange', render);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', render);
  }

  function init() {
    if (!window.BRCA_DATA) {
      console.warn('charts.js: window.BRCA_DATA is missing — load data.js first.');
      return;
    }
    document.querySelectorAll('[data-chart]').forEach(mountFigure);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.BRCACharts = { renderers: RENDERERS, mount: mountFigure };
})();
