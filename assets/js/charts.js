/* ==========================================================================
   charts.js — dependency-free SVG chart renderers
   --------------------------------------------------------------------------
   Every figure in the site is a <figure class="figure" data-chart="NAME">.
   This file finds them, renders the matching chart into .figure__plot, and
   wires up the legend, the hover tooltip and the "Table" view toggle.

   Charts re-render on container resize and on theme change, so colours are
   always read live from the CSS custom properties in tokens.css — never
   hard-coded here.

   Adding a chart:  RENDERERS['my-chart'] = function (ctx) { ... }
   A renderer receives { width, height, data, svg, tip } and returns
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
     Diverging encoding: down-regulated (blue) · not significant (gray) ·
     up-regulated (red). Gray is the diverging midpoint, not a series colour.
     ---------------------------------------------------------------------- */
  RENDERERS.volcano = function (ctx) {
    var svg = ctx.svg, data = ctx.data.de, W = ctx.width, H = ctx.height;
    var M = { t: 14, r: 18, b: 46, l: 54 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    var LFC_CUT = 1, P_CUT = 0.05;
    var pts = data.rows.map(function (d) {
      var y = -Math.log10(Math.max(d.padj, 1e-50));
      var sig = d.padj < P_CUT && Math.abs(d.lfc) > LFC_CUT;
      return { gene: d.gene, lfc: d.lfc, padj: d.padj, y: y,
               dir: !sig ? 'ns' : (d.lfc > 0 ? 'up' : 'down') };
    });

    var xMax = Math.max(4, Math.ceil(Math.max.apply(null, pts.map(function (p) { return Math.abs(p.lfc); }))));
    var yMax = Math.ceil(Math.max.apply(null, pts.map(function (p) { return p.y; })) / 10) * 10;

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

    /* Direct labels on the six strongest hits (selective, never all). */
    var labelled = pts.filter(function (p) { return p.dir !== 'ns'; })
      .sort(function (a, b) { return (b.y * Math.abs(b.lfc)) - (a.y * Math.abs(a.lfc)); })
      .slice(0, 6);
    labelled.forEach(function (p) {
      var right = p.lfc > 0;
      svgEl('circle', {
        cx: p.cx, cy: p.cy, r: 4, fill: colors[p.dir],
        class: 'mark-ring'
      }, g);
      svgEl('text', {
        class: 'data-label',
        x: p.cx + (right ? -8 : 8),
        y: p.cy - 7,
        'text-anchor': right ? 'end' : 'start'
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
        tipRow(null, 'padj', sci(best.padj)),
        best.cx, best.cy
      );
    });
    hit.addEventListener('mouseleave', function () {
      ctx.tip.hide(); focus.setAttribute('opacity', 0);
    });

    var top = pts.filter(function (p) { return p.dir !== 'ns' && !/^GENE/.test(p.gene) && p.gene.indexOf('-') === -1; })
      .sort(function (a, b) { return a.padj - b.padj; }).slice(0, 18);

    return {
      legend: [
        { label: 'Down in Basal-like', color: colors.down, type: 'dot' },
        { label: 'Not significant', color: colors.ns, type: 'dot' },
        { label: 'Up in Basal-like', color: colors.up, type: 'dot' }
      ],
      table: {
        columns: ['Gene', 'log2 FC', 'Adjusted p', 'Direction'],
        align: ['', 'num', 'num', ''],
        rows: top.map(function (p) {
          return [p.gene, p.lfc.toFixed(2), sci(p.padj), p.dir === 'up' ? 'Up' : 'Down'];
        })
      }
    };
  };

  /* ---- Kaplan–Meier ------------------------------------------------------- */
  RENDERERS.survival = function (ctx) {
    var svg = ctx.svg, data = ctx.data.survival, W = ctx.width, H = ctx.height;
    var M = { t: 14, r: 48, b: 104, l: 54 };
    var iw = W - M.l - M.r, ih = H - M.t - M.b;

    var tMax = 120;
    var x = function (v) { return M.l + (v / tMax) * iw; };
    var y = function (v) { return M.t + ih - v * ih; };

    var g = svgEl('g', {}, svg);

    [0, 0.25, 0.5, 0.75, 1].forEach(function (t) {
      svgEl('line', { class: 'grid-line', x1: M.l, x2: M.l + iw, y1: y(t), y2: y(t) }, g);
      svgEl('text', { class: 'axis-label', x: M.l - 8, y: y(t) + 4, 'text-anchor': 'end' }, g)
        .textContent = (t * 100).toFixed(0) + '%';
    });

    var xTicks = [0, 24, 48, 72, 96, 120];
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

      /* Confidence band as a 10% wash (illustrative width for the prototype). */
      var band = '';
      var lo = [], hi = [];
      grp.points.forEach(function (p) {
        var se = 0.055 * Math.sqrt(Math.max(p.t, 1) / 60);
        lo.push([x(p.t), y(Math.max(0, p.s - se))]);
        hi.push([x(p.t), y(Math.min(1, p.s + se))]);
      });
      band = 'M' + hi.map(function (pt) { return pt[0] + ',' + pt[1]; }).join('L') +
             'L' + lo.reverse().map(function (pt) { return pt[0] + ',' + pt[1]; }).join('L') + 'Z';
      svgEl('path', { d: band, fill: grp.color, opacity: 0.10 }, g);

      svgEl('path', {
        d: d, fill: 'none', stroke: grp.color, 'stroke-width': 2,
        'stroke-linejoin': 'round', 'stroke-linecap': 'round'
      }, g);

      /* Censoring ticks */
      grp.points.forEach(function (p) {
        if (!p.censored) return;
        svgEl('line', {
          x1: x(p.t), x2: x(p.t), y1: y(p.s) - 4, y2: y(p.s) + 4,
          stroke: grp.color, 'stroke-width': 1.5
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
    stat.textContent = 'log-rank p = ' + data.pValue + '   ·   HR ' + data.hazardRatio +
      ' (95% CI ' + data.hrCI[0] + '–' + data.hrCI[1] + ')';

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
    var svg = ctx.svg, data = ctx.data.subtypes, W = ctx.width;
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
         (aqua, yellow, magenta) require on the light surface. */
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

  /* ---- Heatmap: marker expression by subtype ------------------------------ */
  RENDERERS.heatmap = function (ctx) {
    var svg = ctx.svg, data = ctx.data.heatmap, W = ctx.width;
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
        data: window.BRCA_DATA, tip: tip, local: local
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
