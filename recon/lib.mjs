// Shared recon helpers for Quackdown T0 — Stokenet only.
import {
  RadixEngineToolkit,
  LTSRadixEngineToolkit,
  PrivateKey,
  NetworkId,
  TransactionBuilder,
  generateRandomNonce,
} from '@radixdlt/radix-engine-toolkit';
import { randomBytes } from 'node:crypto';

export const NETWORK_ID = NetworkId.Stokenet; // 2
export const GATEWAY = 'https://stokenet.radixdlt.com';

export async function gw(path, body) {
  const res = await fetch(GATEWAY + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (!res.ok) {
    const err = new Error(`Gateway ${path} -> HTTP ${res.status}`);
    err.status = res.status;
    err.body = json;
    throw err;
  }
  return json;
}

export async function currentEpoch() {
  const s = await gw('/status/gateway-status', {});
  return s.ledger_state.epoch;
}

export function newKey() {
  const priv = new PrivateKey.Ed25519(new Uint8Array(randomBytes(32)));
  return priv;
}

export async function addressFor(priv) {
  return LTSRadixEngineToolkit.Derive.virtualAccountAddress(priv.publicKey(), NETWORK_ID);
}

export async function knownAddresses() {
  return LTSRadixEngineToolkit.Derive.knownAddresses(NETWORK_ID);
}

const toHex = (u8) => Buffer.from(u8).toString('hex');

// Build + notarize a single-signer tx (notary is the sole signatory).
export async function buildTx({ priv, manifest, message, epoch }) {
  const header = {
    networkId: NETWORK_ID,
    startEpochInclusive: epoch,
    endEpochExclusive: epoch + 10,
    nonce: await generateRandomNonce(),
    notaryPublicKey: priv.publicKey(),
    notaryIsSignatory: true,
    tipPercentage: 0,
  };
  let step = (await TransactionBuilder.new()).header(header);
  if (message) step = step.message(message);
  const notarized = await step
    .manifest({ instructions: { kind: 'String', value: manifest }, blobs: [] })
    .notarize(priv);

  const compiled = await RadixEngineToolkit.NotarizedTransaction.compile(notarized);
  const idHash = await RadixEngineToolkit.NotarizedTransaction.intentHash(notarized);
  return { notarizedHex: toHex(compiled), txId: idHash.id, sizeBytes: compiled.length };
}

export async function submit(notarizedHex) {
  return gw('/transaction/submit', { notarized_transaction_hex: notarizedHex });
}

// Poll committed-details until the tx commits (or times out).
export async function waitForCommit(txId, { optIns, tries = 30, delayMs = 2000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const d = await gw('/transaction/committed-details', {
        intent_hash: txId,
        opt_ins: optIns ?? {
          raw_hex: true,
          receipt_fee_summary: true,
          manifest_instructions: true,
          balance_changes: true,
        },
      });
      return d;
    } catch (e) {
      // Not yet committed -> Gateway returns 4xx; keep polling.
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error(`Timed out waiting for commit of ${txId}`);
}

export { toHex };
