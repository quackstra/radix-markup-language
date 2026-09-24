// Content seeded onto Stokenet by scripts/seed-content.ts. Each top-level entry
// is a separate site (its own account); `pages` maps path -> markdown. The main
// "quackdown" site describes the project; the rest are affectionate Radix
// community in-jokes ($EARLY, roadmap-always-early, Piers/RDX Works, Cerberus,
// Scrypto, Babylon/Xi'an) written as lorem-ipsum nonsense.
export interface SiteContent {
  name: string;
  title: string;
  pages: Record<string, string>;
}

export const SITES: SiteContent[] = [
  {
    name: 'quackdown',
    title: 'Quackdown — radix-markup-language',
    pages: {
      '/': `# Quackdown

A website that lives **entirely on the Radix ledger**. There is no server behind
this page. What you are reading was written into a Radix **transaction message**,
pulled from the public Gateway, reassembled, and rendered by a static reader.

- [What this is](/about)
- [How it works](/how-it-works)
- [FAQ](/faq)

Every page here is on-ledger content. Delete the reader and the pages still exist;
run a different reader and you get byte-identical results.`,

      '/about': `# About

**radix-markup-language** (the repo) ships **Quackdown** (the format): a way to
publish a small website whose every page is a Radix transaction message.

## The idea

- A **site is a Radix account.** A transaction belongs to a site only if it
  committed successfully *and* made an owner-authorized call (\`lock_fee\`) on that
  account. So only the account's owner can publish to it — nobody can forge pages
  onto your site.
- **Pages are markdown**, compressed with zstd and chunked to fit Radix's hard
  **2048-byte message cap**, then written across one transaction per chunk.
- **History is on-ledger.** Every edit is a full snapshot; "latest" is decided by
  ledger state version, never by a timestamp inside the message.
- **The reader is static.** No backend, no database — it reads straight from the
  Gateway and resolves everything client-side.

## No backend, really

This very paragraph is stored in transaction messages on Stokenet. The reader you
are using is a bundle of static files on GitHub Pages. If both vanished tomorrow,
the content would still be on the ledger, waiting for the next reader.

See [how it works](/how-it-works) for the gritty details, or the
[FAQ](/faq) for the obvious questions.`,

      '/how-it-works': `# How it works

## Publishing
1. \`qd publish page.md --path /about\` compresses the markdown (zstd), hashes the
   original (sha256), and splits the compressed stream into ~1500-byte chunks.
2. Each chunk becomes a transaction with a binary **envelope** in its message and
   a \`lock_fee\` owner call on the site account. One chunk = one transaction.
3. A "head" chunk carries the metadata (path, snapshot id, hash, chunk count);
   "body" chunks carry only their slice, to stay under the 2048-byte cap.

## Reading
1. The reader asks the Gateway for every owner-authorized transaction on the site
   account (\`accounts_with_manifest_owner_method_calls\` + committed success).
2. It groups chunks by snapshot, reassembles in order, decompresses, and verifies
   the content hash. Incomplete or tampered snapshots are ignored.
3. Ops fold per path in state-version order — last write wins. Publish, delete,
   redirect. A publish after a delete restores the page.

## Trust
The only trust anchor is the ledger's owner authorization. Nothing inside a
message is trusted for identity — that is why forged pages from other accounts
never appear.`,

      '/faq': `# FAQ

**Is this on mainnet?**
Not yet — Stokenet only. Mainnet needs real XRD to pay per-chunk fees (~0.33 XRD
each) and a re-check of the 2048-byte cap.

**How big can a page be?**
As big as you like — it just becomes more chunks, so more transactions and more
fee. Small pages are cheapest.

**Can someone deface my site?**
No. Publishing requires an owner call on your account. Others can publish their
own sites, not yours.

**How do I list my site here?**
\`qd register --title "My Site"\` adds your account to the [directory](/) on the
reader's home page. You can only ever register your own account.

**Why does it exist?**
Because a website that needs no server, no host, and no you-still-being-alive is
a funny and slightly beautiful thing to be able to make.`,
    },
  },

  {
    name: 'early',
    title: 'The $EARLY Gazette',
    pages: {
      '/': `# The $EARLY Gazette

*The paper of record for people who are still, somehow, early.*

gm. You are early. You have always been early. You will continue to be early for
the foreseeable roadmap.

- [gm](/gm)
- [Roadmap](/roadmap)

Lorem ipsum dolor sit **$EARLY**, consectetur adipiscing elit, sed do eiusmod
tempor incididunt ut labore et 1,000,000 TPS magna aliqua.`,

      '/gm': `# gm

gm. Still early. Ut enim ad minim veniam, quis nostrud **Cerberus** exercitation
ullamco laboris nisi ut aliquip ex ea commodo consensus.

We are so early the ledger has not finalized this sentence yet. We are so early the
mempool is empty because nobody else has arrived. We are so early that "soon" is
still ahead of us, structurally, forever.

Duis aute irure $EARLY in reprehenderit in voluptate velit esse cillum atomic
composability eu fugiat nulla pariatur. Excepteur sint occaecat gm cupidatat.

*Not financial advice. Is barely advice. Is mostly a duck sound.*`,

      '/roadmap': `# Roadmap

- **Q?** — Xi'an (real soon)
- **Q?? ** — the thing after Xi'an
- **Q???** — 1,000,000 TPS, of which three are mine
- **Q????** — you, still here, still early

Sed ut perspiciatis unde omnis **roadmap** natus error sit voluptatem accusantium
doloremque laudantium, totam rem aperiam, eaque ipsa quae ab "coming soon" inventore
veritatis. The roadmap is a living document. It mostly lives in the future.

Nemo enim ipsam voluptatem quia $EARLY sed quia consequuntur magni dolores eos qui
ratione Scrypto voluptatem sequi nesciunt.`,
    },
  },

  {
    name: 'piers',
    title: "Piers' Corner",
    pages: {
      '/': `# Piers' Corner

*An affectionate, entirely fictional tribute to a CEO who has explained atomic
composability more times than any human should.*

- [Quotes](/quotes)
- [The Vision](/vision)

Lorem ipsum dolor sit amet, consectetur **RDX Works** elit. Any resemblance to
real roadmaps, living or delayed, is purely coincidental.`,

      '/quotes': `# Quotes (fictional, loving)

> "It's not late, it's *composable in time*." — not Piers, probably

> "We didn't miss the deadline. The deadline achieved atomic composability with
> the future." — also not Piers

Ut enim ad minim veniam, quis nostrud exercitation. Here he is again, on stage,
with a hand-drawn diagram of three dogs named **Cerberus**, explaining why your
transaction and mine can settle together and nobody has to trust anybody.

Neque porro quisquam est qui dolorem ipsum quia "the tech is ready" dolor sit amet,
consectetur, adipisci velit. He believes. We believe. The believing is the product,
and honestly it's a pretty good product.`,

      '/vision': `# The Vision

Sed ut perspiciatis unde omnis iste natus error sit **DeFi without compromise**,
totam rem aperiam. A world computer. Real assets. A wallet your mum could use, if
your mum were extremely early.

Excepteur sint occaecat cupidatat non proident, sunt in culpa qui **Scrypto**
officia deserunt mollit anim id est laborum. The vision is large. The vision is
bright. The vision is, crucially, still ahead of us — which is where all the best
visions live.

gm, Piers. The diagram was good. It's always good.`,
    },
  },

  {
    name: 'lorem',
    title: 'Radix Lorem Ipsum',
    pages: {
      '/': `# Radix Lorem Ipsum

Filler text, but make it **Cerberus**.

- [Lorem](/lorem)
- [More](/more)`,

      '/lorem': `# Lorem

Lorem ipsum dolor sit **XRD**, consectetur **Babylon** elit, sed do eiusmod
**Scrypto** tempor incididunt ut labore et atomic composability magna aliqua. Ut
enim ad **Cerberus** veniam, quis nostrud exercitation ullamco **DeFi** laboris.

Duis aute irure **Radix Wallet** in reprehenderit in voluptate velit esse cillum
**1,000,000 TPS** dolore eu fugiat nulla pariatur. Excepteur sint **$EARLY**
occaecat cupidatat non proident.

Sed ut perspiciatis unde omnis iste natus **linear scalability** error sit
voluptatem, totam rem **shard space** aperiam, eaque ipsa quae ab illo Xi'an.`,

      '/more': `# More

Neque porro quisquam est qui **dolorem** ipsum quia dolor sit amet, consectetur,
adipisci velit, sed quia non numquam eius **transaction manifest** modi tempora
incidunt ut labore. Quis autem vel eum iure **reprehenderit** qui in ea voluptate
**gateway** velit esse quam nihil molestiae consequatur.

At vero eos et accusamus et iusto odio **dignissimos** ducimus qui blanditiis
praesentium voluptatum deleniti atque corrupti quos dolores et **quas molestias**
excepturi sint occaecati cupiditate non provident, gm.`,
    },
  },
];
