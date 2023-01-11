import { createMessageSend } from '@evmos/transactions'
import { LOCALNET_FEE } from '@hanchon/evmos-ts-wallet'
import { bank } from '../common/worker-const';
import { EvmosWorker, EvmosWorkerParams, Tx } from './evmos-worker';


export class BankWorker extends EvmosWorker {
  private readonly params: EvmosWorkerParams;
  private amount : number;
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
    this.type = bank
    this.extraParams = extra;
    this.amount = 1
  }

  async onSuccessfulTx(receipt: any) {
    super.onSuccessfulTx(receipt);
  }

  createMessage(sender: any) : Tx {
    const txSimple = createMessageSend(this.chainID, sender, LOCALNET_FEE, '', {
      destinationAddress: this.params.receiverAddress,
      amount: this.amount.toString(),
      denom: 'aevmos',
    })
    this.amount += 1;
    return txSimple
  }
}
