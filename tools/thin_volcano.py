#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the volcano subset that assets/js/data.js plots.

WHY THIS EXISTS
  The full DESeq2 result is 39,393 tested genes — too many to ship as SVG.
  An earlier rule kept "the N most significant genes", which cut both wings
  horizontally at -log10(padj) ~= 65 and deleted their base: 8,413 of the
  10,184 significant genes sit below 50, and only 4 survived. The plot showed
  wings floating above the cloud with an empty band between them.

THE RULE HERE
  Bin the plane (x = log2 fold change, y = -log10 padj). Keep every gene in a
  sparse bin — that is the outline, the extremes, and the isolated genes that
  give the cloud its silhouette. Thin only the interior of dense bins, to
  ceil(sqrt(n)) genes chosen at even spacing through the bin sorted by padj.
  Deterministic: no RNG, no seed, identical on every run.

  Result: dense regions lose points (where no shape is lost), sparse regions
  lose none (where all the shape is), and the wings stay continuous with the
  cloud instead of starting at a cliff.

USAGE
  python3 tools/thin_volcano.py            # prints a fidelity report
  python3 tools/thin_volcano.py --emit-js  # prints the rows[] block for data.js
"""
import csv, math, json, sys
from collections import Counter

SRC   = '/Users/zoe_ng/Documents/Cancerproj/exports/tcga_volcano_full.csv'
FLOOR = 2.2250738585072e-308          # smallest normal double; padj is never 0
NX, NY, KEEP_ALL, POW = 140, 90, 3, 0.5

# Genes the page names in prose or relies on; never thinned away.
REQUIRED = ['PPP4C', 'PPP4R1', 'PPP4R2', 'PPP4R3A', 'PPP4R3B', 'PPP4R4',
            'ESR1', 'PGR', 'ERBB2', 'MKI67', 'TP53', 'GATA3', 'FOXA1']


def load():
    rows = []
    for r in csv.DictReader(open(SRC)):
        if r['padj'] in ('NA', '', 'NaN'):
            continue                   # DESeq2 independent filtering: not tested
        padj = float(r['padj']) or FLOOR
        rows.append({'gene': r['gene'], 'lfc': float(r['lfc']),
                     'padj': padj, 'y': -math.log10(padj)})
    return rows


def thin(rows):
    xs = [r['lfc'] for r in rows]
    x0, x1 = min(xs), max(xs)
    y1 = max(r['y'] for r in rows)
    bins = {}
    for r in rows:
        bx = min(NX - 1, int((r['lfc'] - x0) / (x1 - x0) * NX))
        by = min(NY - 1, int(r['y'] / y1 * NY))
        bins.setdefault((bx, by), []).append(r)

    kept = []
    for members in bins.values():
        n = len(members)
        if n <= KEEP_ALL:
            kept.extend(members)
            continue
        members.sort(key=lambda r: r['padj'])
        k = max(KEEP_ALL, math.ceil(n ** POW))
        idx = {round(i * (n - 1) / (k - 1)) for i in range(k)}
        kept.extend(members[i] for i in sorted(idx))

    have = {r['gene'] for r in kept}
    kept.extend(r for r in rows if r['gene'] in REQUIRED and r['gene'] not in have)
    kept.sort(key=lambda r: r['padj'])
    return kept


def is_sig(r):
    return r['padj'] < 0.05 and abs(r['lfc']) > 1


def report(rows, kept):
    band = lambda v: min(int(v // 50) * 50, 300)
    sig_all, sig_kept = [r for r in rows if is_sig(r)], [r for r in kept if is_sig(r)]
    full, plot = Counter(band(r['y']) for r in sig_all), Counter(band(r['y']) for r in sig_kept)
    print(f"source            {SRC}")
    print(f"tested genes      {len(rows)}")
    print(f"significant       {len(sig_all)}   (padj < 0.05 and |lfc| > 1)")
    print(f"grid              {NX} x {NY}, keep all if bin <= {KEEP_ALL}, else ceil(n^{POW})")
    print(f"rows kept         {len(kept)}\n")
    print(f"  {'band':>10} {'true':>7} {'plotted':>8} {'kept':>7}")
    for b in sorted(full):
        t, p = full[b], plot.get(b, 0)
        print(f"  {str(b) + '-' + str(b + 50):>10} {t:>7} {p:>8} {100 * p / t:>6.1f}%")
    print(f"  {'all sig':>10} {len(sig_all):>7} {len(sig_kept):>8} "
          f"{100 * len(sig_kept) / len(sig_all):>6.1f}%")
    ns = [r for r in rows if not is_sig(r)]
    nsk = [r for r in kept if not is_sig(r)]
    print(f"  {'non-sig':>10} {len(ns):>7} {len(nsk):>8} {100 * len(nsk) / len(ns):>6.1f}%")
    for name, pick in (('widest down', min), ('widest up', max)):
        g = pick(rows, key=lambda r: r['lfc'])
        print(f"  {name:>11}: {g['gene']} ({g['lfc']:+.2f}) "
              f"{'KEPT' if any(k['gene'] == g['gene'] for k in kept) else 'LOST'}")


def emit_js(kept):
    cells = ['[%s,%r,%r]' % (json.dumps(r['gene']), round(r['lfc'], 3), r['padj'])
             for r in kept]
    line, out = '', []
    for c in cells:
        add = c if not line else ', ' + c
        if line and len(line) + len(add) + 6 > 108:
            out.append('      ' + line + ','); line = c
        else:
            line += add
    if line:
        out.append('      ' + line)
    print('\n'.join(out))


if __name__ == '__main__':
    rows = load()
    kept = thin(rows)
    if '--emit-js' in sys.argv:
        emit_js(kept)
    else:
        report(rows, kept)
