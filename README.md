# radix-markup-language

**Live reader:** https://quackstra.github.io/radix-markup-language/
· try a site: [`account_tdx_2_12925rep8cd554n78w9tnjqmagv2sdlzmzyadu9zkez9thuya85m0wu`](https://quackstra.github.io/radix-markup-language/#/account_tdx_2_12925rep8cd554n78w9tnjqmagv2sdlzmzyadu9zkez9thuya85m0wu/about)

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
- ✅ **T2 — Reader (static SPA)** — Vite + TS, mobile-first, 4 viewing modes,
  markdown with raw HTML disabled, CSP locked to the Stokenet Gateway. Reuses the
  shared core with browser deps (Web Crypto + `fzstd`); data path verified live.

## Layout

```
docs/quackdown-stokenet-brief.md   the v0 brief (source of truth)
recon/                             T0 recon harness (Node, ESM) + REPORT.md
src/core/                          shared codec + resolver (isomorphic)
src/node/env.ts                    Node crypto/zstd adapters (injected into the core)
src/cli/                           qd publisher CLI + Gateway/RET client
reader/                            T2 static reader SPA (Vite + TS); browser deps
test/                              vitest suite (T3 + codec)
scripts/acceptance.ts              live Stokenet end-to-end acceptance
```

## Directory (self-listing, on-ledger)

The reader's home page shows a directory of registered sites. It's permissionless
and backend-free: to list your site you send one transaction.

```
qd register --title "My Site"   # adds YOUR account to the public directory
qd dir                          # print the directory
```

How it stays trustworthy: `register` makes an owner call (`lock_fee`) on **your**
account — the identity anchor — and deposits dust into a well-known **hub** account
so the registration is discoverable. The reader builds the list from the hub's
transaction stream and takes each registrant **from the ledger's owner call**, never
from the message — so you can only ever list your own account (same defense as the
forged-page test). Latest `register` per account wins. Hub address lives in
`src/core/config.ts`.

## Reader

```
npm run reader:dev        # dev server
npm run reader:build      # -> reader/dist (static, deploy anywhere)
```

Routing is `#/<site-address>/<path>`. Viewing modes (stored per viewer): Clean,
Deletes, Redirects (don't follow), Full history (open any past snapshot). The reader
talks only to the Stokenet Gateway (enforced by CSP `connect-src`) and never trusts
anything inside an envelope — site membership is the owner-call filter + `CommittedSuccess`.

## Carriers: v1 blobs (default) and v0 messages

- **v1 (default): body in transaction blobs, head in the message.** One page = **one
  transaction, one signature**, ~half the fee of v0. Verified on Stokenet (see
  `recon/REPORT-v1.md`). The reader extracts blobs from `raw_hex` with a tiny SBOR
  walker (`src/core/sbor.ts`) — no RET wasm — and verifies the body against `content_hash`.
- **v0: chunked messages.** Still fully supported; `--carrier msg` opts back in. All v0
  content keeps rendering forever.
- **Batch `COMMIT`:** many ops (publish/delete/redirect) in one transaction — the basis
  for the action cart. Opcodes: PUBLISH `0x01`, DELETE `0x02`, REDIRECT `0x03`,
  REGISTER `0x04`, COMMIT `0x05`, UPLOAD `0x06` (two-phase >1 MiB, reserved).

## Use the CLI

```
export QUACKDOWN_SITE_KEY=<32-byte ed25519 hex>   # never commit or log this
npm run qd -- publish page.md --path /about [--carrier blob|msg] [--dry-run]
npm run qd -- commit cart.json [--dry-run]        # batch many ops in ONE tx
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
