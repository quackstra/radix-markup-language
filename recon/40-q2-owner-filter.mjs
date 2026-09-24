// Q2: confirm the Gateway stream filter that isolates a site's own transactions.
// Hypothesis: `accounts_with_manifest_owner_method_calls` matches txs where the
// account made an owner-authorized method call (e.g. lock_fee).
//
// Natural experiment on this account:
//   - funding tx: faucet lock_fee + faucet free + account.try_deposit_batch  (NO owner call on account)
//   - publish txs: account.lock_fee + message                                (owner call on account)
// Expectation: funding tx appears when filtering by "affected entities" but NOT
// under the owner-method-calls filter; publish txs appear under both.
import { readFileSync } from 'node:fs';
import { PrivateKey } from '@radixdlt/radix-engine-toolkit';
import { addressFor, gw } from './lib.mjs';

const { privHex } = JSON.parse(readFileSync(new URL('./.account.json', import.meta.url), 'utf8'));
const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(privHex, 'hex')));
const account = await addressFor(priv);
const FUNDING_TX = 'txid_tdx_2_1m245lp2ap8eqex2w79khlax5zd6lfuec7gm6ucnlr0kqvwnf3mus3tjdqc';

async function streamAll(body) {
  const ids = [];
  let cursor = undefined;
  do {
    const r = await gw('/stream/transactions', { ...body, cursor, limit_per_page: 100 });
    for (const it of r.items) ids.push(it.intent_hash);
    cursor = r.next_cursor;
  } while (cursor && ids.length < 500);
  return ids;
}

// A: every tx that affects the account (broad).
const affected = await streamAll({
  affected_global_entities_filter: [account],
  order: 'Asc',
});

// B: txs where the account made an owner-authorized manifest method call.
let ownerCalls;
let filterAccepted = true;
try {
  ownerCalls = await streamAll({
    accounts_with_manifest_owner_method_calls: [account],
    order: 'Asc',
  });
} catch (e) {
  filterAccepted = false;
  ownerCalls = [];
  console.log('FILTER REJECTED:', e.status, JSON.stringify(e.body?.message ?? e.body));
}

console.log('account:', account);
console.log('filter accepted:', filterAccepted);
console.log('affected-entities count:', affected.length);
console.log('owner-method-calls count:', ownerCalls.length);
const ownerSet = new Set(ownerCalls);
console.log('funding tx in affected set?  ', affected.includes(FUNDING_TX));
console.log('funding tx in owner-call set?', ownerSet.has(FUNDING_TX), '(expected false)');
console.log('txs in affected-but-not-owner-call:');
for (const id of affected) if (!ownerSet.has(id)) console.log('  ', id, id === FUNDING_TX ? '<- funding (deposit only)' : '');
