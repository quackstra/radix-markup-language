# Changelog — @quackdown/core

Semver. Any change to the wire format or resolver output is a **major** version.

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
