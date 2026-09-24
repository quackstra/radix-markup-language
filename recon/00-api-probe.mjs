import * as ret from '@radixdlt/radix-engine-toolkit';
import * as gw from '@radixdlt/babylon-gateway-api-sdk';

console.log('=== radix-engine-toolkit exports ===');
console.log(Object.keys(ret).sort().join('\n'));
console.log('\n=== babylon-gateway-api-sdk exports ===');
console.log(Object.keys(gw).sort().join('\n'));
