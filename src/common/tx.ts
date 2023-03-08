import { NonceManager } from '@ethersproject/experimental';
import { TransactionRequest } from '@ethersproject/providers';
import { createTxRaw } from '@evmos/evmosjs/packages/proto/dist/index.js';
import { TxPayload } from '@evmos/evmosjs/packages/transactions/dist/index.js';
import { broadcast } from '@hanchon/evmos-ts-wallet';
import { BigNumber, providers, Wallet } from 'ethers';
import { arrayify, concat, splitSignature } from 'ethers/lib/utils.js';
import { useTryAsync } from 'no-try';
import { Logger } from 'winston';
import { getTransactionDetailsByHash } from '../client/index.js';

export async function refreshSignerNonce(
  signer: NonceManager,
  blockTag: 'latest' | 'pending',
  logger?: Logger
): Promise<NonceManager> {
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
  signer = await refreshSignerNonce(signer, 'latest');
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
  logger: Logger
): Promise<any> {
  let count = 0;
  let res: any;
  let prevErr = '';
  while (count <= retries) {
    res = await broadcast(signedTx, apiUrl);
    // check response. If got error, retry
    if (res.tx_response && res.tx_response.txhash) {
      if (res.tx_response.code !== 0) {
        prevErr = res.tx_response.raw_log;
        // wait 2 secs before getting tx data
        // got errors saying tx not found
        await sleep(2000);
        // query for the tx to get the logs
        res = await getTransactionDetailsByHash(apiUrl, res.tx_response.txhash);
        if (res.tx_response && res.tx_response.code !== 0) {
          // add previous logs to raw_logs to get more info about the error
          res.tx_response.raw_log = `${res.tx_response.raw_log}. ${prevErr}`;
        }
        if (res.code && res.code !== 0) {
          res.error = `${prevErr}. ${res.error}`;
        }
      }
      break;
    }
    logger.debug(
      `could not broadcast tx successfully, retrying: code ${res.code}, message ${res.message}`
    );
    count++;
    await sleep(2000); // wait 2 sec before retry
  }
  return res;
}
