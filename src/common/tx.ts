import { TransactionRequest } from '@ethersproject/providers';
import { createTxRaw } from '@evmos/evmosjs/packages/proto/dist/index.js';
import { TxPayload } from '@evmos/evmosjs/packages/transactions/dist/index.js';
import { BigNumber, providers, Signer, Wallet } from 'ethers';
import { arrayify, concat, splitSignature } from 'ethers/lib/utils.js';

export async function sendNativeCoin(
  signer: Signer,
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
