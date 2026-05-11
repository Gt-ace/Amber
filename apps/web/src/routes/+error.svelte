<script lang="ts">
	import { page } from '$app/state';
	import { renderTemplate } from '$lib/render/template';

	// `+layout.svelte` wraps this in the theme chrome (chromeBefore / children /
	// chromeAfter); here we render only what goes inside <main>: the active
	// theme's error.html, fed `page.status` / `page.error` (which exist only in
	// the error component) and the optional `/404.md` HTML from the layout load.
	const html = $derived(
		renderTemplate(page.data.errorTemplate ?? '', {
			is_404: page.status === 404,
			has_body: Boolean(page.data.notFoundHtml),
			body: page.data.notFoundHtml ?? '',
			status: page.status,
			message: page.error?.message ?? 'Something went wrong.'
		})
	);
</script>

<svelte:head>
	<title>{page.status} — {page.error?.message ?? 'Error'}</title>
</svelte:head>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html html}
