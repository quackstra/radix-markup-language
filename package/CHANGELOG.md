# Changelog — @quackdown/core

Semver. Any change to the wire format or resolver output is a **major** version.

## 1.2.0

- `buildCommit` helper: dedupes identical blobs in a COMMIT (fixes `DuplicateBlob`
  rejection for identical / empty-body pages); ops with the same body share a range.
- Batch refs: `rdx:tx:<hash>#<opIndex>` addresses one op inside a COMMIT (bare hash =
  op 0); `parseRef`/`formatRef`/`refForOp` updated; `asReply` exposes `opIndex`.
- Strict front-matter JSON (deterministic for the indexer): rejects duplicate keys,
  non-finite/unsafe-integer numbers, and invalid UTF-8 — violations degrade the page
  to `type: page`. Malformed known-typed objects (bad `reply.to`, etc.) also degrade.
- Typed theme tokens: `validateThemeTokens` + `asTheme` accept only colors, lengths,
  and allowlisted fonts (no `url()`/raw CSS).
- `asFollows` drops addresses that don't match the site's network prefix.

## 1.1.0

- Add the core social schema (S0): `parseFrontMatter`, `parsePage`, `serializePage`,
  `parseRef`/`formatRef`, `asProfile`/`asPost`/`asReply`/`asFollows`/`asThemeRef`,
  `extractBlocks`, `ObjectType`. Additive — no wire-format or resolver change.

## 1.0.0

Initial published core.

- Envelope codec: v0 (chunked messages) and v1 (head-in-message, body-in-blobs),
  plus batch `COMMIT` (op `0x05`); `UPLOAD` (`0x06`) reserved for the >1 MiB
  two-phase path. Opcodes: PUBLISH `0x01`, DELETE `0x02`, REDIRECT `0x03`,
  REGISTER `0x04`, COMMIT `0x05`, UPLOAD `0x06`.
- Resolver: folds v0+v1 ops per path by (state version, op index); owner-call +
  `CommittedSuccess` auth; read-time redirect resolution; lazy v1 body loading
  (`loadBody`) with `content_hash` verification.
- Directory registry resolver (`resolveRegistry`, `ownerAccountFromManifest`).
- Minimal SBOR blob extractor (`extractBlobs`) — no RET dependency.
- Read-side Gateway helpers (`fetchSiteRecords`, `fetchRawPayload`,
  `fetchRegistryRecords`), isomorphic via global `fetch`.
- `@quackdown/core/node` adapter (Node crypto + built-in zstd).
