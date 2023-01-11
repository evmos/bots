import { IWorker, IWorkerParams } from './iworker';
import { Wallet } from '@ethersproject/wallet'
import {
  broadcast,
  getSender,
  signTransaction,
} from '@hanchon/evmos-ts-wallet'
import { Chain } from '@evmos/transactions';
import { useTryAsync } from 'no-try';
import { sleep } from '../common/tx';

export interface Tx {
    signDirect: {
        body: import("@evmos/proto/dist/proto/cosmos/tx/v1beta1/tx").cosmos.tx.v1beta1.TxBody;
        authInfo: import("@evmos/proto/dist/proto/cosmos/tx/v1beta1/tx").cosmos.tx.v1beta1.AuthInfo;
        signBytes: string;
    };
    legacyAmino: {
        body: import("@evmos/proto/dist/proto/cosmos/tx/v1beta1/tx").cosmos.tx.v1beta1.TxBody;
        authInfo: import("@evmos/proto/dist/proto/cosmos/tx/v1beta1/tx").cosmos.tx.v1beta1.AuthInfo;
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
  receiverAddress: string;
  apiUrl: string;
  chainId: number;
  cosmosChainId: string;
}

export abstract class EvmosWorker extends IWorker {
  protected readonly chainID : Chain;
  protected readonly apiUrl : string;
  protected sequence : number;
  constructor(params: EvmosWorkerParams) {
    super({
      account: params.account,
      provider: params.provider,
      successfulTxCounter: params.successfulTxCounter,
      failedTxCounter: params.failedTxCounter,
      onInsufficientFunds: params.onInsufficientFunds,
      logger: params.logger,
      successfulTxFeeGauge: params.successfulTxFeeGauge,
    });
    this.apiUrl = params.apiUrl;
    this.chainID = { 
      chainId: params.chainId,
      cosmosChainId: params.cosmosChainId,
    }

    this.sequence = 0

  }

  async sendTransaction(): Promise<any> {
    const txSimple = await this.prepareMessage()
    const res = await signTransaction(this.wallet, txSimple)
    return broadcast(res, this.apiUrl);
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt)
    this.logger.debug('new successful tx', {
      hash: receipt.tx_response.txhash,
      block: receipt.tx_response.height,
    });
  }

  async prepareMessage() {
    let sender = await getSender(this.wallet, this.apiUrl)
    sender.sequence = this.sequence
    const txSimple = this.createMessage(sender)
    this.sequence = this.sequence + 1;
    return txSimple 
  }

  abstract createMessage(sender : any) : Tx

  async action() : Promise<void> {
    try {
      const txResponse = await this.sendTransaction();
          if (txResponse.tx_response != undefined && txResponse.tx_response.code == 0)
          {
            this.onSuccessfulTx(txResponse)
          }
          else if (txResponse.tx_response != undefined && txResponse.tx_response.code != 0)
          {
            this.onFailedTx(txResponse.tx_response);
          }
          else 
          {  
            let sender = await getSender(this.wallet, this.apiUrl)
            this.sequence = sender.sequence
            this.onFailedTx({code: txResponse.code, raw_log: txResponse.message});
          }
    } catch (e: unknown) {
      console.log("Catched error")
      console.log(e)
      this.onFailedTx(e);
    }
  }

  async onFailedTx(error: any) {
    super.onFailedTx({code : error.code, message: error.raw_log})
    if (error.raw_log.includes('account sequence mismatch'))
    {
      let endPos = error.raw_log.indexOf(',', 36)
      let expectedSequence : string = error.raw_log.substring(36, endPos)
      this.sequence = parseInt(expectedSequence);
    }
  }


  async run(): Promise<void> {
    while (!this._isStopped) {
      if (!this._isLowOnFunds) {
        await this.action()
      } else {
        // delay to prevent loop from running synchronously
        await sleep(1000);
      }
    }
  }
}
