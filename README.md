# radix-markup-language

Umbrella repo for **Quackdown** — a website that lives entirely on the Radix ledger.
Pages are markdown, compressed and written into Radix **transaction messages**. A static
reader pulls a site's transactions from the Gateway, reassembles the pages, and renders
them. No backend, no database, no hosting beyond the static reader.

**Network: Stokenet only** (for now).

## Status

- ✅ **T0 — Recon** complete. See [`recon/REPORT.md`](recon/REPORT.md).
  Headline: the binding size limit is a **2048-byte transaction-message cap**, not the
  1 MiB transaction size. Approved spec changes: uniform **1500-byte** chunk payload,
  head/body chunk split, reader reads `message.content.value_hex`, resolver auth =
  owner-call filter + `CommittedSuccess`, publisher prints est. fee + `--dry-run`.
- ✅ **Shared core** (`src/core`) — isomorphic envelope codec + resolver ("one core, two faces").
- ✅ **T1 — Publisher CLI (`qd`)** — publish / delete / redirect / ls / history, `--dry-run`.
- ✅ **T3 — Resolver tests** — 24 tests, all passing (`npm test`).
- ✅ **Acceptance** — full brief acceptance verified live on Stokenet
  (`scripts/acceptance.ts`): 4 pages incl. a 3-chunk page, a delete, a redirect, and a
  forged cross-account message that is correctly excluded.
- ⏸️ **T2 — Reader (static SPA)** — not started (next).

## Layout

```
docs/quackdown-stokenet-brief.md   the v0 brief (source of truth)
recon/                             T0 recon harness (Node, ESM) + REPORT.md
src/core/                          shared codec + resolver (isomorphic)
src/node/env.ts                    Node crypto/zstd adapters (injected into the core)
src/cli/                           qd publisher CLI + Gateway/RET client
test/                              vitest suite (T3 + codec)
scripts/acceptance.ts              live Stokenet end-to-end acceptance
```

## Use the CLI

```
export QUACKDOWN_SITE_KEY=<32-byte ed25519 hex>   # never commit or log this
npm run qd -- publish page.md --path /about --note "first" [--dry-run]
npm run qd -- delete   --path /temp
npm run qd -- redirect --from /old --to /about
npm run qd -- ls
npm run qd -- history  --path /about
```

## Recon harness

```
cd recon && npm install
node 10-fund.mjs                # create + faucet-fund a throwaway Stokenet account
node 20-q1-message-shape.mjs    # Q1: message bytes/string shape
node 30-q3-size-fee.mjs         # Q3: size/fee curve + max-size probe
node 31-q3b-boundary.mjs        # Q3: pin the 2048-byte boundary
node 40-q2-owner-filter.mjs     # Q2: owner-method-calls filter
```

`.account.json` holds a **disposable testnet** private key and is gitignored. It is never
used on mainnet and never committed.
