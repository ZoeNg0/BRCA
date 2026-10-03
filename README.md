# PPP4C in Breast Cancer — project website

Static prototype for a computational-biology project asking whether **PPP4C**
(protein phosphatase 4 catalytic subunit) is elevated in breast tumours, differs
between the molecular subtypes, and tracks with survival — using TCGA-BRCA and
other public datasets. No build step, no dependencies, no frameworks — plain
HTML, CSS and JavaScript.

**All six figures on the Results page are real exports.** The Discussion page carries four
more figures reproduced from two published papers; those are other people's data and are
labelled as such on every one.

## Running it

Just open `index.html` in a browser. Nothing needs to be installed.

If you later switch to loading results with `fetch()`, browsers block that on
`file://`, so serve the folder instead:

```sh
cd /Users/zoe_ng/Documents/Cancerproj_website
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Layout

```
index.html          Overview — hero, headline numbers, research question, roadmap
background.html     Biology background, subtypes, PPP4C and the PP4 complex, what TCGA is
data.html           The five cohorts, TCGA in detail, which n to quote, filtering
methods.html        Pipeline, step-by-step methods, software, reproducibility
results.html        The six PPP4C figures + findings
discussion.html     Interpretation, the two cited papers, limitations, future work, references
code.html           Read-only viewer for the R acquisition notebook
about.html          About you, timeline, acknowledgements (student profile only)

assets/css/tokens.css   All colours, type scale, spacing. Change values HERE only.
assets/css/styles.css   Layout and components.
assets/js/data.js       Real exported results, one block per figure.
assets/js/charts.js     SVG chart renderers (box, forest, scatter, corrbar,
                        volcano, survival, bars, heatmap, enrichment).
assets/js/codeviewer.js Read-only R syntax highlighter for code.html.
assets/js/main.js       Nav, theme toggle, scrollspy, reveal animations.
```

## The six figures and where their numbers come from

Every figure on `results.html` is wired to a named data block. Replace one block
in `assets/js/data.js` and that figure redraws itself — no chart code changes.
Every one of them is a real export; each figure's note names the script that
produced it.

| # | Figure | Chart type | Data block |
|---|--------|-----------|------------|
| 1 | PPP4C tumour vs normal, five cohorts | `boxpanels` | `ppp4.cohortBoxes` |
| 2 | PPP4C in 113 matched tumour/normal pairs | `paired` | `ppp4.paired` |
| 3 | Tumour vs normal across the transcriptome | `volcano` | `tcgaVolcano` |
| 4 | PPP4C across the five PAM50 subtypes | `box` | `ppp4.bySubtype` |
| 5 | Five-year overall survival by PPP4C | `survival` | `ppp4.survival` |
| 6 | Hub gene enrichment, proliferation vs EMT | `enrichment` | `hubEnrichment` |
| — | PAM50 composition | `subtypes` | `subtypes` — block kept, no figure uses it since the Data page dropped its bar chart |

Every block in `assets/js/data.js` is a real export. The synthetic placeholder
blocks, and the seeded PRNG that produced them, were deleted once the first
real figures landed — **do not reintroduce generated data.** An empty figure
slot is honest; a plausible fake one is not.

### Four different denominators, all correct

The figures do not share one n, and the page says so rather than smoothing it
over. Do not "fix" this by forcing them to agree:

| n | what it is | where |
|---|---|---|
| 1,111 | primary tumour aliquots, no de-duplication | Figure 1 (TCGA panel), Figure 3 |
| 1,095 | patients, after 16 duplicate aliquots collapse | Figure 6 (the co-expression network) |
| 1,083 | patients with a PAM50 call (12 unclassified dropped) | Figure 4, Data page |
| 1,071 | patients with usable survival follow-up | Figure 5 |
| 113 | patients with a matched tumour/normal pair | Figure 2 |

### Two hazard ratios

Figure 5 shows the univariate HR (1.60, CI 1.07–2.39) because that is what the
drawn curve depicts, and the callout carries the adjusted HR (1.53, CI
1.00–2.35, p = 0.0501, n = 1,022) because that is the number that decides
whether the signal is independent. Both are in the data block. Showing only
one of them would misrepresent the result in opposite directions.

The `forest`, `heatmap`, `scatter` and `corrbar` renderers are still in
`charts.js` and still work; no figure currently uses them.

The `survival` renderer reads `maxTime` from the data — a curve censored at 5
years must not be drawn on a 10-year axis — and draws its confidence band only
from real `lo`/`hi` bounds on each point. An earlier version synthesised the
band from an invented standard error; if `lo`/`hi` are missing, no band is
drawn at all.

Two chart types are specific to the real figures:

- **`boxpanels`** draws small multiples — one panel per cohort, each with its own
  y-axis in its own units, because the cohorts are not on a common scale.
  `data-height` is the height of *one row*; the renderer picks the column count
  from the available width and grows the SVG for however many rows it needs.
- **`paired`** draws a slope graph — one line per patient joining their own
  normal sample to their own tumour, coloured by direction.

**`enrichment`** draws horizontal log-scale bars around a reference at 1×, grouped
by theme. It exists to keep three properties of the underlying result, and changing
any of them would misreport it:

- every tested set is drawn — non-significant ones faded, never filtered out,
  because the finding is partly that motility is *absent* from the hub genes;
- a set with no hub genes carries no `fold` and gets **no bar**, since a clamped
  value would draw a long leftward bar that reads as strong depletion;
- `fold` below 1 runs leftward as the depletion it is, never clamped to 1.

## Updating a figure

1. Export the new values in the shape the renderer reads — the header comment above
   each block in `assets/js/data.js` documents it field by field.
2. Replace that block's return value.
3. Reload. The figure re-renders from the data; no chart code needs to change.

The target gene is defined once, as `TARGET` at the top of `assets/js/data.js`.
Change it there rather than editing gene names figure by figure.

Figure captions on the site name cohorts, sample counts and tests — never internal
filenames or script names. That is deliberate: a reader wants the provenance of the
data, not the layout of the analysis repository.

## Adding a new figure

`data-source` names which block of `BRCA_DATA` the figure reads, and arrives in
the renderer as `ctx.source`. That is how one renderer (`box`) serves both
Figure 1 and Figure 2. Omit it and the renderer falls back to its own default block.

In the HTML:

```html
<figure class="figure" data-chart="my-chart" data-source="ppp4.cox" data-height="380"
        data-alt="One sentence describing what the chart shows and its main pattern.">
  <div class="figure__head">
    <div class="figure__titles">
      <h3 class="figure__title">Figure N — Title</h3>
      <p class="figure__subtitle">What the reader is looking at.</p>
    </div>
    <div class="figure__tools">
      <button class="btn btn--ghost btn--sm" type="button" data-table-toggle aria-expanded="false">Table</button>
    </div>
  </div>
  <ul class="legend"></ul>
  <div class="figure__plot"></div>
  <div class="figure__table" hidden></div>
  <p class="figure__note">Caption and caveats.</p>
</figure>
```

In `assets/js/charts.js`:

```js
RENDERERS['my-chart'] = function (ctx) {
  // ctx = { svg, width, height, data, source, tip, local }
  // draw into ctx.svg, then:
  return {
    legend: [{ label: 'Series A', color: series(1), type: 'line' }],
    table:  { columns: ['X', 'Y'], align: ['', 'num'], rows: [['a', '1']] }
  };
};
```

Charts re-render automatically on resize and on theme change, and they read their
colours live from `tokens.css` — never hard-code a hex in a renderer.

## The code viewer

`code.html` shows the R acquisition notebook in a read-only pane. It is progressive
enhancement: the page ships the real source inside `<pre>`, so the code is readable,
selectable and Ctrl-F-able with JavaScript off, and `assets/js/codeviewer.js` re-renders
that same text as numbered, coloured lines. Two properties are worth preserving if you
touch it:

- **Nothing is editable.** There is no `contenteditable`, no textarea, and the script
  never writes back into what it highlights.
- **The tokenizer covers every character**, so the rendered text is byte-identical to the
  source. If you extend the R grammar, keep that property — a highlighter that silently
  drops a character is worse than no highlighter.

Syntax colours are `--code-*` tokens in `tokens.css`, defined in all three theme blocks
like every other colour, so the pane follows the light/dark toggle.

## One structural rule the sidebar depends on

Every `#id` the on-this-page list links to must be a **sibling** section, never a wrapper
around the others. `results.html` originally had one `<div id="expression">` containing all
the later sections, which meant the first entry was the only one the scrollspy could ever
report — it was in view for the whole page.

The scrollspy (`assets/js/main.js`) takes the last heading that has passed the reading line,
and pins the final entry once the page bottom is reached, because a short last section can
never reach that line on its own.

## Design rules worth keeping

These are why the figures look consistent; breaking them will show.

- **Colours come from `tokens.css`.** Series colours are `--series-1` … `--series-8`,
  used in fixed order and never cycled. The set has been checked for
  colour-vision-deficiency separation and contrast in both light and dark modes.
- **Never a dual-axis chart.** Two measures on different scales get two charts.
- **Sequential = one hue light→dark** (`--seq-100` … `--seq-700`).
  **Diverging = green ↔ stone ↔ rose** (used by the volcano plot and the
  correlation bars).
- **Every chart with two or more series has a legend**, and every chart has a
  table view, so meaning is never carried by colour alone.
- **Label selectively** — the extreme points, the endpoints, not every value.
- **Text never wears the series colour**; a coloured mark sits beside it instead.
- Charts use the UI sans (`--font-chart`), never the display serif.

## Accessibility checklist before you submit

- [ ] Every `<figure>` has a meaningful `data-alt` describing the pattern, not just the type
- [ ] Table view works for every figure
- [ ] Site is usable at 320px wide and at 200% browser zoom
- [ ] Tab order reaches every link and button, with a visible focus ring
- [ ] Dark mode checked, not just light
- [ ] Test with `prefers-reduced-motion` enabled

## Before you submit it with an application

Two placeholders are left, because only you can fill them:

- [ ] Replace "Your Name", `you@example.com` and `your-handle` throughout — the name
      appears in the hero, the `<meta name="author">` of every page and the footer
- [ ] Write the opening paragraph of "Who made this" on `about.html`, and add anyone who
      helped to the acknowledgements — these are the two remaining yellow callouts

Then:

- [ ] Check spelling of gene names and statistical terms (PPP4C, not PP4C or PPP4)
- [ ] Have someone who is not a biologist read the overview page

## Deploying to GitHub Pages

The repo is already Pages-ready: `.nojekyll` stops GitHub running the files through
Jekyll, `404.html` is served for unknown paths, and every link is relative so the
site works from the `/BRCA/` subpath Pages uses (verified locally).

1. Push: `git push -u origin main`
   Git asks for a password: paste your personal access token, not your GitHub
   password (GitHub stopped accepting passwords over https). The username is
   already in the remote URL, and the macOS keychain stores the token after the
   first push, so this is a one-time step.
2. On github.com/ZoeNg0/BRCA go to **Settings -> Pages**
3. Under **Build and deployment**, set Source to **Deploy from a branch**,
   branch **main**, folder **/ (root)**, and Save
4. Wait a minute or two, then open <https://zoeng0.github.io/BRCA/>

Every later `git push` republishes automatically. If you rename the repository or
add a custom domain, update the `href="/BRCA/"` link in `404.html`.

### If the token expires or stops working

Fine-grained tokens expire on the date you set. When yours does, generate a new
one (Settings -> Developer settings -> Personal access tokens -> Fine-grained,
scoped to `ZoeNg0/BRCA` with **Contents: Read and write**), then clear the old
one from the keychain so git asks again:

```sh
printf "protocol=https\nhost=github.com\n\n" | git credential-osxkeychain erase
```

Never commit a token to the repository. If one is ever exposed, revoke it on that
same settings page immediately and issue a new one.

## Figures 1–3 — real data

Figures 1, 2 and 3 draw real results. They come from the analysis repo, not
from this one:

| | |
|---|---|
| Script | `Cancerproj/scripts/14_export_figure_data.R` (`Rscript` to regenerate) |
| Provenance | `Cancerproj/exports/figure_data_provenance.md` |
| Figure 1 | `exports/cohort_boxes.json` |
| Figure 2 | `exports/tcga_paired.json` · values in `tcga_paired_values.csv` |
| Figure 3 | `exports/tcga_volcano.json` · unthinned in `tcga_volcano_full.csv` |

The values are pasted into `cohortBoxes()`, `tcgaPaired()` and `tcgaVolcano()`
in `assets/js/data.js` rather than fetched, so the site still works from
`file://`. To re-import after a re-run, replace those functions' contents.

Three things about this data that the page states and the code should not
quietly lose:

1. **The five cohorts share no scale.** Four platforms, four normalisations.
   Each panel has its own axis and names its own unit; box heights are not
   comparable between panels, and nothing is transformed to make them look
   comparable.
2. **The tests differ by cohort**, because each is the test that cohort's
   differential expression actually ran — DESeq2 for TCGA, limma for the
   arrays, and a *paired* limma fit for GSE70947. The fold-changes are the
   values already published in `DE_<cohort>.csv`.
3. **Figure 3 is a deliberate subset**: 5,785 of 39,393 tested genes, built by
   `tools/thin_volcano.py` from `exports/tcga_volcano_full.csv`. It bins the
   plane and thins only the interior of dense bins, keeping every gene in a
   sparse one, so the outline and the extremes survive and the wings stay
   continuous with the cloud. `nSignificant` / `nTested` carry the true totals
   and the figure prints both.

   Regenerate with `python3 tools/thin_volcano.py --emit-js` and paste the
   result over the `rows` array in `tcgaVolcano()`. Run it with no arguments
   for a fidelity report — significant genes per −log₁₀(padj) band, true vs
   plotted. **Do not replace this with a "keep the top N by padj" rule:** that
   cuts both wings horizontally at −log₁₀(padj) ≈ 65 and deletes their base,
   because 8,413 of the 10,184 significant genes sit below 50.

Underflowed p-values are floored at the smallest representable double by the
export, and the charts print those as `< 10⁻³⁰⁸` rather than as a point
estimate (`sciP` / `pText` in `charts.js`).

One inconsistency is preserved rather than papered over: Figure 2 uses a paired
test, while the TCGA DE behind Figures 1 and 3 was run unpaired on the same
samples. The page says so.
