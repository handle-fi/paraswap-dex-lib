import _ from 'lodash';
import { Contract } from 'web3-eth-contract';
import { Interface } from '@ethersproject/abi';
import {
  Token,
  Address,
  ExchangePrices,
  PoolPrices,
  AdapterExchangeParam,
  SimpleExchangeParam,
  PoolLiquidity,
  Logger,
} from '../../types';
import { SwapSide, Network, SUBGRAPH_TIMEOUT } from '../../constants';
import * as CALLDATA_GAS_COST from '../../calldata-gas-cost';
import { getDexKeysWithNetwork, getBigIntPow, isETHAddress } from '../../utils';
import { IDex } from '../../dex/idex';
import { IDexHelper } from '../../dex-helper/idex-helper';
import {
  BalancerV1Data,
  OptimizedBalancerV1Data,
  DexParams,
  PoolsInfo,
  PoolInfo,
  FractionAsString,
  BalancerParam,
  BalancerFunctions,
} from './types';
import { SimpleExchange } from '../simple-exchange';
import {
  BalancerV1Config,
  Adapters,
  POOLS_FETCH_TIMEOUT,
  MAX_POOLS_FOR_PRICING,
  BALANCER_SWAP_GAS_COST,
} from './config';
import { BalancerV1EventPool } from './balancer-v1-pool';
import { generatePoolStates } from './utils';
import BalancerV1ExchangeProxyABI from '../../abi/BalancerV1ExchangeProxy.json';
import BalancerCustomMulticallABI from '../../abi/BalancerCustomMulticall.json';

export class BalancerV1
  extends SimpleExchange
  implements IDex<BalancerV1Data | OptimizedBalancerV1Data>
{
  static readonly proxyIface = new Interface(BalancerV1ExchangeProxyABI);

  protected config: DexParams;
  protected poolsInfo?: PoolsInfo;
  protected poolInfosByToken: { [tokenAddress: string]: PoolInfo[] } = {};

  protected eventPools: { [poolAddress: string]: BalancerV1EventPool } = {};

  readonly hasConstantPriceLargeAmounts = false;
  readonly needWrapNative = false;
  readonly isFeeOnTransferSupported = false;

  public static dexKeysWithNetwork: { key: string; networks: Network[] }[] =
    getDexKeysWithNetwork(BalancerV1Config);

  logger: Logger;

  private balancerMulticall: Contract;

  constructor(
    readonly network: Network,
    readonly dexKey: string,
    readonly dexHelper: IDexHelper,
    protected adapters = Adapters[network] || {},
  ) {
    super(dexHelper.config.data.augustusAddress, dexHelper.web3Provider);
    this.config = BalancerV1Config[dexKey][network];
    this.logger = dexHelper.getLogger(dexKey);
    this.balancerMulticall = new dexHelper.web3Provider.eth.Contract(
      BalancerCustomMulticallABI as any,
      this.config.multicallAddress,
    );
  }

  // Initialize pricing is called once in the start of
  // pricing service. It is intended to setup the integration
  // for pricing requests. It is optional for a DEX to
  // implement this function
  async initializePricing(_blockNumber: number) {
    this.poolsInfo = await this.dexHelper.httpRequest.get<PoolsInfo>(
      this.config.poolsURL,
      POOLS_FETCH_TIMEOUT,
    );
    this.poolInfosByToken = {};
    for (const poolInfo of this.poolsInfo.pools) {
      for (const tokenAddress of poolInfo.tokensList) {
        if (!this.poolInfosByToken[tokenAddress]) {
          this.poolInfosByToken[tokenAddress] = [];
        }
        this.poolInfosByToken[tokenAddress].push(poolInfo);
      }
    }
  }

  getPoolInfosWithTokens(from: Token, to: Token): PoolInfo[] {
    const fromPools = this.poolInfosByToken[from.address];
    const toPools = this.poolInfosByToken[to.address];
    if (!fromPools || !toPools) return [];
    return _.intersectionBy(fromPools, toPools, 'id');
  }

  // Returns the list of contract adapters (name and index)
  // for a buy/sell. Return null if there are no adapters.
  getAdapters(side: SwapSide): { name: string; index: number }[] | null {
    return this.adapters[side] ? this.adapters[side] : null;
  }

  // Returns list of pool identifiers that can be used
  // for a given swap. poolIdentifiers must be unique
  // across DEXes. It is recommended to use
  // ${dexKey}_${poolAddress} as a poolIdentifier
  async getPoolIdentifiers(
    srcToken: Token,
    destToken: Token,
    _side: SwapSide,
    _blockNumber: number,
  ): Promise<string[]> {
    if (!this.poolsInfo) return [];

    const from = this.dexHelper.config.wrapETH(srcToken);
    const to = this.dexHelper.config.wrapETH(destToken);
    from.address = from.address.toLowerCase();
    to.address = to.address.toLowerCase();
    if (from.address === to.address) return [];

    const poolInfos = this.getPoolInfosWithTokens(from, to);
    return poolInfos.map(p => `${this.dexKey}_${p.id}`);
  }

  // Returns pool prices for amounts.
  // If limitPools is defined only pools in limitPools
  // should be used. If limitPools is undefined then
  // any pools can be used.
  async getPricesVolume(
    srcToken: Token,
    destToken: Token,
    amounts: bigint[],
    side: SwapSide,
    blockNumber: number,
    limitPools?: string[],
  ): Promise<null | ExchangePrices<BalancerV1Data>> {
    if (!this.poolsInfo) return null;

    const from = this.dexHelper.config.wrapETH(srcToken);
    const to = this.dexHelper.config.wrapETH(destToken);
    from.address = from.address.toLowerCase();
    to.address = to.address.toLowerCase();
    if (from.address === to.address) return null;

    let poolInfos = this.getPoolInfosWithTokens(from, to);
    if (!poolInfos.length) return null;
    if (limitPools) {
      poolInfos = poolInfos.filter(p =>
        limitPools.includes(`${this.dexKey}_${p.id}`),
      );
    }
    if (!poolInfos.length) return null;

    const poolsMissingState: PoolInfo[] = [];
    for (const poolInfo of poolInfos) {
      const eventPool = this.eventPools[poolInfo.id];
      if (!eventPool || !eventPool.getState(blockNumber)) {
        poolsMissingState.push(poolInfo);
      }
    }
    if (poolsMissingState.length) {
      const poolStates = await generatePoolStates(
        poolsMissingState,
        this.balancerMulticall,
        blockNumber,
      );
      for (let i = 0; i < poolsMissingState.length; ++i) {
        const poolInfo = poolsMissingState[i];
        const poolState = poolStates[i];
        if (this.eventPools[poolInfo.id]) {
          this.eventPools[poolInfo.id].setState(poolState, blockNumber);
        } else {
          const newPool = new BalancerV1EventPool(
            this.dexKey,
            this.network,
            this.dexHelper,
            this.logger,
            this.balancerMulticall,
            poolInfo,
          );
          newPool.setState(poolState, blockNumber);
          this.dexHelper.blockManager.subscribeToLogs(
            newPool,
            newPool.addressesSubscribed,
            blockNumber,
          );
          this.eventPools[poolInfo.id] = newPool;
        }
      }
    }

    const pools = poolInfos
      .map(p => this.eventPools[p.id])
      .filter(p => p.checkBalance(from, to, amounts[1], side, blockNumber))
      .map(p => ({
        pool: p,
        score: p.estimatePoolTotalBalance(to, blockNumber),
      }))
      .sort((a, b) => (a.score < b.score ? 1 : a.score > b.score ? -1 : 0))
      .slice(0, MAX_POOLS_FOR_PRICING)
      .map(ps => ps.pool);
    if (!pools.length) return null;

    const amountsWithUnit = [
      getBigIntPow((side === SwapSide.SELL ? from : to).decimals),
      ...amounts.slice(1),
    ];
    return pools.map(p => {
      const rates = p.calcPrices(from, to, amountsWithUnit, side, blockNumber);

      return {
        unit: rates[0],
        prices: [0n, ...rates.slice(1)],
        data: {
          poolId: p.poolInfo.id,
        },
        poolAddresses: [p.poolInfo.id],
        exchange: this.dexKey,
        gasCost: BALANCER_SWAP_GAS_COST,
        poolIdentifier: `${this.dexKey}_${p.poolInfo.id}`,
      };
    });
  }

  // Returns estimated gas cost of calldata for this DEX in multiSwap
  getCalldataGasCost(
    _poolPrices: PoolPrices<BalancerV1Data>,
  ): number | number[] {
    return (
      CALLDATA_GAS_COST.DEX_OVERHEAD +
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> swaps[] header
      CALLDATA_GAS_COST.OFFSET_SMALL +
      // ParentStruct -> swaps[]
      CALLDATA_GAS_COST.LENGTH_SMALL +
      // ParentStruct -> swaps[0]
      CALLDATA_GAS_COST.ADDRESS +
      CALLDATA_GAS_COST.AMOUNT +
      CALLDATA_GAS_COST.AMOUNT +
      CALLDATA_GAS_COST.FULL_WORD
    );
  }

  // Encode params required by the exchange adapter
  // Used for multiSwap, buy & megaSwap
  // Hint: abiCoder.encodeParameter() could be useful
  getAdapterParam(
    _srcToken: string,
    _destToken: string,
    _srcAmount: string,
    _destAmount: string,
    data: OptimizedBalancerV1Data,
    _side: SwapSide,
  ): AdapterExchangeParam {
    const { swaps } = data;
    const payload = this.abiCoder.encodeParameter(
      {
        ParentStruct: {
          'swaps[]': {
            pool: 'address',
            tokenInParam: 'uint',
            tokenOutParam: 'uint',
            maxPrice: 'uint',
          },
        },
      },
      { swaps },
    );

    return {
      targetExchange: this.config.exchangeProxy,
      payload,
      networkFee: '0',
    };
  }

  // Encode call data used by simpleSwap like routers
  // Used for simpleSwap & simpleBuy
  // Hint: this.buildSimpleParamWithoutWETHConversion
  // could be useful
  async getSimpleParam(
    srcToken: string,
    destToken: string,
    srcAmount: string,
    destAmount: string,
    data: OptimizedBalancerV1Data,
    side: SwapSide,
  ): Promise<SimpleExchangeParam> {
    const { swaps } = data;

    if (side === SwapSide.BUY) {
      // Need to adjust the swap input params to match the adjusted srcAmount
      const _srcAmount = BigInt(srcAmount);
      const totalInParam = swaps.reduce(
        (acc, swap) => acc + BigInt(swap.tokenInParam),
        0n,
      );
      swaps.forEach(swap => {
        swap.tokenInParam = (
          (BigInt(swap.tokenInParam) * _srcAmount) /
          totalInParam
        ).toString();
      });
    }

    const [swapFunction, swapFunctionParam] = ((): [
      swapFunction: BalancerFunctions,
      swapFunctionParam: BalancerParam,
    ] => {
      if (side === SwapSide.SELL) {
        if (isETHAddress(srcToken))
          return [
            BalancerFunctions.batchEthInSwapExactIn,
            [swaps, destToken, destAmount],
          ];
        if (isETHAddress(destToken))
          return [
            BalancerFunctions.batchEthOutSwapExactIn,
            [swaps, srcToken, srcAmount, destAmount],
          ];
        return [
          BalancerFunctions.batchSwapExactIn,
          [swaps, srcToken, destToken, srcAmount, destAmount],
        ];
      } else {
        if (isETHAddress(srcToken))
          return [BalancerFunctions.batchEthInSwapExactOut, [swaps, destToken]];
        if (isETHAddress(destToken))
          return [
            BalancerFunctions.batchEthOutSwapExactOut,
            [swaps, srcToken, srcAmount],
          ];
        return [
          BalancerFunctions.batchSwapExactOut,
          [swaps, srcToken, destToken, srcAmount],
        ];
      }
    })();

    const swapData = BalancerV1.proxyIface.encodeFunctionData(
      swapFunction,
      swapFunctionParam,
    );

    return this.buildSimpleParamWithoutWETHConversion(
      srcToken,
      srcAmount,
      destToken,
      destAmount,
      swapData,
      this.config.exchangeProxy,
    );
  }

  // Returns list of top pools based on liquidity. Max
  // limit number pools should be returned.
  async getTopPoolsForToken(
    tokenAddress: Address,
    limit: number,
  ): Promise<PoolLiquidity[]> {
    tokenAddress = tokenAddress.toLowerCase();

    const variables = {
      tokens: [tokenAddress],
      limit,
    };

    const query = `query ($tokens: [Bytes!], $limit: Int) {
      pools (
        first: $limit, orderBy: liquidity, orderDirection: desc,
        where: {
          tokensList_contains: $tokens,
          active: true,
          publicSwap: true,
          liquidity_gt: 0,
          liquidity_lt: 1000000000
        }
      ) {
        id
        liquidity
        tokens {
          address
          decimals
        }
      }
    }`;
    const { data } = await this.dexHelper.httpRequest.post<{
      data: {
        pools: {
          id: Address;
          liquidity: FractionAsString;
          tokens: {
            address: Address;
            decimals: number;
          }[];
        }[];
      };
    }>(this.config.subgraphURL, { query, variables }, SUBGRAPH_TIMEOUT);

    if (!(data && data.pools))
      throw new Error(
        `Error ${this.dexKey} Subgraph: couldn't fetch the pools from the subgraph`,
      );

    return data.pools.map(pool => ({
      exchange: this.dexKey,
      address: pool.id,
      connectorTokens: pool.tokens.reduce<Token[]>(
        (acc, { decimals, address }) => {
          if (address !== tokenAddress) acc.push({ decimals, address });
          return acc;
        },
        [],
      ),
      liquidityUSD: parseFloat(pool.liquidity),
    }));
  }
}
