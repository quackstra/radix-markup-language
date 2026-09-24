# @quackdown/core

The protocol core for **Quackdown** — websites that live entirely on the Radix
ledger. Envelope codec, resolver, directory registry, a minimal SBOR blob
extractor, and read-side Gateway helpers. Isomorphic (Node + browser), **zero
runtime dependencies**. Crypto/zstd are injected so the same code runs anywhere.

Part of [`radix-markup-language`](https://github.com/quackstra/radix-markup-language).

## Install (pinned tarball)

```
npm i https://github.com/quackstra/radix-markup-language/releases/download/core-v1.0.0/quackdown-core-1.0.0.tgz
```

## Resolve a site (Node)

```ts
import { fetchSiteRecords, resolveSite, render, loadBody, fetchRawPayload, extractBlobs } from '@quackdown/core';
import { nodeCrypto } from '@quackdown/core/node';

const account = 'account_tdx_2_…';
const { pages } = await resolveSite(await fetchSiteRecords(account), nodeCrypto);

const r = render(pages, '/about');
if (r.kind === 'page') {
  // v0 bodies are inline; v1 bodies load on demand from the transaction's blobs
  const content = r.content ?? await loadBody(r.op.body!, extractBlobs(await fetchRawPayload(r.op.body!.txId)), nodeCrypto);
  console.log(content);
}
```

In the browser, inject Web Crypto + a zstd decoder (e.g. `fzstd`) instead of
`@quackdown/core/node`:

```ts
const browserCrypto = {
  sha256: async (d) => new Uint8Array(await crypto.subtle.digest('SHA-256', d)),
  zstdDecompress: async (d) => fzstd.decompress(d),
};
```

## Exports

- `@quackdown/core` — codec (`encodePublishV1Head`, `splitBody`, `encodeCommit`,
  `encodePublishChunks`, `encodeDelete`, `encodeRedirect`, `encodeRegister`,
  `decode`), `resolveSite`, `render`, `loadBody`, `resolveRegistry`, `extractBlobs`,
  Gateway helpers, `NETWORKS`, types.
- `@quackdown/core/node` — Node crypto/zstd adapters (`nodeCrypto`, `zstdCompress`, `sha256Sync`).

Signing/publishing (Radix Engine Toolkit) is intentionally **not** in this package —
it lives in the `qd` CLI. This package is the read/format side any client needs.

## Versioning

Semver. Any change to the wire format or resolver output is a **major** version. See CHANGELOG.md.
