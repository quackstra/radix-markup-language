// Read-only Stokenet Gateway client for the reader. Fetch-only; no signing, no
// RET/WASM. Mirrors the CLI's fetchSiteRecords: owner-call filter + CommittedSuccess.
import { MIME_TYPE } from '../../src/core/types.js';
import type { SiteRecord } from '../../src/core/resolver.js';
import { hexToBytes } from './browser-env.js';

export const GATEWAY = 'https://stokenet.radixdlt.com';

async function gw(path: string, body: unknown): Promise<any> {
  const res = await fetch(GATEWAY + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gateway ${path} -> ${res.status}`);
  return res.json();
}

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
    if (it.transaction_status !== 'CommittedSuccess') continue;
    const d = await gw('/transaction/committed-details', { intent_hash: it.intent_hash });
    const msg = d.transaction?.message;
    if (!msg || msg.type !== 'Plaintext' || msg.mime_type !== MIME_TYPE) continue;
    if (msg.content?.type !== 'Binary' || typeof msg.content.value_hex !== 'string') continue;
    records.push({
      stateVersion: it.state_version,
      txId: it.intent_hash,
      bytes: hexToBytes(msg.content.value_hex),
      committedSuccess: true,
      ownerCall: true, // guaranteed by the owner-method-calls filter
    });
  }
  return records;
}
