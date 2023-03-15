import { Fee } from 'evmosjs/packages/transactions/dist/messages/common.js';

export const bank = 'bank';
export const delegate = 'delegate';
export const gasConsumer = 'gasConsumer';
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
  amount: '1000000000000000',
  gas: '2000000'
};
