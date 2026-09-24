// Isomorphic, read-only Radix Gateway helpers (global fetch; Node 18+ and browsers).
// The publisher's signing path (RET) lives in the CLI, not here — this is the
// read side any client needs: fetch a site's heads, the directory, and raw blobs.
import { MIME_TYPE } from './types.js';
import { NETWORKS, DEFAULT_NETWORK } from './config.js';
import { ownerAccountFromManifest, type RegistryRecord } from './registry.js';
import type { SiteRecord } from './resolver.js';

export interface GatewayOpts { gateway?: string; hub?: string; maxItems?: number; }

const NET = NETWORKS[DEFAULT_NETWORK]!;

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 ? '0' + hex : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

async function gw(base: string, path: string, body: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gateway ${path} -> ${res.status}`);
  return res.json();
}

async function streamAll(base: string, filter: Record<string, unknown>, maxItems: number): Promise<any[]> {
  const items: any[] = [];
  let cursor: string | undefined;
  do {
    const r = await gw(base, '/stream/transactions', { ...filter, order: 'Asc', limit_per_page: 100, cursor });
    items.push(...r.items);
    cursor = r.next_cursor;
  } while (cursor && items.length < maxItems);
  return items;
}

// Every owner-authorized, committed transaction on the site account, with its
// Quackdown head/message. Bodies (v1 blobs) are fetched separately via fetchRawPayload.
export async function fetchSiteRecords(account: string, opts: GatewayOpts = {}): Promise<SiteRecord[]> {
  const base = opts.gateway ?? NET.gateway;
  const items = await streamAll(base, { accounts_with_manifest_owner_method_calls: [account] }, opts.maxItems ?? 2000);
  const records: SiteRecord[] = [];
  for (const it of items) {
    if (it.transaction_status !== 'CommittedSuccess') continue;
    const d = await gw(base, '/transaction/committed-details', { intent_hash: it.intent_hash });
    const msg = d.transaction?.message;
    if (!msg || msg.type !== 'Plaintext' || msg.mime_type !== MIME_TYPE) continue;
    if (msg.content?.type !== 'Binary' || typeof msg.content.value_hex !== 'string') continue;
    records.push({ stateVersion: it.state_version, txId: it.intent_hash, bytes: hexToBytes(msg.content.value_hex), committedSuccess: true, ownerCall: true });
  }
  return records;
}

// Raw notarized-transaction payload (for extracting v1 blob bodies on demand).
export async function fetchRawPayload(txId: string, opts: GatewayOpts = {}): Promise<Uint8Array> {
  const base = opts.gateway ?? NET.gateway;
  const d = await gw(base, '/transaction/committed-details', { intent_hash: txId, opt_ins: { raw_hex: true } });
  if (typeof d.transaction?.raw_hex !== 'string') throw new Error('no raw_hex for ' + txId);
  return hexToBytes(d.transaction.raw_hex);
}

// Directory registrations from the hub's stream (registrant = owner call in the tx).
export async function fetchRegistryRecords(opts: GatewayOpts = {}): Promise<RegistryRecord[]> {
  const base = opts.gateway ?? NET.gateway;
  const hub = opts.hub ?? NET.hub;
  const items = await streamAll(base, { affected_global_entities_filter: [hub] }, opts.maxItems ?? 2000);
  const records: RegistryRecord[] = [];
  for (const it of items) {
    if (it.transaction_status !== 'CommittedSuccess') continue;
    const d = await gw(base, '/transaction/committed-details', { intent_hash: it.intent_hash, opt_ins: { manifest_instructions: true } });
    const msg = d.transaction?.message;
    if (!msg || msg.type !== 'Plaintext' || msg.mime_type !== MIME_TYPE) continue;
    if (msg.content?.type !== 'Binary' || typeof msg.content.value_hex !== 'string') continue;
    records.push({ registrant: ownerAccountFromManifest(d.transaction.manifest_instructions ?? ''), stateVersion: it.state_version, bytes: hexToBytes(msg.content.value_hex), committedSuccess: true });
  }
  return records;
}
