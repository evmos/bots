import { IWorker, IWorkerParams } from './iworker.js';
import { Chain } from '@evmos/evmosjs/packages/transactions/dist/index.js';
import { broadcastTxWithRetry, signTransaction, sleep } from '../common/tx.js';
import { getSenderWithRetry } from '../client/index.js';

export interface Tx {
  signDirect: {
    body: import('@evmos/evmosjs/packages/proto/dist/proto/cosmos/transactions/tx.js').TxBody;
    authInfo: import('@evmos/evmosjs/packages/proto/dist/proto/cosmos/transactions/tx.js').AuthInfo;
    signBytes: string;
  };
  legacyAmino: {
    body: import('@evmos/evmosjs/packages/proto/dist/proto/cosmos/transactions/tx.js').TxBody;
    authInfo: import('@evmos/evmosjs/packages/proto/dist/proto/cosmos/transactions/tx.js').AuthInfo;
    signBytes: string;
  };
  eipToSign: {
    types: object;
    primaryType: string;
    domain: {
      name: string;
      version: string;
      chainId: number;
      verifyingContract: string;
      salt: string;
    };
    message: object;
  };
}

export interface EvmosWorkerParams extends IWorkerParams {
  receiverAddress: string | string[];
  apiUrl: string;
  chainId: number;
  cosmosChainId: string;
}

export abstract class EvmosWorker extends IWorker {
  protected readonly chainID: Chain;
  protected readonly apiUrl: string;
  protected readonly retries = 5;
  protected readonly backofff = 1500; // retrt backoff in millisec
  protected _updateSequence = false;
  protected sequence: number;
  constructor(params: EvmosWorkerParams) {
    super({
      account: params.account,
      provider: params.provider,
      successfulTxCounter: params.successfulTxCounter,
      failedTxCounter: params.failedTxCounter,
      onInsufficientFunds: params.onInsufficientFunds,
      logger: params.logger,
      successfulTxFeeGauge: params.successfulTxFeeGauge
    });
    this.apiUrl = params.apiUrl;
    this.chainID = {
      chainId: params.chainId,
      cosmosChainId: params.cosmosChainId
    };

    this.sequence = 0;
  }

  async sendTransaction(): Promise<any> {
    const txSimple = await this.prepareMessage();
    const res = await signTransaction(this.wallet, txSimple as any);
    return broadcastTxWithRetry(res, this.apiUrl, this.retries, this.logger);
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt);
    // in case the receipt comes from an eth tx
    // will not have the 'tx_response' field
    if (receipt.tx_response) {
      this.logger.debug('new successful tx', {
        hash: receipt.tx_response.txhash,
        block: receipt.tx_response.height
      });
    }
  }

  async prepareMessage() {
    const sender = await getSenderWithRetry(
      this.wallet,
      this.apiUrl,
      this.retries,
      this.logger
    );
    // fix the sequence in case there's a mismatch
    if (this._updateSequence) {
      sender.sequence = this.sequence;
      this._updateSequence = false;
    }
    const txSimple = this.createMessage(sender);
    this.sequence = this.sequence + 1;
    return txSimple;
  }

  abstract createMessage(sender: any): Tx;

  async action(): Promise<void> {
    try {
      const txResponse = await this.sendTransaction();
      if (
        txResponse.tx_response != undefined &&
        txResponse.tx_response.code == 0
      ) {
        this.onSuccessfulTx(txResponse);
      } else if (
        txResponse.tx_response != undefined &&
        txResponse.tx_response.code != 0
      ) {
        this.onFailedTx(txResponse.tx_response);
      } else {
        const sender = await getSenderWithRetry(
          this.wallet,
          this.apiUrl,
          this.retries,
          this.logger
        );
        this.sequence = sender.sequence;
        this.onFailedTx({ code: txResponse.code, raw_log: txResponse.message });
      }
    } catch (e: unknown) {
      console.log('Catched error');
      console.log(e);
      this.onFailedTx(e);
    }
  }

  async onFailedTx(error: any) {
    super.onFailedTx({ code: error.code, message: error.raw_log });
    if (error.raw_log.includes('account sequence mismatch')) {
      const endPos = error.raw_log.indexOf(',', 36);
      const expectedSequence: string = error.raw_log.substring(36, endPos);
      this.sequence = parseInt(expectedSequence);
      this._updateSequence = true;
    }
  }

  async run(): Promise<void> {
    while (!this._isStopped) {
      if (!this._isLowOnFunds) {
        await this.action();
      }
      // delay to prevent failure due to block gas limit
      // and stuck the main thread
      await sleep(3000);
    }
  }
}
