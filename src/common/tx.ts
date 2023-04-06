import { NonceManager } from '@ethersproject/experimental';
import { TransactionRequest } from '@ethersproject/providers';
import { createTxRaw } from '@evmos/proto';
import {
  TxContext,
  TxPayload
} from 'evmosjs/packages/transactions/dist/index.js';
import { broadcast } from '@hanchon/evmos-ts-wallet';
import { BigNumber, providers, Wallet } from 'ethers';
import { arrayify, concat, splitSignature } from 'ethers/lib/utils.js';
import { useTryAsync } from 'no-try';
import { Logger } from 'winston';
import { getTransactionDetailsByHash } from '../client/index.js';
import { getExpectedNonce } from './utils.js';

const TX_NOT_FOUND = 'tx not found';

export async function refreshSignerNonce(
  signer: NonceManager,
  blockTag: 'latest' | 'pending',
  logger?: Logger,
  suggestedNonce?: number
): Promise<NonceManager> {
  // use suggested nonce if provided
  if (typeof suggestedNonce === 'number') {
    signer.setTransactionCount(suggestedNonce);
    return signer;
  }
  // otherwise use the getTransactionCount function
  const [err, txCount] = await useTryAsync(() =>
    signer.getTransactionCount(blockTag)
  );
  if (err) {
    logger
      ? logger.error('failed to get account nonce', {
          error: err
        })
      : // eslint-disable-next-line no-console
        console.error(err);
  } else {
    signer.setTransactionCount(txCount);
  }
  return signer;
}

export async function sendNativeCoin(
  signer: NonceManager,
  toAddress: string,
  amountInBase: string,
  waitForTxToMine: boolean
) {
  const tx: TransactionRequest = {
    to: toAddress,
    value: BigNumber.from(amountInBase)
  };

  // const estimate = await signer.estimateGas(tx);

  // tx.gasLimit = estimate;
  const txResponse = await signer.sendTransaction(tx);
  if (waitForTxToMine) await txResponse.wait();
}

export async function getNativeCoinBalance(
  provider: providers.Provider,
  address: string
) {
  return provider.getBalance(address);
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sign transaction is the same func as on hanchon lib but with toBinary()
 * Using the hanchon lib function crashes
 * @param wallet
 * @param tx
 * @param broadcastMode
 * @returns
 */
export async function signTransaction(
  wallet: Wallet,
  tx: TxPayload,
  broadcastMode = 'BROADCAST_MODE_BLOCK'
) {
  const dataToSign = `0x${Buffer.from(
    tx.signDirect.signBytes,
    'base64'
  ).toString('hex')}`;

  /* eslint-disable no-underscore-dangle */
  const signatureRaw = wallet._signingKey().signDigest(dataToSign);
  const splitedSignature = splitSignature(signatureRaw);
  const signature = arrayify(concat([splitedSignature.r, splitedSignature.s]));
  const signedTx = createTxRaw(
    tx.signDirect.body.toBinary(),
    tx.signDirect.authInfo.toBinary(),
    [signature]
  );

  const body = `{ "tx_bytes": [${signedTx.message
    .toBinary()
    .toString()}], "mode": "${broadcastMode}" }`;

  return body;
}

export async function broadcastTxWithRetry(
  signedTx: string,
  apiUrl: string,
  retries: number,
  logger?: Logger
): Promise<any> {
  let count = 0;
  let res: any;
  while (count < retries) {
    res = await broadcast(signedTx, apiUrl);
    // check response. If got error, retry
    if (res.tx_response && res.tx_response.txhash) {
      // sometimes the tx goes thru but returns code != 0 and without logs
      // for this case, we get the transactions details
      if (res.tx_response.code !== 0 && !res.tx_response.raw_log) {
        // wait 2 secs before getting tx data
        await sleep(2000);
        // query for the tx to get the logs
        res = await getTransactionDetailsByHash(apiUrl, res.tx_response.txhash);
      }
      break;
    }
    logger?.debug(
      `could not broadcast tx successfully, retrying: code ${res.code}, message ${res.message}`
    );
    count++;
    await sleep(2000); // wait 2 sec before retry
  }
  return res;
}

export async function sendCosmosTxWithNonceRefresher(
  ctx: TxContext,
  msgParams: any,
  createMsg: (ctx: TxContext, msg: any) => TxPayload,
  wallet: Wallet,
  apiUrl: string,
  retries: number,
  backoff: number,
  logger?: Logger,
  logActionMsg?: string
): Promise<any> {
  let count = 0;
  let nonceSuggestion: number | undefined;
  let res: any;
  while (count < retries) {
    if (nonceSuggestion) {
      ctx.sender.sequence = nonceSuggestion;
    }
    const msg = createMsg(ctx, msgParams);
    const signed = await signTransaction(wallet, msg);
    res = await broadcastTxWithRetry(signed, apiUrl, retries, logger);

    const code = res.code || res.tx_response.code;
    if (code == 0) {
      // transaction successful, break the loop
      break;
    } else {
      const errMsg = res.message || res.tx_response.raw_log;
      if (errMsg && errMsg.includes('sequence mismatch')) {
        // in case it is invalid nonce, retry with the refreshed signer
        logger?.debug(
          `nonce error while ${
            logActionMsg || 'broadcasting tx'
          }. retrying with refreshed nonce`
        );
        nonceSuggestion = getExpectedNonce(errMsg);
      } else {
        // another error happened, return the response
        break;
      }
    }
    await sleep(backoff);
    count++;
  }
  return res;
}

export function getFailedTxReason(error: string | undefined): string {
  if (error?.includes(TX_NOT_FOUND)) {
    return TX_NOT_FOUND;
  }
  return error?.split(':')[0] || '';
}
