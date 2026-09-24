# Quackdown Core Social Schema v1 (S0 — proposal, awaiting approval)

The schema is the **composability contract**: what makes a Quackdown page a
*profile*, *post*, *reply*, *follow list*, or *theme reference*, so that any client —
not just Radpress — can read and write the same social graph. It is deliberately
**tiny, versioned, and extensible**. Reference parsers ship in `@quackdown/core`
(`src/core/schema.ts`); tests in `test/schema.test.ts`.

> Status: **design gate**. This proposes the schema and ships the parsers. Nothing
> in Part B (S1 indexer) or Part C (Radpress) is built on it until it's approved.

---

## 1. Where the type lives — recommendation: **front-matter in the body**

The type tag and structured fields live in a small **JSON front-matter block at the
top of the page body**, delimited by `---` fences:

```
---
{"v":1,"type":"post","title":"Hello","published":"2026-09-24T00:00:00Z","tags":["gm"]}
---
# Hello

Body markdown here…
```

**Why body front-matter, not a field in the head:**

1. **Format/schema separation → forkability.** The Quackdown *envelope* (v0/v1) stays
   frozen at what T4 shipped. The social schema becomes a pure body convention that a
   fork can adopt, extend, or replace **without touching the wire format**. This directly
   serves the non-negotiable "anyone can write Quackdown with nothing but a transaction."
2. **No new envelope changes / opcodes.** Putting the type in the head would couple every
   Quackdown transaction to this social layer forever and require a format revision.
3. **Deterministic + dependency-free.** JSON (not YAML) parses identically everywhere —
   important because the indexer (S1) must be deterministic. No parser dependency.
4. **Extensible in place.** Core keys sit next to namespaced extension keys; unknown keys
   are ignored (§4).

**Accepted trade-offs.** (a) A typed consumer must read the *body* (for v1, one blob
fetch) to classify an object — but the indexer and reader fetch bodies anyway to show
content, and path conventions (§3) give cheap head-only hints. (b) A Quackdown reader that
is **not** schema-aware would show the `---`-fenced block as text; schema-aware readers
strip it (the reference reader will). The block is small.

Backward compatible: existing plain pages (no front-matter) are simply `type: page` and
render unchanged.

---

## 2. Common envelope of every object

| key | type | meaning |
|---|---|---|
| `v` | int | schema version (this doc: `1`) |
| `type` | string | one of the core types below, or a namespaced extension type |

Everything else is type-specific or namespaced. Missing/invalid front-matter ⇒ `type:
page`.

---

## 3. Core object types

Reference parsers: `parsePage`, `asProfile`, `asPost`, `asReply`, `asFollows`, `asThemeRef`.

### `profile` — at path `/`
```
---
{"v":1,"type":"profile","name":"Alice","bio":"builder","avatar":"rdx:page:account_…:/avatar","theme":"rdx:tx:txid_…","links":[{"label":"site","url":"https://…"}]}
---
Welcome to my corner of the ledger.
```
Body = the homepage content. `theme` is an optional shortcut for a theme reference (§6).

### `post` — author's choice of path (e.g. `/posts/hello`)
```
---
{"v":1,"type":"post","title":"Hello","published":"2026-09-24T00:00:00Z","tags":["gm","radix"],"summary":"first post"}
---
# Hello

My first on-ledger post.
```
`published` is an author-declared display time only. **Ordering is always by ledger state
version**, never by this field (v0 decision stands).

### `reply` — on the **replier's own** site, references the target post's transaction
```
---
{"v":1,"type":"reply","to":"rdx:tx:txid_…targetpost","title":"re: Hello"}
---
Nice post!
```
`to` **must** be an `rdx:tx:` ref (immutable target). A reply is a normal page on the
replier's site — the target author can hide it in their view but cannot delete it.

### `follows` — a full-snapshot list, path convention `/follows`
```
---
{"v":1,"type":"follows","accounts":["account_tdx_2_…a","account_tdx_2_…b"]}
---
```
Latest snapshot wins (like all Quackdown state). Accounts are bare addresses or
`rdx:acct:` refs.

### `theme-ref` — which theme the site uses, path convention `/theme`
```
---
{"v":1,"type":"theme-ref","theme":"rdx:tx:txid_…theme"}
---
```
Equivalent to `profile.theme`; a standalone object lets a theme change be one small op.

---

## 4. The rule that makes it scale: **ignore what you don't understand**

- **Unknown `type`** ⇒ treat as a plain page: render the body, skip typed handling.
  Never error.
- **Unknown top-level keys** ⇒ ignored.
- **Unknown blocks** (§6) ⇒ render nothing (or a minimal placeholder), never error.
- **Namespacing:** core keys/types are bare (`type`, `title`, `post`, …). **Every
  extension MUST be namespaced** `ns:name`, e.g. `radpress:gallery`, `x.somefork:thing`.
  The bare namespace is reserved for the core schema. This is what lets the schema grow to
  WordPress scale without breaking old sites or old readers.

---

## 5. References — `rdx:` URIs

| form | means | mutable? |
|---|---|---|
| `rdx:acct:<account>` | an account (a site) | — |
| `rdx:tx:<intent_hash>` | a specific transaction (a post/snapshot) | immutable |
| `rdx:page:<account>:/<path>` | a page on a site (resolves latest) | mutable |

Replies reference `rdx:tx:` (pin the exact post). Follows use accounts. Avatars/theme
use `rdx:page:` or `rdx:tx:`. Parsers: `parseRef` / `formatRef`.

---

## 6. Themes and blocks (declarative only — no JS)

- **Theme** = an on-ledger atom (object `type: theme`) = **style tokens + layout
  templates**, published like any Quackdown object on a theme author's site. Sites
  *reference* a theme (`theme-ref` / `profile.theme`) rather than copy it. A remix sets
  `"remix-of": "rdx:tx:…"` to attribute its parent.
  ```
  ---
  {"v":1,"type":"theme","name":"Pondwater","tokens":{"bg":"#0f1216","accent":"#ffd23f"},"templates":{"post":"…"},"remix-of":"rdx:tx:txid_parent"}
  ---
  ```
- **Blocks** = namespaced, declarative render instructions inside a body, as fenced code
  blocks the reader knows how to draw safely:
  ````
  ```quackdown:radpress:gallery
  {"images":["rdx:tx:a","rdx:tx:b"]}
  ```
  ````
  A reader that knows `radpress:gallery` renders a gallery; one that doesn't ignores it
  and renders the rest. **No arbitrary JavaScript — declarative data only.** Helper:
  `extractBlocks(body)`.

---

## 7. Versioning

`v` is the schema version. **Additive** changes (new optional keys, new namespaced
extensions) do **not** bump `v`. **Breaking** changes to core object shapes bump `v`;
readers check `v` and degrade gracefully. This tracks `@quackdown/core` semver.

---

## 8. What ships with this proposal

- Typed parsers in `@quackdown/core`: `parseFrontMatter`, `parsePage`, `serializePage`,
  `parseRef`, `formatRef`, `asProfile`, `asPost`, `asReply`, `asFollows`, `asThemeRef`,
  `extractBlocks`, `ObjectType`.
- `test/schema.test.ts` — front-matter split/tolerance, refs, each core type, the
  unknown-type rule, and block extraction.

## Open questions for approval

1. **Front-matter vs head** — approving the recommendation (front-matter) freezes the
   envelope; confirm.
2. **Path conventions** — `/` profile, `/follows`, `/theme` are conventions (hints), not
   enforced. OK to keep them advisory?
3. **`published` semantics** — display-only, ordering stays by state version. OK?
4. **Reply visibility** — target author can hide, not delete (matches Part C R3). Confirm
   this lives in the schema as-is (replies are just pages of `type: reply`).

**Stopping for approval before S1 (indexer).**
