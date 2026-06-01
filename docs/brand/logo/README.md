# Amber — Logo Assets

The mark is a **faceted, glowing amber gemstone** (see `../brief.md`). Generated with
Gemini "Nano Banana", then cleaned and vectorized.

## Files

| File | Type | Use |
| --- | --- | --- |
| `source-nano-banana.png` | raster, 2816×1536 | Original AI render (had a *painted* gray checkerboard, not real transparency) |
| `amber-mark-master.png` | raster, square | Cleaned, keyed, transparent master — source of truth for raster |
| `amber-mark-1024.png` | raster 1024² | README / site header / decks |
| `amber-mark.svg` | **vector** | Faithful vector of the gem (VTracer color-trace, optimized ~625 KB). Scalable, matches the raster |
| `icon-512.png` / `icon-192.png` | raster | PWA / web-app manifest icons |
| `apple-touch-icon-180.png` | raster | iOS home-screen icon |
| `icon-48/32/16.png`, `favicon.ico` | raster | Browser favicons (multi-res .ico) |

## Raster + vector

- **Raster (`amber-mark-*.png`)** — derived from the Gemini render. The approved look.
  Lightest option; covers ~all real web/favicon use.
- **Vector (`amber-mark.svg`)** — a faithful color-trace of the raster, so it keeps the
  glow and gradients while scaling to any size. ~625 KB (many stacked gradient layers —
  that's the cost of reproducing a painterly image as vector).

### How the vector was made (to regenerate / tune)

Traced with **VTracer** (visioncortex), the best free/open-source *color* vectorizer —
it handles gradients, unlike potrace-based converters (FreeConvert, Adobe Express,
svgco.de) which posterize gradients into ugly bands. Run via the `@neplex/vectorizer`
node binding: `ColorMode.Color`, `Hierarchical.Stacked`, `Spline`, `colorPrecision: 8`,
`layerDifference: 8`, then `optimize()` (SVGO). Smaller file = raise `layerDifference`
and lower `colorPrecision` (fewer layers, less smooth). VTracer also has a free online
demo at the visioncortex site if you'd rather not run node.

## Palette anchor

Signature amber **#C6871F**, lit toward **#E6BA60**, shadowed toward **#5A3809**.
On amber fills use **dark ink #2A2622** for text, never white (contrast). See
`../palette.md`.
