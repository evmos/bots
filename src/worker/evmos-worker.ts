import { IWorker, IWorkerParams } from './iworker';
import { Wallet } from '@ethersproject/wallet'
import {
  broadcast,
  getSender,
  signTransaction,
} from '@hanchon/evmos-ts-wallet'
import { Chain } from '@tharsis/transactions';

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
  private readonly apiUrl : string;
  constructor(params: EvmosWorkerParams) {
    super({
      account: params.account,
      waitForTxToMine: params.waitForTxToMine,
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
  }

  async sendTransaction(): Promise<any> {
    const msg = await this.prepareMessage(this.wallet)
    const res = await signTransaction(this.wallet, msg.txSimple)
    return broadcast(res, this.apiUrl);

  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt)
    this.logger.debug('new successful tx', {
      hash: receipt.tx_response.txhash,
      block: receipt.tx_response.height,
    });
  }

  async prepareMessage(wallet: Wallet) {
    const sender = await getSender(wallet)
    const txSimple = this.createMessage(sender)
    return { sender, txSimple }
  }

  abstract createMessage(sender : any) : Tx

  async action() : Promise<void> {
    try {
      const txResponse = await this.sendTransaction();
      this.onSuccessfulTx(txResponse)
    } catch (e: unknown) {
      this.onFailedTx(e);
    }
  }
}
