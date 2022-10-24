import dotenv from 'dotenv';
dotenv.config();

import { Interface, Result } from '@ethersproject/abi';
import { DummyDexHelper } from '../../dex-helper/index';
import { Network, SwapSide } from '../../constants';
import { BI_POWS } from '../../bigint-constants';
import { HandleFi } from './handle-fi';
import {
  checkPoolPrices,
  checkPoolsLiquidity,
  checkConstantPoolPrices,
} from '../../../tests/utils';
import { Tokens } from '../../../tests/constants-e2e';
import { HandleFiConfig } from './config';
import ReaderABI from '../../abi/handle-fi/Reader.json';
import { ADDRESS_TO_CURRENCY, SYMBOL_TO_ADDRESS } from './handle-config';

const network = Network.ARBITRUM;
const TokenASymbol = 'WETH';
const TokenA = Tokens[network][TokenASymbol];

const TokenBSymbol = 'fxUSD';
const TokenB = {
  address: SYMBOL_TO_ADDRESS[TokenBSymbol],
  decimals: 18,
};

const amounts = [
  0n,
  1000000000n,
  2000000000n,
  3000000000n,
  4000000000n,
  5000000000n,
];

const dexKey = 'HandleFi';
const params = HandleFiConfig[dexKey][network];
const readerInterface = new Interface(ReaderABI);

describe('HandleFi', function () {
  it('getPoolIdentifiers and getPricesVolume SELL', async function () {
    const dexHelper = new DummyDexHelper(network);
    const blocknumber = await dexHelper.web3Provider.eth.getBlockNumber();
    const handleFi = new HandleFi(network, dexKey, dexHelper);

    await handleFi.initializePricing(blocknumber);

    const pools = await handleFi.getPoolIdentifiers(
      TokenA,
      TokenB,
      SwapSide.SELL,
      blocknumber,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Identifiers: `, pools);

    expect(pools.length).toBeGreaterThan(0);

    const poolPrices = await handleFi.getPricesVolume(
      TokenA,
      TokenB,
      amounts,
      SwapSide.SELL,
      blocknumber,
      pools,
    );
    console.log(`${TokenASymbol} <> ${TokenBSymbol} Pool Prices: `, poolPrices);

    expect(poolPrices).not.toBeNull();
    if (handleFi.hasConstantPriceLargeAmounts) {
      checkConstantPoolPrices(poolPrices!, amounts, dexKey);
    } else {
      checkPoolPrices(poolPrices!, amounts, SwapSide.SELL, dexKey);
    }

    // TODO figure out a way to test this without the on chain call
    // // Do on chain pricing based on reader to compare
    // const readerCallData = amounts.map(a => ({
    //   target: params.reader,
    //   callData: readerInterface.encodeFunctionData('getAmountOut', [
    //     params.vault,
    //     TokenA.address,
    //     TokenB.address,
    //     a.toString(),
    //   ]),
    // }));

    // const readerResult = (
    //   await dexHelper.multiContract.methods
    //     .aggregate(readerCallData)
    //     .call({}, blocknumber)
    // ).returnData;
    // const expectedPrices = readerResult.map((p: any) =>
    //   BigInt(
    //     readerInterface.decodeFunctionResult('getAmountOut', p)[0].toString(),
    //   ),
    // );

    // expect(poolPrices![0].prices).toEqual(expectedPrices);
  });

  it('getTopPoolsForToken', async function () {
    const dexHelper = new DummyDexHelper(network);
    const handleFi = new HandleFi(network, dexKey, dexHelper);

    await handleFi.updatePoolState();
    const poolLiquidity = await handleFi.getTopPoolsForToken(
      TokenA.address,
      10,
    );
    console.log(
      `${TokenASymbol} Top Pools:`,
      JSON.stringify(poolLiquidity, null, 2),
    );

    if (!handleFi.hasConstantPriceLargeAmounts) {
      checkPoolsLiquidity(poolLiquidity, TokenA.address, dexKey);
    }
  });
});
