# Quackdown v1 — T0b-live Recon Report (Stokenet)

**Verdict:** the blob carrier works and is ~half the cost of chunked messages with
**one transaction and one signature per page**. L1–L6 verified live by sending real
transactions; L7–L8 (Radix Wallet) need a real wallet and are gated to Part C — design
answers below. One concrete conflict with the brief's opcode numbering (see v1 proposal).

Recon account: `account_tdx_2_128cpgvrzypqh92dxwzdautjkthypn20p7yn9ur3t86805v5klcntvc`
Script: `recon/v1-blob-recon.mjs` · Toolkit RET 1.0.6.

---

## L1 — Unreferenced blob commits? ✅ Yes.

A tx with `lock_fee` on the site account + a QD head message + **one unreferenced
10 KB blob** committed successfully (fee **1.13 XRD**). Nothing rejects an unused blob,
confirming the T0b source read. **Design consequence:** the body can ride in blobs with
**no manifest `Blob()` reference at all** — the simplest possible carrier. The publishing
path stays a plain transaction, no component.

## L2 — Large blob (~900 KB) ✅ commits.

900 KB blob → `CommittedSuccess`, payload **921,875 B** (< 1 MiB cap), fee **89.87 XRD**.
Single-transaction large pages are real.

## L3 — Fee curve ✅ ~0.10 XRD/KB (matches model)

| blob | payload | fee (XRD) |
|--:|--:|--:|
| 10 KB | 10,514 B | 1.13 |
| 100 KB | 102,675 B | 10.10 |
| 500 KB | 512,275 B | 49.99 |

≈ **0.10 XRD/KB**, small per-tx base. Versus v0 chunked messages, a 10 KB page is
**1 tx / 1 signature / ~1.13 XRD** instead of **7 tx / 7 signatures / ~2.3 XRD**.

## L4 — Read-back ✅ works; but keep RET off the reader.

`committed-details` with `raw_hex` returns the full payload; `RET.NotarizedTransaction.
decompile` extracts the blobs and the **roundtrip matches byte-for-byte**. However **RET
is ~7.9 MB raw / ~3.0 MB gzipped** (wasm embedded in JS) — unacceptable for the reader
(currently 55 KB gz).

**Recommendation:** RET stays on the **publisher/CLI (Node)** where it already lives; the
**reader gets a minimal hand-written SBOR walker** that pulls just the blobs
(`Vec<Vec<u8>>`) out of a notarized-transaction payload. That path is small and bounded
(read the SBOR prefix, seek the manifest blobs field). Implement in T4; keep the reader lean.

## L5 — Stream + raw_hex ✅ works (but don't use it for the list)

`accounts_with_manifest_owner_method_calls` returns blob transactions, and `raw_hex` **is**
supported on `/stream/transactions`. But opting `raw_hex` on the stream inflates each item
by the **entire blob** (a 900 KB page → 900 KB per list item). So the two-step fetch in the
brief is correct: **stream heads only (no raw_hex)** to resolve, then fetch `raw_hex` for the
**one page being viewed** (via `committed-details` or a targeted stream). Cache bodies by
`content_hash`.

## L6 — Transaction version

RET 1.0.6's `TransactionBuilder` produces **V1** notarized transactions
(`notarized_transaction_hex`), which is what the CLI uses. V2 (Cuttlefish subintents) exists
but is **not needed** for publishing; blob semantics are identical across V1/V2. No change.

## L7 / L8 — Radix Wallet + dApp Toolkit (deferred to Part C, needs a real wallet)

Cannot be verified headlessly (they require the Radix Wallet app + user approval). They are
Part C (R1) concerns and Part C is gated behind T5/S0/S1, so this is fine. Design answers to
verify in R1:

- **L7 (blobs + binary message):** confirm the Wallet can submit (a) blobs and (b) a **binary**
  transaction message. **Known risk:** the Wallet may only accept **text** messages. Fallback
  (already in the brief): put the head as **base64 under a text MIME**. Heads are tiny (body is
  in blobs), so base64's ~33% overhead is a non-issue for the head budget. Net: even worst-case,
  the carrier survives.
- **L8 (fee payer):** put an **explicit** owner-authorized call on the site account in the dApp's
  manifest (its own `lock_fee`, or a `set_metadata`/owner method) so owner-auth lives in the
  manifest regardless of which account the Wallet picks to pay fees. That satisfies the owner-call
  filter independently of the fee payer. Verify the manifest survives Wallet signing in R1.

---

## Envelope v1 — proposal (refined by L1–L6), for approval

- **version `0x01`.** v0 (`0x00`) stays valid forever; reader keeps the v0 chunk path.
- **Head in message, body in blobs.** Head = magic, version, op, path, note, snapshot_id,
  content_hash, compression, dict_ref, **`body_blobs: u8`**. Body = the compressed stream split
  across `body_blobs` **unreferenced** blobs, concatenated in tx blob order, decompressed, hash-verified.
- **⚠️ Opcode conflict to resolve:** the brief assigns **`0x04` to COMMIT**, but this session already
  shipped **`0x04` = REGISTER** (the directory). Proposal: keep **REGISTER `0x04`**, use **COMMIT `0x05`**
  and **UPLOAD `0x06`**. (Flagging rather than silently renumbering.)
- **Batch COMMIT.** Small carts: the op list fits inline in the ≤2048 B message. **Large carts exceed
  the 2048 B head** — so COMMIT should support a **batch-in-blob** form: the message stays tiny and
  points to a blob holding the op list. Recommend: inline when it fits, blob-backed when it doesn't.
- **DuplicateBlob edge:** identical blobs in one tx are rejected. Two byte-identical body slices (rare
  for compressed data) would fail; mitigate by never emitting duplicate slices (pad/'‑vary, or merge).
- **Two-phase >1 MiB:** UPLOAD body txs (blobs, not live) then one small COMMIT that activates them.
- **Resolver ordering:** state version, then op index within the batch.
- **Integrity:** missing/mis-hashed body excludes that snapshot (same as v0 incomplete snapshots).

**Stopping at the gate per the brief. Not implementing T4 until v1 is approved.**
