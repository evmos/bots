import { BigNumber, providers, utils } from 'ethers';
import { ethSender } from '../common/worker-const';
import { IWorker, IWorkerParams } from './iworker';

export interface EthSenderWorkerParams extends IWorkerParams {
  receiverAddress: string;
}

export class EthSenderWorker extends IWorker {
  private readonly params: EthSenderWorkerParams;
  private readonly receiverAddress: string;
  constructor(params: EthSenderWorkerParams) {
    super({
      account: params.account,
      waitForTxToMine: params.waitForTxToMine,
      provider: params.provider,
      successfulTxCounter: params.successfulTxCounter,
      failedTxCounter: params.failedTxCounter,
      onInsufficientFunds: params.onInsufficientFunds,
      logger: params.logger,
      successfulTxFeeGauge: params.successfulTxFeeGauge
    });
    this.type = ethSender
    this.params = params;
    this.receiverAddress = params.receiverAddress
  }

  async sendTransaction(): Promise<providers.TransactionResponse> {
    const tx = {
      from: this.wallet.address,
      to: this.receiverAddress,
      value: BigNumber.from("1"),
      nonce: this.wallet.getTransactionCount("pending"),
      gasLimit: "0x100000",
      gasPrice: this.wallet.getGasPrice(),
    }
    return this.wallet.sendTransaction(tx)
  }

  async action() : Promise<void> {
    let txResponse
    try {
      txResponse = await this.sendTransaction();
      txResponse.wait().then((txReceipt: any) => {
        this.onSuccessfulTx(txReceipt);
      });
    } catch (e: unknown) {
      console.log(e)
      this.onFailedTx(e);
    }
    return;
  }

  async onSuccessfulTx(receipt: any): Promise<void> {
    this.logger.debug('new successful tx', {
      hash: receipt.transactionHash,
      block: receipt.blockNumber,
      index: receipt.transactionIndex
    });
    this.successfulTxFeeGauge.set(
    {
      worker: this.account.address
    },
    receipt.gasUsed.mul(receipt.effectiveGasPrice).toNumber()
    );
    super.onSuccessfulTx(receipt)
  }
}
