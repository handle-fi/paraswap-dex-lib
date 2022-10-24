import { Address } from '../../types';

export type PoolState = {
  vault: VaultState;
  usdg: USDGState;
};

export type HandleFiData = {
  // TODO: HandleFiData is the dex data that is
  // returned by the API that can be used for
  // tx building. The data structure should be minimal.
  // Complete me!
  // exchange: Address;
};

export type DexParams = {
  vault: Address;
  usdg: Address;
  priceFeed: Address;
  router: Address;
  reader: Address;
};

export type VaultConfig = {
  tokenDecimals: { [address: string]: number };
  stableTokens: { [address: string]: boolean };
  tokenWeights: { [address: string]: bigint };
  stableSwapFeeBasisPoints: bigint;
  swapFeeBasisPoints: bigint;
  stableTaxBasisPoints: bigint;
  taxBasisPoints: bigint;
  hasDynamicFees: bigint;
  totalTokenWeights: bigint;
};

export type VaultState = {
  usdgAmounts: { [tokenAddress: string]: bigint };
};

export type USDGState = {
  totalSupply: bigint;
};

export type VaultPriceFeedConfig = {
  isAmmEnabled: boolean;
  isSecondaryPriceEnabled: boolean;
  strictStableTokens: { [address: string]: boolean };
  spreadBasisPoints: { [address: string]: bigint };
  adjustmentBasisPoints: { [address: string]: bigint };
  isAdjustmentAdditive: { [address: string]: boolean };
  priceDecimals: { [address: string]: number };
  maxStrictPriceDeviation: bigint;
  useV2Pricing: boolean;
  priceSampleSpace: number;
};

export type PoolConfig = {
  vaultAddress: Address;
  vaultConfig: VaultConfig;
  priceFeedAddress: Address;
  priceFeedConfig: VaultPriceFeedConfig;
  usdgAddress: Address;
  tokenAddresses: Address[];
  readerAddress: Address;
};
