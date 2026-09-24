// Create (or load) a throwaway Stokenet account and fund it from the faucet.
// The private key is a disposable testnet key; it is written to .account.json
// which is gitignored. Never used on mainnet, never committed.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { PrivateKey } from '@radixdlt/radix-engine-toolkit';
import {
  NETWORK_ID, addressFor, knownAddresses, currentEpoch, buildTx, submit, waitForCommit, gw,
} from './lib.mjs';
import { randomBytes } from 'node:crypto';

const ACCOUNT_FILE = new URL('./.account.json', import.meta.url);

async function loadOrCreate() {
  if (existsSync(ACCOUNT_FILE)) {
    const { privHex } = JSON.parse(readFileSync(ACCOUNT_FILE, 'utf8'));
    const priv = new PrivateKey.Ed25519(Uint8Array.from(Buffer.from(privHex, 'hex')));
    const address = await addressFor(priv);
    return { priv, address, privHex };
  }
  const bytes = new Uint8Array(randomBytes(32));
  const priv = new PrivateKey.Ed25519(bytes);
  const address = await addressFor(priv);
  const privHex = Buffer.from(bytes).toString('hex');
  writeFileSync(ACCOUNT_FILE, JSON.stringify({ privHex, address }, null, 2));
  return { priv, address, privHex };
}

async function xrdBalance(address) {
  try {
    const d = await gw('/state/entity/details', { addresses: [address], aggregation_level: 'Global' });
    const items = d.items?.[0]?.fungible_resources?.items ?? [];
    // XRD is the network's native resource; match by symbol-free known address later.
    const known = await knownAddresses();
    const xrd = known.resources.xrdResource;
    const entry = items.find((i) => i.resource_address === xrd);
    return entry?.amount ?? '0';
  } catch { return '0'; }
}

const { priv, address } = await loadOrCreate();
console.log('Account:', address);

const known = await knownAddresses();
const faucet = known.components.faucet;
console.log('Faucet:', faucet);

let bal = await xrdBalance(address);
console.log('XRD balance before:', bal);

if (Number(bal) < 5000) {
  const epoch = await currentEpoch();
  const manifest = `
CALL_METHOD Address("${faucet}") "lock_fee" Decimal("100");
CALL_METHOD Address("${faucet}") "free";
CALL_METHOD Address("${address}") "try_deposit_batch_or_abort" Expression("ENTIRE_WORKTOP") None;
`.trim();
  const { notarizedHex, txId } = await buildTx({ priv, manifest, epoch });
  console.log('Funding tx:', txId);
  await submit(notarizedHex);
  const d = await waitForCommit(txId);
  console.log('Funding status:', d.transaction.transaction_status);
  bal = await xrdBalance(address);
  console.log('XRD balance after:', bal);
} else {
  console.log('Already funded.');
}
