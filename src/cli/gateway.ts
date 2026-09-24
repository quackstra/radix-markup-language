// Network side of the publisher: build/submit Quackdown transactions and fetch a
// site's transaction stream for the resolver. Stokenet only.
import {
  RadixEngineToolkit, LTSRadixEngineToolkit, PrivateKey, NetworkId,
  TransactionBuilder, generateRandomNonce,
} from '@radixdlt/radix-engine-toolkit';
import { MIME_TYPE, type CompressionCode } from '../core/types.js';
import type { SiteRecord } from '../core/resolver.js';
import { NETWORKS, DEFAULT_NETWORK } from '../core/config.js';
import { ownerAccountFromManifest, type RegistryRecord } from '../core/registry.js';

const NET = NETWORKS[DEFAULT_NETWORK]!;
export const NETWORK_ID = NetworkId.Stokenet; // 2
export const GATEWAY = process.env.QUACKDOWN_GATEWAY ?? NET.gateway;
export const HUB = NET.hub;

async function gw(path: string, body: unknown): Promise<any> {
  const res = await fetch(GATEWAY + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: any;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  if (!res.ok) { const e: any = new Error(`Gateway ${path} -> ${res.status}`); e.body = json; throw e; }
  return json;
}

const hex = (u8: Uint8Array) => Buffer.from(u8).toString('hex');
const fromHex = (s: string) => Uint8Array.from(Buffer.from(s, 'hex'));

export function loadSiteKey(): PrivateKey {
  const raw = process.env.QUACKDOWN_SITE_KEY;
  if (!raw) throw new Error('QUACKDOWN_SITE_KEY env var required (32-byte ed25519 hex). Never commit or log it.');
  const bytes = fromHex(raw.trim());
  if (bytes.length !== 32) throw new Error('QUACKDOWN_SITE_KEY must be 32 bytes hex');
  return new PrivateKey.Ed25519(bytes);
}

export async function siteAddress(priv: PrivateKey): Promise<string> {
  return LTSRadixEngineToolkit.Derive.virtualAccountAddress(priv.publicKey(), NETWORK_ID);
}

async function currentEpoch(): Promise<number> {
  return (await gw('/status/gateway-status', {})).ledger_state.epoch;
}

// Build, notarize and submit a transaction (single signer = notary), optionally
// carrying a Quackdown message, then wait for commit. Returns the tx id.
async function send(priv: PrivateKey, manifest: string, envelope?: Uint8Array): Promise<string> {
  const epoch = await currentEpoch();
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
  if (envelope) step = step.message({ kind: 'PlainText', value: { mimeType: MIME_TYPE, message: { kind: 'Bytes', value: envelope } } });
  const notarized = await step.manifest({ instructions: { kind: 'String', value: manifest }, blobs: [] }).notarize(priv);
  const compiled = await RadixEngineToolkit.NotarizedTransaction.compile(notarized);
  const idHash = await RadixEngineToolkit.NotarizedTransaction.intentHash(notarized);
  await gw('/transaction/submit', { notarized_transaction_hex: hex(compiled) });
  await waitForCommit(idHash.id);
  return idHash.id;
}

// Submit one message as a transaction with an owner-authorized lock_fee on the site account.
export async function submitMessage(priv: PrivateKey, account: string, envelope: Uint8Array): Promise<string> {
  return send(priv, `CALL_METHOD Address("${account}") "lock_fee" Decimal("5");`, envelope);
}

// Register in the directory: owner-call (lock_fee) on your account proves identity,
// and a dust deposit into the hub makes the registration discoverable.
export async function submitRegister(priv: PrivateKey, account: string, envelope: Uint8Array): Promise<string> {
  const xrd = await knownXrd();
  const manifest = [
    `CALL_METHOD Address("${account}") "lock_fee" Decimal("5");`,
    `CALL_METHOD Address("${account}") "withdraw" Address("${xrd}") Decimal("1");`,
    `TAKE_ALL_FROM_WORKTOP Address("${xrd}") Bucket("dust");`,
    `CALL_METHOD Address("${HUB}") "try_deposit_or_abort" Bucket("dust") None;`,
  ].join('\n');
  return send(priv, manifest, envelope);
}

let _xrd: string | undefined;
async function knownXrd(): Promise<string> {
  if (!_xrd) _xrd = (await LTSRadixEngineToolkit.Derive.knownAddresses(NETWORK_ID)).resources.xrdResource;
  return _xrd;
}

export async function waitForCommit(txId: string, tries = 40, delayMs = 2000): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const d = await gw('/transaction/committed-details', { intent_hash: txId });
      const status = d.transaction.transaction_status;
      if (status && status !== 'Pending' && status !== 'Unknown') return status;
    } catch { /* not yet indexed */ }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`timed out waiting for ${txId}`);
}

// Fetch every owner-authorized tx on the site account, with its Quackdown message.
export async function fetchSiteRecords(account: string): Promise<SiteRecord[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await gw('/stream/transactions', {
      accounts_with_manifest_owner_method_calls: [account],
      order: 'Asc',
      limit_per_page: 100,
      cursor,
    });
    items.push(...r.items);
    cursor = r.next_cursor;
  } while (cursor && items.length < 2000);

  const records: SiteRecord[] = [];
  for (const it of items) {
    const committedSuccess = it.transaction_status === 'CommittedSuccess';
    if (!committedSuccess) continue;
    const d = await gw('/transaction/committed-details', { intent_hash: it.intent_hash });
    const msg = d.transaction.message;
    if (!msg || msg.type !== 'Plaintext' || msg.mime_type !== MIME_TYPE) continue;
    if (msg.content?.type !== 'Binary' || typeof msg.content.value_hex !== 'string') continue;
    records.push({
      stateVersion: it.state_version,
      txId: it.intent_hash,
      bytes: fromHex(msg.content.value_hex),
      committedSuccess: true,
      ownerCall: true, // guaranteed by the accounts_with_manifest_owner_method_calls filter
    });
  }
  return records;
}

// Fetch directory registrations by querying the hub's transaction stream. The
// registrant account comes from each tx's owner call (manifest lock_fee).
export async function fetchRegistryRecords(): Promise<RegistryRecord[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await gw('/stream/transactions', {
      affected_global_entities_filter: [HUB],
      order: 'Desc',
      limit_per_page: 100,
      cursor,
    });
    items.push(...r.items);
    cursor = r.next_cursor;
  } while (cursor && items.length < 2000);

  const records: RegistryRecord[] = [];
  for (const it of items) {
    if (it.transaction_status !== 'CommittedSuccess') continue;
    const d = await gw('/transaction/committed-details', { intent_hash: it.intent_hash, opt_ins: { manifest_instructions: true } });
    const msg = d.transaction?.message;
    if (!msg || msg.type !== 'Plaintext' || msg.mime_type !== MIME_TYPE) continue;
    if (msg.content?.type !== 'Binary' || typeof msg.content.value_hex !== 'string') continue;
    records.push({
      registrant: ownerAccountFromManifest(d.transaction.manifest_instructions ?? ''),
      stateVersion: it.state_version,
      bytes: fromHex(msg.content.value_hex),
      committedSuccess: true,
    });
  }
  return records;
}

// Rough fee estimate from the recon curve: ~0.13 XRD base + ~0.10 XRD/KB.
export function estimateChunkFee(messageBytes: number): number {
  return 0.13 + (messageBytes / 1024) * 0.1;
}

export { fromHex };
export type { CompressionCode };
