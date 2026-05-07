# apps/web

The SvelteKit + Bun app. Architectural rules live in the repo-root
`CLAUDE.md` — read that first.

## Test command

`bun --bun vitest`. Vitest must run under Bun so the `bun:sqlite` import in
`lib/space/cache.ts` resolves; running under Node will fail with an unknown
module error. The package script `test:unit` already wraps this:

```
bun run --cwd apps/web test:unit
```

`bun --bun vitest --run` for a single non-watch run (what CI would use).
