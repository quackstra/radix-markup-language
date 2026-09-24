// Generate the well-known Quackdown directory hub account (a public drop-box).
// Its key is NOT needed to operate the registry (people only deposit to it); we
// save it gitignored only so we could optionally sweep dust later. The ADDRESS
// is public and gets hardcoded into src/core/config.ts.
import { writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { PrivateKey, NetworkId, LTSRadixEngineToolkit } from '@radixdlt/radix-engine-toolkit';

const bytes = new Uint8Array(randomBytes(32));
const priv = new PrivateKey.Ed25519(bytes);
const address = await LTSRadixEngineToolkit.Derive.virtualAccountAddress(priv.publicKey(), NetworkId.Stokenet);
writeFileSync(new URL('./.hub-key.json', import.meta.url), JSON.stringify({ privHex: Buffer.from(bytes).toString('hex'), address }, null, 2));
console.log('HUB_STOKENET =', address);
