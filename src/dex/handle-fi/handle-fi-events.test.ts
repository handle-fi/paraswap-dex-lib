import dotenv from 'dotenv';
dotenv.config();

import { HandleFiEventPool } from './handle-fi-pool';
import { Network } from '../../constants';
import { DummyDexHelper } from '../../dex-helper/index';
import { testEventSubscriber } from '../../../tests/utils-events';
import { PoolState } from './types';
import { HandleFiConfig } from './config';

const dexKey = 'HandleFi';
const network = Network.ARBITRUM;
const params = HandleFiConfig[dexKey][network];

jest.setTimeout(50 * 1000);

async function fetchPoolState(
  handleFiPools: HandleFiEventPool,
  blockNumber: number,
): Promise<PoolState> {
  return handleFiPools.generateState(blockNumber);
}

function compareState(state: PoolState, expectedState: PoolState) {
  expect(state).toEqual(expectedState);
}

describe('HandleFi Event', function () {
  const blockNumbers: { [eventName: string]: number[] } = {
    IncreaseUsdgAmount: [
      19403150, 19403175, 19403183, 19403215, 19403232, 19403246, 19403344,
      19403484, 19403545, 19403553, 19403586, 19403662, 19403712, 19403721,
      19403757, 19403775, 19403782, 19403800, 19403807, 19403808, 19403826,
    ],
    DecreaseUsdgAmount: [
      19403150, 19403175, 19403183, 19403215, 19403232, 19403246, 19403344,
      19403545, 19403553, 19403662, 19403712, 19403721, 19403757, 19403775,
      19403782, 19403800, 19403807, 19403808, 19403826, 19403844, 19403848,
    ],
    Transfer: [19403484, 19403586, 19405046, 19405100, 19405154, 19405318],
    PriceUpdate: [
      19403134, 19403135, 19403140, 19403141, 19403144, 19403148, 19403151,
      19403154, 19403163, 19403169, 19403170, 19403171, 19403178, 19403185,
      19403186, 19403202,
    ],
  };

  describe('HandleFiEventPool', function () {
    Object.keys(blockNumbers).forEach((event: string) => {
      blockNumbers[event].forEach((blockNumber: number) => {
        it(`Should return the correct state after the ${blockNumber}:${event}`, async function () {
          const dexHelper = new DummyDexHelper(network);
          const logger = dexHelper.getLogger(dexKey);

          const config = await HandleFiEventPool.getConfig(
            params,
            blockNumber,
            dexHelper.multiContract,
          );
          const handlePool = new HandleFiEventPool(
            dexKey,
            network,
            dexHelper,
            logger,
            config,
          );

          await testEventSubscriber(
            handlePool,
            handlePool.addressesSubscribed,
            (_blockNumber: number) => fetchPoolState(handlePool, _blockNumber),
            blockNumber,
            `${dexKey}_${params.vault}`,
            dexHelper.provider,
            compareState,
          );
        });
      });
    });
  });
});
