import { BigNumber, providers } from 'ethers';
import { ethSender } from '../common/worker-const.js';
import { IWorker, IWorkerParams } from './iworker.js';

export interface EthSenderWorkerParams extends IWorkerParams {
  receiverAddress: string;
}

export class EthSenderWorker extends IWorker {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  private readonly params: EthSenderWorkerParams;
  private readonly receiverAddress: string;
  private nonce: number;
  private gasPrice: BigNumber;
  constructor(params: EthSenderWorkerParams) {
    super({
      account: params.account,
      provider: params.provider,
      successfulTxCounter: params.successfulTxCounter,
      failedTxCounter: params.failedTxCounter,
      onInsufficientFunds: params.onInsufficientFunds,
      logger: params.logger,
      successfulTxFeeGauge: params.successfulTxFeeGauge
    });
    this.type = ethSender;
    this.params = params;
    this.receiverAddress = params.receiverAddress;

    this.nonce = -1;
    this.gasPrice = BigNumber.from('1000000000');
  }

  async sendTransaction(): Promise<providers.TransactionResponse> {
    if (this.nonce == -1) {
      this.nonce = await this.wallet.getTransactionCount('latest');
    }

    const tx = {
      from: this.wallet.address,
      to: this.receiverAddress,
      value: BigNumber.from('1'),
      nonce: this.nonce,
      gasLimit: '0xF4240',
      gasPrice: this.gasPrice
    };
    this.nonce = this.nonce + 1;
    return this.wallet.sendTransaction(tx);
  }

  async onSuccessfulTx(receipt: any): Promise<void> {
    this.logger.debug('new successful tx', {
      hash: receipt.transactionHash || receipt.hash,
      block: receipt.blockNumber,
      index: receipt.transactionIndex
    });
    this.successfulTxFeeGauge.set(
      {
        worker: this.account.address
      },
      receipt.gasUsed.mul(receipt.effectiveGasPrice).toNumber()
    );
    super.onSuccessfulTx(receipt);
  }

  async onFailedTx(error: any) {
    super.onFailedTx(error);
    const errorMessage = JSON.parse(error.body)['error']['message'];
    if (errorMessage && errorMessage.includes('nonce')) {
      this.nonce = await this.wallet.getTransactionCount('latest');
    } else if (errorMessage && errorMessage.includes('insufficient fee')) {
      this.gasPrice = await this.wallet.getGasPrice();
    }
  }
}
