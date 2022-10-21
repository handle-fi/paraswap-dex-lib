import { Interface } from '@ethersproject/abi';
import { Address, MultiCallInput, MultiCallOutput } from '../../types';
import { PoolState, VaultPriceFeedConfig } from './types';
import VaultPriceFeedAbi from '../../abi/handle-fi/VaultPriceFeed.json';
import { ChainLinkSubscriber } from '../../lib/chainlink';
import { DeepReadonly } from 'ts-essentials';

export class VaultPriceFeed<State> {
  BASIS_POINTS_DIVISOR = 10000n;
  PRICE_PRECISION = 10n ** 30n;
  ONE_USD = this.PRICE_PRECISION;

  static interface = new Interface(VaultPriceFeedAbi as any);

  protected isAmmEnabled: boolean;
  protected isSecondaryPriceEnabled: boolean;
  protected strictStableTokens: { [address: string]: boolean };
  protected spreadBasisPoints: { [address: string]: bigint };
  protected adjustmentBasisPoints: { [address: string]: bigint };
  protected isAdjustmentAdditive: { [address: string]: boolean };
  protected priceDecimals: { [address: string]: number };
  protected maxStrictPriceDeviation: bigint;
  protected useV2Pricing: boolean;
  protected priceSampleSpace: number;

  constructor(config: VaultPriceFeedConfig) {
    this.isAmmEnabled = config.isAmmEnabled;
    this.isSecondaryPriceEnabled = config.isSecondaryPriceEnabled;
    this.strictStableTokens = config.strictStableTokens;
    this.spreadBasisPoints = config.spreadBasisPoints;
    this.adjustmentBasisPoints = config.adjustmentBasisPoints;
    this.isAdjustmentAdditive = config.isAdjustmentAdditive;
    this.priceDecimals = config.priceDecimals;
    this.maxStrictPriceDeviation = config.maxStrictPriceDeviation;
    this.useV2Pricing = config.useV2Pricing;
    this.priceSampleSpace = config.priceSampleSpace;
  }

  getMaxPrice(price: bigint, token: string) {
    return (
      (price * (this.BASIS_POINTS_DIVISOR + this.spreadBasisPoints[token])) /
      this.BASIS_POINTS_DIVISOR
    );
  }

  getMinPrice(price: bigint, token: string) {
    return (
      (price * (this.BASIS_POINTS_DIVISOR - this.spreadBasisPoints[token])) /
      this.BASIS_POINTS_DIVISOR
    );
  }

  static getConfigMulticallInputs(
    vaultPriceFeedAddress: Address,
    tokenAddresses: Address[],
  ): MultiCallInput[] {
    return [
      {
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData('isAmmEnabled'),
      },
      {
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData(
          'isSecondaryPriceEnabled',
        ),
      },
      ...tokenAddresses.map(t => ({
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData(
          'strictStableTokens',
          [t],
        ),
      })),
      ...tokenAddresses.map(t => ({
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData(
          'spreadBasisPoints',
          [t],
        ),
      })),
      ...tokenAddresses.map(t => ({
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData(
          'isAdjustmentAdditive',
          [t],
        ),
      })),
      ...tokenAddresses.map(t => ({
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData(
          'adjustmentBasisPoints',
          [t],
        ),
      })),
      ...tokenAddresses.map(t => ({
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData('priceDecimals', [
          t,
        ]),
      })),
      {
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData(
          'maxStrictPriceDeviation',
        ),
      },
      {
        target: vaultPriceFeedAddress,
        callData: VaultPriceFeed.interface.encodeFunctionData('useV2Pricing'),
      },
      {
        target: vaultPriceFeedAddress,
        callData:
          VaultPriceFeed.interface.encodeFunctionData('priceSampleSpace'),
      },
    ];
  }

  static getConfig(
    multicallOutputs: MultiCallOutput[],
    tokenAddress: Address[],
  ): VaultPriceFeedConfig {
    let i = 0;
    return {
      isAmmEnabled: VaultPriceFeed.interface.decodeFunctionResult(
        'isAmmEnabled',
        multicallOutputs[i++],
      )[0],
      isSecondaryPriceEnabled: VaultPriceFeed.interface.decodeFunctionResult(
        'isSecondaryPriceEnabled',
        multicallOutputs[i++],
      )[0],
      strictStableTokens: tokenAddress.reduce(
        (acc: { [address: string]: boolean }, t: Address) => {
          acc[t] = VaultPriceFeed.interface.decodeFunctionResult(
            'strictStableTokens',
            multicallOutputs[i++],
          )[0];
          return acc;
        },
        {},
      ),
      spreadBasisPoints: tokenAddress.reduce(
        (acc: { [address: string]: bigint }, t: Address) => {
          acc[t] = BigInt(
            VaultPriceFeed.interface
              .decodeFunctionResult(
                'spreadBasisPoints',
                multicallOutputs[i++],
              )[0]
              .toString(),
          );
          return acc;
        },
        {},
      ),
      isAdjustmentAdditive: tokenAddress.reduce(
        (acc: { [address: string]: boolean }, t: Address) => {
          acc[t] = VaultPriceFeed.interface.decodeFunctionResult(
            'isAdjustmentAdditive',
            multicallOutputs[i++],
          )[0];
          return acc;
        },
        {},
      ),
      adjustmentBasisPoints: tokenAddress.reduce(
        (acc: { [address: string]: bigint }, t: Address) => {
          acc[t] = BigInt(
            VaultPriceFeed.interface
              .decodeFunctionResult(
                'adjustmentBasisPoints',
                multicallOutputs[i++],
              )[0]
              .toString(),
          );
          return acc;
        },
        {},
      ),
      priceDecimals: tokenAddress.reduce(
        (acc: { [address: string]: number }, t: Address) => {
          acc[t] = parseInt(
            VaultPriceFeed.interface
              .decodeFunctionResult('priceDecimals', multicallOutputs[i++])[0]
              .toString(),
          );
          return acc;
        },
        {},
      ),
      maxStrictPriceDeviation: BigInt(
        VaultPriceFeed.interface
          .decodeFunctionResult(
            'maxStrictPriceDeviation',
            multicallOutputs[i++],
          )[0]
          .toString(),
      ),
      useV2Pricing: VaultPriceFeed.interface.decodeFunctionResult(
        'useV2Pricing',
        multicallOutputs[i++],
      )[0],
      priceSampleSpace: parseInt(
        VaultPriceFeed.interface
          .decodeFunctionResult('priceSampleSpace', multicallOutputs[i++])[0]
          .toString(),
      ),
    };
  }
}
