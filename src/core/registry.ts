// Quackdown directory resolver — isomorphic. Builds the list of registered site
// accounts from the hub's transaction stream.
//
// Trust model (same as the page resolver): the registrant account is the account
// that made the owner-authorized call in the registration tx — read from the
// LEDGER, never from the envelope. So an account can only list itself.
import { decode } from './envelope.js';
import { Op } from './types.js';

export interface RegistryRecord {
  registrant: string | null; // owner-call account for this tx (from the manifest)
  stateVersion: number;
  bytes: Uint8Array; // the REGISTER message envelope
  committedSuccess: boolean;
}

export interface RegistryEntry {
  account: string;
  title?: string;
  stateVersion: number;
}

// Extract the account that locked the fee (the owner-authorized signer) from a
// transaction's manifest instructions string. That account IS the registrant.
const LOCK_FEE_RE = /CALL_METHOD\s+Address\("(account_[a-z0-9_]+)"\)\s+"lock_fee"/;
export function ownerAccountFromManifest(manifestInstructions: string): string | null {
  return manifestInstructions.match(LOCK_FEE_RE)?.[1] ?? null;
}

export function resolveRegistry(records: RegistryRecord[]): RegistryEntry[] {
  const latest = new Map<string, RegistryEntry>();
  for (const rec of records) {
    if (!rec.committedSuccess || !rec.registrant) continue;
    let env;
    try { env = decode(rec.bytes); } catch { continue; }
    if (env.op !== Op.REGISTER) continue;
    const prev = latest.get(rec.registrant);
    if (!prev || rec.stateVersion > prev.stateVersion) {
      latest.set(rec.registrant, { account: rec.registrant, title: env.title, stateVersion: rec.stateVersion });
    }
  }
  // Newest registrations first.
  return [...latest.values()].sort((a, b) => b.stateVersion - a.stateVersion);
}
