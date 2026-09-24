# Quackdown — Stokenet Brief v0

## What this is

A website that lives entirely on the Radix ledger. Pages are markdown, compressed and written into **transaction messages**. A static **reader** pulls a site's transactions from the Gateway, reassembles the pages, and renders them. There is no backend, no database, and no hosting beyond the static reader.

This brief covers **text only**: the publisher, the reader, and the editorial ops (publish / delete / redirect). Shared-dictionary compression and loom art come in later briefs, but the format reserves room for both now.

Network: **Stokenet only.**

## Decisions already made — do not relitigate

- **Site = a Radix account.** A transaction belongs to a site only if it committed successfully **and** its manifest makes an owner-authorized call on that account (e.g. `lock_fee`). Anything else that touches the account is ignored.
- **Pages are addressed by path** (`/about`, `/blog/first-post`).
- **History = full snapshots.** Every edit republishes the whole page. No diffs or patches.
- **"Latest" = ledger state version.** Never trust a timestamp inside the envelope.
- **Deletes and redirects are claims, not erasure.** The reader applies them by default, and the viewer can switch them off.
- **One core, two faces.** The envelope codec and the resolver live in one shared TS module, used by both the CLI and the reader, so they can never disagree.

---

## T0 — RECON. Do this first, report, and WAIT for approval.

Answer each of these against the real Stokenet Gateway and Radix Engine Toolkit. Where possible, answer by sending test transactions, not by reading docs.

1. **Message shape.** Send one plaintext message with MIME type `application/x-quackdown` and **raw bytes** content, then read it back through the Gateway with the message opt-in. Report the exact JSON shape returned. Can content be bytes, or only a string? If only a string, propose an encoding (base64 vs base85) and its size overhead.
2. **Owner-call filter.** I believe the Gateway transaction stream has a filter along the lines of `accounts_with_manifest_owner_method_calls`. Confirm it exists and what it matches. Does a `lock_fee` from the account count? If the filter doesn't exist or doesn't fit, propose how the reader should verify owner auth instead.
3. **Size and fee curve.** Publish messages of about 1 KB, 10 KB, 100 KB and 500 KB. Report the fee for each and the practical maximum message size, given the 1 MiB transaction cap. Recommend a chunk size.
4. **Compression library.** Find a zstd encoder for Node and a zstd **decoder for the browser that supports dictionaries**, since we need that in the next brief. Report the bundle size of the browser decoder.
5. **Toolkit versions.** Report the current versions of the Radix Engine Toolkit (TS) and the Gateway SDK you intend to use.

**Then propose** any changes to the envelope spec below that the recon forces, and **stop**. Do not start T1 until I approve.

---

## Envelope spec v0

Every Quackdown message is binary, starting with this header:

| Field | Size | Notes |
|---|---|---|
| magic | 2 bytes | `0x51 0x44` ("QD") |
| version | 1 byte | `0x00` |
| op | 1 byte | `0x01` PUBLISH, `0x02` DELETE, `0x03` REDIRECT |
| path | u16 len + UTF-8 | Normalized: leading `/`, no trailing `/` (except root `/`), NFC, case-sensitive |
| note | u16 len + UTF-8 | Optional commit-style note, max 280 bytes; length 0 = none |

**PUBLISH** adds:

| Field | Size | Notes |
|---|---|---|
| snapshot_id | 16 bytes | Random; groups the chunks of one snapshot |
| chunk_index | u16 | 0-based |
| chunk_count | u16 | ≥ 1 |
| content_hash | 32 bytes | sha256 of the full **uncompressed** markdown |
| compression | 1 byte | `0x00` none, `0x01` zstd |
| dict_ref | u16 len + bytes | Reserved for the shared dictionary; length 0 for now |
| payload | rest | This chunk's slice of the compressed stream |

**REDIRECT** adds:

| Field | Size | Notes |
|---|---|---|
| target | u16 len + UTF-8 | Same-site path only in v0 |

**DELETE** adds nothing.

All integers are little-endian. Readers reject unknown magic, versions, or op codes; they don't guess.

---

## Resolution rules (the shared resolver)

1. Collect every valid site transaction (committed successfully, with an owner call on the site account), and decode its envelope. Silently drop anything that fails to decode.
2. **Snapshots.** A PUBLISH snapshot is complete when all `chunk_count` chunks for its `snapshot_id` are present. Its position in the timeline is the **state version of its last chunk**. Reassemble in index order, decompress, and verify `content_hash`. Incomplete or hash-failing snapshots are excluded from resolution but appear in Full history, marked as such.
3. **Per path, fold the ops in state-version order; the last op wins.** A path ends up as published (with its latest snapshot), deleted (with note), or redirected (with target and note). A PUBLISH after a DELETE restores the page.
4. **Redirects resolve at read time.** Follow at most 5 hops. Any repeated path means a loop, so show "redirect loop." A redirect landing on a deleted path shows the deleted notice. A redirect to a path that never existed shows "not found," naming the redirect.
5. A DELETE on a redirected path removes the redirect.

---

## T1 — Publisher CLI

`qd` in TypeScript/Node, using the Radix Engine Toolkit. The site account's private key comes from an env var and is **never** committed or logged.

- `qd publish <file.md> --path /about [--note "…"]`: compress, chunk, and submit one transaction per chunk, each with an owner call on the site account. Print the snapshot ID and transaction IDs.
- `qd delete --path /about [--note "…"]`
- `qd redirect --from /old --to /new [--note "…"]`
- `qd ls`: fetch from the Gateway, run the shared resolver, and print each path's resolved state.
- `qd history --path /about`: print that path's full op timeline.

## T2 — Reader

A static SPA (Vite + TS), mobile-first: every screen must work one-thumbed at 390×844.

- **Routing:** `#/<site-address>/<path>`. The landing screen takes a site address.
- **Rendering:** markdown with **raw HTML disabled**, so the output can't inject scripts. Relative links stay inside the site. External links open with `rel="noopener noreferrer"`. For now, image syntax renders as a plain link; image handling comes in a later brief.
- **Viewing modes** (toggles, stored per viewer):
  - **Clean** (default): all ops applied.
  - **Show deletes:** deleted pages render with a banner giving when they were deleted and the note.
  - **Show redirects:** don't follow redirects. Show "moved to /new" above the old content.
  - **Full history:** a per-page timeline of every op and snapshot, where any past snapshot can be opened.
- **CSP:** `connect-src` allows the Stokenet Gateway only.

## T3 — Resolver tests

Unit tests on the shared resolver, run in CI, covering at least:

- latest-wins by state version, including out-of-order arrival
- publish → delete → publish (restore)
- redirect chain within the limit, over the limit, and in a loop
- redirect to a deleted path and to a nonexistent path
- incomplete snapshot and hash-mismatch snapshot
- a valid-looking envelope from a transaction **without** a site-account owner call is ignored
- unknown version or op code is rejected

## Acceptance

A demo site on Stokenet with at least three pages, one of which is deleted and one redirected, plus a forged message sent by a different account. All four viewing modes render correctly on a phone, the forged message never appears, and `qd ls` agrees exactly with what the reader shows.

## Out of scope for this brief

Shared dictionary, loom / Quackdown art blocks, the image and fallback conventions, external redirects, mainnet, and a path-to-ID index. The format reserves `dict_ref` and the version byte so each of these can arrive without breaking v0 content.
