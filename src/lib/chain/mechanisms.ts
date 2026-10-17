/**
 * Token launch mechanisms. Only mechanisms with a documented, verifiable interface are enabled.
 * Client-safe.
 */
export interface LaunchMechanism {
  id: string;
  name: string;
  enabled: boolean;
  summary: string;
  feeDisclosure: string;
  unavailableReason?: string;
  docsUrl?: string;
}

export const LAUNCH_MECHANISMS: LaunchMechanism[] = [
  {
    id: "standard-erc20",
    name: "Standard fixed-supply ERC-20",
    enabled: true,
    summary:
      "Deploys RoviumAgentToken (OpenZeppelin ERC-20) directly from your wallet. Entire supply is minted to you. No owner, minting, fees or upgradeability. No liquidity pool is created.",
    feeDisclosure:
      "RoviumPad charges no fee. You pay only the network gas for the deployment transaction, shown before you confirm.",
  },
  {
    id: "pons",
    name: "Pons launchpad (pons.family)",
    enabled: false,
    summary: "Bonding-curve / Uniswap V3 launches on Robinhood Chain.",
    feeDisclosure: "—",
    unavailableReason:
      "Pons does not publish a documented token-creation interface. Public indexer documentation only covers read-only events and views, so RoviumPad does not integrate it. This will be enabled only through an authorized, documented integration.",
    docsUrl: "https://docs.mobula.io/almanac/robinhood-launchpads/pons",
  },
];

export const enabledMechanism = (id: string) => LAUNCH_MECHANISMS.find((m) => m.id === id && m.enabled);
