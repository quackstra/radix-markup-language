# Quackdown — T0 Recon Report (Stokenet)

**Status:** complete. **Verdict:** the project is viable, but **one core assumption in
the brief is wrong and forces a spec change** (see Q3). Everything else in the brief
holds and is now confirmed against the live Stokenet Gateway.

All findings below were obtained by **sending real transactions** to Stokenet, not by
reading docs. Reproduce with the scripts in this directory (`10-fund` → `20` → `30`/`31`
→ `40`). A disposable Stokenet account was generated and faucet-funded; its key lives in
`.account.json` (gitignored, testnet-only, never on mainnet).

- Toolkit: `@radixdlt/radix-engine-toolkit@1.0.6`
- Gateway SDK: `@radixdlt/babylon-gateway-api-sdk@1.10.1`
- Gateway: `https://stokenet.radixdlt.com`
- Recon account: `account_tdx_2_128cpgvrzypqh92dxwzdautjkthypn20p7yn9ur3t86805v5klcntvc`

---

## Q1 — Message shape: can content be raw bytes? ✅ Yes, natively.

Sent a plaintext message, MIME `application/x-quackdown`, with **raw bytes** content
(the header bytes `51 44 00 01 de ad be ef 00 ff`) and read it back through the Gateway
`transaction/committed-details` endpoint. Exact JSON returned:

```json
"message": {
  "type": "Plaintext",
  "content": { "type": "Binary", "value_hex": "51440001deadbeef00ff" },
  "mime_type": "application/x-quackdown"
}
```

For comparison, a String-content message returns:

```json
"content": { "type": "String", "value": "# hello quackdown" }
```

**Conclusion.** The envelope can be **raw binary** — no base64/base85 needed. On-ledger it
is stored as bytes; the Gateway returns it as lowercase hex under
`transaction.message.content.value_hex`. The custom MIME type is preserved verbatim.
The reader decodes `value_hex` → `Uint8Array` and parses our binary envelope directly.
Wire overhead on **read** is 2× (hex), but on-ledger storage and the size limit (Q3) are
measured on the **raw bytes**, so this costs us nothing against the cap.

---

## Q2 — Owner-call filter: does it exist, and does `lock_fee` count? ✅ Yes to both.

The Gateway stream filter **`accounts_with_manifest_owner_method_calls`** exists and is
accepted by Stokenet. Confirmed its semantics with a natural experiment on the recon
account, which has two kinds of transaction:

- **funding tx** — `faucet.lock_fee` + `faucet.free` + `account.try_deposit_batch_or_abort`
  (the account only *receives* a deposit; it makes **no owner call**).
- **publish txs** — `account.lock_fee` + message (an **owner-authorized** call on the account).

Result:

```
affected-entities filter count : 7   (every tx touching the account)
owner-method-calls filter count: 6
funding tx in affected set?      true
funding tx in owner-call set?    false   ← the one tx excluded is exactly the deposit-only funding tx
```

**Conclusion.** `lock_fee` **counts** as an owner method call; a deposit-only tx does
**not**. This implements the brief's site-membership rule directly. Security corollary
for the resolver: **owner-call filter + `CommittedSuccess` = authorized owner action.** A
forger using a *different* account cannot make an owner-authorized call on the site
account — the call would fail auth and never reach `CommittedSuccess`, so it can never
appear under the site's owner-call filter. The forged-message defense holds. The reader
should still (a) require `transaction_status == CommittedSuccess` and (b) rely on the
owner-call filter as the auth boundary rather than trusting anything inside the envelope.

---

## Q3 — Size & fee curve: ⚠️ THE 1 MiB CAP IS NOT THE BINDING LIMIT.

**The real limit is a hard 2048-byte cap on the transaction message**, enforced at
*validation* (before execution), not the 1 MiB transaction size. Every message larger
than 2048 bytes is **rejected outright**:

```
InvalidMessage(PlaintextMessageTooLong { actual: 10240,  permitted: 2048 })
InvalidMessage(PlaintextMessageTooLong { actual: 102400, permitted: 2048 })
InvalidMessage(PlaintextMessageTooLong { actual: 512000, permitted: 2048 })
```

Boundary pinned exactly: **2048 bytes commits, 2049 bytes is rejected.** The 2048 is
measured on the **raw message-content bytes** (our binary envelope); the MIME string does
not count against it. Fee curve (successful commits only):

| message payload | fee (XRD) |
|---:|---:|
| ~10 B      | 0.134 |
| 1024 B     | 0.233 |
| 1500 B     | 0.279 |
| 2000 B     | 0.328 |
| **2048 B (max)** | **0.332** |

≈ 0.13 XRD base + ~0.10 XRD per KB. A full 2048-byte chunk ≈ **0.33 XRD/tx** (free on
Stokenet; real cost on mainnet — a page of *N* chunks costs ≈ 0.33·*N* XRD).

**This is a protocol validation constant and almost certainly applies on mainnet too**
(re-confirm before the mainnet brief). **Recommended chunk size and spec impact are in the
"Proposed spec changes" section below — this is the headline of the recon.**

---

## Q4 — Compression libraries. ✅ Options confirmed and sized.

**Encoder (Node):** Node 24 ships **built-in zstd** — `zlib.zstdCompressSync` /
`zstdDecompressSync` (verified: round-trips correctly). Zero dependency for v0. Caveat:
Node's zstd binding exposes advanced params but **no external-dictionary option**, so it
covers v0 (compression `0x00`/`0x01`, `dict_ref` empty) but *not* the shared-dictionary
brief.

**Decoder (browser):**

| lib | ships to browser | dictionaries? | use |
|---|---|---|---|
| `fzstd@0.1.1` | ~8 KB min+gzip (pure JS) | ❌ no | **v0 reader** (text, no dict) |
| `@bokuweb/zstd-wasm@0.0.27` | **~252 KB wasm** (~100 KB gzip) + ~1.2 KB JS glue | ✅ `compress/decompressUsingDict` | the **shared-dictionary brief**, both node & browser |
| `zstddec@0.3.1` | larger, decompress-only | ❌ | — |

**Recommendation.** v0: Node built-in zstd to encode, `fzstd` to decode in the reader
(tiny, keeps the SPA lean). Dictionary brief: switch both sides to `@bokuweb/zstd-wasm`
and accept the ~100 KB gzipped wasm — it is the only clean dict-capable option that runs
in the browser. The envelope's `compression` byte + `dict_ref` already reserve room for
this swap without breaking v0 content.

---

## Q5 — Toolkit versions. ✅

- `@radixdlt/radix-engine-toolkit@1.0.6`
- `@radixdlt/babylon-gateway-api-sdk@1.10.1`

---

# Proposed spec changes (forced by recon) — for approval before T1

### 1. Chunking is governed by the 2048-byte message cap, not the 1 MiB tx cap. *(required)*

The v0 PUBLISH header repeats heavy fields in every chunk. With only 2048 bytes to work
with, that overhead is now significant. Current per-chunk fixed overhead:

```
magic 2 + version 1 + op 1 + path(2+P) + note(2+N) + snapshot_id 16
  + chunk_index 2 + chunk_count 2 + content_hash 32 + compression 1 + dict_ref(2+D)
  = 63 + P + N + D  bytes  (repeated in EVERY chunk)
```

For a 16-byte path that is ~79 bytes/chunk of pure overhead, and `content_hash` (32) +
`snapshot_id` (16) alone are 48 bytes repeated per chunk.

**Proposal — split head vs. body chunks:**

- **Head chunk (`chunk_index = 0`)** carries the metadata once: magic, version, op, path,
  note, snapshot_id, chunk_count, content_hash, compression, dict_ref, + first payload
  slice.
- **Body chunks (`chunk_index ≥ 1`)** carry only: magic, version, op, snapshot_id,
  chunk_index, payload. Overhead drops to ~22 bytes → **~2026 bytes payload/body chunk**.

**Recommended chunk payload size: 1500 bytes (uniform, simple) for v0**, which stays
safely under 2048 even for a head chunk with a long path + a full 280-byte note. If we
adopt the head/body split, body chunks can carry up to ~1900 bytes. I recommend the simple
uniform **1500 B** to start; optimize later if fee/tx-count on mainnet demands it.

Practical effect: a ~5 KB post (~2–2.5 KB zstd) = 2 chunks = 2 txs; a 50 KB page
(~15 KB zstd) ≈ 8–10 chunks. Cost scales linearly at ~0.33 XRD/chunk on mainnet.

### 2. Reader reads bytes from `message.content.value_hex`. *(clarification)*

Confirmed shape from Q1. No base64 layer. Reject any message whose `content.type` is not
`Binary`, or whose `mime_type` is not `application/x-quackdown`.

### 3. Resolver auth = owner-call filter **and** `CommittedSuccess`. *(clarification, security)*

Q2 proves the filter is the auth boundary. Make explicit in the resolver spec that a tx is
a valid site tx **iff** it is returned by `accounts_with_manifest_owner_method_calls =
[site]` **and** `transaction_status == CommittedSuccess`. Do not trust any identity/author
field inside the envelope — the ledger's owner-auth is the only trust anchor.

### 4. Add a fee/economics line to the mainnet scope. *(note)*

At ~0.33 XRD per full chunk, publishing cost is a real (if small) function of page size on
mainnet. The publisher CLI should print an estimated XRD cost before submitting (chunks ×
per-chunk fee), and `qd publish` should support a `--dry-run` that reports chunk count and
estimated fee without submitting.

### 5. Re-confirm the 2048 cap on mainnet before the mainnet brief. *(open item)*

High confidence it is a protocol constant, but it was only measured on Stokenet here.

---

**Stopping here per the brief. Not starting T1 until these spec changes are approved.**
