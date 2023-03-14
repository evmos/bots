import {
  createTxMsgSend,
  TxContext
} from 'evmosjs/packages/transactions/dist/index.js';
import { bank, defaultFees } from '../common/worker-const.js';
import { EvmosWorker, EvmosWorkerParams, Tx } from './evmos-worker.js';

export class BankWorker extends EvmosWorker {
  private readonly params: EvmosWorkerParams;
  private amount: number;
  constructor(params: EvmosWorkerParams, extra: any) {
    super({
      account: params.account,
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
    this.type = bank;
    this.extraParams = extra;
    this.amount = 1;
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt);
  }

  createMessage(sender: any): Tx {
    const ctx: TxContext = {
      chain: this.chainID,
      sender,
      fee: defaultFees,
      memo: ''
    };
    const txSimple = createTxMsgSend(ctx, {
      destinationAddress: this.params.receiverAddress as string,
      amount: this.amount.toString(),
      denom: 'aevmos'
    });
    this.amount += 1;
    return txSimple;
  }
}
