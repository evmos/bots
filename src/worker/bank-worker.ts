import { IWorker, IWorkerParams } from './iworker';
import { Wallet } from '@ethersproject/wallet'
import { createMessageSend } from '@evmos/transactions'
import {
  broadcast,
  getSender,
  LOCALNET_FEE,
  signTransaction,
} from '@hanchon/evmos-ts-wallet'
import { Chain } from '@tharsis/transactions';
import { EvmosWorker, EvmosWorkerParams } from './evmos-worker';
import { recoverAddress } from 'ethers/lib/utils';

export interface BankWorkerParams extends EvmosWorkerParams {

}

export class BankWorker extends EvmosWorker {
  private readonly params: BankWorkerParams;
  constructor(params: BankWorkerParams) {
    super({
      account: params.account,
      waitForTxToMine: params.waitForTxToMine,
      provider: params.provider,
      successfulTxCounter: params.successfulTxCounter,
      failedTxCounter: params.failedTxCounter,
      onInsufficientFunds: params.onInsufficientFunds,
      logger: params.logger,
      successfulTxFeeGauge: params.successfulTxFeeGauge,
      apiUrl: params.apiUrl,
      chainId: params.chainId,
      cosmosChainId: params.cosmosChainId,
      receiverAddress: params.receiverAddress
    });
    this.params = params;
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt)
    this.logger.debug('new successful tx', {
      hash: receipt.tx_response.txhash,
      block: receipt.tx_response.height,
    });
  }

  createMessage(sender: any) : {
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
  } {
    const txSimple = createMessageSend(this.chainID, sender, LOCALNET_FEE, '', {
      destinationAddress: 'evmos1pmk2r32ssqwps42y3c9d4clqlca403yd9wymgr',
      amount: '1',
      denom: 'aevmos',
    })
    return txSimple
  }

  async action() : Promise<void> {
    try {
      const txResponse = await this.sendTransaction();
      this.onSuccessfulTx(txResponse)
    } catch (e: unknown) {
      console.log(e)
      this.onFailedTx(e);
    }
  }
}
