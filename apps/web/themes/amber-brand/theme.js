/*
 * amber-brand — progressive-enhancement motion. OPTIONAL: the page is fully
 * functional and animated with this file absent (see theme.css). Loaded by the
 * layout as a deferred module (docs/themes.md → "theme.js").
 *
 * Contract: enhance only. Never gate content, layout, or navigation on JS.
 * Honor reduced-motion. Bail when target nodes are absent (article sub-pages).
 *
 * Accepted progressive-enhancement limitations (the page is fully functional
 * without any of these): this deferred module runs once and is not re-invoked
 * on SvelteKit client-side navigation, so arriving at the homepage via an
 * in-app link from a sub-page yields the page without these delighters; and a
 * reduced-motion preference toggled while the page is open isn't re-evaluated.
 */
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(pointer: fine)');

// 1) Pointer-reactive gem glow — the hero halo leans gently toward the cursor.
function pointerGem() {
	if (reduce.matches || !finePointer.matches) return;
	const wrap = document.querySelector('.gem--hero-wrap');
	if (!wrap) return;
	let raf = 0;
	const onMove = (e) => {
		if (raf) return;
		raf = requestAnimationFrame(() => {
			raf = 0;
			const r = wrap.getBoundingClientRect();
			const dx = (e.clientX - (r.left + r.width / 2)) / Math.max(r.width, 1);
			const dy = (e.clientY - (r.top + r.height / 2)) / Math.max(r.height, 1);
			const x = Math.max(-1, Math.min(1, dx)) * 8; // max ~8px
			const y = Math.max(-1, Math.min(1, dy)) * 8;
			wrap.style.setProperty('--gem-glow-x', x.toFixed(1) + 'px');
			wrap.style.setProperty('--gem-glow-y', y.toFixed(1) + 'px');
		});
	};
	window.addEventListener('pointermove', onMove, { passive: true });
	// When the cursor leaves the page, ease the halo back to centre (the .25s
	// transform transition in theme.css does the easing) — a settled object,
	// not one frozen mid-lean.
	document.documentElement.addEventListener(
		'pointerleave',
		() => {
			wrap.style.setProperty('--gem-glow-x', '0px');
			wrap.style.setProperty('--gem-glow-y', '0px');
		},
		{ passive: true }
	);
}

// 2) Reveal fallback for browsers lacking animation-timeline: view().
//    Opt in via an <html> class so the hidden start-state only exists with JS.
function revealFallback() {
	if (CSS.supports('animation-timeline: view()')) return; // CSS handles it
	if (reduce.matches || !('IntersectionObserver' in window)) return; // stay visible
	const els = document.querySelectorAll('.reveal');
	if (!els.length) return;
	// Every .reveal lives in a section below the hero, i.e. below the fold at
	// cold load, so adding the hidden start-state here doesn't flash visible
	// content off-screen — the elements simply fade in as they're scrolled to.
	document.documentElement.classList.add('js-reveal');
	const io = new IntersectionObserver(
		(entries) => {
			for (const en of entries) {
				if (en.isIntersecting) {
					en.target.classList.add('is-in');
					io.unobserve(en.target);
				}
			}
		},
		{ rootMargin: '0px 0px -12% 0px', threshold: 0.08 }
	);
	els.forEach((el) => io.observe(el));
}

// 3) Light/dark preference toggle. Progressive enhancement: the button ships
//    `hidden` and the palette auto-follows the OS without this (color-scheme:
//    light dark in theme.css). A saved choice is already applied before paint
//    by the inline script in app.html; here we reveal the control, keep its
//    icon/label in sync, and persist the visitor's choice on click.
function themeToggle() {
	const btn = document.querySelector('.theme-toggle');
	if (!btn) return;
	const root = document.documentElement;
	const KEY = 'amber-theme';
	const mq = matchMedia('(prefers-color-scheme: dark)');
	const saved = () => {
		try {
			return localStorage.getItem(KEY);
		} catch {
			return null;
		}
	};
	// The mode actually showing right now: an explicit choice if there is one,
	// otherwise whatever the OS resolves to.
	const resolved = () => saved() || (mq.matches ? 'dark' : 'light');

	function paint(mode) {
		btn.dataset.resolved = mode; // CSS swaps the icon off this
		btn.setAttribute('aria-label', mode === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
		btn.setAttribute('aria-pressed', String(mode === 'dark'));
	}

	btn.hidden = false; // safe to show now that JS can drive it
	paint(resolved());

	btn.addEventListener('click', () => {
		const next = resolved() === 'dark' ? 'light' : 'dark';
		root.setAttribute('data-amber-theme', next);
		try {
			localStorage.setItem(KEY, next);
		} catch {
			/* private mode / storage off — the in-page switch still works for this visit */
		}
		paint(next);
	});

	// Visitors who never chose keep following the OS live (e.g. an auto
	// light↔dark schedule) — mirror that into the icon. A saved choice wins.
	mq.addEventListener('change', () => {
		if (!saved()) paint(mq.matches ? 'dark' : 'light');
	});
}

pointerGem();
revealFallback();
themeToggle();
