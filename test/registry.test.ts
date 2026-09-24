import { describe, it, expect } from 'vitest';
import { encodeRegister, decode } from '../src/core/envelope.js';
import { resolveRegistry, ownerAccountFromManifest, type RegistryRecord } from '../src/core/registry.js';
import { Op } from '../src/core/types.js';

const A = 'account_tdx_2_aaaa';
const B = 'account_tdx_2_bbbb';

describe('REGISTER envelope', () => {
  it('round-trips a title', () => {
    const e = decode(encodeRegister('My Site'));
    expect(e.op).toBe(Op.REGISTER);
    if (e.op === Op.REGISTER) expect(e.title).toBe('My Site');
  });
  it('empty title decodes as undefined', () => {
    const e = decode(encodeRegister(''));
    if (e.op === Op.REGISTER) expect(e.title).toBeUndefined();
  });
});

describe('ownerAccountFromManifest', () => {
  it('extracts the lock_fee account', () => {
    const m = `CALL_METHOD Address("${A}") "lock_fee" Decimal("5");\nCALL_METHOD Address("${B}") "withdraw" ...`;
    expect(ownerAccountFromManifest(m)).toBe(A);
  });
  it('returns null when no lock_fee', () => {
    expect(ownerAccountFromManifest('CALL_METHOD Address("x") "free";')).toBeNull();
  });
});

describe('resolveRegistry', () => {
  const rec = (registrant: string | null, title: string, sv: number, over: Partial<RegistryRecord> = {}): RegistryRecord =>
    ({ registrant, stateVersion: sv, bytes: encodeRegister(title), committedSuccess: true, ...over });

  it('lists registrants, newest first, latest title per account', () => {
    const out = resolveRegistry([
      rec(A, 'Old A', 1),
      rec(B, 'Site B', 2),
      rec(A, 'New A', 3),
    ]);
    expect(out.map((e) => e.account)).toEqual([A, B]); // A newest (sv3), then B (sv2)
    expect(out.find((e) => e.account === A)!.title).toBe('New A');
  });

  it('drops records with no owner account (registrant null)', () => {
    expect(resolveRegistry([rec(null, 'ghost', 5)])).toEqual([]);
  });

  it('drops uncommitted registrations', () => {
    expect(resolveRegistry([rec(A, 'x', 1, { committedSuccess: false })])).toEqual([]);
  });

  it('ignores non-REGISTER envelopes', () => {
    expect(resolveRegistry([{ registrant: A, stateVersion: 1, committedSuccess: true, bytes: Uint8Array.from([1, 2, 3]) }])).toEqual([]);
  });
});
