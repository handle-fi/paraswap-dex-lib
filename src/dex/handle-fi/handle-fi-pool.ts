import { DeepReadonly } from 'ts-essentials';
import { Lens, lens } from '../../lens';
import { Address, Log, Logger, MultiCallInput } from '../../types';
import { ComposedEventSubscriber } from '../../composed-event-subscriber';
import { IDexHelper } from '../../dex-helper/idex-helper';
import { PoolState, DexParams, PoolConfig } from './types';
import { Vault } from './vault';
import { USDG } from './usdg';
import { Contract } from 'web3-eth-contract';
import ReaderABI from '../../abi/handle-fi/Reader.json';
import { VaultPriceFeed } from './vault-price-feed';

const MAX_AMOUNT_IN_CACHE_TTL = 5 * 60;

export class HandleFiEventPool extends ComposedEventSubscriber<PoolState> {
  PRICE_PRECISION = 10n ** 30n;
  USDG_DECIMALS = 18;
  BASIS_POINTS_DIVISOR = 10000n;

  vault: Vault<PoolState>;
  reader: Contract;

  constructor(
    protected parentName: string,
    protected network: number,
    protected dexHelper: IDexHelper,
    logger: Logger,
    config: PoolConfig,
  ) {
    const usdg = new USDG(
      config.usdgAddress,
      lens<DeepReadonly<PoolState>>().usdg,
      dexHelper.getLogger(`${parentName}-${network} USDG`),
    );
    const vault = new Vault(
      config.vaultAddress,
      config.tokenAddresses,
      config.vaultConfig,
      config.priceFeedConfig,
      usdg,
      lens<DeepReadonly<PoolState>>().vault,
      dexHelper.getLogger(`${parentName}-${network} vault`),
    );
    super(
      parentName,
      dexHelper.getLogger(`${parentName}-${network}`),
      dexHelper,
      [usdg, vault],
      {
        vault: {
          usdgAmounts: {},
        },
        usdg: {
          totalSupply: 0n,
        },
      },
    );
    this.vault = vault;
    this.reader = new this.dexHelper.web3Provider.eth.Contract(
      ReaderABI as any,
      config.readerAddress,
    );
  }

  async getStateOrGenerate(blockNumber: number): Promise<Readonly<PoolState>> {
    const evenState = this.getState(blockNumber);
    if (evenState) return evenState;
    const onChainState = await this.generateState(blockNumber);
    this.setState(onChainState, blockNumber);
    return onChainState;
  }

  async getMaxAmountIn(_tokenIn: Address, _tokenOut: Address): Promise<bigint> {
    const cacheKey = `maxAmountIn_${_tokenIn}_${_tokenOut}`;
    const maxAmountCached = await this.dexHelper.cache.get(
      this.parentName,
      this.network,
      cacheKey,
    );
    if (maxAmountCached) return BigInt(maxAmountCached);
    const maxAmount: string = await this.reader.methods
      .getMaxAmountIn(this.vault.vaultAddress, _tokenIn, _tokenOut)
      .call();
    this.dexHelper.cache.setex(
      this.parentName,
      this.network,
      cacheKey,
      MAX_AMOUNT_IN_CACHE_TTL,
      maxAmount,
    );
    return BigInt(maxAmount);
  }

  // async getMaxAmountIn0(state: DeepReadonly<PoolState>, _tokenIn: Address, _tokenOut: Address): Promise<bigint> {
  //   const priceIn = await this.vault.getMinPrice(state, _tokenIn);
  //   const priceOut = await this.vault.getMaxPrice(state, _tokenOut);

  //   const tokenInDecimals = this.vault.tokenDecimals[_tokenIn];
  //   const tokenOutDecimals = this.vault.tokenDecimals[_tokenOut];

  //   let amountIn: bigint;
  //   {
  //       const poolAmount = this.vault.poolAmounts(_tokenOut);
  //       const reservedAmount = this.vault.reservedAmounts(_tokenOut);
  //       const bufferAmount = this.vault.bufferAmounts(_tokenOut);
  //       const subAmount = reservedAmount > bufferAmount
  //           ? reservedAmount
  //           : bufferAmount;
  //       if (subAmount >= poolAmount) {
  //           return 0n;
  //       }
  //       const availableAmount = poolAmount.sub(subAmount);
  //       amountIn = availableAmount
  //           .mul(priceOut)
  //           .div(priceIn)
  //           .mul(10**tokenInDecimals)
  //           .div(10**tokenOutDecimals);
  //   }

  //   const maxUsdgAmount = this.vault.maxUsdgAmounts(_tokenIn);

  //   if (maxUsdgAmount != 0) {
  //       if (maxUsdgAmount < this.vault.getUSDGAmount(state, _tokenIn)) {
  //           return 0n;
  //       }

  //       let maxAmountIn = maxUsdgAmount.sub(
  //           this.vault.getUSDGAmount(state, _tokenIn)
  //       );
  //       maxAmountIn = maxAmountIn.mul(10**tokenInDecimals).div(
  //           10**this.USDG_DECIMALS
  //       );
  //       maxAmountIn = maxAmountIn.mul(this.PRICE_PRECISION).div(priceIn);

  //       if (amountIn > maxAmountIn) {
  //           return maxAmountIn;
  //       }
  //   }

  //   return amountIn;
  // }

  // Reference to the original implementation
  // https://github.com/gmx-io/gmx-contracts/blob/master/contracts/peripherals/Reader.sol#L71
  async getAmountOut(
    _tokenIn: Address,
    _tokenOut: Address,
    _amountsIn: bigint[],
    blockNumber: number,
  ): Promise<bigint[] | null> {
    // TODO rewrite this in a way that works with H2SO
    // const maxAmountIn = await this.getMaxAmountIn(_tokenIn, _tokenOut);
    const state = await this.getStateOrGenerate(blockNumber);
    const priceIn = await this.vault.getMinPrice(state, _tokenIn);
    const priceOut = await this.vault.getMaxPrice(state, _tokenOut);

    const tokenInDecimals = this.vault.tokenDecimals[_tokenIn];
    const tokenOutDecimals = this.vault.tokenDecimals[_tokenOut];

    const isStableSwap =
      this.vault.stableTokens[_tokenIn] && this.vault.stableTokens[_tokenOut];
    const baseBps = isStableSwap
      ? this.vault.stableSwapFeeBasisPoints
      : this.vault.swapFeeBasisPoints;
    const taxBps = isStableSwap
      ? this.vault.stableTaxBasisPoints
      : this.vault.taxBasisPoints;
    const USDGUnit = BigInt(10 ** this.USDG_DECIMALS);
    const tokenInUnit = BigInt(10 ** tokenInDecimals);
    const tokenOutUnit = BigInt(10 ** tokenOutDecimals);

    return _amountsIn.map(_amountIn => {
      // if (_amountIn > maxAmountIn) return 0n;
      let feeBasisPoints;
      {
        let usdgAmount = (_amountIn * priceIn) / this.PRICE_PRECISION;
        usdgAmount = (usdgAmount * USDGUnit) / tokenInUnit;

        const feesBasisPoints0 = this.vault.getFeeBasisPoints(
          state,
          _tokenIn,
          usdgAmount,
          baseBps,
          taxBps,
          true,
        );
        const feesBasisPoints1 = this.vault.getFeeBasisPoints(
          state,
          _tokenOut,
          usdgAmount,
          baseBps,
          taxBps,
          false,
        );
        // use the higher of the two fee basis points
        feeBasisPoints =
          feesBasisPoints0 > feesBasisPoints1
            ? feesBasisPoints0
            : feesBasisPoints1;
      }

      let amountOut = (_amountIn * priceIn) / priceOut;
      amountOut = (amountOut * tokenOutUnit) / tokenInUnit;

      const amountOutAfterFees =
        (amountOut * (this.BASIS_POINTS_DIVISOR - feeBasisPoints)) /
        this.BASIS_POINTS_DIVISOR;
      return amountOutAfterFees;
    });
  }

  static async getWhitelistedTokens(
    vaultAddress: Address,
    blockNumber: number | 'latest',
    multiContract: Contract,
  ) {
    // get tokens count
    const tokenCountResult = (
      await multiContract.methods
        .aggregate([
          {
            callData: Vault.interface.encodeFunctionData(
              'allWhitelistedTokensLength',
            ),
            target: vaultAddress,
          },
        ])
        .call({}, blockNumber)
    ).returnData;
    const tokensCount = parseInt(
      Vault.interface
        .decodeFunctionResult('allWhitelistedTokensLength', tokenCountResult[0])
        .toString(),
    );

    // get tokens
    const getTokensCalldata = new Array(tokensCount).fill(0).map((_, i) => {
      return {
        callData: Vault.interface.encodeFunctionData('allWhitelistedTokens', [
          i,
        ]),
        target: vaultAddress,
      };
    });
    const tokensResult = (
      await multiContract.methods
        .aggregate(getTokensCalldata)
        .call({}, blockNumber)
    ).returnData;
    const tokens: Address[] = tokensResult.map((t: any) =>
      Vault.interface
        .decodeFunctionResult('allWhitelistedTokens', t)[0]
        .toLowerCase(),
    );
    return tokens;
  }

  static async getConfig(
    dexParams: DexParams,
    blockNumber: number | 'latest',
    multiContract: Contract,
  ): Promise<PoolConfig> {
    const tokens = await this.getWhitelistedTokens(
      dexParams.vault,
      blockNumber,
      multiContract,
    );

    // get config for all event listeners
    let multicallSlices: [number, number][] = [];
    let multiCallData: MultiCallInput[] = [];
    let i = 0;

    const vaultConfigCallData = Vault.getConfigMulticallInputs(
      dexParams.vault,
      tokens,
    );
    multiCallData.push(...vaultConfigCallData);
    multicallSlices.push([i, i + vaultConfigCallData.length]);
    i += vaultConfigCallData.length;

    const configResults = (
      await multiContract.methods.aggregate(multiCallData).call({}, blockNumber)
    ).returnData;

    const vaultConfigResults = configResults.slice(...multicallSlices.shift()!);
    const vaultConfig = Vault.getConfig(vaultConfigResults, tokens);

    const priceFeedMulticallInput = VaultPriceFeed.getConfigMulticallInputs(
      dexParams.priceFeed,
      tokens,
    );
    const priceFeedMulticallOutput = await multiContract.methods
      .aggregate(priceFeedMulticallInput)
      .call({}, blockNumber);
    const priceFeedConfig = VaultPriceFeed.getConfig(
      priceFeedMulticallOutput.returnData,
      tokens,
    );

    return {
      vaultAddress: dexParams.vault,
      usdgAddress: dexParams.usdg,
      tokenAddresses: tokens,
      vaultConfig,
      priceFeedConfig,
      priceFeedAddress: dexParams.priceFeed,
      readerAddress: dexParams.reader,
    };
  }
}
