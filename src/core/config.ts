// Well-known Quackdown network config. The hub is a public drop-box account:
// registrations are discovered by querying its transaction stream. Nobody needs
// its key to operate the registry — identity comes from each tx's owner call.
export interface QuackdownNetwork {
  networkId: number;
  gateway: string;
  hub: string;
  accountPrefix: string; // Bech32m HRP prefix for accounts on this network
}

export const NETWORKS: Record<string, QuackdownNetwork> = {
  stokenet: {
    networkId: 2,
    gateway: 'https://stokenet.radixdlt.com',
    hub: 'account_tdx_2_12x2fttd8m6tk4zuslssepcnxe652hcnn5d8m0neqy89fjur5uk7km4',
    accountPrefix: 'account_tdx_2_',
  },
  // mainnet: filled in when we go live (networkId 1, mainnet.radixdlt.com, account_rdx1…).
};

export const DEFAULT_NETWORK = 'stokenet';
