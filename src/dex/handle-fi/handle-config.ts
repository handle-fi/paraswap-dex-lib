import axios from 'axios';
import { BigNumber, ethers } from 'ethers';

export const ADDRESS_TO_CURRENCY = {
  '0x7e141940932e3d13bfa54b224cb4a16510519308': 'AUD',
  '0x116172b2482c5dc3e6f445c16ac13367ac3fcd35': 'EUR',
  '0x3d147cd9ac957b2a5f968de9d1c6b9d0872286a0': 'PHP',
  '0x8616e8ea83f048ab9a5ec513c9412dd2993bce3f': 'fxUSD',
  '0x2c29daace6aa05e3b65743efd61f8a2c448302a3': 'CNY',
  '0xf4e8ba79d058fff263fd043ef50e1010c1bdf991': 'KRW',
  '0x8c414cb8a9af9f7b03673e93df73c23c1aa05b4e': 'CHF',
  '0x398b09b68aec6c58e28ade6147dac2ecc6789737': 'CAD',
  '0x1ae27d9068dadf10f611367332d162d184ed3414': 'GBP',
  '0x95e0e6230e9e965a4f12ede5ba8238aa04a85bc6': 'JPY',
  '0x55a90f0eb223f3b2c0c0759f375734c48220decb': 'SGD',
  '0x82af49447d8a07e3bd95bd0d56f35241523fbab1': 'ETH',
} as Record<string, string>;

export const SYMBOL_TO_ADDRESS = {
  fxAUD: '0x7e141940932e3d13bfa54b224cb4a16510519308',
  fxEUR: '0x116172b2482c5dc3e6f445c16ac13367ac3fcd35',
  fxPHP: '0x3d147cd9ac957b2a5f968de9d1c6b9d0872286a0',
  fxUSD: '0x8616e8ea83f048ab9a5ec513c9412dd2993bce3f',
  fxCNY: '0x2c29daace6aa05e3b65743efd61f8a2c448302a3',
  fxKRW: '0xf4e8ba79d058fff263fd043ef50e1010c1bdf991',
  fxCHF: '0x8c414cb8a9af9f7b03673e93df73c23c1aa05b4e',
  fxCAD: '0x398b09b68aec6c58e28ade6147dac2ecc6789737',
  fxGBP: '0x1ae27d9068dadf10f611367332d162d184ed3414',
  fxJPY: '0x95e0e6230e9e965a4f12ede5ba8238aa04a85bc6',
  fxSGD: '0x55a90f0eb223f3b2c0c0759f375734c48220decb',
  WETH: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
} as Record<string, string>;

export const ORACLE_URL = 'https://oracle.handle.fi';
