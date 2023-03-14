import { Fee } from 'evmosjs/packages/transactions/dist/messages/common.js';

export const bank = 'bank';
export const delegate = 'delegate';
export const gasConsumer = 'gas-consumer';
export const converter = 'converter';
export const ethSender = 'ethSender';
export const workersToSpan = [
  bank,
  delegate,
  converter,
  gasConsumer,
  ethSender
];
export const defaultFees: Fee = {
  denom: 'aevmos',
  amount: '10000000000000',
  gas: '2000000'
};
