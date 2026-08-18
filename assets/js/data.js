/* ==========================================================================
   data.js — PLACEHOLDER data for the prototype
   --------------------------------------------------------------------------
   Everything here is synthetic and deterministic (seeded PRNG), so the
   figures look identical on every reload and nothing can be mistaken for a
   real result. Numbers are shaped like TCGA-BRCA output but are NOT real.

   SWAPPING IN REAL RESULTS
     1. Export your analysis to JSON with the same shape (see
        assets/data/placeholder.json for the schema).
     2. Serve the site over http (python3 -m http.server) and replace
        `window.BRCA_DATA = build();` at the bottom with:
            window.BRCA_DATA = await (await fetch('assets/data/results.json')).json();
        ...or simply paste the exported object in place of build().
     3. Delete the "Placeholder data" badges from the HTML.
   ========================================================================== */

(function () {
  'use strict';

  /* Deterministic PRNG (mulberry32) — same numbers every load. */
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* Box–Muller normal from a uniform generator. */
  function normal(rand) {
    var u = 1 - rand(), v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  var GENE_POOL = [
    'ESR1', 'PGR', 'ERBB2', 'MKI67', 'TP53', 'PIK3CA', 'GATA3', 'FOXA1',
    'CDH1', 'MYC', 'CCND1', 'EGFR', 'KRT5', 'KRT14', 'BRCA1', 'BRCA2',
    'AURKA', 'BIRC5', 'CDC20', 'UBE2C', 'MELK', 'RRM2', 'TYMS', 'EXO1',
    'BCL2', 'SCUBE2', 'NAT1', 'SLC39A6', 'MAPT', 'TFF1', 'AR', 'VIM',
    'CDKN2A', 'RB1', 'PTEN', 'AKT1', 'NOTCH1', 'JAK2', 'STAT3', 'CD8A',
    'PDCD1', 'CD274', 'CTLA4', 'FOXP3', 'IL6', 'TNF', 'MMP9', 'SPARC',
    'COL1A1', 'FN1', 'TGFB1', 'SNAI2', 'ZEB1', 'TWIST1', 'CDH2', 'EPCAM'
  ];

  /* ---- 1. Differential expression (volcano) ------------------------------
     Basal-like vs Luminal A. Each row: gene, log2 fold change, adjusted p.  */
  function buildDE() {
    var rand = rng(20250817);
    var rows = [];

    /* Background: the great majority of genes are unchanged. */
    for (var i = 0; i < 1400; i++) {
      var lfc = normal(rand) * 0.55;
      var p = Math.pow(10, -Math.abs(normal(rand)) * 0.9);
      rows.push({ gene: 'GENE' + (i + 1), lfc: lfc, padj: Math.min(1, p) });
    }

    /* A named, clearly-separated signal set so the plot reads like a result. */
    var signal = [
      { gene: 'ESR1',   lfc: -3.9, padj: 2.1e-42 },
      { gene: 'PGR',    lfc: -3.2, padj: 5.4e-31 },
      { gene: 'FOXA1',  lfc: -2.8, padj: 1.7e-28 },
      { gene: 'GATA3',  lfc: -2.5, padj: 9.3e-26 },
      { gene: 'TFF1',   lfc: -3.4, padj: 4.8e-22 },
      { gene: 'SCUBE2', lfc: -2.1, padj: 3.6e-17 },
      { gene: 'MAPT',   lfc: -1.9, padj: 8.2e-15 },
      { gene: 'BCL2',   lfc: -1.4, padj: 6.1e-11 },
      { gene: 'KRT5',   lfc:  3.6, padj: 7.2e-38 },
      { gene: 'KRT14',  lfc:  3.3, padj: 1.9e-33 },
      { gene: 'UBE2C',  lfc:  2.7, padj: 2.4e-30 },
      { gene: 'MELK',   lfc:  2.4, padj: 6.8e-27 },
      { gene: 'BIRC5',  lfc:  2.2, padj: 1.1e-24 },
      { gene: 'MKI67',  lfc:  2.0, padj: 4.5e-21 },
      { gene: 'EXO1',   lfc:  1.8, padj: 3.3e-16 },
      { gene: 'RRM2',   lfc:  1.7, padj: 9.9e-14 },
      { gene: 'CDKN2A', lfc:  1.5, padj: 2.7e-10 },
      { gene: 'EGFR',   lfc:  1.3, padj: 4.1e-8  }
    ];

    /* Scatter of moderately significant hits around the named ones. */
    for (var j = 0; j < 220; j++) {
      var dir = rand() > 0.48 ? 1 : -1;
      var mag = 0.9 + Math.abs(normal(rand)) * 0.9;
      var pv = Math.pow(10, -(2 + Math.abs(normal(rand)) * 5));
      rows.push({ gene: GENE_POOL[j % GENE_POOL.length] + '-' + j, lfc: dir * mag, padj: pv });
    }

    return { comparison: 'Basal-like vs Luminal A', rows: rows.concat(signal) };
  }

  /* ---- 2. Kaplan–Meier survival ------------------------------------------
     Two groups split at the median expression of a candidate gene.          */
  function buildSurvival() {
    function curve(seed, hazard, n) {
      var rand = rng(seed);
      var pts = [{ t: 0, s: 1, atRisk: n, censored: false }];
      var s = 1, atRisk = n;
      for (var t = 3; t <= 120; t += 3) {
        var events = Math.max(0, Math.round(atRisk * hazard * (0.6 + rand() * 0.8)));
        var censor = Math.max(0, Math.round(atRisk * 0.012 * (0.5 + rand())));
        if (atRisk <= 0) break;
        s = s * (1 - events / Math.max(atRisk, 1));
        atRisk = Math.max(0, atRisk - events - censor);
        pts.push({ t: t, s: Math.max(0, s), atRisk: atRisk, censored: censor > 0 });
      }
      return pts;
    }
    return {
      gene: 'GENE-X',
      pValue: 0.0031,
      hazardRatio: 1.62,
      hrCI: [1.18, 2.23],
      groups: [
        { name: 'Low expression',  n: 528, slot: 1, points: curve(11, 0.011, 528) },
        { name: 'High expression', n: 527, slot: 2, points: curve(29, 0.019, 527) }
      ]
    };
  }

  /* ---- 3. PAM50 subtype composition (bar) -------------------------------- */
  function buildSubtypes() {
    return {
      total: 1082,
      items: [
        { label: 'Luminal A',   value: 562, slot: 1 },
        { label: 'Luminal B',   value: 209, slot: 2 },
        { label: 'Basal-like',  value: 190, slot: 3 },
        { label: 'HER2-enrich', value:  82, slot: 4 },
        { label: 'Normal-like', value:  39, slot: 5 }
      ]
    };
  }

  /* ---- 4. Marker-gene expression by subtype (heatmap) --------------------
     Values are row-scaled mean log2(TPM+1), 0–1 after min–max scaling.      */
  function buildHeatmap() {
    var genes = ['ESR1', 'PGR', 'ERBB2', 'MKI67', 'KRT5', 'FOXA1', 'EGFR', 'AURKA'];
    var cols = ['Luminal A', 'Luminal B', 'Basal-like', 'HER2-enrich', 'Normal-like'];
    var seeded = {
      ESR1:   [0.95, 0.82, 0.08, 0.34, 0.71],
      PGR:    [0.88, 0.61, 0.05, 0.19, 0.63],
      ERBB2:  [0.24, 0.47, 0.21, 0.97, 0.28],
      MKI67:  [0.18, 0.72, 0.94, 0.76, 0.22],
      KRT5:   [0.11, 0.16, 0.91, 0.24, 0.45],
      FOXA1:  [0.92, 0.86, 0.12, 0.68, 0.74],
      EGFR:   [0.21, 0.29, 0.83, 0.35, 0.41],
      AURKA:  [0.15, 0.69, 0.90, 0.71, 0.19]
    };
    var cells = [];
    genes.forEach(function (g, r) {
      cols.forEach(function (c, k) {
        cells.push({ row: g, col: c, r: r, c: k, value: seeded[g][k] });
      });
    });
    return { rows: genes, cols: cols, cells: cells, unit: 'row-scaled mean expression' };
  }

  /* ---- Headline numbers for the stat tiles -------------------------------- */
  function buildSummary() {
    return {
      samples:      { label: 'TCGA-BRCA samples analysed', value: '1,082', note: 'primary tumours, RNA-seq' },
      genes:        { label: 'Genes passing expression filter', value: '18,341', note: 'of 60,660 annotated' },
      deGenes:      { label: 'Differentially expressed genes', value: '2,417', note: 'padj < 0.05, |log2FC| > 1' },
      candidates:   { label: 'Candidate prognostic genes', value: '12', note: 'survival-associated, FDR < 0.10' }
    };
  }

  function build() {
    return {
      placeholder: true,
      generated: 'synthetic — replace before submission',
      summary:  buildSummary(),
      de:       buildDE(),
      survival: buildSurvival(),
      subtypes: buildSubtypes(),
      heatmap:  buildHeatmap()
    };
  }

  window.BRCA_DATA = build();
})();
