// The reader's Gateway access is the isomorphic read-side helpers from the core
// package — one source of truth, no duplication.
export { fetchSiteRecords, fetchRegistryRecords, fetchRawPayload } from '../../src/core/gateway.js';
export { NETWORKS, DEFAULT_NETWORK } from '../../src/core/config.js';
