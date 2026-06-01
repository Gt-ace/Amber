# Amber — Color Palette

Derived from the brand brief: *calm & sovereign, worn warmly; non-technical first.*
Anchored on warm amber/honey/gold against warm neutrals. This formalizes the palette
already shipping in the `amber-default` theme into a full brand system.

Open `palette.html` in a browser to see the swatches.

---

## 1. Signature Amber (the hero)

The brand color. A confident honey-amber — warm and premium without being neon.
Use **amber-500** as the primary brand fill (logo, primary buttons). The deeper
steps (700/800) are for text and links on light backgrounds (they meet WCAG AA).
The brighter steps (300/400) are for accents on dark backgrounds.

| Step | Hex | Use |
| --- | --- | --- |
| amber-50  | `#FBF4E4` | Palest wash — hover fills, subtle tint backgrounds |
| amber-100 | `#F6E6C4` | Light fill, badges |
| amber-200 | `#EFD191` | Soft fill |
| amber-300 | `#E6BA60` | Bright accent |
| amber-400 | `#D9A441` | **Dark-mode link/accent** (matches theme's dark accent) |
| amber-500 | `#C6871F` | **★ PRIMARY brand color** — logo fill, primary buttons |
| amber-600 | `#A66E14` | Pressed / deeper fill |
| amber-700 | `#9A6314` | **Light-mode link/accent** (AA on paper; matches theme) |
| amber-800 | `#7C4E0F` | Link hover on light (matches theme) |
| amber-900 | `#5A3809` | Deepest amber — emphasis text |

> **Contrast caveat:** white text on amber-500 fails AA (~2:1). On amber fills,
> use the **dark ink** (`#2A2622`) for labels, not white. amber-700/800 are the
> steps to use for amber *text/links* on a light page.

---

## 2. Warm Neutrals (the calm)

The "paper and ink" system. Warm off-white and a warm near-black — never pure
`#fff` / `#000`, which read cold and clinical. These are exactly the theme's
existing neutral tokens, so the brand and the product already agree.

### Light
| Name | Hex | Use |
| --- | --- | --- |
| paper      | `#FAF7F0` | Page background |
| sunken     | `#EFE8D6` | Recessed fill — code, inset cards |
| rule       | `#E4DCC9` | Hairlines, borders, dividers |
| ink-muted  | `#655D4F` | Secondary text — dates, captions, chrome |
| ink        | `#2A2622` | Primary text |

### Dark
| Name | Hex | Use |
| --- | --- | --- |
| paper      | `#1A1714` | Page background (soft charcoal, not black) |
| sunken     | `#232019` | Recessed fill |
| rule       | `#332E27` | Hairlines, borders |
| ink-muted  | `#9A8F7D` | Secondary text |
| ink        | `#E8E0D2` | Primary text |

---

## 3. Supporting Pine (optional secondary)

A deep, muted teal-pine for the rare moment amber needs a counterweight —
illustration, a marketing accent, a secondary tag. *Calm and sovereign*, never
loud. Use sparingly (≤10% of any composition); amber always leads.

| Name | Hex | Use |
| --- | --- | --- |
| pine-300 | `#6E9189` | Light accent / on-dark detail |
| pine-500 | `#2E5A50` | Secondary accent |
| pine-700 | `#244A42` | Deep detail |

---

## 4. Semantic (authoring / admin UI states)

Not core brand — these are for the v0.5 admin UI's feedback states (save success,
validation errors, etc.). Tuned warm so they sit beside amber without clashing.
Note: warning is a distinct clay-orange, deliberately *not* amber, so alerts never
get confused with the brand color.

| State | Hex | Notes |
| --- | --- | --- |
| success | `#3F7A52` | Muted forest green |
| warning | `#C2611C` | Clay-orange — distinct from brand amber |
| error   | `#B23B2E` | Warm brick red |
| info    | `#3C6E8F` | Calm slate blue |

---

## 5. Paste-ready theme tokens

These map the palette onto the 8 `--amber-*` color tokens that are the theme
dark-mode contract (see `docs/themes.md`). **No change from what `amber-default`
ships** — confirming the theme is already on-brand. Drop into any new theme's
`theme.css`.

```css
:root {
	--amber-bg:             #faf7f0;  /* paper        */
	--amber-ink:            #2a2622;  /* ink          */
	--amber-ink-muted:      #655d4f;  /* ink-muted    */
	--amber-accent:         #9a6314;  /* amber-700    */
	--amber-accent-hover:   #7c4e0f;  /* amber-800    */
	--amber-rule:           #e4dcc9;  /* rule         */
	--amber-surface-sunken: #efe8d6;  /* sunken       */
	--amber-selection-bg:   rgba(154, 99, 20, 0.18);
}

@media (prefers-color-scheme: dark) {
	:root {
		--amber-bg:             #1a1714;  /* paper (dark)   */
		--amber-ink:            #e8e0d2;  /* ink (dark)     */
		--amber-ink-muted:      #9a8f7d;  /* ink-muted      */
		--amber-accent:         #d9a441;  /* amber-400      */
		--amber-accent-hover:   #ecbb5e;  /* amber-300/400+ */
		--amber-rule:           #332e27;  /* rule (dark)    */
		--amber-surface-sunken: #232019;  /* sunken (dark)  */
		--amber-selection-bg:   rgba(217, 164, 65, 0.22);
	}
}
```

---

## How to explore / validate (free + Google tools)

- **Huemint** (free, huemint.com) — paste amber-500 `#C6871F` as a locked color
  and let it generate brand/website schemes around it to explore alternatives.
- **Coolors** (free, coolors.co) — fast lock-and-regenerate; good for nudging the
  ramp steps until the transitions feel even.
- **Contrast checker** — verify every text/background pair hits WCAG AA:
  WebAIM Contrast Checker (free) or the contrast readout in Chrome/Edge DevTools.
- **Gemini** (your Google AI Pro) — good second opinion: "does this palette read
  as calm, warm, premium? what's the weakest pairing?"
