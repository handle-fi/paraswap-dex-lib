import { DexParams } from './types';
import { DexConfigMap, AdapterMappings } from '../../types';
import { Network, SwapSide } from '../../constants';

export const HandleFiConfig: DexConfigMap<DexParams> = {
  HandleFi: {
    [Network.ARBITRUM]: {
      vault: '0x1785e8491e7e9d771b2A6E9E389c25265F06326A',
      router: '0x434b5245f6Fe54D0C9F881d55c2Ba27fe7132d89',
      usdg: '0x823412ac2FfD566cFE35560A850EFec81337e67f',
      priceFeed: '0xf28e261b89fc4479ee41044dd55f7a4053f9844a',
      reader: '0xCb7AEB7f471D1c19C78E3cd578ee5Ff0788278B6',
    },
  },
};

export const Adapters: Record<number, AdapterMappings> = {
  [Network.ARBITRUM]: {
    [SwapSide.SELL]: [{ name: 'ArbitrumAdapter01', index: 14 }],
  },
};
