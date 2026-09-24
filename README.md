# radix-markup-language

Umbrella repo for **Quackdown** — a website that lives entirely on the Radix ledger.
Pages are markdown, compressed and written into Radix **transaction messages**. A static
reader pulls a site's transactions from the Gateway, reassembles the pages, and renders
them. No backend, no database, no hosting beyond the static reader.

**Network: Stokenet only** (for now).

## Status

- ✅ **T0 — Recon** complete. See [`recon/REPORT.md`](recon/REPORT.md).
  Headline: the binding size limit is a **2048-byte transaction-message cap**, not the
  1 MiB transaction size — this changes the chunking spec (proposal in the report).
- ⏸️ **T1 — Publisher CLI (`qd`)** — blocked on approval of the recon's proposed spec changes.
- ⏸️ **T2 — Reader (static SPA)** — not started.
- ⏸️ **T3 — Resolver tests** — not started.

## Layout

```
docs/quackdown-stokenet-brief.md   the v0 brief (source of truth)
recon/                             T0 recon harness (Node, ESM) + REPORT.md
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
