import { Contract, providers } from 'ethers';
import { gasConsumer } from '../common/worker-const';
import { IWorker, IWorkerParams } from './iworker';

export interface GasConsumerWorkerParams extends IWorkerParams {
  contractAddress: string;
  gasToConsumePerTX: string;
}

const CONTRACT_INTERFACES = [
  'function go(uint256 gasAmount) public payable returns (uint256 gasUsed)'
];

export class GasConsumerWorker extends IWorker {
  private readonly params: GasConsumerWorkerParams;
  private readonly contract: Contract;
  constructor(params: GasConsumerWorkerParams) {
    super({
      account: params.account,
      provider: params.provider,
      successfulTxCounter: params.successfulTxCounter,
      failedTxCounter: params.failedTxCounter,
      onInsufficientFunds: params.onInsufficientFunds,
      logger: params.logger,
      successfulTxFeeGauge: params.successfulTxFeeGauge
    });
    this.type = gasConsumer
    this.params = params;
    this.contract = new Contract(
      params.contractAddress,
      CONTRACT_INTERFACES,
      this.signer
    );
  }

  async sendTransaction(): Promise<providers.TransactionResponse> {
    return this.contract.go(this.params.gasToConsumePerTX);
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
