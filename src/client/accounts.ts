import { getSender } from '@hanchon/evmos-ts-wallet';
import { Wallet } from 'ethers';
import { Logger } from 'winston';
import { sleep } from '../common/tx.js';

// add retries for this func
// getting errors that Cannot read properties of undefined (reading 'base_account')
export async function getSenderWithRetry(
  wallet: Wallet,
  url = 'http://127.0.0.1:1317',
  retries: number,
  logger?: Logger
): Promise<{
  accountAddress: string;
  sequence: number;
  accountNumber: number;
  pubkey: string;
}> {
  let sender = {
    accountAddress: '',
    sequence: 0,
    accountNumber: 0,
    pubkey: 'string'
  };
  let count = 0;
  while (count < retries) {
    try {
      sender = await getSender(wallet, url);
      break;
    } catch (error) {
      logger
        ? logger.debug(`error while getting sender: ${error}`)
        : console.error(error);
    }
    count++;
    await sleep(2000); // wait 2 sec before retry
  }
  if (!sender.accountAddress) {
    throw Error(`could not get sender with address ${wallet.address}`);
  }
  return sender;
}
