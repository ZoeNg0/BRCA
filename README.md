# Breast Cancer Transcriptomics — project website

Static prototype for a computational-biology project analysing breast cancer gene
expression (TCGA-BRCA and other public datasets). No build step, no dependencies,
no frameworks — plain HTML, CSS and JavaScript.

**Everything currently on the site is placeholder content.** The structure, styling
and figure machinery are real; the numbers are synthetic.

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
background.html     Biology background, subtypes, what TCGA is
data.html           Datasets, cohort composition, filtering, ethics
methods.html        Pipeline, step-by-step methods, software, reproducibility
results.html        The three main figures + findings
discussion.html     Interpretation, limitations, future work
about.html          About you, timeline, acknowledgements, references

assets/css/tokens.css   All colours, type scale, spacing. Change values HERE only.
assets/css/styles.css   Layout and components.
assets/js/data.js       PLACEHOLDER DATA — this is the file you replace.
assets/js/charts.js     SVG chart renderers (volcano, survival, bars, heatmap).
assets/js/main.js       Nav, theme toggle, scrollspy, reveal animations.
assets/data/placeholder.json   Schema reference for exporting real results.
```

## Swapping in real results

1. Export your analysis to the shape shown in `assets/data/placeholder.json`.
2. Replace the objects returned by `build()` in `assets/js/data.js`.
3. Delete the "Placeholder data" badges and the yellow prototype callouts from the HTML.
4. Reload. Figures re-render from the data; no chart code needs to change.

## Adding a new figure

In the HTML:

```html
<figure class="figure" data-chart="my-chart" data-height="380"
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
  // ctx = { svg, width, height, data, tip, local }
  // draw into ctx.svg, then:
  return {
    legend: [{ label: 'Series A', color: series(1), type: 'line' }],
    table:  { columns: ['X', 'Y'], align: ['', 'num'], rows: [['a', '1']] }
  };
};
```

Charts re-render automatically on resize and on theme change, and they read their
colours live from `tokens.css` — never hard-code a hex in a renderer.

## Design rules worth keeping

These are why the figures look consistent; breaking them will show.

- **Colours come from `tokens.css`.** Series colours are `--series-1` … `--series-8`,
  used in fixed order and never cycled. The set has been checked for
  colour-vision-deficiency separation and contrast in both light and dark modes.
- **Never a dual-axis chart.** Two measures on different scales get two charts.
- **Sequential = one hue light→dark** (`--seq-100` … `--seq-700`).
  **Diverging = blue ↔ grey ↔ red** (used by the volcano plot).
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

- [ ] Replace "Your Name", `you@example.com` and `your-handle` throughout
- [ ] Remove every yellow "to write / to decide / to add" callout
- [ ] Remove every "Placeholder data" badge and the prototype notices
- [ ] Fill in real references in `about.html#references`
- [ ] Check spelling of gene names and statistical terms
- [ ] Have someone who is not a biologist read the overview page

## Deploying

The site is static, so anything that serves files will host it. GitHub Pages is the
usual free choice: push the folder to a repository, then enable Pages on the
default branch in the repository settings.
