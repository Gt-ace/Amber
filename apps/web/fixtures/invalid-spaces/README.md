# invalid-spaces

Fixtures that exercise `LoadError` paths. Each subdirectory triggers exactly
one error class:

- `missing-manifest/` — no `amber.toml`. `load()` throws on the missing file.
- `unparseable-manifest/` — `amber.toml` is syntactically broken TOML.
- `missing-amber-version/` — manifest parses but lacks `amber_version`.
- `slug-on-index/folder/index.md` — a `slug:` on an `index.md` is
  semantically incoherent (slug replaces the filename segment, but
  `index.md`'s segment comes from the parent directory).

These exist so the loader's error paths stay covered as the render layer
becomes the loader's first production caller.
